import UIKit
import WebKit
import AVKit
import MediaPlayer
import CoreMedia
import CryptoKit
import ImageIO

// All documents, scripts, fonts and styles are shipped in Web/.
// Only JSON APIs and explicitly authorized media use the network.
final class BrowserViewController: UIViewController, WKNavigationDelegate, WKScriptMessageHandler, WKScriptMessageHandlerWithReply, URLSessionTaskDelegate, AVPlayerViewControllerDelegate {
    var initialTabRoute = "home"
    var isSecondaryTab = false
    private var waitingForTabRoute = true
    var isLoadingSecondaryTab: Bool { isSecondaryTab && waitingForTabRoute }
    private(set) var showsNativeTabBar = false
    private var resetOnAppearance = false
    private var pendingGenreSearch = false

    func openGenreSearch() {
        pendingGenreSearch = true
        loadViewIfNeeded()
        showGenreSearchIfReady()
    }

    private func showGenreSearchIfReady() {
        guard pendingGenreSearch, !resetOnAppearance, startupNavigation == nil, isLocal(webView.url) else { return }
        pendingGenreSearch = false
        webView.evaluateJavaScript("location.hash = '#/search?genres=all'")
    }

    func resetTabOnAppearance() {
        resetOnAppearance = isViewLoaded
        showsNativeTabBar = false
    }

    func scrollTabToTop() {
        guard let scrollView = webView?.scrollView else { return }
        scrollView.setContentOffset(CGPoint(x: scrollView.contentOffset.x, y: -scrollView.adjustedContentInset.top),
                                    animated: !UIAccessibility.isReduceMotionEnabled)
    }

    override func viewWillAppear(_ animated: Bool) {
        super.viewWillAppear(animated)
        if resetOnAppearance {
            resetOnAppearance = false
            loadBundledInterface()
        }
        (tabBarController as? DiastomyTabController)?.updateTabBar()
    }

