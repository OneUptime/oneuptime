import SecurityPlaybookRunAPI, {
  SELF_APPROVAL_REFUSED_MESSAGE,
} from "../../../Server/API/SecurityPlaybookRunAPI";
import Queue from "../../../Server/Infrastructure/Queue";
import AuditLogService from "../../../Server/Services/AuditLogService";
import SecurityCaseFeedService from "../../../Server/Services/SecurityCaseFeedService";
import SecurityCaseService from "../../../Server/Services/SecurityCaseService";
import SecurityEventConnectionService from "../../../Server/Services/SecurityEventConnectionService";
import SecurityPlaybookRunService from "../../../Server/Services/SecurityPlaybookRunService";
import SecurityPlaybookService, {
  Service as SecurityPlaybookServiceType,
  readIdList,
} from "../../../Server/Services/SecurityPlaybookService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import ProjectReferenceCheck from "../../../Server/Utils/Database/ProjectReferenceCheck";
import DataSourceHttpFetch, {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../Server/Utils/DataSource/HttpFetch";
import { ProjectScopedReference } from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import SecurityEventConnection from "../../../Models/DatabaseModels/SecurityEventConnection";
import SecurityPlaybook from "../../../Models/DatabaseModels/SecurityPlaybook";
import SecurityPlaybookRun from "../../../Models/DatabaseModels/SecurityPlaybookRun";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PositiveNumber from "../../../Types/PositiveNumber";
import ObjectID from "../../../Types/ObjectID";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import Permission from "../../../Types/Permission";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import SecurityEventConnectorProvider from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import { SecurityPlaybookActionType } from "../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import SecurityPlaybookRunStatus, {
  SecurityPlaybookStepStatus,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import { SecurityPlaybookStep } from "../../../Types/SecurityPlaybook/SecurityPlaybookStep";
import {
  SecurityPlaybookApprovalDecision,
  SecurityPlaybookStepResult,
  SecurityPlaybookTarget,
  SecurityPlaybookTargetReason,
  SecurityPlaybookTargetState,
  buildPendingStepResults,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookStepResult";
import SecurityPlaybookTrigger from "../../../Types/SecurityPlaybook/SecurityPlaybookTrigger";
import { getJestSpyOn } from "../../Spy";
import SecurityCasePriorityLevel from "../../../Types/SecurityCase/SecurityCasePriorityLevel";
import SecurityCaseStage from "../../../Types/SecurityCase/SecurityCaseStage";
import SecurityCaseVerdict from "../../../Types/SecurityCase/SecurityCaseVerdict";
import {
  TEST_PRIORITY_IDS,
  TEST_STATUS_IDS,
} from "../../Helpers/SecurityCaseValues";
import { stubSecurityCaseValues } from "../../Helpers/SecurityCaseValuesStub";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

type Spy = ReturnType<typeof getJestSpyOn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const CASE_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const PLAYBOOK_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const RUN_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const USER_ID: ObjectID = new ObjectID("77777777-7777-4777-8777-777777777777");
const OTHER_USER_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const CONNECTION_ID: string = "88888888-8888-4888-8888-888888888888";
const OTHER_CONNECTION_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

// A signed-in member of the project holding these permissions.
function memberWith(
  userId: ObjectID,
  ...permissions: Array<Permission>
): DatabaseCommonInteractionProps {
  return {
    userId,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: permissions.map((permission: Permission) => {
          return { _type: "UserPermission", permission, labelIds: [] };
        }),
      },
    },
  } as unknown as DatabaseCommonInteractionProps;
}

function userTarget(
  value: string,
  state: SecurityPlaybookTargetState = SecurityPlaybookTargetState.Proposed,
): SecurityPlaybookTarget {
  return {
    type: SecurityEntityType.User,
    value,
    reason: SecurityPlaybookTargetReason.GroupedOn,
    state,
  };
}

type HookCaller<TModel extends DatabaseBaseModel> = {
  checkCreateBeforeReferences: (createBy: CreateBy<TModel>) => Promise<void>;
  checkUpdateBeforeReferences: (updateBy: UpdateBy<TModel>) => Promise<void>;
  onBeforeCreate: (createBy: CreateBy<TModel>) => Promise<OnCreate<TModel>>;
  onBeforeUpdate: (updateBy: UpdateBy<TModel>) => Promise<OnUpdate<TModel>>;
};

