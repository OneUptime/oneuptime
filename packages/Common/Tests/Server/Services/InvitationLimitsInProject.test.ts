import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * AN INVITATION'S LIMIT IS ITS PROJECT'S, AND A PROJECT MAILS A PERSON ONE
 * INVITATION PER WINDOW (#10179).
 *
 * Driven through TeamMemberService's hooks as DatabaseService runs them,
 * with the database stood in for (InvitationWorld) and the limits and the
 * windows counted for real (a stand-in for Valkey that counts and expires as
 * it does):
 *
 *   - THE SCOPE. An address other projects invited ten times this hour is
 *     invited by a project that has not. Past the cap on every project's
 *     invitations together, a project is told only "not now" (503): nothing
 *     is made or sent, and the answer is the same for an address with an
 *     account and one without.
 *   - THE WINDOW. A second invitation from the project to the person within
 *     the hour - to another team, or after the first was removed, as a SCIM
 *     create, delete, create loop does - is made, and sends and counts
 *     nothing. It ends with the hour, once the person accepts or declines,
 *     and Resend Invitation still sends (and starts it again). It is one
 *     project's: another project's invitation is sent.
 */

jest.mock("../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../Enterprise/TestBillingFlag",
    ) as typeof import("../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn(),
      isConnected: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      getLogLevel: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import Redis from "../../../Server/Infrastructure/Redis";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import PublicMessageRateLimit, {
  INVITATION_NOT_NOW_MESSAGE,
  PublicMessageNotNowException,
  PublicMessageRateLimitException,
  TeamMessageKind,
} from "../../../Server/Utils/RateLimit/PublicMessageRateLimit";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import ObjectID from "../../../Types/ObjectID";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import InvitationWorld, { WorldAccount } from "../TestingUtils/InvitationWorld";
import FakeCounterRedis from "../TestingUtils/Redis/FakeCounterRedis";

type MockedFn = ReturnType<typeof jest.fn>;

const PROJECT_A: ObjectID = new ObjectID(
  "10179bbb-0000-4000-8000-00000000000a",
);
const PROJECT_B: ObjectID = new ObjectID(
  "10179bbb-0000-4000-8000-00000000000b",
);
const INVITER_ID: ObjectID = new ObjectID(
  "10179bbb-0000-4000-8000-000000000001",
);

const ADDRESS: string = "grace@company.example";
const HOUR_IN_MS: number = 60 * 60 * 1000;

let world: InvitationWorld;
let redis: FakeCounterRedis;
let now: number;
let testIndex: number = 0;

beforeEach(() => {
  jest.clearAllMocks();

  redis = new FakeCounterRedis();
  (Redis.getClient as unknown as MockedFn).mockReturnValue(redis);
  (Redis.isConnected as unknown as MockedFn).mockReturnValue(true);

  testIndex++;
  now = Date.UTC(2036, 0, 1) + testIndex * 24 * HOUR_IN_MS;
  jest.spyOn(Date, "now").mockImplementation((): number => {
    return now;
  });

  world = new InvitationWorld();
  world.install();
  setTestBillingEnabled(true);
});

afterEach(() => {
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

function memberOf(projectId: ObjectID): DatabaseCommonInteractionProps {
  return {
    userId: INVITER_ID,
    tenantId: projectId,
  } as DatabaseCommonInteractionProps;
}

// A dashboard invitation by address to a team of the project.
function invite(
  projectId: ObjectID = PROJECT_A,
  teamId: ObjectID = ObjectID.generate(),
): CreateBy<TeamMember> {
  const member: TeamMember = new TeamMember();
  member.projectId = projectId;
  member.teamId = teamId;

  return {
    data: member,
    props: memberOf(projectId),
    miscDataProps: { email: ADDRESS },
  } as CreateBy<TeamMember>;
}

// As SCIM invites (ProjectSCIMAccountPolicy.addUserToTeam): OneUptime's own.
function inviteAsScim(
  userId: ObjectID,
  projectId: ObjectID = PROJECT_A,
  teamId: ObjectID = ObjectID.generate(),
): CreateBy<TeamMember> {
  const member: TeamMember = new TeamMember();
  member.projectId = projectId;
  member.teamId = teamId;
  member.userId = userId;
  member.hasAcceptedInvitation = false;

  return {
    data: member,
    props: { isRoot: true } as DatabaseCommonInteractionProps,
    miscDataProps: { email: ADDRESS },
  } as CreateBy<TeamMember>;
}

function projectCount(projectId: ObjectID): number {
  return redis.count(
    PublicMessageRateLimit.getProjectContactCounterKey({
      counterName: TeamMessageKind.Invitation,
      projectId: projectId,
      contact: PublicMessageRateLimit.forEmail(ADDRESS),
    }),
  );
}

function capCount(): number {
  return redis.count(
    PublicMessageRateLimit.getContactCounterKey({
      counterName: TeamMessageKind.Invitation,
      contact: PublicMessageRateLimit.forEmail(ADDRESS),
    }),
  );
}

// Another project's invitations to the address this hour, as its limiter counts them.
async function invitedElsewhere(
  times: number,
  projectId: ObjectID,
): Promise<void> {
  for (let round: number = 0; round < times; round++) {
    await PublicMessageRateLimit.assertTeamMaySend({
      kind: TeamMessageKind.Invitation,
      projectId: projectId,
      contacts: [PublicMessageRateLimit.forEmail(ADDRESS)],
    });
  }
}

function person(): WorldAccount {
  return world.accountAt(ADDRESS)!;
}

describe("the limit is the inviting project's", () => {
  test("an address another project invited ten times this hour is invited by one that has not", async () => {
    await invitedElsewhere(10, PROJECT_B);

    // Project B is at its own limit...
    await expect(invitedElsewhere(1, PROJECT_B)).rejects.toBeInstanceOf(
      PublicMessageRateLimitException,
    );

    // ...and project A, which has invited them never, invites them.
    await world.create(invite(PROJECT_A));

    expect(world.mails).toHaveLength(1);
    expect(world.memberships).toHaveLength(1);
    expect(projectCount(PROJECT_A)).toBe(1);
  });

  test.each([
    ["an address with no account", false],
    ["an address with an account", true],
  ])(
    "past the cap on every project's invitations, %s is answered 'not now', and nothing is made or sent",
    async (_label: string, hasAccount: boolean) => {
      if (hasAccount) {
        world.seedAccount({ email: ADDRESS, hasSignedUp: true });
      }

      // Five other projects, ten each: the cap's fifty.
      for (let index: number = 0; index < 5; index++) {
        await invitedElsewhere(
          10,
          new ObjectID(
            `10179bbb-0000-4000-8000-${String(100 + index).padStart(12, "0")}`,
          ),
        );
      }

      const refusal: unknown = await world
        .create(invite(PROJECT_A))
        .catch((error: unknown): unknown => {
          return error;
        });

      expect(refusal).toBeInstanceOf(PublicMessageNotNowException);
      expect((refusal as PublicMessageNotNowException).code).toBe(
        ExceptionCode.ServiceUnavailableException,
      );
      expect((refusal as Error).message).toBe(INVITATION_NOT_NOW_MESSAGE);

      // Nothing made, nothing sent, and project A's count given back.
      expect(world.memberships).toHaveLength(0);
      expect(world.accounts).toHaveLength(hasAccount ? 1 : 0);
      expect(world.mails).toHaveLength(0);
      expect(world.tokensMinted).toHaveLength(0);
      expect(projectCount(PROJECT_A)).toBe(0);
      expect(capCount()).toBe(51);
    },
  );

  test("the 'not now' answer is the same, word for word and code for code, whether or not the address has an account", async () => {
    const answerFor: (hasAccount: boolean) => Promise<unknown> = async (
      hasAccount: boolean,
    ): Promise<unknown> => {
      world.accounts = [];
      world.memberships = [];
      redis.reset();

      if (hasAccount) {
        world.seedAccount({ email: ADDRESS, hasSignedUp: false });
      }

      for (let index: number = 0; index < 5; index++) {
        await invitedElsewhere(
          10,
          new ObjectID(
            `10179bbb-0000-4000-8000-${String(200 + index).padStart(12, "0")}`,
          ),
        );
      }

      const refusal: Error = (await world
        .create(invite(PROJECT_A))
        .catch((error: unknown): unknown => {
          return error;
        })) as Error;

      return {
        kind: refusal.constructor.name,
        code: (refusal as PublicMessageNotNowException).code,
        message: refusal.message,
      };
    };

    expect(await answerFor(true)).toEqual(await answerFor(false));
  });

  test("past its own ten, a project hears of its own invitations, as before", async () => {
    await invitedElsewhere(10, PROJECT_A);

    await expect(world.create(invite(PROJECT_A))).rejects.toBeInstanceOf(
      PublicMessageRateLimitException,
    );
    expect(world.mails).toHaveLength(0);
  });
});

describe("a project mails a person one invitation per window", () => {
  test("invited again to another team within the hour: made, and nothing more sent or counted", async () => {
    await world.create(invite());
    await world.create(invite());
    await world.create(invite());

    expect(world.memberships).toHaveLength(3);
    expect(world.mails).toHaveLength(1);
    expect(projectCount(PROJECT_A)).toBe(1);
  });

  test("an hour on, the next invitation emails them again", async () => {
    await world.create(invite());

    now += HOUR_IN_MS;
    await world.create(invite());

    expect(world.mails).toHaveLength(2);
  });

  test("once they accept, the project's next invitation emails them", async () => {
    await world.create(invite());

    await world.accept({ projectId: PROJECT_A, userId: person().id });
    await world.create(invite());

    expect(world.mails).toHaveLength(2);
  });

  test("once they decline - they delete their own invitation - inviting them again emails them", async () => {
    await world.create(invite());

    await world.deleteMemberships({
      projectId: PROJECT_A,
      userId: person().id,
      by: { userId: person().id } as DatabaseCommonInteractionProps,
    });
    await world.create(invite());

    expect(world.mails).toHaveLength(2);
  });

  test("removed by somebody else, they are not mailed again within the hour", async () => {
    await world.create(invite());

    await world.deleteMemberships({
      projectId: PROJECT_A,
      userId: person().id,
      by: memberOf(PROJECT_A),
    });
    await world.create(invite());

    expect(world.memberships).toHaveLength(1);
    expect(world.mails).toHaveLength(1);
  });

  test("Resend Invitation still sends within the window, and starts it again", async () => {
    await world.create(invite());

    now += 30 * 60 * 1000;
    await world.resend({
      projectId: PROJECT_A,
      userId: person().id,
      props: memberOf(PROJECT_A),
    });

    expect(world.mails).toHaveLength(2);
    expect(projectCount(PROJECT_A)).toBe(2);

    // An hour after the first email, but not after the resend: still held.
    now += 45 * 60 * 1000;
    await world.create(invite());
    expect(world.mails).toHaveLength(2);

    now += 20 * 60 * 1000;
    await world.create(invite());
    expect(world.mails).toHaveLength(3);
  });

  test("it is one project's: another project's invitation within the hour is sent", async () => {
    await world.create(invite(PROJECT_A));
    await world.create(invite(PROJECT_B));

    expect(world.mails).toHaveLength(2);
  });

  test.each([
    ["the invitation made their account", false],
    ["they had an account already", true],
  ])(
    "alike, whether or not the address had an account (%s)",
    async (_label: string, hadAccount: boolean) => {
      if (hadAccount) {
        world.seedAccount({ email: ADDRESS, hasSignedUp: false });
      }

      await world.create(invite());
      await world.create(invite());

      expect(world.mails).toHaveLength(1);
      expect(world.memberships).toHaveLength(2);
    },
  );

  test("while Valkey cannot be reached, every invitation is emailed (fail open)", async () => {
    (Redis.isConnected as unknown as MockedFn).mockReturnValue(false);

    await world.create(invite());
    await world.create(invite());

    expect(world.mails).toHaveLength(2);
  });
});

describe("a SCIM create, delete, create loop mails the person once an hour", () => {
  test.each([
    ["an account SCIM made, with a random password", true],
    ["an account an earlier invitation made, nobody has claimed", false],
  ])("%s", async (_label: string, hasSignedUp: boolean) => {
    const account: WorldAccount = world.seedAccount({
      email: ADDRESS,
      hasSignedUp: hasSignedUp,
    });
    const teamId: ObjectID = ObjectID.generate();

    for (let round: number = 0; round < 12; round++) {
      await world.create(inviteAsScim(account.id, PROJECT_A, teamId));

      // Deactivated or deleted at the identity provider: OneUptime removes it.
      await world.deleteMemberships({
        projectId: PROJECT_A,
        userId: account.id,
        by: { isRoot: true } as DatabaseCommonInteractionProps,
      });

      now += 4 * 60 * 1000;
    }

    // Twelve rounds, four minutes apart: forty-eight minutes, one email.
    expect(world.mails).toHaveLength(1);
    expect(projectCount(PROJECT_A)).toBe(1);

    now += HOUR_IN_MS;
    await world.create(inviteAsScim(account.id, PROJECT_A, teamId));
    expect(world.mails).toHaveLength(2);
  });
});
