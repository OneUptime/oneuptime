# LLM 공급자

OneUptime은 플랫폼 전반에서 AI 기반 기능을 활성화하기 위해 다양한 대형 언어 모델(LLM) 공급자와의 통합을 지원합니다. 이 가이드는 자체 LLM 공급자를 구성하는 데 도움을 드립니다.

## LLM 공급자가 할 수 있는 일

OneUptime의 LLM 공급자는 인시던트 관리 워크플로를 자동화하고 향상시키는 데 도움을 줍니다:

- **인시던트 노트**: 상세한 인시던트 노트 및 업데이트를 자동 생성합니다
- **알림 노트**: 의미 있는 알림 설명과 컨텍스트를 생성합니다
- **예정 유지보수 노트**: 유지보수 이벤트 노트를 자동으로 생성합니다
- **인시던트 포스트모템**: 포괄적인 인시던트 포스트모템 보고서를 자동으로 초안 작성합니다
- **코드 개선**: 코드 저장소를 OneUptime에 연결하면, LLM 공급자를 사용하여 텔레메트리 데이터(로그, 트레이스, 메트릭, 예외)를 분석하고 코드 개선 사항을 제안합니다

## OneUptime SaaS 사용자

**OneUptime SaaS**(클라우드 호스팅 버전)를 사용하는 경우, 추가 구성 없이 기본적으로 **글로벌 LLM 공급자**를 사용할 수 있습니다. 글로벌 LLM 공급자는 사전 구성되어 있으며 모든 AI 기능에 바로 사용할 수 있습니다.

자체 API 키 또는 특정 공급자를 사용하려면 아래 지침에 따라 커스텀 LLM 공급자를 구성할 수 있습니다.

## 지원되는 공급자

OneUptime은 현재 다음 LLM 공급자를 지원합니다:

| 공급자                | 설명                                                               | API 키 필요 여부   | 기본 URL 필요 여부   |
| --------------------- | ------------------------------------------------------------------ | ------------------ | -------------------- |
| **OpenAI**            | GPT-4, GPT-4o, GPT-3.5 Turbo 및 기타 OpenAI 모델                   | 예                 | 아니요 (기본값 사용) |
| **Azure OpenAI**      | Azure 배포에서 호스팅되는 OpenAI 모델                              | 예                 | 예                   |
| **Anthropic**         | Claude 3 Opus, Claude 3 Sonnet, Claude 3 Haiku 및 기타 Claude 모델 | 예                 | 아니요 (기본값 사용) |
| **Groq**              | Llama, Mixtral 및 기타 오픈 모델을 위한 빠른 추론                  | 예                 | 아니요 (기본값 사용) |
| **Mistral**           | Mistral의 호스팅 모델                                              | 예                 | 아니요 (기본값 사용) |
| **Ollama**            | Llama 2, Mistral, CodeLlama 등과 같은 자체 호스팅 오픈 소스 모델   | 아니요             | 예                   |
| **OpenAI Compatible** | OpenAI 호환 서버(vLLM, LocalAI, LM Studio 등)                      | 아니요 (선택 사항) | 예                   |

## LLM 공급자 설정

### 1단계: LLM 공급자 설정으로 이동

1. OneUptime 대시보드에 로그인합니다
2. **AI 에이전트** > **LLM 공급자**로 이동합니다
3. **LLM 공급자 생성**을 클릭하여 새 공급자를 추가합니다

### 2단계: 공급자 구성

다음 항목을 입력합니다:

- **이름**: 이 LLM 구성의 친숙한 이름 (예: "프로덕션 OpenAI", "로컬 Ollama")
- **설명** (선택 사항): 이 공급자의 목적을 식별하는 데 도움이 되는 설명
- **LLM 유형**: 공급자 유형 선택 (OpenAI, Azure OpenAI, Anthropic, Groq, Mistral, Ollama 또는 OpenAI Compatible)
- **API 키**: API 키 (OpenAI, Azure OpenAI, Anthropic, Groq, Mistral의 경우 필수; Ollama 및 OpenAI 호환 서버의 경우 선택 사항)
- **모델 이름**: 사용할 특정 모델 (예: `gpt-4o`, `claude-3-opus-20240229`, `llama2`)
- **기본 URL** (선택 사항): 커스텀 API 엔드포인트 URL (Azure OpenAI, Ollama, OpenAI Compatible의 경우 필수, 기타의 경우 선택 사항)

## 공급자별 구성

### OpenAI

