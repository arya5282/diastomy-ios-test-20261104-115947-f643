import UIKit
import WebKit
import AVKit

// All documents, scripts, fonts and styles are shipped in Web/.
// Only JSON APIs and explicitly authorized media use the network.
final class BrowserViewController: UIViewController, WKNavigationDelegate, WKScriptMessageHandlerWithReply, URLSessionTaskDelegate, AVPlayerViewControllerDelegate {
    private var webView: WKWebView!
    private let server = URL(string: "https://diastomy.top")!
    private var webRoot: URL!
    private var startupPanel: UIView?
    private var startupTimer: Timer?
    private var player: AVPlayer?
    private var playerController: AVPlayerViewController?
    private var progressObserver: Any?
    private var progressTarget: [String: Any] = [:]
    private var api: URLSession!
    private var socket: URLSessionWebSocketTask?
    private var roomTimer: Timer?
    private var roomCode: String?
    private var playingRoom: String?
    private var roomState: [String: Any]?
    private var serverOffset = 0.0
    private let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask { .allButUpsideDown }

    override func viewDidLoad() {
        super.viewDidLoad()
        StartupDiagnostics.record(stage: "controllerLoaded")
        view.backgroundColor = .black
        let session = URLSessionConfiguration.default
        session.httpCookieStorage = .shared
        session.httpShouldSetCookies = true
        session.requestCachePolicy = .reloadIgnoringLocalCacheData
        session.timeoutIntervalForRequest = 25
        api = URLSession(configuration: session, delegate: self, delegateQueue: .main)
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        // Info.plist opts into app-bound domains. Local files also need this
        // flag to use message handlers and JavaScript evaluation on iOS.
        configuration.limitsNavigationsToAppBoundDomains = true
        configuration.allowsInlineMediaPlayback = true
        configuration.allowsAirPlayForMediaPlayback = true
        configuration.allowsPictureInPictureMediaPlayback = true
        configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "native")
        configuration.applicationNameForUserAgent = "DiastomyIOS/2.0"
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        loadBundledInterface()
    }

    private func loadBundledInterface() {
        startupTimer?.invalidate()
        showStartupPanel(message: "در حال آماده‌سازی دیاستومی…", canRetry: false)
        guard let index = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "Web") else {
            startupFailed("فایل‌های رابط برنامه موجود نیستند؛ نسخهٔ کامل را دوباره نصب کنید.")
            return
        }
        webRoot = index.deletingLastPathComponent().standardizedFileURL
        for name in ["index.html", "app.js", "app.css", "assets/Yekan.woff2", "assets/logo.svg"] {
            guard FileManager.default.fileExists(atPath: webRoot.appendingPathComponent(name).path) else {
                startupFailed("فایل‌های رابط برنامه ناقص‌اند؛ نسخهٔ کامل را دوباره نصب کنید.")
                return
            }
        }
        startupTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: false) { [weak self] _ in
            self?.startupFailed("رابط برنامه آماده نشد. روی تلاش دوباره بزنید.")
        }
        StartupDiagnostics.record(stage: "loadingLocalDocument", localDocument: isLocal(index))
        webView.loadFileURL(index, allowingReadAccessTo: webRoot)
    }

    private func isLocal(_ url: URL?) -> Bool {
        guard let url = url, url.isFileURL, let root = webRoot else { return false }
        // /var and /private/var can identify the same iOS bundle. Compare
        // canonical path components, without a fragile trailing-slash prefix.
        let base = root.resolvingSymlinksInPath().standardizedFileURL.pathComponents
        let target = url.resolvingSymlinksInPath().standardizedFileURL.pathComponents
        return target.count > base.count && Array(target.prefix(base.count)) == base
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        let allowed = isLocal(action.request.url)
        decisionHandler(allowed ? .allow : .cancel)
        if !allowed && action.targetFrame?.isMainFrame != false {
            startupFailed("باز کردن این صفحه داخل برنامه مجاز نیست.")
        }
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        StartupDiagnostics.record(stage: "documentCommitted", localDocument: isLocal(webView.url))
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        StartupDiagnostics.record(stage: "checkingNativeBridge", localDocument: isLocal(webView.url))
        guard isLocal(webView.url) else { return }
        // Rendering the bundled UI does not require a native API round trip.
        webView.evaluateJavaScript(
            """
            Boolean(document.querySelector('#app')?.firstElementChild &&
                    document.querySelector('nav') &&
                    getComputedStyle(document.querySelector('nav')).position === 'fixed');
            """
        ) { [weak self] value, error in
            guard let self = self else { return }
            if let error = error {
                self.startupFailed("رابط برنامه اجرا نشد. کد خطا: \((error as NSError).code)")
            } else if value as? Bool == true {
                self.startupDidBecomeReady()
            } else {
                self.startupFailed("بررسی رابط برنامه ناموفق بود.")
            }
        }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        navigationFailed(error)
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        navigationFailed(error)
    }

    private func navigationFailed(_ error: Error) {
        let problem = error as NSError
        if problem.domain == NSURLErrorDomain && problem.code == NSURLErrorCancelled { return }
        startupFailed("باز کردن رابط برنامه ناموفق بود. کد خطا: \(problem.code)")
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        startupFailed("بخش رابط برنامه متوقف شد. روی تلاش دوباره بزنید.")
    }

    private func showStartupPanel(message: String, canRetry: Bool) {
        startupPanel?.removeFromSuperview()
        let panel = UIView()
        panel.backgroundColor = .black
        panel.translatesAutoresizingMaskIntoConstraints = false
        let label = UILabel()
        label.text = message
        label.textColor = .white
        label.font = .systemFont(ofSize: 17)
        label.textAlignment = .center
        label.numberOfLines = 0
        let retry = UIButton(type: .system)
        retry.setTitle("تلاش دوباره", for: .normal)
        retry.tintColor = .white
        retry.isHidden = !canRetry
        retry.addTarget(self, action: #selector(retryStartup), for: .touchUpInside)
        let stack = UIStackView(arrangedSubviews: [label, retry])
        stack.axis = .vertical
        stack.spacing = 24
        stack.translatesAutoresizingMaskIntoConstraints = false
        panel.addSubview(stack)
        view.addSubview(panel)
        NSLayoutConstraint.activate([
            panel.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            panel.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            panel.topAnchor.constraint(equalTo: view.topAnchor),
            panel.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            stack.centerXAnchor.constraint(equalTo: panel.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: panel.centerYAnchor),
            stack.leadingAnchor.constraint(equalTo: panel.leadingAnchor, constant: 28),
            stack.trailingAnchor.constraint(equalTo: panel.trailingAnchor, constant: -28)
        ])
        startupPanel = panel
    }

    @objc private func retryStartup() { loadBundledInterface() }

    private func startupFailed(_ message: String) {
        startupTimer?.invalidate()
        showStartupPanel(message: message, canRetry: true)
        writeStartupReport(ready: false, message: message)
    }

    private func writeStartupReport(ready: Bool, message: String? = nil) {
        StartupDiagnostics.record(stage: ready ? "ready" : "failed", ready: ready,
                                  localDocument: isLocal(webView.url), message: message ?? "")
    }

    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse, newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        // API redirects usually mean an expired login; never load the HTML login page.
        completionHandler(nil)
    }

    private func allowed(_ path: String) -> URL? {
        guard path.hasPrefix("/"), !path.hasPrefix("//"),
              !path.contains("\\"), let url = URL(string: path, relativeTo: server)?.absoluteURL,
              url.scheme == "https", url.host == server.host, url.user == nil,
              url.fragment == nil, url.port == nil else { return nil }
        let p = url.path
        let exact: Set<String> = [
            "/movie/api/filter/", "/movie/api/actors/", "/accounts/api/login-password/",
            "/accounts/api/check-phone/", "/accounts/api/send-otp/", "/accounts/api/verify-otp/",
            "/accounts/api/complete-registration/", "/accounts/api/logout/",
            "/accounts/api/forgot-password-request/", "/accounts/api/forgot-password-verify/",
            "/accounts/api/forgot-password-reset/", "/accounts/api/notifications/",
            "/accounts/api/notifications/mark-read/", "/accounts/api/change-password/",
            "/accounts/api/update-profile/", "/accounts/api/update-player-quality/",
            "/accounts/api/set-language/", "/accounts/api/plans/", "/accounts/api/payments/",
            "/accounts/api/create-payment/",
            "/api/bookmark/toggle/", "/api/watch-progress/", "/api/watch-time/",
            "/accounts/support/api/messages/", "/accounts/support/api/send/"
        ]
        if exact.contains(p) || p.hasPrefix("/api/app/v1/") || p.hasPrefix("/movie/api/actor/") || p.hasPrefix("/movie/api/watch-state/") {
            return url
        }
        return nil
    }

    private func send(_ path: String, method: String = "GET", body: Any? = nil,
                      completion: @escaping ([String: Any]) -> Void) {
        #if DEBUG
        if StartupDiagnostics.isOfflineTest {
            completion(["status": 0, "data": ["error": "Offline startup test"]]); return
        }
        #endif
        guard let url = allowed(path), ["GET", "POST"].contains(method) else {
            completion(["status": 400, "data": ["error": "درخواست معتبر نیست."]]); return
        }
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("DiastomyIOS/2.0", forHTTPHeaderField: "User-Agent")
        request.setValue("https://diastomy.top", forHTTPHeaderField: "Origin")
        request.setValue("https://diastomy.top/", forHTTPHeaderField: "Referer")
        if method == "POST" {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            if let cookie = HTTPCookieStorage.shared.cookies(for: server)?.first(where: { $0.name == "csrftoken" }) {
                request.setValue(cookie.value, forHTTPHeaderField: "X-CSRFToken")
            }
            request.httpBody = try? JSONSerialization.data(withJSONObject: body ?? [:])
        }
        api.dataTask(with: request) { data, response, error in
            if error != nil { completion(["status": 0, "data": ["error": "اتصال به سرور برقرار نشد."]]); return }
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard let data = data, let json = try? JSONSerialization.jsonObject(with: data) else {
                completion(["status": status == 200 ? 502 : status,
                            "data": ["error": "پاسخ API معتبر نیست؛ اتصال یا ورود را بررسی کنید."]]); return
            }
            completion(["status": status, "data": json])
        }.resume()
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        // On device WebKit, frameInfo.request.url may not be the committed
        // file URL. Validate the active main-frame document instead.
        guard message.frameInfo.isMainFrame, isLocal(webView.url),
              let data = message.body as? [String: Any], let action = data["action"] as? String else {
            replyHandler(nil, "Untrusted document"); return
        }
        if action == "request", let path = data["path"] as? String {
            send(path, method: data["method"] as? String ?? "GET", body: data["body"]) { replyHandler($0, nil) }
        } else if action == "play", let kind = data["kind"] as? String,
                  ["movie", "series"].contains(kind), let id = data["id"] as? Int, id > 0 {
            let code = data["room"] as? String
            let room = code != nil && code == roomCode ? "?room=" + code! : ""
            send("/api/app/v1/playback/\(kind)/\(id)/" + room) { result in
                guard result["status"] as? Int == 200, let info = result["data"] as? [String: Any],
                      let value = info["url"] as? String, let url = URL(string: value),
                      url.scheme == "https", url.host == self.server.host,
                      url.path.hasPrefix("/movie/\(kind)-direct-hls/") else { replyHandler(result, nil); return }
                self.playingRoom = room.isEmpty ? nil : code
                self.presentPlayer(url, info: info)
                replyHandler(["status": 200, "data": ["playing": true]], nil)
            }
        } else if action == "checkout", let plan = data["plan"] as? Int, plan > 0 {
            send("/accounts/api/create-payment/", method: "POST", body: ["plan_id": plan, "discount_code": data["discount"] as? String ?? ""]) { result in
                guard let info = result["data"] as? [String: Any], info["success"] as? Bool == true,
                      let value = info["redirect_url"] as? String, let url = URL(string: value),
                      url.scheme == "https", let host = url.host,
                      host == "zibal.ir" || host.hasSuffix(".zibal.ir") || host == "zarinpal.com" || host.hasSuffix(".zarinpal.com") else {
                    replyHandler(result, nil); return
                }
                UIApplication.shared.open(url) { opened in replyHandler(["status": opened ? 200 : 502, "data": ["opened": opened]], nil) }
            }
        } else if action == "roomOpen", let code = data["code"] as? String,
                  code.range(of: "^[A-Za-z0-9_-]{1,16}$", options: .regularExpression) != nil {
            socket?.cancel(with: .goingAway, reason: nil)
            roomCode = code
            var request = URLRequest(url: URL(string: "wss://diastomy.top/ws/movie-room/\(code)/")!)
            request.setValue("https://diastomy.top", forHTTPHeaderField: "Origin")
            let cookies = HTTPCookieStorage.shared.cookies(for: server) ?? []
            for (key, value) in HTTPCookie.requestHeaderFields(with: cookies) { request.setValue(value, forHTTPHeaderField: key) }
            let next = api.webSocketTask(with: request)
            socket = next
            next.resume()
            receiveRoom(next)
            roomTimer?.invalidate()
            roomTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in self?.syncRoom() }
            replyHandler(["ok": true], nil)
        } else if action == "roomSend", let value = data["message"] as? [String: Any],
                  let bytes = try? JSONSerialization.data(withJSONObject: value),
                  let string = String(data: bytes, encoding: .utf8), let socket = socket {
            socket.send(.string(string)) { error in
                DispatchQueue.main.async { replyHandler(["ok": error == nil], nil) }
            }
        } else if action == "roomClose" {
            socket?.cancel(with: .goingAway, reason: nil)
            socket = nil
            roomTimer?.invalidate()
            roomTimer = nil
            roomCode = nil
            roomState = nil
            if playingRoom != nil { player?.pause() }
            playingRoom = nil
            replyHandler(["ok": true], nil)
        } else if action == "clearCache" {
            webView.evaluateJavaScript("localStorage.clear()") { _, _ in replyHandler(["ok": true], nil) }
        } else {
            replyHandler(nil, "Unsupported action")
        }
    }

    private func startupDidBecomeReady() {
        startupTimer?.invalidate()
        startupPanel?.removeFromSuperview()
        startupPanel = nil
        writeStartupReport(ready: true)
    }

    private func presentPlayer(_ url: URL, info: [String: Any]) {
        if let token = progressObserver, let previous = player { previous.removeTimeObserver(token) }
        let cookies = HTTPCookieStorage.shared.cookies(for: server) ?? []
        let asset = AVURLAsset(url: url, options: [AVURLAssetHTTPCookiesKey: cookies])
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
        try? AVAudioSession.sharedInstance().setActive(true)
        let next = AVPlayer(playerItem: AVPlayerItem(asset: asset))
        player = next
        progressTarget = info["target"] as? [String: Any] ?? [:]
        let controller = AVPlayerViewController()
        controller.player = next
        controller.delegate = self
        controller.modalPresentationStyle = .fullScreen
        controller.allowsPictureInPicturePlayback = true
        playerController = controller
        let position = info["position"] as? Double ?? 0
        if position > 0 { next.seek(to: CMTime(seconds: position, preferredTimescale: 600)) }
        progressObserver = next.addPeriodicTimeObserver(forInterval: CMTime(seconds: 15, preferredTimescale: 1), queue: .main) { [weak self, weak controller] time in
            guard let self = self, controller?.presentingViewController != nil,
                  time.seconds.isFinite, let total = self.player?.currentItem?.duration.seconds,
                  total.isFinite, total > 0 else { return }
            var body = self.progressTarget
            body["watched_duration"] = Int(time.seconds)
            body["total_duration"] = Int(total)
            self.send("/api/watch-progress/", method: "POST", body: body) { _ in }
        }
        present(controller, animated: true) {
            if self.playingRoom != nil { self.syncRoom() } else { next.play() }
        }
    }
    func playerViewController(_ playerViewController: AVPlayerViewController,
                              willEndFullScreenPresentationWithAnimationCoordinator coordinator: UIViewControllerTransitionCoordinator) {
        coordinator.animate(alongsideTransition: nil) { [weak self] context in
            guard let self = self, !context.isCancelled else { return }
            self.player?.pause()
            self.playingRoom = nil
        }
    }

    private func receiveRoom(_ task: URLSessionWebSocketTask) {
        task.receive { [weak self, weak task] result in
            DispatchQueue.main.async {
                guard let self = self, let task = task, self.socket === task else { return }
                switch result {
                case .success(let message):
                    let bytes: Data
                    switch message {
                    case .string(let text): bytes = Data(text.utf8)
                    case .data(let data): bytes = data
                    @unknown default: return
                    }
                    if let value = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any] {
                        if value["type"] as? String == "state", let state = value["state"] as? [String: Any] {
                            self.roomState = state
                            if let timestamp = value["server_ts"] as? Double { self.serverOffset = timestamp - Date().timeIntervalSince1970 }
                            self.syncRoom()
                        }
                        self.webView.callAsyncJavaScript(
                            "window.dispatchEvent(new CustomEvent('diastomy-room', {detail: message}))",
                            arguments: ["message": value], in: nil, in: .page, completionHandler: nil)
                    }
                    self.receiveRoom(task)
                case .failure:
                    self.webView.callAsyncJavaScript(
                        "window.dispatchEvent(new CustomEvent('diastomy-room', {detail: {type:'error', message:'اتصال اتاق قطع شد؛ دوباره وارد اتاق شوید.'}}))",
                        arguments: [:], in: nil, in: .page, completionHandler: nil)
                }
            }
        }
    }

    private func syncRoom() {
        guard playingRoom != nil, playingRoom == roomCode, playerController?.presentingViewController != nil, let state = roomState, let player = player else { return }
        if state["closed"] as? Bool == true { player.pause(); return }
        let paused = state["paused_position"] as? Double
        let start = state["starts_at"] as? Double ?? Date().timeIntervalSince1970
        let position = paused ?? Date().timeIntervalSince1970 + serverOffset - start
        if position < 0 { player.pause(); return }
        let current = player.currentTime().seconds
        if !current.isFinite || abs(current - position) > 2 { player.seek(to: CMTime(seconds: position, preferredTimescale: 600)) }
        if paused != nil { player.pause() } else { player.play() }
    }

}
