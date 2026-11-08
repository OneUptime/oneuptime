import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The snippets that send an app's AI calls to OneUptime, one per way an app
 * is built - each for OpenAI and for Azure OpenAI and Microsoft Foundry
 * alike, since the same SDKs call both:
 *
 *   - Python and Node.js: OpenLLMetry, which traces the openai package's
 *     OpenAI and AzureOpenAI clients (and Anthropic, Bedrock, Vertex AI,
 *     LangChain, LlamaIndex) and records prompts and answers on the spans;
 *   - .NET: the OpenAI library's own OpenTelemetry (the OpenAI and
 *     Azure.AI.OpenAI packages), switched on, exported with OTLP;
 *   - Java: the OpenTelemetry Java agent, which traces the OpenAI Java SDK;
 *   - any other GenAI instrumentation: the OpenTelemetry variables;
 *   - a gateway (LiteLLM) for traffic that already goes through one.
 *
 * <ONEUPTIME_OTLP_URL> and <ONEUPTIME_TOKEN> are filled in with the
 * project's endpoint and the ingestion key picked above them. The code is
 * not translated; the titles and notes are. Every package, switch and
 * variable here is as its project documents it (the PR that added .NET and
 * Java cites each one).
 */

export type LlmAppsSnippetKey =
  | "python"
  | "node"
  | "dotnet"
  | "java"
  | "otel"
  | "gateway";

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

// The OpenTelemetry variables every OTLP exporter reads.
const OTEL_EXPORTER_VARIABLES: string = `export OTEL_EXPORTER_OTLP_ENDPOINT="${OTLP_URL_PLACEHOLDER}"
export OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=${TOKEN_PLACEHOLDER}"
export OTEL_EXPORTER_OTLP_PROTOCOL="http/protobuf"
export OTEL_SERVICE_NAME="my-ai-app"`;

export const LLM_APPS_SNIPPETS: Array<LlmAppsSnippet> = [
  {
    key: "python",
    title: translationKey("Python"),
    note: translationKey(
      "OpenLLMetry traces OpenAI, Azure OpenAI and Microsoft Foundry (the openai package's OpenAI and AzureOpenAI clients), Anthropic, Bedrock, Vertex AI, LangChain and LlamaIndex calls, prompts and answers included.",
    ),
    blocks: [
      { language: "bash", code: "pip install traceloop-sdk" },
      {
        language: "python",
        code: `from openai import AzureOpenAI, OpenAI
from traceloop.sdk import Traceloop

Traceloop.init(
    app_name="my-ai-app",
    api_endpoint="${OTLP_URL_PLACEHOLDER}",
    headers={"x-oneuptime-token": "${TOKEN_PLACEHOLDER}"},
)

# OpenAI, or Azure OpenAI and Microsoft Foundry: traced the same way.
client = OpenAI()
# client = AzureOpenAI(azure_endpoint="https://YOUR-RESOURCE.openai.azure.com", api_version="2024-10-21")

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
      "OpenLLMetry traces OpenAI, Azure OpenAI and Microsoft Foundry (the openai package's OpenAI and AzureOpenAI clients), Anthropic, Bedrock, Vertex AI and LangChain calls, prompts and answers included.",
    ),
    blocks: [
      { language: "bash", code: "npm install @traceloop/node-server-sdk" },
      {
        language: "typescript",
        code: `import * as traceloop from "@traceloop/node-server-sdk";
import OpenAI, { AzureOpenAI } from "openai";

traceloop.initialize({
  appName: "my-ai-app",
  baseUrl: "${OTLP_URL_PLACEHOLDER}",
  headers: { "x-oneuptime-token": "${TOKEN_PLACEHOLDER}" },
  instrumentModules: { openAI: OpenAI },
});

// OpenAI, or Azure OpenAI and Microsoft Foundry: traced the same way.
const client = new OpenAI();
// const client = new AzureOpenAI({ endpoint: "https://YOUR-RESOURCE.openai.azure.com", apiVersion: "2024-10-21" });`,
      },
    ],
  },
  {
    key: "dotnet",
    // As the telemetry guides' language picker names it.
    title: translationKey(".NET / C#"),
    note: translationKey(
      "The OpenAI and Azure.AI.OpenAI libraries trace their calls, to OpenAI, Azure OpenAI and Microsoft Foundry, once their OpenTelemetry switch is on. They record no prompts or answers: apps on Microsoft.Extensions.AI record them with UseOpenTelemetry and EnableSensitiveData.",
    ),
    blocks: [
      {
        language: "bash",
        code: `dotnet add package OpenTelemetry.Extensions.Hosting
dotnet add package OpenTelemetry.Exporter.OpenTelemetryProtocol`,
      },
      {
        language: "csharp",
        code: `using OpenTelemetry.Metrics;
using OpenTelemetry.Trace;

// Before any OpenAI or Azure OpenAI client is created:
AppContext.SetSwitch("OpenAI.Experimental.EnableOpenTelemetry", true);

builder.Services.AddOpenTelemetry()
    .WithTracing(tracing => tracing.AddSource("OpenAI.*").AddOtlpExporter())
    .WithMetrics(metrics => metrics.AddMeter("OpenAI.*").AddOtlpExporter());`,
      },
      { language: "bash", code: OTEL_EXPORTER_VARIABLES },
    ],
  },
  {
    key: "java",
    title: translationKey("Java"),
    note: translationKey(
      "The OpenTelemetry Java agent traces the OpenAI Java SDK, calling OpenAI or Azure OpenAI. It sends prompts and answers as log events, which conversations do not show: each call arrives with its model, tokens and cost.",
    ),
    blocks: [
      {
        language: "bash",
        code: `curl -L -O https://github.com/open-telemetry/opentelemetry-java-instrumentation/releases/latest/download/opentelemetry-javaagent.jar

${OTEL_EXPORTER_VARIABLES}

java -javaagent:opentelemetry-javaagent.jar -jar my-ai-app.jar`,
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
        code: `${OTEL_EXPORTER_VARIABLES}
# Record prompts and answers, so conversations show what was said
# (Python's OpenTelemetry instrumentations take span_only instead of true):
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
