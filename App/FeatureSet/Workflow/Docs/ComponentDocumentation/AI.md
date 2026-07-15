# Generate Text with AI

This component sends one prompt to the LLM provider configured for the project and returns generated text. Use it for bounded tasks such as summarizing an incident payload, classifying a message, drafting an internal update, or extracting a short explanation from explicitly selected workflow data.

The request is tool-free: it contains no tool definitions or provider-native capability fields. Through this component, the model cannot look up project records, query telemetry, call an external API, or change anything in OneUptime. Besides OneUptime's fixed component-safety instruction, it receives only the inputs you configure on this component. The fixed instruction tells the model to treat everything after the Context marker through the end of the message as untrusted data and not to claim actions or access it did not have. The configured provider and model remain an administrator trust boundary; if you require strictly offline generation, select a model without intrinsic provider-managed retrieval.

## Before you use it

- AI must be enabled for the project. On OneUptime Cloud, the subscription must be paid and the Growth plan (or a plan that includes Growth features) is required. Self-hosted installations with billing disabled do not have this plan gate.
- Configure a provider under **Project Settings → AI → LLM Providers**. The project default is used first; an installation-wide global provider is the fallback when available.
- On OneUptime Cloud, a costed global provider consumes the project's AI credit balance. Project-owned providers use the credentials configured for that provider.
- The call counts toward the project's daily autonomous AI token budget and appears in **Project Settings → AI → AI Logs**.

You do not supply a provider key, model endpoint, or provider choice in the component. Provider configuration stays centralized so credentials never become workflow arguments.

Provider-level additional parameters remain available through an allowlist of generation-only tuning fields. Capability and retention fields are dropped: they cannot replace this component's messages, inject tools or provider-native web search/data sources, enable non-text modalities, request multiple choices, enable streaming, retain the request through provider storage flags, or raise its output-token cap. Unknown future capability fields are dropped by default. This request filtering cannot change capabilities intrinsic to the configured model, which is why provider/model approval remains important.

## Inputs

### Prompt

Required. Describe the single task the model should perform. You can insert global variables or values returned by earlier workflow components.

Keep the instruction specific and state the expected format. For example:

```text
Write a three-sentence internal incident update. State only facts present in the context. If a cause is not known, say that it is still under investigation.
```

### System Instructions

Optional. Set stable behavior such as role, tone, audience, or constraints. Do not put changing incident or alert data here; place that data in Context instead.

### Context

Optional JSON appended after an explicit marker as untrusted context through the end of the user message. Include only the fields the task needs. The component does not automatically attach trigger data, previous component outputs, workflow history, project records, telemetry, or secrets.

For example:

```json
{
  "title": "{{local.components.incident-trigger.returnValues.title}}",
  "description": "{{local.components.incident-trigger.returnValues.description}}",
  "severity": "{{local.components.incident-trigger.returnValues.severity}}"
}
```

Use the component-value picker in the editor so `incident-trigger` is replaced by the actual component ID from your workflow. Variables are resolved before the request is sent. Referencing a secret in Prompt, System Instructions, or Context therefore sends its resolved value to the provider; do this only when the provider is approved to receive it.

### Temperature

Optional, from `0` to `1`. The default is `0.2`. Lower values are usually better for repeatable workflow output; raise it only when variation is useful.

### Maximum Output Tokens

Optional, from `1` to `4096`. The default is `1024`. Set the smallest useful limit to control latency and cost.

System Instructions, Prompt, and the serialized Context have a combined 50,000-character limit. The provider request is attempted once and times out after at most 60 seconds. At most three workflow AI calls can run concurrently per project; a call that cannot obtain a slot follows the Error path so a later run can retry safely.

## Outputs

| Output | Description |
|---|---|
| **Response** | Generated text returned by the model. |
| **Provider** | Name of the LLM provider used for the call. |
| **Model** | Configured model name used for the call. |
| **Total Tokens** | Input plus output tokens reported by the provider. |
| **Completion Tokens** | Output tokens reported by the provider. |
| **LLM Log ID** | ID of the metered AI log entry for this call. |
| **Error** | Error message when the component takes the Error path. |

The **Success** port runs after the provider returns successfully. Use the component-value picker in a downstream field to insert the Response. The resulting reference has the form `{{local.components.<component-id>.returnValues.response}}`.

The **Error** port runs when input validation, project or plan access, provider configuration, the daily token budget, AI credit balance, the concurrency limit, the provider request, or the timeout check fails. Connect it to a safe fallback, notification, or log component; an unconnected Error path stops that branch of the workflow.

## Data, logs, and billing

The resolved System Instructions, Prompt, and Context are the request's explicit egress. A hosted provider receives those values; a local self-hosted provider such as Ollama can keep them inside your infrastructure.

System Instructions, Prompt, Context, and generated Response values are redacted from this AI component's own argument and return-value entries in the automatic workflow execution log. They remain available to downstream components during the run. If you insert one into another component, that component's logging policy applies and may record the resolved value; treat reuse as an explicit disclosure. The LLM log stores operational metadata and usage, but not prompt or response previews or raw provider error details. Raw provider error bodies are also excluded from application logs and traces. Provider/model names, token counts, the LLM Log ID, and safe errors remain visible so a run can be diagnosed and billed.

Every call is metered. A costed global provider deducts the calculated usage from the project's AI credit balance. The workflow call is also covered by the daily autonomous AI token budget; once that budget is exhausted, the component follows Error without making another provider request.

## Safe use

Model output is untrusted text. Review customer-facing drafts, and do not connect free-form text directly to a destructive action as its only authorization. If the output must control a branch, constrain the prompt to a small set of allowed values and validate the response with deterministic workflow logic before taking action.
