# Terraform 공급자 예시

이 문서는 일반적인 OneUptime Terraform 구성에 대한 포괄적인 예시를 제공합니다.

## 기본 예시

### 간단한 프로젝트

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # 자체 호스팅의 경우 "= 7.0.123" 사용
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"  # 자체 호스팅의 경우 변경
  api_key       = var.oneuptime_api_key
}

```

### 기본 모니터

```hcl
resource "oneuptime_monitor" "manual_monitor" {
  name        = "홈페이지 모니터"
  description = "메인 웹사이트 홈페이지를 위한 모니터"
  monitor_type = "Manual"
}
```

### 상태 페이지

```hcl
# 공개 상태 페이지
resource "oneuptime_status_page" "public" {
  name        = "공개 상태 페이지"
  description = "고객 대면 서비스를 위한 공개 상태 페이지"
}
```
