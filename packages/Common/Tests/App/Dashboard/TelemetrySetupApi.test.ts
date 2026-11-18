import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import TelemetrySetupApi, {
  TelemetryMonitorCreateResult,
  TelemetrySetupService,
  getTelemetryRecommendations,
} from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/Telemetry/TelemetrySetupApi";
import * as PayAsYouGo from "../../../../App/FeatureSet/Dashboard/src/Components/Billing/PayAsYouGo";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import ProjectMilestone from "../../../Models/DatabaseModels/ProjectMilestone";
import Service from "../../../Models/DatabaseModels/Service";
import ActivationMilestone from "../../../Types/Analytics/ActivationMilestone";
import Includes from "../../../Types/BaseDatabase/Includes";
import { CheckOn, FilterType } from "../../../Types/Monitor/CriteriaFilter";
import LogSeverity from "../../../Types/Log/LogSeverity";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import { MonitorRecommendation } from "../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import ObjectID from "../../../Types/ObjectID";
import { createTranslator, Translator } from "../../../Types/Translator";
import { FormType } from "../../../UI/Components/Forms/ModelForm";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * What the telemetry guided setup asks the model API for (issue #6806):
 * the three recommended monitors a service's Recommendations tab would
 * make, each opening an alert rather than an incident, created with the
 * same billing acknowledgement, never twice, and a refusal reported as a
 * value so the rest are still made.
 */

const english: Translator = createTranslator(undefined, "en");

const id: (n: number) => ObjectID = (n: number): ObjectID => {
  return new ObjectID(`00000000-0000-4000-8000-${String(n).padStart(12, "0")}`);
};

const PROJECT_ID: ObjectID = id(6806);
const SERVICE: TelemetrySetupService = {
  id: id(70).toString(),
  name: "checkout",
  hasReported: true,
};

const model: <T>(type: { new (): T }, values: Record<string, unknown>) => T = <
  T,
>(
  type: { new (): T },
  values: Record<string, unknown>,
): T => {
  const record: T = new type();
  Object.assign(record as unknown as Record<string, unknown>, values);
  return record;
};

const list: <T>(data: Array<T>) => {
  data: Array<T>;
  count: number;
  skip: number;
  limit: number;
} = <T>(
  data: Array<T>,
): { data: Array<T>; count: number; skip: number; limit: number } => {
  return { data, count: data.length, skip: 0, limit: data.length };
};

type LooseSpy = SpyInstance<(...args: Array<never>) => Promise<unknown>>;

let getListSpy: LooseSpy;
let createOrUpdateSpy: LooseSpy;
let getItemSpy: LooseSpy;
let existingMonitors: Array<Monitor> = [];

const recommendations: Array<MonitorRecommendation> =
  getTelemetryRecommendations();

const created: () => Array<{
  model: Monitor;
  formType: FormType;
  miscDataProps: unknown;
}> = () => {
  return createOrUpdateSpy.mock.calls.map((call: Array<unknown>) => {
    return call[0] as {
      model: Monitor;
      formType: FormType;
      miscDataProps: unknown;
    };
  });
};

beforeEach(() => {
  existingMonitors = [];
  getListSpy = jest.spyOn(ModelAPI, "getList") as unknown as LooseSpy;
  createOrUpdateSpy = jest.spyOn(
    ModelAPI,
    "createOrUpdate",
  ) as unknown as LooseSpy;
  getItemSpy = jest.spyOn(ModelAPI, "getItem") as unknown as LooseSpy;
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  jest
    .spyOn(PayAsYouGo, "isMonitorBatchConsentRequired")
    .mockReturnValue(false);

  getListSpy.mockImplementation((async (args: {
    modelType: { new (): unknown };
  }) => {
    if (args.modelType === MonitorStatus) {
      return list([
        model(MonitorStatus, {
          _id: id(1).toString(),
          isOperationalState: true,
        }),
        model(MonitorStatus, { _id: id(2).toString(), isOfflineState: true }),
      ]);
    }

    if (args.modelType === IncidentSeverity) {
      return list([model(IncidentSeverity, { _id: id(10).toString() })]);
    }

    if (args.modelType === AlertSeverity) {
      return list([model(AlertSeverity, { _id: id(20).toString() })]);
    }

    if (args.modelType === Monitor) {
      return list(existingMonitors);
    }

    return list([]);
  }) as unknown as (...args: Array<never>) => Promise<unknown>);

  let next: number = 100;
  createOrUpdateSpy.mockImplementation((async () => {
    next++;
    return { data: model(Monitor, { _id: id(next).toString() }) };
  }) as unknown as (...args: Array<never>) => Promise<unknown>);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the monitors offered", () => {
  test("are the three recommended ones, in the setup's order, from the Service catalog", () => {
    expect(
      recommendations.map((recommendation: MonitorRecommendation) => {
        return [recommendation.templateId, recommendation.monitorType];
      }),
    ).toEqual([
      ["service-error-burst", MonitorType.Traces],
      ["service-latency-p95", MonitorType.Metrics],
      ["service-unhandled-exceptions", MonitorType.Exceptions],
    ]);
  });
});

/*
 * #7146: what the project's first data says arrived picks what is offered:
 * a service that sends only logs is offered the error-log monitor.
 */
describe("the monitors offered for the data that arrived", () => {
  test("logs only: unhandled exceptions and the spike in error logs, a Logs monitor", () => {
    expect(
      getTelemetryRecommendations([ActivationMilestone.FirstLogsReceived]).map(
        (recommendation: MonitorRecommendation) => {
          return [recommendation.templateId, recommendation.monitorType];
        },
      ),
    ).toEqual([
      ["service-unhandled-exceptions", MonitorType.Exceptions],
      ["service-error-log-spike", MonitorType.Logs],
    ]);
  });

  test("every kind: all four, the error logs last", () => {
    expect(
      getTelemetryRecommendations([
        ActivationMilestone.FirstTracesReceived,
        ActivationMilestone.FirstMetricsReceived,
        ActivationMilestone.FirstLogsReceived,
      ]).map((recommendation: MonitorRecommendation): string => {
        return recommendation.templateId;
      }),
    ).toEqual([
      "service-error-burst",
      "service-latency-p95",
      "service-unhandled-exceptions",
      "service-error-log-spike",
    ]);
  });

  test("nothing known: the setup's three, as before", () => {
    for (const reached of [undefined, null, []]) {
      expect(
        getTelemetryRecommendations(reached).map(
          (recommendation: MonitorRecommendation): string => {
            return recommendation.templateId;
          },
        ),
      ).toEqual([
        "service-error-burst",
        "service-latency-p95",
        "service-unhandled-exceptions",
      ]);
    }
  });

  test("the error-log monitor is made for the service: its error and fatal logs, more than 25 in five minutes", async () => {
    const offered: Array<MonitorRecommendation> = getTelemetryRecommendations([
      ActivationMilestone.FirstLogsReceived,
    ]);
    const errorLogs: MonitorRecommendation = offered.find(
      (recommendation: MonitorRecommendation): boolean => {
        return recommendation.templateId === "service-error-log-spike";
      },
    )!;

    await TelemetrySetupApi.createMonitors({
      service: SERVICE,
      recommendations: offered,
      recommendationIds: [errorLogs.recommendationId],
      hasAcknowledgedBilling: false,
      translator: english,
    });

    expect(created()).toHaveLength(1);

    const monitor: Monitor = created()[0]!.model;
    const step: MonitorStep = monitor.monitorSteps!.data!
      .monitorStepsInstanceArray[0] as MonitorStep;

    expect(monitor.monitorType).toBe(MonitorType.Logs);
    expect(monitor.name).toContain("checkout");
    expect(step.data!.logMonitor!.severityTexts).toEqual([
      LogSeverity.Error,
      LogSeverity.Fatal,
    ]);
    expect(step.data!.logMonitor!.lastXSecondsOfLogs).toBe(300);
    expect(
      step.data!.logMonitor!.telemetryServiceIds.map(
        (serviceId: ObjectID): string => {
          return serviceId.toString();
        },
      ),
    ).toEqual([SERVICE.id]);

    const unhealthy: MonitorCriteriaInstance = step.data!.monitorCriteria.data!
      .monitorCriteriaInstanceArray[0] as MonitorCriteriaInstance;

    expect(unhealthy.data!.filters[0]).toMatchObject({
      checkOn: CheckOn.LogCount,
      filterType: FilterType.GreaterThan,
      value: 25,
    });
    // An alert, for the team, as the setup's other monitors open.
    expect(unhealthy.data!.createAlerts).toBe(true);
    expect(unhealthy.data!.createIncidents).toBe(false);
  });

  test("a Logs monitor the service has already covers the error-log monitor, as the tab counts it", async () => {
    const offered: Array<MonitorRecommendation> = getTelemetryRecommendations([
      ActivationMilestone.FirstLogsReceived,
    ]);

    await TelemetrySetupApi.createMonitors({
      service: SERVICE,
      recommendations: offered,
      recommendationIds: offered.map((r: MonitorRecommendation) => {
        return r.recommendationId;
      }),
      hasAcknowledgedBilling: false,
      translator: english,
    });

    existingMonitors = created().map(
      (call: { model: Monitor }, index: number): Monitor => {
        return model(Monitor, {
          _id: id(300 + index).toString(),
          name: call.model.name,
          monitorType: call.model.monitorType,
          monitorSteps: call.model.monitorSteps,
        });
      },
    );

    const covered: Array<string> =
      await TelemetrySetupApi.loadCoveredRecommendationIds({
        service: SERVICE,
        recommendations: offered,
        translator: english,
      });

    expect(covered.sort()).toEqual(
      offered
        .map((r: MonitorRecommendation): string => {
          return r.recommendationId;
        })
        .sort(),
    );

    // The tab reads Logs monitors as well as the others.
    const monitorTypesRead: Array<unknown> = getListSpy.mock.calls
      .map((call: Array<unknown>): Record<string, unknown> => {
        return call[0] as Record<string, unknown>;
      })
      .filter((args: Record<string, unknown>): boolean => {
        return args["modelType"] === Monitor;
      })
      .map((args: Record<string, unknown>): unknown => {
        return (args["query"] as Record<string, unknown>)["monitorType"];
      });
    expect(monitorTypesRead).toContain(MonitorType.Logs);
  });
});

describe("making them", () => {
  test("goes through the create form's path, with the billing check the guard looks for", async () => {
    const result: TelemetryMonitorCreateResult =
      await TelemetrySetupApi.createMonitors({
        service: SERVICE,
        recommendations: recommendations,
        recommendationIds: recommendations.map((r: MonitorRecommendation) => {
          return r.recommendationId;
        }),
        hasAcknowledgedBilling: false,
        translator: english,
      });

    expect(result.createdIds).toEqual([
      id(101).toString(),
      id(102).toString(),
      id(103).toString(),
    ]);
    expect(result.failures).toEqual([]);

    for (const call of created()) {
      expect(call.formType).toBe(FormType.Create);
      expect(call.model).toBeInstanceOf(Monitor);
    }
  });

  test("each one watches this service and is named after it", async () => {
    await TelemetrySetupApi.createMonitors({
      service: SERVICE,
      recommendations: recommendations,
      recommendationIds: [recommendations[0]!.recommendationId],
      hasAcknowledgedBilling: false,
      translator: english,
    });

    const monitor: Monitor = created()[0]!.model;
    expect(monitor.name).toContain("checkout");
    expect(monitor.monitorType).toBe(MonitorType.Traces);
    expect(JSON.stringify(monitor.monitorSteps?.toJSON())).toContain(
      SERVICE.id,
    );
  });

  test("each one opens an alert, for the team, never an incident", async () => {
    await TelemetrySetupApi.createMonitors({
      service: SERVICE,
      recommendations: recommendations,
      recommendationIds: recommendations.map((r: MonitorRecommendation) => {
        return r.recommendationId;
      }),
      hasAcknowledgedBilling: false,
      translator: english,
    });

    let unhealthyCriteria: number = 0;

    for (const call of created()) {
      for (const step of call.model.monitorSteps!.data!
        .monitorStepsInstanceArray as Array<MonitorStep>) {
        for (const criteria of step.data!.monitorCriteria.data!
          .monitorCriteriaInstanceArray as Array<MonitorCriteriaInstance>) {
          if ((criteria.data!.alerts || []).length > 0) {
            unhealthyCriteria++;
            expect(criteria.data!.createAlerts).toBe(true);
          }

          if ((criteria.data!.incidents || []).length > 0) {
            expect(criteria.data!.createIncidents).toBe(false);
          }
        }
      }
    }

    expect(unhealthyCriteria).toBeGreaterThanOrEqual(3);
  });

  test("only the ones picked are made", async () => {
    await TelemetrySetupApi.createMonitors({
      service: SERVICE,
      recommendations: recommendations,
      recommendationIds: [recommendations[2]!.recommendationId],
      hasAcknowledgedBilling: false,
      translator: english,
    });

    expect(created()).toHaveLength(1);
    expect(created()[0]!.model.monitorType).toBe(MonitorType.Exceptions);
  });

  test("on the Free plan, nothing is made without the billing acknowledgement", async () => {
    jest
      .spyOn(PayAsYouGo, "isMonitorBatchConsentRequired")
      .mockReturnValue(true);

    await expect(
      TelemetrySetupApi.createMonitors({
        service: SERVICE,
        recommendations: recommendations,
        recommendationIds: [recommendations[0]!.recommendationId],
        hasAcknowledgedBilling: false,
        translator: english,
      }),
    ).rejects.toThrow(/billed/);
    expect(created()).toHaveLength(0);

    await TelemetrySetupApi.createMonitors({
      service: SERVICE,
      recommendations: recommendations,
      recommendationIds: [recommendations[0]!.recommendationId],
      hasAcknowledgedBilling: true,
      translator: english,
    });
    expect(created()).toHaveLength(1);
  });

  test("a refused monitor is a value: the rest are still made, and the reason is kept", async () => {
    createOrUpdateSpy
      .mockResolvedValueOnce({
        data: model(Monitor, { _id: id(201).toString() }),
      } as never)
      .mockRejectedValueOnce(new Error("Active monitor limit reached") as never)
      .mockResolvedValueOnce({
        data: model(Monitor, { _id: id(203).toString() }),
      } as never);

    const result: TelemetryMonitorCreateResult =
      await TelemetrySetupApi.createMonitors({
        service: SERVICE,
        recommendations: recommendations,
        recommendationIds: recommendations.map((r: MonitorRecommendation) => {
          return r.recommendationId;
        }),
        hasAcknowledgedBilling: false,
        translator: english,
      });

    expect(result.createdIds).toEqual([id(201).toString(), id(203).toString()]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]!.name).toContain("checkout");
    expect(result.failures[0]!.message).toContain("Active monitor limit");
  });
});

