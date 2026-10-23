import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import TwilioAccountAvailability from "../../../Server/Utils/TwilioAccountAvailability";
import { toServerTwilioConfig } from "../../../Server/Utils/ServerTwilioConfig";
import TwilioConfig from "../../../Types/CallAndSMS/TwilioConfig";
import { TwilioConfigUse } from "../../../Types/CallAndSMS/TwilioConfigUse";
import ObjectID from "../../../Types/ObjectID";
import Phone from "../../../Types/Phone";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
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
 * WHETHER AN SMS OR A CALL HAS AN ACCOUNT TO GO THROUGH, BY WHAT EACH
 * ACCOUNT IS USED FOR.
 *
 * A config - a project's, or the server's own - used for SMS only makes no
 * calls, and one used for calls only sends no SMS
 * (Types/CallAndSMS/TwilioConfigUse). So whether a verification code can be
 * sent is asked of one kind of message: a project whose default is used for
 * SMS only has an account for its SMS, and for its calls only the server's.
 * The server's own account is read as the Notification service reads it
 * (ServerTwilioConfig), so the two agree.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "7f000000-0000-4000-8000-000000000001",
);

const US: string = "+15550002222";
const SG_MOBILE: string = "+6581234567";

let globalConfig: GlobalConfig | null;
let projectDefault: TwilioConfig | undefined;

function serverAccount(values: Partial<GlobalConfig>): GlobalConfig {
  return Object.assign(
    new GlobalConfig(),
    {
      twilioAccountSID: "AC11111111111111111111111111111111",
      twilioAuthToken: "11111111111111111111111111111111",
    },
    values,
  );
}

function projectConfig(
  use: TwilioConfigUse | undefined,
  numbers: { primary?: string; sms?: Array<string> },
): TwilioConfig {
  const config: TwilioConfig = {
    accountSid: "AC00000000000000000000000000000007",
    authToken: "00000000000000000000000000000007",
    secondaryPhoneNumbers: [],
  };

  if (use) {
    config.use = use;
  }

  if (numbers.primary) {
    config.primaryPhoneNumber = new Phone(numbers.primary);
  }

  if (numbers.sms) {
    config.smsPhoneNumbers = numbers.sms.map((phone: string): Phone => {
      return new Phone(phone);
    });
  }

  return config;
}

