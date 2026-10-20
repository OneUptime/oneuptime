import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The snippets that send an app's AI calls to OneUptime: OpenLLMetry for
 * Python and Node.js (it instruments OpenAI, Anthropic, Bedrock, Vertex AI,
 * LangChain and LlamaIndex with one line), the OpenTelemetry variables for
 * any other GenAI instrumentation, and a gateway (LiteLLM) for traffic
 * that already goes through one.
 *
 * <ONEUPTIME_OTLP_URL> and <ONEUPTIME_TOKEN> are filled in with the
 * project's endpoint and the ingestion key picked above them. The code is
 * not translated; the titles and notes are.
 */

export type LlmAppsSnippetKey = "python" | "node" | "otel" | "gateway";

export interface LlmAppsSnippetBlock {
  language: string;
  code: string;
}

export interface LlmAppsSnippet {
  key: LlmAppsSnippetKey;
  title: string;
  note: string;
  blocks: Array<LlmAppsSnippetBlock>;
}

export const OTLP_URL_PLACEHOLDER: string = "<ONEUPTIME_OTLP_URL>";
export const TOKEN_PLACEHOLDER: string = "<ONEUPTIME_TOKEN>";

export const LLM_APPS_SNIPPETS: Array<LlmAppsSnippet> = [
  {
    key: "python",
    title: translationKey("Python"),
    note: translationKey(
      "OpenLLMetry traces OpenAI, Anthropic, Bedrock, Vertex AI, LangChain and LlamaIndex calls, prompts and answers included.",
    ),
    blocks: [
      { language: "bash", code: "pip install traceloop-sdk" },
      {
        language: "python",
        code: `from traceloop.sdk import Traceloop

Traceloop.init(
    app_name="my-ai-app",
    api_endpoint="${OTLP_URL_PLACEHOLDER}",
    headers={"x-oneuptime-token": "${TOKEN_PLACEHOLDER}"},
)

# Optional: group calls into conversations and say who asked.
Traceloop.set_association_properties({
    "session_id": chat.id,
    "user_email": user.email,
})`,
      },
    ],
  },
  {
    key: "node",
    title: translationKey("Node.js"),
    note: translationKey(
      "OpenLLMetry traces OpenAI, Anthropic, Bedrock, Vertex AI and LangChain calls, prompts and answers included.",
    ),
    blocks: [
      { language: "bash", code: "npm install @traceloop/node-server-sdk" },
      {
        language: "typescript",
        code: `import * as traceloop from "@traceloop/node-server-sdk";

traceloop.initialize({
  appName: "my-ai-app",
  baseUrl: "${OTLP_URL_PLACEHOLDER}",
  headers: { "x-oneuptime-token": "${TOKEN_PLACEHOLDER}" },
});`,
      },
    ],
  },
  {
    key: "otel",
    title: translationKey("Any language"),
    note: translationKey(
      "For OpenInference, the Vercel AI SDK, OpenLIT or the OpenTelemetry instrumentations for OpenAI, Anthropic and Gemini: set these on the app.",
    ),
    blocks: [
      {
        language: "bash",
        code: `export OTEL_EXPORTER_OTLP_ENDPOINT="${OTLP_URL_PLACEHOLDER}"
export OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=${TOKEN_PLACEHOLDER}"
export OTEL_EXPORTER_OTLP_PROTOCOL="http/protobuf"
export OTEL_SERVICE_NAME="my-ai-app"
# Record prompts and answers, so conversations show what was said:
export OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true`,
      },
    ],
  },
  {
    key: "gateway",
    title: translationKey("Through a gateway"),
    note: translationKey(
      "Every app behind a LiteLLM proxy, without instrumenting each one. Portkey and OpenRouter can send their traces too: see the gateways guide.",
    ),
    blocks: [
      {
        language: "yaml",
        code: `# LiteLLM proxy: config.yaml
litellm_settings:
  callbacks: ["otel"]`,
      },
      {
        language: "bash",
        code: `export OTEL_EXPORTER="otlp_http"
export OTEL_ENDPOINT="${OTLP_URL_PLACEHOLDER}/v1/traces"
export OTEL_HEADERS="x-oneuptime-token=${TOKEN_PLACEHOLDER}"`,
      },
    ],
  },
];

// A snippet's code with the project's endpoint and key in it.
export function fillLlmAppsSnippet(
  code: string,
  data: { otlpUrl: string; token: string },
): string {
  return code
    .split(OTLP_URL_PLACEHOLDER)
    .join(data.otlpUrl)
    .split(TOKEN_PLACEHOLDER)
    .join(data.token);
}
