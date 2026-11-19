import { describe, expect, test } from "@jest/globals";
import {
  CIRCUIT_BREAKER_COPY,
  CircuitBreakerStatus,
  getAirflowSnippet,
  getCircuitBreakerPipelineName,
  getCircuitBreakerReasonRoute,
  getCircuitBreakerStatus,
  getCircuitBreakerUrl,
  getCurlSnippet,
  getDbtSnippet,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/CircuitBreakerCopy";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Route from "../../../Types/API/Route";
import {
  DataCircuitBreakerReason,
  DataCircuitBreakerReasonKind,
} from "../../../Types/DataObservability/DataCircuitBreaker";
import ObjectID from "../../../Types/ObjectID";

/*
 * A PIPELINE'S CIRCUIT BREAKER PAGE, IN WORDS AND SNIPPETS (#6548).
 *
 *   - how the breaker stands, from what the pipeline keeps;
 *   - where each reason leads: a failing check to its table's Checks tab,
 *     a late table to the table;
 *   - the step a person copies: this server's address, this pipeline as
 *     the breaker finds it (namespace/name), the API key from the
 *     environment and never in the code, and a stop that stops the step -
 *     curl -f with failWithStatusCode, an Airflow ShortCircuitOperator,
 *     and dbt run only once the breaker says go;
 *   - descriptions short enough for where they are drawn.
 */

const URL: string =
  "https://oneuptime.example.com/api/data-observability/circuit-breaker";
const PIPELINE: string = "airflow://prod/orders_daily";
const TABLE_ID: string = "33333333-3333-4333-8333-000000000001";

function routeTo(page: PageMap, id: string): string {
  return RouteUtil.populateRouteParams(RouteMap[page] as Route, {
    modelId: new ObjectID(id),
  }).toString();
}

describe("how the breaker stands", () => {
  test("stopped, while a stop is kept, whatever was asked since", () => {
    expect(
      getCircuitBreakerStatus({
        checkedAt: "2026-11-19T12:00:00.000Z",
        stoppedAt: "2026-11-19T09:00:00.000Z",
      }),
    ).toBe(CircuitBreakerStatus.Stopped);
  });

  test("go, once asked and not stopped", () => {
    expect(
      getCircuitBreakerStatus({
        checkedAt: "2026-11-19T12:00:00.000Z",
        stoppedAt: null,
      }),
    ).toBe(CircuitBreakerStatus.Go);
  });

  test("not set up, never asked", () => {
    expect(getCircuitBreakerStatus({ checkedAt: null, stoppedAt: null })).toBe(
      CircuitBreakerStatus.NotSetUp,
    );
  });
});

describe("where each reason leads", () => {
  const reason: DataCircuitBreakerReason = {
    kind: DataCircuitBreakerReasonKind.CheckFailing,
    dataAssetId: TABLE_ID,
    table: "public.orders",
    database: null,
    check: "unique order id",
    dataCheckId: "44444444-4444-4444-8444-000000000001",
    lateBySeconds: 0,
  };

  test("a failing check: its table's Checks tab", () => {
    expect(getCircuitBreakerReasonRoute(reason).toString()).toBe(
      routeTo(PageMap.DATA_OBSERVABILITY_TABLE_VIEW_CHECKS, TABLE_ID),
    );
  });

  test("a late table: the table", () => {
    expect(
      getCircuitBreakerReasonRoute({
        ...reason,
        kind: DataCircuitBreakerReasonKind.TableLate,
        check: null,
        dataCheckId: null,
        lateBySeconds: 3_600,
      }).toString(),
    ).toBe(routeTo(PageMap.DATA_OBSERVABILITY_TABLE_VIEW, TABLE_ID));
  });
});

describe("the step to add", () => {
  test("the address is the server's API, with or without its trailing slash", () => {
    expect(getCircuitBreakerUrl("https://oneuptime.example.com/api")).toBe(URL);
    expect(getCircuitBreakerUrl("https://oneuptime.example.com/api/")).toBe(
      URL,
    );
  });

  test("the pipeline as the breaker finds it: its namespace/name, else its name", () => {
    expect(
      getCircuitBreakerPipelineName({
        pipelineKey: PIPELINE,
        jobName: "orders_daily",
      }),
    ).toBe(PIPELINE);
    expect(getCircuitBreakerPipelineName({ jobName: "orders_daily" })).toBe(
      "orders_daily",
    );
    expect(getCircuitBreakerPipelineName({})).toBe("<pipeline name>");
  });

  test("curl: the key from the environment, failWithStatusCode, and -f so a stop fails the step", () => {
    const snippet: string = getCurlSnippet({ url: URL, pipeline: PIPELINE });

    expect(snippet).toContain(`curl -sSf "${URL}"`);
    expect(snippet).toContain('-H "ApiKey: $ONEUPTIME_API_KEY"');
    expect(snippet).toContain('-H "Content-Type: application/json"');
    expect(snippet).toContain(
      `-d '{"pipeline":"${PIPELINE}","failWithStatusCode":true}'`,
    );
  });

  test("a pipeline name that holds a quote stays one JSON string", () => {
    const snippet: string = getCurlSnippet({
      url: URL,
      pipeline: 'odd "name"',
    });

    expect(snippet).toContain('{"pipeline":"odd \\"name\\""');
  });

  test("Airflow: a ShortCircuitOperator whose function returns whether the breaker said go", () => {
    const snippet: string = getAirflowSnippet({ url: URL, pipeline: PIPELINE });

    expect(snippet).toContain(
      "from airflow.operators.python import ShortCircuitOperator",
    );
    expect(snippet).toContain(`"${URL}"`);
    expect(snippet).toContain(
      'headers={"ApiKey": os.environ["ONEUPTIME_API_KEY"]}',
    );
    expect(snippet).toContain(`json={"pipeline": "${PIPELINE}"}`);
    expect(snippet).toContain("response.raise_for_status()");
    expect(snippet).toContain('return answer["verdict"] == "go"');
    expect(snippet).toContain("check_inputs >> load_task");
  });

  test("dbt: the breaker's step, and dbt only once it says go", () => {
    const snippet: string = getDbtSnippet({ url: URL, pipeline: PIPELINE });

    expect(
      snippet.startsWith(getCurlSnippet({ url: URL, pipeline: PIPELINE })),
    ).toBe(true);
    expect(snippet.endsWith("&& dbt build")).toBe(true);
  });
});

describe("the words", () => {
  test("a card's description fits beside its title", () => {
    for (const description of [
      CIRCUIT_BREAKER_COPY.cardDescription,
      CIRCUIT_BREAKER_COPY.switchCardDescription,
      CIRCUIT_BREAKER_COPY.setupDescription,
    ]) {
      expect(description.length).toBeLessThanOrEqual(210);
    }
  });

  test("a switch's sentence fits under it", () => {
    expect(CIRCUIT_BREAKER_COPY.switchOn.length).toBeLessThanOrEqual(150);
    expect(CIRCUIT_BREAKER_COPY.switchOff.length).toBeLessThanOrEqual(150);
  });

  test("each sentence with a time says where it goes", () => {
    expect(CIRCUIT_BREAKER_COPY.stoppedSince).toContain("{{time}}");
    expect(CIRCUIT_BREAKER_COPY.lastAskedGo).toContain("{{time}}");
    expect(CIRCUIT_BREAKER_COPY.overviewBanner).toContain("{{time}}");
  });

  test("Test Now says it keeps nothing, either way", () => {
    expect(CIRCUIT_BREAKER_COPY.testGo).toContain(
      "Testing keeps nothing on the pipeline.",
    );
    expect(CIRCUIT_BREAKER_COPY.testStop).toContain(
      "Testing keeps nothing on the pipeline.",
    );
  });
});
