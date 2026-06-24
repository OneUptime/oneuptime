# Операции с ресурсами

CLI OneUptime предоставляет полные CRUD-операции (создание, чтение, обновление, удаление) для всех поддерживаемых ресурсов. Ресурсы автоматически обнаруживаются из вашего экземпляра OneUptime.

## Доступные ресурсы

Выполните следующую команду, чтобы просмотреть все доступные типы ресурсов:

```bash
oneuptime resources
```

Вы можете фильтровать по типу:

```bash
# Показать только ресурсы базы данных
oneuptime resources --type database

# Показать только аналитические ресурсы
oneuptime resources --type analytics
```

Распространённые ресурсы включают:

| Ресурс                               | Команда                                 |
| ------------------------------------ | --------------------------------------- |
| Инцидент                             | `oneuptime incident`                    |
| Алерт                                | `oneuptime alert`                       |
| Монитор                              | `oneuptime monitor`                     |
| Статус монитора                      | `oneuptime monitor-status`              |
| Состояние инцидента                  | `oneuptime incident-state`              |
| Страница статуса                     | `oneuptime status-page`                 |
| Политика дежурства                   | `oneuptime on-call-policy`              |
| Команда                              | `oneuptime team`                        |
| Запланированное событие обслуживания | `oneuptime scheduled-maintenance-event` |

## Список ресурсов

Получение списка ресурсов с опциональной фильтрацией, пагинацией и сортировкой.

```bash
oneuptime <resource> list [options]
```

**Опции:**

| Опция                   | Описание                            | По умолчанию |
| ----------------------- | ----------------------------------- | ------------ |
| `--query <json>`        | Критерии фильтрации в формате JSON  | Нет          |
| `--limit <n>`           | Максимальное количество результатов | `10`         |
| `--skip <n>`            | Количество пропускаемых результатов | `0`          |
| `--sort <json>`         | Порядок сортировки в формате JSON   | Нет          |
| `-o, --output <format>` | Формат вывода                       | `table`      |

**Примеры:**

```bash
# Список 10 последних инцидентов
oneuptime incident list

# Фильтрация инцидентов по ID состояния
oneuptime incident list --query '{"currentIncidentStateId":"<state-id>"}'

# Список с пагинацией
oneuptime incident list --limit 20 --skip 40

# Сортировка по дате создания (по убыванию)
oneuptime incident list --sort '{"createdAt":-1}'

# Вывод в формате JSON
oneuptime incident list -o json
```

## Получение ресурса

Получение одного ресурса по его ID.

```bash
oneuptime <resource> get <id>
```

**Аргументы:**

| Аргумент | Описание          |
| -------- | ----------------- |
| `<id>`   | ID ресурса (UUID) |

**Примеры:**

```bash
# Получение конкретного инцидента
oneuptime incident get 550e8400-e29b-41d4-a716-446655440000

# Получение монитора в формате JSON
oneuptime monitor get abc-123 -o json
```

## Создание ресурса

Создание нового ресурса из встроенного JSON или файла.

```bash
oneuptime <resource> create [options]
```

**Опции:**

| Опция                   | Описание                            |
| ----------------------- | ----------------------------------- |
| `--data <json>`         | Данные ресурса в виде JSON-объекта  |
| `--file <path>`         | Путь к JSON-файлу с данными ресурса |
| `-o, --output <format>` | Формат вывода                       |

Необходимо указать либо `--data`, либо `--file`.

**Примеры:**

```bash
# Создание инцидента с встроенным JSON
oneuptime incident create --data '{"title":"API Outage","currentIncidentStateId":"<state-id>","incidentSeverityId":"<severity-id>","declaredAt":"2025-01-15T10:30:00Z"}'

# Создание из JSON-файла
oneuptime incident create --file incident.json

# Создание и вывод в формате JSON для захвата ID
oneuptime monitor create --data '{"name":"API Health Check"}' -o json
```

## Обновление ресурса

Обновление существующего ресурса по ID.

```bash
oneuptime <resource> update <id> [options]
```

**Аргументы:**

| Аргумент | Описание   |
| -------- | ---------- |
| `<id>`   | ID ресурса |

**Опции:**

| Опция                   | Описание                                         |
| ----------------------- | ------------------------------------------------ |
| `--data <json>`         | Поля для обновления в формате JSON (обязательно) |
| `-o, --output <format>` | Формат вывода                                    |

**Примеры:**

```bash
# Изменение состояния инцидента (например, на resolved)
oneuptime incident update abc-123 --data '{"currentIncidentStateId":"<resolved-state-id>"}'

# Переименование монитора
oneuptime monitor update abc-123 --data '{"name":"Updated Monitor Name"}'
```

## Удаление ресурса

Удаление ресурса по ID.

```bash
oneuptime <resource> delete <id> [--force]
```

**Аргументы:**

| Аргумент | Описание   |
| -------- | ---------- |
| `<id>`   | ID ресурса |

**Опции:**

| Опция     | Описание                        |
| --------- | ------------------------------- |
| `--force` | Пропустить запрос подтверждения |

**Примеры:**

```bash
oneuptime incident delete abc-123
oneuptime monitor delete 550e8400-e29b-41d4-a716-446655440000

# Пропуск подтверждения
oneuptime monitor delete 550e8400-e29b-41d4-a716-446655440000 --force
```

## Подсчёт ресурсов

Подсчёт ресурсов, соответствующих опциональным критериям фильтрации.

```bash
oneuptime <resource> count [options]
```

**Опции:**

| Опция            | Описание                           |
| ---------------- | ---------------------------------- |
| `--query <json>` | Критерии фильтрации в формате JSON |

**Примеры:**

```bash
# Подсчёт всех инцидентов
oneuptime incident count

# Подсчёт инцидентов по состоянию
oneuptime incident count --query '{"currentIncidentStateId":"<state-id>"}'

# Подсчёт мониторов
oneuptime monitor count
```

## Аналитические ресурсы

Аналитические ресурсы поддерживают ограниченный набор операций по сравнению с ресурсами базы данных:

| Операция | Поддерживается |
| -------- | -------------- |
| `list`   | Да             |
| `create` | Да             |
| `count`  | Да             |
| `get`    | Нет            |
| `update` | Нет            |
| `delete` | Нет            |

Используйте `oneuptime resources --type analytics`, чтобы узнать, какие аналитические ресурсы доступны в вашем экземпляре.
