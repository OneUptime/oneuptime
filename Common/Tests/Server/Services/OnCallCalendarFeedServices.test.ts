import fs from "fs";
import path from "path";
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

import UserOnCallCalendarFeedService from "../../../Server/Services/UserOnCallCalendarFeedService";
import OnCallDutyPolicyScheduleCalendarFeedService, {
  MAX_MINIMUM_GAP_MINUTES,
  MIN_MINIMUM_GAP_MINUTES,
} from "../../../Server/Services/OnCallDutyPolicyScheduleCalendarFeedService";
import ProjectOnCallCalendarFeedService from "../../../Server/Services/ProjectOnCallCalendarFeedService";
import OnCallDutyPolicyScheduleService from "../../../Server/Services/OnCallDutyPolicyScheduleService";
import UserOnCallCalendarFeed from "../../../Models/DatabaseModels/UserOnCallCalendarFeed";
import OnCallDutyPolicyScheduleCalendarFeed from "../../../Models/DatabaseModels/OnCallDutyPolicyScheduleCalendarFeed";
import ProjectOnCallCalendarFeed from "../../../Models/DatabaseModels/ProjectOnCallCalendarFeed";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import CalendarFeedToken, {
  CalendarFeedRotation,
} from "../../../Server/Utils/OnCall/CalendarFeedToken";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import {
  DEFAULT_FUTURE_DAYS,
  DEFAULT_PAST_DAYS,
  MAX_FUTURE_DAYS,
  MAX_PAST_DAYS,
  MIN_FUTURE_DAYS,
  PREVIOUS_TOKEN_GRACE_DAYS,
} from "../../../Types/OnCallDutyPolicy/CalendarFeedWindow";
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

/*
 * The three calendar-feed services share one contract: the token is minted
 * server-side and never chosen by a request, the window is clamped on every
 * write, uniqueness violations become messages, and rotation keeps the old
 * hash in a 30-day grace slot. The hooks are protected, so they are invoked
 * through a narrowed view of the singleton (the ThreatIntelFeedService test
 * discipline); every database call underneath is spied.
 */

const SERVICES_DIRECTORY: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "Server",
  "Services",
);

const SERVICES_INDEX: string = fs.readFileSync(
  path.join(SERVICES_DIRECTORY, "Index.ts"),
  "utf8",
);

const NEW_SERVICE_NAMES: Array<string> = [
  "UserOnCallCalendarFeedService",
  "OnCallDutyPolicyScheduleCalendarFeedService",
  "ProjectOnCallCalendarFeedService",
  "UserOnCallShiftReminderService",
  "UserOnCallShiftReminderLogService",
];

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const SCHEDULE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const FEED_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");
const FEED_ID_2: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);

const DAY_MS: number = 24 * 60 * 60 * 1000;

type HookCaller<TModel extends BaseModel> = {
  onBeforeCreate: (createBy: CreateBy<TModel>) => Promise<OnCreate<TModel>>;
  onBeforeUpdate: (updateBy: UpdateBy<TModel>) => Promise<OnUpdate<TModel>>;
};

const userFeedHooks: HookCaller<UserOnCallCalendarFeed> =
  UserOnCallCalendarFeedService as unknown as HookCaller<UserOnCallCalendarFeed>;

const scheduleFeedHooks: HookCaller<OnCallDutyPolicyScheduleCalendarFeed> =
  OnCallDutyPolicyScheduleCalendarFeedService as unknown as HookCaller<OnCallDutyPolicyScheduleCalendarFeed>;

const projectFeedHooks: HookCaller<ProjectOnCallCalendarFeed> =
  ProjectOnCallCalendarFeedService as unknown as HookCaller<ProjectOnCallCalendarFeed>;

function rootCreate<TModel extends BaseModel>(
  data: TModel,
  props: Record<string, unknown> = {},
): CreateBy<TModel> {
  return {
    data,
    props: { isRoot: true, ...props },
  } as unknown as CreateBy<TModel>;
}

function userCreate<TModel extends BaseModel>(
  data: TModel,
  props: Record<string, unknown> = {},
): CreateBy<TModel> {
  return {
    data,
    props: {
      isRoot: false,
      userId: USER_ID,
      tenantId: PROJECT_ID,
      ...props,
    },
  } as unknown as CreateBy<TModel>;
}

function update<TModel extends BaseModel>(
  data: Loose<TModel>,
  isRoot: boolean = false,
): UpdateBy<TModel> {
  return {
    query: { _id: FEED_ID },
    data,
    props: { isRoot },
    limit: 1,
    skip: 0,
  } as unknown as UpdateBy<TModel>;
}

