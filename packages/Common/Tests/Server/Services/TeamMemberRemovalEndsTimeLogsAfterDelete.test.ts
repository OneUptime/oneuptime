import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import Team from "../../../Models/DatabaseModels/Team";
import OnCallDutyPolicyTimeLogService from "../../../Server/Services/OnCallDutyPolicyTimeLogService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserNotificationSettingService from "../../../Server/Services/UserNotificationSettingService";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Logger");

/*
 * A MEMBER'S ON-CALL TIME LOGS CLOSE ONLY WHEN THEY ARE ACTUALLY REMOVED.
 *
 * Removing someone from a team closes their open on-call time logs for that
 * team. That used to happen in onBeforeDelete, before the hook's own check
 * that a team which must keep a member still has one - so a removal that
 * check refused still closed the logs, and reporting showed a person who was
 * still on call as off it. The logs now close in onDeleteSuccess, for the
 * memberships the delete removed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "20000000-0000-4000-8000-000000000001",
);
const TEAM_ID: ObjectID = new ObjectID("20000000-0000-4000-8000-000000000002");
const ALICE_ID: ObjectID = new ObjectID("20000000-0000-4000-8000-000000000003");
const BOB_ID: ObjectID = new ObjectID("20000000-0000-4000-8000-000000000004");
const ALICE_MEMBERSHIP_ID: ObjectID = new ObjectID(
  "20000000-0000-4000-8000-000000000005",
);
const BOB_MEMBERSHIP_ID: ObjectID = new ObjectID(
  "20000000-0000-4000-8000-000000000006",
);

type Hook = (first: unknown, second?: unknown) => Promise<unknown>;

const onBeforeDelete: Hook = (
  TeamMemberService as unknown as { onBeforeDelete: Hook }
).onBeforeDelete.bind(TeamMemberService);
const onDeleteSuccess: Hook = (
  TeamMemberService as unknown as { onDeleteSuccess: Hook }
).onDeleteSuccess.bind(TeamMemberService);

function membership(
  id: ObjectID,
  userId: ObjectID,
  shouldHaveAtLeastOneMember: boolean,
): TeamMember {
  const member: TeamMember = new TeamMember();
  member._id = id.toString();
  member.userId = userId;
  member.projectId = PROJECT_ID;
  member.teamId = TEAM_ID;
  member.hasAcceptedInvitation = true;
  const team: Team = new Team();
  team._id = TEAM_ID.toString();
  team.shouldHaveAtLeastOneMember = shouldHaveAtLeastOneMember;
  member.team = team;
  return member;
}

let endTimeForUser: jest.SpyInstance;

beforeEach(() => {
  endTimeForUser = getJestSpyOn(
    OnCallDutyPolicyTimeLogService,
    "endTimeForUser",
  ).mockResolvedValue(undefined);
  getJestSpyOn(TeamMemberService, "isSCIMPushGroupsEnabled").mockResolvedValue(
    false,
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("onBeforeDelete", () => {
  test("a removal refused because the team must keep a member closes no time log", async () => {
    getJestSpyOn(TeamMemberService, "findBy").mockResolvedValue([
      membership(ALICE_MEMBERSHIP_ID, ALICE_ID, true),
    ]);
    // Alice is the team's only member.
    getJestSpyOn(TeamMemberService, "countBy").mockResolvedValue(
      new PositiveNumber(1),
    );

    await expect(
      onBeforeDelete({
        query: { _id: ALICE_MEMBERSHIP_ID.toString() },
        props: { tenantId: PROJECT_ID },
      }),
    ).rejects.toThrow();

    expect(endTimeForUser).not.toHaveBeenCalled();
  });

  test("an allowed removal closes nothing yet: it carries the members forward", async () => {
    getJestSpyOn(TeamMemberService, "findBy").mockResolvedValue([
      membership(ALICE_MEMBERSHIP_ID, ALICE_ID, false),
    ]);

    const result: { carryForward: Array<TeamMember> } = (await onBeforeDelete({
      query: { _id: ALICE_MEMBERSHIP_ID.toString() },
      props: { tenantId: PROJECT_ID },
    })) as { carryForward: Array<TeamMember> };

    expect(endTimeForUser).not.toHaveBeenCalled();
    expect(result.carryForward).toHaveLength(1);
  });
});

describe("onDeleteSuccess", () => {
  beforeEach(() => {
    for (const method of [
      "refreshTokens",
      "syncSubscriptionSeatsAfterMembershipChange",
      "removeProjectAccessIfUserLeftProject",
      "cleanupOnCallAssignmentsIfUserLeftProject",
      "cleanupResourceAssignmentsIfUserLeftProject",
      "removeWorkspaceAccountLinksIfUserLeftProject",
    ]) {
      getJestSpyOn(TeamMemberService, method).mockResolvedValue(undefined);
    }

    getJestSpyOn(
      UserNotificationSettingService,
      "removeDefaultNotificationSettingsForUser",
    ).mockResolvedValue(undefined);
  });

  test("closes the time logs of the memberships the delete removed, for the team they left", async () => {
    await onDeleteSuccess(
      {
        deleteBy: { query: {}, props: { tenantId: PROJECT_ID } },
        carryForward: [
          membership(ALICE_MEMBERSHIP_ID, ALICE_ID, false),
          membership(BOB_MEMBERSHIP_ID, BOB_ID, false),
        ],
      },
      [ALICE_MEMBERSHIP_ID],
    );

    expect(endTimeForUser).toHaveBeenCalledTimes(1);
    const request: {
      projectId: ObjectID;
      userId: ObjectID;
      teamId: ObjectID;
    } = endTimeForUser.mock.calls[0]![0] as {
      projectId: ObjectID;
      userId: ObjectID;
      teamId: ObjectID;
    };
    expect(request.userId.toString()).toBe(ALICE_ID.toString());
    expect(request.teamId.toString()).toBe(TEAM_ID.toString());
    expect(request.projectId.toString()).toBe(PROJECT_ID.toString());
  });

  test("a delete that removed nobody closes nothing", async () => {
    await onDeleteSuccess(
      {
        deleteBy: { query: {}, props: { tenantId: PROJECT_ID } },
        carryForward: [membership(ALICE_MEMBERSHIP_ID, ALICE_ID, false)],
      },
      [],
    );

    expect(endTimeForUser).not.toHaveBeenCalled();
  });
});
