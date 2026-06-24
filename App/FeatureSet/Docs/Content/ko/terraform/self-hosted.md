# 자체 호스팅 OneUptime Terraform 구성 가이드

이 가이드는 자체 호스팅 OneUptime 인스턴스를 실행하는 고객을 위한 것입니다. Terraform 공급자와 함께 자체 OneUptime 배포를 사용하기 위한 버전 관리, 구성 및 모범 사례를 다룹니다.

## 중요 참고 사항

⚠️ **프로젝트는 Terraform을 통해 생성할 수 없습니다** - 프로젝트는 먼저 OneUptime 대시보드에서 수동으로 생성해야 합니다. Terraform 구성에서는 프로젝트 ID를 사용합니다.

⚠️ **자체 호스팅 고객에게 가장 중요한 규칙**: Terraform 공급자 버전을 항상 OneUptime 설치 버전과 정확히 일치하도록 고정합니다.

## 리소스 구조

모든 OneUptime Terraform 리소스는 단순화된 구조를 따릅니다:

- `name` (필수) - 리소스 이름
- `description` (선택 사항) - 리소스 설명
- `data` (선택 사항) - JSON으로 된 복잡한 구성

## 중요: 버전 호환성

⚠️ **자체 호스팅 고객에게 가장 중요한 규칙**: Terraform 공급자 버전을 항상 OneUptime 설치 버전과 정확히 일치하도록 고정합니다.

### 버전 고정이 중요한 이유

- Terraform 공급자는 OneUptime API에서 자동 생성됩니다
- 각 OneUptime 버전에는 다른 API 엔드포인트와 스키마가 있을 수 있습니다
- 버전이 일치하지 않는 공급자를 사용하면 오류나 예상치 못한 동작이 발생할 수 있습니다
- 버전 고정은 호환성과 예측 가능한 동작을 보장합니다

## OneUptime 버전 찾기

### 방법 1: 대시보드

1. OneUptime 대시보드에 로그인합니다
2. **설정** → **정보**로 이동합니다
3. 버전 번호를 찾습니다 (예: "7.0.123")

### 방법 2: API 엔드포인트

```bash
curl https://your-oneuptime-instance.com/api/status
```

### 방법 3: Docker 이미지

Docker로 OneUptime을 실행하는 경우:

```bash
docker images | grep oneuptime
# 태그를 찾습니다 (예: oneuptime/dashboard:7.0.123)
```

### 방법 4: Helm 차트

Helm을 사용하는 경우:

```bash
helm list -n oneuptime
# 차트 버전 확인
```

### 방법 5: 환경 변수

구성 파일에서 버전 변수를 확인합니다:

```bash
grep -r "APP_VERSION\|IMAGE_TAG" /path/to/your/oneuptime/config
```

## 공급자 구성 템플릿

### 버전 7.0.x 템플릿

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # 123을 정확한 빌드 번호로 교체
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"  # 자체 호스팅 URL
  api_key       = var.oneuptime_api_key
}
```

### 버전 7.1.x 템플릿

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.1.45"  # 정확한 버전으로 교체
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"
  api_key       = var.oneuptime_api_key
}
```

## 완전한 자체 호스팅 구성 예시

다음은 자체 호스팅 OneUptime 인스턴스에 대한 완전한 예시입니다:

```hcl
# versions.tf
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # OneUptime 버전과 일치해야 함
    }
  }
  required_version = ">= 1.0"

  # 선택 사항: 팀 협업을 위한 원격 상태 사용
  backend "s3" {
    bucket = "your-terraform-state-bucket"
    key    = "oneuptime/terraform.tfstate"
    region = "us-west-2"
  }
}

# variables.tf
variable "oneuptime_url" {
  description = "OneUptime 인스턴스 URL"
  type        = string
  default     = "https://oneuptime.yourcompany.com"
}

variable "oneuptime_api_key" {
  description = "OneUptime API 키"
  type        = string
  sensitive   = true
}

variable "environment" {
  description = "환경 이름"
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
  description = "OneUptime 프로젝트 ID (대시보드에서 수동으로 생성)"
  type        = string
}

# main.tf
# 팀 생성
resource "oneuptime_team" "infrastructure" {
  name        = "인프라 팀"
  description = "인프라 및 운영 팀"
}

# 인프라 모니터
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
```

## 환경별 구성

### 개발 환경

```hcl
# dev.tfvars
oneuptime_url = "https://oneuptime-dev.yourcompany.com"
environment = "development"
```

### 스테이징 환경

```hcl
# staging.tfvars
oneuptime_url = "https://oneuptime-staging.yourcompany.com"
environment = "staging"
```

### 프로덕션 환경

```hcl
# prod.tfvars
oneuptime_url = "https://oneuptime.yourcompany.com"
environment = "production"
```