beforeEach(() => {
  getJestSpyOn(ProjectReferenceCheck, "validateCreate").mockResolvedValue(
    undefined as never,
  );
  getJestSpyOn(ProjectReferenceCheck, "validateUpdate").mockResolvedValue(
    undefined as never,
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SecurityPlaybookService", () => {
  const service: HookCaller<SecurityPlaybook> =
    SecurityPlaybookService as unknown as HookCaller<SecurityPlaybook>;

  test("names every record a step's settings point at, for the project check", () => {
    const references: Array<ProjectScopedReference> =
      SecurityPlaybookServiceType.getStepReferences([
        {
          action: SecurityPlaybookActionType.AssignCase,
          config: { userId: USER_ID.toString(), teamId: "not-an-id" },
        },
        {
          action: SecurityPlaybookActionType.EmailPeople,
          config: { userIds: [USER_ID.toString()], teamIds: [] },
        },
        {
          action: SecurityPlaybookActionType.SuspendOktaUser,
          config: { connectionId: CONNECTION_ID },
        },
        {
          action: SecurityPlaybookActionType.PostToMicrosoftTeams,
          // A Teams team id is the product's own, never a OneUptime record.
          config: {
            channelName: "SOC",
            microsoftTeamsTeamId: "8b2f3a51-7d1e-4c0a-9a35-2f0b1d6c7e44",
          },
        },
      ]);

    expect(
      references.map((reference: ProjectScopedReference) => {
        return `${reference.modelName}:${String(reference.id)}`;
      }),
    ).toEqual([
      `User:${USER_ID.toString()}`,
      `User:${USER_ID.toString()}`,
      `Security Event Connection:${CONNECTION_ID}`,
    ]);
  });

  test("names the project's own priorities and statuses a step sets, for the project check", () => {
    const references: Array<ProjectScopedReference> =
      SecurityPlaybookServiceType.getStepReferences([
        {
          action: SecurityPlaybookActionType.SetCasePriority,
          config: {
            priorityId: TEST_PRIORITY_IDS[SecurityCasePriorityLevel.High],
          },
        },
        {
          action: SecurityPlaybookActionType.SetCaseStatus,
          config: { statusId: TEST_STATUS_IDS[SecurityCaseStage.Contained] },
        },
        {
          action: SecurityPlaybookActionType.CheckThreatIntel,
          config: {
            raisePriorityToId:
              TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Critical],
          },
        },
      ]);

    expect(
      references.map((reference: ProjectScopedReference) => {
        return `${reference.modelName}:${String(reference.id)}`;
      }),
    ).toEqual([
      `Security Case Priority:${TEST_PRIORITY_IDS[SecurityCasePriorityLevel.High]}`,
      `Security Case Status:${TEST_STATUS_IDS[SecurityCaseStage.Contained]}`,
      `Security Case Priority:${TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Critical]}`,
    ]);
  });

  test("names the person an Add tasks step hands its tasks to, for the project check", () => {
    const references: Array<ProjectScopedReference> =
      SecurityPlaybookServiceType.getStepReferences([
        {
          action: SecurityPlaybookActionType.AddCaseTasks,
          config: {
            tasks: ["Confirm the sign-in"],
            assigneeUserId: OTHER_USER_ID.toString(),
          },
        },
        {
          action: SecurityPlaybookActionType.DisableEntraIdUser,
          config: { connectionId: OTHER_CONNECTION_ID },
        },
      ]);

    expect(
      references.map((reference: ProjectScopedReference) => {
        return `${reference.modelName}:${String(reference.id)}`;
      }),
    ).toEqual([
      `User:${OTHER_USER_ID.toString()}`,
      `Security Event Connection:${OTHER_CONNECTION_ID}`,
    ]);
  });

  test("keeps a step's condition and holds the list to the branching rule, on create and on update", async () => {
    const branching: SecurityPlaybook = new SecurityPlaybook();
    branching.projectId = PROJECT_ID;
    branching.name = "Contain or hand over";
    branching.steps = [
      { id: "check", action: SecurityPlaybookActionType.CheckThreatIntel },
      {
        id: "note",
        action: SecurityPlaybookActionType.AddCaseNote,
        config: { note: "Nothing known-bad: check by hand." },
        runIf: { stepId: "check", outcome: "Found Nothing" },
      },
    ] as unknown as JSONArray;

    await service.checkCreateBeforeReferences({
      data: branching,
      props: { isRoot: true },
    });

    expect(
      (branching.steps as unknown as Array<SecurityPlaybookStep>)[1]!.runIf,
    ).toEqual({ stepId: "check", outcome: "Found Nothing" });

    // Waiting on a step after it.
    const backwards: SecurityPlaybook = new SecurityPlaybook();
    backwards.name = "Backwards";
    backwards.steps = [
      {
        id: "note",
        action: SecurityPlaybookActionType.AddCaseNote,
        config: { note: "n" },
        runIf: { stepId: "check", outcome: "Found" },
      },
      { id: "check", action: SecurityPlaybookActionType.CheckThreatIntel },
    ] as unknown as JSONArray;

    await expect(
      service.checkCreateBeforeReferences({
        data: backwards,
        props: { isRoot: true },
      }),
    ).rejects.toThrow(
      "Step 1 (Add a note): it runs after step 2, which comes after it. Move it below step 2, or choose again when it runs.",
    );

    // An update is held to it too: a failure the step it waits on never carries on past.
    await expect(
      service.checkUpdateBeforeReferences({
        query: { _id: PLAYBOOK_ID },
        data: {
          steps: [
            {
              id: "note",
              action: SecurityPlaybookActionType.AddCaseNote,
              config: { note: "n" },
            },
            {
              id: "slack",
              action: SecurityPlaybookActionType.PostToSlack,
              config: { channelName: "soc" },
              runIf: { stepId: "note", outcome: "Failed" },
            },
          ],
        } as never,
        props: { isRoot: true },
      }),
    ).rejects.toThrow(
      "Step 2 (Post to Slack): it runs only if step 1 (Add a note) fails, but a failed step 1 stops the run.",
    );
  });

  test("reads rule id lists the way they are stored or posted", () => {
    expect(
      readIdList(JSON.stringify([USER_ID.toString(), "x", USER_ID.toString()])),
    ).toEqual([USER_ID.toString()]);
    expect(readIdList("not json")).toEqual([]);
    expect(readIdList(undefined)).toEqual([]);
  });

  test("cleans the steps before the project check reads them", async () => {
    const playbook: SecurityPlaybook = new SecurityPlaybook();
    playbook.projectId = PROJECT_ID;
    playbook.name = "  Triage  ";
    playbook.steps = [
      {
        action: SecurityPlaybookActionType.AddCaseNote,
        config: { note: "  Check the VPN.  " },
      },
    ] as unknown as JSONArray;
    (playbook as unknown as JSONObject)["minimumSecurityCasePriorityId"] = "";

    await service.checkCreateBeforeReferences({
      data: playbook,
      props: { isRoot: true },
    });

    const steps: Array<SecurityPlaybookStep> =
      playbook.steps as unknown as Array<SecurityPlaybookStep>;

    expect(playbook.name).toBe("Triage");
    expect(steps[0]!.config).toEqual({ note: "Check the VPN." });
    expect(steps[0]!.id).toBeTruthy();
    // No minimum: every priority.
    expect(playbook.minimumSecurityCasePriorityId).toBeNull();
  });

  test("refuses a step it could not run, and an unknown trigger", async () => {
    const playbook: SecurityPlaybook = new SecurityPlaybook();
    playbook.projectId = PROJECT_ID;
    playbook.name = "Broken";
    playbook.steps = [
      { action: SecurityPlaybookActionType.AssignCase, config: {} },
    ] as unknown as JSONArray;

    await expect(
      service.checkCreateBeforeReferences({
        data: playbook,
        props: { isRoot: true },
      }),
    ).rejects.toThrow(
      "Step 1 (Assign the case): choose a user, a team, or both.",
    );

    const wrongTrigger: SecurityPlaybook = new SecurityPlaybook();
    wrongTrigger.name = "x";
    (wrongTrigger as unknown as JSONObject)["trigger"] = "Whenever";

    await expect(
      service.checkCreateBeforeReferences({
        data: wrongTrigger,
        props: { isRoot: true },
      }),
    ).rejects.toThrow(/Trigger must be/);
  });

  test("refuses a containment step pointed at another product's connection", async () => {
    const crowdstrike: SecurityEventConnection = new SecurityEventConnection();
    crowdstrike._id = CONNECTION_ID;
    crowdstrike.name = "Falcon";
    crowdstrike.provider = SecurityEventConnectorProvider.CrowdStrikeFalcon;

    getJestSpyOn(SecurityEventConnectionService, "findBy").mockResolvedValue([
      crowdstrike,
    ] as never);

    const playbook: SecurityPlaybook = new SecurityPlaybook();
    playbook.projectId = PROJECT_ID;
    playbook.name = "Contain";
    playbook.steps = [
      {
        id: "s1",
        action: SecurityPlaybookActionType.SuspendOktaUser,
        config: { connectionId: CONNECTION_ID },
      },
    ] as unknown as JSONArray;

    await expect(
      service.onBeforeCreate({ data: playbook, props: { isRoot: true } }),
    ).rejects.toThrow(
      /Step 1 \(Suspend the user in Okta\): the connection "Falcon"/,
    );
  });

  test("holds a step's priority and status to the project's own lists, on create", async () => {
    stubSecurityCaseValues();
    getJestSpyOn(SecurityEventConnectionService, "findBy").mockResolvedValue(
      [] as never,
    );

    const startsOver: SecurityPlaybook = new SecurityPlaybook();
    startsOver.projectId = PROJECT_ID;
    startsOver.name = "Back to New";
    startsOver.steps = [
      {
        id: "s1",
        action: SecurityPlaybookActionType.SetCaseStatus,
        config: { statusId: TEST_STATUS_IDS[SecurityCaseStage.New] },
      },
    ] as unknown as JSONArray;

    await expect(
      service.onBeforeCreate({ data: startsOver, props: { isRoot: true } }),
    ).rejects.toThrow(
      "Step 1 (Set the status): every case starts in this status - choose one a case moves on to.",
    );

    const contains: SecurityPlaybook = new SecurityPlaybook();
    contains.projectId = PROJECT_ID;
    contains.name = "Contain and lower";
    contains.steps = [
      {
        id: "s1",
        action: SecurityPlaybookActionType.SetCasePriority,
        config: {
          priorityId: TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Low],
        },
      },
      {
        id: "s2",
        action: SecurityPlaybookActionType.SetCaseStatus,
        config: {
          statusId: TEST_STATUS_IDS[SecurityCaseStage.Contained],
          verdict: SecurityCaseVerdict.FalsePositive,
        },
      },
    ] as unknown as JSONArray;

    await service.onBeforeCreate({ data: contains, props: { isRoot: true } });

    // A verdict on a status that does not close the case is dropped.
    expect(
      (contains.steps as unknown as Array<SecurityPlaybookStep>)[1]!.config,
    ).toEqual({ statusId: TEST_STATUS_IDS[SecurityCaseStage.Contained] });
  });

  test("holds an update's steps to each row's project's lists", async () => {
    stubSecurityCaseValues();

    const row: SecurityPlaybook = new SecurityPlaybook();
    row._id = PLAYBOOK_ID.toString();
    row.projectId = PROJECT_ID;
    row.steps = [] as unknown as JSONArray;

    getJestSpyOn(
      SecurityPlaybookService,
      "findRowsAndHoldUpdateToThem",
    ).mockResolvedValue([row] as never);

    await expect(
      service.onBeforeUpdate({
        query: { _id: PLAYBOOK_ID.toString() },
        data: {
          steps: [
            {
              id: "s1",
              action: SecurityPlaybookActionType.SetCasePriority,
              // Another project's priority.
              config: { priorityId: "c9000000-0000-4000-8000-000000000001" },
            },
          ],
        } as never,
        skip: 0,
        limit: 1,
        props: { isRoot: true },
      }),
    ).rejects.toThrow(
      "Step 1 (Set the priority): choose one of this project's case priorities.",
    );
  });
});

