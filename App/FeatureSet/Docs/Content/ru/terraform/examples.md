# Примеры провайдера Terraform

Этот документ содержит исчерпывающие примеры типичных конфигураций Terraform для OneUptime.

## Базовые примеры

### Простой проект

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Используйте "= 7.0.123" для самостоятельного хостинга
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"  # Замените для самостоятельного хостинга
  api_key       = var.oneuptime_api_key
}

```

### Базовый монитор

```hcl
resource "oneuptime_monitor" "manual_monitor" {
  name        = "Homepage Monitor"
  description = "Монитор главной страницы сайта"
  monitor_type = "Manual"
}
```

### Страницы статуса

```hcl
# Публичная страница статуса
resource "oneuptime_status_page" "public" {
  name        = "Public Status Page"
  description = "Публичная страница статуса для пользовательских сервисов"
}
```
