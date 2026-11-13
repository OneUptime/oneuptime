import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import ServerChannelSetup, {
  CALL_NOT_SET_UP_PROBLEM,
  SERVER_TWILIO_ENVIRONMENT_PROBLEM,
  SMS_NOT_SET_UP_PROBLEM,
  ServerChannelSetupSettings,
} from "../../../Server/Utils/ServerSending/ServerChannelSetup";
import {
  getServerTwilioEnvironment,
  toServerTwilioConfig,
} from "../../../Server/Utils/ServerTwilioConfig";
import TwilioAccountAvailability from "../../../Server/Utils/TwilioAccountAvailability";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import { CallAndSmsProvider } from "../../../Types/CallAndSMS/CallAndSmsProvider";
import {
  SERVER_TWILIO_ENVIRONMENT_VARIABLES,
  ServerTwilioEnvironmentVariable,
} from "../../../Types/CallAndSMS/ServerTwilioEnvironment";
import TwilioConfig from "../../../Types/CallAndSMS/TwilioConfig";
import { TwilioConfigUse } from "../../../Types/CallAndSMS/TwilioConfigUse";
import Phone from "../../../Types/Phone";
import { ServerSendingChannel } from "../../../Types/ServerSending/ServerSendingStatus";
import { TwilioMessageKind } from "../../../Utils/Project/TwilioAccount";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Logger", () => {
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

/*
 * THE SERVER'S TWILIO ACCOUNT FROM ENVIRONMENT VARIABLES, AS EVERY SENDER
 * TAKES IT (#7515).
 *
 * The Notification service sends through toServerTwilioConfig, the checks
 * made before a verification code is sent ask TwilioAccountAvailability,
 * and the server's sending status and /admin/setup ask ServerChannelSetup.
 * Once GLOBAL_TWILIO_ACCOUNT_SID is set, all three read the account the
 * GLOBAL_TWILIO_ variables describe, whatever the GlobalConfig row holds;
 * with anything wrong with the variables, none of them sends through the
 * saved account instead - and the status says what is wrong, by the
 * variable's name. Unset, the saved account applies, as it always did.
 */

const SAVED_SID: string = "AC11111111111111111111111111111111";
const SAVED_TOKEN: string = "saved-auth-token-11111111111111";
const SAVED_NUMBER: string = "+15550001111";

const ENV_SID: string = "AC22222222222222222222222222222222";
const ENV_TOKEN: string = "environment-auth-token-sentinel-2222";
const ENV_NUMBER: string = "+14155550100";
const UK: string = "+447700900123";
const SG: string = "+6581234567";

// The account an admin saved in the Admin Dashboard: one that sends both.
function savedAccount(values: Partial<GlobalConfig> = {}): GlobalConfig {
  return Object.assign(
    new GlobalConfig(),
    {
      twilioAccountSID: SAVED_SID,
      twilioAuthToken: SAVED_TOKEN,
      twilioPrimaryPhoneNumber: new Phone(SAVED_NUMBER),
    },
    values,
  );
}

const before: Record<string, string | undefined> = {};

function setEnvironment(
  values: Partial<Record<ServerTwilioEnvironmentVariable, string>>,
): void {
  for (const [variable, value] of Object.entries(values)) {
    process.env[variable] = value;
  }
}

// An account the variables set, that sends both.
function setEnvironmentAccount(
  values: Partial<Record<ServerTwilioEnvironmentVariable, string>> = {},
): void {
  setEnvironment({
    [ServerTwilioEnvironmentVariable.AccountSid]: ENV_SID,
    [ServerTwilioEnvironmentVariable.AuthToken]: ENV_TOKEN,
    [ServerTwilioEnvironmentVariable.PrimaryPhoneNumber]: ENV_NUMBER,
    ...values,
  });
}

let globalConfig: GlobalConfig | null;

beforeEach(() => {
  for (const variable of SERVER_TWILIO_ENVIRONMENT_VARIABLES) {
    before[variable] = process.env[variable];
    delete process.env[variable];
  }

  globalConfig = savedAccount();

  jest
    .spyOn(GlobalConfigService, "findOneBy")
    .mockImplementation(async (): Promise<GlobalConfig | null> => {
      return globalConfig;
    });
});

afterEach(() => {
  for (const variable of SERVER_TWILIO_ENVIRONMENT_VARIABLES) {
    if (before[variable] === undefined) {
      delete process.env[variable];
    } else {
      process.env[variable] = before[variable];
    }
  }

  jest.restoreAllMocks();
});

