"""Portable resource preflight; Xcode is still required to compile the app."""
from pathlib import Path
import json
import plistlib
import struct
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parents[1]
info = plistlib.loads((root / 'Diastomy/Info.plist').read_bytes())
assert info['WKAppBoundDomains'] == ['diastomy.top', 'www.diastomy.top']
assert info['UILaunchStoryboardName'] == 'LaunchScreen'
assert 'NSAllowsArbitraryLoads' not in info.get('NSAppTransportSecurity', {})
for path in [root / 'Diastomy/LaunchScreen.storyboard',
             root / 'Diastomy.xcodeproj/xcshareddata/xcschemes/Diastomy.xcscheme']:
    ET.parse(path)
for catalog in (root / 'Diastomy/Assets.xcassets').glob('*/Contents.json'):
    data = json.loads(catalog.read_text())
    for image in data.get('images', []):
        png = catalog.parent / image['filename']
        content = png.read_bytes()
        assert content[:8] == b'\x89PNG\r\n\x1a\n', png
        if catalog.parent.name == 'AppIcon.appiconset':
            size = float(image['size'].split('x')[0])
            pixels = round(size * int(image['scale'][0]))
            assert struct.unpack('>II', content[16:24]) == (pixels, pixels), png
            assert content[25] == 2, 'App icons must be opaque RGB PNGs'
project = (root / 'Diastomy.xcodeproj/project.pbxproj').read_text()
for filename in ['AppDelegate.swift', 'BrowserViewController.swift', 'AppMode.js', 'Assets.xcassets', 'LaunchScreen.storyboard']:
    assert (root / 'Diastomy' / filename).exists(), filename
    assert filename in project, filename
assert (root / '.github/workflows/build-ios.yml').read_bytes() == (root / 'BUILD-IPA.yml').read_bytes()
assert 'CODE_SIGNING_ALLOWED=NO' in (root / 'scripts/build-ipa.sh').read_text()
print('PASS: plist, XML, asset sizes/opacity, bundled resources and workflow copies')