describe("SecurityPlaybookRunService", () => {
  const service: HookCaller<SecurityPlaybookRun> =
    SecurityPlaybookRunService as unknown as HookCaller<SecurityPlaybookRun>;

  function storedPlaybook(steps: Array<JSONObject>): void {
    const playbook: SecurityPlaybook = new SecurityPlaybook();
    playbook._id = PLAYBOOK_ID.toString();
    playbook.name = "Triage";
    playbook.steps = steps as unknown as JSONArray;

    getJestSpyOn(SecurityPlaybookService, "findOneBy").mockResolvedValue(
      playbook as never,
    );
  }

  function newRun(): SecurityPlaybookRun {
    const run: SecurityPlaybookRun = new SecurityPlaybookRun();
    run.projectId = PROJECT_ID;
    run.securityCaseId = CASE_ID;
    run.securityPlaybookId = PLAYBOOK_ID;
    return run;
  }

  beforeEach(() => {
    const securityCase: SecurityCase = new SecurityCase();
    securityCase._id = CASE_ID.toString();
    getJestSpyOn(SecurityCaseService, "findOneBy").mockResolvedValue(
      securityCase as never,
    );
    getJestSpyOn(SecurityPlaybookRunService, "countBy").mockResolvedValue(
      new PositiveNumber(0) as never,
    );
  });

  test("copies the playbook's steps onto a person's run, as a Manual run of theirs", async () => {
    storedPlaybook([
      {
        id: "s1",
        action: SecurityPlaybookActionType.CheckThreatIntel,
        config: {},
      },
    ]);

    const run: SecurityPlaybookRun = newRun();
    // Whatever a person sends for these, the run decides them.
    run.trigger = SecurityPlaybookTrigger.CaseOpened;

    await service.onBeforeCreate({
      data: run,
      props: { tenantId: PROJECT_ID, userId: USER_ID },
    });

    expect(run.playbookName).toBe("Triage");
    expect(run.status).toBe(SecurityPlaybookRunStatus.Queued);
    expect(run.trigger).toBe(SecurityPlaybookTrigger.Manual);
    expect(run.triggeredByUserId?.toString()).toBe(USER_ID.toString());
    expect(run.currentStepIndex).toBe(0);
    expect(
      (run.steps as unknown as Array<SecurityPlaybookStep>)[0]!.action,
    ).toBe(SecurityPlaybookActionType.CheckThreatIntel);
    expect(
      (run.stepResults as unknown as Array<SecurityPlaybookStepResult>)[0]!
        .status,
    ).toBe(SecurityPlaybookStepStatus.Pending);
  });

  test("keeps the trigger OneUptime names for an automatic run", async () => {
    storedPlaybook([
      {
        id: "s1",
        action: SecurityPlaybookActionType.CheckThreatIntel,
        config: {},
      },
    ]);

    const run: SecurityPlaybookRun = newRun();
    run.trigger = SecurityPlaybookTrigger.DetectionAdded;

    await service.onBeforeCreate({ data: run, props: { isRoot: true } });

    expect(run.trigger).toBe(SecurityPlaybookTrigger.DetectionAdded);
    expect(run.triggeredByUserId).toBeUndefined();
  });

  test("refuses a playbook without steps, and a second unfinished run of it on the case", async () => {
    storedPlaybook([]);

    await expect(
      service.onBeforeCreate({ data: newRun(), props: { isRoot: true } }),
    ).rejects.toThrow(/no steps yet/);

    storedPlaybook([
      {
        id: "s1",
        action: SecurityPlaybookActionType.CheckThreatIntel,
        config: {},
      },
    ]);
    getJestSpyOn(SecurityPlaybookRunService, "countBy").mockResolvedValue(
      new PositiveNumber(1) as never,
    );

    await expect(
      service.onBeforeCreate({ data: newRun(), props: { isRoot: true } }),
    ).rejects.toThrow(/already running on this case/);
  });

  test("lets a person do nothing to a run but cancel it before it finishes", async () => {
    const update: (
      status: SecurityPlaybookRunStatus,
    ) => UpdateBy<SecurityPlaybookRun> = (
      status: SecurityPlaybookRunStatus,
    ) => {
      return {
        query: { _id: RUN_ID.toString() },
        data: { status } as never,
        skip: 0,
        limit: 1,
        props: { tenantId: PROJECT_ID, userId: USER_ID },
      };
    };

    await expect(
      service.onBeforeUpdate(update(SecurityPlaybookRunStatus.Succeeded)),
    ).rejects.toThrow(/can only be cancelled/);

    const finished: SecurityPlaybookRun = new SecurityPlaybookRun();
    finished._id = RUN_ID.toString();
    finished.status = SecurityPlaybookRunStatus.Failed;

    getJestSpyOn(
      SecurityPlaybookRunService,
      "findRowsAndHoldUpdateToThem",
    ).mockResolvedValue([finished] as never);

    await expect(
      service.onBeforeUpdate(update(SecurityPlaybookRunStatus.Cancelled)),
    ).rejects.toThrow(/already finished/);

    finished.status = SecurityPlaybookRunStatus.WaitingForApproval;

    await expect(
      service.onBeforeUpdate(update(SecurityPlaybookRunStatus.Cancelled)),
    ).resolves.toBeTruthy();
  });
});