describe("what the service has already", () => {
  test("a monitor the setup made before counts as covering its recommendation", async () => {
    await TelemetrySetupApi.createMonitors({
      service: SERVICE,
      recommendations: recommendations,
      recommendationIds: [recommendations[0]!.recommendationId],
      hasAcknowledgedBilling: false,
      translator: english,
    });

    const made: Monitor = created()[0]!.model;
    made._id = id(301).toString();
    existingMonitors = [made];

    expect(
      await TelemetrySetupApi.loadCoveredRecommendationIds({
        service: SERVICE,
        recommendations: recommendations,
        translator: english,
      }),
    ).toEqual([recommendations[0]!.recommendationId]);
  });

  test("another service's monitor covers nothing here", async () => {
    await TelemetrySetupApi.createMonitors({
      service: { ...SERVICE, id: id(71).toString(), name: "billing" },
      recommendations: recommendations,
      recommendationIds: [recommendations[0]!.recommendationId],
      hasAcknowledgedBilling: false,
      translator: english,
    });

    const made: Monitor = created()[0]!.model;
    made._id = id(302).toString();
    existingMonitors = [made];

    expect(
      await TelemetrySetupApi.loadCoveredRecommendationIds({
        service: SERVICE,
        recommendations: recommendations,
        translator: english,
      }),
    ).toEqual([]);
  });
});