    private var webView: WKWebView!
    private var titleBackButton: UIButton?
    private var titleBookmarkButton: UIButton?
    private let server = URL(string: "https://diastomy.top")!
    private var webRoot: URL!
    private var startupPanel: UIView?
    private var startupTimer: Timer?
    private var startupNavigation: WKNavigation?
    private var startupDocumentCommitted = false
    private var inlineRoom: String?
    private var inlineLayer: AVPlayerLayer?
    private var inlineRoomItemStatus: NSKeyValueObservation?
    private var inlineGeneration = 0
    private var inlineRotated = false
    private var inlineRate: Float = 1
    private var lastInlineCaption: AVMediaSelectionOption?
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
    private var browserSignInVerifier: String?
    private var redeemingBrowserSignIn = false
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
        configuration.setURLSchemeHandler(BundledInterfaceHandler(), forURLScheme: "diastomy")
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.allowsAirPlayForMediaPlayback = true
        configuration.allowsPictureInPictureMediaPlayback = true
        configuration.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "native")
        configuration.userContentController.add(self, name: "startupStatus")
        configuration.userContentController.addUserScript(WKUserScript(source: """
            document.addEventListener('DOMContentLoaded', () => {
                const nav = document.querySelector('nav');
                const hasStyle = nav && getComputedStyle(nav).position === 'fixed';
                const hasContent = document.querySelector('#app')?.firstElementChild;
                window.webkit.messageHandlers.startupStatus.postMessage(
                    !hasStyle ? 'css' : !hasContent ? 'js' : 'ready'
                );
            }, { once: true });
            """, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        configuration.userContentController.addUserScript(WKUserScript(source: """
            document.documentElement.classList.add('diastomy-native-tabs');
            """, injectionTime: .atDocumentEnd, forMainFrameOnly: true))
        if isSecondaryTab {
            configuration.userContentController.addUserScript(WKUserScript(source: "window.diastomySecondaryTab = true;",
                injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        configuration.applicationNameForUserAgent = "DiastomyIOS/2.0"
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.alwaysBounceHorizontal = false
        webView.scrollView.showsHorizontalScrollIndicator = false
        webView.scrollView.isDirectionalLockEnabled = true
        webView.scrollView.pinchGestureRecognizer?.isEnabled = false
        if #available(iOS 26.0, *) { setContentScrollView(webView.scrollView, for: .bottom) }
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

    private var playerViewportActive = false
    private var playerVolumeView: MPVolumeView?
    private var savedBackGesture = false

    private func updatePlayerViewport(_ data: [String: Any]) -> Bool {
        let active = data["active"] as? Bool == true
        if active != playerViewportActive {
            playerViewportActive = active
            if active {
                savedBackGesture = webView.allowsBackForwardNavigationGestures
                webView.allowsBackForwardNavigationGestures = false
            } else {
                webView.allowsBackForwardNavigationGestures = savedBackGesture
            }
        }
        let scrolling = webView.scrollView
        scrolling.isScrollEnabled = !active
        scrolling.bounces = !active && data["detail"] as? Bool != true
        guard active, let x = data["x"] as? Double, let y = data["y"] as? Double,
              let length = data["length"] as? Double, [x, y, length].allSatisfy(\.isFinite),
              (20...300).contains(length), webView.bounds.contains(CGPoint(x: x, y: y)) else {
            if let slider = playerVolumeView { setPlayerVolumeVisible(active: false, slider: slider, animated: active) }
            return false
        }
        let slider: MPVolumeView
        if let existing = playerVolumeView {
            slider = existing
        } else {
            slider = MPVolumeView(frame: .zero)
            slider.showsRouteButton = false
            slider.tintColor = .systemRed
            let thumbSize = CGSize(width: 24, height: 16)
            let thumb = UIGraphicsImageRenderer(size: thumbSize).image { context in
                UIColor.white.setFill()
                let rect = CGRect(origin: .zero, size: thumbSize)
                context.cgContext.addPath(UIBezierPath(roundedRect: rect, cornerRadius: 8).cgPath)
                context.cgContext.fillPath()
            }.withRenderingMode(.alwaysOriginal)
            slider.setVolumeThumbImage(thumb, for: .normal)
            slider.setVolumeThumbImage(thumb, for: .highlighted)
            slider.accessibilityLabel = "بلندی صدا"
            slider.alpha = 0
            slider.isHidden = true
            slider.isUserInteractionEnabled = false
            view.addSubview(slider)
            playerVolumeView = slider
        }
        slider.bounds = CGRect(x: 0, y: 0, width: length, height: 28)
        slider.center = webView.convert(CGPoint(x: x, y: y), to: view)
        slider.transform = CGAffineTransform(rotationAngle: data["horizontal"] as? Bool == true ? 0 : -.pi / 2)
        setPlayerVolumeVisible(active: true, slider: slider)
        return true
    }

    private func setPlayerVolumeVisible(active: Bool, slider: MPVolumeView, animated: Bool = true) {
        let opacity: CGFloat = active ? 1 : 0
        if !animated || UIAccessibility.isReduceMotionEnabled {
            slider.layer.removeAllAnimations()
            slider.alpha = opacity
            slider.isUserInteractionEnabled = active
            slider.isHidden = !active
            return
        }
        guard slider.isUserInteractionEnabled != active else { return }
        slider.isUserInteractionEnabled = active
        if active { slider.isHidden = false }
        UIView.animate(withDuration: 0.18, delay: 0, options: [.beginFromCurrentState, .curveEaseOut]) {
            slider.alpha = opacity
        } completion: { finished in
            if finished && !slider.isUserInteractionEnabled { slider.isHidden = true }
        }
    }

    private final class TitleButton: UIButton {
        override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
            let inset = max(0, (44 - bounds.width) / 2)
            return bounds.insetBy(dx: -inset, dy: -inset).contains(point)
        }
    }

    private func updateNativeTitleButtons(_ data: [String: Any]) -> Bool {
        webView.scrollView.bounces = !playerViewportActive && data["detail"] as? Bool != true
        guard #available(iOS 26.0, *) else { return false }
        let size: CGFloat = 36
        guard data["visible"] as? Bool == true,
              let y = data["y"] as? Double, let backX = data["backX"] as? Double,
              let bookmarkX = data["bookmarkX"] as? Double,
              [y, backX, bookmarkX].allSatisfy(\.isFinite),
              y >= 0, y <= webView.bounds.height, backX >= 0,
              bookmarkX <= webView.bounds.width, bookmarkX - backX >= 36 else {
            titleBackButton?.isHidden = true
            titleBookmarkButton?.isHidden = true
            return data["visible"] as? Bool != true
        }
        let backCenter = webView.convert(CGPoint(x: backX, y: y), to: view)
        let bookmarkCenter = webView.convert(CGPoint(x: bookmarkX, y: y), to: view)
        let safeFrame = view.safeAreaLayoutGuide.layoutFrame
        let visible = backCenter.y >= safeFrame.minY + size / 2 - 1 &&
            backCenter.y <= safeFrame.maxY - size / 2

        if titleBackButton == nil {
            titleBackButton = makeTitleButton(id: "title-back", label: "بازگشت", symbol: "chevron.left",
                                             target: #selector(activateTitleBack))
            titleBookmarkButton = makeTitleButton(id: "title-bookmark", label: "ذخیره در لیست من", symbol: "heart",
                                                 target: #selector(activateTitleBookmark))
        }
        let saved = data["saved"] as? Bool == true
        if let bookmark = titleBookmarkButton, bookmark.isSelected != saved {
            bookmark.isSelected = saved
            let heart = UIImage(systemName: saved ? "heart.fill" : "heart")
            bookmark.configuration?.image = saved
                ? heart?.withTintColor(UIColor(red: 0.88, green: 0, blue: 0, alpha: 1), renderingMode: .alwaysOriginal)
                : heart
            bookmark.accessibilityLabel = saved ? "حذف از لیست من" : "ذخیره در لیست من"
        }
        titleBookmarkButton?.isEnabled = data["busy"] as? Bool != true
        for (button, center) in [(titleBackButton, backCenter), (titleBookmarkButton, bookmarkCenter)] {
            button?.bounds = CGRect(x: 0, y: 0, width: size, height: size)
            button?.center = CGPoint(x: min(max(center.x, safeFrame.minX + size / 2), safeFrame.maxX - size / 2), y: center.y)
            button?.isHidden = !visible
        }
        return true
    }

    @available(iOS 26.0, *)
    private func makeTitleButton(id: String, label: String, symbol: String, target: Selector) -> UIButton {
        var configuration = UIButton.Configuration.glass()
        configuration.cornerStyle = .capsule
        configuration.image = UIImage(systemName: symbol)
        configuration.preferredSymbolConfigurationForImage = UIImage.SymbolConfiguration(pointSize: 15, weight: .medium)
        configuration.baseForegroundColor = .white
        let button = TitleButton(type: .system)
        button.configuration = configuration
        button.tintColor = .white
        button.configurationUpdateHandler = { control in
            var appearance = control.configuration
            appearance?.baseForegroundColor = control.isHighlighted || control.isSelected ? .systemRed : .white
            control.configuration = appearance
        }
        button.accessibilityIdentifier = id
        button.accessibilityLabel = label
        button.addTarget(self, action: target, for: .touchUpInside)
        view.addSubview(button)
        return button
    }

    @objc private func activateTitleBack() {
        webView.evaluateJavaScript("document.querySelector('.dm-film-topbar a')?.click()")
    }

    @objc private func activateTitleBookmark() {
        webView.evaluateJavaScript("document.querySelector('.dm-film-topbar #bookmark')?.click()")
    }

    private func loadBundledInterface() {
        titleBackButton?.isHidden = true
        titleBookmarkButton?.isHidden = true
        startupTimer?.invalidate()
        startupNavigation = nil
        startupDocumentCommitted = false
        _ = updatePlayerViewport(["active": false])
        webView.stopLoading()
        waitingForTabRoute = true
        if !isSecondaryTab {
            showStartupPanel(message: "در حال آماده‌سازی دیاستومی…", canRetry: false)
        } else {
            startupPanel?.removeFromSuperview()
            startupPanel = nil
        }
        guard let index = Bundle.main.url(forResource: "index", withExtension: "html", subdirectory: "Web") else {
            startupFailed("فایل‌های رابط برنامه موجود نیستند؛ نسخهٔ کامل را دوباره نصب کنید.")
            return
        }
        webRoot = index.deletingLastPathComponent().standardizedFileURL
        for name in ["index.html", "app.js", "app.css", "pwa-ui.js", "pwa-shell.js", "pwa-source.css", "pwa-local.css", "resources.json", "assets/Yekan.woff2", "assets/logo.svg"] {
            guard FileManager.default.fileExists(atPath: webRoot.appendingPathComponent(name).path) else {
                startupFailed("فایل‌های رابط برنامه ناقص‌اند؛ نسخهٔ کامل را دوباره نصب کنید.")
                return
            }
        }
        startupTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: false) { [weak self] _ in
            guard let self = self else { return }
            let code = self.startupDocumentCommitted ? "UI-SIGNAL" : "UI-LOAD"
            self.startupFailed("رابط برنامه آماده نشد. کد: \(code)")
        }
        StartupDiagnostics.record(stage: "loadingLocalDocument", localDocument: isLocal(index))
        showsNativeTabBar = false
        (tabBarController as? DiastomyTabController)?.updateTabBar()
        let url = URL(string: "diastomy://app/index.html#/\(initialTabRoute)")!
        startupNavigation = webView.load(URLRequest(url: url))
    }

    private func isLocal(_ url: URL?) -> Bool {
        guard let url = url else { return false }
        return url.scheme == "diastomy" && url.host == "app" && url.path == "/index.html"
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
        guard startupNavigation != nil, isLocal(webView.url) else { return }
        startupDocumentCommitted = true
        StartupDiagnostics.record(stage: "documentCommitted", localDocument: isLocal(webView.url))
    }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard message.name == "startupStatus", startupNavigation != nil,
              message.frameInfo.isMainFrame, isLocal(webView.url),
              let status = message.body as? String else { return }
        switch status {
        case "ready":
            startupDidBecomeReady()
        case "css":
            startupFailed("چیدمان رابط بارگذاری نشد. کد: UI-CSS")
        case "js":
            startupFailed("رابط برنامه اجرا نشد. کد: UI-JS")
        default:
            break
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
        stopInlinePlayer()
        startupFailed("بخش رابط برنامه متوقف شد. روی تلاش دوباره بزنید.")
    }

    private func showStartupPanel(message: String, canRetry: Bool) {
        startupPanel?.removeFromSuperview()
        let panel = UIView()
        panel.backgroundColor = UIColor(red: 13 / 255.0, green: 17 / 255.0, blue: 25 / 255.0, alpha: 1)
        panel.translatesAutoresizingMaskIntoConstraints = false
        if !canRetry {
            let glow = UIColor(red: 39 / 255.0, green: 16 / 255.0, blue: 22 / 255.0, alpha: 1)
            for origin in [CGPoint(x: 0, y: 0), CGPoint(x: 1, y: 0.78)] {
                let gradient = CAGradientLayer()
                gradient.type = .radial
                gradient.colors = [glow.cgColor, glow.withAlphaComponent(0).cgColor]
                gradient.startPoint = origin
                gradient.endPoint = CGPoint(x: 0.5, y: origin.y + 0.40)
                panel.layer.addSublayer(gradient)
            }
            let logo = UIImageView(image: UIImage(named: "LaunchLogo"))
            logo.contentMode = .scaleAspectFit
            logo.translatesAutoresizingMaskIntoConstraints = false
            let caption = UILabel()
            caption.text = "loading..."
            caption.font = .systemFont(ofSize: 10)
            caption.textColor = .lightGray
            caption.textAlignment = .center
            let progress = UIProgressView(progressViewStyle: .default)
            progress.progressTintColor = .systemRed
            progress.trackTintColor = .white
            let footer = UIStackView(arrangedSubviews: [caption, progress])
            footer.axis = .vertical
            footer.spacing = 9
            footer.translatesAutoresizingMaskIntoConstraints = false
            panel.addSubview(logo)
            panel.addSubview(footer)
            view.addSubview(panel)
            NSLayoutConstraint.activate([
                panel.leadingAnchor.constraint(equalTo: view.leadingAnchor),
                panel.trailingAnchor.constraint(equalTo: view.trailingAnchor),
                panel.topAnchor.constraint(equalTo: view.topAnchor),
                panel.bottomAnchor.constraint(equalTo: view.bottomAnchor),
                logo.centerXAnchor.constraint(equalTo: panel.centerXAnchor),
                logo.centerYAnchor.constraint(equalTo: panel.centerYAnchor),
                logo.widthAnchor.constraint(equalTo: panel.widthAnchor, multiplier: 0.45),
                logo.heightAnchor.constraint(equalToConstant: 44),
                footer.centerXAnchor.constraint(equalTo: panel.centerXAnchor),
                footer.widthAnchor.constraint(equalTo: panel.widthAnchor, multiplier: 0.76),
                footer.bottomAnchor.constraint(equalTo: panel.safeAreaLayoutGuide.bottomAnchor, constant: -2)
            ])
            progress.setProgress(0.40, animated: true)
            startupPanel = panel
            return
        }
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
        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "—"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "—"
        let versionLabel = UILabel()
        versionLabel.text = "نسخهٔ \(version) · بیلد \(build)"
        versionLabel.textColor = .lightGray
        versionLabel.font = .monospacedDigitSystemFont(ofSize: 13, weight: .regular)
        versionLabel.textAlignment = .center
        let stack = UIStackView(arrangedSubviews: [label, retry, versionLabel])
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
        waitingForTabRoute = false
        (tabBarController as? DiastomyTabController)?.updateTabBar()
        startupNavigation = nil
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
        // URL.path can drop the terminal slash on device. Match the path sent to Django.
        guard let p = URLComponents(url: url, resolvingAgainstBaseURL: true)?.percentEncodedPath else { return nil }
        let exact: Set<String> = [
            "/movie/api/filter/", "/movie/api/actors/", "/accounts/api/login-password/",
            "/accounts/api/check-phone/", "/accounts/api/send-otp/", "/accounts/api/verify-otp/",
            "/accounts/api/complete-registration/", "/accounts/api/logout/",
            "/accounts/api/forgot-password-request/", "/accounts/api/forgot-password-verify/",
            "/accounts/api/forgot-password-reset/", "/accounts/api/notifications/",
            "/accounts/api/notifications/mark-read/", "/accounts/api/change-password/",
            "/accounts/api/update-profile/", "/accounts/api/update-player-quality/",
            "/accounts/api/set-language/", "/accounts/api/plans/", "/accounts/api/payments/",
            "/accounts/api/create-payment/", "/accounts/api/check-discount/",
            "/api/suggest-content/", "/api/bookmark/toggle/", "/api/content-preferences/", "/api/watch-progress/", "/api/watch-time/",
            "/accounts/support/api/messages/", "/accounts/support/api/send/"
        ]
        if exact.contains(p) || p.hasPrefix("/api/app/v1/") || p.hasPrefix("/movie/api/actor/") || p.hasPrefix("/movie/api/watch-state/") ||
            p.range(of: #"^/accounts/notifications/[1-9][0-9]*/dismiss/$"#, options: .regularExpression) != nil ||
            p.range(of: #"^/movie/(movie-comment|comment)/[1-9][0-9]*/(like|dislike)/$"#, options: .regularExpression) != nil ||
            p.range(of: #"^/accounts/api/devices/[1-9][0-9]*/terminate/$"#, options: .regularExpression) != nil ||
            p.range(of: #"^/api/watch-history/[1-9][0-9]*/remove/$"#, options: .regularExpression) != nil ||
            p.range(of: #"^/movie-room/r/[A-Za-z0-9_-]+/delete/$"#, options: .regularExpression) != nil {
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
            if url.path == "/api/suggest-content" || url.path == "/api/suggest-content/" {
                let values = body as? [String: String] ?? [:]
                var form = URLComponents()
                form.queryItems = ["title", "source_query"].map { URLQueryItem(name: $0, value: values[$0] ?? "") }
                request.setValue("application/x-www-form-urlencoded", forHTTPHeaderField: "Content-Type")
                request.httpBody = form.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B").data(using: .utf8)
            } else {
                request.httpBody = try? JSONSerialization.data(withJSONObject: body ?? [:])
            }
        }
        api.dataTask(with: request) { data, response, error in
            if let error {
                let code = (error as? URLError)?.code
                let offline = code == .notConnectedToInternet || code == .networkConnectionLost ||
                    code == .dataNotAllowed || code == .internationalRoamingOff
                completion(["status": offline ? 0 : 503,
                            "data": ["error": offline ? "مشکل در اتصال اینترنت" : "خطای سرور"]])
                return
            }
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            guard let data = data, let json = try? JSONSerialization.jsonObject(with: data) else {
                completion(["status": status == 200 ? 502 : status,
                            "data": ["error": "پاسخ API معتبر نیست؛ اتصال یا ورود را بررسی کنید."]]); return
            }
            completion(["status": status, "data": json])
        }.resume()
    }

    private func uploadAttachment(path: String, field: String, name: String, encoded: String,
                                  message: String? = nil, limit: Int,
                                  reply: @escaping (Any?, String?) -> Void) {
        guard encoded.utf8.count <= ((limit + 2) / 3) * 4,
              let file = Data(base64Encoded: encoded), !file.isEmpty, file.count <= limit,
              let url = allowed(path) else {
            reply(["status": 400], nil)
            return
        }
        let filename = String(name.prefix(128)).replacingOccurrences(of: #"[^a-zA-Z0-9_.-]"#, with: "_", options: .regularExpression)
        let boundary = UUID().uuidString
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(server.absoluteString, forHTTPHeaderField: "Referer")
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")
        if let token = HTTPCookieStorage.shared.cookies(for: server)?.first(where: { $0.name == "csrftoken" }) {
            request.setValue(token.value, forHTTPHeaderField: "X-CSRFToken")
        }
        var body = Data()
        if let message {
            body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"content\"\r\n\r\n\(message)\r\n".utf8))
        }
        body.append(Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"\(field)\"; filename=\"\(filename)\"\r\nContent-Type: application/octet-stream\r\n\r\n".utf8))
        body.append(file)
        body.append(Data("\r\n--\(boundary)--\r\n".utf8))
        request.httpBody = body
        api.dataTask(with: request) { data, response, _ in
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            let result = data.flatMap { try? JSONSerialization.jsonObject(with: $0) } as? [String: Any] ?? [:]
            reply(["status": status, "data": result], nil)
        }.resume()
    }

    private func loadSupportImage(_ id: Int, reply: @escaping (Any?, String?) -> Void) {
        guard id > 0, let url = URL(string: "/accounts/support/attachment/\(id)/", relativeTo: server)?.absoluteURL else {
            reply([:], nil)
            return
        }
        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.setValue("image/*", forHTTPHeaderField: "Accept")
        api.downloadTask(with: request) { location, response, _ in
            guard let response = response as? HTTPURLResponse, response.statusCode == 200,
                  let location, let size = try? location.resourceValues(forKeys: [.fileSizeKey]).fileSize,
                  size <= 20 * 1024 * 1024, let data = try? Data(contentsOf: location) else {
                reply([:], nil)
                return
            }
            let webFormats = ["public.jpeg": "image/jpeg", "public.png": "image/png",
                              "com.compuserve.gif": "image/gif", "org.webmproject.webp": "image/webp"]
            guard let source = CGImageSourceCreateWithData(data as CFData, nil) else {
                reply([:], nil)
                return
            }
            if let type = CGImageSourceGetType(source), let mime = webFormats[type as String],
               data.count <= 5 * 1024 * 1024 {
                reply(["image": "data:\(mime);base64," + data.base64EncodedString()], nil)
                return
            }
            let options: [CFString: Any] = [kCGImageSourceCreateThumbnailFromImageAlways: true,
                                           kCGImageSourceCreateThumbnailWithTransform: true,
                                           kCGImageSourceThumbnailMaxPixelSize: 1800]
            guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary),
                  let jpeg = UIImage(cgImage: image).jpegData(compressionQuality: 0.88) else {
                reply([:], nil)
                return
            }
            reply(["image": "data:image/jpeg;base64," + jpeg.base64EncodedString()], nil)
        }.resume()
    }

    private func loadHistoryFrame(_ path: String, reply: @escaping (Any?, String?) -> Void) {
        guard path.range(of: #"^/api/watch-frame/[1-9][0-9]*/(?:\?v=[0-9]+)?$"#, options: .regularExpression) != nil,
              let url = URL(string: path, relativeTo: server)?.absoluteURL else {
            reply(nil, "Invalid history frame")
            return
        }
        var request = URLRequest(url: url)
        request.setValue("image/jpeg", forHTTPHeaderField: "Accept")
        api.dataTask(with: request) { data, response, _ in
            guard let response = response as? HTTPURLResponse, response.statusCode == 200,
                  response.mimeType == "image/jpeg", let data, data.count <= 512 * 1024 else {
                reply([:], nil)
                return
            }
            reply(["image": "data:image/jpeg;base64," + data.base64EncodedString()], nil)
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
        if action == "nativeTabVisibility", let visible = data["visible"] as? Bool {
            waitingForTabRoute = data["starting"] as? Bool == true
            showsNativeTabBar = visible
            (tabBarController as? DiastomyTabController)?.updateTabBar()
            replyHandler(["ok": true], nil)
        } else if action == "openGenreSearch" {
            replyHandler(["ok": (tabBarController as? DiastomyTabController)?.selectGenreSearch() == true], nil)
        } else if action == "playerViewport" {
            replyHandler(["ok": updatePlayerViewport(data)], nil)
        } else if action == "nativeTitleButtons" {
            replyHandler(["ok": updateNativeTitleButtons(data)], nil)
        } else if action == "nativeTabSessionEnded" {
            (tabBarController as? DiastomyTabController)?.clearOtherTabs(except: self)
            replyHandler(["ok": true], nil)
        } else if action == "request", let path = data["path"] as? String {
            send(path, method: data["method"] as? String ?? "GET", body: data["body"]) { replyHandler($0, nil) }
        } else if action == "selectDefaultAvatar", let index = data["index"] as? Int, (1...12).contains(index),
                  let url = Bundle.main.url(forResource: String(format: "avatar-%02d", index), withExtension: "png",
                                            subdirectory: "Web/static/public/assets/avatars/default"),
                  let image = try? Data(contentsOf: url) {
            uploadAttachment(path: "/accounts/api/update-profile/", field: "avatar", name: "avatar.png",
                             encoded: image.base64EncodedString(), limit: 3 * 1024 * 1024, reply: replyHandler)
        } else if action == "updateAvatar", let content = data["content"] as? String {
            uploadAttachment(path: "/accounts/api/update-profile/", field: "avatar", name: "avatar",
                             encoded: content, limit: 3 * 1024 * 1024, reply: replyHandler)
        } else if action == "sendSupportImage", let encoded = data["content64"] as? String,
                  let content = data["content"] as? String, content.count <= 4000, let name = data["name"] as? String {
            uploadAttachment(path: "/accounts/support/api/send/", field: "file", name: name,
                             encoded: encoded, message: content, limit: 5 * 1024 * 1024, reply: replyHandler)
        } else if action == "supportImage", let id = data["id"] as? Int {
            loadSupportImage(id, reply: replyHandler)
        } else if action == "historyFrame", let path = data["path"] as? String {
            loadHistoryFrame(path, reply: replyHandler)
        } else if action == "inlineControl", let command = data["command"] as? String {
            replyHandler(controlInlinePlayer(command, data: data), nil)
        } else if action == "play", let kind = data["kind"] as? String,
                  ["movie", "series"].contains(kind), let id = data["id"] as? Int, id > 0 {
            let code = data["room"] as? String
            guard code == nil || code == roomCode else {
                replyHandler(["status": 400, "data": ["error": "ابتدا وارد اتاق شوید."]], nil)
                return
            }
            let room = code.map { "?room=" + $0 } ?? ""
            let surface = data["surface"] as? Bool == true
            if surface { inlineGeneration += 1 }
            let generation = inlineGeneration
            send("/api/app/v1/playback/\(kind)/\(id)/" + room) { result in
                guard result["status"] as? Int == 200, let info = result["data"] as? [String: Any],
                      let value = info["url"] as? String, let url = URL(string: value),
                      url.scheme == "https", url.host == self.server.host,
                      url.path.hasPrefix("/movie/\(kind)-direct-hls/") else { replyHandler(result, nil); return }
                if surface {
                    guard generation == self.inlineGeneration else {
                        replyHandler(["status": 409], nil)
                        return
                    }
                    self.startInlinePlayer(url, position: data["position"] as? Double ?? 0, room: code)
                    replyHandler(["status": 200, "data": ["surface": true]], nil)
                    return
                }
                if data["presentRoom"] as? Bool == true, let code, code == self.roomCode,
                   self.presentedViewController == nil {
                    self.playingRoom = code
                    var roomInfo = info
                    roomInfo.removeValue(forKey: "target")
                    roomInfo["position"] = 0
                    self.presentPlayer(url, info: roomInfo)
                    replyHandler(["status": 200, "data": ["presented": true]], nil)
                    return
                }
                if data["inline"] as? Bool == true {
                    let store = self.webView.configuration.websiteDataStore.httpCookieStore
                    let group = DispatchGroup()
                    for cookie in HTTPCookieStorage.shared.cookies(for: url) ?? [] {
                        group.enter()
                        store.setCookie(cookie) { group.leave() }
                    }
                    group.notify(queue: .main) { replyHandler(result, nil) }
                    return
                }
                replyHandler(["status": 400, "data": ["error": "پخش آنلاین از پلیر داخلی باز می‌شود."]], nil)
            }
        } else if action == "listDownloads" {
            do {
                let names = try FileManager.default.contentsOfDirectory(atPath: documents.path)
                let files = names.sorted().compactMap { name -> [String: String]? in
                    guard localDownload(named: name) != nil,
                          let separator = name.lastIndex(of: "-"),
                          let idSeparator = name[..<separator].lastIndex(of: "-") else { return nil }
                    return ["name": name, "title": name[..<idSeparator].replacingOccurrences(of: "-", with: " ")]
                }
                replyHandler(["ok": true, "files": files], nil)
            } catch {
                replyHandler(["ok": false, "error": "خواندن دانلودها ممکن نشد."], nil)
            }
        } else if ["playDownload", "deleteDownload"].contains(action), let name = data["name"] as? String {
            guard let file = localDownload(named: name) else {
                replyHandler(["ok": false, "error": "فایل دانلودشده پیدا نشد."], nil)
                return
            }
            if action == "playDownload" {
                playingRoom = nil
                presentPlayer(file, info: [:])
                replyHandler(["ok": true], nil)
            } else {
                do {
                    try FileManager.default.removeItem(at: file)
                    replyHandler(["ok": true], nil)
                } catch {
                    replyHandler(["ok": false, "error": "حذف فایل ممکن نشد."], nil)
                }
            }
        } else if action == "downloadProgress", let token = data["token"] as? String,
                  let task = activeDownloads[token] {
            replyHandler(["received": task.countOfBytesReceived, "expected": task.countOfBytesExpectedToReceive], nil)
        } else if ["downloadMovie", "downloadSeries"].contains(action), let slug = data["slug"] as? String,
                  let id = data["id"] as? Int, id > 0,
                  let token = data["token"] as? String, UUID(uuidString: token) != nil,
                  slug.range(of: #"^[A-Za-z0-9_-]+$"#, options: .regularExpression) != nil {
            downloadVideo(kind: action == "downloadSeries" ? "series" : "movie", slug: slug, id: id, dubbed: action == "downloadMovie" && data["dubbed"] as? Bool == true, token: token) { replyHandler($0, nil) }
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
        } else if action == "browserSignIn" {
            guard !redeemingBrowserSignIn else { replyHandler(["ok": false], nil); return }
            let verifier = (UUID().uuidString + UUID().uuidString).replacingOccurrences(of: "-", with: "").lowercased()
            let challenge = SHA256.hash(data: Data(verifier.utf8)).map { String(format: "%02x", $0) }.joined()
            browserSignInVerifier = verifier
            let url = URL(string: "/api/app/v1/browser-sign-in/?challenge=\(challenge)", relativeTo: server)!.absoluteURL
            UIApplication.shared.open(url) { opened in
                if !opened, self.browserSignInVerifier == verifier { self.browserSignInVerifier = nil }
                replyHandler(["ok": opened], nil)
            }
        } else if action == "openSocial", let site = data["site"] as? String,
                  let address = ["instagram": "https://instagram.com/diastomyplus",
                                 "telegram": "https://t.me/diastomyplus"][site],
                  let url = URL(string: address) {
            UIApplication.shared.open(url) { opened in
                replyHandler(opened ? ["ok": true] : ["ok": false, "error": "باز کردن پیوند ممکن نشد."], nil)
            }
        } else if action == "shareRoom", let code = data["code"] as? String,
                  code.range(of: #"^[A-Za-z0-9_-]+$"#, options: .regularExpression) != nil,
                  let url = URL(string: "/movie-room/r/\(code)/", relativeTo: server)?.absoluteURL {
            let activity = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            activity.popoverPresentationController?.sourceView = view
            activity.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
            present(activity, animated: true)
            replyHandler(["ok": true], nil)
        } else if action == "roomOpen", let code = data["code"] as? String,
                  code.range(of: "^[A-Za-z0-9_-]{1,16}$", options: .regularExpression) != nil {
            socket?.cancel(with: .goingAway, reason: nil)
            roomCode = code
            roomState = data["state"] as? [String: Any]
            serverOffset = (data["serverTimestamp"] as? Double).map { $0 - Date().timeIntervalSince1970 } ?? 0
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
            if inlineRoom != nil { stopInlinePlayer() }
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
        startupNavigation = nil
        startupTimer?.invalidate()
        startupPanel?.removeFromSuperview()
        startupPanel = nil
        writeStartupReport(ready: true)
        showGenreSearchIfReady()
    }

    func completeBrowserSignIn(_ url: URL) {
        guard !redeemingBrowserSignIn, let verifier = browserSignInVerifier,
              let components = URLComponents(url: url, resolvingAgainstBaseURL: false),
              components.scheme == "top.diastomy.ios.auth", components.host == "login",
              components.path.isEmpty, components.fragment == nil,
              let items = components.queryItems, items.count == 1,
              items[0].name == "code", let code = items[0].value,
              code.range(of: #"^[a-f0-9]{40}$"#, options: .regularExpression) != nil else { return }
        redeemingBrowserSignIn = true
        send("/api/app/v1/session/") { [weak self] session in
            guard let self = self, self.browserSignInVerifier == verifier else { return }
            let finished: (Bool) -> Void = { ok in
                guard self.browserSignInVerifier == verifier else { return }
                self.browserSignInVerifier = nil
                self.redeemingBrowserSignIn = false
                self.webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('diastomy-browser-sign-in', {detail: \(ok)}))")
            }
            guard session["status"] as? Int == 200 else { finished(false); return }
            self.send("/api/app/v1/browser-sign-in/redeem/", method: "POST", body: ["code": code, "verifier": verifier]) { result in
                finished(result["status"] as? Int == 200)
            }
        }
    }

    private func localDownload(named name: String) -> URL? {
        guard name.range(of: #"^[A-Za-z0-9_-]+-[0-9]+-[A-Fa-f0-9]{8}\.(mp4|mkv|mov|webm|m4v)$"#,
                         options: .regularExpression) != nil else { return nil }
        let url = documents.appendingPathComponent(name, isDirectory: false)
        guard let properties = try? url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey]),
              properties.isRegularFile == true, properties.isSymbolicLink == false else { return nil }
        return url
    }

    private var activeDownloads: [String: URLSessionDownloadTask] = [:]
    private lazy var downloadsSession: URLSession = {
        let config = URLSessionConfiguration.default
        config.httpCookieStorage = .shared
        config.httpShouldSetCookies = true
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        config.timeoutIntervalForRequest = 45
        config.timeoutIntervalForResource = 10_800
        return URLSession(configuration: config)
    }()

    private func downloadVideo(kind: String, slug: String, id: Int, dubbed: Bool, token: String, completion: @escaping ([String: Any]) -> Void) {
        let variant = dubbed ? "dubbed/" : ""
        let url = URL(string: "/movie/\(kind)/\(slug)/download/\(id)/\(variant)", relativeTo: server)!.absoluteURL
        // The existing Django download route checks the session before redirecting.
        guard activeDownloads[token] == nil else {
            completion(["ok": false, "error": "این فایل در حال دانلود است."])
            return
        }
        let task = downloadsSession.downloadTask(with: url) { [weak self, documents] file, response, error in
            let result: [String: Any]
            if let file = file, let http = response as? HTTPURLResponse,
               http.statusCode == 200, http.url?.scheme == "https",
               let mime = http.mimeType,
               mime.hasPrefix("video/") || ["application/octet-stream", "application/x-matroska", "application/matroska"].contains(mime),
               let size = try? file.resourceValues(forKeys: [.fileSizeKey]).fileSize, size > 0 {
                let suggestedExtension = ((http.suggestedFilename ?? "") as NSString).pathExtension.lowercased()
                let suffix = ["mp4", "mkv", "mov", "webm", "m4v"].contains(suggestedExtension) ? suggestedExtension : "mp4"
                let name = "\(slug)-\(id)-\(UUID().uuidString.prefix(8)).\(suffix)"
                do {
                    try FileManager.default.moveItem(at: file, to: documents.appendingPathComponent(name))
                    result = ["ok": true]
                } catch {
                    result = ["ok": false, "error": "ذخیرهٔ فایل ناموفق بود."]
                }
            } else {
                let code = (response as? HTTPURLResponse)?.statusCode
                let message: String
                if code == 401 || code == 403 || code == 302 {
                    message = "برای دانلود، وضعیت ورود و اشتراک را بررسی کنید."
                } else if (error as? URLError)?.code == .timedOut {
                    message = "پاسخ منبع دانلود طول کشید. دوباره تلاش کنید."
                } else {
                    message = "دریافت فایل ناموفق بود. دوباره تلاش کنید."
                }
                result = ["ok": false, "error": message]
            }
            DispatchQueue.main.async {
                self?.activeDownloads.removeValue(forKey: token)
                completion(result)
            }
        }
        activeDownloads[token] = task
        task.resume()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        if let panel = startupPanel {
            panel.layer.sublayers?.compactMap { $0 as? CAGradientLayer }.forEach { $0.frame = panel.bounds }
        }
        layoutInlinePlayer()
    }

    private func layoutInlinePlayer(animated: Bool = false) {
        guard let layer = inlineLayer else { return }
        let current = layer.presentation() ?? layer
        let previousBounds = current.bounds
        let previousTransform = current.affineTransform()
        let bounds = view.bounds
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        layer.bounds = CGRect(origin: .zero, size: inlineRotated
            ? CGSize(width: bounds.height, height: bounds.width) : bounds.size)
        layer.position = CGPoint(x: bounds.midX, y: bounds.midY)
        let angle: CGFloat = inlineRotated ? .pi / 2 : 0
        layer.setAffineTransform(CGAffineTransform(rotationAngle: angle))
        CATransaction.commit()
        guard animated, !UIAccessibility.isReduceMotionEnabled else { return }

        let resize = CABasicAnimation(keyPath: "bounds")
        resize.fromValue = NSValue(cgRect: previousBounds)
        resize.toValue = NSValue(cgRect: layer.bounds)
        let rotation = CABasicAnimation(keyPath: "transform.rotation.z")
        rotation.fromValue = atan2(previousTransform.b, previousTransform.a)
        rotation.toValue = angle
        for animation in [resize, rotation] { animation.duration = 0.32 }

        let transition = CAAnimationGroup()
        transition.animations = [resize, rotation]
        transition.duration = 0.32
        transition.timingFunction = CAMediaTimingFunction(name: .easeInEaseOut)
        layer.add(transition, forKey: "playerRotation")
    }

    private func stopInlinePlayer() {
        inlineGeneration += 1
        inlineRoomItemStatus?.invalidate()
        inlineRoomItemStatus = nil
        inlineLayer?.player?.pause()
        inlineLayer?.removeFromSuperlayer()
        inlineLayer = nil
        inlineRoom = nil
        view.backgroundColor = .black
        inlineRotated = false
        inlineRate = 1
        lastInlineCaption = nil
        webView.underPageBackgroundColor = .black
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
    }

    private func startInlinePlayer(_ url: URL, position: Double, room: String?) {
        stopInlinePlayer()
        let cookies = HTTPCookieStorage.shared.cookies(for: url) ?? []
        let asset = AVURLAsset(url: url, options: [AVURLAssetHTTPCookiesKey: cookies])
        let item = AVPlayerItem(asset: asset)
        let playback = AVPlayer(playerItem: item)
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
        try? AVAudioSession.sharedInstance().setActive(true)
        let layer = AVPlayerLayer(player: playback)
        layer.videoGravity = .resizeAspect
        view.layer.insertSublayer(layer, below: webView.layer)
        inlineLayer = layer
        inlineRoom = room
        view.backgroundColor = .black
        layoutInlinePlayer()
        webView.underPageBackgroundColor = .clear
        webView.backgroundColor = .clear
        webView.scrollView.backgroundColor = .clear
        if room != nil {
            inlineRoomItemStatus = item.observe(\.status, options: [.initial, .new]) { [weak self, weak layer] item, _ in
                guard item.status == .readyToPlay else { return }
                DispatchQueue.main.async {
                    guard let self, let layer, self.inlineLayer === layer else { return }
                    self.syncRoom(loadFirstFrame: true)
                }
            }
        } else if position.isFinite, position > 0 {
            let time = CMTime(seconds: position, preferredTimescale: 600)
            playback.seek(to: time, toleranceBefore: .zero, toleranceAfter: .zero) { [weak self, weak layer] _ in
                guard let self, let layer, self.inlineLayer === layer else { return }
                layer.player?.play()
            }
        } else {
            playback.play()
        }
    }

    private func controlInlinePlayer(_ command: String, data: [String: Any]) -> [String: Any] {
        if command == "stop" {
            stopInlinePlayer()
            return ["ok": true]
        }
        guard let playback = inlineLayer?.player else { return ["ok": false] }
        let item = playback.currentItem
        let captionGroup = item?.status == .readyToPlay
            ? item?.asset.mediaSelectionGroup(forMediaCharacteristic: .legible) : nil
        // The HLS master labels the intro-only branding track "Diastomy".
        let captions = captionGroup?.options.filter {
            $0.displayName.trimmingCharacters(in: .whitespacesAndNewlines).caseInsensitiveCompare("Diastomy") != .orderedSame
        } ?? []
        let audioGroup = item?.status == .readyToPlay
            ? item?.asset.mediaSelectionGroup(forMediaCharacteristic: .audible) : nil
        switch command {
        case "toggle":
            if playback.timeControlStatus == .paused { playback.playImmediately(atRate: inlineRate) } else { playback.pause() }
        case "mute": playback.isMuted.toggle()
        case "volume":
            if let volume = data["value"] as? Double, (0...1).contains(volume) {
                playback.volume = Float(volume)
            }
        case "seek":
            if let seconds = data["value"] as? Double, seconds.isFinite, seconds >= 0 {
                playback.seek(to: CMTime(seconds: seconds, preferredTimescale: 600))
            }
        case "rate":
            if let rate = data["value"] as? Double, (0.5...2).contains(rate) {
                inlineRate = Float(rate)
                if playback.rate != 0 { playback.rate = Float(rate) }
            }
        case "rotate", "rotateAnimated":
            inlineRotated = data["value"] as? Bool == true
            layoutInlinePlayer(animated: command == "rotateAnimated")
        case "fill":
            inlineLayer?.videoGravity = data["value"] as? Bool == true ? .resizeAspectFill : .resizeAspect
        case "captionStyle":
            let style = data["value"] as? [String: Any] ?? [:]
            let sizes: [String: Int] = ["small": 80, "normal": 100, "large": 130]
            let colors: [String: [Double]] = [
                "white": [1, 1, 1, 1], "yellow": [1, 1, 0.88, 0.26], "cyan": [1, 0.48, 0.93, 1]
            ]
            let attributes: [String: Any] = [
                kCMTextMarkupAttribute_RelativeFontSize as String: sizes[style["size"] as? String ?? ""] ?? 100,
                kCMTextMarkupAttribute_ForegroundColorARGB as String: colors[style["color"] as? String ?? ""] ?? [1, 1, 1, 1],
                kCMTextMarkupAttribute_BackgroundColorARGB as String: [(style["background"] as? Bool == false ? 0.0 : 0.78), 0.0, 0.0, 0.0],
                kCMTextMarkupAttribute_CharacterBackgroundColorARGB as String: [0.0, 0.0, 0.0, 0.0]
            ]
            if let rule = AVTextStyleRule(textMarkupAttributes: attributes) { item?.textStyleRules = [rule] }
        case "audio":
            if let audioGroup, let index = data["value"] as? Int, audioGroup.options.indices.contains(index) {
                item?.select(audioGroup.options[index], in: audioGroup)
            }
        case "captions", "enableCaptions":
            guard let item, let captionGroup, !captions.isEmpty else {
                return ["ok": false, "captionsUnavailable": true, "captionsLoading": item?.status == .unknown]
            }
            let selected = item.currentMediaSelection.selectedMediaOption(in: captionGroup)
            let current = selected.flatMap { captions.firstIndex(of: $0) }
            let index: Int
            if command == "enableCaptions" {
                index = current ?? lastInlineCaption.flatMap { captions.firstIndex(of: $0) } ?? 0
            } else {
                index = data["value"] as? Int ?? -1
            }
            playback.appliesMediaSelectionCriteriaAutomatically = false
            if index == -1 {
                if let current { lastInlineCaption = captions[current] }
                item.select(nil, in: captionGroup)
            } else if captions.indices.contains(index) {
                lastInlineCaption = captions[index]
                item.select(captions[index], in: captionGroup)
            }
        default: break
        }
        let duration = playback.currentItem?.duration.seconds ?? 0
        let position = playback.currentTime().seconds
        let selectedCaption = captionGroup.flatMap { group in
            item?.currentMediaSelection.selectedMediaOption(in: group).flatMap { captions.firstIndex(of: $0) }
        } ?? -1
        let selectedAudio = audioGroup.flatMap { group in
            item?.currentMediaSelection.selectedMediaOption(in: group).flatMap { group.options.firstIndex(of: $0) }
        } ?? -1
        return ["ok": true, "duration": duration.isFinite ? duration : 0,
                "frameReady": inlineLayer?.isReadyForDisplay == true,
                "captions": captions.map(\.displayName), "selectedCaption": selectedCaption,
                "audio": audioGroup?.options.map(\.displayName) ?? [], "selectedAudio": selectedAudio,
                "position": position.isFinite ? position : 0, "muted": playback.isMuted,
                "paused": playback.timeControlStatus == .paused,
                "buffering": playback.timeControlStatus == .waitingToPlayAtSpecifiedRate,
                "failed": playback.status == .failed || playback.currentItem?.status == .failed]
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
            guard let self = self, !self.progressTarget.isEmpty, controller?.presentingViewController != nil,
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

    private func syncRoom(loadFirstFrame: Bool = false) {
        guard let code = roomCode, let state = roomState else { return }
        let roomPlayer = inlineRoom == code ? inlineLayer?.player :
            (playingRoom == code && playerController?.presentingViewController != nil ? player : nil)
        guard let player = roomPlayer else { return }
        let inline = inlineRoom == code
        if inline && player.currentItem?.status != .readyToPlay { return }
        let paused = state["paused_position"] as? Double
        let now = Date().timeIntervalSince1970 + serverOffset
        let start = state["starts_at"] as? Double ?? now
        let requestedPosition = paused ?? now - start
        let roomDuration = state["duration"] as? Double ?? 0
        let mediaDuration = player.currentItem?.duration.seconds ?? 0
        let durations = [roomDuration, mediaDuration].filter { $0.isFinite && $0 > 0 }
        let duration = durations.min() ?? 0
        let ended = duration > 0 && requestedPosition >= duration
        let shouldPause = paused != nil || requestedPosition < 0 || ended || state["closed"] as? Bool == true
        let safeEnd = duration > 0 ? max(0, duration - 0.5) : Double.greatestFiniteMagnitude
        let position = min(max(0, requestedPosition), safeEnd)
        let current = player.currentTime().seconds
        if shouldPause { player.pause() }
        if loadFirstFrame || !current.isFinite || abs(current - position) > 2 {
            let time = CMTime(seconds: position, preferredTimescale: 600)
            if loadFirstFrame && shouldPause {
                player.seek(to: time, toleranceBefore: .zero, toleranceAfter: .zero)
            } else {
                player.seek(to: time)
            }
        }
        if !shouldPause { player.play() }
    }

}


// Serve a fixed list of bundled resources without WebKit file URL access.
private final class BundledInterfaceHandler: NSObject, WKURLSchemeHandler {
    private let resources: [String: String] = {
        guard let url = Bundle.main.url(forResource: "resources", withExtension: "json", subdirectory: "Web"),
              let data = try? Data(contentsOf: url),
              let manifest = try? JSONDecoder().decode([String: String].self, from: data) else { return [:] }
        return manifest
    }()

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url,
              url.scheme == "diastomy", url.host == "app",
              let mime = resources[url.path],
              let root = Bundle.main.resourceURL?.appendingPathComponent("Web") else {
            urlSchemeTask.didFailWithError(URLError(.unsupportedURL))
            return
        }
        do {
            let data = try Data(contentsOf: root.appendingPathComponent(String(url.path.dropFirst())))
            let response = URLResponse(url: url, mimeType: mime,
                                       expectedContentLength: data.count,
                                       textEncodingName: mime.hasPrefix("text/") || mime == "application/javascript" ? "utf-8" : nil)
            urlSchemeTask.didReceive(response)
            urlSchemeTask.didReceive(data)
            urlSchemeTask.didFinish()
        } catch {
            urlSchemeTask.didFailWithError(error)
        }
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {
        // Resource reads finish synchronously on the calling thread.
    }
}
