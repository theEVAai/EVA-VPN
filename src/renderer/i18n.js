/**
 * Перевод интерфейса.
 *
 * Ключ словаря — сама русская строка, как она написана в коде. Так не нужно
 * выдумывать имена вроде `settings.killswitch.hint` и невозможно потерять
 * строку: если перевода нет, показывается русский оригинал — читаемо, пусть
 * и не на том языке. Обратное (пустое место вместо текста) было бы хуже.
 *
 * Файл лежит в папке окна, потому что окно подключает его тегом <script>,
 * а главный процесс забирает через require. Одна копия словаря на обоих.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.I18N = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const LANGS = [
    { code: 'ru', label: 'Русский' },
    { code: 'en', label: 'English' }
  ];

  const EN = {
    /* Site routing */
    'Домены': 'Domains',
    'Программы': 'Apps',
    'Наборы': 'Presets',
    'Правила трафика': 'Traffic rules',
    'Для каждого сайта — свой маршрут. Остальной трафик использует активный ключ и правила программ.': 'Choose a route for each website. Other traffic follows the active key and app rules.',
    'Новое правило': 'New rule',
    'Изменить правило': 'Edit rule',
    'Название, необязательно': 'Name, optional',
    'Например, YouTube': 'For example, YouTube',
    'Домены или ссылки': 'Domains or URLs',
    'По одному в строке или через запятую. Домен включает поддомены; путь ссылки не учитывается.': 'One per line or separated by commas. Includes subdomains; URL paths are ignored.',
    'Куда направлять': 'Route through',
    'Через активный ключ': 'Active key',
    'Через выбранный ключ': 'Selected key',
    'Активный ключ': 'Active key',
    'Напрямую · Direct': 'Direct',
    'Заблокировать · Block': 'Block',
    'Заблокировано · Block': 'Blocked',
    'ОТМЕНА': 'CANCEL',
    'ДОБАВИТЬ ПРАВИЛО': 'ADD RULE',
    'СОХРАНИТЬ': 'SAVE',
    'СОХРАНЯЮ…': 'SAVING…',
    'Мои правила': 'My rules',
    'Доменные правила важнее программ и наборов. Более точный поддомен важнее общего домена.': 'Domain rules take priority over apps and presets. A more specific subdomain takes priority over its parent.',
    'Поиск по домену, названию или ключу': 'Search by domain, name or key',
    'Найти правило': 'Find a rule',
    'Показать маршрут': 'Show route',
    'Все маршруты': 'All routes',
    'Выбранные ключи': 'Selected keys',
    'Ключ удалён': 'Key removed',
    'Ключ удалён — выберите другой': 'Key removed — choose another',
    'Неизвестный маршрут': 'Unknown route',
    'Для видео и приложений могут понадобиться дополнительные домены CDN. Добавьте их в то же правило. Зашифрованный DNS браузера может мешать определению домена.': 'Videos and apps may need additional CDN domains in the same rule. Browser encrypted DNS may prevent domain detection.',
    'Эти настройки применяются к адресам без доменного правила.': 'These settings apply to addresses without a domain rule.',
    'Без списка программ': 'No app list',
    'Остальной трафик использует активный ключ и готовые наборы.': 'Other traffic uses the active key and presets.',
    'Перечисленные программы идут напрямую, кроме адресов с доменными правилами.': 'Listed apps go direct, except for addresses with domain rules.',
    'Остальные программы идут напрямую, кроме адресов с доменными правилами.': 'Other apps go direct, except for addresses with domain rules.',
    'Программа опознаётся по имени исполняемого файла без учёта регистра. Если у разных программ одинаковое имя файла, правило действует на обе.': 'Apps are matched by executable name, ignoring case. If different apps share a filename, the rule applies to both.',
    'Готовые блокировки и обходы для адресов без доменного правила.': 'Preset blocks and bypasses for addresses without a domain rule.',
    'Сайт увидит ваш обычный IP. DNS-запросы идут напрямую.': 'The website sees your regular IP. DNS queries go direct.',
    'Соединения и DNS-запросы к этим доменам блокируются.': 'Connections and DNS queries to these domains are blocked.',
    'Используется ключ с главного экрана. При смене активного ключа маршрут изменится после переподключения.': 'Uses the key on the home screen. Changing the active key changes this route after reconnecting.',
    'Трафик и DNS идут через этот ключ. Смена активного ключа не меняет привязку.': 'Traffic and DNS use this key. Changing the active key keeps this binding.',
    'По этому запросу правил нет.': 'No rules match this search.',
    'Правил пока нет. Добавьте домен и выберите, через какой ключ его открывать.': 'No rules yet. Add a domain and choose which key should open it.',
    'Включено': 'Enabled',
    'Выключено': 'Disabled',
    'Выберите другой ключ. Пока правило включено, эти домены заблокированы.': 'Choose another key. These domains remain blocked while this rule is enabled.',
    'Изменить': 'Edit',
    'Удалить правило': 'Delete rule',
    'Будут сохранены: ': 'Domains to save: ',
    'Правило сохранено.': 'Rule saved.',
    'Правило удалено.': 'Rule deleted.',
    'Нажмите «Применить», чтобы переподключить VPN с новыми правилами.': 'Click Apply to reconnect the VPN with the new rules.',
    'Применится при следующем подключении.': 'Applies on the next connection.',
    'Не удалось сохранить правило. Повторите попытку.': 'Could not save the rule. Try again.',
    'доменных правил: ': 'domain rules: ',
    'Укажите домен или HTTP(S)-ссылку.': 'Enter a domain or an HTTP(S) URL.',
    'Не удалось прочитать адрес сайта.': 'Could not read the website address.',
    'Ссылка не должна содержать логин или пароль.': 'The URL must not contain a username or password.',
    'Укажите домен, например example.com.': 'Enter a domain, for example example.com.',
    'Нужен полный домен, например example.com. IP-адреса и маски внутри домена не поддерживаются.': 'Enter a full domain such as example.com. IP addresses and wildcards inside domains are not supported.',
    'В одном правиле может быть не больше 1000 доменов.': 'Each rule can contain up to 1000 domains.',
    'Добавьте хотя бы один домен.': 'Add at least one domain.',
    'Не удалось прочитать правило.': 'Could not read the rule.',
    'Выберите действие для доменов.': 'Choose an action for the domains.',
    'Выберите ключ для этого правила.': 'Choose a key for this rule.',
    'Список доменных правил повреждён или содержит больше 300 правил.': 'The domain rule list is invalid or contains more than 300 rules.',
    'В списке доменных правил повторяется идентификатор.': 'The domain rule list contains duplicate identifiers.',
    'Правило уже удалено. Создайте его заново.': 'This rule was deleted. Create it again.',
    'Выбранный ключ удалён. Выберите другой ключ.': 'The selected key was removed. Choose another key.',
    /* ---------------- главный экран ---------------- */
    '// ТУННЕЛЬ': '// TUNNEL',
    '// ЗАЩИТА ВЫКЛ': '// PROTECTION OFF',
    'НЕ ЗАЩИЩЕНО': 'NOT PROTECTED',
    'ЗАЩИЩЕНО': 'PROTECTED',
    'ПОДКЛЮЧЕНИЕ': 'CONNECTING',
    'ОТКЛЮЧЕНИЕ': 'DISCONNECTING',
    'СЕТЬ ЗАБЛОКИРОВАНА': 'NETWORK BLOCKED',
    '// ключ не добавлен': '// no key added',
    'ключ не добавлен': 'no key added',
    '// приём': '// down',
    '// пинг': '// ping',
    '// отдача': '// up',
    '// ID КЛЮЧА ДОСТУПА': '// ACCESS KEY ID',
    '// killswitch держит трафик — нажмите сердце, чтобы снять':
      '// killswitch is holding traffic — press the heart to release',
    'туннель': 'tunnel',
    'прокси': 'proxy',
    'ПРИОРИТЕТ': 'PRIORITY',
    '// защита выкл': '// protection off',
    'ВЕРСИЯ ': 'VERSION ',

    /* ---------------- меню ---------------- */
    'МЕНЮ': 'MENU',
    'Ключи и подписки': 'Keys and subscriptions',
    'Добавить ключ или подписку': 'Add a key or subscription',
    'Личный кабинет': 'Account',
    'Блокировки и обходы': 'Blocking and bypass',
    'Раздельное туннелирование': 'Split tunnelling',
    'Настройки': 'Settings',
    'Восстановить сеть': 'Repair network',
    'если интернет пропал': 'if the internet is gone',
    'Журнал подключения': 'Connection log',
    'Обновление': 'Update',
    'О программе': 'About',
    'нет': 'none',
    'выключено': 'off',
    ' шт.': '',

    /* ---------------- ключи ---------------- */
    'КЛЮЧИ И ПОДПИСКИ': 'KEYS AND SUBSCRIPTIONS',
    'ДОБАВИТЬ КЛЮЧ': 'ADD A KEY',
    'ДОБАВИТЬ': 'ADD',
    'Вставьте ключ': 'Paste a key',
    'или ссылку на подписку': 'or a subscription link',
    '. Можно сразу несколько строк.': '. Several lines at once are fine.',
    'ИЗ БУФЕРА': 'FROM CLIPBOARD',
    'ЗАГРУЗКА…': 'LOADING…',
    'Вставьте ключ или ссылку': 'Paste a key or a link',
    'Нет активного ключа': 'No active key',
    'Ссылка на ключ скопирована': 'Key link copied',
    'ID ключа скопирован': 'Key ID copied',
    'Ключ выбран': 'Key selected',
    'из ': 'of ',
    '<div class="emptyhint">ПОКА НЕТ НИ ОДНОГО КЛЮЧА<br>Добавьте vless:// или ссылку на подписку</div>':
      '<div class="emptyhint">NO KEYS YET<br>Add a vless:// key or a subscription link</div>',

    /* ---------------- цвета ключа ---------------- */
    'Лазурь': 'Azure',
    'Циан': 'Cyan',
    'Мята': 'Mint',
    'Изумруд': 'Emerald',
    'Лайм': 'Lime',
    'Янтарь': 'Amber',
    'Оранж': 'Orange',
    'Алый': 'Scarlet',
    'Вино': 'Wine',
    'Розовый': 'Pink',
    'Фиолет': 'Violet',
    'Индиго': 'Indigo',
    'Сталь': 'Steel',
    'Крем': 'Cream',

    /* ---------------- кабинет ---------------- */
    'ЛИЧНЫЙ КАБИНЕТ': 'ACCOUNT',
    '// вход в кабинет': '// sign in',
    'Почта': 'Email',
    'Пароль': 'Password',
    'РЕГИСТРАЦИЯ': 'SIGN UP',
    'ВОЙТИ': 'SIGN IN',
    'Вход тот же, что на сайте. После входа ключ выдаётся прямо здесь — копировать ссылку вручную больше не нужно.':
      'The same sign-in as on the website. Once you are in, the key is issued right here — no more copying links by hand.',
    'АВТО': 'AUTO',
    '// аккаунт': '// account',
    '// ключ для этого компьютера': '// key for this computer',
    'Сервер': 'Server',
    'ОБНОВИТЬ КЛЮЧ': 'REFRESH KEY',
    'ОТКРЫТЬ САЙТ': 'OPEN THE SITE',
    'ВЫЙТИ': 'SIGN OUT',
    'Цвет ключа': 'Key colour',
    'Удалить': 'Delete',
    'Подписка добавлена: ': 'Subscription added: ',
    ' серверов': ' servers',
    'Добавлено ключей: ': 'Keys added: ',
    'Обновлено серверов: ': 'Servers updated: ',
    'Игровой': 'Gaming',
    'ровный низкий пинг': 'steady low ping',
    'Общий': 'General',
    'обычный выход в интернет': 'ordinary internet access',
    'Каскад': 'Cascade',
    'переживает блокировки': 'survives blocking',
    'Прямой': 'Direct',
    'быстрее, блокируется первым': 'faster, blocked first',
    '<div class="accrow"><span>Аккаунт</span><b>': '<div class="accrow"><span>Account</span><b>',
    '<div class="accrow"><span>Тариф</span><b>': '<div class="accrow"><span>Plan</span><b>',
    '<div class="accrow"><span>Баланс</span><b>': '<div class="accrow"><span>Balance</span><b>',
    '<div class="accrow"><span>Срок</span><b>без ограничения</b></div>':
      '<div class="accrow"><span>Expires</span><b>never</b></div>',
    '<div class="accrow"><span>Осталось</span><b>': '<div class="accrow"><span>Left</span><b>',
    ' дн. · до ': ' days · until ',
    '<div class="accrow"><span>Трафик</span><b>': '<div class="accrow"><span>Traffic</span><b>',
    ' ГБ · без ограничения</b></div>': ' GB · unlimited</b></div>',
    ' ГБ</b></div>': ' GB</b></div>',
    'ключ ещё не выдан': 'no key issued yet',
    '<p class="note">Выбор конкретной страны доступен на тарифе PRO и выше — ':
      '<p class="note">Picking a specific country needs the PRO plan or above — ',
    'сейчас работает автоподбор внутри режима.</p>':
      'right now the server is chosen automatically within the mode.</p>',
    '<div class="group"><div class="glabel">// сменить сервер</div>':
      '<div class="group"><div class="glabel">// change server</div>',
    '<div class="emptyhint">ЗАГРУЗКА…</div>': '<div class="emptyhint">LOADING…</div>',
    'НЕТ ДАННЫХ': 'NO DATA',
    '<br><br></div><div class="btnrow"><button class="primary" id="siteReloadBtn">ОБНОВИТЬ</button></div>':
      '<br><br></div><div class="btnrow"><button class="primary" id="siteReloadBtn">RELOAD</button></div>',
    '<label class="field"><span>Код 2FA</span><input type="text" id="siteCode" inputmode="numeric" autocomplete="off" /></label>':
      '<label class="field"><span>2FA code</span><input type="text" id="siteCode" inputmode="numeric" autocomplete="off" /></label>',
    'Заполните почту и пароль': 'Fill in the email and password',
    'Вход выполнен': 'Signed in',
    'Запрашиваю ключ…': 'Requesting a key…',
    'Ключ обновлён: ': 'Key updated: ',
    'Меняю сервер…': 'Changing server…',
    'Сервер сменён: ': 'Server changed: ',

    /* ---------------- блокировки ---------------- */
    'БЛОКИРОВКИ И ОБХОДЫ': 'BLOCKING AND BYPASS',
    '// что режем': '// what we block',
    '// что пускаем мимо vpn': '// what goes outside the vpn',
    ' включено': ' on',

    /* ---------------- раздельное туннелирование ---------------- */
    'РАЗДЕЛЬНОЕ ТУННЕЛИРОВАНИЕ': 'SPLIT TUNNELLING',
    '// как делим трафик': '// how traffic is split',
    'Выключено': 'Off',
    'Весь трафик идёт через туннель.': 'All traffic goes through the tunnel.',
    'Список — мимо VPN': 'Listed apps bypass the VPN',
    'Через туннель идёт всё, кроме перечисленных программ. Их не касаются и блокировки: адрес у них остаётся ваш настоящий.':
      'Everything goes through the tunnel except the listed apps. Blocking rules do not touch them either: they keep your real address.',
    'Только список — через VPN': 'Only listed apps use the VPN',
    'В туннеле только перечисленные программы, всё остальное идёт напрямую.':
      'Only the listed apps go through the tunnel, everything else goes direct.',
    '// программы': '// applications',
    'Имя файла': 'File name',
    'ВЫБРАТЬ ФАЙЛ': 'PICK A FILE',
    'Программа опознаётся по имени исполняемого файла, регистр значения не имеет. Полный путь можно не указывать — правило переживёт переустановку игры на другой диск. Обратная сторона: если у двух разных программ файл называется одинаково, под правило попадут обе.':
      'An app is matched by the name of its executable; letter case does not matter. There is no need to give the full path — the rule survives moving the game to another drive. The flip side: if two different programs have the same file name, both fall under the rule.',
    'Зачем это нужно: игры с античитом сверяют, откуда вы заходите, и смена страны посреди сессии выглядит для них как угон аккаунта. Вывод игры из туннеля оставляет ей ваш настоящий адрес, а всё остальное продолжает идти через VPN.':
      'Why this exists: anti-cheat systems check where you connect from, and a country change mid-session looks to them like a stolen account. Taking the game out of the tunnel leaves it your real address, while everything else keeps going through the VPN.',
    'мимо VPN: ': 'outside VPN: ',
    'через VPN только: ': 'through VPN only: ',
    '<div class="appempty">список пуст — режим не действует</div>':
      '<div class="appempty">the list is empty — the mode has no effect</div>',
    '" aria-label="Убрать">': '" aria-label="Remove">',
    'Добавлено: ': 'Added: ',
    'Уже в списке': 'Already in the list',

    /* ---------------- настройки ---------------- */
    'НАСТРОЙКИ': 'SETTINGS',
    '// 01 — режим подключения': '// 01 — connection mode',
    'Туннель': 'Tunnel',
    'Виртуальный кабель на весь трафик системы. Ничего не утекает мимо.':
      'A virtual cable for all system traffic. Nothing leaks around it.',
    'Системный прокси': 'System proxy',
    'Без прав администратора, но покрывает только приложения с поддержкой прокси.':
      'No administrator rights needed, but it only covers apps that support a proxy.',
    '// 02 — защита от утечек': '// 02 — leak protection',
    'Блокировать весь трафик мимо туннеля. Может перекрыть локальные сервисы: петлю IPv6 брандмауэр Windows разрешать не умеет':
      'Block all traffic outside the tunnel. May cut off local services: the Windows firewall cannot allow the IPv6 loopback',
    'Пока туннель жив, наружу выпускается только он. Если ядро упадёт или вы нажмёте отключение — интернет встанет вместо того, чтобы пойти напрямую и показать сайтам ваш настоящий адрес. Снять блокировку можно нажатием на сердце, пунктом в трее или кнопкой «Восстановить сеть».':
      'While the tunnel is alive, only it is let out. If the core dies or you press disconnect, the internet stops instead of going direct and showing sites your real address. The block can be lifted by pressing the heart, from the tray menu, or with “Repair network”.',
    'Приоритет над другими VPN': 'Priority over other VPNs',
    'Перебивать чужие туннели (v2rayN и прочие)': 'Outrank other tunnels (v2rayN and the rest)',
    'Блокировать IPv6': 'Block IPv6',
    'Частый канал утечки реального адреса': 'A common channel for leaking your real address',
    '// 03 — поведение': '// 03 — behaviour',
    'Автозапуск с Windows': 'Start with Windows',
    'Подключаться при запуске': 'Connect on launch',
    'Сворачивать в трей': 'Minimise to tray',
    '// 04 — dns и сеть': '// 04 — dns and network',
    'DNS через VPN': 'DNS over VPN',
    'Локальный DNS': 'Local DNS',
    'Ожидание подключения, с': 'Connection timeout, s',
    'Порт прокси': 'Proxy port',
    'Доступ из локальной сети': 'Allow access from the local network',
    '// 05 — язык': '// 05 — language',
    // название языка не переводится: так его узнают в любом интерфейсе
    'Русский': 'Русский',
    'Язык интерфейса': 'Interface language',
    'Как в системе': 'Same as system',

    /* ---------------- журнал ---------------- */
    'ЖУРНАЛ': 'LOG',
    'Журнал скопирован': 'Log copied',
    'Обновить подписки': 'Refresh subscriptions',
    'Проверить соединение': 'Test connection',
    'Открыть папку журналов': 'Open the log folder',
    'Обновляю подписки…': 'Refreshing subscriptions…',
    'Восстанавливаю сеть…': 'Repairing the network…',
    'Готово': 'Done',
    'Проверяю соединение…': 'Testing the connection…',
    'Проверка не удалась': 'The test failed',
    'Трафик проходит · ': 'Traffic is flowing · ',
    ' мс': ' ms',
    'без пинга': 'no ping',
    ' · рядом: ': ' · nearby: ',
    'Трафик НЕ проходит': 'Traffic is NOT flowing',
    ' · мешает ': ' · blocked by ',
    ' — смотрите журнал': ' — see the log',
    'Туннель поднят, но трафик не проходит': 'The tunnel is up, but no traffic passes',
    'Блокировка снята': 'The block has been lifted',
    'Применится после переподключения': 'Will apply after reconnecting',
    'Переподключаю…': 'Reconnecting…',
    'Изменения применены': 'Changes applied',

    /* ---------------- о программе ---------------- */
    'О ПРОГРАММЕ': 'ABOUT',
    'Клиент VLESS / Reality на ядре sing-box. Открытый код, без телеметрии и без вмешательства в чужие подключения.':
      'A VLESS / Reality client on the sing-box core. Open source, no telemetry, and no interference with other people’s connections.',
    'Исходный код': 'Source code',

    /* ---------------- обновление ---------------- */
    'ОБНОВЛЕНИЕ': 'UPDATE',
    '// новая версия': '// new version',
    'Проверяю…': 'Checking…',
    'ОТМЕНИТЬ': 'CANCEL',
    'ПРОВЕРИТЬ': 'CHECK',
    'ПРОВЕРЯЮ…': 'CHECKING…',
    'ОБНОВИТЬ': 'UPDATE',
    'ПОДОЖДИТЕ…': 'HOLD ON…',
    'Подождите чуть-чуть — приложение обновится и запустится само.':
      'Hold on a moment — the app will update and start itself.',
    '// проверяю обновления…': '// checking for updates…',
    '// вышла версия ': '// new version out: ',
    '// подождите чуть-чуть · ': '// hold on a moment · ',
    '// подождите чуть-чуть · ставлю': '// hold on a moment · installing',
    '// подождите, приложение перезапустится': '// hold on, the app will restart',
    '// не получилось обновиться': '// the update did not go through',
    'УСТАНОВИТЬ': 'INSTALL',
    'ЗАГРУЖАЮ…': 'DOWNLOADING…',
    'ПЕРЕЗАПУСТИТЬ И ПОСТАВИТЬ': 'RESTART AND INSTALL',
    'УСТАНАВЛИВАЮ…': 'INSTALLING…',
    'ПОПРОБОВАТЬ СНОВА': 'TRY AGAIN',
    'версия ': 'version ',
    ' готова к установке': ' is ready to install',
    'Не получилось: ': 'It did not work: ',
    'без описания': 'no description',
    'Смотрю, нет ли новой версии…': 'Looking for a newer version…',
    'Запускаю установщик. Приложение сейчас закроется и откроется заново.':
      'Starting the installer. The app will now close and open again.',
    'Файл загружен и проверен по контрольной сумме. Можно ставить.':
      'The file is downloaded and its checksum verified. Ready to install.',
    'Скачать нужно ': 'Needs to download ',
    ' МБ. ': ' MB. ',
    'Установка идёт поверх текущей версии.': 'It installs over the current version.',
    'Проверить не вышло: ': 'The check failed: ',
    'У вас последняя версия.': 'You have the latest version.',
    ' из ': ' of ',
    'Установлена последняя версия': 'The latest version is installed',
    'Версия ': 'Version ',
    ' на месте. Ключи, вход в кабинет и настройки остались как были.':
      ' is in place. Your keys, account sign-in and settings are untouched.',
    'Приложение скачивает установщик из релизов на GitHub и сверяет его контрольную сумму sha256 с той, что отдаёт API. Если суммы разойдутся, файл удаляется и ничего не ставится. Установка идёт поверх текущей версии: ключи, вход в кабинет и настройки остаются на месте, а туннель поднимется сам, если был поднят до обновления.':
      'The app downloads the installer from GitHub releases and compares its sha256 checksum with the one the API reports. If they differ, the file is deleted and nothing is installed. It installs over the current version: keys, account sign-in and settings stay in place, and the tunnel comes back up by itself if it was up before the update.',
    '// обновление установлено': '// update installed',
    'СПАСИБО, ЧТО УСТАНОВИЛИ НОВУЮ ВЕРСИЮ!': 'THANK YOU FOR INSTALLING THE NEW VERSION!',
    'ПОЕХАЛИ': 'LET’S GO',

    /* ---------------- права и панель применения ---------------- */
    '// требуются права': '// rights required',
    'НУЖЕН АДМИНИСТРАТОР': 'ADMINISTRATOR REQUIRED',
    'Туннель создаёт системный сетевой адаптер и перехватывает весь трафик — Windows разрешает это только с правами администратора.':
      'The tunnel creates a system network adapter and intercepts all traffic — Windows only allows that with administrator rights.',
    'ОБОЙТИСЬ ПРОКСИ': 'USE THE PROXY INSTEAD',
    'ПЕРЕЗАПУСТИТЬ': 'RESTART',
    '// изменения ждут переподключения': '// changes are waiting for a reconnect',
    'ПРИМЕНИТЬ': 'APPLY',

    /* ---------------- подписи кнопок окна ---------------- */
    'Свернуть': 'Minimise',
    'Закрыть': 'Close',
    'Меню': 'Menu',
    'Поделиться ключом': 'Share the key',
    'Включить VPN': 'Turn the VPN on',
    'Скопировать': 'Copy',
    'Назад': 'Back',

    /* ---------------- названия модулей (rules.js) ---------------- */
    'Трекеры и метрики': 'Trackers and analytics',
    'Яндекс.Метрика, Google Analytics, Meta Pixel и ещё 30 счётчиков':
      'Yandex.Metrica, Google Analytics, Meta Pixel and thirty more counters',
    'Российские сайты мимо VPN': 'Russian sites bypass the VPN',
    '.ru, .su, .рф, банки, госуслуги, маркетплейсы — быстрее и без блокировок за иностранный адрес':
      '.ru, .su, .рф, banks, government services, marketplaces — faster and without being blocked for a foreign address',
    'Починить Kodik': 'Fix Kodik',
    'Плеер аниме и фильмов не отдаёт видео через прокси — пускаем напрямую':
      'The anime and film player refuses to serve video over a proxy — we let it go direct',
    'Торренты мимо VPN': 'Torrents bypass the VPN',
    'Раздача и закачка идут напрямую через провайдера. Разгружает туннель, но ваш настоящий адрес виден каждому участнику раздачи':
      'Seeding and downloading go straight through your provider. It unloads the tunnel, but every peer in the swarm sees your real address',
    'App Store мимо VPN': 'App Store bypasses the VPN',
    'Apple обрывает загрузки через прокси: магазин виснет на «Ожидание», обновления не докачиваются':
      'Apple breaks downloads over a proxy: the store hangs on “Waiting”, updates never finish',
    'обязательно включить': 'keep this on',

    /* ---------------- ошибки кабинета (site.js) ---------------- */
    'Сессия истекла, войдите заново': 'The session has expired, please sign in again',
    'Нужен код из приложения': 'A code from your authenticator app is required',
    'Код не подошёл': 'That code did not work',
    'На аккаунте нет активного тарифа': 'The account has no active plan',
    'Тариф BASIC не включает ПК — нужен PRO или выше': 'The BASIC plan does not cover PCs — PRO or above is needed',
    'Подтвердите почту в кабинете': 'Confirm your email in the account area',
    'Закончился баланс — пополните в кабинете': 'Your balance has run out — top it up in the account area',
    'Выбор страны не входит в ваш тариф': 'Choosing a country is not part of your plan',
    'Свободных серверов сейчас нет': 'There are no free servers right now',
    'В этом направлении нет серверов': 'There are no servers in that direction',
    'Слишком часто — подождите минуту': 'Too often — wait a minute',
    'Сайт не ответил вовремя (502) — панель могла не успеть выдать ключ':
      'The site did not answer in time (502) — the panel may not have finished issuing the key',
    'Сайт не ответил вовремя (504)': 'The site did not answer in time (504)',
    'Сервер не принял запрос': 'The server rejected the request',
    'Сайт недоступен: ': 'The site is unreachable: ',
    'нет ответа': 'no answer',
    'Сайт не выдал сессию': 'The site did not issue a session',

    /* ---------------- разбор ключей ---------------- */
    'vless: не хватает UUID или адреса': 'vless: the UUID or the address is missing',
    'vmess: не удалось разобрать ссылку': 'vmess: could not parse the link',
    'ss: не удалось разобрать ссылку': 'ss: could not parse the link',
    'Неподдерживаемый тип ключа: ': 'Unsupported key type: ',

    /* ---------------- трей и события приложения (main.js) ---------------- */
    'версия ': 'version ',
    ' · сборка от ': ' · built ',
    'упакована': 'packaged',
    'режим разработки': 'development mode',
    'подключён': 'connected',
    'отключён': 'disconnected',
    'Ключ не добавлен': 'No key added',
    'Отключить': 'Disconnect',
    'Подключить': 'Connect',
    'Показать окно': 'Show the window',
    'Снять блокировку сети': 'Lift the network block',
    'Сеть восстановлена': 'The network has been repaired',
    'Выход': 'Quit',
    'операция: ': 'operation: ',
    'Сначала добавьте ключ доступа': 'Add an access key first',
    'Нет ключа': 'No key',
    'Подключение: ': 'Connecting: ',
    '), режим ': '), mode ',
    'Не удалось подключиться: ': 'Could not connect: ',
    'Рядом работает чужой туннель: ': 'Another tunnel is running alongside: ',
    ' (маршрутов по умолчанию: ': ' (default routes: ',
    'Рядом работает ': 'Running alongside: ',
    ' — подавлен на время сессии': ' — suppressed for this session',
    ' — включите приоритет или выключите соседа': ' — turn on priority or switch the other one off',
    'Killswitch блокировал системный трафик — снимаю его':
      'The killswitch was blocking system traffic — lifting it',
    'Killswitch блокировал трафик — снят, соединение работает':
      'The killswitch was blocking traffic — lifted, the connection works',
    'Трафик не проходит даже без killswitch — смотрите журнал':
      'Traffic does not pass even without the killswitch — see the log',
    'Туннель поднят, но трафик не проходит — смотрите журнал':
      'The tunnel is up, but no traffic passes — see the log',
    'Отключение по команде пользователя': 'Disconnected on the user’s command',
    'Переподключение остановлено: ': 'Reconnecting stopped: ',
    ' обрывов за 10 минут. Смотрите журнал выше.': ' drops in 10 minutes. See the log above.',
    'Туннель падает раз за разом — переподключение остановлено':
      'The tunnel keeps dying — reconnecting has been stopped',
    'Обрыв ': 'Drop ',
    ', повтор через ': ', retry in ',
    ' с': ' s',
    'Переподключение (': 'Reconnecting (',
    'автоповтор': 'auto-retry',
    'подключение': 'connect',
    'отключение': 'disconnect',
    'В подписке нет ключей': 'The subscription has no keys',
    'Пусто': 'Empty',
    'Подписка не загрузилась: ': 'The subscription did not load: ',
    'Не похоже на ключ или ссылку подписки': 'This does not look like a key or a subscription link',
    'Нет подписок': 'No subscriptions',
    'Брандмауэр Windows выключен — killswitch не удержит трафик':
      'The Windows firewall is off — the killswitch will not hold traffic',
    'Выберите программы': 'Choose applications',
    'Программы': 'Applications',
    'Не выполнен вход': 'Not signed in',
    'Сайт не отдал ключ': 'The site did not return a key',
    'снятие блокировки': 'lifting the block',
    'Блокировка сети снята вручную': 'The network block was lifted manually',
    'Туннель не запущен': 'The tunnel is not running',
    'Ошибка ядра: ': 'Core error: ',
    'Восстановление после сбоя: ': 'Recovery after a crash: ',
    'Не найдено ядро sing-box:\n': 'The sing-box core was not found:\n',
    'Обновление установлено: ': 'Update installed: ',
    'Автозапуск восстановлен после обновления': 'Autostart restored after the update',

    /* ---------------- ядро (core.js) ---------------- */
    'Запуск уже идёт — повторный запрос отброшен': 'A start is already in progress — the repeat request was dropped',
    'Подключение уже выполняется': 'A connection is already being made',
    'Прошлый адаптер ещё в системе — поднимаем туннель поверх':
      'The previous adapter is still in the system — bringing the tunnel up over it',
    'системный прокси': 'system proxy',
    'Не удалось запустить ядро: ': 'Could not start the core: ',
    'Ядро завершилось (код ': 'The core exited (code ',
    'Ядро не ответило вовремя': 'The core did not answer in time',
    'Ядро не поднялось: ': 'The core did not come up: ',
    'Повторная попытка запуска: убираю хвосты прошлой':
      'Retrying the start: clearing leftovers from the previous one',
    'Системный прокси включён: 127.0.0.1:': 'System proxy enabled: 127.0.0.1:',
    'Приоритет туннеля: метрика 1': 'Tunnel priority: metric 1',
    ' · подавлены: ': ' · suppressed: ',
    ' (метрика 9000': ' (metric 9000',
    ', снято маршрутов ': ', routes removed: ',
    ', DNS очищен': ', DNS cleared',
    'Killswitch включён: исходящий трафик мимо туннеля заблокирован':
      'Killswitch on: outbound traffic outside the tunnel is blocked',
    'Брандмауэр Windows выключен (': 'The Windows firewall is off (',
    ') — killswitch не удержит трафик. Включите брандмауэр.':
      ') — the killswitch will not hold traffic. Turn the firewall on.',
    'Killswitch снят': 'Killswitch lifted',
    'нет потока': 'no stream',
    'трафик системы идёт через туннель': 'system traffic goes through the tunnel',
    'ядро работает, но трафик системы наружу не выпускается (killswitch или маршруты)':
      'the core works, but system traffic is not let out (killswitch or routes)',
    'ядро не отдаёт трафик': 'the core passes no traffic',
    'Самопроверка: ': 'Self-test: ',
    ' · системой ': ' · by the system ',
    ' за ': ' in ',
    ' · через ядро ': ' · through the core ',
    ' · задержка ': ' · latency ',
    'Сетевой адаптер занят прошлым запуском': 'The network adapter is held by the previous run',
    'Ядро уже запущено: файл кэша занят другим экземпляром':
      'The core is already running: the cache file is held by another instance',
    'Нет прав администратора для режима туннеля': 'No administrator rights for tunnel mode',
    'Порт занят другим приложением': 'The port is taken by another application',
    'Ключ не поддерживается ядром': 'The core does not support this key',
    'Сервер отклонил подключение (проверьте ключ)': 'The server refused the connection (check the key)',

    /* ---------------- обновление (updater.js) ---------------- */
    'GitHub ответил ': 'GitHub answered ',
    'последний релиз черновой': 'the latest release is a draft',
    'в релизе нет номера версии': 'the release has no version number',
    'в релизе нет установщика': 'the release has no installer',
    'ссылка на файл ведёт не на GitHub': 'the file link does not point to GitHub',
    'GitHub не дал контрольную сумму, ставить такое нельзя':
      'GitHub gave no checksum; installing that is not acceptable',
    'Доступно обновление ': 'Update available ',
    ' МБ)': ' MB)',
    'нечего скачивать': 'nothing to download',
    'уже качается': 'already downloading',
    'сервер ответил ': 'the server answered ',
    'загрузка увела на посторонний адрес': 'the download was redirected to a foreign address',
    'контрольная сумма не сошлась: файл повреждён или подменён':
      'the checksum did not match: the file is damaged or substituted',
    'размер файла не совпал с заявленным': 'the file size did not match the declared one',
    'Обновление ': 'Update ',
    ' загружено и проверено по sha256': ' downloaded and verified by sha256',
    'Обновление не загрузилось: ': 'The update did not download: ',
    'отменено': 'cancelled',
    'файл обновления не готов': 'the update file is not ready',
    'Запускаю установку ': 'Starting the installation of ',

    /* ---------------- единицы ---------------- */
    ' Б/с': ' B/s',
    ' КБ/с': ' KB/s',
    ' МБ/с': ' MB/s',
    ' Б': ' B',
    ' КБ': ' KB',
    ' МБ': ' MB',
    ' ГБ': ' GB'
  };

  const DICTS = { ru: null, en: EN };

  /**
   * Текущий язык для главного процесса.
   *
   * Модуль в Node загружается один раз, поэтому main, core и updater
   * пользуются общим состоянием: достаточно один раз вызвать setLang.
   * У окна свой экземпляр, ему язык ставит applyLang.
   */
  let active = 'ru';

  function setLang(lang) {
    active = DICTS[lang] ? lang : 'ru';
    return active;
  }

  /** Перевод по текущему языку. Незнакомая строка возвращается как есть. */
  function t(s) {
    const dict = DICTS[active];
    const key = String(s);
    if (!dict) return key;
    return Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : key;
  }

  /** Возвращает функцию перевода для языка. Для русского — тождество. */
  function translator(lang) {
    const dict = DICTS[lang];
    if (!dict) return (s) => s;
    return (s) => {
      const key = String(s);
      return Object.prototype.hasOwnProperty.call(dict, key) ? dict[key] : key;
    };
  }

  /** Язык по коду локали системы: русский только для явно русской локали. */
  function fromLocale(locale) {
    return /^ru\b/i.test(String(locale || '')) ? 'ru' : 'en';
  }

  /** Приводит настройку к рабочему коду языка. */
  function resolve(setting, locale) {
    if (setting === 'ru' || setting === 'en') return setting;
    return fromLocale(locale);
  }

  return { LANGS, DICTS, translator, fromLocale, resolve, setLang, t };
});
