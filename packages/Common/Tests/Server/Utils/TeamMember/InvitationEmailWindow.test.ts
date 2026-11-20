import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ONE INVITATION EMAIL FROM A PROJECT TO A PERSON PER WINDOW (#10179,
 * Server/Utils/TeamMember/InvitationEmailWindow).
 *
 * The window itself, against a stand-in for Valkey that keeps values and
 * their expiry by the clock this suite turns: what opens it, what closes it,
 * how long it lasts, that it is one project's and one person's, and that it
 * fails open - every invitation emailed - whenever Valkey cannot answer. The
 * invitations that ask it are driven in
 * Services/InvitationEmailWindowInvitations.test.ts.
 */

jest.mock("../../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn(),
      isConnected: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import Redis from "../../../../Server/Infrastructure/Redis";
import logger from "../../../../Server/Utils/Logger";
import PublicMessageRateLimit from "../../../../Server/Utils/RateLimit/PublicMessageRateLimit";
import InvitationEmailWindow, {
  InvitationEmailWindowClaim,
} from "../../../../Server/Utils/TeamMember/InvitationEmailWindow";
import ObjectID from "../../../../Types/ObjectID";
import FakeCounterRedis, {
  FakeCounterCommand,
} from "../../TestingUtils/Redis/FakeCounterRedis";

type MockedFn = ReturnType<typeof jest.fn>;

const getClientMock: MockedFn = Redis.getClient as unknown as MockedFn;
const isConnectedMock: MockedFn = Redis.isConnected as unknown as MockedFn;
const warnMock: MockedFn = logger.warn as unknown as MockedFn;

const PROJECT_A: ObjectID = new ObjectID(
  "10179aaa-0000-4000-8000-000000000001",
);
const PROJECT_B: ObjectID = new ObjectID(
  "10179aaa-0000-4000-8000-000000000002",
);
const GRACE: ObjectID = new ObjectID("10179aaa-0000-4000-8000-000000000003");
const ADA: ObjectID = new ObjectID("10179aaa-0000-4000-8000-000000000004");

const HOUR_IN_MS: number = 60 * 60 * 1000;

let redis: FakeCounterRedis;
let now: number;

beforeEach(() => {
  jest.clearAllMocks();

  redis = new FakeCounterRedis();
  getClientMock.mockReturnValue(redis);
  isConnectedMock.mockReturnValue(true);

  now = Date.UTC(2035, 0, 1, 9, 0, 0);
  jest.spyOn(Date, "now").mockImplementation((): number => {
    return now;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function claim(
  projectId: ObjectID = PROJECT_A,
  userId: ObjectID = GRACE,
): Promise<InvitationEmailWindowClaim> {
  return await InvitationEmailWindow.claim({
    projectId: projectId,
    userId: userId,
  });
}

describe("a window opens with a project's first invitation email to a person", () => {
  test("the first invitation claims it; another within the hour does not", async () => {
    expect((await claim()).isClaimed).toBe(true);
    expect((await claim()).isClaimed).toBe(false);

    now += HOUR_IN_MS - 1000;
    expect((await claim()).isClaimed).toBe(false);
  });

  test("it lasts as long as the invitation limit's window: an hour, then the next invitation emails again", async () => {
    expect(InvitationEmailWindow.getWindowSeconds()).toBe(
      PublicMessageRateLimit.getConfig().contactWindowSeconds,
    );
    expect(InvitationEmailWindow.getWindowSeconds()).toBe(60 * 60);

    await claim();
    now += HOUR_IN_MS;

    expect((await claim()).isClaimed).toBe(true);
  });

  test("it is one project's, for one person", async () => {
    await claim(PROJECT_A, GRACE);

    // Another project, or another person, has a window of its own.
    expect((await claim(PROJECT_B, GRACE)).isClaimed).toBe(true);
    expect((await claim(PROJECT_A, ADA)).isClaimed).toBe(true);
    expect((await claim(PROJECT_A, GRACE)).isClaimed).toBe(false);
  });

  test("one id however it is spelled: in capitals it is the same window", async () => {
    await claim(PROJECT_A, GRACE);

    expect(
      (
        await claim(
          new ObjectID(PROJECT_A.toString().toUpperCase()),
          new ObjectID(GRACE.toString().toUpperCase()),
        )
      ).isClaimed,
    ).toBe(false);
  });

  test("its key holds the project's and the account's ids, and nothing of the address", async () => {
    await claim();

    expect(redis.keys()).toEqual([
      `invitation-email-window:${PROJECT_A.toString()}:${GRACE.toString()}`,
    ]);
    expect(redis.keys()[0]).not.toContain("@");
  });

  test("of two invitations racing, one claims it: SET with NX and EX, in one round trip each", async () => {
    const [first, second] = await Promise.all([claim(), claim()]);

    expect([first.isClaimed, second.isClaimed].sort()).toEqual([false, true]);
    expect(redis.commandsSent("set")).toHaveLength(2);
  });
});

describe("what closes it before the hour is over", () => {
  test("an invitation that sent nothing gives its window back, once", async () => {
    const opened: InvitationEmailWindowClaim = await claim();

    await opened.release();
    await opened.release();

    expect(redis.commandsSent("del")).toHaveLength(1);
    expect((await claim()).isClaimed).toBe(true);
  });

  test("an invitation that did not claim it cannot close the one that did", async () => {
    await claim();
    const inTheWindow: InvitationEmailWindowClaim = await claim();

    await inTheWindow.release();

    expect(redis.commandsSent("del")).toHaveLength(0);
    expect((await claim()).isClaimed).toBe(false);
  });

  test("the person accepted or declined: their windows in the project end, no one else's", async () => {
    await claim(PROJECT_A, GRACE);
    await claim(PROJECT_A, ADA);
    await claim(PROJECT_B, GRACE);

    await InvitationEmailWindow.end({ projectId: PROJECT_A, userIds: [GRACE] });

    expect((await claim(PROJECT_A, GRACE)).isClaimed).toBe(true);
    expect((await claim(PROJECT_A, ADA)).isClaimed).toBe(false);
    expect((await claim(PROJECT_B, GRACE)).isClaimed).toBe(false);
  });

  test("ending several at once is one round trip; ending none is none", async () => {
    await InvitationEmailWindow.end({
      projectId: PROJECT_A,
      userIds: [GRACE, ADA],
    });
    await InvitationEmailWindow.end({ projectId: PROJECT_A, userIds: [] });

    expect(redis.commandsSent("del")).toHaveLength(1);
  });
});

describe("Resend Invitation starts it again", () => {
  test("a resend opens the window from now, whether or not one was open", async () => {
    now += 0;
    await InvitationEmailWindow.renew({ projectId: PROJECT_A, userId: GRACE });

    expect((await claim()).isClaimed).toBe(false);

    now += HOUR_IN_MS - 1000;
    await InvitationEmailWindow.renew({ projectId: PROJECT_A, userId: GRACE });

    // An hour after the first resend, the second still holds it.
    now += 2000;
    expect((await claim()).isClaimed).toBe(false);

    now += HOUR_IN_MS;
    expect((await claim()).isClaimed).toBe(true);
  });
});

describe("it fails open: whenever Valkey cannot answer, every invitation is emailed", () => {
  test("not connected: claimed, with nothing to give back, and nothing sent to Valkey", async () => {
    isConnectedMock.mockReturnValue(false);

    const first: InvitationEmailWindowClaim = await claim();
    const second: InvitationEmailWindowClaim = await claim();

    expect([first.isClaimed, second.isClaimed]).toEqual([true, true]);

    await first.release();
    await InvitationEmailWindow.renew({ projectId: PROJECT_A, userId: GRACE });
    await InvitationEmailWindow.end({ projectId: PROJECT_A, userIds: [GRACE] });

    expect(redis.sent).toEqual([]);
  });

  test("no client at all: the same", async () => {
    getClientMock.mockReturnValue(null);

    expect((await claim()).isClaimed).toBe(true);
    expect((await claim()).isClaimed).toBe(true);
  });

  test("a SET that fails: claimed, and a warning", async () => {
    redis.failCommand = (command: FakeCounterCommand): Error | null => {
      return command.name === "set" ? new Error("connection reset") : null;
    };

    expect((await claim()).isClaimed).toBe(true);
    expect(warnMock).toHaveBeenCalled();
  });

  test("a DEL that fails never throws: the window ends with its expiry", async () => {
    const opened: InvitationEmailWindowClaim = await claim();

    redis.failCommand = (command: FakeCounterCommand): Error | null => {
      return command.name === "del" ? new Error("connection reset") : null;
    };

    await expect(opened.release()).resolves.toBeUndefined();
    await expect(
      InvitationEmailWindow.end({ projectId: PROJECT_A, userIds: [GRACE] }),
    ).resolves.toBeUndefined();
    expect(warnMock).toHaveBeenCalled();
  });

  test("a resend's SET that fails never throws", async () => {
    redis.failCommand = (): Error | null => {
      return new Error("connection reset");
    };

    await expect(
      InvitationEmailWindow.renew({ projectId: PROJECT_A, userId: GRACE }),
    ).resolves.toBeUndefined();
  });
});
