"""JSON-only companion for the bundled iOS client. No new database tables.

Install as core/mobile_app_api.py and include urlpatterns at api/app/v1/.
Existing authentication, CSRF, media entitlement and playback routes stay active.
"""
from functools import wraps

from django.http import JsonResponse, Http404
from django.middleware.csrf import get_token
from django.shortcuts import get_object_or_404
from django.urls import path, reverse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_GET, require_http_methods

from core.content_labels import content_title, genre_name
from movie.models import Movie, Series, Episode, MovieVideo, EpisodeVideo, Genre, Person
from movie.access import can_access_content
from movie.media_sources import direct_url_usable


def private(view):
    @wraps(view)
    def guarded(request, *args, **kwargs):
        if not request.user.is_authenticated:
            return JsonResponse({'error': 'برای این بخش وارد حساب شوید.'}, status=401)
        return view(request, *args, **kwargs)
    return never_cache(guarded)


def file_url(field):
    return field.url if field else ''


def card(item):
    kind = 'series' if isinstance(item, Series) else 'movie'
    return {
        'id': item.pk, 'type': kind, 'slug': item.slug,
        'title': content_title(item),
        'english_title_full': getattr(item, 'english_title_full', '') or getattr(item, 'title_en', ''),
        'age_limit': getattr(item, 'age_limit', None),
        'cover': file_url(item.cover),
        'banner': file_url(item.banner_mobile) or file_url(item.banner) or file_url(item.cover),
        'description': item.description, 'production_year': item.production_year,
        'imdb_rating': item.imdb_rating, 'duration': item.duration,
        'is_free': item.is_free, 'is_dubbed': item.is_dubbed,
        'genres': [{'slug': g.slug, 'name': genre_name(g)} for g in item.genres.all()],
    }


@never_cache
@require_GET
def session(request):
    user = request.user
    data = None
    if user.is_authenticated:
        from django.utils import timezone
        subscription = user.active_subscription
        days = max(0, (subscription.end_date - timezone.now()).days) if subscription and subscription.end_date else None
        data = {
            'id': user.pk, 'name': user.full_name or user.get_full_name() or user.username,
            'email': user.email, 'subscription_days': days,
            'username': user.username, 'avatar': user.avatar_src,
            'phone': str(getattr(user, 'phone', '') or ''),
            'subscribed': user.has_active_subscription or user.is_staff,
            'language': user.preferred_language,
            'quality': user.preferred_quality,
        }
    from django.conf import settings
    google_client = getattr(settings, 'GOOGLE_CLIENT_ID', '')
    return JsonResponse({'csrf': get_token(request), 'user': data, 'api_version': 1,
                         'browser_sign_in': bool(google_client and google_client != 'YOUR_GOOGLE_CLIENT_ID_HERE')})


@never_cache
@require_GET
def browser_sign_in(request):
    import re
    import time
    from urllib.parse import urlencode
    from django.shortcuts import redirect

    challenge = request.GET.get('challenge', '')
    if not re.fullmatch(r'[a-f0-9]{64}', challenge):
        raise Http404
    request.session['ios_sign_in'] = {'challenge': challenge, 'expires': int(time.time()) + 600}
    finish = reverse('ios_browser_sign_in_finish')
    if request.user.is_authenticated:
        return redirect(finish)
    return redirect(reverse('accounts:login') + '?' + urlencode({'next': finish}))


@never_cache
@require_GET
def browser_sign_in_finish(request):
    import secrets
    import time
    from datetime import timedelta
    from django.contrib.sessions.backends.db import SessionStore
    from django.contrib.sessions.models import Session
    from django.http import HttpResponse
    from django.utils import timezone
    from django.utils.html import format_html

    pending = request.session.get('ios_sign_in')
    if not request.user.is_authenticated or not pending or pending['expires'] < time.time():
        raise Http404
    request.session.pop('ios_sign_in', None)
    code = secrets.token_hex(20)
    Session.objects.create(
        session_key=code,
        session_data=SessionStore().encode({'ios_grant_user': request.user.pk, 'challenge': pending['challenge']}),
        expire_date=timezone.now() + timedelta(minutes=2),
    )
    response = HttpResponse(format_html(
        '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        '<main dir="rtl"><h1>ورود انجام شد</h1><a href="{}">بازگشت به اپ دیاستومی</a></main>',
        'top.diastomy.ios.auth://login?code=' + code,
    ))
    response['Referrer-Policy'] = 'no-referrer'
    return response


