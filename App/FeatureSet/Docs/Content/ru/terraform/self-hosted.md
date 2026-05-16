# Руководство по конфигурации Terraform для самостоятельного хостинга OneUptime

Это руководство предназначено специально для клиентов, использующих самостоятельно размещённые экземпляры OneUptime. В нём рассматривается управление версиями, конфигурация и рекомендации по использованию провайдера Terraform с вашим собственным развёртыванием OneUptime.

## Важные замечания

⚠️ **Проекты нельзя создавать через Terraform** — проекты необходимо сначала создать вручную в панели управления OneUptime. Используйте идентификатор проекта в своих конфигурациях Terraform.

⚠️ **Важнейшее правило для пользователей с самостоятельным хостингом**: всегда фиксируйте версию провайдера Terraform, точно совпадающую с версией вашей установки OneUptime.

## Структура ресурсов

Все ресурсы Terraform для OneUptime следуют упрощённой структуре:
- `name` (обязательно) — имя ресурса
- `description` (необязательно) — описание ресурса
- `data` (необязательно) — сложная конфигурация в формате JSON

## Критически важно: совместимость версий

⚠️ **Важнейшее правило для пользователей с самостоятельным хостингом**: всегда фиксируйте версию провайдера Terraform, точно совпадающую с версией вашей установки OneUptime.

### Почему фиксация версий критически важна

- Провайдер Terraform автоматически генерируется из API OneUptime
- Каждая версия OneUptime может иметь различные конечные точки API и схемы
- Использование несовпадающей версии провайдера может вызвать ошибки или неожиданное поведение
- Фиксация версии обеспечивает совместимость и предсказуемое поведение

## Определение версии OneUptime

### Метод 1: Панель управления
1. Войдите в панель управления OneUptime
2. Перейдите в **Настройки** → **О программе**
3. Запишите номер версии (например, «7.0.123»)

### Метод 2: Конечная точка API
```bash
curl https://your-oneuptime-instance.com/api/status
```

### Метод 3: Образы Docker
При запуске OneUptime с Docker:
```bash
docker images | grep oneuptime
# Посмотрите тег, например: oneuptime/dashboard:7.0.123
```

### Метод 4: Helm-чарт
При использовании Helm:
```bash
helm list -n oneuptime
# Проверьте версию чарта
```

### Метод 5: Переменные среды
Проверьте ваши конфигурационные файлы на наличие переменных версии:
```bash
grep -r "APP_VERSION\|IMAGE_TAG" /path/to/your/oneuptime/config
```

## Шаблоны конфигурации провайдера

### Шаблон для версии 7.0.x

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Замените 123 вашим точным номером сборки
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"  # URL вашего самостоятельного хостинга
  api_key       = var.oneuptime_api_key
}
```

### Шаблон для версии 7.1.x

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.1.45"  # Замените вашей точной версией
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"
  api_key       = var.oneuptime_api_key
}
```

## Полный пример конфигурации для самостоятельного хостинга

Полный пример для самостоятельно размещённого экземпляра OneUptime:

