import UserNotificationSettingService, {
  SECURITY_CASE_NOTIFICATION_EVENT_TYPES,
} from "../../../Server/Services/UserNotificationSettingService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UserNotificationSetting from "../../../Models/DatabaseModels/UserNotificationSetting";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import NotificationSettingEventType from "../../../Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import SecurityCasePriority from "../../../Types/SecurityCase/SecurityCasePriority";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The three security case notification settings - a case at my chosen
 * priority, a case assigned to me or my team, a playbook step waiting for my
 * approval - must exist as UserNotificationSetting rows, because
 * sendUserNotification sends nothing without one. Pinned here:
 *
 *   1. addSecurityCaseNotificationSettings writes exactly those three rows,
 *      with email and push on, as root, and is idempotent;
 *   2. addDefaultNotificationSettingsForUser - the project-join path -
 *      reaches them, so a new member hears about High and Critical cases
 *      without setting anything up;
 *   3. a setting's priority choice is a priority, and only the New Security
 *      Case setting has one.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const ROW_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

interface StoredSetting {
  eventType: NotificationSettingEventType;
  alertByEmail: boolean;
  alertByPush: boolean;
  alertBySMS: boolean;
  isRoot: boolean;
}

type HookCaller = {
  onBeforeCreate: (
    createBy: CreateBy<UserNotificationSetting>,
  ) => Promise<OnCreate<UserNotificationSetting>>;
  onBeforeUpdate: (
    updateBy: UpdateBy<UserNotificationSetting>,
  ) => Promise<OnUpdate<UserNotificationSetting>>;
};

const service: HookCaller =
  UserNotificationSettingService as unknown as HookCaller;

