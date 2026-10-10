import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  LLM_MONITOR_HEALTHY_DESCRIPTION,
  LLM_MONITOR_HEALTHY_NAME,
  LLM_MONITOR_TEMPLATE_QUERY_PARAM,
  LLM_MONITOR_UNKNOWN_TEMPLATE_ERROR,
  LlmMonitorSeedIds,
  buildLlmMonitorCriteria,
  buildLlmMonitorPrefill,
  getLlmMonitorCreateRoute,
  getLlmMonitorTemplateRoute,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/LlmMonitorPrefill";
import {
  fetchLlmMonitorSeedIds,
  pickLlmMonitorStatuses,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/LlmMonitorData";
import { LLM_MONITOR_TEMPLATE_COPY } from "../../../../App/FeatureSet/Dashboard/src/Components/LlmAlerts/LlmMonitorTemplateCopy";
import LlmMonitorTemplates, {
  LlmMonitorTemplate,
  LlmMonitorTemplateId,
} from "../../../Types/Monitor/LlmMonitor/LlmMonitorTemplates";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import MonitorCriteria from "../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import { CheckOn, FilterType } from "../../../Types/Monitor/CriteriaFilter";
import { MonitorStepLlmMonitorUtil } from "../../../Types/Monitor/MonitorStepLlmMonitor";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Route from "../../../Types/API/Route";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";

/*
 * "Create alert" on an AI alert template opens Create Monitor filled in.
 * The monitor it fills in must be one the form accepts as it is - the right
 * type, the template's "what counts as bad", criteria built from the
 * project's own statuses and severities - so a click and Save makes a
 * working monitor. And it must degrade, not break, for a project missing a
 * status or a severity.
 */

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";

const OPERATIONAL: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const DEGRADED: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const OFFLINE: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const INCIDENT_SEV1: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444441",
);
const INCIDENT_SEV2: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444442",
);
const ALERT_HIGH: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555551",
);
const ALERT_LOW: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555552",
);

const SEEDS: LlmMonitorSeedIds = {
  operationalMonitorStatusId: OPERATIONAL,
  unhealthyMonitorStatusId: DEGRADED,
  rankedIncidentSeverityIds: [INCIDENT_SEV1, INCIDENT_SEV2],
  rankedAlertSeverityIds: [ALERT_HIGH, ALERT_LOW],
};

const NO_SEEDS: LlmMonitorSeedIds = {
  operationalMonitorStatusId: null,
  unhealthyMonitorStatusId: null,
  rankedIncidentSeverityIds: [],
  rankedAlertSeverityIds: [],
};

// The prefill as the create form reads it back: through the steps' JSON.
function stepsOf(prefill: JSONObject): MonitorSteps {
  return MonitorSteps.fromJSON(prefill["monitorSteps"] as JSONObject);
}

function stepOf(prefill: JSONObject): MonitorStep {
  return stepsOf(prefill).data!.monitorStepsInstanceArray[0]!;
}

function criteriaOf(prefill: JSONObject): Array<MonitorCriteriaInstance> {
  return stepOf(prefill).data!.monitorCriteria.data!
    .monitorCriteriaInstanceArray;
}

function prefillFor(
  templateId: LlmMonitorTemplateId,
  seeds: LlmMonitorSeedIds = SEEDS,
): JSONObject {
  const prefill: JSONObject | null = buildLlmMonitorPrefill({
    templateId: templateId,
    seeds: seeds,
  });

  expect(prefill).not.toBeNull();

  return prefill!;
}