function expectConsistentTokenColumns(data: {
  token?: string | undefined;
  tokenHash?: string | undefined;
  tokenHint?: string | undefined;
  rotatedAt?: Date | undefined;
  previousTokenHash?: string | undefined;
  previousTokenExpiresAt?: Date | undefined;
}): void {
  expect(CalendarFeedToken.isValidShape(data.token)).toBe(true);
  expect(data.tokenHash).toBe(CalendarFeedToken.hash(data.token as string));
  expect(data.tokenHint).toBe(CalendarFeedToken.hint(data.token as string));
  expect(data.rotatedAt).toBeInstanceOf(Date);
  expect(data.previousTokenHash).toBeUndefined();
  expect(data.previousTokenExpiresAt).toBeUndefined();
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Service wiring", () => {
  test.each(NEW_SERVICE_NAMES)("%s exists on disk", (serviceName: string) => {
    expect(
      fs.existsSync(path.join(SERVICES_DIRECTORY, `${serviceName}.ts`)),
    ).toBe(true);
  });

  test.each(NEW_SERVICE_NAMES)(
    "%s is registered in Server/Services/Index.ts",
    (serviceName: string) => {
      /*
       * That array is what boot-time createTables() iterates. An unregistered
       * service has no table, however correct the model is.
       */
      expect(SERVICES_INDEX).toContain(
        `import ${serviceName} from "./${serviceName}";`,
      );
      expect(SERVICES_INDEX).toMatch(
        new RegExp(`^\\s{2}${serviceName},$`, "m"),
      );
    },
  );

  test("registers each new service exactly once", () => {
    for (const serviceName of NEW_SERVICE_NAMES) {
      const occurrences: number = (
        SERVICES_INDEX.match(new RegExp(`^\\s{2}${serviceName},$`, "gm")) || []
      ).length;

      expect({ serviceName, occurrences }).toEqual({
        serviceName,
        occurrences: 1,
      });
    }
  });
});

describe("UserOnCallCalendarFeedService.onBeforeCreate", () => {
  function feed(
    overrides: Loose<UserOnCallCalendarFeed> = {},
  ): UserOnCallCalendarFeed {
    const model: UserOnCallCalendarFeed = new UserOnCallCalendarFeed();
    model.projectId = PROJECT_ID;
    model.userId = USER_ID;
    Object.assign(model, overrides);
    return model;
  }

  test("refuses a non-root create even with a valid session", async () => {
    await expect(
      userFeedHooks.onBeforeCreate(userCreate(feed())),
    ).rejects.toThrow(NotAuthorizedException);
  });

  test("requires a project and a user", async () => {
    await expect(
      userFeedHooks.onBeforeCreate(rootCreate(feed({ projectId: undefined }))),
    ).rejects.toThrow(BadDataException);

    await expect(
      userFeedHooks.onBeforeCreate(rootCreate(feed({ userId: undefined }))),
    ).rejects.toThrow(BadDataException);
  });

  test("takes the project from the tenant when the row does not carry one", async () => {
    const onCreate: OnCreate<UserOnCallCalendarFeed> =
      await userFeedHooks.onBeforeCreate(
        rootCreate(feed({ projectId: undefined }), {
          tenantId: OTHER_PROJECT_ID,
        }),
      );

    expect(onCreate.createBy.data.projectId).toBe(OTHER_PROJECT_ID);
  });

  test("mints a consistent token set when none is supplied", async () => {
    const onCreate: OnCreate<UserOnCallCalendarFeed> =
      await userFeedHooks.onBeforeCreate(rootCreate(feed()));

    expectConsistentTokenColumns(onCreate.createBy.data);
  });

  test("derives hash and hint from a token the caller minted", async () => {
    const token: string = CalendarFeedToken.mint();

    const onCreate: OnCreate<UserOnCallCalendarFeed> =
      await userFeedHooks.onBeforeCreate(
        rootCreate(feed({ token, tokenHash: "not-the-hash", tokenHint: "zz" })),
      );

    expect(onCreate.createBy.data.token).toBe(token);
    expect(onCreate.createBy.data.tokenHash).toBe(
      CalendarFeedToken.hash(token),
    );
    expect(onCreate.createBy.data.tokenHint).toBe(
      CalendarFeedToken.hint(token),
    );
  });

  test("replaces a malformed caller token and never trusts a bare hash", async () => {
    const onCreate: OnCreate<UserOnCallCalendarFeed> =
      await userFeedHooks.onBeforeCreate(
        rootCreate(feed({ token: "too-short", tokenHash: "chosen-hash" })),
      );

    expect(onCreate.createBy.data.token).not.toBe("too-short");
    expect(onCreate.createBy.data.tokenHash).not.toBe("chosen-hash");
    expectConsistentTokenColumns(onCreate.createBy.data);
  });

  test("never carries a grace-period hash into a brand-new row", async () => {
    const onCreate: OnCreate<UserOnCallCalendarFeed> =
      await userFeedHooks.onBeforeCreate(
        rootCreate(
          feed({
            previousTokenHash: "stale",
            previousTokenExpiresAt: new Date(),
          }),
        ),
      );

    expect(onCreate.createBy.data.previousTokenHash).toBeUndefined();
    expect(onCreate.createBy.data.previousTokenExpiresAt).toBeUndefined();
  });

  test("applies the window defaults when nothing is supplied", async () => {
    const onCreate: OnCreate<UserOnCallCalendarFeed> =
      await userFeedHooks.onBeforeCreate(rootCreate(feed()));

    expect(onCreate.createBy.data.pastDays).toBe(DEFAULT_PAST_DAYS);
    expect(onCreate.createBy.data.futureDays).toBe(DEFAULT_FUTURE_DAYS);
  });

  test("clamps the window into the CalendarFeedWindow bounds", async () => {
    const tooBig: OnCreate<UserOnCallCalendarFeed> =
      await userFeedHooks.onBeforeCreate(
        rootCreate(feed({ pastDays: 999, futureDays: 9999 })),
      );

    expect(tooBig.createBy.data.pastDays).toBe(MAX_PAST_DAYS);
    expect(tooBig.createBy.data.futureDays).toBe(MAX_FUTURE_DAYS);

    const tooSmall: OnCreate<UserOnCallCalendarFeed> =
      await userFeedHooks.onBeforeCreate(
        rootCreate(feed({ pastDays: -5, futureDays: 1 })),
      );

    expect(tooSmall.createBy.data.pastDays).toBe(0);
    expect(tooSmall.createBy.data.futureDays).toBe(MIN_FUTURE_DAYS);

    const numericStrings: OnCreate<UserOnCallCalendarFeed> =
      await userFeedHooks.onBeforeCreate(
        rootCreate(
          feed({
            pastDays: "10" as unknown as number,
            futureDays: "45" as unknown as number,
          }),
        ),
      );

    expect(numericStrings.createBy.data.pastDays).toBe(10);
    expect(numericStrings.createBy.data.futureDays).toBe(45);
  });
});

