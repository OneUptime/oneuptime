# Краткое руководство по провайдеру Terraform

Это руководство поможет вам начать работу с провайдером Terraform для OneUptime за несколько минут.

## Предварительные требования

- Установленный Terraform >= 1.0
- Учётная запись OneUptime (облачная или самостоятельный хостинг)
- API-ключ OneUptime

## Шаг 1: Создание API-ключа

### Для облачного OneUptime

1. Перейдите на [OneUptime Cloud](https://oneuptime.com) и войдите в систему
2. Перейдите в **Настройки** → **API-ключи**
3. Нажмите **Создать API-ключ**
4. Назовите его «Terraform Provider»
5. Выберите необходимые разрешения
6. Скопируйте сгенерированный API-ключ

### Для OneUptime с самостоятельным хостингом

1. Перейдите на ваш экземпляр OneUptime
2. Перейдите в **Настройки** → **API-ключи**
3. Нажмите **Создать API-ключ**
4. Назовите его «Terraform Provider»
5. Выберите необходимые разрешения
6. Скопируйте сгенерированный API-ключ

## Шаг 2: Создание конфигурации Terraform

Создайте новый каталог и файл `main.tf`:

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      # Для облачных пользователей
      version = "~> 7.0"

      # Для пользователей с самостоятельным хостингом — зафиксируйте точную версию
      # version = "= 7.0.123"  # Замените версией OneUptime
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  # Для облачных пользователей
  oneuptime_url = "https://oneuptime.com"

  # Для пользователей с самостоятельным хостингом — используйте URL вашего экземпляра
  # oneuptime_url = "https://oneuptime.yourcompany.com"

  api_key = var.oneuptime_api_key
}

variable "oneuptime_api_key" {
  description = "API-ключ OneUptime"
  type        = string
  sensitive   = true
}

# Примечание: проекты необходимо создавать вручную в панели управления OneUptime
# Используйте идентификатор вашего существующего проекта здесь
variable "project_id" {
  description = "Идентификатор проекта OneUptime"
  type        = string
}

# Создание простого монитора сайта
resource "oneuptime_monitor" "website" {
  name        = "Website Monitor"
  description = "Монитор доступности сайта"
  data        = jsonencode({
    url = "https://example.com"
    interval = "5m"
    timeout = "30s"
  })
}

# Вывод идентификатора монитора
output "monitor_id" {
  value = oneuptime_monitor.website.id
}
```

## Шаг 3: Создание файла переменных

Создайте `terraform.tfvars`:

```hcl
# terraform.tfvars
oneuptime_api_key = "your-api-key-here"
project_id        = "your-project-id-here"  # Получите из панели управления OneUptime
```

**Важно**: добавьте `terraform.tfvars` в `.gitignore`, чтобы скрыть API-ключи!

## Шаг 4: Инициализация и применение

```bash
# Инициализация Terraform
terraform init

# Планирование развёртывания
terraform plan

# Применение конфигурации
terraform apply
```

## Шаг 5: Проверка ресурсов

1. Проверьте панель управления OneUptime
2. Перейдите в ваш существующий проект
3. Убедитесь, что «Website Monitor» создан и работает

## Следующие шаги

1. **Изучите другие ресурсы**: ознакомьтесь с [полной документацией](./README.md) по всем доступным ресурсам
2. **Настройте оповещения**: добавьте политики оповещений и каналы уведомлений
3. **Создайте страницы статуса**: настройте публичные страницы статуса для ваших сервисов
4. **Организуйте с помощью команд**: создайте команды и назначьте разрешения

## Примеры для конкретных версий

### Облачные пользователи (последняя версия)

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Всегда получает последнюю совместимую версию 7.x
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"
  api_key       = var.oneuptime_api_key
}
```

### Пользователи с самостоятельным хостингом (фиксированная версия)

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Должно точно совпадать с вашей версией OneUptime
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.mycompany.com"  # URL вашего самостоятельного хостинга
  api_key       = var.oneuptime_api_key
}
```

## Устранение неполадок при быстром старте

### Проблема: Провайдер не найден

```
Error: Failed to query available provider packages
```

**Решение**: выполните `terraform init` для загрузки провайдера

### Проблема: Ошибка аутентификации

```
Error: Invalid API key
```

**Решение**:

1. Проверьте API-ключ в панели управления OneUptime
2. Убедитесь, что API-ключ имеет достаточные разрешения
3. Убедитесь в правильности `oneuptime_url` для вашего экземпляра

### Проблема: Несовпадение версий (самостоятельный хостинг)

```
Error: API version incompatible
```

**Решение**:

1. Проверьте версию OneUptime в панели управления
2. Обновите версию провайдера до точного совпадения
3. Выполните `terraform init -upgrade`

## Очистка

Для удаления всех ресурсов, созданных в этом кратком руководстве:

```bash
terraform destroy
```

Это удалит монитор и проект, созданные при быстром старте.
