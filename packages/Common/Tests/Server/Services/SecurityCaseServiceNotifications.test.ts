import SecurityCaseFeedService from "../../../Server/Services/SecurityCaseFeedService";
import SecurityCaseService, {
  SECURITY_CASE_OPENED_BY_DETECTION_KEY,
  SECURITY_CASE_PLAYBOOK_NAME_KEY,
} from "../../../Server/Services/SecurityCaseService";
import TeamService from "../../../Server/Services/TeamService";
import UserService from "../../../Server/Services/UserService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { securityCaseGroupingKey } from "../../../Server/Utils/SecurityCase/SecurityCaseIngest";
import SecurityCaseNotifications from "../../../Server/Utils/SecurityCase/SecurityCaseNotifications";
import SecurityPlaybookLauncher from "../../../Server/Utils/SecurityPlaybook/SecurityPlaybookLauncher";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import SecurityCasePriority from "../../../Types/SecurityCase/SecurityCasePriority";
import SecurityCaseStatus from "../../../Types/SecurityCase/SecurityCaseStatus";
import { SETUP_TEST_SOURCE_IP } from "../../../Types/SecurityEvent/SecuritySetupTest";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Where a case's notifications start (SecurityCaseNotifications): the case
 * service queues them as a case opens, rises, and is assigned. Pinned here:
 * what each change queues, for whom it says it was done, and that a lower
 * priority, an unassignment and the setup test's case queue nothing.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CASE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const PERSON_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const ALICE_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const TEAM_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");

