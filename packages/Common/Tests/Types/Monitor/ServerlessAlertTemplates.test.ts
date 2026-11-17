import "../../Server/TestingUtils/Init";
import { describe, expect, test } from "@jest/globals";
import { SpanStatus } from "../../../Models/AnalyticsModels/Span";
import TraceMonitorCriteria from "../../../Server/Utils/Monitor/Criteria/TraceMonitorCriteria";
import Dictionary from "../../../Types/Dictionary";
import { CheckOn, CriteriaFilter } from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import MonitorRecommendationCatalog from "../../../Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import MonitorRecommendationUtil from "../../../Types/Monitor/Recommendation/MonitorRecommendationUtil";
import {
  MonitorRecommendation,
  MonitorRecommendationArgs,
  MonitorRecommendationResourceType,
} from "../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import {
  SERVERLESS_FUNCTION_NAME_FILTER,
  ServerlessAlertTemplate,
  ServerlessAlertTemplateArgs,
  getAllServerlessAlertTemplates,
  getServerlessAlertTemplate,
  getServerlessAlertTemplatesFor,
  getServerlessFunctionTelemetryFilters,
  isServerlessFunctionTelemetryScoped,
} from "../../../Types/Monitor/ServerlessAlertTemplates";
import TraceMonitorResponse from "../../../Types/Monitor/TraceMonitor/TraceMonitorResponse";
import ObjectID from "../../../Types/ObjectID";

/*
 * THE MONITORS ONEUPTIME RECOMMENDS FOR A SERVERLESS FUNCTION
 * (Types/Monitor/ServerlessAlertTemplates, #9307): its invocations
 * failing, read from its own spans by its faas.name - the filter its own
 * Traces tab reads - and nothing for a function without one.
 */

const FUNCTION_ID: string = "0b000000-0000-4000-8000-000000000001";

const ORDERS: Dictionary<string> =
  getServerlessFunctionTelemetryFilters("orders-handler");
const PAYMENTS: Dictionary<string> =
  getServerlessFunctionTelemetryFilters("payments-handler");

function argsFor(filters: Dictionary<string>): ServerlessAlertTemplateArgs {
  return {
    serverlessFunctionId: FUNCTION_ID,
    telemetryFilters: filters,
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "orders-handler",
  };
}

function template(id: string): ServerlessAlertTemplate {
  return getServerlessAlertTemplate(id)!;
}

function instancesOf(step: MonitorStep): Array<MonitorCriteriaInstance> {
  return step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray;
}

async function spanCountMeets(
  instance: MonitorCriteriaInstance,
  spanCount: number,
): Promise<boolean> {
  const filter: CriteriaFilter = instance.data!.filters[0]!;

  expect(filter.checkOn).toBe(CheckOn.SpanCount);

  return (
    (await TraceMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
      dataToProcess: {
        projectId: ObjectID.generate(),
        monitorId: ObjectID.generate(),
        spanCount: spanCount,
        spanQuery: {},
      } as TraceMonitorResponse,
      criteriaFilter: JSON.parse(JSON.stringify(filter)) as CriteriaFilter,
    })) !== null
  );
}

describe("a function's telemetry filter", () => {
  test("is its faas.name, trimmed", () => {
    expect(getServerlessFunctionTelemetryFilters("  orders-handler ")).toEqual({
      [SERVERLESS_FUNCTION_NAME_FILTER]: "orders-handler",
    });
    expect(SERVERLESS_FUNCTION_NAME_FILTER).toBe("resource.faas.name");
  });

  test("is nothing for a function with no faas.name yet", () => {
    expect(getServerlessFunctionTelemetryFilters("")).toEqual({});
    expect(getServerlessFunctionTelemetryFilters("   ")).toEqual({});
    expect(getServerlessFunctionTelemetryFilters(undefined)).toEqual({});
    expect(getServerlessFunctionTelemetryFilters(42)).toEqual({});
  });

  test("names one function only when it holds a faas.name", () => {
    expect(isServerlessFunctionTelemetryScoped(ORDERS)).toBe(true);
    expect(isServerlessFunctionTelemetryScoped({})).toBe(false);
    expect(isServerlessFunctionTelemetryScoped(null)).toBe(false);
    expect(
      isServerlessFunctionTelemetryScoped({
        [SERVERLESS_FUNCTION_NAME_FILTER]: " ",
      }),
    ).toBe(false);
    // Another attribute alone is not a function.
    expect(
      isServerlessFunctionTelemetryScoped({ "resource.cloud.region": "x" }),
    ).toBe(false);
  });
});

describe("which templates a function is offered", () => {
  test("its two error templates once it has a faas.name", () => {
    expect(
      getServerlessAlertTemplatesFor({ telemetryFilters: ORDERS }).map(
        (candidate: ServerlessAlertTemplate) => {
          return candidate.id;
        },
      ),
    ).toEqual(["serverless-failed-invocations", "serverless-error-burst"]);
  });

  test("none without one", () => {
    expect(getServerlessAlertTemplatesFor({ telemetryFilters: {} })).toEqual(
      [],
    );
    expect(getServerlessAlertTemplatesFor({})).toEqual([]);
  });

  test("never a monitor that fires for an idle function", () => {
    // No "no spans" template: an idle function is not a failing one.
    for (const candidate of getAllServerlessAlertTemplates()) {
      const step: MonitorStep = candidate.getMonitorStep(argsFor(ORDERS));

      expect(step.data!.traceMonitor!.spanStatuses).toEqual([SpanStatus.Error]);
    }
  });
});

