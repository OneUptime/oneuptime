import UserNotificationSettingService, {
  NotificationSettingChannel,
  SLA_BREACH_CHANNELS,
} from "../../../Server/Services/UserNotificationSettingService";
import UserNotificationSetting from "../../../Models/DatabaseModels/UserNotificationSetting";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * "Incident SLA breached" (SEND_INCIDENT_SLA_BREACHED_OWNER_NOTIFICATION) is
 * an event of its own: an SLA breach was sent through "Incident created"
 * until now, so switching that off silenced breaches too. A person's setting
 * for it must exist as a row - sendUserNotification sends nothing for an
 * event without one, and the Notification Settings page shows a missing row
 * as off. Pinned here (addIncidentSlaBreachedNotificationSettings):
 *
 *   1. it starts with email and every other channel the person has on for
 *      "Incident created", where breaches were sent before - and email even
 *      when "Incident created" is off;
 *   2. email alone for somebody with no "Incident created" row;
 *   3. a setting the person already has is never touched, and it is
 *      idempotent;
 *   4. a new member gets it with the other incident events
 *      (addDefaultNotificationSettingsForUser).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5ab1ead0-0000-4000-8000-000000000001",
);
const USER_ID: ObjectID = new ObjectID("5ab1ead0-0000-4000-8000-000000000002");

const SLA_BREACHED: NotificationSettingEventType =
  NotificationSettingEventType.SEND_INCIDENT_SLA_BREACHED_OWNER_NOTIFICATION;
const INCIDENT_CREATED: NotificationSettingEventType =
  NotificationSettingEventType.SEND_INCIDENT_CREATED_OWNER_NOTIFICATION;

type Channel = NotificationSettingChannel;

const ALL_OFF: Record<Channel, boolean> = {
  alertByEmail: false,
  alertBySMS: false,
  alertByCall: false,
  alertByPush: false,
  alertByWhatsApp: false,
  alertByTelegram: false,
  alertBySlack: false,
  alertByMicrosoftTeams: false,
  alertByWebhook: false,
};

interface StoredSetting {
  eventType: NotificationSettingEventType;
  channels: Record<Channel, boolean>;
  isRoot: boolean;
}

// A setting's place in the store: whose, in which project, for which event.
function key(data: {
  userId?: unknown;
  projectId?: unknown;
  eventType?: unknown;
}): string {
  return `${String(data.userId)}|${String(data.projectId)}|${String(
    data.eventType,
  )}`;
}

function channelsOf(item: UserNotificationSetting): Record<Channel, boolean> {
  const channels: Record<Channel, boolean> = { ...ALL_OFF };

  for (const channel of SLA_BREACH_CHANNELS) {
    channels[channel] = Boolean(item[channel]);
  }

  return channels;
}

