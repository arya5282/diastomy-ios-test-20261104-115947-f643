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
        data = {
            'id': user.pk, 'name': user.get_full_name() or user.username,
            'username': user.username, 'avatar': user.avatar_src,
            'phone': str(getattr(user, 'phone', '') or ''),
            'subscribed': user.has_active_subscription or user.is_staff,
            'language': user.preferred_language,
            'quality': user.preferred_quality,
        }
    return JsonResponse({'csrf': get_token(request), 'user': data, 'api_version': 1})


@require_GET
def home(request):
    # Reuse the same editorial rails and order as the current PWA.
    from core.views import _home_public_context
    from django.core.cache import cache
    from django.utils.translation import get_language
    key = 'mobile-app-home:v2:' + (get_language() or 'fa')
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
            'hero': [card(x) for x in context['hero_items']],
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
    data['actors'] = [{'slug': a.slug, 'name': a.name, 'photo': file_url(a.photo)}
                      for a in item.actors.all()[:30]]
    data['comments'] = [
        {'text': comment.text, 'spoiler': comment.is_spoiler}
        for comment in item.comments.filter(is_approved=True, parent__isnull=True).order_by('-pk')[:30]
    ]
    # Only public metadata here: this response can be retained offline.
    # Media links and entitlement are always obtained afresh from playback().
    if kind == 'movie':
        videos = item.videos.select_related('quality').order_by('-quality__weight')
        data['videos'] = [{'id': v.pk, 'quality': v.quality.title}
                          for v in videos if direct_url_usable(v)]
    else:
        episodes = Episode.objects.filter(season__series=item).select_related('season').prefetch_related('videos__quality').order_by('season__season_number', 'episode_number')
        data['episodes'] = []
        for episode in episodes:
            videos = [{'id': v.pk, 'quality': v.quality.title}
                      for v in episode.videos.all() if direct_url_usable(v)]
            if videos:
                data['episodes'].append({'id': episode.pk, 'season': episode.season.season_number,
                                         'number': episode.episode_number, 'videos': videos})
    return JsonResponse(data)


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
            history.append({**card(item), 'position': row.watched_duration, 'total': row.total_duration})
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
        try:
            body = json.loads(request.body)
            room = services.create_room(request.user, body.get('movie_id'), body.get('title'),
                                        timezone.now(), is_public=body.get('public') is True)
        except (ValueError, TypeError, AttributeError) as error:
            return JsonResponse({'error': str(error)}, status=400)
        return JsonResponse({'code': room.code})
    def row(room):
        return {'code': room.code, 'title': room.display_title, 'status': room.status()}
    return JsonResponse({'mine': [row(x) for x in services.user_rooms(request.user)[:30]],
                         'public': [row(x) for x in services.public_rooms()[:30]]})


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
                         'videos': videos, 'state': room.state_dict(), 'server_ts': time.time()})


urlpatterns = [
    path('session/', session), path('home/', home),
    path('title/<str:kind>/<slug:slug>/', detail),
    path('playback/<str:kind>/<int:video_id>/', playback),
    path('library/', library), path('settings/', settings),
    path('rooms/', rooms), path('rooms/<str:code>/', room_detail),
]
