import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import Project from "../../../Models/DatabaseModels/Project";
import ProjectCallSMSConfig from "../../../Models/DatabaseModels/ProjectCallSMSConfig";
import UserCall from "../../../Models/DatabaseModels/UserCall";
import UserIncomingCallNumber from "../../../Models/DatabaseModels/UserIncomingCallNumber";
import UserSMS from "../../../Models/DatabaseModels/UserSMS";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import ProjectService from "../../../Server/Services/ProjectService";
import UserCallService from "../../../Server/Services/UserCallService";
import UserIncomingCallNumberService from "../../../Server/Services/UserIncomingCallNumberService";
import UserSmsService from "../../../Server/Services/UserSmsService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { TwilioConfigUse } from "../../../Types/CallAndSMS/TwilioConfigUse";
import ObjectID from "../../../Types/ObjectID";
import Phone from "../../../Types/Phone";
import { getProjectBalanceTooLowMessage } from "../../../Utils/Project/ProjectBalance";
import { ProjectNotificationChannel } from "../../../Utils/Project/NotificationChannels";
import { INCOMING_CALL_NUMBER_BALANCE_TOO_LOW_MESSAGE } from "../../../Utils/Project/ProjectBalance";
import {
  getIncomingCallNumberNoTwilioAccountMessage,
  getNoTwilioAccountMessage,
  TwilioMessageKind,
} from "../../../Utils/Project/TwilioAccount";
import { getJestSpyOn } from "../../Spy";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

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

// Billing on, as on OneUptime Cloud, so the balance checks run too.
jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  return { ...actual, IsBillingEnabled: true };
});

