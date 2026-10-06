import Project from "../../../Models/DatabaseModels/Project";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageSubscriber from "../../../Models/DatabaseModels/StatusPageSubscriber";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import UserCall from "../../../Models/DatabaseModels/UserCall";
import UserIncomingCallNumber from "../../../Models/DatabaseModels/UserIncomingCallNumber";
import UserSMS from "../../../Models/DatabaseModels/UserSMS";
import UserTelegram from "../../../Models/DatabaseModels/UserTelegram";
import UserWhatsApp from "../../../Models/DatabaseModels/UserWhatsApp";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import ProjectService from "../../../Server/Services/ProjectService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import StatusPageSubscriberService, {
  SMS_SIGN_UP_UNAVAILABLE_MESSAGE,
} from "../../../Server/Services/StatusPageSubscriberService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import UserCallService from "../../../Server/Services/UserCallService";
import UserIncomingCallNumberService from "../../../Server/Services/UserIncomingCallNumberService";
import UserSmsService from "../../../Server/Services/UserSmsService";
import UserTelegramService from "../../../Server/Services/UserTelegramService";
import UserWhatsAppService from "../../../Server/Services/UserWhatsAppService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Phone from "../../../Types/Phone";
import {
  getProjectNotificationChannelOffMessage,
  INCOMING_CALL_NUMBER_SMS_OFF_MESSAGE,
  ProjectNotificationChannel,
  STATUS_PAGE_SMS_SUBSCRIPTIONS_SMS_OFF_MESSAGE,
} from "../../../Utils/Project/NotificationChannels";
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
 * WHAT THE SERVER SAYS WHEN SOMETHING NEEDS A CHANNEL THE PROJECT HAS OFF.
 *
 * A project's SMS, phone calls, WhatsApp and Telegram start off, and only a
 * project owner or someone with Manage Billing may turn one on. The refusals
 * used to say "SMS notifications are disabled for this project. Please
 * enable them in Project Settings > Notification Settings." - to whoever
 * asked, most of whom may not. Each now says what is off and exactly who can
 * turn it on, and where (Utils/Project/NotificationChannels), and a visitor
 * signing up on a status page is told nothing about project settings at all.
 *
 * Only the reads are stubbed: each service's own hook decides.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5a000000-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("5a000000-0000-4000-8000-000000000002");
const ITEM_ID: ObjectID = new ObjectID("5a000000-0000-4000-8000-000000000003");
const STATUS_PAGE_ID: ObjectID = new ObjectID(
  "5a000000-0000-4000-8000-000000000004",
);

type OnBeforeCreate<T> = (createBy: CreateBy<T>) => Promise<OnCreate<T>>;

function hooksOf<T>(service: unknown): { onBeforeCreate: OnBeforeCreate<T> } {
  return service as { onBeforeCreate: OnBeforeCreate<T> };
}

// The project row each refusal reads: every channel on but the one named.
function projectWithOff(channel: ProjectNotificationChannel): Project {
  const project: Project = new Project();
  project._id = PROJECT_ID.toString();
  project.enableSmsNotifications = channel !== ProjectNotificationChannel.SMS;
  project.enableCallNotifications = channel !== ProjectNotificationChannel.Call;
  project.enableWhatsAppNotifications =
    channel !== ProjectNotificationChannel.WhatsApp;
  project.enableTelegramNotifications =
    channel !== ProjectNotificationChannel.Telegram;
  project.smsOrCallCurrentBalanceInUSDCents = 100000;
  return project;
}

