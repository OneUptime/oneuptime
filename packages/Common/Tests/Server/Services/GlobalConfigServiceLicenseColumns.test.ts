import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import GlobalConfigService, {
  ROOT_ONLY_LICENSE_COLUMNS,
} from "../../../Server/Services/GlobalConfigService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * A12: forging a license through GlobalConfig CRUD.
 *
 * GlobalConfig's column ACLs are empty, and master admins bypass ACLs, so the
 * generic PUT /api/global-config/<zero id> let a master admin write any column
 * - including the stored license token, its expiry, the seat limit, the
 * instance id an instance-bound license is checked against, and the moment
 * the Enterprise Edition was first seen (which starts the unlicensed grace).
 * One request was enough to turn an unlicensed installation into a licensed
 * one, or to restart the trial forever.
 *
 * Those columns are now written by OneUptime itself only (props.isRoot): the
 * license client, the first-boot stamp and the data migrations. Everybody
 * else is refused, including master admins, and including writes of null.
 */

type GlobalConfigServiceWithHooks = {
  onBeforeCreate(createBy: CreateBy<GlobalConfig>): Promise<OnCreate<GlobalConfig>>;
  onBeforeUpdate(updateBy: UpdateBy<GlobalConfig>): Promise<OnUpdate<GlobalConfig>>;
};

const hooks: GlobalConfigServiceWithHooks =
  GlobalConfigService as unknown as GlobalConfigServiceWithHooks;

const EXPECTED_ROOT_ONLY_COLUMNS: Array<string> = [
  "instanceId",
  "enterpriseCompanyName",
  "enterpriseLicenseKey",
  "enterpriseLicenseExpiresAt",
  "enterpriseLicenseToken",
  "enterpriseLicenseIsEvaluation",
  "enterpriseLicenseUserLimit",
  "enterpriseLicenseCurrentUserCount",
  "enterpriseLicenseUserCountUpdatedAt",
  "enterpriseLicenseInstances",
  "enterpriseEditionFirstSeenAt",
];

// A plausible forged value for each column.
const FORGED_VALUES: Record<string, unknown> = {
  instanceId: ObjectID.generate(),
  enterpriseCompanyName: "Forged Inc",
  enterpriseLicenseKey: "forged-key",
  enterpriseLicenseExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
  enterpriseLicenseToken: "forged.license.token",
  enterpriseLicenseIsEvaluation: false,
  enterpriseLicenseUserLimit: 1_000_000,
  enterpriseLicenseCurrentUserCount: 0,
  enterpriseLicenseUserCountUpdatedAt: new Date(),
  enterpriseLicenseInstances: [],
  enterpriseEditionFirstSeenAt: new Date(),
};

const MASTER_ADMIN_PROPS: DatabaseCommonInteractionProps = {
  userId: ObjectID.generate(),
  isMasterAdmin: true,
} as DatabaseCommonInteractionProps;

const ROOT_PROPS: DatabaseCommonInteractionProps = {
  isRoot: true,
} as DatabaseCommonInteractionProps;

const makeUpdateBy: (
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
) => UpdateBy<GlobalConfig> = (
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
): UpdateBy<GlobalConfig> => {
  return {
    query: { _id: ObjectID.getZeroObjectID().toString() },
    data,
    limit: 1,
    skip: 0,
    props,
  } as unknown as UpdateBy<GlobalConfig>;
};

