import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import { SecurityCaseFeedEventType } from "../../../Models/DatabaseModels/SecurityCaseFeed";
import SecurityCaseTask from "../../../Models/DatabaseModels/SecurityCaseTask";
import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";
import SecurityCaseFeedService from "../../../Server/Services/SecurityCaseFeedService";
import SecurityCaseService from "../../../Server/Services/SecurityCaseService";
import SecurityCaseTaskService from "../../../Server/Services/SecurityCaseTaskService";
import TeamService from "../../../Server/Services/TeamService";
import UserService from "../../../Server/Services/UserService";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import ProjectReferenceCheck from "../../../Server/Utils/Database/ProjectReferenceCheck";
import {
  FEED_INVITEE_UNNAMED,
  FEED_NOBODY_NAMED,
} from "../../../Server/Utils/Feed/FeedPersonName";
import logger from "../../../Server/Utils/Logger";
import SecurityCaseNotifications from "../../../Server/Utils/SecurityCase/SecurityCaseNotifications";
import SecurityCaseSourceAlerts from "../../../Server/Utils/SecurityCase/SecurityCaseSourceAlerts";
import PendingInviteeProfiles, {
  WithheldProfile,
} from "../../../Server/Utils/TeamMember/PendingInviteeProfiles";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import SecurityCasePriorityLevel from "../../../Types/SecurityCase/SecurityCasePriorityLevel";
import SecurityCaseStage from "../../../Types/SecurityCase/SecurityCaseStage";
import {
  FEED_PERSON_CASES,
  FeedPersonCase,
  expectNoAddressIn,
  feedPersonAccount,
  stubInvitations,
} from "../../Helpers/FeedPersonCases";
import { testPriorityId, testStatusId } from "../../Helpers/SecurityCaseValues";
import { stubSecurityCaseValues } from "../../Helpers/SecurityCaseValuesStub";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * A SECURITY CASE'S TIMELINE NAMES WHOM IT AND ITS TASKS ARE ASSIGNED TO
 * WITHOUT ANYBODY'S ADDRESS (#10681).
 *
 * Assigning a case, adding a task for somebody and handing a task on each
 * write an entry on the case's timeline, and the timeline is read through
 * the API and workflows, by whoever they hand it to. The case's and the
 * task's services named the person themselves: someone only invited by
 * the address they were invited at when no name was typed, and a member
 * with no name by their address. Now each is named through FeedPersonName,
 * as every feed entry and channel line is:
 *
 *   - someone only invited by the name typed with their invitation; with
 *     none, only spaces or an address typed, as "someone who hasn't joined
 *     the project yet" - never by their account's own name (#9823);
 *   - a member by their name; with none, or one that holds an address, by
 *     the part of their address before the "@".
 *
 * The services' real hooks run with the real naming; only the database's
 * reads and writes, and who is only invited, are answered here.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10681000-0000-4000-8000-000000000001",
);
const CASE_ID: ObjectID = new ObjectID("10681000-0000-4000-8000-000000000002");
const TASK_ID: ObjectID = new ObjectID("10681000-0000-4000-8000-000000000003");
// Maya, working the case: a member.
const MAYA_ID: ObjectID = new ObjectID("10681000-0000-4000-8000-000000000004");
// Whom the case or the task is handed to.
const PERSON_ID: ObjectID = new ObjectID(
  "10681000-0000-4000-8000-000000000005",
);
const SOC_TEAM_ID: ObjectID = new ObjectID(
  "10681000-0000-4000-8000-000000000006",
);

const MAYA: DatabaseCommonInteractionProps = {
  userId: MAYA_ID,
  tenantId: PROJECT_ID,
};

