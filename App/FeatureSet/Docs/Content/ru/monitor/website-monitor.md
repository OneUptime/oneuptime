# Монитор сайтов

Мониторинг сайтов позволяет отслеживать доступность, производительность и ответы любого сайта или веб-страницы. OneUptime периодически отправляет HTTP-запросы на указанный URL сайта и проверяет корректность ответов.

## Обзор

Мониторы сайтов проверяют веб-страницы, выполняя HTTP-запросы и оценивая ответы. Это позволяет:

- Мониторинг доступности и работоспособности сайтов
- Отслеживание времени отклика и производительности
- Проверка HTTP-кодов состояния
- Проверка заголовков ответов
- Обнаружение простоев раньше, чем их заметят пользователи

## Создание монитора сайтов

1. Перейдите в раздел **Мониторы** на панели управления OneUptime
2. Нажмите **Создать монитор**
3. Выберите тип монитора **Сайт**
4. Введите URL сайта для мониторинга
5. При необходимости настройте критерии мониторинга

## Параметры конфигурации

### URL сайта

Введите полный URL сайта, включая протокол (например, `https://example.com`).

### Динамические плейсхолдеры URL

При мониторинге URL за CDN или кеширующими прокси монитор может получать кешированный ответ вместо обращения к исходному серверу. Для обхода кеша при каждой проверке можно использовать динамические плейсхолдеры, которые заменяются уникальным значением при каждом запросе мониторинга.

#### Поддерживаемые плейсхолдеры

| Плейсхолдер     | Описание                                              | Пример значения                    |
| --------------- | ----------------------------------------------------- | ---------------------------------- |
| `{{timestamp}}` | Заменяется текущей временной меткой Unix (в секундах) | `1719500000`                       |
| `{{random}}`    | Заменяется случайной уникальной строкой               | `a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5` |

#### Пример

Настройте URL монитора с плейсхолдером:

```
https://example.com/health?cb={{timestamp}}
```

При каждой проверке мониторинга URL принимает вид:

```
https://example.com/health?cb=1719500000
https://example.com/health?cb=1719500005
...
```

Также можно использовать `{{random}}` для получения уникальной строки при каждом запросе:

```
https://example.com/health?nocache={{random}}
```

### Дополнительные параметры

#### Не следовать перенаправлениям

По умолчанию OneUptime следует HTTP-перенаправлениям (301, 302 и др.). Включите этот параметр, если хотите отслеживать сам ответ перенаправления, а не конечный адрес.

#### Allow Self-Signed Certificates

Enable this option to skip TLS certificate validation. Useful when the target server uses a self-signed or otherwise untrusted TLS certificate (for example, an internal staging environment).

#### Client Certificate (mTLS)

If your endpoint requires mutual TLS authentication, enable **Use client certificate (mTLS)** and provide:

- **Client Certificate (PEM)** — the PEM-encoded client certificate to present.
- **Client Private Key (PEM)** — the matching PEM-encoded private key.
- **Client Private Key Passphrase** _(optional)_ — required only if the private key is encrypted.

This is the OneUptime equivalent of the `--cert` and `--key` flags in curl:

```bash
curl --cert client.crt --key client.key https://api.example.com/health
```

For sensitive values, store the certificate and key as [Monitor Secrets](/docs/monitor/monitor-secrets) and reference them with `{{monitorSecrets.name}}`. Monitor Secrets are resolved server-side and the rendered values never appear in the dashboard.

## Критерии мониторинга

Можно настроить критерии, определяющие, считается ли сайт доступным, деградированным или недоступным, на основе:

- **Код состояния ответа** — проверка соответствия HTTP-кода ожидаемым значениям (например, 200, 301)
- **Время отклика** — мониторинг превышения порогового значения времени отклика
- **Тело ответа** — проверка наличия или соответствия определённого содержимого в теле ответа
- **Заголовки ответа** — проверка наличия или соответствия определённых заголовков ответа
