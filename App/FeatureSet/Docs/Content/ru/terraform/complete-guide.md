# Провайдер Terraform для OneUptime

Провайдер Terraform для OneUptime позволяет управлять ресурсами OneUptime с помощью Infrastructure as Code (IaC). Провайдер позволяет настраивать мониторинг, управление инцидентами, страницы статуса и другие функции OneUptime через Terraform.

## Оглавление

- [Установка](#установка)
- [Настройка провайдера](#настройка-провайдера)
- [Быстрый старт](#быстрый-старт)
- [Совместимость версий](#совместимость-версий)
- [Доступные ресурсы](#доступные-ресурсы)
- [Примеры](#примеры)
- [Рекомендации](#рекомендации)
- [Руководство по миграции](#руководство-по-миграции)

## Установка

### Из Terraform Registry (рекомендуется)

Провайдер Terraform для OneUptime доступен в [Terraform Registry](https://registry.terraform.io/providers/oneuptime/oneuptime).

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Используйте последнюю версию 7.x
    }
  }
  required_version = ">= 1.0"
}
```

### Фиксация версии для самостоятельного хостинга

⚠️ **Важно для пользователей с самостоятельным хостингом**: всегда фиксируйте версию провайдера Terraform, совпадающую с версией вашей установки OneUptime, для обеспечения совместимости API.

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Зафиксируйте точную версию, совпадающую с вашей установкой OneUptime
    }
  }
  required_version = ">= 1.0"
}
```

#### Определение версии OneUptime

Версию OneUptime можно определить несколькими способами:

1. **Панель управления**: перейдите в Настройки → О программе в панели управления OneUptime
2. **API**: вызовите конечную точку `GET /api/status`
3. **Docker**: проверьте используемый тег образа
4. **Helm**: проверьте версию Helm-чарта

```bash
# Пример: при запуске OneUptime 7.0.123
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"
    }
  }
}
```

## Настройка провайдера

### Базовая конфигурация

```hcl
provider "oneuptime" {
  oneuptime_url = "https://your-oneuptime-instance.com"  # Или https://oneuptime.com для облака
  api_key       = var.oneuptime_api_key
}
```

### Переменные среды

Провайдер можно настроить через переменные среды:

```bash
export ONEUPTIME_URL="https://your-oneuptime-instance.com"
export ONEUPTIME_API_KEY="your-api-key-here"
```

Затем используйте провайдер без явной конфигурации:

```hcl
provider "oneuptime" {
  # Конфигурация будет считана из переменных среды
}
```

### Параметры конфигурации

| Аргумент | Переменная среды | Описание | Обязательно |
|----------|-----------------|----------|-------------|
| `oneuptime_url` | `ONEUPTIME_URL` | URL OneUptime | Да |
| `api_key` | `ONEUPTIME_API_KEY` | API-ключ OneUptime | Да |

## Быстрый старт

### 1. Создание API-ключа

Сначала создайте API-ключ на панели управления OneUptime:

1. Перейдите в **Настройки** → **API-ключи**
2. Нажмите **Создать API-ключ**
3. Задайте описательное имя (например, «Terraform Automation»)
4. Выберите соответствующие разрешения
5. Скопируйте сгенерированный API-ключ

### 2. Базовая конфигурация Terraform

Создайте файл `main.tf`:

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"  # Используйте URL вашего экземпляра
  api_key       = var.oneuptime_api_key
}

# Примечание: проекты необходимо создавать вручную в панели управления OneUptime
variable "project_id" {
  description = "Идентификатор проекта OneUptime"
  type        = string
}

# Создание монитора
resource "oneuptime_monitor" "website" {
  name        = "Website Monitor"
  description = "Монитор доступности сайта"
  data        = jsonencode({
    url = "https://example.com"
    interval = "5m"
    timeout = "30s"
  })
}

# Создание команды
resource "oneuptime_team" "platform" {
  name        = "Platform Team"
  description = "Команда платформенной инженерии"
}
    value = "alerts@example.com"
  }
}
```

### 3. Инициализация и применение

```bash
# Инициализация Terraform
terraform init

# Планирование изменений
terraform plan

# Применение конфигурации
terraform apply
```

## Совместимость версий

### Облачные пользователи

Для облачных пользователей OneUptime используйте последнюю версию провайдера:

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Всегда используйте последнюю совместимую версию
    }
  }
}
```

### Пользователи с самостоятельным хостингом

**Критически важно**: пользователи с самостоятельным хостингом должны фиксировать версию провайдера, совпадающую с их установкой OneUptime:

| Версия OneUptime | Версия провайдера | Конфигурация |
|-----------------|-------------------|--------------|
| 7.0.x | 7.0.x | `version = "~> 7.0.0"` |
| 7.1.x | 7.1.x | `version = "~> 7.1.0"` |
| 7.2.x | 7.2.x | `version = "~> 7.2.0"` |

Пример для OneUptime 7.0.123:

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Точное совпадение версии
    }
  }
}
```

## Доступные ресурсы

Провайдер Terraform для OneUptime поддерживает следующие ресурсы:

### Базовые ресурсы
- `oneuptime_team` — управление командами

### Мониторинг
- `oneuptime_monitor` — создание и управление мониторами
- `oneuptime_probe` — управление зондами мониторинга

### Управление дежурством
- `oneuptime_on_call_duty_policy` — настройка расписаний дежурства

### Страницы статуса
- `oneuptime_status_page` — создание страниц статуса

### Каталог сервисов
- `oneuptime_service_catalog` — управление записями каталога сервисов

### Каталог сервисов
- `oneuptime_service` — определение сервисов
- `oneuptime_service_dependency` — отображение зависимостей сервисов

### Источники данных
Примечание: источники данных в настоящее время недоступны в провайдере, так как в схеме провайдера не определены datasources.

## Примеры

### Полная настройка мониторинга

```hcl
# Переменные
variable "oneuptime_api_key" {
  description = "API-ключ OneUptime"
  type        = string
  sensitive   = true
}

