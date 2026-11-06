"""Compile and launch the real offline iOS UI; retain native startup diagnostics."""
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import time

root = Path(__file__).resolve().parents[1]
output = root / 'output'
output.mkdir(exist_ok=True)
derived = root / 'build/startup-smoke'


def run(*args, timeout=180, env=None):
    return subprocess.check_output(args, text=True, timeout=timeout, env=env).strip()


def wait_for_report(report, timeout=60):
    deadline = time.monotonic() + timeout
    latest = None
    while time.monotonic() < deadline:
        if report.exists():
            latest = json.loads(report.read_text())
            if latest.get('complete') is True:
                return latest
        time.sleep(0.25)
    raise RuntimeError('UI never reached a terminal startup state. Last native report: ' + str(latest))


def compatible_runtime(identifier):
    # WebKit bug 293831: refined Swift WebKit APIs crash on the 18.5
    # simulator when built with a deployment target below 18.4. This
    # restriction applies only to the simulator smoke build, not the IPA.
    match = re.search(r'\.iOS-(\d+)-(\d+)(?:-|$)', identifier)
    return match is not None and tuple(map(int, match.groups())) >= (18, 4)


def main():
    devices = json.loads(run('xcrun', 'simctl', 'list', 'devices', 'available', '--json'))['devices']
    types = {x['name']: x['identifier'] for x in json.loads(run('xcrun', 'simctl', 'list', 'devicetypes', '--json'))['devicetypes']}
    choice = next(((runtime, device) for runtime, rows in devices.items() if compatible_runtime(runtime)
                   for device in rows if device.get('isAvailable') and device['name'].startswith('iPhone')
                   and device['name'] in types), None)
    if choice is None:
        raise RuntimeError('No available iOS 18.4+ iPhone simulator runtime. Install one in Xcode Settings > Components.')
    runtime, device = choice
    simulator = run('xcrun', 'simctl', 'create', 'Diastomy offline startup check', types[device['name']], runtime)
    container = None
    passed = False
    try:
        print('STARTUP_TEST: compile simulator app on ' + runtime, flush=True)
        subprocess.run([
            'xcodebuild', '-quiet', '-project', str(root / 'Diastomy.xcodeproj'), '-scheme', 'Diastomy',
            '-configuration', 'Debug', '-sdk', 'iphonesimulator',
            '-destination', 'generic/platform=iOS Simulator', '-derivedDataPath', str(derived),
            'IPHONEOS_DEPLOYMENT_TARGET=18.4',
            'CODE_SIGNING_ALLOWED=YES', 'CODE_SIGNING_REQUIRED=YES', 'CODE_SIGN_IDENTITY=-', 'build',
        ], check=True, timeout=600)
        print('PASS: simulator compilation', flush=True)
        app = derived / 'Build/Products/Debug-iphonesimulator/Diastomy.app'
        info = plistlib.loads((app / 'Info.plist').read_bytes())
        bundle = info['CFBundleIdentifier']
        run('xcrun', 'simctl', 'boot', simulator)
        run('xcrun', 'simctl', 'bootstatus', simulator, '-b', timeout=240)
        run('xcrun', 'simctl', 'install', simulator, str(app))
        container = Path(run('xcrun', 'simctl', 'get_app_container', simulator, bundle, 'data'))
        for filename in ('startup-stdout.txt', 'startup-stderr.txt'):
            (output / filename).touch()
        environment = dict(os.environ)
        environment['SIMCTL_CHILD_DIASTOMY_STARTUP_TEST'] = '1'
        launch = run('xcrun', 'simctl', 'launch',
                     '--stdout=' + str(output / 'startup-stdout.txt'),
                     '--stderr=' + str(output / 'startup-stderr.txt'),
                     simulator, bundle, '--offline-startup-test', env=environment)
        print('STARTUP_TEST: launch result: ' + launch, flush=True)
        report = container / 'Documents/startup-report.json'
        data = wait_for_report(report)
        print('STARTUP_TEST: terminal native report: ' + json.dumps(data, ensure_ascii=False), flush=True)
        assert data.get('ready') is True and data.get('localDocument') is True, 'Offline UI/bridge failed: ' + str(data)
        passed = True
        print('PASS: local iOS page, CSS and native reply bridge initialized with server APIs disabled.', flush=True)
    finally:
        if container is not None:
            report = container / 'Documents/startup-report.json'
            if report.exists():
                shutil.copy2(report, output / 'startup-report.json')
        try:
            run('xcrun', 'simctl', 'io', simulator, 'screenshot', str(output / 'startup-smoke.png'), timeout=30)
        except (subprocess.SubprocessError, OSError) as error:
            print('Startup screenshot unavailable: ' + str(error), flush=True)
        try:
            logs = run('xcrun', 'simctl', 'spawn', simulator, 'log', 'show', '--last', '2m',
                       '--style', 'compact', '--predicate', 'process == "Diastomy"', timeout=45)
            (output / 'startup-log.txt').write_text(logs)
        except (subprocess.SubprocessError, OSError) as error:
            print('Startup log unavailable: ' + str(error), flush=True)
        if not passed:
            for name in ('startup-report.json', 'startup-stderr.txt', 'startup-stdout.txt', 'startup-log.txt'):
                path = output / name
                if path.exists():
                    print('STARTUP_DIAGNOSTIC ' + name + ':\n' + '\n'.join(path.read_text(errors='replace').splitlines()[-50:]), flush=True)
        for operation in ('shutdown', 'delete'):
            try:
                subprocess.run(['xcrun', 'simctl', operation, simulator], capture_output=True, timeout=45)
            except (subprocess.SubprocessError, OSError):
                pass


if __name__ == '__main__':
    main()
