# Аутентификация

CLI OneUptime поддерживает несколько способов аутентификации с вашим экземпляром OneUptime. Вы можете использовать именованные контексты, переменные окружения или передавать учётные данные непосредственно в виде флагов.

## Вход в систему

Выполните аутентификацию в вашем экземпляре OneUptime с помощью ключа API:

```bash
oneuptime login <api-key> <instance-url>
```

**Аргументы:**

| Аргумент | Описание |
|----------|-------------|
| `<api-key>` | Ваш ключ API OneUptime (например, `sk-your-api-key`) |
| `<instance-url>` | URL вашего экземпляра OneUptime (например, `https://oneuptime.com`) |

**Опции:**

| Опция | Описание |
|--------|-------------|
| `--context-name <name>` | Имя для этого контекста (по умолчанию: `"default"`) |

**Примеры:**

```bash
# Вход с контекстом по умолчанию
oneuptime login sk-abc123 https://oneuptime.com

# Вход с именованным контекстом
oneuptime login sk-abc123 https://oneuptime.com --context-name production

# Настройка нескольких сред
oneuptime login sk-prod-key https://oneuptime.com --context-name production
oneuptime login sk-staging-key https://staging.oneuptime.com --context-name staging
```

## Контексты

Контексты позволяют сохранять и переключаться между несколькими средами OneUptime (например, production, staging, development).

### Список контекстов

```bash
oneuptime context list
```

Отображает все настроенные контексты. Текущий контекст отмечен символом `*`.

### Переключение контекста

```bash
oneuptime context use <name>
```

Переключается на другой именованный контекст для всех последующих команд.

```bash
# Переключение на staging
oneuptime context use staging

# Переключение на production
oneuptime context use production
```

### Просмотр текущего контекста

```bash
oneuptime context current
```

Отображает активный контекст, включая URL экземпляра и скрытый ключ API.

### Удаление контекста

```bash
oneuptime context delete <name>
```

Удаляет именованный контекст. Если удалённый контекст является текущим, CLI автоматически переключается на первый оставшийся контекст.

## Разрешение учётных данных

Учётные данные разрешаются в следующем порядке приоритета:

1. **Флаги CLI** (`--api-key` и `--url`)
2. **Переменные окружения** (`ONEUPTIME_API_KEY` и `ONEUPTIME_URL`)
3. **Именованный контекст** (через флаг `--context`)
4. **Текущий контекст** (из сохранённой конфигурации)

Вы можете комбинировать источники — например, использовать переменную окружения для ключа API и сохранённый контекст для URL.

### Использование флагов CLI

```bash
oneuptime --api-key sk-abc123 --url https://oneuptime.com incident list
```

### Использование переменных окружения

```bash
export ONEUPTIME_API_KEY=sk-abc123
export ONEUPTIME_URL=https://oneuptime.com

oneuptime incident list
```

### Использование конкретного контекста

```bash
oneuptime --context production incident list
```

## Проверка аутентификации

Проверьте текущий статус аутентификации:

```bash
oneuptime whoami
```

Отображает:
- URL экземпляра
- Скрытый ключ API
- Имя текущего контекста (отображается только при активном сохранённом контексте)

Если аутентификация не выполнена, команда выводит полезное сообщение с предложением выполнить `oneuptime login`.

## Файл конфигурации

Учётные данные хранятся в `~/.oneuptime/config.json` с ограниченными правами доступа (`0600`).

```json
{
  "currentContext": "production",
  "contexts": {
    "production": {
      "name": "production",
      "apiUrl": "https://oneuptime.com",
      "apiKey": "sk-..."
    },
    "staging": {
      "name": "staging",
      "apiUrl": "https://staging.oneuptime.com",
      "apiKey": "sk-..."
    }
  },
  "defaults": {
    "output": "table",
    "limit": 10
  }
}
```
