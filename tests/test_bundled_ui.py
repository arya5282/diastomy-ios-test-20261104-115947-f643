"""Real WebKit smoke tests with an explicit API bridge double, no live account.
Run with a Python environment containing playwright and its WebKit browser.
"""
import json
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from threading import Thread
from pathlib import Path
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
fixture = {
    'id': 1, 'type': 'movie', 'slug': 'test-movie', 'title': 'فیلم آزمایشی',
    'cover': '', 'banner': '', 'description': '<script>throw Error("XSS")</script>',
    'production_year': 2026, 'imdb_rating': 8.2, 'duration': 100,
    'is_free': False, 'is_dubbed': True, 'genres': [{'slug': 'drama', 'name': 'درام'}],
    'videos': [{'id': 42, 'quality': '1080p'}], 'actors': [],
}
script = r"""
window.__calls = [];
window.__offline = false;
const title = FIXTURE;
window.webkit = { messageHandlers: { native: { postMessage: async payload => {
  window.__calls.push(payload);
  if (payload.action === 'play' && payload.inline) return {status:200,data:{url:'https://diastomy.top/movie/movie-direct-hls/test.m3u8',title:title.title,target:{movie_id:1},position:0}};
  if (payload.action !== 'request') return {status:200,data:{},ok:true};
  if (window.__holdRequests) return new Promise(() => {});
  if (window.__offline) return {status:0,data:{error:'offline'}};
  const path = payload.path;
  if (path.includes('/session/')) return {status:200,data:{user:window.__guest ? null : {name:'Test'},csrf:'test'}};
  if (path.includes('/home/')) return {status:200,data:{hero:[title,{...title,id:2,slug:'second-movie',title:'Second movie'}],genres:title.genres,rails:[{title:'تازه‌ترین فیلم‌ها',items:[title]}]}};
  if (path.includes('/library/')) return {status:200,data:{history:[],saved:[]}};
  if (path.includes('/bookmark/toggle/')) {
    window.__bookmarked = !window.__bookmarked;
    return {status:200,data:{is_bookmarked:window.__bookmarked}};
  }
  if (path.includes('/title/')) return {status:200,data:title};
  if (path.includes('/filter/')) return {status:200,data:{results:[title],total_results:1,current_page:1,has_next:false}};
  if (path.includes('/actor/')) return {status:200,data:{actor:{name:'بازیگر',photo:'',bio:''},filmography:[title]}};
  if (path.includes('/actors/')) return {status:200,data:{actors:[]}};
  if (path.includes('/plans/')) return {status:200,data:{plans:[{id:1,name:'یک ماهه',newPriceRaw:100000}]}};
  if (path.includes('check-phone')) return {status:200,data:{has_password:true,identifier_type:'email'}};
  if (path.includes('login-password')) return {status:400,data:{error:'رمز اشتباه است'}};
  return {status:503,data:{error:'سرویس در دسترس نیست'}};
}}}};
""".replace('FIXTURE', json.dumps(fixture, ensure_ascii=False))

server = ThreadingHTTPServer(('127.0.0.1', 0), partial(SimpleHTTPRequestHandler, directory=str(root / 'Diastomy/Web')))
Thread(target=server.serve_forever, daemon=True).start()
local_url = 'http://127.0.0.1:' + str(server.server_port) + '/index.html'