@never_cache
@require_http_methods(['POST'])
def browser_sign_in_redeem(request):
    import hashlib
    import hmac
    import json
    import re
    from django.contrib.auth import get_user_model, login
    from django.contrib.sessions.models import Session
    from django.db import transaction
    from django.utils import timezone

    error = {'error': 'این درخواست ورود معتبر نیست یا منقضی شده است.'}
    try:
        body = json.loads(request.body)
        code, verifier = body['code'], body['verifier']
        if not re.fullmatch(r'[a-f0-9]{40}', code) or not re.fullmatch(r'[a-f0-9]{64}', verifier):
            raise ValueError
    except (ValueError, TypeError, KeyError):
        return JsonResponse(error, status=400)
    challenge = hashlib.sha256(verifier.encode('ascii')).hexdigest()
    with transaction.atomic():
        grant = Session.objects.filter(session_key=code, expire_date__gt=timezone.now()).first()
        if grant is None:
            return JsonResponse(error, status=400)
        data = grant.get_decoded()
        if not data.get('ios_grant_user') or not hmac.compare_digest(data.get('challenge', ''), challenge):
            return JsonResponse(error, status=400)
        # Conditional deletion consumes the grant exactly once across workers.
        removed, _ = Session.objects.filter(session_key=code, session_data=grant.session_data).delete()
        if not removed:
            return JsonResponse(error, status=400)
        user = get_user_model().objects.filter(pk=data['ios_grant_user'], is_active=True).first()
        if user is None:
            return JsonResponse(error, status=400)
        login(request, user, backend='django.contrib.auth.backends.ModelBackend')
    return JsonResponse({'ok': True})


@require_GET
def home(request):
    # Reuse the same editorial rails and order as the current PWA.
    from core.views import _home_public_context
    from django.core.cache import cache
    from django.utils.translation import get_language
    from movie.templatetags.image_perf import hero_artwork
    from movie.templatetags.pwa_ui import pwa_hero_age_rating, pwa_hero_duration
    key = 'mobile-app-home:v3:' + (get_language() or 'fa')
    data = cache.get(key)
    if data is None:
        context = _home_public_context()
        names = [
            ('trending_movies', 'ترندترین فیلم‌ها'),
            ('pwa_turkish_series', 'سریال‌های ترکی'),
            ('pwa_latest_movies', 'جدیدترین فیلم‌ها'),
            ('pwa_dubbed_movies', 'فیلم‌های دوبله فارسی'),
            ('pwa_free_movies', 'فیلم‌های بدون نیاز به اشتراک'),
            ('pwa_latest_series', 'جدیدترین سریال‌ها'),
            ('pwa_dubbed_series', 'سریال‌های دوبله فارسی'),
            ('pwa_free_series', 'سریال‌های بدون نیاز به اشتراک'),
            ('pwa_recommended', 'پیشنهاد ما'),
            ('animations', 'جدیدترین انیمیشن‌ها'),
        ]
        data = {
            'hero': [{**card(x), 'hero_artwork': hero_artwork(x),
                      'hero_age': pwa_hero_age_rating(x.age_limit) if x.age_limit is not None else '',
                      'hero_duration': pwa_hero_duration(x.duration) if x.duration else '',
                      'hero_trending': x in context.get('trending_movies', [])}
                     for x in context['hero_items']],
            'rails': [{'key': key, 'title': title, 'items': [card(x) for x in context.get(key, [])]}
                      for key, title in names],
            'genres': [{'slug': x.slug, 'name': genre_name(x)} for x in context['genres']],
        }
        cache.set(key, data, 60)
    return JsonResponse(data)


def title_object(kind, slug):
    if kind not in ('movie', 'series'):
        raise Http404
    model = Movie if kind == 'movie' else Series
    return get_object_or_404(model.objects.prefetch_related('genres', 'actors'), slug=slug)


