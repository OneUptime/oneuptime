import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it, and DatabaseService - the base class
 * of every service below - imports it.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import UserOnCallShiftReminderService from "../../../Server/Services/UserOnCallShiftReminderService";
import UserOnCallShiftReminderLogService from "../../../Server/Services/UserOnCallShiftReminderLogService";
import UserOnCallShiftReminder, {
  MAX_MINUTES_BEFORE_SHIFT,
  MIN_MINUTES_BEFORE_SHIFT,
} from "../../../Models/DatabaseModels/UserOnCallShiftReminder";
import UserOnCallShiftReminderLog, {
  UserOnCallShiftReminderLogKind,
} from "../../../Models/DatabaseModels/UserOnCallShiftReminderLog";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import {
  OnCreate,
  OnDelete,
  OnUpdate,
} from "../../../Server/Types/Database/Hooks";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { getJestSpyOn } from "../../Spy";

/*
 * Fixture overrides may set a column to undefined on purpose (a missing
 * field is the case under test), which Partial<Model> forbids under
 * exactOptionalPropertyTypes.
 */
type Loose<TModel> = { [K in keyof TModel]?: TModel[K] | undefined };

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const OTHER_USER_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const SCHEDULE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const ROW_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");

type ReminderHooks = {
  onBeforeCreate: (
    createBy: CreateBy<UserOnCallShiftReminder>,
  ) => Promise<OnCreate<UserOnCallShiftReminder>>;
  onBeforeUpdate: (
    updateBy: UpdateBy<UserOnCallShiftReminder>,
  ) => Promise<OnUpdate<UserOnCallShiftReminder>>;
};

type LogHooks = {
  onBeforeCreate: (
    createBy: CreateBy<UserOnCallShiftReminderLog>,
  ) => Promise<OnCreate<UserOnCallShiftReminderLog>>;
  onBeforeUpdate: (
    updateBy: UpdateBy<UserOnCallShiftReminderLog>,
  ) => Promise<OnUpdate<UserOnCallShiftReminderLog>>;
  onBeforeDelete: (
    deleteBy: DeleteBy<UserOnCallShiftReminderLog>,
  ) => Promise<OnDelete<UserOnCallShiftReminderLog>>;
};

const reminderHooks: ReminderHooks =
  UserOnCallShiftReminderService as unknown as ReminderHooks;

const logHooks: LogHooks =
  UserOnCallShiftReminderLogService as unknown as LogHooks;

const validateLead: (value: unknown) => number = (value: unknown): number => {
  return (
    UserOnCallShiftReminderService.constructor as unknown as {
      validateMinutesBeforeShift: (value: unknown) => number;
    }
  ).validateMinutesBeforeShift(value);
};

const logStatics: {
  truncateToMinute: (date: Date) => Date;
  validateMinutesBeforeShift: (value: unknown) => number;
} = UserOnCallShiftReminderLogService.constructor as unknown as {
  truncateToMinute: (date: Date) => Date;
  validateMinutesBeforeShift: (value: unknown) => number;
};

function reminder(
  overrides: Loose<UserOnCallShiftReminder> = {},
): UserOnCallShiftReminder {
  const model: UserOnCallShiftReminder = new UserOnCallShiftReminder();
  model.projectId = PROJECT_ID;
  model.userId = USER_ID;
  model.minutesBeforeShift = 60;
  Object.assign(model, overrides);
  return model;
}

function userCreate<TModel extends BaseModel>(
  data: TModel,
  props: Record<string, unknown> = {},
): CreateBy<TModel> {
  return {
    data,
    props: { isRoot: false, userId: USER_ID, tenantId: PROJECT_ID, ...props },
  } as unknown as CreateBy<TModel>;
}

function rootCreate<TModel extends BaseModel>(
  data: TModel,
  props: Record<string, unknown> = {},
): CreateBy<TModel> {
  return {
    data,
    props: { isRoot: true, ...props },
  } as unknown as CreateBy<TModel>;
}

