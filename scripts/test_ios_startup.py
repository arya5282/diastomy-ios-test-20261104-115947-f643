"""Build/launch the real UIKit + WKWebView app offline on an iOS simulator.
Executed on the macOS builder before an installable device IPA is produced.
"""
import json
from pathlib import Path
import plistlib
import subprocess
import time

root = Path(__file__).resolve().parents[1]
output = root / 'output'
output.mkdir(exist_ok=True)
derived = root / 'build/startup-smoke'

def run(*args, timeout=180):
    return subprocess.check_output(args, text=True, timeout=timeout).strip()

devices = json.loads(run('xcrun', 'simctl', 'list', 'devices', 'available', '--json'))['devices']
types = {x['name']: x['identifier'] for x in json.loads(run('xcrun', 'simctl', 'list', 'devicetypes', '--json'))['devicetypes']}
choice = next(((runtime, device) for runtime, rows in devices.items() if '.iOS-' in runtime
               for device in rows if device.get('isAvailable') and device['name'].startswith('iPhone')
               and device['name'] in types), None)
if choice is None:
    raise SystemExit('No available iPhone simulator runtime. Install one in Xcode Settings > Components.')
runtime, device = choice
simulator = run('xcrun', 'simctl', 'create', 'Diastomy offline startup check', types[device['name']], runtime)
try:
    subprocess.run([
        'xcodebuild', '-project', str(root / 'Diastomy.xcodeproj'), '-scheme', 'Diastomy',
        '-configuration', 'Debug', '-sdk', 'iphonesimulator',
        '-destination', 'generic/platform=iOS Simulator', '-derivedDataPath', str(derived),
        'CODE_SIGNING_ALLOWED=NO', 'CODE_SIGNING_REQUIRED=NO', 'CODE_SIGN_IDENTITY=', 'build',
    ], check=True, timeout=600)
    app = derived / 'Build/Products/Debug-iphonesimulator/Diastomy.app'
    info = plistlib.loads((app / 'Info.plist').read_bytes())
    bundle = info['CFBundleIdentifier']
    run('xcrun', 'simctl', 'boot', simulator)
    run('xcrun', 'simctl', 'bootstatus', simulator, '-b', timeout=240)
    run('xcrun', 'simctl', 'install', simulator, str(app))
    run('xcrun', 'simctl', 'launch', simulator, bundle, '--offline-startup-test')
    container = Path(run('xcrun', 'simctl', 'get_app_container', simulator, bundle, 'data'))
    report = container / 'Documents/startup-report.json'
    deadline = time.monotonic() + 35
    while not report.exists() and time.monotonic() < deadline:
        time.sleep(0.25)
    if not report.exists():
        raise RuntimeError('Native UI readiness report was not produced; startup may be blank or crashed.')
    data = json.loads(report.read_text())
    assert data.get('ready') is True and data.get('localDocument') is True, 'Offline UI/bridge failed: ' + str(data)
    print('PASS: real iOS app rendered the bundled page and completed its native bridge handshake with server APIs disabled.', flush=True)
finally:
    try:
        run('xcrun', 'simctl', 'io', simulator, 'screenshot', str(output / 'startup-smoke.png'), timeout=30)
    except (subprocess.SubprocessError, OSError):
        pass
    subprocess.run(['xcrun', 'simctl', 'shutdown', simulator], capture_output=True, timeout=45)
    subprocess.run(['xcrun', 'simctl', 'delete', simulator], capture_output=True, timeout=45)
