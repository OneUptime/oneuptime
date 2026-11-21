import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import OnCallDutyPolicyTimeLogService from "../../../Server/Services/OnCallDutyPolicyTimeLogService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserNotificationSettingService from "../../../Server/Services/UserNotificationSettingService";
import { OnDelete } from "../../../Server/Types/Database/Hooks";
import logger from "../../../Server/Utils/Logger";
import OnCallLeaveNotices, {
  OnCallLeaver,
} from "../../../Server/Utils/OnCall/OnCallLeaveNotices";
import URL from "../../../Types/API/URL";
import { EmailEnvelope } from "../../../Types/Email/EmailMessage";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../Types/ObjectID";
import ReachWorld, {
  ANA,
  BO,
  IVY,
  OTHER_RULE_ID,
  PAYMENTS_TEAM,
  PLATFORM,
  PRIMARY,
  PROJECT_ID,
  WorldMembership,
} from "../Utils/OnCall/EscalationRuleReachWorld";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

jest.mock("../../../Server/Utils/Logger");

/*
 * LEAVING A TEAM TELLS YOU WHICH ON-CALL POLICIES STOPPED PAGING YOU (#10587).
 *
 * A team membership's delete - a Project Admin removing someone from a
 * team, SCIM Push Groups syncing a group, a team deleted with its members,
 * someone removed from the project - ends the time logs of the teams left
 * (TeamMemberRemovalEndsTimeLogsAfterDelete) and, now, hands the people it
 * took out of teams to OnCallLeaveNotices: each accepted membership it
 * removed, by person and by project, so each person is told once for each
 * policy that pages them through nothing any more. In the background: the
 * delete never waits for it, nor fails with it.
 *
 * Driven here through the real onDeleteSuccess - and, at the end, over
 * policies kept in memory (EscalationRuleReachWorld), with the real
 * OnCallLeaveNotices - for every way out: one of two teams, the only team a
 * policy names, both at once, removed from the project, an invitation
 * withdrawn.
 */

const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "10587000-0000-4000-8000-000000000002",
);
// A team no rule names: what keeps someone in the project.
const SRE: ObjectID = new ObjectID("10587000-0000-4000-8000-0000000000b3");

type Hook = (first: unknown, second?: unknown) => Promise<unknown>;

// The real leave notices, before any test stands in for them.
const REAL_TELL_LEFT: typeof OnCallLeaveNotices.tellLeft =
  OnCallLeaveNotices.tellLeft.bind(OnCallLeaveNotices);

const onDeleteSuccess: Hook = (
  TeamMemberService as unknown as { onDeleteSuccess: Hook }
).onDeleteSuccess.bind(TeamMemberService);

function membership(data: {
  userId: ObjectID;
  teamId: ObjectID;
  accepted?: boolean;
  projectId?: ObjectID;
  id?: ObjectID;
}): TeamMember {
  const member: TeamMember = new TeamMember();
  member._id = (data.id || ObjectID.generate()).toString();
  member.userId = data.userId;
  member.projectId = data.projectId || PROJECT_ID;
  member.teamId = data.teamId;
  member.hasAcceptedInvitation = data.accepted !== false;
  const team: Team = new Team();
  team._id = data.teamId.toString();
  team.shouldHaveAtLeastOneMember = false;
  member.team = team;
  return member;
}

// A world membership, as the delete's onBeforeDelete read it.
function asRow(world: WorldMembership): TeamMember {
  return membership({
    userId: world.userId,
    teamId: world.teamId,
    accepted: world.accepted,
    id: world.id,
  });
}

let tellLeft: SpyInstance<typeof OnCallLeaveNotices.tellLeft>;
let told: Array<Promise<void>>;

