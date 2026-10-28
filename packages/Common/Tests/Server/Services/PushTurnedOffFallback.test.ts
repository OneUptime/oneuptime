import CustomNotificationChannelService from "../../../Server/Services/CustomNotificationChannelService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import ProjectService from "../../../Server/Services/ProjectService";
import UserCallService from "../../../Server/Services/UserCallService";
import UserEmailService from "../../../Server/Services/UserEmailService";
import UserMicrosoftTeamsService from "../../../Server/Services/UserMicrosoftTeamsService";
import UserNotificationRuleService, {
  ExecuteFallbackNotificationOptions,
  ExecuteNotificationRuleOptions,
  FallbackNotificationOutcome,
  FallbackNotificationResult,
} from "../../../Server/Services/UserNotificationRuleService";
import UserOnCallLogService from "../../../Server/Services/UserOnCallLogService";
import UserPushService from "../../../Server/Services/UserPushService";
import UserSlackService from "../../../Server/Services/UserSlackService";
import UserSmsService from "../../../Server/Services/UserSmsService";
import UserTelegramService from "../../../Server/Services/UserTelegramService";
import UserWebhookService from "../../../Server/Services/UserWebhookService";
import UserWhatsAppService from "../../../Server/Services/UserWhatsAppService";
import logger from "../../../Server/Utils/Logger";
import ProjectMembership from "../../../Server/Utils/TeamMember/ProjectMembership";
import Project from "../../../Models/DatabaseModels/Project";
import UserNotificationRule from "../../../Models/DatabaseModels/UserNotificationRule";
import Email from "../../../Types/Email";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import ObjectID from "../../../Types/ObjectID";
import Phone from "../../../Types/Phone";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * THE ON-CALL FALLBACK, WHILE THE SERVER HAS PUSH TURNED OFF.
 *
 * A responder with no rule for a page is paged by the fallback on what they
 * have: every free channel - push, email, Slack, Microsoft Teams, a custom
 * channel that pages everyone - and only when there is none, one paid
 * channel the project has on. While a master admin has push turned off for
 * the whole server, a push device would stand in for the channels that could
 * reach the responder and then be refused by the sender, so the fallback
 * skips it: their email still goes, and a responder whose only free channel
 * was a push device is paged on their paid channel instead.
 *
 * A switch that cannot be read leaves the fallback as it was (logged): the
 * push sender refuses on its own then, and readiness already counts push as
 * off.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "c7000000-0000-4000-8000-0000000000a1",
);
const USER_ID: ObjectID = new ObjectID("c7000000-0000-4000-8000-0000000000b1");
const LOG_ID: ObjectID = new ObjectID("c7000000-0000-4000-8000-0000000000c1");
const PUSH_ID: ObjectID = new ObjectID("c7000000-0000-4000-8000-000000000001");
const EMAIL_ID: ObjectID = new ObjectID("c7000000-0000-4000-8000-000000000002");
const SMS_ID: ObjectID = new ObjectID("c7000000-0000-4000-8000-000000000003");

interface FallbackInternals {
  chooseFallbackChannels: (
    options: ExecuteFallbackNotificationOptions,
  ) => Promise<Array<{ channelName: string; rule: UserNotificationRule }>>;
  deliverNotificationForRule: (
    rule: UserNotificationRule,
    options: ExecuteNotificationRuleOptions,
  ) => Promise<boolean>;
}

function internals(): FallbackInternals {
  return UserNotificationRuleService as unknown as FallbackInternals;
}

function fallbackOptions(): ExecuteFallbackNotificationOptions {
  return {
    userId: USER_ID,
    projectId: PROJECT_ID,
    userOnCallLogId: LOG_ID,
    ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    severityName: "Sev1",
    userNotificationLogId: LOG_ID,
    userNotificationEventType: UserNotificationEventType.IncidentCreated,
    onCallPolicyId: undefined,
  };
}