@require_GET
def detail(request, kind, slug):
    item = title_object(kind, slug)
    data = card(item)
    data['description'] = item.public_persian_description or item.description
    data['director_id'] = item.director_id
    from movie.services.detail_trailers import build_detail_trailers
    data['trailers'] = [{'url': trailer['url'], 'title': trailer.get('title', '')}
                        for trailer in build_detail_trailers(item, kind, limit=3)]
    data['hero_cover'] = file_url(getattr(item, 'trailer_cover', None)) or data['banner']
    data['actors'] = [{'slug': a.slug, 'name': a.name, 'photo': file_url(a.photo)}
                      for a in item.actors.all()[:30]]
    from django.db.models import Count
    comments = item.comments.filter(is_approved=True, parent__isnull=True)
    data['comment_count'] = comments.count()
    data['comments'] = [
        {'text': comment.text, 'spoiler': comment.is_spoiler,
         'author': comment.user.username, 'created_at': comment.created_at.isoformat()}
        for comment in comments.select_related('user').order_by('-pk')[:30]
    ]
    related = type(item).objects.filter(genres__in=item.genres.all()).exclude(pk=item.pk)
    if kind == 'series':
        related = related.distinct().order_by('-imdb_rating', '-created_at')
    else:
        related = related.annotate(shared_genres=Count('genres', distinct=True)).order_by('-shared_genres', '-created_at', '-pk')
    data['similar'] = [card(related_item) for related_item in related.prefetch_related('genres')[:10]]
    # Only public metadata here: this response can be retained offline.
    # Media links and entitlement are always obtained afresh from playback().
    if kind == 'movie':
        videos = item.videos.select_related('quality').order_by('-quality__weight')
        from movie.media_sources import video_has_dub
        data['download_options'] = [
            {'id': v.pk, 'quality': v.quality.title, 'variant': 'subbed',
             'size': v.file_size_label}
            for v in videos if v.direct_download_url
        ] + [
            {'id': v.pk, 'quality': v.quality.title, 'variant': 'dubbed',
             'size': v.dubbed_file_size_label if v.dubbed_download_url else v.file_size_label,
             'audio': 'دوبله فارسی' if v.dubbed_download_url else 'دوزبانه (فارسی + اصلی)'}
            for v in videos if video_has_dub(v)
        ]
        data['videos'] = [{'id': v.pk, 'quality': v.quality.title}
                          for v in videos if direct_url_usable(v)]
    else:
        from movie.download_proxy import is_usable_source_url
        episodes = Episode.objects.filter(season__series=item).select_related('season').prefetch_related('videos__quality').order_by('season__season_number', 'episode_number')
        data['episodes'] = []
        for episode in episodes:
            sources = list(episode.videos.all())
            sources.sort(key=lambda video: video.quality.weight, reverse=True)
            videos = [{'id': video.pk, 'quality': video.quality.title}
                      for video in sources if direct_url_usable(video)]
            downloads = [{'id': video.pk, 'quality': video.quality.title}
                         for video in sources if is_usable_source_url((video.direct_download_url or '').strip())]
            data['episodes'].append({'id': episode.pk, 'season': episode.season.season_number,
                                     'number': episode.episode_number, 'videos': videos, 'download_options': downloads,
                                     'cover': file_url(episode.cover), 'duration': episode.duration,
                                     'description': getattr(episode, 'description_fa', '') or episode.description})
    return JsonResponse(data)


@private
@require_http_methods(['POST'])
def add_title_comment(request, kind, slug):
    import json

    try:
        body = json.loads(request.body)
        text = body['text'].strip()
        spoiler = body.get('is_spoiler', False)
        if not 1 <= len(text) <= 2000 or type(spoiler) is not bool:
            raise ValueError
    except (AttributeError, KeyError, TypeError, ValueError):
        return JsonResponse({'error': 'متن دیدگاه باید بین ۱ تا ۲۰۰۰ نویسه باشد.'}, status=400)
    item = title_object(kind, slug)
    item.comments.create(user=request.user, text=text, is_spoiler=spoiler)
    return JsonResponse({'message': 'دیدگاه ثبت شد و پس از تأیید نمایش داده می‌شود.'}, status=201)


@never_cache
@require_GET
def playback(request, kind, video_id):
    if kind == 'movie':
        video = get_object_or_404(MovieVideo.objects.select_related('movie', 'quality'), pk=video_id)
        item = video.movie
        target = {'movie_id': item.pk}
        route = 'movie:movie_direct_hls_playlist'
    elif kind == 'series':
        video = get_object_or_404(EpisodeVideo.objects.select_related('episode__season__series', 'quality'), pk=video_id)
        item = video.episode.season.series
        target = {'episode_id': video.episode_id}
        route = 'movie:series_direct_hls_playlist'
    else:
        raise Http404
    room_code = request.GET.get('room', '')
    room = None
    allowed = can_access_content(request.user, item)
    if room_code and kind == 'movie':
        from watchparty.models import MovieRoom
        from watchparty.services import can_watch_room
        room = get_object_or_404(MovieRoom, code=room_code, movie=item, is_closed=False)
        allowed = can_watch_room(request.user, room)
    if not allowed:
        return JsonResponse({'error': 'برای پخش وارد حساب دارای اشتراک شوید.',
                             'login_required': not request.user.is_authenticated},
                            status=403 if request.user.is_authenticated else 401)
    if not direct_url_usable(video):
        return JsonResponse({'error': 'این منبع فعلاً آمادهٔ پخش نیست.'}, status=410)
    from movie.views import _preferred_original_audio_index
    audio = _preferred_original_audio_index(video, request=request)
    position = 0
    if request.user.is_authenticated:
        from interactions.models import WatchHistory
        history = WatchHistory.objects.filter(user=request.user, **target).first()
        if history:
            position = history.watched_duration
    from urllib.parse import urlencode
    query = {'audio': audio}
    if room:
        query['room'] = room.code
    return JsonResponse({'url': request.build_absolute_uri(reverse(route, args=[video.pk])) + '?' + urlencode(query),
                         'title': content_title(item), 'target': target, 'position': position})


