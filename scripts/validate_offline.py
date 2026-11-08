"""Check bundled files, Xcode resource wiring and basic offline boundaries."""
import ast
import json
import re
from pathlib import Path

root = Path(__file__).resolve().parents[1]
web = root / 'Diastomy/Web'
html = (web / 'index.html').read_text()
for target in re.findall(r'(?:src|href)="([^"]+)"', html):
    if not target.startswith('#'):
        assert '://' not in target and (web / target.lstrip('/')).is_file(), target
for stylesheet in web.rglob('*.css'):
    for target in re.findall(r"url\(['\"]?([^)\'\"]+)", stylesheet.read_text()):
        if target.startswith('data:') or target.startswith('#'):
            continue
        assert '://' not in target, target
        target = target.split('?')[0].split('#')[0]
        asset = web / target.lstrip('/') if target.startswith('/') else stylesheet.parent / target
        assert asset.resolve().is_relative_to(web.resolve()) and asset.is_file(), target
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
assert 'configuration.setURLSchemeHandler(BundledInterfaceHandler(), forURLScheme: "diastomy")' in native
assert 'diastomy://app/index.html' in native
assert 'message.frameInfo.isMainFrame, isLocal' in native
assert 'AVURLAssetHTTPCookiesKey' in native
assert 'WKAppBoundDomains' not in (root / 'Diastomy/Info.plist').read_text()
assert 'let mime = resources[url.path]' in native
assert 'func webView(_ webView: WKWebView, didFailProvisionalNavigation' in native
assert 'test_ios_startup.py' in (root / 'scripts/build-ipa.sh').read_text()
resources = json.loads((web / 'resources.json').read_text())
for path in web.rglob('*'):
    if path.is_file() and path.name != 'resources.json':
        assert '/' + path.relative_to(web).as_posix() in resources, path
for path in resources:
    assert '..' not in path and (web / path.lstrip('/')).is_file(), path
for path in list((root / 'backend').glob('*.py')) + list((root / 'scripts').glob('*.py')):
    ast.parse(path.read_text(), filename=str(path))
print('PASS: local HTML/CSS/font resources, Xcode bundle wiring, native document boundary and backend Python syntax')
