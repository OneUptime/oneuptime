import UserNotificationEmailRollupSettingService, {
  Service as UserNotificationEmailRollupSettingServiceType,
} from "../../../Server/Services/UserNotificationEmailRollupSettingService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import UserNotificationEmailRollupSetting from "../../../Models/DatabaseModels/UserNotificationEmailRollupSetting";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * This service is the whole read side of the personal escape hatch from owner
 * email burst rollup. What breaks in production if any of the behaviour below
 * regresses:
 *
 *   1. ABSENT ROW MEANS ENABLED. Rollup ships on by default with no backfill,
 *      so the overwhelming majority of project members will never have a row
 *      here. A read that treated "no row" as anything other than the default
 *      would make the feature's answer depend on data that does not exist -
 *      either turning rollup off for the entire fleet, or turning it on for
 *      somebody who explicitly asked for individual mail. This is the single
 *      most-travelled case in the method and the least likely to be noticed
 *      when it breaks, because both wrong answers still deliver the email.
 *
 *   2. ONLY AN EXPLICIT FALSE OPTS SOMEBODY OUT. A row whose isEnabled arrived
 *      NULL - a hand-written insert, a column added ahead of its default - is
 *      not a preference anybody expressed. Reading it as an opt-out would take
 *      a person out of rollup without them ever having asked.
 *
 *   3. THE QUERY IS SCOPED TO BOTH USER AND PROJECT. Drop either column and one
 *      person's opt-out silently governs their colleagues, or governs their own
 *      mail in a project where they never touched the toggle. The preference is
 *      per (user, project) precisely because a consultant in six projects wants
 *      six independent answers.
 *
 *   4. ERRORS PROPAGATE. The one caller reads this inside the writer's
 *      fail-open catch, which turns any failure into an immediate send. A
 *      service that swallowed the error and returned `true` would convert a
 *      degraded database into "everybody's opt-out is quietly ignored and their
 *      mail is batched anyway" - the exact complaint the toggle exists to
 *      answer, caused by the code meant to serve it.
 *
 *   5. ONE ROW PER PAIR. The page creates lazily on the first toggle, so a
 *      double click or two open tabs can race. Two rows would make findOneBy's
 *      answer depend on which one Postgres happened to return first.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const OTHER_USER_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

/*
 * What the service hands findOneBy. Declared here rather than reached for
 * through FindOneBy<Model>, because the two things worth asserting - that both
 * scoping columns are present, and that the read runs as root - are exactly the
 * ones the generic type erases behind an optional query.
 */
interface CapturedQuery {
  query: {
    userId: ObjectID | undefined;
    projectId: ObjectID | undefined;
  };
  props: {
    isRoot: boolean;
  };
}

interface CapturedFindOneBy extends CapturedQuery {
  select: {
    isEnabled: boolean;
  };
}

/*
 * The protected hook, reached the way every other service test in this folder
 * reaches one: through a structural cast rather than by making the hook public
 * just so a test can call it.
 */
type ServiceInternals = {
  onBeforeCreate: (
    createBy: CreateBy<UserNotificationEmailRollupSetting>,
  ) => Promise<OnCreate<UserNotificationEmailRollupSetting>>;
};

function buildSetting(
  isEnabled: boolean | null | undefined,
): UserNotificationEmailRollupSetting {
  const setting: UserNotificationEmailRollupSetting =
    new UserNotificationEmailRollupSetting();

  /*
   * Assigned through the cast because the column is `boolean | undefined` and
   * the null case is one the database can produce even though the type says it
   * cannot - which is the entire reason the null case is tested at all.
   */
  (setting as { isEnabled?: boolean | null | undefined }).isEnabled = isEnabled;

  return setting;
}

function createBy(data: {
  projectId?: ObjectID | undefined;
  userId?: ObjectID | undefined;
}): CreateBy<UserNotificationEmailRollupSetting> {
  const setting: UserNotificationEmailRollupSetting =
    new UserNotificationEmailRollupSetting();

  if (data.projectId) {
    setting.projectId = data.projectId;
  }

  if (data.userId) {
    setting.userId = data.userId;
  }

  setting.isEnabled = false;

  return {
    data: setting,
    props: { isRoot: true },
  } as CreateBy<UserNotificationEmailRollupSetting>;
}

