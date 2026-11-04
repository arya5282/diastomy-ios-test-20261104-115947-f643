import UIKit
import WebKit

final class BrowserViewController: UIViewController, WKNavigationDelegate, WKUIDelegate, WKDownloadDelegate {
    private let home = URL(string: "https://diastomy.top/?source=pwa&client=ios")!
    private let trustedHosts: Set<String> = ["diastomy.top", "www.diastomy.top"]
    private var webView: WKWebView!
    private let cover = UIView()
    private let progress = UIProgressView(progressViewStyle: .bar)
    private var observation: NSKeyValueObservation?
    private var downloadedFiles: [ObjectIdentifier: URL] = [:]
    private var errorView: UIView?

    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask {
        UIDevice.current.userInterfaceIdiom == .pad ? .all : .allButUpsideDown
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .black
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .default()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []
        configuration.allowsAirPlayForMediaPlayback = true
        configuration.allowsPictureInPictureMediaPlayback = true
        configuration.limitsNavigationsToAppBoundDomains = true
        configuration.applicationNameForUserAgent = "DiastomyIOS/1.0"
        if let scriptURL = Bundle.main.url(forResource: "AppMode", withExtension: "js"),
           let script = try? String(contentsOf: scriptURL, encoding: .utf8) {
            configuration.userContentController.addUserScript(
                WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        }
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsBackForwardNavigationGestures = true
        webView.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(webView)
        NSLayoutConstraint.activate([
            webView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            webView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            webView.topAnchor.constraint(equalTo: view.topAnchor),
            webView.bottomAnchor.constraint(equalTo: view.bottomAnchor)
        ])
        installLaunchCover()
        observation = webView.observe(\.estimatedProgress, options: [.new]) { [weak self] browser, _ in
            self?.progress.setProgress(Float(browser.estimatedProgress), animated: true)
        }
        webView.load(URLRequest(url: home))
    }

    private func installLaunchCover() {
        cover.backgroundColor = .black
        cover.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(cover)
        let logo = UIImageView(image: UIImage(named: "LaunchLogo"))
        logo.contentMode = .scaleAspectFit
        logo.translatesAutoresizingMaskIntoConstraints = false
        cover.addSubview(logo)
        progress.progressTintColor = UIColor(red: 0.87, green: 0.01, blue: 0.02, alpha: 1)
        progress.trackTintColor = UIColor(white: 0.12, alpha: 1)
        progress.translatesAutoresizingMaskIntoConstraints = false
        cover.addSubview(progress)
        NSLayoutConstraint.activate([
            cover.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            cover.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            cover.topAnchor.constraint(equalTo: view.topAnchor),
            cover.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            logo.centerXAnchor.constraint(equalTo: cover.centerXAnchor),
            logo.centerYAnchor.constraint(equalTo: cover.centerYAnchor, constant: -12),
            logo.widthAnchor.constraint(equalToConstant: 150),
            logo.heightAnchor.constraint(equalToConstant: 36),
            progress.centerXAnchor.constraint(equalTo: cover.centerXAnchor),
            progress.topAnchor.constraint(equalTo: logo.bottomAnchor, constant: 18),
            progress.widthAnchor.constraint(equalToConstant: 120),
            progress.heightAnchor.constraint(equalToConstant: 2)
        ])
    }

    private func revealPage() {
        guard !cover.isHidden else { return }
        UIView.animate(withDuration: 0.2, animations: { self.cover.alpha = 0 }) { _ in
            self.cover.isHidden = true
        }
    }

    private func isTrusted(_ url: URL) -> Bool {
        url.scheme?.lowercased() == "https" && trustedHosts.contains(url.host?.lowercased() ?? "")
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { decisionHandler(.cancel); return }
        // Embedded media/frames are subresources; only top-level navigation leaves the app.
        if action.targetFrame?.isMainFrame == false { decisionHandler(.allow); return }
        if isTrusted(url) {
            if action.shouldPerformDownload { decisionHandler(.download); return }
            if action.targetFrame == nil {
                decisionHandler(.cancel)
                webView.load(action.request)
            } else { decisionHandler(.allow) }
            return
        }
        if url.scheme == "blob" || url.absoluteString == "about:blank" {
            decisionHandler(action.shouldPerformDownload ? .download : .allow)
            return
        }
        decisionHandler(.cancel)
        if ["https", "http", "mailto", "tel", "tg"].contains(url.scheme?.lowercased() ?? "") {
            UIApplication.shared.open(url)
        }
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        guard response.isForMainFrame else { decisionHandler(.allow); return }
        decisionHandler(response.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, didCommit navigation: WKNavigation!) {
        errorView?.removeFromSuperview()
        errorView = nil
        // The document's own PWA loader now takes over from the native launch cover.
        revealPage()
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { revealPage() }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        showConnectionError(error)
    }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        showConnectionError(error)
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }

    private func showConnectionError(_ error: Error) {
        let error = error as NSError
        guard error.code != NSURLErrorCancelled else { return }
        revealPage()
        errorView?.removeFromSuperview()
        let container = UIView()
        container.backgroundColor = .black
        container.translatesAutoresizingMaskIntoConstraints = false
        let label = UILabel()
        label.text = "اتصال به دیاستومی برقرار نشد.\nاینترنت را بررسی و دوباره تلاش کنید."
        label.textColor = .white
        label.numberOfLines = 0
        label.textAlignment = .center
        label.font = .systemFont(ofSize: 16)
        let retry = UIButton(type: .system)
        retry.setTitle("تلاش دوباره", for: .normal)
        retry.tintColor = .white
        retry.backgroundColor = UIColor(red: 0.8, green: 0, blue: 0.04, alpha: 1)
        retry.layer.cornerRadius = 12
        retry.addTarget(self, action: #selector(retryConnection), for: .touchUpInside)
        let stack = UIStackView(arrangedSubviews: [label, retry])
        stack.axis = .vertical
        stack.spacing = 24
        stack.translatesAutoresizingMaskIntoConstraints = false
        container.addSubview(stack)
        view.addSubview(container)
        NSLayoutConstraint.activate([
            container.leadingAnchor.constraint(equalTo: view.leadingAnchor),
            container.trailingAnchor.constraint(equalTo: view.trailingAnchor),
            container.topAnchor.constraint(equalTo: view.topAnchor),
            container.bottomAnchor.constraint(equalTo: view.bottomAnchor),
            stack.centerXAnchor.constraint(equalTo: container.centerXAnchor),
            stack.centerYAnchor.constraint(equalTo: container.centerYAnchor),
            stack.widthAnchor.constraint(lessThanOrEqualToConstant: 320),
            stack.leadingAnchor.constraint(greaterThanOrEqualTo: container.leadingAnchor, constant: 24),
            retry.heightAnchor.constraint(equalToConstant: 46)
        ])
        errorView = container
    }

    @objc private func retryConnection() {
        errorView?.removeFromSuperview()
        errorView = nil
        webView.load(URLRequest(url: webView.url.flatMap { isTrusted($0) ? $0 : nil } ?? home))
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        // Top-level popup requests are handled by decidePolicyFor navigationAction.
        return nil
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: "Diastomy", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "باشه", style: .default) { _ in completionHandler() })
        present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: "Diastomy", message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "انصراف", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "تأیید", style: .default) { _ in completionHandler(true) })
        present(alert, animated: true)
    }

    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                 initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(origin.protocol == "https" && trustedHosts.contains(origin.host) ? .prompt : .deny)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }
    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse,
                  suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let documents = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let name = String((suggestedFilename as NSString).lastPathComponent.prefix(180))
        let destination = documents.appendingPathComponent(String(UUID().uuidString.prefix(8)) + "-" + (name.isEmpty ? "download" : name))
        downloadedFiles[ObjectIdentifier(download)] = destination
        completionHandler(destination)
    }
    func downloadDidFinish(_ download: WKDownload) {
        guard let file = downloadedFiles.removeValue(forKey: ObjectIdentifier(download)) else { return }
        let sheet = UIActivityViewController(activityItems: [file], applicationActivities: nil)
        sheet.popoverPresentationController?.sourceView = webView
        sheet.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
        if presentedViewController == nil { present(sheet, animated: true) }
    }
    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloadedFiles.removeValue(forKey: ObjectIdentifier(download))
        let alert = UIAlertController(title: "دانلود انجام نشد", message: "اتصال اینترنت و فضای خالی دستگاه را بررسی کنید و دوباره تلاش کنید.", preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "باشه", style: .default))
        if presentedViewController == nil { present(alert, animated: true) }
    }
}