/*
 * A PHONE NUMBER'S CODE, WHEN THE PROJECT'S TWILIO CONFIG IS USED FOR SMS
 * ONLY, OR FOR CALLS ONLY.
 *
 * Adding a number sends its code before anything else, and the verify
 * dialog says up front when none can be sent. A project's default config
 * used for SMS only makes no calls: a number for calls gets its code through
 * the server's own account - paid from the project's balance, as without a
 * config - and when the server has none either, the dialog says that the
 * project's config is used for SMS only, and who can change that. The same
 * for SMS, and numbers for incoming calls (verified by SMS), when the
 * project's config is used for calls only.
 *
 * The project's default is read through the real
 * getProjectDefaultTwilioConfig, from a stored config.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "9e000000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("9e000000-0000-4000-8000-000000000002");

const US: string = "+15550001111";
const SG_MOBILE: string = "+6581234567";

function storedConfig(use: TwilioConfigUse): ProjectCallSMSConfig {
  const config: ProjectCallSMSConfig = new ProjectCallSMSConfig();
  config._id = "9e000000-0000-4000-8000-000000000003";
  config.projectId = PROJECT_ID;
  config.usedFor = use;
  config.twilioAccountSID = "AC00000000000000000000000000000009";
  config.twilioAuthToken = "00000000000000000000000000000009";
  config.isProjectDefault = true;

  if (use === TwilioConfigUse.SmsOnly) {
    config.twilioSmsPhoneNumbers = SG_MOBILE;
  } else {
    config.twilioPrimaryPhoneNumber = new Phone(US);
  }

  return config;
}

function serverAccount(isSetUp: boolean): GlobalConfig | null {
  if (!isSetUp) {
    return null;
  }

  return Object.assign(new GlobalConfig(), {
    twilioAccountSID: "AC11111111111111111111111111111111",
    twilioAuthToken: "11111111111111111111111111111111",
    twilioPrimaryPhoneNumber: new Phone("+15550002222"),
  });
}

function stub(options: {
  projectDefault: TwilioConfigUse | null;
  serverAccount: boolean;
  balanceInCents?: number;
}): void {
  const project: Project = new Project();
  project._id = PROJECT_ID.toString();
  project.enableSmsNotifications = true;
  project.enableCallNotifications = true;
  project.smsOrCallCurrentBalanceInUSDCents =
    options.balanceInCents === undefined ? 100000 : options.balanceInCents;

  getJestSpyOn(ProjectService, "findOneById").mockResolvedValue(project);
  getJestSpyOn(ProjectCallSMSConfigService, "findOneBy").mockResolvedValue(
    options.projectDefault ? storedConfig(options.projectDefault) : null,
  );
  getJestSpyOn(GlobalConfigService, "findOneBy").mockResolvedValue(
    serverAccount(options.serverAccount),
  );
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a number for calls, in a project whose config is used for SMS only", () => {
  test("gets its code through the server's own account", async () => {
    stub({ projectDefault: TwilioConfigUse.SmsOnly, serverAccount: true });

    await expect(
      UserCallService.getReasonCodeCannotBeSent(PROJECT_ID),
    ).resolves.toBeNull();
  });

  test("with no server account either, is told the project's config is used for SMS only, and who can change that", async () => {
    stub({ projectDefault: TwilioConfigUse.SmsOnly, serverAccount: false });

    await expect(
      UserCallService.getReasonCodeCannotBeSent(PROJECT_ID),
    ).resolves.toBe(
      getNoTwilioAccountMessage(TwilioMessageKind.Call, {
        projectConfigUse: TwilioConfigUse.SmsOnly,
      }),
    );
    expect(
      getNoTwilioAccountMessage(TwilioMessageKind.Call, {
        projectConfigUse: TwilioConfigUse.SmsOnly,
      }),
    ).toMatch(/^This project's Twilio config is used for SMS only/);
  });

  test("is paid from the balance, so a balance too low refuses it - where a config for calls too would not be", async () => {
    stub({
      projectDefault: TwilioConfigUse.SmsOnly,
      serverAccount: true,
      balanceInCents: 50,
    });

    await expect(
      UserCallService.getReasonCodeCannotBeSent(PROJECT_ID),
    ).resolves.toBe(getProjectBalanceTooLowMessage(ProjectNotificationChannel.Call));

    stub({
      projectDefault: TwilioConfigUse.CallsAndSms,
      serverAccount: true,
      balanceInCents: 50,
    });

    await expect(
      UserCallService.getReasonCodeCannotBeSent(PROJECT_ID),
    ).resolves.toBeNull();
  });

  test("adding one checks the balance the server's account charges", async () => {
    stub({
      projectDefault: TwilioConfigUse.SmsOnly,
      serverAccount: true,
      balanceInCents: 50,
    });

    const call: UserCall = new UserCall();
    call.projectId = PROJECT_ID;
    call.userId = USER_ID;
    call.phone = new Phone("+15551230100");

    await expect(
      (
        UserCallService as unknown as {
          onBeforeCreate: (createBy: CreateBy<UserCall>) => Promise<unknown>;
        }
      ).onBeforeCreate({ data: call, props: { isRoot: true } }),
    ).rejects.toThrow(
      getProjectBalanceTooLowMessage(ProjectNotificationChannel.Call),
    );
  });
});

describe("a number for SMS, in a project whose config is used for calls only", () => {
  test("with no server account, is told the project's config is used for calls only", async () => {
    stub({ projectDefault: TwilioConfigUse.CallsOnly, serverAccount: false });

    await expect(
      UserSmsService.getReasonCodeCannotBeSent(PROJECT_ID),
    ).resolves.toBe(
      getNoTwilioAccountMessage(TwilioMessageKind.SMS, {
        projectConfigUse: TwilioConfigUse.CallsOnly,
      }),
    );
  });

  test("with a server account, gets its code, paid from the balance", async () => {
    stub({ projectDefault: TwilioConfigUse.CallsOnly, serverAccount: true });

    await expect(
      UserSmsService.getReasonCodeCannotBeSent(PROJECT_ID),
    ).resolves.toBeNull();

    stub({
      projectDefault: TwilioConfigUse.CallsOnly,
      serverAccount: true,
      balanceInCents: 50,
    });

    await expect(
      UserSmsService.getReasonCodeCannotBeSent(PROJECT_ID),
    ).resolves.toBe(getProjectBalanceTooLowMessage(ProjectNotificationChannel.SMS));
  });

  test("adding one checks the balance too", async () => {
    stub({
      projectDefault: TwilioConfigUse.CallsOnly,
      serverAccount: true,
      balanceInCents: 50,
    });

    const sms: UserSMS = new UserSMS();
    sms.projectId = PROJECT_ID;
    sms.userId = USER_ID;
    sms.phone = new Phone("+15551230100");

    await expect(
      (
        UserSmsService as unknown as {
          onBeforeCreate: (createBy: CreateBy<UserSMS>) => Promise<unknown>;
        }
      ).onBeforeCreate({ data: sms, props: { isRoot: true } }),
    ).rejects.toThrow(
      getProjectBalanceTooLowMessage(ProjectNotificationChannel.SMS),
    );
  });
});

describe("a number for SMS, in a project whose config is used for SMS only", () => {
  test("gets its code through the project's own config, not paid from the balance", async () => {
    stub({
      projectDefault: TwilioConfigUse.SmsOnly,
      serverAccount: false,
      balanceInCents: 0,
    });

    await expect(
      UserSmsService.getReasonCodeCannotBeSent(PROJECT_ID),
    ).resolves.toBeNull();
    // Nothing asked of the server: the project's own config sends it.
    expect(GlobalConfigService.findOneBy).not.toHaveBeenCalled();
  });
});

describe("a number for incoming calls, verified by SMS", () => {
  test("in a project whose config is used for calls only, with no server account, is told why", async () => {
    stub({ projectDefault: TwilioConfigUse.CallsOnly, serverAccount: false });

    await expect(
      UserIncomingCallNumberService.getReasonCodeCannotBeSent(PROJECT_ID),
    ).resolves.toBe(
      getIncomingCallNumberNoTwilioAccountMessage({
        projectConfigUse: TwilioConfigUse.CallsOnly,
      }),
    );
  });

  test("in a project whose config is used for calls only, its code is paid from the balance", async () => {
    stub({
      projectDefault: TwilioConfigUse.CallsOnly,
      serverAccount: true,
      balanceInCents: 50,
    });

    await expect(
      UserIncomingCallNumberService.getReasonCodeCannotBeSent(PROJECT_ID),
    ).resolves.toBe(INCOMING_CALL_NUMBER_BALANCE_TOO_LOW_MESSAGE);

    const number: UserIncomingCallNumber = new UserIncomingCallNumber();
    number.projectId = PROJECT_ID;
    number.userId = USER_ID;
    number.phone = new Phone("+15551230100");

    await expect(
      (
        UserIncomingCallNumberService as unknown as {
          onBeforeCreate: (
            createBy: CreateBy<UserIncomingCallNumber>,
          ) => Promise<unknown>;
        }
      ).onBeforeCreate({ data: number, props: { isRoot: true } }),
    ).rejects.toThrow(INCOMING_CALL_NUMBER_BALANCE_TOO_LOW_MESSAGE);
  });

  test("in a project whose config is used for SMS only, its code goes through the project's config", async () => {
    stub({ projectDefault: TwilioConfigUse.SmsOnly, serverAccount: false });

    await expect(
      UserIncomingCallNumberService.getReasonCodeCannotBeSent(PROJECT_ID),
    ).resolves.toBeNull();
  });
});

describe("a project whose config is used for calls and SMS - every existing one", () => {
  test("sends every code through it, as before, whatever its balance", async () => {
    for (const service of [
      UserSmsService,
      UserCallService,
      UserIncomingCallNumberService,
    ]) {
      stub({
        projectDefault: TwilioConfigUse.CallsAndSms,
        serverAccount: false,
        balanceInCents: 0,
      });

      await expect(
        (
          service as unknown as {
            getReasonCodeCannotBeSent: (
              projectId: ObjectID,
            ) => Promise<string | null>;
          }
        ).getReasonCodeCannotBeSent(PROJECT_ID),
      ).resolves.toBeNull();
    }
  });
});
