import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import OnCallDutyPolicyExecutionLog from "../../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import Runbook from "../../../../Models/DatabaseModels/Runbook";
import RunbookExecution from "../../../../Models/DatabaseModels/RunbookExecution";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../../Server/Services/IncidentSeverityService";
import RunbookRuleEngineService from "../../../../Server/Services/RunbookRuleEngineService";
import RunbookService from "../../../../Server/Services/RunbookService";
import RunbookRunAccess from "../../../../Server/Utils/Runbook/RunbookRunAccess";
import {
  ChangeIncidentSeverityTool,
  PageOnCallPolicyTool,
  RunRunbookTool,
} from "../../../../Server/Utils/AI/Toolbox/AIActionTools";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import DatabaseRequestType from "../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import {
  RUNBOOK_RUN_PERMISSIONS,
  RUNBOOK_RUN_REFUSED_MESSAGE,
} from "../../../../Types/Runbook/RunbookRunPermissions";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * The AI assistant's actions ask what the dashboard asks of the person, with
 * the person's own props:
 *
 *   - page_on_call_policy needs the permission to create the policy's
 *     execution log - what the dashboard's Execute On-Call Policy creates -
 *     not the permission to edit incidents;
 *   - run_runbook needs the permission to start runs, for a runbook of the
 *     project that permission reaches (labels, owners, blocks) - as the
 *     dashboard's Run Runbook asks, reading the runbook as OneUptime - before
 *     OneUptime starts the run;
 *   - change_incident_severity changes the incident as the person, and an
 *     incident they may read but not change is answered as unchanged, never
 *     as changed.
 */

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();
const runbookId: ObjectID = ObjectID.generate();
const incidentId: ObjectID = ObjectID.generate();

function contextFor(allow: Array<Permission>): ToolContext {
  const props: DatabaseCommonInteractionProps = {
    tenantId: projectId,
    userId: userId,
    userGlobalAccessPermission: {
      globalPermissions: [Permission.Public],
      projectIds: [projectId],
      _type: "UserGlobalAccessPermission",
    },
    userTenantAccessPermission: {
      [projectId.toString()]: {
        projectId: projectId,
        permissions: allow.map((permission: Permission) => {
          return {
            permission: permission,
            labelIds: [],
            isBlockPermission: false,
            _type: "UserPermission" as const,
          };
        }),
        _type: "UserTenantAccessPermission",
      },
    },
  } as unknown as DatabaseCommonInteractionProps;

  return { projectId: projectId, props: props };
}

function buildRunbook(inProject: ObjectID = projectId): Runbook {
  const runbook: Runbook = new Runbook();
  runbook._id = runbookId.toString();
  runbook.projectId = inProject;
  runbook.name = "Restart checkout";
  return runbook;
}

