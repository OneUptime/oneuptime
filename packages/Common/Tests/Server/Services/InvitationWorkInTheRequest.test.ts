import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * AN INVITATION DOES THE SAME WORK BEFORE ITS REQUEST ANSWERS, WHATEVER
 * ACCOUNT THE ADDRESS HAS (#10180).
 *
 * An invitation to an account nobody had claimed yet - one an earlier
 * invitation made, with no password - minted its registration token in the
 * request (one INSERT), and read and wrote the account's name when one was
 * typed: work an invitation to an account that has signed up did not do. A
 * few milliseconds, but they said that somebody had invited the address
 * before - on a dashboard invitation, a SCIM create and a SCIM group add
 * alike.
 *
 * Now the email is built, its token minted and sent once the membership is
 * made, after the request (TeamMemberService.sendPlannedInvitation), and the
 * name is written there too. Driven through every hook of the create, as
 * DatabaseService runs them, with the database stood in for (InvitationWorld):
 *
 *   - the reads and writes before the answer are the same, in the same
 *     order, for an account that has signed up, one nobody has claimed (with
 *     a name and without), and - bar the account's own creation - an address
 *     with no account; on OneUptime Cloud and self-hosted; by address, by id,
 *     and as SCIM creates them;
 *   - with every read and write slowed down, the answers take as long;
 *   - after the answer, each is sent what it always was: a token only for an
 *     account that can still be claimed, and a name only for one that has
 *     none.
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
  TeamMessageKind,
} from "../../../Server/Utils/RateLimit/PublicMessageRateLimit";
import InvitationEmailWindow from "../../../Server/Utils/TeamMember/InvitationEmailWindow";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import InvitationWorld, { WorldAccount } from "../TestingUtils/InvitationWorld";
import FakeCounterRedis from "../TestingUtils/Redis/FakeCounterRedis";

type MockedFn = ReturnType<typeof jest.fn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "10180000-0000-4000-8000-000000000001",
);
const TEAM_ID: ObjectID = new ObjectID("10180000-0000-4000-8000-000000000002");
const INVITER_ID: ObjectID = new ObjectID(
  "10180000-0000-4000-8000-000000000003",
);

const ADDRESS: string = "grace@company.example";

let world: InvitationWorld;
let redis: FakeCounterRedis;

beforeEach(() => {
  jest.clearAllMocks();

  redis = new FakeCounterRedis();
  (Redis.getClient as unknown as MockedFn).mockReturnValue(redis);
  (Redis.isConnected as unknown as MockedFn).mockReturnValue(true);

  world = new InvitationWorld();
  world.install();
  setTestBillingEnabled(true);
});

