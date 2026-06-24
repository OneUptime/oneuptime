# MCP-сервер

MCP-сервер OneUptime (Model Context Protocol) предоставляет LLM прямой доступ к вашему экземпляру OneUptime, обеспечивая мониторинг на основе AI, управление инцидентами и операции наблюдаемости.

## Что такое MCP-сервер OneUptime?

MCP-сервер OneUptime — это мост между большими языковыми моделями (LLM) и вашим экземпляром OneUptime. Он реализует протокол Model Context Protocol (MCP), позволяя AI-ассистентам, таким как Claude, напрямую взаимодействовать с вашей инфраструктурой мониторинга.

## Как это работает

MCP-сервер размещён вместе с вашим экземпляром OneUptime и доступен через транспорт Streamable HTTP. Локальная установка не требуется.

**Облачные пользователи**: `https://oneuptime.com/mcp`
**Пользователи с самостоятельным размещением**: `https://your-oneuptime-domain.com/mcp`

## Ключевые возможности

- **Полное покрытие API**: Доступ к 711 конечным точкам API OneUptime
- **126 типов ресурсов**: Управление всеми ресурсами OneUptime, включая мониторы, инциденты, команды, зонды и другое
- **Операции в реальном времени**: Создание, чтение, обновление и удаление ресурсов в реальном времени
- **Типобезопасный интерфейс**: Полностью типизированный с комплексной валидацией входных данных
- **Безопасная аутентификация**: Аутентификация на основе ключей API с надлежащей обработкой ошибок
- **Простая интеграция**: Работает с Claude Desktop и другими MCP-совместимыми клиентами
- **Управление сессиями**: Встроенная обработка сессий с поддержкой автоматического повторного подключения

## Что вы можете делать

С MCP-сервером OneUptime AI-ассистенты могут помочь вам:

- **Управление мониторами**: Создавать и настраивать мониторы, проверять их статус и управлять группами мониторов
- **Реагирование на инциденты**: Создавать инциденты, добавлять заметки, назначать членов команды и отслеживать разрешение
- **Операции с командой**: Управлять командами, правами доступа и расписаниями дежурств
- **Страницы статуса**: Обновлять страницы статуса, создавать объявления и управлять подписчиками
- **Алертинг**: Настраивать правила алертов, управлять политиками эскалации и проверять журналы уведомлений
- **Зонды**: Развёртывать зонды мониторинга в различных местах и управлять ими
- **Отчёты и аналитика**: Генерировать отчёты и анализировать данные мониторинга

## Требования

- Экземпляр OneUptime (облачный или с самостоятельным размещением)
- MCP-совместимый клиент (Claude Desktop, VS Code с GitHub Copilot и т.д.)
- Действительный ключ API OneUptime (требуется только для аутентифицированных операций — публичные инструменты работают без него)

## Получение ключа API

1. Войдите в ваш экземпляр OneUptime
2. Перейдите в **Settings** → **API Keys**
3. Нажмите **Create API Key**
4. Укажите имя (например, "MCP Server")
5. Выберите соответствующие разрешения для вашего случая использования
6. Скопируйте сгенерированный ключ API

## Конфигурация

### Конфигурация Claude Desktop

Найдите файл конфигурации Claude Desktop:

**macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
**Linux**: `~/.config/Claude/claude_desktop_config.json`

### Для OneUptime Cloud

Добавьте следующую конфигурацию:

```json
{
  "mcpServers": {
    "oneuptime": {
      "transport": "streamable-http",
      "url": "https://oneuptime.com/mcp",
      "headers": {
        "x-api-key": "your-api-key-here"
      }
    }
  }
}
```

### Для самостоятельно размещённого OneUptime

Замените `oneuptime.com` на ваш домен OneUptime:

```json
{
  "mcpServers": {
    "oneuptime": {
      "transport": "streamable-http",
      "url": "https://your-oneuptime-domain.com/mcp",
      "headers": {
        "x-api-key": "your-api-key-here"
      }
    }
  }
}
```

### Публичный доступ (без ключа API)

Для использования только публичных инструментов (информации о странице статуса, справки) можно подключиться без ключа API:

```json
{
  "mcpServers": {
    "oneuptime": {
      "transport": "streamable-http",
      "url": "https://oneuptime.com/mcp"
    }
  }
}
```

Эта конфигурация обеспечивает доступ к публичным инструментам страницы статуса и справочным ресурсам без аутентификации.

### VS Code с GitHub Copilot

