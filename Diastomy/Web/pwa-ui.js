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
  function landscape(item) {
    return '<a href="' + titleURL(item) + '" class="dm54-hcard" dir="ltr"><span class="dm54-landscape"><img src="' + media(item.banner || item.cover) +
      '" alt="' + esc(item.title) + '" loading="lazy"><span class="dm54-landscape-shade"></span><span class="dm54-landscape-brand"><img src="' + logo +
      '" alt=""></span></span><span class="dm54-hmeta"><strong>' + name(item) + '</strong><small class="dm54-hdetails"><span class="dm54-hgenres">' +
      genres(item) + '</span><span>' + esc(item.production_year) + '</span><span class="dm54-hscore">' + esc(item.imdb_rating || '') + star + '</span></small></span></a>';
  }
  function hero(items) {
    if (!items.length) return '';
    return '<section class="nyx-prime-hero" aria-label="فیلم‌ها و سریال‌های ویژه" dir="ltr"><ul class="nyx-prime-rail" tabindex="0">' +
      items.map((item, i) => '<li class="nyx-prime-slide"><a class="nyx-prime-card" href="' + titleURL(item) +
        '"><picture class="nyx-prime-picture"><img src="' + media(item.banner || item.cover) + '" alt="' + esc(item.title) +
        '" loading="' + (i < 2 ? 'eager' : 'lazy') + '" draggable="false"></picture><div class="nyx-prime-shade"></div><img class="nyx-prime-brand" src="' + logo +
        '" alt="Diastomy"><div class="nyx-prime-copy"><h2 dir="auto">' + name(item) + '</h2><div class="nyx-prime-meta">' + (item.age_limit != null ? '<span class="nyx-prime-age">+' + esc(item.age_limit) + '</span>' : '') + '<span class="nyx-prime-year">' +
        esc(item.production_year) + '</span><span class="nyx-prime-genres">' + genres(item) + '</span></div><div class="nyx-prime-trend"><b>' +
        (item.type === 'series' ? 'NEW SERIES' : 'NEW MOVIE') + '</b></div><div class="nyx-prime-premium"><span>' +
        (item.is_free ? 'تماشای رایگان' : 'included with premium') + '</span></div></div></a></li>').join('') +
      '</ul><div class="nyx-prime-dots">' + items.map((_, i) => '<button type="button" data-slide="' + i + '" aria-pressed="' + (i === 0) + '" aria-label="اسلاید ' + (i + 1) + '"></button>').join('') + '</div></section>';
  }
  function home(data, history = []) {
    const order = ['trending_movies','pwa_turkish_series','pwa_latest_movies','pwa_dubbed_movies','pwa_free_movies','pwa_latest_series','pwa_dubbed_series','pwa_free_series','pwa_recommended','animations'];
    const rails = (data.rails || []).map(r => ({...r, key: r.key || 'pwa_latest_movies'})).sort((a,b) => order.indexOf(a.key) - order.indexOf(b.key));
    const illustratedGenres = ['drama', 'adventure', 'fantasy', 'action', 'comedy', 'sci-fi', 'horror', 'documentary', 'animation'];
    const genreHTML = '<section class="dm54-genres"><div class="dm54-head"><h2>ژانرها</h2><a href="#/search">بیشتر</a></div><div class="dm54-genre-track">' +
      illustratedGenres.map(slug => '<a class="dm54-genre reference-genre" href="#/browse/all?genre=' + slug +
        '"><img loading="lazy" alt="" src="https://diastomy.top/pwa/genre-images/v1/' + slug + '/"><span>' +
        slug.toUpperCase() + '</span></a>').join('') + '</div></section>';
    const continueHTML = history.length ? '<section class="dm54-section dm54-horizontal-section"><div class="dm54-head"><h2>ادامه تماشا</h2><a href="#/library">بیشتر</a></div><div class="dm54-htrack reference-continue">' +
      history.slice(0, 12).map(item => {
        const percent = item.total > 0 ? Math.min(100, Math.max(0, Math.round(100 * item.position / item.total))) : 0;
        return '<div>' + landscape(item) + '<progress max="100" value="' + percent + '"></progress><small>' +
          Math.max(0, Math.ceil((item.total - item.position) / 60)) + ' دقیقه باقی مانده</small></div>';
      }).join('') + '</div></section>' : '';
    return hero(data.hero || []) + '<div class="dm-pwa-home-v54 dm-figma-home-v2">' +
      rails.filter(r => r.items.length).map(r => {
        const wide = r.key === 'pwa_free_movies';
        const link = '#/browse/' + (r.key.includes('series') ? 'series' : 'movie');
        return '<section class="dm54-section' + (wide ? ' dm54-free dm54-horizontal-section' : '') + '"><div class="dm54-head"><h2>' +
          esc(r.title) + '</h2><a href="' + link + '">بیشتر</a></div><div class="' + (wide ? 'dm54-htrack' : 'dm54-vtrack') + '">' +
          r.items.map(wide ? landscape : card).join('') + '</div></section>' + (r.key === 'trending_movies' ? genreHTML + continueHTML : '');
      }).join('') + (!rails.some(r => r.key === 'trending_movies' && r.items.length) ? genreHTML + continueHTML : '') + '</div>';
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
  function episodeCards(item, episodes) {
    return episodes.map(episode => {
      const video = (episode.videos || [])[0];
      const downloads = episode.download_options || [];
      const title = 'Season ' + esc(episode.season) + ' · Episode ' + esc(episode.number);
      const duration = Number(episode.duration);
      const time = duration > 0 ? [Math.floor(duration / 3600), Math.floor(duration / 60) % 60, duration % 60]
        .map((part,index) => index ? String(part).padStart(2,'0') : part).join(':') : '';
      return '<article class="reference-episode-card"><div class="reference-episode-head" dir="ltr"><button type="button" class="reference-episode-thumb"' +
        (video ? ' data-play="' + esc(video.id) + '" data-kind="series"' : ' disabled') + ' aria-label="' + title + '"><img src="' +
        media(episode.cover || item.banner || item.cover) + '" alt="" loading="lazy">' +
        (video ? '<span>' + PWA_SOURCE.detailPlay + '</span>' : '') + '</button><div><strong>' + title + '</strong>' +
        (time ? '<small>' + time + '</small>' : '') + '</div>' +
        (downloads.length ? '<details class="reference-episode-download"><summary aria-label="دانلود قسمت">' + PWA_SOURCE.detailDownload +
          '</summary><div class="reference-download-options">' + downloadOptions(downloads) + '</div></details>' : '') +
        '</div>' + (episode.description ? '<p dir="auto">' + esc(episode.description) + '</p>' : '') + '</article>';
    }).join('');
  }
  function detail(item, episodes) {
    const series = item.type === 'series';
    const trailers = (item.trailers || []).filter(trailer => trailer.url && media(trailer.url));
    const trailerButton = trailers.length ? '<button type="button" class="reference-trailer-play" data-trailer-index="0" aria-label="پخش تریلر">▶</button>' : '';
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
      (play ? '<span class="reference-quality">' + esc(play.quality) + '</span>' : '') +
      (item.comments ? '<span>' + item.comments.length + ' ♧</span>' : '') + '</div>' +
      '<div class="dm-film-buttons reference-film-actions" dir="ltr">' +
        (play ? '<button type="button" data-play="' + esc(play.id) + '" data-kind="' + (series ? 'series' : 'movie') + '">Play ' + PWA_SOURCE.detailPlay + '</button>' :
          '<button type="button" disabled>Play</button>') + download + '</div>' +
      (options.length ? '<div id="film-download-options" class="reference-download-options" hidden>' + downloadOptions(options) + '</div>' : '') +
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
      '<div data-detail-panel="comments"' + (item.type === 'series' ? ' hidden' : '') + '><h2>دیدگاه‌های ' + name(item) + '</h2>' +
      (item.comments || []).map(comment => comment.spoiler
        ? '<details class="spoiler-comment"><summary>دیدگاه حاوی اسپویل</summary><p>' + esc(comment.text) + '</p></details>'
        : '<p>' + esc(comment.text) + '</p>').join('') +
      '<p>' + (item.comments ? item.comments.length + ' دیدگاه' : 'دیدگاه‌ها هنوز در دسترس نیستند.') + '</p></div>' +
      '<div data-detail-panel="trailers" hidden>' + (trailers.length ? trailers.map((trailer, index) =>
        '<button type="button" data-trailer-index="' + index + '">▶ ' + esc(trailer.title || 'تریلر ' + (index + 1)) + '</button>').join('') :
        '<p>تریلر در دسترس نیست.</p>') + '</div>' +
      '<div data-detail-panel="similar" hidden><a class="button" href="#/browse/' + (item.type === 'series' ? 'series' : 'movie') + '">مشاهده آرشیو</a></div></div></article>';
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
      if (!(image instanceof HTMLImageElement) || !image.dataset.historyFallback) return;
      const fallback = image.dataset.historyFallback;
      delete image.dataset.historyFallback;
      if (image.getAttribute('src') !== fallback) image.src = fallback;
    }, true);
    document.getElementById('pwa-header').innerHTML = PWA_SOURCE.header;
    document.getElementById('pwa-nav').innerHTML = PWA_SOURCE.nav;
    document.getElementById('pwa-sprite').innerHTML = PWA_SOURCE.sprite;
    document.addEventListener('scroll', event => {
      const rail = event.target;
      if (!(rail instanceof Element) || !rail.matches('.nyx-prime-rail')) return;
      const active = Math.round(rail.scrollLeft / rail.clientWidth);
      rail.parentElement.querySelectorAll('[data-slide]').forEach(dot =>
        dot.setAttribute('aria-pressed', String(Number(dot.dataset.slide) === active)));
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
  return {card, home, historyCard, episodeCards, detail, account, auth, searchInput, install, page};
})();
