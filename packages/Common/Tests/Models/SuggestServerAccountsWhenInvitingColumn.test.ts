/**
 * GlobalConfig.suggestServerAccountsWhenInviting: whether the invite forms'
 * email box suggests every account on a self-hosted server to anyone who may
 * invite people to a project, not to master admins alone (#9744).
 *
 * "Off unless a master admin turns it on" is carried by three things that
 * are easy to confuse, so all three are pinned: the Postgres column default
 * for a new row, the migration's default for the row that exists, and the
 * documented default. And who may read and change it: master admins alone,
 * like every switch beside it, since it decides who sees every account.
 */

import GlobalConfig from "../../Models/DatabaseModels/GlobalConfig";
import GlobalConfigService from "../../Server/Services/GlobalConfigService";
import { TableColumnMetadata } from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import Permission from "../../Types/Permission";
import { getJestSpyOn } from "../Spy";
import { afterEach, describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import fs from "fs";
import path from "path";

const COLUMN: string = "suggestServerAccountsWhenInviting";

const SCHEMA_MIGRATIONS_DIRECTORY: string = path.join(
  __dirname,
  "..",
  "..",
  "Server",
  "Infrastructure",
  "Postgres",
  "SchemaMigrations",
);

const MIGRATION_FILE: string =
  "1809185347450-AddSuggestServerAccountsWhenInviting";

const MIGRATION_PATH: string = path.join(
  SCHEMA_MIGRATIONS_DIRECTORY,
  `${MIGRATION_FILE}.ts`,
);

function typeOrmColumn(): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage().columns.find((column: ColumnMetadataArgs) => {
    return column.target === GlobalConfig && column.propertyName === COLUMN;
  });
}

// The migration's up() and down(), apart.
function migrationHalves(): { up: string; down: string } {
  const migration: string = fs.readFileSync(MIGRATION_PATH, "utf8");
  const downAt: number = migration.indexOf("public async down(");

  expect(downAt).toBeGreaterThan(0);

  return {
    up: migration.slice(0, downAt),
    down: migration.slice(downAt),
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("GlobalConfig.suggestServerAccountsWhenInviting", () => {
  const metadata: () => TableColumnMetadata = (): TableColumnMetadata => {
    return new GlobalConfig().getTableColumnMetadata(COLUMN);
  };

  test("is a boolean column", () => {
    expect(metadata()).toBeDefined();
    expect(metadata().type).toBe(TableColumnType.Boolean);
  });

  test("a new server suggests only to master admins: the Postgres default is false", () => {
    expect(typeOrmColumn()?.options.default).toBe(false);
    expect(typeOrmColumn()?.options.nullable).toBe(true);
  });

  test("the server that exists does too: the migration adds it DEFAULT false", () => {
    expect(migrationHalves().up).toContain(
      `ALTER TABLE "GlobalConfig" ADD "${COLUMN}" boolean DEFAULT false`,
    );
    expect(migrationHalves().up).not.toContain("NOT NULL");
  });

  test("drops it again on the way down", () => {
    expect(migrationHalves().down).toContain(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "${COLUMN}"`,
    );
  });

  test("the migration is registered, last, so it runs", () => {
    const index: string = fs.readFileSync(
      path.join(SCHEMA_MIGRATIONS_DIRECTORY, "Index.ts"),
      "utf8",
    );

    expect(index).toContain(
      `import { AddSuggestServerAccountsWhenInviting1809185347450 } from "./${MIGRATION_FILE}";`,
    );
    expect(index).toContain(
      "AddSuggestServerAccountsWhenInviting1809185347450,",
    );
  });

  test("is documented as off, and says it never applies on OneUptime Cloud", () => {
    expect(metadata().defaultValue).toBe(false);
    expect(metadata().required).toBeFalsy();
    expect(metadata().description).toContain("OneUptime Cloud");
  });

  test("is read and written by master admins alone, as the switches beside it are", () => {
    expect(new GlobalConfig().getColumnAccessControlFor(COLUMN)).toEqual(
      new GlobalConfig().getColumnAccessControlFor("disableSignup"),
    );
    expect(
      new GlobalConfig().getColumnAccessControlFor(COLUMN)?.read,
    ).not.toContain(Permission.Public);
    expect(
      new GlobalConfig().getColumnAccessControlFor(COLUMN)?.update,
    ).toEqual([]);
  });
});

describe("GlobalConfigService.getSuggestServerAccountsWhenInviting", () => {
  test.each([
    [true, true],
    [false, false],
    [null, false],
    [undefined, false],
  ])(
    "the column holding %s reads as %s",
    async (stored: boolean | null | undefined, expected: boolean) => {
      const config: GlobalConfig = new GlobalConfig();
      (config as unknown as Record<string, unknown>)[COLUMN] = stored;

      getJestSpyOn(GlobalConfigService, "findOneBy").mockResolvedValue(config);

      await expect(
        GlobalConfigService.getSuggestServerAccountsWhenInviting(),
      ).resolves.toBe(expected);
    },
  );

  test("a server with no settings row yet reads it as off", async () => {
    getJestSpyOn(GlobalConfigService, "findOneBy").mockResolvedValue(null);

    await expect(
      GlobalConfigService.getSuggestServerAccountsWhenInviting(),
    ).resolves.toBe(false);
  });

  test("reads the one column, as root, and keeps nothing: every ask reads it afresh", async () => {
    const findOneBy: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      GlobalConfigService,
      "findOneBy",
    ).mockResolvedValue(null);

    await GlobalConfigService.getSuggestServerAccountsWhenInviting();
    await GlobalConfigService.getSuggestServerAccountsWhenInviting();

    expect(findOneBy).toHaveBeenCalledTimes(2);
    expect(findOneBy.mock.calls[0]![0]).toEqual({
      query: {},
      select: { [COLUMN]: true },
      props: { isRoot: true },
    });
  });
});
