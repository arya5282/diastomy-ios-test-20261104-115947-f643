# Build status

Prepared on Linux; an iOS SDK / Xcode runner is not available in this workspace.
No successful Xcode build or physical-device run is claimed. The GitHub workflow
performs the first actual iPhone-device build and packages the unsigned ARM64 app.

Local checks cover project/plist/XML/resource consistency, Swift syntax parsing,
JavaScript syntax/app-mode behavior, workflow structure, shell syntax, and source
package contents. They do not substitute for Xcode type-checking or iPhone tests.
