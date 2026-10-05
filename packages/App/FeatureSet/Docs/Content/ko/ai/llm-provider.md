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

OneUptime SaaS는 공용 인터넷에 있는 LLM 엔드포인트에만 연결할 수 있습니다. 자체 호스팅한 Ollama나 vLLM 서버처럼 사설 네트워크에 있는 모델에는 연결할 수 없습니다. 직접 운영하는 모델을 사용하려면 그 모델에 연결할 수 있는 네트워크에서 OneUptime을 자체 호스팅하거나, 모델을 공용 엔드포인트로 노출하세요. 자세한 내용은 [자체 호스팅 모델의 기본 URL 선택](#자체-호스팅-모델의-기본-url-선택)을 참조하세요.

## 자체 호스팅: 환경 변수만으로 설정하기

자체 호스팅 인스턴스에서 **모든 프로젝트에 한 번에** AI 기능을 켜는 가장 빠른 방법은 OneUptime 서버에 `GLOBAL_LLM_PROVIDER_*` 환경 변수를 설정하는 것입니다. Docker Compose에서는 `config.env`에, Helm에서는 values로 설정합니다. 시작 시 OneUptime은 이 변수로 글로벌 LLM 공급자를 등록하고 계속 동기화합니다. 프로젝트마다 대시보드에서 설정할 필요가 없으며, 자체 공급자가 없는 프로젝트에서는 AI 수정 작업도 이 공급자를 사용합니다.

| 변수 | 설명 |
| --- | --- |
| `GLOBAL_LLM_PROVIDER_TYPE` | 활성화하려면 필수입니다. `OpenAI`, `AzureOpenAI`, `Anthropic`, `Groq`, `Mistral`, `Ollama`, `OpenAICompatible` 중 하나 |
| `GLOBAL_LLM_PROVIDER_API_KEY` | API 키 — OpenAI, Azure OpenAI, Anthropic, Groq, Mistral의 경우 필수, Ollama나 키가 필요 없는 OpenAI 호환 서버에는 필요 없음 |
| `GLOBAL_LLM_PROVIDER_BASE_URL` | API 엔드포인트 — Azure OpenAI, Ollama, OpenAI 호환 서버의 경우 필수 |
| `GLOBAL_LLM_PROVIDER_MODEL_NAME` | 사용할 모델 (OpenAI 호환 서버의 경우 필수, 그 외에는 권장) |
| `GLOBAL_LLM_PROVIDER_NAME` | 대시보드에 표시되는 친숙한 이름 (선택 사항) |

**예시: 자체 호스팅 Ollama**

```bash
GLOBAL_LLM_PROVIDER_TYPE=Ollama
# OneUptime 서버가 접근할 수 있는 주소. localhost는 절대 안 됨:
# 아래 "자체 호스팅 모델의 기본 URL 선택" 참고.
GLOBAL_LLM_PROVIDER_BASE_URL=http://ollama:11434
GLOBAL_LLM_PROVIDER_MODEL_NAME=llama3.1
# API 키 필요 없음 — Ollama는 키 없이 동작합니다.
```

**예시: OpenAI**

```bash
GLOBAL_LLM_PROVIDER_TYPE=OpenAI
GLOBAL_LLM_PROVIDER_API_KEY=sk-xxxxxxxxxxxxxxxxxxxx
GLOBAL_LLM_PROVIDER_MODEL_NAME=gpt-5.1
```

동기화는 선언적입니다. 변수를 바꾸면 다음 재시작 때 공급자가 업데이트되고, `GLOBAL_LLM_PROVIDER_TYPE`을 지우면 공급자가 삭제됩니다. 관리자 대시보드에서 수동으로 만든 글로벌 공급자는 절대 건드리지 않습니다. 프로젝트는 여전히 **프로젝트 설정** > **AI** > **LLM 공급자**에서 자체 공급자를 추가할 수 있으며, 프로젝트가 소유한 공급자가 항상 글로벌 공급자보다 우선합니다.

## 지원되는 공급자

OneUptime은 현재 다음 LLM 공급자를 지원합니다:

| 공급자                | 설명                                                                 | API 키 필요 여부   | 기본 URL 필요 여부   |
| --------------------- | -------------------------------------------------------------------- | ------------------ | -------------------- |
| **OpenAI**            | GPT-5.1 및 기타 OpenAI 모델                                          | 예                 | 아니요 (기본값 사용) |
| **Azure OpenAI**      | Azure 배포에서 호스팅되는 OpenAI 모델                                | 예                 | 예                   |
| **Anthropic**         | Claude Sonnet 5, Claude Opus 5, Claude Haiku 4.5 및 기타 Claude 모델 | 예                 | 아니요 (기본값 사용) |
| **Groq**              | Llama, Mixtral 및 기타 오픈 모델을 위한 빠른 추론                    | 예                 | 아니요 (기본값 사용) |
| **Mistral**           | Mistral의 호스팅 모델                                                | 예                 | 아니요 (기본값 사용) |
| **Ollama**            | Llama 3.1, Mistral, Qwen 등과 같은 자체 호스팅 오픈 소스 모델        | 아니요             | 예                   |
| **OpenAI Compatible** | OpenAI 호환 서버(vLLM, LocalAI, LM Studio 등)                        | 아니요 (선택 사항) | 예                   |

## LLM 공급자 설정

### 1단계: LLM 공급자 설정으로 이동

1. OneUptime 대시보드에 로그인합니다
2. **프로젝트 설정** > **AI** > **LLM 공급자**로 이동합니다
3. **LLM 공급자 생성**을 클릭하여 새 공급자를 추가합니다

### 2단계: 공급자 구성

다음 항목을 입력합니다:

- **이름**: 이 LLM 구성의 친숙한 이름 (예: "프로덕션 OpenAI", "로컬 Ollama")
- **설명** (선택 사항): 이 공급자의 목적을 식별하는 데 도움이 되는 설명
- **LLM 제공자**: 공급자 유형 선택 (OpenAI, Azure OpenAI, Anthropic, Groq, Mistral, Ollama 또는 OpenAI Compatible)
- **API 키**: API 키 (OpenAI, Azure OpenAI, Anthropic, Groq, Mistral의 경우 필수; Ollama 및 OpenAI 호환 서버의 경우 선택 사항)
- **모델 이름**: 사용할 특정 모델 (예: `gpt-5.1`, `claude-sonnet-5`, `llama3.1`)
- **기본 URL** (선택 사항): 커스텀 API 엔드포인트 URL (Azure OpenAI, Ollama, OpenAI Compatible의 경우 필수, 기타의 경우 선택 사항)
- **추가 필드**(위 항목 아래에 접혀 있음): **기본값으로 설정**은 AI 기능이 프로젝트의 기본 공급자만 사용하므로 새 공급자에서는 켜져 있고, **추가 매개변수**는 요청할 때마다 공급자에게 보내는 추가 매개변수를 담은 선택 사항 JSON 객체입니다(예: `{"temperature": 0.2}`)

## 공급자별 구성

### OpenAI

1. [OpenAI 플랫폼](https://platform.openai.com/api-keys)에서 API 키를 발급받습니다
2. LLM 제공자로 **OpenAI**를 선택합니다
3. API 키를 입력합니다
4. 모델 이름을 선택합니다:
   - `gpt-5.1` - 권장 기본값, 도구 호출과 복잡한 조사에 강함
   - `gpt-5.1-mini` - 더 빠르고 비용 효율적

**구성 예시:**

```
이름: 프로덕션 OpenAI
LLM 제공자: OpenAI
API 키: sk-xxxxxxxxxxxxxxxxxxxx
모델 이름: gpt-5.1
```

### Anthropic

1. [Anthropic 콘솔](https://console.anthropic.com/)에서 API 키를 발급받습니다
2. LLM 제공자로 **Anthropic**을 선택합니다
3. API 키를 입력합니다
4. 모델 이름을 선택합니다:
   - `claude-sonnet-5` - 권장 기본값, 지능·속도·비용의 균형이 가장 좋음
   - `claude-opus-5` - 가장 유능한 모델, 가장 어려운 조사용
   - `claude-haiku-4-5` - 가장 빠르고 비용 효율적

**구성 예시:**

```
이름: 프로덕션 Anthropic
LLM 제공자: Anthropic
API 키: sk-ant-xxxxxxxxxxxxxxxxxxxx
모델 이름: claude-sonnet-5
```

### Ollama (자체 호스팅)

Ollama를 사용하면 로컬 또는 자체 인프라에서 오픈 소스 LLM을 실행할 수 있습니다.

1. [ollama.ai](https://ollama.ai)에서 Ollama를 설치합니다
2. 원하는 모델을 다운로드합니다: `ollama pull llama3.1`
3. Ollama가 실행 중이며 OneUptime 서버에서 연결할 수 있는지 확인합니다. 네이티브 설치는 `127.0.0.1`에서만 수신하므로, 다른 머신과 컨테이너의 연결을 받으려면 `OLLAMA_HOST=0.0.0.0:11434`로 시작합니다 (공식 Docker 이미지 `ollama/ollama`는 이미 그렇게 설정되어 있습니다)
4. LLM 제공자로 **Ollama**를 선택합니다
5. 기본 URL을 입력합니다. OneUptime 서버가 Ollama 서버에 연결할 때 쓰는 주소로, 예를 들면 `http://ollama:11434`입니다 (`/api/chat`은 OneUptime이 직접 붙입니다). `localhost`는 동작하지 않습니다. [자체 호스팅 모델의 기본 URL 선택](#자체-호스팅-모델의-기본-url-선택)을 참조하세요
6. 다운로드한 모델 이름을 입력합니다

**구성 예시 (OneUptime의 Docker Compose 네트워크에서 `ollama`라는 이름의 서비스로 실행되는 Ollama):**

```
이름: 자체 호스팅 Ollama
LLM 제공자: Ollama
기본 URL: http://ollama:11434
모델 이름: llama3.1
```

**컨텍스트 창을 늘리세요.** 따로 지정하지 않으면 Ollama는 작은 컨텍스트 창(현재 릴리스는 4096 토큰, 이전 릴리스는 2048 토큰)으로 모델을 실행하고, 들어가지 않는 부분은 아무 표시 없이 잘라냅니다. OneUptime의 AI 기능은 요청마다 도구 정의를 함께 보내는데, 이것만으로도 수천 토큰이 될 수 있습니다. 도구 정의가 잘려도 오류는 나지 않으며, 모델은 그 질문에 쓸 도구가 없다고 답할 뿐입니다. 공급자의 **추가 매개변수**에서 더 큰 `num_ctx`를 설정하세요:

```json
{ "options": { "num_ctx": 16384 } }
```

OneUptime은 이 `options` 객체를 Ollama로 보내는 옵션에 병합하므로, 바꾸려는 설정만 적으면 됩니다. 컨텍스트 창이 클수록 메모리를 더 많이 쓰므로, 모델이 지원하고 하드웨어가 감당할 수 있는 크기를 고르세요. 대신 모든 클라이언트의 기본값을 올리려면 Ollama 서버에 `OLLAMA_CONTEXT_LENGTH`를 설정하세요. `GLOBAL_LLM_PROVIDER_*` 변수로 등록된 글로벌 공급자는 관리자 대시보드의 **설정** > **글로벌 LLM 공급자**에서 이 필드를 설정하세요. 시작 시 동기화는 이 필드를 건드리지 않습니다.

**인기 있는 Ollama 모델:**

- `llama3.1` - Meta의 Llama 3.1 모델, 도구 호출을 지원하는 가장 오래된 Llama
- `llama3.3` - Meta의 Llama 3.3 모델
- `qwen2.5` - Alibaba의 Qwen 2.5 모델
- `mistral-nemo` - Mistral AI의 Nemo 모델

> 참고: OneUptime의 AI 기능은 에이전트 방식이라 도구 호출에 크게 의존합니다. `llama3.1` 이상(또는 도구 호출을 지원하는 다른 모델)을 사용하세요. 작은 모델이나 도구 호출을 지원하지 않는 모델(예: `llama2`, 초기 `llama3`)은 결과가 좋지 않습니다. 모니터, 인시던트, 텔레메트리를 조회할 수 없어서 조사 결과가 비어 있거나 지어낸 내용으로 돌아옵니다.

### 자체 호스팅 모델의 기본 URL 선택

자체 호스팅 모델(Ollama, vLLM, LM Studio 또는 그 밖의 OpenAI 호환 서버)의 기본 URL은 **OneUptime 서버**가 연결할 수 있는 주소여야 합니다. 브라우저는 이 주소에 연결하지 않습니다.

**루프백 주소는 항상 거부됩니다.** OneUptime은 연결하기 전에 기본 URL의 호스트 이름이 해석되는 모든 주소를 확인합니다. `localhost`, `127.0.0.1`, `[::1]`, `0.0.0.0`과 링크 로컬 주소, `169.254.169.254` 같은 클라우드 메타데이터 주소는 자체 호스팅을 포함한 모든 배포에서 거부됩니다. 이는 의도된 설계입니다. 공급자의 기본 URL로 OneUptime 서버 자체의 서비스에 접근할 수 있어서는 안 되기 때문입니다. 게다가 Docker Compose나 Kubernetes 안에서 `localhost`는 모델을 실행하는 머신이 아니라 OneUptime 컨테이너를 가리킵니다.

대신 사설 주소나 내부 호스트 이름을 사용하세요:

| 모델 서버 실행 위치 | 기본 URL |
| --- | --- |
| OneUptime의 Docker Compose 네트워크(`oneuptime`)에 있는 서비스 | 서비스 이름. 예: `http://ollama:11434` |
| OneUptime과 같은 Kubernetes 클러스터 | Service DNS 이름. 예: `http://ollama.<namespace>.svc.cluster.local:11434` ([번들 vLLM](#kubernetes에서-자체-호스팅-vllm-helm)과 같은 패턴) |
| 컨테이너 밖, 호스트 머신 자체 | 호스트의 LAN IP. 예: `http://192.168.1.20:11434`. Docker Desktop에서는 `http://host.docker.internal:11434`도 사용할 수 있습니다 |
| 네트워크의 다른 머신 | 해당 머신의 사설 IP 또는 내부 호스트 이름. 예: `http://10.0.0.12:11434` |

OpenAI 호환 서버도 각자의 포트와 `/v1` 경로로 같은 규칙을 따릅니다. 예를 들어 `http://vllm:8000/v1`, LM Studio라면 `http://192.168.1.20:1234/v1`입니다. 네이티브 설치한 Ollama와 마찬가지로 LM Studio도 서버 설정에서 **Serve on Local Network**를 켜기 전까지는 `127.0.0.1`에서만 수신합니다.

**자체 호스팅 설치에서는 사설 주소를 사용할 수 있습니다.** 자체 호스팅 OneUptime은 `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10`, IPv6 `fc00::/7` 같은 사설 네트워크 주소에 연결할 수 있습니다. 단, `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true`를 설정하면 OneUptime Cloud처럼 이 주소들도 거부됩니다.

**OneUptime Cloud(SaaS)는 사설 네트워크에 연결할 수 없습니다.** 모든 LLM 공급자에 대해 사설 네트워크 주소와 그 주소로 해석되는 호스트 이름을 거부합니다. 자체 인프라에서 실행되는 모델을 사용하려면, 그 모델에 연결할 수 있는 네트워크에서 OneUptime을 자체 호스팅하거나 모델을 공개적으로 연결 가능한 엔드포인트로 노출하세요. 공개 엔드포인트는 API 키로 보호하세요. **Ollama** 공급자는 자격 증명을 보내지 않지만, **OpenAI Compatible**은 API 키를 Bearer 토큰으로 보냅니다(Ollama는 `/v1`에서 OpenAI 호환 API도 제공하므로, 키를 확인하는 리버스 프록시 뒤에 둘 수 있습니다).

### OpenAI Compatible (vLLM, LocalAI, LM Studio 등)

OpenAI `/chat/completions` API를 구현하지만 OpenAI 자체는 아닌 서버에는 **OpenAI Compatible** 공급자를 사용하세요 — 예를 들어 [vLLM](https://docs.vllm.ai), [LocalAI](https://localai.io), [LM Studio](https://lmstudio.ai), 또는 text-generation-webui가 있습니다. 이러한 서버는 일반적으로 자체 URL에서 셀프 호스팅되며 인증 없이 실행되는 경우가 많습니다.

1. OpenAI 호환 서버를 시작하고 기본 URL을 확인합니다 (일반적으로 `/v1`로 끝남)
2. LLM 제공자로 **OpenAI Compatible**을 선택합니다
3. **기본 URL**을 입력합니다 (필수), 예: `http://your-server:8000/v1`. OneUptime 서버에서 연결할 수 있어야 하므로 `localhost`는 안 됩니다. [자체 호스팅 모델의 기본 URL 선택](#자체-호스팅-모델의-기본-url-선택)을 참조하세요
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
3. 이것으로 끝입니다 — vLLM은 시작 시 글로벌 LLM 공급자로 자동 등록되므로(`vllm.globalProvider.enabled`, 기본값 `true`) AI 수정 작업을 포함해 모든 프로젝트에서 AI 기능이 작동합니다. (클라우드와 자체 호스팅 모두에서, 프로젝트에 자체 공급자가 없으면 에이전트의 수정 작업은 글로벌 공급자를 사용합니다. 클라우드에서는 이 사용량이 종량제 AI 토큰으로 청구됩니다. 프로젝트가 소유한 공급자가 항상 우선합니다.)

자동 등록을 비활성화한 경우(`vllm.globalProvider.enabled: false`), 공급자를 수동으로 생성합니다:

1. LLM 제공자로 **OpenAI Compatible**을 선택합니다 (vLLM은 OpenAI API를 사용합니다)
2. 클러스터 내부 기본 URL을 입력합니다: `http://<release>-vllm.<namespace>.svc.cluster.local:8000/v1` (`global.clusterDomain`을 변경했다면 `cluster.local`을 바꾸세요)
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

GPU 스케줄링, 게이트된 모델 및 튜닝 옵션에 대해서는 [Helm 차트의 vLLM 가이드](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/ai-vllm.md)를 참조하세요.

## 커스텀 기본 URL 사용

엔터프라이즈 배포 또는 프록시 서비스를 사용할 때 커스텀 기본 URL을 지정할 수 있습니다:

- **Azure OpenAI**: Azure 엔드포인트 URL 사용
- **OpenAI 호환 API**: OpenAI의 API 사양을 따르는 모든 API
- **프라이빗 Ollama 인스턴스**: 내부 Ollama 서버 URL

## 모범 사례

1. **설명적인 이름 사용**: 공급자를 명확하게 이름 지정합니다 (예: "프로덕션 OpenAI", "개발 Ollama")
2. **API 키 보안**: API 키는 저장 시 암호화되지만 공유하지 마십시오
3. **구성 테스트**: 설정 후 공급자가 AI 기능과 함께 작동하는지 확인합니다
4. **사용량 모니터링**: API 사용량을 추적하여 비용을 관리합니다

## 문제 해결

### 연결 문제

- **OpenAI/Anthropic**: API 키가 유효하고 충분한 크레딧이 있는지 확인합니다
- **Ollama**: Ollama 서버가 실행 중이고, OneUptime 서버가 연결할 수 있는 주소에서 수신하며(네이티브 설치는 `OLLAMA_HOST=0.0.0.0:11434`), 기본 URL이 그 주소를 가리키는지 확인합니다
- **OpenAI Compatible**: 기본 URL이 `/v1`로 끝나는지(또는 서버와 일치하는지), 모델 이름이 서버가 제공하는 모델과 일치하는지 확인하고, 서버에 인증이 필요한 경우에만 API 키를 설정하세요
- **"…points to an address OneUptime is not allowed to connect to"**: 기본 URL이 거부된 주소로 해석됩니다. `localhost`나 다른 루프백 주소, 또는 OneUptime Cloud에서는 사설 네트워크 주소입니다. (OneUptime Cloud는 거부된 호스트 이름을 대신 "…could not be reached"로 보고합니다.) [자체 호스팅 모델의 기본 URL 선택](#자체-호스팅-모델의-기본-url-선택)을 참조하세요
- **방화벽**: 네트워크가 공급자의 API로의 아웃바운드 연결을 허용하는지 확인합니다

### 모델을 찾을 수 없는 경우

- 모델 이름의 철자가 올바른지 확인합니다
- Ollama의 경우 `ollama pull <모델-이름>`으로 모델을 다운로드했는지 확인합니다
- 해당 지역에서 모델을 사용할 수 있는지 확인합니다 (일부 모델에는 지역 제한이 있습니다)

## 도움이 필요하신가요?

LLM 공급자 설정에 문제가 발생한 경우:

1. 알려진 문제에 대해 [OneUptime GitHub Issues](https://github.com/OneUptime/oneuptime/issues)를 확인합니다
2. 엔터프라이즈 플랜을 사용하는 경우 지원팀에 문의합니다