const makeCreateBy: (
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
) => CreateBy<GlobalConfig> = (
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
): CreateBy<GlobalConfig> => {
  const model: GlobalConfig = new GlobalConfig();
  model.id = ObjectID.getZeroObjectID();
  Object.assign(model, data);

  return {
    data: model,
    props,
  } as unknown as CreateBy<GlobalConfig>;
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GlobalConfigService - which columns are root-only", () => {
  test("covers exactly the license and identity columns", () => {
    expect([...ROOT_ONLY_LICENSE_COLUMNS].sort()).toEqual(
      [...EXPECTED_ROOT_ONLY_COLUMNS].sort(),
    );
  });

  test("every root-only column is a real GlobalConfig column", () => {
    const model: GlobalConfig = new GlobalConfig();

    for (const column of ROOT_ONLY_LICENSE_COLUMNS) {
      expect({
        column,
        isColumn: model.isTableColumn(column as string),
      }).toEqual({ column, isColumn: true });
    }
  });

  /*
   * These two are settings the oneuptime.com admin edits from the Admin
   * Dashboard; locking them would break that page.
   */
  test.each([
    "enterpriseLicenseNotificationEmail",
    "enterpriseLicenseExpiryReminderDays",
  ])("leaves %s editable by master admins", (column: string) => {
    expect(ROOT_ONLY_LICENSE_COLUMNS as ReadonlyArray<string>).not.toContain(
      column,
    );
  });
});

