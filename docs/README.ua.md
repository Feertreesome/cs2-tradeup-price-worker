# CS2 Trade-Up Price Worker

## Огляд

`cs2-tradeup-price-worker` це окремий Node.js worker, який відповідає за оновлення цін скінах CS2.

Його основні задачі:

- читати `collections` і `skins` з MongoDB
- запускати pricing sync jobs
- отримувати ринкові ціни зі Steam
- записувати нормалізовані ціни в MongoDB
- зберігати прогрес і стан job у MongoDB
- повідомляти backend після успішного завершення повної синхронізації

Worker не рахує rankings і не будує trade-up opportunities. Ця бізнес-логіка залишається на backend.

## Роль в архітектурі

Worker знаходиться між Steam і backend.

### Worker -> MongoDB

MongoDB використовується як джерело каталогу і як сховище стану.

Worker читає:

- `collections`
- `skins`

Worker записує:

- `pricings`
- `pricingsyncjobs`
- `refreshstates`

### Worker -> Steam API

Worker звертається до Steam Community Market для отримання ринкових цін.

Використовуються:

- `priceoverview` для прямих запитів ціни
- `market/search/render` для пошуку товарів і побудови price map

Steam є зовнішнім джерелом сирих ринкових даних.

### Worker -> Backend

Worker не перебудовує rankings самостійно. Після успішного завершення pricing sync він надсилає best-effort повідомлення на internal backend endpoint, щоб backend сам перерахував результати за власними бізнес-правилами.

## Налаштування і запуск

### Вимоги

- Node.js 20+ рекомендовано
- npm
- MongoDB

### Встановлення

```bash
npm install
cp .env.example .env
```

### Development

```bash
npm run dev
```

Безпечна поведінка за замовчуванням у development:

- worker стартує
- підключається до MongoDB
- запускає dispatcher
- може обробляти вручну створені jobs
- може автоматично резюмити paused jobs після Steam `429`
- не запускає scheduled full refresh, якщо явно не ввімкнути `AUTO_REFRESH_ENABLED=true`

### Production

```bash
npm start
```

Типовий production режим:

- `NODE_ENV=production`
- `AUTO_REFRESH_ENABLED=true`

У такому режимі worker також запускає automatic refresh scheduler.

## Змінні середовища

Нижче наведені всі env-змінні, які зараз використовує worker.

### Основний runtime

- `MONGODB_URI`: рядок підключення до MongoDB, який має збігатися з backend.
- `NODE_ENV`: середовище виконання. За замовчуванням `development`.
- `LOG_LEVEL`: рівень structured logger. Підтримуються `debug`, `info`, `warn`, `error`.

### Керування automatic refresh

- `AUTO_REFRESH_ENABLED`: головний прапорець для автоматичних повних циклів refresh. У development фактично за замовчуванням `false`. У production фактично за замовчуванням `true`, якщо явно не перевизначити.
- `AUTO_REFRESH_INTERVAL_MS`: інтервал між automatic refresh cycles. За замовчуванням 6 годин.

### Логування прогресу

- `WORKER_VERBOSE_PROGRESS`: якщо `true`, worker логує прогрес по кожному обробленому skin.
- `WORKER_PROGRESS_EVERY_N_SKINS`: у звичайному режимі логує прогрес кожні N skins. За замовчуванням `100`.

### Повідомлення backend

- `BACKEND_INTERNAL_URL`: базовий URL backend, на який надсилається internal notification.
- `BACKEND_INTERNAL_TOKEN`: опціональний bearer token для internal backend endpoint. В деяких backend-документаціях це може називатися internal token або `INTERNAL_TOKEN`, але в цьому worker env-ім'я саме `BACKEND_INTERNAL_TOKEN`.

### Конфігурація Steam

- `STEAM_MARKET_APP_ID`: Steam app id. За замовчуванням `730` для CS2.

### Кеш цін і поведінка запитів

- `PRICE_CACHE_TTL_MINUTES`: TTL, який записується в price cache documents.
- `PRICE_REQUEST_DELAY_MS`: фіксована затримка між retry-спробами і деякими follow-up запитами.
- `PRICE_REQUEST_RETRIES`: кількість retry-спроб для Steam запитів.

### Rate limits і затримки

Є також внутрішня логіка таймінгів, яка зараз не винесена в env:

- випадкова затримка 3-10 секунд перед Steam request
- exponential backoff для retry запитів
- базова пауза 10 хвилин, коли full pricing sync ставиться на паузу через Steam `429`

## Pricing Sync Flow

Основний flow реалізований у pricing sync runner.

### 1. Старт job

Worker створює або резюмить `PricingSyncJob` document у MongoDB. У job зберігається:

- status
- current collection
- current skin
- лічильники прогресу
- failed і partial items
- `resumeAfter`
- observability fields, наприклад `lastHeartbeatAt`

### 2. Ітерація по колекціях

Runner завантажує collections у стабільному порядку, а потім skins усередині collection також у стабільному порядку.

Це дає детермінований прогрес і дозволяє коректно резюмити sync з checkpoint.

### 3. Отримання цін

Для кожного skin worker:

1. читає поточний cached price map з MongoDB
2. запитує дані у Steam
3. нормалізує price map по exteriors
4. записує оновлений `Pricing` document у MongoDB

### 4. Збереження прогресу

Під час виконання worker періодично оновлює `PricingSyncJob`:

- processed collections
- processed skins
- current collection і current skin
- partial і failed items
- observability fields, наприклад `lastProgressMessage`

### 5. Обробка Steam `429`

