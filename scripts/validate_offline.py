"""Check bundled files, Xcode resource wiring and basic offline boundaries."""
import ast
import re
from pathlib import Path

root = Path(__file__).resolve().parents[1]
web = root / 'Diastomy/Web'
html = (web / 'index.html').read_text()
for target in re.findall(r'(?:src|href)="([^"]+)"', html):
    if not target.startswith('#'):
        assert '://' not in target and (web / target).is_file(), target
for target in re.findall(r"url\(['\"]?([^)'\"]+)", (web / 'app.css').read_text()):
    assert '://' not in target and (web / target).is_file(), target
assert "connect-src 'none'" in html
assert "script-src 'self'" in html
assert "form-action 'none'" in html
assert (web / 'assets/Yekan.woff2').stat().st_size > 1000
project = (root / 'Diastomy.xcodeproj/project.pbxproj').read_text()
assert re.search(r'AAAAAAAAAAAAAAAAAAAAAA01\s*=\s*\{[^}]*path = Web;', project)
assert re.search(r'AAAAAAAAAAAAAAAAAAAAAA02\s*=\s*\{[^}]*fileRef = AAAAAAAAAAAAAAAAAAAAAA01;', project)
assert project.count('AAAAAAAAAAAAAAAAAAAAAA01') == 3
assert project.count('AAAAAAAAAAAAAAAAAAAAAA02') == 2
native = (root / 'Diastomy/BrowserViewController.swift').read_text()
assert 'webView.loadFileURL(index, allowingReadAccessTo: webRoot)' in native
assert 'webView.load(URLRequest' not in native
assert 'message.frameInfo.isMainFrame, isLocal' in native
assert 'AVURLAssetHTTPCookiesKey' in native
assert 'configuration.limitsNavigationsToAppBoundDomains = true' in native
assert 'resolvingSymlinksInPath()' in native
assert 'func webView(_ webView: WKWebView, didFailProvisionalNavigation' in native
assert 'test_ios_startup.py' in (root / 'scripts/build-ipa.sh').read_text()
for path in list((root / 'backend').glob('*.py')) + list((root / 'scripts').glob('*.py')):
    ast.parse(path.read_text(), filename=str(path))
print('PASS: local HTML/CSS/font resources, Xcode bundle wiring, native document boundary and backend Python syntax')
