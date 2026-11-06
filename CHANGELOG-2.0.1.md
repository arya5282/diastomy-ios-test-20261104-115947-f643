# 2.0.1 — cached page navigation

Previously public cached responses were read only after a failed network request.
The client now displays public cached data immediately. Entries older than 15
seconds refresh in the background; late responses cannot redraw another route.
Private account, payment, room and playback APIs are never retained this way.

Added a WebKit regression test that leaves all native API promises unresolved:
footer navigation and cached content still render within the 1.5-second test
limit. This is a browser regression test, not a physical-iPhone benchmark.

The About screen and Info.plist now identify version 2.0.1. No IPA has been built
for this patch in this Linux session. The installed user's IPA is not yet known.