afterEach(() => {
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

// Where the address stands before the invitation.
enum Address {
  NoAccount = "an address with no account",
  Unclaimed = "an account nobody has claimed, with no name",
  UnclaimedNamed = "an account nobody has claimed, named by an earlier invitation",
  SignedUp = "an account that has signed up",
}

const ACCOUNT_STATES: Array<Address> = [
  Address.Unclaimed,
  Address.UnclaimedNamed,
  Address.SignedUp,
];

function seed(address: Address): WorldAccount | null {
  switch (address) {
    case Address.NoAccount:
      return null;
    case Address.Unclaimed:
      return world.seedAccount({ email: ADDRESS, hasSignedUp: false });
    case Address.UnclaimedNamed:
      return world.seedAccount({
        email: ADDRESS,
        hasSignedUp: false,
        name: "Grace H.",
      });
    case Address.SignedUp:
      return world.seedAccount({
        email: ADDRESS,
        hasSignedUp: true,
        name: "Grace Hopper",
      });
  }
}

function ownerProps(): DatabaseCommonInteractionProps {
  return {
    userId: INVITER_ID,
    tenantId: PROJECT_ID,
  } as DatabaseCommonInteractionProps;
}

// The invite forms: by address, with the name typed for them, or none.
function byAddress(typedName?: string): CreateBy<TeamMember> {
  const member: TeamMember = new TeamMember();
  member.projectId = PROJECT_ID;
  member.teamId = TEAM_ID;

  return {
    data: member,
    props: ownerProps(),
    miscDataProps: {
      email: ADDRESS,
      ...(typedName ? { name: typedName } : {}),
    },
  } as CreateBy<TeamMember>;
}

// A master admin's Add to Project: by the account's id.
function byId(userId: ObjectID): CreateBy<TeamMember> {
  const member: TeamMember = new TeamMember();
  member.projectId = PROJECT_ID;
  member.teamId = TEAM_ID;
  member.userId = userId;
  member.hasAcceptedInvitation = false;

  return {
    data: member,
    props: {
      userId: INVITER_ID,
      isMasterAdmin: true,
    } as DatabaseCommonInteractionProps,
  } as CreateBy<TeamMember>;
}

// As SCIM invites (ProjectSCIMAccountPolicy.addUserToTeam): OneUptime's own.
function asScim(userId: ObjectID): CreateBy<TeamMember> {
  const member: TeamMember = new TeamMember();
  member.projectId = PROJECT_ID;
  member.teamId = TEAM_ID;
  member.userId = userId;
  member.hasAcceptedInvitation = false;
  member.inviteeName = "Grace Hopper";

  return {
    data: member,
    props: { isRoot: true } as DatabaseCommonInteractionProps,
    miscDataProps: { email: ADDRESS },
  } as CreateBy<TeamMember>;
}

// One invitation in a fresh world: what it did before and after its answer.
async function inviteIn(
  address: Address,
  make: (account: WorldAccount | null) => CreateBy<TeamMember>,
): Promise<{ before: Array<string>; after: Array<string> }> {
  world.calls = [];
  world.accounts = [];
  world.memberships = [];
  world.tokensMinted = [];
  world.mails = [];
  redis.reset();

  const account: WorldAccount | null = seed(address);

  await world.create(make(account));

  return { before: world.callsBeforeAnswer(), after: world.callsAfterAnswer() };
}

// The account's own creation: what only an address with no account does.
function withoutAccountCreation(calls: Array<string>): Array<string> {
  return calls.filter((call: string): boolean => {
    return call !== "UserService.createByEmail";
  });
}

describe.each([
  ["OneUptime Cloud", true],
  ["a self-hosted server", false],
])("on %s", (_edition: string, isCloud: boolean) => {
  beforeEach(() => {
    setTestBillingEnabled(isCloud);
  });

  describe.each([
    ["with a name typed for them", "Grace"],
    ["with no name typed", undefined],
  ])(
    "an invitation by address, %s",
    (_label: string, typedName: string | undefined) => {
      test("the same reads and writes before the answer, for every account", async () => {
        const signedUp: Array<string> = (
          await inviteIn(Address.SignedUp, () => {
            return byAddress(typedName);
          })
        ).before;

        for (const address of ACCOUNT_STATES) {
          expect({
            address,
            before: (
              await inviteIn(address, () => {
                return byAddress(typedName);
              })
            ).before,
          }).toEqual({ address, before: signedUp });
        }

        // An address with no account makes it, and does nothing else more.
        const noAccount: Array<string> = (
          await inviteIn(Address.NoAccount, () => {
            return byAddress(typedName);
          })
        ).before;

        expect(noAccount).toContain("UserService.createByEmail");
        expect(withoutAccountCreation(noAccount)).toEqual(signedUp);
      });

      test("nothing of the email before the answer: no token, no name, no send", async () => {
        for (const address of [...ACCOUNT_STATES, Address.NoAccount]) {
          const before: Array<string> = (
            await inviteIn(address, () => {
              return byAddress(typedName);
            })
          ).before;

          for (const call of [
            "EmailVerificationTokenService.create",
            "UserService.updateOneById",
            "MailService.sendMail",
            "ProjectService.findOneById",
          ]) {
            expect({ address, call, before: before.includes(call) }).toEqual({
              address,
              call,
              before: false,
            });
          }
        }
      });
    },
  );

  test("an invitation by id (Add to Project): the same reads and writes, for every account", async () => {
    const signedUp: Array<string> = (
      await inviteIn(Address.SignedUp, (account: WorldAccount | null) => {
        return byId(account!.id);
      })
    ).before;

    for (const address of ACCOUNT_STATES) {
      expect({
        address,
        before: (
          await inviteIn(address, (account: WorldAccount | null) => {
            return byId(account!.id);
          })
        ).before,
      }).toEqual({ address, before: signedUp });
    }
  });

  test("as SCIM invites: the same reads and writes, for every account", async () => {
    const signedUp: Array<string> = (
      await inviteIn(Address.SignedUp, (account: WorldAccount | null) => {
        return asScim(account!.id);
      })
    ).before;

    for (const address of ACCOUNT_STATES) {
      expect({
        address,
        before: (
          await inviteIn(address, (account: WorldAccount | null) => {
            return asScim(account!.id);
          })
        ).before,
      }).toEqual({ address, before: signedUp });
    }
  });
});

describe("after the answer, each is sent what it always was", () => {
  test("an account nobody has claimed: a registration token for this address, on the email's link", async () => {
    const { after } = await inviteIn(Address.Unclaimed, () => {
      return byAddress();
    });

    expect(after).toContain("EmailVerificationTokenService.create");
    expect(world.tokensMinted).toHaveLength(1);
    expect(world.tokensMinted[0]!.email?.toString()).toBe(ADDRESS);
    expect(world.mails).toHaveLength(1);
    expect(world.mails[0]!.vars["registerLink"]).toContain(
      `token=${world.tokensMinted[0]!.token!.toString()}`,
    );
  });

  test("an address with no account: its new account's token, the same way", async () => {
    await inviteIn(Address.NoAccount, () => {
      return byAddress();
    });

    expect(world.tokensMinted).toHaveLength(1);
    expect(world.mails[0]!.vars["isNewUser"]).toBe("true");
  });

  test("an account that has signed up: no token, the sign-in link", async () => {
    const { after } = await inviteIn(Address.SignedUp, () => {
      return byAddress("Grace");
    });

    expect(after).not.toContain("EmailVerificationTokenService.create");
    expect(world.tokensMinted).toHaveLength(0);
    expect(world.mails).toHaveLength(1);
    expect(world.mails[0]!.vars["registerLink"]).not.toContain("token=");
  });

  test("the typed name goes on an account nobody has claimed that has none, after the answer", async () => {
    await inviteIn(Address.Unclaimed, () => {
      return byAddress("Grace");
    });

    expect(world.accountAt(ADDRESS)!.name).toBe("Grace");
  });

  test("an account nobody has claimed keeps a name an earlier invitation gave it", async () => {
    await inviteIn(Address.UnclaimedNamed, () => {
      return byAddress("Someone Else");
    });

    expect(world.accountAt(ADDRESS)!.name).toBe("Grace H.");
  });

  test("an account that has signed up keeps its own name", async () => {
    await inviteIn(Address.SignedUp, () => {
      return byAddress("Someone Else");
    });

    expect(world.accountAt(ADDRESS)!.name).toBe("Grace Hopper");
  });

  test("an account claimed after the request, before its name was written, keeps what its person gave it", async () => {
    world.calls = [];
    const account: WorldAccount = seed(Address.Unclaimed)!;

    const creating: Promise<TeamMember> = world.create(byAddress("Grace"));

    // The person signs up as the invitation is made.
    account.password = "signed-up-meanwhile";

    await creating;

    expect(world.accountAt(ADDRESS)!.name).toBeNull();
  });
});

describe("the answer waits for none of it", () => {
  test("with every read and write slowed down, an account nobody has claimed is answered as fast as one that has signed up", async () => {
    world.readDelayMs = 25;

    const fastest: (address: Address) => Promise<number> = async (
      address: Address,
    ): Promise<number> => {
      const times: Array<number> = [];

      for (let round: number = 0; round < 3; round++) {
        await inviteIn(address, () => {
          return byAddress("Grace");
        });
        times.push(world.lastRequestMs);
      }

      return Math.min(...times);
    };

    const signedUp: number = await fastest(Address.SignedUp);
    const unclaimed: number = await fastest(Address.Unclaimed);

    // Within half of one slowed read: the token's INSERT alone is a whole one.
    expect(Math.abs(unclaimed - signedUp)).toBeLessThan(world.readDelayMs / 2);
  });
});

describe("a create that fails sends nothing, and gives back what it took", () => {
  test("an INSERT that fails: no email, no token, the address's count and the project's window given back", async () => {
    const account: WorldAccount = seed(Address.Unclaimed)!;

    await expect(
      world.create(byAddress(), { failInsert: new Error("connection lost") }),
    ).rejects.toThrow("connection lost");

    expect(world.mails).toHaveLength(0);
    expect(world.tokensMinted).toHaveLength(0);
    expect(
      redis.count(
        PublicMessageRateLimit.getProjectContactCounterKey({
          counterName: TeamMessageKind.Invitation,
          projectId: PROJECT_ID,
          contact: PublicMessageRateLimit.forEmail(ADDRESS),
        }),
      ),
    ).toBe(0);
    expect(
      (
        await InvitationEmailWindow.claim({
          projectId: PROJECT_ID,
          userId: account.id,
        })
      ).isClaimed,
    ).toBe(true);
  });

  test("a mail service that refuses the email: the count and the window given back, the membership stands", async () => {
    const account: WorldAccount = seed(Address.SignedUp)!;
    world.mailAnswer = "refused";

    await world.create(byAddress());

    expect(world.memberships).toHaveLength(1);
    expect(world.mails).toHaveLength(1);
    expect(
      redis.count(
        PublicMessageRateLimit.getContactCounterKey({
          counterName: TeamMessageKind.Invitation,
          contact: PublicMessageRateLimit.forEmail(ADDRESS),
        }),
      ),
    ).toBe(0);
    expect(
      (
        await InvitationEmailWindow.claim({
          projectId: PROJECT_ID,
          userId: account.id,
        })
      ).isClaimed,
    ).toBe(true);
  });

  test("an email that cannot be built (a token that cannot be minted): the same", async () => {
    const account: WorldAccount = seed(Address.Unclaimed)!;

    const { default: EmailVerificationTokenService } = (await import(
      "../../../Server/Services/EmailVerificationTokenService"
    )) as { default: { create: MockedFn } };
    EmailVerificationTokenService.create.mockRejectedValueOnce(
      new Error("database away") as never,
    );

    await expect(world.create(byAddress())).resolves.toBeDefined();

    expect(world.mails).toHaveLength(0);
    expect(
      (
        await InvitationEmailWindow.claim({
          projectId: PROJECT_ID,
          userId: account.id,
        })
      ).isClaimed,
    ).toBe(true);
  });
});
