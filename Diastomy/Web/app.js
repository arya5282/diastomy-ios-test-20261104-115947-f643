/* Bundled client. No remote HTML, JavaScript, stylesheet or CDN is loaded. */
(function () {
  'use strict';
  const app = document.getElementById('app');
  const state = { user: null, sessionKnown: false, sequence: 0, online: true };
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
      state.user = null;
      throw new Error('برای این بخش وارد حساب شوید.');
    }
    throw new Error(response.data.error || response.data.message || 'دریافت اطلاعات ممکن نشد.');
  }
  async function refreshSession() {
    try { const data = await api('/api/app/v1/session/'); state.user = data.user; state.sessionKnown = true; }
    catch (_) { state.sessionKnown = false; }
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
    const back = ['local-settings','local-notifications','local-support','local-subscription','local-about'].includes(route) ? 'account' :
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
    mount(shell(isSearch ? 'جست‌وجو' : 'فیلم و سریال', '<div class="chips"><a class="chip" href="#/browse/movie">فیلم</a><a class="chip" href="#/browse/series">سریال</a><a class="chip" href="#/browse/all">همه</a><a class="chip" href="#/actors">بازیگران</a></div><form id="search-form" class="search-form"><input name="q" placeholder="نام فیلم، سریال یا بازیگر…" aria-label="عبارت جست‌وجو" value="' + esc(q) + '"><button type="submit">جست‌وجو</button></form><div class="row"><label>مرتب‌سازی<select id="sort"><option value="newest">تازه‌ترین</option><option value="imdb">امتیاز IMDb</option></select></label></div><div id="catalogue"><div class="loading"></div></div>'));
    $('#search-form').addEventListener('submit', e => { e.preventDefault(); location.hash = '#/search?q=' + enc(new FormData(e.target).get('q')); });
    $('#sort').value = params.get('sort') || 'newest';
    $('#sort').addEventListener('change', e => { params.set('sort', e.target.value); location.hash = '#/browse/' + enc(kind) + '?' + params; });
    if (isSearch && !q) {
      try {
        const data = await api('/api/app/v1/home/', {cache:true});
        whenCurrent(seq, () => {
          const recommended = (data.rails || []).find(rail => rail.key === 'pwa_recommended');
          $('#catalogue').innerHTML = '<h2>ژانرها</h2><div class="dm-search-genres">' + data.genres.map(genre =>
            '<a class="dm-search-genre" href="#/browse/all?genre=' + enc(genre.slug) + '">' + esc(genre.name) + '</a>').join('') +
            '</div><h2>پیشنهادی</h2><div class="dm-search-recommendations">' +
            ((recommended && recommended.items) || data.hero || []).map(card).join('') + '</div>';
        });
      } catch (error) { whenCurrent(seq, () => fail($('#catalogue'), error)); }
      return;
    }
    const query = new URLSearchParams(params); query.set('type', kind || 'all');
    try {
      const data = await api('/movie/api/filter/?' + query, { cache: true });
      whenCurrent(seq, () => {
        $('#catalogue').innerHTML = '<p>' + number(data.total_results) + ' عنوان</p><div class="grid archive-reference-grid">' + data.results.map(card).join('') + '</div>' + (!data.results.length ? empty('عنوانی پیدا نشد.') : '') + (data.has_next ? '<button class="wide" id="more">صفحهٔ بعد</button>' : '');
        if ($('#more')) $('#more').onclick = () => { params.set('page', String((data.current_page || 1) + 1)); location.hash = '#/browse/' + enc(kind) + '?' + params; };
      });
    } catch (error) { whenCurrent(seq, () => fail($('#catalogue'), error)); }
  }
  async function detail(seq, kind, slug) {
    mount(shell('جزئیات عنوان', '<div id="detail-data" class="loading"></div>'));
    try {
      const data = await api('/api/app/v1/title/' + enc(kind) + '/' + enc(slug) + '/', { cache: true });
      whenCurrent(seq, () => {
        let episodes = '';
        if (kind === 'series') {
          const seasons = new Map(); (data.episodes || []).forEach(x => { if (!seasons.has(x.season)) seasons.set(x.season, []); seasons.get(x.season).push(x); });
          episodes = Array.from(seasons, ([season, items]) => '<details open><summary>فصل ' + number(season) + '</summary><div class="season">' + items.map(x => '<div class="panel"><strong>قسمت ' + number(x.number) + '</strong><div class="chips">' + x.videos.map(v => '<button data-play="' + v.id + '" data-kind="series">▶ ' + esc(v.quality) + '</button>').join('') + '</div></div>').join('') + '</div></details>').join('');
        } else { episodes = '<div class="chips">' + (data.videos || []).map(v => '<button class="primary" data-play="' + v.id + '" data-kind="movie">▶ پخش ' + esc(v.quality) + '</button>').join('') + '</div>'; }
        mount(PWA.detail(data, episodes || empty('قسمت یا منبع قابل پخش موجود نیست.')));
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
  async function library(seq) {
    mount(shell('لیست من', '<div id="library-data"><p>دریافت لیست و ادامهٔ تماشا…</p></div>'));
    try {
      const data = await api('/api/app/v1/library/');
      whenCurrent(seq, () => {
        const library = $('#library-data');
        library.innerHTML = '<div class="library-tabs"><button data-library-tab="saved" aria-pressed="true">ذخیره‌شده‌ها</button>' +
          '<button data-library-tab="history" aria-pressed="false">تاریخچه تماشا</button></div><div class="library-panel"></div>';
        const panel = library.querySelector('.library-panel');
        const buttons = library.querySelectorAll('[data-library-tab]');
        function show(tab) {
          buttons.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.libraryTab === tab)));
          const items = data[tab] || [];
          panel.innerHTML = items.length ? '<div class="grid library-grid">' + items.map(card).join('') + '</div>' :
            '<div class="library-empty">' + empty('هنوز عنوانی در این بخش نیست.') + '</div>';
        }
        buttons.forEach(button => button.onclick = () => show(button.dataset.libraryTab));
        show('saved');
      });
    } catch (error) { whenCurrent(seq, () => { $('#library-data').innerHTML = empty(error.message) + loginPrompt(); }); }
  }
  function login() {
    mount(PWA.auth('Sign in or register', form('identify', field('identifier', 'شماره موبایل یا ایمیل', 'text', 'autocomplete="username"'), 'Continue') +
      '<div class="reference-auth-alternatives"><a href="#/otp">ورود با کد یک‌بارمصرف</a></div>'));
    submit('identify', async ({identifier}) => {
      const sequence = state.sequence;
      await api('/api/app/v1/session/');
      const status = await api('/accounts/api/check-phone/', {body:{identifier}});
      whenCurrent(sequence, () => {
        if (!status.has_password && status.identifier_type === 'phone') {
          location.hash = '#/otp?phone=' + enc(identifier);
          return;
        }
        mount(PWA.auth('رمز عبور', form('login', '<input type="hidden" name="identifier" value="' + esc(identifier) + '">' +
          field('password', 'رمز عبور', 'password', 'autocomplete="current-password"'), 'ورود') +
          '<div class="reference-auth-alternatives"><a href="#/forgot">فراموشی رمز عبور</a></div>'));
        submit('login', async data => {
          await api('/accounts/api/login-password/', {body:data});
          await refreshSession();
          if (sequence === state.sequence) location.hash = '#/account';
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
        const result = await api('/accounts/api/verify-otp/', { body: { phone: data.phone, code: value.code } });
        if (result.needs_registration) { registration(); } else { await refreshSession(); location.hash = '#/account'; }
      });
    });
  }
  function registration() {
    mount(PWA.auth('تکمیل ثبت‌نام', form('register', field('full_name', 'نام و نام خانوادگی') + field('username', 'نام کاربری') + field('email', 'ایمیل', 'email') + field('password', 'رمز عبور', 'password', 'autocomplete="new-password" minlength="8"'), 'ساخت حساب')));
    submit('register', async data => { await api('/accounts/api/complete-registration/', { body: data }); await refreshSession(); location.hash = '#/account'; });
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
    function render(history) {
      mount(PWA.account(user, history));
      if ($('#logout')) $('#logout').onclick = async () => {
        try { await api('/accounts/api/logout/', { body: {} }); state.user = null; state.sessionKnown = true; if (sequence === state.sequence) account(); }
        catch (error) { toast(error.message); }
      };
    }
    render();
    if (user) api('/api/app/v1/library/').then(library => {
      if (state.user === user) whenCurrent(sequence, () => render(library.history));
    }).catch(() => {});
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
  async function rooms(seq) {
    mount(shell('اتاق فیلم', '<a class="button" href="#/browse/movie">انتخاب فیلم برای ساخت اتاق</a>' + form('join-room', field('code', 'کد دعوت اتاق'), 'ورود به اتاق') + '<div id="room-list">' + empty('برای دریافت اتاق‌ها وارد حساب شوید.') + '</div>'));
    submit('join-room', async data => { location.hash = '#/room/' + enc(data.code.trim()); });
    try {
      const data = await api('/api/app/v1/rooms/');
      whenCurrent(seq, () => { $('#room-list').innerHTML = '<h2>اتاق‌های من</h2>' + data.mine.map(r => '<a class="mr-room mr-room-body" href="#/room/' + enc(r.code) + '">' + esc(r.title) + '</a>').join('') + '<h2>اتاق‌های عمومی</h2>' + data.public.map(r => '<a class="mr-room mr-room-body" href="#/room/' + enc(r.code) + '">' + esc(r.title) + '</a>').join(''); });
    } catch (error) { whenCurrent(seq, () => fail($('#room-list'), error)); }
  }
  async function room(seq, code) {
    mount(shell('اتاق فیلم', '<div id="room-data">' + empty('اطلاعات اتاق از سرور دریافت می‌شود.') + '</div>'));
    try {
      const data = await api('/api/app/v1/rooms/' + enc(code) + '/');
      if (state.sequence !== seq) return;
      state.roomCode = code;
      $('#room-data').innerHTML = '<h2>' + esc(data.title) + '</h2><p>کد دعوت: <strong dir="ltr">' + esc(code) + '</strong></p><div class="chips">' + data.videos.map(v => '<button data-play="' + v.id + '" data-kind="movie" data-room="' + esc(code) + '">▶ ' + esc(v.quality) + '</button>').join('') + '</div>' + (!data.can_watch ? empty('برای تماشای این اتاق به اشتراک نیاز دارید.') : '') + '<p id="room-status">در حال اتصال…</p>' + (data.is_host ? '<div class="chips"><button data-control="start_now">شروع</button><button data-control="pause">توقف</button><button data-control="resume">ادامه</button><button data-control="close">بستن اتاق</button></div>' : '') + '<h2>گفت‌وگو</h2><div id="room-chat" class="mr-side"></div>' + form('room-chat-form', field('text', 'پیام', 'text', 'maxlength="500"'), 'ارسال');
      await native({ action: 'roomOpen', code });
      submit('room-chat-form', async (body, output) => { const result = await native({ action: 'roomSend', message: { type: 'chat', text: body.text } }); if (!result.ok) throw new Error('ارسال پیام ناموفق بود.'); output.textContent = ''; $('#room-chat-form input').value = ''; });
      document.querySelectorAll('[data-control]').forEach(b => { b.onclick = async () => { const result = await native({ action: 'roomSend', message: { type: 'control', action: b.dataset.control } }); if (!result.ok) toast('کنترل اتاق ارسال نشد.'); }; });
    } catch (error) { whenCurrent(seq, () => fail($('#room-data'), error)); }
  }
  window.addEventListener('diastomy-room', event => {
    if (!state.roomCode || !$('#room-chat')) return;
    const data = event.detail;
    const message = m => '<div class="message"><small>' + esc(m.name) + '</small><p>' + esc(m.text) + '</p></div>';
    if (data.type === 'history') $('#room-chat').innerHTML = data.messages.map(message).join('');
    if (data.type === 'chat') $('#room-chat').insertAdjacentHTML('beforeend', message(data.message));
    if (data.type === 'presence') $('#room-status').textContent = number(data.users.length) + ' نفر در اتاق';
    if (data.type === 'state' && data.state.closed) $('#room-status').textContent = 'اتاق بسته شد.';
    if (data.type === 'error') toast(data.message);
  });
  async function route() {
    const seq = ++state.sequence;
    if (state.roomCode) { state.roomCode = null; native({ action: 'roomClose' }).catch(() => {}); }
    const hash = (location.hash.slice(1) || '/home');
    const split = hash.indexOf('?');
    const path = split === -1 ? hash : hash.slice(0, split);
    const params = new URLSearchParams(split === -1 ? '' : hash.slice(split + 1));
    let parts; try { parts = path.split('/').filter(Boolean).map(decodeURIComponent); } catch (_) { parts = ['home']; }
    const name = parts[0] || 'home';
    PWA.page(name);
    document.querySelectorAll('nav a').forEach(a => a.classList.toggle('active', a.dataset.tab === name));
    window.scrollTo(0,0);
    try {
      if (name === 'home') await home(seq);
      else if (name === 'browse') await browse(seq, parts[1] || 'all', params, false);
      else if (name === 'search') await browse(seq, 'all', params, true);
      else if (name === 'title') await detail(seq, parts[1], parts[2]);
      else if (name === 'actors' || name === 'actor') await actors(seq, parts[1]);
      else if (name === 'library') await library(seq);
      else if (name === 'login') login();
      else if (name === 'otp') otp(params);
      else if (name === 'forgot') forgot();
      else if (name === 'account') account();
      else if (name === 'notifications') await notifications(seq);
      else if (name === 'support') await support(seq);
      else if (name === 'subscription') await subscription(seq);
      else if (name === 'rooms') await rooms(seq);
      else if (name === 'room') await room(seq, parts[1]);
      else if (name === 'settings') settings(seq);
      else if (name === 'about') mount(shell('دربارهٔ دیاستومی', '<div class="panel"><img class="logo" src="assets/logo.svg" alt="دیاستومی"><p>نسخهٔ ۲٫۱٫۲ — رابط نصب‌شده روی دستگاه</p><p>صفحات و فایل‌های برنامه محلی هستند. اطلاعات حساب، فهرست محتوا، پوسترها و ویدیوها از سرور دریافت می‌شوند.</p></div>'));
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
      const response = await native({ action: 'play', kind: button.dataset.kind, id: Number(button.dataset.play), room: button.dataset.room || undefined });
      if (response.status !== 200) throw new Error(response.data.error || 'پخش ممکن نشد.');
    } catch (error) { toast(error.message); }
    finally { button.disabled = false; }
  });
  window.addEventListener('hashchange', route);
  window.addEventListener('online', () => { connection(true); route(); });
  window.addEventListener('offline', () => connection(false));
  // Render the initial page immediately; authentication must never gate offline UI.
  PWA.install();
  route();
  refreshSession().then(() => {
    const current = location.hash || '#/home';
    if (current === '#/account') account();
    else if (current === '#/home' && state.user) route();
  });
})();
