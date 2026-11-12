/* Locally packaged PWA-style HLS controls. The native bridge authorizes each source. */
window.PWAPlayer = (() => {
  let closeCurrent;
  const icons = window.PWA_PLAYER_ICONS;
  const format = seconds => {
    const total = Math.max(0, Math.floor(seconds || 0));
    const part = value => String(value).padStart(2, '0');
    return (total >= 3600 ? Math.floor(total / 3600) + ':' : '') +
      (total < 3600 ? Math.floor(total / 60) : part(Math.floor(total / 60) % 60)) + ':' + part(total % 60);
  };
  function close() { if (closeCurrent) closeCurrent(); }
  function chooseResume(position) {
    document.getElementById('dm-playback-choice')?.dispatchEvent(new Event('cancel'));
    const dialog = document.createElement('div');
    dialog.id = 'dm-playback-choice';
    dialog.dir = 'rtl';
    dialog.innerHTML = '<section role="dialog" aria-modal="true" aria-labelledby="dm-resume-title">' +
      '<button type="button" data-resume-close aria-label="بستن">×</button>' +
      '<h2 id="dm-resume-title">از ابتدا می‌بینید یا ادامه؟</h2><p></p>' +
      '<div class="dm-resume-actions"><button type="button" data-resume-restart>پخش از ابتدا</button>' +
      '<button type="button" data-resume-continue>پخش ادامه</button></div></section>';
    dialog.querySelector('p').textContent = 'قبلاً تا زمان ' + format(position) + ' تماشا کرده‌اید.';
    document.body.append(dialog);
    return new Promise(resolve => {
      const finish = value => { dialog.remove(); resolve(value); };
      dialog.addEventListener('cancel', () => finish(null));
      dialog.onkeydown = event => { if (event.key === 'Escape') finish(null); };
      dialog.onclick = event => {
        if (event.target === dialog || event.target.closest('[data-resume-close]')) finish(null);
        else if (event.target.closest('[data-resume-restart]')) finish(0);
        else if (event.target.closest('[data-resume-continue]')) finish(position);
      };
      dialog.querySelector('[data-resume-continue]').focus({preventScroll:true});
    });
  }
  function open({info, groups, group, kind, id, room, native, save, onError}) {
    close();
    const overlay = document.createElement('section');
    overlay.className = 'local-pwa-player';
    overlay.setAttribute('aria-label', 'پلیر فیلم');
    const control = (action, title, icon) => '<button type="button" data-player="' + action + '" aria-label="' + title + '">' + icons[icon] + '</button>';
    overlay.innerHTML = '<video playsinline webkit-playsinline></video><div class="local-player-dim"></div><div class="local-player-top">' +
      '<button type="button" data-player="close" aria-label="بازگشت"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 19l-7-7m0 0l7-7m-7 7h18"/></svg></button><h2></h2>' +
      control('rotate','چرخش تصویر','player-phone-rotate') + '</div>' +
      '<label class="local-player-side local-player-brightness"><span aria-hidden="true">☼</span><input type="range" min="0" max="1" value="1" step=".01" aria-label="روشنایی تصویر"></label>' +
      '<label class="local-player-side local-player-volume">' + icons.volume + '<input type="range" min="0" max="1" value="1" step=".01" aria-label="بلندی صدا"></label>' +
      '<div class="local-player-center">' + control('toggle','پخش یا توقف','play') + '</div><div class="local-player-bottom"><div class="local-player-bar">' +
      control('back','۱۰ ثانیه عقب','backward') + control('toggle','پخش یا توقف','play') + control('forward','۱۰ ثانیه جلو','forward') +
      '<div class="local-player-timeline"><div><output>0:00</output><output>0:00</output></div><input type="range" min="0" max="0" value="0" step=".1" aria-label="موقعیت پخش"></div>' +
      (kind === 'series' ? control('next','قسمت بعد','forward') : '') + control('captions','زیرنویس','captions') + control('audio','زبان صدا','microphone') + control('settings','تنظیمات پخش','setting-2') + control('fullscreen','تمام‌صفحه','fullscreen') +
      '</div></div><div class="local-player-settings dm-ref-settings" hidden></div><div class="local-player-error" hidden role="alert"><p>پخش ویدیو در این حالت ممکن نشد.</p><button type="button" data-player="retry">تلاش دوباره</button></div>';
    const get = selector => overlay.querySelector(selector);
    const video = get('video');
    const seek = get('.local-player-timeline input');
    const settings = get('.local-player-settings');
    let source = info, selected = id, revision = 0, resume = Number(info.position) || 0, lastSaved = 0, played = false;
    const updateTransport = paused => {
      overlay.classList.toggle('local-player-playing', !paused);
      overlay.querySelectorAll('[data-player=toggle]').forEach(button => { button.innerHTML = paused ? icons.play : icons.pause; });
    };
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
        controlSurface('volume', Number(volume.value)).catch(() => {});
        if (video.muted) controlSurface('mute').catch(() => {});
        const sync = async () => {
          try {
            const state = await controlSurface('status');
            if (!overlay.isConnected || request !== revision || !surface || !state.ok) return;
            lastState = state;
            updateTransport(state.paused);
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
    const brightness = get('.local-player-brightness input');
    brightness.oninput = () => get('.local-player-dim').style.opacity = 1 - Number(brightness.value);
    const volume = get('.local-player-volume input');
    volume.oninput = () => {
      const level = Number(volume.value);
      video.volume = level;
      if (surface) controlSurface('volume', level).catch(() => {});
    };
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
      const [elapsed, end] = overlay.querySelectorAll('output');
      elapsed.textContent = format(time());
      end.textContent = format(total);
      seek.style.setProperty('--played', (total ? Number(seek.value) / total * 100 : 0) + '%');
      progress(false);
    }
    function sourceChanged(next, position) {
      stopSurface();
      source = next;
      resume = position;
      played = false;
      get('.local-player-error').hidden = true;
      video.src = next.url;
      video.playbackRate = playbackRate;
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
      if (settings.dataset.panel === 'settings') select('کیفیت پخش', (groups[group] || []).map(v => [v.id,v.quality]), selected,
        value => changeSource(Number(value), group));
      if (settings.dataset.panel === 'settings') select('سرعت پخش', [.5,.75,1,1.25,1.5,2].map(rate => [rate,rate + '×']), playbackRate, value => { playbackRate = Number(value); video.playbackRate = playbackRate; if (surface) controlSurface('rate', playbackRate).catch(() => {}); });
      if (settings.dataset.panel === 'settings') return;
      if (surface) {
        settings.textContent = 'این گزینه برای منبع فعلی در دسترس نیست.';
        return;
      }
      const audio = Array.from(video.audioTracks || []);
      if (settings.dataset.panel === 'audio') select('زبان صدا', audio.map((track,i) => [i,track.label || track.language || String(i+1)]),
        audio.findIndex(track => track.enabled), value => audio.forEach((track,i) => { track.enabled = i === Number(value); }));
      const captions = Array.from(video.textTracks || []).filter(track => ['captions','subtitles'].includes(track.kind));
      if (settings.dataset.panel === 'captions' && captions.length) select('زیرنویس', [[-1,'خاموش'], ...captions.map((track,i) => [i,track.label || track.language || String(i+1)])],
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
    video.addEventListener('click', () => get('.local-player-center button').click());
    video.addEventListener('play', () => { played = true; updateTransport(false); });
    video.addEventListener('pause', () => { updateTransport(true); });
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
        case 'captions':
        case 'audio':
        case 'settings': {
          const panel = button.dataset.player;
          settings.hidden = !settings.hidden && settings.dataset.panel === panel;
          settings.dataset.panel = panel;
          if (!settings.hidden) renderSettings();
          break;
        }
        case 'fullscreen':
        case 'rotate': {
          const rotated = overlay.classList.toggle('local-player-rotated');
          if (surface) await controlSurface('rotate', rotated);
          break;
        }
        case 'retry':
          revision++;
          sourceChanged(source, time() || resume);
          break;
      }
    };
    overlay.classList.toggle('local-player-rotated', matchMedia('(orientation: portrait)').matches);
    document.body.append(overlay);
    document.body.classList.add('local-player-open');
    updateNext();
    sourceChanged(info, resume);
  }
  return {open,close,chooseResume};
})();