```hcl
# versions.tf
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Должно совпадать с вашей версией OneUptime
    }
  }
  required_version = ">= 1.0"
  
  # Необязательно: используйте удалённое хранилище состояния для командной работы
  backend "s3" {
    bucket = "your-terraform-state-bucket"
    key    = "oneuptime/terraform.tfstate"
    region = "us-west-2"
  }
}

# variables.tf
variable "oneuptime_url" {
  description = "URL экземпляра OneUptime"
  type        = string
  default     = "https://oneuptime.yourcompany.com"
}

variable "oneuptime_api_key" {
  description = "API-ключ OneUptime"
  type        = string
  sensitive   = true
}

variable "environment" {
  description = "Имя среды"
  type        = string
  default     = "production"
}

# providers.tf
provider "oneuptime" {
  oneuptime_url = var.oneuptime_url
  api_key       = var.oneuptime_api_key
}

# variables.tf
variable "project_id" {
  description = "Идентификатор проекта OneUptime (создайте вручную в панели управления)"
  type        = string
}

# main.tf
# Создание команд
resource "oneuptime_team" "infrastructure" {
  name        = "Infrastructure Team"
  description = "Команда инфраструктуры и эксплуатации"
}

resource "oneuptime_team" "development" {
  name        = "Development Team"
  description = "Команда разработки приложений"  
  project_id = oneuptime_project.main.id
}

# Мониторы инфраструктуры
resource "oneuptime_monitor" "database" {
  name       = "${var.environment}-database"
  project_id = oneuptime_project.main.id
  
  monitor_type = "port"
  hostname     = "db.internal.yourcompany.com"
  port         = 5432
  interval     = "2m"
  timeout      = "10s"
  
  tags = {
    team        = "infrastructure"
    service     = "database"
    environment = var.environment
    criticality = "critical"
  }
}

resource "oneuptime_monitor" "application" {
  name       = "${var.environment}-application"
  project_id = oneuptime_project.main.id
  
  monitor_type = "website"
  url          = "https://app.yourcompany.com/health"
  interval     = "1m"
  timeout      = "30s"
  
  expected_status_codes = [200]
  
  tags = {
    team        = "development"
    service     = "application"
    environment = var.environment
    criticality = "high"
  }
}

# Политики дежурства
resource "oneuptime_on_call_policy" "infrastructure_oncall" {
  name       = "Infrastructure On-Call"
  project_id = oneuptime_project.main.id
  team_id    = oneuptime_team.infrastructure.id
  
  schedules {
    name     = "24x7 Infrastructure"
    timezone = "America/New_York"
    
    layers {
      name          = "Primary"
      users         = ["infra1@yourcompany.com", "infra2@yourcompany.com"]
      rotation_type = "weekly"
      start_time    = "00:00"
      end_time      = "23:59"
      days          = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    }
  }
}

# Политики оповещений
resource "oneuptime_alert_policy" "critical_infrastructure" {
  name       = "Critical Infrastructure Alerts"
  project_id = oneuptime_project.main.id
  
  conditions {
    monitor_id = oneuptime_monitor.database.id
    threshold  = "down"
  }
  
  actions {
    type = "email"
    recipients = ["infrastructure@yourcompany.com"]
  }
  
  actions {
    type             = "oncall_escalation"
    oncall_policy_id = oneuptime_on_call_policy.infrastructure_oncall.id
  }
}

# Внутренняя страница статуса
resource "oneuptime_status_page" "internal" {
  name       = "Internal Services Status"
  project_id = oneuptime_project.main.id
  
  domain = "status.internal.yourcompany.com"
  
  components {
    name       = "Database"
    monitor_id = oneuptime_monitor.database.id
  }
  
  components {
    name       = "Application"
    monitor_id = oneuptime_monitor.application.id
  }
}

# outputs.tf
output "project_id" {
  description = "Идентификатор проекта"
  value       = oneuptime_project.main.id
}

output "status_page_url" {
  description = "URL страницы статуса"
  value       = "https://${oneuptime_status_page.internal.domain}"
}
```

## Конфигурация для конкретных сред

### Среда разработки

```hcl
# dev.tfvars
oneuptime_url = "https://oneuptime-dev.yourcompany.com"
environment = "development"
```

### Промежуточная среда

```hcl
# staging.tfvars
oneuptime_url = "https://oneuptime-staging.yourcompany.com"  
environment = "staging"
```

### Производственная среда

```hcl
# prod.tfvars
oneuptime_url = "https://oneuptime.yourcompany.com"
environment = "production"
```

## Процесс обновления для самостоятельного хостинга

При обновлении экземпляра OneUptime:

### 1. Чек-лист перед обновлением

```bash
# Резервная копия текущего состояния Terraform
terraform state pull > backup-$(date +%Y%m%d).tfstate

# Запись текущей версии OneUptime
curl https://oneuptime.yourcompany.com/api/status | jq '.version'

# Запись текущей версии провайдера
terraform providers | grep oneuptime
```

### 2. Обновление экземпляра OneUptime

Следуйте стандартному процессу обновления OneUptime (Docker, Helm и др.)

### 3. Обновление провайдера Terraform

```hcl
# Обновите версию в блоке terraform
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.124"  # Новая версия после обновления
    }
  }
}
```

### 4. Тестирование и применение

