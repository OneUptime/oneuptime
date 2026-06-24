# OneUptime Terraform 공급자

OneUptime Terraform 공급자를 통해 인프라 코드(IaC)를 사용하여 OneUptime 리소스를 관리할 수 있습니다. 이 공급자를 통해 Terraform을 통해 모니터링, 인시던트 관리, 상태 페이지 및 기타 OneUptime 기능을 구성할 수 있습니다.

## 목차

- [설치](#installation)
- [공급자 구성](#provider-configuration)
- [빠른 시작](#quick-start)
- [버전 호환성](#version-compatibility)
- [사용 가능한 리소스](#available-resources)
- [예시](#examples)
- [모범 사례](#best-practices)
- [마이그레이션 가이드](#migration-guide)

## 설치

### Terraform 레지스트리에서 (권장)

OneUptime Terraform 공급자는 [Terraform 레지스트리](https://registry.terraform.io/providers/oneuptime/oneuptime)에서 사용할 수 있습니다.

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # 최신 7.x 버전 사용
    }
  }
  required_version = ">= 1.0"
}
```

### 자체 호스팅 설치의 버전 고정

⚠️ **자체 호스팅 고객에게 중요**: API 호환성을 보장하기 위해 Terraform 공급자 버전을 항상 OneUptime 설치 버전과 일치하도록 고정합니다.

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # OneUptime 설치와 일치하는 정확한 버전으로 고정
    }
  }
  required_version = ">= 1.0"
}
```

#### OneUptime 버전 찾기

여러 가지 방법으로 OneUptime 버전을 찾을 수 있습니다:

1. **대시보드**: OneUptime 대시보드에서 설정 → 정보로 이동합니다
2. **API**: `GET /api/status` 엔드포인트 호출
3. **Docker**: 사용 중인 이미지 태그 확인
4. **Helm**: Helm 차트 버전 확인

```bash
# 예시: OneUptime 7.0.123을 실행 중인 경우
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"
    }
  }
}
```

## 공급자 구성

### 기본 구성

```hcl
provider "oneuptime" {
  oneuptime_url = "https://your-oneuptime-instance.com"  # 또는 클라우드의 경우 https://oneuptime.com
  api_key       = var.oneuptime_api_key
}
```

### 환경 변수

환경 변수를 사용하여 공급자를 구성할 수 있습니다:

```bash
export ONEUPTIME_URL="https://your-oneuptime-instance.com"
export ONEUPTIME_API_KEY="your-api-key-here"
```

그런 다음 명시적 구성 없이 공급자를 사용합니다:

```hcl
provider "oneuptime" {
  # 구성은 환경 변수에서 읽힙니다
}
```

### 구성 옵션

| 인수            | 환경 변수           | 설명             | 필수 여부 |
| --------------- | ------------------- | ---------------- | --------- |
| `oneuptime_url` | `ONEUPTIME_URL`     | OneUptime URL    | 예        |
| `api_key`       | `ONEUPTIME_API_KEY` | OneUptime API 키 | 예        |

## 빠른 시작

### 1. API 키 생성

먼저 OneUptime 대시보드에서 API 키를 생성합니다:

1. **설정** → **API 키**로 이동합니다
2. **API 키 생성**을 클릭합니다
3. 설명적인 이름을 지정합니다 (예: "Terraform 자동화")
4. 적절한 권한을 선택합니다
5. 생성된 API 키를 복사합니다

### 2. 기본 Terraform 구성

`main.tf` 파일을 생성합니다:

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
  oneuptime_url = "https://oneuptime.com"  # 인스턴스 URL 사용
  api_key       = var.oneuptime_api_key
}

# 참고: 프로젝트는 OneUptime 대시보드에서 수동으로 생성해야 합니다
variable "project_id" {
  description = "OneUptime 프로젝트 ID"
  type        = string
}

# 모니터 생성
resource "oneuptime_monitor" "website" {
  name        = "웹사이트 모니터"
  description = "웹사이트 업타임을 위한 모니터"
  data        = jsonencode({
    url = "https://example.com"
    interval = "5m"
    timeout = "30s"
  })
}

# 팀 생성
resource "oneuptime_team" "platform" {
  name        = "플랫폼 팀"
  description = "플랫폼 엔지니어링 팀"
}
    value = "alerts@example.com"
  }
}
```

### 3. 초기화 및 적용

```bash
# Terraform 초기화
terraform init

# 변경 사항 계획
terraform plan

# 구성 적용
terraform apply
```

## 버전 호환성

### 클라우드 고객

OneUptime 클라우드 고객의 경우 최신 공급자 버전을 사용합니다:

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # 항상 최신 호환 버전 사용
    }
  }
}
```

### 자체 호스팅 고객

**중요**: 자체 호스팅 고객은 OneUptime 설치와 일치하도록 공급자 버전을 고정해야 합니다:

| OneUptime 버전 | 공급자 버전 | 구성                   |
| -------------- | ----------- | ---------------------- |
| 7.0.x          | 7.0.x       | `version = "~> 7.0.0"` |
| 7.1.x          | 7.1.x       | `version = "~> 7.1.0"` |
| 7.2.x          | 7.2.x       | `version = "~> 7.2.0"` |

OneUptime 7.0.123의 예시:

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # 정확한 버전 일치
    }
  }
}
```

## 사용 가능한 리소스

OneUptime Terraform 공급자는 다음 리소스를 지원합니다:

### 핵심 리소스

- `oneuptime_team` - 팀 관리

### 모니터링

- `oneuptime_monitor` - 모니터 생성 및 관리
- `oneuptime_probe` - 모니터링 프로브 관리

### 온콜 관리

- `oneuptime_on_call_duty_policy` - 온콜 일정 설정

### 상태 페이지

- `oneuptime_status_page` - 상태 페이지 생성

### 서비스 카탈로그

- `oneuptime_service_catalog` - 서비스 카탈로그 항목 관리

### 서비스 카탈로그

- `oneuptime_service` - 서비스 정의
- `oneuptime_service_dependency` - 서비스 종속성 매핑

### 데이터 소스

참고: 공급자 스키마에 데이터 소스가 정의되어 있지 않으므로 데이터 소스는 현재 공급자에서 사용할 수 없습니다.

## 예시

### 완전한 모니터링 설정

```hcl
# 변수
variable "oneuptime_api_key" {
  description = "OneUptime API 키"
  type        = string
  sensitive   = true
}