type Hooks<TModel extends DatabaseBaseModel> = {
  onBeforeUpdate: (updateBy: UpdateBy<TModel>) => Promise<OnUpdate<TModel>>;
  onUpdateSuccess: (
    onUpdate: OnUpdate<TModel>,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<OnUpdate<TModel>>;
  onCreateSuccess: (
    onCreate: OnCreate<TModel>,
    createdItem: TModel,
  ) => Promise<TModel>;
};

const caseHooks: Hooks<SecurityCase> =
  SecurityCaseService as unknown as Hooks<SecurityCase>;
const taskHooks: Hooks<SecurityCaseTask> =
  SecurityCaseTaskService as unknown as Hooks<SecurityCaseTask>;

let feed: Array<JSONObject>;
// Whom the case or the task is handed to, as OneUptime holds their account.
let person: FeedPersonCase | null;

beforeEach(() => {
  feed = [];
  person = null;

  stubProjectDirectory({});
  stubSecurityCaseValues();

  jest
    .spyOn(SecurityCaseFeedService, "createSecurityCaseFeedItem")
    .mockImplementation(async (data: unknown): Promise<void> => {
      feed.push(data as JSONObject);
    });
  jest
    .spyOn(SecurityCaseService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(SecurityCaseTaskService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(SecurityCaseNotifications, "caseAssigned")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(SecurityCaseNotifications, "caseReachedPriority")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(SecurityCaseNotifications, "taskAssigned")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(SecurityCaseSourceAlerts, "caseClosed")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(ProjectReferenceCheck, "validateCreate")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(ProjectReferenceCheck, "validateUpdate")
    .mockResolvedValue(undefined as never);

  jest.spyOn(UserService, "findOneById").mockImplementation((async (data: {
    id: ObjectID;
  }) => {
    const id: string = data.id.toString().toLowerCase();

    if (id === PERSON_ID.toString() && person) {
      return feedPersonAccount(PERSON_ID, person);
    }

    if (id === MAYA_ID.toString()) {
      const maya: User = new User(MAYA_ID);
      maya.name = new Name("Maya Chen");
      return maya;
    }

    return null;
  }) as never);
  jest.spyOn(TeamService, "findOneById").mockImplementation((async () => {
    const team: Team = new Team(SOC_TEAM_ID);
    team.name = "SOC Tier 2";
    return team;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The case or task is handed to `who`: their account, and their invitation.
function handTo(
  who: FeedPersonCase,
): SpyInstance<typeof PendingInviteeProfiles.readWithheldProfilesInProject> {
  person = who;

  return stubInvitations(
    new Map<string, WithheldProfile>(
      who.invitation
        ? [[PERSON_ID.toString().toLowerCase(), who.invitation]]
        : [],
    ),
  );
}

function feedTexts(): Array<string> {
  return feed.map((item: JSONObject): string => {
    return String(item["feedInfoInMarkdown"]);
  });
}

// The case as its update hook reads it before the change.
function caseBefore(teamId?: ObjectID): SecurityCase {
  const securityCase: SecurityCase = new SecurityCase();
  securityCase._id = CASE_ID.toString();
  securityCase.projectId = PROJECT_ID;
  securityCase.securityCaseStatusId = testStatusId(SecurityCaseStage.New);
  securityCase.securityCasePriorityId = testPriorityId(
    SecurityCasePriorityLevel.High,
  );

  if (teamId) {
    securityCase.assignedToTeamId = teamId;
  }

  return securityCase;
}

// Maya assigns the case, through both of its update hooks.
async function assignCase(
  data: JSONObject,
  before?: SecurityCase,
): Promise<void> {
  jest
    .spyOn(
      SecurityCaseService as unknown as {
        findRowsAndHoldUpdateToThem: () => Promise<unknown>;
      },
      "findRowsAndHoldUpdateToThem",
    )
    .mockResolvedValue([before || caseBefore()] as never);

  const onUpdate: OnUpdate<SecurityCase> = await caseHooks.onBeforeUpdate({
    query: { _id: CASE_ID },
    data: { ...data },
    props: MAYA,
  } as unknown as UpdateBy<SecurityCase>);

  await caseHooks.onUpdateSuccess(onUpdate, [CASE_ID]);
}

function task(overrides: Partial<SecurityCaseTask> = {}): SecurityCaseTask {
  const model: SecurityCaseTask = new SecurityCaseTask();
  model._id = TASK_ID.toString();
  model.projectId = PROJECT_ID;
  model.securityCaseId = CASE_ID;
  model.title = "Reset the admin password";
  Object.assign(model, overrides);
  return model;
}

// Maya adds a task for the person.
async function addTaskFor(userId: ObjectID): Promise<void> {
  const created: SecurityCaseTask = task({
    assignedToUserId: userId,
    createdByUserId: MAYA_ID,
  });

  await taskHooks.onCreateSuccess(
    { createBy: { data: created, props: MAYA }, carryForward: null },
    created,
  );
}

// Maya hands a task of hers to the person.
async function handTaskTo(userId: ObjectID): Promise<void> {
  jest
    .spyOn(
      SecurityCaseTaskService as unknown as {
        findRowsAndHoldUpdateToThem: () => Promise<unknown>;
      },
      "findRowsAndHoldUpdateToThem",
    )
    .mockResolvedValue([
      task({ isDone: false, assignedToUserId: MAYA_ID }),
    ] as never);

  const onUpdate: OnUpdate<SecurityCaseTask> = await taskHooks.onBeforeUpdate({
    query: { _id: TASK_ID },
    data: { assignedToUserId: userId } as never,
    props: MAYA,
    limit: 1,
    skip: 0,
  });

  await taskHooks.onUpdateSuccess(onUpdate, [TASK_ID]);
}

describe.each(FEED_PERSON_CASES)(
  "$label, on the case's timeline",
  (who: FeedPersonCase) => {
    test("a case assigned to them names them as every line does, and no address", async () => {
      handTo(who);

      await assignCase({ assignedToUserId: PERSON_ID.toString() });

      expect(feed).toHaveLength(1);
      expect(feed[0]!["eventType"]).toBe(
        SecurityCaseFeedEventType.AssigneeChanged,
      );
      expect(feedTexts()).toEqual([`👤 Assigned to **${who.named}**.`]);
      expectNoAddressIn(JSON.stringify(feed));
    });

    test("a case assigned to them in a team's queue: them, in the team", async () => {
      handTo(who);

      await assignCase(
        { assignedToUserId: PERSON_ID.toString() },
        caseBefore(SOC_TEAM_ID),
      );

      expect(feedTexts()).toEqual([
        `👤 Assigned to **${who.named}** in **SOC Tier 2**.`,
      ]);
      expectNoAddressIn(JSON.stringify(feed));
    });

    test("a task added for them names them so", async () => {
      handTo(who);

      await addTaskFor(PERSON_ID);

      expect(feedTexts()).toEqual([
        `📋 Added the task **Reset the admin password** and assigned it to **${who.named}**.`,
      ]);
      expectNoAddressIn(JSON.stringify(feed));
    });

    test("a task handed to them names them so", async () => {
      handTo(who);

      await handTaskTo(PERSON_ID);

      expect(feedTexts()).toEqual([
        `👤 Assigned the task **Reset the admin password** to **${who.named}**.`,
      ]);
      expectNoAddressIn(JSON.stringify(feed));
    });
  },
);

describe("who the timeline names", () => {
  test("who is only invited is read once for each line, in the case's project, of the person it names", async () => {
    const withheldIn: SpyInstance<
      typeof PendingInviteeProfiles.readWithheldProfilesInProject
    > = handTo(FEED_PERSON_CASES[0]!);

    await assignCase({ assignedToUserId: PERSON_ID.toString() });
    await addTaskFor(PERSON_ID);
    await handTaskTo(PERSON_ID);

    expect(withheldIn).toHaveBeenCalledTimes(3);

    for (const call of withheldIn.mock.calls) {
      expect(call[0].projectId).toBe(PROJECT_ID);
      expect(call[0].userIds).toEqual([PERSON_ID.toString()]);
    }
  });

  test("somebody who is gone is a user, and nobody's address is read for them", async () => {
    const withheldIn: SpyInstance<
      typeof PendingInviteeProfiles.readWithheldProfilesInProject
    > = stubInvitations(new Map<string, WithheldProfile>());

    await assignCase({ assignedToUserId: PERSON_ID.toString() });
    await addTaskFor(PERSON_ID);
    await handTaskTo(PERSON_ID);

    expect(feedTexts()).toEqual([
      "👤 Assigned to **a user**.",
      "📋 Added the task **Reset the admin password** and assigned it to **a user**.",
      "👤 Assigned the task **Reset the admin password** to **a user**.",
    ]);
    expect(withheldIn).not.toHaveBeenCalled();
  });

  test("when whether they are only invited cannot be read: Somebody, never a name that could be an address", async () => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    person = FEED_PERSON_CASES[1]!;
    jest
      .spyOn(PendingInviteeProfiles, "readWithheldProfilesInProject")
      .mockRejectedValue(new Error("The database is not answering."));

    await assignCase({ assignedToUserId: PERSON_ID.toString() });
    await addTaskFor(PERSON_ID);
    await handTaskTo(PERSON_ID);

    expect(feedTexts()).toEqual([
      `👤 Assigned to **${FEED_NOBODY_NAMED}**.`,
      `📋 Added the task **Reset the admin password** and assigned it to **${FEED_NOBODY_NAMED}**.`,
      `👤 Assigned the task **Reset the admin password** to **${FEED_NOBODY_NAMED}**.`,
    ]);
    expectNoAddressIn(JSON.stringify(feed));
  });

  test("REGRESSION: someone only invited with no name typed is no longer named by the address they were invited at", async () => {
    handTo(FEED_PERSON_CASES[1]!);

    await assignCase({ assignedToUserId: PERSON_ID.toString() });

    expect(feedTexts()).toEqual([
      `👤 Assigned to **${FEED_INVITEE_UNNAMED}**.`,
    ]);
  });
});