describe("GlobalConfigService - a master admin forging the license (update)", () => {
  test.each(EXPECTED_ROOT_ONLY_COLUMNS)(
    "refuses a master admin writing %s",
    async (column: string) => {
      await expect(
        hooks.onBeforeUpdate(
          makeUpdateBy({ [column]: FORGED_VALUES[column] }, MASTER_ADMIN_PROPS),
        ),
      ).rejects.toBeInstanceOf(NotAuthorizedException);
    },
  );

  test.each(EXPECTED_ROOT_ONLY_COLUMNS)(
    "refuses a master admin clearing %s with null",
    async (column: string) => {
      await expect(
        hooks.onBeforeUpdate(
          makeUpdateBy({ [column]: null }, MASTER_ADMIN_PROPS),
        ),
      ).rejects.toBeInstanceOf(NotAuthorizedException);
    },
  );

  test("refuses an ordinary signed-in user too", async () => {
    await expect(
      hooks.onBeforeUpdate(
        makeUpdateBy(
          { enterpriseLicenseToken: "forged.license.token" },
          { userId: ObjectID.generate() } as DatabaseCommonInteractionProps,
        ),
      ),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
  });

  test("refuses a request with no props flags at all", async () => {
    await expect(
      hooks.onBeforeUpdate(
        makeUpdateBy(
          { enterpriseLicenseExpiresAt: new Date("2099-01-01") },
          {} as DatabaseCommonInteractionProps,
        ),
      ),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
  });

  /*
   * The exact request from the review: the token and a far-future expiry in
   * one PUT, which used to turn an unlicensed installation into a licensed one.
   */
  test("refuses the token-plus-expiry forgery and names both columns", async () => {
    let caught: unknown = null;

    try {
      await hooks.onBeforeUpdate(
        makeUpdateBy(
          {
            enterpriseLicenseToken: "x",
            enterpriseLicenseExpiresAt: new Date("2099-01-01T00:00:00.000Z"),
          },
          MASTER_ADMIN_PROPS,
        ),
      );
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(NotAuthorizedException);
    expect((caught as Error).message).toContain("enterpriseLicenseToken");
    expect((caught as Error).message).toContain("enterpriseLicenseExpiresAt");
  });

  test("refuses a forged column hidden among legitimate settings", async () => {
    await expect(
      hooks.onBeforeUpdate(
        makeUpdateBy(
          {
            disableSignup: true,
            enterpriseLicenseUserLimit: 1_000_000,
          },
          MASTER_ADMIN_PROPS,
        ),
      ),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
  });

  test("lets a master admin change ordinary settings", async () => {
    const result: OnUpdate<GlobalConfig> = await hooks.onBeforeUpdate(
      makeUpdateBy({ disableSignup: true }, MASTER_ADMIN_PROPS),
    );

    expect(result.updateBy.data).toEqual({ disableSignup: true });
  });

  test.each([
    ["enterpriseLicenseNotificationEmail", "licenses@oneuptime.com"],
    ["enterpriseLicenseExpiryReminderDays", 30],
  ])(
    "lets a master admin change %s",
    async (column: string, value: unknown) => {
      await expect(
        hooks.onBeforeUpdate(makeUpdateBy({ [column]: value }, MASTER_ADMIN_PROPS)),
      ).resolves.toBeDefined();
    },
  );
});

describe("GlobalConfigService - OneUptime's own license writes (update)", () => {
  test.each(EXPECTED_ROOT_ONLY_COLUMNS)(
    "lets a root write set %s",
    async (column: string) => {
      const result: OnUpdate<GlobalConfig> = await hooks.onBeforeUpdate(
        makeUpdateBy({ [column]: FORGED_VALUES[column] }, ROOT_PROPS),
      );

      expect(
        (result.updateBy.data as Record<string, unknown>)[column],
      ).toEqual(FORGED_VALUES[column]);
    },
  );

  test("lets a root write clear the token", async () => {
    await expect(
      hooks.onBeforeUpdate(
        makeUpdateBy({ enterpriseLicenseToken: null }, ROOT_PROPS),
      ),
    ).resolves.toBeDefined();
  });
});

describe("GlobalConfigService - a master admin forging the license (create)", () => {
  test.each(EXPECTED_ROOT_ONLY_COLUMNS)(
    "refuses a master admin creating the row with %s",
    async (column: string) => {
      await expect(
        hooks.onBeforeCreate(
          makeCreateBy({ [column]: FORGED_VALUES[column] }, MASTER_ADMIN_PROPS),
        ),
      ).rejects.toBeInstanceOf(NotAuthorizedException);
    },
  );

  test("lets a master admin create a row without license columns", async () => {
    await expect(
      hooks.onBeforeCreate(
        makeCreateBy({ disableSignup: true }, MASTER_ADMIN_PROPS),
      ),
    ).resolves.toBeDefined();
  });

  /*
   * AddDefaultGlobalConfig seeds the row with a fresh instanceId as root; it
   * must keep working.
   */
  test("lets the default-config data migration create the row with an instance id", async () => {
    await expect(
      hooks.onBeforeCreate(
        makeCreateBy({ instanceId: ObjectID.generate() }, ROOT_PROPS),
      ),
    ).resolves.toBeDefined();
  });
});

describe("GlobalConfigService - through the public write methods", () => {
  /*
   * The hook is what the generic CRUD API reaches. Driving the public methods
   * proves the refusal happens before any database work: nothing here has a
   * database, so reaching one would fail differently.
   */
  test("updateOneBy refuses a master admin's forged token", async () => {
    await expect(
      GlobalConfigService.updateOneBy({
        query: { _id: ObjectID.getZeroObjectID().toString() },
        data: { enterpriseLicenseToken: "forged.license.token" },
        props: MASTER_ADMIN_PROPS,
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
  });

  test("create refuses a master admin's forged first-seen stamp", async () => {
    const model: GlobalConfig = new GlobalConfig();
    model.enterpriseEditionFirstSeenAt = new Date();

    await expect(
      GlobalConfigService.create({
        data: model,
        props: MASTER_ADMIN_PROPS,
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
  });

  test("the guard lets a root write through whatever else its props say", () => {
    expect(() => {
      GlobalConfigService.assertLicenseColumnsWrittenByRootOnly(
        { enterpriseLicenseToken: "x" },
        { isRoot: true, ignoreHooks: true } as DatabaseCommonInteractionProps,
      );
    }).not.toThrow();
    expect(() => {
      GlobalConfigService.assertLicenseColumnsWrittenByRootOnly(
        { enterpriseLicenseToken: "x" },
        {
          isRoot: false,
          isMasterAdmin: true,
          ignoreHooks: true,
        } as DatabaseCommonInteractionProps,
      );
    }).toThrow(NotAuthorizedException);
  });
});
