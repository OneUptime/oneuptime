import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { AIChatCitationTargetType } from "../../../../../Types/AI/AIChatTypes";
import {
  ASK_AI_RECORD_KINDS,
  AskAiRecordKind,
} from "../../../../../Types/AI/AskAiRecordPages";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import Permission from "../../../../../Types/Permission";
import ProductKey from "../../../../../Types/Product/ProductKey";
import {
  ServerProductOffReason,
  ServerProductsOff,
} from "../../../../../Types/Product/ServerProducts";
import ServerProducts from "../../../../../Server/Utils/ServerProducts/ServerProducts";
import {
  DASHBOARD_RECORD_READERS,
  readDashboardRecordName,
} from "../../../../../Server/Utils/AI/Docs/DashboardRecordReaders";
import {
  FIND_DASHBOARD_PAGE_TOOL_NAME,
  FindDashboardPageTool,
} from "../../../../../Server/Utils/AI/Toolbox/DocsTools";
import AIToolbox, {
  ToolCallOutcome,
} from "../../../../../Server/Utils/AI/Toolbox/Index";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../../Server/Utils/AI/Toolbox/ToolTypes";
import AlertService from "../../../../../Server/Services/AlertService";
import DashboardService from "../../../../../Server/Services/DashboardService";
import FormService from "../../../../../Server/Services/FormService";
import IncidentService from "../../../../../Server/Services/IncidentService";
import IncomingCallPolicyService from "../../../../../Server/Services/IncomingCallPolicyService";
import MonitorService from "../../../../../Server/Services/MonitorService";
import OnCallDutyPolicyScheduleService from "../../../../../Server/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService from "../../../../../Server/Services/OnCallDutyPolicyService";
import RunbookService from "../../../../../Server/Services/RunbookService";
import ScheduledMaintenanceService from "../../../../../Server/Services/ScheduledMaintenanceService";
import ServiceLevelObjectiveService from "../../../../../Server/Services/ServiceLevelObjectiveService";
import ServiceService from "../../../../../Server/Services/ServiceService";
import StatusPageService from "../../../../../Server/Services/StatusPageService";
import TeamService from "../../../../../Server/Services/TeamService";
import WorkflowService from "../../../../../Server/Services/WorkflowService";