variable "project_id" {
  description = "OneUptime 프로젝트 ID (대시보드에서 수동으로 생성)"
  type        = string
}

variable "oneuptime_url" {
  description = "OneUptime URL"
  type        = string
  default     = "https://oneuptime.com"
}

# 공급자 구성
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

# 팀
resource "oneuptime_team" "platform" {
  name        = "플랫폼 팀"
  description = "플랫폼 엔지니어링 팀"
}

# 모니터
resource "oneuptime_monitor" "api" {
  name        = "API 상태 확인"
  description = "API 상태 엔드포인트를 위한 모니터"
  data        = jsonencode({
    url = "https://api.mycompany.com/health"
    method = "GET"
    interval = "1m"
    timeout = "30s"
  })
  }
}
```

### 자체 호스팅 구성 예시

```hcl
# 자체 호스팅 OneUptime 인스턴스 버전 7.0.123의 경우
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # OneUptime 버전과 정확히 일치해야 함
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.mycompany.com"  # 자체 호스팅 URL
  api_key       = var.oneuptime_api_key
}

# 나머지 구성...
```

## 모범 사례

### 1. 버전 관리

**클라우드 고객의 경우:**

- 호환 가능한 업데이트를 얻기 위해 `~>`를 사용한 시맨틱 버전 관리를 사용합니다
- 주요 버전 업그레이드 전에 변경 로그를 검토합니다

**자체 호스팅 고객의 경우:**

- 항상 설치와 일치하는 정확한 버전으로 고정합니다
- OneUptime을 업그레이드할 때 공급자 버전을 업데이트합니다
- 먼저 비프로덕션 환경에서 테스트합니다

### 2. 상태 관리

```hcl
terraform {
  backend "s3" {
    bucket = "my-terraform-state"
    key    = "oneuptime/terraform.tfstate"
    region = "us-west-2"
  }
}
```

### 3. 환경 분리

다양한 환경에 워크스페이스 또는 별도의 상태 파일을 사용합니다:

```bash
# 워크스페이스 사용
terraform workspace new production
terraform workspace new staging

# 별도 디렉토리 사용
mkdir -p environments/{staging,production}
```

### 4. 변수 관리

```hcl
# variables.tf
variable "environment" {
  description = "환경 이름"
  type        = string
}

variable "monitors" {
  description = "생성할 모니터 목록"
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
    name = "웹사이트"
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

### 5. 리소스 이름 지정

일관된 명명 규칙을 사용합니다:

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

## 마이그레이션 가이드

### 수동 구성에서

1. OneUptime 대시보드에서 **기존 리소스 감사**
2. 기존 리소스에 대한 **Terraform 구성 생성**
3. 기존 리소스를 Terraform 상태로 **가져오기**
4. **구성 유효성 검사**가 현재 상태와 일치하는지 확인
5. **변경 사항을 점진적으로 적용**

가져오기 예시:

```bash
# 기존 모니터 가져오기
terraform import oneuptime_monitor.website monitor-id-here

# 기존 프로젝트 가져오기
terraform import oneuptime_project.main project-id-here
```

### 버전 업그레이드

OneUptime을 업그레이드할 때 (자체 호스팅):

1. **현재 상태 백업**
2. **공급자 호환성 확인**
3. 구성에서 **공급자 버전 업데이트**
4. **스테이징 환경에서 테스트**
5. **프로덕션에 적용**

```bash
# 상태 백업
terraform state pull > backup.tfstate

# 공급자 버전 업데이트
# 구성의 terraform 블록 편집

# 계획 및 적용
terraform init -upgrade
terraform plan
terraform apply
```

## 지원 및 리소스

- **문서**: [OneUptime 문서](https://docs.oneuptime.com)
- **Terraform 레지스트리**: [OneUptime 공급자](https://registry.terraform.io/providers/oneuptime/oneuptime)
- **GitHub 이슈**: [OneUptime GitHub](https://github.com/OneUptime/oneuptime/issues)
- **커뮤니티**: [OneUptime 커뮤니티](https://community.oneuptime.com)

## 문제 해결

### 일반적인 문제

1. **버전 불일치 (자체 호스팅)**

   ```
   오류: API 버전 비호환
   ```

   **해결책**: 공급자 버전이 OneUptime 설치와 일치하는지 확인합니다

2. **인증 문제**

   ```
   오류: 잘못된 API 키
   ```

   **해결책**: API 키 및 권한을 확인합니다

3. **리소스를 찾을 수 없음**
   ```
   오류: 리소스를 찾을 수 없음
   ```
   **해결책**: 리소스 ID를 확인하고 리소스가 존재하는지 확인합니다

### 디버그 모드

자세한 로깅 활성화:

```bash
export TF_LOG=DEBUG
terraform apply
```

### 버전 확인

설정 확인:

```bash
# Terraform 버전 확인
terraform version

# 공급자 버전 확인
terraform providers

# 구성 유효성 검사
terraform validate
```
