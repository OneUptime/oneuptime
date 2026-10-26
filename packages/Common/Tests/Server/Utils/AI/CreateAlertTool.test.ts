import {
  AlertSeverityChoice,
  CreateAlertTool,
  pickAlertSeverity,
} from "../../../../Server/Utils/AI/Toolbox/AlertWriteTools";
import { CreateIncidentTool } from "../../../../Server/Utils/AI/Toolbox/IncidentWriteTools";
import {
  PreparedMutation,
  ToolContext,
  ToolExecutionResult,
} from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import AlertService from "../../../../Server/Services/AlertService";
import AlertSeverityService from "../../../../Server/Services/AlertSeverityService";
import HostService from "../../../../Server/Services/HostService";
import KubernetesClusterService from "../../../../Server/Services/KubernetesClusterService";
import ServiceService from "../../../../Server/Services/ServiceService";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../../Models/DatabaseModels/AlertSeverity";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Host from "../../../../Models/DatabaseModels/Host";
import KubernetesCluster from "../../../../Models/DatabaseModels/KubernetesCluster";
import Service from "../../../../Models/DatabaseModels/Service";
import AIChatPageContextType, {
  AIChatPageContext,
} from "../../../../Types/AI/AIChatPageContext";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import {
  AIResourceSubresourceKind,
  AIResourceType,
} from "../../../../Types/AI/AIResourceContext";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * ISSUE #5301: ASK AI RAISES ALERTS, AS IT DECLARES INCIDENTS.
 *
 * On host test01's page, "Create alert on high ram 75%" was answered with
 * "I don't have a tool available to create new alerts", though the same
 * Ask AI declared incidents there. create_alert is create_incident's twin,
 * and this suite holds the contract around its write rather than the prose
 * handed to the model:
 *
 *   - the alert is created in the request's project, as the person who
 *     asked (ctx.props - never a tool argument), credited to them;
 *   - its severity is one of the project's alert severities - read as the
 *     person, archived ones left out, in the project's order - by name
 *     without regard to case, else the first, and the model is told which
 *     it got and which exist;
 *   - it is linked to what it is about: the resources the call names, or -
 *     raised from a resource's page without naming any - that resource,
 *     each read as the person, what they may not view left out with the
 *     reason; never a monitor;
 *   - before approval, the page's resource and the severity it takes are
 *     written into the arguments the person approves, and the card names
 *     what the IDs stand for; what was approved is what runs;
 *   - every missing input fails loudly instead of writing.
 */

afterEach(() => {
  jest.restoreAllMocks();
});

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const USER_ID: ObjectID = new ObjectID("abababab-abab-4bab-8bab-abababababab");
const ALERT_ID: string = "a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1";
const HOST_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const CLUSTER_ID: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SERVICE_ID: string = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const MONITOR_ID: string = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const HIGH_ID: string = "f1f1f1f1-f1f1-41f1-81f1-f1f1f1f1f1f1";
const LOW_ID: string = "f2f2f2f2-f2f2-42f2-82f2-f2f2f2f2f2f2";

const HOST_PAGE: AIChatPageContext = {
  type: AIChatPageContextType.Resource,
  resourceType: AIResourceType.Host,
  entityId: HOST_ID,
  entityTitle: "test01",
};

const ALERTS_PAGE: AIChatPageContext = {
  type: AIChatPageContextType.AlertsList,
};

function context(pageContext?: AIChatPageContext): ToolContext {
  return {
    projectId: PROJECT_ID,
    props: { userId: USER_ID, tenantId: PROJECT_ID },
    ...(pageContext ? { pageContext } : {}),
  };
}

function severity(id: string, name: string, order: number): AlertSeverity {
  const row: AlertSeverity = new AlertSeverity();
  row._id = id;
  row.name = name;
  row.order = order;
  return row;
}

// A new project's alert severities, in their order.
function projectSeverities(): Array<AlertSeverity> {
  return [severity(HIGH_ID, "High", 1), severity(LOW_ID, "Low", 2)];
}