describe("UserOnCallCalendarFeedService.onBeforeUpdate", () => {
  test("clamps pastDays and futureDays when present", async () => {
    const onUpdate: OnUpdate<UserOnCallCalendarFeed> =
      await userFeedHooks.onBeforeUpdate(
        update<UserOnCallCalendarFeed>({ pastDays: 500, futureDays: 3 }),
      );

    expect(onUpdate.updateBy.data.pastDays).toBe(MAX_PAST_DAYS);
    expect(onUpdate.updateBy.data.futureDays).toBe(MIN_FUTURE_DAYS);
  });

  test("leaves an update that does not touch the window alone", async () => {
    const onUpdate: OnUpdate<UserOnCallCalendarFeed> =
      await userFeedHooks.onBeforeUpdate(
        update<UserOnCallCalendarFeed>({ isEnabled: false }),
      );

    expect(onUpdate.updateBy.data).toEqual({ isEnabled: false });
    expect(onUpdate.updateBy.data.pastDays).toBeUndefined();
    expect(onUpdate.updateBy.data.futureDays).toBeUndefined();
  });

  test("accepts in-range values unchanged", async () => {
    const onUpdate: OnUpdate<UserOnCallCalendarFeed> =
      await userFeedHooks.onBeforeUpdate(
        update<UserOnCallCalendarFeed>({ pastDays: 7, futureDays: 120 }),
      );

    expect(onUpdate.updateBy.data.pastDays).toBe(7);
    expect(onUpdate.updateBy.data.futureDays).toBe(120);
  });
});

describe("UserOnCallCalendarFeedService.createForUser", () => {
  test("creates as root with a freshly minted token and returns the plaintext once", async () => {
    const create: jest.SpyInstance = getJestSpyOn(
      UserOnCallCalendarFeedService,
      "create",
    ).mockImplementation(async (createBy: CreateBy<UserOnCallCalendarFeed>) => {
      const created: UserOnCallCalendarFeed = createBy.data;
      created.id = FEED_ID;
      return created;
    });

    const result: {
      feed: UserOnCallCalendarFeed;
      minted: { token: string; tokenHash: string; tokenHint: string };
    } = await UserOnCallCalendarFeedService.createForUser({
      projectId: PROJECT_ID,
      userId: USER_ID,
    });

    expect(create).toHaveBeenCalledTimes(1);

    const createBy: CreateBy<UserOnCallCalendarFeed> = create.mock
      .calls[0]![0] as CreateBy<UserOnCallCalendarFeed>;

    expect(createBy.props.isRoot).toBe(true);
    expect(createBy.data.projectId).toBe(PROJECT_ID);
    expect(createBy.data.userId).toBe(USER_ID);
    expect(createBy.data.token).toBe(result.minted.token);
    expect(CalendarFeedToken.isValidShape(result.minted.token)).toBe(true);
    expect(result.minted.tokenHash).toBe(
      CalendarFeedToken.hash(result.minted.token),
    );
    expect(result.minted.tokenHint).toBe(
      CalendarFeedToken.hint(result.minted.token),
    );
    expect(result.feed.id?.toString()).toBe(FEED_ID.toString());
  });
});

/*
 * rotateTokenById has the same body in all three services; the table below
 * drives one set of assertions over each so a divergence shows up by name.
 */