describe("UserNotificationEmailRollupSettingService", () => {
  let findOne: jest.SpyInstance;

  beforeEach(() => {
    findOne = jest
      .spyOn(UserNotificationEmailRollupSettingService, "findOneBy")
      .mockResolvedValue(null as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function capturedFindOneBy(index: number = 0): CapturedFindOneBy {
    return findOne.mock.calls[index]?.[0] as CapturedFindOneBy;
  }

  function isRollupEnabled(
    overrides: { userId?: ObjectID; projectId?: ObjectID } = {},
  ): Promise<boolean> {
    return UserNotificationEmailRollupSettingService.isRollupEnabledForUser({
      userId: overrides.userId ?? USER_ID,
      projectId: overrides.projectId ?? PROJECT_ID,
    });
  }

  /*
   * ----------------------------------------------------------------------- *
   * (A) The default, which is the case almost every read takes.
   * -----------------------------------------------------------------------
   */

  describe("isRollupEnabledForUser - the default", () => {
    test("no row for the pair means enabled", async () => {
      /*
       * The load-bearing one. Nobody has a row until they open the setting and
       * change it, so this branch answers for essentially the whole fleet, and
       * a `false` here would silently disable the feature everywhere while
       * still delivering every email - nothing would fail, nothing would page,
       * and the only symptom would be that the rollup table filled with rows
       * that were all sent immediately.
       */
      findOne.mockResolvedValue(null as never);

      await expect(isRollupEnabled()).resolves.toBe(true);
    });

    test("a row that says true means enabled", async () => {
      findOne.mockResolvedValue(buildSetting(true) as never);

      await expect(isRollupEnabled()).resolves.toBe(true);
    });

    test("a row that says false is the opt-out", async () => {
      findOne.mockResolvedValue(buildSetting(false) as never);

      await expect(isRollupEnabled()).resolves.toBe(false);
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (B) Only an explicit false opts somebody out.
   * -----------------------------------------------------------------------
   */

  describe("isRollupEnabledForUser - non-boolean column values", () => {
    test("a row whose isEnabled is null is NOT an opt-out", async () => {
      /*
       * A NULL reaches this row from outside the product - a hand-written
       * insert, a restore from a dump taken before the column had its default.
       * `Boolean(setting.isEnabled)` and `setting.isEnabled === true` both read
       * that as "off", and both would take somebody out of rollup on the
       * strength of a value nobody chose.
       */
      findOne.mockResolvedValue(buildSetting(null) as never);

      await expect(isRollupEnabled()).resolves.toBe(true);
    });

    test("a row whose isEnabled is undefined is NOT an opt-out", async () => {
      findOne.mockResolvedValue(buildSetting(undefined) as never);

      await expect(isRollupEnabled()).resolves.toBe(true);
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (C) The scope of the read.
   * -----------------------------------------------------------------------
   */

  describe("isRollupEnabledForUser - query scope", () => {
    test("the read is keyed on BOTH userId and projectId, as root, selecting only the flag", async () => {
      await isRollupEnabled();

      expect(findOne).toHaveBeenCalledTimes(1);

      const captured: CapturedFindOneBy = capturedFindOneBy();
      expect(captured.query.userId?.toString()).toBe(USER_ID.toString());
      expect(captured.query.projectId?.toString()).toBe(PROJECT_ID.toString());

      /*
       * Both keys must be PRESENT, not merely equal when present: a query that
       * dropped `projectId` entirely would still satisfy an assertion written
       * only against the key it kept.
       */
      expect(Object.keys(captured.query).sort()).toEqual([
        "projectId",
        "userId",
      ]);

      /*
       * Root, because the table's read permission is CurrentUser and the writer
       * calls this from a background send path that has no user props of its
       * own; and one column, because that is all the answer needs.
       */
      expect(captured.props.isRoot).toBe(true);
      expect(captured.select.isEnabled).toBe(true);
    });

    test("an opt-out in one project does not leak into another project or another person", async () => {
      /*
       * The mock answers like the database would: the row exists for exactly
       * one (user, project) pair. A read that dropped either column from its
       * query would find that row for the other project or the other person,
       * and one member's preference would start governing traffic that is not
       * theirs.
       */
      findOne.mockImplementation(
        (
          params: CapturedFindOneBy,
        ): Promise<UserNotificationEmailRollupSetting | null> => {
          const matches: boolean =
            params.query.userId?.toString() === USER_ID.toString() &&
            params.query.projectId?.toString() === PROJECT_ID.toString();

          return Promise.resolve(matches ? buildSetting(false) : null);
        },
      );

      await expect(isRollupEnabled()).resolves.toBe(false);

      await expect(
        isRollupEnabled({ projectId: OTHER_PROJECT_ID }),
      ).resolves.toBe(true);

      await expect(isRollupEnabled({ userId: OTHER_USER_ID })).resolves.toBe(
        true,
      );
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (D) Failures are the caller's business.
   * -----------------------------------------------------------------------
   */

  describe("isRollupEnabledForUser - failures", () => {
    test("a findOneBy that throws PROPAGATES rather than being swallowed", async () => {
      /*
       * The writer reads this inside its fail-open catch, so a throw becomes an
       * immediate send - the same direction an opt-out means, and the same
       * direction every other failure in that path takes. Catching it here and
       * returning `true` instead would batch the mail of every person who had
       * opted out, for as long as the database stayed unhappy, and would log
       * nothing at all.
       */
      findOne.mockRejectedValue(
        new Error("canceling statement due to timeout"),
      );

      await expect(isRollupEnabled()).rejects.toThrow(
        "canceling statement due to timeout",
      );
    });
  });

  /*
   * ----------------------------------------------------------------------- *
   * (E) One row per (user, project).
   * -----------------------------------------------------------------------
   */

  describe("onBeforeCreate", () => {
    let service: UserNotificationEmailRollupSettingServiceType;
    let internals: ServiceInternals;
    let count: jest.SpyInstance;

    beforeEach(() => {
      service = new UserNotificationEmailRollupSettingServiceType();
      internals = service as unknown as ServiceInternals;

      count = jest
        .spyOn(service, "countBy")
        .mockResolvedValue(new PositiveNumber(0) as never);
    });

    test("a row with both ids and no existing row is accepted", async () => {
      const result: OnCreate<UserNotificationEmailRollupSetting> =
        await internals.onBeforeCreate(
          createBy({ projectId: PROJECT_ID, userId: USER_ID }),
        );

      expect(result.createBy.data.isEnabled).toBe(false);
      expect(count).toHaveBeenCalledTimes(1);
    });

    test("a missing projectId is refused", async () => {
      /*
       * Without it the row is not tenant-scoped, and the duplicate check below
       * would count across every project at once.
       */
      await expect(
        internals.onBeforeCreate(createBy({ userId: USER_ID })),
      ).rejects.toThrow(BadDataException);

      await expect(
        internals.onBeforeCreate(createBy({ userId: USER_ID })),
      ).rejects.toThrow("projectId is required");

      expect(count).not.toHaveBeenCalled();
    });

    test("a missing userId is refused", async () => {
      await expect(
        internals.onBeforeCreate(createBy({ projectId: PROJECT_ID })),
      ).rejects.toThrow(BadDataException);

      await expect(
        internals.onBeforeCreate(createBy({ projectId: PROJECT_ID })),
      ).rejects.toThrow("userId is required");

      expect(count).not.toHaveBeenCalled();
    });

    test("a second row for a pair that already has one is refused", async () => {
      count.mockResolvedValue(new PositiveNumber(1) as never);

      await expect(
        internals.onBeforeCreate(
          createBy({ projectId: PROJECT_ID, userId: USER_ID }),
        ),
      ).rejects.toThrow(BadDataException);

      await expect(
        internals.onBeforeCreate(
          createBy({ projectId: PROJECT_ID, userId: USER_ID }),
        ),
      ).rejects.toThrow(
        "An email rollup setting already exists for this user in this project.",
      );
    });

    test("the duplicate check is scoped to the pair, as root", async () => {
      /*
       * A check that counted only by userId would refuse the second project a
       * consultant ever opts out of; one that counted only by projectId would
       * refuse every member but the first.
       */
      await internals.onBeforeCreate(
        createBy({ projectId: PROJECT_ID, userId: USER_ID }),
      );

      const captured: CapturedQuery = count.mock.calls[0]?.[0] as CapturedQuery;

      expect(captured.query.userId?.toString()).toBe(USER_ID.toString());
      expect(captured.query.projectId?.toString()).toBe(PROJECT_ID.toString());
      expect(Object.keys(captured.query).sort()).toEqual([
        "projectId",
        "userId",
      ]);
      expect(captured.props.isRoot).toBe(true);
    });
  });
});