function buildIncident(): Incident {
  const incident: Incident = new Incident();
  incident._id = incidentId.toString();
  incident.incidentNumber = 42;
  incident.title = "Checkout is down";
  return incident;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("page_on_call_policy asks for what paging creates", () => {
  test("it needs the permission to create the policy's execution log, not to edit incidents", () => {
    const required: Array<Permission> =
      PageOnCallPolicyTool.requiredPermissions;

    expect([...required].sort()).toEqual(
      [...new OnCallDutyPolicyExecutionLog().getCreatePermissions()].sort(),
    );
    expect(required).toContain(
      Permission.CreateProjectOnCallDutyPolicyExecutionLog,
    );
    expect(required).not.toContain(Permission.EditProjectIncident);
  });
});

describe("run_runbook asks what the dashboard's Run Runbook asks", () => {
  function stubStart(): jest.SpiedFunction<
    typeof RunbookRuleEngineService.startRunbookFor
  > {
    const execution: RunbookExecution = new RunbookExecution();
    execution._id = ObjectID.generate().toString();

    return jest
      .spyOn(RunbookRuleEngineService, "startRunbookFor")
      .mockResolvedValue(execution as never);
  }

  test("it needs the permission to start runs", () => {
    expect([...RunRunbookTool.requiredPermissions].sort()).toEqual(
      [...RUNBOOK_RUN_PERMISSIONS].sort(),
    );
  });

  test("a person without the permission to start runs is refused before the runbook is read, and nothing starts", async () => {
    const runbookRead: jest.SpiedFunction<typeof RunbookService.findOneById> =
      jest.spyOn(RunbookService, "findOneById");
    const start: jest.SpiedFunction<
      typeof RunbookRuleEngineService.startRunbookFor
    > = stubStart();

    const attempt: Promise<ToolExecutionResult> = RunRunbookTool.execute(
      { runbookId: runbookId.toString() },
      contextFor([Permission.ReadRunbook]),
    );

    await expect(attempt).rejects.toThrow(NotAuthorizedException);
    await expect(attempt).rejects.toThrow(RUNBOOK_RUN_REFUSED_MESSAGE);
    expect(runbookRead).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  test("a runbook the person's permission to start runs does not reach starts nothing", async () => {
    jest
      .spyOn(RunbookService, "findOneById")
      .mockResolvedValue(buildRunbook() as never);
    const mayStart: jest.SpiedFunction<typeof RunbookRunAccess.assertMayStart> =
      jest
        .spyOn(RunbookRunAccess, "assertMayStart")
        .mockRejectedValue(
          new NotAuthorizedException(
            "You do not have permission to run this runbook.",
          ) as never,
        );
    const start: jest.SpiedFunction<
      typeof RunbookRuleEngineService.startRunbookFor
    > = stubStart();
    const ctx: ToolContext = contextFor([Permission.RunbookMember]);

    await expect(
      RunRunbookTool.execute({ runbookId: runbookId.toString() }, ctx),
    ).rejects.toThrow("You do not have permission to run this runbook.");

    // Asked with the person's own props, for this runbook in this project.
    expect(mayStart).toHaveBeenCalledTimes(1);
    const asked: {
      databaseProps: DatabaseCommonInteractionProps;
      projectId: ObjectID;
      runbookId: ObjectID;
    } = mayStart.mock.calls[0]![0] as unknown as {
      databaseProps: DatabaseCommonInteractionProps;
      projectId: ObjectID;
      runbookId: ObjectID;
    };
    expect(asked.databaseProps).toBe(ctx.props);
    expect(asked.projectId.toString()).toBe(projectId.toString());
    expect(asked.runbookId.toString()).toBe(runbookId.toString());
    expect(start).not.toHaveBeenCalled();
  });

  test("the runbook is read as OneUptime, and one of another project is answered like one that does not exist", async () => {
    const runbookRead: jest.SpiedFunction<typeof RunbookService.findOneById> =
      jest
        .spyOn(RunbookService, "findOneById")
        .mockResolvedValue(buildRunbook(ObjectID.generate()) as never);
    const mayStart: jest.SpiedFunction<typeof RunbookRunAccess.assertMayStart> =
      jest
        .spyOn(RunbookRunAccess, "assertMayStart")
        .mockResolvedValue(undefined as never);
    const start: jest.SpiedFunction<
      typeof RunbookRuleEngineService.startRunbookFor
    > = stubStart();

    await expect(
      RunRunbookTool.execute(
        { runbookId: runbookId.toString() },
        contextFor([Permission.RunbookMember]),
      ),
    ).rejects.toThrow("Runbook not found.");

    const read: {
      id: ObjectID;
      select: Record<string, boolean>;
      props: DatabaseCommonInteractionProps;
    } = runbookRead.mock.calls[0]![0] as unknown as {
      id: ObjectID;
      select: Record<string, boolean>;
      props: DatabaseCommonInteractionProps;
    };
    expect(read.id.toString()).toBe(runbookId.toString());
    expect(read.select["projectId"]).toBe(true);
    expect(read.props).toEqual({ isRoot: true });
    expect(mayStart).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  test("a permission to start runs that does not show runbooks still starts one it reaches, named by its ID", async () => {
    const ctx: ToolContext = contextFor([Permission.CreateRunbookExecution]);
    jest
      .spyOn(RunbookService, "findOneById")
      .mockImplementation((async (findOneById: {
        props: DatabaseCommonInteractionProps;
      }): Promise<Runbook> => {
        // Read as OneUptime it is there; read as the person it is not shown.
        if (findOneById.props.isRoot) {
          return buildRunbook();
        }

        throw new NotAuthorizedException(
          "You do not have permission to read Runbook.",
        );
      }) as never);
    jest
      .spyOn(RunbookRunAccess, "assertMayStart")
      .mockResolvedValue(undefined as never);
    const start: jest.SpiedFunction<
      typeof RunbookRuleEngineService.startRunbookFor
    > = stubStart();

    const result: ToolExecutionResult = await RunRunbookTool.execute(
      { runbookId: runbookId.toString() },
      ctx,
    );

    expect(start).toHaveBeenCalledTimes(1);
    expect(result.dataForLlm).toContain(
      `Started runbook ${runbookId.toString()}.`,
    );
    expect(result.dataForLlm).not.toContain("Restart checkout");
    expect(result.citationLabel).not.toContain("Restart checkout");
  });

  test("a runbook name that cannot be read never stops a run the person may start", async () => {
    const calls: Array<string> = [];
    jest
      .spyOn(RunbookService, "findOneById")
      .mockImplementation((async (findOneById: {
        props: DatabaseCommonInteractionProps;
      }): Promise<Runbook> => {
        if (findOneById.props.isRoot) {
          return buildRunbook();
        }

        calls.push("name");
        throw new Error("The database went away.");
      }) as never);
    jest
      .spyOn(RunbookRunAccess, "assertMayStart")
      .mockResolvedValue(undefined as never);
    const execution: RunbookExecution = new RunbookExecution();
    execution._id = ObjectID.generate().toString();
    jest
      .spyOn(RunbookRuleEngineService, "startRunbookFor")
      .mockImplementation((async (): Promise<RunbookExecution> => {
        calls.push("start");
        return execution;
      }) as never);

    const result: ToolExecutionResult = await RunRunbookTool.execute(
      { runbookId: runbookId.toString() },
      contextFor([Permission.RunbookMember]),
    );

    // The name is looked up for the answer, once the run has started.
    expect(calls).toEqual(["start", "name"]);
    expect(result.dataForLlm).toContain(
      `Started runbook ${runbookId.toString()}.`,
    );
  });

  test("an incident the person may not read is not linked, and nothing starts", async () => {
    jest
      .spyOn(RunbookService, "findOneById")
      .mockResolvedValue(buildRunbook() as never);
    jest
      .spyOn(RunbookRunAccess, "assertMayStart")
      .mockResolvedValue(undefined as never);
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue(null as never);
    const start: jest.SpiedFunction<
      typeof RunbookRuleEngineService.startRunbookFor
    > = stubStart();

    await expect(
      RunRunbookTool.execute(
        {
          runbookId: runbookId.toString(),
          incidentId: incidentId.toString(),
        },
        contextFor([Permission.RunbookMember]),
      ),
    ).rejects.toThrow("Incident not found (or you do not have access to it).");
    expect(start).not.toHaveBeenCalled();
  });

  test("once every check passed, OneUptime starts the run, triggered by the person", async () => {
    jest
      .spyOn(RunbookService, "findOneById")
      .mockResolvedValue(buildRunbook() as never);
    jest
      .spyOn(RunbookRunAccess, "assertMayStart")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(buildIncident() as never);
    const start: jest.SpiedFunction<
      typeof RunbookRuleEngineService.startRunbookFor
    > = stubStart();

    const result: ToolExecutionResult = await RunRunbookTool.execute(
      {
        runbookId: runbookId.toString(),
        incidentId: incidentId.toString(),
      },
      contextFor([Permission.RunbookMember]),
    );

    expect(result.dataForLlm).toContain('Started runbook "Restart checkout".');
    expect(start).toHaveBeenCalledTimes(1);
    const started: {
      projectId: ObjectID;
      runbookId: ObjectID;
      linkage: { incidentId?: ObjectID };
      triggeredByUserId: ObjectID;
    } = start.mock.calls[0]![0] as unknown as {
      projectId: ObjectID;
      runbookId: ObjectID;
      linkage: { incidentId?: ObjectID };
      triggeredByUserId: ObjectID;
    };
    expect(started.projectId.toString()).toBe(projectId.toString());
    expect(started.runbookId.toString()).toBe(runbookId.toString());
    expect(started.linkage.incidentId?.toString()).toBe(incidentId.toString());
    expect(started.triggeredByUserId.toString()).toBe(userId.toString());
  });
});

describe("change_incident_severity changes the incident as the person", () => {
  function stubSeverities(): IncidentSeverity {
    const severity: IncidentSeverity = new IncidentSeverity();
    severity._id = ObjectID.generate().toString();
    severity.name = "Critical";
    severity.order = 1;

    jest
      .spyOn(IncidentSeverityService, "findBy")
      .mockResolvedValue([severity] as never);

    return severity;
  }

  test("writes with the person's own props", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(buildIncident() as never);
    const severity: IncidentSeverity = stubSeverities();
    const update: jest.SpiedFunction<typeof IncidentService.updateOneById> =
      jest.spyOn(IncidentService, "updateOneById").mockResolvedValue(1);
    const ctx: ToolContext = contextFor([Permission.ProjectMember]);

    const result: ToolExecutionResult =
      await ChangeIncidentSeverityTool.execute(
        { incidentId: incidentId.toString(), severityName: "critical" },
        ctx,
      );

    expect(result.dataForLlm).toContain(
      "Changed incident #42 severity to Critical.",
    );
    const written: {
      id: ObjectID;
      data: { incidentSeverityId: ObjectID };
      props: DatabaseCommonInteractionProps;
    } = update.mock.calls[0]![0] as unknown as {
      id: ObjectID;
      data: { incidentSeverityId: ObjectID };
      props: DatabaseCommonInteractionProps;
    };
    expect(written.id.toString()).toBe(incidentId.toString());
    expect(written.data.incidentSeverityId.toString()).toBe(
      severity.id!.toString(),
    );
    expect(written.props).toBe(ctx.props);
  });

  test("an incident the person may read but not change is answered as unchanged, with why", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(buildIncident() as never);
    stubSeverities();
    jest.spyOn(IncidentService, "updateOneById").mockResolvedValue(0);
    const refusal: NotAuthorizedException = new NotAuthorizedException(
      "You do not have permission to edit this Incident.",
    );
    const explain: jest.SpiedFunction<
      typeof IncidentService.getUnwrittenByIdError
    > = jest
      .spyOn(IncidentService, "getUnwrittenByIdError")
      .mockResolvedValue(refusal as never);
    const ctx: ToolContext = contextFor([Permission.ProjectMember]);

    await expect(
      ChangeIncidentSeverityTool.execute(
        { incidentId: incidentId.toString(), severityName: "Critical" },
        ctx,
      ),
    ).rejects.toBe(refusal);

    const asked: {
      id: ObjectID;
      props: DatabaseCommonInteractionProps;
      type: DatabaseRequestType;
    } = explain.mock.calls[0]![0] as unknown as {
      id: ObjectID;
      props: DatabaseCommonInteractionProps;
      type: DatabaseRequestType;
    };
    expect(asked.id.toString()).toBe(incidentId.toString());
    expect(asked.props).toBe(ctx.props);
    expect(asked.type).toBe(DatabaseRequestType.Update);
  });
});
