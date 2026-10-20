/**
 * Dashboard.theme: the column, the migration that adds it, and every write
 * of it.
 *
 * Three promises, each carried by something different and each easy to
 * break with a one-word edit:
 *
 *   - Nothing changes for a dashboard that exists today: the migration adds
 *     the column with DEFAULT 'Light', which Postgres gives every existing
 *     row, so every public dashboard keeps the light page it had.
 *   - Nothing changes for a Terraform configuration that names no theme: the
 *     column's documented default (TableColumn.defaultValue) is Light, and it
 *     is the static default the generated provider plans and sends - Light,
 *     so it never plans a change on a dashboard that has Light.
 *   - A dashboard made from now on in the dashboard or through the API, with
 *     no theme in its create, follows each visitor's device:
 *     DashboardService.onBeforeCreate fills in System, as a status page's
 *     does.
 *
 * And a theme no reader knows is refused on every create and update.
 */

import Dashboard from "../../../Models/DatabaseModels/Dashboard";
import DashboardService, {
  assertDashboardWriteValues,
} from "../../../Server/Services/DashboardService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import ColumnLength from "../../../Types/Database/ColumnLength";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import DashboardTheme, {
  DASHBOARD_THEMES,
  DASHBOARD_THEME_COLUMN,
  DASHBOARD_THEME_PROBLEM,
  NEW_DASHBOARD_THEME,
} from "../../../Types/Dashboard/DashboardTheme";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import fs from "fs";
import path from "path";

jest.mock("../../../Server/Utils/Logger");

const MIGRATIONS_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "Server",
  "Infrastructure",
  "Postgres",
  "SchemaMigrations",
);

// The migration's timestamp: later than every migration on master when it merged.
const MIGRATION_TIMESTAMP: number = 1804860000000;

const MIGRATION_NAME: string = "AddDashboardTheme";

const MIGRATION_FILE: string = `${MIGRATION_TIMESTAMP}-${MIGRATION_NAME}.ts`;

// A class registered in Index.ts's migration list: "  AddDashboardTheme1804860000000,".
const REGISTERED_MIGRATION_ENTRY: RegExp = /^\s{2}(\w+?(\d{13})),$/gm;

const metadata: () => TableColumnMetadata = (): TableColumnMetadata => {
  return new Dashboard().getTableColumnMetadata(DASHBOARD_THEME_COLUMN);
};

const typeOrmColumn: () => ColumnMetadataArgs | undefined = ():
  | ColumnMetadataArgs
  | undefined => {
  return getMetadataArgsStorage().columns.find(
    (column: ColumnMetadataArgs): boolean => {
      return (
        column.target === Dashboard &&
        column.propertyName === DASHBOARD_THEME_COLUMN
      );
    },
  );
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the theme column", () => {
  test("is short text, titled Theme, described for the API reference and Terraform", () => {
    expect(metadata().type).toBe(TableColumnType.ShortText);
    expect(metadata().title).toBe("Theme");
    expect(metadata().required).toBe(false);

    for (const theme of DASHBOARD_THEMES) {
      expect(metadata().description).toContain(theme);
    }

    // Visitors' own pick is part of what the setting means.
    expect(metadata().description).toContain("toolbar");
  });

  test("is part of the API reference and the generated Terraform provider", () => {
    expect(metadata().hideColumnInDocumentation).toBeFalsy();
    expect(metadata().computed).toBeFalsy();
  });

  test("its documented default is Light, the one the Terraform provider sends, so it never flips a dashboard", () => {
    expect(metadata().defaultValue).toBe(DashboardTheme.Light);
  });

  test("its Postgres default is Light too, so the column and the model never drift", () => {
    expect(typeOrmColumn()?.options.default).toBe(DashboardTheme.Light);
    expect(typeOrmColumn()?.options.nullable).toBe(true);
    expect(typeOrmColumn()?.options.length).toBe(ColumnLength.ShortText);
  });

  test("is free on every plan: it is how the page looks, not what it shows", () => {
    expect(
      new Dashboard().getColumnBillingAccessControl(DASHBOARD_THEME_COLUMN),
    ).toBeUndefined();
  });

  test("whoever may change the dashboard's logo may change its theme, and whoever may read the dashboard reads it", () => {
    const dashboard: Dashboard = new Dashboard();

    expect(dashboard.getColumnAccessControlFor(DASHBOARD_THEME_COLUMN)).toEqual(
      dashboard.getColumnAccessControlFor("logoFile"),
    );
    expect(dashboard.getColumnAccessControlFor(DASHBOARD_THEME_COLUMN)).toEqual(
      dashboard.getColumnAccessControlFor("pageTitle"),
    );
  });
});

