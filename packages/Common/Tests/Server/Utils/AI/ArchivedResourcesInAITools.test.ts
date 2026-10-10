import { PageOnCallPolicyTool } from "../../../../Server/Utils/AI/Toolbox/AIActionTools";
import {
  ARCHIVED_MONITOR_NOTE,
  QueryMonitorsTool,
} from "../../../../Server/Utils/AI/Toolbox/MonitorTools";
import {
  ARCHIVED_ON_CALL_POLICY_NOTE,
  GetOnCallStatusTool,
  QueryOnCallPoliciesTool,
} from "../../../../Server/Utils/AI/Toolbox/OnCallTools";
import {
  ARCHIVED_STATUS_PAGE_NOTE,
  QueryStatusPagesTool,
} from "../../../../Server/Utils/AI/Toolbox/StatusPageTools";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import {
  ARCHIVED_WORKFLOW_NOTE,
  QueryWorkflowsTool,
} from "../../../../Server/Utils/AI/Toolbox/WorkflowProbeTools";
import IncidentService from "../../../../Server/Services/IncidentService";
import MonitorOwnerTeamService from "../../../../Server/Services/MonitorOwnerTeamService";
import MonitorOwnerUserService from "../../../../Server/Services/MonitorOwnerUserService";
import MonitorService from "../../../../Server/Services/MonitorService";
import MonitorStatusTimelineService from "../../../../Server/Services/MonitorStatusTimelineService";
import OnCallDutyPolicyEscalationRuleScheduleService from "../../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyEscalationRuleService from "../../../../Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyEscalationRuleTeamService from "../../../../Server/Services/OnCallDutyPolicyEscalationRuleTeamService";
import OnCallDutyPolicyEscalationRuleUserService from "../../../../Server/Services/OnCallDutyPolicyEscalationRuleUserService";
import OnCallDutyPolicyService from "../../../../Server/Services/OnCallDutyPolicyService";
import StatusPageResourceService from "../../../../Server/Services/StatusPageResourceService";
import StatusPageService from "../../../../Server/Services/StatusPageService";
import StatusPageSubscriberService from "../../../../Server/Services/StatusPageSubscriberService";
import WorkflowLogService from "../../../../Server/Services/WorkflowLogService";
import WorkflowService from "../../../../Server/Services/WorkflowService";
import WorkspaceMemberActions, {
  WorkspaceEventType,
} from "../../../../Server/Utils/Workspace/WorkspaceMemberActions";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../../Models/DatabaseModels/MonitorStatus";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleUser from "../../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../../../Models/DatabaseModels/StatusPageResource";
import User from "../../../../Models/DatabaseModels/User";
import Workflow from "../../../../Models/DatabaseModels/Workflow";
import WorkflowLog from "../../../../Models/DatabaseModels/WorkflowLog";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import WorkflowStatus from "../../../../Types/Workflow/WorkflowStatus";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * The AI assistant reads the same resources the dashboard lists, and must
 * treat archived ones the way the dashboard does:
 *
 *   - its list tools leave archived monitors, workflows, status pages and
 *     on-call policies out, as their list pages do - so "what is down right
 *     now?" never names a monitor nobody checks, and the assistant never
 *     plans a status page post or a page around something that is offline;
 *   - read by id, an archived resource is still returned (that is how the
 *     assistant answers "why did this stop?"), flagged as archived, with a
 *     note saying what archived means for it;
 *   - page_on_call_policy refuses an archived policy outright, rather than
 *     telling the user "responders are being notified" when nobody is.
 */

const ctx: ToolContext = {
  projectId: ObjectID.generate(),
  props: { isRoot: true },
};

type AnySpy = SpyInstance<(...args: Array<never>) => unknown>;

function spy(target: unknown, method: string, value: unknown): AnySpy {
  return jest
    .spyOn(target as Record<string, () => unknown>, method)
    .mockResolvedValue(value as never) as unknown as AnySpy;
}