```bash
# Обновление провайдера
terraform init -upgrade

# Планирование для просмотра изменений
terraform plan

# Применение при одобрении
terraform apply
```

## Настройка сети

### Правила брандмауэра

Убедитесь, что ваш исполнитель Terraform имеет доступ к:
- Конечной точке API OneUptime (обычно порт 443/HTTPS)
- Любым внутренним ресурсам, находящимся под мониторингом

### VPN/частные сети

При размещении OneUptime в частной сети:

```hcl
provider "oneuptime" {
  oneuptime_url = "https://10.0.1.100:443"  # Внутренний IP
  api_key       = var.oneuptime_api_key
}
```

## Рекомендации по безопасности

### 1. Управление API-ключами

```bash
# Используйте переменные среды
export ONEUPTIME_API_KEY="your-api-key"

# Или используйте систему управления секретами
export ONEUPTIME_API_KEY=$(vault kv get -field=api_key secret/oneuptime)
```

### 2. API-ключи с минимальными привилегиями

Создавайте API-ключи с минимально необходимыми разрешениями:
- Управление мониторами
- Управление политиками оповещений
- Управление командами (при необходимости)

### 3. Сетевая безопасность

```hcl
# Пример с верификацией TLS
provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"
  api_key       = var.oneuptime_api_key
  
  # Дополнительные параметры безопасности при поддержке
  verify_ssl = true
  timeout    = "30s"
}
```

## Мониторинг вашей автоматизации Terraform

Создайте мониторы для вашей автоматизации Terraform:

```hcl
resource "oneuptime_monitor" "terraform_runner" {
  name       = "Terraform Runner Health"
  project_id = oneuptime_project.main.id
  
  monitor_type = "heartbeat"
  interval     = "15m"
  
  tags = {
    automation = "terraform"
    criticality = "medium"
  }
}
```

## Устранение неполадок для самостоятельного хостинга

### Проблема: Отказ в соединении

```
Error: connection refused
```

**Решения**:
1. Убедитесь, что экземпляр OneUptime запущен
2. Проверьте правильность URL API
3. Проверьте сетевое подключение и брандмауэр
4. Убедитесь в действительности TLS-сертификатов

### Проблема: Несовпадение версий API

```
Error: API version incompatible
```

**Решения**:
1. Проверьте версию OneUptime: `curl https://your-instance/api/status`
2. Обновите версию провайдера до совпадающей
3. Выполните `terraform init -upgrade`

### Проблема: Самоподписанные сертификаты

При использовании самоподписанных сертификатов:

```bash
# Временный обход верификации TLS (не рекомендуется для производственной среды)
export ONEUPTIME_SKIP_TLS_VERIFY=true
```

Лучшее решение: добавьте ваш CA-сертификат в хранилище доверия системы.

## Резервное копирование и аварийное восстановление

### Резервная копия состояния

```bash
# Регулярное резервное копирование состояния
terraform state pull > backup-$(date +%Y%m%d-%H%M%S).tfstate

# Скрипт автоматического резервного копирования
#!/bin/bash
DATE=$(date +%Y%m%d-%H%M%S)
terraform state pull > "backups/terraform-state-${DATE}.tfstate"
find backups/ -name "terraform-state-*.tfstate" -mtime +30 -delete
```

### Резервная копия конфигурации

```bash
# Резервная копия конфигурации Terraform
tar -czf terraform-config-$(date +%Y%m%d).tar.gz *.tf *.tfvars
```

## Управление несколькими средами

### Использование рабочих пространств

```bash
# Создание сред
terraform workspace new dev
terraform workspace new staging  
terraform workspace new prod

# Переключение между средами
terraform workspace select prod
terraform apply -var-file="prod.tfvars"
```

### Использование отдельных каталогов

```
terraform/
├── environments/
│   ├── dev/
│   │   ├── main.tf
│   │   └── terraform.tfvars
│   ├── staging/
│   │   ├── main.tf
│   │   └── terraform.tfvars
│   └── prod/
│       ├── main.tf
│       └── terraform.tfvars
└── modules/
    └── oneuptime/
        ├── main.tf
        ├── variables.tf
        └── outputs.tf
```

Такой подход обеспечивает лучшую изоляцию и упрощает управление версиями для каждой среды.