describe("the account the Notification service sends through", () => {
  test("unset, the one saved in the Admin Dashboard, as before", () => {
    expect(getServerTwilioEnvironment().isSet).toBe(false);
    expect(toServerTwilioConfig(savedAccount())).toEqual({
      accountSid: SAVED_SID,
      authToken: SAVED_TOKEN,
      primaryPhoneNumber: new Phone(SAVED_NUMBER),
      secondaryPhoneNumbers: [],
    });
  });

  test("set, the variables' account, whatever the row holds", () => {
    setEnvironmentAccount({
      [ServerTwilioEnvironmentVariable.SecondaryPhoneNumbers]: `${UK}, ${SG}`,
      [ServerTwilioEnvironmentVariable.SmsPhoneNumbers]: SG,
    });

    const expected: TwilioConfig = {
      accountSid: ENV_SID,
      authToken: ENV_TOKEN,
      primaryPhoneNumber: new Phone(ENV_NUMBER),
      secondaryPhoneNumbers: [new Phone(UK), new Phone(SG)],
      smsPhoneNumbers: [new Phone(SG)],
    };

    expect(toServerTwilioConfig(savedAccount())).toEqual(expected);
    // Nothing saved at all: the variables are still the whole account.
    expect(toServerTwilioConfig(null)).toEqual(expected);
    expect(toServerTwilioConfig(new GlobalConfig())).toEqual(expected);
  });

  test("set, used for what the variables say, never what the row says", () => {
    setEnvironmentAccount({
      [ServerTwilioEnvironmentVariable.UsedFor]: "sms-only",
      [ServerTwilioEnvironmentVariable.PrimaryPhoneNumber]: "",
      [ServerTwilioEnvironmentVariable.SmsPhoneNumbers]: SG,
    });

    const config: TwilioConfig | null = toServerTwilioConfig(
      savedAccount({ twilioUsedFor: TwilioConfigUse.CallsOnly }),
    );

    expect(config?.use).toBe(TwilioConfigUse.SmsOnly);
    expect(config?.primaryPhoneNumber).toBeUndefined();
    expect(config?.smsPhoneNumbers).toEqual([new Phone(SG)]);
  });

  test.each([
    [
      "without its auth token",
      { [ServerTwilioEnvironmentVariable.AuthToken]: "" },
    ],
    [
      "with a number it cannot read",
      { [ServerTwilioEnvironmentVariable.PrimaryPhoneNumber]: "call me" },
    ],
    [
      "with a use it does not know",
      { [ServerTwilioEnvironmentVariable.UsedFor]: "voice" },
    ],
    [
      "with an SMS number it cannot read",
      { [ServerTwilioEnvironmentVariable.SmsPhoneNumbers]: `${SG}, nope` },
    ],
  ] as Array<
    [string, Partial<Record<ServerTwilioEnvironmentVariable, string>>]
  >)(
    "set %s, nothing: never the saved account in its place",
    (
      _case: string,
      values: Partial<Record<ServerTwilioEnvironmentVariable, string>>,
    ) => {
      setEnvironmentAccount(values);

      expect(getServerTwilioEnvironment().isSet).toBe(true);
      expect(toServerTwilioConfig(savedAccount())).toBeNull();
    },
  );

  test("variables set without the account SID are read by nothing: the saved account sends", () => {
    setEnvironment({
      [ServerTwilioEnvironmentVariable.AuthToken]: ENV_TOKEN,
      [ServerTwilioEnvironmentVariable.PrimaryPhoneNumber]: ENV_NUMBER,
    });

    expect(toServerTwilioConfig(savedAccount())?.accountSid).toBe(SAVED_SID);
    expect(toServerTwilioConfig(savedAccount())?.authToken).toBe(SAVED_TOKEN);
  });

  test("read again on every call: nothing it held goes stale", () => {
    expect(toServerTwilioConfig(savedAccount())?.accountSid).toBe(SAVED_SID);

    setEnvironmentAccount();
    expect(toServerTwilioConfig(savedAccount())?.accountSid).toBe(ENV_SID);

    delete process.env[ServerTwilioEnvironmentVariable.AccountSid];
    expect(toServerTwilioConfig(savedAccount())?.accountSid).toBe(SAVED_SID);
  });
});

describe("whether the server's account can send a verification code", () => {
  test("set, by what the variables' account is used for", async () => {
    globalConfig = savedAccount();
    setEnvironmentAccount({
      [ServerTwilioEnvironmentVariable.UsedFor]: "sms-only",
      [ServerTwilioEnvironmentVariable.PrimaryPhoneNumber]: "",
      [ServerTwilioEnvironmentVariable.SmsPhoneNumbers]: SG,
    });

    expect(
      await TwilioAccountAvailability.isServerAccountSetUp(
        TwilioMessageKind.SMS,
      ),
    ).toBe(true);
    // The saved account makes calls; the variables' account does not.
    expect(
      await TwilioAccountAvailability.isServerAccountSetUp(
        TwilioMessageKind.Call,
      ),
    ).toBe(false);
  });

  test("set with a problem, no: the saved account does not stand in", async () => {
    globalConfig = savedAccount();
    setEnvironmentAccount({ [ServerTwilioEnvironmentVariable.AuthToken]: "" });

    expect(await TwilioAccountAvailability.isServerAccountSetUp()).toBe(false);
    expect(
      await TwilioAccountAvailability.isServerAccountSetUp(
        TwilioMessageKind.SMS,
      ),
    ).toBe(false);
  });

  test("set, even with nothing saved", async () => {
    globalConfig = new GlobalConfig();
    setEnvironmentAccount();

    expect(
      await TwilioAccountAvailability.isServerAccountSetUp(
        TwilioMessageKind.Call,
      ),
    ).toBe(true);
  });

  test("a server that sends through its gateway sends both, whatever the variables say", async () => {
    globalConfig = Object.assign(new GlobalConfig(), {
      callAndSmsProvider: CallAndSmsProvider.Gateway,
      callAndSmsGatewayUrl: "https://gateway.example.com/send",
    });
    setEnvironmentAccount({ [ServerTwilioEnvironmentVariable.AuthToken]: "" });

    expect(
      await TwilioAccountAvailability.isServerAccountSetUp(
        TwilioMessageKind.SMS,
      ),
    ).toBe(true);
  });
});

