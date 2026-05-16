# Terraform 공급자 빠른 시작 가이드

이 가이드는 몇 분 안에 OneUptime Terraform 공급자를 시작하는 데 도움을 드립니다.

## 전제 조건

- Terraform >= 1.0 설치됨
- OneUptime 계정 (클라우드 또는 자체 호스팅)
- OneUptime API 키

## 1단계: API 키 생성

### OneUptime 클라우드의 경우
1. [OneUptime 클라우드](https://oneuptime.com)로 이동하여 로그인합니다
2. **설정** → **API 키**로 이동합니다
3. **API 키 생성**을 클릭합니다
4. 이름을 "Terraform 공급자"로 지정합니다
5. 필요한 권한을 선택합니다
6. 생성된 API 키를 복사합니다

### 자체 호스팅 OneUptime의 경우
1. OneUptime 인스턴스에 액세스합니다
2. **설정** → **API 키**로 이동합니다
3. **API 키 생성**을 클릭합니다
4. 이름을 "Terraform 공급자"로 지정합니다
5. 필요한 권한을 선택합니다
6. 생성된 API 키를 복사합니다

## 2단계: Terraform 구성 생성

새 디렉토리와 `main.tf` 파일을 생성합니다:

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      # 클라우드 고객의 경우
      version = "~> 7.0"
      
      # 자체 호스팅 고객의 경우 - 정확한 버전으로 고정
      # version = "= 7.0.123"  # OneUptime 버전으로 교체
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  # 클라우드 고객의 경우
  oneuptime_url = "https://oneuptime.com"
  
  # 자체 호스팅 고객의 경우 - 인스턴스 URL 사용
  # oneuptime_url = "https://oneuptime.yourcompany.com"
  
  api_key = var.oneuptime_api_key
}

variable "oneuptime_api_key" {
  description = "OneUptime API 키"
  type        = string
  sensitive   = true
}

# 참고: 프로젝트는 OneUptime 대시보드에서 수동으로 생성해야 합니다
# 여기서 기존 프로젝트 ID를 사용합니다
variable "project_id" {
  description = "OneUptime 프로젝트 ID"
  type        = string
}

# 간단한 웹사이트 모니터 생성
resource "oneuptime_monitor" "website" {
  name        = "웹사이트 모니터"
  description = "웹사이트 업타임을 위한 모니터"
  data        = jsonencode({
    url = "https://example.com"
    interval = "5m"
    timeout = "30s"
  })
}

# 모니터 ID 출력
output "monitor_id" {
  value = oneuptime_monitor.website.id
}
```

## 3단계: 변수 파일 생성

`terraform.tfvars`를 생성합니다:

```hcl
# terraform.tfvars
oneuptime_api_key = "your-api-key-here"
project_id        = "your-project-id-here"  # OneUptime 대시보드에서 가져옵니다
```

**중요**: API 키를 비밀로 유지하려면 `terraform.tfvars`를 `.gitignore`에 추가합니다!

## 4단계: 초기화 및 적용

```bash
# Terraform 초기화
terraform init

# 배포 계획
terraform plan

# 구성 적용
terraform apply
```

## 5단계: 리소스 확인

1. OneUptime 대시보드를 확인합니다
2. 기존 프로젝트로 이동합니다
3. "웹사이트 모니터"가 생성되어 실행 중인지 확인합니다

## 다음 단계

1. **더 많은 리소스 탐색**: 사용 가능한 모든 리소스에 대한 [전체 문서](./README.md)를 확인합니다
2. **알림 설정**: 알림 정책 및 알림 채널 추가
3. **상태 페이지 생성**: 서비스를 위한 공개 상태 페이지 설정
4. **팀으로 구성**: 팀 생성 및 권한 할당

## 버전별 예시

### 클라우드 고객 (최신 버전)

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # 항상 최신 호환 7.x 버전 가져오기
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"
  api_key       = var.oneuptime_api_key
}
```

### 자체 호스팅 고객 (버전 고정)

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # OneUptime 버전과 정확히 일치해야 함
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.mycompany.com"  # 자체 호스팅 URL
  api_key       = var.oneuptime_api_key
}
```

## 빠른 시작 문제 해결

### 문제: 공급자를 찾을 수 없음
```
오류: 사용 가능한 공급자 패키지 쿼리 실패
```
**해결책**: 공급자를 다운로드하려면 `terraform init`을 실행합니다

### 문제: 인증 실패
```
오류: 잘못된 API 키
```
**해결책**: 
1. OneUptime 대시보드에서 API 키를 확인합니다
2. API 키에 충분한 권한이 있는지 확인합니다
3. `oneuptime_url`이 인스턴스에 대해 올바른지 확인합니다

### 문제: 버전 불일치 (자체 호스팅)
```
오류: API 버전 비호환
```
**해결책**: 
1. 대시보드에서 OneUptime 버전을 확인합니다
2. 정확히 일치하도록 공급자 버전을 업데이트합니다
3. `terraform init -upgrade`를 실행합니다

## 정리

이 빠른 시작에서 생성된 모든 리소스를 제거하려면:

```bash
terraform destroy
```

이렇게 하면 빠른 시작 중에 생성된 모니터와 프로젝트가 삭제됩니다.
