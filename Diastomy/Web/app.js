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
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
  function closeWithMotion(dialog) {
    if (!dialog.open || dialog.hasAttribute('data-closing')) return;
    if (reduceMotion.matches || !dialog.animate) { dialog.close(); return; }
    dialog.setAttribute('data-closing','');
    const sheet = dialog.matches('#home-history-menu,#local-filters,#settings-choice');
    const motion = dialog.animate([
      {opacity:1, transform:'none'},
      {opacity:0, transform:sheet ? 'translateY(18px)' : 'translateY(6px) scale(.985)'}
    ], {duration:125, easing:'ease-in', fill:'forwards'});
    motion.finished.catch(() => {}).then(() => {
      dialog.close();
      dialog.removeAttribute('data-closing');
      motion.cancel();
    });
  }
  document.addEventListener('submit', event => {
    const dialog = event.target.closest('#home-history-menu,.film-download-dialog,#local-filters,#settings-choice');
    if (!dialog || event.target.method !== 'dialog') return;
    event.preventDefault();
    closeWithMotion(dialog);
  });
  document.addEventListener('cancel', event => {
    if (!event.target.matches('#home-history-menu,.film-download-dialog,#local-filters,#settings-choice')) return;
    event.preventDefault();
    closeWithMotion(event.target);
  }, true);
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
  let historyFrameObserver;
  function loadHistoryFrames(container) {
    historyFrameObserver?.disconnect();
    const observer = historyFrameObserver = new IntersectionObserver(entries => {
      entries.forEach(({target, isIntersecting}) => {
        if (!isIntersecting) return;
        observer.unobserve(target);
        native({action:'historyFrame',path:target.dataset.historyFrame}).then(result => {
          if (target.isConnected && result?.image) target.src = result.image;
        }).catch(() => {});
      });
    }, {rootMargin:'150px'});
    container.querySelectorAll('[data-history-frame]').forEach(image => observer.observe(image));
  }
  async function home(seq) {
    mount('<div id="home-data"><div class="loading"></div><p>دریافت تازه‌ترین‌ها…</p></div>');
    try {
      const data = await api('/api/app/v1/home/', { cache: true });
      whenCurrent(seq, () => {
        $('#home-data').innerHTML = PWA.home(data);
        if (state.user) api('/api/app/v1/library/').then(library => {
          whenCurrent(seq, () => {
            const container = $('#home-data');
            const entries = library.history || [];
            container.innerHTML = PWA.home(data, entries) +
              '<dialog id="home-history-menu" aria-label="گزینه‌های ادامه تماشا"><form method="dialog"><button aria-label="بستن">×</button></form>' +
              '<button type="button" id="home-history-resume" data-play="" data-resume>ادامه تماشا</button><a>اطلاعات فیلم</a></dialog>';
            loadHistoryFrames(container);
            const menu = $('#home-history-menu');
            container.onclick = event => {
              const trigger = event.target.closest('[data-history-more]');
              if (!trigger) return;
              const item = entries[Number(trigger.dataset.historyMore)];
              const resume = $('#home-history-resume');
              const details = menu.querySelector('a');
              details.href = trigger.closest('article').querySelector('a').href;
              details.onclick = () => menu.close();
              resume.dataset.play = item.video_id || '';
              resume.dataset.kind = item.type;
              resume.onclick = event => {
                menu.close();
                if (!item.video_id) {
                  event.stopPropagation();
                  location.href = details.href;
                }
              };
              menu.showModal();
            };
          });
        }).catch(() => {});
      });
    } catch (error) { whenCurrent(seq, () => fail($('#home-data'), error)); }
  }
  function installFilterChoices(form) {
    const refresh = [];
    let openMenu;
    function closeMenu() {
      if (!openMenu) return;
      openMenu.list.hidden = true;
      openMenu.toggle.setAttribute('aria-expanded', 'false');
      openMenu = null;
    }
    for (const select of form.querySelectorAll('select')) {
      select.hidden = true;
      if (select.closest('.local-filter-year')) {
        const wheel = document.createElement('div');
        wheel.className = 'filter-year-wheel';
        wheel.tabIndex = 0;
        wheel.setAttribute('role', 'listbox');
        wheel.setAttribute('aria-label', select.name === 'year_from' ? 'از سال' : 'تا سال');
        const options = [...select.options];
        options.forEach(option => {
          const row = document.createElement('div');
          row.setAttribute('role', 'option');
          row.textContent = option.text;
          wheel.append(row);
        });
        select.after(wheel);
        function choose(index) {
          index = Math.max(0, Math.min(options.length - 1, index));
          select.selectedIndex = index;
          wheel.children[index].setAttribute('aria-selected', 'true');
          for (const row of wheel.querySelectorAll('[aria-selected=true]')) {
            if (row !== wheel.children[index]) row.removeAttribute('aria-selected');
          }
        }
        choose(0);
        wheel.onscroll = () => choose(Math.round((wheel.scrollTop + 10) / 22));
        wheel.onkeydown = event => {
          if (!['ArrowDown','ArrowUp'].includes(event.key)) return;
          event.preventDefault();
          choose(select.selectedIndex + (event.key === 'ArrowDown' ? 1 : -1));
          wheel.scrollTop = Math.max(0, select.selectedIndex * 22 - 10);
        };
        continue;
      }
      const toggle = document.createElement('button');
      const list = document.createElement('div');
      toggle.type = 'button';
      toggle.className = 'filter-choice-toggle';
      toggle.setAttribute('aria-expanded','false');
      list.className = 'filter-choice-list';
      list.hidden = true;
      select.after(toggle, list);
      const update = () => {
        toggle.textContent = select.selectedOptions[0]?.text || 'همه';
        toggle.setAttribute('aria-label', select.parentElement.firstChild.textContent.trim() + ' ' + toggle.textContent);
      };
      refresh.push(update);
      update();
      toggle.onclick = event => {
        event.preventDefault();
        const alreadyOpen = openMenu?.toggle === toggle;
        closeMenu();
        if (alreadyOpen) return;
        openMenu = {list, toggle};
        list.hidden = false;
        toggle.setAttribute('aria-expanded','true');
        list.replaceChildren(...[...select.options].map(option => {
          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = option.text;
          button.setAttribute('aria-pressed', String(option.selected));
          button.onclick = event => {
            event.preventDefault();
            select.value = option.value;
            update();
            closeMenu();
            toggle.focus();
          };
          return button;
        }));
      };
    }
    form.addEventListener('click', event => {
      if (!event.target.closest('.filter-choice-toggle,.filter-choice-list')) closeMenu();
    });
    form.closest('dialog').addEventListener('cancel', event => {
      if (!openMenu) return;
      event.preventDefault();
      const toggle = openMenu.toggle;
      closeMenu();
      toggle.focus();
    });
    form.closest('dialog').addEventListener('close', closeMenu);
    return () => refresh.forEach(update => update());
  }
  function openFilters() {
    const dialog = $('#local-filters');
    if (dialog.open) return;
    const form = dialog.querySelector('form');
    const select = (name, label, choices) => '<label>' + label + '<select name="' + name + '"><option value="">همه</option>' +
      choices.map(([value,text]) => '<option value="' + esc(value) + '">' + esc(text) + '</option>').join('') + '</select></label>';
    if (!form.children.length) {
      const latestYear = new Date().getFullYear() + 2;
      const yearOptions = Array.from({length:latestYear - 1887}, (_, index) => {
        const year = latestYear - index;
        return '<option value="' + year + '">' + year + '</option>';
      }).join('');
      const yearSelect = (name, label) => '<label class="local-filter-year"><span>' + label +
        '</span><select name="' + name + '" dir="ltr" lang="en"><option value="">all</option>' +
        yearOptions + '</select></label>';
      form.innerHTML = '<header><h2 id="local-filter-title" tabindex="-1" autofocus>اعمال فیلتر</h2><button type="button" data-close-filter aria-label="بستن">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6m0-6-6 6" stroke-linecap="round"/></svg></button></header>' +
        '<div class="local-filter-fields">' + select('type','نوع',[['movie','فیلم'],['series','سریال']]) +
        '<label>کارگردان<span class="filter-text-field"><input name="director" placeholder="نام کارگردان"></span></label><label>بازیگران<span class="filter-text-field"><input name="actor" placeholder="نام بازیگر"></span></label>' +
        '<div class="local-filter-pair"><label>حداقل امتیاز<span class="filter-text-field"><input type="text" inputmode="decimal" name="rating" lang="en" placeholder="7.8"></span></label>' +
        '<fieldset><legend>سال ساخت</legend><div class="local-filter-years">' + yearSelect('year_from','از') +
        '<span aria-hidden="true">–</span>' + yearSelect('year_to','تا') + '</div></fieldset></div>' +
        select('country','کشور',[['ایالات متحده آمریکا','ایالات متحده آمریکا'],['ایران','ایران'],['ترکیه','ترکیه'],['بریتانیا','بریتانیا'],['فرانسه','فرانسه'],['هند','هند'],['کره جنوبی','کره جنوبی'],['ژاپن','ژاپن']]) +
        select('sort','ترتیب نمایش',[['newest','جدیدترین'],['oldest','قدیمی‌ترین'],['most_viewed','پربازدیدترین'],['highest_rating','بالاترین امتیاز']]) +
        select('genre','ژانر',[]) +
        '<fieldset class="local-filter-tags"><legend>انتخاب بر اساس</legend><div>' +
        [['dubbed','دوبله فارسی'],['subtitled','زیرنویس فارسی'],['uncensored','بدون سانسور'],['censored','سانسور شده']]
          .map(([value,label]) => '<label><input type="checkbox" name="tags" value="' + value + '"><span>' + label + '</span></label>').join('') +
        '</div></fieldset></div><footer><p id="filter-range-error" role="status"></p><button type="submit">جستجو</button></footer>';
      form.querySelector('[data-close-filter]').onclick = () => closeWithMotion(dialog);
      dialog.addEventListener('click', event => { if (event.target === dialog) closeWithMotion(dialog); });
      const {rating, year_from:fromYear, year_to:toYear} = form.elements;
      rating.oninput = () => {
        rating.value = rating.value.replace(/[۰-۹٠-٩]/g, digit => String(digit.charCodeAt(0) & 15))
          .replace(/[٫,]/g, '.');
        rating.setCustomValidity('');
      };
      form.refreshChoices = installFilterChoices(form);
      form.onsubmit = event => {
        event.preventDefault();
        $('#filter-range-error').textContent = '';
        const score = rating.value.trim();
        if (score && (!/^[0-9]+(?:\.[0-9]+)?$/.test(score) || Number(score) > 10)) {
          rating.setCustomValidity('امتیاز را بین 0 تا 10 وارد کنید.');
          rating.reportValidity();
          return;
        }
        if (fromYear.value && toYear.value && Number(fromYear.value) > Number(toYear.value)) {
          $('#filter-range-error').textContent = 'سال پایان باید برابر یا بعد از سال شروع باشد.';
          return;
        }
        const query = new URLSearchParams();
        const data = new FormData(form);
        data.forEach((value,key) => { if (key !== 'type' && value.trim()) query.append(key,value.trim()); });
        const term = document.querySelector('.reference-search-form input')?.value.trim();
        if (term) query.set('q',term);
        dialog.close();
        location.hash = '#/browse/' + (data.get('type') || 'all') + (query.size ? '?' + query : '');
      };
    }
    dialog.showModal();
    form.querySelector('.local-filter-fields').scrollTop = 0;
    api('/api/app/v1/home/', {cache:true}).then(data => {
      for (const [field, choices] of [['genre', data.genres], ['country', data.countries]]) {
        if (!choices?.length) continue;
        const select = form.elements[field], value = select.value;
        select.replaceChildren(new Option('همه',''), ...choices.map(item => new Option(item.name,item.slug)));
        select.value = value;
      }
      form.refreshChoices();
    }).catch(() => {});
  }
  async function searchPage(seq, initialQuery) {
    const search = PWA.searchInput(initialQuery);
    const input = search.elements.q;
    mount('<section class="dmf3-search-discovery" aria-label="جست‌وجو"><div id="catalogue"></div></section>');
    const catalogue = $('#catalogue');
    let timer;
    let searchRequest = 0;
    async function render(term, request) {
      if (seq !== state.sequence || request !== searchRequest) return;
      if (!term) {
      try {
        const data = await api('/api/app/v1/home/', {cache:true});
        if (request !== searchRequest) return;
        whenCurrent(seq, () => {
          const rails = data.rails || [];
          const recommended = rails.find(rail => rail.key === 'trending_movies' && rail.items.length) ||
            rails.find(rail => rail.key === 'pwa_recommended' && rail.items.length);
          $('#catalogue').innerHTML = PWA.searchDiscovery(data.genres || [], recommended?.items || data.hero || []);
          const toggle = $('#search-genres-toggle');
          const extra = $('#search-genres-extra');
          toggle.onclick = () => {
            const expanded = toggle.getAttribute('aria-expanded') !== 'true';
            toggle.setAttribute('aria-expanded', String(expanded));
            toggle.textContent = expanded ? '── دیدن ژانرهای کمتر ──' : '── دیدن ژانرهای بیشتر ──';
            extra.inert = !expanded;
            extra.setAttribute('aria-hidden', String(!expanded));
          };
        });
      } catch (error) { if (request === searchRequest) whenCurrent(seq, () => fail($('#catalogue'), error)); }
        return;
      }
      try {
        const query = new URLSearchParams({q:term, type:'all', sort:'relevance'});
        const data = await api('/movie/api/filter/?' + query, {cache:true});
        if (request !== searchRequest || seq !== state.sequence) return;
        catalogue.innerHTML = '<h2>نتایج جستجو</h2>' + (data.results.length ?
          '<div class="dm-search-live-results">' + data.results.map(PWA.savedCard).join('') + '</div>' :
          '<form id="search-suggestion"><p>متأسفانه جستجوی شما نتیجه‌ای نداشت. می‌توانید عنوان موردنظر را پیشنهاد بدهید تا به مجموعه اضافه کنیم.</p>' +
          '<label>نام فیلم یا سریال<input name="title" maxlength="255" required></label>' +
          '<button type="submit">ثبت پیشنهاد</button><small id="search-suggestion-status" role="status"></small></form>');
        const suggestion = $('#search-suggestion');
        if (suggestion) {
          suggestion.elements.title.value = term;
          submit('search-suggestion', async ({title}, output) => {
            const result = await api('/api/suggest-content/', {body:{title,source_query:term}});
            output.textContent = result.message;
          });
        }
      } catch (error) {
        if (request === searchRequest) whenCurrent(seq, () => fail(catalogue, error));
      }
    }
    function queue(immediate) {
      clearTimeout(timer);
      const term = input.value.trim();
      const request = ++searchRequest;
      history.replaceState(null, '', term ? '#/search?q=' + enc(term) : '#/search');
      if (term) catalogue.innerHTML = '<div class="live-search-loading" role="status">' +
        '<span class="startup-spinner" aria-hidden="true"></span><strong>در حال جستجو...</strong>' +
        '<small>لطفاً کمی صبر کنید</small></div>';
      if (immediate) return render(term, request);
      timer = setTimeout(() => render(term, request), 230);
    }
    input.oninput = () => queue(false);
    search.onsubmit = event => {
      event.preventDefault();
      input.blur();
      queue(true);
    };
    await queue(true);
  }
  async function browse(seq, kind, params) {
    const route = '#/browse/' + enc(kind);
    const results = '<div id="catalogue"><div class="loading"></div></div>';

      const title = kind === 'movie' ? 'Movies Archive' : kind === 'series' ? 'Series Archive' : 'آرشیو فیلم و سریال';
      mount('<section class="archive-reference-shell"><header class="archive-reference-header"><a href="#/home" aria-label="بازگشت">' + PWA_SOURCE.actorBack + '</a><h1 data-dm-archive-title dir="auto">' +
        title + '</h1><button type="button" data-local-menu aria-label="منوی کاربری">' + PWA_SOURCE.actorMenu + '</button></header>' +
        '<div class="archive-reference-sort"><label for="sort">مرتب‌سازی</label><select id="sort">' +
        '<option value="newest">جدیدترین</option><option value="oldest">قدیمی‌ترین</option><option value="most_viewed">پربازدیدترین</option>' +
        '<option value="highest_rating">بالاترین امتیاز</option></select></div>' + results + '</section>');
      $('#sort').value = params.get('sort') || 'newest';
      $('#sort').onchange = event => {
        params.set('sort', event.target.value);
        params.delete('page');
        location.hash = route + '?' + params;
      };
        const query = new URLSearchParams(params); query.set('type', kind || 'all');
    try {
      const data = await api('/movie/api/filter/?' + query, { cache: true });
      whenCurrent(seq, () => {
        $('#catalogue').innerHTML = '<div class="archive-reference-grid">' + data.results.map(item =>
          '<article class="archive-reference-card">' + PWA.savedCard(item) + '</article>').join('') + '</div>' +
          (!data.results.length ? empty('عنوانی پیدا نشد.') : '') +
          (data.has_next ? '<div class="archive-reference-pagination"><button id="more">بعدی</button></div>' : '');
        if ($('#more')) $('#more').onclick = () => {
          params.set('page', String((data.current_page || 1) + 1));
          location.hash = route + '?' + params;
        };
      });
    } catch (error) { whenCurrent(seq, () => fail($('#catalogue'), error)); }
  }
  function loadContentPreferences(sequence) {
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
        if (kind === 'series') loadContentPreferences(seq);
        const trailers = (data.trailers || []).filter(trailer => imageURL(trailer.url));
        document.querySelectorAll('[data-trailer-index]').forEach(button => {
          const trailer = trailers[Number(button.dataset.trailerIndex)];
          if (!trailer) return;
          button.dataset.inlineTrailerSrc = imageURL(trailer.url);
          if (!button.closest('.movie-detail-hero')) {
            button.classList.add('local-trailer-card');
            const host = document.createElement('span');
            host.className = 'dm-trailer-thumb';
            button.before(host);
            host.append(button);
          }
        });
        const downloadOptions = $('#film-download-options');
        $('#film-comments').onclick = () => {
          $('[data-detail-tab="comments"]').click();
          $('[data-detail-tab="comments"]').scrollIntoView({behavior:'smooth', block:'start'});
        };
        if (downloadOptions) {
          const selectDownloadTab = variant => {
            downloadOptions.querySelector('.film-download-content').scrollTop = 0;
            downloadOptions.querySelectorAll('[data-download-tab]').forEach(button => {
              button.setAttribute('aria-pressed', String(button.dataset.downloadTab === variant));
            });
            downloadOptions.querySelectorAll('[data-download-panel]').forEach(panel => {
              panel.hidden = panel.dataset.downloadPanel !== variant;
            });
          };
          downloadOptions.querySelectorAll('[data-download-tab]').forEach(button => {
            button.onclick = () => selectDownloadTab(button.dataset.downloadTab);
          });
          $('#film-download').onclick = () => { selectDownloadTab('subbed'); downloadOptions.showModal(); };
          const audio = $('#film-audio');
          if (audio) audio.onclick = () => { selectDownloadTab('dubbed'); downloadOptions.showModal(); };
          downloadOptions.addEventListener('click', event => {
            if (event.target === downloadOptions) {
              const bounds = downloadOptions.getBoundingClientRect();
              if (event.clientX < bounds.left || event.clientX > bounds.right ||
                  event.clientY < bounds.top || event.clientY > bounds.bottom) closeWithMotion(downloadOptions);
            }
          });
        }
        $('.movie-detail-shell').addEventListener('click', async event => {
          const button = event.target.closest('[data-download]');
          if (!button || button.disabled) return;
          button.disabled = true;
          try {
            const action = kind === 'series' ? 'downloadSeries' : 'downloadMovie';
            const result = await native({action, slug, id:Number(button.dataset.download), dubbed:button.dataset.variant === "dubbed"});
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
  document.addEventListener('click', event => {
    const link = event.target.closest('a[href^="#/actor/"]');
    if (link && !location.hash.startsWith('#/actor/')) state.actorBack = location.hash;
  });
  async function actors(seq, slug, page) {
    mount(slug ? PWA.actorPage() : shell('بازیگران', '<div id="actors-data"><div class="loading"></div></div>'));
    const query = '?page=' + (Number(page) || 1);
    try {
      const cache = {cache:true};
      const data = slug ? await api('/api/app/v1/actor/' + enc(slug) + '/' + query, cache)
        .catch(() => api('/movie/api/actor/' + enc(slug) + '/' + query, cache)) :
        await api('/movie/api/actors/', cache);
      whenCurrent(seq, () => {
        $('#actors-data').innerHTML = slug ? PWA.actorProfile(data, slug) :
          '<div class="grid">' + data.actors.map(a => '<a class="person" href="#/actor/' + enc(a.slug) + '">' +
          image(a.photo, '', a.name) + '<p>' + esc(a.name) + '</p></a>').join('') + '</div>';
        if (!slug) return;
        const back = $('.dm-actor-back');
        back.onclick = event => {
          if (!state.actorBack || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          event.preventDefault();
          location.hash = state.actorBack;
        };
        const facts = $('#dm-actor-facts');
        const more = $('.dm-actor-more');
        const measure = () => { if (!facts.classList.contains('dm-expanded')) more.hidden = facts.scrollHeight <= facts.clientHeight + 1; };
        more.onclick = () => {
          const expanded = facts.classList.toggle('dm-expanded');
          more.setAttribute('aria-expanded', String(expanded));
          more.textContent = expanded ? 'کمتر' : 'بیشتر';
          measure();
        };
        measure();
        document.fonts?.ready.then(measure);
        loadContentPreferences(seq);
      });
    } catch (error) { whenCurrent(seq, () => fail($('#actors-data'), error)); }
  }
  function library(seq, params) {
    const tabs = [['downloads','دانلودها'], ['saved','لیست من'], ['history','ادامه تماشا']];
    mount(PWA_SOURCE.libraryHeader + '<dialog id="history-menu"><form method="dialog"><button aria-label="بستن">×</button></form><a>مشاهده جزئیات</a><button type="button" data-remove-history>حذف از ادامه تماشا</button></dialog><dialog id="delete-download-dialog"><p>فایل دانلودشده حذف شود؟</p><button type="button" data-cancel-delete>انصراف</button><button type="button" data-confirm-delete>حذف فایل</button></dialog><section class="library-shell" aria-label="لیست من"><div class="library-tabs" role="tablist">' +
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
        '<article class="local-library-saved">' + PWA.savedCard(item) + '<button type="button" class="library-heart" data-remove-saved="' + index +
        '" aria-label="حذف از لیست من">' + PWA_SOURCE.libraryHeart + '</button></article>').join('') + '</div>' :
        '<p class="library-empty">هنوز فیلم یا سریالی ذخیره نکرده‌ای.</p>';
      panel('history').innerHTML = data.history.length ? '<div class="library-history-grid">' + data.history.map(PWA.historyCard).join('') +
        '</div>' : '<p class="library-empty">هنوز چیزی تماشا نکرده‌ای.</p>';
      loadHistoryFrames(panel('history'));
      const menu = $('#history-menu');
      panel('history').querySelectorAll('[data-history-more]').forEach(button => {
        button.onclick = () => {
          const item = data.history[Number(button.dataset.historyMore)];
          menu.querySelector('a').href = '#/title/' + enc(item.type) + '/' + enc(item.slug);
          const remove = menu.querySelector('[data-remove-history]');
          const id = item.history_id || String(item.snapshot || '').match(/\/api\/watch-frame\/(\d+)\//)?.[1];
          remove.hidden = !id;
          remove.onclick = async () => {
            remove.disabled = true;
            try {
              await api('/api/watch-history/' + enc(id) + '/remove/', {body:{}});
              if (seq !== state.sequence) return;
              menu.close();
              await loadCollection();
            } catch (error) { toast(error.message); }
            finally { remove.disabled = false; }
          };
          menu.showModal();
        };
      });
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
    panel('saved').innerHTML = '<p role="status">دریافت لیست…</p>';
    const collection = loadCollection();
    return initial === 'downloads' ? loadDownloads() : collection;
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
    mount(PWA.account(user, PWA.accountBack || '#/home') +
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
    loadAccountWatchTime(user, sequence);
  }
  function loadAccountWatchTime(user, sequence) {
    const output = $('#account-watch-time');
    api('/api/watch-time/').then(viewing => {
      if (state.user !== user || sequence !== state.sequence) return;
      if (!Number.isInteger(viewing.hours) || !Number.isInteger(viewing.minutes)) {
        output.textContent = 'زمان تماشا در دسترس نیست.';
        return;
      }
      output.textContent = viewing.hours + ' ساعت و ' + viewing.minutes + ' دقیقه';
    }).catch(() => {
      if (state.user === user && sequence === state.sequence) output.textContent = 'زمان تماشا در دسترس نیست.';
    });
  }
  function profile() {
    const user = state.user;
    const sequence = state.sequence;
    const [first = '', ...last] = (user.full_name ?? user.name ?? '').trim().split(/\s+/);
    const avatar = imageURL(user.avatar) || '/static/public/assets/avatars/default/avatar-04.svg';
    const profileField = (name, label, value, attributes) =>
      '<label><span>' + label + '</span><input name="' + name + '" value="' + esc(value) + '" ' + attributes + '></label>';
    mount('<section class="profile-editor"><header><h1>پروفایل کاربری</h1><a href="#/account" aria-label="بازگشت">' +
      PWA_SOURCE.actorBack + '</a></header>' + PWA.watchTimeCard() +
      '<div class="profile-editor-avatar"><button type="button" id="profile-avatar-edit" aria-label="تغییر آواتار">' +
      '<img id="profile-avatar-current" src="' + esc(avatar) + '" alt="آواتار"><span aria-hidden="true">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><path d="m4 16-1 5 5-1L21 7l-4-4L4 16Zm11-11 4 4M4 16l4 4"/></svg></span></button>' +
      '<span class="reference-subscription-badge">' + (user.subscribed ? 'اشتراک فعال' : 'اشتراک غیرفعال') + '</span></div>' +
      form('edit-profile', profileField('first','نام',first,'autocomplete="given-name"') +
        profileField('last','نام خانوادگی',last.join(' '),'autocomplete="family-name"') +
        profileField('username','نام کاربری',user.username || '','dir="ltr" autocomplete="username" required') +
        profileField('email','ایمیل',user.email || '','dir="ltr" type="email" autocomplete="email" readonly') +
        profileField('phone','شماره تماس',user.phone || '','dir="ltr" type="tel" autocomplete="tel" readonly'), 'ذخیره اطلاعات') +
      '<dialog id="profile-avatar-dialog" aria-labelledby="profile-avatar-title"><form method="dialog"><button aria-label="بستن">×</button></form>' +
      '<h2 id="profile-avatar-title">تغییر آواتار</h2><label>بارگذاری تصویر<input id="profile-avatar-file" type="file" accept="image/*"></label>' +
      '<p id="profile-avatar-status" role="status"></p></dialog></section>');
    loadAccountWatchTime(user, sequence);
    submit('edit-profile', async (values, output) => {
      const full_name = [values.first.trim(), values.last.trim()].filter(Boolean).join(' ');
      const result = await api('/accounts/api/update-profile/', {body:{full_name,username:values.username}});
      await refreshSession();
      output.textContent = result.message || 'ذخیره شد.';
    });
    const dialog = $('#profile-avatar-dialog');
    const picker = $('#profile-avatar-file');
    $('#profile-avatar-edit').onclick = () => dialog.showModal();
    picker.onchange = async () => {
      const file = picker.files[0];
      if (!file) return;
      const output = $('#profile-avatar-status');
      if (file.size > 3 * 1024 * 1024) {
        output.textContent = 'حجم تصویر باید حداکثر ۳ مگابایت باشد.';
        picker.value = '';
        return;
      }
      picker.disabled = true;
      output.textContent = 'در حال ذخیره…';
      try {
        const content = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result).split(',')[1]);
          reader.onerror = () => reject(Error('خواندن تصویر ممکن نشد.'));
          reader.readAsDataURL(file);
        });
        const result = await native({action:'updateAvatar', content});
        if (result.status !== 200) throw Error(result.data?.error || 'ذخیرهٔ تصویر ممکن نشد.');
        await refreshSession();
        whenCurrent(sequence, () => {
          $('#profile-avatar-current').src = imageURL(state.user?.avatar) || avatar;
          dialog.close();
        });
      } catch (error) { output.textContent = error.message; }
      finally { picker.disabled = false; picker.value = ''; }
    };
  }
  const persianDate = new Intl.DateTimeFormat('en-GB-u-ca-persian-nu-latn', {
    year:'numeric', month:'2-digit', day:'2-digit', timeZone:'Asia/Tehran'
  });
  function paymentDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || '');
    if (!match) return value || '—';
    const date = new Date(match.slice(1).join('-') + 'T12:00:00Z');
    if (!Number.isFinite(date.getTime())) return value;
    const parts = Object.fromEntries(persianDate.formatToParts(date).map(({type,value}) => [type,value]));
    return [parts.year,parts.month,parts.day].join('/');
  }
  async function payments(seq) {
    mount(shell('اطلاعات پرداخت', '<div id="payment-history"><p role="status">در حال دریافت…</p></div>'));
    try {
      const data = await api('/accounts/api/payments/');
      whenCurrent(seq, () => {
        const detailLine = (label,value) => value ? '<p>' + label + ' <bdi>' + esc(value) + '</bdi></p>' : '';
        const rows = (data.payments || []).map(payment =>
          '<details class="ar-payment"><summary><span>' + esc(payment.plan_name === '-' ? '' : payment.plan_name) + '</span>' +
          '<time dir="ltr">' + esc(paymentDate(payment.created_at)) + '</time><span dir="ltr">' + esc(payment.amount) + '</span>' +
          '<span aria-label="جزئیات پرداخت">•••</span></summary><div class="ar-payment-detail">' +
          detailLine('وضعیت:',payment.status_display) + detailLine('مبلغ:',payment.amount + ' تومان') +
          detailLine('کد تخفیف:',payment.discount_code) +
          detailLine('شروع:',payment.start_date && paymentDate(payment.start_date)) +
          detailLine('پایان:',payment.end_date && paymentDate(payment.end_date)) + '</div></details>').join('');
        $('#payment-history').innerHTML = '<div class="ar-payment-head"><span>نوع خرید</span><span>تاریخ</span><span>مبلغ</span><span>جزئیات</span></div>' +
          (rows || '<p class="account-reference-empty">هنوز پرداختی ثبت نشده است.</p>');
      });
    } catch (error) { whenCurrent(seq, () => fail($('#payment-history'), error)); }
  }
  const noticeCategories = {media:'فیلم و سریال',room:'اتاق فیلم',news:'اخبار و اطلاعیه‌ها',account:'حساب و سیستم'};
  function noticeCategory(title) {
    if (/اتاق|میزبان|دعوت/.test(title)) return 'room';
    if (/ورود|حساب|اشتراک|دانلود|اینترنت|سرویس|پرداخت/.test(title)) return 'account';
    return /فیلم|سریال|قسمت|تماشا/.test(title) ? 'media' : 'news';
  }
  async function notifications(seq, params) {
    const requested = params.get('category');
    const category = Object.hasOwn(noticeCategories,requested) ? requested : '';
    const label = category === 'media' ? 'اعلان‌های فیلم و سریال' : noticeCategories[category] || 'اعلان‌ها';
    mount(shell('اعلان‌ها', '<div class="account-notice-row account-notice-pref"><strong>' + label +
      '</strong><button type="button" role="switch" aria-label="فعال بودن ' + label +
      '" aria-checked="true"></button></div><div id="notifications"><p role="status">در حال دریافت…</p></div>'));
    if (category) $('.pwa-internal-head a').href = '#/notifications';
    const toggle = $('.account-notice-pref button');
    const key = 'diastomy_notifications_' + (category || 'enabled');
    toggle.setAttribute('aria-checked', String(localStorage.getItem(key) !== 'false'));
    toggle.onclick = () => {
      const enabled = toggle.getAttribute('aria-checked') !== 'true';
      toggle.setAttribute('aria-checked',String(enabled));
      localStorage.setItem(key,String(enabled));
    };
    if (!category) {
      $('#notifications').innerHTML = Object.entries(noticeCategories).map(([key,label]) =>
        '<a class="account-notice-row" href="#/notifications?category=' + key + '"><span>' + label +
        '</span><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m14 6-6 6 6 6"/></svg></a>').join('');
    }
    try {
      const data = await api('/accounts/api/notifications/');
      whenCurrent(seq, () => {
        const notices = data.notifications || [];
        if (!category) {
          for (const key of Object.keys(noticeCategories)) {
            if (notices.some(n => n.is_read === false && noticeCategory(n.title) === key)) {
              const dot = document.createElement('i');
              dot.className = 'account-notice-unread';
              dot.setAttribute('aria-label','خوانده‌نشده');
              $('#notifications a[href="#/notifications?category=' + key + '"] span').append(dot);
            }
          }
          return;
        }
        $('#notifications').innerHTML = notices.filter(n => noticeCategory(n.title) === category).map(n =>
          '<article class="account-notice-row account-notice-item"><h2>' + esc(n.title) + '</h2><p>' + esc(n.message) +
          '</p><small>' + esc(n.created_at) + '</small></article>').join('') ||
          '<p class="account-reference-empty">اعلانی در این بخش ندارید.</p>';
      });
    } catch (error) {
      if (category) whenCurrent(seq, () => fail($('#notifications'), error));
    }
  }
  async function support(seq) {
    const quickReplies = ['فیلم پخش نمی‌شه','مشکل اتصال به اینترنت','مشکل حساب کاربری'];
    const icon = path => '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round">' + path + '</svg>';
    const clip = icon('<path d="M8 9v9a4 4 0 0 0 8 0V6a3 3 0 0 0-6 0v11a1 1 0 0 0 2 0V8"/>');
    const smile = icon('<circle cx="12" cy="12" r="10"/><path d="M8 14a4 4 0 0 0 8 0M9 9h.1M15 9h.1"/>');
    const missing = icon('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m5 17 5-5 3 3 2-2 4 4"/><path stroke="#ed1423" d="M2 3l20 18"/>');
    mount(shell('پشتیبانی', '<section class="local-support-chat"><div class="local-support-chat-head"><h2>پشتیبانی</h2><span>پاسخ‌گویی آنلاین</span></div>' +
      '<div id="messages" role="log" aria-label="گفتگوی پشتیبانی"><p>در حال دریافت پیام‌ها…</p></div>' +
      '<form id="support"><div class="local-support-quick">' + quickReplies.map(text => '<button type="button">' + text + '</button>').join('') + '</div>' +
      '<div class="local-support-emojis" hidden>' + ['😊','🙏','👍','❤️','😕'].map(text => '<button type="button">' + text + '</button>').join('') + '</div>' +
      '<div class="local-support-file" hidden><span></span><button type="button" aria-label="حذف پیوست">×</button></div>' +
      '<div class="local-support-compose"><div class="local-support-field"><label aria-label="افزودن پیوست">' + clip + '<input type="file" name="file" accept="image/*" aria-label="افزودن پیوست"></label>' +
      '<textarea name="content" maxlength="4000" rows="1" placeholder="پیام خود را بنویسید…" aria-label="پیام شما"></textarea>' +
      '<button type="button" class="local-support-emoji-toggle" aria-label="ایموجی" aria-expanded="false">' + smile + '</button></div>' +
      '<button type="submit" class="local-support-send">ارسال</button></div><p id="support-feedback" role="status"></p></form></section>'));
    const log = $('#messages'), composer = $('#support'), input = composer.elements.content, file = composer.elements.file;
    const feedback = $('#support-feedback'), selected = $('.local-support-file'), emojis = $('.local-support-emojis');
    const emojiToggle = $('.local-support-emoji-toggle');
    const scrollLatest = () => { log.scrollTop = log.scrollHeight; };
    for (const button of $('.local-support-quick').children) button.onclick = () => { input.value = button.textContent; };
    emojiToggle.onclick = () => { emojis.hidden = !emojis.hidden; emojiToggle.setAttribute('aria-expanded',String(!emojis.hidden)); };
    for (const button of emojis.children) button.onclick = () => {
      input.setRangeText(button.textContent,input.selectionStart,input.selectionEnd,'end');
      emojiToggle.click();
    };
    const showFile = () => {
      selected.hidden = !file.files.length;
      selected.querySelector('span').textContent = file.files[0]?.name || '';
    };
    file.onchange = showFile;
    selected.querySelector('button').onclick = () => { file.value = ''; showFile(); };
    let lastMessages;
    async function loadMessages() {
      try {
        const data = await api('/accounts/support/api/messages/');
        if (seq !== state.sequence) return;
        const messages = data.messages || [];
        const signature = JSON.stringify(messages.map(m => [m.id,m.is_read,m.content,m.attachment_url]));
        if (signature === lastMessages) return;
        const follow = !lastMessages || log.scrollHeight - log.scrollTop - log.clientHeight < 64;
        lastMessages = signature;
        let day;
        log.innerHTML = messages.map(m => {
          const date = m.date_display && m.date_display !== day ? '<p class="local-support-day">' + esc(m.date_display) + '</p>' : '';
          day = m.date_display;
          const attachment = m.attachment_name || m.attachment_url ? '<div class="local-support-attachment"' +
            (m.attachment_type === 'image' && m.attachment_url ? ' data-support-image="' + esc(m.id) + '"' : '') + '>' +
            missing + '<span>Attachment unavailable</span></div>' : '';
          return date + '<article class="local-support-message ' + (m.is_operator ? 'operator' : 'mine') + '">' +
            (m.content ? '<p class="local-support-bubble" dir="auto">' + esc(m.content) + '</p>' : '') + attachment +
            '<small dir="ltr">' + esc(m.created_at) + (m.is_operator ? '' : (m.is_read ? ' <span aria-label="خوانده‌شده">✓✓</span>' : ' <span aria-label="ارسال‌شده">✓</span>')) +
            '</small></article>';
        }).join('') || '<p class="local-support-empty">پیام خود را برای پشتیبانی بفرستید.</p>';
        if (follow) scrollLatest();
        for (const frame of log.querySelectorAll('[data-support-image]')) {
          native({action:'supportImage', id:Number(frame.dataset.supportImage)}).then(result => {
            if (!frame.isConnected || !result.image) return;
            const image = new Image();
            image.alt = 'تصویر پیوست';
            image.src = result.image;
            frame.replaceChildren(image);
            if (follow && log.scrollHeight - log.scrollTop - log.clientHeight < 64) scrollLatest();
          }).catch(() => {});
        }
      } catch (error) {
        if (!lastMessages) whenCurrent(seq, () => fail(log,error));
      }
    }
    composer.onsubmit = async event => {
      event.preventDefault();
      const content = input.value.trim(), attachment = file.files[0], send = composer.querySelector('[type=submit]');
      if (send.disabled || (!content && !attachment)) return;
      if (attachment && attachment.size > 5 * 1024 * 1024) { feedback.textContent = 'حجم تصویر باید حداکثر ۵ مگابایت باشد.'; return; }
      send.disabled = true;
      feedback.textContent = '';
      try {
        if (attachment) {
          const content64 = await new Promise((resolve,reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(',')[1]);
            reader.onerror = () => reject(Error('خواندن پیوست ممکن نشد.'));
            reader.readAsDataURL(attachment);
          });
          const result = await native({action:'sendSupportImage', content, content64, name:attachment.name});
          if (result.status !== 200) throw Error(result.data?.error || 'ارسال پیوست ممکن نشد.');
        } else await api('/accounts/support/api/send/', {body:{content}});
        input.value = ''; file.value = ''; showFile();
        await loadMessages();
        if (seq === state.sequence) scrollLatest();
      } catch (error) { feedback.textContent = error.message; }
      finally { send.disabled = false; }
    };
    await loadMessages();
    if (seq !== state.sequence) return;
    async function refresh() {
      if (seq !== state.sequence) return;
      if (!document.hidden) await loadMessages();
      if (seq === state.sequence) setTimeout(refresh, 8000);
    }
    setTimeout(refresh, 8000);
  }
  async function subscription(seq) {
    mount(shell('خرید یا تمدید اشتراک', '<div id="plans">' + empty('اطلاعات اشتراک از سرور دریافت می‌شود.') + '</div>'));
    try {
      const data = await api('/accounts/api/plans/');
      whenCurrent(seq, () => {
        const plans = data.plans || [];
        if (!plans.length) { $('#plans').innerHTML = empty('در حال حاضر پلنی برای خرید موجود نیست.'); return; }
        const money = value => new Intl.NumberFormat('en-US', {maximumFractionDigits:0}).format(value);
        const planPrice = plan => Number(plan.newPriceRaw || plan.oldPriceRaw || 0);
        let selected = plans[0], discount = 0, applied = '', revision = 0;
        $('#plans').innerHTML = '<div class="sub-plans" role="radiogroup" aria-label="انتخاب اشتراک">' +
          plans.map((plan, i) => '<label class="sub-plan"><span><input type="radio" name="subscription-plan" value="' + i +
            '"' + (i === 0 ? ' checked' : '') + '> ' + esc(plan.name || plan.title) + '</span><span>' +
            (plan.newPriceRaw && plan.oldPriceRaw ? '<del>' + money(plan.oldPriceRaw) + '</del> ' : '') +
            '<strong>' + money(planPrice(plan)) + '</strong> <small>تومان</small></span></label>').join('') +
          '</div><p class="sub-tax-note">به مبلغ نهایی ۱۰٪ مالیات بر ارزش افزوده اضافه خواهد شد.</p>' +
          '<form class="sub-discount" id="sub-discount-form"><input name="code" placeholder="کد تخفیف یا هدیه" aria-label="کد تخفیف یا هدیه" maxlength="100" required><button type="submit">ثبت کد</button></form>' +
          '<p id="sub-discount-form-status" role="status"></p><div class="sub-summary"><dl>' +
          [['price','قیمت'],['discount','مبلغ کد تخفیف'],['vat','مالیات بر ارزش افزوده'],['total','جمع مبلغ قابل پرداخت']]
            .map(([key,label]) => '<div><dt>' + label + '</dt><dd data-total="' + key + '"></dd></div>').join('') +
          '</dl><button class="sub-pay" type="button" id="sub-pay">انتقال به درگاه پرداخت</button></div>';
        function render() {
          const price = planPrice(selected), taxable = Math.max(0, price - discount);
          const amounts = {price, discount, vat:taxable * .10, total:taxable * 1.10};
          Object.entries(amounts).forEach(([key,value]) => {
            $('[data-total="' + key + '"]').textContent = money(value) + ' تومان';
          });
        }
        function clearDiscount() {
          revision++;
          discount = 0;
          applied = '';
          $('#sub-discount-form-status').textContent = '';
          render();
        }
        document.querySelectorAll('[name=subscription-plan]').forEach(input => {
          input.onchange = () => { selected = plans[Number(input.value)]; clearDiscount(); };
        });
        $('#sub-discount-form input').oninput = clearDiscount;
        submit('sub-discount-form', async ({code}, output) => {
          const version = revision;
          const result = await api('/accounts/api/check-discount/', {body:{code:code.trim(),plan_id:selected.id}});
          if (seq !== state.sequence || version !== revision) return;
          discount = Math.min(planPrice(selected), Math.max(0, Number(result.discount) || 0));
          applied = code.trim();
          output.textContent = result.message || 'کد تخفیف ثبت شد.';
          render();
        });
        const pay = $('#sub-pay');
        pay.onclick = async () => {
          pay.disabled = true;
          try {
            const result = await native({action:'checkout',plan:Number(selected.id),discount:applied});
            if (!result.data?.opened) throw Error(result.data?.message || 'درگاه پرداخت باز نشد.');
          } catch (error) { toast(error.message); }
          finally { pay.disabled = false; }
        };
        render();
      });
    } catch (error) { whenCurrent(seq, () => fail($('#plans'), error)); }
  }
  const qualityChoices = [['AUTO','خودکار','بهترین کیفیت موجود'],['VeryHigh','1080p','Full HD'],
    ['High','720p','HD'],['Medium','480p','مصرف کمتر اینترنت'],['Low','360p','کمترین مصرف اینترنت']];
  const languageChoices = [['fa','فارسی','فارسی'],['en','انگلیسی','English'],['ar','عربی','العربية'],['ru','روسی','Русский']];
  const settingsArrow = '<svg aria-hidden="true" viewBox="0 0 24 24"><path d="m14 6-6 6 6 6"/></svg>';
  function settingsRow(label,href) {
    return '<a class="account-notice-row settings-row" href="' + href + '"><span>' + label + '</span>' + settingsArrow + '</a>';
  }
  function preferenceSheet({key,title,caption,choices,endpoint}) {
    const dialog = $('#settings-choice');
    const trigger = $('#settings-' + key);
    const selected = () => choices.find(([value]) => value === state.user[key]) || choices[0];
    trigger.querySelector('span').textContent = selected()[1];
    trigger.onclick = () => {
      dialog.innerHTML = '<div class="settings-sheet-handle" aria-hidden="true"></div><header><div><h2>' + title +
        '</h2>' + (caption ? '<p>' + caption + '</p>' : '') + '</div><button type="button" aria-label="بستن" data-choice-close>×</button></header>' +
        choices.map(([value,label,note]) => '<button type="button" class="settings-choice-option" data-choice="' + value +
          '" aria-pressed="' + (value === selected()[0]) + '"><span>' + label + '<small>' + note + '</small></span><i aria-hidden="true"></i></button>').join('') +
        (key === 'quality' ? '<p class="settings-choice-help">اگر کیفیت انتخابی موجود نباشد، نزدیک‌ترین کیفیت پایین‌تر پخش می‌شود.</p>' : '') +
        '<p class="settings-choice-error" role="status"></p>';
      dialog.showModal();
      dialog.querySelector('[data-choice-close]').onclick = () => closeWithMotion(dialog);
      const options = [...dialog.querySelectorAll('[data-choice]')];
      for (const button of options) button.onclick = async () => {
        const value = button.dataset.choice;
        if (value === selected()[0]) { dialog.close(); return; }
        options.forEach(option => { option.disabled = true; });
        try {
          const result = await api(endpoint, {body:{[key]:value}});
          if (result.success === false) throw Error(result.error || 'ذخیره نشد.');
          state.user[key] = result[key] || value;
          trigger.querySelector('span').textContent = selected()[1];
          dialog.close();
        } catch (error) { dialog.querySelector('.settings-choice-error').textContent = error.message; }
        finally { options.forEach(option => { option.disabled = false; }); }
      };
    };
  }
  async function settings(seq, params) {
    const section = params.get('section');
    if (section === 'following') {
      mount(shell('دنبال‌شده‌ها', '<p class="account-notice-row settings-follow-help">با اضافه‌شدن قسمت جدید یا اثری از افراد دنبال‌شده، در بخش اعلان‌ها باخبر می‌شوید.</p><div id="settings-follows"><p role="status">در حال دریافت…</p></div>'));
      $('.pwa-internal-head a').href = '#/settings';
      try {
        const data = await api('/api/app/v1/settings/');
        whenCurrent(seq, () => {
          $('#settings-follows').innerHTML = (data.following || []).map(item =>
            '<div class="account-notice-row settings-follow-row"><span>' + esc(item.name) +
            '</span><button type="button" class="settings-pill" aria-pressed="true" data-follow="' + esc(item.id) +
            '" data-kind="' + esc(item.kind) + '">' + PWA_SOURCE.detailFollow + ' دنبال‌کردن <span aria-hidden="true">✓</span></button></div>').join('') ||
            '<p class="account-reference-empty">هنوز کسی یا سریالی را دنبال نکرده‌اید.</p>';
          for (const button of document.querySelectorAll('[data-follow]')) button.onclick = async () => {
            const following = button.getAttribute('aria-pressed') !== 'true';
            button.disabled = true;
            try {
              const result = await api('/api/content-preferences/', {body:{kind:button.dataset.kind,id:Number(button.dataset.follow),following}});
              button.setAttribute('aria-pressed',String(result.following));
              button.querySelector('span').hidden = !result.following;
            } catch (error) { toast(error.message); }
            finally { button.disabled = false; }
          };
        });
      } catch (error) { whenCurrent(seq, () => fail($('#settings-follows'),error)); }
      return;
    }
    if (section === 'password') {
      mount(shell('تغییر رمز عبور', form('password', field('old_password','رمز فعلی','password','autocomplete="current-password"') +
        field('new_password','رمز جدید','password','autocomplete="new-password" minlength="8"') +
        field('confirm_password','تکرار رمز جدید','password','autocomplete="new-password" minlength="8"'),'تغییر رمز')));
      $('.pwa-internal-head a').href = '#/settings';
      submit('password', async (data, output) => { await api('/accounts/api/change-password/', {body:data}); $('#password').reset(); output.textContent = 'رمز تغییر کرد.'; });
      return;
    }
    mount(shell('تنظیمات', settingsRow('دنبال‌شده‌ها','#/settings?section=following') +
      '<button type="button" id="settings-spoiler" class="settings-pill" aria-pressed="false" disabled>' + PWA_SOURCE.detailSpoiler + ' بدون اسپویل</button>' +
      settingsRow('شماره تلفن','#/profile?field=phone') + settingsRow('تغییر رمز عبور','#/settings?section=password') + settingsRow('ایمیل','#/profile?field=email') +
      '<details class="settings-section"><summary>دستگاه‌های متصل</summary><div id="devices"><p role="status">در حال دریافت…</p></div></details>' +
      '<details class="settings-section"><summary>تنظیمات پخش و زبان</summary><p>کیفیت پیش‌فرض</p><button type="button" id="settings-quality" class="account-notice-row settings-row"><span></span>' + settingsArrow +
      '</button><p>زبان</p><button type="button" id="settings-language" class="account-notice-row settings-row"><span></span>' + settingsArrow +
      '</button></details><details class="settings-section"><summary>نمایش آفلاین</summary><button type="button" id="clear" class="account-notice-row settings-row">پاک کردن اطلاعات عمومی ذخیره‌شده</button></details>' +
      '<dialog id="settings-choice" aria-label="انتخاب تنظیمات"></dialog>'));
    const dialog = $('#settings-choice');
    dialog.onclick = event => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
    };
    $('#clear').onclick = async () => { await native({action:'clearCache'}); toast('اطلاعات عمومی پاک شد.'); };
    preferenceSheet({key:'quality',title:'کیفیت پخش',caption:'کیفیت پیش‌فرض فیلم‌ها و سریال‌ها',choices:qualityChoices,endpoint:'/accounts/api/update-player-quality/'});
    preferenceSheet({key:'language',title:'زبان',choices:languageChoices,endpoint:'/accounts/api/set-language/'});
    const spoiler = $('#settings-spoiler');
    api('/api/content-preferences/').then(data => whenCurrent(seq, () => {
      spoiler.setAttribute('aria-pressed',String(Boolean(data.spoiler_mode)));
      spoiler.disabled = false;
    })).catch(() => {});
    spoiler.onclick = async () => {
      spoiler.disabled = true;
      try {
        const data = await api('/api/content-preferences/', {body:{spoiler_mode:spoiler.getAttribute('aria-pressed') !== 'true'}});
        spoiler.setAttribute('aria-pressed',String(Boolean(data.spoiler_mode)));
      } catch (error) { toast(error.message); }
      finally { spoiler.disabled = false; }
    };
    try {
      const data = await api('/api/app/v1/settings/');
      whenCurrent(seq, () => {
        $('#devices').innerHTML = (data.devices || []).map(device =>
          '<article class="account-notice-row settings-device"><strong>' + esc(device.name) + '</strong>' +
          (device.last_activity ? '<time dir="ltr">' + esc(paymentDate(device.last_activity)) + ' ، ' + esc(device.last_activity.slice(11,19)) + '</time>' : '') +
          (device.current ? '<small>دستگاه فعلی</small>' : '<button type="button" data-device="' + esc(device.id) + '">خروج دستگاه</button>') + '</article>').join('') ||
          '<p class="account-reference-empty">دستگاه متصلی ثبت نشده است.</p>';
        for (const button of document.querySelectorAll('[data-device]')) button.onclick = async () => {
          button.disabled = true;
          try {
            await api('/accounts/api/devices/' + Number(button.dataset.device) + '/terminate/', {body:{}});
            button.closest('article').remove();
            if (!$('#devices').children.length) $('#devices').textContent = 'دستگاه متصلی ثبت نشده است.';
          } catch (error) { toast(error.message); button.disabled = false; }
        };
      });
    } catch (error) { whenCurrent(seq, () => fail($('#devices'),error)); }
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
    return Promise.all([refreshRooms(), searchMovies('')]);
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
  let previousRoute;
  async function route() {
    const loader = $('#route-loading');
    loader.hidden = true;
    app.classList.remove('route-enter');
    historyFrameObserver?.disconnect();
    PWAPlayer.close();
    document.querySelectorAll('.dm-inline-trailer').forEach(player => player.dmDispose?.());
    document.getElementById('dm-playback-choice')?.dispatchEvent(new Event('cancel'));
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
    if (state.checkingSession || (!state.sessionKnown && !state.user)) {
      PWA.page('startup');
      const content = state.checkingSession
        ? '<div class="startup-progress" role="status"><span>loading...</span><i aria-hidden="true"></i></div>'
        : '<p role="status">وضعیت ورود بررسی نشد. اتصال اینترنت را بررسی کنید.</p><button id="retry-session" type="button">تلاش دوباره</button>';
      mount('<section class="local-startup' + (state.checkingSession ? ' local-startup-active' : '') + '"><img src="assets/logo.svg" alt="دیاستومی">' + content + '</section>');
      const retry = $('#retry-session');
      if (retry) retry.onclick = checkStartupSession;
      return;
    }
    if (!state.user && !['login','otp','forgot'].includes(name)) {
      state.nextAfterLogin = '#/' + hash.replace(/^\//, '');
      history.replaceState(null, '', '#/login');
      return route();
    }
    const animateRoute = path !== previousRoute;
    previousRoute = path;
    const loadingTimer = animateRoute && !['login','otp','forgot'].includes(name)
      ? setTimeout(() => whenCurrent(seq, () => { if (!document.activeElement?.matches('.reference-search-form input')) loader.hidden = false; }), 100) : null;
    PWA.page(name);
    document.querySelectorAll('nav a').forEach(a => a.classList.toggle('active', a.dataset.tab === name));
    window.scrollTo(0,0);
    try {
      if (name === 'home') await home(seq);
      else if (name === 'browse') await browse(seq, parts[1] || 'all', params);
      else if (name === 'search') await searchPage(seq, params.get('q') || '');
      else if (name === 'title') await detail(seq, parts[1], parts[2]);
      else if (name === 'actors' || name === 'actor') await actors(seq, parts[1], parts[2]);
      else if (name === 'library') await library(seq, params);
      else if (name === 'login') login();
      else if (name === 'otp') otp(params);
      else if (name === 'forgot') forgot();
      else if (name === 'account') account();
      else if (name === 'profile') {
        profile();
        const field = params.get('field');
        if (field === 'phone' || field === 'email') {
          $('.profile-editor header a').href = '#/settings';
          $('#edit-profile [name="' + field + '"]')?.scrollIntoView({block:'center'});
        }
      }
      else if (name === 'payments') await payments(seq);
      else if (name === 'notifications') await notifications(seq, params);
      else if (name === 'support') await support(seq);
      else if (name === 'subscription') await subscription(seq);
      else if (name === 'rooms') await rooms(seq);
      else if (name === 'room') await room(seq, parts[1]);
      else if (name === 'settings') await settings(seq, params);
      else if (name === 'about') mount(shell('دربارهٔ دیاستومی', '<div class="panel"><img class="logo" src="assets/logo.svg" alt="دیاستومی"><p>نسخهٔ ۲٫۱٫۴۳ — رابط نصب‌شده روی دستگاه</p><p>صفحات و فایل‌های برنامه محلی هستند. اطلاعات حساب، فهرست محتوا، پوسترها و ویدیوها از سرور دریافت می‌شوند.</p></div>'));
      else mount(shell('صفحه پیدا نشد', empty('از منوی برنامه صفحهٔ مورد نظر را انتخاب کنید.')));
    } catch (error) { whenCurrent(seq, () => mount(shell('خطا', empty(error.message)))); }
    finally {
      clearTimeout(loadingTimer);
      whenCurrent(seq, () => {
        loader.hidden = true;
        if (animateRoute) app.classList.add('route-enter');
      });
    }
  }
  document.addEventListener('click', async e => {
    const button = e.target.closest('[data-play]');
    if (!button) return;
    button.disabled = true;
    try {
      const kind = button.dataset.kind;
      let id = Number(button.dataset.play);
      const targetQuality = {VeryHigh:1080,High:720,Medium:480,Low:360}[state.user?.quality];
      if (targetQuality && !button.dataset.room) {
        const variants = (state.playGroups || []).find(options => options.some(option => Number(option.id) === id));
        const ranked = (variants || []).map(option => ({id:Number(option.id), height:parseInt(option.quality,10)}))
          .filter(option => Number.isFinite(option.height)).sort((a,b) => b.height-a.height);
        id = (ranked.find(option => option.height <= targetQuality) || ranked.at(-1))?.id || id;
      }
      const room = button.dataset.room;
      const sequence = state.sequence;
      const response = await native({ action: 'play', kind, id, room, inline: true });
      if (response.status !== 200) throw new Error(response.data.error || 'پخش ممکن نشد.');
      if (sequence === state.sequence) {
        if (!response.data.url) throw new Error('آدرس پخش در دسترس نیست.');
        const groups = state.playGroups || [];
        const group = groups.findIndex(options => options.some(option => Number(option.id) === id));
        const position = Number(response.data.position) || 0;
        const start = button.hasAttribute('data-resume') || room || position <= 0 ? position : await PWAPlayer.chooseResume(position);
        if (start === null || sequence !== state.sequence) return;
        document.querySelectorAll('.dm-inline-trailer').forEach(player => player.dmDispose?.());
        PWAPlayer.open({
          info:{...response.data, position:start}, groups, group, kind, id, room, native, onError:toast,
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
  async function checkStartupSession() {
    state.checkingSession = true;
    route();
    await refreshSession();
    state.checkingSession = false;
    if (state.user && (!location.hash || location.hash === '#/login')) history.replaceState(null, '', '#/home');
    route();
  }
  document.addEventListener('click', event => {
    if (event.target.closest('.dmf3-filter')) { openFilters(); return; }
    if (!event.target.closest('[data-local-search]') || !state.user) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    history.pushState(null, '', '#/search');
    route();
    document.querySelector('.reference-search-form input')?.focus();
  });
  PWA.install();
  checkStartupSession();
})();
