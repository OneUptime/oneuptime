# Руководство по установке и использованию провайдера Terraform

## Установка из Terraform Registry

Провайдер Terraform для OneUptime доступен в официальном [Terraform Registry](https://registry.terraform.io/providers/oneuptime/oneuptime).

### Для облачных пользователей OneUptime

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Используйте последнюю совместимую версию
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"
  api_key       = var.oneuptime_api_key
}
```

### Для пользователей с самостоятельным хостингом OneUptime

⚠️ **Критически важно**: пользователи с самостоятельным хостингом должны фиксировать версию провайдера, точно совпадающую с их установкой OneUptime.

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Замените вашей точной версией OneUptime
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"  # URL вашего самостоятельного хостинга
  api_key       = var.oneuptime_api_key
}
```

## Почему важна фиксация версий для самостоятельного хостинга?

Провайдер Terraform для OneUptime автоматически генерируется из спецификации API OneUptime. Каждая версия OneUptime может иметь:

- Различные конечные точки API
- Обновлённые схемы ресурсов
- Новые или удалённые функции
- Изменённые правила валидации

Использование версии провайдера, не совпадающей с вашей установкой OneUptime, может привести к:
- Ошибкам совместимости API
- Неудачному созданию/обновлению ресурсов
- Неожиданному поведению
- Дрейфу состояния ресурсов

## Определение версии OneUptime

### Метод 1: Панель управления
1. Войдите в панель управления OneUptime
2. Перейдите в **Настройки** → **О программе**
3. Запишите номер версии (например, «7.0.123»)

### Метод 2: API
```bash
curl https://your-oneuptime-instance.com/api/version | jq '.version'
```

### Метод 3: Docker
```bash
docker images | grep oneuptime
# Посмотрите тег, например: oneuptime/dashboard:7.0.123
```

## Информация о реестре провайдера

- **URL реестра**: https://registry.terraform.io/providers/oneuptime/oneuptime
- **Репозиторий**: https://github.com/OneUptime/terraform-provider-oneuptime
- **Документация**: https://registry.terraform.io/providers/oneuptime/oneuptime/latest/docs
- **Релизы**: https://github.com/OneUptime/terraform-provider-oneuptime/releases

## Матрица совместимости версий

| Версия OneUptime | Версия провайдера | Конфигурация Terraform |
|-----------------|-------------------|------------------------|
| 7.0.x | 7.0.x | `version = "~> 7.0.0"` |
| 7.1.x | 7.1.x | `version = "~> 7.1.0"` |
| Последний облачный | Последний провайдер | `version = "~> 7.0"` |

## Пример быстрого старта

```hcl
# Настройка провайдера
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Настройте для самостоятельного хостинга
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"  # Настройте для самостоятельного хостинга
  api_key       = var.oneuptime_api_key
}

# Создание проекта
resource "oneuptime_project" "example" {
  name        = "Terraform Example"
  description = "Создано с помощью Terraform"
}

# Создание монитора сайта
resource "oneuptime_monitor" "website" {
  name       = "Website Monitor"
  project_id = oneuptime_project.example.id
  
  monitor_type = "website"
  url          = "https://example.com"
  interval     = "5m"
  
  tags = {
    managed_by = "terraform"
  }
}
```

## Шаги установки

1. **Создайте конфигурацию Terraform** с блоком провайдера
2. **Инициализируйте Terraform**: `terraform init`
3. **Установите API-ключ**: создайте `terraform.tfvars` с вашим API-ключом
4. **Спланируйте развёртывание**: `terraform plan`
5. **Примените конфигурацию**: `terraform apply`

## Получение помощи

- **Полная документация**: см. [полное руководство по Terraform](./README.md)
- **Руководство для самостоятельного хостинга**: ознакомьтесь с [руководством по конфигурации для самостоятельного хостинга](./self-hosted.md)
- **Примеры**: просмотрите [примеры конфигурации](./examples.md)
- **Быстрый старт**: следуйте [краткому руководству](./quick-start.md)

## Обновления реестра

Провайдер автоматически публикуется в Terraform Registry при выходе новых версий OneUptime. Облачные пользователи могут использовать семантическое версионирование (`~> 7.0`) для автоматического получения совместимых обновлений, тогда как пользователям с самостоятельным хостингом следует фиксировать точные версии.