function update<TModel extends BaseModel>(
  data: Loose<TModel>,
  isRoot: boolean = false,
): UpdateBy<TModel> {
  return {
    query: { _id: ROW_ID },
    data,
    props: { isRoot },
    limit: 1,
    skip: 0,
  } as unknown as UpdateBy<TModel>;
}

function noDuplicates(): jest.SpyInstance {
  return getJestSpyOn(
    UserOnCallShiftReminderService,
    "countBy",
  ).mockResolvedValue(new PositiveNumber(0));
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("UserOnCallShiftReminderService.onBeforeCreate", () => {
  test("accepts a well-formed reminder from its owner", async () => {
    noDuplicates();

    const onCreate: OnCreate<UserOnCallShiftReminder> =
      await reminderHooks.onBeforeCreate(userCreate(reminder()));

    expect(onCreate.createBy.data.projectId).toBe(PROJECT_ID);
    expect(onCreate.createBy.data.userId).toBe(USER_ID);
    expect(onCreate.createBy.data.minutesBeforeShift).toBe(60);
  });

  test("defaults the owner to the session user so the page can post just the lead", async () => {
    noDuplicates();

    const onCreate: OnCreate<UserOnCallShiftReminder> =
      await reminderHooks.onBeforeCreate(
        userCreate(reminder({ userId: undefined })),
      );

    expect(onCreate.createBy.data.userId).toBe(USER_ID);
  });

  test("does not override an explicit owner (ownership is enforced downstream)", async () => {
    noDuplicates();

    const onCreate: OnCreate<UserOnCallShiftReminder> =
      await reminderHooks.onBeforeCreate(
        userCreate(reminder({ userId: OTHER_USER_ID })),
      );

    expect(onCreate.createBy.data.userId).toBe(OTHER_USER_ID);
  });

  test("requires an owner when there is no session user either", async () => {
    noDuplicates();

    await expect(
      reminderHooks.onBeforeCreate(rootCreate(reminder({ userId: undefined }))),
    ).rejects.toThrow(BadDataException);
  });

  test("takes the project from the tenant and requires one from somewhere", async () => {
    noDuplicates();

    const onCreate: OnCreate<UserOnCallShiftReminder> =
      await reminderHooks.onBeforeCreate(
        userCreate(reminder({ projectId: undefined }), {
          tenantId: OTHER_PROJECT_ID,
        }),
      );

    expect(onCreate.createBy.data.projectId).toBe(OTHER_PROJECT_ID);

    await expect(
      reminderHooks.onBeforeCreate(
        userCreate(reminder({ projectId: undefined }), {
          tenantId: undefined,
        }),
      ),
    ).rejects.toThrow(BadDataException);
  });

  test("normalises a numeric-string lead the form posted", async () => {
    noDuplicates();

    const onCreate: OnCreate<UserOnCallShiftReminder> =
      await reminderHooks.onBeforeCreate(
        userCreate(
          reminder({ minutesBeforeShift: "1440" as unknown as number }),
        ),
      );

    expect(onCreate.createBy.data.minutesBeforeShift).toBe(1440);
  });

  test("rejects a lead outside 15 minutes ... two weeks, or not a whole number", async () => {
    noDuplicates();

    for (const bad of [
      undefined,
      0,
      14,
      MAX_MINUTES_BEFORE_SHIFT + 1,
      -60,
      30.5,
      Number.NaN,
      "soon" as unknown as number,
    ]) {
      await expect(
        reminderHooks.onBeforeCreate(
          userCreate(reminder({ minutesBeforeShift: bad })),
        ),
      ).rejects.toThrow(BadDataException);
    }
  });

  test("accepts the exact bounds", async () => {
    noDuplicates();

    const min: OnCreate<UserOnCallShiftReminder> =
      await reminderHooks.onBeforeCreate(
        userCreate(reminder({ minutesBeforeShift: MIN_MINUTES_BEFORE_SHIFT })),
      );
    expect(min.createBy.data.minutesBeforeShift).toBe(MIN_MINUTES_BEFORE_SHIFT);

    const max: OnCreate<UserOnCallShiftReminder> =
      await reminderHooks.onBeforeCreate(
        userCreate(reminder({ minutesBeforeShift: MAX_MINUTES_BEFORE_SHIFT })),
      );
    expect(max.createBy.data.minutesBeforeShift).toBe(MAX_MINUTES_BEFORE_SHIFT);
  });

  test("answers a duplicate lead with a message naming it, checked as root on the full key", async () => {
    const countBy: jest.SpyInstance = getJestSpyOn(
      UserOnCallShiftReminderService,
      "countBy",
    ).mockResolvedValue(new PositiveNumber(1));

    await expect(
      reminderHooks.onBeforeCreate(
        userCreate(reminder({ minutesBeforeShift: 60 })),
      ),
    ).rejects.toThrow(/already have a reminder 60 minutes/);

    const call: {
      query: Record<string, unknown>;
      props: { isRoot?: boolean };
    } = countBy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      props: { isRoot?: boolean };
    };

    expect(call.query).toEqual({
      projectId: PROJECT_ID,
      userId: USER_ID,
      minutesBeforeShift: 60,
    });
    expect(call.props.isRoot).toBe(true);
  });

  test("checks duplicates only after the lead has been validated (no NaN queries)", async () => {
    const countBy: jest.SpyInstance = noDuplicates();

    await expect(
      reminderHooks.onBeforeCreate(
        userCreate(reminder({ minutesBeforeShift: 3 })),
      ),
    ).rejects.toThrow(BadDataException);

    expect(countBy).not.toHaveBeenCalled();
  });
});