describe("the monitor a template builds", () => {
  test("counts the function's own error spans, by its faas.name, not a service", () => {
    for (const candidate of getAllServerlessAlertTemplates()) {
      const step: MonitorStep = candidate.getMonitorStep(argsFor(ORDERS));

      expect(candidate.monitorType).toBe(MonitorType.Traces);
      expect(step.data!.traceMonitor!.attributes).toEqual(ORDERS);
      expect(step.data!.traceMonitor!.telemetryServiceIds).toEqual([]);
    }
  });

  test("names the function once in its incidents and alerts", () => {
    const step: MonitorStep = template("serverless-error-burst").getMonitorStep(
      argsFor(ORDERS),
    );
    const unhealthy: MonitorCriteriaInstance = instancesOf(step)[0]!;

    expect(unhealthy.data!.incidents[0]!.title).toBe(
      "[Function] Invocation Error Burst - orders-handler",
    );
    expect(unhealthy.data!.alerts[0]!.title).toBe(
      "[Function] Invocation Error Burst - orders-handler",
    );
  });
});

describe("what each template decides", () => {
  test.each([
    ["serverless-failed-invocations", 0, false],
    ["serverless-failed-invocations", 1, true],
    ["serverless-error-burst", 25, false],
    ["serverless-error-burst", 26, true],
  ] as Array<[string, number, boolean]>)(
    "%s at %i error spans fires: %s, and is healthy otherwise",
    async (id: string, count: number, fires: boolean) => {
      const [unhealthy, healthy] = instancesOf(
        template(id).getMonitorStep(argsFor(ORDERS)),
      );

      expect(await spanCountMeets(unhealthy!, count)).toBe(fires);
      expect(await spanCountMeets(healthy!, count)).toBe(!fires);
    },
  );
});

describe("in the recommendation catalog", () => {
  const ARGS: MonitorRecommendationArgs = {
    resourceIdentifier: FUNCTION_ID,
    onlineMonitorStatusId: ObjectID.getZeroObjectID(),
    offlineMonitorStatusId: ObjectID.getZeroObjectID(),
    defaultIncidentSeverityId: ObjectID.getZeroObjectID(),
    defaultAlertSeverityId: ObjectID.getZeroObjectID(),
    monitorName: "orders-handler",
  };

  function recommendationsFor(
    filters: Dictionary<string> | undefined,
  ): Array<MonitorRecommendation> {
    return MonitorRecommendationCatalog.getRecommendations(
      MonitorRecommendationResourceType.ServerlessFunction,
      filters ? { serverlessFunctionTelemetryFilters: filters } : {},
    );
  }

  test("a function is offered its two, as ServerlessFunction recommendations; nothing without a faas.name", () => {
    expect(
      recommendationsFor(ORDERS).map(
        (recommendation: MonitorRecommendation) => {
          return recommendation.recommendationId;
        },
      ),
    ).toEqual([
      "ServerlessFunction:serverless-failed-invocations",
      "ServerlessFunction:serverless-error-burst",
    ]);
    expect(recommendationsFor(undefined)).toEqual([]);
    expect(recommendationsFor({})).toEqual([]);
  });

  test("a monitor made for a function covers its recommendation, and never another function's", () => {
    const orders: Array<MonitorRecommendation> = recommendationsFor(ORDERS);
    const payments: Array<MonitorRecommendation> = recommendationsFor(PAYMENTS);
    const made: MonitorStep = orders[0]!.getMonitorStep({
      ...ARGS,
      onlineMonitorStatusId: ObjectID.generate(),
      offlineMonitorStatusId: ObjectID.generate(),
    });

    expect(
      MonitorRecommendationUtil.getCoveredRecommendationIds({
        recommendations: orders,
        existingMonitorSteps: [made],
        args: ARGS,
      }),
    ).toEqual(new Set<string>([orders[0]!.recommendationId]));

    expect(
      MonitorRecommendationUtil.getCoveredRecommendationIds({
        recommendations: payments,
        existingMonitorSteps: [made],
        args: ARGS,
      }).size,
    ).toBe(0);
  });

  test("each step is valid as the API takes it, and keeps its filter through JSON", () => {
    for (const recommendation of recommendationsFor(ORDERS)) {
      const step: MonitorStep = recommendation.getMonitorStep(ARGS);
      const stored: MonitorStep = MonitorStep.fromJSON(step.toJSON());

      expect(
        MonitorStep.getValidationError(step, recommendation.monitorType),
      ).toBeNull();
      expect(stored.data!.traceMonitor!.attributes).toEqual(ORDERS);
    }
  });
});