beforeEach(() => {
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("buildLlmMonitorPrefill", () => {
  test.each(Object.values(LlmMonitorTemplateId))(
    "%s opens an AI / LLM monitor the create form accepts as it is",
    (templateId: LlmMonitorTemplateId) => {
      const prefill: JSONObject = prefillFor(templateId);

      expect(prefill["monitorType"]).toBe(MonitorType.Llm);
      expect(prefill["name"]).toBe(
        LLM_MONITOR_TEMPLATE_COPY[templateId].monitorName,
      );
      expect(prefill["description"]).toBe(
        LLM_MONITOR_TEMPLATE_COPY[templateId].monitorDescription,
      );
      expect(
        MonitorSteps.getValidationError(stepsOf(prefill), MonitorType.Llm),
      ).toBeNull();
    },
  );

  test.each(Object.values(LlmMonitorTemplateId))(
    "%s counts what its template counts",
    (templateId: LlmMonitorTemplateId) => {
      const template: LlmMonitorTemplate = LlmMonitorTemplates.get(templateId)!;

      expect(
        MonitorStepLlmMonitorUtil.toJSON(
          MonitorStepLlmMonitorUtil.fromJSON(
            stepOf(prefillFor(templateId)).data!
              .llmMonitor as unknown as JSONObject,
          ),
        ),
      ).toEqual(MonitorStepLlmMonitorUtil.toJSON(template.step));
    },
  );

  test.each(Object.values(LlmMonitorTemplateId))(
    "%s: an unhealthy criteria that alerts, and its healthy mirror",
    (templateId: LlmMonitorTemplateId) => {
      const template: LlmMonitorTemplate = LlmMonitorTemplates.get(templateId)!;
      const [unhealthy, healthy] = criteriaOf(prefillFor(templateId));

      expect(unhealthy?.data?.filterCondition).toBe(FilterCondition.All);
      expect(unhealthy?.data?.filters).toEqual(
        template.unhealthyFilters.map(
          (filter: {
            checkOn: CheckOn;
            filterType: FilterType;
            value: number;
          }) => {
            return {
              checkOn: filter.checkOn,
              filterType: filter.filterType,
              value: filter.value,
            };
          },
        ),
      );
      expect(unhealthy?.data?.monitorStatusId?.toString()).toBe(
        DEGRADED.toString(),
      );
      expect(unhealthy?.data?.changeMonitorStatus).toBe(true);
      expect(unhealthy?.data?.createAlerts).toBe(true);
      expect(unhealthy?.data?.name).toBe(
        LLM_MONITOR_TEMPLATE_COPY[templateId].monitorName,
      );

      expect(healthy?.data?.filterCondition).toBe(FilterCondition.Any);
      expect(healthy?.data?.filters).toHaveLength(
        template.healthyFilters.length,
      );
      expect(healthy?.data?.monitorStatusId?.toString()).toBe(
        OPERATIONAL.toString(),
      );
      expect(healthy?.data?.createAlerts).toBe(false);
      expect(healthy?.data?.createIncidents).toBe(false);
      expect(healthy?.data?.alerts).toEqual([]);
      expect(healthy?.data?.name).toBe(LLM_MONITOR_HEALTHY_NAME);
      expect(healthy?.data?.description).toBe(LLM_MONITOR_HEALTHY_DESCRIPTION);
    },
  );

  test("an alert, not an incident: the incident is filled in and switched off", () => {
    for (const templateId of Object.values(LlmMonitorTemplateId)) {
      const [unhealthy] = criteriaOf(prefillFor(templateId));

      expect(unhealthy?.data?.createIncidents).toBe(false);
      expect(unhealthy?.data?.incidents).toHaveLength(1);
      expect(unhealthy?.data?.incidents[0]?.title).toBe(
        LLM_MONITOR_TEMPLATE_COPY[templateId].monitorName,
      );
      // An alert that resolves itself once the answers recover.
      expect(unhealthy?.data?.alerts[0]?.autoResolveAlert).toBe(true);
      expect(unhealthy?.data?.alerts[0]?.description).toBe(
        LLM_MONITOR_TEMPLATE_COPY[templateId].alertDescription,
      );
    }
  });

  test("a Critical template alerts at the most severe level, a Warning at the next", () => {
    const failed: MonitorCriteriaInstance = criteriaOf(
      prefillFor(LlmMonitorTemplateId.FailedCalls),
    )[0]!;
    const refusals: MonitorCriteriaInstance = criteriaOf(
      prefillFor(LlmMonitorTemplateId.Refusals),
    )[0]!;

    expect(failed.data?.alerts[0]?.alertSeverityId?.toString()).toBe(
      ALERT_HIGH.toString(),
    );
    expect(failed.data?.incidents[0]?.incidentSeverityId?.toString()).toBe(
      INCIDENT_SEV1.toString(),
    );
    expect(refusals.data?.alerts[0]?.alertSeverityId?.toString()).toBe(
      ALERT_LOW.toString(),
    );
    expect(refusals.data?.incidents[0]?.incidentSeverityId?.toString()).toBe(
      INCIDENT_SEV2.toString(),
    );
  });

  test("a project with one severity uses it for both levels", () => {
    const [unhealthy] = criteriaOf(
      prefillFor(LlmMonitorTemplateId.Refusals, {
        ...SEEDS,
        rankedAlertSeverityIds: [ALERT_HIGH],
      }),
    );

    expect(unhealthy?.data?.alerts[0]?.alertSeverityId?.toString()).toBe(
      ALERT_HIGH.toString(),
    );
  });

  test("the monitor starts operational", () => {
    expect(
      stepsOf(
        prefillFor(LlmMonitorTemplateId.BadAnswers),
      ).data?.defaultMonitorStatusId?.toString(),
    ).toBe(OPERATIONAL.toString());
  });

  test("a project missing statuses and severities gets criteria without those parts, not broken ones", () => {
    const prefill: JSONObject = prefillFor(
      LlmMonitorTemplateId.BadAnswers,
      NO_SEEDS,
    );
    const [unhealthy, healthy] = criteriaOf(prefill);

    expect(unhealthy?.data?.changeMonitorStatus).toBe(false);
    expect(unhealthy?.data?.monitorStatusId).toBeUndefined();
    expect(unhealthy?.data?.createAlerts).toBe(false);
    expect(unhealthy?.data?.alerts).toEqual([]);
    expect(unhealthy?.data?.incidents).toEqual([]);
    expect(healthy?.data?.changeMonitorStatus).toBe(false);
    // The form asks for the default status rather than saving without one.
    expect(stepsOf(prefill).data?.defaultMonitorStatusId).toBeUndefined();
    expect(
      MonitorSteps.getValidationError(stepsOf(prefill), MonitorType.Llm),
    ).toBe("Default Monitor Status is required");
  });

  test("criteria ids are fresh on every call", () => {
    const first: Array<MonitorCriteriaInstance> = criteriaOf(
      prefillFor(LlmMonitorTemplateId.BadAnswers),
    );
    const second: Array<MonitorCriteriaInstance> = criteriaOf(
      prefillFor(LlmMonitorTemplateId.BadAnswers),
    );

    expect(first[0]?.data?.id).not.toBe(second[0]?.data?.id);
    expect(first[0]?.data?.id).not.toBe(first[1]?.data?.id);
  });

  test.each([
    ["llm-made-up"],
    [""],
    [null],
    [undefined],
    [42],
    [{ id: "llm-bad-answers" }],
  ])("%p is not a template", (templateId: unknown) => {
    expect(
      buildLlmMonitorPrefill({ templateId: templateId, seeds: SEEDS }),
    ).toBeNull();
  });

  test("a template a caller changed does not change the next prefill", () => {
    const template: LlmMonitorTemplate = LlmMonitorTemplates.get(
      LlmMonitorTemplateId.FailedCalls,
    )!;

    template.step.issues.push(...LlmMonitorTemplates.getAll()[0]!.step.issues);
    template.unhealthyFilters[0]!.value = 99;

    expect(
      criteriaOf(prefillFor(LlmMonitorTemplateId.FailedCalls))[0]?.data
        ?.filters[0]?.value,
    ).toBe(10);
  });
});

describe("buildLlmMonitorCriteria", () => {
  test("the unhealthy criteria comes first, so it is checked first", () => {
    const template: LlmMonitorTemplate = LlmMonitorTemplates.get(
      LlmMonitorTemplateId.NoAnswers,
    )!;
    const criteria: MonitorCriteria = buildLlmMonitorCriteria({
      template: template,
      copy: LLM_MONITOR_TEMPLATE_COPY[template.id],
      seeds: SEEDS,
    });
    const [unhealthy, healthy] = criteria.data!.monitorCriteriaInstanceArray;

    expect(unhealthy?.data?.filters).toEqual([
      {
        checkOn: CheckOn.LlmAnswerCount,
        filterType: FilterType.EqualTo,
        value: 0,
      },
    ]);
    expect(healthy?.data?.filters).toEqual([
      {
        checkOn: CheckOn.LlmAnswerCount,
        filterType: FilterType.GreaterThan,
        value: 0,
      },
    ]);
  });
});

describe("pickLlmMonitorStatuses", () => {
  test("operational, and the first status between operational and offline", () => {
    expect(
      pickLlmMonitorStatuses([
        { id: OPERATIONAL, isOperationalState: true },
        { id: DEGRADED },
        { id: OFFLINE, isOfflineState: true },
      ]),
    ).toEqual({
      operationalMonitorStatusId: OPERATIONAL,
      unhealthyMonitorStatusId: DEGRADED,
    });
  });

  test("the order decides between two in-between statuses", () => {
    const partial: ObjectID = new ObjectID(
      "66666666-6666-4666-8666-666666666666",
    );

    expect(
      pickLlmMonitorStatuses([
        { id: OFFLINE, isOfflineState: true },
        { id: partial },
        { id: OPERATIONAL, isOperationalState: true },
        { id: DEGRADED },
      ]).unhealthyMonitorStatusId,
    ).toBe(partial);
  });

  test("without an in-between status, offline", () => {
    expect(
      pickLlmMonitorStatuses([
        { id: OPERATIONAL, isOperationalState: true },
        { id: OFFLINE, isOfflineState: true },
      ]).unhealthyMonitorStatusId,
    ).toBe(OFFLINE);
  });

  test("rows without an id are skipped, and nothing at all is null", () => {
    expect(
      pickLlmMonitorStatuses([
        { id: null, isOperationalState: true },
        { id: null },
        { id: OPERATIONAL, isOperationalState: true },
      ]),
    ).toEqual({
      operationalMonitorStatusId: OPERATIONAL,
      unhealthyMonitorStatusId: null,
    });
    expect(pickLlmMonitorStatuses([])).toEqual({
      operationalMonitorStatusId: null,
      unhealthyMonitorStatusId: null,
    });
  });
});

describe("fetchLlmMonitorSeedIds", () => {
  function row<T>(Model: new () => T, data: Partial<T>): T {
    const model: T = new Model();
    Object.assign(model as Record<string, unknown>, data);
    return model;
  }

  test("reads statuses by priority and severities most severe first", async () => {
    const getList: ReturnType<typeof jest.spyOn> = jest
      .spyOn(ModelAPI, "getList")
      .mockImplementation(async (args: unknown): Promise<never> => {
        const modelType: unknown = (args as { modelType: unknown }).modelType;

        if (modelType === MonitorStatus) {
          return {
            data: [
              row(MonitorStatus, {
                _id: OPERATIONAL.toString(),
                isOperationalState: true,
              } as Partial<MonitorStatus>),
              row(MonitorStatus, {
                _id: DEGRADED.toString(),
              } as Partial<MonitorStatus>),
              row(MonitorStatus, {
                _id: OFFLINE.toString(),
                isOfflineState: true,
              } as Partial<MonitorStatus>),
            ],
            count: 3,
            skip: 0,
            limit: 3,
          } as never;
        }

        if (modelType === IncidentSeverity) {
          return {
            data: [
              row(IncidentSeverity, {
                _id: INCIDENT_SEV1.toString(),
              } as Partial<IncidentSeverity>),
              row(IncidentSeverity, {
                _id: INCIDENT_SEV2.toString(),
              } as Partial<IncidentSeverity>),
            ],
            count: 2,
            skip: 0,
            limit: 2,
          } as never;
        }

        return {
          data: [
            row(AlertSeverity, {
              _id: ALERT_HIGH.toString(),
            } as Partial<AlertSeverity>),
          ],
          count: 1,
          skip: 0,
          limit: 1,
        } as never;
      });

    const seeds: LlmMonitorSeedIds = await fetchLlmMonitorSeedIds();

    expect(seeds.operationalMonitorStatusId?.toString()).toBe(
      OPERATIONAL.toString(),
    );
    expect(seeds.unhealthyMonitorStatusId?.toString()).toBe(
      DEGRADED.toString(),
    );
    expect(
      seeds.rankedIncidentSeverityIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([INCIDENT_SEV1.toString(), INCIDENT_SEV2.toString()]);
    expect(
      seeds.rankedAlertSeverityIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    ).toEqual([ALERT_HIGH.toString()]);

    const calls: Array<Array<unknown>> = getList.mock.calls as Array<
      Array<unknown>
    >;
    const sortFor: (model: unknown) => unknown = (model: unknown): unknown => {
      return (
        calls.find((call: Array<unknown>): boolean => {
          return (call[0] as { modelType: unknown }).modelType === model;
        })![0] as { sort: unknown }
      ).sort;
    };

    expect(calls).toHaveLength(3);
    expect(sortFor(MonitorStatus)).toEqual({ priority: SortOrder.Ascending });
    expect(sortFor(IncidentSeverity)).toEqual({ order: SortOrder.Ascending });
    expect(sortFor(AlertSeverity)).toEqual({ order: SortOrder.Ascending });
  });
});

describe("the routes to Create Monitor", () => {
  test("a template's card opens Create Monitor on that template", () => {
    const route: Route = getLlmMonitorTemplateRoute(
      LlmMonitorTemplateId.Refusals,
    );
    const [path, query] = route.toString().split("?");

    expect(path).toBe(`/dashboard/${PROJECT_ID}/monitors/create`);
    expect(
      new URLSearchParams(query).get(LLM_MONITOR_TEMPLATE_QUERY_PARAM),
    ).toBe("llm-refusals");
  });

  test("Create AI alert opens Create Monitor on the AI / LLM type alone", () => {
    const [path, query] = getLlmMonitorCreateRoute().toString().split("?");

    expect(path).toBe(`/dashboard/${PROJECT_ID}/monitors/create`);
    expect(new URLSearchParams(query).get("monitorType")).toBe(MonitorType.Llm);
  });

  test("a link naming no template says so in words the reader can act on", () => {
    expect(LLM_MONITOR_UNKNOWN_TEMPLATE_ERROR).toContain(
      "Alerts tab of AI / LLM",
    );
  });
});