type RotatableService = {
  findOneBy: (...args: Array<unknown>) => Promise<unknown>;
  updateOneById: (...args: Array<unknown>) => Promise<number>;
  rotateTokenById: (data: { id: ObjectID }) => Promise<CalendarFeedRotation>;
};

const ROTATABLE: Array<[string, RotatableService]> = [
  [
    "UserOnCallCalendarFeedService",
    UserOnCallCalendarFeedService as unknown as RotatableService,
  ],
  [
    "OnCallDutyPolicyScheduleCalendarFeedService",
    OnCallDutyPolicyScheduleCalendarFeedService as unknown as RotatableService,
  ],
  [
    "ProjectOnCallCalendarFeedService",
    ProjectOnCallCalendarFeedService as unknown as RotatableService,
  ],
];

describe.each(ROTATABLE)(
  "%s.rotateTokenById",
  (_name: string, service: RotatableService) => {
    test("mints a new token, parks the old hash for the grace period and stamps rotatedAt", async () => {
      const before: number = Date.now();

      getJestSpyOn(service, "findOneBy").mockResolvedValue({
        id: FEED_ID,
        _id: FEED_ID.toString(),
        tokenHash: "old-hash",
      });
      const updateOneById: jest.SpyInstance = getJestSpyOn(
        service,
        "updateOneById",
      ).mockResolvedValue(1);

      const rotation: CalendarFeedRotation = await service.rotateTokenById({
        id: FEED_ID,
      });

      expect(updateOneById).toHaveBeenCalledTimes(1);

      const call: {
        id: ObjectID;
        data: Record<string, unknown>;
        props: { isRoot?: boolean };
      } = updateOneById.mock.calls[0]![0] as {
        id: ObjectID;
        data: Record<string, unknown>;
        props: { isRoot?: boolean };
      };

      expect(call.id).toBe(FEED_ID);
      expect(call.props.isRoot).toBe(true);

      expect(CalendarFeedToken.isValidShape(rotation.token)).toBe(true);
      expect(rotation.tokenHash).toBe(CalendarFeedToken.hash(rotation.token));
      expect(rotation.tokenHint).toBe(CalendarFeedToken.hint(rotation.token));
      expect(rotation.tokenHash).not.toBe("old-hash");
      expect(rotation.previousTokenHash).toBe("old-hash");

      expect(call.data["token"]).toBe(rotation.token);
      expect(call.data["tokenHash"]).toBe(rotation.tokenHash);
      expect(call.data["tokenHint"]).toBe(rotation.tokenHint);
      expect(call.data["previousTokenHash"]).toBe("old-hash");
      expect(call.data["rotatedAt"]).toBe(rotation.rotatedAt);

      const rotatedAt: number = (call.data["rotatedAt"] as Date).getTime();
      expect(rotatedAt).toBeGreaterThanOrEqual(before);
      expect(rotatedAt).toBeLessThanOrEqual(Date.now());

      const expiresAt: number = (
        call.data["previousTokenExpiresAt"] as Date
      ).getTime();
      const expectedExpiry: number =
        rotatedAt + PREVIOUS_TOKEN_GRACE_DAYS * DAY_MS;
      // moment.add(days) is DST-aware; allow an hour either side.
      expect(Math.abs(expiresAt - expectedExpiry)).toBeLessThanOrEqual(
        60 * 60 * 1000,
      );
    });

    test("reads only the hash (never the encrypted token) and as root without hooks", async () => {
      const findOneBy: jest.SpyInstance = getJestSpyOn(
        service,
        "findOneBy",
      ).mockResolvedValue({ id: FEED_ID, tokenHash: "old-hash" });
      getJestSpyOn(service, "updateOneById").mockResolvedValue(1);

      await service.rotateTokenById({ id: FEED_ID });

      const call: {
        query: Record<string, unknown>;
        select: Record<string, unknown>;
        props: { isRoot?: boolean; ignoreHooks?: boolean };
      } = findOneBy.mock.calls[0]![0] as {
        query: Record<string, unknown>;
        select: Record<string, unknown>;
        props: { isRoot?: boolean; ignoreHooks?: boolean };
      };

      expect(call.query).toEqual({ _id: FEED_ID });
      expect(call.select).toEqual({ _id: true, tokenHash: true });
      expect(call.select["token"]).toBeUndefined();
      expect(call.props.isRoot).toBe(true);
      expect(call.props.ignoreHooks).toBe(true);
    });

    test("a first mint on a row without a hash parks nothing", async () => {
      getJestSpyOn(service, "findOneBy").mockResolvedValue({
        id: FEED_ID,
        tokenHash: undefined,
      });
      const updateOneById: jest.SpyInstance = getJestSpyOn(
        service,
        "updateOneById",
      ).mockResolvedValue(1);

      const rotation: CalendarFeedRotation = await service.rotateTokenById({
        id: FEED_ID,
      });

      expect(rotation.previousTokenHash).toBeNull();
      expect(rotation.previousTokenExpiresAt).toBeNull();

      const data: Record<string, unknown> = (
        updateOneById.mock.calls[0]![0] as { data: Record<string, unknown> }
      ).data;

      expect(data["previousTokenHash"]).toBeNull();
      expect(data["previousTokenExpiresAt"]).toBeNull();
    });

    test("throws NotFound for a feed that does not exist and writes nothing", async () => {
      getJestSpyOn(service, "findOneBy").mockResolvedValue(null);
      const updateOneById: jest.SpyInstance = getJestSpyOn(
        service,
        "updateOneById",
      ).mockResolvedValue(1);

      await expect(service.rotateTokenById({ id: FEED_ID })).rejects.toThrow(
        NotFoundException,
      );
      expect(updateOneById).not.toHaveBeenCalled();
    });

    test("two rotations never mint the same token", async () => {
      getJestSpyOn(service, "findOneBy").mockResolvedValue({
        id: FEED_ID,
        tokenHash: "old-hash",
      });
      getJestSpyOn(service, "updateOneById").mockResolvedValue(1);

      const first: CalendarFeedRotation = await service.rotateTokenById({
        id: FEED_ID,
      });
      const second: CalendarFeedRotation = await service.rotateTokenById({
        id: FEED_ID,
      });

      expect(first.token).not.toBe(second.token);
      expect(first.tokenHash).not.toBe(second.tokenHash);
    });
  },
);

