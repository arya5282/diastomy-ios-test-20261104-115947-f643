import UIKit

@main
final class AppDelegate: UIResponder, UIApplicationDelegate {
    func application(_ application: UIApplication,
                     didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        StartupDiagnostics.record(stage: "applicationLaunched")
        return true
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let configuration = UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
        configuration.delegateClass = SceneDelegate.self
        return configuration
    }
}

final class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession,
               options connectionOptions: UIScene.ConnectionOptions) {
        StartupDiagnostics.record(stage: "sceneConnected")
        guard let windowScene = scene as? UIWindowScene else {
            StartupDiagnostics.record(stage: "sceneFailed", ready: false, message: "Expected UIWindowScene")
            return
        }
        let next = UIWindow(windowScene: windowScene)
        next.backgroundColor = .black
        next.rootViewController = DiastomyTabController()
        window = next
        next.makeKeyAndVisible()
    }

    func scene(_ scene: UIScene, openURLContexts contexts: Set<UIOpenURLContext>) {
        guard let tabs = window?.rootViewController as? DiastomyTabController,
              let controller = tabs.selectedViewController as? BrowserViewController else { return }
        for context in contexts {
            controller.completeBrowserSignIn(context.url)
        }
    }
}

final class DiastomyTabController: UITabBarController, UITabBarControllerDelegate, UIGestureRecognizerDelegate {
    private var didPreloadTabs = false
    private var swipeOrigin: Int?
    private var swipeTabWidth: CGFloat = 1
    private let compactTabBarScale: CGFloat = 0.95

    override func viewDidLoad() {
        super.viewDidLoad()
        delegate = self
        overrideUserInterfaceStyle = .dark
        tabBar.tintColor = UIColor(red: 1, green: 0.24, blue: 0.27, alpha: 1)
        let tabs = [
            ("home", "خانه", "tab-home", "tab-home"),
            ("rooms", "اتاق فیلم", "tab-room", "tab-room-selected"),
            ("search", "جستجو", "tab-search", "tab-search-selected"),
            ("library", "کتابخانه", "tab-movies", "tab-movies-selected")
        ]
        viewControllers = tabs.map { route, title, icon, selectedIcon in
            let controller = BrowserViewController()
            controller.initialTabRoute = route
            controller.isSecondaryTab = route != "home"
            let item = UITabBarItem(title: nil, image: UIImage(named: icon), selectedImage: UIImage(named: selectedIcon))
            item.accessibilityLabel = title
            controller.tabBarItem = item
            return controller
        }
        if #available(iOS 26.0, *) {
            tabBarMinimizeBehavior = .onScrollDown
        }
        let swipe = UIPanGestureRecognizer(target: self, action: #selector(swipeTabs(_:)))
        swipe.maximumNumberOfTouches = 1
        swipe.cancelsTouchesInView = true
        swipe.delegate = self
        tabBar.addGestureRecognizer(swipe)
        updateTabBar()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        guard #available(iOS 26.0, *), let count = viewControllers?.count, count > 0 else { return }
        let width = tabBar.bounds.width
        let height = tabBar.bounds.height
        guard width > 0, height > 0 else { return }
        let minimumScale = max(44 * CGFloat(count) / width, 44 / height)
        let scale = min(1, max(compactTabBarScale, minimumScale))
        let transform = CGAffineTransform(scaleX: scale, y: scale)
        if tabBar.transform != transform {
            tabBar.transform = transform
        }
    }