describe("UserOnCallShiftReminderService.onBeforeUpdate", () => {
  test("validates and normalises the lead when present", async () => {
    const onUpdate: OnUpdate<UserOnCallShiftReminder> =
      await reminderHooks.onBeforeUpdate(
        update<UserOnCallShiftReminder>({
          minutesBeforeShift: "120" as unknown as number,
        }),
      );

    expect(onUpdate.updateBy.data.minutesBeforeShift).toBe(120);

    await expect(
      reminderHooks.onBeforeUpdate(
        update<UserOnCallShiftReminder>({ minutesBeforeShift: 5 }),
      ),
    ).rejects.toThrow(BadDataException);
  });

  test("leaves an update without a lead alone", async () => {
    const onUpdate: OnUpdate<UserOnCallShiftReminder> =
      await reminderHooks.onBeforeUpdate(update<UserOnCallShiftReminder>({}));

    expect(onUpdate.updateBy.data).toEqual({});
  });
});

describe("UserOnCallShiftReminderService.validateMinutesBeforeShift", () => {
  test("is the 15 ... 20160 whole-minute rule", () => {
    expect(validateLead(15)).toBe(15);
    expect(validateLead(20160)).toBe(20160);
    expect(validateLead("10080")).toBe(10080);

    for (const bad of [14, 20161, 1.5, "", "x", null, undefined, true, []]) {
      expect(() => {
        return validateLead(bad);
      }).toThrow(BadDataException);
    }
  });
});

