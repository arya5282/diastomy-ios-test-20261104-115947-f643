/* Bundled client. No remote HTML, JavaScript, stylesheet or CDN is loaded. */
(function () {
  'use strict';
  const app = document.getElementById('app');
  const state = { user: null, sessionKnown: false, checkingSession: true, nextAfterLogin: '#/home', sequence: 0, online: true };
  const SERVER = 'https://diastomy.top';
  const $ = (s) => document.querySelector(s);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const enc = encodeURIComponent;
  const number = n => new Intl.NumberFormat('fa').format(n || 0);
  const titlePath = x => '#/title/' + enc(x.type) + '/' + enc(x.slug);
  function imageURL(path) {
    if (!path) return '';
    try { const u = new URL(path, SERVER); return u.protocol === 'https:' ? u.href : ''; } catch (_) { return ''; }
  }
  function image(path, cls, alt) {
    const url = imageURL(path);
    return url ? '<img src="' + esc(url) + '" class="' + esc(cls || '') + '" alt="' + esc(alt || '') + '" loading="lazy">' : '';
  }
  function connection(online) {
    state.online = online;
    $('#connection').hidden = online;
  }
  function toast(message) {
    const el = $('#toast'); el.textContent = message; el.hidden = false;
    clearTimeout(toast.timer); toast.timer = setTimeout(() => { el.hidden = true; }, 5000);
  }
  async function native(body) {
    if (!window.webkit || !window.webkit.messageHandlers.native) throw new Error('این صفحه باید داخل اپ iOS اجرا شود.');
    return window.webkit.messageHandlers.native.postMessage(body);
  }
  const publicRefresh = new Map();
  async function api(path, options) {
    const opts = options || {};
    const key = 'dm-public-v2:' + path;
    if (opts.cache && !opts.networkOnly) {
      let saved;
      try { saved = JSON.parse(localStorage.getItem(key)); } catch (_) {}
      if (saved && saved.data) {
        // A tab must never wait for a network timeout to show its saved content.
        if (Date.now() - saved.time > 15000 && !publicRefresh.has(path)) {
          const hash = location.hash;
          const sequence = state.sequence;
          const refresh = api(path, { cache: true, networkOnly: true }).then(data => {
            if (state.sequence === sequence && location.hash === hash &&
                JSON.stringify(data) !== JSON.stringify(saved.data)) route();
          }).catch(() => {}).finally(() => publicRefresh.delete(path));
          publicRefresh.set(path, refresh);
        }
        return saved.data;
      }
    }
    let response;
    try { response = await native({ action: 'request', path, method: opts.body ? 'POST' : 'GET', body: opts.body }); }
    catch (error) { response = { status: 0, data: { error: error.message } }; }
    if (response.status >= 200 && response.status < 300) {
      connection(true);
      if (response.data.success === false) throw new Error(response.data.error || response.data.message || 'درخواست انجام نشد.');
      if (opts.cache) {
        try {
          localStorage.setItem(key, JSON.stringify({ data: response.data, time: Date.now() }));
          // Bound stored public catalogue to 80 requests; never retain session/private APIs.
          const keys = Object.keys(localStorage).filter(k => k.startsWith('dm-public-v2:'));
          if (keys.length > 80) {
            keys.sort((a,b) => JSON.parse(localStorage.getItem(a)).time - JSON.parse(localStorage.getItem(b)).time);
            keys.slice(0, keys.length - 80).forEach(k => localStorage.removeItem(k));
          }
        } catch (_) {}
      }
      return response.data;
    }
    if (response.status === 0 || response.status >= 500) {
      connection(false);
      if (opts.cache) {
        try { const saved = JSON.parse(localStorage.getItem(key)); if (saved) return saved.data; } catch (_) {}
      }
    }
    if (response.status === 401 || response.status === 302) {
      if (state.user) {
        state.user = null;
        route();
      }
      throw new Error('برای این بخش وارد حساب شوید.');
    }
    throw new Error(response.data.error || response.data.message || 'دریافت اطلاعات ممکن نشد.');
  }
  async function refreshSession() {
    try { const data = await api('/api/app/v1/session/'); state.user = data.user; state.browserSignIn = data.browser_sign_in === true; state.sessionKnown = true; }
    catch (_) { state.sessionKnown = false; }
  }
  async function finishLogin(sequence) {
    await refreshSession();
    if (!state.user) throw new Error('ورود تأیید نشد. اتصال اینترنت را بررسی کنید.');
    if (sequence !== state.sequence) return;
    history.replaceState(null, '', state.nextAfterLogin);
    state.nextAfterLogin = '#/home';
    route();
  }
  function card(x) { return PWA.card(x); }
  function empty(text) { return '<div class="empty"><p>' + esc(text) + '</p></div>'; }
  function loginPrompt() { return '<div class="panel"><p>برای دریافت اطلاعات حساب به اینترنت متصل شوید و وارد شوید.</p><a class="button primary" href="#/login">ورود به حساب</a></div>'; }
  function shell(title, body) {
    const route = document.body.dataset.page;
    const layout = {
      'local-browse': ['archive-reference-shell','archive-reference-header'],
      'search': ['dm-search-discovery','dm-search-head'],
      'local-library': ['library-shell','library-header'],
      'local-subscription': ['sub-shell','sub-head'],
      'local-rooms': ['mr-wrap','mr-hero'],
      'local-room': ['mr-wrap','mr-room-topline'],
      'local-support': ['ar-support-main','ar-support-head']
    }[route] || ['ar-shell','ar-head'];
    const back = ['local-profile','local-payments','local-settings','local-notifications','local-support','local-subscription','local-about'].includes(route) ? 'account' :
      route === 'local-room' ? 'rooms' : 'home';
    return '<section class="pwa-internal ' + layout[0] + '"><header class="pwa-internal-head ' + layout[1] + '">' +
      '<h1>' + esc(title) + '</h1><a href="#/' + back + '" aria-label="بازگشت"><svg viewBox="0 0 24 24" aria-hidden="true">' +
      '<path d="M20 12H4m7-7-7 7 7 7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></a></header>' +
      (body || '') + '</section>';
  }
  function status(id) { return '<div class="status" id="' + id + '" role="status"></div>'; }
  function fail(el, error) { el.innerHTML = empty(error.message); }
  function mount(html) { app.innerHTML = html; }
  function whenCurrent(seq, fn) { if (state.sequence === seq) fn(); }
  function form(name, fields, button) { return '<form id="' + name + '">' + fields + '<button class="primary" type="submit">' + esc(button) + '</button>' + status(name + '-status') + '</form>'; }
  function field(name, label, type, attributes) {
    return '<label>' + esc(label) + '<input name="' + esc(name) + '" type="' + (type || 'text') + '" ' + (attributes || '') + ' required></label>';
  }
  function submit(id, handler) {
    const element = document.getElementById(id);
    if (!element) return;
    element.addEventListener('submit', async e => {
      e.preventDefault(); const button = element.querySelector('button[type=submit]');
      const output = document.getElementById(id + '-status');
      button.disabled = true; if (output) output.textContent = 'در حال ارسال…';
      try { await handler(Object.fromEntries(new FormData(element)), output); }
      catch (error) { if (output) output.textContent = error.message; else toast(error.message); }
      finally { button.disabled = false; }
    });
  }
  async function home(seq) {
    mount('<div id="home-data"><div class="loading"></div><p>دریافت تازه‌ترین‌ها…</p></div>');
    try {
      const data = await api('/api/app/v1/home/', { cache: true });
      whenCurrent(seq, () => {
        $('#home-data').innerHTML = PWA.home(data);
        if (state.user) api('/api/app/v1/library/').then(library => {
          whenCurrent(seq, () => { $('#home-data').innerHTML = PWA.home(data, library.history); });
        }).catch(() => {});
      });
    } catch (error) { whenCurrent(seq, () => fail($('#home-data'), error)); }
  }
  async function browse(seq, kind, params, isSearch) {
    const q = params.get('q') || '';
    const route = isSearch ? '#/search' : '#/browse/' + enc(kind);
    const results = '<div id="catalogue"><div class="loading"></div></div>';
    if (isSearch) {
      PWA.searchInput(q);
      mount('<section class="dmf3-search-discovery" aria-label="جست‌وجو">' + results + '</section>');
    } else {
      const title = kind === 'movie' ? 'Movies Archive' : kind === 'series' ? 'Series Archive' : 'آرشیو فیلم و سریال';
      mount('<section class="archive-reference-shell"><header class="archive-reference-header"><a href="#/home" aria-label="بازگشت">←</a><h1 data-dm-archive-title dir="auto">' +
        title + '</h1><button type="button" data-local-menu aria-label="منوی کاربری">☰</button></header>' +
        '<div class="archive-reference-sort"><label for="sort">مرتب‌سازی</label><select id="sort">' +
        '<option value="newest">جدیدترین</option><option value="oldest">قدیمی‌ترین</option><option value="most_viewed">پربازدیدترین</option>' +
        '<option value="highest_rating">بالاترین امتیاز</option></select></div>' + results + '</section>');
      $('#sort').value = params.get('sort') || 'newest';
      $('#sort').onchange = event => {
        params.set('sort', event.target.value);
        params.delete('page');
        location.hash = route + '?' + params;
      };
    }
    if (isSearch && !q) {
      try {
        const data = await api('/api/app/v1/home/', {cache:true});
        whenCurrent(seq, () => {
          const rails = data.rails || [];
          const recommended = rails.find(rail => rail.key === 'trending_movies' && rail.items.length) ||
            rails.find(rail => rail.key === 'pwa_recommended' && rail.items.length);
          const featured = ['fantasy','action','drama','horror','sci-fi','comedy'];
          const genres = featured.map(slug => ({slug,name:slug.toUpperCase()}));
          const extra = (data.genres || []).filter(genre => !featured.includes(genre.slug));
          const tile = genre => '<a class="dm-search-genre reference-genre" href="#/browse/all?genre=' + enc(genre.slug) +
            '"><img alt="" loading="lazy" src="https://diastomy.top/pwa/genre-images/v1/' + enc(genre.slug) + '/"><span>' + esc(genre.name) + '</span></a>';
          $('#catalogue').innerHTML = '<h2>ژانرها</h2><div class="dm-search-genres">' + genres.map(tile).join('') +
            '</div>' + (extra.length ? '<details class="local-extra-genres"><summary>دیدن ژانرهای بیشتر</summary><div class="dm-search-genres">' +
            extra.map(tile).join('') + '</div></details>' : '') + '<h2>پیشنهادی</h2><div class="dm-search-recommendations">' +
            (recommended?.items || data.hero || []).map(card).join('') + '</div>';
        });
      } catch (error) { whenCurrent(seq, () => fail($('#catalogue'), error)); }
      return;
    }
    const query = new URLSearchParams(params); query.set('type', kind || 'all');
    try {
      const data = await api('/movie/api/filter/?' + query, { cache: true });
      whenCurrent(seq, () => {
        $('#catalogue').innerHTML = '<div class="archive-reference-grid">' + data.results.map(item =>
          '<article class="archive-reference-card">' + card(item) + '</article>').join('') + '</div>' +
          (!data.results.length ? empty('عنوانی پیدا نشد.') : '') +
          (data.has_next ? '<div class="archive-reference-pagination"><button id="more">بعدی</button></div>' : '');
        if ($('#more')) $('#more').onclick = () => {
          params.set('page', String((data.current_page || 1) + 1));
          location.hash = route + '?' + params;
        };
      });
    } catch (error) { whenCurrent(seq, () => fail($('#catalogue'), error)); }
  }
  function loadSeriesPreferences(sequence) {
    const endpoint = '/api/content-preferences/';
    const spoiler = $('#series-spoiler');
    function setSpoiler(enabled) {
      spoiler.setAttribute('aria-pressed', String(enabled));
      document.querySelectorAll('.spoiler-comment').forEach(comment => { comment.hidden = enabled; });
    }
    async function bind(button, query, key, payload, update) {
      try {
        const result = await api(endpoint + query);
        if (sequence !== state.sequence) return;
        update(Boolean(result[key]));
        button.disabled = false;
        button.onclick = async () => {
          button.disabled = true;
          try {
            const enabled = button.getAttribute('aria-pressed') !== 'true';
            const result = await api(endpoint, {body:{...payload,[key]:enabled}});
            whenCurrent(sequence, () => update(Boolean(result[key])));
          } catch (error) { toast(error.message); }
          finally { button.disabled = false; }
        };
      } catch (_) {}
    }
    bind(spoiler, '', 'spoiler_mode', {}, setSpoiler);
    document.querySelectorAll('[data-follow]').forEach(button => {
      const kind = button.dataset.follow;
      const id = Number(button.dataset.id);
      bind(button, '?kind=' + kind + '&id=' + id, 'following', {kind,id}, enabled =>
        button.setAttribute('aria-pressed', String(enabled)));
    });
  }
  async function detail(seq, kind, slug) {
    mount(shell('جزئیات عنوان', '<div id="detail-data" class="loading"></div>'));
    try {
      const data = await api('/api/app/v1/title/' + enc(kind) + '/' + enc(slug) + '/', { cache: true });
      whenCurrent(seq, () => {
        state.playGroups = kind === 'series' ? (data.episodes || []).map(episode => episode.videos).filter(videos => videos.length) : [data.videos || []];
        const episodeList = data.episodes || [];
        const seasons = [...new Set(episodeList.map(episode => episode.season))];
        const episodes = seasons.length ? '<div class="reference-season-controls"><div class="reference-season-picker"><select id="series-season" aria-label="انتخاب فصل">' +
          seasons.map(season => '<option value="' + esc(season) + '">فصل ' + number(season) + '</option>').join('') +
          '</select><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 9l-7 7-7-7" stroke-linecap="round" stroke-linejoin="round"/></svg></div><button type="button" id="series-sort" aria-label="تغییر ترتیب قسمت‌ها" aria-pressed="false"><svg viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4"/></svg></button></div><div id="series-episodes"></div>' :
          empty('قسمت یا منبع قابل پخش موجود نیست.');
        mount(PWA.detail({...data,type:kind}, episodes));
        submit('title-comment', async (values, output) => {
          const result = await api('/api/app/v1/title/' + enc(kind) + '/' + enc(slug) + '/comments/', {
            body:{text:values.text.trim(),is_spoiler:values.spoiler === 'on'}
          });
          output.textContent = result.message;
          whenCurrent(seq, () => $('#title-comment').reset());
        });
        const season = $('#series-season');
        if (season) {
          const sort = $('#series-sort');
          let watchState = {};
          const renderEpisodes = () => {
            const direction = sort.getAttribute('aria-pressed') === 'true' ? -1 : 1;
            const items = episodeList.filter(episode => String(episode.season) === season.value).sort((a,b) => direction * (a.number - b.number));
            $('#series-episodes').innerHTML = PWA.episodeCards(data, items, watchState, slug);
          };
          season.onchange = renderEpisodes;
          sort.onclick = () => {
            sort.setAttribute('aria-pressed', String(sort.getAttribute('aria-pressed') !== 'true'));
            renderEpisodes();
          };
          renderEpisodes();
          api('/movie/api/watch-state/series/' + enc(slug) + '/').then(result => {
            whenCurrent(seq, () => { watchState = result.items || {}; renderEpisodes(); });
          }).catch(() => {});
        }
        if (kind === 'series') loadSeriesPreferences(seq);
        const trailers = (data.trailers || []).filter(trailer => imageURL(trailer.url));
        document.querySelectorAll('[data-trailer-index]').forEach(button => {
          button.onclick = () => {
            const trailer = trailers[Number(button.dataset.trailerIndex)];
            if (!trailer) return;
            const player = document.createElement('video');
            player.controls = true;
            player.playsInline = true;
            player.src = imageURL(trailer.url);
            $('.movie-detail-hero').replaceChildren(player);
            player.scrollIntoView({block:'nearest'});
            player.play().catch(() => {});
          };
        });
        const downloadOptions = $('#film-download-options');
        if (downloadOptions) $('#film-download').onclick = () => { downloadOptions.hidden = !downloadOptions.hidden; };
        $('.movie-detail-shell').addEventListener('click', async event => {
          const button = event.target.closest('[data-download]');
          if (!button || button.disabled) return;
          button.disabled = true;
          try {
            const action = kind === 'series' ? 'downloadSeries' : 'downloadMovie';
            const result = await native({action, slug, id:Number(button.dataset.download)});
            toast(result.ok ? 'فایل در برنامه Files ذخیره شد.' : result.error);
          } catch (error) { toast(error.message); }
          finally { button.disabled = false; }
        });
        if (kind === 'movie') {
          const create = document.createElement('button'); create.textContent = 'ساخت اتاق فیلم';
          document.querySelector('.actions').appendChild(create);
          create.onclick = async () => { try { const result = await api('/api/app/v1/rooms/', { body: { movie_id: data.id, title: data.title } }); location.hash = '#/room/' + enc(result.code); } catch (error) { toast(error.message); } };
        }
        $('#bookmark').onclick = async () => {
          try { const result = await api('/api/bookmark/toggle/?item_type=' + enc(kind) + '&item_id=' + data.id, { body: {} }); toast(result.message || 'لیست به‌روز شد.'); }
          catch (error) { toast(error.message); }
        };
      });
    } catch (error) { whenCurrent(seq, () => mount(shell('جزئیات عنوان', empty(error.message)))); }
  }
  async function actors(seq, slug) {
    mount(shell(slug ? 'بازیگر' : 'بازیگران', '<div id="actors-data"><div class="loading"></div></div>'));
    try {
      const data = await api(slug ? '/movie/api/actor/' + enc(slug) + '/' : '/movie/api/actors/', { cache: true });
      whenCurrent(seq, () => {
        $('#actors-data').innerHTML = slug ? image(data.actor.photo, 'avatar', data.actor.name) + '<h2>' + esc(data.actor.name) + '</h2><p class="description">' + esc(data.actor.bio) + '</p><div class="grid">' + data.filmography.map(card).join('') + '</div>' : '<div class="grid">' + data.actors.map(a => '<a class="person" href="#/actor/' + enc(a.slug) + '">' + image(a.photo, '', a.name) + '<p>' + esc(a.name) + '</p></a>').join('') + '</div>';
      });
    } catch (error) { whenCurrent(seq, () => fail($('#actors-data'), error)); }
  }
  function library(seq, params) {
    const tabs = [['downloads','دانلودها'], ['saved','لیست من'], ['history','ادامه تماشا']];
    mount(PWA_SOURCE.libraryHeader + '<dialog id="delete-download-dialog"><p>فایل دانلودشده حذف شود؟</p><button type="button" data-cancel-delete>انصراف</button><button type="button" data-confirm-delete>حذف فایل</button></dialog><section class="library-shell" aria-label="لیست من"><div class="library-tabs" role="tablist">' +
      tabs.map(([id,label]) => '<button type="button" role="tab" id="library-tab-' + id + '" aria-controls="library-' + id +
        '" data-library-tab="' + id + '">' + label + '</button>').join('') + '</div>' +
      tabs.map(([id]) => '<section class="library-panel" id="library-' + id + '" aria-labelledby="library-tab-' + id + '" role="tabpanel" hidden></section>').join('') + '</section>');
    const buttons = [...document.querySelectorAll('[data-library-tab]')];
    function panel(tab) { return $('#library-' + tab); }
    function select(tab) {
      buttons.forEach(button => {
        const active = button.dataset.libraryTab === tab;
        button.setAttribute('aria-selected', String(active));
        panel(button.dataset.libraryTab).hidden = !active;
      });
    }
    function renderCollection(data) {
      panel('saved').innerHTML = data.saved.length ? '<div class="library-grid">' + data.saved.map((item,index) =>
        '<article class="local-library-saved">' + card(item) + '<button type="button" class="library-heart" data-remove-saved="' + index +
        '" aria-label="حذف از لیست من">' + PWA_SOURCE.libraryHeart + '</button></article>').join('') + '</div>' :
        '<p class="library-empty">هنوز فیلم یا سریالی ذخیره نکرده‌ای.</p>';
      panel('history').innerHTML = data.history.length ? '<div class="library-history-grid">' + data.history.map(PWA.historyCard).join('') +
        '</div>' : '<p class="library-empty">هنوز چیزی تماشا نکرده‌ای.</p>';
      panel('saved').querySelectorAll('[data-remove-saved]').forEach(button => {
        button.onclick = async () => {
          const item = data.saved[Number(button.dataset.removeSaved)];
          button.disabled = true;
          try {
            const result = await api('/api/bookmark/toggle/?item_type=' + enc(item.type) + '&item_id=' + enc(item.id), {body:{}});
            if (result.success === false) throw Error(result.message || 'حذف ممکن نشد.');
            if (seq !== state.sequence) return;
            await loadCollection();
          } catch (error) { toast(error.message); }
          finally { button.disabled = false; }
        };
      });
    }
    async function loadCollection() {
      try {
        const collection = await api('/api/app/v1/library/');
        whenCurrent(seq, () => renderCollection(collection));
      } catch (error) {
        whenCurrent(seq, () => { fail(panel('saved'), error); fail(panel('history'), error); });
      }
    }
    function confirmDelete() {
      const dialog = $('#delete-download-dialog');
      return new Promise(resolve => {
        dialog.querySelector('[data-cancel-delete]').onclick = () => dialog.close('cancel');
        dialog.querySelector('[data-confirm-delete]').onclick = () => dialog.close('delete');
        dialog.addEventListener('close', () => resolve(dialog.returnValue === 'delete'), {once:true});
        dialog.returnValue = '';
        dialog.showModal();
      });
    }
    async function loadDownloads() {
      const target = panel('downloads');
      try {
        const result = await native({action:'listDownloads'});
        if (seq !== state.sequence) return;
        if (!result.ok) throw Error(result.error || 'خواندن دانلودها ممکن نشد.');
        target.innerHTML = '<p class="dl-hint">روی همین دستگاه ذخیره می‌شود. هنگام دانلود اپ را باز نگه دارید.</p>' +
          (result.files.length ? result.files.map((file,index) =>
            '<article class="local-download-card"><strong>' + esc(file.title) + '</strong><div><button data-local-play="' + index +
            '">پخش آفلاین</button><button data-local-delete="' + index + '">حذف</button></div></article>').join('') :
            '<div class="local-download-empty"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2v19m-5-5 5 5 5-5"/></svg><h2>هنوز دانلودی نداری</h2><p>از صفحهٔ فیلم یا قسمت سریال، دانلود را انتخاب کن.</p></div>');
        const resultFiles = result.files;
        target.querySelectorAll('[data-local-play]').forEach(button => {
          button.onclick = async () => {
            try {
              const outcome = await native({action:'playDownload', name:resultFiles[Number(button.dataset.localPlay)].name});
              if (!outcome.ok) toast(outcome.error);
            } catch (error) { toast(error.message); }
          };
        });
        target.querySelectorAll('[data-local-delete]').forEach(button => {
          button.onclick = async () => {
            if (!await confirmDelete() || seq !== state.sequence) return;
            button.disabled = true;
            try {
              const outcome = await native({action:'deleteDownload', name:resultFiles[Number(button.dataset.localDelete)].name});
              if (!outcome.ok) throw Error(outcome.error);
              if (seq === state.sequence) await loadDownloads();
            } catch (error) { toast(error.message); }
            finally { button.disabled = false; }
          };
        });
      } catch (error) { whenCurrent(seq, () => fail(target, error)); }
    }
    buttons.forEach(button => button.onclick = () => {
      const tab = button.dataset.libraryTab;
      select(tab);
      if (tab === 'downloads') loadDownloads();
    });
    const initial = tabs.some(([id]) => id === params.get('tab')) ? params.get('tab') : 'saved';
    select(initial);
    if (initial === 'downloads') loadDownloads();
    panel('saved').innerHTML = '<p role="status">دریافت لیست…</p>';
    loadCollection();
  }
  function login(previousIdentifier = '') {
    const identifierField = '<div class="dm-auth-phone-field"><input name="identifier" type="text" dir="ltr" autocomplete="username" inputmode="email" required ' +
      'aria-label="شماره موبایل یا ایمیل" placeholder="شماره موبایل یا ایمیل"><span class="dm-auth-phone-icon" aria-hidden="true">' +
      PWA_SOURCE.authPhone + '<i class="dm-auth-phone-separator"></i></span></div>';
    mount(PWA.auth('Sign in or register', form('identify', identifierField, 'Continue') +
      '<div class="reference-auth-alternatives"><span class="reference-auth-divider">or</span>' +
      (state.browserSignIn ? '<button type="button" id="dm-google-id-button" class="dm-google-custom"><img src="/static/public/assets/icons/auth/google-g.svg" alt="">Continue with Google</button>' :
        '<a href="#/otp">ورود با کد یک‌بارمصرف</a>') + '</div>'));
    const google = $('#dm-google-id-button');
    if (google) google.onclick = async () => {
      google.disabled = true;
      try {
        const result = await native({action:'browserSignIn'});
        if (!result.ok) throw Error('باز کردن ورود با گوگل ممکن نشد.');
      } catch (error) { toast(error.message); }
      finally { google.disabled = false; }
    };
    $('#identify [name=identifier]').value = previousIdentifier;
    $('.reference-auth-back').onclick = event => { event.preventDefault(); login(); };
    const output = $('#identify-status');
    if (state.checkingSession) {
      $('#identify button').disabled = true;
      output.textContent = 'در حال بررسی ورود…';
    } else if (!state.sessionKnown) output.textContent = 'برای بررسی ورود به اینترنت وصل شوید.';
    submit('identify', async ({identifier}) => {
      const sequence = state.sequence;
      await api('/api/app/v1/session/');
      const status = await api('/accounts/api/check-phone/', {body:{identifier}});
      whenCurrent(sequence, () => {
        if (!status.has_password && status.identifier_type === 'phone') {
          location.hash = '#/otp?phone=' + enc(identifier);
          return;
        }
        const phone = status.identifier_type === 'phone' ? '?phone=' + enc(identifier) : '';
        mount(PWA.auth('Enter your password.', form('login', '<input type="hidden" name="identifier" value="' + esc(identifier) + '">' +
          '<div class="reference-password-field"><input type="password" name="password" autocomplete="current-password" aria-label="Password" placeholder="Password" required>' +
          '<button type="button" id="toggle-password" aria-label="نمایش رمز عبور" aria-pressed="false">' + PWA_SOURCE.passwordHidden + '</button></div>', 'Continue') +
          '<div class="reference-password-alternatives"><a class="reference-forgot" href="#/forgot">Forgot password</a>' +
          '<a class="reference-sms" href="#/otp' + phone + '">' + PWA_SOURCE.smsIcon + '<span>Get a sign-in code by SMS</span>' +
          PWA_SOURCE.smsChevron + '</a></div>'));
        $('.reference-auth-back').onclick = event => { event.preventDefault(); login(identifier); };
        const toggle = $('#toggle-password');
        toggle.onclick = () => {
          const input = $('#login [name=password]');
          const visible = input.type === 'password';
          input.type = visible ? 'text' : 'password';
          toggle.innerHTML = visible ? PWA_SOURCE.passwordVisible : PWA_SOURCE.passwordHidden;
          toggle.setAttribute('aria-pressed', String(visible));
          toggle.setAttribute('aria-label', visible ? 'پنهان کردن رمز عبور' : 'نمایش رمز عبور');
        };
        submit('login', async data => {
          await api('/accounts/api/login-password/', {body:data});
          await finishLogin(sequence);
        });
      });
    });
  }
  function otp(params) {
    mount(PWA.auth('ورود با کد تأیید', '<div class="form-panel">' + form('send-otp', field('phone', 'شماره موبایل', 'tel', 'autocomplete="tel"'), 'ارسال کد') + '<div id="otp-step"></div></div>'));
    $('#send-otp input').value = params.get('phone') || '';
    submit('send-otp', async (data, output) => {
      await api('/api/app/v1/session/'); await api('/accounts/api/send-otp/', { body: data }); output.textContent = 'کد ارسال شد.';
      $('#otp-step').innerHTML = form('verify-otp', field('code', 'کد تأیید', 'text', 'inputmode="numeric" autocomplete="one-time-code"'), 'تأیید');
      submit('verify-otp', async value => {
        const sequence = state.sequence;
        const result = await api('/accounts/api/verify-otp/', { body: { phone: data.phone, code: value.code } });
        if (result.needs_registration) whenCurrent(sequence, registration);
        else await finishLogin(sequence);
      });
    });
  }
  function registration() {
    mount(PWA.auth('تکمیل ثبت‌نام', form('register', field('full_name', 'نام و نام خانوادگی') + field('username', 'نام کاربری') + field('email', 'ایمیل', 'email') + field('password', 'رمز عبور', 'password', 'autocomplete="new-password" minlength="8"'), 'ساخت حساب')));
    submit('register', async data => {
      const sequence = state.sequence;
      await api('/accounts/api/complete-registration/', {body:data});
      await finishLogin(sequence);
    });
  }
  function forgot() {
    mount(PWA.auth('بازیابی رمز عبور', form('reset-request', field('phone', 'شماره موبایل', 'tel'), 'دریافت کد')));
    submit('reset-request', async (data, output) => {
      await api('/api/app/v1/session/'); await api('/accounts/api/forgot-password-request/', { body: data });
      output.textContent = 'کد ارسال شد.';
      mount(PWA.auth('تأیید کد بازیابی', form('reset-verify', field('code', 'کد تأیید', 'text', 'inputmode="numeric"'), 'تأیید')));
      submit('reset-verify', async code => {
        await api('/accounts/api/forgot-password-verify/', { body: { ...data, ...code } });
        mount(PWA.auth('رمز جدید', form('reset-save', field('password', 'رمز جدید', 'password', 'minlength="8" autocomplete="new-password"'), 'ذخیره')));
        submit('reset-save', async password => { await api('/accounts/api/forgot-password-reset/', { body: { ...data, ...password } }); toast('رمز تغییر کرد.'); location.hash = '#/login'; });
      });
    });
  }
  function account() {
    const user = state.user;
    const sequence = state.sequence;
    mount(PWA.account(user, null, PWA.accountBack || '#/home') +
      '<dialog id="local-logout-dialog"><p>از حساب کاربری خارج می‌شوید؟</p><button type="button" data-logout-cancel>انصراف</button>' +
      '<button type="button" data-logout-confirm>خروج</button></dialog>');
    const dialog = $('#local-logout-dialog');
    $('#logout').onclick = () => dialog.showModal();
    dialog.querySelector('[data-logout-cancel]').onclick = () => dialog.close();
    dialog.querySelector('[data-logout-confirm]').onclick = async event => {
      event.target.disabled = true;
      try {
        await api('/accounts/api/logout/', {body:{}});
        state.user = null;
        state.sessionKnown = true;
        state.nextAfterLogin = '#/home';
        location.hash = '#/login';
      } catch (error) { dialog.close(); toast(error.message); }
      finally { event.target.disabled = false; }
    };
    document.querySelectorAll('[data-social]').forEach(link => link.onclick = async event => {
      event.preventDefault();
      try { const result = await native({action:'openSocial', site:link.dataset.social}); if (!result.ok) throw Error(result.error); }
      catch (error) { toast(error.message); }
    });
    api('/api/watch-time/').then(viewing => {
      if (state.user !== user || sequence !== state.sequence) return;
      const template = document.createElement('template');
      template.innerHTML = PWA.account(user, viewing, PWA.accountBack || '#/home');
      const summary = template.content.querySelector('.dm-viewing-summary');
      if (summary) $('.dm-app-menu-profile').after(summary);
    }).catch(() => {});
  }
  function profile() {
    const user = state.user;
    mount(shell('اطلاعات کاربری', form('edit-profile',
      '<label>نام و نام خانوادگی<input name="full_name" value="' + esc(user.name) + '"></label>' +
      '<label>نام کاربری<input name="username" value="' + esc(user.username || '') + '"></label>' +
      '<label>ایمیل<input name="email" type="email" value="' + esc(user.email || '') + '"></label>' +
      (user.phone ? '<div class="ar-row">شماره تلفن <bdi>' + esc(user.phone) + '</bdi></div>' : ''), 'ذخیره')));
    submit('edit-profile', async (values, output) => {
      const result = await api('/accounts/api/update-profile/', {body:values});
      await refreshSession();
      output.textContent = result.message || 'ذخیره شد.';
    });
  }
  async function payments(seq) {
    mount(shell('اطلاعات پرداخت', '<div id="payment-history"><p role="status">در حال دریافت…</p></div>'));
    try {
      const data = await api('/accounts/api/payments/');
      whenCurrent(seq, () => { $('#payment-history').innerHTML = (data.payments || []).map(payment =>
        '<article class="ar-note"><strong>' + esc(payment.plan_name) + '</strong><p>' + esc(payment.amount) + ' · ' +
        esc(payment.status_display) + '</p><small dir="ltr">' + esc(payment.created_at) + ' · ' + esc(payment.tracking_code) + '</small></article>').join('') ||
        empty('پرداختی ثبت نشده است.'); });
    } catch (error) { whenCurrent(seq, () => fail($('#payment-history'), error)); }
  }
  async function notifications(seq) {
    mount(shell('اعلان‌ها', '<div id="notifications">' + empty('برای دریافت اعلان‌ها به اینترنت و حساب کاربری نیاز است.') + '</div>'));
    try {
      const data = await api('/accounts/api/notifications/');
      whenCurrent(seq, () => {
        $('#notifications').innerHTML = data.notifications.map(n => '<article class="ar-note"><h2>' + esc(n.title) + '</h2><p>' + esc(n.message) + '</p><small>' + esc(n.created_at) + '</small></article>').join('') || empty('اعلان جدیدی ندارید.');
      });
    } catch (error) { whenCurrent(seq, () => fail($('#notifications'), error)); }
  }
  async function support(seq) {
    mount(shell('پشتیبانی', '<div id="messages">' + empty('پیام‌ها از سرور دریافت می‌شوند.') + '</div>' + form('support', '<label>پیام شما<textarea name="content" required maxlength="4000"></textarea></label>', 'ارسال پیام')));
    submit('support', async (data, output) => {
      await api('/accounts/support/api/send/', { body: data }); output.textContent = 'پیام ارسال شد.';
      if (state.sequence === seq) await loadMessages();
    });
    async function loadMessages() {
      try {
        const data = await api('/accounts/support/api/messages/');
        whenCurrent(seq, () => { $('#messages').innerHTML = data.messages.map(m => '<div class="message ar-support-bubble ' + (m.is_operator ? 'operator' : '') + '"><small>' + esc(m.sender_name) + ' · ' + esc(m.created_at) + '</small><p>' + esc(m.content) + '</p>' + (m.attachment_name ? '<small>پیوست: ' + esc(m.attachment_name) + '</small>' : '') + '</div>').join('') || empty('پیام خود را برای پشتیبانی بفرستید.'); });
      } catch (error) { whenCurrent(seq, () => fail($('#messages'), error)); }
    }
    await loadMessages();
  }
  async function subscription(seq) {
    mount(shell('خرید یا تمدید اشتراک', '<div id="plans" class="sub-plans">' + empty('اطلاعات اشتراک از سرور دریافت می‌شود.') + '</div>'));
    try {
      const data = await api('/accounts/api/plans/');
      whenCurrent(seq, () => {
        const plans = data.plans || [];
        $('#plans').innerHTML = plans.map(p => '<article class="sub-plan"><h2 class="sub-plan-name">' + esc(p.name || p.title) + '</h2><p>' + esc(p.description || '') + '</p><strong>' + number(p.newPriceRaw || p.oldPriceRaw) + ' تومان</strong><button class="sub-pay" data-plan="' + p.id + '">خرید اشتراک</button></article>').join('') + '<label>کد تخفیف<input id="discount" autocomplete="off"></label><p>پرداخت در مرورگر امن درگاه انجام می‌شود.</p>';
      });
    } catch (error) { whenCurrent(seq, () => fail($('#plans'), error)); }
  }
  function settings(seq) {
    mount(shell('تنظیمات', '<div class="panel"><h2>نمایش آفلاین</h2><p>صفحات، فونت و منوها داخل اپ هستند. اطلاعات عمومیِ دریافت‌شده برای دفعات بعد ذخیره می‌شوند.</p><button id="clear">پاک کردن اطلاعات عمومی ذخیره‌شده</button></div>' + form('quality', '<label>کیفیت پیش‌فرض<select name="quality"><option value="AUTO">خودکار</option><option value="VeryHigh">1080p</option><option value="High">720p</option><option value="Medium">480p</option><option value="Low">360p</option></select></label>', 'ذخیره کیفیت') + '<h2>تغییر رمز عبور</h2>' + form('password', field('old_password', 'رمز فعلی', 'password', 'autocomplete="current-password"') + field('new_password', 'رمز جدید', 'password', 'autocomplete="new-password" minlength="8"') + field('confirm_password', 'تکرار رمز جدید', 'password', 'autocomplete="new-password" minlength="8"'), 'تغییر رمز') + '<h2>دستگاه‌ها</h2><div id="devices"><p>برای نمایش دستگاه‌ها آنلاین شوید.</p></div>'));
    $('#clear').onclick = async () => { await native({ action: 'clearCache' }); toast('اطلاعات عمومی پاک شد.'); };
    if (state.user) $('#quality select').value = state.user.quality;
    submit('quality', async (data, output) => { await api('/accounts/api/update-player-quality/', { body: data }); output.textContent = 'ذخیره شد.'; });
    submit('password', async (data, output) => { await api('/accounts/api/change-password/', { body: data }); output.textContent = 'رمز تغییر کرد.'; });
    api('/api/app/v1/settings/').then(data => whenCurrent(seq, () => { $('#devices').innerHTML = data.devices.map(d => '<div class="ar-note device">' + esc(d.name) + (d.current ? ' · این دستگاه' : '') + '</div>').join(''); })).catch(() => {});
  }
  function rooms(seq) {
    const slides = ['ساخت اتاق', 'تنظیم ساعت پخش', 'دعوت'];
    mount(PWA_SOURCE.libraryHeader + '<section class="mr-wrap local-room-landing"><h1>به اتاق فیلم دیاستومی خوش آمدید!</h1>' +
      '<section class="mr-exact-slider" aria-label="معرفی اتاق فیلم"><div class="mr-exact-viewport">' + slides.map((label,index) =>
        '<button type="button" class="mr-exact-slide" data-room-slide="' + index + '" aria-hidden="' + Boolean(index) + '"' + (index ? ' hidden' : '') +
        '><span class="mr-exact-image mr-exact-image-' + index + '"></span><span class="mr-slide-action">' + label + '</span></button>').join('') +
      '</div><div class="mr-exact-dots">' + slides.map((_,index) => '<button type="button" data-room-dot="' + index +
        '" aria-label="اسلاید ' + (index + 1) + '" aria-pressed="' + (index === 0) + '"></button>').join('') +
      '</div></section><section class="mr-section"><div class="local-room-section-head"><div><h2>اکسپلور اتاق‌ها</h2>' +
      '<p>یک اتاق پیدا کن و با بقیه فیلم ببین.</p></div><button type="button" data-room-create>+ ساخت اتاق</button></div>' +
      '<form id="room-search"><input name="q" type="search" aria-label="جستجوی اتاق" placeholder="جستجوی اتاق، فیلم یا میزبان"><button type="submit">جستجو</button></form>' +
      '<div id="public-rooms" role="status">در حال دریافت اتاق‌ها…</div>' +
      '<form id="join-room"><input name="code" required placeholder="کد دعوت اتاق" aria-label="کد دعوت اتاق"><button type="submit">ورود</button></form></section>' +
      '<section class="mr-section"><h2>اتاق‌های من</h2><div id="my-rooms" role="status"></div></section>' +
      '<section class="mr-section" id="local-room-create"><h2>ساخت اتاق جدید</h2><form id="mr-create-form" class="mr-form">' +
      '<fieldset class="mr-visibility"><legend>نوع اتاق</legend><label><input type="radio" name="visibility" value="public" checked> عمومی<small>همه کاربران می‌توانند اتاقت را در اکسپلور پیدا کنند.</small></label>' +
      '<label><input type="radio" name="visibility" value="private"> خصوصی<small>فقط با لینک دعوت وارد می‌شوند.</small></label></fieldset>' +
      '<label>عنوان اتاق (اختیاری)<input name="title" maxlength="120" placeholder="مثلاً: شب فیلم جمعه"></label>' +
      '<label>زمان شروع<input name="start" type="datetime-local"></label><label class="local-start-now"><input type="checkbox" name="now"> همین الان شروع شود</label>' +
      '<label>انتخاب فیلم<input name="movie" type="search" placeholder="جستجوی نام فیلم ..."></label>' +
      '<button type="submit" class="mr-create-action">ساخت اتاق</button>' + status('mr-create-form') + '</form>' +
      '<h2 id="room-movie-heading">پیشنهادی</h2><div class="local-room-movies" id="room-movies"></div></section></section>' +
      '<dialog id="room-delete-dialog"><p>اتاق و پیام‌های آن حذف شوند؟</p><button type="button" data-room-cancel>انصراف</button>' +
      '<button type="button" data-room-confirm>حذف اتاق</button></dialog>');

    const form = $('#mr-create-form');
    let roomData;
    let selectedMovie;
    let requestNumber = 0;
    let searchTimer;
    const date = new Date(Date.now() + 10 * 60000);
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    form.elements.start.value = date.toISOString().slice(0,16);
    form.elements.now.onchange = () => { form.elements.start.disabled = form.elements.now.checked; };
    const jump = () => $('#local-room-create').scrollIntoView({behavior:'smooth'});
    function openRoom(code) { location.hash = '#/room/' + enc(code); }
    document.querySelectorAll('[data-room-slide]').forEach(button => button.onclick = jump);
    document.querySelectorAll('[data-room-dot]').forEach(dot => {
      dot.onclick = () => {
        document.querySelectorAll('[data-room-slide]').forEach(slide => { slide.hidden = slide.dataset.roomSlide !== dot.dataset.roomDot; slide.setAttribute('aria-hidden', String(slide.hidden)); });
        document.querySelectorAll('[data-room-dot]').forEach(button => button.setAttribute('aria-pressed', String(button === dot)));
      };
    });
    $('#join-room').onsubmit = event => { event.preventDefault(); const code = new FormData(event.target).get('code').trim(); if (code) openRoom(code); };
    function roomCards(items, owned) {
      return items.map((item,index) => '<article class="mr-room local-room-card">' + image(item.cover, 'local-room-cover', '') +
        '<div class="mr-room-body"><strong>' + esc(item.title) + '</strong><small>' +
        [item.host, item.starts_at ? new Date(item.starts_at).toLocaleString() : '', item.public == null ? '' : item.public ? 'عمومی' : 'خصوصی'].filter(Boolean).map(esc).join(' · ') +
        '</small><span class="mr-status">' + esc(({live:'در حال پخش',upcoming:'برنامه‌ریزی‌شده',paused:'متوقف',ended:'پایان‌یافته'})[item.status] || '') +
        '</span></div><div class="local-room-actions"><a class="mr-btn" href="#/room/' + enc(item.code) + '">ورود</a><button type="button" data-room-share="' +
        esc(item.code) + '">دعوت</button>' + (owned && item.is_host ? '<button type="button" data-room-delete="' + index + '">حذف اتاق</button>' : '') +
        '</div></article>').join('');
    }
    function renderRooms(query = '') {
      const results = roomData.public.filter(item => (item.title + ' ' + (item.host || '')).toLowerCase().includes(query.toLowerCase()));
      $('#public-rooms').innerHTML = results.length ? roomCards(results, false) : '<div class="local-room-empty"><span aria-hidden="true">◉</span><h3>' +
        (query ? 'اتاقی پیدا نشد.' : 'اولین اتاق عمومی را بساز!') + '</h3><p>اتاق‌های عمومی فعال و برنامه‌ریزی‌شده اینجا نمایش داده می‌شوند.</p>' +
        '<button type="button" data-room-create>+ ساخت اتاق عمومی</button></div>';
      $('#my-rooms').innerHTML = roomCards(roomData.mine, true) || '<p>هنوز اتاقی نداری.</p>';
    }
    async function refreshRooms() {
      try {
        const data = await api('/api/app/v1/rooms/');
        whenCurrent(seq, () => { roomData = data; renderRooms($('#room-search input').value.trim()); });
      } catch (error) { whenCurrent(seq, () => fail($('#public-rooms'), error)); }
    }
    $('#room-search').onsubmit = event => { event.preventDefault(); if (roomData) renderRooms(new FormData(event.target).get('q').trim()); };
    $('.local-room-landing').onclick = async event => {
      if (event.target.closest('[data-room-create]')) { jump(); return; }
      const share = event.target.closest('[data-room-share]');
      if (share) {
        try { const result = await native({action:'shareRoom',code:share.dataset.roomShare}); if (!result.ok) throw Error(result.error); }
        catch (error) { toast(error.message); }
        return;
      }
      const button = event.target.closest('[data-room-delete]');
      if (!button) return;
      const item = roomData.mine[Number(button.dataset.roomDelete)];
      const dialog = $('#room-delete-dialog');
      dialog.querySelector('[data-room-cancel]').onclick = () => dialog.close();
      dialog.querySelector('[data-room-confirm]').onclick = async () => {
        dialog.close();
        button.disabled = true;
        try { await api('/movie-room/r/' + enc(item.code) + '/delete/', {body:{}}); await refreshRooms(); }
        catch (error) { toast(error.message); }
        finally { button.disabled = false; }
      };
      dialog.showModal();
    };
    function renderMovies(items, query) {
      $('#room-movie-heading').textContent = query ? 'نتایج جستجو' : 'پیشنهادی';
      $('#room-movies').innerHTML = items.length ? items.map(item => card(item)).join('') : empty('فیلمی پیدا نشد.');
      $('#room-movies').querySelectorAll('a').forEach((link,index) => {
        link.onclick = event => {
          event.preventDefault();
          clearTimeout(searchTimer);
          requestNumber++;
          selectedMovie = items[index];
          form.elements.movie.value = selectedMovie.english_title_full || selectedMovie.title;
          $('#room-movies').querySelectorAll('a').forEach(card => card.removeAttribute('aria-current'));
          link.setAttribute('aria-current','true');
        };
      });
    }
    async function searchMovies(query) {
      const request = ++requestNumber;
      try {
        const data = await api('/movie/api/filter/?type=movie&q=' + enc(query), {cache:true});
        if (request === requestNumber) whenCurrent(seq, () => renderMovies(data.results.slice(0,12), query));
      } catch (error) { if (request === requestNumber) whenCurrent(seq, () => fail($('#room-movies'), error)); }
    }
    form.elements.movie.oninput = () => {
      selectedMovie = null;
      requestNumber++;
      clearTimeout(searchTimer);
      const query = form.elements.movie.value.trim();
      searchTimer = setTimeout(() => { if (seq === state.sequence) searchMovies(query); }, 250);
    };
    submit('mr-create-form', async values => {
      if (!selectedMovie) throw Error('یک فیلم از کارت‌های پایین انتخاب کنید.');
      if (!values.now && !roomData?.supports_scheduling) throw Error('زمان‌بندی اتاق به به‌روزرسانی API سرور نیاز دارد. برای شروع فوری گزینهٔ همین الان را بزنید.');
      const starts = values.now ? null : new Date(values.start);
      if (starts && (!Number.isFinite(starts.getTime()) || starts <= new Date())) throw Error('زمان شروع باید در آینده باشد.');
      const result = await api('/api/app/v1/rooms/', {body:{
        movie_id:selectedMovie.id, title:values.title, public:values.visibility === 'public',
        starts_at:starts ? starts.toISOString() : null
      }});
      if (seq === state.sequence) openRoom(result.code);
    });
    refreshRooms();
    searchMovies('');
  }
  async function room(seq, code) {
    mount(PWA_SOURCE.libraryHeader + '<section class="local-room-detail"><div class="mr-room-topline"><h1>سینما از راه دور!</h1><a href="#/rooms">← بازگشت</a></div>' +
      '<div id="room-data"><p role="status">اطلاعات اتاق از سرور دریافت می‌شود…</p></div></section>');
    try {
      const data = await api('/api/app/v1/rooms/' + enc(code) + '/');
      if (state.sequence !== seq) return;
      state.roomCode = code;
      const videos = data.videos || [];
      $('#room-data').innerHTML = '<article class="local-room-card mr-room">' + image(data.cover, 'local-room-cover', '') +
        '<div class="mr-room-body"><strong>' + esc(data.title) + '</strong><small>میزبان: ' + esc(data.is_host ? 'خودت' : data.host || '—') +
        (data.starts_at ? ' · ' + esc(new Date(data.starts_at).toLocaleString('fa-IR')) : '') + '</small><span id="room-live-state" class="mr-status"></span>' +
        '<div class="local-room-card-buttons"><button type="button" id="share-inside-room">دعوت</button><a href="#/rooms">اتاق‌های من</a></div></div></article>' +
        '<h2>پنل مدیریت پخش</h2><div class="local-room-screen"><span id="room-live-badge">● پخش زنده</span><video playsinline hidden></video>' +
        '<div class="local-room-join"><strong>پخش هم‌زمان</strong><p>برای پیوستن به پخش هم‌زمان روی دکمه بزن.</p>' +
        (videos.length ? '<button type="button" id="room-join-play">ورود به پخش</button>' : '<p>منبع قابل پخش در دسترس نیست.</p>') + '</div></div>' +
        '<h2>کنترل کاربر</h2><div class="local-room-controls"><div class="local-room-volume">' +
        '<button type="button" id="room-mute" aria-label="قطع یا وصل صدا">' + PWA_PLAYER_ICONS.volume + '</button>' +
        '<input id="room-volume" type="range" min="0" max="1" step=".01" value="1" aria-label="صدا">' +
        '<button type="button" id="room-fullscreen" aria-label="تمام‌صفحه">' + PWA_PLAYER_ICONS.fullscreen + '</button></div><div class="local-room-selects">' +
        '<select id="room-subtitle" aria-label="زیرنویس"><option value="-1">بدون زیرنویس</option></select>' +
        '<select id="room-audio" aria-label="زبان صدا"><option value="">صدای اصلی</option></select>' +
        '<select id="room-quality" aria-label="کیفیت">' + videos.map(v => '<option value="' + esc(v.id) + '">' + esc(v.quality) + '</option>').join('') + '</select></div></div>' +
        (data.is_host ? '<h2>کنترل میزبان</h2><div class="local-host-controls"><button data-control="toggle">توقف</button>' +
          '<button data-control="forward">۱۰ ثانیه جلو</button><button data-control="back">۱۰ ثانیه عقب</button><button data-control="close">بستن اتاق</button></div>' : '') +
        '<h2>چت اتاق</h2><section class="local-room-chat"><header><strong>' + esc(data.title) + '</strong><small id="room-status">در حال اتصال…</small></header>' +
        '<div id="room-chat" aria-live="polite"><p>پیام‌ها برای همهٔ حاضرین اتاق نمایش داده می‌شوند.</p></div>' +
        '<div class="local-room-reactions">' + ['😂','😍','😱','😢','👏','🔥','🍿','❤️'].map(emoji => '<button type="button">' + emoji + '</button>').join('') +
        '</div><form id="room-chat-form"><input name="text" aria-label="پیام" placeholder="پیامت رو بنویس…" maxlength="500" required><button type="submit">ارسال</button>' +
        status('room-chat-form') + '</form></section>';

      const player = $('.local-room-screen video');
      const join = $('#room-join-play');
      let roomState = data.state;
      let clockOffset = Number.isFinite(data.server_ts) ? data.server_ts - Date.now() / 1000 : 0;
      let connected = false;
      let mediaRequest = 0;
      let quality;
      function position() {
        return roomState?.paused_position ?? Math.max(0, Date.now() / 1000 + clockOffset - (roomState?.starts_at || Date.now() / 1000));
      }
      function sync() {
        if (!roomState) return;
        const upcoming = roomState.starts_at > Date.now() / 1000 + clockOffset;
        const ended = roomState.duration > 0 && position() >= roomState.duration;
        const paused = roomState.paused_position != null;
        $('#room-live-state').textContent = roomState.closed ? 'بسته‌شده' : ended ? 'پایان‌یافته' : upcoming ? 'در انتظار شروع' : paused ? 'متوقف' : 'در حال پخش';
        $('#room-live-badge').hidden = roomState.closed || upcoming || ended;
        const toggle = $('[data-control=toggle]');
        if (toggle) toggle.textContent = upcoming ? 'شروع' : paused ? 'ادامه' : 'توقف';
        if (player.hidden) return;
        if (connected && player.readyState && Math.abs(player.currentTime - position()) > 1.5) player.currentTime = position();
        if (!connected || roomState.closed || upcoming || ended || paused) player.pause();
        else if (player.paused) player.play().catch(() => {});
      }
      const timer = setInterval(sync, 1000);
      state.roomCleanup = () => {
        clearInterval(timer);
        player.pause();
        player.removeAttribute('src');
        player.load();
      };
      function updateTracks() {
        const audio = Array.from(player.audioTracks || []);
        const subtitles = Array.from(player.textTracks || []).filter(track => ['captions','subtitles'].includes(track.kind));
        const audioInput = $('#room-audio');
        const subtitleInput = $('#room-subtitle');
        audioInput.replaceChildren(...(audio.length ? audio.map((track,i) => new Option(track.label || track.language || String(i+1),i,false,track.enabled)) : [new Option('صدای اصلی','')]));
        subtitleInput.replaceChildren(new Option('بدون زیرنویس',-1), ...subtitles.map((track,i) => new Option(track.label || track.language || String(i+1),i,false,track.mode === 'showing')));
        audioInput.onchange = () => audio.forEach((track,i) => { track.enabled = i === Number(audioInput.value); });
        subtitleInput.onchange = () => subtitles.forEach((track,i) => { track.mode = i === Number(subtitleInput.value) ? 'showing' : 'disabled'; });
      }
      async function playRoom() {
        const selected = Number($('#room-quality').value);
        if (!selected || !connected) { toast('اتصال اتاق هنوز برقرار نشده.'); return; }
        const request = ++mediaRequest;
        try {
          const response = await native({action:'play',kind:'movie',room:code,id:selected,inline:true});
          if (seq !== state.sequence || request !== mediaRequest) return;
          if (response.status !== 200 || !response.data.url) throw Error(response.data.error || 'پخش ممکن نشد.');
          quality = selected;
          player.src = response.data.url;
          player.hidden = false;
          $('.local-room-join').hidden = true;
          sync();
        } catch (error) {
          if (quality) $('#room-quality').value = quality;
          toast(error.message);
        }
      }
      if (join) join.onclick = playRoom;
      $('#room-quality').onchange = () => { if (!player.hidden) playRoom(); };
      player.addEventListener('loadedmetadata', () => { if (seq === state.sequence) { updateTracks(); sync(); } });
      player.addEventListener('error', () => {
        if (seq !== state.sequence || !player.isConnected) return;
        player.hidden = true;
        $('.local-room-join').hidden = false;
        toast('پخش ممکن نشد. دوباره تلاش کنید.');
      });
      $('#room-volume').oninput = event => { player.volume = Number(event.target.value); player.muted = Number(event.target.value) === 0; };
      $('#room-mute').onclick = () => { player.muted = !player.muted; };
      $('#room-fullscreen').onclick = () => {
        if (!player.hidden && player.webkitEnterFullscreen) player.webkitEnterFullscreen();
        else if (!player.hidden && player.requestFullscreen) player.requestFullscreen().catch(() => {});
      };
      $('#share-inside-room').onclick = () => native({action:'shareRoom',code}).catch(error => toast(error.message));
      document.querySelectorAll('.local-room-reactions button').forEach(button => {
        button.onclick = () => { $('#room-chat-form input').value += button.textContent; $('#room-chat-form input').focus(); };
      });
      submit('room-chat-form', async body => {
        const result = await native({action:'roomSend',message:{type:'chat',text:body.text}});
        if (!result.ok) throw Error('ارسال پیام ناموفق بود.');
        whenCurrent(seq, () => { $('#room-chat-form input').value = ''; });
      });
      document.querySelectorAll('[data-control]').forEach(button => button.onclick = async () => {
        const control = button.dataset.control;
        const message = {type:'control',action:control};
        if (control === 'toggle') message.action = roomState?.starts_at > Date.now()/1000 + clockOffset ? 'start_now' :
          roomState?.paused_position != null ? 'resume' : 'pause';
        if (control === 'forward' || control === 'back') {
          message.action = 'seek';
          message.position = Math.max(0, Math.min(roomState?.duration || Infinity, position() + (control === 'forward' ? 10 : -10)));
        }
        try { const response = await native({action:'roomSend',message}); if (!response.ok) throw Error('فرمان اتاق ارسال نشد.'); }
        catch (error) { toast(error.message); }
      });
      state.handleRoomState = event => {
        connected = event.type !== 'error';
        if (event.type === 'state') {
          roomState = event.state;
          if (Number.isFinite(event.server_ts)) clockOffset = event.server_ts - Date.now()/1000;
        }
        sync();
      };
      sync();
      const connection = await native({action:'roomOpen',code});
      if (!connection.ok) throw Error('اتصال اتاق برقرار نشد.');
    } catch (error) {
      whenCurrent(seq, () => {
        if (state.roomCleanup) state.roomCleanup();
        state.roomCleanup = null;
        state.handleRoomState = null;
        fail($('#room-data'), error);
      });
    }
  }
  window.addEventListener('diastomy-room', event => {
    if (!state.roomCode || !$('#room-chat')) return;
    const data = event.detail;
    const message = m => '<div class="message"><small>' + esc(m.name) + '</small><p>' + esc(m.text) + '</p></div>';
    if (data.type === 'history') $('#room-chat').innerHTML = data.messages.map(message).join('');
    if (data.type === 'chat') $('#room-chat').insertAdjacentHTML('beforeend', message(data.message));
    if (data.type === 'presence') $('#room-status').textContent = number(data.users.length) + ' کاربر آنلاین';
    if (data.type === 'error') { $('#room-status').textContent = 'اتصال قطع شد'; toast(data.message); }
    if (state.handleRoomState) state.handleRoomState(data);
  });
  async function route() {
    PWAPlayer.close();
    if (state.roomCleanup) state.roomCleanup();
    state.roomCleanup = null;
    state.handleRoomState = null;
    state.playGroups = [];
    const seq = ++state.sequence;
    if (state.roomCode) { state.roomCode = null; native({ action: 'roomClose' }).catch(() => {}); }
    const hash = (location.hash.slice(1) || '/home');
    const split = hash.indexOf('?');
    const path = split === -1 ? hash : hash.slice(0, split);
    const params = new URLSearchParams(split === -1 ? '' : hash.slice(split + 1));
    let parts; try { parts = path.split('/').filter(Boolean).map(decodeURIComponent); } catch (_) { parts = ['home']; }
    const name = parts[0] || 'home';
    if (state.checkingSession) {
      PWA.page('login');
      login();
      return;
    }
    if (!state.user && !['login','otp','forgot'].includes(name)) {
      state.nextAfterLogin = '#/' + hash.replace(/^\//, '');
      history.replaceState(null, '', '#/login');
      return route();
    }
    PWA.page(name);
    document.querySelectorAll('nav a').forEach(a => a.classList.toggle('active', a.dataset.tab === name));
    window.scrollTo(0,0);
    try {
      if (name === 'home') await home(seq);
      else if (name === 'browse') await browse(seq, parts[1] || 'all', params, false);
      else if (name === 'search') await browse(seq, 'all', params, true);
      else if (name === 'title') await detail(seq, parts[1], parts[2]);
      else if (name === 'actors' || name === 'actor') await actors(seq, parts[1]);
      else if (name === 'library') library(seq, params);
      else if (name === 'login') login();
      else if (name === 'otp') otp(params);
      else if (name === 'forgot') forgot();
      else if (name === 'account') account();
      else if (name === 'profile') profile();
      else if (name === 'payments') await payments(seq);
      else if (name === 'notifications') await notifications(seq);
      else if (name === 'support') await support(seq);
      else if (name === 'subscription') await subscription(seq);
      else if (name === 'rooms') await rooms(seq);
      else if (name === 'room') await room(seq, parts[1]);
      else if (name === 'settings') settings(seq);
      else if (name === 'about') mount(shell('دربارهٔ دیاستومی', '<div class="panel"><img class="logo" src="assets/logo.svg" alt="دیاستومی"><p>نسخهٔ ۲٫۱٫۱۷ — رابط نصب‌شده روی دستگاه</p><p>صفحات و فایل‌های برنامه محلی هستند. اطلاعات حساب، فهرست محتوا، پوسترها و ویدیوها از سرور دریافت می‌شوند.</p></div>'));
      else mount(shell('صفحه پیدا نشد', empty('از منوی برنامه صفحهٔ مورد نظر را انتخاب کنید.')));
    } catch (error) { whenCurrent(seq, () => mount(shell('خطا', empty(error.message)))); }
  }
  document.addEventListener('click', async e => {
    const purchase = e.target.closest('[data-plan]');
    if (purchase) {
      purchase.disabled = true;
      try { const result = await native({ action: 'checkout', plan: Number(purchase.dataset.plan), discount: $('#discount') ? $('#discount').value : '' }); if (!result.data.opened) throw new Error(result.data.error || result.data.message || 'درگاه پرداخت باز نشد.'); }
      catch (error) { toast(error.message); }
      finally { purchase.disabled = false; }
      return;
    }
    const button = e.target.closest('[data-play]');
    if (!button) return;
    button.disabled = true;
    try {
      const kind = button.dataset.kind;
      const id = Number(button.dataset.play);
      const room = button.dataset.room;
      const sequence = state.sequence;
      const response = await native({ action: 'play', kind, id, room, inline: !room });
      if (response.status !== 200) throw new Error(response.data.error || 'پخش ممکن نشد.');
      if (!room && sequence === state.sequence) {
        if (!response.data.url) throw new Error('آدرس پخش در دسترس نیست.');
        const groups = state.playGroups || [];
        const group = groups.findIndex(options => options.some(option => Number(option.id) === id));
        PWAPlayer.open({
          info:response.data, groups, group, kind, id, native, onError:toast,
          save:body => api('/api/watch-progress/', {body}).catch(() => {})
        });
      }
    } catch (error) { toast(error.message); }
    finally { button.disabled = false; }
  });
  window.addEventListener('diastomy-browser-sign-in', async event => {
    if (!event.detail) { toast('ورود کامل نشد. دوباره تلاش کنید.'); return; }
    try { await finishLogin(state.sequence); } catch (error) { toast(error.message); }
  });
  window.addEventListener('hashchange', route);
  window.addEventListener('online', () => { connection(true); if (!document.body.classList.contains('local-player-open')) route(); });
  window.addEventListener('offline', () => connection(false));
  PWA.install();
  route();
  refreshSession().finally(() => {
    state.checkingSession = false;
    if (state.user && (!location.hash || location.hash === '#/login')) history.replaceState(null, '', '#/home');
    route();
  });
})();
