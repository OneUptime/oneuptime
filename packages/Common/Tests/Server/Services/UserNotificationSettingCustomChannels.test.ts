import CustomNotificationChannelDeliveryService, {
  CustomChannelDeliveryResult,
} from "../../../Server/Services/CustomNotificationChannelDeliveryService";
import CustomNotificationChannelService from "../../../Server/Services/CustomNotificationChannelService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import ProjectService from "../../../Server/Services/ProjectService";
import PushNotificationService from "../../../Server/Services/PushNotificationService";
import SmsService from "../../../Server/Services/SmsService";
import UserEmailService from "../../../Server/Services/UserEmailService";
import UserNotificationSettingService from "../../../Server/Services/UserNotificationSettingService";
import UserService from "../../../Server/Services/UserService";
import UserSmsService from "../../../Server/Services/UserSmsService";
import UserWebhookService from "../../../Server/Services/UserWebhookService";
import WebhookService from "../../../Server/Services/WebhookService";
import DatabaseConfig from "../../../Server/DatabaseConfig";
import EmailRollupWriter from "../../../Server/Utils/EmailRollup/EmailRollupWriter";
import logger from "../../../Server/Utils/Logger";
import CustomNotificationChannel from "../../../Models/DatabaseModels/CustomNotificationChannel";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import UserEmail from "../../../Models/DatabaseModels/UserEmail";
import UserNotificationSetting from "../../../Models/DatabaseModels/UserNotificationSetting";
import UserSMS from "../../../Models/DatabaseModels/UserSMS";
import UserWebhook from "../../../Models/DatabaseModels/UserWebhook";
import URL from "../../../Types/API/URL";
import { CallRequestMessage } from "../../../Types/Call/CallRequest";
import {
  CustomChannelEvent,
  MAX_CUSTOM_CHANNEL_TEXT_LENGTH,
} from "../../../Types/CustomNotificationChannel/CustomNotificationChannelPayload";
import OneUptimeDate from "../../../Types/Date";
import Email from "../../../Types/Email";
import { EmailEnvelope } from "../../../Types/Email/EmailMessage";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../Types/ObjectID";
import PushNotificationMessage from "../../../Types/PushNotification/PushNotificationMessage";
import { SMSMessage } from "../../../Types/SMS/SMS";
import { TRUNCATED_TEXT_NOTE } from "../../../Utils/MessageFit";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Custom channels for the notifications that are not pages
 * (UserNotificationSetting.alertByCustomChannel): a person who turns them on
 * for a setting gets that setting's notifications through every custom
 * channel that is on, as one request per channel, with event "notification"
 * and what their push notification says. What breaks if this regresses:
 *
 *   1. NOTIFICATIONS NOBODY ASKED FOR. The column is off for everyone until
 *      they turn it on; off, or with no channel on, nothing is read and
 *      nothing is sent - not even the person's name.
 *
 *   2. THE WRONG CHANNEL OR PERSON. Each request names its own channel and
 *      the person and project it is for, read once however many channels
 *      there are, and goes through CustomNotificationChannelDeliveryService
 *      with the project, so a project a master admin blocked sends nothing.
 *
 *   3. ONE CHANNEL TAKING DOWN THE REST. A delivery that fails is a warning
 *      in the log and the next channel is still sent; a lookup that throws
 *      is an error in the log, never a rejection of sendUserNotification.
 *
 *   4. THE OTHER CHANNELS WAITING ON IT. It runs in the background, as every
 *      other channel does: email, SMS, push and webhooks go out whatever the
 *      custom channels do.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "c0570c4a-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("c0570c4a-0000-4000-8000-000000000002");
const CORPO_APP_ID: string = "c0570c4a-0000-4000-8000-0000000000a1";
const PAGER_ID: string = "c0570c4a-0000-4000-8000-0000000000a2";
const GATEWAY_ID: string = "c0570c4a-0000-4000-8000-0000000000a3";

const SENT_AT: Date = new Date("2026-10-27T03:20:00.000Z");

const EVENT_TYPE: NotificationSettingEventType =
  NotificationSettingEventType.SEND_INCIDENT_STATE_CHANGED_OWNER_NOTIFICATION;