describe("SecurityPlaybookRunAPI.decide", () => {
  const steps: Array<SecurityPlaybookStep> = [
    {
      id: "s1",
      action: SecurityPlaybookActionType.SuspendOktaUser,
      config: { connectionId: CONNECTION_ID },
      requiresApproval: true,
      continueOnFailure: false,
      onlyIfThreatIntelMatched: false,
    },
  ];

  let cas: Spy;
  let enqueue: Spy;
  let feed: Spy;

  function waitingRun(status: SecurityPlaybookRunStatus): void {
    const run: SecurityPlaybookRun = new SecurityPlaybookRun();
    run._id = RUN_ID.toString();
    run.projectId = PROJECT_ID;
    run.securityCaseId = CASE_ID;
    run.playbookName = "Contain";
    run.status = status;
    run.steps = steps as unknown as JSONArray;
    run.stepResults = buildPendingStepResults(steps) as unknown as JSONArray;
    run.currentStepIndex = 0;

    /*
     * The run as the caller may change it. Who may change which run is
     * pinned through the routes, in SecurityPlaybookRunChangeScope.test.ts.
     */
    getJestSpyOn(
      SecurityPlaybookRunService,
      "findOneUpdatableById",
    ).mockResolvedValue(run as never);
  }

  beforeEach(() => {
    cas = getJestSpyOn(
      SecurityPlaybookRunService,
      "compareAndSetColumnsByIdWithoutHooks",
    ).mockResolvedValue(true as never);
    enqueue = getJestSpyOn(Queue, "addJob").mockResolvedValue(
      undefined as never,
    );
    feed = getJestSpyOn(
      SecurityCaseFeedService,
      "createSecurityCaseFeedItem",
    ).mockResolvedValue(undefined as never);
  });

  test("records an approval on the step and queues the run", async () => {
    waitingRun(SecurityPlaybookRunStatus.WaitingForApproval);

    await SecurityPlaybookRunAPI.decide({
      projectId: PROJECT_ID,
      runId: RUN_ID,
      decision: SecurityPlaybookApprovalDecision.Approved,
      props: { tenantId: PROJECT_ID, userId: USER_ID },
      comment: "Confirmed with the user's manager.",
    });

    const write: {
      data: { status: string; stepResults: Array<SecurityPlaybookStepResult> };
      expectedData: { status: string };
    } = cas.mock.calls[0]![0] as never;

    // The step results are compared too: an undo written meanwhile is never lost.
    expect(write.expectedData).toEqual({
      status: SecurityPlaybookRunStatus.WaitingForApproval,
      stepResults: buildPendingStepResults(steps),
    });
    expect(write.data.status).toBe(SecurityPlaybookRunStatus.Queued);
    expect(write.data.stepResults[0]!.approval).toMatchObject({
      decision: SecurityPlaybookApprovalDecision.Approved,
      decidedByUserId: USER_ID.toString(),
      comment: "Confirmed with the user's manager.",
    });
    expect(enqueue).toHaveBeenCalledTimes(1);
    expect(feed).toHaveBeenCalledTimes(1);
  });

  test("ends the run on a rejection, without queueing it", async () => {
    waitingRun(SecurityPlaybookRunStatus.WaitingForApproval);

    await SecurityPlaybookRunAPI.decide({
      projectId: PROJECT_ID,
      runId: RUN_ID,
      decision: SecurityPlaybookApprovalDecision.Rejected,
      props: { tenantId: PROJECT_ID, userId: USER_ID },
    });

    const write: {
      data: { status: string; stepResults: Array<SecurityPlaybookStepResult> };
    } = cas.mock.calls[0]![0] as never;

    expect(write.data.status).toBe(SecurityPlaybookRunStatus.Cancelled);
    expect(write.data.stepResults[0]!.status).toBe(
      SecurityPlaybookStepStatus.Rejected,
    );
    expect(enqueue).not.toHaveBeenCalled();
  });

  test("refuses a run that is not waiting, and a decision somebody beat them to", async () => {
    waitingRun(SecurityPlaybookRunStatus.Running);

    await expect(
      SecurityPlaybookRunAPI.decide({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        decision: SecurityPlaybookApprovalDecision.Approved,
        props: { tenantId: PROJECT_ID, userId: USER_ID },
      }),
    ).rejects.toThrow(/not waiting for an approval/);

    waitingRun(SecurityPlaybookRunStatus.WaitingForApproval);
    cas.mockResolvedValue(false as never);

    await expect(
      SecurityPlaybookRunAPI.decide({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        decision: SecurityPlaybookApprovalDecision.Approved,
        props: { tenantId: PROJECT_ID, userId: USER_ID },
      }),
    ).rejects.toThrow(/decided on this step a moment ago/);
    expect(enqueue).not.toHaveBeenCalled();
  });
});

