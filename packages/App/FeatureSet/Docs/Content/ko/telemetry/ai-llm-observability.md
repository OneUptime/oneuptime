# OneUptime으로 하는 AI / LLM 옵저버빌리티

AI가 나눈 모든 대화를 읽고, 일어난 그대로 다시 재생하고, AI가 잘못 답할 때 알림을 받으세요. 모든 것이 표준 OpenTelemetry 위에서 동작하며 독점 SDK는 없습니다. 앱이 OpenTelemetry **GenAI 시맨틱 규칙**(`gen_ai.*`)을 따르는 스팬을 내보내면, OneUptime이 이를 대화, 알림, 사용량, 비용으로 바꿉니다.

## 제공되는 기능

내비게이션 바의 관측 가능성 아래에서 **AI / LLM**을 여세요.

- **대화** — AI가 나눈 모든 대화입니다. 사람들이 무엇을 물었는지, AI가 무엇이라고 답했는지, 어떤 도구를 썼는지, 무엇이 잘못됐는지 보여 줍니다. 목록 위에는 다섯 가지 숫자가 있습니다. 대화 수, AI 답변 수, 확인이 필요한 수, 비용, 그리고 답변에 보통 걸리는 시간입니다. 대화를 열면 읽거나 다시 재생할 수 있습니다.
- **호출** — 모든 LLM, 임베딩, 에이전트, 도구 호출이며 서비스, 공급자, 모델, 작업, 사람, 팀으로 필터링할 수 있습니다. 호출을 클릭하면 트레이스 뷰어에서 열립니다.
- **사용량** — 기간별 호출, 토큰, 비용과 누가 무엇에 지출하는지입니다. 직원, 팀, 모델, 공급자, 앱을 지출 순으로 보여 줍니다.
- **알림** — AI가 잘못 답할 때를 위한 기본 제공 알림과 AI / LLM 모니터입니다.
- **예산** — 일일 비용 한도이며, 알림을 걸 수 있는 메트릭으로 게시됩니다.
- **가격** — 내장 카탈로그가 모르는 모델을 위한 모델별 자체 가격입니다.
- **설정** — 아래 다섯 단계와 프로젝트의 엔드포인트입니다.

트레이스 뷰어에서 각 AI 호출의 스팬에는 모델, 토큰 수, 비용, 요청 매개변수, 프롬프트와 응답을 보여 주는 **AI / LLM** 패널도 있습니다.

## 1단계 — AI 호출 보내기

텔레메트리 수집 키를 만드세요. **프로젝트 설정 → 텔레메트리 및 APM → 수집 키**를 열고 **수집 키 생성**을 클릭합니다. 앱은 이 키를 OTLP 헤더로 전달합니다. (스크린샷은 [OpenTelemetry 가이드](/docs/telemetry/open-telemetry)를 참고하세요.)

그런 다음 원하는 OpenTelemetry GenAI 라이브러리로 앱을 계측하세요.

- **OpenLLMetry**(Traceloop) — OpenAI, Anthropic, Cohere, Bedrock, LangChain, LlamaIndex, CrewAI 등.
- **OpenInference**(Arize) — OpenAI, LangChain, LlamaIndex, DSPy 등.
- **Vercel AI SDK**, 또는 OpenAI, Anthropic, Gemini용 **OpenTelemetry 계측**.

LLM 트래픽을 **LiteLLM**이나 **Portkey** 같은 게이트웨이로 보내고 있나요? 앱마다 계측하는 대신 게이트웨이에서 트레이스를 내보내세요. [AI 게이트웨이 관측](/docs/telemetry/ai-gateways)을 참고하세요. 엔지니어들이 쓰는 코딩 어시스턴트(Claude Code, Cursor, Codex, Gemini CLI, Copilot)를 찾고 있나요? 이 도구들은 자체 OpenTelemetry를 내보내므로 따로 할 일이 없습니다. [AI 코딩 어시스턴트 옵저버빌리티](/docs/telemetry/ai-coding-assistants)를 참고하세요.

### Python (OpenLLMetry)

```bash
pip install traceloop-sdk opentelemetry-exporter-otlp
```

