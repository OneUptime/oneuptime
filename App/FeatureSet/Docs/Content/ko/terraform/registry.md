# Terraform 공급자 설치 및 사용 가이드

## Terraform 레지스트리에서 설치

OneUptime Terraform 공급자는 공식 [Terraform 레지스트리](https://registry.terraform.io/providers/oneuptime/oneuptime)에서 사용할 수 있습니다.

### OneUptime 클라우드 사용자의 경우

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # 최신 호환 버전 사용
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"
  api_key       = var.oneuptime_api_key
}
```

### 자체 호스팅 OneUptime 사용자의 경우

⚠️ **중요**: 자체 호스팅 고객은 공급자 버전을 OneUptime 설치와 정확히 일치하도록 고정해야 합니다.

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # 정확한 OneUptime 버전으로 교체
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"  # 자체 호스팅 URL
  api_key       = var.oneuptime_api_key
}
```

## 자체 호스팅에 버전 고정이 필요한 이유

OneUptime Terraform 공급자는 OneUptime API 사양에서 자동으로 생성됩니다. 각 OneUptime 버전에는 다음이 있을 수 있습니다:

- 다른 API 엔드포인트
- 업데이트된 리소스 스키마
- 새롭거나 제거된 기능
- 변경된 유효성 검사 규칙

OneUptime 설치와 일치하지 않는 공급자 버전을 사용하면 다음이 발생할 수 있습니다:

- API 호환성 오류
- 리소스 생성/업데이트 실패
- 예상치 못한 동작
- 리소스 상태 드리프트

## OneUptime 버전 찾기

### 방법 1: 대시보드

1. OneUptime 대시보드에 로그인합니다
2. **설정** → **정보**로 이동합니다
3. 버전 번호를 확인합니다 (예: "7.0.123")

### 방법 2: API

```bash
curl https://your-oneuptime-instance.com/api/version | jq '.version'
```

### 방법 3: Docker

```bash
docker images | grep oneuptime
# 태그를 찾습니다 (예: oneuptime/dashboard:7.0.123)
```

## 공급자 레지스트리 정보

- **레지스트리 URL**: https://registry.terraform.io/providers/oneuptime/oneuptime
- **소스 저장소**: https://github.com/OneUptime/terraform-provider-oneuptime
- **문서**: https://registry.terraform.io/providers/oneuptime/oneuptime/latest/docs
- **릴리스**: https://github.com/OneUptime/terraform-provider-oneuptime/releases

## 버전 호환성 매트릭스

| OneUptime 버전 | 공급자 버전 | Terraform 구성         |
| -------------- | ----------- | ---------------------- |
| 7.0.x          | 7.0.x       | `version = "~> 7.0.0"` |
| 7.1.x          | 7.1.x       | `version = "~> 7.1.0"` |
| 최신 클라우드  | 최신 공급자 | `version = "~> 7.0"`   |

## 빠른 시작 예시

```hcl
# 공급자 구성
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # 자체 호스팅의 경우 조정
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"  # 자체 호스팅의 경우 조정
  api_key       = var.oneuptime_api_key
}

# 프로젝트 생성
resource "oneuptime_project" "example" {
  name        = "Terraform 예시"
  description = "Terraform으로 생성됨"
}

# 웹사이트 모니터 생성
resource "oneuptime_monitor" "website" {
  name       = "웹사이트 모니터"
  project_id = oneuptime_project.example.id

  monitor_type = "website"
  url          = "https://example.com"
  interval     = "5m"

  tags = {
    managed_by = "terraform"
  }
}
```

## 설치 단계

1. 공급자 블록으로 **Terraform 구성 생성**
2. **Terraform 초기화**: `terraform init`
3. **API 키 설정**: API 키로 `terraform.tfvars` 생성
4. **배포 계획**: `terraform plan`
5. **구성 적용**: `terraform apply`

## 도움말 받기

- **전체 문서**: [완전한 Terraform 문서](./README.md)를 참조합니다
- **자체 호스팅 가이드**: [자체 호스팅 구성 가이드](./self-hosted.md)를 확인합니다
- **예시**: [구성 예시](./examples.md)를 탐색합니다
- **빠른 시작**: [빠른 시작 가이드](./quick-start.md)를 따릅니다

## 레지스트리 업데이트

공급자는 새 OneUptime 버전이 릴리스될 때 Terraform 레지스트리에 자동으로 게시됩니다. 클라우드 사용자는 시맨틱 버전 (`~> 7.0`)을 사용하여 호환 가능한 업데이트를 자동으로 받을 수 있으며, 자체 호스팅 사용자는 정확한 버전으로 고정해야 합니다.