function readsProject(project: Project): void {
  getJestSpyOn(ProjectService, "findOneById").mockResolvedValue(project);
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

function createBy<T>(data: T): CreateBy<T> {
  return {
    data: data,
    props: { tenantId: PROJECT_ID, userId: USER_ID },
  } as unknown as CreateBy<T>;
}

// Every refusal: who can, where - and never "ask an admin" or "enable them".
function expectSaysWhoCan(message: string): void {
  expect(message).toContain("A project owner or someone with Manage Billing");
  expect(message).toContain("Project Settings > Notification Settings");
  expect(message.toLowerCase()).not.toContain("admin");
  expect(message).not.toMatch(/please enable/i);
}

beforeEach(() => {
  stubProjectDirectory({});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("adding a phone number for SMS", () => {
  function sms(): UserSMS {
    const row: UserSMS = new UserSMS();
    row.projectId = PROJECT_ID;
    row.userId = USER_ID;
    row.phone = new Phone("+15551230100");
    return row;
  }

  test("is refused while SMS is off, naming who can turn it on", async () => {
    readsProject(projectWithOff(ProjectNotificationChannel.SMS));

    const message: string = await refusalOf(
      hooksOf<UserSMS>(UserSmsService).onBeforeCreate(createBy(sms())),
    );

    expect(message).toBe(
      getProjectNotificationChannelOffMessage(ProjectNotificationChannel.SMS),
    );
    expect(message).toBe(
      "SMS is off in this project. A project owner or someone with Manage Billing can turn it on in Project Settings > Notification Settings.",
    );
    expectSaysWhoCan(message);
  });

  test("goes ahead once SMS is on", async () => {
    const project: Project = projectWithOff(ProjectNotificationChannel.Call);
    readsProject(project);
    getJestSpyOn(
      ProjectCallSMSConfigService,
      "getProjectDefaultTwilioConfig",
    ).mockResolvedValue(undefined);

    const result: OnCreate<UserSMS> = await hooksOf<UserSMS>(
      UserSmsService,
    ).onBeforeCreate(createBy(sms()));

    expect(result.createBy.data.phone?.toString()).toBe("+15551230100");
  });

  test("sending its code again is refused the same way", async () => {
    const row: UserSMS = sms();
    row._id = ITEM_ID.toString();
    row.isVerified = false;
    getJestSpyOn(UserSmsService, "findOneById").mockResolvedValue(row);
    readsProject(projectWithOff(ProjectNotificationChannel.SMS));

    const message: string = await refusalOf(
      UserSmsService.resendVerificationCode(ITEM_ID),
    );

    expect(message).toBe(
      getProjectNotificationChannelOffMessage(ProjectNotificationChannel.SMS),
    );
  });
});

describe("adding a phone number for calls", () => {
  function call(): UserCall {
    const row: UserCall = new UserCall();
    row.projectId = PROJECT_ID;
    row.userId = USER_ID;
    row.phone = new Phone("+15551230199");
    return row;
  }

  test("is refused while calls are off - 'them', for phone calls", async () => {
    readsProject(projectWithOff(ProjectNotificationChannel.Call));

    const message: string = await refusalOf(
      hooksOf<UserCall>(UserCallService).onBeforeCreate(createBy(call())),
    );

    expect(message).toBe(
      "Phone calls are off in this project. A project owner or someone with Manage Billing can turn them on in Project Settings > Notification Settings.",
    );
    expectSaysWhoCan(message);
  });

  test("calling with its code again is refused the same way", async () => {
    const row: UserCall = call();
    row._id = ITEM_ID.toString();
    row.isVerified = false;
    getJestSpyOn(UserCallService, "findOneById").mockResolvedValue(row);
    readsProject(projectWithOff(ProjectNotificationChannel.Call));

    const message: string = await refusalOf(
      UserCallService.resendVerificationCode(ITEM_ID),
    );

    expect(message).toBe(
      getProjectNotificationChannelOffMessage(ProjectNotificationChannel.Call),
    );
  });
});

describe("adding a WhatsApp number", () => {
  test("is refused while WhatsApp is off, naming who can turn it on", async () => {
    readsProject(projectWithOff(ProjectNotificationChannel.WhatsApp));

    const row: UserWhatsApp = new UserWhatsApp();
    row.projectId = PROJECT_ID;
    row.userId = USER_ID;
    row.phone = new Phone("+15551230123");

    const message: string = await refusalOf(
      hooksOf<UserWhatsApp>(UserWhatsAppService).onBeforeCreate(createBy(row)),
    );

    expect(message).toBe(
      "WhatsApp is off in this project. A project owner or someone with Manage Billing can turn it on in Project Settings > Notification Settings.",
    );
    expectSaysWhoCan(message);
  });
});

describe("linking a Telegram account", () => {
  test("is refused while Telegram is off, naming who can turn it on", async () => {
    readsProject(projectWithOff(ProjectNotificationChannel.Telegram));
    getJestSpyOn(TeamMemberService, "findOneBy").mockResolvedValue({
      _id: "5a000000-0000-4000-8000-000000000009",
    } as TeamMember);

    const row: UserTelegram = new UserTelegram();
    row.projectId = PROJECT_ID;
    row.userId = USER_ID;

    const message: string = await refusalOf(
      hooksOf<UserTelegram>(UserTelegramService).onBeforeCreate(createBy(row)),
    );

    expect(message).toBe(
      "Telegram is off in this project. A project owner or someone with Manage Billing can turn it on in Project Settings > Notification Settings.",
    );
    expectSaysWhoCan(message);
  });
});

describe("adding a number for incoming calls", () => {
  function incoming(): UserIncomingCallNumber {
    const row: UserIncomingCallNumber = new UserIncomingCallNumber();
    row.projectId = PROJECT_ID;
    row.userId = USER_ID;
    row.phone = new Phone("+15551230177");
    return row;
  }

  test("needs SMS on, because the number is verified by text - and says who can turn it on", async () => {
    readsProject(projectWithOff(ProjectNotificationChannel.SMS));

    const message: string = await refusalOf(
      hooksOf<UserIncomingCallNumber>(
        UserIncomingCallNumberService,
      ).onBeforeCreate(createBy(incoming())),
    );

    expect(message).toBe(INCOMING_CALL_NUMBER_SMS_OFF_MESSAGE);
    expect(message).toContain("verified by SMS");
    expectSaysWhoCan(message);
  });

  test("sending its code again is refused the same way", async () => {
    const row: UserIncomingCallNumber = incoming();
    row._id = ITEM_ID.toString();
    row.isVerified = false;
    getJestSpyOn(
      UserIncomingCallNumberService,
      "findOneById",
    ).mockResolvedValue(row);
    readsProject(projectWithOff(ProjectNotificationChannel.SMS));

    const message: string = await refusalOf(
      UserIncomingCallNumberService.resendVerificationCode(ITEM_ID),
    );

    expect(message).toBe(INCOMING_CALL_NUMBER_SMS_OFF_MESSAGE);
  });
});

describe("a status page's SMS subscriptions", () => {
  type OnBeforeUpdate = (
    updateBy: UpdateBy<StatusPage>,
  ) => Promise<OnUpdate<StatusPage>>;

  test("cannot be turned on while SMS is off for the project, and the refusal says who can turn SMS on", async () => {
    const page: StatusPage = new StatusPage();
    page._id = STATUS_PAGE_ID.toString();
    page.projectId = PROJECT_ID;

    getJestSpyOn(StatusPageService, "findBy").mockResolvedValue([page]);
    getJestSpyOn(ProjectService, "isSMSNotificationsEnabled").mockResolvedValue(
      false,
    );

    const updateBy: UpdateBy<StatusPage> = {
      query: { _id: STATUS_PAGE_ID.toString() },
      data: { enableSmsSubscribers: true },
      props: { isRoot: true },
    } as unknown as UpdateBy<StatusPage>;

    const message: string = await refusalOf(
      (
        StatusPageService as unknown as { onBeforeUpdate: OnBeforeUpdate }
      ).onBeforeUpdate(updateBy),
    );

    expect(message).toBe(STATUS_PAGE_SMS_SUBSCRIPTIONS_SMS_OFF_MESSAGE);
    expect(message).toBe(
      "Visitors can't subscribe by SMS while SMS is off in this project. A project owner or someone with Manage Billing can turn it on in Project Settings > Notification Settings.",
    );
    expectSaysWhoCan(message);
  });
});

describe("a subscriber by phone while SMS is off for the project", () => {
  function phoneSubscriber(): StatusPageSubscriber {
    const row: StatusPageSubscriber = new StatusPageSubscriber();
    row.projectId = PROJECT_ID;
    row.statusPageId = STATUS_PAGE_ID;
    row.subscriberPhone = new Phone("+15551230155");
    return row;
  }

  beforeEach(() => {
    getJestSpyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
      plan: null,
      isSubscriptionUnpaid: false,
    });
    getJestSpyOn(ProjectService, "isSMSNotificationsEnabled").mockResolvedValue(
      false,
    );
  });

  test("added by the team - the dashboard, an API key, a workflow - is refused with who can turn SMS on", async () => {
    const message: string = await refusalOf(
      hooksOf<StatusPageSubscriber>(StatusPageSubscriberService).onBeforeCreate(
        {
          data: phoneSubscriber(),
          props: { isRoot: true },
        } as unknown as CreateBy<StatusPageSubscriber>,
      ),
    );

    expect(message).toBe(
      getProjectNotificationChannelOffMessage(ProjectNotificationChannel.SMS),
    );
    expectSaysWhoCan(message);
  });

  test("signed up by a visitor on the status page is refused without a word about project settings", async () => {
    /*
     * A sign-up goes through create, whose first step is the same hook; the
     * rest of create (the database) is not this test's business.
     */
    getJestSpyOn(StatusPageSubscriberService, "create").mockImplementation(
      async (data: CreateBy<StatusPageSubscriber>): Promise<unknown> => {
        await hooksOf<StatusPageSubscriber>(
          StatusPageSubscriberService,
        ).onBeforeCreate(data);
        return data.data;
      },
    );

    const message: string = await refusalOf(
      StatusPageSubscriberService.createFromStatusPageSignUp(phoneSubscriber()),
    );

    expect(message).toBe(SMS_SIGN_UP_UNAVAILABLE_MESSAGE);
    expect(message).toBe("SMS subscribers not enabled for this status page.");
    expect(message).not.toContain("Project Settings");
    expect(message).not.toContain("project owner");
  });
});