describe("OnCallDutyPolicyScheduleCalendarFeedService.onBeforeCreate", () => {
  function feed(
    overrides: Loose<OnCallDutyPolicyScheduleCalendarFeed> = {},
  ): OnCallDutyPolicyScheduleCalendarFeed {
    const model: OnCallDutyPolicyScheduleCalendarFeed =
      new OnCallDutyPolicyScheduleCalendarFeed();
    model.projectId = PROJECT_ID;
    model.onCallDutyPolicyScheduleId = SCHEDULE_ID;
    Object.assign(model, overrides);
    return model;
  }

  function scheduleExists(exists: boolean): jest.SpyInstance {
    return getJestSpyOn(
      OnCallDutyPolicyScheduleService,
      "findOneBy",
    ).mockResolvedValue(
      exists ? ({ id: SCHEDULE_ID } as OnCallDutyPolicySchedule) : null,
    );
  }

  function existingFeeds(count: number): jest.SpyInstance {
    return getJestSpyOn(
      OnCallDutyPolicyScheduleCalendarFeedService,
      "countBy",
    ).mockResolvedValue(new PositiveNumber(count));
  }

  test("requires the schedule id", async () => {
    scheduleExists(true);
    existingFeeds(0);

    await expect(
      scheduleFeedHooks.onBeforeCreate(
        userCreate(feed({ onCallDutyPolicyScheduleId: undefined })),
      ),
    ).rejects.toThrow(BadDataException);
  });

  test("requires a project (row or tenant)", async () => {
    scheduleExists(true);
    existingFeeds(0);

    await expect(
      scheduleFeedHooks.onBeforeCreate(
        userCreate(feed({ projectId: undefined }), { tenantId: undefined }),
      ),
    ).rejects.toThrow(BadDataException);
  });

  test("refuses a schedule that is not in the caller's project", async () => {
    const findOneBy: jest.SpyInstance = scheduleExists(false);
    existingFeeds(0);

    await expect(
      scheduleFeedHooks.onBeforeCreate(userCreate(feed())),
    ).rejects.toThrow(BadDataException);

    // The lookup is by (schedule, project) as root: the FK alone cannot tell.
    const call: {
      query: Record<string, unknown>;
      props: { isRoot?: boolean };
    } = findOneBy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      props: { isRoot?: boolean };
    };

    expect(call.query).toEqual({ _id: SCHEDULE_ID, projectId: PROJECT_ID });
    expect(call.props.isRoot).toBe(true);
  });

  test("scopes the schedule lookup to the tenant when the row has no projectId", async () => {
    const findOneBy: jest.SpyInstance = scheduleExists(true);
    existingFeeds(0);

    const onCreate: OnCreate<OnCallDutyPolicyScheduleCalendarFeed> =
      await scheduleFeedHooks.onBeforeCreate(
        userCreate(feed({ projectId: undefined }), {
          tenantId: OTHER_PROJECT_ID,
        }),
      );

    expect(onCreate.createBy.data.projectId).toBe(OTHER_PROJECT_ID);
    expect(
      (findOneBy.mock.calls[0]![0] as { query: Record<string, unknown> }).query,
    ).toEqual({ _id: SCHEDULE_ID, projectId: OTHER_PROJECT_ID });
  });

  test("refuses a second feed for the same schedule with a readable message", async () => {
    scheduleExists(true);
    const countBy: jest.SpyInstance = existingFeeds(1);

    await expect(
      scheduleFeedHooks.onBeforeCreate(userCreate(feed())),
    ).rejects.toThrow(/already has a shared calendar feed/);

    expect(
      (countBy.mock.calls[0]![0] as { query: Record<string, unknown> }).query,
    ).toEqual({ onCallDutyPolicyScheduleId: SCHEDULE_ID });
  });

  test("mints the token for a non-root (permission-checked) publish", async () => {
    scheduleExists(true);
    existingFeeds(0);

    const onCreate: OnCreate<OnCallDutyPolicyScheduleCalendarFeed> =
      await scheduleFeedHooks.onBeforeCreate(userCreate(feed()));

    expectConsistentTokenColumns(onCreate.createBy.data);
  });

  test("ignores a token a non-root request tried to choose", async () => {
    scheduleExists(true);
    existingFeeds(0);

    const chosen: string = CalendarFeedToken.mint();

    const onCreate: OnCreate<OnCallDutyPolicyScheduleCalendarFeed> =
      await scheduleFeedHooks.onBeforeCreate(
        userCreate(
          feed({
            token: chosen,
            tokenHash: CalendarFeedToken.hash(chosen),
            tokenHint: CalendarFeedToken.hint(chosen),
          }),
        ),
      );

    expect(onCreate.createBy.data.token).not.toBe(chosen);
    expect(onCreate.createBy.data.tokenHash).not.toBe(
      CalendarFeedToken.hash(chosen),
    );
    expectConsistentTokenColumns(onCreate.createBy.data);
  });

  test("honours a token a ROOT caller minted (so the API can answer with the URL)", async () => {
    scheduleExists(true);
    existingFeeds(0);

    const minted: string = CalendarFeedToken.mint();

    const onCreate: OnCreate<OnCallDutyPolicyScheduleCalendarFeed> =
      await scheduleFeedHooks.onBeforeCreate(
        rootCreate(feed({ token: minted })),
      );

    expect(onCreate.createBy.data.token).toBe(minted);
    expect(onCreate.createBy.data.tokenHash).toBe(
      CalendarFeedToken.hash(minted),
    );
  });

  test("applies window defaults and clamps, and bounds the gap threshold", async () => {
    scheduleExists(true);
    existingFeeds(0);

    const defaults: OnCreate<OnCallDutyPolicyScheduleCalendarFeed> =
      await scheduleFeedHooks.onBeforeCreate(userCreate(feed()));

    expect(defaults.createBy.data.pastDays).toBe(DEFAULT_PAST_DAYS);
    expect(defaults.createBy.data.futureDays).toBe(DEFAULT_FUTURE_DAYS);
    expect(defaults.createBy.data.minimumGapMinutes).toBeUndefined();

    const clamped: OnCreate<OnCallDutyPolicyScheduleCalendarFeed> =
      await scheduleFeedHooks.onBeforeCreate(
        userCreate(
          feed({
            pastDays: 400,
            futureDays: 2,
            minimumGapMinutes: "30" as unknown as number,
          }),
        ),
      );

    expect(clamped.createBy.data.pastDays).toBe(MAX_PAST_DAYS);
    expect(clamped.createBy.data.futureDays).toBe(MIN_FUTURE_DAYS);
    expect(clamped.createBy.data.minimumGapMinutes).toBe(30);

    await expect(
      scheduleFeedHooks.onBeforeCreate(
        userCreate(feed({ minimumGapMinutes: 0 })),
      ),
    ).rejects.toThrow(BadDataException);
  });
});