variable "project_id" {
  description = "Идентификатор проекта OneUptime (создайте проект вручную в панели управления)"
  type        = string
}

variable "oneuptime_url" {
  description = "URL OneUptime"
  type        = string
  default     = "https://oneuptime.com"
}

# Конфигурация провайдера
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"
    }
  }
}

provider "oneuptime" {
  oneuptime_url = var.oneuptime_url
  api_key       = var.oneuptime_api_key
}

# Команда
resource "oneuptime_team" "platform" {
  name        = "Platform Team"
  description = "Команда платформенной инженерии"
}

# Мониторы
resource "oneuptime_monitor" "api" {
  name        = "API Health Check"
  description = "Монитор конечной точки работоспособности API"
  data        = jsonencode({
    url = "https://api.mycompany.com/health"
    method = "GET"
    interval = "1m"
    timeout = "30s"
  })
  }
}

resource "oneuptime_monitor" "database" {
  name       = "Database Connection"
  project_id = oneuptime_project.production.id
  
  monitor_type = "port"
  hostname     = "db.mycompany.com"
  port         = 5432
  interval     = "2m"
  
  tags = {
    service     = "database"
    environment = "production"
    criticality = "critical"
  }
}

# Политика дежурства
resource "oneuptime_on_call_policy" "platform_oncall" {
  name       = "Platform On-Call"
  project_id = oneuptime_project.production.id
  team_id    = oneuptime_team.platform.id
  
  schedules {
    name      = "Business Hours"
    timezone  = "America/New_York"
    
    layers {
      name = "Primary"
      users = ["user1@mycompany.com", "user2@mycompany.com"]
      rotation_type = "weekly"
      start_time = "09:00"
      end_time = "17:00"
      days = ["monday", "tuesday", "wednesday", "thursday", "friday"]
    }
  }
}

# Политика оповещений
resource "oneuptime_alert_policy" "critical_alerts" {
  name       = "Critical System Alerts"
  project_id = oneuptime_project.production.id
  
  conditions {
    monitor_id = oneuptime_monitor.api.id
    threshold  = "down"
  }
  
  conditions {
    monitor_id = oneuptime_monitor.database.id
    threshold  = "down"
  }
  
  actions {
    type = "webhook"
    url  = "https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK"
  }
  
  actions {
    type           = "oncall_escalation"
    oncall_policy_id = oneuptime_on_call_policy.platform_oncall.id
  }
}

# Страница статуса
resource "oneuptime_status_page" "public" {
  name       = "MyCompany Status"
  project_id = oneuptime_project.production.id
  
  domain = "status.mycompany.com"
  
  components {
    name       = "API"
    monitor_id = oneuptime_monitor.api.id
  }
  
  components {
    name       = "Database"
    monitor_id = oneuptime_monitor.database.id
  }
}
```

### Пример конфигурации для самостоятельного хостинга

```hcl
# Для самостоятельного хостинга OneUptime версии 7.0.123
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Должно точно совпадать с версией OneUptime
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.mycompany.com"  # Ваш URL самостоятельного хостинга
  api_key       = var.oneuptime_api_key
}

