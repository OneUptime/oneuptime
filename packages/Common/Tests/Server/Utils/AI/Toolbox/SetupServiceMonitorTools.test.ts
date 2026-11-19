import AIToolbox from "../../../../../Server/Utils/AI/Toolbox/Index";
import {
  SERVICE_MONITOR_TEMPLATES,
  SetUpServiceMonitorTool,
  readServiceMonitorTemplate,
} from "../../../../../Server/Utils/AI/Toolbox/SetupServiceMonitorTools";
import { countMonitorsSetUpInPlan } from "../../../../../Server/Utils/AI/Toolbox/SetupPlan";
import {
  PreparedMutation,
  SetupActionRefusal,
  ToolContext,
  ToolExecutionResult,
} from "../../../../../Server/Utils/AI/Toolbox/ToolTypes";
import AlertSeverityService from "../../../../../Server/Services/AlertSeverityService";
import IncidentSeverityService from "../../../../../Server/Services/IncidentSeverityService";
import MonitorService from "../../../../../Server/Services/MonitorService";
import MonitorStatusService from "../../../../../Server/Services/MonitorStatusService";
import PayAsYouGoBillingService from "../../../../../Server/Services/PayAsYouGoBillingService";
import ProjectMilestoneService from "../../../../../Server/Services/ProjectMilestoneService";
import ServiceService from "../../../../../Server/Services/ServiceService";
import ActiveMonitorLimit from "../../../../../Server/Utils/Billing/ActiveMonitorLimit";
import AlertSeverity from "../../../../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../../../../Models/DatabaseModels/IncidentSeverity";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../../../Models/DatabaseModels/MonitorStatus";
import ProjectMilestone from "../../../../../Models/DatabaseModels/ProjectMilestone";
import Service from "../../../../../Models/DatabaseModels/Service";
import {
  AI_ACTION_CARD_KINDS,
  describeAIActionCardWords,
  isKnownAIActionSentence,
} from "../../../../../Types/AI/AIActionWords";
import {
  AIChatCitationTargetType,
  AIToolRefusal,
} from "../../../../../Types/AI/AIChatTypes";
import {
  SET_UP_SERVICE_MONITOR_TOOL_NAME,
  SET_UP_WEBSITE_MONITORING_TOOL_NAME,
} from "../../../../../Types/AI/AISetupActions";
import ActivationMilestone from "../../../../../Types/Analytics/ActivationMilestone";
import { JSONObject } from "../../../../../Types/JSON";
import MonitorType from "../../../../../Types/Monitor/MonitorType";
import { MonitorRecommendationCreatePlanItem } from "../../../../../Types/Monitor/Recommendation/MonitorRecommendationCreateUtil";
import ObjectID from "../../../../../Types/ObjectID";
import {
  TELEMETRY_RECOMMENDED_TEMPLATES,
  buildServiceMonitorPlan,
  getServiceRecommendation,
} from "../../../../../Utils/GuidedSetup/ServiceMonitorRecords";
import {
  actionLineText,
  actionTitleText,
} from "../../../../Helpers/AIActionText";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * "SET UP MONITORING FOR THE CHECKOUT SERVICE" (#7243).
 *
 * set_up_service_monitor makes one of the monitors the telemetry guided
 * setup recommends for a service - one call each, so each is a line of the
 * card the person can skip - built with the Recommendations tab's own plan
 * (Common's ServiceMonitorRecords), so it is the monitor the guided setup
 * and the tab make, and they count it as covered. Each opens an alert, for
 * the team. A service that does not exist or sends nothing yet, a monitor
 * of data the project does not send, one the service has already, and a
 * plan with no room are said before any card.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "72430000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("72430000-0000-4000-8000-000000000002");
const SERVICE_ID: string = "72430000-0000-4000-8000-000000000003";
const OPERATIONAL_ID: string = "72430000-0000-4000-8000-000000000004";
const OFFLINE_ID: string = "72430000-0000-4000-8000-000000000005";
const INCIDENT_SEVERITY_ID: string = "72430000-0000-4000-8000-000000000006";
const ALERT_SEVERITY_ID: string = "72430000-0000-4000-8000-000000000007";
const MONITOR_ID: string = "72430000-0000-4000-8000-000000000008";

const ctx: ToolContext = {
  projectId: PROJECT_ID,
  props: { userId: USER_ID, tenantId: PROJECT_ID },
};

type Spy = jest.SpyInstance;

afterEach(() => {
  jest.restoreAllMocks();
});

function model<T>(type: { new (): T }, values: Record<string, unknown>): T {
  const record: T = new type();
  Object.assign(record as unknown as Record<string, unknown>, values);
  return record;
}

const DEFAULTS: {
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
} = {
  onlineMonitorStatusId: new ObjectID(OPERATIONAL_ID),
  offlineMonitorStatusId: new ObjectID(OFFLINE_ID),
  defaultMonitorStatusId: new ObjectID(OPERATIONAL_ID),
  defaultIncidentSeverityId: new ObjectID(INCIDENT_SEVERITY_ID),
  defaultAlertSeverityId: new ObjectID(ALERT_SEVERITY_ID),
};

/*
 * The project: its checkout service (reported, unless told), its first
 * data, its statuses and severities, and its monitors of a type.
 */
function project(data?: {
  service?: Service | null;
  reached?: Array<ActivationMilestone>;
  monitors?: Array<Monitor>;
}): { monitors: Spy } {
  jest.spyOn(ServiceService, "findOneBy").mockResolvedValue(
    (data?.service === undefined
      ? model(Service, {
          _id: SERVICE_ID,
          name: "checkout",
          lastSeenAt: new Date(),
        })
      : data.service) as never,
  );
  jest.spyOn(ProjectMilestoneService, "findBy").mockResolvedValue(
    (
      data?.reached || [
        ActivationMilestone.FirstTracesReceived,
        ActivationMilestone.FirstMetricsReceived,
      ]
    ).map((milestone: ActivationMilestone) => {
      return model(ProjectMilestone, { milestone: milestone });
    }) as never,
  );
  jest
    .spyOn(MonitorStatusService, "findBy")
    .mockResolvedValue([
      model(MonitorStatus, { _id: OPERATIONAL_ID, isOperationalState: true }),
      model(MonitorStatus, { _id: OFFLINE_ID, isOfflineState: true }),
    ] as never);
  jest
    .spyOn(IncidentSeverityService, "findBy")
    .mockResolvedValue([
      model(IncidentSeverity, { _id: INCIDENT_SEVERITY_ID }),
    ] as never);
  jest
    .spyOn(AlertSeverityService, "findBy")
    .mockResolvedValue([
      model(AlertSeverity, { _id: ALERT_SEVERITY_ID }),
    ] as never);

  return {
    monitors: jest
      .spyOn(MonitorService, "findBy")
      .mockResolvedValue((data?.monitors || []) as never),
  };
}

/*
 * A record as JSON, the ids its steps and criteria generate for themselves
 * numbered in the order they appear, and the project's own kept.
 */
function withGeneratedIdsNumbered(record: unknown): unknown {
  const kept: ReadonlySet<string> = new Set<string>([
    SERVICE_ID,
    OPERATIONAL_ID,
    OFFLINE_ID,
    INCIDENT_SEVERITY_ID,
    ALERT_SEVERITY_ID,
  ]);
  const numbered: Map<string, string> = new Map<string, string>();

  return JSON.parse(
    JSON.stringify(record).replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
      (uuid: string): string => {
        if (kept.has(uuid)) {
          return uuid;
        }

        if (!numbered.has(uuid)) {
          numbered.set(uuid, `generated-${numbered.size + 1}`);
        }

        return numbered.get(uuid)!;
      },
    ),
  );
}

// The monitor the guided setup and the Recommendations tab make for it.
function recommendedMonitor(templateId: string): Monitor {
  const item: MonitorRecommendationCreatePlanItem = buildServiceMonitorPlan({
    service: { id: SERVICE_ID, name: "checkout" },
    recommendations: [getServiceRecommendation(templateId)!],
    recommendationIds: [getServiceRecommendation(templateId)!.recommendationId],
    defaults: DEFAULTS,
  })[0]!;
  item.monitor._id = MONITOR_ID;
  return item.monitor;
}

describe("reading which monitor", () => {
  test("each word names one of the telemetry guided setup's templates", () => {
    expect(Object.values(SERVICE_MONITOR_TEMPLATES).sort()).toEqual(
      TELEMETRY_RECOMMENDED_TEMPLATES.map(
        (template: { templateId: string }): string => {
          return template.templateId;
        },
      ).sort(),
    );
    expect(readServiceMonitorTemplate({ monitor: "Errors" })).toBe(
      "service-error-burst",
    );
    expect(readServiceMonitorTemplate({ monitor: "cpu" })).toBeNull();
  });

  test("a plan counts each of a service's monitors toward the plan's room", () => {
    expect(
      countMonitorsSetUpInPlan([
        {
          name: SET_UP_WEBSITE_MONITORING_TOOL_NAME,
          arguments: { address: "example.com" },
        },
        {
          name: SET_UP_SERVICE_MONITOR_TOOL_NAME,
          arguments: { service: "checkout", monitor: "errors" },
        },
        {
          name: SET_UP_SERVICE_MONITOR_TOOL_NAME,
          arguments: { service: "checkout", monitor: "slow_requests" },
        },
        // Names no monitor: never made, so never counted.
        {
          name: SET_UP_SERVICE_MONITOR_TOOL_NAME,
          arguments: { service: "checkout" },
        },
      ]),
    ).toBe(3);
  });
});

describe("the card", () => {
  test("names the monitor as it will be called, and that it opens an alert for the team", async () => {
    project();

    const prepared: PreparedMutation =
      await SetUpServiceMonitorTool.prepareMutation!(
        { service: "Checkout", monitor: "errors" },
        ctx,
      );

    expect(actionTitleText(prepared.title)).toBe(
      'Create monitor "checkout - Error Burst"',
    );
    expect(actionLineText(prepared.description)).toBe(
      "It reads the data checkout sends and opens an alert for your team: alerts never appear on a status page.",
    );
    expect(prepared.arguments).toEqual({
      service: "checkout",
      monitor: "errors",
      serviceId: SERVICE_ID,
    });
    for (const sentence of prepared.description || []) {
      expect(isKnownAIActionSentence(sentence)).toBe(true);
    }
  });

  test("its title before the service is read names the monitor by the template", () => {
    expect(
      actionTitleText(
        SetUpServiceMonitorTool.buildActionTitle!({
          service: "checkout",
          monitor: "slow_requests",
        }),
      ),
    ).toBe('Create monitor "checkout - High Request Latency (p95)"');
    expect(actionTitleText(SetUpServiceMonitorTool.buildActionTitle!({}))).toBe(
      "Create a recommended monitor for a service",
    );
  });
});

describe("asked before the card", () => {
  test("a monitor that is none of the four is not proposed", async () => {
    expect(
      (
        await SetUpServiceMonitorTool.checkBeforeApproval!(
          { service: "checkout", monitor: "cpu" },
          ctx,
        )
      )?.toldModel,
    ).toContain(
      "name the recommended monitor - errors, slow_requests, exceptions, error_logs",
    );
  });

  test("a service the project does not have, or that sends nothing yet, is not proposed", async () => {
    project({ service: null });
    expect(
      (
        await SetUpServiceMonitorTool.checkBeforeApproval!(
          { service: "billing", monitor: "errors" },
          ctx,
        )
      )?.toldModel,
    ).toContain('"billing" is no service of this project that sends telemetry');

    jest.restoreAllMocks();
    project({
      service: model(Service, { _id: SERVICE_ID, name: "checkout" }),
    });
    expect(
      (
        await SetUpServiceMonitorTool.checkBeforeApproval!(
          { service: "checkout", monitor: "errors" },
          ctx,
        )
      )?.toldModel,
    ).toContain('the service "checkout" has not sent any data yet');
  });

  test("a monitor of data the project does not send would never fire: not proposed, and the ones it can feed are named", async () => {
    project({ reached: [ActivationMilestone.FirstTracesReceived] });

    const refused: SetupActionRefusal | null =
      await SetUpServiceMonitorTool.checkBeforeApproval!(
        { service: "checkout", monitor: "error_logs" },
        ctx,
      );

    expect(refused?.toldModel).toContain(
      'the "Error Log Spike" monitor reads logs, which this project has not sent yet, so it would never fire. The monitors its data feeds now: errors, exceptions.',
    );
  });

  test("first data that cannot be read offers the setup's three, as the guided setup does", async () => {
    project();
    jest
      .spyOn(ProjectMilestoneService, "findBy")
      .mockRejectedValue(new Error("down") as never);
    jest
      .spyOn(PayAsYouGoBillingService, "canUsePayAsYouGo")
      .mockResolvedValue(true as never);
    jest
      .spyOn(ActiveMonitorLimit, "getRefusal")
      .mockResolvedValue(null as never);

    expect(
      await SetUpServiceMonitorTool.checkBeforeApproval!(
        { service: "checkout", monitor: "exceptions" },
        ctx,
      ),
    ).toBeNull();
    expect(
      (
        await SetUpServiceMonitorTool.checkBeforeApproval!(
          { service: "checkout", monitor: "error_logs" },
          ctx,
        )
      )?.toldModel,
    ).toContain("would never fire");
  });

  test("a service watched this way already is not proposed again: the recommendation's fingerprint, as its Recommendations tab tells", async () => {
    const reads: { monitors: Spy } = project({
      monitors: [recommendedMonitor("service-error-burst")],
    });

    const refused: SetupActionRefusal | null =
      await SetUpServiceMonitorTool.checkBeforeApproval!(
        { service: "checkout", monitor: "errors" },
        ctx,
      );

    expect(refused?.toldModel).toContain(
      'the monitor "checkout - Error Burst" already watches "checkout" this way, so no second one is made',
    );
    // The project's monitors of its type, as the person reads them.
    const read: { query: JSONObject; props: unknown } = reads.monitors.mock
      .calls[0]![0] as { query: JSONObject; props: unknown };
    expect(read.props).toBe(ctx.props);
    expect(read.query["monitorType"]).toBe(MonitorType.Traces);
  });

  test("a plan with no room for every monitor it sets up is told the plan's own sentence", async () => {
    project();
    jest
      .spyOn(PayAsYouGoBillingService, "canUsePayAsYouGo")
      .mockResolvedValue(true as never);
    const room: Spy = jest
      .spyOn(ActiveMonitorLimit, "getRefusal")
      .mockResolvedValue(
        "This project has 4 active monitors and the Free plan allows 5, so it has room for 1 more, not 2." as never,
      );

    const refused: SetupActionRefusal | null =
      await SetUpServiceMonitorTool.checkBeforeApproval!(
        { service: "checkout", monitor: "errors" },
        {
          ...ctx,
          plannedCalls: [
            {
              name: SET_UP_SERVICE_MONITOR_TOOL_NAME,
              arguments: { service: "checkout", monitor: "errors" },
            },
            {
              name: SET_UP_SERVICE_MONITOR_TOOL_NAME,
              arguments: { service: "checkout", monitor: "slow_requests" },
            },
          ],
        },
      );

    expect(refused?.refusal).toBe(AIToolRefusal.Plan);
    expect(refused?.toldModel).toContain("so it has room for 1 more, not 2.");
    expect(room).toHaveBeenCalledWith({ projectId: PROJECT_ID, adding: 2 });
  });
});

describe("approved", () => {
  test("it creates the Recommendations tab's own monitor, as the person, opening an alert", async () => {
    project();
    const create: Spy = jest
      .spyOn(MonitorService, "create")
      .mockImplementation((async (args: {
        data: Monitor;
      }): Promise<Monitor> => {
        args.data._id = MONITOR_ID;
        return args.data;
      }) as never);

    const result: ToolExecutionResult = await SetUpServiceMonitorTool.execute(
      { service: "checkout", monitor: "errors", serviceId: SERVICE_ID },
      ctx,
    );

    const made: { data: Monitor; miscDataProps: JSONObject; props: unknown } =
      create.mock.calls[0]![0] as {
        data: Monitor;
        miscDataProps: JSONObject;
        props: unknown;
      };
    const expected: Monitor = recommendedMonitor("service-error-burst");

    expect(made.props).toBe(ctx.props);
    expect(made.data.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(made.data.name).toBe("checkout - Error Burst");
    expect(made.data.monitorType).toBe(expected.monitorType);
    expect(made.data.description).toBe(expected.description);
    expect(withGeneratedIdsNumbered(made.data.monitorSteps?.toJSON())).toEqual(
      withGeneratedIdsNumbered(expected.monitorSteps?.toJSON()),
    );
    expect(made.miscDataProps).toEqual({});

    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.MonitorView,
      params: { monitorId: MONITOR_ID },
    });
    expect(result.dataForLlm).toContain(
      'Created the monitor "checkout - Error Burst" for the service "checkout"',
    );
    expect(result.dataForLlm).toContain("It opens an alert for the team");
    expect(describeAIActionCardWords(result.widget!.data.words!)).toEqual({
      kind: AI_ACTION_CARD_KINDS.monitor,
      line: "Opens alerts for your team",
      facts: [],
    });
  });

  test("approved after the service got that monitor elsewhere, it makes no second one", async () => {
    project({ monitors: [recommendedMonitor("service-error-burst")] });
    const create: Spy = jest.spyOn(MonitorService, "create");

    await expect(
      SetUpServiceMonitorTool.execute(
        { service: "checkout", monitor: "errors" },
        ctx,
      ),
    ).rejects.toThrow("already watches");
    expect(create).not.toHaveBeenCalled();
  });
});

test("it is a setup action of the toolbox, run with the monitors of a plan", () => {
  expect(AIToolbox.getToolByName(SET_UP_SERVICE_MONITOR_TOOL_NAME)).toBe(
    SetUpServiceMonitorTool,
  );
  expect(
    AIToolbox.getSetupPlanOrder(SET_UP_SERVICE_MONITOR_TOOL_NAME),
  ).toBeGreaterThan(AIToolbox.getSetupPlanOrder("set_up_paging"));
  expect(
    AIToolbox.getSetupPlanOrder(SET_UP_SERVICE_MONITOR_TOOL_NAME),
  ).toBeLessThan(AIToolbox.getSetupPlanOrder("publish_status_page"));
});