1. [OpenAI 플랫폼](https://platform.openai.com/api-keys)에서 API 키를 발급받습니다
2. LLM 유형으로 **OpenAI**를 선택합니다
3. API 키를 입력합니다
4. 모델 이름을 선택합니다:
   - `gpt-4o` - 가장 유능한 모델, 복잡한 작업에 최적
   - `gpt-4o-mini` - 더 빠르고 비용 효율적
   - `gpt-4-turbo` - 기능과 속도의 균형이 좋음
   - `gpt-3.5-turbo` - 빠르고 경제적

**구성 예시:**

```
이름: 프로덕션 OpenAI
LLM 유형: OpenAI
API 키: sk-xxxxxxxxxxxxxxxxxxxx
모델 이름: gpt-4o
```

### Anthropic

1. [Anthropic 콘솔](https://console.anthropic.com/)에서 API 키를 발급받습니다
2. LLM 유형으로 **Anthropic**을 선택합니다
3. API 키를 입력합니다
4. 모델 이름을 선택합니다:
   - `claude-3-opus-20240229` - 가장 유능한 모델
   - `claude-3-sonnet-20240229` - 지능과 속도의 균형이 좋음
   - `claude-3-haiku-20240307` - 가장 빠르고 컴팩트한 모델
   - `claude-3-5-sonnet-20241022` - 최신 Sonnet 모델

**구성 예시:**

```
이름: 프로덕션 Anthropic
LLM 유형: Anthropic
API 키: sk-ant-xxxxxxxxxxxxxxxxxxxx
모델 이름: claude-3-5-sonnet-20241022
```

### Ollama (자체 호스팅)

Ollama를 사용하면 로컬 또는 자체 인프라에서 오픈 소스 LLM을 실행할 수 있습니다.

1. [ollama.ai](https://ollama.ai)에서 Ollama를 설치합니다
2. 원하는 모델을 다운로드합니다: `ollama pull llama2`
3. Ollama가 실행 중이며 액세스 가능한지 확인합니다
4. LLM 유형으로 **Ollama**를 선택합니다
5. 기본 URL을 입력합니다 (예: `http://localhost:11434`)
6. 다운로드한 모델 이름을 입력합니다

**구성 예시:**

```
이름: 로컬 Ollama
LLM 유형: Ollama
기본 URL: http://localhost:11434
모델 이름: llama2
```

**인기 있는 Ollama 모델:**

- `llama2` - Meta의 Llama 2 모델
- `llama3` - Meta의 Llama 3 모델
- `mistral` - Mistral AI의 모델
- `codellama` - 코드 특화 Llama 모델
- `mixtral` - Mistral의 전문가 혼합 모델

### OpenAI Compatible (vLLM, LocalAI, LM Studio 등)

OpenAI `/chat/completions` API를 구현하지만 OpenAI 자체는 아닌 서버에는 **OpenAI Compatible** 공급자를 사용하세요 — 예를 들어 [vLLM](https://docs.vllm.ai), [LocalAI](https://localai.io), [LM Studio](https://lmstudio.ai), 또는 text-generation-webui가 있습니다. 이러한 서버는 일반적으로 자체 URL에서 셀프 호스팅되며 인증 없이 실행되는 경우가 많습니다.

1. OpenAI 호환 서버를 시작하고 기본 URL을 확인합니다 (일반적으로 `/v1`로 끝남)
2. LLM 유형으로 **OpenAI Compatible**을 선택합니다
3. **기본 URL**을 입력합니다 (필수), 예: `http://your-server:8000/v1`
4. **모델 이름**을 입력합니다 (필수) — 서버가 제공하는 모델과 일치해야 합니다
5. 서버에 인증이 필요한 경우에만 **API 키**를 입력합니다; 키가 필요 없는 서버는 비워 둡니다

**구성 예시 (키가 필요 없는 vLLM):**

```
Name: Self-Hosted vLLM
LLM Provider: OpenAI Compatible
Base URL: http://vllm.internal:8000/v1
Model Name: meta-llama/Llama-3.1-8B-Instruct
API Key: (leave blank)
```

> 팁: 저장한 후 공급자의 **테스트** 버튼을 사용하여 연결, 모델 이름, 기본 URL이 올바른지 확인하세요.

### Kubernetes에서 자체 호스팅 vLLM (Helm)

Helm 차트로 OneUptime을 자체 호스팅하는 경우, 클러스터 내부에서 [vLLM](https://docs.vllm.ai) — OpenAI 호환 추론 서버 — 을 실행하고 자체 GPU에서 로컬 모델을 제공할 수 있습니다. 어떤 데이터도 인프라를 벗어나지 않습니다.

1. Helm 값에서 이를 활성화합니다 (NVIDIA GPU 노드 필요):

   ```yaml
   vllm:
     enabled: true
     model: Qwen/Qwen2.5-1.5B-Instruct
   ```

2. `helm upgrade`를 실행하고 vLLM 파드가 Ready 상태가 될 때까지 기다립니다 (첫 시작 시 모델을 다운로드합니다)
3. 이것으로 끝입니다 — vLLM은 시작 시 글로벌 LLM 공급자로 자동 등록되므로(`vllm.globalProvider.enabled`, 기본값 `true`) 모든 프로젝트에서 AI 기능이 작동합니다. 참고: 프로젝트 범위의 AI 에이전트는 글로벌 공급자를 사용할 수 없으며 여전히 프로젝트별 LLM 공급자가 필요합니다.

자동 등록을 비활성화한 경우(`vllm.globalProvider.enabled: false`), 공급자를 수동으로 생성합니다:

1. LLM 유형으로 **OpenAI Compatible**을 선택합니다 (vLLM은 OpenAI API를 사용합니다)
2. 클러스터 내부 기본 URL을 입력합니다: `http://<release>-vllm.<namespace>.svc.cluster.local:8000/v1`
3. 모델 이름을 입력합니다: 전체 HuggingFace 모델 id (또는 설정한 경우 `vllm.servedModelName`)
4. `vllm.apiKey`를 설정한 경우에만 API 키를 입력합니다; 키가 필요 없는 vLLM은 비워 둡니다

**구성 예시:**

```
Name: In-Cluster vLLM
LLM Provider: OpenAI Compatible
Base URL: http://oneuptime-vllm.default.svc.cluster.local:8000/v1
Model Name: Qwen/Qwen2.5-1.5B-Instruct
API Key: (leave blank unless vllm.apiKey is set)
```

GPU 스케줄링, 게이트된 모델 및 튜닝 옵션에 대해서는 [Helm 차트 README](https://github.com/OneUptime/oneuptime/tree/master/HelmChart/Public/oneuptime#local-models-with-vllm)를 참조하세요.

## 커스텀 기본 URL 사용

엔터프라이즈 배포 또는 프록시 서비스를 사용할 때 커스텀 기본 URL을 지정할 수 있습니다:

- **Azure OpenAI**: Azure 엔드포인트 URL 사용
- **OpenAI 호환 API**: OpenAI의 API 사양을 따르는 모든 API
- **프라이빗 Ollama 인스턴스**: 내부 Ollama 서버 URL

## 모범 사례

1. **설명적인 이름 사용**: 공급자를 명확하게 이름 지정합니다 (예: "프로덕션 GPT-4", "개발 Ollama")
2. **API 키 보안**: API 키는 저장 시 암호화되지만 공유하지 마십시오
3. **구성 테스트**: 설정 후 공급자가 AI 기능과 함께 작동하는지 확인합니다
4. **사용량 모니터링**: API 사용량을 추적하여 비용을 관리합니다

## 문제 해결

### 연결 문제

- **OpenAI/Anthropic**: API 키가 유효하고 충분한 크레딧이 있는지 확인합니다
- **Ollama**: Ollama 서버가 실행 중이며 기본 URL이 올바른지 확인합니다
- **OpenAI Compatible**: 기본 URL이 `/v1`로 끝나는지(또는 서버와 일치하는지), 모델 이름이 서버가 제공하는 모델과 일치하는지 확인하고, 서버에 인증이 필요한 경우에만 API 키를 설정하세요
- **방화벽**: 네트워크가 공급자의 API로의 아웃바운드 연결을 허용하는지 확인합니다

### 모델을 찾을 수 없는 경우

- 모델 이름의 철자가 올바른지 확인합니다
- Ollama의 경우 `ollama pull <모델-이름>`으로 모델을 다운로드했는지 확인합니다
- 해당 지역에서 모델을 사용할 수 있는지 확인합니다 (일부 모델에는 지역 제한이 있습니다)

## 도움이 필요하신가요?

LLM 공급자 설정에 문제가 발생한 경우:

1. 알려진 문제에 대해 [OneUptime GitHub Issues](https://github.com/OneUptime/oneuptime/issues)를 확인합니다
2. 엔터프라이즈 플랜을 사용하는 경우 지원팀에 문의합니다
