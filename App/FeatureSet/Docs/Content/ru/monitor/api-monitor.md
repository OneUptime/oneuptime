# Монитор API

Мониторинг API позволяет отслеживать доступность, производительность и корректность работы ваших HTTP/REST API. OneUptime периодически отправляет HTTP-запросы к указанным конечным точкам API и оценивает ответы на основе заданных критериев.

## Обзор

Мониторы API отправляют HTTP-запросы к вашим конечным точкам и проверяют ответы. Это позволяет:

- Мониторинг доступности и работоспособности API
- Отслеживание времени отклика и производительности
- Проверка HTTP-кодов состояния и тел ответов
- Валидация заголовков ответов
- Тестирование различных HTTP-методов (GET, POST, PUT, DELETE и др.)
- Отправка пользовательских заголовков и тел запросов

## Создание монитора API

1. Перейдите в раздел **Мониторы** на панели управления OneUptime
2. Нажмите **Создать монитор**
3. Выберите тип монитора **API**
4. Введите URL API и настройте параметры запроса
5. При необходимости настройте критерии мониторинга

## Параметры конфигурации

### URL API

Введите полный URL конечной точки API, которую хотите отслеживать (например, `https://api.example.com/v1/health`).

### Динамические плейсхолдеры URL

При мониторинге API за CDN или кеширующими прокси монитор может получать кешированный ответ вместо обращения к исходному серверу. Для обхода кеша при каждой проверке можно использовать динамические плейсхолдеры, которые заменяются уникальным значением при каждом запросе мониторинга.

#### Поддерживаемые плейсхолдеры

| Плейсхолдер | Описание | Пример значения |
|-------------|----------|-----------------|
| `{{timestamp}}` | Заменяется текущей временной меткой Unix (в секундах) | `1719500000` |
| `{{random}}` | Заменяется случайной уникальной строкой | `a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5` |

#### Пример

Настройте URL монитора с плейсхолдером:

```
https://api.example.com/health?cb={{timestamp}}
```

При каждой проверке мониторинга URL принимает вид:

```
https://api.example.com/health?cb=1719500000
https://api.example.com/health?cb=1719500005
...
```

Также можно использовать `{{random}}` для получения уникальной строки при каждом запросе:

```
https://api.example.com/health?nocache={{random}}
```

### Тип запроса API

Выберите HTTP-метод для запроса:

- **GET** (по умолчанию)
- **POST**
- **PUT**
- **DELETE**
- **PATCH**
- **HEAD**

### Дополнительные параметры

#### Заголовки запроса

Добавьте пользовательские HTTP-заголовки к запросу. Это полезно для токенов аутентификации, указания типа содержимого и других специфических для API заголовков.

Для безопасного хранения конфиденциальных данных, таких как ключи API, можно использовать [Секреты монитора](/docs/monitor/monitor-secrets) в значениях заголовков.

#### Тело запроса (JSON)

Для запросов POST, PUT и PATCH можно задать тело запроса в формате JSON. В теле запроса также можно использовать [Секреты монитора](/docs/monitor/monitor-secrets).

#### Не следовать перенаправлениям

По умолчанию OneUptime следует HTTP-перенаправлениям (301, 302 и др.). Включите этот параметр, если хотите отслеживать сам ответ перенаправления, а не конечный адрес.

#### Allow Self-Signed Certificates

Enable this option to skip TLS certificate validation. Useful when the target server uses a self-signed or otherwise untrusted TLS certificate (for example, an internal staging environment).

#### Client Certificate (mTLS)

If your endpoint requires mutual TLS authentication, enable **Use client certificate (mTLS)** and provide:

- **Client Certificate (PEM)** — the PEM-encoded client certificate to present.
- **Client Private Key (PEM)** — the matching PEM-encoded private key.
- **Client Private Key Passphrase** *(optional)* — required only if the private key is encrypted.

This is the OneUptime equivalent of the `--cert` and `--key` flags in curl:

```bash
curl --cert client.crt --key client.key https://api.example.com/health
```

For sensitive values, store the certificate and key as [Monitor Secrets](/docs/monitor/monitor-secrets) and reference them with `{{monitorSecrets.name}}`. Monitor Secrets are resolved server-side and the rendered values never appear in the dashboard.

## Критерии мониторинга

Можно настроить критерии, определяющие, считается ли ваш API доступным, деградированным или недоступным, на основе:

- **Код состояния ответа** — проверка соответствия HTTP-кода ожидаемым значениям (например, 200, 201)
- **Время отклика** — мониторинг превышения порогового значения времени отклика
- **Тело ответа** — проверка наличия или соответствия определённого содержимого в теле ответа
- **Заголовки ответа** — проверка наличия или соответствия определённых заголовков ответа
- **Выражение JavaScript** — написание пользовательских выражений для оценки ответа. Подробнее см. в разделе [Выражения JavaScript](/docs/monitor/javascript-expression).