describe("UserNotificationSettingService security case defaults", () => {
  let store: Map<string, StoredSetting>;

  beforeEach(() => {
    store = new Map<string, StoredSetting>();

    jest
      .spyOn(UserNotificationSettingService, "countBy")
      .mockImplementation(((args: {
        query: { eventType: string };
      }): Promise<PositiveNumber> => {
        return Promise.resolve(
          new PositiveNumber(store.has(String(args.query.eventType)) ? 1 : 0),
        );
      }) as never);

    jest
      .spyOn(UserNotificationSettingService, "create")
      .mockImplementation(((args: {
        data: UserNotificationSetting;
        props: { isRoot?: boolean };
      }): Promise<UserNotificationSetting> => {
        store.set(String(args.data.eventType), {
          eventType: args.data.eventType as NotificationSettingEventType,
          alertByEmail: Boolean(args.data.alertByEmail),
          alertByPush: Boolean(args.data.alertByPush),
          alertBySMS: Boolean(args.data.alertBySMS),
          isRoot: Boolean(args.props.isRoot),
        });
        return Promise.resolve(args.data);
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("writes the three events with email and push on, as root", async () => {
    await UserNotificationSettingService.addSecurityCaseNotificationSettings(
      USER_ID,
      PROJECT_ID,
    );

    expect(Array.from(store.keys())).toEqual([
      NotificationSettingEventType.SEND_SECURITY_CASE_OPENED_NOTIFICATION,
      NotificationSettingEventType.SEND_SECURITY_CASE_ASSIGNED_NOTIFICATION,
      NotificationSettingEventType.SEND_SECURITY_PLAYBOOK_APPROVAL_NOTIFICATION,
    ]);
    expect([...SECURITY_CASE_NOTIFICATION_EVENT_TYPES]).toEqual(
      Array.from(store.keys()),
    );

    for (const setting of store.values()) {
      expect(setting).toEqual({
        eventType: setting.eventType,
        alertByEmail: true,
        alertByPush: true,
        alertBySMS: false,
        isRoot: true,
      });
    }
  });

  test("leaves a row a member already has, and writes nothing the second time", async () => {
    store.set(
      NotificationSettingEventType.SEND_SECURITY_CASE_ASSIGNED_NOTIFICATION,
      {
        eventType:
          NotificationSettingEventType.SEND_SECURITY_CASE_ASSIGNED_NOTIFICATION,
        alertByEmail: false,
        alertByPush: false,
        alertBySMS: true,
        isRoot: false,
      },
    );

    await UserNotificationSettingService.addSecurityCaseNotificationSettings(
      USER_ID,
      PROJECT_ID,
    );
    await UserNotificationSettingService.addSecurityCaseNotificationSettings(
      USER_ID,
      PROJECT_ID,
    );

    expect(UserNotificationSettingService.create).toHaveBeenCalledTimes(2);
    expect(
      store.get(
        NotificationSettingEventType.SEND_SECURITY_CASE_ASSIGNED_NOTIFICATION,
      )!.alertBySMS,
    ).toBe(true);
  });

  test("a member who joins a project gets them", async () => {
    await UserNotificationSettingService.addDefaultNotificationSettingsForUser(
      USER_ID,
      PROJECT_ID,
    );

    for (const eventType of SECURITY_CASE_NOTIFICATION_EVENT_TYPES) {
      expect(store.get(eventType)).toEqual(
        expect.objectContaining({ alertByEmail: true, alertByPush: true }),
      );
    }
  });
});

describe("UserNotificationSettingService security case priority choice", () => {
  function createBy(
    data: Partial<UserNotificationSetting>,
  ): CreateBy<UserNotificationSetting> {
    const setting: UserNotificationSetting = new UserNotificationSetting();
    setting.projectId = PROJECT_ID;
    setting.userId = USER_ID;
    Object.assign(setting, data);

    return {
      data: setting,
      props: { userId: USER_ID, tenantId: PROJECT_ID },
    } as CreateBy<UserNotificationSetting>;
  }

  function updateBy(data: JSONObject): UpdateBy<UserNotificationSetting> {
    return {
      query: { _id: ROW_ID },
      data,
      props: { userId: USER_ID, tenantId: PROJECT_ID },
    } as unknown as UpdateBy<UserNotificationSetting>;
  }

  let otherEventRows: number;

  beforeEach(() => {
    otherEventRows = 0;

    jest
      .spyOn(UserNotificationSettingService, "countBy")
      .mockImplementation(((args: {
        query: JSONObject;
      }): Promise<PositiveNumber> => {
        // The duplicate check on create asks without an eventType filter of its own.
        if (args.query["_id"]) {
          return Promise.resolve(new PositiveNumber(otherEventRows));
        }

        return Promise.resolve(new PositiveNumber(0));
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("the New Security Case setting takes a priority, or none", async () => {
    await expect(
      service.onBeforeCreate(
        createBy({
          eventType:
            NotificationSettingEventType.SEND_SECURITY_CASE_OPENED_NOTIFICATION,
          minimumSecurityCasePriority: SecurityCasePriority.Medium,
        }),
      ),
    ).resolves.toBeDefined();

    await expect(
      service.onBeforeCreate(
        createBy({
          eventType:
            NotificationSettingEventType.SEND_SECURITY_CASE_OPENED_NOTIFICATION,
        }),
      ),
    ).resolves.toBeDefined();
  });

  test("a value that is not a priority is refused", async () => {
    await expect(
      service.onBeforeCreate(
        createBy({
          eventType:
            NotificationSettingEventType.SEND_SECURITY_CASE_OPENED_NOTIFICATION,
          minimumSecurityCasePriority: "Urgent" as SecurityCasePriority,
        }),
      ),
    ).rejects.toThrow(BadDataException);

    await expect(
      service.onBeforeUpdate(
        updateBy({ minimumSecurityCasePriority: "Urgent" }),
      ),
    ).rejects.toThrow(
      "The priority must be Critical, High, Medium, Low or Informational.",
    );
  });

  test("no other setting has a priority to choose", async () => {
    await expect(
      service.onBeforeCreate(
        createBy({
          eventType:
            NotificationSettingEventType.SEND_SECURITY_CASE_ASSIGNED_NOTIFICATION,
          minimumSecurityCasePriority: SecurityCasePriority.Low,
        }),
      ),
    ).rejects.toThrow(
      "Only the New Security Case setting has a priority to choose.",
    );

    // The row updated is another event's.
    otherEventRows = 1;
    await expect(
      service.onBeforeUpdate(
        updateBy({ minimumSecurityCasePriority: SecurityCasePriority.Low }),
      ),
    ).rejects.toThrow(
      "Only the New Security Case setting has a priority to choose.",
    );
  });

  test("an update of the New Security Case row, or of channels only, goes through", async () => {
    await expect(
      service.onBeforeUpdate(
        updateBy({ minimumSecurityCasePriority: SecurityCasePriority.Low }),
      ),
    ).resolves.toEqual(expect.objectContaining({ carryForward: null }));

    await expect(
      service.onBeforeUpdate(updateBy({ alertByEmail: false })),
    ).resolves.toBeDefined();
    // A channel switch asks nothing of the database.
    expect(UserNotificationSettingService.countBy).toHaveBeenCalledTimes(1);
  });
});
