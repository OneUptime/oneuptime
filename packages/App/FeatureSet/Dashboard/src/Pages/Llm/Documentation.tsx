import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import Route from "Common/Types/API/Route";
import Link from "Common/UI/Components/Link/Link";
import React, { FunctionComponent, ReactElement } from "react";
import TelemetryDocumentation from "../../Components/Telemetry/Documentation";

const LlmDocumentationPage: FunctionComponent<PageComponentProps> = (
  _props: PageComponentProps,
): ReactElement => {
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
          Send AI / LLM telemetry to OneUptime
        </h2>
        <p className="mt-2 text-sm text-gray-600">
          OneUptime understands the OpenTelemetry GenAI semantic conventions (
          <code className="font-mono text-xs">gen_ai.*</code>). Instrument your
          LLM or agent app with any GenAI OpenTelemetry library — for example{" "}
          <span className="font-medium">OpenLLMetry</span> (Traceloop),{" "}
          <span className="font-medium">OpenInference</span> (Arize), or the
          native OpenTelemetry instrumentations for OpenAI, Anthropic,
          LangChain, LlamaIndex and CrewAI — then point its OTLP exporter at
          OneUptime using the connection settings below.
        </p>
        <p className="mt-2 text-sm text-gray-600">
          Once spans arrive, they appear in the{" "}
          <span className="font-medium">LLM Calls</span> list with model, token,
          cost and latency columns, and each span gets a first-class{" "}
          <span className="font-medium">AI / LLM</span> panel showing the prompt
          and completion. Build token/cost dashboards and set token or latency
          alerts using the standard Metrics dashboards and monitors on the{" "}
          <code className="font-mono text-xs">gen_ai.*</code> metrics your SDK
          emits.
        </p>
      </div>

      <div className="rounded-lg border border-amber-100 bg-amber-50/40 p-5 shadow-sm">
        <h2 className="text-base font-semibold text-gray-900">
          Control what prompt &amp; completion content is stored
        </h2>
        <p className="mt-2 text-sm text-gray-600">
          LLM calls are ingested as OpenTelemetry trace spans, so the trace
          pipeline&apos;s privacy controls apply to them directly. Prompts and
          completions can carry sensitive data — use{" "}
          <Link
            to={scrubRulesRoute}
            className="font-medium text-indigo-600 underline"
          >
            Traces → Settings → Scrub Rules
          </Link>{" "}
          to mask or redact attribute values before they are stored, or{" "}
          <Link
            to={dropFiltersRoute}
            className="font-medium text-indigo-600 underline"
          >
            Traces → Settings → Drop Filters
          </Link>{" "}
          to drop matching spans entirely. These rules govern every trace span,
          including the <code className="font-mono text-xs">gen_ai.*</code>{" "}
          spans shown here.
        </p>
      </div>

      <TelemetryDocumentation telemetryType="traces" />
    </div>
  );
};

export default LlmDocumentationPage;
