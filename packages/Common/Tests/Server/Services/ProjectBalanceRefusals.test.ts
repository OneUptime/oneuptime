import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Project from "../../../Models/DatabaseModels/Project";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import UserCall from "../../../Models/DatabaseModels/UserCall";
import UserIncomingCallNumber from "../../../Models/DatabaseModels/UserIncomingCallNumber";
import UserSMS from "../../../Models/DatabaseModels/UserSMS";
import UserTelegram from "../../../Models/DatabaseModels/UserTelegram";
import UserWhatsApp from "../../../Models/DatabaseModels/UserWhatsApp";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import ProjectService from "../../../Server/Services/ProjectService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserCallService from "../../../Server/Services/UserCallService";
import UserIncomingCallNumberService from "../../../Server/Services/UserIncomingCallNumberService";
import UserSmsService from "../../../Server/Services/UserSmsService";
import UserTelegramService from "../../../Server/Services/UserTelegramService";
import UserWhatsAppService from "../../../Server/Services/UserWhatsAppService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import TwilioConfig from "../../../Types/CallAndSMS/TwilioConfig";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Phone from "../../../Types/Phone";
import {
  getProjectNotificationChannelOffMessage,
  ProjectNotificationChannel,
} from "../../../Utils/Project/NotificationChannels";
import {
  getProjectBalanceTooLowMessage,
  INCOMING_CALL_NUMBER_BALANCE_TOO_LOW_MESSAGE,
} from "../../../Utils/Project/ProjectBalance";
import { getJestSpyOn } from "../../Spy";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHAT THE SERVER SAYS WHEN A METHOD'S VERIFICATION CODE CANNOT BE PAID FOR.
 *
 * On OneUptime Cloud a code sent by SMS, call or WhatsApp - and every
 * Telegram message - is paid from the project's balance, so adding one of
 * those methods (or sending its code again) is refused while the balance is
 * 1 USD or less. The refusal used to say "Your SMS balance is low. Please
 * recharge your SMS balance in Project Settings > Notification Settings." -
 * to whoever was adding a number, most of whom may not recharge, and about
 * "SMS" even for a phone call. Each now says what the balance is too low
 * for, and exactly who can add to it, and where
 * (Utils/Project/ProjectBalance).
 *
 * Only the reads are stubbed: each service's own hook decides. Billing is
 * pinned per test - CI runs with it on, a local run with it off - because
 * without billing there is no balance to run low.
 */

type MockBillingGlobal = typeof globalThis & {
  __projectBalanceRefusalsBillingEnabled: boolean;
};

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;
  const mocked: Record<string, unknown> = { ...actual };
  const mockGlobal: MockBillingGlobal = globalThis as MockBillingGlobal;
  mockGlobal.__projectBalanceRefusalsBillingEnabled = true;

  Object.defineProperty(mocked, "IsBillingEnabled", {
    configurable: true,
    enumerable: true,
    get: (): boolean => {
      return mockGlobal.__projectBalanceRefusalsBillingEnabled;
    },
  });

  return mocked;
});

function setBillingEnabled(value: boolean): void {
  (globalThis as MockBillingGlobal).__projectBalanceRefusalsBillingEnabled =
    value;
}

const PROJECT_ID: ObjectID = new ObjectID(
  "7d000000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("7d000000-0000-4000-8000-000000000002");
const ITEM_ID: ObjectID = new ObjectID("7d000000-0000-4000-8000-000000000003");

// The threshold the services refuse at or below: 1 USD.
const LOW_BALANCE_IN_CENTS: number = 100;

type OnBeforeCreate<T extends DatabaseBaseModel> = (
  createBy: CreateBy<T>,
) => Promise<OnCreate<T>>;

function hooksOf<T extends DatabaseBaseModel>(
  service: unknown,
): { onBeforeCreate: OnBeforeCreate<T> } {
  return service as { onBeforeCreate: OnBeforeCreate<T> };
}

// Every channel on, with this much balance.
function projectWithBalance(cents: number): Project {
  const project: Project = new Project();
  project._id = PROJECT_ID.toString();
  project.enableSmsNotifications = true;
  project.enableCallNotifications = true;
  project.enableWhatsAppNotifications = true;
  project.enableTelegramNotifications = true;
  project.smsOrCallCurrentBalanceInUSDCents = cents;
  return project;
}

function readsProject(project: Project): void {
  getJestSpyOn(ProjectService, "findOneById").mockResolvedValue(project);
}

function hasProjectTwilio(config: TwilioConfig | undefined): void {
  getJestSpyOn(
    ProjectCallSMSConfigService,
    "getProjectDefaultTwilioConfig",
  ).mockResolvedValue(config);
}

async function refusalOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(BadDataException);
    return (error as Error).message;
  }

  throw new Error("Expected a refusal, but the call went through.");
}

