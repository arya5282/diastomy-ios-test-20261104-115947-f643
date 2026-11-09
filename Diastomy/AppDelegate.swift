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
        next.rootViewController = BrowserViewController()
        window = next
        next.makeKeyAndVisible()
    }

    func scene(_ scene: UIScene, openURLContexts contexts: Set<UIOpenURLContext>) {
        guard let controller = window?.rootViewController as? BrowserViewController else { return }
        for context in contexts {
            controller.completeBrowserSignIn(context.url)
        }
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