function mockSeverities(
  severities: Array<AlertSeverity> = projectSeverities(),
): jest.SpyInstance {
  return jest
    .spyOn(AlertSeverityService, "findBy")
    .mockResolvedValue(severities as never);
}

// AlertService.create, answering as the service does: the number it gave.
function mockCreate(data?: {
  alertNumber?: number;
  alertNumberWithPrefix?: string | undefined;
}): jest.SpyInstance {
  return jest.spyOn(AlertService, "create").mockImplementation((async (args: {
    data: Alert;
  }): Promise<Alert> => {
    const created: Alert = args.data;
    created._id = ALERT_ID;
    created.alertNumber = data?.alertNumber ?? 12;

    if (data?.alertNumberWithPrefix !== undefined) {
      created.alertNumberWithPrefix = data.alertNumberWithPrefix;
    } else if (!data) {
      created.alertNumberWithPrefix = "ALT-12";
    }

    return created;
  }) as never);
}

function createdAlert(spy: jest.SpyInstance): Alert {
  return (spy.mock.calls[0]![0] as { data: Alert }).data;
}

function named<T extends BaseModel>(
  modelType: { new (): T },
  id: string,
  name: string,
): T {
  const record: T = new modelType();
  record._id = id;
  (record as unknown as { name: string }).name = name;
  (record as unknown as { isArchived: boolean }).isArchived = false;
  return record;
}

function idsOf(list: Array<BaseModel> | undefined): Array<string> {
  return (list || []).map((record: BaseModel): string => {
    return record.id!.toString();
  });
}

function widgetFields(
  result: ToolExecutionResult,
): Array<{ label: string; value: string }> {
  return (result.widget?.data as JSONObject)["fields"] as unknown as Array<{
    label: string;
    value: string;
  }>;
}