describe("UserNotificationSettingService: the SLA breach setting", () => {
  let store: Map<string, StoredSetting>;
  let createCalls: number;

  const seed: (
    eventType: NotificationSettingEventType,
    channels: Partial<Record<Channel, boolean>>,
  ) => void = (
    eventType: NotificationSettingEventType,
    channels: Partial<Record<Channel, boolean>>,
  ): void => {
    store.set(
      key({ userId: USER_ID, projectId: PROJECT_ID, eventType: eventType }),
      {
        eventType: eventType,
        channels: { ...ALL_OFF, ...channels },
        isRoot: true,
      },
    );
  };

  const stored: (
    eventType?: NotificationSettingEventType,
  ) => StoredSetting | undefined = (
    eventType?: NotificationSettingEventType,
  ): StoredSetting | undefined => {
    return store.get(
      key({
        userId: USER_ID,
        projectId: PROJECT_ID,
        eventType: eventType || SLA_BREACHED,
      }),
    );
  };

  beforeEach(() => {
    store = new Map<string, StoredSetting>();
    createCalls = 0;

    jest
      .spyOn(UserNotificationSettingService, "countBy")
      .mockImplementation(((args: {
        query: { userId: ObjectID; projectId: ObjectID; eventType: string };
      }): Promise<PositiveNumber> => {
        return Promise.resolve(
          new PositiveNumber(store.has(key(args.query)) ? 1 : 0),
        );
      }) as never);

    jest
      .spyOn(UserNotificationSettingService, "findOneBy")
      .mockImplementation(((args: {
        query: { userId: ObjectID; projectId: ObjectID; eventType: string };
        props: { isRoot?: boolean };
      }): Promise<UserNotificationSetting | null> => {
        expect(args.props.isRoot).toBe(true);

        const found: StoredSetting | undefined = store.get(key(args.query));

        if (!found) {
          return Promise.resolve(null);
        }

        const item: UserNotificationSetting = new UserNotificationSetting();

        for (const channel of SLA_BREACH_CHANNELS) {
          item[channel] = found.channels[channel];
        }

        return Promise.resolve(item);
      }) as never);

    jest
      .spyOn(UserNotificationSettingService, "create")
      .mockImplementation(((args: {
        data: UserNotificationSetting;
        props: { isRoot?: boolean };
      }): Promise<UserNotificationSetting> => {
        createCalls++;

        store.set(key(args.data), {
          eventType: args.data.eventType as NotificationSettingEventType,
          channels: channelsOf(args.data),
          isRoot: Boolean(args.props.isRoot),
        });

        return Promise.resolve(args.data);
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("starts on email and every channel the person has on for Incident created", async () => {
    seed(INCIDENT_CREATED, {
      alertByEmail: true,
      alertBySMS: true,
      alertByPush: true,
      alertBySlack: true,
    });

    await UserNotificationSettingService.addIncidentSlaBreachedNotificationSettings(
      USER_ID,
      PROJECT_ID,
    );

    expect(stored()).toEqual({
      eventType: SLA_BREACHED,
      channels: {
        ...ALL_OFF,
        alertByEmail: true,
        alertBySMS: true,
        alertByPush: true,
        alertBySlack: true,
      },
      isRoot: true,
    });
  });

  test.each(SLA_BREACH_CHANNELS)(
    "%s on for Incident created is on for SLA breaches too",
    async (channel: Channel) => {
      seed(INCIDENT_CREATED, { [channel]: true });

      await UserNotificationSettingService.addIncidentSlaBreachedNotificationSettings(
        USER_ID,
        PROJECT_ID,
      );

      expect(stored()!.channels[channel]).toBe(true);
      expect(stored()!.channels.alertByEmail).toBe(true);
    },
  );

  test("email even when Incident created is switched off: that never meant silencing breaches", async () => {
    seed(INCIDENT_CREATED, {});

    await UserNotificationSettingService.addIncidentSlaBreachedNotificationSettings(
      USER_ID,
      PROJECT_ID,
    );

    expect(stored()!.channels).toEqual({ ...ALL_OFF, alertByEmail: true });
  });

  test("email alone for somebody with no Incident created setting", async () => {
    await UserNotificationSettingService.addIncidentSlaBreachedNotificationSettings(
      USER_ID,
      PROJECT_ID,
    );

    expect(stored()!.channels).toEqual({ ...ALL_OFF, alertByEmail: true });
  });

  test("a setting the person already has is never touched, and a second run writes nothing", async () => {
    seed(SLA_BREACHED, { alertByCall: true });
    seed(INCIDENT_CREATED, { alertByEmail: true, alertBySMS: true });

    await UserNotificationSettingService.addIncidentSlaBreachedNotificationSettings(
      USER_ID,
      PROJECT_ID,
    );
    await UserNotificationSettingService.addIncidentSlaBreachedNotificationSettings(
      USER_ID,
      PROJECT_ID,
    );

    expect(createCalls).toBe(0);
    expect(stored()!.channels).toEqual({ ...ALL_OFF, alertByCall: true });
  });

  test("never changes the Incident created setting it reads", async () => {
    seed(INCIDENT_CREATED, { alertBySMS: true });

    await UserNotificationSettingService.addIncidentSlaBreachedNotificationSettings(
      USER_ID,
      PROJECT_ID,
    );

    expect(stored(INCIDENT_CREATED)!.channels).toEqual({
      ...ALL_OFF,
      alertBySMS: true,
    });
  });

  test("a new member gets it with the other incident events, by email", async () => {
    await UserNotificationSettingService.addDefaultNotificationSettingsForUser(
      USER_ID,
      PROJECT_ID,
    );

    expect(stored()!.channels).toEqual({ ...ALL_OFF, alertByEmail: true });
    expect(stored(INCIDENT_CREATED)!.channels.alertByEmail).toBe(true);
  });
});