function verifiedPush(): Record<string, unknown> {
  return {
    id: PUSH_ID,
    _id: PUSH_ID.toString(),
    deviceToken: "ExponentPushToken[push-off-fallback-0001]",
    deviceType: "ios",
    isVerified: true,
  };
}

function verifiedEmail(): Record<string, unknown> {
  return {
    id: EMAIL_ID,
    _id: EMAIL_ID.toString(),
    email: new Email("jane@example.com"),
    isVerified: true,
  };
}

function verifiedSms(): Record<string, unknown> {
  return {
    id: SMS_ID,
    _id: SMS_ID.toString(),
    phone: new Phone("+15550101234"),
    isVerified: true,
  };
}

// Whether push is turned off, as the server reads it; an Error when the read fails.
let switchAnswer: boolean | Error = false;

let readSwitch: jest.SpyInstance;
let pushFind: jest.SpyInstance;
let emailFind: jest.SpyInstance;
let smsFind: jest.SpyInstance;
let projectFind: jest.SpyInstance;
let errorLog: jest.SpyInstance;

async function chosenChannels(): Promise<Array<string>> {
  return (await internals().chooseFallbackChannels(fallbackOptions())).map(
    (choice: { channelName: string }): string => {
      return choice.channelName;
    },
  );
}

beforeEach(() => {
  switchAnswer = false;

  readSwitch = jest
    .spyOn(GlobalConfigService, "getPushNotificationsTurnedOff")
    .mockImplementation(async (): Promise<boolean> => {
      if (switchAnswer instanceof Error) {
        throw switchAnswer;
      }

      return switchAnswer;
    });

  errorLog = jest.spyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  });

  // A responder with a verified push device and nothing else, unless a test adds more.
  pushFind = jest
    .spyOn(UserPushService, "findOneBy")
    .mockResolvedValue(verifiedPush() as never);
  emailFind = jest
    .spyOn(UserEmailService, "findOneBy")
    .mockResolvedValue(null as never);
  jest.spyOn(UserSlackService, "findOneBy").mockResolvedValue(null as never);
  jest
    .spyOn(UserMicrosoftTeamsService, "findOneBy")
    .mockResolvedValue(null as never);
  jest
    .spyOn(CustomNotificationChannelService, "getChannelsPagingEveryone")
    .mockResolvedValue([]);
  smsFind = jest
    .spyOn(UserSmsService, "findOneBy")
    .mockResolvedValue(null as never);
  jest.spyOn(UserCallService, "findOneBy").mockResolvedValue(null as never);
  jest.spyOn(UserWhatsAppService, "findOneBy").mockResolvedValue(null as never);
  jest.spyOn(UserTelegramService, "findOneBy").mockResolvedValue(null as never);
  jest.spyOn(UserWebhookService, "findOneBy").mockResolvedValue(null as never);

  // SMS is on in the project; the other paid channels are off.
  projectFind = jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
    _id: PROJECT_ID.toString(),
    enableSmsNotifications: true,
    enableCallNotifications: false,
    enableWhatsAppNotifications: false,
    enableTelegramNotifications: false,
  } as unknown as Project);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the channels the fallback picks", () => {
  test("push on: a verified push device is picked, as it always was", async () => {
    await expect(chosenChannels()).resolves.toEqual(["Push"]);
  });

  test("push off: the push device is skipped - it is not even read", async () => {
    switchAnswer = true;

    await expect(chosenChannels()).resolves.toEqual([]);
    expect(pushFind).not.toHaveBeenCalled();
  });

  test("push off: the other free channels still go, without push beside them", async () => {
    switchAnswer = true;
    emailFind.mockResolvedValue(verifiedEmail() as never);

    await expect(chosenChannels()).resolves.toEqual(["Email"]);
  });

  test("push on, with email too: both free channels go, push first", async () => {
    emailFind.mockResolvedValue(verifiedEmail() as never);

    await expect(chosenChannels()).resolves.toEqual(["Push", "Email"]);
  });

  test("push off: a responder whose only free channel was push is paged on the paid channel the project has on", async () => {
    switchAnswer = true;
    smsFind.mockResolvedValue(verifiedSms() as never);

    await expect(chosenChannels()).resolves.toEqual(["SMS"]);
    expect(projectFind).toHaveBeenCalledTimes(1);
  });

  test("push on: the push device stands in for the paid channel, which is never looked up", async () => {
    smsFind.mockResolvedValue(verifiedSms() as never);

    await expect(chosenChannels()).resolves.toEqual(["Push"]);
    expect(projectFind).not.toHaveBeenCalled();
    expect(smsFind).not.toHaveBeenCalled();
  });

  test("the switch is asked once per fallback", async () => {
    await chosenChannels();

    expect(readSwitch).toHaveBeenCalledTimes(1);
  });

  test("the rule built for push, with push on, points at the device itself", async () => {
    const [choice] =
      await internals().chooseFallbackChannels(fallbackOptions());

    expect(choice?.channelName).toBe("Push");
    expect(choice?.rule.userPushId?.toString()).toBe(PUSH_ID.toString());
  });
});

