# LLM 공급자

LLM 공급자는 OneUptime의 모든 AI 기능 뒤에 있는 모델입니다. 조사, AI에게 질문, 초안, 수정 풀 리퀘스트가 모두 이를 사용합니다. 이 페이지에서는 기능이 어떤 공급자를 사용하는지, 자체 공급자(OpenAI, Azure OpenAI와 Microsoft Foundry, Anthropic, Groq, Mistral, Ollama 또는 모든 OpenAI 호환 서버)를 추가하는 방법, 직접 실행하는 모델을 OneUptime이 사용하게 하는 방법을 설명합니다.

:::cards
- [AI가 사용하는 공급자](#ai가-사용하는-공급자): 프로젝트의 기본 공급자, 없으면 글로벌 공급자입니다.
- [자체 호스팅: 환경 변수로 설정 없이 구성하기](#자체-호스팅-환경-변수로-설정-없이-구성하기): 서버 설정으로 모든 프로젝트에 공급자 하나를 제공합니다.
- [LLM 공급자 설정하기](#llm-공급자-설정하기): 프로젝트에 공급자를 추가하고 테스트합니다.
- [자체 호스팅 모델의 기본 URL 선택하기](#자체-호스팅-모델의-기본-url-선택하기): OneUptime 서버가 도달할 수 있는 주소입니다.
:::

## 공급자가 구동하는 것

- **조사**: OneUptime AI가 새 인시던트와 경고를 조사하고, 출처가 달린 근본 원인 분석을 타임라인에 게시합니다. [AI SRE](/docs/ai/ai-sre)를 참조하세요.
- **질문**: **AI에게 질문** 은 프로젝트의 데이터로 답하며, 모든 주장에 출처를 답니다. [AI에게 질문](/docs/ai/ask-ai)을 참조하세요.
- **초안**: 인시던트, 경고, 예약된 유지 관리의 메모에서 쓰는 **AI로 초안 작성** 과, 요청하거나 인시던트가 해결될 때 작성되는 포스트모템입니다.
- **코드**: 예외, 느린 트레이스, 조사로 찾은 원인을 수정하는 풀 리퀘스트로, OneUptime이나 GitHub에서 시작합니다. [코드](/docs/ai/ai-agent)를 참조하세요.
- **그 밖의 모든 것**: AI Insights 분류, 워크플로와 런북의 AI 단계, Slack과 Microsoft Teams에서의 답변입니다.

## AI가 사용하는 공급자

AI 기능은 프로젝트의 기본 공급자를 사용합니다. 기본 공급자가 없는 프로젝트는 글로벌 공급자가 있으면 그것을 사용합니다. AI에게 질문은 대화를 프로젝트의 다른 공급자나 글로벌 공급자로 바꿀 수도 있습니다.

```mermaid title="AI 기능이 사용하는 공급자"
flowchart TB
    F["AI 기능에<br/>모델이 필요함"] --> D{"프로젝트에<br/>기본 공급자가<br/>있는가?"}
    D -->|"예"| P["프로젝트의<br/>기본 공급자"]
    D -->|"아니요"| G{"글로벌 공급자가<br/>있는가?"}
    G -->|"예"| GP["글로벌 공급자:<br/>OneUptime Cloud의<br/>AI 크레딧"]
    G -->|"아니요"| N["아무것도 실행되지<br/>않고 AI 페이지에<br/>공급자가 없다고<br/>표시됨"]
```

공급자는 **기본값으로 설정** 이 켜져 있을 때 프로젝트의 기본 공급자가 되며, 새 공급자는 모두 켜져 있습니다. 모든 공급자에서 이 설정이 꺼진 프로젝트는 공급자가 없는 것처럼 글로벌 공급자로 대체합니다.

모든 OneUptime AI 규칙(AI 규칙과 포스트모템 규칙)은 대신 **추가 필드**에서 자체 공급자를 고를 수 있습니다. 프로젝트의 공급자 중 하나나 글로벌 공급자를 고를 수 있으며, 규칙이 시작하는 모든 작업에 사용됩니다. 아무것도 고르지 않은 규칙은 기본 공급자를 사용하고, 고른 공급자를 더 이상 사용할 수 없으면 기본 공급자로 돌아갑니다. [규칙이 사용하는 LLM 제공자](/docs/ai/ai-sre#규칙이-사용하는-llm-제공자)를 참고하세요.

## OneUptime Cloud

**OneUptime Cloud** 에서는 모든 프로젝트가 설정 없이 글로벌 공급자를 사용할 수 있습니다. 모든 AI 기능에 바로 쓸 수 있으며, 비용은 프로젝트의 AI 크레딧에서 지불됩니다.

대신 자체 API 키나 특정 모델을 쓰려면 아래와 같이 자체 공급자를 추가하세요. 자체 공급자에서 실행되는 AI에는 요금이 부과되지 않습니다.

글로벌 LLM 공급자의 비용은 프로젝트의 AI 크레딧에서 지불됩니다. AI가 하루에 쓸 수 있는 금액을 제한하려면 **프로젝트 설정 → AI → AI Features → 추가 설정** 에서 **일일 AI 지출 한도(USD)** 를 설정하세요. 같은 곳의 **일일 AI 토큰 한도** 는 자체 공급자를 포함한 모든 공급자의 토큰을 제한합니다. [프로젝트 자체의 일일 한도](/docs/ai/ai-sre#프로젝트-자체의-일일-한도)를 참조하세요.

OneUptime Cloud는 공용 인터넷에 있는 LLM 엔드포인트에만 도달할 수 있습니다. 자체 호스팅 Ollama나 vLLM 서버처럼 사설 네트워크에 있는 모델에는 연결할 수 없습니다. 직접 실행하는 모델을 쓰려면 그 모델에 도달할 수 있는 네트워크에 OneUptime을 자체 호스팅하거나, 모델을 공용 엔드포인트로 노출하세요. [자체 호스팅 모델의 기본 URL 선택하기](#자체-호스팅-모델의-기본-url-선택하기)를 참조하세요.

## 자체 호스팅: 환경 변수로 설정 없이 구성하기

자체 호스팅 인스턴스에서 **모든 프로젝트에 한 번에** AI를 켜는 가장 빠른 방법은 OneUptime 서버에 `GLOBAL_LLM_PROVIDER_*` 환경 변수를 설정하는 것입니다. Docker Compose에서는 `config.env` 에, Helm에서는 values로 설정합니다. 시작할 때 OneUptime이 이 변수로 글로벌 LLM 공급자를 등록하고 계속 맞춰 둡니다. 어떤 프로젝트도 따로 설정할 필요가 없으며, 자체 공급자가 없는 프로젝트에서는 AI 수정 작업도 이를 사용합니다.

| 변수 | 설명 |
| --- | --- |
| `GLOBAL_LLM_PROVIDER_TYPE` | 켜려면 필요합니다. `OpenAI`, `AzureOpenAI`, `Anthropic`, `Groq`, `Mistral`, `Ollama`, `OpenAICompatible` 중 하나 |
| `GLOBAL_LLM_PROVIDER_API_KEY` | API 키: OpenAI, Azure OpenAI, Anthropic, Groq, Mistral에는 필요하고, Ollama나 키 없는 OpenAI 호환 서버에는 필요 없음 |
| `GLOBAL_LLM_PROVIDER_BASE_URL` | 엔드포인트: Azure OpenAI, Ollama, OpenAI 호환 서버에 필요 |
| `GLOBAL_LLM_PROVIDER_MODEL_NAME` | 사용할 모델. 선택 사항: 설정하지 않으면 OneUptime은 공급자의 기본 모델을 사용하고, OpenAI 호환 서버에서는 서버 목록의 첫 번째 모델을 사용 |
| `GLOBAL_LLM_PROVIDER_NAME` | 대시보드에 표시되는 선택적 표시 이름 |

:::tabs
@tab Ollama
```bash
GLOBAL_LLM_PROVIDER_TYPE=Ollama
# An address the OneUptime server can reach. Never localhost: see
# "Choosing a Base URL for a Self-Hosted Model" below.
GLOBAL_LLM_PROVIDER_BASE_URL=http://ollama:11434
GLOBAL_LLM_PROVIDER_MODEL_NAME=llama3.1
# No API key needed — Ollama is keyless.
```
@tab OpenAI
```bash
GLOBAL_LLM_PROVIDER_TYPE=OpenAI
GLOBAL_LLM_PROVIDER_API_KEY=sk-xxxxxxxxxxxxxxxxxxxx
GLOBAL_LLM_PROVIDER_MODEL_NAME=gpt-5.1
```
:::

동기화는 선언적입니다. 변수를 바꾸면 다음 재시작 때 공급자가 따라 바뀌고, `GLOBAL_LLM_PROVIDER_TYPE` 을 지우면 공급자가 제거됩니다. Admin Dashboard에서 직접 만든 글로벌 공급자는 절대 건드리지 않습니다. 프로젝트는 여전히 **프로젝트 설정 → AI → LLM 공급자** 에서 자체 공급자를 추가할 수 있으며, 프로젝트가 소유한 공급자가 항상 우선합니다.

## 지원되는 공급자

| 공급자 | 용도 | API 키 필요 | 기본 URL 필요 |
| --- | --- | --- | --- |
| **OpenAI** | GPT-5.1과 그 밖의 OpenAI 모델 | 예 | 아니요(기본값 사용) |
| **Azure OpenAI / Microsoft Foundry** | Microsoft Foundry나 Azure OpenAI에 배포한 모델: OpenAI 모델, Foundry Models, Claude | 예 | 예 |
| **Anthropic** | Claude Sonnet 5.5, Claude Opus 5.5, Claude Haiku 5.5와 그 밖의 Claude 모델 | 예 | 아니요(기본값 사용) |
| **Groq** | Llama, Mixtral 등 개방형 모델의 빠른 추론 | 예 | 아니요(기본값 사용) |
| **Mistral** | Mistral이 호스팅하는 모델 | 예 | 아니요(기본값 사용) |
| **Ollama** | Llama 3.1, Mistral, Qwen처럼 직접 실행하는 오픈 소스 모델 | 아니요 | 예 |
| **OpenAI Compatible** | 모든 OpenAI 호환 서버: vLLM, LocalAI, LM Studio 등 | 아니요(선택) | 예 |

## LLM 공급자 설정하기

:::steps
### LLM 공급자 열기

**프로젝트 설정 → AI → LLM 공급자** 로 이동하고(사이드 메뉴의 **AI** 섹션은 처음에 접혀 있습니다) **LLM 제공자 만들기** 를 클릭합니다.

### 공급자 고르기

**공급자** 에서 **LLM 제공자** 를 고릅니다. OpenAI, Anthropic, Azure OpenAI / Microsoft Foundry, Groq, Mistral, Ollama, OpenAI 호환 서버마다 카드가 있고, 각 카드에 무엇인지 한 줄로 적혀 있습니다.

### 연결하기

**연결** 에서는 그 공급자가 쓰는 항목만, 필드마다 그 공급자에 맞는 도움말과 함께 묻습니다:

- **API 키**: API 키. OpenAI, Azure OpenAI, Anthropic, Groq, Mistral에는 필요하고, OpenAI 호환 서버에는 선택이며, Ollama에는 묻지 않습니다
- **기본 URL**: 엔드포인트. Azure OpenAI, Ollama, OpenAI Compatible에는 필요하고, 그 밖에는 프록시나 게이트웨이를 거칠 때만 입력합니다
- **모델 이름**: 사용할 모델. 예: `gpt-5.1`, `claude-sonnet-5-5`, `llama3.1`. 비워 두면 OneUptime은 공급자의 기본 모델을 사용합니다. OpenAI 호환 서버에는 기본 모델이 없으므로, OneUptime이 서버에 제공하는 모델을 물어보고 목록의 첫 번째 모델을 사용합니다
- **이름**: 직접 이름을 입력하기 전까지는 공급자 이름입니다. 예: "Production OpenAI", "Local Ollama"
- **추가 필드**: 위 필드 아래에 접혀 있습니다. **설명**, AI 기능이 프로젝트의 기본 공급자만 사용하기 때문에 새 공급자에서 켜져 있는 **기본값으로 설정**, 모든 요청과 함께 공급자에게 보내는 추가 매개변수를 담은 선택적 JSON 객체인 **추가 매개변수** 가 있습니다(예: `{"temperature": 0.2}`)

**공급자를 볼 수 있는 사람.** 프로젝트의 LLM 공급자는 프로젝트 설정을 읽을 수 있는 구성원만 읽습니다: **프로젝트 소유자**, **프로젝트 관리자**, **프로젝트 구성원**, **뷰어**, **설정 관리자**, **설정 구성원**, **설정 뷰어**, **Read LLM**. 공급자의 **API 키** 와 **추가 매개변수** 는 프로젝트 소유자와 관리자만 읽습니다. 매개변수는 모든 요청과 함께 공급자에게 보내지며 키처럼 토큰이나 헤더를 담을 수 있기 때문입니다. 다른 구성원은 매개변수가 저장되어 있는지만 볼 수 있고 내용은 볼 수 없습니다. 공급자를 편집할 수 있는 구성원은 API 키나 매개변수를 읽지 않고도 바꿀 수 있습니다. 편집 양식에서 이 필드들은 비어 있는 상태로 시작하며, 비워 두면 저장된 값이 유지됩니다. 매개변수를 지우려면 `{}` 를 저장하세요. 공급자의 **기본 URL** 은 프로젝트 소유자와 관리자만 바꿀 수 있습니다. 공급자의 API 키와 추가 매개변수가 그 주소로 보내지기 때문입니다. 공급자를 편집할 수 있는 다른 구성원은 그 밖의 모든 것을 바꿀 수 있습니다. 공급자를 읽을 수 있는 사람은 누구나 그 **기본 URL** 을 읽을 수 있으므로, 키, 토큰, 비밀번호를 절대 넣지 말고 **API 키** 를 사용하세요. 같은 페이지의 **글로벌 LLM 공급자** 목록(프로젝트가 대체하여 쓰는 공유 공급자)은 로그인한 모든 사람에게 이름, 설명, 가격만 보여 주고 그 밖의 정보는 보여 주지 않습니다.

### 테스트하기

**공급자 테스트하기.** 공급자 페이지나 그 행의 메뉴에 있는 **테스트** 는 공급자의 **API 키**, **모델 이름**, **기본 URL**, **추가 매개변수** 로 짧은 프롬프트를 보내고, 공급자가 응답했는지, OneUptime의 AI 기능에 필요한 도구 호출을 했는지 알려 줍니다. 테스트가 실패하면 먼저 무엇을 확인할지, 그다음 공급자가 무엇이라고 답했는지 보여 줍니다. 공급자를 변경할 수 있는 사람은 테스트할 수 있습니다: **프로젝트 소유자**, **프로젝트 관리자**, **프로젝트 구성원**, **설정 관리자**, **설정 구성원**, **Edit LLM**. 공급자를 볼 수 있는 그 밖의 사람에게는 **테스트** 가 잠겨 있습니다. 글로벌 LLM 공급자는 서버 관리자가 Admin Dashboard의 **설정 → 글로벌 LLM 공급자** 에서 테스트합니다.
:::

## 공급자별 구성

### OpenAI

1. [OpenAI Platform](https://platform.openai.com/api-keys)에서 API 키를 받습니다
2. LLM 공급자로 **OpenAI** 를 선택합니다
3. API 키를 입력합니다
4. 모델 이름을 선택합니다:
   - `gpt-5.1` - 권장 기본값으로, 도구 호출과 복잡한 조사에 강합니다
   - `gpt-5.1-mini` - 더 빠르고 비용 효율적입니다

```text title="Example configuration"
Name: Production OpenAI
LLM Provider: OpenAI
API Key: sk-xxxxxxxxxxxxxxxxxxxx
Model Name: gpt-5.1
```

### Anthropic

1. [Anthropic Console](https://console.anthropic.com/)에서 API 키를 받습니다
2. LLM 공급자로 **Anthropic** 을 선택합니다
3. API 키를 입력합니다
4. 모델 이름을 선택합니다:
   - `claude-sonnet-5-5` - 권장 기본값으로, 지능, 속도, 비용의 균형이 가장 좋습니다
   - `claude-opus-5-5` - 더 강력하며, 가장 어려운 조사에 적합합니다
   - `claude-haiku-5-5` - 가장 빠르고 비용 효율적입니다

```text title="Example configuration"
Name: Production Anthropic
LLM Provider: Anthropic
API Key: sk-ant-xxxxxxxxxxxxxxxxxxxx
Model Name: claude-sonnet-5-5
```

Claude Opus 4.7과 그 이후의 모든 Claude 모델은 샘플링을 스스로 정하며, `temperature`, `top_p` 또는 `top_k` 를 지정한 요청을 거부합니다. OneUptime은 이 모델들에 대해 해당 설정을 보내지 않습니다. 그래도 모델이 그중 하나를 거부하면 OneUptime은 그 설정을 빼고 요청을 다시 보내고, 해당 공급자에 대해 이를 기억합니다.

Claude 5 모델은 답하기 전에 생각하며, 그 생각은 답변의 토큰 한도에 포함되므로 OneUptime은 그만큼 여유를 남깁니다. 생각을 줄여 더 빠르고 저렴하게 답하게 하려면 공급자의 **추가 매개변수** 에 `{"output_config": {"effort": "low"}}` 를 설정하세요. OneUptime은 그곳에 추가한 설정을 모든 요청과 함께 Anthropic에 보내지만, `model`, `messages`, `system`, `tools`, `tool_choice`, `stream` 은 OneUptime이 직접 설정하므로 제외합니다.

OneUptime은 Anthropic의 프롬프트 캐싱을 사용합니다. 조사나 AI에게 질문 답변의 각 호출은 시스템 프롬프트, 도구, 지금까지의 대화를 다시 보내고, OneUptime은 이를 캐시 대상으로 표시합니다: 호출은 이전 호출이 보낸 부분에 대해 가격의 10분의 1 이하를, 새로운 부분에 대해서는 가격보다 4분의 1 더 많이 내며, 새로운 부분은 캐시에 기록됩니다. Claude 앞의 게이트웨이가 캐시 표시를 거부하면, OneUptime은 표시 없이 요청을 다시 보내고 그 사실을 공급자별로 기억합니다. [토큰을 세는 방법](/docs/ai/ai-sre#토큰을-세는-방법)에서 캐시된 토큰이 한도에 어떻게 계산되는지 설명합니다.

### Azure OpenAI와 Microsoft Foundry

Microsoft Foundry나 Azure OpenAI에 배포한 모델(OpenAI 모델, 그 밖의 Foundry Models, Claude)에는 **Azure OpenAI / Microsoft Foundry** 를 사용합니다. 리소스의 키 중 하나를 **API 키** 로, 배포 이름을 **모델 이름** 으로, 리소스의 엔드포인트를 **기본 URL** 로 입력합니다. 예: `https://contoso-ai.openai.azure.com/openai/v1`. [Microsoft Foundry와 Azure OpenAI](/docs/ai/microsoft-foundry)에서 리소스, 권한, 모델 배포, 네트워크 요구 사항, 문제 해결 등 Azure 쪽 설정을 안내합니다.

### Ollama(자체 호스팅)

Ollama는 오픈 소스 모델을 여러분의 머신에서 실행합니다.

1. [ollama.ai](https://ollama.ai)에서 Ollama를 설치합니다
2. 모델을 받습니다: `ollama pull llama3.1`
3. Ollama가 실행 중이고 OneUptime 서버가 도달할 수 있는지 확인합니다. 네이티브 설치는 `127.0.0.1` 에서만 수신하므로, 다른 머신과 컨테이너의 연결을 받으려면 `OLLAMA_HOST=0.0.0.0:11434` 로 시작하세요(공식 `ollama/ollama` Docker 이미지는 이미 그렇게 합니다)
4. LLM 공급자로 **Ollama** 를 선택합니다
5. 기본 URL을 입력합니다. OneUptime 서버가 도달하는 Ollama 서버의 주소로, 예를 들면 `http://ollama:11434` 입니다(`/api/chat` 은 OneUptime이 직접 덧붙입니다). `localhost` 는 동작하지 않습니다. [자체 호스팅 모델의 기본 URL 선택하기](#자체-호스팅-모델의-기본-url-선택하기)를 참조하세요
6. 받은 모델 이름을 입력합니다

```text title="Ollama as a service named ollama on OneUptime's Docker Compose network"
Name: Self-Hosted Ollama
LLM Provider: Ollama
Base URL: http://ollama:11434
Model Name: llama3.1
```

**컨텍스트 창을 늘리세요.** 따로 지정하지 않으면 Ollama는 찾은 GPU 메모리에 따라 모델의 컨텍스트 창 크기를 정합니다. 24GiB 미만이면 4k 토큰, 48GiB까지는 32k, 그 이상은 256k입니다(이전 릴리스는 2,048 또는 4,096 토큰을 사용합니다). OneUptime의 AI 기능은 에이전트입니다. 모든 요청에는 시스템 프롬프트와 도구 정의가 들어 있어 질문 전에만 10,000 토큰이 넘으며, AI 조사는 진행하면서 각 쿼리 결과를 대화에 덧붙입니다. 요청이 더 이상 들어가지 않으면 Ollama는 가장 오래된 메시지를 버리고, 질문도 함께 사라집니다. 모델과 Ollama 릴리스에 따라, 모델이 질문이나 도구 없이 답하거나, 요청이 "no user query found in messages"(Qwen 3.8 이상) 또는 "the prompt is longer than the context length currently available to the model" 로 실패합니다. OneUptime은 이런 실패를 "…the request is larger than the model's context window" 로 보고하며 조사를 다시 실행하지 않습니다. 공급자의 **추가 매개변수** 에 더 큰 `num_ctx` 를 설정하세요:

```json
{ "options": { "num_ctx": 65536 } }
```

OneUptime은 이 `options` 객체를 Ollama에 보내는 옵션에 병합하므로, 바꾸려는 설정만 적으세요. 65,536 토큰은 Ollama가 에이전트에 권장하는 값으로, 대부분의 조사에 충분합니다. OneUptime은 대화가 약 75,000 토큰을 넘어야 오래된 쿼리 결과를 줄이기 시작하므로 긴 조사는 더 많이 쓸 수 있습니다. 모델이 지원하고 GPU가 감당할 수 있다면 131,072를 사용하세요. 컨텍스트 창이 크면 메모리가 더 필요하며, `ollama ps` 로 로드된 각 모델이 받은 컨텍스트를 볼 수 있습니다. 대신 모든 클라이언트의 기본값을 올리려면 Ollama 서버에 `OLLAMA_CONTEXT_LENGTH` 를 설정하세요. OneUptime이 OpenAI 호환 `/v1` API(**OpenAI Compatible** 공급자)로 Ollama에 접속할 때는 `num_ctx` 가 무시되므로 이것이 유일한 방법입니다. `GLOBAL_LLM_PROVIDER_*` 변수로 등록한 글로벌 공급자는 Admin Dashboard의 **설정 → 글로벌 LLM 공급자** 에서 **추가 매개변수** 를 설정하세요. 시작 시 동기화는 이 필드를 건드리지 않습니다.

**많이 쓰는 Ollama 모델:**

- `llama3.1` - Meta의 Llama 3.1 모델로, 도구 호출을 지원하는 가장 오래된 Llama입니다
- `llama3.3` - Meta의 Llama 3.3 모델
- `qwen2.5` - Alibaba의 Qwen 2.5 모델
- `mistral-nemo` - Mistral AI의 Nemo 모델

> [!NOTE]
> OneUptime의 AI 기능은 에이전트이며 도구 호출에 크게 의존합니다. `llama3.1` 이상이나 도구를 호출하는 다른 모델을 사용하세요. 작은 모델이나 도구 호출이 없는 모델(`llama2` 나 초기 `llama3` 등)은 제대로 답하지 못합니다. 모니터, 인시던트, 텔레메트리를 조회할 수 없어서 조사가 비어 있거나 지어낸 내용으로 돌아옵니다.

### 자체 호스팅 모델의 기본 URL 선택하기

자체 호스팅 모델의 기본 URL은 Ollama, vLLM, LM Studio 또는 다른 OpenAI 호환 서버 어느 것이든 **OneUptime 서버** 가 도달할 수 있는 주소여야 합니다. 브라우저는 절대 거기에 연결하지 않습니다.

**루프백 주소는 항상 거부됩니다.** 연결하기 전에 OneUptime은 기본 URL의 호스트 이름이 확인되는 모든 주소를 검사합니다. `localhost`, `127.0.0.1`, `[::1]`, `0.0.0.0` 과 `169.254.169.254` 같은 링크 로컬 및 클라우드 메타데이터 주소는 자체 호스팅을 포함한 모든 배포에서 거부됩니다. 이는 의도된 것입니다. 공급자의 기본 URL로 OneUptime 서버 자체의 서비스에 도달할 수 있어서는 안 됩니다. Docker Compose나 Kubernetes 안에서 `localhost` 는 어차피 모델을 실행하는 머신이 아니라 OneUptime 컨테이너를 가리킵니다.

대신 사설 주소나 내부 호스트 이름을 사용하세요:

| 모델 서버가 실행되는 곳 | 기본 URL |
| --- | --- |
| OneUptime의 Docker Compose 네트워크(`oneuptime`)에 있는 서비스 | 서비스 이름. 예: `http://ollama:11434` |
| OneUptime과 같은 Kubernetes 클러스터 | Service의 DNS 이름. 예: `http://ollama.<namespace>.svc.cluster.local:11434`, [번들 vLLM](#kubernetes의-자체-호스팅-vllmhelm)과 같은 패턴 |
| 컨테이너 밖의 호스트 머신 자체 | 호스트의 LAN IP. 예: `http://192.168.1.20:11434`, Docker Desktop에서는 `http://host.docker.internal:11434` |
| 네트워크의 다른 머신 | 그 머신의 사설 IP나 내부 호스트 이름. 예: `http://10.0.0.12:11434` |

OpenAI 호환 서버도 각자의 포트와 `/v1` 경로로 같은 규칙을 따릅니다. 예: `http://vllm:8000/v1`, LM Studio는 `http://192.168.1.20:1234/v1`. 네이티브 설치의 Ollama처럼 LM Studio도 서버 설정에서 **Serve on Local Network** 를 켜기 전까지는 `127.0.0.1` 에서만 수신합니다.

**자체 호스팅 설치에서는 사설 주소가 동작합니다.** 자체 호스팅 OneUptime은 `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `100.64.0.0/10`, IPv6 `fc00::/7` 같은 사설 네트워크 주소에 도달할 수 있습니다. 단, `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true` 를 설정하면 OneUptime Cloud처럼 이를 거부합니다. 이 설정은 프로젝트가 아니라 관리자가(`GLOBAL_LLM_PROVIDER_*` 변수나 Admin Dashboard에서) 구성하는 글로벌 LLM 공급자에는 적용되지 않으며, 그 공급자는 계속 사설 주소에 도달할 수 있습니다. 루프백과 링크 로컬 주소는 모든 공급자에 대해 계속 거부됩니다.

**OneUptime Cloud(SaaS)는 사설 네트워크에 도달할 수 없습니다.** 모든 LLM 공급자에 대해 사설 네트워크 주소와, 그 주소로 확인되는 호스트 이름을 거부합니다. 자체 인프라에서 실행되는 모델을 쓰려면 그 모델에 도달할 수 있는 네트워크에 OneUptime을 자체 호스팅하거나, 모델을 공개적으로 도달 가능한 엔드포인트로 노출하세요. 공개 엔드포인트는 API 키로 보호하세요. **Ollama** 공급자는 자격 증명을 보내지 않지만, **OpenAI Compatible** 은 API 키를 bearer 토큰으로 보냅니다(Ollama는 `/v1` 아래에서 OpenAI 호환 API도 제공하므로, 키를 확인하는 리버스 프록시 뒤에 둘 수 있습니다).

### OpenAI Compatible(vLLM, LocalAI, LM Studio 등)

OpenAI의 `/chat/completions` API를 구현하지만 OpenAI 자체는 아닌 서버에는 **OpenAI Compatible** 공급자를 사용하세요. 예: [vLLM](https://docs.vllm.ai), [LocalAI](https://localai.io), [LM Studio](https://lmstudio.ai), text-generation-webui. 이런 서버는 보통 여러분의 주소에서, 흔히 인증 없이 실행됩니다.

1. OpenAI 호환 서버를 시작하고 기본 URL을 적어 둡니다(보통 `/v1` 로 끝납니다)
2. LLM 공급자로 **OpenAI Compatible** 을 선택합니다
3. **기본 URL** 을 입력합니다(필수). 예: `http://your-server:8000/v1`. OneUptime 서버가 도달할 수 있어야 하므로 `localhost` 는 안 됩니다. [자체 호스팅 모델의 기본 URL 선택하기](#자체-호스팅-모델의-기본-url-선택하기)를 참조하세요
4. **모델 이름** 을 입력하거나 비워 둡니다. 비워 두면 OneUptime이 서버에 제공하는 모델을 물어보고 목록의 첫 번째 모델을 사용합니다(vLLM에서는 서버가 제공하는 모델). 입력하는 이름은 서버가 제공하는 모델과 일치해야 합니다
5. **API 키** 는 서버가 요구할 때만 입력하고, 키 없는 서버에서는 비워 둡니다

```text title="A keyless vLLM"
Name: Self-Hosted vLLM
LLM Provider: OpenAI Compatible
Base URL: http://vllm.internal:8000/v1
Model Name: meta-llama/Llama-3.1-8B-Instruct
API Key: (leave blank)
```

> [!TIP]
> 저장한 뒤 공급자의 **테스트** 로 연결, 모델 이름, 기본 URL을 확인하세요.

### Kubernetes의 자체 호스팅 vLLM(Helm)

Helm 차트로 OneUptime을 자체 호스팅한다면, OpenAI 호환 추론 서버인 [vLLM](https://docs.vllm.ai)을 클러스터 안에서 실행해 자체 GPU로 로컬 모델을 제공할 수 있습니다. 어떤 데이터도 인프라 밖으로 나가지 않습니다.

1. Helm values에서 켭니다(NVIDIA GPU 노드가 필요합니다):

   ```yaml
   vllm:
     enabled: true
     model: Qwen/Qwen2.5-1.5B-Instruct
   ```

2. `helm upgrade` 를 실행하고 vLLM 파드가 Ready가 될 때까지 기다립니다(첫 시작 때 모델을 내려받습니다)
3. 이제 끝입니다. vLLM은 시작할 때 글로벌 LLM 공급자로 자동 등록되므로(`vllm.globalProvider.enabled`, 기본값 `true`) AI 수정 작업을 포함한 모든 프로젝트에서 AI 기능이 동작합니다. (Cloud와 자체 호스팅 모두에서, 프로젝트가 자체 공급자를 소유하지 않으면 에이전트 수정 작업은 글로벌 공급자를 사용합니다. Cloud에서는 그 사용량이 계량된 AI 토큰으로 청구됩니다. 프로젝트가 소유한 공급자가 항상 우선합니다.)

자동 등록을 껐다면(`vllm.globalProvider.enabled: false`) 공급자를 직접 만드세요:

1. LLM 공급자로 **OpenAI Compatible** 을 선택합니다(vLLM은 OpenAI API를 사용합니다)
2. 클러스터 내부 기본 URL을 입력합니다: `http://<release>-vllm.<namespace>.svc.cluster.local:8000/v1`(`global.clusterDomain` 을 바꿨다면 `cluster.local` 을 바꾸세요)
3. 모델 이름을 입력합니다: Hugging Face 모델 ID 전체(또는 설정했다면 `vllm.servedModelName`). 비워 두면 vLLM이 제공하는 모델을 사용합니다
4. API 키는 `vllm.apiKey` 를 설정한 경우에만 입력하고, 키 없는 vLLM에서는 비워 둡니다

```text title="The in-cluster vLLM"
Name: In-Cluster vLLM
LLM Provider: OpenAI Compatible
Base URL: http://oneuptime-vllm.default.svc.cluster.local:8000/v1
Model Name: Qwen/Qwen2.5-1.5B-Instruct
API Key: (leave blank unless vllm.apiKey is set)
```

과금이 켜져 있거나 `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true`(Helm values의 `outboundConnections.blockPrivateNetwork: true`)인 경우, 프로젝트 자체의 공급자는 이 클러스터 내부 주소에 도달할 수 없습니다. 이 주소가 클러스터의 사설 IP로 확인되기 때문입니다. 대신 Admin Dashboard의 **설정 → 글로벌 LLM 공급자** 에서 같은 필드로 공급자를 만드세요. 글로벌 LLM 공급자는 그 주소에 도달할 수 있습니다.

GPU 스케줄링, 접근이 제한된 모델, 튜닝 옵션은 [Helm 차트의 vLLM 가이드](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/oneuptime/docs/ai-vllm.md)를 참조하세요.

## 좋은 운영 방법

- **공급자 이름을 명확하게 지으세요**. "Production OpenAI"나 "Development Ollama"처럼 지으면 팀원이 어느 것이 어느 것인지 압니다.
- **키는 API 키 필드에 두세요.** API 키는 저장 시 암호화되며, 프로젝트 소유자와 관리자만 읽습니다.
- **변경할 때마다 테스트하세요**. 공급자의 **테스트** 를 사용합니다.
- **AI 비용을 지켜보세요.** 모든 호출이 토큰과 비용과 함께 **프로젝트 설정 → AI → AI 로그** 에 나열됩니다.

## 문제 해결

:::details 공급자에 도달할 수 없음
- **OpenAI 또는 Anthropic**: API 키가 유효하고 크레딧이 남아 있는지 확인하세요
- **Azure OpenAI / Microsoft Foundry**: 오류는 바꿔야 할 것부터 알려 줍니다. [Microsoft Foundry와 Azure OpenAI](/docs/ai/microsoft-foundry)에서 Azure가 응답하는 각 오류를 설명합니다
- **Ollama**: Ollama 서버가 실행 중이고, OneUptime 서버가 도달할 수 있는 주소에서 수신하며(네이티브 설치에서는 `OLLAMA_HOST=0.0.0.0:11434`), 기본 URL이 그 주소를 가리키는지 확인하세요
- **OpenAI Compatible**: 기본 URL이 `/v1` 로 끝나는지(또는 서버에 맞는지), 모델 이름을 입력했다면 서버가 제공하는 모델과 일치하는지, 서버가 요구할 때만 API 키를 설정했는지 확인하세요. 모델 이름이 비어 있는데 서버의 `/models` 엔드포인트에 모델이 하나도 없다면 모델 이름을 입력하세요
- **"…points to an address OneUptime is not allowed to connect to"**: 기본 URL이 거부되는 주소로 확인됩니다. `localhost` 나 다른 루프백 주소, 또는 OneUptime Cloud에서는 사설 네트워크 주소입니다. (OneUptime Cloud는 거부된 호스트 이름을 대신 "…could not be reached"로 보고합니다.) [자체 호스팅 모델의 기본 URL 선택하기](#자체-호스팅-모델의-기본-url-선택하기)를 참조하세요
- **방화벽**: 네트워크가 공급자 API로 나가는 연결을 허용하는지 확인하세요
:::

:::details 모델을 찾을 수 없음
모델 이름의 철자를 확인하세요. Ollama에서는 먼저 `ollama pull <model-name>` 으로 모델을 받으세요. 일부 모델은 일부 지역에서만 사용할 수 있습니다.
:::

:::details 컨텍스트 창이 너무 작음
- **"…the request is larger than the model's context window"**: 요청이 모델의 컨텍스트 창에 들어가지 않았습니다. 보통 AI 조사가 많은 증거를 모았기 때문입니다. 공급자의 **추가 매개변수** 에서 `num_ctx` 를 늘리거나, Ollama 서버에서 `OLLAMA_CONTEXT_LENGTH` 를 늘리세요. [Ollama(자체 호스팅)](#ollama자체-호스팅)를 참조하세요
- **"no user query found in messages"**: 같은 문제를 Qwen이 보고한 것입니다. OneUptime은 항상 질문을 보내지만, Ollama가 나머지 요청을 맞추려고 질문을 버렸습니다
:::

그래도 해결되지 않나요? [OneUptime의 GitHub 이슈](https://github.com/OneUptime/oneuptime/issues)에서 오류를 찾아보거나, 요금제에 지원이 포함되어 있다면 지원팀에 문의하세요.

## 다음 단계

:::cards
- [코드](/docs/ai/ai-agent): 공급자가 작성하는 풀 리퀘스트와 그 시작 위치입니다.
- [AI SRE](/docs/ai/ai-sre): 공급자를 얻은 OneUptime AI가 하는 일입니다.
- [AI에게 질문](/docs/ai/ask-ai): 프로젝트에 질문하고, 대화의 공급자를 바꿉니다.
:::