Якщо Steam rate limit спрацьовує:

1. worker оновлює прогрес job
2. записує `last429At`
3. збільшує `consecutiveRateLimitPauses`
4. обчислює `resumeAfter`
5. переводить job у статус `paused`
6. планує автоматичний resume

### 6. Resume

Коли настає `resumeAfter`, dispatcher або локальний timer резюмить paused job, і runner продовжує з збереженого checkpoint, а не починає все спочатку.

### 7. Завершення

Коли всі collections успішно оброблені:

- job переходить у статус `completed`
- зберігається `finishedAt`
- очищаються активні checkpoint fields
- worker логує успішне завершення
- worker надсилає best-effort повідомлення на backend

Для paused або failed jobs backend notification не відправляється.

## Поведінка при Rate Limiting

Обробка Steam `429` це одна з ключових задач worker.

### Що відбувається при `429`

Якщо під час pricing fetch спрацьовує rate limit:

- поточна full pricing sync job ставиться на паузу
- checkpoint-дані зберігаються
- виставляється `resumeAfter`
- оновлюються observability-поля
- створюється локальний auto-resume timer

### Логіка `resumeAfter`

Затримка паузи використовує базове вікно очікування і збільшується при послідовних rate-limit паузах.

Тобто:

- перша пауза -> базова затримка
- повторні паузи -> довша затримка

Dispatcher також перевіряє MongoDB на paused jobs, у яких `resumeAfter` вже минув. Завдяки цьому resume працює навіть після рестарту worker.

## Конвертація валюти

### Поточна поведінка worker

Зараз worker запитує Steam у USD-орієнтованому режимі:

- Steam `currency=1`
- Steam `country=US`

Worker зберігає нормалізовані price maps у MongoDB у тому вигляді, у якому вони приходять у цій USD-орієнтованій схемі.

### Логіка USD -> UAH

У цьому репозиторії worker немає логіки конвертації USD -> UAH.

Тобто worker:

- не отримує FX rates
- не конвертує збережені ціни в UAH
- не реалізує display currency або ranking currency logic

Якщо UAH conversion існує в системі в цілому, вона має жити поза цим worker, зазвичай у backend або окремому сервісі.

### Вибір source skin

Окремої логіки “source skin selection” або алгоритму вибору джерела ціни в цьому worker також немає, окрім наявної Steam search та exterior matching логіки.

Worker лише:

- шукає результати у Steam
- матчить результати до підтримуваних exteriors
- записує нормалізований price map

Будь-яка вища бізнес-логіка про те, яка ціна або яке джерело повинні впливати на rankings, належить backend.

## Повідомлення backend

Після того як pricing sync job повністю завершена і збережена зі статусом `completed`, worker викликає:

- `POST /api/internal/rankings/rebuild-after-pricing`

Форма payload:

```json
{
  "pricingSyncJobId": "<job id>",
  "completedAt": "<ISO date>",
  "source": "price-worker"
}
```

Навіщо це потрібно:

- повідомити backend, що в MongoDB з'явилися актуальні pricing data
- дозволити backend самостійно перебудувати rankings або opportunity scans за власною бізнес-логікою

Важливі деталі:

- notification працює в режимі best-effort
- помилка notification не валить worker
- notification відправляється тільки після успішного completion
- для paused або failed jobs notification не відправляється

## Основні модулі

### `pricing-sync`

Основна orchestration-логіка живе в:

- `pricing-sync.dispatcher.js`
- `pricing-sync.runner.js`
- `pricing-sync.service.js`
- `pricing-sync.model.js`

### `pricing-sync.dispatcher.js`

Dispatcher прокидається кожні кілька секунд і вирішує, що робити далі:

- продовжити running job
- резюмити resumable paused job
- переконатися, що paused job має auto-resume timer

### `pricing-sync.runner.js`

Runner виконує основний sync loop:

- ітерує collections
- ітерує skins
- отримує ціни
- оновлює checkpoints
- ставить job на паузу при `429`
- резюмить із checkpoint
- позначає job completed або failed

### `pricing-sync.service.js`

Service layer відповідає за persistence job у MongoDB:

- start
- pause
- resume
- complete
- fail
- checkpoint updates

### `pricing.steam.service.js`

Цей модуль відповідає за інтеграцію зі Steam:

- будує Steam URLs
- виконує fetch-запити
- робить retry
- парсить Steam price payloads
- визначає rate limiting

## Важлива поведінка

### Лише одна job одночасно

Worker спеціально працює консервативно: в одному процесі одночасно може виконуватися тільки один pricing sync runner.

Це зменшує ризики race conditions навколо:

- MongoDB checkpoints
- Steam rate limiting
- cache invalidation

### Логіка resume

Worker спроєктований так, щоб резюмити довгі sync jobs, а не починати все заново.

У MongoDB зберігається достатньо checkpoint-даних, щоб продовжити з:

- поточної collection
- поточного skin
- лічильників прогресу
- часу наступного resume

### Зовнішнє керування станом job

Під час виконання runner періодично перечитує актуальний стан job з MongoDB. Якщо зовнішній actor змінює статус на `paused` або `cancelled`, runner безпечно зупиняється і зберігає checkpoint state.

### Чому worker винесений окремо

Worker винесений в окремий сервіс, тому що price synchronization це:

- довгі операції
- чутливість до rate limiting
- високий обсяг operational logs
- необхідність окремого спостереження і перезапуску

Завдяки цьому backend може фокусуватися на читанні даних і прикладній логіці, а worker на синхронізації цін і зборі даних.
