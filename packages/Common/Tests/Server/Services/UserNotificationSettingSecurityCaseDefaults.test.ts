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
import SecurityCasePriorityLevel from "../../../Types/SecurityCase/SecurityCasePriorityLevel";
import { testPriorityId } from "../../Helpers/SecurityCaseValues";
import { stubSecurityCaseValues } from "../../Helpers/SecurityCaseValuesStub";
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
 *   3. a setting's priority choice is one of its project's case priorities,
 *      and only the New Security Case setting has one - judged, on an
 *      update, by the rows the update writes (findRowsAndHoldUpdateToThem),
 *      never by a read of its query.
 */

// A priority no project in these tests has.
const UNKNOWN_PRIORITY_ID: ObjectID = new ObjectID(
  "c1000000-0000-4000-8000-0000000000ff",
);

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

  /*
   * The events of the rows an update writes, as findRowsAndHoldUpdateToThem
   * reads them - the rows the caller may write that the update names, the
   * update held to them.
   */
  let eventsWritten: Array<NotificationSettingEventType>;

  beforeEach(() => {
    // The project's priorities: a new project's.
    stubSecurityCaseValues();
    eventsWritten = [
      NotificationSettingEventType.SEND_SECURITY_CASE_OPENED_NOTIFICATION,
    ];

    // The duplicate check on create: no row of the event yet.
    jest
      .spyOn(UserNotificationSettingService, "countBy")
      .mockResolvedValue(new PositiveNumber(0));

    jest
      .spyOn(UserNotificationSettingService, "findRowsAndHoldUpdateToThem")
      .mockImplementation(async (): Promise<Array<UserNotificationSetting>> => {
        return eventsWritten.map(
          (
            eventType: NotificationSettingEventType,
          ): UserNotificationSetting => {
            const row: UserNotificationSetting = new UserNotificationSetting();
            row._id = ROW_ID.toString();
            row.eventType = eventType;
            row.projectId = PROJECT_ID;
            return row;
          },
        );
      });
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
          minimumSecurityCasePriorityId: testPriorityId(
            SecurityCasePriorityLevel.Medium,
          ),
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

  test("a priority that is none of the project's is refused", async () => {
    await expect(
      service.onBeforeCreate(
        createBy({
          eventType:
            NotificationSettingEventType.SEND_SECURITY_CASE_OPENED_NOTIFICATION,
          minimumSecurityCasePriorityId: UNKNOWN_PRIORITY_ID,
        }),
      ),
    ).rejects.toThrow(BadDataException);

    await expect(
      service.onBeforeUpdate(
        updateBy({ minimumSecurityCasePriorityId: UNKNOWN_PRIORITY_ID }),
      ),
    ).rejects.toThrow("Choose one of this project's security case priorities.");

    // Named by the relation, the same.
    await expect(
      service.onBeforeUpdate(
        updateBy({
          minimumSecurityCasePriority: { _id: UNKNOWN_PRIORITY_ID.toString() },
        }),
      ),
    ).rejects.toThrow("Choose one of this project's security case priorities.");
  });

  test("the two spellings of the choice must name one priority", async () => {
    await expect(
      service.onBeforeUpdate(
        updateBy({
          minimumSecurityCasePriorityId: testPriorityId(
            SecurityCasePriorityLevel.Low,
          ),
          minimumSecurityCasePriority: {
            _id: testPriorityId(SecurityCasePriorityLevel.High).toString(),
          },
        }),
      ),
    ).rejects.toThrow(BadDataException);
  });

  test("no other setting has a priority to choose", async () => {
    await expect(
      service.onBeforeCreate(
        createBy({
          eventType:
            NotificationSettingEventType.SEND_SECURITY_CASE_ASSIGNED_NOTIFICATION,
          minimumSecurityCasePriorityId: testPriorityId(
            SecurityCasePriorityLevel.Low,
          ),
        }),
      ),
    ).rejects.toThrow(
      "Only the New Security Case setting has a priority to choose.",
    );

    // The row updated is another event's.
    eventsWritten = [
      NotificationSettingEventType.SEND_SECURITY_CASE_ASSIGNED_NOTIFICATION,
    ];
    await expect(
      service.onBeforeUpdate(
        updateBy({
          minimumSecurityCasePriorityId: testPriorityId(
            SecurityCasePriorityLevel.Low,
          ),
        }),
      ),
    ).rejects.toThrow(
      "Only the New Security Case setting has a priority to choose.",
    );

    // One row of another event among those the update writes is enough.
    eventsWritten = [
      NotificationSettingEventType.SEND_SECURITY_CASE_OPENED_NOTIFICATION,
      NotificationSettingEventType.SEND_SECURITY_PLAYBOOK_APPROVAL_NOTIFICATION,
    ];
    await expect(
      service.onBeforeUpdate(
        updateBy({
          minimumSecurityCasePriorityId: testPriorityId(
            SecurityCasePriorityLevel.Low,
          ),
        }),
      ),
    ).rejects.toThrow(
      "Only the New Security Case setting has a priority to choose.",
    );
  });

  test("judges the rows the update writes: the update itself is handed to findRowsAndHoldUpdateToThem", async () => {
    const update: UpdateBy<UserNotificationSetting> = updateBy({
      minimumSecurityCasePriorityId: testPriorityId(
            SecurityCasePriorityLevel.High,
          ),
    });

    await service.onBeforeUpdate(update);

    expect(
      UserNotificationSettingService.findRowsAndHoldUpdateToThem,
    ).toHaveBeenCalledTimes(1);
    // The update itself, so it is held to the rows read.
    expect(
      jest.mocked(UserNotificationSettingService.findRowsAndHoldUpdateToThem)
        .mock.calls[0]![0],
    ).toBe(update);
    expect(
      jest.mocked(UserNotificationSettingService.findRowsAndHoldUpdateToThem)
        .mock.calls[0]![1],
    ).toEqual({ eventType: true, projectId: true });
    // No count of its own over the update's query.
    expect(UserNotificationSettingService.countBy).not.toHaveBeenCalled();
  });

  test("an update that writes no row goes through", async () => {
    eventsWritten = [];

    await expect(
      service.onBeforeUpdate(
        updateBy({
          minimumSecurityCasePriorityId: testPriorityId(
            SecurityCasePriorityLevel.Low,
          ),
        }),
      ),
    ).resolves.toEqual(expect.objectContaining({ carryForward: null }));
  });

  test("an update of the New Security Case row, or of channels only, goes through", async () => {
    await expect(
      service.onBeforeUpdate(
        updateBy({
          minimumSecurityCasePriorityId: testPriorityId(
            SecurityCasePriorityLevel.Low,
          ),
        }),
      ),
    ).resolves.toEqual(expect.objectContaining({ carryForward: null }));

    await expect(
      service.onBeforeUpdate(updateBy({ alertByEmail: false })),
    ).resolves.toBeDefined();
    // A channel switch asks nothing of the database.
    expect(
      UserNotificationSettingService.findRowsAndHoldUpdateToThem,
    ).toHaveBeenCalledTimes(1);
  });
});