describe("the records it reads", () => {
  test("the run's service, whether it has reported, and null once it is gone", async () => {
    getItemSpy.mockResolvedValue(
      model(Service, {
        _id: SERVICE.id,
        name: "checkout",
        lastSeenAt: new Date(),
      }) as never,
    );
    expect(await TelemetrySetupApi.loadService(SERVICE.id)).toEqual(SERVICE);

    getItemSpy.mockResolvedValue(
      model(Service, { _id: SERVICE.id, name: "checkout" }) as never,
    );
    expect((await TelemetrySetupApi.loadService(SERVICE.id))?.hasReported).toBe(
      false,
    );

    getItemSpy.mockResolvedValue(null as never);
    expect(await TelemetrySetupApi.loadService(SERVICE.id)).toBeNull();
  });

  test("the services that have reported: this project's, latest first, five at most", async () => {
    getListSpy.mockResolvedValue(
      list([
        model(Service, {
          _id: id(80).toString(),
          name: "api",
          lastSeenAt: new Date(),
        }),
      ]) as never,
    );

    expect(await TelemetrySetupApi.loadReportingServices()).toEqual([
      { id: id(80).toString(), name: "api", hasReported: true },
    ]);

    const args: Record<string, unknown> = getListSpy.mock
      .calls[0]![0] as unknown as Record<string, unknown>;
    expect(args["modelType"]).toBe(Service);
    expect(args["limit"]).toBe(5);
    expect(args["sort"]).toEqual({ lastSeenAt: "DESC" });
    expect((args["query"] as Record<string, unknown>)["projectId"]).toBe(
      PROJECT_ID,
    );
    expect(
      (args["query"] as Record<string, unknown>)["lastSeenAt"],
    ).toBeDefined();
  });

  test("the project's first data: its first logs, traces, metrics and exceptions, and nothing else it keeps", async () => {
    getListSpy.mockResolvedValue(
      list([
        model(ProjectMilestone, {
          _id: id(90).toString(),
          milestone: ActivationMilestone.FirstLogsReceived,
        }),
        model(ProjectMilestone, {
          _id: id(91).toString(),
          milestone: "a_milestone_this_version_does_not_know",
        }),
      ]) as never,
    );

    expect(await TelemetrySetupApi.loadFirstDataReached()).toEqual([
      ActivationMilestone.FirstLogsReceived,
    ]);

    const args: Record<string, unknown> = getListSpy.mock
      .calls[0]![0] as unknown as Record<string, unknown>;
    const query: Record<string, unknown> = args["query"] as Record<
      string,
      unknown
    >;

    expect(args["modelType"]).toBe(ProjectMilestone);
    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(query["milestone"]).toBeInstanceOf(Includes);
    expect([...(query["milestone"] as Includes).values].sort()).toEqual(
      [
        ActivationMilestone.FirstTracesReceived,
        ActivationMilestone.FirstMetricsReceived,
        ActivationMilestone.FirstExceptionsReceived,
        ActivationMilestone.FirstLogsReceived,
      ].sort(),
    );
  });

  test("the run's monitors that still exist, and no read for none", async () => {
    expect(await TelemetrySetupApi.loadMonitors([])).toEqual([]);
    expect(getListSpy).not.toHaveBeenCalled();

    getListSpy.mockResolvedValue(
      list([
        model(Monitor, { _id: id(101).toString(), name: "Error Burst" }),
      ]) as never,
    );
    expect(
      await TelemetrySetupApi.loadMonitors([
        id(101).toString(),
        id(102).toString(),
      ]),
    ).toEqual([{ id: id(101).toString(), name: "Error Burst" }]);
  });
});
