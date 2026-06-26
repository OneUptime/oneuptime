# AI 에이전트

OneUptime의 AI 에이전트는 코드의 오류, 성능 문제, 데이터베이스 쿼리를 자동으로 수정합니다. OpenTelemetry 관측 가능성 데이터를 기반으로 AI 에이전트는 단순한 알림이 아닌, 수정 사항이 포함된 풀 리퀘스트를 생성합니다.

## AI 에이전트가 할 수 있는 일

AI 에이전트는 관측 가능성 데이터(트레이스, 로그, 메트릭)를 분석하여 코드베이스의 문제를 감지하고 자동으로 수정합니다:

- **오류 자동 수정**: AI 에이전트가 트레이스나 로그에서 예외를 발견하면 문제를 자동으로 수정하고 풀 리퀘스트를 생성합니다.
- **성능 문제 수정**: 실행 시간이 가장 오래 걸리는 트레이스를 분석하고 성능 최적화가 포함된 풀 리퀘스트를 생성합니다.
- **데이터베이스 쿼리 수정**: 느리거나 비효율적인 데이터베이스 쿼리를 식별하고 적절한 인덱싱과 쿼리 재작성으로 최적화합니다.
- **프론트엔드 문제 수정**: 프론트엔드 특정 성능 문제, 렌더링 문제, JavaScript 오류를 자동으로 처리합니다.
- **텔레메트리 자동 추가**: 한 번의 클릭으로 코드베이스에 트레이싱, 메트릭, 로그를 추가합니다. 수동 계측이 필요하지 않습니다.
- **GitHub 및 GitLab 통합**: 기존 저장소와 원활하게 통합됩니다. PR이 워크플로에 직접 생성됩니다.
- **CI/CD 통합**: 기존 CI/CD 파이프라인과 통합됩니다. 수정 사항은 PR 생성 전에 테스트 및 검증됩니다.
- **Terraform 지원**: 인프라 문제를 자동으로 수정합니다. 인프라 코드를 위한 Terraform 및 OpenTofu를 지원합니다.
- **이슈 트래커 통합**: Jira, Linear 및 기타 이슈 트래커와 연동됩니다. 수정 사항이 관련 이슈에 자동으로 연결됩니다.

## 작동 방식

1. **데이터 수집**: OpenTelemetry가 애플리케이션에서 트레이스, 로그, 메트릭을 수집합니다
2. **문제 감지**: AI가 오류, 성능 병목, 느린 쿼리를 식별합니다
3. **수정 생성**: AI가 코드베이스를 분석하고 자동으로 수정 사항을 생성합니다
4. **PR 생성**: 수정 사항과 상세 보고서가 포함된 풀 리퀘스트가 검토 준비 완료 상태로 생성됩니다

## LLM 공급자 유연성

OneUptime은 모든 LLM 공급자와 함께 작동합니다. 다음을 사용할 수 있습니다:

- **OpenAI GPT** 모델
- **Anthropic Claude** 모델
- **Meta Llama** (Ollama 또는 기타 공급자를 통해)
- **커스텀 자체 호스팅** 모델

AI 모델을 자체 호스팅하여 코드를 완전히 비공개로 유지할 수 있습니다.

## 개인 정보 보호

플랜에 관계없이 OneUptime은 귀하의 코드를 보거나, 저장하거나, 학습에 사용하지 않습니다:

- **코드 액세스 없음**: 귀하의 코드는 귀하의 인프라에 유지됩니다
- **데이터 저장 없음**: 데이터 보관 정책 없음
- **학습에 사용하지 않음**: 귀하의 코드는 AI 학습에 절대 사용되지 않습니다

## 글로벌 AI 에이전트 대 자체 호스팅 AI 에이전트

### 글로벌 AI 에이전트

**OneUptime SaaS**(클라우드 호스팅 버전)를 사용하는 경우, 글로벌 AI 에이전트는 OneUptime에서 제공되며 사전 구성되어 바로 사용할 수 있습니다. 이 에이전트들은 OneUptime에서 관리되며 추가 설정이 필요하지 않습니다.

글로벌 AI 에이전트는 프로젝트 설정에서 비활성화하지 않는 한 모든 프로젝트에서 자동으로 사용할 수 있습니다.

### 자체 호스팅 AI 에이전트

자체 인프라 내에서 AI 에이전트를 실행해야 하는 조직(예: 보안, 컴플라이언스 또는 네트워크 액세스 요구 사항)의 경우, OneUptime은 자체 호스팅 AI 에이전트를 지원합니다.

자체 호스팅 AI 에이전트의 특징:

- 프라이빗 네트워크 내에서 실행됩니다
- 내부 리소스 및 시스템에 액세스할 수 있습니다
- 에이전트 환경을 완전히 제어할 수 있습니다
- 특정 요구 사항에 맞게 커스터마이징할 수 있습니다

## 자체 호스팅 AI 에이전트 설정

### 1단계: OneUptime에서 AI 에이전트 생성

