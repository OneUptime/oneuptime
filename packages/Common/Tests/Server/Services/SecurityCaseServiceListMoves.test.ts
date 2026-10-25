import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import { SecurityCaseFeedEventType } from "../../../Models/DatabaseModels/SecurityCaseFeed";
import SecurityCaseStatus from "../../../Models/DatabaseModels/SecurityCaseStatus";
import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";
import SecurityCaseFeedService from "../../../Server/Services/SecurityCaseFeedService";
import SecurityCaseService from "../../../Server/Services/SecurityCaseService";
import TeamService from "../../../Server/Services/TeamService";
import UserService from "../../../Server/Services/UserService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import SecurityCaseNotifications from "../../../Server/Utils/SecurityCase/SecurityCaseNotifications";
import SecurityCaseSourceAlerts from "../../../Server/Utils/SecurityCase/SecurityCaseSourceAlerts";
import {
  Gray500,
  Green500,
  Orange500,
  Purple500,
} from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import SecurityCasePriorityLevel from "../../../Types/SecurityCase/SecurityCasePriorityLevel";
import SecurityCaseStage from "../../../Types/SecurityCase/SecurityCaseStage";
import SecurityCaseVerdict from "../../../Types/SecurityCase/SecurityCaseVerdict";
import {
  TEST_PRIORITY_IDS,
  TEST_STATUS_IDS,
  buildDefaultTestStatuses,
  buildTestStatus,
  testPriorityId,
  testStatusId,
} from "../../Helpers/SecurityCaseValues";
import { stubSecurityCaseValues } from "../../Helpers/SecurityCaseValuesStub";
import { getJestSpyOn } from "../../Spy";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

/*
 * WHAT A CASE'S TIMELINE SAYS WHEN IT IS WORKED FROM A LIST.
 *
 * A row's ⋯, Bulk Actions and the case's header move a case with one
 * update each, through the API, as the person working it - Assign to Me,
 * Assign to Someone Else (a person, or a team that takes the case into its
 * queue), Change Status (closing with a verdict and a note) and Change
 * Priority (SecurityCaseChanges writes them). Each update runs the case's
 * update hooks, as the server runs them: here both, before and after, with
 * the writes those moves send.
 *
 * Pinned: every move lands on the case's timeline as one entry of its own
 * kind, saying what changed in words, and naming the person who made it -
 * "with who did it" - and the people it reached are told.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "12121212-1212-4212-8212-121212121212",
);
const CASE_ID: ObjectID = new ObjectID("34343434-3434-4434-8434-343434343434");
// The person working the case from the list.
const ACTOR_ID: ObjectID = new ObjectID("56565656-5656-4656-8656-565656565656");
const DIEGO_ID: ObjectID = new ObjectID("78787878-7878-4878-8878-787878787878");
const SOC_TEAM_ID: ObjectID = new ObjectID(
  "9a9a9a9a-9a9a-4a9a-8a9a-9a9a9a9a9a9a",
);
const DUPLICATE_ID: string = "c2000000-0000-4000-8000-0000000000a3";

type Hooks = {
  onBeforeUpdate: (
    updateBy: UpdateBy<SecurityCase>,
  ) => Promise<OnUpdate<SecurityCase>>;
  onUpdateSuccess: (
    onUpdate: OnUpdate<SecurityCase>,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<OnUpdate<SecurityCase>>;
};

const service: Hooks = SecurityCaseService as unknown as Hooks;

interface FeedEntry {
  feedInfoInMarkdown: string;
  eventType: SecurityCaseFeedEventType;
  userId?: ObjectID | undefined;
  moreInformationInMarkdown?: string | undefined;
  displayColor?: Color | undefined;
  securityCaseId: ObjectID;
}

let feed: Array<FeedEntry>;
let stamps: Array<JSONObject>;
let assigned: Array<JSONObject>;
let reached: Array<JSONObject>;
let closedAtSource: Array<unknown>;

// New, Investigating, Contained, Closed and the project's Closed - Duplicate.
function teamStatuses(): Array<SecurityCaseStatus> {
  const statuses: Array<SecurityCaseStatus> = buildDefaultTestStatuses();

  return [
    ...statuses,
    buildTestStatus({ id: DUPLICATE_ID, name: "Closed - Duplicate", order: 5 }),
  ];
}

// The case as it stands before the move, as the update hook reads it.
function caseBefore(
  fields: {
    stage?: SecurityCaseStage;
    statusId?: string;
    priority?: SecurityCasePriorityLevel;
    userId?: ObjectID;
    teamId?: ObjectID;
    verdict?: SecurityCaseVerdict;
    acknowledgedAt?: Date;
  } = {},
): SecurityCase {
  const securityCase: SecurityCase = new SecurityCase();
  securityCase._id = CASE_ID.toString();
  securityCase.projectId = PROJECT_ID;
  securityCase.securityCaseStatusId = new ObjectID(
    fields.statusId ||
      testStatusId(fields.stage || SecurityCaseStage.New).toString(),
  );
  securityCase.securityCasePriorityId = testPriorityId(
    fields.priority || SecurityCasePriorityLevel.High,
  );

  if (fields.userId) {
    securityCase.assignedToUserId = fields.userId;
  }

  if (fields.teamId) {
    securityCase.assignedToTeamId = fields.teamId;
  }

  if (fields.verdict) {
    securityCase.verdict = fields.verdict;
  }

  if (fields.acknowledgedAt) {
    securityCase.acknowledgedAt = fields.acknowledgedAt;
  }

  return securityCase;
}

/*
 * One move, as a list sends it: the update's data, by the person working
 * the case, through both of the case's update hooks.
 */