VS Code поддерживает MCP-серверы нативно с GitHub Copilot (версия 1.99+). Это позволяет Copilot напрямую обращаться к данным OneUptime.

#### Шаг 1: Требования

- VS Code версии 1.99 или выше
- Установленное и активированное расширение GitHub Copilot
- Включённый GitHub Copilot Chat

#### Шаг 2: Откройте конфигурацию MCP

1. Нажмите `Ctrl+Shift+P` (Windows/Linux) или `Cmd+Shift+P` (macOS)
2. Введите "MCP: Open User Configuration" и нажмите Enter
3. Это открывает или создаёт файл конфигурации `mcp.json`

Либо создайте `.vscode/mcp.json` в вашем рабочем пространстве для конфигурации, специфичной для проекта.

#### Для OneUptime Cloud

```json
{
  "servers": {
    "oneuptime": {
      "type": "http",
      "url": "https://oneuptime.com/mcp",
      "headers": {
        "x-api-key": "${input:oneuptime-api-key}"
      }
    }
  },
  "inputs": [
    {
      "type": "promptString",
      "id": "oneuptime-api-key",
      "description": "OneUptime API Key",
      "password": true
    }
  ]
}
```

#### Для самостоятельно размещённого OneUptime

```json
{
  "servers": {
    "oneuptime": {
      "type": "http",
      "url": "https://your-oneuptime-domain.com/mcp",
      "headers": {
        "x-api-key": "${input:oneuptime-api-key}"
      }
    }
  },
  "inputs": [
    {
      "type": "promptString",
      "id": "oneuptime-api-key",
      "description": "OneUptime API Key",
      "password": true
    }
  ]
}
```

#### Шаг 3: Запустите MCP-сервер

1. Нажмите `Ctrl+Shift+P` / `Cmd+Shift+P`
2. Введите "MCP: List Servers", чтобы увидеть доступные серверы
3. Нажмите на "oneuptime", чтобы запустить сервер
4. При появлении запроса введите ваш ключ API OneUptime

#### Шаг 4: Используйте с Copilot Chat

Откройте GitHub Copilot Chat и используйте режим Agent (`@workspace` или спрашивайте напрямую):

```
"What monitors do I have in OneUptime?"
"Show me recent incidents"
"Create a new monitor for https://example.com"
```

#### Примечание по безопасности

Приведённая выше конфигурация использует входные переменные с `"password": true` для безопасного запроса ключа API вместо хранения его в открытом виде. VS Code предложит подтвердить доверие при первом запуске MCP-сервера.

## Доступные конечные точки

| Конечная точка | Метод  | Описание                                                                   |
| -------------- | ------ | -------------------------------------------------------------------------- |
| `/mcp`         | GET    | Поток событий, отправляемых сервером, для уведомлений от сервера к клиенту |
| `/mcp`         | POST   | Запросы JSON-RPC для вызовов инструментов и других операций                |
| `/mcp`         | DELETE | Очистка и завершение сессии                                                |
| `/mcp/health`  | GET    | Конечная точка проверки работоспособности                                  |
| `/mcp/tools`   | GET    | REST API для перечисления доступных инструментов                           |

## Аутентификация

MCP-сервер поддерживает два режима работы:

### Публичные инструменты (аутентификация не требуется)

Вы можете подключиться к MCP-серверу без ключа API для доступа к публичным инструментам:

- **`oneuptime_help`**: Получение справки и руководства по возможностям MCP OneUptime
- **`oneuptime_list_resources`**: Перечисление доступных ресурсов и их операций
- **`get_public_status_page_overview`**: Получение обзора публичной страницы статуса
- **`get_public_status_page_incidents`**: Получение инцидентов с публичной страницы статуса
- **`get_public_status_page_scheduled_maintenance`**: Получение запланированных событий технического обслуживания
- **`get_public_status_page_announcements`**: Получение объявлений с публичной страницы статуса

Инструменты публичной страницы статуса принимают как идентификатор страницы статуса (UUID), так и доменное имя страницы статуса.

### Аутентифицированные инструменты (требуется ключ API)

Для всех других операций (управление мониторами, инцидентами, командами и т.д.) требуется аутентификация через один из следующих заголовков:

- `x-api-key`: Ваш ключ API OneUptime
- `Authorization`: Токен Bearer с вашим ключом API (например, `Bearer your-api-key-here`)

## Проверка

Убедитесь, что MCP-сервер работает:

