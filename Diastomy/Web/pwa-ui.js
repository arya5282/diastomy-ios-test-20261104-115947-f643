/* Local rendering adapters for the supplied Django PWA components. */
window.PWA = (() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const titleURL = item => '#/title/' + encodeURIComponent(item.type || 'movie') + '/' + encodeURIComponent(item.slug);
  const media = value => {
    if (!value) return '/static/public/assets/img/poster-unavailable-v1.svg';
    try { const url = new URL(value, 'https://diastomy.top'); return url.protocol === 'https:' ? esc(url.href) : ''; }
    catch (_) { return ''; }
  };
  const logo = '/static/public/assets/icons/diastomy-logo.svg';
  const star = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21 7 14.2 2 9.3l6.9-1L12 2Z"/></svg>';
  const genres = item => (item.genres || []).map(g => esc(typeof g === 'string' ? g : g.name)).slice(0, 3).join(' · ');
  const name = item => esc(item.english_title_full || item.title);
  function card(item) {
    return '<a href="' + titleURL(item) + '" class="dm54-vcard" dir="ltr"><span class="dm54-poster">' +
      '<img class="dm54-poster-img" src="' + media(item.cover) + '" alt="' + esc(item.title) + '" loading="lazy" decoding="async">' +
      (item.imdb_rating ? '<span class="dm54-rating"><b>' + esc(item.imdb_rating) + '</b>' + star + '</span>' : '') +
      '<span class="dm54-poster-brand" aria-hidden="true"><svg class="dmf54-poster-mark" width="28" height="24" viewBox="0 0 28 24"><use href="#dm-poster-mark-v1"/></svg></span>' +
      '</span><span class="dm54-vmeta"><strong>' + name(item) + '</strong><small class="dm54-old-genres">' + genres(item) + '</small></span></a>';
  }
  function actorPage() {
    return '<header class="dm-actor-header" dir="ltr"><a class="dm-actor-back" href="#/actors" aria-label="بازگشت">' +
      PWA_SOURCE.actorBack + '</a><h1>Actors</h1><button class="dm-actor-menu" type="button" data-local-menu aria-label="منو">' +
      PWA_SOURCE.actorMenu + '</button></header><div class="dm-actor-page" id="actors-data"><div class="loading"></div></div>';
  }
  function actorProfile(data, slug) {
    const actor = data.actor;
    const films = data.filmography.map(item => '<a class="dm-actor-film" href="' + titleURL(item) + '"><div class="dm-actor-poster"><img src="' +
      media(item.cover) + '" alt="' + name(item) + '" loading="lazy" width="180" height="240">' +
      (item.imdb_rating ? '<span class="dm-actor-rating" dir="ltr">' + esc(item.imdb_rating) + star + '</span>' : '') +
      '<span class="dm-actor-mark" aria-hidden="true"><img src="' + logo + '" alt=""></span></div><h3 dir="ltr">' +
      name(item) + '</h3><p class="dm-actor-genres" dir="ltr">' + (item.genres || []).map(esc).join(', ') + '</p></a>').join('');
    const href = '#/actor/' + encodeURIComponent(slug) + '/';
    return '<section class="dm-actor-profile" aria-label="معرفی بازیگر"><img class="dm-actor-photo" src="' +
      (actor.photo ? media(actor.photo) : '/static/public/assets/avatars/default/avatar-04.svg') + '" alt="' + esc(actor.name) + '"><div class="dm-actor-bio"><h2 dir="auto">' + esc(actor.name) +
      '</h2><p id="dm-actor-facts" dir="rtl">' + esc(actor.summary || actor.bio) +
      '</p><button type="button" class="dm-actor-more" aria-expanded="false" aria-controls="dm-actor-facts" hidden>بیشتر</button></div></section>' +
      '<div class="reference-series-preferences dm-actor-preferences" dir="rtl"><button type="button" data-follow="person" data-id="' +
      esc(actor.id) + '" aria-pressed="false" disabled>' + PWA_SOURCE.detailFollow + 'دنبال‌کردن</button>' +
      '<button type="button" id="series-spoiler" aria-pressed="false" disabled>' + PWA_SOURCE.detailSpoiler + 'بدون اسپویل</button></div>' +
      '<h2 class="dm-actor-heading">فیلم‌های بازیگر</h2><div class="dm-actor-grid" dir="rtl">' +
      (films || '<p class="dm-actor-empty">اثری برای این بازیگر یافت نشد.</p>') + '</div>' +
      (data.total_pages > 1 ? '<nav class="dm-actor-pagination" dir="rtl" aria-label="صفحه‌های آثار">' +
        (data.has_previous ? '<a href="' + href + (data.page - 1) + '">قبلی</a>' : '') + '<span>' + esc(data.page) + ' / ' +
        esc(data.total_pages) + '</span>' + (data.has_next ? '<a href="' + href + (data.page + 1) + '">بعدی</a>' : '') + '</nav>' : '');
  }
  function landscape(item) {
    return '<a href="' + titleURL(item) + '" class="dm54-hcard" dir="ltr"><span class="dm54-landscape"><img src="' + media(item.banner || item.cover) +
      '" alt="' + esc(item.title) + '" loading="lazy"><span class="dm54-landscape-shade"></span><span class="dm54-landscape-brand"><img src="' + logo +
      '" alt=""></span></span><span class="dm54-hmeta"><strong>' + name(item) + '</strong><small class="dm54-hdetails"><span class="dm54-hgenres">' +
      genres(item) + '</span><span>' + esc(item.production_year) + '</span><span class="dm54-hscore">' + esc(item.imdb_rating || '') + star + '</span></small></span></a>';
  }
  function hero(items) {
    if (!items.length) return '';
    const dot = '<i class="nyx-prime-genre-dot" aria-hidden="true"></i>';
    return '<section class="nyx-prime-hero" aria-label="فیلم‌ها و سریال‌های ویژه" dir="ltr"><ul class="nyx-prime-rail" tabindex="0">' +
      items.map((item, i) => {
        const series = item.type === 'series';
        const age = item.hero_age || (item.age_limit != null ? '+' + item.age_limit : '');
        const heroGenres = (item.genres || []).slice(0,3).map(g => '<span>' + esc(typeof g === 'string' ? g : g.name) + '</span>').join('');
        const fallback = media(item.banner || item.cover);
        return '<li class="nyx-prime-slide"><a class="nyx-prime-card" href="' + titleURL(item) +
          '"><picture class="nyx-prime-picture"><img src="' + (item.hero_artwork ? media(item.hero_artwork) : fallback) +
          '" data-hero-fallback="' + fallback + '" alt="' + esc(item.title) + '" loading="' + (i < 2 ? 'eager' : 'lazy') +
          '"' + (i === 0 ? ' fetchpriority="high"' : '') + ' decoding="async" draggable="false"></picture>' +
          '<div class="nyx-prime-shade"></div><img class="nyx-prime-brand" src="' + logo + '" alt="Diastomy">' +
          '<div class="nyx-prime-copy"><h2 dir="auto">' + name(item) + '</h2><div class="nyx-prime-meta">' +
          (age ? '<span class="nyx-prime-age">' + esc(age) + '</span>' : '') +
          (item.hero_duration ? '<span class="nyx-prime-duration">' + esc(item.hero_duration) + '</span>' : '') +
          '<span class="nyx-prime-year">' + esc(item.production_year) + '</span>' +
          (heroGenres ? '<span class="nyx-prime-genres">' + dot + '<span class="nyx-prime-genre-names">' + heroGenres + '</span>' + dot + '</span>' : '') +
          '</div><div class="nyx-prime-trend"><b>' + (item.hero_trending ? 'TRENDING' : series ? 'NEW SERIES' : 'NEW MOVIE') +
          '</b>' + (series ? '<span>all episodes available</span>' : '') + '</div><div class="nyx-prime-premium">' +
          (!item.is_free ? '<span class="nyx-prime-check" aria-hidden="true">' + PWA_SOURCE.heroPremium + '</span>' : '') +
          '<span>' + (item.is_free ? 'تماشای رایگان' : 'included with premium') + '</span></div></div></a></li>';
      }).join('') + '</ul><div class="nyx-prime-dots">' + items.map((_, i) =>
        '<button type="button" data-slide="' + i + '" data-distance="' + Math.min(i,3) + '" aria-pressed="' + (i === 0) +
        '" aria-label="اسلاید ' + (i + 1) + '"></button>').join('') + '</div></section>';
  }
  function home(data, history = []) {
    const order = [
      'trending_movies', 'genres', 'continue_watching', 'pwa_turkish_series',
      'pwa_latest_movies', 'pwa_latest_series', 'pwa_dubbed_movies', 'pwa_free_movies',
      'pwa_dubbed_series', 'pwa_free_series', 'pwa_recommended', 'animations'
    ];
    const sections = new Map();
    const illustratedGenres = ['drama', 'adventure', 'fantasy', 'action', 'comedy', 'sci-fi', 'horror', 'documentary', 'animation'];
    const genreHTML = '<section class="dm54-genres"><div class="dm54-head"><h2>ژانرها</h2><a href="#/search">بیشتر</a></div><div class="dm54-genre-track">' +
      illustratedGenres.map(slug => '<a class="dm54-genre reference-genre" href="#/browse/all?genre=' + slug +
        '"><img loading="lazy" alt="" src="https://diastomy.top/pwa/genre-images/v1/' + slug + '/"><span>' +
        slug.toUpperCase() + '</span></a>').join('') + '</div></section>';
    const continueHTML = history.length ? '<section class="dm54-section reference-continue-section"><div class="dm54-head"><h2>ادامه تماشا</h2><a href="#/library?tab=history">بیشتر</a></div>' +
      '<div class="reference-continue">' + history.slice(0, 12).map(item => historyCard(item)).join('') + '</div></section>' : '';
    sections.set('genres', genreHTML);
    sections.set('continue_watching', continueHTML);
    for (const rail of data.rails || []) {
      if (!rail.items.length) continue;
      const key = rail.key || 'pwa_latest_movies';
      const wide = key === 'pwa_free_movies';
      const link = '#/browse/' + (key.includes('series') ? 'series' : 'movie');
      sections.set(key, '<section class="dm54-section' + (wide ? ' dm54-free dm54-horizontal-section' : '') +
        '"><div class="dm54-head"><h2>' + esc(rail.title) + '</h2><a href="' + link +
        '">بیشتر</a></div><div class="' + (wide ? 'dm54-htrack' : 'dm54-vtrack') + '">' +
        rail.items.map(wide ? landscape : card).join('') + '</div></section>');
    }
    return hero(data.hero || []) + '<div class="dm-pwa-home-v54 dm-figma-home-v2">' +
      order.map(key => sections.get(key) || '').join('') +
      [...sections].filter(([key]) => !order.includes(key)).map(([, html]) => html).join('') + '</div>';
  }
  function historyCard(item) {
    const progress = item.total > 0 ? Math.min(100, Math.max(0, Math.round(100 * item.position / item.total))) : 0;
    const remaining = Math.max(0, Math.floor((item.total || 0) - (item.position || 0)));
    const time = Math.floor(remaining / 60) + ':' + String(remaining % 60).padStart(2, '0');
    return '<article class="library-history-card"><a class="library-history-thumb" href="' + titleURL(item) + '" aria-label="ادامه تماشا">' +
      '<img src="' + media(item.snapshot || item.banner || item.cover) + '" data-history-fallback="' + media(item.banner || item.cover) + '" alt="' + esc(item.title) + '" loading="lazy">' +
      '<svg class="local-history-mark" viewBox="0 0 28 24" aria-hidden="true"><use href="#dm-poster-mark-v1"/></svg><progress class="local-library-progress" max="100" value="' + progress + '"></progress></a><div class="library-history-meta"><strong>' +
      name(item) + '</strong><small dir="ltr">' + time + ' باقی‌مانده</small></div></article>';
  }
  function downloadOptions(options) {
    return options.map(option => '<button type="button" data-download="' + esc(option.id) + '">' + esc(option.quality) + '</button>').join('');
  }
  function episodeCards(item, episodes, watchState, slug) {
    return episodes.map(episode => {
      const video = (episode.videos || [])[0];
      const downloads = episode.download_options || [];
      const title = 'Season ' + esc(episode.season) + ' · Episode ' + esc(episode.number);
      const watchPath = '/movie/series/' + slug + '/season/' + episode.season + '/episode/' + episode.number + '/watch/';
      const seen = watchState[watchPath]?.seen ? '<svg class="reference-episode-seen" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.6" role="img" aria-label="دیده‌شده"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg>' : '';
      const duration = Number(episode.duration);
      const time = duration > 0 ? [Math.floor(duration / 3600), Math.floor(duration / 60) % 60, duration % 60]
        .map((part,index) => index ? String(part).padStart(2,'0') : part).join(':') : '';
      return '<article class="reference-episode-card"><div class="reference-episode-head" dir="ltr"><button type="button" class="reference-episode-thumb"' +
        (video ? ' data-play="' + esc(video.id) + '" data-kind="series"' : ' disabled') + ' aria-label="' + title + '"><img src="' +
        media(episode.cover || item.banner || item.cover) + '" alt="" loading="lazy">' +
        (video ? '<span>' + PWA_SOURCE.detailPlay + '</span>' : '') + '</button><div><strong>' + title + seen + '</strong>' +
        (time ? '<small>' + time + '</small>' : '') + '</div>' +
        (downloads.length ? '<details class="reference-episode-download"><summary aria-label="دانلود قسمت">' + PWA_SOURCE.detailDownload +
          '</summary><div class="reference-download-options">' + downloadOptions(downloads) + '</div></details>' : '') +
        '</div>' + (episode.description ? '<p dir="auto">' + esc(episode.description) + '</p>' : '') + '</article>';
    }).join('');
  }
  function filmDownloadDialog(options, series) {
    const variants = ['subbed', 'dubbed'];
    const panels = variants.map(variant => {
      const dubbed = variant === 'dubbed';
      const rows = options.filter(option => (option.variant || 'subbed') === variant).map(option =>
        '<article class="film-download-card"><div class="film-download-meta"><strong dir="ltr">' +
        esc(option.quality) + (!dubbed && !series ? ' · زیرنویس فارسی' : '') +
        '</strong>' + (option.size ? '<small dir="ltr">' + esc(option.size) + '</small>' : '') + '</div>' +
        (option.audio ? '<small>' + esc(option.audio) + '</small>' : '') +
        '<button type="button" data-download="' + esc(option.id) + '" data-variant="' + variant + '">' +
        (dubbed ? 'دانلود نسخه دوبله · ' + esc(option.quality) : 'دانلود با لینک مستقیم ↓') + '</button></article>');
      return '<section data-download-panel="' + variant + '"' + (dubbed ? ' hidden' : '') + '>' +
        (rows.join('') || '<p class="film-download-empty">لینک دانلود این نسخه در دسترس نیست.</p>') + '</section>';
    });
    return '<dialog id="film-download-options" class="film-download-dialog" dir="rtl" aria-labelledby="film-download-title">' +
      '<form method="dialog"><button class="film-download-close" aria-label="بستن">×</button></form>' +
      '<h2 id="film-download-title">لینک‌های دانلود</h2>' +
      (series ? '' : '<div class="film-download-tabs"><button type="button" data-download-tab="subbed" aria-pressed="true">نسخه زیرنویس</button><button type="button" data-download-tab="dubbed" aria-pressed="false">نسخه دوبله</button></div>') +
      panels.join('') + '</dialog>';
  }

  function detail(item, episodes) {
    const series = item.type === 'series';
    const trailers = (item.trailers || []).filter(trailer => trailer.url && media(trailer.url));
    const trailerButton = trailers.length ? '<button type="button" class="reference-trailer-play" data-trailer-index="0" aria-label="پخش تریلر">' + PWA_SOURCE.detailTrailer + '</button>' : '';
    const episodeList = item.episodes || [];
    const firstEpisode = episodeList.find(episode => episode.videos?.length);
    const play = series ? firstEpisode?.videos[0] : (item.videos || [])[0];
    const options = series ? (episodeList.find(episode => episode.download_options?.length)?.download_options || []) : (item.download_options || []);
    const download = '<button type="button" class="reference-download" id="film-download"' +
      (options.length ? '' : ' disabled') + '>Download ' + PWA_SOURCE.detailDownload + '</button>';
    const cast = (item.actors || []).slice(0, 6);
    return '<article class="movie-detail-shell"><div class="dm-film-topbar" dir="ltr"><a href="#/home" aria-label="بازگشت"><svg viewBox="0 0 24 24"><path d="M20 12H4m7-7-7 7 7 7"/></svg></a><button id="bookmark" aria-label="ذخیره در لیست من"><svg viewBox="0 0 24 24"><path d="M12 21S2 15 2 8a5.5 5.5 0 0 1 10-3 5.5 5.5 0 0 1 10 3c0 7-10 13-10 13Z"/></svg></button></div>' +
      '<div class="movie-detail-hero"><img src="' + media(item.hero_cover || item.banner || item.cover) + '" alt="' + esc(item.title) + '">' + trailerButton + '</div>' +
      '<div class="dm-film-reference-info"><div class="dm-film-title-row"><h1>' + name(item) + '</h1><img src="' + logo + '" alt="Diastomy"></div>' +
      '<div class="dm-film-meta" dir="ltr">' + (series ? '<span>' + new Set(episodeList.map(episode => episode.season)).size + ' Season</span>' : item.duration ? '<span>' + esc(item.duration) + ' Min</span>' : '') + '<span>' + esc(item.production_year) + '</span><span>' + genres(item) + '</span></div>' +
      '<div class="dm-film-media">' + (item.age_limit != null ? '<span class="reference-age">' + esc(item.age_limit) + '</span>' : '') +
      (play ? '<button type="button" data-play="' + esc(play.id) + '" data-kind="' + (series ? 'series' : 'movie') + '" class="reference-media-hd" aria-label="پخش HD">' + PWA_SOURCE.detailHD + '</button>' : '') +
      '<button type="button" id="film-comments" aria-label="دیدگاه‌ها">' + esc(item.comment_count ?? (item.comments || []).length) + PWA_SOURCE.detailComments + '</button>' +
      (!series && options.some(option => option.variant === 'dubbed') ? '<button type="button" id="film-audio" aria-label="نسخه دوبله">' + PWA_SOURCE.detailAudio + '</button>' : '') +
      (play ? '<span class="reference-media-dolby" role="img" aria-label="Dolby Vision">' + PWA_SOURCE.detailDolby + '</span>' : '') + '</div>' +
      '<div class="dm-film-buttons reference-film-actions" dir="ltr">' +
        (play ? '<button type="button" data-play="' + esc(play.id) + '" data-kind="' + (series ? 'series' : 'movie') + '">Play ' + PWA_SOURCE.detailPlay + '</button>' :
          '<button type="button" disabled>Play</button>') + download + '</div>' +
      (options.length ? filmDownloadDialog(options, series) : '') +
      (series ? '<div class="reference-series-preferences">' +
        (item.id ? '<button type="button" data-follow="series" data-id="' + esc(item.id) + '" disabled>' + PWA_SOURCE.detailFollow + 'دنبال‌کردن</button>' : '') +
        (item.director_id ? '<button type="button" data-follow="person" data-id="' + esc(item.director_id) + '" disabled>' + PWA_SOURCE.detailFollow + 'دنبال‌کردن کارگردان</button>' : '') +
        '<button type="button" id="series-spoiler" disabled>' + PWA_SOURCE.detailSpoiler + 'بدون اسپویل</button></div>' : '') +
      '<section class="reference-film-summary"><h2>' + (series ? 'خلاصه سریال' : 'خلاصه فیلم') + '</h2><p class="dm-film-description" dir="auto">' + esc(item.description) +
      '</p><div class="actions reference-summary-actions"></div></section><section class="reference-film-cast"><h2>بازیگران</h2><div class="rail reference-cast">' +
      cast.map(a => '<a class="person" href="#/actor/' + encodeURIComponent(a.slug) + '"><img src="' + media(a.photo) + '" alt="' + esc(a.name) + '"><p>' + esc(a.name) + '</p></a>').join('') +
      '</div></section><div class="reference-detail-tabs" aria-label="بخش‌های جزئیات">' +
      '' + (item.type === 'series' ? '<button type="button" data-detail-tab="episodes" aria-pressed="true">قسمت‌ها</button>' : '') + '<button type="button" data-detail-tab="comments" aria-pressed="' + (item.type !== 'series') + '">دیدگاه‌ها</button>' +
      '<button type="button" data-detail-tab="trailers" aria-pressed="false">تریلرها</button>' +
      '<button type="button" data-detail-tab="similar" aria-pressed="false">مشابه</button></div>' +
      (item.type === 'series' ? '<div data-detail-panel="episodes">' + episodes + '</div>' : '') +
      '<div data-detail-panel="comments"' + (item.type === 'series' ? ' hidden' : '') + '><div class="local-comments-head"><h2>دیدگاه‌های ' +
      name(item) + '</h2><small>' + esc(item.comment_count ?? (item.comments || []).length) + ' دیدگاه</small></div>' +
      '<form id="title-comment"><label class="local-comment-spoiler"><input type="checkbox" name="spoiler"> این نظر حاوی اسپویل است</label>' +
      '<div class="local-comment-compose"><textarea name="text" rows="1" aria-label="دیدگاه" placeholder="نظرت رو اینجا بنویس ..." maxlength="2000" required></textarea>' +
      '<button type="submit" aria-label="ارسال دیدگاه"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><path d="M21 3 3 10l8 3 3 8 7-18Z"/><path d="m11 13 10-10"/></svg></button></div>' +
      '<p id="title-comment-status" role="status"></p></form>' +
      (item.comments || []).map(comment => '<article class="nd-comment' + (comment.spoiler ? ' spoiler-comment' : '') +
        '"><header><strong>' + esc(comment.author) + '</strong>' +
        (comment.created_at ? '<time>' + esc(new Date(comment.created_at).toLocaleDateString('fa-IR')) + '</time>' : '') + '</header>' +
        (comment.spoiler ? '<details><summary>دیدگاه حاوی اسپویل</summary><p>' + esc(comment.text) + '</p></details>' :
          '<p>' + esc(comment.text) + '</p>') + '</article>').join('') + '</div>' +
      '<div data-detail-panel="trailers" hidden>' + (trailers.length ? trailers.map((trailer, index) =>
        '<button type="button" data-trailer-index="' + index + '">▶ ' + esc(trailer.title || 'تریلر ' + (index + 1)) + '</button>').join('') :
        '<p>تریلر در دسترس نیست.</p>') + '</div>' +
      '<div data-detail-panel="similar" hidden>' + ((item.similar || []).length ?
        '<div class="local-similar-grid">' + item.similar.map(card).join('') + '</div>' :
        '<a class="button" href="#/browse/' + (item.type === 'series' ? 'series' : 'movie') + '">مشاهده آرشیو</a>') + '</div></div></article>';
  }
  function account(user, viewing, back) {
    const watchTime = viewing ? '<a class="dm-viewing-summary" href="#/library?tab=history"><span class="dm-viewing-icon">' +
      PWA_SOURCE.watchIcon + '</span><span class="dm-viewing-copy"><small>مجموع زمان تماشای شما</small><strong>' +
      esc(viewing.hours) + ' ساعت و ' + esc(viewing.minutes) + ' دقیقه</strong></span>' + PWA_SOURCE.watchChevron + '</a>' : '';
    const identity = (user.avatar ? '<img class="reference-profile-avatar" src="' + media(user.avatar) + '" alt="">' : '') +
      '<div><strong>' + esc(user.name) + '</strong><small dir="ltr">' + esc(user.phone || user.username) + '</small>' +
      '<div class="local-subscription-line"><span class="reference-subscription-badge">' + (user.subscribed ? 'اشتراک فعال' : 'بدون اشتراک فعال') + '</span>' +
      (user.subscription_days != null ? '<small>' + esc(user.subscription_days) + ' روز باقی مانده</small>' : '') + '</div></div>';
    return '<div id="dm-app-menu" class="dm-app-menu" open><div class="dm-app-menu-shell"><div class="dm-app-menu-top">' +
      '<div class="ar-menu-heading"><h1>پروفایل کاربری</h1><img src="' + logo + '" alt="Diastomy"></div>' +
      '<a class="dm-app-menu-close" href="' + esc(back) + '" aria-label="بازگشت"><svg viewBox="0 0 24 24"><path d="M20 12H4m7-7-7 7 7 7"/></svg></a></div>' +
      '<div class="dm-app-menu-profile">' + identity + '</div>' + watchTime + '<div class="dm-app-menu-nav">' + PWA_SOURCE.accountRows +
      '</div><button id="logout" type="button">خروج از حساب کاربری ↗</button>' +
      '<footer class="reference-profile-footer"><img src="' + logo + '" alt="Diastomy"><p>برای مطلع شدن از آخرین اخبار و به‌روزرسانی‌ها،<br>دیاستومی را در شبکه‌های اجتماعی دنبال کنید.</p>' +
      PWA_SOURCE.accountSocial + '</footer></div></div>';
  }
  function auth(title, body) {
    return '<div id="dm-auth-reference"><div class="dm-auth-shell"><div class="dm-auth-logo"><img src="' + logo +
      '" alt="Diastomy"></div><div class="dm-auth-step"><div class="dm-auth-card"><a class="reference-auth-back" href="#/home">' + PWA_SOURCE.authBack + '<span>Back</span></a><h1 dir="auto">' + esc(title) + '</h1>' + body +
      '</div></div></div></div>';
  }
  function searchInput(query) {
    const header = document.getElementById('pwa-header');
    const button = header.querySelector('.dmf3-search');
    const form = document.createElement('form');
    form.className = 'dmf3-search reference-search-form';
    form.innerHTML = '<button type="submit" aria-label="جست‌وجو"></button><input type="search" name="q" placeholder="Search titles, genres…" aria-label="جست‌وجو">';
    form.querySelector('button').append(button.querySelector('svg').cloneNode(true));
    form.elements.q.value = query;
    form.onsubmit = event => {
      event.preventDefault();
      const term = form.elements.q.value.trim();
      location.hash = term ? '#/search?q=' + encodeURIComponent(term) : '#/search';
    };
    button.replaceWith(form);
  }
  function install() {
    document.addEventListener('error', event => {
      const image = event.target;
      if (!(image instanceof HTMLImageElement)) return;
      const fallback = image.dataset.historyFallback || image.dataset.heroFallback;
      if (!fallback) return;
      delete image.dataset.historyFallback;
      delete image.dataset.heroFallback;
      if (image.getAttribute('src') !== fallback) image.src = fallback;
    }, true);
    document.getElementById('pwa-header').innerHTML = PWA_SOURCE.header;
    document.getElementById('pwa-nav').innerHTML = PWA_SOURCE.nav;
    installFooterSwipe(document.getElementById('dm-app-bottom-nav'));
    document.getElementById('pwa-sprite').innerHTML = PWA_SOURCE.sprite;
    document.addEventListener('scroll', event => {
      const rail = event.target;
      if (!(rail instanceof Element) || !rail.matches('.nyx-prime-rail')) return;
      const active = Math.round(rail.scrollLeft / rail.clientWidth);
      rail.parentElement.querySelectorAll('[data-slide]').forEach(dot => {
        const distance = Math.abs(Number(dot.dataset.slide) - active);
        dot.setAttribute('aria-pressed', String(distance === 0));
        dot.dataset.distance = Math.min(distance,3);
      });
    }, true);
    document.addEventListener('click', event => {
      if (event.target.closest('[data-local-menu]')) {
        PWA.accountBack = location.hash || '#/home';
        location.hash = '#/account';
      }
      if (event.target.closest('[data-local-search]')) location.hash = '#/search';
      const tab = event.target.closest('[data-detail-tab]');
      if (tab) {
        const article = tab.closest('article');
        article.querySelectorAll('[data-detail-tab]').forEach(button => button.setAttribute('aria-pressed', String(button === tab)));
        article.querySelectorAll('[data-detail-panel]').forEach(panel => { panel.hidden = panel.dataset.detailPanel !== tab.dataset.detailTab; });
      }
      const dot = event.target.closest('[data-slide]');
      if (dot) {
        const slide = document.querySelectorAll('.nyx-prime-slide')[Number(dot.dataset.slide)];
        if (slide) slide.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      }
    });
  }
  function page(name) {
    document.getElementById('pwa-header').innerHTML = PWA_SOURCE.header;
    document.body.dataset.page = name === 'library' ? 'my-library' : name === 'browse' ? 'archive-reference' : name === 'home' || name === 'search' ? name : 'local-' + name;
    document.getElementById('pwa-header').hidden = ['login','otp','register','forgot','reset','account','title','browse','library','settings','notifications','support','subscription','rooms','room','about','actor','actors','profile','payments'].includes(name);
    const slot = ({home:'home',rooms:'room',room:'room',search:'search',browse:'search',library:'movies'})[name];
    document.querySelectorAll('[data-nav-slot]').forEach(link => {
      if (link.dataset.navSlot === slot) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }
  function installFooterSwipe(nav) {
    let start;
    let suppressClick = false;
    nav.addEventListener('pointerdown', event => {
      if (!event.isPrimary || event.button !== 0) return;
      suppressClick = false;
      start = event.pointerType === 'touch' ? {id:event.pointerId, x:event.clientX, y:event.clientY} : undefined;
    });
    nav.addEventListener('pointercancel', event => {
      if (start?.id === event.pointerId) start = undefined;
    });
    nav.addEventListener('pointerup', event => {
      if (start?.id !== event.pointerId) return;
      const dx = event.clientX - start.x;
      const dy = event.clientY - start.y;
      start = undefined;
      if (Math.abs(dx) < 28 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
      suppressClick = true;
      const links = [...nav.querySelectorAll('[data-nav-slot]')];
      const current = links.findIndex(link => link.getAttribute('aria-current') === 'page');
      const next = current < 0 ? (dx > 0 ? 0 : links.length - 1) : current + Math.sign(dx);
      const link = links[next];
      if (link) location.hash = link.hash;
    });
    nav.addEventListener('click', event => {
      if (!suppressClick || event.detail === 0) return;
      suppressClick = false;
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
    nav.addEventListener('contextmenu', event => {
      if (start) event.preventDefault();
    });
  }
  return {card, actorPage, actorProfile, home, historyCard, episodeCards, detail, account, auth, searchInput, install, page};
})();