describe("OnCallDutyPolicyScheduleCalendarFeedService.onBeforeUpdate", () => {
  test("clamps the window and validates the gap threshold when present", async () => {
    const onUpdate: OnUpdate<OnCallDutyPolicyScheduleCalendarFeed> =
      await scheduleFeedHooks.onBeforeUpdate(
        update<OnCallDutyPolicyScheduleCalendarFeed>({
          pastDays: -1,
          futureDays: 1000,
          minimumGapMinutes: 15,
        }),
      );

    expect(onUpdate.updateBy.data.pastDays).toBe(0);
    expect(onUpdate.updateBy.data.futureDays).toBe(MAX_FUTURE_DAYS);
    expect(onUpdate.updateBy.data.minimumGapMinutes).toBe(15);
  });

  test("rejects an out-of-range gap threshold", async () => {
    await expect(
      scheduleFeedHooks.onBeforeUpdate(
        update<OnCallDutyPolicyScheduleCalendarFeed>({
          minimumGapMinutes: MAX_MINIMUM_GAP_MINUTES + 1,
        }),
      ),
    ).rejects.toThrow(BadDataException);

    await expect(
      scheduleFeedHooks.onBeforeUpdate(
        update<OnCallDutyPolicyScheduleCalendarFeed>({
          minimumGapMinutes: 2.5,
        }),
      ),
    ).rejects.toThrow(BadDataException);
  });

  test("leaves a settings-only update alone", async () => {
    const onUpdate: OnUpdate<OnCallDutyPolicyScheduleCalendarFeed> =
      await scheduleFeedHooks.onBeforeUpdate(
        update<OnCallDutyPolicyScheduleCalendarFeed>({
          includeCoverageGaps: true,
          rotateWhenMemberLeaves: true,
        }),
      );

    expect(onUpdate.updateBy.data).toEqual({
      includeCoverageGaps: true,
      rotateWhenMemberLeaves: true,
    });
  });
});