```bash
# Для OneUptime Cloud
curl https://oneuptime.com/mcp/health

# Для самостоятельного размещения
curl https://your-oneuptime-domain.com/mcp/health
```

Перечислите доступные инструменты:

```bash
# Для OneUptime Cloud
curl https://oneuptime.com/mcp/tools

# Для самостоятельного размещения
curl https://your-oneuptime-domain.com/mcp/tools
```

## Примеры использования

### Базовые информационные запросы

```
"What's the current status of all my monitors?"
"Show me incidents from the last 24 hours"
```

### Управление мониторами

```
"Create a new website monitor for https://example.com that checks every 5 minutes"
"Set up an API monitor for https://api.example.com/health with a 30-second timeout"
"Change the monitoring interval for my website monitor to every 2 minutes"
"Disable the monitor for staging.example.com while we're doing maintenance"
```

### Управление инцидентами

```
"Create a high-priority incident for the database outage affecting user authentication"
"Add a note to incident #123 saying 'Database connection restored, monitoring for stability'"
"Mark incident #456 as resolved"
"Assign the current payment gateway incident to the infrastructure team"
```

### Команда и дежурство

```
"Who are the members of the infrastructure team?"
"Who's currently on call for the infrastructure team?"
"Show me the on-call schedule for this week"
```

### Управление страницами статуса

```
"Update our status page to show 'Investigating Payment Issues' for the payment service"
"Create a status page announcement about scheduled maintenance this weekend"
```

### Запросы к публичной странице статуса (ключ API не требуется)

Эти запросы работают без аутентификации, используя только публичные инструменты страницы статуса:

```
"What's the current status of status.example.com?"
"Show me recent incidents from the OneUptime status page"
"Are there any scheduled maintenance events on status.acme.com?"
"Get the latest announcements from my public status page with ID abc123-..."
```

### Расширенные операции

```
"Create a scheduled maintenance window for Saturday 2-4 AM, disable all monitors for api.example.com during that time, and update the status page"
"Show me all monitors that have been down in the last hour, create incidents for any that don't already have one"
```

## Разрешения ключей API

### Доступ только для чтения

Для просмотра данных добавьте разрешения на чтение для вашего ключа API.

### Полный доступ

Для полного доступа к созданию, обновлению и удалению ресурсов убедитесь, что ваш ключ API имеет разрешения администратора проекта.

### Рекомендации

- Используйте конкретные разрешения: Предоставляйте только минимально необходимые разрешения
- Ротируйте ключи API: Регулярно обновляйте ключи API
- Следите за использованием: Отслеживайте использование ключей API в OneUptime
- Используйте отдельные ключи: Применяйте разные ключи API для разных сред

## Устранение неполадок

### Ошибки разрешений

Убедитесь, что ваш ключ API имеет необходимые разрешения:

- Доступ на чтение для перечисления ресурсов
- Доступ на запись для создания/обновления ресурсов
- Доступ на удаление, если вы хотите удалять ресурсы

### Проблемы с подключением

1. Убедитесь, что URL OneUptime указан правильно
2. Проверьте, что ваш ключ API действителен
3. Убедитесь, что ваш экземпляр OneUptime доступен
4. Проверьте конечную точку работоспособности

### Недействительный ключ API

- Проверьте ключ API в настройках OneUptime
- Проверьте наличие лишних пробелов или символов
- Убедитесь, что срок действия ключа не истёк

### Ошибки сессии

Если вы получаете ошибки, связанные с сессией:

- MCP-сервер использует заголовок `mcp-session-id` для отслеживания сессий
- Убедитесь, что ваш клиент правильно обрабатывает идентификатор сессии, возвращаемый сервером
- Сессии автоматически очищаются при закрытии соединений

## Доступные ресурсы

MCP-сервер предоставляет доступ к 126 типам ресурсов, включая:

**Мониторинг**: Monitor, MonitorStatus, MonitorGroup, Probe
**Инциденты**: Incident, IncidentState, IncidentNote, IncidentTemplate
**Алерты**: Alert, AlertState, AlertSeverity
**Страницы статуса**: StatusPage, StatusPageAnnouncement, StatusPageSubscriber
**Дежурство**: On-CallPolicy, EscalationRule, On-CallSchedule
**Команды**: Team, TeamMember, TeamPermission
**Телеметрия**: TelemetryService, Log, Span, Metric
**Рабочие процессы**: Workflow, WorkflowVariable, WorkflowLog

Каждый ресурс поддерживает стандартные операции: List, Count, Get, Create, Update и Delete.