type HookCaller = {
  onCreateSuccess: (
    onCreate: OnCreate<SecurityCase>,
    createdItem: SecurityCase,
  ) => Promise<SecurityCase>;
  onUpdateSuccess: (
    onUpdate: OnUpdate<SecurityCase>,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<OnUpdate<SecurityCase>>;
};

const service: HookCaller = SecurityCaseService as unknown as HookCaller;

let reached: Array<JSONObject>;
let assigned: Array<JSONObject>;

beforeEach(() => {
  reached = [];
  assigned = [];

  getJestSpyOn(
    SecurityCaseNotifications,
    "caseReachedPriority",
  ).mockImplementation(async (data: unknown) => {
    reached.push(data as JSONObject);
  });

  getJestSpyOn(SecurityCaseNotifications, "caseAssigned").mockImplementation(
    async (data: unknown) => {
      assigned.push(data as JSONObject);
    },
  );

  getJestSpyOn(
    SecurityCaseFeedService,
    "createSecurityCaseFeedItem",
  ).mockResolvedValue(undefined as never);

  getJestSpyOn(SecurityPlaybookLauncher, "launchForCase").mockResolvedValue(
    0 as never,
  );

  getJestSpyOn(
    SecurityCaseService,
    "updateColumnsByIdWithoutHooks",
  ).mockResolvedValue(undefined as never);

  getJestSpyOn(UserService, "findOneById").mockImplementation(async () => {
    const user: User = new User();
    user.name = "Alice" as never;
    return user;
  });

  getJestSpyOn(TeamService, "findOneById").mockImplementation(async () => {
    const team: Team = new Team();
    team.name = "Blue Team";
    return team;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function created(overrides: Partial<SecurityCase> = {}): SecurityCase {
  const securityCase: SecurityCase = new SecurityCase();
  securityCase._id = CASE_ID.toString();
  securityCase.projectId = PROJECT_ID;
  securityCase.priority = SecurityCasePriority.High;
  securityCase.status = SecurityCaseStatus.New;
  securityCase.groupingKey = "entity:198.51.100.7";
  Object.assign(securityCase, overrides);
  return securityCase;
}

function onCreate(data: {
  userId?: ObjectID | undefined;
  openedByDetection?: boolean | undefined;
}): OnCreate<SecurityCase> {
  return {
    createBy: {
      data: new SecurityCase(),
      props: data.userId
        ? { userId: data.userId, tenantId: PROJECT_ID }
        : { isRoot: true },
      ...(data.openedByDetection
        ? {
            miscDataProps: {
              [SECURITY_CASE_OPENED_BY_DETECTION_KEY]: true,
            },
          }
        : {}),
    } as unknown as CreateBy<SecurityCase>,
    carryForward: undefined,
  };
}

describe("a case that opens", () => {
  test("opened by a person: people are told it reached their priority, not the person", async () => {
    await service.onCreateSuccess(onCreate({ userId: PERSON_ID }), created());

    expect(reached).toEqual([
      {
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        actorUserId: PERSON_ID,
      },
    ]);
  });

  test("opened assigned: its assignee and team are told too", async () => {
    await service.onCreateSuccess(
      onCreate({ userId: PERSON_ID }),
      created({ assignedToUserId: ALICE_ID, assignedToTeamId: TEAM_ID }),
    );

    expect(assigned).toEqual([
      {
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        userId: ALICE_ID,
        teamId: TEAM_ID,
        actorUserId: PERSON_ID,
      },
    ]);
  });

  test("opened by a detection: queued the same, by nobody in particular", async () => {
    await service.onCreateSuccess(
      onCreate({ openedByDetection: true }),
      created({ priority: SecurityCasePriority.Critical }),
    );

    expect(reached).toEqual([
      {
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        actorUserId: undefined,
      },
    ]);
  });

  test("the setup test's case queues nothing", async () => {
    await service.onCreateSuccess(
      onCreate({ openedByDetection: true }),
      created({
        groupingKey: securityCaseGroupingKey({
          groupValue: SETUP_TEST_SOURCE_IP,
          fingerprint: "",
        }),
      }),
    );

    expect(reached).toEqual([]);
    expect(assigned).toEqual([]);
  });
});

describe("a case that changes", () => {
  function onUpdate(data: {
    change: JSONObject;
    before: Partial<{
      priority: SecurityCasePriority;
      assignedToUserId: string;
      assignedToTeamId: string;
    }>;
    userId?: ObjectID | undefined;
    playbookName?: string | undefined;
  }): OnUpdate<SecurityCase> {
    return {
      updateBy: {
        query: { _id: CASE_ID },
        data: data.change,
        props: data.userId
          ? { userId: data.userId, tenantId: PROJECT_ID }
          : { isRoot: true },
        ...(data.playbookName
          ? {
              miscDataProps: {
                [SECURITY_CASE_PLAYBOOK_NAME_KEY]: data.playbookName,
              },
            }
          : {}),
      } as unknown as UpdateBy<SecurityCase>,
      carryForward: new Map([
        [
          CASE_ID.toString(),
          {
            id: CASE_ID.toString(),
            projectId: PROJECT_ID,
            status: SecurityCaseStatus.Investigating,
            priority: data.before.priority || SecurityCasePriority.Medium,
            verdict: undefined,
            assignedToUserId: data.before.assignedToUserId,
            assignedToTeamId: data.before.assignedToTeamId,
            acknowledgedAt: new Date(),
            containedAt: undefined,
          },
        ],
      ]),
    };
  }

  test("a rise in priority may reach somebody's priority now", async () => {
    await service.onUpdateSuccess(
      onUpdate({
        change: { priority: SecurityCasePriority.Critical },
        before: { priority: SecurityCasePriority.Medium },
        userId: PERSON_ID,
      }),
      [CASE_ID],
    );

    expect(reached).toEqual([
      {
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        actorUserId: PERSON_ID,
      },
    ]);
  });

  test("a lower priority, or the same one, tells nobody", async () => {
    await service.onUpdateSuccess(
      onUpdate({
        change: { priority: SecurityCasePriority.Low },
        before: { priority: SecurityCasePriority.High },
      }),
      [CASE_ID],
    );
    await service.onUpdateSuccess(
      onUpdate({
        change: { priority: SecurityCasePriority.High },
        before: { priority: SecurityCasePriority.High },
      }),
      [CASE_ID],
    );

    expect(reached).toEqual([]);
  });

  test("assigned to a person by a playbook: that person is told, and by whom", async () => {
    await service.onUpdateSuccess(
      onUpdate({
        change: { assignedToUserId: ALICE_ID },
        before: {},
        playbookName: "Triage",
      }),
      [CASE_ID],
    );

    expect(assigned).toEqual([
      {
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        userId: ALICE_ID,
        teamId: undefined,
        actorUserId: undefined,
        playbookName: "Triage",
      },
    ]);
  });

  test("moved to another team with the same person on it: only the team is told", async () => {
    await service.onUpdateSuccess(
      onUpdate({
        change: { assignedToTeamId: TEAM_ID },
        before: { assignedToUserId: ALICE_ID.toString() },
        userId: PERSON_ID,
      }),
      [CASE_ID],
    );

    expect(assigned).toEqual([
      expect.objectContaining({
        userId: undefined,
        teamId: TEAM_ID,
        actorUserId: PERSON_ID,
      }),
    ]);
  });

  test("unassigned: nobody to tell", async () => {
    await service.onUpdateSuccess(
      onUpdate({
        change: { assignedToUserId: null },
        before: { assignedToUserId: ALICE_ID.toString() },
        userId: PERSON_ID,
      }),
      [CASE_ID],
    );

    expect(assigned).toEqual([
      expect.objectContaining({ userId: undefined, teamId: undefined }),
    ]);
    // caseAssigned queues nothing for nobody (SecurityCaseNotifications).
  });
});
