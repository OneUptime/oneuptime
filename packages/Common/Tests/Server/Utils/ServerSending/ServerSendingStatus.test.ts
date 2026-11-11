import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * CAN THIS SERVER SEND? THE ONE ANSWER ON THE SERVER (#6825).
 *
 * ServerSendingStatus reads the server's settings and what it remembers of
 * its own last sends from the GlobalConfig row, and writes down how the
 * senders' sends went - news only, decided again on a fresh read. The row is
 * stood in for here: findOneById answers what the test says, and every
 * write is caught.
 */

let storedConfig: Record<string, unknown> | null = null;
const findOneById: jest.Mock = jest.fn();
const writeServerSendingHealth: jest.Mock = jest.fn();
const forgetServerSendingHealthOf: jest.Mock = jest.fn();
const probeCountBy: jest.Mock = jest.fn();

jest.mock("../../../../Server/Services/GlobalConfigService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: (...args: Array<unknown>): unknown => {
        return findOneById(...args);
      },
      writeServerSendingHealth: (...args: Array<unknown>): unknown => {
        return writeServerSendingHealth(...args);
      },
      forgetServerSendingHealthOf: (...args: Array<unknown>): unknown => {
        return forgetServerSendingHealthOf(...args);
      },
    },
  };
});

jest.mock("../../../../Server/Services/ProbeService", () => {
  return {
    __esModule: true,
    default: {
      countBy: (...args: Array<unknown>): unknown => {
        return probeCountBy(...args);
      },
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
  };
});

import ServerSendingStatus from "../../../../Server/Utils/ServerSending/ServerSendingStatus";
import ServerSendingOutcomes from "../../../../Server/Utils/ServerSending/ServerSendingOutcomes";
import GlobalConfig, {
  EmailServerType,
} from "../../../../Models/DatabaseModels/GlobalConfig";
import { ProbeConnectionStatus } from "../../../../Models/DatabaseModels/Probe";
import PositiveNumber from "../../../../Types/PositiveNumber";
import ServerSendingStatusUtil, {
  ServerChannelStatus,
  ServerSendingChannel,
  ServerSendingHealth,
  ServerSendingState,
  ServerSendingStatusAnswer,
} from "../../../../Types/ServerSending/ServerSendingStatus";

const EMAIL_SET_UP: Record<string, unknown> = {
  emailServerType: EmailServerType.Resend,
  resendApiKey: "re_key",
  resendFromEmail: "alerts@example.com",
};

function row(
  settings: Record<string, unknown>,
  health?: ServerSendingHealth,
): Record<string, unknown> {
  return { ...settings, serverSendingHealth: health };
}

beforeEach(() => {
  ServerSendingStatus.clearCache();
  storedConfig = null;
  findOneById.mockReset();
  writeServerSendingHealth.mockReset();
  forgetServerSendingHealthOf.mockReset();
  probeCountBy.mockReset();

  findOneById.mockImplementation(async (): Promise<unknown> => {
    return storedConfig ? { ...storedConfig } : null;
  });

  writeServerSendingHealth.mockImplementation(
    async (health: unknown): Promise<void> => {
      storedConfig = {
        ...(storedConfig || {}),
        serverSendingHealth: JSON.parse(JSON.stringify(health)),
      };
    },
  );
});

afterEach(() => {
  ServerSendingOutcomes.register(null);
  jest.useRealTimers();
});

describe("where each channel stands", () => {
  test("a fresh server: email, SMS and calls not set up; push untested", () => {
    const statuses: Array<ServerChannelStatus> =
      ServerSendingStatus.getStatusesFrom({} as GlobalConfig);

    expect(
      statuses.map((status: ServerChannelStatus): [string, string] => {
        return [status.channel, status.state];
      }),
    ).toEqual([
      [ServerSendingChannel.Email, ServerSendingState.NotSetUp],
      [ServerSendingChannel.SMS, ServerSendingState.NotSetUp],
      [ServerSendingChannel.Call, ServerSendingState.NotSetUp],
      [ServerSendingChannel.Push, ServerSendingState.Untested],
    ]);

    expect(statuses[0]!.setUpProblem).toBeTruthy();
  });

  test("set up and remembered: working, or failing since when and why", () => {
    const failing: ServerChannelStatus = ServerSendingStatus.getStatusFrom(
      row(EMAIL_SET_UP, {
        email: {
          lastSucceededAt: "2026-11-10T10:00:00.000Z",
          lastFailedAt: "2026-11-11T09:00:00.000Z",
          failingSince: "2026-11-11T08:00:00.000Z",
          lastFailure: "403 Forbidden",
        },
      }) as GlobalConfig,
      ServerSendingChannel.Email,
    );

    expect(failing).toMatchObject({
      state: ServerSendingState.Failing,
      hasWorked: true,
      failingSince: "2026-11-11T08:00:00.000Z",
      lastFailure: "403 Forbidden",
      setUpProblem: null,
    });

    expect(
      ServerSendingStatus.getStatusFrom(
        row(EMAIL_SET_UP, {
          email: {
            lastSucceededAt: "2026-11-11T09:00:00.000Z",
            lastFailedAt: null,
            failingSince: null,
            lastFailure: null,
          },
        }) as GlobalConfig,
        ServerSendingChannel.Email,
      ).state,
    ).toBe(ServerSendingState.Working);
  });

  test("what anybody's page may say about email", () => {
    expect(
      ServerSendingStatus.canSendEmailPubliclyFrom({} as GlobalConfig),
    ).toBe(false);
    expect(ServerSendingStatus.canSendEmailPubliclyFrom(null)).toBe(false);
    expect(
      ServerSendingStatus.canSendEmailPubliclyFrom(
        row(EMAIL_SET_UP) as GlobalConfig,
      ),
    ).toBe(true);
    // Set up, never worked, failing: cannot send yet.
    expect(
      ServerSendingStatus.canSendEmailPubliclyFrom(
        row(EMAIL_SET_UP, {
          email: {
            lastSucceededAt: null,
            lastFailedAt: "2026-11-11T09:00:00.000Z",
            failingSince: "2026-11-11T09:00:00.000Z",
            lastFailure: "refused",
          },
        }) as GlobalConfig,
      ),
    ).toBe(false);
    // Worked once, failing now: the public pages say nothing.
    expect(
      ServerSendingStatus.canSendEmailPubliclyFrom(
        row(EMAIL_SET_UP, {
          email: {
            lastSucceededAt: "2026-11-10T09:00:00.000Z",
            lastFailedAt: "2026-11-11T09:00:00.000Z",
            failingSince: "2026-11-11T09:00:00.000Z",
            lastFailure: "refused",
          },
        }) as GlobalConfig,
      ),
    ).toBe(true);
  });
});

describe("what the sign-in pages are refused on", () => {
  test("email read, and not set up", async () => {
    storedConfig = {};
    await expect(ServerSendingStatus.isEmailKnownNotSetUp()).resolves.toBe(
      true,
    );

    storedConfig = row(EMAIL_SET_UP);
    await expect(ServerSendingStatus.isEmailKnownNotSetUp()).resolves.toBe(
      false,
    );
  });

  test("a read that fails, or finds no row, refuses nothing: the request goes on as it always did", async () => {
    storedConfig = null;
    await expect(ServerSendingStatus.isEmailKnownNotSetUp()).resolves.toBe(
      false,
    );

    findOneById.mockRejectedValueOnce(new Error("database is down") as never);
    await expect(ServerSendingStatus.isEmailKnownNotSetUp()).resolves.toBe(
      false,
    );
  });

  test("reads the settings and the remembered sends, as root", async () => {
    storedConfig = row(EMAIL_SET_UP);

    await ServerSendingStatus.isEmailKnownNotSetUp();

    const args: Record<string, any> = findOneById.mock.calls[0]![0] as Record<
      string,
      any
    >;

    expect(args["props"]).toEqual({ isRoot: true });
    expect(args["select"]["serverSendingHealth"]).toBe(true);
    expect(args["select"]["smtpHost"]).toBe(true);
    expect(args["select"]["resendApiKey"]).toBe(true);
  });
});

describe("what the senders' sends write down", () => {
  test("the first send that goes out is written; the next ones within the hour are not", async () => {
    storedConfig = row(EMAIL_SET_UP);

    await ServerSendingStatus.recordOutcome({
      channel: ServerSendingChannel.Email,
      succeeded: true,
    });

    expect(writeServerSendingHealth).toHaveBeenCalledTimes(1);

    const written: ServerSendingHealth = writeServerSendingHealth.mock
      .calls[0]![0] as ServerSendingHealth;

    expect(written.email?.lastSucceededAt).toBeTruthy();
    expect(written.email?.failingSince).toBeNull();

    for (let i: number = 0; i < 20; i++) {
      await ServerSendingStatus.recordOutcome({
        channel: ServerSendingChannel.Email,
        succeeded: true,
      });
    }

    expect(writeServerSendingHealth).toHaveBeenCalledTimes(1);
  });

  test("a failure after it is news at once, with why; the same failure again is not", async () => {
    storedConfig = row(EMAIL_SET_UP);

    await ServerSendingStatus.recordOutcome({
      channel: ServerSendingChannel.Email,
      succeeded: true,
    });
    await ServerSendingStatus.recordOutcome({
      channel: ServerSendingChannel.Email,
      succeeded: false,
      reason: "535 Authentication failed",
    });
    await ServerSendingStatus.recordOutcome({
      channel: ServerSendingChannel.Email,
      succeeded: false,
      reason: "535 Authentication failed",
    });

    expect(writeServerSendingHealth).toHaveBeenCalledTimes(2);

    const status: ServerChannelStatus = ServerSendingStatus.getStatusFrom(
      storedConfig as unknown as GlobalConfig,
      ServerSendingChannel.Email,
    );

    expect(status.state).toBe(ServerSendingState.Failing);
    expect(status.hasWorked).toBe(true);
    expect(status.lastFailure).toBe("535 Authentication failed");
  });

  test("a send that goes out after failures ends the streak at once", async () => {
    storedConfig = row(EMAIL_SET_UP, {
      email: {
        lastSucceededAt: null,
        lastFailedAt: new Date().toISOString(),
        failingSince: new Date().toISOString(),
        lastFailure: "refused",
      },
    });

    await ServerSendingStatus.recordOutcome({
      channel: ServerSendingChannel.Email,
      succeeded: true,
    });

    expect(
      ServerSendingStatus.getStatusFrom(
        storedConfig as unknown as GlobalConfig,
        ServerSendingChannel.Email,
      ).state,
    ).toBe(ServerSendingState.Working);
  });

  test("news is decided again on a fresh read: another server's write is kept", async () => {
    storedConfig = row(EMAIL_SET_UP);

    // This server reads first: nothing remembered.
    await ServerSendingStatus.recordOutcome({
      channel: ServerSendingChannel.SMS,
      succeeded: true,
    });

    // Another server writes that email works.
    storedConfig = {
      ...storedConfig,
      serverSendingHealth: {
        ...(storedConfig["serverSendingHealth"] as ServerSendingHealth),
        email: {
          lastSucceededAt: new Date().toISOString(),
          lastFailedAt: null,
          failingSince: null,
          lastFailure: null,
        },
      },
    };

    // This server's cached copy knows nothing of email: a failure is news.
    await ServerSendingStatus.recordOutcome({
      channel: ServerSendingChannel.Email,
      succeeded: false,
      reason: "timed out",
    });

    const health: ServerSendingHealth = ServerSendingStatusUtil.readHealth(
      storedConfig["serverSendingHealth"],
    );

    expect(health.sms?.lastSucceededAt).toBeTruthy();
    // The other server's success is kept: email has worked.
    expect(health.email?.lastSucceededAt).toBeTruthy();
    expect(health.email?.failingSince).toBeTruthy();
  });

  test("a send that is news on this server's copy but not on the fresh read writes nothing", async () => {
    const recent: string = new Date().toISOString();

    storedConfig = row(EMAIL_SET_UP);

    // Read and cached: nothing remembered.
    await ServerSendingStatus.recordOutcome({
      channel: ServerSendingChannel.Call,
      succeeded: false,
      reason: "busy",
    });

    expect(writeServerSendingHealth).toHaveBeenCalledTimes(1);

    // Another server wrote email's success a moment ago.
    (storedConfig["serverSendingHealth"] as ServerSendingHealth).email = {
      lastSucceededAt: recent,
      lastFailedAt: null,
      failingSince: null,
      lastFailure: null,
    };

    await ServerSendingStatus.recordOutcome({
      channel: ServerSendingChannel.Email,
      succeeded: true,
    });

    expect(writeServerSendingHealth).toHaveBeenCalledTimes(1);
  });

  test("the senders reach it only once the Notification service starts recording", async () => {
    storedConfig = row(EMAIL_SET_UP);

    await ServerSendingOutcomes.recordSucceeded(ServerSendingChannel.Email);
    expect(writeServerSendingHealth).not.toHaveBeenCalled();

    ServerSendingStatus.startRecordingOutcomes();
    expect(ServerSendingOutcomes.isRegistered()).toBe(true);

    await ServerSendingOutcomes.recordFailed(
      ServerSendingChannel.Email,
      "refused",
    );
    expect(writeServerSendingHealth).toHaveBeenCalledTimes(1);
  });

  test("a write that fails is never the send's failure", async () => {
    storedConfig = row(EMAIL_SET_UP);
    writeServerSendingHealth.mockRejectedValue(
      new Error("database is down") as never,
    );

    ServerSendingStatus.startRecordingOutcomes();

    await expect(
      ServerSendingOutcomes.recordSucceeded(ServerSendingChannel.Email),
    ).resolves.toBeUndefined();
  });
});

describe("saving a channel's settings", () => {
  test("starts it again at untested, and forgets this server's copy", async () => {
    storedConfig = row(EMAIL_SET_UP);

    await ServerSendingStatus.recordOutcome({
      channel: ServerSendingChannel.Email,
      succeeded: true,
    });
    expect(writeServerSendingHealth).toHaveBeenCalledTimes(1);

    await ServerSendingStatus.forgetChannels([ServerSendingChannel.Email]);

    expect(forgetServerSendingHealthOf).toHaveBeenCalledWith([
      ServerSendingChannel.Email,
    ]);

    // The cached copy is gone: the next send reads afresh.
    findOneById.mockClear();
    await ServerSendingStatus.recordOutcome({
      channel: ServerSendingChannel.Email,
      succeeded: true,
    });
    expect(findOneById).toHaveBeenCalled();
  });
});

describe("GET /global-config/sending-status's answer", () => {
  test("every channel, and the global probes", async () => {
    storedConfig = row(EMAIL_SET_UP);

    probeCountBy.mockImplementation(
      async (args: unknown): Promise<PositiveNumber> => {
        const query: Record<string, unknown> = (
          args as { query: Record<string, unknown> }
        ).query;

        return new PositiveNumber(
          query["connectionStatus"] === ProbeConnectionStatus.Connected ? 0 : 2,
        );
      },
    );

    const answer: ServerSendingStatusAnswer =
      await ServerSendingStatus.getAnswer();

    expect(answer.channels).toHaveLength(4);
    expect(answer.globalProbes).toEqual({ total: 2, reporting: 0 });
    expect(
      ServerSendingStatusUtil.areGlobalProbesSilent(answer.globalProbes),
    ).toBe(true);

    for (const call of probeCountBy.mock.calls) {
      const args: Record<string, any> = call[0] as Record<string, any>;
      expect(args["query"]["isGlobalProbe"]).toBe(true);
      expect(args["props"]).toEqual({ isRoot: true });
    }
  });

  test("a server with no global probes says nothing about them", async () => {
    storedConfig = row(EMAIL_SET_UP);
    probeCountBy.mockResolvedValue(new PositiveNumber(0) as never);

    await expect(ServerSendingStatus.getGlobalProbesStatus()).resolves.toBe(
      null,
    );
    expect(probeCountBy).toHaveBeenCalledTimes(1);
  });
});