beforeEach(() => {
  told = [];

  for (const method of [
    "refreshTokens",
    "syncSubscriptionSeatsAfterMembershipChange",
    "removeProjectAccessIfUserLeftProject",
    "cleanupOnCallAssignmentsIfUserLeftProject",
    "cleanupResourceAssignmentsIfUserLeftProject",
    "removeWorkspaceAccountLinksIfUserLeftProject",
    "removePersonalNotificationSettingsIfUserLeftProject",
  ]) {
    jest
      .spyOn(TeamMemberService as never, method as never)
      .mockResolvedValue(undefined as never);
  }

  jest
    .spyOn(
      UserNotificationSettingService,
      "removeDefaultNotificationSettingsForUser",
    )
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(OnCallDutyPolicyTimeLogService, "endTimeForUser")
    .mockResolvedValue(undefined as never);

  tellLeft = jest
    .spyOn(OnCallLeaveNotices, "tellLeft")
    .mockImplementation(async (): Promise<void> => {
      return undefined;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

// Every background telling the delete started, waited for.
async function afterTheDelete(): Promise<void> {
  // The background starts each project's telling after the one before it.
  for (let round: number = 0; round < 5; round++) {
    await Promise.all(told);
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
  }
}

async function deleted(
  members: Array<TeamMember>,
  removedIds?: Array<ObjectID>,
): Promise<void> {
  await onDeleteSuccess(
    {
      deleteBy: { query: {}, props: { isRoot: true } },
      carryForward: members,
    } as unknown as OnDelete<TeamMember>,
    removedIds ||
      members.map((member: TeamMember): ObjectID => {
        return member.id!;
      }),
  );

  await afterTheDelete();
}

// What onDeleteSuccess handed OnCallLeaveNotices, as "user: team, team".
function handedOver(): Array<Array<string>> {
  return tellLeft.mock.calls.map(
    (call: Parameters<typeof OnCallLeaveNotices.tellLeft>): Array<string> => {
      return call[0].leavers.map((leaver: OnCallLeaver): string => {
        return `${call[0].projectId.toString()} ${leaver.userId.toString()}: ${leaver.teamIds
          .map((teamId: ObjectID): string => {
            return teamId.toString();
          })
          .join(", ")}`;
      });
    },
  );
}

describe("what a delete hands the leave notices", () => {
  test("REGRESSION: each accepted membership it removed, by person - one telling for the project", async () => {
    await deleted([
      membership({ userId: ANA, teamId: PLATFORM }),
      membership({ userId: BO, teamId: PLATFORM }),
    ]);

    expect(handedOver()).toEqual([
      [
        `${PROJECT_ID.toString()} ${ANA.toString()}: ${PLATFORM.toString()}`,
        `${PROJECT_ID.toString()} ${BO.toString()}: ${PLATFORM.toString()}`,
      ],
    ]);
  });

  test("one person out of two teams in one delete is one leaver, with both teams", async () => {
    await deleted([
      membership({ userId: ANA, teamId: PLATFORM }),
      membership({ userId: ANA, teamId: PAYMENTS_TEAM }),
    ]);

    expect(handedOver()).toEqual([
      [
        `${PROJECT_ID.toString()} ${ANA.toString()}: ${PLATFORM.toString()}, ${PAYMENTS_TEAM.toString()}`,
      ],
    ]);
  });

  test("an invitation withdrawn paged nobody: it is not handed over", async () => {
    await deleted([
      membership({ userId: IVY, teamId: PLATFORM, accepted: false }),
    ]);

    expect(tellLeft).not.toHaveBeenCalled();
  });

  test("only the memberships the delete removed", async () => {
    const kept: TeamMember = membership({ userId: BO, teamId: PLATFORM });
    const gone: TeamMember = membership({ userId: ANA, teamId: PLATFORM });

    await deleted([gone, kept], [gone.id!]);

    expect(handedOver()).toEqual([
      [`${PROJECT_ID.toString()} ${ANA.toString()}: ${PLATFORM.toString()}`],
    ]);
  });

  test("a delete that removed nobody tells nobody", async () => {
    await deleted([membership({ userId: ANA, teamId: PLATFORM })], []);

    expect(tellLeft).not.toHaveBeenCalled();
  });

  test("each project is told of its own leavers", async () => {
    await deleted([
      membership({ userId: ANA, teamId: PLATFORM }),
      membership({
        userId: ANA,
        teamId: PAYMENTS_TEAM,
        projectId: OTHER_PROJECT_ID,
      }),
    ]);

    expect(handedOver()).toEqual([
      [`${PROJECT_ID.toString()} ${ANA.toString()}: ${PLATFORM.toString()}`],
      [
        `${OTHER_PROJECT_ID.toString()} ${ANA.toString()}: ${PAYMENTS_TEAM.toString()}`,
      ],
    ]);
  });

  test("telling them never holds up or fails the delete", async () => {
    let finish: () => void = (): void => {};

    tellLeft.mockImplementation((): Promise<void> => {
      return new Promise<void>((resolve: () => void): void => {
        finish = resolve;
      });
    });

    await expect(
      onDeleteSuccess(
        {
          deleteBy: { query: {}, props: { isRoot: true } },
          carryForward: [membership({ userId: ANA, teamId: PLATFORM })],
        },
        undefined,
      ),
    ).resolves.toBeDefined();

    expect(tellLeft).toHaveBeenCalledTimes(1);
    finish();

    tellLeft.mockRejectedValue(new Error("unreachable") as never);

    await expect(
      onDeleteSuccess(
        {
          deleteBy: { query: {}, props: { isRoot: true } },
          carryForward: [membership({ userId: BO, teamId: PLATFORM })],
        },
        undefined,
      ),
    ).resolves.toBeDefined();

    await afterTheDelete();
    expect(logger.error).toHaveBeenCalled();
  });

  test("the team's own time logs still end, for every membership removed", async () => {
    await deleted([
      membership({ userId: ANA, teamId: PLATFORM }),
      membership({ userId: IVY, teamId: PLATFORM, accepted: false }),
    ]);

    expect(OnCallDutyPolicyTimeLogService.endTimeForUser).toHaveBeenCalledTimes(
      2,
    );
  });
});

/*
 * The delete hook over policies kept in memory, with the real
 * OnCallLeaveNotices: what the person hears, for each way out.
 */
describe("what they hear, through the real delete hook", () => {
  let world: ReachWorld;
  let subjects: Array<string>;

  beforeEach(() => {
    world = new ReachWorld();
    world.install();
    world.names.set(SRE.toString().toLowerCase(), "SRE");
    subjects = [];

    // The real notices, each telling kept to be waited for.
    tellLeft.mockImplementation(
      (data: Parameters<typeof OnCallLeaveNotices.tellLeft>[0]) => {
        const telling: Promise<void> = REAL_TELL_LEFT(data);
        told.push(telling);
        return telling;
      },
    );

    jest
      .spyOn(OnCallDutyPolicyService, "getOnCallDutyPolicyLinkInDashboard")
      .mockResolvedValue(URL.fromString("https://oneuptime.test/policies/1"));
    jest
      .spyOn(UserNotificationSettingService, "sendUserNotification")
      .mockImplementation((async (data: {
        userId: ObjectID;
        eventType: NotificationSettingEventType;
        emailEnvelope: EmailEnvelope;
      }) => {
        expect(data.eventType).toBe(
          NotificationSettingEventType.SEND_WHEN_USER_IS_REMOVED_FROM_ON_CALL_POLICY,
        );
        subjects.push(
          `${data.userId.toString() === ANA.toString() ? "Ana" : data.userId.toString()}: ${data.emailEnvelope.subject}`,
        );
      }) as never);
  });

  // The delete takes these memberships away, then its hook runs.
  async function remove(...memberships: Array<WorldMembership>): Promise<void> {
    for (const each of memberships) {
      world.leave(each);
    }

    await deleted(memberships.map(asRow));
  }

  test("REGRESSION: leaving the only team a policy pages them through: told once", async () => {
    world.addMember(ANA, SRE, true);
    const platform: WorldMembership = world.addMember(ANA, PLATFORM, true);
    world.nameTeam(PLATFORM);
    world.nameTeam(PLATFORM, OTHER_RULE_ID);

    await remove(platform);

    expect(subjects).toEqual([
      "Ana: You have been removed from the on-call policy Payments for team Platform",
    ]);
  });

  test("leaving one of two teams the policy names: nothing, and the other team's log stays open", async () => {
    const platform: WorldMembership = world.addMember(ANA, PLATFORM, true);
    world.addMember(ANA, PAYMENTS_TEAM, true);
    world.nameTeam(PLATFORM);
    world.nameTeam(PAYMENTS_TEAM);

    await remove(platform);

    expect(subjects).toEqual([]);
    expect(world.logsOf(ANA)).toEqual([
      `start team ${PAYMENTS_TEAM.toString()}`,
    ]);
  });

  test("on call in one of its schedules: nothing yet - the hand-off that ends the shift tells them", async () => {
    world.addMember(ANA, SRE, true);
    const platform: WorldMembership = world.addMember(ANA, PLATFORM, true);
    world.nameTeam(PLATFORM);
    world.nameSchedule(PRIMARY, { ruleId: OTHER_RULE_ID });
    world.onCall.set(PRIMARY.toString(), ANA);

    await remove(platform);

    expect(subjects).toEqual([]);
  });

  test("removed from the project - every team at once - is told nothing", async () => {
    const sre: WorldMembership = world.addMember(ANA, SRE, true);
    const platform: WorldMembership = world.addMember(ANA, PLATFORM, true);
    world.nameTeam(PLATFORM);

    await remove(sre, platform);

    expect(subjects).toEqual([]);
    // The project's leave cleanup runs for them instead.
    expect(
      (
        TeamMemberService as unknown as {
          cleanupOnCallAssignmentsIfUserLeftProject: unknown;
        }
      ).cleanupOnCallAssignmentsIfUserLeftProject,
    ).toHaveBeenCalledTimes(1);
  });

  test("an invitation withdrawn tells nothing", async () => {
    const invitation: WorldMembership = world.addMember(IVY, PLATFORM, false);
    world.nameTeam(PLATFORM);

    await remove(invitation);

    expect(subjects).toEqual([]);
  });
});