describe("create_alert creates the alert as the person who asked", () => {
  test("pinned to ctx's project and user, under the caller's props, and answered with its number", async () => {
    mockSeverities();
    const create: jest.SpyInstance = mockCreate();
    const ctx: ToolContext = context();

    const result: ToolExecutionResult = await CreateAlertTool.execute(
      {
        title: "High memory usage on test01",
        description: "Memory in use on test01 is at 78%.",
      },
      ctx,
    );

    expect(create).toHaveBeenCalledTimes(1);
    const alert: Alert = createdAlert(create);
    expect(alert.projectId).toBe(PROJECT_ID);
    expect(alert.title).toBe("High memory usage on test01");
    expect(alert.description).toBe("Memory in use on test01 is at 78%.");
    expect(alert.createdByUserId).toBe(USER_ID);
    // The write runs under the caller's props so model-layer RBAC applies.
    expect((create.mock.calls[0]![0] as { props: unknown }).props).toBe(
      ctx.props,
    );

    expect(result.rowCount).toBe(1);
    expect(result.isTruncated).toBe(false);
    expect(result.dataForLlm).toContain(
      'Successfully created alert ALT-12 ("High memory usage on test01", severity High).',
    );
    expect(result.citationLabel).toBe("Created alert ALT-12");
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.AlertView,
      params: { alertId: ALERT_ID },
    });
  });

  test("starts where every new alert starts: it picks no state, raises nothing automatically and links no monitor", async () => {
    mockSeverities();
    const create: jest.SpyInstance = mockCreate();

    await CreateAlertTool.execute(
      {
        title: "High memory usage",
        // What a model could try to slip in: none of it is read.
        currentAlertStateId: ObjectID.generate().toString(),
        monitorId: MONITOR_ID,
        isCreatedAutomatically: true,
      },
      context({
        type: AIChatPageContextType.Monitor,
        entityId: MONITOR_ID,
        entityTitle: "API health",
      }),
    );

    const alert: Alert = createdAlert(create);
    /*
     * AlertService stamps the project's created state; the alert is a
     * person's, so it is never one a monitor raised.
     */
    expect(alert.currentAlertStateId).toBeUndefined();
    expect(alert.currentAlertState).toBeUndefined();
    expect(alert.isCreatedAutomatically).toBeUndefined();
    // Ask AI never links a monitor: that stays a choice on the form.
    expect(alert.monitorId).toBeUndefined();
    expect(alert.monitor).toBeUndefined();
  });

  test("the acting user and the project come from ctx even when the arguments smuggle others", async () => {
    mockSeverities();
    const create: jest.SpyInstance = mockCreate();

    await CreateAlertTool.execute(
      {
        title: "High memory usage",
        userId: ObjectID.generate().toString(),
        createdByUserId: ObjectID.generate().toString(),
        projectId: ObjectID.generate().toString(),
        alertSeverityId: ObjectID.generate().toString(),
      },
      context(),
    );

    const alert: Alert = createdAlert(create);
    expect(alert.createdByUserId).toBe(USER_ID);
    expect(alert.projectId).toBe(PROJECT_ID);
    expect(alert.alertSeverityId?.toString()).toBe(HIGH_ID);
  });

  test("an alert with no prefixed number is named #N, as the dashboard names it", async () => {
    mockSeverities();
    mockCreate({ alertNumber: 7, alertNumberWithPrefix: "" });

    const result: ToolExecutionResult = await CreateAlertTool.execute(
      { title: "High memory usage" },
      context(),
    );

    expect(result.citationLabel).toBe("Created alert #7");
    expect(result.dataForLlm).toContain("Successfully created alert #7");
    expect(widgetFields(result)[0]).toEqual({ label: "Number", value: "#7" });
  });

  test("missing title is a loud BadData error, and nothing is read or written", async () => {
    const severities: jest.SpyInstance = jest.spyOn(
      AlertSeverityService,
      "findBy",
    );
    const create: jest.SpyInstance = jest.spyOn(AlertService, "create");

    for (const args of [{}, { title: "   " }, { title: 42 }]) {
      await expect(
        CreateAlertTool.execute(args as JSONObject, context()),
      ).rejects.toThrow("title is required to create an alert.");
    }

    expect(severities).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  test("refuses to write without an authenticated user in context", async () => {
    const severities: jest.SpyInstance = jest.spyOn(
      AlertSeverityService,
      "findBy",
    );
    const create: jest.SpyInstance = jest.spyOn(AlertService, "create");

    await expect(
      CreateAlertTool.execute(
        { title: "High memory usage" },
        { projectId: PROJECT_ID, props: { isRoot: true } },
      ),
    ).rejects.toThrow(
      "No authenticated user in context; cannot create an alert.",
    );
    expect(severities).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  test("a refusal from the service is the person's own, passed on as it is", async () => {
    mockSeverities();
    jest
      .spyOn(AlertService, "create")
      .mockRejectedValue(
        new NotAuthorizedException(
          "You do not have permissions to create Alert.",
        ) as never,
      );

    await expect(
      CreateAlertTool.execute({ title: "High memory usage" }, context()),
    ).rejects.toThrow("You do not have permissions to create Alert.");
  });
});

describe("create_alert's severity", () => {
  test("defaults to the project's first-ordered severity, read as the person, archived ones left out", async () => {
    const find: jest.SpyInstance = mockSeverities();
    const create: jest.SpyInstance = mockCreate();
    const ctx: ToolContext = context();

    const result: ToolExecutionResult = await CreateAlertTool.execute(
      { title: "High memory usage" },
      ctx,
    );

    const read: JSONObject = find.mock.calls[0]![0] as JSONObject;
    expect(read["query"]).toEqual({ projectId: PROJECT_ID, isArchived: false });
    // Asked for in the project's own order, so "first" means first-defined.
    expect(read["sort"]).toEqual({ order: SortOrder.Ascending });
    expect(read["props"]).toBe(ctx.props);

    expect(createdAlert(create).alertSeverityId?.toString()).toBe(HIGH_ID);
    // It named none, so nothing is said about names it did not ask for.
    expect(result.dataForLlm).not.toContain("No alert severity");
  });

  test("matches a named severity without regard to case or spaces around it", async () => {
    mockSeverities();
    const create: jest.SpyInstance = mockCreate();

    const result: ToolExecutionResult = await CreateAlertTool.execute(
      { title: "High memory usage", severityName: "  low " },
      context(),
    );

    expect(createdAlert(create).alertSeverityId?.toString()).toBe(LOW_ID);
    expect(result.dataForLlm).toContain("severity Low).");
    expect(result.dataForLlm).not.toContain("No alert severity");
  });

  test("a name the project does not have falls back to the first, and the model is told which exist", async () => {
    mockSeverities();
    const create: jest.SpyInstance = mockCreate();

    const result: ToolExecutionResult = await CreateAlertTool.execute(
      { title: "High memory usage", severityName: "Warning" },
      context(),
    );

    expect(createdAlert(create).alertSeverityId?.toString()).toBe(HIGH_ID);
    expect(result.dataForLlm).toContain(
      'No alert severity of this project is named "Warning", so it took the first, High. The project\'s alert severities: High, Low.',
    );
  });

  test("a project with no alert severities is a loud BadData error, not a bad write", async () => {
    mockSeverities([]);
    const create: jest.SpyInstance = jest.spyOn(AlertService, "create");

    await expect(
      CreateAlertTool.execute({ title: "High memory usage" }, context()),
    ).rejects.toThrow(
      "No alert severities are configured for this project. Add one in Alerts > Settings > Alert Severity first.",
    );
    expect(create).not.toHaveBeenCalled();
  });

  test("a person who may not read the severities is refused with the reason, and nothing is written", async () => {
    jest
      .spyOn(AlertSeverityService, "findBy")
      .mockRejectedValue(
        new NotAuthorizedException(
          "You do not have permissions to read Alert Severity.",
        ) as never,
      );
    const create: jest.SpyInstance = jest.spyOn(AlertService, "create");

    await expect(
      CreateAlertTool.execute({ title: "High memory usage" }, context()),
    ).rejects.toThrow("You do not have permissions to read Alert Severity.");
    expect(create).not.toHaveBeenCalled();
  });

  test("pickAlertSeverity: named first, else the first; null for a project with none", () => {
    const severities: Array<AlertSeverity> = projectSeverities();

    const named: AlertSeverityChoice | null = pickAlertSeverity({
      severities,
      severityName: "LOW",
    });
    expect(named?.severity.name).toBe("Low");
    expect(named?.isNamed).toBe(true);

    for (const severityName of [undefined, "", "   ", "Critical"]) {
      const fallback: AlertSeverityChoice | null = pickAlertSeverity({
        severities,
        severityName,
      });
      expect(fallback?.severity.name).toBe("High");
      expect(fallback?.isNamed).toBe(false);
    }

    expect(
      pickAlertSeverity({ severities: [], severityName: "High" }),
    ).toBeNull();
  });
});

describe("create_alert links what the alert is about", () => {
  test("raised from host test01's page, the alert is linked to test01", async () => {
    mockSeverities();
    const create: jest.SpyInstance = mockCreate();
    const hosts: jest.SpyInstance = jest
      .spyOn(HostService, "findBy")
      .mockResolvedValue([named(Host, HOST_ID, "test01")] as never);
    const ctx: ToolContext = context(HOST_PAGE);

    const result: ToolExecutionResult = await CreateAlertTool.execute(
      {
        title: "High memory usage on test01",
        description: "Memory in use on test01 is at 78%.",
      },
      ctx,
    );

    // Linked with the create itself: what the investigation and fixes read.
    expect(idsOf(createdAlert(create).hosts)).toEqual([HOST_ID]);
    // The host was read as the person, in the project.
    const read: JSONObject = hosts.mock.calls[0]![0] as JSONObject;
    expect(read["props"]).toBe(ctx.props);
    expect((read["query"] as JSONObject)["projectId"]).toBe(PROJECT_ID);

    expect(result.dataForLlm).toContain('Linked to: host "test01".');
    expect(result.dataForLlm).not.toContain("add_alert_affected_resources");
    expect(widgetFields(result)).toEqual(
      expect.arrayContaining([
        { label: "Affected resources", value: 'host "test01"' },
      ]),
    );
  });

  test("raised from a Kubernetes pod's page, it is linked to the pod's cluster", async () => {
    mockSeverities();
    const create: jest.SpyInstance = mockCreate();
    jest
      .spyOn(KubernetesClusterService, "findBy")
      .mockResolvedValue([
        named(KubernetesCluster, CLUSTER_ID, "prod-east"),
      ] as never);

    await CreateAlertTool.execute(
      { title: "Pod restarting" },
      context({
        type: AIChatPageContextType.Resource,
        resourceType: AIResourceType.KubernetesCluster,
        entityId: CLUSTER_ID,
        subresource: { kind: AIResourceSubresourceKind.Pod, key: "web-1" },
      }),
    );

    expect(idsOf(createdAlert(create).kubernetesClusters)).toEqual([
      CLUSTER_ID,
    ]);
  });

  test("raised from a telemetry service's page, it is linked to the service", async () => {
    mockSeverities();
    const create: jest.SpyInstance = mockCreate();
    jest
      .spyOn(ServiceService, "findBy")
      .mockResolvedValue([named(Service, SERVICE_ID, "checkout")] as never);

    await CreateAlertTool.execute(
      { title: "Error rate creeping up" },
      context({
        type: AIChatPageContextType.TelemetryService,
        entityId: SERVICE_ID,
        entityTitle: "checkout",
      }),
    );

    expect(idsOf(createdAlert(create).services)).toEqual([SERVICE_ID]);
  });

  test("the resources the call names win over the page", async () => {
    mockSeverities();
    const create: jest.SpyInstance = mockCreate();
    const hosts: jest.SpyInstance = jest.spyOn(HostService, "findBy");
    jest
      .spyOn(KubernetesClusterService, "findBy")
      .mockResolvedValue([
        named(KubernetesCluster, CLUSTER_ID, "prod-east"),
      ] as never);

    await CreateAlertTool.execute(
      {
        title: "Pods crash-looping",
        affectedResources: [
          { resourceType: "KubernetesCluster", resourceId: CLUSTER_ID },
        ],
      },
      context(HOST_PAGE),
    );

    const alert: Alert = createdAlert(create);
    expect(idsOf(alert.kubernetesClusters)).toEqual([CLUSTER_ID]);
    expect(alert.hosts).toBeUndefined();
    expect(hosts).not.toHaveBeenCalled();
  });

  test("an empty list links nothing, even on a resource's page, and the model is told how to link it", async () => {
    mockSeverities();
    const create: jest.SpyInstance = mockCreate();
    const hosts: jest.SpyInstance = jest.spyOn(HostService, "findBy");

    const result: ToolExecutionResult = await CreateAlertTool.execute(
      { title: "Checkout slow", affectedResources: [] },
      context(HOST_PAGE),
    );

    expect(createdAlert(create).hosts).toBeUndefined();
    expect(hosts).not.toHaveBeenCalled();
    expect(result.dataForLlm).toContain(
      "It is linked to no infrastructure or service, and OneUptime AI fixes only what an alert is linked to. When you know what it is about, link it with add_alert_affected_resources.",
    );
  });

  test("off a resource's page, nothing named links nothing, and the card has no Affected resources row", async () => {
    mockSeverities();
    const create: jest.SpyInstance = mockCreate();

    const result: ToolExecutionResult = await CreateAlertTool.execute(
      { title: "Checkout slow" },
      context(ALERTS_PAGE),
    );

    expect(createdAlert(create).hosts).toBeUndefined();
    expect(result.dataForLlm).toContain("add_alert_affected_resources");
    expect(
      widgetFields(result).map((field: { label: string }): string => {
        return field.label;
      }),
    ).toEqual(["Number", "Severity"]);
  });

  test("what the person may not view is left out, the alert is still raised, and the model is told why", async () => {
    mockSeverities();
    const create: jest.SpyInstance = mockCreate();
    jest.spyOn(HostService, "findBy").mockResolvedValue([] as never);
    jest
      .spyOn(ServiceService, "findBy")
      .mockResolvedValue([named(Service, SERVICE_ID, "checkout")] as never);

    const result: ToolExecutionResult = await CreateAlertTool.execute(
      {
        title: "Checkout slow",
        affectedResources: [
          { resourceType: "Host", resourceId: HOST_ID },
          { resourceType: "Service", resourceId: SERVICE_ID },
        ],
      },
      context(),
    );

    const alert: Alert = createdAlert(create);
    expect(alert.hosts).toBeUndefined();
    expect(idsOf(alert.services)).toEqual([SERVICE_ID]);
    expect(result.dataForLlm).toContain('Linked to: service "checkout".');
    expect(result.dataForLlm).toContain(
      `Not linked: No host with ID ${HOST_ID} that the current user may view exists in this project, so it was not linked.`,
    );
  });

  test("a page whose resource an alert cannot be linked to links nothing", async () => {
    mockSeverities();
    const create: jest.SpyInstance = mockCreate();

    await CreateAlertTool.execute(
      { title: "Interface down" },
      context({
        type: AIChatPageContextType.Resource,
        resourceType: AIResourceType.NetworkDevice,
        entityId: HOST_ID,
      }),
    );

    const alert: Alert = createdAlert(create);
    expect(alert.hosts).toBeUndefined();
    expect(alert.services).toBeUndefined();
  });
});

describe("create_alert, prepared for approval", () => {
  test("the page's host and the severity it takes are written into the arguments the person approves, and the host is named on the card", async () => {
    mockSeverities();
    jest
      .spyOn(HostService, "findBy")
      .mockResolvedValue([named(Host, HOST_ID, "test01")] as never);

    const prepared: PreparedMutation = await CreateAlertTool.prepareMutation!(
      { title: "High memory usage on test01" },
      context(HOST_PAGE),
    );

    expect(prepared.arguments).toEqual({
      title: "High memory usage on test01",
      affectedResources: [{ resourceType: "Host", resourceId: HOST_ID }],
      severityName: "High",
    });
    expect(prepared.description).toBe('Linked to host "test01".');
    // buildActionTitle's title stands: it names the alert by its title.
    expect(prepared.title).toBeUndefined();
  });

  test("a severity named in another case is written out as the project names it", async () => {
    mockSeverities();

    const prepared: PreparedMutation = await CreateAlertTool.prepareMutation!(
      { title: "High memory usage", severityName: "low" },
      context(ALERTS_PAGE),
    );

    expect(prepared.arguments).toEqual({
      title: "High memory usage",
      severityName: "Low",
    });
  });

  test("a severity the project does not have is written out as the one it will take", async () => {
    mockSeverities();

    const prepared: PreparedMutation = await CreateAlertTool.prepareMutation!(
      { title: "High memory usage", severityName: "Warning" },
      context(ALERTS_PAGE),
    );

    expect(prepared.arguments["severityName"]).toBe("High");
  });

  test("a call's own list is kept as named, and named on the card", async () => {
    mockSeverities();
    jest
      .spyOn(KubernetesClusterService, "findBy")
      .mockResolvedValue([
        named(KubernetesCluster, CLUSTER_ID, "prod-east"),
      ] as never);

    const args: JSONObject = {
      title: "Pods crash-looping",
      severityName: "Low",
      affectedResources: [
        { resourceType: "KubernetesCluster", resourceId: CLUSTER_ID },
      ],
    };

    const prepared: PreparedMutation = await CreateAlertTool.prepareMutation!(
      args,
      context(HOST_PAGE),
    );

    expect(prepared.arguments).toEqual(args);
    expect(prepared.description).toBe(
      'Linked to Kubernetes cluster "prod-east".',
    );
  });

  test("off a resource's page, only the severity is written out and the card says nothing more", async () => {
    mockSeverities();

    const prepared: PreparedMutation = await CreateAlertTool.prepareMutation!(
      { title: "Checkout slow" },
      context(ALERTS_PAGE),
    );

    expect(prepared.arguments).toEqual({
      title: "Checkout slow",
      severityName: "High",
    });
    expect(prepared.description).toBeUndefined();
  });

  test("a resource the person may not view is flagged on the card before they approve", async () => {
    mockSeverities();
    jest.spyOn(HostService, "findBy").mockResolvedValue([] as never);

    const prepared: PreparedMutation = await CreateAlertTool.prepareMutation!(
      { title: "High memory usage" },
      context(HOST_PAGE),
    );

    expect(prepared.description).toBe(
      "The resources named will not be linked.",
    );
  });

  test("severities the person may not read leave the model's severity as it is, and the prepare never throws", async () => {
    jest
      .spyOn(AlertSeverityService, "findBy")
      .mockRejectedValue(
        new NotAuthorizedException(
          "You do not have permissions to read Alert Severity.",
        ) as never,
      );

    const prepared: PreparedMutation = await CreateAlertTool.prepareMutation!(
      { title: "High memory usage", severityName: "Low" },
      context(ALERTS_PAGE),
    );

    expect(prepared.arguments).toEqual({
      title: "High memory usage",
      severityName: "Low",
    });
  });

  test("a project with no severities writes none out: running the action says why", async () => {
    mockSeverities([]);

    const prepared: PreparedMutation = await CreateAlertTool.prepareMutation!(
      { title: "High memory usage" },
      context(ALERTS_PAGE),
    );

    expect(prepared.arguments).toEqual({ title: "High memory usage" });
  });

  test("it only reads: nothing is created before the person approves", async () => {
    mockSeverities();
    jest
      .spyOn(HostService, "findBy")
      .mockResolvedValue([named(Host, HOST_ID, "test01")] as never);
    const create: jest.SpyInstance = jest.spyOn(AlertService, "create");
    const ctx: ToolContext = context(HOST_PAGE);
    const severities: jest.SpyInstance = jest.spyOn(
      AlertSeverityService,
      "findBy",
    );

    await CreateAlertTool.prepareMutation!({ title: "High memory usage" }, ctx);

    expect(create).not.toHaveBeenCalled();
    // The severities were read as the person, as running it reads them.
    expect((severities.mock.calls[0]![0] as { props: unknown }).props).toBe(
      ctx.props,
    );
  });

  test("what was prepared runs as approved: run later from another page, it links the same host with the same severity", async () => {
    mockSeverities();
    jest
      .spyOn(HostService, "findBy")
      .mockResolvedValue([named(Host, HOST_ID, "test01")] as never);

    const prepared: PreparedMutation = await CreateAlertTool.prepareMutation!(
      { title: "High memory usage", severityName: "LOW" },
      context(HOST_PAGE),
    );

    const create: jest.SpyInstance = mockCreate();

    // Run after approval - from any page: the arguments say it all.
    await CreateAlertTool.execute(prepared.arguments, context(ALERTS_PAGE));

    const alert: Alert = createdAlert(create);
    expect(idsOf(alert.hosts)).toEqual([HOST_ID]);
    expect(alert.alertSeverityId?.toString()).toBe(LOW_ID);
  });
});

describe("create_alert's card in the chat", () => {
  test("names the alert by its number, its severity, what it is linked to, and links to the alert", async () => {
    mockSeverities();
    mockCreate();
    jest
      .spyOn(HostService, "findBy")
      .mockResolvedValue([named(Host, HOST_ID, "test01")] as never);

    const result: ToolExecutionResult = await CreateAlertTool.execute(
      {
        title: "High memory usage on test01",
        description: "Memory in use is at 78%.",
        severityName: "Low",
      },
      context(HOST_PAGE),
    );

    const data: JSONObject = result.widget?.data as JSONObject;
    expect(result.widget?.title).toBe("Alert created");
    expect(data["resourceType"]).toBe("Alert");
    expect(data["heading"]).toBe("ALT-12 · High memory usage on test01");
    expect(data["subheading"]).toBe("Severity: Low");
    expect(data["link"]).toEqual({
      type: AIChatCitationTargetType.AlertView,
      params: { alertId: ALERT_ID },
    });
    expect(widgetFields(result)).toEqual([
      { label: "Number", value: "ALT-12" },
      { label: "Severity", value: "Low" },
      { label: "Affected resources", value: 'host "test01"' },
      { label: "Description", value: "Memory in use is at 78%." },
    ]);
  });

  test("a long description is elided on the card only; the alert keeps all of it", async () => {
    mockSeverities();
    const create: jest.SpyInstance = mockCreate();
    const longDescription: string = "x".repeat(250);

    const result: ToolExecutionResult = await CreateAlertTool.execute(
      { title: "High memory usage", description: longDescription },
      context(),
    );

    const description: { label: string; value: string } | undefined =
      widgetFields(result).find((field: { label: string }): boolean => {
        return field.label === "Description";
      });
    expect(description?.value).toBe(`${"x".repeat(200)}…`);
    expect(createdAlert(create).description).toBe(longDescription);
  });
});

describe("create_alert as a tool", () => {
  test("is a mutation whose permissions are the Alert model's create permissions, as the Create Alert form's", () => {
    expect(CreateAlertTool.name).toBe("create_alert");
    expect(CreateAlertTool.isMutation).toBe(true);
    expect([...CreateAlertTool.requiredPermissions].sort()).toEqual(
      [...new Alert().getCreatePermissions()].sort(),
    );
    expect(CreateAlertTool.requiredPermissions).toContain(
      Permission.CreateAlert,
    );
    // Editing an alert, or changing its state, is not creating one.
    expect(CreateAlertTool.requiredPermissions).not.toContain(
      Permission.EditAlert,
    );
    expect(CreateAlertTool.requiredPermissions).not.toContain(
      Permission.CreateAlertStateTimeline,
    );
    // An incident's permission is not an alert's.
    expect(CreateAlertTool.requiredPermissions).not.toContain(
      Permission.CreateProjectIncident,
    );
  });

  test("buildActionTitle names the alert by its title, or says Untitled", () => {
    expect(
      CreateAlertTool.buildActionTitle!({
        title: "High memory usage on test01",
      }),
    ).toBe("Create alert: High memory usage on test01");
    expect(CreateAlertTool.buildActionTitle!({})).toBe(
      "Create alert: Untitled",
    );
  });

  test("its schema is create_incident's: a title is all it needs, and linking never refuses a create", () => {
    const properties: JSONObject = CreateAlertTool.inputSchema[
      "properties"
    ] as JSONObject;

    expect(CreateAlertTool.inputSchema["type"]).toBe("object");
    expect(CreateAlertTool.inputSchema["required"]).toEqual(["title"]);
    expect(Object.keys(properties).sort()).toEqual(
      Object.keys(
        CreateIncidentTool.inputSchema["properties"] as JSONObject,
      ).sort(),
    );
    expect(properties["affectedResources"]).toEqual(
      (CreateIncidentTool.inputSchema["properties"] as JSONObject)[
        "affectedResources"
      ],
    );
    expect((properties["severityName"] as JSONObject)["description"]).toContain(
      "alert severity",
    );
  });

  test("its description says when an alert fits, what linking does, and that it is no rule", () => {
    const description: string = CreateAlertTool.description;

    expect(description).toContain(
      "for something the team should look into that is not, or not yet, an outage users feel",
    );
    expect(description).toContain(
      "For an outage or a problem users feel, declare an incident with create_incident instead; when the user names one, create that one.",
    );
    expect(description).toContain(
      "OneUptime AI investigates and fixes what an alert is linked to, and nothing else.",
    );
    expect(description).toContain(
      "the alert is linked to that resource unless you pass affectedResources yourself; pass an empty list to link nothing.",
    );
    expect(description).toContain(
      "An alert is raised once, now: it is not a rule and watches nothing.",
    );
  });
});