describe("the migration that adds it", () => {
  const source: string = fs.readFileSync(
    path.join(MIGRATIONS_DIR, MIGRATION_FILE),
    "utf8",
  );
  const index: string = fs.readFileSync(
    path.join(MIGRATIONS_DIR, "Index.ts"),
    "utf8",
  );

  test("gives every dashboard that exists today Light, in the statement that adds the column", () => {
    expect(source).toContain(
      `ALTER TABLE "Dashboard" ADD "theme" character varying(100) DEFAULT 'Light'`,
    );
    // No UPDATE of its own: the column's default fills the existing rows.
    expect(source).not.toContain("UPDATE ");
  });

  test("can be taken back", () => {
    expect(source).toContain(`ALTER TABLE "Dashboard" DROP COLUMN "theme"`);
  });

  test("is named for its class, as typeorm records it", () => {
    expect(source).toContain(
      `export class ${MIGRATION_NAME}${MIGRATION_TIMESTAMP} implements MigrationInterface`,
    );
    expect(source).toContain(
      `public name: string = "${MIGRATION_NAME}${MIGRATION_TIMESTAMP}";`,
    );
  });

  test("is registered, after every migration before it", () => {
    const className: string = `${MIGRATION_NAME}${MIGRATION_TIMESTAMP}`;

    expect(index).toContain(
      `import { ${className} } from "./${MIGRATION_TIMESTAMP}-${MIGRATION_NAME}";`,
    );

    const registered: Array<string> = Array.from(
      index.matchAll(REGISTERED_MIGRATION_ENTRY),
      (match: RegExpMatchArray): string => {
        return match[1]!;
      },
    );

    expect(registered).toContain(className);

    const timestamps: Array<number> = Array.from(
      fs.readdirSync(MIGRATIONS_DIR),
      (file: string): number => {
        return Number(file.split("-")[0]);
      },
    ).filter((timestamp: number): boolean => {
      return Number.isFinite(timestamp) && timestamp > 0;
    });

    // The newest migration this change knew of is older than it.
    expect(Math.max(...timestamps)).toBeGreaterThanOrEqual(MIGRATION_TIMESTAMP);

    // No other migration shares its timestamp.
    expect(
      timestamps.filter((timestamp: number): boolean => {
        return timestamp === MIGRATION_TIMESTAMP;
      }),
    ).toHaveLength(1);
  });
});

