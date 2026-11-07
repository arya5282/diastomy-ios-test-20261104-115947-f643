# Diastomy iOS 2.0.4

- Avoid waiting for a JavaScript promise reply during initial WebKit startup; the native bridge now marks the interface ready when it receives the startup probe.
- Validate the active local main-frame URL when handling WebKit messages, since device WebKit may report a different request URL for the frame.
- Allow up to 30 seconds for first launch on slower iPhones.