const PUSH_TITLE: string = "Incident INC-42 acknowledged";
const PUSH_BODY: string =
  "Incident INC-42 (API latency high) was acknowledged in Agency A.";
const PUSH_URL: string =
  "https://oneuptime.example.com/dashboard/8d1f/incidents/9a3c";
const CLICK_ACTION: string =
  "https://oneuptime.example.com/dashboard/8d1f/incidents/9a3c?from=push";

type SendUserNotificationData = Parameters<
  typeof UserNotificationSettingService.sendUserNotification
>[0];

interface DeliveryRequest {
  customNotificationChannelId: ObjectID;
  eventType: string;
  payload: JSONObject;
  projectId?: ObjectID | undefined;
  userOnCallLogTimelineId?: ObjectID | undefined;
  isTest?: boolean | undefined;
}

function settingsRow(
  channels: Partial<UserNotificationSetting> = {},
): UserNotificationSetting {
  const row: UserNotificationSetting = new UserNotificationSetting();
  row.alertByCustomChannel = true;
  Object.assign(row, channels);
  return row;
}

function channel(
  id: string | undefined,
  name?: string,
): CustomNotificationChannel {
  const model: CustomNotificationChannel = new CustomNotificationChannel();

  if (id) {
    model._id = id;
  }

  if (name !== undefined) {
    model.name = name;
  }

  model.isEnabled = true;
  return model;
}

// What a test changes of the push message; a link given as undefined is left out.
interface PushMessageOverrides {
  title?: string | undefined;
  body?: string | undefined;
  url?: string | undefined;
  clickAction?: string | undefined;
}

function pushMessage(
  overrides: PushMessageOverrides = {},
): PushNotificationMessage {
  const message: PushNotificationMessage = {
    title: overrides.title ?? PUSH_TITLE,
    body: overrides.body ?? PUSH_BODY,
  };
  const url: string | undefined = "url" in overrides ? overrides.url : PUSH_URL;

  if (url !== undefined) {
    message.url = url;
  }

  if (overrides.clickAction !== undefined) {
    message.clickAction = overrides.clickAction;
  }

  return message;
}

function notificationData(
  overrides: Partial<SendUserNotificationData> = {},
): SendUserNotificationData {
  return {
    userId: USER_ID,
    projectId: PROJECT_ID,
    eventType: EVENT_TYPE,
    emailEnvelope: {
      subject: "Incident INC-42 acknowledged",
      templateType: EmailTemplateType.BlankTemplate,
      vars: {},
    } as unknown as EmailEnvelope,
    smsMessage: { message: "Incident INC-42 was acknowledged." } as SMSMessage,
    callRequestMessage: {} as CallRequestMessage,
    pushNotificationMessage: pushMessage(),
    ...overrides,
  } as SendUserNotificationData;
}

/*
 * The custom channels go out in the background. A few macrotask hops, not a
 * count of microtask hops, so a deeper chain of awaits inside does not make
 * the assertions below pass or fail by accident.
 */
async function settle(): Promise<void> {
  for (let hop: number = 0; hop < 5; hop++) {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
  }
}

async function send(
  overrides: Partial<SendUserNotificationData> = {},
): Promise<void> {
  await UserNotificationSettingService.sendUserNotification(
    notificationData(overrides),
  );
  await settle();
}