describe("SecurityPlaybookService: who may let a containment step run without approval", () => {
  const service: HookCaller<SecurityPlaybook> =
    SecurityPlaybookService as unknown as HookCaller<SecurityPlaybook>;

  const SECURITY_ADMIN: DatabaseCommonInteractionProps = memberWith(
    USER_ID,
    Permission.SecurityAdmin,
  );
  // May edit playbooks (a custom role), but is no Security Admin.
  const PLAYBOOK_EDITOR: DatabaseCommonInteractionProps = memberWith(
    OTHER_USER_ID,
    Permission.EditSecurityPlaybook,
    Permission.CreateSecurityPlaybook,
  );

  function containmentStep(extra: JSONObject = {}): JSONObject {
    return {
      id: "s1",
      action: SecurityPlaybookActionType.SuspendOktaUser,
      config: { connectionId: CONNECTION_ID },
      ...extra,
    };
  }

  function rule(
    steps: Array<JSONObject>,
    props: DatabaseCommonInteractionProps,
    storedSteps: Array<JSONObject> = [],
  ): Array<SecurityPlaybookStep> {
    return SecurityPlaybookServiceType.applyContainmentApprovalRule({
      steps: steps as unknown as Array<SecurityPlaybookStep>,
      storedSteps: storedSteps as unknown as Array<SecurityPlaybookStep>,
      props,
    });
  }

  beforeEach(() => {
    const okta: SecurityEventConnection = new SecurityEventConnection();
    okta._id = CONNECTION_ID;
    okta.name = "Okta";
    okta.provider = SecurityEventConnectorProvider.OktaSystemLog;

    getJestSpyOn(SecurityEventConnectionService, "findBy").mockResolvedValue([
      okta,
    ] as never);
  });

  test("a Security Admin can, and the step is stamped with who and when", () => {
    const [ruled] = rule(
      [containmentStep({ requiresApproval: false })],
      SECURITY_ADMIN,
    );

    expect(ruled!.requiresApproval).toBe(false);
    expect(ruled!.approvalTurnedOff?.byUserId).toBe(USER_ID.toString());
    expect(ruled!.approvalTurnedOff?.at).toBeTruthy();

    for (const permission of [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
    ]) {
      expect(
        rule(
          [containmentStep({ requiresApproval: false })],
          memberWith(USER_ID, permission),
        )[0]!.approvalTurnedOff,
      ).toBeTruthy();
    }
  });

  test("anyone else is refused, naming the step", () => {
    expect(() => {
      rule([containmentStep({ requiresApproval: false })], PLAYBOOK_EDITOR);
    }).toThrow(
      "Step 1 (Suspend the user in Okta): a containment step waits for approval. Only a Security Admin can let it run without one.",
    );
  });

  test("a stamp a write sends is never taken as it is", () => {
    const forged: JSONObject = containmentStep({
      requiresApproval: false,
      approvalTurnedOff: {
        byUserId: USER_ID.toString(),
        at: "2026-01-01T00:00:00.000Z",
      },
    });

    expect(() => {
      rule([forged], PLAYBOOK_EDITOR);
    }).toThrow(/Only a Security Admin/);

    // An admin's save is stamped with the admin, not with what was sent.
    expect(
      rule([forged], memberWith(OTHER_USER_ID, Permission.SecurityAdmin))[0]!
        .approvalTurnedOff?.byUserId,
    ).toBe(OTHER_USER_ID.toString());
  });

  test("anyone may save a playbook whose step a Security Admin turned off, while the step stays as it was", () => {
    const stamp: JSONObject = {
      byUserId: USER_ID.toString(),
      at: "2026-10-01T00:00:00.000Z",
    };
    const stored: JSONObject = containmentStep({
      requiresApproval: false,
      approvalTurnedOff: stamp,
    });

    const [kept] = rule(
      [containmentStep({ requiresApproval: false })],
      PLAYBOOK_EDITOR,
      [stored],
    );

    expect(kept!.approvalTurnedOff).toEqual(stamp);

    // Pointed at another connection, it is a new decision: a Security Admin's.
    expect(() => {
      rule(
        [
          containmentStep({
            requiresApproval: false,
            config: { connectionId: OTHER_CONNECTION_ID },
          }),
        ],
        PLAYBOOK_EDITOR,
        [stored],
      );
    }).toThrow(/Only a Security Admin/);
  });

  test("a step that asks for approval, and any other step, carries no stamp", () => {
    const steps: Array<SecurityPlaybookStep> = rule(
      [
        containmentStep({
          requiresApproval: true,
          approvalTurnedOff: { at: "2026-01-01T00:00:00.000Z" },
        }),
        {
          id: "s2",
          action: SecurityPlaybookActionType.AddCaseNote,
          config: { note: "n" },
          approvalTurnedOff: { at: "2026-01-01T00:00:00.000Z" },
        },
      ],
      PLAYBOOK_EDITOR,
    );

    expect(steps[0]!.approvalTurnedOff).toBeUndefined();
    expect(steps[1]!.approvalTurnedOff).toBeUndefined();
  });

  test("is asked when a playbook is created, after its steps are read", async () => {
    const playbook: SecurityPlaybook = new SecurityPlaybook();
    playbook.projectId = PROJECT_ID;
    playbook.name = "Contain";
    playbook.steps = [
      containmentStep({ requiresApproval: false }),
    ] as unknown as JSONArray;

    await expect(
      service.onBeforeCreate({ data: playbook, props: PLAYBOOK_EDITOR }),
    ).rejects.toThrow(/Only a Security Admin/);

    // A step that says nothing about approval waits for it.
    const quiet: SecurityPlaybook = new SecurityPlaybook();
    quiet.projectId = PROJECT_ID;
    quiet.name = "Contain";
    quiet.steps = [containmentStep()] as unknown as JSONArray;

    await service.onBeforeCreate({ data: quiet, props: PLAYBOOK_EDITOR });

    expect(
      (quiet.steps as unknown as Array<SecurityPlaybookStep>)[0]!
        .requiresApproval,
    ).toBe(true);
  });

  test("is asked when a playbook's steps change, against each row's own stored steps", async () => {
    const row: SecurityPlaybook = new SecurityPlaybook();
    row._id = PLAYBOOK_ID.toString();
    row.projectId = PROJECT_ID;
    row.steps = [
      containmentStep({
        requiresApproval: false,
        approvalTurnedOff: {
          byUserId: USER_ID.toString(),
          at: "2026-10-01T00:00:00.000Z",
        },
      }),
    ] as unknown as JSONArray;

    getJestSpyOn(
      SecurityPlaybookService,
      "findRowsAndHoldUpdateToThem",
    ).mockResolvedValue([row] as never);

    const updateBy: UpdateBy<SecurityPlaybook> = {
      query: { _id: PLAYBOOK_ID.toString() },
      data: {
        steps: [
          containmentStep({ requiresApproval: false }),
          {
            id: "s2",
            action: SecurityPlaybookActionType.AddCaseNote,
            config: { note: "Contained." },
          },
        ],
      } as never,
      skip: 0,
      limit: 1,
      props: PLAYBOOK_EDITOR,
    };

    await service.onBeforeUpdate(updateBy);

    const saved: Array<SecurityPlaybookStep> = (
      updateBy.data as unknown as { steps: Array<SecurityPlaybookStep> }
    ).steps;

    expect(saved[0]!.approvalTurnedOff?.byUserId).toBe(USER_ID.toString());
    expect(saved[1]!.action).toBe(SecurityPlaybookActionType.AddCaseNote);
  });
});

