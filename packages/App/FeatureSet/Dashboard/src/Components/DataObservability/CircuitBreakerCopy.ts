import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import {
  DataCircuitBreakerReason,
  DataCircuitBreakerReasonKind,
} from "Common/Types/DataObservability/DataCircuitBreaker";
import { DATA_OBSERVABILITY_API_ROUTES } from "Common/Types/DataObservability/DataObservabilityApiTypes";
import ObjectID from "Common/Types/ObjectID";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * A PIPELINE'S CIRCUIT BREAKER PAGE: ITS WORDS, ITS LINKS, AND THE STEP TO
 * ADD (#6548).
 *
 * Kept free of React, so the sentences, where each reason leads and the
 * snippets a person copies into their pipeline are pinned in plain tests.
 * Each snippet names the pipeline exactly as the circuit breaker finds it
 * - its namespace/name, the key its events are matched by - and asks with a
 * project API key from the environment, never one written into the code.
 */

// How the breaker stands, as its status pill says it.
export enum CircuitBreakerStatus {
  // It stopped the pipeline, and has not said go since.
  Stopped = "Stopped",
  // It was asked, and said go.
  Go = "Go",
  // No step of the pipeline has asked yet.
  NotSetUp = "Not Set Up",
}

export function getCircuitBreakerStatus(state: {
  checkedAt: string | null;
  stoppedAt: string | null;
}): CircuitBreakerStatus {
  if (state.stoppedAt) {
    return CircuitBreakerStatus.Stopped;
  }

  return state.checkedAt
    ? CircuitBreakerStatus.Go
    : CircuitBreakerStatus.NotSetUp;
}

export const CIRCUIT_BREAKER_COPY: {
  cardTitle: string;
  cardDescription: string;
  stoppedSince: string;
  lastAskedGo: string;
  notSetUp: string;
  reasonsTitle: string;
  noReadableReasons: string;
  testNow: string;
  testGo: string;
  testStop: string;
  testNoTables: string;
  switchCardTitle: string;
  switchCardDescription: string;
  switchTitle: string;
  switchOn: string;
  switchOff: string;
  setupTitle: string;
  setupDescription: string;
  setupKey: string;
  curlNote: string;
  airflowNote: string;
  dbtNote: string;
  readTheDocs: string;
  overviewBanner: string;
  openCircuitBreaker: string;
} = {
  cardTitle: translationKey("Circuit Breaker"),
  cardDescription: translationKey(
    "Before this pipeline runs, a step of it asks whether the tables it reads are healthy, and stops it when one is not.",
  ),
  stoppedSince: translationKey("Stopped the pipeline {{time}}"),
  lastAskedGo: translationKey("Said go {{time}}"),
  notSetUp: translationKey(
    "No step of this pipeline has asked yet. Add the step below to the start of the pipeline.",
  ),
  reasonsTitle: translationKey("Why it stopped"),
  noReadableReasons: translationKey(
    "The tables that stopped it are not ones you may read.",
  ),
  testNow: translationKey("Test Now"),
  testGo: translationKey(
    "Go: none of the tables it reads would stop it now. Testing keeps nothing on the pipeline.",
  ),
  testStop: translationKey(
    "Stop: it would stop the pipeline now. Testing keeps nothing on the pipeline.",
  ),
  testNoTables: translationKey(
    "Go: OneUptime knows none of the tables this pipeline reads yet, so nothing would be checked. Its lineage fills in as its runs report what they read.",
  ),
  switchCardTitle: translationKey("What Stops It"),
  switchCardDescription: translationKey(
    "A failing check of a table it reads always stops the pipeline.",
  ),
  switchTitle: translationKey("Stop when a table it reads is late"),
  switchOn: translationKey(
    "A table well past its usual rhythm without a change stops the pipeline too.",
  ),
  switchOff: translationKey(
    "Late tables do not stop the pipeline: a late table may only mean a quiet day.",
  ),
  setupTitle: translationKey("Add It to Your Pipeline"),
  setupDescription: translationKey(
    "Ask the circuit breaker as the pipeline's first step, and run the rest only when it says go.",
  ),
  setupKey: translationKey(
    "Create a project API key that may read Data Observability under Project Settings > API Keys, and give it to the step as ONEUPTIME_API_KEY.",
  ),
  curlNote: translationKey(
    "With failWithStatusCode, a stop answers HTTP 412, so curl -f fails the step and the steps after it do not run.",
  ),
  airflowNote: translationKey(
    "A ShortCircuitOperator skips every task after it when its function returns false, so the tasks that read the tables do not run.",
  ),
  dbtNote: translationKey(
    "dbt's hooks run SQL in your warehouse, not web requests, so ask the circuit breaker in the step that starts dbt.",
  ),
  readTheDocs: translationKey("Read the docs"),
  overviewBanner: translationKey(
    "The circuit breaker stopped this pipeline {{time}}: a table it reads failed a check or is late.",
  ),
  openCircuitBreaker: translationKey("Open Circuit Breaker"),
};

// The page of a reason's table: its Checks tab for a failing check, its page for a late table.
export function getCircuitBreakerReasonRoute(
  reason: DataCircuitBreakerReason,
): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[
      reason.kind === DataCircuitBreakerReasonKind.CheckFailing
        ? PageMap.DATA_OBSERVABILITY_TABLE_VIEW_CHECKS
        : PageMap.DATA_OBSERVABILITY_TABLE_VIEW
    ] as Route,
    { modelId: new ObjectID(reason.dataAssetId) },
  );
}