describe("UserNotificationSettingService.sendUserNotification - custom channels", () => {
  let findSettings: jest.SpyInstance;
  let getChannels: jest.SpyInstance;
  let findUser: jest.SpyInstance;
  let findProject: jest.SpyInstance;
  let deliver: jest.SpyInstance;
  let sendPush: jest.SpyInstance;
  let loggerError: jest.SpyInstance;
  let loggerWarn: jest.SpyInstance;

  function requests(): Array<DeliveryRequest> {
    return deliver.mock.calls.map((call: Array<unknown>): DeliveryRequest => {
      return call[0] as DeliveryRequest;
    });
  }

  function payloads(): Array<JSONObject> {
    return requests().map((request: DeliveryRequest): JSONObject => {
      return request.payload;
    });
  }

  // The warnings this path logs, and no other path's.
  function customChannelWarnings(): Array<string> {
    return loggerWarn.mock.calls
      .map((call: Array<unknown>): string => {
        return String(call[0]);
      })
      .filter((message: string): boolean => {
        return message.startsWith("Custom channel ");
      });
  }

  beforeEach(() => {
    loggerError = jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    loggerWarn = jest.spyOn(logger, "warn").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "debug").mockImplementation((): void => {
      return undefined;
    });

    findSettings = jest
      .spyOn(UserNotificationSettingService, "findOneBy")
      .mockResolvedValue(settingsRow() as never);

    jest
      .spyOn(ProjectCallSMSConfigService, "getProjectDefaultTwilioConfig")
      .mockResolvedValue(undefined as never);

    getChannels = jest
      .spyOn(CustomNotificationChannelService, "getChannelsThatAreOn")
      .mockResolvedValue([
        channel(CORPO_APP_ID, "CorpoApp"),
        channel(PAGER_ID, "Pager"),
      ] as never);

    findUser = jest
      .spyOn(UserService, "findOneById")
      .mockImplementation((async (): Promise<User> => {
        const user: User = new User();
        user.name = new Name("Jane Tan");
        user.email = new Email("jane@example.com");
        return user;
      }) as never);

    findProject = jest
      .spyOn(ProjectService, "findOneById")
      .mockImplementation((async (): Promise<Project> => {
        const project: Project = new Project();
        project.name = "Agency A";
        return project;
      }) as never);

    deliver = jest
      .spyOn(CustomNotificationChannelDeliveryService, "send")
      .mockResolvedValue({
        ok: true,
        statusCode: 200,
        message: "Delivered (HTTP 200).",
      } as never);

    sendPush = jest
      .spyOn(PushNotificationService, "sendPushNotificationToUser")
      .mockResolvedValue(undefined as never);

    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(SENT_AT);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * ----------------------------------------------------------------------- *
   * (A) Whether anything is sent at all.
   * -----------------------------------------------------------------------
   */

  describe("whether it sends", () => {
    test("the setting is read with its custom channel column", async () => {
      await send();

      const select: JSONObject = (
        findSettings.mock.calls[0]?.[0] as { select: JSONObject }
      ).select;

      expect(select["alertByCustomChannel"]).toBe(true);
    });

    test.each([
      ["off", false],
      ["left unset, as on a row from before the column", undefined],
      ["null", null],
    ])(
      "with custom channels %s, no channel, person or project is read and nothing is sent",
      async (_label: string, value: boolean | null | undefined) => {
        const row: UserNotificationSetting = new UserNotificationSetting();

        if (value !== undefined) {
          row.alertByCustomChannel = value as unknown as boolean;
        }

        findSettings.mockResolvedValue(row as never);

        await send();

        expect(getChannels).not.toHaveBeenCalled();
        expect(findUser).not.toHaveBeenCalled();
        expect(findProject).not.toHaveBeenCalled();
        expect(deliver).not.toHaveBeenCalled();
      },
    );

    test("somebody with no setting for the event (or no longer a member) is sent nothing", async () => {
      findSettings.mockResolvedValue(null as never);

      await send();

      expect(getChannels).not.toHaveBeenCalled();
      expect(deliver).not.toHaveBeenCalled();
    });

    test("on, with no channel on: nothing else is read and nothing is sent", async () => {
      getChannels.mockResolvedValue([] as never);

      await send();

      expect(getChannels).toHaveBeenCalledTimes(1);
      expect(findUser).not.toHaveBeenCalled();
      expect(findProject).not.toHaveBeenCalled();
      expect(deliver).not.toHaveBeenCalled();
      expect(customChannelWarnings()).toEqual([]);
      expect(loggerError).not.toHaveBeenCalled();
    });

    test("on, with one channel on: one request to it", async () => {
      getChannels.mockResolvedValue([
        channel(CORPO_APP_ID, "CorpoApp"),
      ] as never);

      await send();

      expect(deliver).toHaveBeenCalledTimes(1);
      expect(requests()[0]!.customNotificationChannelId.toString()).toBe(
        CORPO_APP_ID,
      );
    });

    test("several channels: one request each, in the order they are listed, each naming its own channel", async () => {
      getChannels.mockResolvedValue([
        channel(CORPO_APP_ID, "CorpoApp"),
        channel(PAGER_ID, "Pager"),
        channel(GATEWAY_ID, "Gateway"),
      ] as never);

      await send();

      expect(deliver).toHaveBeenCalledTimes(3);
      expect(
        requests().map((request: DeliveryRequest): string => {
          return request.customNotificationChannelId.toString();
        }),
      ).toEqual([CORPO_APP_ID, PAGER_ID, GATEWAY_ID]);
      expect(
        payloads().map((payload: JSONObject): unknown => {
          return payload["channel"];
        }),
      ).toEqual([
        { id: CORPO_APP_ID, name: "CorpoApp" },
        { id: PAGER_ID, name: "Pager" },
        { id: GATEWAY_ID, name: "Gateway" },
      ]);
    });

    test("every request is the same notification, for the same person, in the same project", async () => {
      getChannels.mockResolvedValue([
        channel(CORPO_APP_ID, "CorpoApp"),
        channel(PAGER_ID, "Pager"),
        channel(GATEWAY_ID, "Gateway"),
      ] as never);

      await send();

      const withoutChannel: Array<JSONObject> = payloads().map(
        (payload: JSONObject): JSONObject => {
          const copy: JSONObject = { ...payload };
          delete copy["channel"];
          return copy;
        },
      );

      expect(withoutChannel[1]).toEqual(withoutChannel[0]);
      expect(withoutChannel[2]).toEqual(withoutChannel[0]);

      for (const request of requests()) {
        expect(request.projectId?.toString()).toBe(PROJECT_ID.toString());
        expect(request.eventType).toBe(CustomChannelEvent.Notification);
      }
    });

    test("the person and the project are read once, however many channels, as the server", async () => {
      getChannels.mockResolvedValue([
        channel(CORPO_APP_ID, "CorpoApp"),
        channel(PAGER_ID, "Pager"),
        channel(GATEWAY_ID, "Gateway"),
      ] as never);

      await send();

      expect(findUser).toHaveBeenCalledTimes(1);
      expect(findProject).toHaveBeenCalledTimes(1);

      const userRead: {
        id: ObjectID;
        select: JSONObject;
        props: { isRoot?: boolean };
      } = findUser.mock.calls[0]![0];
      const projectRead: {
        id: ObjectID;
        select: JSONObject;
        props: { isRoot?: boolean };
      } = findProject.mock.calls[0]![0];

      expect(userRead.id.toString()).toBe(USER_ID.toString());
      expect(userRead.select).toEqual({ _id: true, name: true, email: true });
      expect(userRead.props.isRoot).toBe(true);
      expect(projectRead.id.toString()).toBe(PROJECT_ID.toString());
      expect(projectRead.select).toEqual({ _id: true, name: true });
      expect(projectRead.props.isRoot).toBe(true);
    });

    test("a channel without an id is skipped, and the channels around it still get theirs", async () => {
      getChannels.mockResolvedValue([
        channel(undefined, "Half-saved"),
        channel(CORPO_APP_ID, "CorpoApp"),
        channel(undefined, "Another"),
        channel(PAGER_ID, "Pager"),
      ] as never);

      await send();

      expect(
        requests().map((request: DeliveryRequest): string => {
          return request.customNotificationChannelId.toString();
        }),
      ).toEqual([CORPO_APP_ID, PAGER_ID]);
      expect(JSON.stringify(payloads())).not.toContain("Half-saved");
    });

    test("only channels without an id: nothing is sent and nothing is wrong", async () => {
      getChannels.mockResolvedValue([
        channel(undefined, "Half-saved"),
      ] as never);

      await send();

      expect(deliver).not.toHaveBeenCalled();
      expect(loggerError).not.toHaveBeenCalled();
      expect(customChannelWarnings()).toEqual([]);
    });

    test("the request is the notification event, with the setting's own type in the payload", async () => {
      await send();

      for (const request of requests()) {
        expect(request.eventType).toBe("notification");
        expect(request.payload["event"]).toBe("notification");
        expect(request.payload["notificationType"]).toBe(EVENT_TYPE);
      }
    });

    test.each([
      NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION,
      NotificationSettingEventType.SEND_ALERT_NOTE_POSTED_OWNER_NOTIFICATION,
      NotificationSettingEventType.SEND_MONITOR_STATUS_CHANGED_OWNER_NOTIFICATION,
      NotificationSettingEventType.SEND_BEFORE_USER_ON_CALL_SHIFT_STARTS,
      NotificationSettingEventType.SEND_WHEN_USER_IS_ON_CALL_ROSTER,
      NotificationSettingEventType.SEND_SECURITY_CASE_ASSIGNED_NOTIFICATION,
    ])(
      "a %p notification names that setting in notificationType",
      async (eventType: NotificationSettingEventType) => {
        await send({ eventType });

        expect(deliver).toHaveBeenCalledTimes(2);

        for (const request of requests()) {
          expect(request.eventType).toBe(CustomChannelEvent.Notification);
          expect(request.payload["notificationType"]).toBe(eventType);
        }
      },
    );

    test("each request names the project, so a project a master admin blocked sends nothing", async () => {
      await send();

      for (const request of requests()) {
        expect(request.projectId).toBeInstanceOf(ObjectID);
        expect(request.projectId?.toString()).toBe(PROJECT_ID.toString());
      }
    });

    test("a notification is neither a test nor a page: no test flag and no on-call log row", async () => {
      await send();

      for (const request of requests()) {
        expect(request.isTest).toBeFalsy();
        expect(request.userOnCallLogTimelineId).toBeUndefined();
      }
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (B) What each request says.
   * -----------------------------------------------------------------------
   */

  describe("the payload", () => {
    test("says what the push notification says, for the person, in their project, through that channel", async () => {
      getChannels.mockResolvedValue([
        channel(CORPO_APP_ID, "CorpoApp"),
      ] as never);

      await send();

      expect(payloads()[0]).toEqual({
        version: 1,
        event: "notification",
        notificationId: null,
        sentAt: "2026-10-27T03:20:00.000Z",
        channel: { id: CORPO_APP_ID, name: "CorpoApp" },
        title: PUSH_TITLE,
        message: PUSH_BODY,
        project: { id: PROJECT_ID.toString(), name: "Agency A" },
        team: null,
        user: {
          id: USER_ID.toString(),
          name: "Jane Tan",
          email: "jane@example.com",
        },
        recordType: null,
        record: null,
        onCallPolicy: null,
        escalationRule: null,
        isPageAgain: false,
        actions: null,
        notificationType: EVENT_TYPE,
        url: PUSH_URL,
      });
    });

    test("is held to the budget: a push body of a megabyte is cut, and the title stays whole", async () => {
      const body: string = "log line\n".repeat(120_000);

      await send({ pushNotificationMessage: pushMessage({ body }) });

      for (const payload of payloads()) {
        const title: string = payload["title"] as string;
        const message: string = payload["message"] as string;

        expect(title).toBe(PUSH_TITLE);
        expect(message.endsWith(TRUNCATED_TEXT_NOTE)).toBe(true);
        expect(title.length + message.length).toBeLessThanOrEqual(
          MAX_CUSTOM_CHANNEL_TEXT_LENGTH,
        );
      }
    });

    test("sentAt is when it was sent", async () => {
      await send();

      expect(payloads()[0]!["sentAt"]).toBe(SENT_AT.toISOString());
    });

    describe("its link", () => {
      test("is the push notification's url", async () => {
        await send({
          pushNotificationMessage: pushMessage({
            url: PUSH_URL,
            clickAction: undefined,
          }),
        });

        expect(payloads()[0]!["url"]).toBe(PUSH_URL);
      });

      test("is its clickAction when it has no url", async () => {
        await send({
          pushNotificationMessage: pushMessage({
            url: undefined,
            clickAction: CLICK_ACTION,
          }),
        });

        expect(payloads()[0]!["url"]).toBe(CLICK_ACTION);
      });

      test("is its clickAction when its url is empty", async () => {
        await send({
          pushNotificationMessage: pushMessage({
            url: "",
            clickAction: CLICK_ACTION,
          }),
        });

        expect(payloads()[0]!["url"]).toBe(CLICK_ACTION);
      });

      test("is the url when it has both", async () => {
        await send({
          pushNotificationMessage: pushMessage({
            url: PUSH_URL,
            clickAction: CLICK_ACTION,
          }),
        });

        expect(payloads()[0]!["url"]).toBe(PUSH_URL);
      });

      test.each([
        ["neither", undefined, undefined],
        ["two empty ones", "", ""],
      ])(
        "is null when it has %s",
        async (
          _label: string,
          url: string | undefined,
          clickAction: string | undefined,
        ) => {
          await send({
            pushNotificationMessage: pushMessage({ url, clickAction }),
          });

          for (const payload of payloads()) {
            expect(payload["url"]).toBeNull();
          }
        },
      );
    });

    test("a push message with no title or body sends empty ones, not undefined", async () => {
      await send({
        pushNotificationMessage: {} as PushNotificationMessage,
      });

      expect(payloads()[0]).toMatchObject({
        title: "",
        message: "",
        url: null,
      });
    });

    test("a caller that sent no push message at all still reaches the channels, with empty texts", async () => {
      await send({
        pushNotificationMessage:
          undefined as unknown as PushNotificationMessage,
      });

      expect(deliver).toHaveBeenCalledTimes(2);
      expect(payloads()[0]).toMatchObject({
        title: "",
        message: "",
        url: null,
      });
      expect(loggerError).not.toHaveBeenCalled();
    });

    test("a person or a project that could not be read is sent by id, with empty names", async () => {
      findUser.mockResolvedValue(null as never);
      findProject.mockResolvedValue(null as never);

      await send();

      expect(payloads()[0]!["user"]).toEqual({
        id: USER_ID.toString(),
        name: "",
        email: "",
      });
      expect(payloads()[0]!["project"]).toEqual({
        id: PROJECT_ID.toString(),
        name: "",
      });
    });

    test("a person with no name is sent with an empty name beside their email", async () => {
      findUser.mockImplementation((async (): Promise<User> => {
        const user: User = new User();
        user.email = new Email("sam@example.com");
        return user;
      }) as never);

      await send();

      expect(payloads()[0]!["user"]).toEqual({
        id: USER_ID.toString(),
        name: "",
        email: "sam@example.com",
      });
    });

    test("a channel with no name is sent with an empty one", async () => {
      getChannels.mockResolvedValue([channel(CORPO_APP_ID)] as never);

      await send();

      expect(payloads()[0]!["channel"]).toEqual({ id: CORPO_APP_ID, name: "" });
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (C) A channel that fails costs only its own request.
   * -----------------------------------------------------------------------
   */

  describe("when something fails", () => {
    test("a delivery that is not ok is a warning naming the channel, the event, the person and why, and the next channel is still sent", async () => {
      getChannels.mockResolvedValue([
        channel(CORPO_APP_ID, "CorpoApp"),
        channel(PAGER_ID, "Pager"),
      ] as never);
      deliver.mockImplementation((async (
        request: DeliveryRequest,
      ): Promise<CustomChannelDeliveryResult> => {
        if (request.customNotificationChannelId.toString() === CORPO_APP_ID) {
          return {
            ok: false,
            statusCode: 503,
            message: "Not delivered: CorpoApp answered HTTP 503.",
          };
        }

        return { ok: true, statusCode: 200, message: "Delivered." };
      }) as never);

      await expect(
        UserNotificationSettingService.sendUserNotification(notificationData()),
      ).resolves.toBeUndefined();
      await settle();

      expect(deliver).toHaveBeenCalledTimes(2);
      expect(requests()[1]!.customNotificationChannelId.toString()).toBe(
        PAGER_ID,
      );

      const warnings: Array<string> = customChannelWarnings();

      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain(CORPO_APP_ID);
      expect(warnings[0]).toContain(EVENT_TYPE);
      expect(warnings[0]).toContain(USER_ID.toString());
      expect(warnings[0]).toContain(
        "Not delivered: CorpoApp answered HTTP 503.",
      );
      expect(warnings[0]).not.toContain(PAGER_ID);
      expect(loggerError).not.toHaveBeenCalled();
    });

    test("every delivery failing is one warning per channel, and nothing is thrown", async () => {
      getChannels.mockResolvedValue([
        channel(CORPO_APP_ID, "CorpoApp"),
        channel(PAGER_ID, "Pager"),
        channel(GATEWAY_ID, "Gateway"),
      ] as never);
      deliver.mockResolvedValue({
        ok: false,
        message:
          "Custom Channel notification not sent: this project is blocked.",
      } as never);

      await send();

      const warnings: Array<string> = customChannelWarnings();

      expect(deliver).toHaveBeenCalledTimes(3);
      expect(warnings).toHaveLength(3);
      expect(warnings[0]).toContain(CORPO_APP_ID);
      expect(warnings[1]).toContain(PAGER_ID);
      expect(warnings[2]).toContain(GATEWAY_ID);
      expect(loggerError).not.toHaveBeenCalled();
    });

    test("a delivered request logs no warning", async () => {
      await send();

      expect(deliver).toHaveBeenCalledTimes(2);
      expect(customChannelWarnings()).toEqual([]);
      expect(loggerError).not.toHaveBeenCalled();
    });

    test("a channel lookup that throws is only logged: nothing is sent, nothing else is read, and sendUserNotification resolves", async () => {
      const lookupError: Error = new Error("Postgres is unreachable");
      getChannels.mockRejectedValue(lookupError as never);

      await expect(
        UserNotificationSettingService.sendUserNotification(notificationData()),
      ).resolves.toBeUndefined();
      await settle();

      expect(deliver).not.toHaveBeenCalled();
      expect(findUser).not.toHaveBeenCalled();
      expect(findProject).not.toHaveBeenCalled();
      expect(loggerError).toHaveBeenCalledTimes(1);
      expect(loggerError).toHaveBeenCalledWith(lookupError);
    });

    test("a read of the person that throws is only logged, and nothing is sent", async () => {
      const readError: Error = new Error("User read failed");
      findUser.mockRejectedValue(readError as never);

      await expect(
        UserNotificationSettingService.sendUserNotification(notificationData()),
      ).resolves.toBeUndefined();
      await settle();

      expect(deliver).not.toHaveBeenCalled();
      expect(loggerError).toHaveBeenCalledWith(readError);
    });

    test("a request that throws is only logged: sendUserNotification resolves", async () => {
      const sendError: Error = new Error(
        "Could not reach the Notification service.",
      );
      deliver.mockRejectedValue(sendError as never);

      await expect(
        UserNotificationSettingService.sendUserNotification(notificationData()),
      ).resolves.toBeUndefined();
      await settle();

      // Every channel is still asked, and each throw is a warning of its own.
      const asked: number = deliver.mock.calls.length;
      expect(asked).toBeGreaterThan(0);
      expect(customChannelWarnings()).toHaveLength(asked);

      for (const warning of customChannelWarnings()) {
        expect(warning).toContain("could not be sent");
        expect(warning).toContain(sendError.message);
        expect(warning).toContain(USER_ID.toString());
      }
    });

    test("one channel whose request throws stops none of the others", async () => {
      deliver
        .mockRejectedValueOnce(new Error("socket hang up") as never)
        .mockResolvedValue({ ok: true, message: "Sent." } as never);

      await send();

      const asked: number = deliver.mock.calls.length;
      expect(asked).toBeGreaterThan(1);
      expect(customChannelWarnings()).toHaveLength(1);
      expect(customChannelWarnings()[0]).toContain("socket hang up");
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (D) In the background, beside every other channel.
   * -----------------------------------------------------------------------
   */

  describe("beside the other channels", () => {
    let sendOrRollup: jest.SpyInstance;
    let sendSms: jest.SpyInstance;
    let sendWebhook: jest.SpyInstance;

    beforeEach(() => {
      findSettings.mockResolvedValue(
        settingsRow({
          alertByEmail: true,
          alertBySMS: true,
          alertByPush: true,
          alertByWebhook: true,
          alertByCustomChannel: true,
        }) as never,
      );

      jest.spyOn(UserEmailService, "findBy").mockResolvedValue([
        {
          email: new Email("jane@example.com"),
        } as unknown as UserEmail,
      ] as never);
      jest
        .spyOn(DatabaseConfig, "getDashboardUrl")
        .mockResolvedValue(
          URL.fromString("https://oneuptime.example.com/dashboard"),
        );
      sendOrRollup = jest
        .spyOn(EmailRollupWriter, "sendOrRollup")
        .mockResolvedValue(undefined as never);

      jest
        .spyOn(UserSmsService, "findBy")
        .mockResolvedValue([
          { phone: "+15550000001" } as unknown as UserSMS,
        ] as never);
      sendSms = jest
        .spyOn(SmsService, "sendSms")
        .mockResolvedValue(undefined as never);

      jest.spyOn(UserWebhookService, "findBy").mockResolvedValue([
        {
          webhookUrl: "https://example.com/hook",
          name: "hook",
        } as unknown as UserWebhook,
      ] as never);
      sendWebhook = jest
        .spyOn(WebhookService, "sendWebhook")
        .mockResolvedValue(undefined as never);
    });

    function expectEveryOtherChannelSent(): void {
      expect(sendOrRollup).toHaveBeenCalledTimes(1);
      expect(sendSms).toHaveBeenCalledTimes(1);
      expect(sendPush).toHaveBeenCalledTimes(1);
      expect(sendWebhook).toHaveBeenCalledTimes(1);
    }

    test("sendUserNotification does not wait for the custom channels: it resolves while their lookup is pending, and they go out after", async () => {
      let releaseLookup: (
        channels: Array<CustomNotificationChannel>,
      ) => void = (): void => {
        return undefined;
      };
      getChannels.mockReturnValue(
        new Promise<Array<CustomNotificationChannel>>(
          (
            resolve: (channels: Array<CustomNotificationChannel>) => void,
          ): void => {
            releaseLookup = resolve;
          },
        ) as never,
      );

      await UserNotificationSettingService.sendUserNotification(
        notificationData(),
      );

      expectEveryOtherChannelSent();
      expect(getChannels).toHaveBeenCalledTimes(1);
      expect(deliver).not.toHaveBeenCalled();

      releaseLookup([channel(CORPO_APP_ID, "CorpoApp")]);
      await settle();

      expect(deliver).toHaveBeenCalledTimes(1);
    });

    test("email, SMS, push and webhooks all go out, and so do the custom channels", async () => {
      await send();

      expectEveryOtherChannelSent();
      expect(deliver).toHaveBeenCalledTimes(2);
      expect(loggerError).not.toHaveBeenCalled();
    });

    test("they still go out when the custom channels cannot be looked up", async () => {
      getChannels.mockRejectedValue(new Error("lookup failed") as never);

      await send();

      expectEveryOtherChannelSent();
      expect(deliver).not.toHaveBeenCalled();
      expect(loggerError).toHaveBeenCalledTimes(1);
    });

    test("they still go out when every custom channel delivery fails", async () => {
      deliver.mockResolvedValue({
        ok: false,
        statusCode: 500,
        message: "Not delivered.",
      } as never);

      await send();

      expectEveryOtherChannelSent();
      expect(customChannelWarnings()).toHaveLength(2);
    });

    test("they still go out when a custom channel request throws", async () => {
      deliver.mockRejectedValue(new Error("socket hang up") as never);

      await send();

      expectEveryOtherChannelSent();
      expect(customChannelWarnings().length).toBeGreaterThan(0);
    });

    test("custom channels on with push off: the channels get the push wording, and no push is sent", async () => {
      findSettings.mockResolvedValue(
        settingsRow({
          alertByPush: false,
          alertByCustomChannel: true,
        }) as never,
      );

      await send();

      expect(sendPush).not.toHaveBeenCalled();
      expect(deliver).toHaveBeenCalledTimes(2);
      expect(payloads()[0]).toMatchObject({
        title: PUSH_TITLE,
        message: PUSH_BODY,
      });
    });

    test("push on with custom channels off: the push goes, and no channel is asked", async () => {
      findSettings.mockResolvedValue(
        settingsRow({
          alertByPush: true,
          alertByCustomChannel: false,
        }) as never,
      );

      await send();

      expect(sendPush).toHaveBeenCalledTimes(1);
      expect(getChannels).not.toHaveBeenCalled();
      expect(deliver).not.toHaveBeenCalled();
    });

    test("the channels' requests do not change the push notification the other channels are given", async () => {
      const message: PushNotificationMessage = pushMessage({
        clickAction: CLICK_ACTION,
      });
      const before: string = JSON.stringify(message);

      await send({ pushNotificationMessage: message });

      expect(JSON.stringify(message)).toBe(before);
      expect(sendPush.mock.calls[0]?.[2]).toBe(message);
    });
  });
});
