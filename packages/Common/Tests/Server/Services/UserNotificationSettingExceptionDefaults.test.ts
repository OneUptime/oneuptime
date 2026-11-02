import UserNotificationSettingService from "../../../Server/Services/UserNotificationSettingService";
import CountBy from "../../../Server/Types/Database/CountBy";
import CreateBy from "../../../Server/Types/Database/CreateBy";
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
 * "Exception assigned to me" must exist as a UserNotificationSetting row,
 * because sendUserNotification sends nothing without one. A new member gets
 * it by email when they join (addDefaultNotificationSettingsForUser), and a
 * member who joined before it existed gets it the first time an exception
 * is assigned to them (ensureSettingExistsForUser, which
 * ExceptionAssignmentNotifications calls before it sends). A row that is
 * there - switched off, say - is never written again.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");

describe("the exception assignment setting's defaults", () => {
  let store: Map<string, UserNotificationSetting>;

  beforeEach(() => {
    store = new Map<string, UserNotificationSetting>();

    jest
      .spyOn(UserNotificationSettingService, "countBy")
      .mockImplementation((async (
        countBy: CountBy<UserNotificationSetting>,
      ) => {
        return new PositiveNumber(
          store.has(String(countBy.query["eventType"])) ? 1 : 0,
        );
      }) as never);

    jest
      .spyOn(UserNotificationSettingService, "create")
      .mockImplementation((async (
        createBy: CreateBy<UserNotificationSetting>,
      ) => {
        expect(createBy.props).toEqual({ isRoot: true });
        store.set(String(createBy.data.eventType), createBy.data);
        return createBy.data;
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a new member starts with it on, by email", async () => {
    await UserNotificationSettingService.addDefaultNotificationSettingsForUser(
      USER_ID,
      PROJECT_ID,
    );

    const row: UserNotificationSetting | undefined = store.get(
      NotificationSettingEventType.SEND_EXCEPTION_ASSIGNED_NOTIFICATION,
    );

    expect(row).toBeDefined();
    expect(row!.alertByEmail).toBe(true);
    expect(row!.alertByPush).toBeFalsy();
    expect(row!.userId?.toString()).toBe(USER_ID.toString());
    expect(row!.projectId?.toString()).toBe(PROJECT_ID.toString());
  });

  test("seeded once, and never again over one that is there", async () => {
    await UserNotificationSettingService.ensureSettingExistsForUser({
      userId: USER_ID,
      projectId: PROJECT_ID,
      eventType:
        NotificationSettingEventType.SEND_EXCEPTION_ASSIGNED_NOTIFICATION,
    });

    // The person switches email off.
    store.get(
      NotificationSettingEventType.SEND_EXCEPTION_ASSIGNED_NOTIFICATION,
    )!.alertByEmail = false;

    await UserNotificationSettingService.addExceptionNotificationSettings(
      USER_ID,
      PROJECT_ID,
    );
    await UserNotificationSettingService.ensureSettingExistsForUser({
      userId: USER_ID,
      projectId: PROJECT_ID,
      eventType:
        NotificationSettingEventType.SEND_EXCEPTION_ASSIGNED_NOTIFICATION,
    });

    expect(UserNotificationSettingService.create).toHaveBeenCalledTimes(1);
    expect(
      store.get(
        NotificationSettingEventType.SEND_EXCEPTION_ASSIGNED_NOTIFICATION,
      )!.alertByEmail,
    ).toBe(false);
  });
});
