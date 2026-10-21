import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import GlobalConfigService, {
  ROOT_ONLY_BRANDING_COLUMNS,
} from "../../../Server/Services/GlobalConfigService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import FindBy from "../../../Server/Types/Database/FindBy";
import {
  OnCreate,
  OnFind,
  OnUpdate,
} from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * GlobalConfig's branding columns are the enterprise module's: it writes and
 * reads them as root, behind its own checks of whether the installation may
 * brand itself. The generic API - master admins included, whose access to
 * GlobalConfig's empty column ACLs is otherwise unlimited - may neither write
 * them nor read them back:
 *   - a write naming any of them is refused, with a refusal that names no
 *     column;
 *   - a read drops them from what it selects and from what it filters on, so
 *     a value stored while the installation could brand itself is never
 *     served once it cannot, and the API cannot be used to find out whether
 *     one is stored.
 */

type GlobalConfigServiceWithHooks = {
  onBeforeCreate(
    createBy: CreateBy<GlobalConfig>,
  ): Promise<OnCreate<GlobalConfig>>;
  onBeforeUpdate(
    updateBy: UpdateBy<GlobalConfig>,
  ): Promise<OnUpdate<GlobalConfig>>;
  onBeforeFind(findBy: FindBy<GlobalConfig>): Promise<OnFind<GlobalConfig>>;
};

const hooks: GlobalConfigServiceWithHooks =
  GlobalConfigService as unknown as GlobalConfigServiceWithHooks;

const EXPECTED_COLUMNS: Array<string> = [
  "brandingProductName",
  "brandingWebsiteUrl",
  "brandingLogo",
  "brandingDarkLogo",
  "brandingFavicon",
  "brandingUpdatedAt",
];

const VALUES: Record<string, unknown> = {
  brandingProductName: "Acme",
  brandingWebsiteUrl: "https://acme.example",
  brandingLogo: "data:image/png;base64,iVBORw0KGgo=",
  brandingDarkLogo: "data:image/png;base64,iVBORw0KGgo=",
  brandingFavicon: "data:image/png;base64,iVBORw0KGgo=",
  brandingUpdatedAt: new Date(),
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

const makeFindBy: (
  select: Record<string, unknown>,
  query: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
) => FindBy<GlobalConfig> = (
  select: Record<string, unknown>,
  query: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
): FindBy<GlobalConfig> => {
  return {
    select,
    query,
    limit: 1,
    skip: 0,
    props,
  } as unknown as FindBy<GlobalConfig>;
};

describe("ROOT_ONLY_BRANDING_COLUMNS", () => {
  test("is every branding column GlobalConfig has", () => {
    expect([...ROOT_ONLY_BRANDING_COLUMNS]).toEqual(EXPECTED_COLUMNS);

    const brandingColumns: Array<string> = new GlobalConfig()
      .getTableColumns()
      .columns.filter((column: string): boolean => {
        return column.startsWith("branding");
      });

    expect(brandingColumns.sort()).toEqual([...EXPECTED_COLUMNS].sort());
  });

  test("are held to master admins by their own column ACLs too", () => {
    for (const column of EXPECTED_COLUMNS) {
      const access: Record<string, unknown> =
        new GlobalConfig().getColumnAccessControlFor(
          column,
        ) as unknown as Record<string, unknown>;

      expect({ column, access }).toEqual({
        column,
        access: expect.objectContaining({ create: [], read: [], update: [] }),
      });
    }
  });
});

describe("writes", () => {
  test.each(EXPECTED_COLUMNS)(
    "an update of %s by a master admin is refused, naming no column",
    async (column: string) => {
      await expect(
        hooks.onBeforeUpdate(
          makeUpdateBy({ [column]: VALUES[column] }, MASTER_ADMIN_PROPS),
        ),
      ).rejects.toThrow(
        new NotAuthorizedException(
          "You do not have permission to change these settings.",
        ),
      );
    },
  );

  test.each(EXPECTED_COLUMNS)(
    "clearing %s through the generic API is refused too",
    async (column: string) => {
      await expect(
        hooks.onBeforeUpdate(
          makeUpdateBy({ [column]: null }, MASTER_ADMIN_PROPS),
        ),
      ).rejects.toBeInstanceOf(NotAuthorizedException);
    },
  );

  test("a create naming a branding column is refused", async () => {
    await expect(
      hooks.onBeforeCreate({
        data: { brandingProductName: "Acme" } as unknown as GlobalConfig,
        props: MASTER_ADMIN_PROPS,
      } as CreateBy<GlobalConfig>),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
  });

  test("OneUptime itself (root) writes them", async () => {
    await expect(
      hooks.onBeforeUpdate(makeUpdateBy({ ...VALUES }, ROOT_PROPS)),
    ).resolves.toBeDefined();
  });

  test("an update that names none of them is not affected", async () => {
    await expect(
      hooks.onBeforeUpdate(
        makeUpdateBy({ disableSignup: true }, MASTER_ADMIN_PROPS),
      ),
    ).resolves.toBeDefined();
  });
});

describe("reads", () => {
  test("a master admin's read never selects or filters on them", async () => {
    const result: OnFind<GlobalConfig> = await hooks.onBeforeFind(
      makeFindBy(
        {
          _id: true,
          disableSignup: true,
          ...Object.fromEntries(
            EXPECTED_COLUMNS.map((column: string) => {
              return [column, true];
            }),
          ),
        },
        {
          _id: ObjectID.getZeroObjectID().toString(),
          brandingProductName: "Acme",
        },
        MASTER_ADMIN_PROPS,
      ),
    );

    expect(Object.keys(result.findBy.select || {}).sort()).toEqual([
      "_id",
      "disableSignup",
    ]);
    expect(Object.keys(result.findBy.query || {})).toEqual(["_id"]);
  });

  test("OneUptime itself (root) reads them", async () => {
    const findBy: FindBy<GlobalConfig> = makeFindBy(
      { brandingProductName: true, brandingLogo: true },
      { brandingProductName: "Acme" },
      ROOT_PROPS,
    );

    const result: OnFind<GlobalConfig> = await hooks.onBeforeFind(findBy);

    expect(result.findBy).toBe(findBy);
  });

  test("a read that names none of them is passed through unchanged in content", async () => {
    const result: OnFind<GlobalConfig> = await hooks.onBeforeFind(
      makeFindBy(
        { disableSignup: true },
        { _id: ObjectID.getZeroObjectID().toString() },
        MASTER_ADMIN_PROPS,
      ),
    );

    expect(result.findBy.select).toEqual({ disableSignup: true });
    expect(result.findBy.query).toEqual({
      _id: ObjectID.getZeroObjectID().toString(),
    });
  });
});
