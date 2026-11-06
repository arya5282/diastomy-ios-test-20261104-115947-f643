"""Install the companion JSON routes, with dated backups. Does not restart services.
Preview: python3 backend/install_backend.py /var/www/diastomy
Apply:   python3 backend/install_backend.py /var/www/diastomy --apply
"""
import argparse
from datetime import datetime, timezone
from pathlib import Path
import shutil

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('server', type=Path)
parser.add_argument('--apply', action='store_true')
args = parser.parse_args()
root = args.server.resolve()
urls = root / 'diastomy/urls.py'
destination = root / 'core/mobile_app_api.py'
source = Path(__file__).with_name('mobile_app_api.py')
text = urls.read_text()
route = "    path('api/app/v1/', include('core.mobile_app_api')),\n"
if 'core.mobile_app_api' not in text:
    marker = 'urlpatterns = ['
    if text.count(marker) != 1:
        raise SystemExit('Expected one urlpatterns list; inspect URLConf before installing.')
    text = text.replace(marker, marker + '\n' + route, 1)
    text = 'from django.urls import include, path\n' + text
compile(text, str(urls), 'exec')
compile(source.read_text(), str(destination), 'exec')
print('Install core/mobile_app_api.py and mount /api/app/v1/ in diastomy/urls.py')
print('No database migrations; no existing API or page is replaced.')
if not args.apply:
    print('Preview only. Pass --apply to write these two files; reload Django separately.')
else:
    backup = root / 'backups' / ('ios-offline-api-' + datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S-%f'))
    backup.mkdir(parents=True, exist_ok=False)
    shutil.copy2(urls, backup / 'urls.py')
    if destination.exists():
        shutil.copy2(destination, backup / 'mobile_app_api.py')
    shutil.copy2(source, destination)
    destination.chmod(0o644)
    temporary = urls.with_name('urls.py.ios-offline-tmp')
    shutil.copy2(urls, temporary)
    temporary.write_text(text)
    temporary.replace(urls)
    print('Installed. Backup:', backup)
