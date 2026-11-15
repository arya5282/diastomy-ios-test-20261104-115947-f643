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

final class DiastomyTabController: UITabBarController, UITabBarControllerDelegate {
    private var didPreloadTabs = false
    override func viewDidLoad() {
        super.viewDidLoad()
        delegate = self
        overrideUserInterfaceStyle = .dark
        tabBar.tintColor = UIColor(red: 1, green: 0.24, blue: 0.27, alpha: 1)
        let tabs = [
            ("home", "خانه", "house", "house.fill"),
            ("rooms", "اتاق فیلم", "square.grid.2x2", "square.grid.2x2.fill"),
            ("search", "جستجو", "magnifyingglass", "magnifyingglass"),
            ("library", "کتابخانه", "play.rectangle", "play.rectangle.fill")
        ]
        viewControllers = tabs.map { route, title, icon, selectedIcon in
            let controller = BrowserViewController()
            controller.initialTabRoute = route
            controller.isSecondaryTab = route != "home"
            controller.tabBarItem = UITabBarItem(title: title, image: UIImage(systemName: icon),
                                                  selectedImage: UIImage(systemName: selectedIcon))
            return controller
        }
        if #available(iOS 26.0, *) {
            tabBarMinimizeBehavior = .onScrollDown
        }
        updateTabBar()
    }

    override var childForStatusBarStyle: UIViewController? { selectedViewController }

    func updateTabBar() {
        let selected = selectedViewController as? BrowserViewController
        let hidden = selected?.showsNativeTabBar != true && !(didPreloadTabs && selected?.isLoadingSecondaryTab == true)
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
