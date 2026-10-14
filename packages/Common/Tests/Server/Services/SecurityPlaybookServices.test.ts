import SecurityPlaybookRunAPI from "../../../Server/API/SecurityPlaybookRunAPI";
import Queue from "../../../Server/Infrastructure/Queue";
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
import { ProjectScopedReference } from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import SecurityEventConnection from "../../../Models/DatabaseModels/SecurityEventConnection";
import SecurityPlaybook from "../../../Models/DatabaseModels/SecurityPlaybook";
import SecurityPlaybookRun from "../../../Models/DatabaseModels/SecurityPlaybookRun";
import PositiveNumber from "../../../Types/PositiveNumber";
import ObjectID from "../../../Types/ObjectID";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import SecurityEventConnectorProvider from "../../../Types/SecurityEvent/Connectors/SecurityEventConnectorProvider";
import { SecurityPlaybookActionType } from "../../../Types/SecurityPlaybook/SecurityPlaybookAction";
import SecurityPlaybookRunStatus, {
  SecurityPlaybookStepStatus,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import { SecurityPlaybookStep } from "../../../Types/SecurityPlaybook/SecurityPlaybookStep";
import {
  SecurityPlaybookApprovalDecision,
  SecurityPlaybookStepResult,
  buildPendingStepResults,
} from "../../../Types/SecurityPlaybook/SecurityPlaybookStepResult";
import SecurityPlaybookTrigger from "../../../Types/SecurityPlaybook/SecurityPlaybookTrigger";
import { getJestSpyOn } from "../../Spy";
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
const CONNECTION_ID: string = "88888888-8888-4888-8888-888888888888";

type HookCaller<TModel extends DatabaseBaseModel> = {
  checkCreateBeforeReferences: (createBy: CreateBy<TModel>) => Promise<void>;
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
    (playbook as unknown as JSONObject)["minimumPriority"] = "";

    await service.checkCreateBeforeReferences({
      data: playbook,
      props: { isRoot: true },
    });

    const steps: Array<SecurityPlaybookStep> =
      playbook.steps as unknown as Array<SecurityPlaybookStep>;

    expect(playbook.name).toBe("Triage");
    expect(steps[0]!.config).toEqual({ note: "Check the VPN." });
    expect(steps[0]!.id).toBeTruthy();
    expect(playbook.minimumPriority).toBeNull();
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

    getJestSpyOn(SecurityPlaybookRunService, "findOneBy").mockResolvedValue(
      run as never,
    );
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

    expect(write.expectedData).toEqual({
      status: SecurityPlaybookRunStatus.WaitingForApproval,
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
