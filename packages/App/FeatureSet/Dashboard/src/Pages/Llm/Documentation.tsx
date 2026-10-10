import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import React, { FunctionComponent, ReactElement } from "react";
import TelemetryDocumentation from "../../Components/Telemetry/Documentation";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";

/*
 * Setting up AI / LLM observability, as the steps a team takes: send the
 * AI calls, record what was said, group calls into conversations, say who
 * asked, flag bad answers - each step names the attribute it needs and what
 * it unlocks in the product. The full guide, with code for each library,
 * is the docs page.
 */

export const LLM_DOCS_URL: string = "/docs/telemetry/ai-llm-observability";

interface SetupStep {
  key: string;
  title: string;
  body: ReactElement;
}

const Attribute: FunctionComponent<{ name: string }> = (props: {
  name: string;
}): ReactElement => {
  return (
    <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-xs text-gray-800">
      {props.name}
    </code>
  );
};

const LlmDocumentationPage: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const scrubRulesRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.TRACES_SETTINGS_SCRUB_RULES] as Route,
  );
  const dropFiltersRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.TRACES_SETTINGS_DROP_FILTERS] as Route,
  );

  const steps: Array<SetupStep> = [
    {
      key: "send",
      title: "Send your AI calls",
      body: (
        <TranslatedSentence
          template="OneUptime understands the OpenTelemetry GenAI semantic conventions ({{attributes}}). Instrument your app with any GenAI OpenTelemetry library, for example {{openLlmetry}}, {{openInference}}, the Vercel AI SDK, or the OpenTelemetry instrumentations for OpenAI, Anthropic and Gemini. Then point its OTLP exporter at OneUptime with the settings below."
          slots={{
            attributes: <Attribute name="gen_ai.*" />,
            openLlmetry: <span className="font-medium">OpenLLMetry</span>,
            openInference: <span className="font-medium">OpenInference</span>,
          }}
        />
      ),
    },
    {
      key: "record",
      title: "Record what was said",
      body: (
        <TranslatedSentence
          template="Conversations show what people asked and what the AI answered when your instrumentation records them. The OpenTelemetry instrumentations record them with {{captureSetting}}; OpenLLMetry records them unless you turn it off. Without them, a conversation still shows its timing, cost and problems."
          slots={{
            captureSetting: (
              <Attribute name="OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT=true" />
            ),
          }}
        />
      ),
    },
    {
      key: "group",
      title: "Group calls into conversations",
      body: (
        <TranslatedSentence
          template="Set {{conversationId}} (or {{sessionId}}) to your chat's id on every AI call, and each chat shows as one conversation you can replay. Calls without one show one request at a time."
          slots={{
            conversationId: <Attribute name="gen_ai.conversation.id" />,
            sessionId: <Attribute name="session.id" />,
          }}
        />
      ),
    },
    {
      key: "person",
      title: "Say who asked",
      body: (
        <TranslatedSentence
          template="Set {{userId}} or {{userEmail}} to see who each conversation was with, and to search by person."
          slots={{
            userId: <Attribute name="user.id" />,
            userEmail: <Attribute name="user.email" />,
          }}
        />
      ),
    },
    {
      key: "flag",
      title: "Flag bad answers",
      body: (
        <TranslatedSentence
          template="Failed, refused, cut-off and empty answers are found for you. To flag the rest, send a {{evaluationEvent}} event with {{labelAttribute}} set to fail from your guardrails, your evals or a thumbs-down button. Flagged answers are marked in conversations, and an AI alert can tell you about them."
          slots={{
            evaluationEvent: <Attribute name="gen_ai.evaluation.result" />,
            labelAttribute: <Attribute name="gen_ai.evaluation.score.label" />,
          }}
        />
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div
        className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
        data-testid="llm-setup-steps"
      >
        <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-900">
              {translator.translateText("Set up AI observability")}
            </h2>
            <p className="mt-1 text-sm text-gray-600">
              {translator.translateText(
                "Five steps. The first is all you need to start; each one after it shows more.",
              )}
            </p>
          </div>
          <a
            href={LLM_DOCS_URL}
            target="_blank"
            rel="noreferrer"
            className="inline-flex flex-shrink-0 items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700"
          >
            <Icon icon={IconProp.Book} className="h-4 w-4" />
            <span>{translator.translateText("Read the full guide")}</span>
          </a>
        </div>
        <ol className="mt-5 space-y-4">
          {steps.map((step: SetupStep, index: number) => {
            return (
              <li
                key={step.key}
                className="flex items-start gap-3"
                data-testid={`llm-setup-step-${step.key}`}
              >
                <div
                  className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-indigo-50 text-xs font-semibold text-indigo-700"
                  aria-hidden="true"
                >
                  {index + 1}
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-gray-900">
                    {translator.translateText(step.title)}
                  </div>
                  <div className="mt-1 text-sm leading-6 text-gray-600">
                    {step.body}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </div>

      <div className="rounded-lg border border-amber-100 bg-amber-50/50 p-5 shadow-sm">
        <h2 className="text-base font-semibold text-gray-900">
          {translator.translateText(
            "Control what prompt & completion content is stored",
          )}
        </h2>
        <p className="mt-2 text-sm text-gray-600">
          <TranslatedSentence
            template="LLM calls are ingested as OpenTelemetry trace spans, so the trace pipeline's privacy controls apply to them directly. Prompts and completions can carry sensitive data — use {{scrubRules}} to mask or redact attribute values before they are stored, or {{dropFilters}} to drop matching spans entirely. These rules govern every trace span, including the {{attributes}} spans shown here."
            slots={{
              scrubRules: (
                <Link
                  to={scrubRulesRoute}
                  className="font-medium text-indigo-600 underline"
                >
                  {translator.translateText("Traces → Settings → Scrub Rules")}
                </Link>
              ),
              dropFilters: (
                <Link
                  to={dropFiltersRoute}
                  className="font-medium text-indigo-600 underline"
                >
                  {translator.translateText("Traces → Settings → Drop Filters")}
                </Link>
              ),
              attributes: <code className="font-mono text-xs">gen_ai.*</code>,
            }}
          />
        </p>
      </div>

      <TelemetryDocumentation telemetryType="traces" />
    </div>
  );
};

export default LlmDocumentationPage;
