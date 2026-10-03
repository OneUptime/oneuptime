import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import Link from "Common/UI/Components/Link/Link";
import React, { FunctionComponent, ReactElement } from "react";
import TelemetryDocumentation from "../../Components/Telemetry/Documentation";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";

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

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
        <h2 className="text-base font-semibold text-gray-900">
          {translator.translateText("Send AI / LLM telemetry to OneUptime")}
        </h2>
        <p className="mt-2 text-sm text-gray-600">
          <TranslatedSentence
            template="OneUptime understands the OpenTelemetry GenAI semantic conventions ({{attributes}}). Instrument your LLM or agent app with any GenAI OpenTelemetry library — for example {{openLlmetry}} (Traceloop), {{openInference}} (Arize), or the native OpenTelemetry instrumentations for OpenAI, Anthropic, LangChain, LlamaIndex and CrewAI — then point its OTLP exporter at OneUptime using the connection settings below."
            slots={{
              attributes: <code className="font-mono text-xs">gen_ai.*</code>,
              openLlmetry: <span className="font-medium">OpenLLMetry</span>,
              openInference: <span className="font-medium">OpenInference</span>,
            }}
          />
        </p>
        <p className="mt-2 text-sm text-gray-600">
          <TranslatedSentence
            template="Once spans arrive, they appear in the {{llmCalls}} list with model, token, cost and latency columns, and each span gets a first-class {{panel}} panel showing the prompt and completion. Build token/cost dashboards and set token or latency alerts using the standard Metrics dashboards and monitors on the {{metrics}} metrics your SDK emits."
            slots={{
              llmCalls: (
                <span className="font-medium">
                  {translator.translateText("LLM Calls")}
                </span>
              ),
              panel: (
                <span className="font-medium">
                  {translator.translateText("AI / LLM")}
                </span>
              ),
              metrics: <code className="font-mono text-xs">gen_ai.*</code>,
            }}
          />
        </p>
      </div>

      <div className="rounded-lg border border-amber-100 bg-amber-50/40 p-5 shadow-sm">
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