@private
@require_GET
def library(request):
    from interactions import services
    saved_movies = [card(x) for x in services.get_user_saved_movies(request.user)]
    saved_series = [card(x) for x in services.get_user_saved_series(request.user)]
    history = []
    for row in services.get_user_watch_history(request.user)[:100]:
        item = row.movie or (row.episode.season.series if row.episode else None)
        if item:
            history.append({**card(item), 'position': row.watched_duration, 'total': row.total_duration, 'snapshot': row.snapshot_url})
    return JsonResponse({'saved': saved_movies + saved_series, 'history': history})


@private
@require_GET
def settings(request):
    from accounts.models import UserDevice
    devices = UserDevice.objects.filter(user=request.user).order_by('-last_activity')[:50]
    return JsonResponse({'devices': [{'id': x.pk, 'name': x.device_name,
                                      'current': x.session_key == request.session.session_key}
                                     for x in devices]})


@private
@require_http_methods(['GET', 'POST'])
def rooms(request):
    from watchparty import services
    if request.method == 'POST':
        import json
        from django.utils import timezone
        from django.utils.dateparse import parse_datetime
        try:
            body = json.loads(request.body)
            starts_at = timezone.now()
            if body.get('starts_at'):
                starts_at = parse_datetime(body['starts_at'])
                if starts_at is None or timezone.is_naive(starts_at) or starts_at <= timezone.now():
                    raise ValueError('زمان شروع باید در آینده باشد.')
            room = services.create_room(request.user, body.get('movie_id'), body.get('title'),
                                        starts_at, is_public=body.get('public') is True)
        except (ValueError, TypeError, AttributeError) as error:
            return JsonResponse({'error': str(error)}, status=400)
        return JsonResponse({'code': room.code})
    def row(room):
        return {'code': room.code, 'title': room.display_title, 'status': room.status(),
                'cover': file_url(room.movie.cover), 'public': room.is_public,
                'starts_at': room.starts_at.isoformat(), 'is_host': room.host_id == request.user.pk,
                'host': room.host.get_full_name() or room.host.username}
    return JsonResponse({'mine': [row(x) for x in services.user_rooms(request.user)[:30]],
                         'public': [row(x) for x in services.public_rooms()[:30]],
                         'supports_scheduling': True})


@private
@require_GET
def room_detail(request, code):
    import time
    from watchparty.models import MovieRoom
    from watchparty import services
    room = get_object_or_404(MovieRoom.objects.select_related('movie', 'host', 'free_guest'), code=code)
    if room.is_closed:
        return JsonResponse({'error': 'این اتاق بسته شده است.'}, status=410)
    room.members.add(request.user)
    allowed = services.can_watch_room(request.user, room)
    videos = [{'id': x.pk, 'quality': x.quality.title}
              for x in room.movie.videos.select_related('quality').order_by('-quality__weight')
              if direct_url_usable(x)] if allowed else []
    return JsonResponse({'code': room.code, 'title': room.display_title,
                         'is_host': room.host_id == request.user.pk, 'can_watch': allowed,
                         'cover': file_url(room.movie.cover), 'starts_at': room.starts_at.isoformat(),
                         'host': room.host.full_name or room.host.username,
                         'videos': videos, 'state': room.state_dict(), 'server_ts': time.time()})


urlpatterns = [
    path('session/', session), path('home/', home),
    path('browser-sign-in/', browser_sign_in),
    path('browser-sign-in/finish/', browser_sign_in_finish, name='ios_browser_sign_in_finish'),
    path('browser-sign-in/redeem/', browser_sign_in_redeem),
    path('title/<str:kind>/<slug:slug>/', detail),
    path('title/<str:kind>/<slug:slug>/comments/', add_title_comment),
    path('playback/<str:kind>/<int:video_id>/', playback),
    path('library/', library), path('settings/', settings),
    path('rooms/', rooms), path('rooms/<str:code>/', room_detail),
]
