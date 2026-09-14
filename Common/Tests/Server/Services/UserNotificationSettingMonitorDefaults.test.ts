import UserNotificationSetting from "../../../Models/DatabaseModels/UserNotificationSetting";
import UserNotificationSettingService from "../../../Server/Services/UserNotificationSettingService";
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

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const OTHER_USER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

const STATUS_CHANGE_EVENT: NotificationSettingEventType =
  NotificationSettingEventType.SEND_MONITOR_STATUS_CHANGED_OWNER_NOTIFICATION;

const ENABLED_MONITOR_EVENTS: Array<NotificationSettingEventType> = [
  NotificationSettingEventType.SEND_MONITOR_NOTIFICATION_WHEN_NO_PROBES_ARE_MONITORING_THE_MONITOR,
  NotificationSettingEventType.SEND_MONITOR_NOTIFICATION_WHEN_PORBE_STATUS_CHANGES,
];

interface StoredSetting {
  userId: string;
  projectId: string;
  eventType: NotificationSettingEventType;
  alertByEmail: boolean;
  alertBySMS: boolean;
  alertByCall: boolean;
  alertByPush: boolean;
  alertByWhatsApp: boolean;
  alertByTelegram: boolean;
  alertBySlack: boolean;
  alertByMicrosoftTeams: boolean;
  alertByWebhook: boolean;
  isRoot: boolean;
}

interface SettingIdentity {
  userId: unknown;
  projectId: unknown;
  eventType: unknown;
}

function key(data: SettingIdentity): string {
  return `${String(data.userId)}|${String(data.projectId)}|${String(
    data.eventType,
  )}`;
}