describe("what the server's sending status says SMS and calls are missing", () => {
  test("set with a problem: that the variables' account cannot send, and why, by the variable's name", () => {
    setEnvironmentAccount({
      [ServerTwilioEnvironmentVariable.AuthToken]: "",
      [ServerTwilioEnvironmentVariable.PrimaryPhoneNumber]: "call me",
    });

    const problems: Array<string> = getServerTwilioEnvironment().problems;
    const expected: string = `${SERVER_TWILIO_ENVIRONMENT_PROBLEM} ${problems.join(" ")}`;

    expect(problems).toHaveLength(2);
    for (const kind of [TwilioMessageKind.SMS, TwilioMessageKind.Call]) {
      expect(
        ServerChannelSetup.getTwilioSetUpProblem(savedAccount(), kind),
      ).toBe(expected);
    }
    expect(expected).toContain("GLOBAL_TWILIO_AUTH_TOKEN is not set");
    expect(expected).toContain("GLOBAL_TWILIO_PRIMARY_PHONE_NUMBER");
    // Not "set it up under Settings > Call and SMS": it is not changed there.
    expect(expected).not.toContain("Settings > Call and SMS");
  });

  test("set with a problem, the status never says the auth token", () => {
    setEnvironmentAccount({
      [ServerTwilioEnvironmentVariable.SmsPhoneNumbers]: "nope",
    });

    expect(
      ServerChannelSetup.getSetUpProblem(
        ServerSendingChannel.SMS,
        savedAccount(),
      ),
    ).not.toContain(ENV_TOKEN);
  });

  test("set and usable: both go out, with nothing saved", () => {
    setEnvironmentAccount();

    for (const channel of [
      ServerSendingChannel.SMS,
      ServerSendingChannel.Call,
    ]) {
      expect(ServerChannelSetup.getSetUpProblem(channel, {})).toBeNull();
    }
  });

  test("set for SMS only: SMS go out, and calls say why not", () => {
    setEnvironmentAccount({
      [ServerTwilioEnvironmentVariable.UsedFor]: "sms-only",
      [ServerTwilioEnvironmentVariable.SmsPhoneNumbers]: SG,
    });

    expect(
      ServerChannelSetup.getTwilioSetUpProblem({}, TwilioMessageKind.SMS),
    ).toBeNull();
    expect(
      ServerChannelSetup.getTwilioSetUpProblem({}, TwilioMessageKind.Call),
    ).toBe("This Twilio config is used for SMS only, so it makes no calls.");
  });

  test("the server's gateway carries both, whatever the variables say", () => {
    setEnvironmentAccount({ [ServerTwilioEnvironmentVariable.AuthToken]: "" });

    const gateway: ServerChannelSetupSettings = {
      callAndSmsProvider: CallAndSmsProvider.Gateway,
      callAndSmsGatewayUrl: "https://gateway.example.com/send",
    };

    expect(
      ServerChannelSetup.getSetUpProblem(ServerSendingChannel.SMS, gateway),
    ).toBeNull();
    expect(
      ServerChannelSetup.getSetUpProblem(ServerSendingChannel.Call, gateway),
    ).toBeNull();
  });

  test("variables set without the account SID: the saved account, as before", () => {
    setEnvironment({ [ServerTwilioEnvironmentVariable.AuthToken]: ENV_TOKEN });

    expect(
      ServerChannelSetup.getTwilioSetUpProblem({}, TwilioMessageKind.SMS),
    ).toBe(SMS_NOT_SET_UP_PROBLEM);
    expect(
      ServerChannelSetup.getTwilioSetUpProblem({}, TwilioMessageKind.Call),
    ).toBe(CALL_NOT_SET_UP_PROBLEM);
    expect(
      ServerChannelSetup.getTwilioSetUpProblem(
        savedAccount(),
        TwilioMessageKind.SMS,
      ),
    ).toBeNull();
  });
});
