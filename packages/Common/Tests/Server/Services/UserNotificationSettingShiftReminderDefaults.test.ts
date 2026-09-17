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
 * The two shift-reminder notification settings — "before my on-call shift
 * starts" and "my upcoming on-call shift is reassigned" — must exist as
 * UserNotificationSetting rows, because sendUserNotification sends NOTHING
 * for a (user, project, event) without a row. Pinned here:
 *
 *   1. addShiftReminderNotificationSettings writes exactly those two rows,
 *      with email AND push on (a reminder that only lands in a mailbox is
 *      easy to miss at 05:45), as root;
 *   2. it is idempotent: an existing row is left alone, a missing one is
 *      created, and calling it again creates nothing;
 *   3. addOnCallNotificationSettings — the project-join path — reaches them,
 *      so new members get them without the data migration;
 *   4. the older on-call events keep their email-only default (push is not
 *      flipped on for anybody else by this change).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

const REMINDER_EVENTS: Array<NotificationSettingEventType> = [
  NotificationSettingEventType.SEND_BEFORE_USER_ON_CALL_SHIFT_STARTS,
  NotificationSettingEventType.SEND_WHEN_USER_ON_CALL_SHIFT_IS_REASSIGNED,
];

const OLDER_ON_CALL_EVENTS: Array<NotificationSettingEventType> = [
  NotificationSettingEventType.SEND_WHEN_USER_IS_ON_CALL_ROSTER,
  NotificationSettingEventType.SEND_WHEN_USER_IS_NEXT_ON_CALL_ROSTER,
  NotificationSettingEventType.SEND_WHEN_USER_IS_ADDED_TO_ON_CALL_POLICY,
  NotificationSettingEventType.SEND_WHEN_USER_IS_REMOVED_FROM_ON_CALL_POLICY,
  NotificationSettingEventType.SEND_WHEN_USER_IS_NO_LONGER_ACTIVE_ON_ON_CALL_ROSTER,
];

interface StoredSetting {
  userId: string;
  projectId: string;
  eventType: NotificationSettingEventType;
  alertByEmail: boolean;
  alertByPush: boolean;
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

describe("UserNotificationSettingService shift-reminder defaults", () => {
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
          isRoot: Boolean(args.props.isRoot),
        };

        store.set(key(stored), stored);

        return Promise.resolve(item);
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function stored(eventType: NotificationSettingEventType): StoredSetting {
    const setting: StoredSetting | undefined = store.get(
      key({ userId: USER_ID, projectId: PROJECT_ID, eventType }),
    );

    if (!setting) {
      throw new Error(`no settings row for ${eventType}`);
    }

    return setting;
  }

  test("creates both reminder events with email and push on, as root", async () => {
    await UserNotificationSettingService.addShiftReminderNotificationSettings(
      USER_ID,
      PROJECT_ID,
    );

    expect(createCalls).toBe(2);
    expect(
      Array.from(store.values())
        .map((s: StoredSetting) => {
          return s.eventType;
        })
        .sort(),
    ).toEqual([...REMINDER_EVENTS].sort());

    for (const eventType of REMINDER_EVENTS) {
      const setting: StoredSetting = stored(eventType);

      expect(setting.alertByEmail).toBe(true);
      expect(setting.alertByPush).toBe(true);
      expect(setting.isRoot).toBe(true);
      expect(setting.userId).toBe(USER_ID.toString());
      expect(setting.projectId).toBe(PROJECT_ID.toString());
    }
  });

  test("is idempotent: a second call creates nothing", async () => {
    await UserNotificationSettingService.addShiftReminderNotificationSettings(
      USER_ID,
      PROJECT_ID,
    );
    await UserNotificationSettingService.addShiftReminderNotificationSettings(
      USER_ID,
      PROJECT_ID,
    );

    expect(createCalls).toBe(2);
    expect(store.size).toBe(2);
  });

  test("fills in only the missing row when one of the two already exists", async () => {
    store.set(
      key({
        userId: USER_ID,
        projectId: PROJECT_ID,
        eventType:
          NotificationSettingEventType.SEND_BEFORE_USER_ON_CALL_SHIFT_STARTS,
      }),
      {
        userId: USER_ID.toString(),
        projectId: PROJECT_ID.toString(),
        eventType:
          NotificationSettingEventType.SEND_BEFORE_USER_ON_CALL_SHIFT_STARTS,
        // The user switched push off; the backfill must not touch that.
        alertByEmail: true,
        alertByPush: false,
        isRoot: true,
      },
    );

    await UserNotificationSettingService.addShiftReminderNotificationSettings(
      USER_ID,
      PROJECT_ID,
    );

    expect(createCalls).toBe(1);
    expect(
      stored(NotificationSettingEventType.SEND_BEFORE_USER_ON_CALL_SHIFT_STARTS)
        .alertByPush,
    ).toBe(false);
    expect(
      stored(
        NotificationSettingEventType.SEND_WHEN_USER_ON_CALL_SHIFT_IS_REASSIGNED,
      ).alertByPush,
    ).toBe(true);
  });

  test("is scoped to the (user, project) it is called for", async () => {
    const otherProject: ObjectID = new ObjectID(
      "33333333-3333-4333-8333-333333333333",
    );

    await UserNotificationSettingService.addShiftReminderNotificationSettings(
      USER_ID,
      PROJECT_ID,
    );
    await UserNotificationSettingService.addShiftReminderNotificationSettings(
      USER_ID,
      otherProject,
    );

    expect(store.size).toBe(4);
    expect(
      Array.from(store.values()).filter((s: StoredSetting) => {
        return s.projectId === otherProject.toString();
      }),
    ).toHaveLength(2);
  });

  test("addOnCallNotificationSettings (the project-join path) includes both reminder events", async () => {
    await UserNotificationSettingService.addOnCallNotificationSettings(
      USER_ID,
      PROJECT_ID,
    );

    for (const eventType of REMINDER_EVENTS) {
      expect(stored(eventType).alertByEmail).toBe(true);
      expect(stored(eventType).alertByPush).toBe(true);
    }

    // The five pre-existing on-call events are still written, email-only.
    for (const eventType of OLDER_ON_CALL_EVENTS) {
      expect(stored(eventType).alertByEmail).toBe(true);
      expect(stored(eventType).alertByPush).toBe(false);
    }

    expect(createCalls).toBe(
      OLDER_ON_CALL_EVENTS.length + REMINDER_EVENTS.length,
    );
  });

  test("addDefaultNotificationSettingsForUser (what TeamMember creation calls) reaches them too", async () => {
    await UserNotificationSettingService.addDefaultNotificationSettingsForUser(
      USER_ID,
      PROJECT_ID,
    );

    for (const eventType of REMINDER_EVENTS) {
      expect(stored(eventType).alertByPush).toBe(true);
    }
  });

  test("the two event type strings are the ones the runner sends on", () => {
    expect(
      NotificationSettingEventType.SEND_BEFORE_USER_ON_CALL_SHIFT_STARTS,
    ).toBe("Before user's on-call shift starts");
    expect(
      NotificationSettingEventType.SEND_WHEN_USER_ON_CALL_SHIFT_IS_REASSIGNED,
    ).toBe("User's upcoming on-call shift is reassigned");
  });
});