function createBy<T extends DatabaseBaseModel>(data: T): CreateBy<T> {
  return {
    data: data,
    props: { tenantId: PROJECT_ID, userId: USER_ID },
  } as unknown as CreateBy<T>;
}

/*
 * Every refusal: what the balance is too low for, who can add to it, where -
 * and never "please recharge", "your balance" or "ask an admin".
 */
function expectSaysWhoCanAddBalance(message: string): void {
  expect(message.toLowerCase()).toContain("this project's balance is too low");
  expect(message).toContain(
    "A project owner or someone with Manage Billing can add balance in Project Settings > Notification Settings.",
  );
  expect(message).not.toMatch(/please/i);
  expect(message).not.toMatch(/\brecharge\b/i);
  expect(message).not.toMatch(/\byour\b/i);
  expect(message.toLowerCase()).not.toContain("admin");
}

function sms(): UserSMS {
  const row: UserSMS = new UserSMS();
  row.projectId = PROJECT_ID;
  row.userId = USER_ID;
  row.phone = new Phone("+15551230200");
  return row;
}

function call(): UserCall {
  const row: UserCall = new UserCall();
  row.projectId = PROJECT_ID;
  row.userId = USER_ID;
  row.phone = new Phone("+15551230201");
  return row;
}

function whatsApp(): UserWhatsApp {
  const row: UserWhatsApp = new UserWhatsApp();
  row.projectId = PROJECT_ID;
  row.userId = USER_ID;
  row.phone = new Phone("+15551230202");
  return row;
}

function telegram(): UserTelegram {
  const row: UserTelegram = new UserTelegram();
  row.projectId = PROJECT_ID;
  row.userId = USER_ID;
  return row;
}

function incoming(): UserIncomingCallNumber {
  const row: UserIncomingCallNumber = new UserIncomingCallNumber();
  row.projectId = PROJECT_ID;
  row.userId = USER_ID;
  row.phone = new Phone("+15551230203");
  return row;
}

beforeEach(() => {
  setBillingEnabled(true);
  stubProjectDirectory({});
  hasProjectTwilio(undefined);
  // Telegram's hook checks the adder belongs to the project.
  getJestSpyOn(TeamMemberService, "findOneBy").mockResolvedValue({
    _id: "7d000000-0000-4000-8000-000000000009",
  } as TeamMember);
  // Incoming call numbers: one verified number per person.
  getJestSpyOn(UserIncomingCallNumberService, "findOneBy").mockResolvedValue(
    null,
  );
});

afterEach(() => {
  jest.restoreAllMocks();
  setBillingEnabled(true);
});