describe("a switch that cannot be read", () => {
  beforeEach(() => {
    switchAnswer = new Error("database unavailable");
  });

  test("leaves the fallback as it was: push is picked, and the failure is logged", async () => {
    await expect(chosenChannels()).resolves.toEqual(["Push"]);

    expect(errorLog).toHaveBeenCalledWith(switchAnswer);
  });

  test("does not stop the rest of the fallback", async () => {
    emailFind.mockResolvedValue(verifiedEmail() as never);

    await expect(chosenChannels()).resolves.toEqual(["Push", "Email"]);
  });
});

describe("executeFallbackNotification, while push is off", () => {
  let delivered: jest.SpyInstance;

  beforeEach(() => {
    switchAnswer = true;

    jest
      .spyOn(UserOnCallLogService, "claimNotificationExecution")
      .mockResolvedValue(true as never);
    jest.spyOn(ProjectMembership, "isMember").mockResolvedValue(true as never);

    delivered = jest
      .spyOn(internals(), "deliverNotificationForRule")
      .mockResolvedValue(true as never);
  });

  test("a responder with a push device and email is paged by email alone", async () => {
    emailFind.mockResolvedValue(verifiedEmail() as never);

    const result: FallbackNotificationResult =
      await UserNotificationRuleService.executeFallbackNotification(
        fallbackOptions(),
      );

    expect(result).toEqual({
      outcome: FallbackNotificationOutcome.Delivered,
      notified: true,
      channelsUsed: ["Email"],
    });
    expect(delivered).toHaveBeenCalledTimes(1);
    expect(
      (
        delivered.mock.calls[0]![0] as UserNotificationRule
      ).userEmailId?.toString(),
    ).toBe(EMAIL_ID.toString());
  });

  test("a responder whose only method is a push device has no usable method, as readiness says", async () => {
    const result: FallbackNotificationResult =
      await UserNotificationRuleService.executeFallbackNotification(
        fallbackOptions(),
      );

    expect(result).toEqual({
      outcome: FallbackNotificationOutcome.NoUsableNotificationMethod,
      notified: false,
      channelsUsed: [],
    });
    expect(delivered).not.toHaveBeenCalled();
  });

  test("no rule handed to a sender points at a push device", async () => {
    emailFind.mockResolvedValue(verifiedEmail() as never);
    smsFind.mockResolvedValue(verifiedSms() as never);

    await UserNotificationRuleService.executeFallbackNotification(
      fallbackOptions(),
    );

    for (const call of delivered.mock.calls) {
      expect((call[0] as UserNotificationRule).userPushId).toBeUndefined();
      expect((call[0] as UserNotificationRule).userPush).toBeUndefined();
    }
  });
});
