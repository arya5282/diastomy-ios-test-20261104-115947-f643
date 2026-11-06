# Diastomy iOS 2 — bundled offline interface

See [README-FA.md](README-FA.md) for architecture, supported features, limitations,
server API installation and GitHub Actions build instructions.

The app loads `Diastomy/Web/index.html` from its bundle. It does not load the
website as its UI. Only public JSON metadata, private account APIs, images,
media, room WebSocket traffic and payment checkout need the network.

This repository is source code, not a prebuilt or signed IPA.