describe("adding a phone number for SMS", () => {
  test("is refused at 1 USD or less, naming who can add balance", async () => {
    readsProject(projectWithBalance(LOW_BALANCE_IN_CENTS));

    const message: string = await refusalOf(
      hooksOf<UserSMS>(UserSmsService).onBeforeCreate(createBy(sms())),
    );

    expect(message).toBe(
      getProjectBalanceTooLowMessage(ProjectNotificationChannel.SMS),
    );
    expect(message).toBe(
      "This project's balance is too low to send SMS. A project owner or someone with Manage Billing can add balance in Project Settings > Notification Settings.",
    );
    expectSaysWhoCanAddBalance(message);
  });

  test("is refused with nothing left at all", async () => {
    readsProject(projectWithBalance(0));

    expect(
      await refusalOf(
        hooksOf<UserSMS>(UserSmsService).onBeforeCreate(createBy(sms())),
      ),
    ).toBe(getProjectBalanceTooLowMessage(ProjectNotificationChannel.SMS));
  });

  test("goes ahead with more than 1 USD", async () => {
    readsProject(projectWithBalance(LOW_BALANCE_IN_CENTS + 1));

    const result: OnCreate<UserSMS> = await hooksOf<UserSMS>(
      UserSmsService,
    ).onBeforeCreate(createBy(sms()));

    expect(result.createBy.data.phone?.toString()).toBe("+15551230200");
  });

  test("goes ahead whatever the balance when the project's own Twilio account pays", async () => {
    readsProject(projectWithBalance(0));
    hasProjectTwilio({ accountSid: "AC1" } as unknown as TwilioConfig);

    await expect(
      hooksOf<UserSMS>(UserSmsService).onBeforeCreate(createBy(sms())),
    ).resolves.toBeDefined();
  });

  test("goes ahead whatever the balance where OneUptime does not bill", async () => {
    setBillingEnabled(false);
    readsProject(projectWithBalance(0));

    await expect(
      hooksOf<UserSMS>(UserSmsService).onBeforeCreate(createBy(sms())),
    ).resolves.toBeDefined();
  });

  test("with SMS also off, says SMS is off first - turning it on comes before paying for it", async () => {
    const project: Project = projectWithBalance(0);
    project.enableSmsNotifications = false;
    readsProject(project);

    expect(
      await refusalOf(
        hooksOf<UserSMS>(UserSmsService).onBeforeCreate(createBy(sms())),
      ),
    ).toBe(
      getProjectNotificationChannelOffMessage(ProjectNotificationChannel.SMS),
    );
  });

  test("sending its code again is refused the same way", async () => {
    const row: UserSMS = sms();
    row._id = ITEM_ID.toString();
    row.isVerified = false;
    getJestSpyOn(UserSmsService, "findOneById").mockResolvedValue(row);
    readsProject(projectWithBalance(LOW_BALANCE_IN_CENTS));

    const message: string = await refusalOf(
      UserSmsService.resendVerificationCode(ITEM_ID),
    );

    expect(message).toBe(
      getProjectBalanceTooLowMessage(ProjectNotificationChannel.SMS),
    );
    expectSaysWhoCanAddBalance(message);
  });
});

describe("adding a phone number for calls", () => {
  test("is refused at 1 USD or less - about calls, not SMS", async () => {
    readsProject(projectWithBalance(LOW_BALANCE_IN_CENTS));

    const message: string = await refusalOf(
      hooksOf<UserCall>(UserCallService).onBeforeCreate(createBy(call())),
    );

    expect(message).toBe(
      "This project's balance is too low to make phone calls. A project owner or someone with Manage Billing can add balance in Project Settings > Notification Settings.",
    );
    expect(message).not.toContain("SMS");
    expectSaysWhoCanAddBalance(message);
  });

  test("goes ahead with more than 1 USD", async () => {
    readsProject(projectWithBalance(LOW_BALANCE_IN_CENTS + 1));

    await expect(
      hooksOf<UserCall>(UserCallService).onBeforeCreate(createBy(call())),
    ).resolves.toBeDefined();
  });

  test("goes ahead whatever the balance when the project's own Twilio account pays", async () => {
    readsProject(projectWithBalance(0));
    hasProjectTwilio({ accountSid: "AC1" } as unknown as TwilioConfig);

    await expect(
      hooksOf<UserCall>(UserCallService).onBeforeCreate(createBy(call())),
    ).resolves.toBeDefined();
  });

  test("calling with its code again is refused the same way", async () => {
    const row: UserCall = call();
    row._id = ITEM_ID.toString();
    row.isVerified = false;
    getJestSpyOn(UserCallService, "findOneById").mockResolvedValue(row);
    readsProject(projectWithBalance(0));

    expect(
      await refusalOf(UserCallService.resendVerificationCode(ITEM_ID)),
    ).toBe(getProjectBalanceTooLowMessage(ProjectNotificationChannel.Call));
  });
});