// The circuit breaker's address on this server, after its API's own address (https://oneuptime.example.com/api).
export function getCircuitBreakerUrl(apiUrl: string): string {
  return `${apiUrl.replace(/\/+$/, "")}${
    DATA_OBSERVABILITY_API_ROUTES.circuitBreaker
  }`;
}

// A pipeline as the circuit breaker finds it: its namespace/name key, else its name.
export function getCircuitBreakerPipelineName(pipeline: {
  pipelineKey?: string | undefined | null;
  jobName?: string | undefined | null;
}): string {
  return pipeline.pipelineKey || pipeline.jobName || "<pipeline name>";
}

// A string as JSON writes it, for a snippet: quotes and backslashes escaped.
function quoted(value: string): string {
  return JSON.stringify(value);
}

export interface CircuitBreakerSnippetData {
  url: string;
  pipeline: string;
}

// A plain shell step: curl -f fails it on a stop.
export function getCurlSnippet(data: CircuitBreakerSnippetData): string {
  return `curl -sSf ${quoted(data.url)} \\
  -H "ApiKey: $ONEUPTIME_API_KEY" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify({
    pipeline: data.pipeline,
    failWithStatusCode: true,
  })}'`;
}

// An Airflow task before the tasks that read the tables: false skips them.
export function getAirflowSnippet(data: CircuitBreakerSnippetData): string {
  return `import os

import requests
from airflow.operators.python import ShortCircuitOperator


def inputs_are_healthy() -> bool:
    response = requests.post(
        ${quoted(data.url)},
        headers={"ApiKey": os.environ["ONEUPTIME_API_KEY"]},
        json={"pipeline": ${quoted(data.pipeline)}},
        timeout=30,
    )
    response.raise_for_status()
    answer = response.json()
    print(answer["answer"])
    return answer["verdict"] == "go"


check_inputs = ShortCircuitOperator(
    task_id="check_inputs",
    python_callable=inputs_are_healthy,
)

check_inputs >> load_task  # the task that reads the tables`;
}

// The step that starts dbt: dbt runs only when the circuit breaker says go.
export function getDbtSnippet(data: CircuitBreakerSnippetData): string {
  return `${getCurlSnippet(data)} \\
  && dbt build`;
}