# Остальная конфигурация...
```

## Рекомендации

### 1. Управление версиями

**Для облачных пользователей:**
- Используйте семантическое версионирование с `~>` для получения совместимых обновлений
- Изучайте журнал изменений перед крупными обновлениями версий

**Для пользователей с самостоятельным хостингом:**
- Всегда фиксируйте точную версию, совпадающую с вашей установкой
- Обновляйте версию провайдера при обновлении OneUptime
- Сначала тестируйте в нерабочей среде

### 2. Управление состоянием

```hcl
terraform {
  backend "s3" {
    bucket = "my-terraform-state"
    key    = "oneuptime/terraform.tfstate"
    region = "us-west-2"
  }
}
```

### 3. Разделение сред

Используйте рабочие пространства или отдельные файлы состояния для разных сред:

```bash
# Использование рабочих пространств
terraform workspace new production
terraform workspace new staging

# Использование отдельных каталогов
mkdir -p environments/{staging,production}
```

### 4. Управление переменными

```hcl
# variables.tf
variable "environment" {
  description = "Имя среды"
  type        = string
}

variable "monitors" {
  description = "Список мониторов для создания"
  type = list(object({
    name = string
    url  = string
    type = string
  }))
}

# terraform.tfvars
environment = "production"
monitors = [
  {
    name = "Website"
    url  = "https://example.com"
    type = "website"
  },
  {
    name = "API"
    url  = "https://api.example.com/health"
    type = "api"
  }
]
```

### 5. Именование ресурсов

Используйте согласованные соглашения об именовании:

```hcl
resource "oneuptime_monitor" "website_production" {
  name = "${var.environment}-website-monitor"
  # ...
}

resource "oneuptime_alert_policy" "critical_production" {
  name = "${var.environment}-critical-alerts"
  # ...
}
```

## Руководство по миграции

### Из ручной конфигурации

1. **Аудит существующих ресурсов** в панели управления OneUptime
2. **Создание конфигурации Terraform** для существующих ресурсов
3. **Импорт существующих ресурсов** в состояние Terraform
4. **Валидация конфигурации** на соответствие текущему состоянию
5. **Применение изменений** постепенно

Пример импорта:

```bash
# Импорт существующего монитора
terraform import oneuptime_monitor.website monitor-id-here

# Импорт существующего проекта
terraform import oneuptime_project.main project-id-here
```

### Обновление версий

При обновлении OneUptime (самостоятельный хостинг):

1. **Создайте резервную копию текущего состояния**
2. **Проверьте совместимость провайдера**
3. **Обновите версию провайдера** в конфигурации
4. **Протестируйте в промежуточной среде**
5. **Примените к производственной среде**

```bash
# Резервное копирование состояния
terraform state pull > backup.tfstate

# Обновление версии провайдера
# Отредактируйте блок terraform в вашей конфигурации

# Планирование и применение
terraform init -upgrade
terraform plan
terraform apply
```

## Поддержка и ресурсы

- **Документация**: [OneUptime Docs](https://docs.oneuptime.com)
- **Terraform Registry**: [Провайдер OneUptime](https://registry.terraform.io/providers/oneuptime/oneuptime)
- **GitHub Issues**: [OneUptime GitHub](https://github.com/OneUptime/oneuptime/issues)
- **Сообщество**: [OneUptime Community](https://community.oneuptime.com)

## Устранение неполадок

### Распространённые проблемы

1. **Несовпадение версий (самостоятельный хостинг)**
   ```
   Error: API version incompatible
   ```
   **Решение**: убедитесь, что версия провайдера совпадает с установкой OneUptime

2. **Проблемы аутентификации**
   ```
   Error: Invalid API key
   ```
   **Решение**: проверьте API-ключ и разрешения

3. **Ресурс не найден**
   ```
   Error: Resource not found
   ```
   **Решение**: проверьте идентификаторы ресурсов и убедитесь, что ресурс существует

### Режим отладки

Включите детальное журналирование:

```bash
export TF_LOG=DEBUG
terraform apply
```

### Проверка версии

Проверьте вашу конфигурацию:

```bash
# Проверка версии Terraform
terraform version

# Проверка версии провайдера
terraform providers

# Валидация конфигурации
terraform validate
```