function firstCallArg(target: AnySpy): JSONObject {
  return target.mock.calls[0]?.[0] as unknown as JSONObject;
}

function cardFields(
  result: ToolExecutionResult,
): Array<{ label: string; value: string }> {
  return ((result.widget?.data as JSONObject | undefined)?.["fields"] ||
    []) as Array<{ label: string; value: string }>;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("query_monitors and archived monitors", () => {
  function monitor(isArchived: boolean): Monitor {
    const row: Monitor = new Monitor();
    row._id = ObjectID.generate().toString();
    row.name = "Checkout API";
    row.monitorType = MonitorType.Website;
    row.isArchived = isArchived;
    const status: MonitorStatus = new MonitorStatus();
    status.name = "Offline";
    status.isOperationalState = false;
    row.currentMonitorStatus = status;
    return row;
  }

  function mockDetailLookups(row: Monitor): AnySpy {
    const findOneById: AnySpy = spy(MonitorService, "findOneById", row);
    spy(MonitorStatusTimelineService, "findBy", []);
    spy(MonitorOwnerTeamService, "findBy", []);
    spy(MonitorOwnerUserService, "findBy", []);
    return findOneById;
  }

  test("the list leaves archived monitors out, in the rows and in the count", async () => {
    const findBy: AnySpy = spy(MonitorService, "findBy", []);
    const countBy: AnySpy = spy(
      MonitorService,
      "countBy",
      new PositiveNumber(0),
    );

    await QueryMonitorsTool.execute({}, ctx);

    expect(firstCallArg(findBy)["query"]).toEqual({ isArchived: false });
    expect(firstCallArg(countBy)["query"]).toBe(firstCallArg(findBy)["query"]);
  });

  test("'what is down right now?' never names an archived monitor", async () => {
    const findBy: AnySpy = spy(MonitorService, "findBy", []);
    spy(MonitorService, "countBy", new PositiveNumber(0));

    await QueryMonitorsTool.execute(
      { problemsOnly: true, nameSearch: "checkout" },
      ctx,
    );

    const query: JSONObject = firstCallArg(findBy)["query"] as JSONObject;
    expect(query["isArchived"]).toBe(false);
    expect(query["currentMonitorStatus"]).toEqual({
      isOperationalState: false,
    });
    expect(query["name"]).toBeDefined();
  });

  test("read by id, an archived monitor is returned, flagged, with what archived means", async () => {
    const findOneById: AnySpy = mockDetailLookups(monitor(true));

    const result: ToolExecutionResult = await QueryMonitorsTool.execute(
      { monitorId: ObjectID.generate().toString() },
      ctx,
    );

    expect(
      (firstCallArg(findOneById)["select"] as JSONObject)["isArchived"],
    ).toBe(true);
    expect(result.dataForLlm.startsWith(ARCHIVED_MONITOR_NOTE)).toBe(true);
    expect(result.dataForLlm).toContain("archived=true");
    expect(result.dataForLlm).toContain("Checkout API");
    expect(cardFields(result)).toContainEqual({
      label: "Archived",
      value: "Yes - not monitored",
    });
  });

  test("a live monitor read by id carries no archive note", async () => {
    mockDetailLookups(monitor(false));

    const result: ToolExecutionResult = await QueryMonitorsTool.execute(
      { monitorId: ObjectID.generate().toString() },
      ctx,
    );

    expect(result.dataForLlm).not.toContain(ARCHIVED_MONITOR_NOTE);
    expect(result.dataForLlm).not.toContain("archived=");
    expect(
      cardFields(result).map((field: { label: string }) => {
        return field.label;
      }),
    ).not.toContain("Archived");
  });

  test("the note says the status is stale and how to bring it back", () => {
    expect(ARCHIVED_MONITOR_NOTE).toContain("not being monitored");
    expect(ARCHIVED_MONITOR_NOTE).toContain("Unarchive");
    expect(QueryMonitorsTool.description).toContain(
      "Archived monitors are left out of the list",
    );
  });
});

describe("query_workflows and archived workflows", () => {
  function workflow(values: {
    isArchived: boolean;
    isEnabled?: boolean;
  }): Workflow {
    const row: Workflow = new Workflow();
    row._id = ObjectID.generate().toString();
    row.name = "Deploy notifier";
    row.description = "Notifies the team on deploys.";
    row.isEnabled = values.isEnabled ?? true;
    row.isArchived = values.isArchived;
    row.createdAt = new Date("2026-07-01T00:00:00Z");
    return row;
  }

  function run(): WorkflowLog {
    const log: WorkflowLog = new WorkflowLog();
    log._id = ObjectID.generate().toString();
    log.workflowStatus = WorkflowStatus.Success;
    log.startedAt = new Date("2026-08-14T10:00:00Z");
    log.completedAt = new Date("2026-08-14T10:00:42Z");
    log.createdAt = new Date("2026-08-14T10:00:00Z");
    return log;
  }

  test("the list leaves archived workflows out, in the rows and in the count", async () => {
    const findBy: AnySpy = spy(WorkflowService, "findBy", []);
    const countBy: AnySpy = spy(
      WorkflowService,
      "countBy",
      new PositiveNumber(0),
    );

    await QueryWorkflowsTool.execute({}, ctx);

    expect(firstCallArg(findBy)["query"]).toEqual({ isArchived: false });
    expect(firstCallArg(countBy)["query"]).toEqual({ isArchived: false });
  });

  test("read by id, an archived workflow is flagged, even though it is still switched on", async () => {
    const findOneById: AnySpy = spy(
      WorkflowService,
      "findOneById",
      workflow({ isArchived: true, isEnabled: true }),
    );
    spy(WorkflowLogService, "findBy", [run()]);

    const result: ToolExecutionResult = await QueryWorkflowsTool.execute(
      { workflowId: ObjectID.generate().toString() },
      ctx,
    );

    expect(
      (firstCallArg(findOneById)["select"] as JSONObject)["isArchived"],
    ).toBe(true);
    expect(result.dataForLlm.startsWith(ARCHIVED_WORKFLOW_NOTE)).toBe(true);
    expect(result.dataForLlm).toContain("enabled=true");
    expect(result.dataForLlm).toContain("archived=true");
    // The runs table says why nothing new will appear in it.
    expect(result.widget?.description).toBe(ARCHIVED_WORKFLOW_NOTE);
  });

  test("an archived workflow with no runs shows it on its card", async () => {
    spy(
      WorkflowService,
      "findOneById",
      workflow({ isArchived: true, isEnabled: false }),
    );
    spy(WorkflowLogService, "findBy", []);

    const result: ToolExecutionResult = await QueryWorkflowsTool.execute(
      { workflowId: ObjectID.generate().toString() },
      ctx,
    );

    expect(cardFields(result)).toContainEqual({
      label: "Archived",
      value: "Yes - does not run",
    });
  });

  test("a disabled workflow that is not archived still reads as disabled", async () => {
    spy(
      WorkflowService,
      "findOneById",
      workflow({ isArchived: false, isEnabled: false }),
    );
    spy(WorkflowLogService, "findBy", [run()]);

    const result: ToolExecutionResult = await QueryWorkflowsTool.execute(
      { workflowId: ObjectID.generate().toString() },
      ctx,
    );

    expect(result.dataForLlm).not.toContain(ARCHIVED_WORKFLOW_NOTE);
    expect(result.dataForLlm).not.toContain("archived=");
    expect(result.widget?.description).toBe("This workflow is disabled.");
  });
});

describe("query_status_pages and archived status pages", () => {
  function statusPage(isArchived: boolean): StatusPage {
    const row: StatusPage = new StatusPage();
    row._id = ObjectID.generate().toString();
    row.name = "Acme Status";
    row.description = "Customer-facing status page.";
    row.isPublicStatusPage = true;
    row.isArchived = isArchived;
    return row;
  }

  function resource(
    displayName: string,
    monitorIsArchived: boolean,
  ): StatusPageResource {
    const row: StatusPageResource = new StatusPageResource();
    row._id = ObjectID.generate().toString();
    row.displayName = displayName;
    const monitor: Monitor = new Monitor();
    monitor.name = `${displayName} monitor`;
    monitor.isArchived = monitorIsArchived;
    row.monitor = monitor;
    return row;
  }

  function mockDetail(
    page: StatusPage,
    resources: Array<StatusPageResource>,
  ): { findOneById: AnySpy; resourcesFindBy: AnySpy } {
    const findOneById: AnySpy = spy(StatusPageService, "findOneById", page);
    const resourcesFindBy: AnySpy = spy(
      StatusPageResourceService,
      "findBy",
      resources,
    );
    spy(StatusPageSubscriberService, "countBy", new PositiveNumber(12));
    spy(StatusPageService, "getStatusPageURL", "https://status.acme.dev");
    return { findOneById, resourcesFindBy };
  }

  test("the list leaves archived status pages out, in the rows and in the count", async () => {
    const findBy: AnySpy = spy(StatusPageService, "findBy", []);
    const countBy: AnySpy = spy(
      StatusPageService,
      "countBy",
      new PositiveNumber(0),
    );

    await QueryStatusPagesTool.execute({}, ctx);

    expect(firstCallArg(findBy)["query"]).toEqual({ isArchived: false });
    expect(firstCallArg(countBy)["query"]).toEqual({ isArchived: false });
  });

  test("read by id, an archived page is flagged as offline and reaching no one", async () => {
    const { findOneById } = mockDetail(statusPage(true), []);

    const result: ToolExecutionResult = await QueryStatusPagesTool.execute(
      { statusPageId: ObjectID.generate().toString() },
      ctx,
    );

    expect(
      (firstCallArg(findOneById)["select"] as JSONObject)["isArchived"],
    ).toBe(true);
    expect(result.dataForLlm.startsWith(ARCHIVED_STATUS_PAGE_NOTE)).toBe(true);
    expect(result.dataForLlm).toContain("archived=true");
    expect(cardFields(result)).toContainEqual({
      label: "Archived",
      value: "Yes - offline, sends nothing",
    });
    expect(ARCHIVED_STATUS_PAGE_NOTE).toContain("reaches no one");
  });

  test("a live page carries no archive note", async () => {
    mockDetail(statusPage(false), []);

    const result: ToolExecutionResult = await QueryStatusPagesTool.execute(
      { statusPageId: ObjectID.generate().toString() },
      ctx,
    );

    expect(result.dataForLlm).not.toContain(ARCHIVED_STATUS_PAGE_NOTE);
    expect(result.dataForLlm).not.toContain("archived=");
  });

  test("an archived monitor is not among the resources a page shows, as the public page leaves it off", async () => {
    const { resourcesFindBy } = mockDetail(statusPage(false), [
      resource("Checkout", false),
      resource("Legacy API", true),
    ]);

    const result: ToolExecutionResult = await QueryStatusPagesTool.execute(
      { statusPageId: ObjectID.generate().toString() },
      ctx,
    );

    const select: JSONObject = firstCallArg(resourcesFindBy)[
      "select"
    ] as JSONObject;
    expect((select["monitor"] as JSONObject)["isArchived"]).toBe(true);

    expect(result.dataForLlm).toContain("Checkout");
    expect(result.dataForLlm).not.toContain("Legacy API");
    expect(result.dataForLlm).toContain("resourceCount=1");
    expect(cardFields(result)).toContainEqual({
      label: "Resources shown",
      value: "1: Checkout (monitor: Checkout monitor)",
    });
  });
});

describe("the on-call tools and archived policies", () => {
  const POLICY_ID: ObjectID = ObjectID.generate();
  const RULE_ID: ObjectID = ObjectID.generate();

  function policy(isArchived: boolean): OnCallDutyPolicy {
    const row: OnCallDutyPolicy = new OnCallDutyPolicy();
    row._id = POLICY_ID.toString();
    row.name = "Payments primary";
    row.description = "Pages the payments on-call.";
    row.isArchived = isArchived;
    return row;
  }

  function mockEscalation(): void {
    const rule: OnCallDutyPolicyEscalationRule =
      new OnCallDutyPolicyEscalationRule();
    rule._id = RULE_ID.toString();
    rule.order = 1;
    rule.name = "Primary";
    rule.onCallDutyPolicyId = POLICY_ID;

    const user: User = new User();
    user._id = ObjectID.generate().toString();
    user.name = new Name("Alice Smith");
    const link: OnCallDutyPolicyEscalationRuleUser =
      new OnCallDutyPolicyEscalationRuleUser();
    link._id = ObjectID.generate().toString();
    link.onCallDutyPolicyEscalationRuleId = RULE_ID;
    link.user = user;

    spy(OnCallDutyPolicyEscalationRuleService, "findBy", [rule]);
    spy(OnCallDutyPolicyEscalationRuleUserService, "findBy", [link]);
    spy(OnCallDutyPolicyEscalationRuleTeamService, "findBy", []);
    spy(OnCallDutyPolicyEscalationRuleScheduleService, "findBy", []);
  }

  test("query_on_call_policies lists no archived policy, in the rows or the count", async () => {
    const countBy: AnySpy = spy(
      OnCallDutyPolicyService,
      "countBy",
      new PositiveNumber(0),
    );
    const findBy: AnySpy = spy(OnCallDutyPolicyService, "findBy", []);
    mockEscalation();

    await QueryOnCallPoliciesTool.execute({}, ctx);

    expect(firstCallArg(countBy)["query"]).toEqual({ isArchived: false });
    expect(firstCallArg(findBy)["query"]).toEqual({ isArchived: false });
    expect(QueryOnCallPoliciesTool.description).toContain(
      "Archived policies page no one and are left out of the list",
    );
  });

  test("query_on_call_policies, read by id, flags an archived policy", async () => {
    const findOneById: AnySpy = spy(
      OnCallDutyPolicyService,
      "findOneById",
      policy(true),
    );
    mockEscalation();

    const result: ToolExecutionResult = await QueryOnCallPoliciesTool.execute(
      { onCallPolicyId: POLICY_ID.toString() },
      ctx,
    );

    expect(
      (firstCallArg(findOneById)["select"] as JSONObject)["isArchived"],
    ).toBe(true);
    expect(result.dataForLlm.startsWith(ARCHIVED_ON_CALL_POLICY_NOTE)).toBe(
      true,
    );
    expect(result.dataForLlm).toContain("archived=true");
    // Flagged first, then the escalation chain it would run if unarchived.
    expect(cardFields(result)[0]).toEqual({
      label: "Archived",
      value: "Yes - pages no one",
    });
    expect(cardFields(result)[1]?.label).toContain("Rule 1");
  });

  test("query_on_call_policies, read by id, says nothing about archiving for a live policy", async () => {
    spy(OnCallDutyPolicyService, "findOneById", policy(false));
    mockEscalation();

    const result: ToolExecutionResult = await QueryOnCallPoliciesTool.execute(
      { onCallPolicyId: POLICY_ID.toString() },
      ctx,
    );

    expect(result.dataForLlm).not.toContain(ARCHIVED_ON_CALL_POLICY_NOTE);
    expect(result.dataForLlm).not.toContain("archived=");
    expect(cardFields(result)[0]?.label).toContain("Rule 1");
  });

  test("get_on_call_status for an archived policy says first that it pages no one", async () => {
    const findOneById: AnySpy = spy(
      OnCallDutyPolicyService,
      "findOneById",
      policy(true),
    );
    mockEscalation();

    const result: ToolExecutionResult = await GetOnCallStatusTool.execute(
      { onCallPolicyId: POLICY_ID.toString() },
      ctx,
    );

    expect(
      (firstCallArg(findOneById)["select"] as JSONObject)["isArchived"],
    ).toBe(true);
    expect(result.dataForLlm.startsWith(ARCHIVED_ON_CALL_POLICY_NOTE)).toBe(
      true,
    );
    // The rules are still listed, so the user sees who it would page.
    expect(result.dataForLlm).toContain("Alice Smith");
    expect(result.widget?.description).toBe(ARCHIVED_ON_CALL_POLICY_NOTE);
  });

  test("get_on_call_status for a live policy is unchanged", async () => {
    spy(OnCallDutyPolicyService, "findOneById", policy(false));
    mockEscalation();

    const result: ToolExecutionResult = await GetOnCallStatusTool.execute(
      { onCallPolicyId: POLICY_ID.toString() },
      ctx,
    );

    expect(result.dataForLlm).not.toContain(ARCHIVED_ON_CALL_POLICY_NOTE);
    expect(result.widget?.description).toBe(
      "Who each escalation rule pages, in order",
    );
  });

  describe("page_on_call_policy", () => {
    const pageCtx: ToolContext = {
      projectId: ctx.projectId,
      props: { isRoot: true, userId: ObjectID.generate() },
    };

    function incident(): Incident {
      const row: Incident = new Incident();
      row._id = ObjectID.generate().toString();
      row.incidentNumber = 7;
      row.title = "Checkout is down";
      return row;
    }

    test("refuses an archived policy, and pages no one", async () => {
      const findOneById: AnySpy = spy(
        OnCallDutyPolicyService,
        "findOneById",
        policy(true),
      );
      const incidentLookup: AnySpy = spy(
        IncidentService,
        "findOneById",
        incident(),
      );
      const executeOnCallPolicy: AnySpy = spy(
        WorkspaceMemberActions,
        "executeOnCallPolicy",
        undefined,
      );

      const attempt: Promise<ToolExecutionResult> =
        PageOnCallPolicyTool.execute(
          {
            onCallDutyPolicyId: POLICY_ID.toString(),
            incidentId: ObjectID.generate().toString(),
          },
          pageCtx,
        );

      await expect(attempt).rejects.toThrow(BadDataException);
      await expect(attempt).rejects.toThrow(
        'On-call duty policy "Payments primary" is archived, so it pages no one. Unarchive it first, or page a different policy.',
      );
      expect(
        (firstCallArg(findOneById)["select"] as JSONObject)["isArchived"],
      ).toBe(true);
      expect(executeOnCallPolicy).not.toHaveBeenCalled();
      expect(incidentLookup).not.toHaveBeenCalled();
    });

    test("pages a live policy, as the person who asked", async () => {
      spy(OnCallDutyPolicyService, "findOneById", policy(false));
      spy(IncidentService, "findOneById", incident());
      const executeOnCallPolicy: AnySpy = spy(
        WorkspaceMemberActions,
        "executeOnCallPolicy",
        undefined,
      );
      const incidentId: ObjectID = ObjectID.generate();

      const result: ToolExecutionResult = await PageOnCallPolicyTool.execute(
        {
          onCallDutyPolicyId: POLICY_ID.toString(),
          incidentId: incidentId.toString(),
        },
        pageCtx,
      );

      expect(executeOnCallPolicy).toHaveBeenCalledTimes(1);
      const call: {
        event: { type: WorkspaceEventType; id: ObjectID };
        onCallDutyPolicyId: ObjectID;
        props: unknown;
      } = executeOnCallPolicy.mock.calls[0]?.[0] as unknown as {
        event: { type: WorkspaceEventType; id: ObjectID };
        onCallDutyPolicyId: ObjectID;
        props: unknown;
      };
      expect(call.event.type).toBe(WorkspaceEventType.Incident);
      expect(call.event.id.toString()).toBe(incidentId.toString());
      expect(call.onCallDutyPolicyId.toString()).toBe(POLICY_ID.toString());
      expect(call.props).toBe(pageCtx.props);
      expect(result.dataForLlm).toContain(
        'Paged on-call policy "Payments primary"',
      );
    });
  });
});
