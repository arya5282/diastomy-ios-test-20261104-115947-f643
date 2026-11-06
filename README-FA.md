# دیاستومی iOS — رابط محلی، نسخهٔ ۲

این پروژه جایگزین پوستهٔ قبلی می‌شود: برنامه فایل `Diastomy/Web/index.html` را از خود بسته باز می‌کند. هیچ صفحهٔ HTML، اسکریپت، فونت یا CSS از سایت دریافت نمی‌شود. رابط آفلاین برای این معماری بازنویسی شده؛ تمام جزئیات بصری و امکانات نسخهٔ وب عیناً منتقل نشده‌اند.

## داخل برنامه

صفحهٔ اصلی، آرشیو، جست‌وجو، جزئیات عنوان و قسمت‌ها، بازیگران، حساب، ورود با رمز/کد، ثبت‌نام، بازیابی رمز، لیست من، تنظیمات، اعلان‌ها، پشتیبانی، اشتراک و اتاق فیلم همگی مسیر محلی دارند. فایل‌های HTML/JS/CSS، فونت و لوگو همراه اپ نصب می‌شوند.

اطلاعات عمومیِ دریافت‌شده از API تا سقف ۸۰ پاسخ برای مشاهدهٔ بعدی نگهداری می‌شود. حتی اولین اجرا در حالت هواپیما صفحه‌ها و فرم‌ها را باز می‌کند؛ بدون دادهٔ قبلی، فهرست فیلم خالی خواهد بود. اطلاعات حساب، پیام‌ها و مجوز پخش در کش عمومی ذخیره نمی‌شوند. ورود، ارسال پیام، پرداخت، دادهٔ جدید و پخش آنلاین نیاز به اینترنت دارند. پوسترها و سایر تصاویر محتوایی از URLهای داخل پاسخ API دریافت می‌شوند؛ نمایش آفلاین آن‌ها تضمین نشده است.

پخش با AVPlayer و مسیر HLS فعلی سرور انجام می‌شود. کوکی حساب از نشست بومی به AVPlayer داده می‌شود و سرور روی API پخش و مسیرهای HLS اشتراک را بررسی می‌کند. کیفیت از صفحهٔ جزئیات انتخاب می‌شود؛ زیرنویس و کنترل‌های موجود در HLS با کنترل‌های بومی اپل نمایش داده می‌شوند. این نسخه انتقال عین‌به‌عین پلیر سفارشی وب نیست.

اتاق فیلم از همان WebSocket فعلی با کوکی حساب استفاده می‌کند؛ صفحه، گفت‌وگو و کنترل میزبان محلی هستند و پخش بومی از وضعیت اتاق پیروی می‌کند. پرداخت در مرورگر خارجیِ درگاه باز می‌شود. دانلود مدیریت‌شدهٔ فیلم، آپلود پیوست، ورود Google و همهٔ امکانات سفارشی پلیر وب در این نسخه پیاده نشده‌اند.

## سرور

فایل `backend/mobile_app_api.py` APIهای JSON مورد نیاز را به پروژهٔ Django اضافه می‌کند. هیچ migration یا تغییری در مدل‌ها نیاز نیست. قبل از ساخت IPA باید این APIها روی سرور فعال باشند:

- `GET /api/app/v1/session/`
- `GET /api/app/v1/home/`
- `GET /api/app/v1/title/<movie|series>/<slug>/`
- `GET /api/app/v1/playback/<movie|series>/<video_id>/`
- `GET /api/app/v1/library/`
- `GET /api/app/v1/settings/`
- `GET/POST /api/app/v1/rooms/`
- `GET /api/app/v1/rooms/<code>/`

برای سرور دیگر ابتدا پیش‌نمایش و بعد نصب:

```bash
python3 backend/install_backend.py /path/to/django
python3 backend/install_backend.py /path/to/django --apply
/path/to/venv/bin/python /path/to/django/manage.py check
```

نصاب از `diastomy/urls.py` و API قبلی در صورت وجود پشتیبان می‌گیرد؛ سرویس را خودش reload نمی‌کند. در این محیط API روی سرور دیاستومی نصب و جداگانه بررسی شده است؛ جزئیات در BUILD-STATUS.md است.

## ساخت با مخزن قبلی

مخزن: https://github.com/arya5282/diastomy-ios-test-20261104-115947-f643

۱. ZIP سورس جدید را Extract کن. محتویات پوشه را در ریشهٔ همین مخزن جایگزین کن؛ مخصوصاً `Diastomy`، `Diastomy.xcodeproj`، `scripts` و `.github/workflows/build-ios.yml`. فایل ZIP یا پوشهٔ مادر را به‌جای محتویات آپلود نکن. پوشهٔ مخفی `.github` را فراموش نکن.

۲. در Actions، اجرای `Build iPhone IPA` را با Run workflow شروع کن. اگر `.github` را نمی‌توانی آپلود کنی، محتوای BUILD-IPA.yml را در مسیر `.github/workflows/build-ios.yml` قرار بده.

۳. بعد از سبز شدن ساخت، Artifact با نام `Diastomy-iPhone-IPA` را بگیر. داخلش `Diastomy-unsigned.ipa` قرار دارد. این فایل باید روی کامپیوتر خودت با Sideloadly امضا و روی آیفون نصب شود.

۴. Bundle ID همان `top.diastomy.ios.test` است. برای به‌روزرسانی روی نصب قبلی، حساب و Bundle ID امضای قبلی را نگه دار. دیتابیس سرور، رمز، کلید امضا و اطلاعات خصوصی داخل این بسته نیستند.

## بررسی‌ها

```bash
python3 scripts/validate.py
python3 scripts/validate_offline.py
node --check Diastomy/Web/app.js
python3 tests/test_bundled_ui.py  # نیازمند Playwright + WebKit
/path/to/venv/bin/python backend/check_current_catalogue.py /path/to/django
```

بررسی مرورگر، قرارداد API و منابع جای ساخت Xcode و تست آیفون را نمی‌گیرند. این محیط Linux است و خروجی IPA محلی تولید نشده است.

مستندات فنی اپل:
- https://developer.apple.com/documentation/webkit/wkwebview/loadfileurl(_:allowingreadaccessto:)
- https://developer.apple.com/documentation/webkit/wkscriptmessagehandlerwithreply
- https://developer.apple.com/documentation/avfoundation/avurlassethttpcookieskey