async function move(before: SecurityCase, data: JSONObject): Promise<void> {
  getJestSpyOn(
    SecurityCaseService,
    "findRowsAndHoldUpdateToThem",
  ).mockResolvedValue([before] as never);

  const updateBy: UpdateBy<SecurityCase> = {
    query: { _id: CASE_ID },
    data: { ...data },
    props: { userId: ACTOR_ID, tenantId: PROJECT_ID },
  } as unknown as UpdateBy<SecurityCase>;

  const onUpdate: OnUpdate<SecurityCase> =
    await service.onBeforeUpdate(updateBy);

  await service.onUpdateSuccess(onUpdate, [CASE_ID]);
}

beforeEach(() => {
  feed = [];
  stamps = [];
  assigned = [];
  reached = [];
  closedAtSource = [];

  stubProjectDirectory({});
  stubSecurityCaseValues({ statuses: teamStatuses() });

  getJestSpyOn(
    SecurityCaseFeedService,
    "createSecurityCaseFeedItem",
  ).mockImplementation(async (data: unknown) => {
    feed.push(data as FeedEntry);
  });
  getJestSpyOn(
    SecurityCaseService,
    "updateColumnsByIdWithoutHooks",
  ).mockImplementation(async (data: unknown) => {
    stamps.push((data as { data: JSONObject }).data);
  });
  getJestSpyOn(SecurityCaseNotifications, "caseAssigned").mockImplementation(
    async (data: unknown) => {
      assigned.push(data as JSONObject);
    },
  );
  getJestSpyOn(
    SecurityCaseNotifications,
    "caseReachedPriority",
  ).mockImplementation(async (data: unknown) => {
    reached.push(data as JSONObject);
  });
  getJestSpyOn(SecurityCaseSourceAlerts, "caseClosed").mockImplementation(
    async (data: unknown) => {
      closedAtSource.push(data);
    },
  );
  getJestSpyOn(UserService, "findOneById").mockImplementation(
    async (data: unknown) => {
      const id: string = String((data as { id: ObjectID }).id);
      const user: User = new User();
      user.name = (
        id === DIEGO_ID.toString() ? "Diego Alvarez" : "Maya Chen"
      ) as never;
      return user;
    },
  );
  getJestSpyOn(TeamService, "findOneById").mockImplementation(async () => {
    const team: Team = new Team();
    team.name = "SOC Tier 2";
    return team;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Assign to Me and Assign to Someone Else", () => {
  test("a person picked: the timeline says who has the case, and that the person working the list did it", async () => {
    await move(caseBefore(), { assignedToUserId: DIEGO_ID.toString() });

    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({
      securityCaseId: CASE_ID,
      eventType: SecurityCaseFeedEventType.AssigneeChanged,
      userId: ACTOR_ID,
      displayColor: Gray500,
    });
    expect(feed[0]!.feedInfoInMarkdown).toContain(
      "Assigned to **Diego Alvarez**",
    );
    // Diego is told, by whom.
    expect(assigned).toEqual([
      expect.objectContaining({
        securityCaseId: CASE_ID,
        userId: DIEGO_ID,
        actorUserId: ACTOR_ID,
      }),
    ]);
    // Somebody is on it now: acknowledged, once.
    expect(stamps).toHaveLength(1);
    expect(stamps[0]!["acknowledgedAt"]).toBeInstanceOf(Date);
  });

  test("Assign to Me: the reader is both who has it and who did it", async () => {
    await move(caseBefore(), { assignedToUserId: ACTOR_ID.toString() });

    expect(feed[0]).toMatchObject({
      eventType: SecurityCaseFeedEventType.AssigneeChanged,
      userId: ACTOR_ID,
    });
    expect(feed[0]!.feedInfoInMarkdown).toContain("Assigned to **Maya Chen**");
  });

  test("a person picked for a case in a team's queue: assigned to them, in that team", async () => {
    await move(caseBefore({ teamId: SOC_TEAM_ID }), {
      assignedToUserId: DIEGO_ID.toString(),
    });

    expect(feed[0]!.feedInfoInMarkdown).toContain(
      "Assigned to **Diego Alvarez** in **SOC Tier 2**",
    );
  });

  test("a team picked: the case moves to the team's queue, the person comes off it, and the team is told", async () => {
    await move(
      caseBefore({ userId: DIEGO_ID, acknowledgedAt: new Date("2026-10-14") }),
      { assignedToTeamId: SOC_TEAM_ID.toString(), assignedToUserId: null },
    );

    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({
      eventType: SecurityCaseFeedEventType.AssigneeChanged,
      userId: ACTOR_ID,
    });
    expect(feed[0]!.feedInfoInMarkdown).toContain(
      "Moved to the **SOC Tier 2** queue",
    );
    expect(feed[0]!.feedInfoInMarkdown).not.toContain("Diego");
    expect(assigned).toEqual([
      expect.objectContaining({
        teamId: SOC_TEAM_ID,
        userId: undefined,
        actorUserId: ACTOR_ID,
      }),
    ]);
    // Acknowledged before: nothing stamped again.
    expect(stamps).toEqual([]);
  });

  test("a pick that leaves the case as it is records nothing", async () => {
    await move(caseBefore({ userId: DIEGO_ID }), {
      assignedToUserId: DIEGO_ID.toString(),
    });

    expect(feed).toEqual([]);
    expect(assigned).toEqual([]);
  });
});

describe("Change Status", () => {
  test("between open statuses: the timeline says from and to, by whom", async () => {
    await move(caseBefore({ stage: SecurityCaseStage.New }), {
      securityCaseStatusId: TEST_STATUS_IDS[SecurityCaseStage.Contained],
    });

    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({
      eventType: SecurityCaseFeedEventType.StatusChanged,
      userId: ACTOR_ID,
      displayColor: Purple500,
    });
    expect(feed[0]!.feedInfoInMarkdown).toContain("**New** to **Contained**");
  });

  test("closing with a verdict and a note: the timeline says the verdict, keeps the note, and names who closed it", async () => {
    await move(caseBefore({ stage: SecurityCaseStage.Acknowledged }), {
      securityCaseStatusId: TEST_STATUS_IDS[SecurityCaseStage.Closed],
      verdict: SecurityCaseVerdict.FalsePositive,
      closingNote: "The rule matched our own scanner.",
    });

    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({
      eventType: SecurityCaseFeedEventType.StatusChanged,
      userId: ACTOR_ID,
      displayColor: Green500,
      moreInformationInMarkdown: "The rule matched our own scanner.",
    });
    expect(feed[0]!.feedInfoInMarkdown).toContain(
      "Closed as **False Positive**",
    );
    expect(stamps[0]).toMatchObject({
      verdict: SecurityCaseVerdict.FalsePositive,
      closedByUserId: ACTOR_ID,
    });
    expect(stamps[0]!["closedAt"]).toBeInstanceOf(Date);
    // Closed here, closed where its alerts came from.
    expect(closedAtSource).toEqual([
      { projectId: PROJECT_ID, securityCaseId: CASE_ID },
    ]);
  });

  test("reopening a case closed in the project's own closing status says it was reopened", async () => {
    await move(
      caseBefore({
        statusId: DUPLICATE_ID,
        verdict: SecurityCaseVerdict.FalsePositive,
      }),
      {
        securityCaseStatusId: TEST_STATUS_IDS[SecurityCaseStage.Acknowledged],
      },
    );

    expect(feed[0]!.feedInfoInMarkdown).toContain(
      "Reopened as **Investigating**",
    );
    expect(feed[0]).toMatchObject({ userId: ACTOR_ID });
    expect(stamps[0]).toMatchObject({
      verdict: null,
      closedAt: null,
      closedByUserId: null,
    });
  });

  test("reopening a case from Closed says it was reopened, as it always did", async () => {
    await move(
      caseBefore({
        stage: SecurityCaseStage.Closed,
        verdict: SecurityCaseVerdict.TruePositive,
      }),
      { securityCaseStatusId: TEST_STATUS_IDS[SecurityCaseStage.New] },
    );

    expect(feed[0]!.feedInfoInMarkdown).toContain("Reopened as **New**");
  });

  test("a closed case moved to another closing status keeps its verdict, and nothing closes again", async () => {
    await move(
      caseBefore({
        stage: SecurityCaseStage.Closed,
        verdict: SecurityCaseVerdict.TruePositive,
      }),
      { securityCaseStatusId: DUPLICATE_ID },
    );

    expect(feed[0]!.feedInfoInMarkdown).toContain(
      "Closed as **True Positive**",
    );
    expect(feed[0]!.feedInfoInMarkdown).not.toContain("Reopened");
    expect(closedAtSource).toEqual([]);
    for (const stamp of stamps) {
      expect(stamp).not.toHaveProperty("closedAt");
    }
  });
});

describe("Change Priority", () => {
  test("up: the timeline says from and to, by whom, and whoever the new priority reaches is told", async () => {
    await move(caseBefore({ priority: SecurityCasePriorityLevel.High }), {
      securityCasePriorityId:
        TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Critical],
    });

    expect(feed).toHaveLength(1);
    expect(feed[0]).toMatchObject({
      eventType: SecurityCaseFeedEventType.PriorityChanged,
      userId: ACTOR_ID,
      displayColor: Orange500,
    });
    expect(feed[0]!.feedInfoInMarkdown).toContain(
      "Priority changed from **High** to **Critical**",
    );
    expect(reached).toEqual([
      expect.objectContaining({
        securityCaseId: CASE_ID,
        actorUserId: ACTOR_ID,
      }),
    ]);
  });

  test("down: on the timeline, telling nobody", async () => {
    await move(caseBefore({ priority: SecurityCasePriorityLevel.High }), {
      securityCasePriorityId: TEST_PRIORITY_IDS[SecurityCasePriorityLevel.Low],
    });

    expect(feed[0]!.feedInfoInMarkdown).toContain(
      "Priority changed from **High** to **Low**",
    );
    expect(reached).toEqual([]);
  });
});