```python
from traceloop.sdk import Traceloop

Traceloop.init(
    app_name="my-ai-agent",
    api_endpoint="https://oneuptime.com/otlp",   # or your self-hosted host + /otlp
    headers={"x-oneuptime-token": "YOUR_INGESTION_TOKEN"},
)

# Your normal OpenAI / Anthropic / LangChain calls are now traced automatically.
```

### Node.js / TypeScript (OpenLLMetry)

```bash
npm install @traceloop/node-server-sdk
```

```ts
import * as traceloop from "@traceloop/node-server-sdk";

traceloop.initialize({
  appName: "my-ai-agent",
  baseUrl: "https://oneuptime.com/otlp", // or your self-hosted host + /otlp
  headers: { "x-oneuptime-token": "YOUR_INGESTION_TOKEN" },
});
```

### OpenTelemetry 환경 변수만 사용하기

네이티브 OpenTelemetry SDK로 계측한다면 OTLP 익스포터가 OneUptime을 가리키도록 하세요.

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT="https://oneuptime.com/otlp"
export OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=YOUR_INGESTION_TOKEN"
export OTEL_SERVICE_NAME="my-ai-agent"
```

OneUptime을 직접 호스팅하나요? `https://oneuptime.com/otlp`를 `https://YOUR-ONEUPTIME-HOST/otlp`로 바꾸세요.

## 2단계 — 오간 내용 기록하기

계측이 내용을 기록하면 대화에 사람들이 무엇을 물었고 AI가 무엇이라고 답했는지 표시됩니다. OpenLLMetry는 끄지 않는 한(`TRACELOOP_TRACE_CONTENT=false`) 프롬프트와 응답을 기록합니다. OpenTelemetry 계측은 요청할 때만 기록합니다.

```bash
export OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true
```

