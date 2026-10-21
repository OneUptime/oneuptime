import UserNotificationSettingService from "../../../Server/Services/UserNotificationSettingService";
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
 * The missed call notification setting must exist as a
 * UserNotificationSetting row: sendUserNotification sends NOTHING for a
 * (user, project, event) without one, and the Notification Settings page shows
 * a missing row as switched off. Pinned here:
 *
 *   1. addIncomingCallNotificationSettings writes that one row, email on and
 *      every other channel off, as root;
 *   2. it is idempotent, and leaves a row the user already has alone - their
 *      choice, including "off", survives;
 *   3. addDefaultNotificationSettingsForUser - the project-join path - writes
 *      it, so new members get it without the data migration.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

const MISSED_CALL: NotificationSettingEventType =
  NotificationSettingEventType.SEND_INCOMING_CALL_MISSED_OWNER_NOTIFICATION;

interface StoredSetting {
  userId: string;
  projectId: string;
  eventType: NotificationSettingEventType;
  alertByEmail: boolean;
  alertByPush: boolean;
  alertBySMS: boolean;
  alertByCall: boolean;
  isRoot: boolean;
}

function key(data: {
  userId: unknown;
  projectId: unknown;
  eventType: unknown;
}): string {
  return `${String(data.userId)}|${String(data.projectId)}|${String(
    data.eventType,
  )}`;
}

describe("UserNotificationSettingService missed call default", () => {
  let store: Map<string, StoredSetting>;
  let createCalls: number;

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
      .spyOn(UserNotificationSettingService, "create")
      .mockImplementation(((args: {
        data: UserNotificationSetting;
        props: { isRoot?: boolean };
      }): Promise<UserNotificationSetting> => {
        createCalls++;

        const item: UserNotificationSetting = args.data;
        const stored: StoredSetting = {
          userId: String(item.userId),
          projectId: String(item.projectId),
          eventType: item.eventType as NotificationSettingEventType,
          alertByEmail: Boolean(item.alertByEmail),
          alertByPush: Boolean(item.alertByPush),
          alertBySMS: Boolean(item.alertBySMS),
          alertByCall: Boolean(item.alertByCall),
          isRoot: Boolean(args.props.isRoot),
        };

        store.set(key(stored), stored);

        return Promise.resolve(item);
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function stored(): StoredSetting | undefined {
    return store.get(
      key({ userId: USER_ID, projectId: PROJECT_ID, eventType: MISSED_CALL }),
    );
  }

  test("creates the missed call setting with email on, as root", async () => {
    await UserNotificationSettingService.addIncomingCallNotificationSettings(
      USER_ID,
      PROJECT_ID,
    );

    expect(createCalls).toBe(1);
    expect(stored()).toEqual({
      userId: USER_ID.toString(),
      projectId: PROJECT_ID.toString(),
      eventType: MISSED_CALL,
      alertByEmail: true,
      alertByPush: false,
      alertBySMS: false,
      alertByCall: false,
      isRoot: true,
    });
  });

  test("is idempotent", async () => {
    await UserNotificationSettingService.addIncomingCallNotificationSettings(
      USER_ID,
      PROJECT_ID,
    );
    await UserNotificationSettingService.addIncomingCallNotificationSettings(
      USER_ID,
      PROJECT_ID,
    );

    expect(createCalls).toBe(1);
  });

  test("leaves a setting the user already has alone, even one switched off", async () => {
    store.set(
      key({ userId: USER_ID, projectId: PROJECT_ID, eventType: MISSED_CALL }),
      {
        userId: USER_ID.toString(),
        projectId: PROJECT_ID.toString(),
        eventType: MISSED_CALL,
        alertByEmail: false,
        alertByPush: true,
        alertBySMS: false,
        alertByCall: false,
        isRoot: false,
      },
    );

    await UserNotificationSettingService.addIncomingCallNotificationSettings(
      USER_ID,
      PROJECT_ID,
    );

    expect(createCalls).toBe(0);
    expect(stored()?.alertByEmail).toBe(false);
    expect(stored()?.alertByPush).toBe(true);
  });

  test("ensureSettingExistsForUser seeds the same default for this event", async () => {
    await UserNotificationSettingService.ensureSettingExistsForUser({
      userId: USER_ID,
      projectId: PROJECT_ID,
      eventType: MISSED_CALL,
    });

    expect(stored()).toMatchObject({ alertByEmail: true, alertByPush: false });
  });

  test("a member who joins a project gets it", async () => {
    await UserNotificationSettingService.addDefaultNotificationSettingsForUser(
      USER_ID,
      PROJECT_ID,
    );

    expect(stored()).toMatchObject({
      eventType: MISSED_CALL,
      alertByEmail: true,
    });
  });
});
