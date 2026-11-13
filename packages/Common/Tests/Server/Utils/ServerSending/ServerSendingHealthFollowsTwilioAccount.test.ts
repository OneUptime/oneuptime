import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";

/*
 * SMS AND CALLS START AGAIN AT UNTESTED WHEN THE TWILIO ACCOUNT CHANGES
 * WITHOUT A SAVE (#7736).
 *
 * Once GLOBAL_TWILIO_ACCOUNT_SID is set, the server's Twilio account is the
 * one the GLOBAL_TWILIO_ environment variables describe (#7515), and it
 * changes when they do and OneUptime restarts - with no save in the Admin
 * Dashboard to forget what the server remembered of the account before. So
 * an operator who fixed a wrong auth token in their Helm values went on
 * seeing "SMS failing since..." until an SMS happened to go out, and an
 * account nobody had tried showed as working.
 *
 * ServerSendingStatus reads an SMS or call entry learned through another
 * route as nothing remembered, and the next send writes its news marked
 * with the route it went through. The row is stood in for, as in
 * ServerSendingStatus.test.ts: findOneById answers what the test stored,
 * and every write is caught.
 */

let storedConfig: Record<string, unknown> | null = null;
const findOneById: Mock = jest.fn();
const writeServerSendingHealth: Mock = jest.fn();

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
      forgetServerSendingHealthOf: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Services/ProbeService", () => {
  return {
    __esModule: true,
    default: {
      countBy: jest.fn(),
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
import ServerSendingSettings from "../../../../Server/Utils/ServerSending/ServerSendingSettings";
import GlobalConfig, {
  EmailServerType,
} from "../../../../Models/DatabaseModels/GlobalConfig";
import { CallAndSmsProvider } from "../../../../Types/CallAndSMS/CallAndSmsProvider";
import {
  SERVER_TWILIO_ENVIRONMENT_VARIABLES,
  ServerTwilioEnvironmentVariable,
} from "../../../../Types/CallAndSMS/ServerTwilioEnvironment";
import Phone from "../../../../Types/Phone";
import ServerSendingStatusUtil, {
  ServerChannelStatus,
  ServerSendingChannel,
  ServerSendingHealth,
  ServerSendingHealthEntry,
  ServerSendingSettingsFingerprints,
  ServerSendingState,
} from "../../../../Types/ServerSending/ServerSendingStatus";

const SAVED_ACCOUNT: Record<string, unknown> = {
  twilioAccountSID: "AC11111111111111111111111111111111",
  twilioAuthToken: "saved-auth-token-sentinel-1111",
  twilioPrimaryPhoneNumber: new Phone("+15550001111"),
};

const EMAIL_SET_UP: Record<string, unknown> = {
  emailServerType: EmailServerType.Resend,
  resendApiKey: "re_key",
  resendFromEmail: "alerts@example.com",
};

const GATEWAY: Record<string, unknown> = {
  callAndSmsProvider: CallAndSmsProvider.Gateway,
  callAndSmsGatewayUrl: "https://gateway.example.com/send",
  callAndSmsGatewaySecret: "gateway-secret",
};

const RECENTLY: string = new Date(Date.now() - 5 * 60 * 1000).toISOString();
const YESTERDAY: string = new Date(
  Date.now() - 24 * 60 * 60 * 1000,
).toISOString();

// What the server remembered before there were fingerprints: entries learned with the saved account.
const SMS_FAILING: ServerSendingHealthEntry = {
  lastSucceededAt: YESTERDAY,
  lastFailedAt: RECENTLY,
  failingSince: RECENTLY,
  lastFailure: "Authenticate",
};

const WORKING: ServerSendingHealthEntry = {
  lastSucceededAt: RECENTLY,
  lastFailedAt: null,
  failingSince: null,
  lastFailure: null,
};

function row(
  settings: Record<string, unknown>,
  health?: ServerSendingHealth,
): Record<string, unknown> {
  return {
    ...EMAIL_SET_UP,
    ...SAVED_ACCOUNT,
    ...settings,
    serverSendingHealth: health,
  };
}

function config(): GlobalConfig {
  return Object.assign(new GlobalConfig(), storedConfig);
}

function stateOf(channel: ServerSendingChannel): ServerSendingState {
  return ServerSendingStatus.getStatusFrom(config(), channel).state;
}

function storedHealth(): ServerSendingHealth {
  return ServerSendingStatusUtil.readHealth(
    storedConfig?.["serverSendingHealth"],
  );
}

function fingerprints(): ServerSendingSettingsFingerprints {
  return ServerSendingSettings.getFingerprints(
    ServerSendingChannel.SMS,
    config(),
  )!;
}

const before: Record<string, string | undefined> = {};

// The variables set an account of their own, that sends both.
function setEnvironmentAccount(
  values: Partial<Record<ServerTwilioEnvironmentVariable, string>> = {},
): void {
  const all: Partial<Record<ServerTwilioEnvironmentVariable, string>> = {
    [ServerTwilioEnvironmentVariable.AccountSid]:
      "AC22222222222222222222222222222222",
    [ServerTwilioEnvironmentVariable.AuthToken]:
      "environment-auth-token-sentinel-2222",
    [ServerTwilioEnvironmentVariable.PrimaryPhoneNumber]: "+14155550100",
    ...values,
  };

  for (const [variable, value] of Object.entries(all)) {
    process.env[variable] = value;
  }
}

function unsetEnvironment(): void {
  for (const variable of SERVER_TWILIO_ENVIRONMENT_VARIABLES) {
    delete process.env[variable];
  }
}

beforeEach(() => {
  for (const variable of SERVER_TWILIO_ENVIRONMENT_VARIABLES) {
    before[variable] = process.env[variable];
  }

  unsetEnvironment();
  ServerSendingStatus.clearCache();
  storedConfig = null;
  findOneById.mockReset();
  writeServerSendingHealth.mockReset();

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
  for (const variable of SERVER_TWILIO_ENVIRONMENT_VARIABLES) {
    if (before[variable] === undefined) {
      delete process.env[variable];
    } else {
      process.env[variable] = before[variable];
    }
  }

  jest.useRealTimers();
});

describe("what the server says of SMS and calls when the account changes without a save", () => {
  test("an upgrade alone changes nothing: what was learned with the saved account stays", () => {
    storedConfig = row({}, { sms: SMS_FAILING, call: WORKING });

    expect(stateOf(ServerSendingChannel.SMS)).toBe(ServerSendingState.Failing);
    expect(stateOf(ServerSendingChannel.Call)).toBe(ServerSendingState.Working);
  });

  test("the variables set another account: SMS and calls are untested, email and push as they were", () => {
    storedConfig = row(
      {},
      {
        email: SMS_FAILING,
        sms: SMS_FAILING,
        call: WORKING,
        push: WORKING,
      },
    );

    setEnvironmentAccount();

    const statuses: Array<ServerChannelStatus> =
      ServerSendingStatus.getStatusesFrom(config());

    expect(
      statuses.map((status: ServerChannelStatus) => {
        return [status.channel, status.state];
      }),
    ).toEqual([
      [ServerSendingChannel.Email, ServerSendingState.Failing],
      [ServerSendingChannel.SMS, ServerSendingState.Untested],
      [ServerSendingChannel.Call, ServerSendingState.Untested],
      [ServerSendingChannel.Push, ServerSendingState.Working],
    ]);

    const sms: ServerChannelStatus = statuses[1]!;

    // Nothing of the old account's streak is shown as this one's.
    expect(sms.hasWorked).toBe(false);
    expect(sms.lastWorkedAt).toBeNull();
    expect(sms.failingSince).toBeNull();
    expect(sms.lastFailure).toBeNull();
  });

  test("the first SMS under the variables is written at once, marked as theirs", async () => {
    // The saved account worked minutes ago: not news, had the account not changed.
    storedConfig = row({}, { sms: WORKING });

    setEnvironmentAccount();

    await ServerSendingStatus.recordOutcome({
      channel: ServerSendingChannel.SMS,
      succeeded: true,
    });

    expect(writeServerSendingHealth).toHaveBeenCalledTimes(1);

    const sms: ServerSendingHealthEntry = storedHealth().sms!;

    expect(sms.settingsFingerprint).toBe(fingerprints().current);
    expect(sms.settingsFingerprint).not.toBe(fingerprints().unmarked);
    expect(new Date(sms.lastSucceededAt!).getTime()).toBeGreaterThan(
      new Date(RECENTLY).getTime(),
    );
    expect(stateOf(ServerSendingChannel.SMS)).toBe(ServerSendingState.Working);
  });

  test("a fixed auth token: the old account's failure goes, and the new account's first success shows", async () => {
    storedConfig = row({}, { sms: SMS_FAILING });

    // Before the fix: the saved account's token is wrong.
    expect(stateOf(ServerSendingChannel.SMS)).toBe(ServerSendingState.Failing);

    // The operator sets the account with the variables and restarts.
    setEnvironmentAccount();

    expect(stateOf(ServerSendingChannel.SMS)).toBe(ServerSendingState.Untested);

    await ServerSendingStatus.recordOutcome({
      channel: ServerSendingChannel.SMS,
      succeeded: true,
    });

    expect(stateOf(ServerSendingChannel.SMS)).toBe(ServerSendingState.Working);
  });

  test("a failure under the variables starts its own streak, even for the old account's reason", async () => {
    storedConfig = row({}, { call: { ...SMS_FAILING } });

    setEnvironmentAccount();

    const startedAt: number = Date.now();

    await ServerSendingStatus.recordOutcome({
      channel: ServerSendingChannel.Call,
      succeeded: false,
      reason: "Authenticate",
    });

    expect(writeServerSendingHealth).toHaveBeenCalledTimes(1);

    const call: ServerSendingHealthEntry = storedHealth().call!;

    expect(new Date(call.failingSince!).getTime()).toBeGreaterThanOrEqual(
      startedAt,
    );
    expect(call.lastSucceededAt).toBeNull();
    expect(call.settingsFingerprint).toBe(fingerprints().current);

    const status: ServerChannelStatus = ServerSendingStatus.getStatusFrom(
      config(),
      ServerSendingChannel.Call,
    );

    expect(status.state).toBe(ServerSendingState.Failing);
    // Never worked with this account: a page anybody can open may say so.
    expect(status.hasWorked).toBe(false);
  });

  test("the variables changed again: what was learned with their first account is not the second's", async () => {
    storedConfig = row({});
    setEnvironmentAccount();

    await ServerSendingStatus.recordOutcome({
      channel: ServerSendingChannel.SMS,
      succeeded: true,
    });

    expect(stateOf(ServerSendingChannel.SMS)).toBe(ServerSendingState.Working);

    setEnvironmentAccount({
      [ServerTwilioEnvironmentVariable.AuthToken]: "a-rotated-auth-token",
    });

    expect(stateOf(ServerSendingChannel.SMS)).toBe(ServerSendingState.Untested);
  });

  test("the variables unset: what was learned under them is not the saved account's", async () => {
    storedConfig = row({});
    setEnvironmentAccount();

    await ServerSendingStatus.recordOutcome({
      channel: ServerSendingChannel.Call,
      succeeded: false,
      reason: "busy",
    });

    expect(stateOf(ServerSendingChannel.Call)).toBe(ServerSendingState.Failing);

    unsetEnvironment();

    expect(stateOf(ServerSendingChannel.Call)).toBe(
      ServerSendingState.Untested,
    );
  });

  test("the same news under the same account is still written once an hour, not on every send", async () => {
    storedConfig = row({});
    setEnvironmentAccount();

    for (let i: number = 0; i < 10; i++) {
      await ServerSendingStatus.recordOutcome({
        channel: ServerSendingChannel.SMS,
        succeeded: true,
      });
    }

    expect(writeServerSendingHealth).toHaveBeenCalledTimes(1);
  });

  test("a write keeps the other channels' entries and their marks", async () => {
    const marked: ServerSendingHealthEntry = {
      ...WORKING,
      settingsFingerprint: "c".repeat(64),
    };

    storedConfig = row({}, { email: WORKING, call: marked });
    setEnvironmentAccount();

    await ServerSendingStatus.recordOutcome({
      channel: ServerSendingChannel.SMS,
      succeeded: true,
    });

    expect(storedHealth().email).toEqual(WORKING);
    expect(storedHealth().call).toEqual(marked);
  });

  test("email's news is marked with the email settings, which the Twilio account is no part of (#7803)", async () => {
    storedConfig = row({});

    const email: ServerSendingSettingsFingerprints =
      ServerSendingSettings.getFingerprints(
        ServerSendingChannel.Email,
        config(),
      )!;

    setEnvironmentAccount();

    await ServerSendingStatus.recordOutcome({
      channel: ServerSendingChannel.Email,
      succeeded: true,
    });

    expect(storedHealth().email?.lastSucceededAt).toBeTruthy();
    expect(storedHealth().email?.settingsFingerprint).toBe(email.current);
    expect(stateOf(ServerSendingChannel.Email)).toBe(
      ServerSendingState.Working,
    );
  });

  test("a gateway carries SMS and calls whatever the variables say: what it learned stays", async () => {
    storedConfig = row(GATEWAY, { sms: SMS_FAILING, call: WORKING });

    setEnvironmentAccount();

    expect(stateOf(ServerSendingChannel.SMS)).toBe(ServerSendingState.Failing);
    expect(stateOf(ServerSendingChannel.Call)).toBe(ServerSendingState.Working);

    // Its news within the hour is still not news.
    await ServerSendingStatus.recordOutcome({
      channel: ServerSendingChannel.Call,
      succeeded: true,
    });

    expect(writeServerSendingHealth).not.toHaveBeenCalled();
  });

  test("variables with a problem: not set up, whatever was learned", () => {
    storedConfig = row({}, { sms: WORKING });

    setEnvironmentAccount({
      [ServerTwilioEnvironmentVariable.PrimaryPhoneNumber]: "+1 415 555 CALL",
    });

    const sms: ServerChannelStatus = ServerSendingStatus.getStatusFrom(
      config(),
      ServerSendingChannel.SMS,
    );

    expect(sms.state).toBe(ServerSendingState.NotSetUp);
    expect(sms.setUpProblem).toContain(
      ServerTwilioEnvironmentVariable.PrimaryPhoneNumber,
    );
    expect(sms.hasWorked).toBe(false);
  });

  test("variables that repeat the saved account keep what was learned with it", () => {
    storedConfig = row({}, { sms: SMS_FAILING });

    process.env[ServerTwilioEnvironmentVariable.AccountSid] = SAVED_ACCOUNT[
      "twilioAccountSID"
    ] as string;
    process.env[ServerTwilioEnvironmentVariable.AuthToken] = SAVED_ACCOUNT[
      "twilioAuthToken"
    ] as string;
    process.env[ServerTwilioEnvironmentVariable.PrimaryPhoneNumber] = (
      SAVED_ACCOUNT["twilioPrimaryPhoneNumber"] as Phone
    ).toString();

    expect(stateOf(ServerSendingChannel.SMS)).toBe(ServerSendingState.Failing);
  });
});

describe("what the answers read", () => {
  test("the status reads the settings with what the server remembers, as root", async () => {
    storedConfig = row({}, { sms: SMS_FAILING });
    setEnvironmentAccount();

    const statuses: Array<ServerChannelStatus> =
      await ServerSendingStatus.getStatuses();

    expect(
      statuses.find((status: ServerChannelStatus) => {
        return status.channel === ServerSendingChannel.SMS;
      })?.state,
    ).toBe(ServerSendingState.Untested);

    const args: Record<string, any> = findOneById.mock.calls[0]![0] as Record<
      string,
      any
    >;

    expect(args["props"]).toEqual({ isRoot: true });
    expect(args["select"]["serverSendingHealth"]).toBe(true);
    expect(args["select"]["twilioAuthToken"]).toBe(true);
    expect(args["select"]["callAndSmsProvider"]).toBe(true);
  });

  test("an outcome reads the settings too, so its news is decided for the route it went through", async () => {
    storedConfig = row({});
    setEnvironmentAccount();

    await ServerSendingStatus.recordOutcome({
      channel: ServerSendingChannel.SMS,
      succeeded: true,
    });

    for (const call of findOneById.mock.calls) {
      const args: Record<string, any> = call[0] as Record<string, any>;

      expect(args["select"]["serverSendingHealth"]).toBe(true);
      expect(args["select"]["twilioAccountSID"]).toBe(true);
    }
  });
});