1. OneUptime 대시보드에 로그인합니다
2. **프로젝트 설정** > **AI 에이전트**로 이동합니다
3. **AI 에이전트 생성**을 클릭하여 새 에이전트를 추가합니다
4. 필수 항목을 입력합니다:
   - **이름**: AI 에이전트의 친숙한 이름
   - **설명** (선택 사항): 에이전트의 목적에 대한 설명
5. 생성 후 `AI_AGENT_ID`와 `AI_AGENT_KEY`를 받게 됩니다

**중요**: `AI_AGENT_KEY`를 안전하게 저장하십시오. 한 번만 표시되며 나중에 검색할 수 없습니다.

### 2단계: AI 에이전트 배포

#### Docker

AI 에이전트를 실행하려면 Docker가 설치되어 있는지 확인하십시오. 다음 명령으로 에이전트를 실행합니다:

```bash
docker run --name oneuptime-ai-agent --network host \
  -e AI_AGENT_KEY=<ai-agent-key> \
  -e AI_AGENT_ID=<ai-agent-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -d oneuptime/ai-agent:release
```

OneUptime을 자체 호스팅하는 경우, `ONEUPTIME_URL`을 커스텀 자체 호스팅 인스턴스 URL로 변경하십시오.

#### Docker Compose

docker-compose를 사용하여 AI 에이전트를 실행할 수도 있습니다. `docker-compose.yml` 파일을 생성합니다:

```yaml
version: "3"

services:
  oneuptime-ai-agent:
    image: oneuptime/ai-agent:release
    container_name: oneuptime-ai-agent
    environment:
      - AI_AGENT_KEY=<ai-agent-key>
      - AI_AGENT_ID=<ai-agent-id>
      - ONEUPTIME_URL=https://oneuptime.com
    network_mode: host
    restart: always
```

그런 다음 실행합니다:

```bash
docker compose up -d
```

#### Kubernetes

`oneuptime-ai-agent.yaml` 파일을 생성합니다:

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oneuptime-ai-agent
spec:
  selector:
    matchLabels:
      app: oneuptime-ai-agent
  template:
    metadata:
      labels:
        app: oneuptime-ai-agent
    spec:
      containers:
        - name: oneuptime-ai-agent
          image: oneuptime/ai-agent:release
          env:
            - name: AI_AGENT_KEY
              value: "<ai-agent-key>"
            - name: AI_AGENT_ID
              value: "<ai-agent-id>"
            - name: ONEUPTIME_URL
              value: "https://oneuptime.com"
```

구성을 적용합니다:

```bash
kubectl apply -f oneuptime-ai-agent.yaml
```

### 환경 변수

AI 에이전트는 다음 환경 변수를 지원합니다:

#### 필수 변수

| 변수            | 설명                                                     |
| --------------- | -------------------------------------------------------- |
| `AI_AGENT_KEY`  | OneUptime 대시보드의 AI 에이전트 키                      |
| `AI_AGENT_ID`   | OneUptime 대시보드의 AI 에이전트 ID                      |
| `ONEUPTIME_URL` | OneUptime 인스턴스의 URL (기본값: https://oneuptime.com) |

## AI 에이전트 확인

AI 에이전트를 배포한 후:

1. OneUptime 대시보드의 **프로젝트 설정** > **AI 에이전트**로 이동합니다
2. 몇 분 내에 에이전트가 **연결됨** 상태로 표시되어야 합니다
3. 상태가 **연결 끊김**으로 표시되면 컨테이너 로그에서 오류를 확인하십시오

컨테이너 로그를 보려면:

```bash
# Docker
docker logs oneuptime-ai-agent

# Kubernetes
kubectl logs deployment/oneuptime-ai-agent
```

## 문제 해결

### 에이전트가 연결되지 않는 경우

1. **자격 증명 확인**: `AI_AGENT_KEY`와 `AI_AGENT_ID`가 올바른지 확인합니다
2. **네트워크 확인**: 에이전트가 OneUptime 인스턴스에 도달할 수 있는지 확인합니다
3. **로그 검토**: 오류 메시지에 대한 컨테이너 로그를 확인합니다
4. **방화벽 규칙**: 아웃바운드 HTTPS (포트 443)가 허용되는지 확인합니다

### 에이전트가 계속 연결이 끊어지는 경우

1. **리소스 제한 확인**: 컨테이너에 충분한 메모리와 CPU가 있는지 확인합니다
2. **네트워크 안정성**: 네트워크 연결이 안정적인지 확인합니다
3. **로그 검토**: 로그에서 타임아웃 또는 연결 오류를 찾아봅니다

## 도움이 필요하신가요?

AI 에이전트에 문제가 발생한 경우:

1. 알려진 문제에 대해 [OneUptime GitHub Issues](https://github.com/OneUptime/oneuptime/issues)를 확인합니다
2. 문제가 아직 보고되지 않은 경우 새 이슈를 생성합니다
3. 엔터프라이즈 플랜을 사용하는 경우 [지원팀](https://oneuptime.com/support)에 문의합니다