## 자체 호스팅을 위한 업그레이드 프로세스

OneUptime 인스턴스를 업그레이드할 때:

### 1. 업그레이드 전 체크리스트

```bash
# 현재 Terraform 상태 백업
terraform state pull > backup-$(date +%Y%m%d).tfstate

# 현재 OneUptime 버전 기록
curl https://oneuptime.yourcompany.com/api/status | jq '.version'

# 현재 공급자 버전 기록
terraform providers | grep oneuptime
```

### 2. OneUptime 인스턴스 업그레이드

표준 OneUptime 업그레이드 프로세스를 따릅니다 (Docker, Helm 등).

### 3. Terraform 공급자 업데이트

```hcl
# terraform 블록에서 버전 업데이트
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.124"  # 업그레이드 후 새 버전
    }
  }
}
```

### 4. 테스트 및 적용

```bash
# 공급자 업데이트
terraform init -upgrade

# 변경 사항 계획
terraform plan

# 모든 것이 좋아 보이면 적용
terraform apply
```

## 네트워크 구성

### 방화벽 규칙

Terraform 실행기가 다음에 액세스할 수 있는지 확인합니다:

- OneUptime API 엔드포인트 (일반적으로 포트 443/HTTPS)
- 모니터링되는 내부 리소스

### VPN/프라이빗 네트워크

OneUptime이 프라이빗 네트워크에 있는 경우:

```hcl
provider "oneuptime" {
  oneuptime_url = "https://10.0.1.100:443"  # 내부 IP
  api_key       = var.oneuptime_api_key
}
```

## 보안 모범 사례

### 1. API 키 관리

```bash
# 환경 변수 사용
export ONEUPTIME_API_KEY="your-api-key"

# 또는 시크릿 관리 시스템 사용
export ONEUPTIME_API_KEY=$(vault kv get -field=api_key secret/oneuptime)
```

### 2. 최소 권한 API 키

최소 필요 권한으로 API 키를 생성합니다:

- 모니터 관리
- 알림 정책 관리
- 팀 관리 (필요한 경우)

### 3. 네트워크 보안

```hcl
# TLS 확인 예시
provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"
  api_key       = var.oneuptime_api_key

  # 지원되는 경우 추가 보안 옵션
  verify_ssl = true
  timeout    = "30s"
}
```

## Terraform 자동화 모니터링

Terraform 자동화에 대한 모니터를 생성합니다:

```hcl
resource "oneuptime_monitor" "terraform_runner" {
  name       = "Terraform 실행기 상태"
  project_id = oneuptime_project.main.id

  monitor_type = "heartbeat"
  interval     = "15m"

  tags = {
    automation = "terraform"
    criticality = "medium"
  }
}
```

## 자체 호스팅 문제 해결

### 문제: 연결 거부됨

```
오류: 연결 거부됨
```

**해결책**:

1. OneUptime 인스턴스가 실행 중인지 확인합니다
2. API URL이 올바른지 확인합니다
3. 방화벽/네트워크 연결을 확인합니다
4. TLS 인증서가 유효한지 확인합니다

### 문제: API 버전 불일치

```
오류: API 버전 비호환
```

**해결책**:

1. OneUptime 버전 확인: `curl https://your-instance/api/status`
2. 공급자 버전을 일치하도록 업데이트합니다
3. `terraform init -upgrade`를 실행합니다

### 문제: 자체 서명된 인증서

자체 서명된 인증서를 사용하는 경우:

```bash
# TLS 확인 임시 건너뛰기 (프로덕션에는 권장하지 않음)
export ONEUPTIME_SKIP_TLS_VERIFY=true
```

더 나은 해결책: CA 인증서를 시스템 신뢰 저장소에 추가합니다.

## 백업 및 재해 복구

### 상태 백업

```bash
# 정기적인 상태 백업
terraform state pull > backup-$(date +%Y%m%d).tfstate

# 자동화된 백업 스크립트
#!/bin/bash
DATE=$(date +%Y%m%d-%H%M%S)
terraform state pull > "backups/terraform-state-${DATE}.tfstate"
find backups/ -name "terraform-state-*.tfstate" -mtime +30 -delete
```

### 구성 백업

```bash
# Terraform 구성 백업
tar -czf terraform-config-$(date +%Y%m%d).tar.gz *.tf *.tfvars
```

## 다중 환경 관리

### 워크스페이스 사용

```bash
# 환경 생성
terraform workspace new dev
terraform workspace new staging
terraform workspace new prod

# 환경 간 전환
terraform workspace select prod
terraform apply -var-file="prod.tfvars"
```

### 별도 디렉토리 사용

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

이 접근 방식은 더 나은 격리와 환경당 더 쉬운 버전 관리를 제공합니다.