내용이 없어도 대화에는 소요 시간, 비용, 문제가 표시되며 내용이 기록되지 않았다고 알려 줍니다. 프롬프트에는 민감한 데이터가 들어 있을 수 있습니다. 저장 전에 가리는 방법은 [개인정보 보호와 마스킹](#개인정보-보호와-마스킹)을 참고하세요.

## 3단계 — 호출을 대화로 묶기

채팅 앱은 턴마다 모델을 한 번 호출합니다. 모든 AI 호출에서 `gen_ai.conversation.id`(또는 `session.id`)를 채팅 ID로 설정하면, 호출과 트레이스가 몇 개든 각 채팅이 하나의 대화로 표시됩니다. OpenLLMetry에서는 요청마다 한 번 연결 속성(association property)으로 설정하세요.

```python
from traceloop.sdk import Traceloop

Traceloop.set_association_properties({
    "session_id": chat.id,
    "user_email": user.email,
})
```

대화 ID가 없는 호출도 한 번에 한 요청(한 트레이스)씩 표시됩니다.

## 4단계 — 누가 물었는지 알려 주기

`user.id` 또는 `user.email`을 설정하면(위의 연결 속성이 이메일을 설정합니다) 각 대화의 상대가 누구인지 보고, 목록을 사람으로 검색하고, 사용량 탭에서 직원별로 지출 순위를 볼 수 있습니다. OneUptime이 읽는 모든 키는 [직원 및 팀 귀속](#직원-및-팀-귀속)에 나와 있습니다.

## 5단계 — 잘못된 답변에 플래그 지정하기

OneUptime은 답변이 도착할 때마다 확인하고 무엇이 잘못됐는지 표시합니다.

| 문제       | 의미                                                    | 판단 근거                                                                                                                                                                  |
| ---------- | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 실패       | 호출이 오류로 끝나 답변이 오지 않음                     | 스팬 상태 Error, `error.type`, 또는 종료 이유 `error`                                                                                                                      |
| 거부됨     | AI가 거절했거나 안전 필터가 차단함                      | 거부나 안전 관련 종료 이유(`content_filter`, `refusal`, `SAFETY` 등), 답변 안의 거부, 또는 흔한 영어 거부 문구로 시작하는 답변                                             |
| 잘림       | 답변이 토큰 한도에서 멈춤                               | 종료 이유 `length`, `max_tokens` 또는 `MAX_TOKENS`                                                                                                                         |
| 비어 있음  | AI가 텍스트도 도구 호출도 없이 답함                     | 아무것도 담기지 않은 기록된 내용, 또는 출력 토큰 0개                                                                                                                       |
| 플래그됨   | 앱이 보낸 평가가 답변이 나쁘다고 판단함                 | `gen_ai.evaluation.result` 이벤트                                                                                                                                          |

처음 네 가지는 따로 할 일이 없습니다. 나머지(가드레일, eval 또는 자체 LLM 심사자가 거부하는 답변)에 플래그를 지정하려면 답변의 스팬에 `gen_ai.evaluation.result` 이벤트를 추가하고 `gen_ai.evaluation.score.label`을 `fail`로 설정하세요.

```python
from opentelemetry import trace

trace.get_current_span().add_event(
    "gen_ai.evaluation.result",
    {
        "gen_ai.evaluation.name": "relevance",
        "gen_ai.evaluation.score.label": "fail",
        "gen_ai.evaluation.explanation": "The answer is about another product.",
    },
)
```

`incorrect`, `wrong`, `unhelpful`, `toxic`, `unsafe`, `hallucination` 같은 레이블도 실패로 간주됩니다. 이벤트는 평가 대상 답변의 스팬에, 그 스팬이 열려 있는 동안 붙어야 합니다.

OneUptime은 대화를 평가하기 위해 다른 AI로 보내지 않습니다. 모든 확인은 호출 자체에 담긴 내용만 읽습니다.

## 대화 읽기와 다시 재생하기

대화는 채팅 앱이 기록을 보여 주는 것처럼 통째로 열립니다. 사람이 한 말은 오른쪽에, AI의 답변은 왼쪽에 모델, 시간, 토큰, 비용과 함께 표시되고, 그 사이에 도구 호출이 있으며, 잘못된 부분은 일어난 자리에 표시됩니다. 답변 아래의 **세부 정보**는 종료 이유와 평가를 보여 주고, 트레이스에 있는 해당 호출로 가는 링크도 제공합니다.

아래쪽 막대는 그 사람이 겪은 그대로 대화를 다시 재생합니다.

- **다시 재생**은 첫 메시지부터 실제로 일어난 속도로 재생하며, 답변이 오는 동안 "AI가 답변하는 중…"이 시간을 셉니다. 아무 메시지의 시간을 클릭하면 거기서부터 재생합니다.
- **대기 건너뛰기**는 기본으로 켜져 있으며 3초가 넘는 침묵을 줄입니다. 속도 버튼으로 1×, 2×, 4×, 8× 속도로 재생할 수 있습니다.
- **K** 키는 재생하거나 일시 정지하고, **J** 또는 **←** 키는 메시지 하나 뒤로, **L** 또는 **→** 키는 하나 앞으로 이동합니다.
- 재생이 멈춘 메시지는 주소에 남으므로(`?step=`), 링크를 열면 바로 그 순간에서 열립니다.

## AI가 잘못 답할 때 알림 받기

**알림** 탭은 대부분의 AI 앱에 필요한 알림을 제공합니다. 하나를 고르면 내용이 채워진 모니터 생성 화면이 열리고, 저장하기 전에 무엇이든 바꿀 수 있습니다.

| 알림                     | 알려 주는 시점                                                                                     |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| 답변에 문제 발생         | 15분 동안의 답변 중 5% 넘게 실패, 거부, 잘림, 빈 답변 또는 플래그가 될 때                          |
| AI 호출 실패             | 5분 동안 모델 호출의 10% 넘게 오류로 끝날 때                                                       |
| AI가 답변을 거부함       | 30분 동안의 답변 중 5% 넘게 거부일 때                                                              |
| 답변이 잘림              | 30분 동안 답변 3개 이상이 토큰 한도에서 멈출 때                                                    |
| 답변에 플래그 지정       | 평가가 답변을 나쁘다고 표시할 때                                                                   |
| 답변이 느림              | 15분 동안의 답변 중 10% 넘게 30초보다 오래 걸릴 때                                                 |
| AI가 답변을 멈춤         | AI가 30분 동안 아무 답변도 하지 않을 때                                                            |

비율 기반 알림은 나쁜 답변이 최소 3개가 될 때까지도 기다리므로, 답변 두 개 중 하나가 나빴다고 누군가를 깨우지 않습니다.

각 알림은 **AI / LLM** 모니터입니다. 설정에서 무엇을 나쁜 답변으로 볼지(위의 문제, 지정한 한도보다 느린 답변, 또는 둘 다), 어떤 앱과 어떤 모델을 감시할지, 각 확인이 얼마나 과거까지 볼지를 정합니다. 그 아래 미리 보기는 모니터가 지금 이 순간 무엇을 셀지 보여 줍니다. 조건은 세 가지 숫자를 비교합니다. **나쁜 답변 비율**(%), **나쁜 답변 수**, **답변 수**입니다. 기본 제공 알림은 스스로 해결되는 알림을 발생시키고, 답변이 나쁜 동안 모니터를 저하됨으로 표시합니다. 대신 누군가를 호출하려면 인시던트를 켜세요.

지출은 [일일 비용 예산](#일일-비용-예산)이 감시합니다.

## OneUptime이 인식하는 속성

OneUptime은 먼저 OpenTelemetry GenAI 규칙을 읽고, 인기 라이브러리가 바로 동작하도록 OpenLLMetry와 OpenInference 변형으로 대체합니다.

| 항목                         | 기본 속성                    | 함께 허용되는 속성                                                                                                                                                                                                                                                        |
| ---------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 공급자 / 시스템              | `gen_ai.provider.name`       | `gen_ai.system`(규칙에서는 사용 중단됐지만 여전히 널리 전송됨), `llm.system`, `llm.provider`                                                                                                                                                                             |
| 작업                         | `gen_ai.operation.name`      | `llm.request.type`, `openinference.span.kind`                                                                                                                                                                                                                             |
| 요청한 모델                  | `gen_ai.request.model`       | `llm.model_name`, `llm.request.model`                                                                                                                                                                                                                                     |
| 응답한 모델                  | `gen_ai.response.model`      | `llm.response.model`                                                                                                                                                                                                                                                      |
| 입력 토큰                    | `gen_ai.usage.input_tokens`  | `gen_ai.usage.prompt_tokens`, `llm.token_count.prompt`, `llm.usage.prompt_tokens`                                                                                                                                                                                         |
| 출력 토큰                    | `gen_ai.usage.output_tokens` | `gen_ai.usage.completion_tokens`, `llm.token_count.completion`, `llm.usage.completion_tokens`                                                                                                                                                                             |
| 전체 토큰                    | `gen_ai.usage.total_tokens`  | `llm.token_count.total`, `llm.usage.total_tokens`; 아무것도 보고되지 않으면 입력 + 출력으로 계산                                                                                                                                                                         |
| 비용 (USD)                   | `gen_ai.usage.cost`          | `gen_ai.usage.cost_usd`, `gen_ai.usage.total_cost`, `llm.usage.total_cost`, `gen_ai.cost.total_cost`(LiteLLM), `litellm.cost.total`                                                                                                                                       |
| 에이전트 이름                | `gen_ai.agent.name`          | `agent.name`                                                                                                                                                                                                                                                              |
| 도구 이름                    | `gen_ai.tool.name`           | `tool.name`                                                                                                                                                                                                                                                               |
| 대화 / 세션 ID               | `gen_ai.conversation.id`     | `session.id`, `langfuse.session.id`, `traceloop.association.properties.session_id`                                                                                                                                                                                        |
| 직원(호출을 실행한 사람)     | `user.id`                    | `enduser.id`, `litellm.metadata.user_api_key_user_id`와 `metadata.user_api_key_user_id`(LiteLLM OTel v2와 v1 표기 — 둘 다 읽음), `traceloop.association.properties.user_id`, `langfuse.user.id`, `user.account_uuid`, `user.account_id`, `cursor.user.id` |
| 직원 이메일                  | `user.email`                 | `traceloop.association.properties.user_email`, `enduser.email`                                                                                                                                                                                                            |
| 팀 / 비용 센터               | `team.id`                    | `team`, `cost_center`, `department`, `litellm.metadata.user_api_key_team_id`와 `litellm.team.id`(LiteLLM OTel v2), `metadata.user_api_key_team_id`(LiteLLM OTel v1), `cursor.team.id`                                                                                    |

`traceloop.association.properties.*`의 하위 키는 **호출하는 쪽이 정합니다**. Traceloop이 접두사를 정의하고, 그 아래에 무엇이 들어갈지는 여러분의 코드가 정합니다. `gen_ai.usage.total_tokens`와 `gen_ai.usage.cost`는 GenAI 시맨틱 규칙이 아닌 **사실상의 표준** 키입니다. 규칙에는 전체 토큰 속성도 비용 속성도 없지만, 흔히 쓰는 계측이 이 키들을 내보내기 때문에 OneUptime이 읽습니다. `gen_ai.system`은 규칙 자체에서 사용 중단된 `gen_ai.provider.name`의 이전 이름이며, 둘 다 읽습니다.

**세 개의 신원 행은 `resource.` 접두사로도 매칭됩니다.** OTLP 수집은 모든 _리소스_ 속성을 `resource.` 접두사 아래 스팬의 속성 맵으로 펼치므로, `OTEL_RESOURCE_ATTRIBUTES=team.id=platform`은 `resource.team.id`로 도착합니다. OneUptime은 먼저 접두사 없는 목록 전체를, 그다음 `resource.` 목록 전체를 찾으므로 스팬 속성(호출 하나를 설명)이 리소스 속성(프로세스 전체를 설명)보다 우선합니다. 나머지 행은 접두사 없는 키로만 매칭합니다. 호출마다 다른 값이기 때문입니다.

**프롬프트와 응답 내용**은 다음에서 읽습니다. `gen_ai.client.inference.operation.details` 이벤트, 스팬 속성 `gen_ai.input.messages`, `gen_ai.output.messages`, `gen_ai.system_instructions`, 오래된 계측이 아직 내보내는 **사용 중단된** 역할별 이벤트(`gen_ai.system.message`, `gen_ai.user.message`, `gen_ai.tool.message`, `gen_ai.assistant.message`, `gen_ai.choice`), 인덱스가 붙은 속성(`gen_ai.prompt.N.content`와 `gen_ai.completion.N.content`, OpenInference의 `llm.input_messages.N.message.content`와 `llm.output_messages.N.message.content`), 그리고 JSON 메시지 배열(`gen_ai.prompt`, `gen_ai.completion`, `input.value`, `output.value`)입니다.

### 비용 계산 방식

계측이 비용(`gen_ai.usage.cost`)을 보고하면 OneUptime은 그 값을 그대로 씁니다. 보고된 값이 항상 우선합니다. 비용이 보고되지 않으면 OneUptime은 스팬의 토큰 수와, OpenAI, Anthropic, Google Gemini, Mistral, DeepSeek, xAI, Cohere, Amazon Nova, Meta Llama의 일반 모델 정가를 담은 내장 카탈로그로 **수집 시점의 추정 비용**을 계산합니다. 모델은 이름 접두사로 매칭되므로 `gpt-4o-2024-08-06` 같은 날짜가 붙은 스냅샷이나 `us.anthropic.claude-3-5-sonnet-20241022-v2:0` 같은 공급업체 표기가 붙은 ID도 올바르게 찾습니다. 알 수 없거나 사용자 지정 모델은 절대 추측하지 않습니다. **가격** 탭에서 가격을 지정할 때까지 비용은 `0`으로 남습니다. 추정에는 정가를 쓰며 캐시나 배치 할인은 반영하지 않습니다.

OneUptime을 직접 호스팅하나요? 카탈로그는 `packages/Common/Types/Telemetry/LlmCostCatalog.ts`에 있습니다.

## 직원 및 팀 귀속

"지난달 Opus에 4,000달러를 쓴 엔지니어는 누구인가"는 사람에 관한 질문이며, 스팬에 누군가를 가리키는 정보가 없으면 어떤 LLM 스팬도 답할 수 없습니다. OneUptime은 수집할 때 사람 행위자를 조회 가능한 열로 복사하므로, 속성 조회식을 쓰는 대신 열로 그룹화하고 필터링하면 됩니다.

위 표의 세 신원 행이 이 메커니즘의 전부입니다. 나열된 순서대로 처음 발견된 키가 사용됩니다. `user.id`가 맨 앞인 이유는 사람 행위자를 나타내는 OpenTelemetry의 표준 키이고, 신원을 직접 설정한다면 기준으로 삼아야 할 키이기 때문입니다. **예외가 하나 있습니다. Claude Code**는 `user.id`를 사람이 아니라 `~/.claude.json`에 저장된 임의의 익명 식별자로 내보냅니다. 이메일을 먼저 보는 메트릭 데이터 포인트에서는 문제가 없지만, Claude Code의 트레이스 베타를 켜면 스팬에서 익명 `user.id`가 `user.email`보다 우선합니다. 그 장비 그룹에서는 컬렉터 프로세서에서 `user.id`를 제거하거나 다시 매핑하세요. `enduser.id`는 여전히 유효한 시맨틱 규칙 속성이며 동등한 별칭으로 허용됩니다. `cursor.user.id`가 마지막인 이유는 팀 범위의 불투명한 정수라서 사람으로 확인하려면 Cursor의 관리자 API가 필요하기 때문입니다.

신원은 이미 LLM 호출로 인식된 스팬에서만 읽습니다. `user.id`, `user.email`, `team.id`는 브라우저와 일반 백엔드 스팬도 가지는 범용 키이기 때문입니다. **메트릭 데이터 포인트**는 이메일을 먼저 보는 더 짧은 목록을 가집니다. `user.email`, `user.id`, `user.account_uuid`, `user.account_id`, `cursor.user.id`이고, 팀은 `team.id`, `team`, `cost_center`, `department`, `cursor.team.id`에서 읽으며, 각각 `resource.` 접두사로도 매칭합니다. 스팬 없이 메트릭을 내보내는 코딩 에이전트 CLI가 `user.email`을 기본으로 내보내기 때문입니다. 현재 **로그 레코드**에서 신원을 읽는 기능은 없습니다.

### 팀과 비용 센터 설정하기

`team.id`, `team`, `cost_center`, `department`를 내보내는 계측은 없습니다. 조직에서 직접 설정하며, 보통 프로세스의 `OTEL_RESOURCE_ATTRIBUTES`로 설정합니다.

```bash
export OTEL_RESOURCE_ATTRIBUTES="team.id=platform,team=Platform_Engineering,cost_center=eng-123,department=engineering"
```

이 값들은 `resource.team.id`, `resource.team`, `resource.cost_center`, `resource.department`로 OneUptime에 도착하며, 익스포터가 키를 OTLP 리소스 블록에 두든 각 스팬에 복사하든(Claude Code는 후자) 두 계층 모두 스팬과 메트릭 데이터 포인트에서 인식됩니다. 스팬에 직접 설정한 접두사 없는 `team.id`가 여전히 우선합니다.

게이트웨이 표기는 별도 설정 없이 들어옵니다. LiteLLM은 두 가지 OpenTelemetry 모드에서 속성 이름을 다르게 붙입니다. 기본 v1 `otel` 콜백은 접두사 `metadata.`만 쓰고(`metadata.user_api_key_user_id`, `metadata.user_api_key_user_email`, `metadata.user_api_key_team_id`), 선택형 v2 모드(`LITELLM_OTEL_V2=true`)는 `litellm.` 네임스페이스를 씁니다. **OneUptime은 둘 다 읽습니다**.

### 고객 키는 의도적으로 제외합니다

LLM 스팬에는 **두** 사람이 담길 수 있습니다. 호출을 실행한 직원과, 그 호출의 대상인 다운스트림 **고객**입니다. 다음 키는 고객을 나타내므로 OneUptime은 의도적으로 이 중 **어느 것도** 신원 열에 읽어 들이지 않습니다.

- `gen_ai.user`와 `llm.user` — 계측이 OpenAI의 요청 매개변수 `user`를 그대로 옮긴 것입니다. OpenAI는 이를 "a stable identifier for your end-users"라고 설명합니다(현재는 사용 중단되어 `safety_identifier`와 `prompt_cache_key`로 대체됨).
- `litellm.metadata.user_api_key_end_user_id`, `metadata.user_api_key_end_user_id`, `litellm.end_user.id` — 세 가지 표기 모두에서의 LiteLLM 명시적 최종 사용자 ID입니다. 키 소유자 ID와는 다르며, 키 소유자 ID는 **바로** 직원이므로 **읽습니다**.

이유는 비용 배분의 정확성입니다. 고객 ID를 직원 열에 읽어 들이면 고객 40,000명을 상대하는 지원 봇이 가짜 "직원" 40,000명을 만들고, 정작 그 지출의 주인인 엔지니어는 아무것도 쓰지 않은 것처럼 보입니다. 이 속성들은 원시 속성 맵에 남아 있으므로 직접 조회할 수 있습니다.

### 신원 열은 스크럽됩니다

직원 이메일 열에는 실제 개인 데이터가 담깁니다. **속성** 범위의 텔레메트리 **스크럽 규칙**은 이 열을 원래 읽어 온 속성과 똑같이 적용하므로, 이메일을 가리는 규칙이 열에도 적용됩니다. 스크럽 규칙과 드롭 필터는 **트레이스 → 설정**에서 구성합니다.

## 스팬과 메트릭은 합산이 아니라 대체입니다

**GenAI 스팬이 기준입니다. 메트릭 스트림은 스팬 스트림이 아무것도 보고하지 않았을 때만 참고하며, 두 값을 더하지 않습니다.** 스팬은 모델, 토큰, 비용을 한 행에 담으므로 스팬이 있으면 어떤 질문에도 답합니다. 스팬이 없으면(코딩 에이전트 CLI는 토큰과 비용 _메트릭_ 을 게시하고 GenAI 스팬은 보내지 않습니다) 메트릭 스트림이 대신합니다. 많은 계측이 같은 호출에 대해 두 신호를 모두 내보내므로(OpenLLMetry가 흔한 예입니다) 더하면 모든 달러가 두 번 계산됩니다. 그래서 합산하지 않습니다.

염두에 둘 결과: **GenAI 스팬이 0이 아닌 값을 보고하면, 메트릭만 보내는 소스가 그 값에 기여한 부분은 나타나지 않습니다.** 대체는 보내는 쪽별이 아니라 값별, 분류별로 적용됩니다.

| 위치                                       | 메트릭으로 대체되는 항목                                 | 조건                                    |
| ------------------------------------------ | -------------------------------------------------------- | --------------------------------------- |
| 사용량 → 입력 토큰 / 출력 토큰             | 입력 토큰과 출력 토큰 합계                               | 스팬의 토큰 합계가 둘 다 0              |
| 사용량 → 비용 (USD)                        | 비용(USD와 마이크로 USD를 환산해 더한 값)                | 스팬의 비용 합계가 0                    |
| 사용량 → LLM 호출                          | 없음 — 스팬만                                            | —                                       |
| 사용량 → 직원, 팀, 모델                    | 비용만. 호출과 토큰 열은 `—`로 표시                      | 해당 분류에서 스팬 행이 하나도 없음     |
| 사용량 → 공급자, 애플리케이션 / 서비스     | 없음 — 스팬만                                            | —                                       |
| 대화                                       | 없음 — 대화는 스팬으로 만듦                              | —                                       |

공급자와 애플리케이션 / 서비스에 메트릭 대체가 없는 이유는 코딩 에이전트 카운터에 GenAI 공급자 속성이 없고 OneUptime 텔레메트리 서비스에도 연결되어 있지 않기 때문입니다. 값이 메트릭에서 왔다면 페이지는 그 값에 **GenAI 메트릭 기준**이라는 레이블을 붙입니다. 메트릭에서 온 값은 호출 목록에 대응하는 행이 없기 때문입니다.

**메트릭만 보내는 도구의 지출을 따로 보려면 그 도구에 별도의 프로젝트를 주세요.** 그래야 스팬 스트림이 정말로 비어 있게 되어 대체가 동작합니다. 예산도 마찬가지입니다. 스팬을 보내는 서비스와 메트릭만 보내는 서비스를 섞지 말고 서비스마다 예산을 하나씩 설정하세요.

## 대시보드와 메트릭 알림

GenAI 메트릭은 일반 OpenTelemetry 메트릭으로 들어오므로 `gen_ai.client.token.usage`, `gen_ai.client.operation.duration` 등을 그래프로 보여 주는 **대시보드**를 만들고, 그 위에 **메트릭 모니터**를 만들 수 있습니다. 예를 들어 `gen_ai.client.operation.duration`의 p95가 모델별로 임곗값을 넘을 때입니다. [메트릭 모니터](/docs/monitor/metrics-monitor)를 참고하세요.

## 일일 비용 예산

**예산** 탭은 UTC 하루 기준으로 평가되는 일일 USD 한도를 설정합니다. 15분마다 백그라운드 워커가 그날의 LLM 스팬 비용(보고된 값 또는 계산된 값)을 합산해 예산에 기록하고 두 가지 게이지 메트릭을 게시합니다.

| 메트릭                              | 의미                                       |
| ----------------------------------- | ------------------------------------------ |
| `oneuptime.llm.budget.spend.usd`    | 지금까지의 당일 지출(USD)                  |
| `oneuptime.llm.budget.percent.used` | 일일 한도 대비 지출 비율(%)                |

둘 다 `oneuptime.llm.budget.id`와 `oneuptime.llm.budget.name` 속성을 가지며, 예산에 서비스, 공급자, 모델 범위가 설정되어 있으면 그것도 가집니다. 모니터는 변하지 않는 **`oneuptime.llm.budget.id`** 기준으로 필터링하세요. 이름은 예산 이름을 바꾸면 바뀝니다.

**알림은 이 메트릭에 대한 [메트릭 모니터](/docs/monitor/metrics-monitor)로 설정합니다.** 흔히 쓰는 80% / 100% 패턴이라면 `oneuptime.llm.budget.percent.used`에 대한 모니터를 만들고 `oneuptime.llm.budget.id`로 필터링한 뒤 두 조건을 추가하세요. `>= 80`은 경고 알림을, `>= 100`은 심각 알림을 만듭니다. **모니터의 롤링 시간은 30분으로 설정하세요.** 예산은 15분마다 점 하나를 게시하므로, 기본값인 1분 창으로는 집계 사이에 빈 계열만 보게 됩니다.

예산은 텔레메트리 서비스, LLM 공급자, 특정 모델로 범위를 좁히거나 프로젝트 전체에 적용할 수 있으며, 여러 예산을 함께 둘 수 있습니다. 예산 모니터는 폭주하는 에이전트를 멈추는 워크플로를 호출할 수도 있습니다. [폭주하는 AI 에이전트를 위한 서킷 브레이커](/docs/telemetry/ai-agent-circuit-breaker)를 참고하세요.

## 개인정보 보호와 마스킹

프롬프트와 응답에는 민감한 데이터가 들어 있을 수 있습니다. OneUptime은 다른 트레이스와 마찬가지로 텔레메트리 **스크럽 규칙**과 **드롭 필터**를 LLM 스팬에 적용하므로, 저장 전에 속성을 가리거나 스팬을 버릴 수 있습니다. 이는 **트레이스 → 설정**에서 구성합니다. 직원 이메일 열에도 같은 규칙이 적용됩니다. [신원 열은 스크럽됩니다](#신원-열은-스크럽됩니다)를 참고하세요.

대화는 트레이스와 같은 권한으로 읽습니다. 프로젝트의 트레이스를 읽을 수 있는 사람은 대화도 읽을 수 있고, 그 밖의 사람은 읽을 수 없습니다.

## 관련 문서

- [AI 코딩 어시스턴트 옵저버빌리티](/docs/telemetry/ai-coding-assistants) — Claude Code, Cursor, Codex, Gemini CLI, Copilot, Cline 등의 지원 매트릭스와, 이들 사이에서 직원별 지출이 어떻게 동작하는지.
- [Claude Code 모니터링](/docs/telemetry/claude-code)
- [Cursor 모니터링](/docs/telemetry/cursor)
- [OpenAI Codex CLI 모니터링](/docs/telemetry/openai-codex)
- [Gemini CLI 및 GitHub Copilot 모니터링](/docs/telemetry/gemini-cli-and-copilot)
- [AI 게이트웨이 관측(LiteLLM 및 Portkey)](/docs/telemetry/ai-gateways)
- [폭주하는 AI 에이전트를 위한 서킷 브레이커](/docs/telemetry/ai-agent-circuit-breaker)
