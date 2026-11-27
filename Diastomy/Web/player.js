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
      '<button type="button" data-resume-close aria-label="بازگشت">' + PWA_SOURCE.actorBack + '</button>' +
      '<h2 id="dm-resume-title">ادامهٔ تماشا</h2><p>آخرین موقعیت پخش <bdi dir="ltr"></bdi></p>' +
      '<div class="dm-resume-actions"><button type="button" data-resume-continue>ادامهٔ پخش</button>' +
      '<button type="button" data-resume-restart>پخش از ابتدا</button></div></section>';
    dialog.querySelector('bdi').textContent = format(position);
    const previousFocus = document.activeElement;
    document.body.append(dialog);
    return new Promise(resolve => {
      let finishing = false;
      const finish = (value, immediate = false) => {
        if (finishing) {
          if (immediate) dialog.remove();
          return;
        }
        finishing = true;
        const remove = () => {
          const attached = dialog.isConnected;
          dialog.remove();
          if (value === null && attached) previousFocus?.focus({preventScroll:true});
          resolve(value);
        };
        if (immediate || matchMedia('(prefers-reduced-motion: reduce)').matches || !dialog.animate) {
          remove();
          return;
        }
        dialog.inert = true;
        const panel = dialog.querySelector('[role=dialog]');
        panel.animate([{translate:'none'}, {translate:'0 6px'}], {duration:125,fill:'forwards'});
        dialog.animate([{opacity:1}, {opacity:0}], {duration:125,fill:'forwards'}).finished.then(remove, remove);
      };
      dialog.addEventListener('cancel', () => finish(null, true));
      dialog.onkeydown = event => { if (event.key === 'Escape') finish(null); };
      dialog.onclick = event => {
        if (event.target === dialog || event.target.closest('[data-resume-close]')) finish(null);
        else if (event.target.closest('[data-resume-restart]')) finish(0);
        else if (event.target.closest('[data-resume-continue]')) finish(position);
      };
      dialog.querySelector('[data-resume-continue]').focus({preventScroll:true});
    });
  }
  function open({info, groups, group, kind, id, room, roomControl, onClose, initialVolume = 1, roomSubtitleMode, roomAudio, native, save, onError}) {
    close();
    const overlay = document.createElement('section');
    overlay.className = 'local-pwa-player';
    if (room) overlay.classList.add('local-player-room');
    overlay.setAttribute('aria-label', 'پلیر فیلم');
    const control = (action, title, icon) => '<button type="button" data-player="' + action + '" aria-label="' + title + '">' + icons[icon] + '</button>';
    overlay.innerHTML = '<video playsinline webkit-playsinline></video><div class="local-player-dim"></div><div class="local-player-top">' +
      '<button type="button" data-player="close" aria-label="بازگشت"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M21 12H3m7-7-7 7 7 7"/></svg></button>' +
      '<div class="local-player-title"><h2></h2><p hidden></p></div>' + control('rotate','چرخش تصویر','player-phone-rotate') + '</div>' +
      '<label class="local-player-side local-player-brightness"><span aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="4"/><path d="M12 1v3m0 16v3M1 12h3m16 0h3M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/></svg></span><input type="range" min="0" max="1" value="1" step=".01" aria-label="روشنایی تصویر"><span class="local-player-brightness-track" aria-hidden="true"><i></i></span></label>' +
      '<label class="local-player-side local-player-volume">' + icons.volume + '<input type="range" min="0" max="1" value="1" step=".01" aria-label="بلندی صدا"></label>' +
      '<div class="local-player-center">' + control('toggle','پخش یا توقف','play') + '</div>' +
      '<div class="local-player-loading" data-phase="refreshing" role="status" dir="rtl" hidden>' + PWA.activityIndicator() +
      '<span>در حال بارگذاری ویدیو…</span></div>' +
      '<div class="local-player-caption-status" role="status" dir="rtl" hidden></div><div class="local-player-bottom"><div class="local-player-bar">' +
      control('back','۱۰ ثانیه عقب','backward') + control('toggle','پخش یا توقف','play') + control('forward','۱۰ ثانیه جلو','forward') +
      '<div class="local-player-timeline"><div><output>0:00</output><output>0:00</output></div><div class="local-player-seek"><span aria-hidden="true"></span><input type="range" min="0" max="0" value="0" step=".1" aria-label="موقعیت پخش" disabled></div></div>' +
      (kind === 'series' ? control('next','قسمت بعد','forward') : '') + control('captions','زیرنویس','captions') + control('audio','زبان صدا','microphone') + control('settings','تنظیمات پخش','setting-2') + control('fullscreen','پر کردن صفحه','fullscreen') +
      '</div></div><div class="local-player-settings dm-ref-settings" hidden></div><div class="local-player-error" hidden role="alert"><p>پخش ویدیو در این حالت ممکن نشد.</p><button type="button" data-player="retry">تلاش دوباره</button></div>';
    const get = selector => overlay.querySelector(selector);
    const video = get('video');
    const seek = get('.local-player-timeline input');
    const timelineFill = get('.local-player-seek > span');
    const [elapsed, end] = overlay.querySelectorAll('output');
    const settings = get('.local-player-settings');
    settings.addEventListener('click', event => event.stopPropagation());
    let source = info, selected = id, revision = 0, resume = Number(info.position) || 0, lastSaved = 0, played = false;
    const updateTransport = paused => {
      overlay.classList.toggle('local-player-playing', !paused);
      overlay.querySelectorAll('[data-player=toggle]').forEach(button => {
        button.innerHTML = paused ? icons.play : icons.pause;
        button.setAttribute('aria-label', paused ? 'پخش' : 'توقف');
      });
    };
    let surface, surfaceStarting = false, polling, startupCheck, lastState, playbackRate = 1;
    const sizes = {small:'0.8em',normal:'1em',large:'1.3em'};
    const colors = {white:'#fff',yellow:'#ffe043',cyan:'#7bedff'};
    let captionStyle = {size:'normal',color:'white',background:true};
    try {
      const saved = JSON.parse(localStorage.getItem('diastomy-caption-style'));
      if (saved && Object.hasOwn(sizes,saved.size) && Object.hasOwn(colors,saved.color) && typeof saved.background === 'boolean') captionStyle = saved;
    } catch (_) {}
    function applyCaptionStyle() {
      overlay.style.setProperty('--caption-size', sizes[captionStyle.size]);
      overlay.style.setProperty('--caption-color', colors[captionStyle.color]);
      overlay.style.setProperty('--caption-background', captionStyle.background ? '#000c' : 'transparent');
      if (surface) controlSurface('captionStyle', captionStyle).catch(() => {});
    }
    function setCaptionStyle(key, value) {
      captionStyle[key] = value;
      try { localStorage.setItem('diastomy-caption-style', JSON.stringify(captionStyle)); } catch (_) {}
      applyCaptionStyle();
    }
    const loading = get('.local-player-loading');
    const captionStatus = get('.local-player-caption-status');
    let captionNoticeTimer;
    let captionChange = 0;
    function setLoading(active) {
      loading.hidden = !active;
      get('.local-player-center').classList.toggle('local-player-center-loading', active);
    }
    function playbackFailed() {
      setLoading(false);
      get('.local-player-error').hidden = false;
    }
    function captionNotice(message) {
      clearTimeout(captionNoticeTimer);
      captionStatus.textContent = message;
      captionStatus.hidden = false;
      captionNoticeTimer = setTimeout(() => { captionStatus.hidden = true; }, 2500);
    }
    let scrubbing = false;
    let pendingSeek;
    const controlSurface = (command, value) => native({action:'inlineControl',command,value});
    const time = () => surface ? lastState?.position || 0 : video.currentTime;
    const duration = () => surface ? lastState?.duration || 0 : video.duration;
    function setTime(value) {
      const total = duration();
      if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(value)) return;
      const target = Math.max(0, Math.min(total, value));
      if (room) { roomControl?.('seek', target); return; }
      const request = pendingSeek = {value:target, expires:performance.now() + 2200};
      paintTimeline(target, total);
      if (surface) controlSurface('seek', target).then(result => {
        if (!result.ok && pendingSeek === request) pendingSeek = null;
      }).catch(() => { if (pendingSeek === request) pendingSeek = null; });
      else video.currentTime = target;
    }
    function stopSurface() {
      clearTimeout(startupCheck);
      if (surface || surfaceStarting) controlSurface('stop').catch(() => {});
      clearInterval(polling);
      surface = false;
      surfaceStarting = false;
      lastState = null;
      pendingSeek = null;
      scrubbing = false;
      overlay.classList.remove('local-player-native');
      document.body.classList.remove('local-player-native-open');
    }
    async function startSurface() {
      if (surface || surfaceStarting) return;
      if (kind === 'trailer') { playbackFailed(); return; }
      const request = revision;
      const position = time() || resume;
      surfaceStarting = true;
      setLoading(true);
      try {
        const response = await native({action:'play',inline:true,surface:true,kind,room,id:selected,position});
        if (!overlay.isConnected || request !== revision) return;
        if (!response.data?.surface) throw Error('پخش ویدیو ممکن نشد.');
        surface = true;
        clearTimeout(startupCheck);
        video.pause();
        video.removeAttribute('src');
        video.load();
        overlay.classList.add('local-player-native');
        document.body.classList.add('local-player-native-open');
        await controlSurface('rotate', overlay.classList.contains('local-player-rotated'));
        if (!overlay.isConnected || request !== revision) return;
        controlSurface('rate', playbackRate).catch(() => {});
        applyCaptionStyle();
        controlSurface('volume', Number(volume.value)).catch(() => {});
        controlSurface('fill', overlay.classList.contains('local-player-fill')).catch(() => {});
        if (video.muted) controlSurface('mute').catch(() => {});
        const frameDeadline = Date.now() + 30000;
        let pendingRoomSubtitle = roomSubtitleMode !== undefined;
        let pendingRoomAudio = Number.isInteger(roomAudio);
        const sync = async () => {
          try {
            const selection = captionChange;
            const state = await controlSurface('status');
            if (!overlay.isConnected || request !== revision || !surface || !state.ok) return;
            if (captionChange !== selection || captionButton.disabled) return;
            const optionsChanged = (lastState?.captions?.length || 0) !== (state.captions?.length || 0) ||
              (lastState?.audio?.length || 0) !== (state.audio?.length || 0);
            lastState = state;
            if (pendingRoomSubtitle && state.captions?.length) {
              pendingRoomSubtitle = false;
              const index = state.captions.indexOf(roomSubtitleMode);
              selectNativeCaption(roomSubtitleMode === 'off' ? -1 : index < 0 ? undefined : index);
            }
            if (pendingRoomAudio && state.audio?.length) {
              pendingRoomAudio = false;
              if (state.audio[roomAudio] && roomAudio !== state.selectedAudio) controlSurface('audio', roomAudio).catch(() => {});
            }
            syncCaptionButton();
            const firstFrame = state.frameReady && !played;
            if (state.frameReady) played = true;
            updateTransport(state.paused || !state.frameReady);
            if (state.failed || (!played && Date.now() > frameDeadline)) {
              clearInterval(polling);
              playbackFailed();
            } else {
              setLoading(!state.frameReady || state.buffering === true);
            }
            refresh();
            if (settings.dataset.panel && (optionsChanged || (firstFrame && settings.dataset.panel === 'captions'))) renderSettings();
          } catch (_) {}
        };
        polling = setInterval(sync, 500);
        sync();
        if (!settings.hidden) renderSettings();
      } catch (_) {
        if (overlay.isConnected && request === revision) playbackFailed();
      } finally {
        if (request === revision) surfaceStarting = false;
      }
    }
    const brightness = get('.local-player-brightness input');
    function paintLevel(input) { input.style.setProperty('--played', Number(input.value) * 100 + '%'); }
    brightness.oninput = () => {
      const level = Number(brightness.value);
      brightness.parentElement.style.setProperty('--played', level * 100 + '%');
      brightness.parentElement.style.setProperty('--brightness-level', level);
      get('.local-player-dim').style.opacity = 1 - Number(brightness.value);
    };
    const volume = get('.local-player-volume input');
    volume.value = initialVolume;
    video.volume = initialVolume;
    paintLevel(volume);
    volume.oninput = () => {
      paintLevel(volume);
      const level = Number(volume.value);
      video.volume = level;
      if (surface) controlSurface('volume', level).catch(() => {});
      else if (kind !== 'trailer' && /iP(?:hone|ad|od)/.test(navigator.userAgent)) startSurface();
    };
    const nativeViewport = document.documentElement.classList.contains('diastomy-native-tabs');
    let viewportRequest = 0;
    let rotationTimer;
    function updateViewport(active = true) {
      if (!nativeViewport) return;
      const request = ++viewportRequest;
      const showVolume = active && !rotationTimer && !settings.dataset.panel && !overlay.classList.contains('local-player-controls-hidden');
      const rect = volume.getBoundingClientRect();
      const horizontal = overlay.classList.contains('local-player-rotated');
      const geometry = showVolume ? {
        x:rect.left + rect.width / 2, y:rect.top + rect.height / 2,
        length:horizontal ? rect.width : rect.height, horizontal
      } : {};
      native({action:'playerViewport', active, detail:Boolean(document.querySelector('.movie-detail-shell')), ...geometry}).then(result => {
        if (request !== viewportRequest) return;
        const systemVolume = result?.ok === true;
        volume.inert = systemVolume;
        overlay.classList.toggle('local-player-system-volume', systemVolume);
      }).catch(() => {
        if (request !== viewportRequest) return;
        volume.inert = false;
        overlay.classList.remove('local-player-system-volume');
      });
    }
    const resizeViewport = () => updateViewport();
    function paintTitle(title) {
      get('h2').textContent = title || '';
      const subtitle = get('.local-player-title p');
      const episode = groups[group]?.find(entry => Number(entry.id) === Number(selected));
      subtitle.hidden = episode?.season == null || episode?.episode == null;
      subtitle.textContent = subtitle.hidden ? '' : 'Season ' + episode.season + ' · Episode ' + episode.episode;
    }
    updateTransport(true);
    function progress(force) {
      if (!played || !Number.isFinite(duration()) || duration() <= 0 || !source.target) return;
      if (scrubbing || pendingSeek) return;
      if (!force && Date.now() - lastSaved < 15000) return;
      lastSaved = Date.now();
      save({...source.target, watched_duration:Math.floor(time()), total_duration:Math.floor(duration())});
    }
    function paintTimeline(position, total) {
      seek.disabled = total <= 0 || Boolean(room && !roomControl);
      seek.max = total;
      seek.value = position;
      elapsed.textContent = format(position);
      end.textContent = format(total);
      timelineFill.style.setProperty('--played', (total ? Number(seek.value) / total * 100 : 0) + '%');
      seek.setAttribute('aria-valuetext', elapsed.textContent + ' / ' + end.textContent);
    }
    function refresh() {
      const total = Number.isFinite(duration()) ? duration() : 0;
      if (scrubbing) return;
      const position = time() || 0;
      if (pendingSeek && (Math.abs(position - pendingSeek.value) < .8 || performance.now() >= pendingSeek.expires)) {
        pendingSeek = null;
      }
      paintTimeline(pendingSeek?.value ?? position, total);
      progress(false);
    }
    function sourceChanged(next, position, preferSurface = false) {
      stopSurface();
      source = next;
      resume = position;
      played = false;
      setLoading(true);
      captionStatus.hidden = true;
      paintTitle(next.title);
      get('.local-player-error').hidden = true;
      if (preferSurface || (room && onClose)) { startSurface(); return; }
      video.src = next.url;
      video.playbackRate = playbackRate;
      const request = revision;
      video.play().catch(error => {
        if (error.name !== 'NotAllowedError' || !overlay.isConnected || request !== revision) return;
        clearTimeout(startupCheck);
        setLoading(false);
      });
      startupCheck = setTimeout(() => {
        if (overlay.isConnected && !played) startSurface();
      }, 6500);
    }
    async function changeSource(id, nextGroup) {
      const request = ++revision;
      try {
        const response = await native({action:'play',inline:true,kind,room,id});
        if (!overlay.isConnected || request !== revision) return;
        if (response.status !== 200 || !response.data.url) throw Error(response.data.error || 'منبع در دسترس نیست.');
        progress(true);
        const position = nextGroup === group ? (pendingSeek?.value ?? (time() || resume)) : Number(response.data.position) || 0;
        const preferSurface = Boolean(surface);
        selected = id;
        group = nextGroup;
        sourceChanged(response.data, position, preferSurface);
        updateNext();
      } catch (error) { if (overlay.isConnected && request === revision) { onError(error.message); renderSettings(); } }
    }
    function updateNext() {
      const next = get('[data-player=next]');
      if (next) next.hidden = group < 0 || !(groups[group + 1] || []).length;
    }
    function renderSettings() {
      settings.replaceChildren();
      const options = (title, entries, current, change) => {
        const group = document.createElement('fieldset');
        const heading = document.createElement('legend');
        heading.textContent = title;
        group.append(heading);
        for (const [value, label] of entries) {
          const option = document.createElement('button');
          option.type = 'button';
          option.textContent = label;
          option.setAttribute('aria-pressed', String(value === current));
          option.onclick = () => {
            group.querySelector('[aria-pressed=true]')?.setAttribute('aria-pressed','false');
            option.setAttribute('aria-pressed','true');
            change(value);
          };
          group.append(option);
        }
        settings.append(group);
      };
      if (settings.dataset.panel === 'captions') {
        const available = surface ? Boolean(lastState?.captions?.length) : captionTracks().length > 0;
        if (!available) {
          settings.textContent = surfaceStarting || !played ? 'زیرنویس هنوز در حال بارگذاری است.' : 'زیرنویس قابل تغییر در دسترس نیست.';
          return;
        }
        options('زیرنویس', [[true,'روشن'],[false,'خاموش']],
          captionButton.getAttribute('aria-pressed') === 'true', setCaptions);
        return;
      }
      if (settings.dataset.panel === 'settings') {
        const qualities = (groups[group] || []).map(v => [Number(v.id),v.quality]);
        if (qualities.length) options('کیفیت پخش', qualities, selected, value => {
          if (value !== selected) changeSource(value, group);
        });
        if (!room) options('سرعت پخش', [.5,.75,1,1.25,1.5,2].map(rate => [rate,rate + '×']), playbackRate, value => {
          playbackRate = value;
          video.playbackRate = value;
          if (surface) controlSurface('rate', value).catch(() => {});
        });
        options('اندازهٔ زیرنویس', [['small','کوچک'],['normal','متوسط'],['large','بزرگ']], captionStyle.size, value => setCaptionStyle('size', value));
        options('پس‌زمینه', [[true,'روشن'],[false,'خاموش']], captionStyle.background, value => setCaptionStyle('background', value));
        options('رنگ زیرنویس', [['white','سفید'],['yellow','زرد'],['cyan','آبی روشن']], captionStyle.color, value => setCaptionStyle('color', value));
        const nativeCaptions = lastState?.captions || [];
        if (surface && nativeCaptions.length > 1) {
          options('زبان زیرنویس', nativeCaptions.map((name,i) =>
            [i, name && !creditMarker.test(name) ? name : 'زیرنویس ' + (i + 1)]),
          lastState.selectedCaption, selectNativeCaption);
        } else if (!surface) {
          const tracks = captionTracks();
          if (tracks.length > 1) options('زبان زیرنویس', tracks.map((track,i) => [i,
            track.label && !creditMarker.test(track.label) ? track.label : track.language || 'زیرنویس ' + (i + 1)]),
          tracks.findIndex(track => track.mode === 'showing'), value => selectWebCaption(tracks[value]));
        }
        return;
      }
      if (surface) {
        const audio = lastState?.audio || [];
        if (!audio.length) { settings.textContent = 'مسیر صوتی دیگری در دسترس نیست.'; return; }
        options('زبان صدا', audio.map((name,i) => [i, name || audioLabel(i,audio.length)]), lastState.selectedAudio,
          value => controlSurface('audio', value).catch(() => {}));
        return;
      }
      const audio = Array.from(video.audioTracks || []);
      if (settings.dataset.panel === 'audio') {
        if (!audio.length) { settings.textContent = 'مسیر صوتی دیگری در دسترس نیست.'; return; }
        options('زبان صدا', audio.map((track,i) => [i,track.label || track.language || audioLabel(i,audio.length)]),
          audio.findIndex(track => track.enabled), value => audio.forEach((track,i) => { track.enabled = i === value; }));
      }
    }
    const captionButton = get('[data-player=captions]');
    let lastWebCaption;
    function captionTracks() {
      return Array.from(video.textTracks || []).filter(track => ['captions','subtitles'].includes(track.kind));
    }
    function syncCaptionButton() {
      const enabled = surface ? (lastState?.selectedCaption ?? -1) >= 0 :
        captionTracks().some(track => track.mode === 'showing');
      captionButton.setAttribute('aria-pressed', String(enabled));
    }
    async function selectNativeCaption(index) {
      const request = revision;
      if (captionButton.disabled) return;
      captionChange++;
      captionButton.disabled = true;
      try {
        const state = await controlSurface(index === undefined ? 'enableCaptions' : 'captions', index);
        if (!surface || request !== revision) return;
        if (!state.ok) {
          captionNotice(state.captionsLoading ? 'زیرنویس هنوز در حال بارگذاری است.' :
            state.captionsUnavailable ? 'زیرنویس قابل تغییر در دسترس نیست.' : 'تغییر زیرنویس انجام نشد.');
          return;
        }
        lastState = state;
        syncCaptionButton();
        if (!settings.hidden && ['settings','captions'].includes(settings.dataset.panel)) renderSettings();
      } catch (_) {
        if (request === revision && overlay.isConnected) captionNotice('تغییر زیرنویس انجام نشد.');
      } finally { captionButton.disabled = false; }
    }
    function selectWebCaption(selected) {
      for (const track of captionTracks()) track.mode = track === selected ? 'showing' : 'hidden';
      if (selected) lastWebCaption = selected;
      syncCaptionButton();
    }
    function setCaptions(enabled) {
      if (surface) return selectNativeCaption(enabled ? undefined : -1);
      const tracks = captionTracks();
      const current = tracks.find(track => track.mode === 'showing');
      if (current) lastWebCaption = current;
      if (!tracks.length) { captionNotice('زیرنویس قابل تغییر در دسترس نیست.'); return; }
      selectWebCaption(!enabled ? null : tracks.includes(lastWebCaption) ? lastWebCaption : tracks[0]);
    }
    function audioLabel(index, count) { return count === 1 ? 'صدای اصلی' : 'مسیر صوتی ' + (index + 1); }
    function dismiss() {
      progress(true);
      clearTimeout(captionNoticeTimer);
      clearTimeout(rotationTimer);
      window.removeEventListener('resize', resizeViewport);
      updateViewport(false);
      document.removeEventListener('keydown', closePanelOnEscape);
      closeCurrent = null;
      revision++;
      stopSurface();
      video.pause();
      video.removeAttribute('src');
      video.load();
      overlay.remove();
      document.body.classList.remove('local-player-open');
      onClose?.();
    }
    closeCurrent = dismiss;
    const creditMarker = /king[\s_.-]*movie|movie[\s_.-]*baz/i;
    function cleanCaptionTrack(track) {
      const cues = Array.from(track.cues || []);
      for (const cue of cues) {
        if (typeof cue.text !== 'string') continue;
        const lines = cue.text.split('\n');
        const clean = lines.filter(line => {
          if (!creditMarker.test(line)) return true;
          const text = line.replace(/<[^>]+>/g,'').trim();
          return !/^(?:@|https?:\/\/|www\.|ترجمه|زیرنویس|ارائه|هماهنگ|دانلود|presented\b|subtitles\b|translated\b|credits\b|synced\b)/i.test(text)
            && !/^(?:@|www\.)?(?:king[\s_.-]*movie|movie[\s_.-]*baz)(?:\.[a-z]+)?[!.]?$/i.test(text);
        }).join('\n');
        if (clean !== cue.text) cue.text = clean;
      }
      return cues.some(cue => typeof cue.text === 'string' && cue.text.trim() && cue.endTime > cue.startTime);
    }
    syncCaptionButton();
    video.textTracks?.addEventListener('change', syncCaptionButton);
    video.textTracks?.addEventListener('addtrack', event => {
      const track = event.track;
      if (!['captions','subtitles'].includes(track.kind)) return;
      track.addEventListener('cuechange', () => cleanCaptionTrack(track));
      syncCaptionButton();
      if (settings.dataset.panel === 'captions') renderSettings();
    });
    video.addEventListener('loadedmetadata', () => {
      if (resume > 0 && Number.isFinite(video.duration)) video.currentTime = Math.min(resume, video.duration);
      refresh();
      if (!settings.hidden) renderSettings();
    });
    video.addEventListener('timeupdate', refresh);
    video.addEventListener('seeked', () => {
      if (resume > 0 && Math.abs(video.currentTime - resume) < 2) resume = 0;
      refresh();
    });
    video.addEventListener('playing', () => {
      if (surface) return;
      played = true;
      setLoading(false);
      updateTransport(false);
      if (settings.dataset.panel === 'captions') renderSettings();
    });
    video.addEventListener('waiting', () => { if (!surface && !video.paused) setLoading(true); });
    video.addEventListener('pause', () => {
      if (!surface && !surfaceStarting) setLoading(false);
      updateTransport(true);
    });
    video.addEventListener('error', () => { if (overlay.isConnected) startSurface(); });
    seek.oninput = () => {
      scrubbing = true;
      paintTimeline(Number(seek.value), duration());
    };
    seek.onchange = () => {
      scrubbing = false;
      setTime(Number(seek.value));
    };
    seek.onpointercancel = () => { scrubbing = false; refresh(); };
    seek.onblur = () => { if (scrubbing) seek.onchange(); };
    function setPanel(panel) {
      PWA.setDisclosure(settings, Boolean(panel));
      settings.dataset.panel = panel || '';
      overlay.querySelectorAll('[data-player=captions],[data-player=audio],[data-player=settings]').forEach(trigger => {
        trigger.setAttribute('aria-expanded', String(panel === trigger.dataset.player));
      });
      if (panel) renderSettings();
      if (overlay.isConnected) updateViewport();
    }
    setPanel(null);
    function closePanelOnEscape(event) {
      if (event.key === 'Escape' && settings.dataset.panel) {
        const trigger = get('[aria-expanded=true]');
        setPanel(null);
        trigger?.focus({preventScroll:true});
        event.preventDefault();
      }
    }
    document.addEventListener('keydown', closePanelOnEscape);
    overlay.onclick = async event => {
      const button = event.target.closest('[data-player]');
      if (!button) {
        if (event.target.closest('input, label, .local-player-top, .local-player-bottom, .local-player-settings')) return;
        setPanel(null);
        overlay.classList.toggle('local-player-controls-hidden');
        updateViewport();
        return;
      }
      switch (button.dataset.player) {
        case 'close': dismiss(); break;
        case 'back': setTime((pendingSeek?.value ?? time()) - 10); break;
        case 'forward': setTime((pendingSeek?.value ?? time()) + 10); break;
        case 'mute':
          if (surface) { const state = await controlSurface('mute'); button.setAttribute('aria-pressed', String(state.muted)); break; }
          video.muted = !video.muted;
          button.setAttribute('aria-pressed', String(video.muted));
          break;
        case 'toggle': if (room) { roomControl?.('toggle'); break; } if (surface) await controlSurface('toggle'); else if (video.paused) video.play().catch(() => {}); else video.pause(); break;
        case 'next': {
          const next = groups[group + 1]?.[0];
          if (next) await changeSource(Number(next.id), group + 1);
          break;
        }
        case 'captions':
        case 'audio':
        case 'settings': {
          const panel = button.dataset.player;
          setPanel(settings.dataset.panel === panel ? null : panel);
          break;
        }
        case 'fullscreen': {
          const fill = overlay.classList.toggle('local-player-fill');
          button.setAttribute('aria-pressed', String(fill));
          if (surface) await controlSurface('fill', fill);
          break;
        }
        case 'rotate': {
          const rotated = overlay.classList.toggle('local-player-rotated');
          button.setAttribute('aria-pressed', String(rotated));
          clearTimeout(rotationTimer);
          rotationTimer = setTimeout(() => {
            rotationTimer = undefined;
            updateViewport();
          }, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 340);
          updateViewport();
          if (surface) await controlSurface('rotateAnimated', rotated);
          break;
        }
        case 'retry':
          revision++;
          sourceChanged(source, time() || resume);
          break;
      }
    };
    applyCaptionStyle();
    document.body.append(overlay);
    document.body.classList.add('local-player-open');
    window.addEventListener('resize', resizeViewport);
    updateViewport();
    overlay.addEventListener('touchmove', event => {
      if (event.cancelable && !event.target.closest('input[type=range],.local-player-settings')) event.preventDefault();
    }, {passive:false});
    updateNext();
    if (room && !roomControl) {
      overlay.querySelectorAll('[data-player=toggle],[data-player=back],[data-player=forward]').forEach(button => {
        button.disabled = true;
      });
    }
    sourceChanged(info, resume);
  }
  return {open,close,chooseResume};
})();