with sync_playwright() as playwright:
    browser = playwright.webkit.launch()
    context = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=1)
    context.add_init_script(script)
    page = context.new_page()
    errors = []
    remote_documents = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('request', lambda request: remote_documents.append(request.url)
            if request.resource_type in ('document', 'script', 'stylesheet', 'font') and request.url.startswith('http') and not request.url.startswith('http://127.0.0.1:') else None)
    page.route('https://diastomy.top/movie/**', lambda route: route.abort())
    page.goto(local_url)
    page.wait_for_selector('.home-hero-card')
    for width in (320, 390, 430):
        page.set_viewport_size({'width': width, 'height': 844})
        for selector in ('.home-glass-header', '.home-hero-card', '[data-local-filter]'):
            bounds = page.locator(selector).first.bounding_box()
            assert bounds['width'] > 0 and 0 <= bounds['x'] < bounds['x'] + bounds['width'] <= width
    page.set_viewport_size({'width': 390, 'height': 844})
    print('PASS: bundled home rendered at three iPhone widths in WebKit')
    page.locator('[data-local-filter]').click()
    page.wait_for_selector('#local-filters[open]')
    page.locator('[data-close-filter]').click()
    page.wait_for_selector('#local-filters[open]', state='detached')
    page.locator('.home-glass-header [data-local-search]').click()
    page.wait_for_selector('.reference-search-form input')
    page.evaluate('location.hash = "#/home"')
    page.wait_for_selector('.home-hero-card')
    page.locator('.home-glass-header a[href="#/notifications"]').click()
    page.wait_for_function('document.querySelector("h1")?.textContent === "اعلان‌ها"')
    page.evaluate('location.hash = "#/home"')
    page.wait_for_selector('.home-hero-card')
    page.locator('[data-slide="1"]').click()
    page.wait_for_selector('[data-slide="1"][aria-pressed="true"]')
    page.evaluate('document.querySelector(".home-hero-rail").scrollLeft = 0')
    page.wait_for_selector('[data-slide="0"][aria-pressed="true"]')
    save = page.locator('[data-home-save]').first
    save.click()
    page.wait_for_selector('[data-home-save][aria-pressed="true"]')
    save.click()
    page.wait_for_function('document.querySelector("[data-home-save]").getAttribute("aria-pressed") === "false"')
    assert save.get_attribute('aria-pressed') == 'false'
    assert page.evaluate('window.__calls.filter(x => x.path?.includes("/bookmark/toggle/?item_type=movie&item_id=1")).length === 2')
    page.locator('.home-watch').first.click()
    page.wait_for_selector('.local-pwa-player')
    assert page.locator('.dm-film-description').inner_text() == fixture['description']
    assert page.evaluate('window.__calls.some(x => x.action === "play" && x.id === 42)')
    page.locator('[data-player=settings]').click()
    page.wait_for_selector('.local-player-settings fieldset button')
    page.locator('[data-player=close]').click()
    page.wait_for_selector('.local-pwa-player', state='detached')
    print('PASS: escaped API content and local player launch and close')
    page.evaluate('window.__offline = true; window.dispatchEvent(new Event("offline"))')
    page.evaluate('location.hash = "#/home"')
    page.wait_for_selector('.home-hero-card')
    assert page.locator('#connection').is_visible()
    page.evaluate('location.hash = "#/title/movie/test-movie"')
    page.wait_for_selector('[data-play]')
    print('PASS: offline home and detail from retained public JSON')
    routes = {
        'account': 'پروفایل کاربری', 'login': 'Sign in or register',
        'otp': 'ورود با کد تأیید', 'forgot': 'بازیابی رمز عبور', 'settings': 'تنظیمات',
        'support': 'پشتیبانی', 'subscription': 'خرید یا تمدید اشتراک',
        'notifications': 'اعلان‌ها', 'rooms': 'به اتاق فیلم دیاستومی خوش‌ اومدی !', 'about': 'دربارهٔ دیاستومی',
    }
    for route, heading in routes.items():
        page.evaluate('(hash) => { location.hash = hash; }', '#/' + route)
        page.get_by_role('heading', name=heading, exact=True, level=1).wait_for(timeout=5000)
    page.evaluate('location.hash = "#/library"')
    page.wait_for_selector('#library-tab-saved')
    page.evaluate('location.hash = "#/search"')
    page.wait_for_selector('.reference-search-form input')
    page.evaluate('location.hash = "#/browse/movie"')
    page.wait_for_selector('.archive-reference-header h1')
    print('PASS: every local screen opens with the server unavailable')
    page.evaluate('window.__offline = false; location.hash = "#/login"')
    page.fill('#identify [name=identifier]', 'invalid@example.test')
    page.locator('#identify button').click()
    page.wait_for_selector('#login')
    page.fill('[name=password]', 'not-a-real-password')
    page.locator('#login [type=submit]').click()
    page.wait_for_function('document.querySelector("#login-status").textContent.includes("رمز اشتباه")')
    assert page.evaluate('window.__calls.some(x => x.path === "/accounts/api/login-password/" && x.body.identifier === "invalid@example.test")')
    print('PASS: login sends JSON and displays API error')
    assert not errors, errors
    assert not remote_documents, remote_documents
    page.evaluate('location.hash = "#/home"')
    page.wait_for_selector('.home-hero-card')
    page.screenshot(path=str(root / 'tests/offline-home.png'), full_page=True)
    # Keep native API promises unresolved: cached content and footer routing must
    # still render, including navigation away from an in-flight private request.
    page.evaluate('''() => {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith('dm-public-v2:')) {
          const value = JSON.parse(localStorage.getItem(key)); value.time = 0;
          localStorage.setItem(key, JSON.stringify(value));
        }
      }
      window.__holdRequests = true;
      location.hash = '#/library';
    }''')
    page.wait_for_selector('#library-tab-saved', timeout=1500)
    page.locator('nav a[data-nav-slot="home"]').click()
    page.wait_for_selector('.home-hero-card', timeout=1500)
    page.locator('[data-local-menu]').click()
    page.wait_for_function('document.querySelector("h1").textContent === "پروفایل کاربری"', timeout=1500)
    page.locator('.dm-app-menu-close').click()
    page.wait_for_selector('.home-hero-card', timeout=1500)
    print('PASS: footer switching and stale cached content never wait for unresolved API requests')
    # A signed-out or unverified installation must render sign-in, including on a deep link.
    clean = browser.new_context(viewport={'width':390,'height':844})
    clean.add_init_script(script + '\nwindow.__guest = true;')
    first = clean.new_page()
    first.goto(local_url + '#/settings')
    first.wait_for_selector('#identify')
    assert first.evaluate('location.hash') == '#/login'
    assert not first.locator('#clear').count()
    first.evaluate('window.__offline = true; location.hash = "#/home"')
    first.wait_for_function('location.hash === "#/login"')
    print('PASS: signed-out navigation is gated by login')
    clean.close()
    browser.close()

server.shutdown()
server.server_close()