    func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        guard let swipe = gestureRecognizer as? UIPanGestureRecognizer else { return false }
        let speed = swipe.velocity(in: view)
        return abs(speed.x) > abs(speed.y)
    }

    @objc private func swipeTabs(_ gesture: UIPanGestureRecognizer) {
        switch gesture.state {
        case .began:
            guard let count = viewControllers?.count, count > 1 else { return }
            swipeOrigin = selectedIndex
            swipeTabWidth = max(44, tabBar.convert(tabBar.bounds, to: view).width / CGFloat(count))
            selectTabDuringSwipe(gesture)
        case .changed:
            selectTabDuringSwipe(gesture)
        case .ended, .cancelled, .failed:
            swipeOrigin = nil
            updateTabBar()
        default:
            break
        }
    }

    private func selectTabDuringSwipe(_ gesture: UIPanGestureRecognizer) {
        guard let origin = swipeOrigin, let count = viewControllers?.count else { return }
        let direction: CGFloat = tabBar.effectiveUserInterfaceLayoutDirection == .rightToLeft ? -1 : 1
        let offset = direction * gesture.translation(in: view).x / swipeTabWidth
        let position = min(CGFloat(count - 1), max(0, CGFloat(origin) + offset))
        // Hysteresis prevents repeated switches when hovering near a boundary.
        guard abs(position - CGFloat(selectedIndex)) >= 0.56 else { return }
        selectedIndex = Int(position.rounded())
        updateTabBar()
    }

    override var childForStatusBarStyle: UIViewController? { selectedViewController }

    func updateTabBar() {
        let selected = selectedViewController as? BrowserViewController
        let hidden = swipeOrigin == nil && selected?.showsNativeTabBar != true &&
            !(didPreloadTabs && selected?.isLoadingSecondaryTab == true)
        if !hidden, selected?.showsNativeTabBar == true, !didPreloadTabs {
            didPreloadTabs = true
            DispatchQueue.main.async { [weak self] in
                guard let self, (self.selectedViewController as? BrowserViewController)?.showsNativeTabBar == true else {
                    self?.didPreloadTabs = false
                    return
                }
                for case let controller as BrowserViewController in self.viewControllers ?? [] {
                    controller.loadViewIfNeeded()
                }
            }
        }
        if #available(iOS 18.0, *) {
            if isTabBarHidden != hidden { setTabBarHidden(hidden, animated: false) }
        } else {
            tabBar.isHidden = hidden
        }
    }

    func clearOtherTabs(except current: BrowserViewController) {
        for case let controller as BrowserViewController in viewControllers ?? [] where controller !== current {
            controller.resetTabOnAppearance()
        }
    }

    func openSearchTab(from source: BrowserViewController, query: String) -> Bool {
        guard selectedViewController === source,
              let search = viewControllers?.compactMap({ $0 as? BrowserViewController }).first(where: {
                  $0.initialTabRoute == "search"
              }) else { return false }
        selectedViewController = search
        updateTabBar()
        search.showSearchResults(for: query)
        return true
    }

    func tabBarController(_ tabBarController: UITabBarController, shouldSelect viewController: UIViewController) -> Bool {
        if viewController === selectedViewController {
            (viewController as? BrowserViewController)?.scrollTabToTop()
            return false
        }
        return true
    }

    func tabBarController(_ tabBarController: UITabBarController, didSelect viewController: UIViewController) {
        updateTabBar()
    }
}

// Only the Debug simulator smoke test writes reports. No account/API data is
// recorded. Explicit directory creation and logged write errors avoid treating
// an unavailable report as evidence of a specific WebKit failure.
enum StartupDiagnostics {
    static var isOfflineTest: Bool {
        #if DEBUG
        return ProcessInfo.processInfo.arguments.contains("--offline-startup-test") ||
            ProcessInfo.processInfo.environment["DIASTOMY_STARTUP_TEST"] == "1"
        #else
        return false
        #endif
    }

    static func record(stage: String, ready: Bool? = nil, localDocument: Bool? = nil, message: String = "") {
        guard isOfflineTest else { return }
        var report: [String: Any] = [
            "stage": stage, "complete": ready != nil, "message": message,
            "version": Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? ""
        ]
        if let ready = ready { report["ready"] = ready }
        if let localDocument = localDocument { report["localDocument"] = localDocument }
        NSLog("DIASTOMY_STARTUP %@", stage)
        do {
            let directory = try FileManager.default.url(for: .documentDirectory, in: .userDomainMask,
                                                       appropriateFor: nil, create: true)
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            let bytes = try JSONSerialization.data(withJSONObject: report)
            try bytes.write(to: directory.appendingPathComponent("startup-report.json"), options: .atomic)
        } catch {
            NSLog("DIASTOMY_STARTUP_REPORT_WRITE_FAILED %@", String(describing: error))
        }
    }
}