describe("validateMinimumGapMinutes", () => {
  const validators: Array<[string, (value: unknown) => number]> = [
    [
      "OnCallDutyPolicyScheduleCalendarFeedService",
      (value: unknown): number => {
        return (
          OnCallDutyPolicyScheduleCalendarFeedService.constructor as unknown as {
            validateMinimumGapMinutes: (value: unknown) => number;
          }
        ).validateMinimumGapMinutes(value);
      },
    ],
    [
      "ProjectOnCallCalendarFeedService",
      (value: unknown): number => {
        return (
          ProjectOnCallCalendarFeedService.constructor as unknown as {
            validateMinimumGapMinutes: (value: unknown) => number;
          }
        ).validateMinimumGapMinutes(value);
      },
    ],
  ];

  test("publishes sensible bounds", () => {
    expect(MIN_MINIMUM_GAP_MINUTES).toBe(1);
    expect(MAX_MINIMUM_GAP_MINUTES).toBe(7 * 24 * 60);
  });

  test.each(validators)(
    "%s accepts whole minutes inside the bounds, incl. numeric strings",
    (_name: string, validate: (value: unknown) => number) => {
      expect(validate(MIN_MINIMUM_GAP_MINUTES)).toBe(MIN_MINIMUM_GAP_MINUTES);
      expect(validate(MAX_MINIMUM_GAP_MINUTES)).toBe(MAX_MINIMUM_GAP_MINUTES);
      expect(validate(60)).toBe(60);
      expect(validate("90")).toBe(90);
    },
  );

  test.each(validators)(
    "%s rejects everything else",
    (_name: string, validate: (value: unknown) => number) => {
      for (const bad of [
        0,
        -1,
        MAX_MINIMUM_GAP_MINUTES + 1,
        1.5,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        "",
        "abc",
        null,
        undefined,
        true,
        {},
      ]) {
        expect(() => {
          return validate(bad);
        }).toThrow(BadDataException);
      }
    },
  );
});

describe("OnCallDutyPolicyScheduleCalendarFeedService.rotateFeedsForMemberLeave", () => {
  test("rotates every enabled, opted-in feed of the project and returns their ids", async () => {
    const findBy: jest.SpyInstance = getJestSpyOn(
      OnCallDutyPolicyScheduleCalendarFeedService,
      "findBy",
    ).mockResolvedValue([{ id: FEED_ID }, { id: FEED_ID_2 }]);
    const rotate: jest.SpyInstance = getJestSpyOn(
      OnCallDutyPolicyScheduleCalendarFeedService,
      "rotateTokenById",
    ).mockResolvedValue({} as CalendarFeedRotation);

    const rotated: Array<ObjectID> =
      await OnCallDutyPolicyScheduleCalendarFeedService.rotateFeedsForMemberLeave(
        { projectId: PROJECT_ID },
      );

    expect(rotated).toEqual([FEED_ID, FEED_ID_2]);
    expect(rotate).toHaveBeenCalledTimes(2);
    expect(rotate).toHaveBeenNthCalledWith(1, { id: FEED_ID });
    expect(rotate).toHaveBeenNthCalledWith(2, { id: FEED_ID_2 });

    const call: {
      query: Record<string, unknown>;
      props: { isRoot?: boolean };
    } = findBy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      props: { isRoot?: boolean };
    };

    // Disabled or un-flagged feeds are filtered at the query, not in memory.
    expect(call.query).toEqual({
      projectId: PROJECT_ID,
      isEnabled: true,
      rotateWhenMemberLeaves: true,
    });
    expect(call.props.isRoot).toBe(true);
  });

  test("is a no-op when nothing opted in", async () => {
    getJestSpyOn(
      OnCallDutyPolicyScheduleCalendarFeedService,
      "findBy",
    ).mockResolvedValue([]);
    const rotate: jest.SpyInstance = getJestSpyOn(
      OnCallDutyPolicyScheduleCalendarFeedService,
      "rotateTokenById",
    ).mockResolvedValue({} as CalendarFeedRotation);

    await expect(
      OnCallDutyPolicyScheduleCalendarFeedService.rotateFeedsForMemberLeave({
        projectId: PROJECT_ID,
      }),
    ).resolves.toEqual([]);
    expect(rotate).not.toHaveBeenCalled();
  });
});