beforeEach(() => {
  globalConfig = null;
  projectDefault = undefined;

  jest
    .spyOn(GlobalConfigService, "findOneBy")
    .mockImplementation(async (): Promise<GlobalConfig | null> => {
      return globalConfig;
    });

  jest
    .spyOn(ProjectCallSMSConfigService, "getProjectDefaultTwilioConfig")
    .mockImplementation(async (): Promise<TwilioConfig | undefined> => {
      return projectDefault;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the server's own account, as the senders take it", () => {
  test("used for calls and SMS - every installation's, as before - needs its number", () => {
    expect(
      toServerTwilioConfig(
        serverAccount({ twilioPrimaryPhoneNumber: new Phone(US) }),
      ),
    ).toEqual({
      accountSid: "AC11111111111111111111111111111111",
      authToken: "11111111111111111111111111111111",
      primaryPhoneNumber: new Phone(US),
      secondaryPhoneNumbers: [],
    });
    expect(toServerTwilioConfig(serverAccount({}))).toBeNull();
  });

  test("used for SMS only, needs SMS numbers and no number to make calls from", () => {
    const config: TwilioConfig | null = toServerTwilioConfig(
      serverAccount({
        twilioUsedFor: TwilioConfigUse.SmsOnly,
        twilioSmsPhoneNumbers: SG_MOBILE,
      }),
    );

    expect(config?.use).toBe(TwilioConfigUse.SmsOnly);
    expect(config?.primaryPhoneNumber).toBeUndefined();
    expect(config?.smsPhoneNumbers?.map(String)).toEqual([SG_MOBILE]);
    expect(
      toServerTwilioConfig(
        serverAccount({
          twilioUsedFor: TwilioConfigUse.SmsOnly,
          twilioPrimaryPhoneNumber: new Phone(US),
        }),
      ),
    ).toBeNull();
  });

  test("used for calls only, needs its number", () => {
    expect(
      toServerTwilioConfig(
        serverAccount({
          twilioUsedFor: TwilioConfigUse.CallsOnly,
          twilioPrimaryPhoneNumber: new Phone(US),
        }),
      )?.use,
    ).toBe(TwilioConfigUse.CallsOnly);
    expect(
      toServerTwilioConfig(
        serverAccount({
          twilioUsedFor: TwilioConfigUse.CallsOnly,
          twilioSmsPhoneNumbers: SG_MOBILE,
        }),
      ),
    ).toBeNull();
  });

  test("without its account SID or token, is no account", () => {
    expect(toServerTwilioConfig(null)).toBeNull();
    expect(
      toServerTwilioConfig(
        serverAccount({
          twilioAccountSID: "",
          twilioPrimaryPhoneNumber: new Phone(US),
        }),
      ),
    ).toBeNull();
    expect(
      toServerTwilioConfig(
        serverAccount({
          twilioAuthToken: "",
          twilioUsedFor: TwilioConfigUse.SmsOnly,
          twilioSmsPhoneNumbers: SG_MOBILE,
        }),
      ),
    ).toBeNull();
  });
});

describe("whether the server's account is set up, for one kind of message", () => {
  test.each([
    [TwilioConfigUse.CallsAndSms, true, true],
    [TwilioConfigUse.SmsOnly, true, false],
    [TwilioConfigUse.CallsOnly, false, true],
  ] as Array<[TwilioConfigUse, boolean, boolean]>)(
    "used for %s: SMS %s, calls %s",
    async (use: TwilioConfigUse, sms: boolean, calls: boolean) => {
      globalConfig = serverAccount({
        twilioUsedFor: use,
        twilioPrimaryPhoneNumber: new Phone(US),
        twilioSmsPhoneNumbers: SG_MOBILE,
      });

      expect(
        await TwilioAccountAvailability.isServerAccountSetUp(
          TwilioMessageKind.SMS,
        ),
      ).toBe(sms);
      expect(
        await TwilioAccountAvailability.isServerAccountSetUp(
          TwilioMessageKind.Call,
        ),
      ).toBe(calls);
      // Set up at all.
      expect(await TwilioAccountAvailability.isServerAccountSetUp()).toBe(true);
    },
  );

  test("an account whose stored list cannot be read still counts: the send says what is wrong", async () => {
    globalConfig = serverAccount({
      twilioPrimaryPhoneNumber: new Phone(US),
      twilioSecondaryPhoneNumbers: "not a number",
    });

    expect(
      await TwilioAccountAvailability.isServerAccountSetUp(
        TwilioMessageKind.Call,
      ),
    ).toBe(true);
  });
});

describe("whether a project's message has an account", () => {
  test("a default used for SMS only covers its SMS without asking the server", async () => {
    projectDefault = projectConfig(TwilioConfigUse.SmsOnly, {
      sms: [SG_MOBILE],
    });

    expect(
      await TwilioAccountAvailability.isAccountAvailableForProject({
        projectId: PROJECT_ID,
        kind: TwilioMessageKind.SMS,
      }),
    ).toBe(true);
    expect(GlobalConfigService.findOneBy).not.toHaveBeenCalled();
  });

  test("a default used for SMS only does not cover its calls: only the server's account can", async () => {
    projectDefault = projectConfig(TwilioConfigUse.SmsOnly, {
      sms: [SG_MOBILE],
    });

    expect(
      await TwilioAccountAvailability.isAccountAvailableForProject({
        projectId: PROJECT_ID,
        kind: TwilioMessageKind.Call,
      }),
    ).toBe(false);

    globalConfig = serverAccount({ twilioPrimaryPhoneNumber: new Phone(US) });

    expect(
      await TwilioAccountAvailability.isAccountAvailableForProject({
        projectId: PROJECT_ID,
        kind: TwilioMessageKind.Call,
      }),
    ).toBe(true);
  });

  test("a default used for calls only does not cover its SMS - nor does a server account used for calls only", async () => {
    projectDefault = projectConfig(TwilioConfigUse.CallsOnly, {
      primary: US,
    });
    globalConfig = serverAccount({
      twilioUsedFor: TwilioConfigUse.CallsOnly,
      twilioPrimaryPhoneNumber: new Phone(US),
    });

    expect(
      await TwilioAccountAvailability.isAccountAvailableForProject({
        projectId: PROJECT_ID,
        kind: TwilioMessageKind.SMS,
      }),
    ).toBe(false);
    expect(
      await TwilioAccountAvailability.isAccountAvailableForProject({
        projectId: PROJECT_ID,
        kind: TwilioMessageKind.Call,
      }),
    ).toBe(true);
  });

  test("a default the caller already read counts only for the kinds it sends", async () => {
    const smsOnly: TwilioConfig = projectConfig(TwilioConfigUse.SmsOnly, {
      sms: [SG_MOBILE],
    });

    expect(
      await TwilioAccountAvailability.isAccountAvailableForProject({
        projectId: PROJECT_ID,
        kind: TwilioMessageKind.SMS,
        projectDefaultTwilioConfig: smsOnly,
      }),
    ).toBe(true);
    expect(
      ProjectCallSMSConfigService.getProjectDefaultTwilioConfig,
    ).not.toHaveBeenCalled();
    expect(
      await TwilioAccountAvailability.isAccountAvailableForProject({
        projectId: PROJECT_ID,
        kind: TwilioMessageKind.Call,
        projectDefaultTwilioConfig: smsOnly,
      }),
    ).toBe(false);
  });
});
