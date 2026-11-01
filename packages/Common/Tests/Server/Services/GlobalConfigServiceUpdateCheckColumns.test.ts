import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import GlobalConfigService, {
  ROOT_ONLY_UPDATE_CHECK_COLUMNS,
} from "../../../Server/Services/GlobalConfigService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * What the daily update check found - the latest release, OneUptime's
 * published security advisories, which of them the owners were emailed
 * about, when it last asked GitHub and why that failed - is written by the
 * worker alone.
 *
 * GlobalConfig's column ACLs are empty and master admins bypass them, so the
 * generic PUT /api/global-config/<zero id> would otherwise let one master
 * admin empty the advisory list - hiding the Admin Dashboard's security
 * notice and the footer's "Security update" from every other master admin -
 * or mark an advisory as emailed that nobody was told about. Reading them
 * stays open: the Enterprise licenses page reads the latest release.
 */

type GlobalConfigServiceWithHooks = {
  onBeforeCreate(
    createBy: CreateBy<GlobalConfig>,
  ): Promise<OnCreate<GlobalConfig>>;
  onBeforeUpdate(
    updateBy: UpdateBy<GlobalConfig>,
  ): Promise<OnUpdate<GlobalConfig>>;
};

const hooks: GlobalConfigServiceWithHooks =
  GlobalConfigService as unknown as GlobalConfigServiceWithHooks;

const EXPECTED_COLUMNS: Array<string> = [
  "latestReleaseVersion",
  "latestReleasePublishedAt",
  "latestReleaseCheckedAt",
  "securityAdvisories",
  "securityAdvisoriesCheckedAt",
  "securityAdvisoriesEmailed",
  "updateCheckLastAttemptAt",
  "updateCheckLastFailure",
];

const FORGED_VALUES: Record<string, unknown> = {
  latestReleaseVersion: "0.0.1",
  latestReleasePublishedAt: new Date("2000-01-01T00:00:00.000Z"),
  latestReleaseCheckedAt: new Date("2099-01-01T00:00:00.000Z"),
  securityAdvisories: [],
  securityAdvisoriesCheckedAt: new Date("2099-01-01T00:00:00.000Z"),
  securityAdvisoriesEmailed: { "GHSA-aaaa-bbbb-cccc": "2026-10-30T00:00:00Z" },
  updateCheckLastAttemptAt: new Date("2099-01-01T00:00:00.000Z"),
  updateCheckLastFailure: "rate-limited",
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

describe("GlobalConfigService - the update check's columns", () => {
  test("are exactly the release, advisory and attempt columns", () => {
    expect([...ROOT_ONLY_UPDATE_CHECK_COLUMNS].sort()).toEqual(
      [...EXPECTED_COLUMNS].sort(),
    );
  });

  test("are real GlobalConfig columns", () => {
    const model: GlobalConfig = new GlobalConfig();

    for (const column of ROOT_ONLY_UPDATE_CHECK_COLUMNS) {
      expect({
        column,
        isColumn: model.isTableColumn(column as string),
      }).toEqual({ column, isColumn: true });
    }
  });

  test.each(EXPECTED_COLUMNS)(
    "refuses a master admin writing %s",
    async (column: string) => {
      await expect(
        hooks.onBeforeUpdate(
          makeUpdateBy({ [column]: FORGED_VALUES[column] }, MASTER_ADMIN_PROPS),
        ),
      ).rejects.toBeInstanceOf(NotAuthorizedException);
    },
  );

  test.each(EXPECTED_COLUMNS)(
    "refuses a master admin clearing %s with null",
    async (column: string) => {
      await expect(
        hooks.onBeforeUpdate(
          makeUpdateBy({ [column]: null }, MASTER_ADMIN_PROPS),
        ),
      ).rejects.toBeInstanceOf(NotAuthorizedException);
    },
  );

  test("refuses one hidden among ordinary settings, and names it", async () => {
    let caught: unknown = null;

    try {
      await hooks.onBeforeUpdate(
        makeUpdateBy(
          { disableSignup: true, securityAdvisories: [] },
          MASTER_ADMIN_PROPS,
        ),
      );
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(NotAuthorizedException);
    expect((caught as Error).message).toContain("securityAdvisories");
  });

  test("refuses them on create too", async () => {
    await expect(
      hooks.onBeforeCreate(
        makeCreateBy({ securityAdvisoriesEmailed: {} }, MASTER_ADMIN_PROPS),
      ),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
  });

  test("lets OneUptime itself write them", async () => {
    for (const column of EXPECTED_COLUMNS) {
      await expect(
        hooks.onBeforeUpdate(
          makeUpdateBy({ [column]: FORGED_VALUES[column] }, ROOT_PROPS),
        ),
      ).resolves.toBeDefined();
    }
  });

  test("leaves a master admin's ordinary settings alone", async () => {
    const result: OnUpdate<GlobalConfig> = await hooks.onBeforeUpdate(
      makeUpdateBy({ disableSignup: true }, MASTER_ADMIN_PROPS),
    );

    expect(result.updateBy.data).toEqual({ disableSignup: true });
  });
});