/*
 * ASK AI OPENS ONE RECORD'S OWN PAGE (#7065), ONLY FOR SOMEONE WHO MAY
 * OPEN THAT RECORD. "How do I put this status page on my own domain?" ends
 * with that status page's Custom Domains: find_dashboard_page takes the
 * record's kind and id, reads the record with the asker's own props, and
 * cites the page of it they asked for. A record they may not read, one of
 * a product switched off on the server, or an id that is not one opens
 * nothing, and the model is told nothing of whether such a record exists.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const STATUS_PAGE_ID: string = "33333333-3333-4333-8333-333333333333";

const propsFor: (
  permissions: Array<Permission>,
) => DatabaseCommonInteractionProps = (
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps => {
  return {
    tenantId: PROJECT_ID,
    userId: USER_ID,
    userGlobalAccessPermission: {
      globalPermissions: [Permission.Public],
      projectIds: [PROJECT_ID],
      _type: "UserGlobalAccessPermission",
    },
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        projectId: PROJECT_ID,
        permissions: permissions.map((permission: Permission) => {
          return {
            permission,
            labelIds: [],
            isBlockPermission: false,
            _type: "UserPermission" as const,
          };
        }),
        _type: "UserTenantAccessPermission",
      },
    },
  } as unknown as DatabaseCommonInteractionProps;
};

const contextFor: (permissions: Array<Permission>) => ToolContext = (
  permissions: Array<Permission>,
): ToolContext => {
  return { projectId: PROJECT_ID, props: propsFor(permissions) };
};

const MEMBER: ToolContext = contextFor([Permission.ProjectMember]);

type FindOneById = (args: {
  id: ObjectID;
  select: JSONObject;
  props: DatabaseCommonInteractionProps;
}) => Promise<unknown>;

// The service each kind is read through.
const SERVICE_OF_KIND: Record<AskAiRecordKind, unknown> = {
  [AskAiRecordKind.StatusPage]: StatusPageService,
  [AskAiRecordKind.Monitor]: MonitorService,
  [AskAiRecordKind.Incident]: IncidentService,
  [AskAiRecordKind.Alert]: AlertService,
  [AskAiRecordKind.OnCallPolicy]: OnCallDutyPolicyService,
  [AskAiRecordKind.OnCallSchedule]: OnCallDutyPolicyScheduleService,
  [AskAiRecordKind.IncomingCallPolicy]: IncomingCallPolicyService,
  [AskAiRecordKind.MaintenanceEvent]: ScheduledMaintenanceService,
  [AskAiRecordKind.Service]: ServiceService,
  [AskAiRecordKind.Team]: TeamService,
  [AskAiRecordKind.Workflow]: WorkflowService,
  [AskAiRecordKind.Dashboard]: DashboardService,
  [AskAiRecordKind.Runbook]: RunbookService,
  [AskAiRecordKind.Slo]: ServiceLevelObjectiveService,
  [AskAiRecordKind.Form]: FormService,
};

const readsOf: (
  kind: AskAiRecordKind,
  answer: (args: Parameters<FindOneById>[0]) => Promise<unknown>,
) => ReturnType<typeof jest.fn> = (
  kind: AskAiRecordKind,
  answer: (args: Parameters<FindOneById>[0]) => Promise<unknown>,
): ReturnType<typeof jest.fn> => {
  const read: ReturnType<typeof jest.fn> = jest.fn(answer as never);
  jest
    .spyOn(SERVICE_OF_KIND[kind] as { findOneById: FindOneById }, "findOneById")
    .mockImplementation(read as unknown as FindOneById);
  return read;
};

const switchOff: (off: ServerProductsOff) => void = (
  off: ServerProductsOff,
): void => {
  jest.spyOn(ServerProducts, "getOff").mockResolvedValue(off);
};

const findPage: (
  args: JSONObject,
  ctx?: ToolContext,
) => Promise<ToolExecutionResult> = (
  args: JSONObject,
  ctx?: ToolContext,
): Promise<ToolExecutionResult> => {
  return FindDashboardPageTool.execute(args, ctx || MEMBER);
};

beforeEach(() => {
  switchOff({});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("find_dashboard_page and one record's own page", () => {
  test("a status page the person may open: its citation opens that status page's Custom Domains", async () => {
    const read: ReturnType<typeof jest.fn> = readsOf(
      AskAiRecordKind.StatusPage,
      async () => {
        return { name: "Acme Status" };
      },
    );

    const result: ToolExecutionResult = await findPage({
      query: "Custom Domains",
      recordType: "status-pages",
      recordId: STATUS_PAGE_ID,
    });

    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.DashboardPage,
      params: {
        path: "/dashboard/:projectId/status-pages/:id/domains",
        title: "Custom Domains",
        recordId: STATUS_PAGE_ID,
        recordTitle: "Acme Status",
      },
    });
    expect(result.citationLabel).toBe(
      "Page: Status Page > Branding > Custom Domains",
    );
    expect(result.rowCount).toBeGreaterThan(0);

    const data: JSONObject = JSON.parse(result.dataForLlm) as JSONObject;
    expect(data["record"]).toEqual({
      kind: "status-pages",
      name: "Acme Status",
    });
    expect(String(data["citationOpens"])).toBe(
      'Status Page "Acme Status" > Branding > Custom Domains',
    );
    // The model is told the page by name, never an address to write.
    expect(result.dataForLlm).not.toContain("/dashboard/");

    expect(read).toHaveBeenCalledTimes(1);
  });

  test("reads the record with the asker's own props, never as OneUptime", async () => {
    const read: ReturnType<typeof jest.fn> = readsOf(
      AskAiRecordKind.StatusPage,
      async () => {
        return { name: "Acme Status" };
      },
    );

    await findPage({
      query: "SSO",
      recordType: "status-pages",
      recordId: STATUS_PAGE_ID,
    });

    const args: Parameters<FindOneById>[0] = read.mock
      .calls[0]![0] as Parameters<FindOneById>[0];
    expect(args.id.toString()).toBe(STATUS_PAGE_ID);
    expect(args.props).toBe(MEMBER.props);
    expect(args.props.isRoot).toBeFalsy();
  });

  test("a record the person may not read opens nothing, and says nothing of whether it exists", async () => {
    readsOf(AskAiRecordKind.StatusPage, async () => {
      return null;
    });

    const result: ToolExecutionResult = await findPage({
      query: "Custom Domains",
      recordType: "status-pages",
      recordId: STATUS_PAGE_ID,
    });

    expect(result.citationTarget).toBeUndefined();
    expect(result.rowCount).toBe(0);
    expect(result.dataForLlm).toContain("cannot open a status page");
    expect(result.dataForLlm).toContain("say nothing of whether it exists");
  });

  test("a read the permission layer refuses opens nothing either", async () => {
    readsOf(AskAiRecordKind.Monitor, async () => {
      throw new NotAuthorizedException("You do not have permission.");
    });

    const result: ToolExecutionResult = await findPage({
      query: "Criteria",
      recordType: "monitors",
      recordId: STATUS_PAGE_ID,
    });

    expect(result.citationTarget).toBeUndefined();
    expect(result.dataForLlm).not.toContain("permission");
  });

  test("a run with no person behind it opens no record's page, and reads nothing", async () => {
    const read: ReturnType<typeof jest.fn> = readsOf(
      AskAiRecordKind.StatusPage,
      async () => {
        return { name: "Acme Status" };
      },
    );

    const result: ToolExecutionResult = await findPage(
      {
        query: "Custom Domains",
        recordType: "status-pages",
        recordId: STATUS_PAGE_ID,
      },
      {
        projectId: PROJECT_ID,
        props: { isRoot: true, tenantId: PROJECT_ID },
      },
    );

    expect(result.citationTarget).toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });

  test.each([
    ["not-a-kind", STATUS_PAGE_ID],
    ["StatusPage", STATUS_PAGE_ID],
    [undefined, STATUS_PAGE_ID],
  ])(
    "a recordType that is none (%s) opens nothing and reads nothing",
    async (recordType: string | undefined, recordId: string) => {
      const read: ReturnType<typeof jest.fn> = readsOf(
        AskAiRecordKind.StatusPage,
        async () => {
          return { name: "Acme Status" };
        },
      );

      const result: ToolExecutionResult = await findPage({
        query: "Custom Domains",
        ...(recordType ? { recordType } : {}),
        recordId,
      });

      expect(result.citationTarget).toBeUndefined();
      expect(result.dataForLlm).toContain("Error: recordType must be one of");
      expect(read).not.toHaveBeenCalled();
    },
  );

  test.each([
    "",
    "123",
    "../../settings",
    "33333333-3333-4333-8333-33333333333g",
  ])(
    "a recordId that is no record's ID (%p) opens nothing and reads nothing",
    async (recordId: string) => {
      const read: ReturnType<typeof jest.fn> = readsOf(
        AskAiRecordKind.StatusPage,
        async () => {
          return { name: "Acme Status" };
        },
      );

      const result: ToolExecutionResult = await findPage({
        query: "Custom Domains",
        recordType: "status-pages",
        recordId,
      });

      expect(result.citationTarget).toBeUndefined();
      expect(result.dataForLlm).toContain("Error: recordId must be");
      expect(read).not.toHaveBeenCalled();
    },
  );

  test("a page no record of the kind has opens nothing, and says to try its menu's name", async () => {
    readsOf(AskAiRecordKind.StatusPage, async () => {
      return { name: "Acme Status" };
    });

    const result: ToolExecutionResult = await findPage({
      query: "zzqx flux capacitor",
      recordType: "status-pages",
      recordId: STATUS_PAGE_ID,
    });

    expect(result.citationTarget).toBeUndefined();
    expect(result.dataForLlm).toContain("No page of a status page");
  });

  test("a section, as a result named it, finds the page in it", async () => {
    readsOf(AskAiRecordKind.StatusPage, async () => {
      return { name: "Acme Status" };
    });

    const result: ToolExecutionResult = await findPage({
      query: "Custom Domains",
      place: "Branding",
      recordType: "status-pages",
      recordId: STATUS_PAGE_ID,
    });

    expect(result.citationTarget?.params?.["path"]).toBe(
      "/dashboard/:projectId/status-pages/:id/domains",
    );
  });

  test("an incident is named by its number and its title, as its page heads it", async () => {
    readsOf(AskAiRecordKind.Incident, async () => {
      return {
        title: "Checkout down",
        incidentNumber: 42,
        incidentNumberWithPrefix: "INC-42",
      };
    });

    const result: ToolExecutionResult = await findPage({
      query: "Postmortem",
      recordType: "incidents",
      recordId: STATUS_PAGE_ID,
    });

    expect(result.citationTarget?.params).toEqual(
      expect.objectContaining({
        path: "/dashboard/:projectId/incidents/:id/postmortem",
        recordTitle: "INC-42 Checkout down",
      }),
    );
  });

  test("a record with no name still opens its page, with no name beside its button", async () => {
    readsOf(AskAiRecordKind.Team, async () => {
      return { name: "  " };
    });

    const result: ToolExecutionResult = await findPage({
      query: "Members",
      recordType: "teams",
      recordId: STATUS_PAGE_ID,
    });

    expect(result.citationTarget?.params?.["recordId"]).toBe(STATUS_PAGE_ID);
    expect(result.citationTarget?.params?.["recordTitle"]).toBeUndefined();
  });
});

describe("never a page of a product switched off on the server", () => {
  test("a record of a product switched off opens nothing, and says who can switch it on", async () => {
    switchOff({ [ProductKey.StatusPages]: ServerProductOffReason.SwitchedOff });
    readsOf(AskAiRecordKind.StatusPage, async () => {
      return { name: "Acme Status" };
    });

    const result: ToolExecutionResult = await findPage({
      query: "Custom Domains",
      recordType: "status-pages",
      recordId: STATUS_PAGE_ID,
    });

    expect(result.citationTarget).toBeUndefined();
    expect(result.dataForLlm).toContain(
      "Status Pages is switched off on this server",
    );
    expect(result.dataForLlm).toContain("end the answer without a page");
  });

  test("a page of the project of a product switched off opens nothing", async () => {
    switchOff({ [ProductKey.Monitors]: ServerProductOffReason.SwitchedOff });

    const result: ToolExecutionResult = await findPage({
      query: "Create Monitor",
    });

    expect(result.citationTarget).toBeUndefined();
    expect(result.dataForLlm).toContain(
      "Monitors is switched off on this server",
    );
  });

  test("a guided setup that needs a product switched off opens nothing", async () => {
    switchOff({ [ProductKey.OnCall]: ServerProductOffReason.SwitchedOff });

    const result: ToolExecutionResult = await findPage({
      query: "Know when my website is down",
    });

    expect(result.citationTarget).toBeUndefined();
  });

  test("a page of no product, or of one that is on, opens as before", async () => {
    switchOff({ [ProductKey.Monitors]: ServerProductOffReason.SwitchedOff });

    for (const query of ["Notification Methods", "Declare Incident"]) {
      const result: ToolExecutionResult = await findPage({ query });
      expect(result.citationTarget).toBeDefined();
    }
  });

  test("the pages listed beside the one it opens leave out those of a product switched off", async () => {
    switchOff({ [ProductKey.Alerts]: ServerProductOffReason.SwitchedOff });

    const result: ToolExecutionResult = await findPage({
      query: "Custom Fields",
    });
    const data: JSONObject = JSON.parse(result.dataForLlm) as JSONObject;
    const places: Array<string> = (
      data["pages"] as Array<{ where: string }>
    ).map((page: { where: string }): string => {
      return page.where;
    });

    expect(places.length).toBeGreaterThan(0);
    expect(
      places.filter((place: string): boolean => {
        return place.startsWith("Alerts");
      }),
    ).toEqual([]);
  });
});

describe("every kind Ask AI opens is read with the person's own permissions", () => {
  test.each([...ASK_AI_RECORD_KINDS])(
    "%s is read through its own service, with the asker's props",
    async (kind: AskAiRecordKind) => {
      const read: ReturnType<typeof jest.fn> = readsOf(kind, async () => {
        return { name: "Named", title: "Named" };
      });
      const props: DatabaseCommonInteractionProps = MEMBER.props;

      const name: string | null = await readDashboardRecordName({
        kind,
        id: new ObjectID(STATUS_PAGE_ID),
        props,
      });

      expect(name).toBe("Named");
      expect(read).toHaveBeenCalledTimes(1);
      expect((read.mock.calls[0]![0] as Parameters<FindOneById>[0]).props).toBe(
        props,
      );
      expect(typeof DASHBOARD_RECORD_READERS[kind]).toBe("function");
    },
  );

  test.each([...ASK_AI_RECORD_KINDS])(
    "%s: a record the person may not read is null",
    async (kind: AskAiRecordKind) => {
      readsOf(kind, async () => {
        return null;
      });

      expect(
        await readDashboardRecordName({
          kind,
          id: new ObjectID(STATUS_PAGE_ID),
          props: MEMBER.props,
        }),
      ).toBeNull();
    },
  );
});

describe("find_dashboard_page's arguments for a record", () => {
  test("offers the model every kind it opens, by name, and asks for an ID it read", () => {
    const properties: JSONObject = FindDashboardPageTool.inputSchema[
      "properties"
    ] as JSONObject;
    const recordType: JSONObject = properties["recordType"] as JSONObject;

    expect(recordType["enum"]).toEqual([...ASK_AI_RECORD_KINDS]);
    expect(
      String((properties["recordId"] as JSONObject)["description"]),
    ).toContain("Never guess one");
    expect(FindDashboardPageTool.inputSchema["required"]).toEqual(["query"]);
  });

  test("runs through the toolbox's gate for a viewer, reading as the viewer", async () => {
    const viewer: ToolContext = contextFor([Permission.Viewer]);
    const read: ReturnType<typeof jest.fn> = readsOf(
      AskAiRecordKind.OnCallPolicy,
      async () => {
        return { name: "Primary" };
      },
    );

    const outcome: ToolCallOutcome = await AIToolbox.executeTool({
      name: FIND_DASHBOARD_PAGE_TOOL_NAME,
      args: {
        query: "Escalation Rules",
        recordType: "on-call-policies",
        recordId: STATUS_PAGE_ID,
      },
      ctx: viewer,
    });

    expect(outcome.success).toBe(true);
    expect(outcome.textForLlm).toContain("Escalation Rules");
    expect((read.mock.calls[0]![0] as Parameters<FindOneById>[0]).props).toBe(
      viewer.props,
    );
  });
});
