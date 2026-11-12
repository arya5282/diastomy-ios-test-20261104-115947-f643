/* Locally packaged PWA-style HLS controls. The native bridge authorizes each source. */
window.PWAPlayer = (() => {
  let closeCurrent;
  const icons = window.PWA_PLAYER_ICONS;
  const format = seconds => {
    const total = Math.max(0, Math.floor(seconds || 0));
    const part = value => String(value).padStart(2, '0');
    return (total >= 3600 ? Math.floor(total / 3600) + ':' : '') +
      part(Math.floor(total / 60) % 60) + ':' + part(total % 60);
  };
  function close() { if (closeCurrent) closeCurrent(); }
  function open({info, groups, group, kind, id, room, native, save, onError}) {
    close();
    const overlay = document.createElement('section');
    overlay.className = 'local-pwa-player';
    overlay.setAttribute('aria-label', 'پلیر فیلم');
    const control = (action, title, icon) => '<button type="button" data-player="' + action + '" aria-label="' + title + '">' + icons[icon] + '</button>';
    overlay.innerHTML = '<video playsinline></video><div class="local-player-top">' +
      '<button type="button" data-player="close" aria-label="بازگشت"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 19l-7-7m0 0l7-7m-7 7h18"/></svg></button><h2></h2>' +
      control('fullscreen','چرخش و تمام‌صفحه','player-phone-rotate') + '</div><div class="local-player-center">' +
      control('back','۱۰ ثانیه عقب','skip-back') + control('toggle','پخش یا توقف','play') +
      control('forward','۱۰ ثانیه جلو','skip-forward') + '</div><div class="local-player-bottom">' +
      '<input type="range" min="0" max="0" value="0" step=".1" aria-label="موقعیت پخش"><div class="local-player-bar"><output>00:00 / 00:00</output>' +
      (kind === 'series' ? control('next','قسمت بعد','forward') : '') + control('mute','قطع یا وصل صدا','volume') + control('settings','تنظیمات پخش','setting-2') + control('fullscreen','تمام‌صفحه','fullscreen') +
      '</div></div><div class="local-player-settings dm-ref-settings" hidden></div><div class="local-player-error" hidden role="alert"><p>پخش ویدیو در این حالت ممکن نشد.</p><button type="button" data-player="retry">تلاش دوباره</button></div>';
    const get = selector => overlay.querySelector(selector);
    const video = get('video');
    const seek = get('input');
    const settings = get('.local-player-settings');
    let source = info, selected = id, revision = 0, resume = Number(info.position) || 0, lastSaved = 0, played = false;
    let surface, surfaceStarting = false, polling, lastState, playbackRate = 1;
    const controlSurface = (command, value) => native({action:'inlineControl',command,value});
    const time = () => surface ? lastState?.position || 0 : video.currentTime;
    const duration = () => surface ? lastState?.duration || 0 : video.duration;
    function setTime(value) {
      if (surface) controlSurface('seek', value).catch(() => {});
      else video.currentTime = value;
    }
    function stopSurface() {
      if (surface || surfaceStarting) controlSurface('stop').catch(() => {});
      clearInterval(polling);
      surface = false;
      surfaceStarting = false;
      lastState = null;
      overlay.classList.remove('local-player-native');
      document.body.classList.remove('local-player-native-open');
    }
    async function startSurface() {
      if (surface || surfaceStarting) return;
      if (kind === 'trailer') { get('.local-player-error').hidden = false; return; }
      const request = revision;
      surfaceStarting = true;
      try {
        const response = await native({action:'play',inline:true,surface:true,kind,room,id:selected,position:time() || resume});
        if (!overlay.isConnected || request !== revision) return;
        if (!response.data?.surface) throw Error('پخش ویدیو ممکن نشد.');
        surface = true;
        played = true;
        overlay.classList.add('local-player-native');
        document.body.classList.add('local-player-native-open');
        await controlSurface('rotate', overlay.classList.contains('local-player-rotated'));
        if (!overlay.isConnected || request !== revision) return;
        controlSurface('rate', playbackRate).catch(() => {});
        if (video.muted) controlSurface('mute').catch(() => {});
        const sync = async () => {
          try {
            const state = await controlSurface('status');
            if (!overlay.isConnected || request !== revision || !surface || !state.ok) return;
            lastState = state;
            get('[data-player=toggle]').innerHTML = state.paused ? icons.play : icons.pause;
            if (state.failed) { clearInterval(polling); get('.local-player-error').hidden = false; }
            refresh();
          } catch (_) {}
        };
        polling = setInterval(sync, 500);
        sync();
        if (!settings.hidden) renderSettings();
      } catch (_) {
        if (overlay.isConnected && request === revision) get('.local-player-error').hidden = false;
      } finally {
        if (request === revision) surfaceStarting = false;
      }
    }
    get('h2').textContent = info.title || '';
    function progress(force) {
      if (!played || !Number.isFinite(duration()) || duration() <= 0 || !source.target) return;
      if (!force && Date.now() - lastSaved < 15000) return;
      lastSaved = Date.now();
      save({...source.target, watched_duration:Math.floor(time()), total_duration:Math.floor(duration())});
    }
    function refresh() {
      const total = Number.isFinite(duration()) ? duration() : 0;
      seek.max = total;
      seek.value = time() || 0;
      get('output').textContent = format(time()) + ' / ' + format(total);
      progress(false);
    }
    function sourceChanged(next, position) {
      stopSurface();
      source = next;
      resume = position;
      played = false;
      get('.local-player-error').hidden = true;
      video.src = next.url;
      video.play().catch(() => {});
    }
    async function changeSource(id, nextGroup) {
      const request = ++revision;
      try {
        const response = await native({action:'play',inline:true,kind,room,id});
        if (!overlay.isConnected || request !== revision) return;
        if (response.status !== 200 || !response.data.url) throw Error(response.data.error || 'منبع در دسترس نیست.');
        progress(true);
        const position = nextGroup === group ? time() : Number(response.data.position) || 0;
        selected = id;
        group = nextGroup;
        sourceChanged(response.data, position);
        updateNext();
      } catch (error) { if (overlay.isConnected && request === revision) { onError(error.message); renderSettings(); } }
    }
    function updateNext() {
      const next = get('[data-player=next]');
      if (next) next.hidden = group < 0 || !(groups[group + 1] || []).length;
    }
    function renderSettings() {
      settings.replaceChildren();
      const select = (title, entries, current, change) => {
        if (!entries.length) return;
        const row = document.createElement('label');
        row.textContent = title;
        const input = document.createElement('select');
        for (const [value, label] of entries) input.add(new Option(label, value));
        input.value = current;
        input.onchange = () => change(input.value);
        row.append(input);
        settings.append(row);
      };
      select('کیفیت پخش', (groups[group] || []).map(v => [v.id,v.quality]), selected,
        value => changeSource(Number(value), group));
      select('سرعت پخش', [.5,.75,1,1.25,1.5,2].map(rate => [rate,rate + '×']), playbackRate, value => { playbackRate = Number(value); video.playbackRate = playbackRate; if (surface) controlSurface('rate', playbackRate).catch(() => {}); });
      if (surface) return;
      const audio = Array.from(video.audioTracks || []);
      select('زبان صدا', audio.map((track,i) => [i,track.label || track.language || String(i+1)]),
        audio.findIndex(track => track.enabled), value => audio.forEach((track,i) => { track.enabled = i === Number(value); }));
      const brightness = document.createElement('label');
      brightness.textContent = 'روشنایی تصویر';
      const level = document.createElement('input');
      level.type = 'range';
      level.min = 35;
      level.max = 100;
      level.value = video.dataset.brightness || 100;
      level.oninput = () => {
        video.dataset.brightness = level.value;
        video.style.filter = 'brightness(' + Number(level.value) / 100 + ')';
      };
      brightness.append(level);
      settings.append(brightness);
      const captions = Array.from(video.textTracks || []).filter(track => ['captions','subtitles'].includes(track.kind));
      if (captions.length) select('زیرنویس', [[-1,'خاموش'], ...captions.map((track,i) => [i,track.label || track.language || String(i+1)])],
        captions.findIndex(track => track.mode === 'showing'), value => captions.forEach((track,i) => { track.mode = i === Number(value) ? 'showing' : 'disabled'; }));
    }
    function dismiss() {
      progress(true);
      closeCurrent = null;
      revision++;
      stopSurface();
      video.pause();
      video.removeAttribute('src');
      video.load();
      overlay.remove();
      document.body.classList.remove('local-player-open');
    }
    closeCurrent = dismiss;
    video.addEventListener('loadedmetadata', () => {
      if (resume > 0 && Number.isFinite(video.duration)) video.currentTime = Math.min(resume, video.duration);
      resume = 0;
      refresh();
      if (!settings.hidden) renderSettings();
    });
    video.addEventListener('timeupdate', refresh);
    video.addEventListener('play', () => { played = true; get('[data-player=toggle]').innerHTML = icons.pause; });
    video.addEventListener('pause', () => { get('[data-player=toggle]').innerHTML = icons.play; });
    video.addEventListener('error', () => { if (overlay.isConnected) startSurface(); });
    seek.oninput = () => { if (Number.isFinite(duration())) setTime(Number(seek.value)); };
    overlay.onclick = async event => {
      const button = event.target.closest('[data-player]');
      if (!button) return;
      switch (button.dataset.player) {
        case 'close': dismiss(); break;
        case 'back': setTime(Math.max(0, time() - 10)); break;
        case 'forward': if (Number.isFinite(duration())) setTime(Math.min(duration(), time() + 10)); break;
        case 'mute':
          if (surface) { const state = await controlSurface('mute'); button.setAttribute('aria-pressed', String(state.muted)); break; }
          video.muted = !video.muted;
          button.setAttribute('aria-pressed', String(video.muted));
          break;
        case 'toggle': if (surface) await controlSurface('toggle'); else if (video.paused) video.play().catch(() => {}); else video.pause(); break;
        case 'next': {
          const next = groups[group + 1]?.[0];
          if (next) await changeSource(Number(next.id), group + 1);
          break;
        }
        case 'settings': settings.hidden = !settings.hidden; if (!settings.hidden) renderSettings(); break;
        case 'fullscreen':
          if (surface) { await controlSurface('rotate', overlay.classList.toggle('local-player-rotated')); break; }
          if (document.fullscreenElement) await document.exitFullscreen();
          else if (overlay.requestFullscreen) await overlay.requestFullscreen().catch(() => overlay.classList.toggle('local-player-rotated'));
          else overlay.classList.toggle('local-player-rotated');
          break;
        case 'retry':
          revision++;
          sourceChanged(source, time() || resume);
          break;
      }
    };
    document.body.append(overlay);
    document.body.classList.add('local-player-open');
    updateNext();
    sourceChanged(info, resume);
  }
  return {open,close};
})();
