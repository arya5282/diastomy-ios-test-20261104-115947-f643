"""Read-only contract smoke check against an existing Django installation."""
import importlib.util
import json
import os
import sys
from pathlib import Path

server = Path(sys.argv[1] if len(sys.argv) > 1 else '/var/www/diastomy')
sys.path.insert(0, str(server))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'diastomy.settings')
import django
django.setup()
from django.db import connection
from django.test import RequestFactory, override_settings
from django.contrib.auth.models import AnonymousUser
from movie.models import Movie, Series

spec = importlib.util.spec_from_file_location('mobile_app_api', Path(__file__).with_name('mobile_app_api.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
request = RequestFactory().get('/api/app/v1/home/', HTTP_HOST='diastomy.top', secure=True)
request.user = AnonymousUser()
request.session = {}
with connection.cursor() as cursor:
    cursor.execute('PRAGMA query_only = ON')
try:
    with override_settings(CACHES={'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}}):
        data = json.loads(module.home(request).content)
        assert data['hero'] and data['rails']
        print('PASS: current PWA editorial rails serialized to public JSON')
        for kind, model in [('movie', Movie), ('series', Series)]:
            item = model.objects.first()
            response = module.detail(request, kind, item.slug)
            detail = json.loads(response.content)
            assert detail['slug'] == item.slug and detail['type'] == kind
            assert 'url' not in detail and 'user' not in detail
            print('PASS: public ' + kind + ' detail/metadata')
        response = module.session(request)
        assert json.loads(response.content)['user'] is None
        assert response.status_code == 200
        for endpoint in (module.library, module.settings):
            assert endpoint(request).status_code == 401
        video = Movie.objects.filter(is_free=False, videos__direct_download_url__gt='').first().videos.first()
        assert module.playback(request, 'movie', video.pk).status_code == 401
        print('PASS: guest session and private/media entitlement gates')
finally:
    with connection.cursor() as cursor:
        cursor.execute('PRAGMA query_only = OFF')
    connection.close()