describe("SecurityPlaybookRunAPI.decide: who approves, and what", () => {
  const steps: Array<SecurityPlaybookStep> = [
    {
      id: "s1",
      action: SecurityPlaybookActionType.SuspendOktaUser,
      config: { connectionId: CONNECTION_ID },
      requiresApproval: true,
      continueOnFailure: false,
      onlyIfThreatIntelMatched: false,
    },
  ];

  let cas: Spy;
  let feed: Spy;
  let audit: Spy;

  function waitingRun(data: {
    triggeredByUserId?: ObjectID | undefined;
    targets?: Array<SecurityPlaybookTarget> | undefined;
  }): void {
    const results: Array<SecurityPlaybookStepResult> =
      buildPendingStepResults(steps);
    results[0]!.status = SecurityPlaybookStepStatus.WaitingForApproval;

    if (data.targets) {
      results[0]!.targets = data.targets;
    }

    const run: SecurityPlaybookRun = new SecurityPlaybookRun();
    run._id = RUN_ID.toString();
    run.projectId = PROJECT_ID;
    run.securityCaseId = CASE_ID;
    run.securityPlaybookId = PLAYBOOK_ID;
    run.playbookName = "Contain";
    run.status = SecurityPlaybookRunStatus.WaitingForApproval;
    run.steps = steps as unknown as JSONArray;
    run.stepResults = results as unknown as JSONArray;
    run.currentStepIndex = 0;

    if (data.triggeredByUserId) {
      run.triggeredByUserId = data.triggeredByUserId;
    }

    getJestSpyOn(
      SecurityPlaybookRunService,
      "findOneUpdatableById",
    ).mockResolvedValue(run as never);
  }

  function written(): Array<SecurityPlaybookStepResult> {
    return (
      cas.mock.calls[0]![0] as {
        data: { stepResults: Array<SecurityPlaybookStepResult> };
      }
    ).data.stepResults;
  }

  beforeEach(() => {
    cas = getJestSpyOn(
      SecurityPlaybookRunService,
      "compareAndSetColumnsByIdWithoutHooks",
    ).mockResolvedValue(true as never);
    getJestSpyOn(Queue, "addJob").mockResolvedValue(undefined as never);
    feed = getJestSpyOn(
      SecurityCaseFeedService,
      "createSecurityCaseFeedItem",
    ).mockResolvedValue(undefined as never);
    audit = getJestSpyOn(AuditLogService, "recordUpdate").mockResolvedValue(
      undefined as never,
    );
  });

  test("the person who started the run cannot approve its step, and may reject it", async () => {
    waitingRun({ triggeredByUserId: USER_ID });

    await expect(
      SecurityPlaybookRunAPI.decide({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        decision: SecurityPlaybookApprovalDecision.Approved,
        props: { tenantId: PROJECT_ID, userId: USER_ID },
      }),
    ).rejects.toThrow(SELF_APPROVAL_REFUSED_MESSAGE);
    expect(cas).not.toHaveBeenCalled();

    await SecurityPlaybookRunAPI.decide({
      projectId: PROJECT_ID,
      runId: RUN_ID,
      decision: SecurityPlaybookApprovalDecision.Rejected,
      props: { tenantId: PROJECT_ID, userId: USER_ID },
    });

    expect(written()[0]!.status).toBe(SecurityPlaybookStepStatus.Rejected);
  });

  test("somebody else approves it", async () => {
    waitingRun({ triggeredByUserId: USER_ID });

    await SecurityPlaybookRunAPI.decide({
      projectId: PROJECT_ID,
      runId: RUN_ID,
      decision: SecurityPlaybookApprovalDecision.Approved,
      props: { tenantId: PROJECT_ID, userId: OTHER_USER_ID },
    });

    expect(written()[0]!.approval?.decidedByUserId).toBe(
      OTHER_USER_ID.toString(),
    );
  });

  test("a run nobody started - a detection's - is approved by anyone who may", async () => {
    waitingRun({});

    await SecurityPlaybookRunAPI.decide({
      projectId: PROJECT_ID,
      runId: RUN_ID,
      decision: SecurityPlaybookApprovalDecision.Approved,
      props: { tenantId: PROJECT_ID, userId: USER_ID },
    });

    expect(cas).toHaveBeenCalledTimes(1);
  });

  test("keeps the targets the approver ticked, leaves the rest out, and says so on the case", async () => {
    waitingRun({
      targets: [
        userTarget("mallory@acme.com"),
        userTarget("trent@acme.com"),
        userTarget(
          "breakglass@acme.com",
          SecurityPlaybookTargetState.Protected,
        ),
      ],
    });

    await SecurityPlaybookRunAPI.decide({
      projectId: PROJECT_ID,
      runId: RUN_ID,
      decision: SecurityPlaybookApprovalDecision.Approved,
      props: { tenantId: PROJECT_ID, userId: USER_ID },
      targets: [" Mallory@Acme.com "],
    });

    expect(
      written()[0]!.targets!.map((target: SecurityPlaybookTarget): string => {
        return `${target.value}: ${target.state}`;
      }),
    ).toEqual([
      "mallory@acme.com: Proposed",
      "trent@acme.com: Left Out",
      "breakglass@acme.com: Protected",
    ]);
    expect(written()[0]!.approval?.targets).toEqual(["mallory@acme.com"]);
    expect(
      (feed.mock.calls[0]![0] as { feedInfoInMarkdown: string })
        .feedInfoInMarkdown,
    ).toContain("for `mallory@acme.com`, leaving out `trent@acme.com`.");
  });

  test("an approval without a list keeps every target", async () => {
    waitingRun({ targets: [userTarget("mallory@acme.com")] });

    await SecurityPlaybookRunAPI.decide({
      projectId: PROJECT_ID,
      runId: RUN_ID,
      decision: SecurityPlaybookApprovalDecision.Approved,
      props: { tenantId: PROJECT_ID, userId: USER_ID },
    });

    expect(written()[0]!.approval?.targets).toEqual(["mallory@acme.com"]);
  });

  test("an approver can leave targets out, never add one, and keeps at least one", async () => {
    waitingRun({
      targets: [
        userTarget("mallory@acme.com"),
        userTarget(
          "breakglass@acme.com",
          SecurityPlaybookTargetState.Protected,
        ),
      ],
    });

    for (const [targets, message] of [
      [["alice@acme.com"], /not one of this step's targets/],
      [["breakglass@acme.com"], /not one of this step's targets/],
      [[], /Keep at least one target/],
    ] as Array<[Array<string>, RegExp]>) {
      await expect(
        SecurityPlaybookRunAPI.decide({
          projectId: PROJECT_ID,
          runId: RUN_ID,
          decision: SecurityPlaybookApprovalDecision.Approved,
          props: { tenantId: PROJECT_ID, userId: USER_ID },
          targets,
        }),
      ).rejects.toThrow(message);
    }

    expect(cas).not.toHaveBeenCalled();
    expect(() => {
      SecurityPlaybookRunAPI.readTargetsBody("mallory@acme.com");
    }).toThrow(/must be a list/);
  });

  test("records an approval and a rejection in the project's audit log, as the decider's change to the run", async () => {
    waitingRun({ targets: [userTarget("mallory@acme.com")] });

    const approver: DatabaseCommonInteractionProps = memberWith(
      USER_ID,
      Permission.SecurityMember,
    );

    await SecurityPlaybookRunAPI.decide({
      projectId: PROJECT_ID,
      runId: RUN_ID,
      decision: SecurityPlaybookApprovalDecision.Approved,
      props: approver,
      comment: "Confirmed with the user's manager.",
    });

    const entry: {
      model: SecurityPlaybookRun;
      before: SecurityPlaybookRun;
      updatedFields: JSONObject;
      itemId: ObjectID;
      props: DatabaseCommonInteractionProps;
    } = audit.mock.calls[0]![0] as never;

    expect(entry.model).toBeInstanceOf(SecurityPlaybookRun);
    expect(entry.itemId.toString()).toBe(RUN_ID.toString());
    expect(entry.props).toBe(approver);
    expect(entry.before.status).toBe(
      SecurityPlaybookRunStatus.WaitingForApproval,
    );
    expect(entry.before.securityCaseId?.toString()).toBe(CASE_ID.toString());
    expect(entry.updatedFields["status"]).toBe(
      SecurityPlaybookRunStatus.Queued,
    );
    expect(
      (
        entry.updatedFields[
          "stepResults"
        ] as unknown as Array<SecurityPlaybookStepResult>
      )[0]!.approval,
    ).toMatchObject({
      decision: SecurityPlaybookApprovalDecision.Approved,
      decidedByUserId: USER_ID.toString(),
      comment: "Confirmed with the user's manager.",
      targets: ["mallory@acme.com"],
    });

    await SecurityPlaybookRunAPI.decide({
      projectId: PROJECT_ID,
      runId: RUN_ID,
      decision: SecurityPlaybookApprovalDecision.Rejected,
      props: approver,
    });

    expect(
      (audit.mock.calls[1]![0] as { updatedFields: JSONObject }).updatedFields[
        "status"
      ],
    ).toBe(SecurityPlaybookRunStatus.Cancelled);
  });

  test("records nothing when the decision did not land", async () => {
    waitingRun({});
    cas.mockResolvedValue(false as never);

    await expect(
      SecurityPlaybookRunAPI.decide({
        projectId: PROJECT_ID,
        runId: RUN_ID,
        decision: SecurityPlaybookApprovalDecision.Approved,
        props: { tenantId: PROJECT_ID, userId: USER_ID },
      }),
    ).rejects.toThrow(/decided on this step a moment ago/);
    expect(audit).not.toHaveBeenCalled();
  });
});

describe("SecurityPlaybookRunAPI.undoTarget, the one-click on a contained target", () => {
  const OKTA_STEP: SecurityPlaybookStep = {
    id: "s1",
    action: SecurityPlaybookActionType.SuspendOktaUser,
    config: { connectionId: CONNECTION_ID },
    requiresApproval: true,
    continueOnFailure: false,
    onlyIfThreatIntelMatched: false,
  };

  let cas: Spy;
  let feed: Spy;
  let audit: Spy;
  let requests: Array<DataSourceHttpRequest>;

  function finishedRun(data: {
    step?: SecurityPlaybookStep;
    status?: SecurityPlaybookRunStatus;
    targets: Array<SecurityPlaybookTarget>;
  }): SecurityPlaybookRun {
    const step: SecurityPlaybookStep = data.step || OKTA_STEP;
    const results: Array<SecurityPlaybookStepResult> = buildPendingStepResults([
      step,
    ]);
    results[0]!.status = SecurityPlaybookStepStatus.Succeeded;
    results[0]!.targets = data.targets;

    const run: SecurityPlaybookRun = new SecurityPlaybookRun();
    run._id = RUN_ID.toString();
    run.projectId = PROJECT_ID;
    run.securityCaseId = CASE_ID;
    run.playbookName = "Contain";
    run.status = data.status || SecurityPlaybookRunStatus.Succeeded;
    run.steps = [step] as unknown as JSONArray;
    run.stepResults = results as unknown as JSONArray;
    run.currentStepIndex = 1;

    getJestSpyOn(
      SecurityPlaybookRunService,
      "findOneUpdatableById",
    ).mockResolvedValue(run as never);

    return run;
  }

  function undo(
    value: string = "mallory@acme.com",
  ): Promise<SecurityPlaybookTarget> {
    return SecurityPlaybookRunAPI.undoTarget({
      projectId: PROJECT_ID,
      runId: RUN_ID,
      stepId: "s1",
      value,
      props: { tenantId: PROJECT_ID, userId: USER_ID },
    });
  }

  beforeEach(() => {
    requests = [];

    const okta: SecurityEventConnection = new SecurityEventConnection();
    okta._id = CONNECTION_ID;
    okta.name = "Okta";
    okta.provider = SecurityEventConnectorProvider.OktaSystemLog;

    getJestSpyOn(SecurityEventConnectionService, "findOneBy").mockResolvedValue(
      okta as never,
    );
    getJestSpyOn(
      SecurityEventConnectionService,
      "getConnectorSettings",
    ).mockResolvedValue({
      provider: SecurityEventConnectorProvider.OktaSystemLog,
      config: { orgUrl: "https://acme.okta.com" },
      secrets: { apiToken: "00okta-token" },
      alertingOnly: false,
    } as never);

    const securityCase: SecurityCase = new SecurityCase();
    securityCase.caseNumberWithPrefix = "CASE-7";
    getJestSpyOn(SecurityCaseService, "findOneById").mockResolvedValue(
      securityCase as never,
    );

    // Okta itself: mallory is suspended; unsuspending her works.
    getJestSpyOn(DataSourceHttpFetch, "fetch").mockImplementation(
      async (request: unknown): Promise<DataSourceHttpResponse> => {
        requests.push(request as DataSourceHttpRequest);
        const body: unknown =
          (request as DataSourceHttpRequest).method === "GET"
            ? {
                id: "00u-mallory",
                status: "SUSPENDED",
                profile: { login: "mallory@acme.com" },
              }
            : {};

        return {
          statusCode: 200,
          bodyText: JSON.stringify(body),
          bodyJson: body,
        } as DataSourceHttpResponse;
      },
    );

    cas = getJestSpyOn(
      SecurityPlaybookRunService,
      "compareAndSetColumnsByIdWithoutHooks",
    ).mockResolvedValue(true as never);
    feed = getJestSpyOn(
      SecurityCaseFeedService,
      "createSecurityCaseFeedItem",
    ).mockResolvedValue(undefined as never);
    audit = getJestSpyOn(AuditLogService, "recordUpdate").mockResolvedValue(
      undefined as never,
    );
  });

  test("unsuspends the account in Okta, marks it undone on the step, and records who did it", async () => {
    const run: SecurityPlaybookRun = finishedRun({
      targets: [
        {
          ...userTarget("mallory@acme.com", SecurityPlaybookTargetState.Done),
          detail: "suspended",
        },
      ],
    });

    const target: SecurityPlaybookTarget = await undo("MALLORY@acme.com");

    expect(target).toMatchObject({
      value: "mallory@acme.com",
      state: SecurityPlaybookTargetState.Undone,
      detail: "unsuspended",
      undoneByUserId: USER_ID.toString(),
    });
    expect(
      requests.map((request: DataSourceHttpRequest): string => {
        return `${request.method} ${request.url}`;
      }),
    ).toEqual([
      "GET https://acme.okta.com/api/v1/users/mallory%40acme.com",
      "POST https://acme.okta.com/api/v1/users/00u-mallory/lifecycle/unsuspend",
    ]);

    const write: {
      data: { stepResults: Array<SecurityPlaybookStepResult> };
      expectedData: JSONObject;
    } = cas.mock.calls[0]![0] as never;

    expect(write.expectedData).toEqual({
      status: SecurityPlaybookRunStatus.Succeeded,
      stepResults: run.stepResults,
    });
    expect(write.data.stepResults[0]!.targets![0]!.state).toBe(
      SecurityPlaybookTargetState.Undone,
    );
    expect(
      (feed.mock.calls[0]![0] as { feedInfoInMarkdown: string })
        .feedInfoInMarkdown,
    ).toContain(
      "Unsuspend the user in Okta: `mallory@acme.com` unsuspended, undoing step 1 (Suspend the user in Okta)",
    );
    expect(audit).toHaveBeenCalledTimes(1);
  });

  test("tries again on a run that changed under it, from what is there now", async () => {
    finishedRun({
      targets: [
        userTarget("mallory@acme.com", SecurityPlaybookTargetState.Done),
      ],
    });
    cas
      .mockResolvedValueOnce(false as never)
      .mockResolvedValueOnce(true as never);

    const fresh: SecurityPlaybookRun = new SecurityPlaybookRun();
    fresh._id = RUN_ID.toString();
    fresh.status = SecurityPlaybookRunStatus.Succeeded;
    fresh.steps = [OKTA_STEP] as unknown as JSONArray;
    fresh.stepResults = [
      {
        stepId: "s1",
        action: SecurityPlaybookActionType.SuspendOktaUser,
        status: SecurityPlaybookStepStatus.Succeeded,
        targets: [
          userTarget("mallory@acme.com", SecurityPlaybookTargetState.Done),
          userTarget("trent@acme.com", SecurityPlaybookTargetState.Undone),
        ],
      },
    ] as unknown as JSONArray;

    getJestSpyOn(SecurityPlaybookRunService, "findOneById").mockResolvedValue(
      fresh as never,
    );

    await undo();

    const second: {
      data: { stepResults: Array<SecurityPlaybookStepResult> };
    } = cas.mock.calls[1]![0] as never;

    expect(
      second.data.stepResults[0]!.targets!.map(
        (target: SecurityPlaybookTarget): string => {
          return `${target.value}: ${target.state}`;
        },
      ),
    ).toEqual(["mallory@acme.com: Undone", "trent@acme.com: Undone"]);
  });

  test("refuses a run still running, a target it never contained, one already undone, and a step nothing undoes", async () => {
    finishedRun({
      status: SecurityPlaybookRunStatus.Running,
      targets: [
        userTarget("mallory@acme.com", SecurityPlaybookTargetState.Done),
      ],
    });
    await expect(undo()).rejects.toThrow(/still running/);

    // Already suspended before the step ran: not the step's to give back.
    for (const state of [
      SecurityPlaybookTargetState.Protected,
      SecurityPlaybookTargetState.LeftOut,
      SecurityPlaybookTargetState.NotFound,
      SecurityPlaybookTargetState.Failed,
      SecurityPlaybookTargetState.AlreadyDone,
    ]) {
      finishedRun({ targets: [userTarget("mallory@acme.com", state)] });
      await expect(undo()).rejects.toThrow(/nothing of its to undo/);
    }

    finishedRun({
      targets: [
        userTarget("mallory@acme.com", SecurityPlaybookTargetState.Undone),
      ],
    });
    await expect(undo()).rejects.toThrow(/already released/);

    finishedRun({
      targets: [
        userTarget("mallory@acme.com", SecurityPlaybookTargetState.Done),
      ],
    });
    await expect(undo("trent@acme.com")).rejects.toThrow(/not a target/);

    finishedRun({
      step: {
        ...OKTA_STEP,
        action: SecurityPlaybookActionType.EndOktaSessions,
      },
      targets: [
        userTarget("mallory@acme.com", SecurityPlaybookTargetState.Done),
      ],
    });
    await expect(undo()).rejects.toThrow(/cannot be taken back/);

    expect(requests).toEqual([]);
    expect(cas).not.toHaveBeenCalled();
  });

  test("says what the product answered when it refuses, and leaves the step as it was", async () => {
    finishedRun({
      targets: [
        userTarget("mallory@acme.com", SecurityPlaybookTargetState.Done),
      ],
    });

    getJestSpyOn(DataSourceHttpFetch, "fetch").mockImplementation(
      async (request: unknown): Promise<DataSourceHttpResponse> => {
        const isLookup: boolean =
          (request as DataSourceHttpRequest).method === "GET";
        const body: unknown = isLookup
          ? { id: "00u-mallory", status: "SUSPENDED", profile: {} }
          : { errorSummary: "You do not have permission" };

        return {
          statusCode: isLookup ? 200 : 403,
          bodyText: JSON.stringify(body),
          bodyJson: body,
        } as DataSourceHttpResponse;
      },
    );

    await expect(undo()).rejects.toThrow(/cannot unsuspend this user/);
    expect(cas).not.toHaveBeenCalled();
    expect(audit).not.toHaveBeenCalled();
  });
});
