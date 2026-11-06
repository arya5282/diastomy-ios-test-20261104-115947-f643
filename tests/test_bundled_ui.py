"""Real WebKit smoke tests with an explicit API bridge double, no live account.
Run with a Python environment containing playwright and its WebKit browser.
"""
import json
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
  if (payload.action !== 'request') return {status:200,data:{},ok:true};
  if (window.__holdRequests) return new Promise(() => {});
  if (window.__offline) return {status:0,data:{error:'offline'}};
  const path = payload.path;
  if (path.includes('/session/')) return {status:200,data:{user:null,csrf:'test'}};
  if (path.includes('/home/')) return {status:200,data:{hero:[title],genres:title.genres,rails:[{title:'تازه‌ترین فیلم‌ها',items:[title]}]}};
  if (path.includes('/title/')) return {status:200,data:title};
  if (path.includes('/filter/')) return {status:200,data:{results:[title],total_results:1,current_page:1,has_next:false}};
  if (path.includes('/actor/')) return {status:200,data:{actor:{name:'بازیگر',photo:'',bio:''},filmography:[title]}};
  if (path.includes('/actors/')) return {status:200,data:{actors:[]}};
  if (path.includes('/plans/')) return {status:200,data:{plans:[{id:1,name:'یک ماهه',newPriceRaw:100000}]}};
  if (path.includes('login-password')) return {status:400,data:{error:'رمز اشتباه است'}};
  return {status:401,data:{error:'وارد حساب شوید'}};
}}}};
""".replace('FIXTURE', json.dumps(fixture, ensure_ascii=False))

with sync_playwright() as playwright:
    browser = playwright.webkit.launch()
    context = browser.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=1)
    context.add_init_script(script)
    page = context.new_page()
    errors = []
    remote_documents = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('request', lambda request: remote_documents.append(request.url)
            if request.resource_type in ('document', 'script', 'stylesheet', 'font') and request.url.startswith('http') else None)
    page.goto((root / 'Diastomy/Web/index.html').as_uri())
    page.wait_for_selector('.hero-item')
    print('PASS: bundled home rendered in WebKit')
    page.locator('.hero-item').first.click()
    page.wait_for_selector('[data-play]')
    assert page.locator('.description').inner_text() == fixture['description']
    page.locator('[data-play]').click()
    assert page.evaluate('window.__calls.some(x => x.action === "play" && x.id === 42)')
    print('PASS: escaped API content and native playback dispatch')
    page.evaluate('window.__offline = true; window.dispatchEvent(new Event("offline"))')
    page.evaluate('location.hash = "#/home"')
    page.wait_for_selector('.hero-item')
    assert page.locator('#connection').is_visible()
    page.evaluate('location.hash = "#/title/movie/test-movie"')
    page.wait_for_selector('[data-play]')
    print('PASS: offline home and detail from retained public JSON')
    routes = {
        'search': 'جست‌وجو', 'account': 'حساب من', 'login': 'ورود به دیاستومی',
        'otp': 'ورود با کد تأیید', 'forgot': 'بازیابی رمز عبور', 'settings': 'تنظیمات',
        'support': 'پشتیبانی', 'subscription': 'اشتراک', 'library': 'لیست من',
        'notifications': 'اعلان‌ها', 'rooms': 'اتاق فیلم', 'about': 'دربارهٔ دیاستومی',
    }
    for route, heading in routes.items():
        page.evaluate('(hash) => { location.hash = hash; }', '#/' + route)
        page.wait_for_function('(text) => document.querySelector("h1")?.textContent === text', arg=heading)
    print('PASS: every local screen opens with the server unavailable')
    page.evaluate('window.__offline = false; location.hash = "#/login"')
    page.wait_for_selector('#login')
    page.fill('[name=identifier]', 'invalid@example.test')
    page.fill('[name=password]', 'not-a-real-password')
    page.locator('#login button').click()
    page.wait_for_function('document.querySelector("#login-status").textContent.includes("رمز اشتباه")')
    assert page.evaluate('window.__calls.some(x => x.path === "/accounts/api/login-password/" && x.body.identifier === "invalid@example.test")')
    print('PASS: login sends JSON and displays API error')
    assert not errors, errors
    assert not remote_documents, remote_documents
    page.evaluate('location.hash = "#/home"')
    page.wait_for_selector('.hero-item')
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
    page.wait_for_function('document.querySelector("h1").textContent === "لیست من"', timeout=1500)
    page.locator('nav a[data-tab="home"]').click()
    page.wait_for_selector('.hero-item', timeout=1500)
    page.locator('nav a[data-tab="account"]').click()
    page.wait_for_function('document.querySelector("h1").textContent === "حساب من"', timeout=1500)
    page.locator('nav a[data-tab="home"]').click()
    page.wait_for_selector('.hero-item', timeout=1500)
    print('PASS: footer switching and stale cached content never wait for unresolved API requests')
    # First installation must also open the UI before ever receiving catalogue data.
    clean = browser.new_context(viewport={'width':390,'height':844})
    clean.add_init_script(script + '\nwindow.__offline = true;')
    first = clean.new_page()
    first.goto((root / 'Diastomy/Web/index.html').as_uri() + '#/settings')
    first.wait_for_selector('#clear')
    first.evaluate('location.hash = "#/home"')
    first.wait_for_selector('#home-data .empty')
    print('PASS: first launch offline, with no cache, still opens local pages')
    clean.close()
    browser.close()