describe("UserOnCallShiftReminderLogService", () => {
  function logRow(
    overrides: Loose<UserOnCallShiftReminderLog> = {},
  ): UserOnCallShiftReminderLog {
    const model: UserOnCallShiftReminderLog = new UserOnCallShiftReminderLog();
    model.projectId = PROJECT_ID;
    model.userId = USER_ID;
    model.onCallDutyPolicyScheduleId = SCHEDULE_ID;
    model.shiftStartsAt = new Date("2026-09-01T09:00:00.000Z");
    model.minutesBeforeShift = 60;
    model.kind = UserOnCallShiftReminderLogKind.Reminder;
    Object.assign(model, overrides);
    return model;
  }

  test("refuses non-root writes in every direction", async () => {
    await expect(logHooks.onBeforeCreate(userCreate(logRow()))).rejects.toThrow(
      NotAuthorizedException,
    );

    await expect(
      logHooks.onBeforeUpdate(
        update<UserOnCallShiftReminderLog>({ sentAt: new Date() }, false),
      ),
    ).rejects.toThrow(NotAuthorizedException);

    await expect(
      logHooks.onBeforeDelete({
        query: { _id: ROW_ID },
        props: { isRoot: false },
        limit: 1,
        skip: 0,
      } as unknown as DeleteBy<UserOnCallShiftReminderLog>),
    ).rejects.toThrow(NotAuthorizedException);
  });

  test("lets root update and delete", async () => {
    const onUpdate: OnUpdate<UserOnCallShiftReminderLog> =
      await logHooks.onBeforeUpdate(
        update<UserOnCallShiftReminderLog>({ sentAt: new Date() }, true),
      );
    expect(onUpdate.updateBy.data.sentAt).toBeInstanceOf(Date);

    const onDelete: OnDelete<UserOnCallShiftReminderLog> =
      await logHooks.onBeforeDelete({
        query: { _id: ROW_ID },
        props: { isRoot: true },
        limit: 1,
        skip: 0,
      } as unknown as DeleteBy<UserOnCallShiftReminderLog>);
    expect(onDelete.deleteBy.props.isRoot).toBe(true);
  });

  test("accepts a complete claim row and stamps claimedAt now", async () => {
    const before: number = Date.now();

    const onCreate: OnCreate<UserOnCallShiftReminderLog> =
      await logHooks.onBeforeCreate(rootCreate(logRow()));

    expect(onCreate.createBy.data.claimedAt).toBeInstanceOf(Date);
    expect(onCreate.createBy.data.claimedAt!.getTime()).toBeGreaterThanOrEqual(
      before,
    );
    expect(onCreate.createBy.data.claimedAt!.getTime()).toBeLessThanOrEqual(
      Date.now(),
    );
    expect(onCreate.createBy.data.sentAt).toBeUndefined();
  });

  test("keeps a claimedAt the worker supplied", async () => {
    const claimedAt: Date = new Date("2026-09-01T08:00:00.000Z");

    const onCreate: OnCreate<UserOnCallShiftReminderLog> =
      await logHooks.onBeforeCreate(rootCreate(logRow({ claimedAt })));

    expect(onCreate.createBy.data.claimedAt).toBe(claimedAt);
  });

  test("requires every part of the idempotency key", async () => {
    for (const missing of [
      "userId",
      "onCallDutyPolicyScheduleId",
      "shiftStartsAt",
      "kind",
    ]) {
      await expect(
        logHooks.onBeforeCreate(rootCreate(logRow({ [missing]: undefined }))),
      ).rejects.toThrow(BadDataException);
    }

    await expect(
      logHooks.onBeforeCreate(
        rootCreate(logRow({ projectId: undefined }), { tenantId: undefined }),
      ),
    ).rejects.toThrow(BadDataException);
  });

  test("takes the project from the tenant when the row has none", async () => {
    const onCreate: OnCreate<UserOnCallShiftReminderLog> =
      await logHooks.onBeforeCreate(
        rootCreate(logRow({ projectId: undefined }), {
          tenantId: OTHER_PROJECT_ID,
        }),
      );

    expect(onCreate.createBy.data.projectId).toBe(OTHER_PROJECT_ID);
  });

  test("accepts exactly the three kinds and nothing else", async () => {
    for (const kind of Object.values(UserOnCallShiftReminderLogKind)) {
      await expect(
        logHooks.onBeforeCreate(rootCreate(logRow({ kind }))),
      ).resolves.toBeDefined();
    }

    for (const bad of ["Reminder", "nudge", "", undefined]) {
      await expect(
        logHooks.onBeforeCreate(
          rootCreate(
            logRow({ kind: bad as unknown as UserOnCallShiftReminderLogKind }),
          ),
        ),
      ).rejects.toThrow(BadDataException);
    }
  });

  test("truncates shiftStartsAt to the minute so a start that drifts by seconds collides on the unique key", async () => {
    const onCreate: OnCreate<UserOnCallShiftReminderLog> =
      await logHooks.onBeforeCreate(
        rootCreate(
          logRow({ shiftStartsAt: new Date("2026-09-01T09:00:59.999Z") }),
        ),
      );

    expect(onCreate.createBy.data.shiftStartsAt!.toISOString()).toBe(
      "2026-09-01T09:00:00.000Z",
    );

    const oneSecondLater: OnCreate<UserOnCallShiftReminderLog> =
      await logHooks.onBeforeCreate(
        rootCreate(
          logRow({ shiftStartsAt: new Date("2026-09-01T09:00:01.000Z") }),
        ),
      );

    expect(oneSecondLater.createBy.data.shiftStartsAt!.getTime()).toBe(
      onCreate.createBy.data.shiftStartsAt!.getTime(),
    );
  });

  test("accepts an ISO string for shiftStartsAt", async () => {
    const onCreate: OnCreate<UserOnCallShiftReminderLog> =
      await logHooks.onBeforeCreate(
        rootCreate(
          logRow({
            shiftStartsAt: "2026-09-01T09:30:20.000Z" as unknown as Date,
          }),
        ),
      );

    expect(onCreate.createBy.data.shiftStartsAt).toBeInstanceOf(Date);
    expect(onCreate.createBy.data.shiftStartsAt!.toISOString()).toBe(
      "2026-09-01T09:30:00.000Z",
    );
  });

  test("defaults minutesBeforeShift to 0 for change notices and rejects junk", async () => {
    const catchUp: OnCreate<UserOnCallShiftReminderLog> =
      await logHooks.onBeforeCreate(
        rootCreate(
          logRow({
            kind: UserOnCallShiftReminderLogKind.CatchUp,
            minutesBeforeShift: undefined,
          }),
        ),
      );

    expect(catchUp.createBy.data.minutesBeforeShift).toBe(0);

    const asString: OnCreate<UserOnCallShiftReminderLog> =
      await logHooks.onBeforeCreate(
        rootCreate(logRow({ minutesBeforeShift: "15" as unknown as number })),
      );

    expect(asString.createBy.data.minutesBeforeShift).toBe(15);

    for (const bad of [-1, 2.5, "x"]) {
      await expect(
        logHooks.onBeforeCreate(
          rootCreate(logRow({ minutesBeforeShift: bad as unknown as number })),
        ),
      ).rejects.toThrow(BadDataException);
    }
  });

  test("truncateToMinute zeroes seconds and milliseconds and is idempotent", () => {
    const truncated: Date = logStatics.truncateToMinute(
      new Date("2026-09-01T09:07:45.678Z"),
    );

    expect(truncated.toISOString()).toBe("2026-09-01T09:07:00.000Z");
    expect(logStatics.truncateToMinute(truncated).getTime()).toBe(
      truncated.getTime(),
    );
    expect(
      logStatics
        .truncateToMinute(new Date("2026-09-01T09:07:00.000Z"))
        .toISOString(),
    ).toBe("2026-09-01T09:07:00.000Z");
  });

  test("validateMinutesBeforeShift accepts 0 and whole positive minutes only", () => {
    expect(logStatics.validateMinutesBeforeShift(undefined)).toBe(0);
    expect(logStatics.validateMinutesBeforeShift(null)).toBe(0);
    expect(logStatics.validateMinutesBeforeShift(0)).toBe(0);
    expect(logStatics.validateMinutesBeforeShift(10080)).toBe(10080);
    expect(logStatics.validateMinutesBeforeShift("60")).toBe(60);

    for (const bad of [-1, 0.5, "", "abc", true]) {
      expect(() => {
        return logStatics.validateMinutesBeforeShift(bad);
      }).toThrow(BadDataException);
    }
  });
});