describe("ProjectOnCallCalendarFeedService.onBeforeCreate", () => {
  function feed(
    overrides: Loose<ProjectOnCallCalendarFeed> = {},
  ): ProjectOnCallCalendarFeed {
    const model: ProjectOnCallCalendarFeed = new ProjectOnCallCalendarFeed();
    model.projectId = PROJECT_ID;
    Object.assign(model, overrides);
    return model;
  }

  function existingFeeds(count: number): jest.SpyInstance {
    return getJestSpyOn(
      ProjectOnCallCalendarFeedService,
      "countBy",
    ).mockResolvedValue(new PositiveNumber(count));
  }

  test("requires a project (row or tenant)", async () => {
    existingFeeds(0);

    await expect(
      projectFeedHooks.onBeforeCreate(
        userCreate(feed({ projectId: undefined }), { tenantId: undefined }),
      ),
    ).rejects.toThrow(BadDataException);

    const onCreate: OnCreate<ProjectOnCallCalendarFeed> =
      await projectFeedHooks.onBeforeCreate(
        userCreate(feed({ projectId: undefined }), {
          tenantId: OTHER_PROJECT_ID,
        }),
      );

    expect(onCreate.createBy.data.projectId).toBe(OTHER_PROJECT_ID);
  });

  test("refuses a second feed for the project", async () => {
    const countBy: jest.SpyInstance = existingFeeds(1);

    await expect(
      projectFeedHooks.onBeforeCreate(userCreate(feed())),
    ).rejects.toThrow(/already has a shared calendar feed/);

    expect(
      (countBy.mock.calls[0]![0] as { query: Record<string, unknown> }).query,
    ).toEqual({ projectId: PROJECT_ID });
  });

  test("mints the token, ignoring one a non-root request chose", async () => {
    existingFeeds(0);

    const chosen: string = CalendarFeedToken.mint();

    const onCreate: OnCreate<ProjectOnCallCalendarFeed> =
      await projectFeedHooks.onBeforeCreate(
        userCreate(feed({ token: chosen })),
      );

    expect(onCreate.createBy.data.token).not.toBe(chosen);
    expectConsistentTokenColumns(onCreate.createBy.data);
  });

  test("applies defaults, clamps the window and bounds the gap threshold", async () => {
    existingFeeds(0);

    const onCreate: OnCreate<ProjectOnCallCalendarFeed> =
      await projectFeedHooks.onBeforeCreate(
        userCreate(
          feed({ pastDays: 61, futureDays: 181, minimumGapMinutes: 120 }),
        ),
      );

    expect(onCreate.createBy.data.pastDays).toBe(MAX_PAST_DAYS);
    expect(onCreate.createBy.data.futureDays).toBe(MAX_FUTURE_DAYS);
    expect(onCreate.createBy.data.minimumGapMinutes).toBe(120);

    await expect(
      projectFeedHooks.onBeforeCreate(
        userCreate(feed({ minimumGapMinutes: -1 })),
      ),
    ).rejects.toThrow(BadDataException);
  });
});

describe("ProjectOnCallCalendarFeedService.onBeforeUpdate", () => {
  test("clamps and validates when present, leaves the rest alone", async () => {
    const onUpdate: OnUpdate<ProjectOnCallCalendarFeed> =
      await projectFeedHooks.onBeforeUpdate(
        update<ProjectOnCallCalendarFeed>({
          futureDays: 5,
          minimumGapMinutes: "45" as unknown as number,
          isEnabled: false,
        }),
      );

    expect(onUpdate.updateBy.data).toEqual({
      futureDays: MIN_FUTURE_DAYS,
      minimumGapMinutes: 45,
      isEnabled: false,
    });

    await expect(
      projectFeedHooks.onBeforeUpdate(
        update<ProjectOnCallCalendarFeed>({
          minimumGapMinutes: "x" as unknown as number,
        }),
      ),
    ).rejects.toThrow(BadDataException);
  });
});

describe("ProjectOnCallCalendarFeedService.rotateFeedsForMemberLeave", () => {
  test("rotates the project's feed when it is enabled and opted in", async () => {
    const findOneBy: jest.SpyInstance = getJestSpyOn(
      ProjectOnCallCalendarFeedService,
      "findOneBy",
    ).mockResolvedValue({ id: FEED_ID });
    const rotate: jest.SpyInstance = getJestSpyOn(
      ProjectOnCallCalendarFeedService,
      "rotateTokenById",
    ).mockResolvedValue({} as CalendarFeedRotation);

    await expect(
      ProjectOnCallCalendarFeedService.rotateFeedsForMemberLeave({
        projectId: PROJECT_ID,
      }),
    ).resolves.toEqual([FEED_ID]);

    expect(rotate).toHaveBeenCalledWith({ id: FEED_ID });
    expect(
      (findOneBy.mock.calls[0]![0] as { query: Record<string, unknown> }).query,
    ).toEqual({
      projectId: PROJECT_ID,
      isEnabled: true,
      rotateWhenMemberLeaves: true,
    });
  });

  test("is a no-op without an opted-in feed", async () => {
    getJestSpyOn(
      ProjectOnCallCalendarFeedService,
      "findOneBy",
    ).mockResolvedValue(null);
    const rotate: jest.SpyInstance = getJestSpyOn(
      ProjectOnCallCalendarFeedService,
      "rotateTokenById",
    ).mockResolvedValue({} as CalendarFeedRotation);

    await expect(
      ProjectOnCallCalendarFeedService.rotateFeedsForMemberLeave({
        projectId: PROJECT_ID,
      }),
    ).resolves.toEqual([]);
    expect(rotate).not.toHaveBeenCalled();
  });
});
