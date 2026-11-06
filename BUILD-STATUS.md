# Build and deployment status — iOS 2 bundled client

Implemented locally in `/root/diastomy-ios-offline`, based on the supplied GitHub
source ZIP (commit ab063b2c159f4f18f4f265c6615a7ad0e23646b2).

Passed:
- Real Playwright WebKit runs of the bundled file:// application: home rendering,
  escaping API text, native playback dispatch, cached home and title while offline,
  every listed local screen with APIs unavailable, login error reporting, and first
  launch offline with an empty cache. Remote HTML/JS/CSS/font requests: zero.
- Read-only Django contract checks against the current catalogue: PWA editorial
  rails, movie/series details, guest session and private/media entitlement gates.
- Existing plist/XML/assets/workflow consistency checks; new bundled resource and
  Xcode folder-reference checks; JavaScript and backend Python syntax; shell syntax.
- Django `manage.py check`: no issues.

Companion API installed on this server, with originals backed up at:
`/var/www/diastomy/backups/ios-offline-api-20261105-194806-061252/`.
Gunicorn received a graceful HUP. Local HTTP checks through its live port returned:
- /api/app/v1/session/: 200 JSON
- /api/app/v1/home/: 200 JSON
- /api/app/v1/library/: 401 JSON for guest
- /api/app/v1/rooms/: 401 JSON for guest
- /movie/api/filter/?type=movie&page=1: 200 JSON

No successful Xcode compilation, signed IPA, physical iPhone test, authenticated
media playback, live room synchronization or payment is claimed. Those require
the macOS workflow and device testing. Browser tests use a labelled API bridge
double; they do not execute the native Swift bridge. GitHub has not been updated
from this session and no workflow has been dispatched. See README-FA.md for
features and current differences from the web client.

## 2.0.1 navigation fix

Passed the existing WebKit suite and a new regression that keeps API replies
unresolved while navigating footer tabs and rendering stale public cache.
Resource validators and JavaScript syntax checks passed. No new native build
or installed-device verification is claimed.