describe("UserNotificationSettingService monitor defaults", () => {
  let store: Map<string, StoredSetting>;
  let createdSettings: Array<StoredSetting>;
  let queriedSettings: Array<SettingIdentity>;

  beforeEach(() => {
    store = new Map<string, StoredSetting>();
    createdSettings = [];
    queriedSettings = [];

    jest
      .spyOn(UserNotificationSettingService, "countBy")
      .mockImplementation(((args: {
        query: {
          userId: ObjectID;
          projectId: ObjectID;
          eventType: NotificationSettingEventType;
        };
      }): Promise<PositiveNumber> => {
        queriedSettings.push(args.query);

        return Promise.resolve(
          new PositiveNumber(store.has(key(args.query)) ? 1 : 0),
        );
      }) as never);

    jest
      .spyOn(UserNotificationSettingService, "create")
      .mockImplementation(((args: {
        data: UserNotificationSetting;
        props: { isRoot?: boolean };
      }): Promise<UserNotificationSetting> => {
        const item: UserNotificationSetting = args.data;
        const storedSetting: StoredSetting = {
          userId: String(item.userId),
          projectId: String(item.projectId),
          eventType: item.eventType as NotificationSettingEventType,
          alertByEmail: Boolean(item.alertByEmail),
          alertBySMS: Boolean(item.alertBySMS),
          alertByCall: Boolean(item.alertByCall),
          alertByPush: Boolean(item.alertByPush),
          alertByWhatsApp: Boolean(item.alertByWhatsApp),
          alertByTelegram: Boolean(item.alertByTelegram),
          alertBySlack: Boolean(item.alertBySlack),
          alertByMicrosoftTeams: Boolean(item.alertByMicrosoftTeams),
          alertByWebhook: Boolean(item.alertByWebhook),
          isRoot: Boolean(args.props.isRoot),
        };

        createdSettings.push(storedSetting);
        store.set(key(storedSetting), storedSetting);

        return Promise.resolve(item);
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function stored(
    eventType: NotificationSettingEventType,
    userId: ObjectID = USER_ID,
    projectId: ObjectID = PROJECT_ID,
  ): StoredSetting | undefined {
    return store.get(key({ userId, projectId, eventType }));
  }

  function seed(setting: StoredSetting): void {
    store.set(key(setting), setting);
  }

  test("does not seed monitor status-change notifications for a new membership", async () => {
    await UserNotificationSettingService.addDefaultNotificationSettingsForUser(
      USER_ID,
      PROJECT_ID,
    );

    expect(stored(STATUS_CHANGE_EVENT)).toBeUndefined();
    expect(
      createdSettings.some((setting: StoredSetting) => {
        return setting.eventType === STATUS_CHANGE_EVENT;
      }),
    ).toBe(false);
    expect(
      queriedSettings.some((setting: SettingIdentity) => {
        return setting.eventType === STATUS_CHANGE_EVENT;
      }),
    ).toBe(false);
  });

  test("keeps the other monitor defaults enabled by email only", async () => {
    await UserNotificationSettingService.addDefaultNotificationSettingsForUser(
      USER_ID,
      PROJECT_ID,
    );

    for (const eventType of ENABLED_MONITOR_EVENTS) {
      expect(stored(eventType)).toEqual({
        userId: USER_ID.toString(),
        projectId: PROJECT_ID.toString(),
        eventType,
        alertByEmail: true,
        alertBySMS: false,
        alertByCall: false,
        alertByPush: false,
        alertByWhatsApp: false,
        alertByTelegram: false,
        alertBySlack: false,
        alertByMicrosoftTeams: false,
        alertByWebhook: false,
        isRoot: true,
      });
    }
  });

  test("remains idempotent without recreating the disabled default", async () => {
    await UserNotificationSettingService.addDefaultNotificationSettingsForUser(
      USER_ID,
      PROJECT_ID,
    );

    const settingsCreatedByFirstCall: number = createdSettings.length;
    const rowsCreatedByFirstCall: number = store.size;

    await UserNotificationSettingService.addDefaultNotificationSettingsForUser(
      USER_ID,
      PROJECT_ID,
    );

    expect(createdSettings).toHaveLength(settingsCreatedByFirstCall);
    expect(store.size).toBe(rowsCreatedByFirstCall);
    expect(stored(STATUS_CHANGE_EVENT)).toBeUndefined();
  });

  test("preserves an existing explicit status-change preference", async () => {
    const optedInSetting: StoredSetting = {
      userId: USER_ID.toString(),
      projectId: PROJECT_ID.toString(),
      eventType: STATUS_CHANGE_EVENT,
      alertByEmail: false,
      alertBySMS: false,
      alertByCall: false,
      alertByPush: true,
      alertByWhatsApp: false,
      alertByTelegram: false,
      alertBySlack: true,
      alertByMicrosoftTeams: false,
      alertByWebhook: false,
      isRoot: true,
    };
    seed(optedInSetting);

    await UserNotificationSettingService.addDefaultNotificationSettingsForUser(
      USER_ID,
      PROJECT_ID,
    );

    expect(stored(STATUS_CHANGE_EVENT)).toEqual(optedInSetting);
    expect(
      createdSettings.some((setting: StoredSetting) => {
        return setting.eventType === STATUS_CHANGE_EVENT;
      }),
    ).toBe(false);
  });

  test("applies the off default independently to every user and project", async () => {
    await UserNotificationSettingService.addDefaultNotificationSettingsForUser(
      USER_ID,
      PROJECT_ID,
    );
    await UserNotificationSettingService.addDefaultNotificationSettingsForUser(
      OTHER_USER_ID,
      OTHER_PROJECT_ID,
    );

    expect(stored(STATUS_CHANGE_EVENT, USER_ID, PROJECT_ID)).toBeUndefined();
    expect(
      stored(STATUS_CHANGE_EVENT, OTHER_USER_ID, OTHER_PROJECT_ID),
    ).toBeUndefined();

    for (const eventType of ENABLED_MONITOR_EVENTS) {
      expect(stored(eventType, USER_ID, PROJECT_ID)).toBeDefined();
      expect(stored(eventType, OTHER_USER_ID, OTHER_PROJECT_ID)).toBeDefined();
    }
  });
});
