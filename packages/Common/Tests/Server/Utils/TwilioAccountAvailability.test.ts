import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import TwilioAccountAvailability from "../../../Server/Utils/TwilioAccountAvailability";
import TwilioConfig from "../../../Types/CallAndSMS/TwilioConfig";
import ObjectID from "../../../Types/ObjectID";
import Phone from "../../../Types/Phone";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
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
 * Whether an SMS or a call to a project's members has a Twilio account to go
 * through: the project's default config, or the server's own. The channel
 * services ask before they send a verification code, so one that cannot go
 * anywhere is refused with the reason instead of failing in the background.
 * It has to agree with the Notification service, which counts the server's
 * account only once its account SID, auth token and number are all filled in.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "7e000000-0000-4000-8000-000000000001",
);

const PROJECT_TWILIO_CONFIG: TwilioConfig = {
  accountSid: "AC00000000000000000000000000000007",
  authToken: "00000000000000000000000000000007",
  primaryPhoneNumber: new Phone("+15550001111"),
  secondaryPhoneNumbers: [],
};

let globalConfig: GlobalConfig | null;
let projectDefault: TwilioConfig | undefined;

const serverAccount: (values: {
  twilioAccountSID?: string | undefined;
  twilioAuthToken?: string | undefined;
  twilioPrimaryPhoneNumber?: Phone | undefined;
}) => GlobalConfig = (values: {
  twilioAccountSID?: string | undefined;
  twilioAuthToken?: string | undefined;
  twilioPrimaryPhoneNumber?: Phone | undefined;
}): GlobalConfig => {
  const config: GlobalConfig = new GlobalConfig();

  if (values.twilioAccountSID) {
    config.twilioAccountSID = values.twilioAccountSID;
  }

  if (values.twilioAuthToken) {
    config.twilioAuthToken = values.twilioAuthToken;
  }

  if (values.twilioPrimaryPhoneNumber) {
    config.twilioPrimaryPhoneNumber = values.twilioPrimaryPhoneNumber;
  }

  return config;
};

const FULL_SERVER_ACCOUNT: {
  twilioAccountSID: string;
  twilioAuthToken: string;
  twilioPrimaryPhoneNumber: Phone;
} = {
  twilioAccountSID: "AC11111111111111111111111111111111",
  twilioAuthToken: "11111111111111111111111111111111",
  twilioPrimaryPhoneNumber: new Phone("+15550002222"),
};

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

describe("the server's own Twilio account", () => {
  test("counts once its account SID, auth token and number are all filled in", async () => {
    globalConfig = serverAccount(FULL_SERVER_ACCOUNT);

    expect(await TwilioAccountAvailability.isServerAccountSetUp()).toBe(true);
  });

  test.each([
    ["the account SID", { ...FULL_SERVER_ACCOUNT, twilioAccountSID: "" }],
    ["the auth token", { ...FULL_SERVER_ACCOUNT, twilioAuthToken: "" }],
    [
      "the number to send from",
      { ...FULL_SERVER_ACCOUNT, twilioPrimaryPhoneNumber: undefined },
    ],
  ])("does not count without %s", async (_missing: string, values: object) => {
    globalConfig = serverAccount(values);

    expect(await TwilioAccountAvailability.isServerAccountSetUp()).toBe(false);
  });

  test("does not count on a server with no settings row", async () => {
    globalConfig = null;

    expect(await TwilioAccountAvailability.isServerAccountSetUp()).toBe(false);
  });

  test("is read as OneUptime, from the one settings row", async () => {
    await TwilioAccountAvailability.isServerAccountSetUp();

    const query: { query: { _id: string }; props: { isRoot: boolean } } = (
      GlobalConfigService.findOneBy as unknown as jest.Mock
    ).mock.calls[0]![0] as {
      query: { _id: string };
      props: { isRoot: boolean };
    };

    expect(query.query._id).toBe(ObjectID.getZeroObjectID().toString());
    expect(query.props.isRoot).toBe(true);
  });
});

describe("an account for a project", () => {
  test("the project's own default config is enough, without asking about the server's", async () => {
    projectDefault = PROJECT_TWILIO_CONFIG;

    expect(
      await TwilioAccountAvailability.isAccountAvailableForProject({
        projectId: PROJECT_ID,
      }),
    ).toBe(true);
    expect(GlobalConfigService.findOneBy).not.toHaveBeenCalled();
  });

  test("without one, the server's account is used", async () => {
    globalConfig = serverAccount(FULL_SERVER_ACCOUNT);

    expect(
      await TwilioAccountAvailability.isAccountAvailableForProject({
        projectId: PROJECT_ID,
      }),
    ).toBe(true);
  });

  test("with neither, there is no account - the self-hosted server nobody has set Twilio up on", async () => {
    expect(
      await TwilioAccountAvailability.isAccountAvailableForProject({
        projectId: PROJECT_ID,
      }),
    ).toBe(false);
  });

  test("a project default the caller already read is not read again", async () => {
    expect(
      await TwilioAccountAvailability.isAccountAvailableForProject({
        projectId: PROJECT_ID,
        projectDefaultTwilioConfig: PROJECT_TWILIO_CONFIG,
      }),
    ).toBe(true);
    expect(
      ProjectCallSMSConfigService.getProjectDefaultTwilioConfig,
    ).not.toHaveBeenCalled();
  });
});