describe("what a write may hold", () => {
  const refusal: (data: Record<string, unknown>) => string | null = (
    data: Record<string, unknown>,
  ): string | null => {
    try {
      assertDashboardWriteValues(data);
      return null;
    } catch (err) {
      expect(err).toBeInstanceOf(BadDataException);
      return (err as Error).message;
    }
  };

  test.each(
    DASHBOARD_THEMES.map((theme: DashboardTheme): Array<DashboardTheme> => {
      return [theme];
    }),
  )("%s is saved as it was sent", (theme: DashboardTheme) => {
    const data: Record<string, unknown> = { theme };

    expect(refusal(data)).toBeNull();
    expect(data["theme"]).toBe(theme);
  });

  test("no theme, or an emptied one, is saved: the dashboard is the light one", () => {
    expect(refusal({ theme: null })).toBeNull();
    expect(refusal({ name: "Checkout API" })).toBeNull();
  });

  test.each([
    ["another case", "dark"],
    ["the head's spelling", "system"],
    ["the visitor menu's Auto", "Auto"],
    ["an unknown theme", "High Contrast"],
    ["an empty string", ""],
    ["a number", 1],
    ["an object", { theme: "Dark" }],
  ])("%s is refused, naming the three", (_what: string, value: unknown) => {
    expect(refusal({ theme: value })).toBe(DASHBOARD_THEME_PROBLEM);
  });

  type Check = (write: unknown) => Promise<void>;

  const hooks: {
    checkCreateBeforeReferences: Check;
    checkUpdateBeforeReferences: Check;
  } = DashboardService as unknown as {
    checkCreateBeforeReferences: Check;
    checkUpdateBeforeReferences: Check;
  };

  test("every create is checked", async () => {
    const dashboard: Dashboard = new Dashboard();
    dashboard.theme = "Midnight" as DashboardTheme;

    await expect(
      hooks.checkCreateBeforeReferences({
        data: dashboard,
        props: { isRoot: true },
      } as CreateBy<Dashboard>),
    ).rejects.toThrow(DASHBOARD_THEME_PROBLEM);

    dashboard.theme = DashboardTheme.Dark;

    await hooks.checkCreateBeforeReferences({
      data: dashboard,
      props: { isRoot: true },
    } as CreateBy<Dashboard>);
  });

  test("every update is checked", async () => {
    await expect(
      hooks.checkUpdateBeforeReferences({
        query: {},
        data: { theme: "light" },
        props: { isRoot: true },
      } as unknown as UpdateBy<Dashboard>),
    ).rejects.toThrow(DASHBOARD_THEME_PROBLEM);

    await hooks.checkUpdateBeforeReferences({
      query: {},
      data: { theme: DashboardTheme.System },
      props: { isRoot: true },
    } as unknown as UpdateBy<Dashboard>);
  });

  test("an update that leaves the theme alone is not asked about it", async () => {
    await hooks.checkUpdateBeforeReferences({
      query: {},
      data: { pageTitle: "Checkout API" },
      props: { isRoot: true },
    } as unknown as UpdateBy<Dashboard>);
  });
});

describe("a dashboard created from now on", () => {
  type CreateHook = (createBy: CreateBy<Dashboard>) => Promise<{
    createBy: CreateBy<Dashboard>;
  }>;

  const onBeforeCreate: CreateHook = (
    DashboardService as unknown as { onBeforeCreate: CreateHook }
  ).onBeforeCreate.bind(DashboardService);

  const create: (dashboard: Dashboard) => Promise<Dashboard> = async (
    dashboard: Dashboard,
  ): Promise<Dashboard> => {
    dashboard.projectId = ObjectID.generate();
    dashboard.name = "Checkout API";

    const result: { createBy: CreateBy<Dashboard> } = await onBeforeCreate({
      data: dashboard,
      // As OneUptime itself creates: no plan, so no Free plan count.
      props: { isRoot: true },
      miscDataProps: {},
    } as unknown as CreateBy<Dashboard>);

    return result.createBy.data;
  };

  test("with no theme in its create, follows each visitor's device", async () => {
    const created: Dashboard = await create(new Dashboard());

    expect(NEW_DASHBOARD_THEME).toBe(DashboardTheme.System);
    expect(created.theme).toBe(DashboardTheme.System);
  });

  test("with an emptied theme in its create, follows each visitor's device", async () => {
    const dashboard: Dashboard = new Dashboard();
    dashboard.theme = null as unknown as DashboardTheme;

    expect((await create(dashboard)).theme).toBe(DashboardTheme.System);
  });

  test.each(
    DASHBOARD_THEMES.map((theme: DashboardTheme): Array<DashboardTheme> => {
      return [theme];
    }),
  )(
    "with %s in its create - what Terraform sends, Light included - keeps it",
    async (theme: DashboardTheme) => {
      const dashboard: Dashboard = new Dashboard();
      dashboard.theme = theme;

      expect((await create(dashboard)).theme).toBe(theme);
    },
  );

  test("a create that names an unreadable theme is refused before anything is filled in", async () => {
    const dashboard: Dashboard = new Dashboard();
    dashboard.theme = "dark" as DashboardTheme;

    await expect(create(dashboard)).rejects.toThrow(DASHBOARD_THEME_PROBLEM);
  });
});