describe("adding a WhatsApp number", () => {
  test("is refused at 1 USD or less, naming who can add balance", async () => {
    readsProject(projectWithBalance(LOW_BALANCE_IN_CENTS));

    const message: string = await refusalOf(
      hooksOf<UserWhatsApp>(UserWhatsAppService).onBeforeCreate(
        createBy(whatsApp()),
      ),
    );

    expect(message).toBe(
      "This project's balance is too low to send WhatsApp messages. A project owner or someone with Manage Billing can add balance in Project Settings > Notification Settings.",
    );
    expectSaysWhoCanAddBalance(message);
  });

  test("goes ahead with more than 1 USD, or where OneUptime does not bill", async () => {
    readsProject(projectWithBalance(LOW_BALANCE_IN_CENTS + 1));

    await expect(
      hooksOf<UserWhatsApp>(UserWhatsAppService).onBeforeCreate(
        createBy(whatsApp()),
      ),
    ).resolves.toBeDefined();

    setBillingEnabled(false);
    readsProject(projectWithBalance(0));

    await expect(
      hooksOf<UserWhatsApp>(UserWhatsAppService).onBeforeCreate(
        createBy(whatsApp()),
      ),
    ).resolves.toBeDefined();
  });
});

describe("linking a Telegram account", () => {
  test("is refused at 1 USD or less, naming who can add balance", async () => {
    readsProject(projectWithBalance(LOW_BALANCE_IN_CENTS));

    const message: string = await refusalOf(
      hooksOf<UserTelegram>(UserTelegramService).onBeforeCreate(
        createBy(telegram()),
      ),
    );

    expect(message).toBe(
      "This project's balance is too low to send Telegram messages. A project owner or someone with Manage Billing can add balance in Project Settings > Notification Settings.",
    );
    expectSaysWhoCanAddBalance(message);
  });

  test("goes ahead with more than 1 USD", async () => {
    readsProject(projectWithBalance(LOW_BALANCE_IN_CENTS + 1));

    await expect(
      hooksOf<UserTelegram>(UserTelegramService).onBeforeCreate(
        createBy(telegram()),
      ),
    ).resolves.toBeDefined();
  });
});

describe("adding a number for incoming calls", () => {
  test("is refused at 1 USD or less: the number is verified by SMS - and says who can add balance", async () => {
    readsProject(projectWithBalance(LOW_BALANCE_IN_CENTS));

    const message: string = await refusalOf(
      hooksOf<UserIncomingCallNumber>(
        UserIncomingCallNumberService,
      ).onBeforeCreate(createBy(incoming())),
    );

    expect(message).toBe(INCOMING_CALL_NUMBER_BALANCE_TOO_LOW_MESSAGE);
    expect(message).toContain("verified by SMS");
    expectSaysWhoCanAddBalance(message);
  });

  test("goes ahead whatever the balance when the project's own Twilio account pays", async () => {
    readsProject(projectWithBalance(0));
    hasProjectTwilio({ accountSid: "AC1" } as unknown as TwilioConfig);

    await expect(
      hooksOf<UserIncomingCallNumber>(
        UserIncomingCallNumberService,
      ).onBeforeCreate(createBy(incoming())),
    ).resolves.toBeDefined();
  });

  test("sending its code again is refused the same way", async () => {
    const row: UserIncomingCallNumber = incoming();
    row._id = ITEM_ID.toString();
    row.isVerified = false;
    getJestSpyOn(
      UserIncomingCallNumberService,
      "findOneById",
    ).mockResolvedValue(row);
    readsProject(projectWithBalance(LOW_BALANCE_IN_CENTS));

    expect(
      await refusalOf(
        UserIncomingCallNumberService.resendVerificationCode(ITEM_ID),
      ),
    ).toBe(INCOMING_CALL_NUMBER_BALANCE_TOO_LOW_MESSAGE);
  });
});
