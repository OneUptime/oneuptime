/**
 * StatusPage.theme: the column, the migration that adds it, and every write
 * of it.
 *
 * Three promises, each carried by something different and each easy to
 * break with a one-word edit:
 *
 *   - Nothing changes for a page that exists today: the migration adds the
 *     column with DEFAULT 'Light', which Postgres gives every existing row.
 *   - Nothing changes for a Terraform configuration that names no theme: the
 *     column's documented default (TableColumn.defaultValue) is Light, and it
 *     is the static default the generated provider plans and sends - Light,
 *     so it never plans a change on a page that has Light.
 *   - A page made from now on in the dashboard or through the API, with no
 *     theme in its create, follows each visitor's device:
 *     StatusPageService.onBeforeCreate fills in System.
 *
 * And a theme no reader knows is refused on every create and update.
 */

import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import ProjectService from "../../../Server/Services/ProjectService";
import StatusPageService, {
  assertStatusPageWriteValues,
} from "../../../Server/Services/StatusPageService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import OwnerRuleAssignment from "../../../Server/Utils/Rules/OwnerRuleAssignment";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import ColumnLength from "../../../Types/Database/ColumnLength";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import StatusPageTheme, {
  NEW_STATUS_PAGE_THEME,
  STATUS_PAGE_THEMES,
  STATUS_PAGE_THEME_COLUMN,
  STATUS_PAGE_THEME_PROBLEM,
} from "../../../Types/StatusPage/StatusPageTheme";
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

const MIGRATION_FILE: string = "1803200000000-AddStatusPageTheme.ts";

const metadata: () => TableColumnMetadata = (): TableColumnMetadata => {
  return new StatusPage().getTableColumnMetadata(STATUS_PAGE_THEME_COLUMN);
};

const typeOrmColumn: () => ColumnMetadataArgs | undefined = ():
  | ColumnMetadataArgs
  | undefined => {
  return getMetadataArgsStorage().columns.find(
    (column: ColumnMetadataArgs): boolean => {
      return (
        column.target === StatusPage &&
        column.propertyName === STATUS_PAGE_THEME_COLUMN
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

    for (const theme of STATUS_PAGE_THEMES) {
      expect(metadata().description).toContain(theme);
    }
  });

  test("its documented default is Light, the one the Terraform provider sends, so it never flips a page", () => {
    expect(metadata().defaultValue).toBe(StatusPageTheme.Light);
  });

  test("its Postgres default is Light too, so the column and the models never drift", () => {
    expect(typeOrmColumn()?.options.default).toBe(StatusPageTheme.Light);
    expect(typeOrmColumn()?.options.nullable).toBe(true);
    expect(typeOrmColumn()?.options.length).toBe(ColumnLength.ShortText);
  });

  test("is free on every plan: it is how the page looks, not what it shows", () => {
    expect(
      new StatusPage().getColumnBillingAccessControl(STATUS_PAGE_THEME_COLUMN),
    ).toBeUndefined();
  });

  test("whoever may set the page's default bar colour may set its theme, and whoever may read the page reads it", () => {
    const page: StatusPage = new StatusPage();

    expect(page.getColumnAccessControlFor(STATUS_PAGE_THEME_COLUMN)).toEqual(
      page.getColumnAccessControlFor("defaultBarColor"),
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

  test("gives every status page that exists today Light, in the statement that adds the column", () => {
    expect(source).toContain(
      `ALTER TABLE "StatusPage" ADD "theme" character varying(100) DEFAULT 'Light'`,
    );
    // No UPDATE of its own: the column's default fills the existing rows.
    expect(source).not.toContain("UPDATE ");
  });

  test("can be taken back", () => {
    expect(source).toContain(`ALTER TABLE "StatusPage" DROP COLUMN "theme"`);
  });

  test("is registered, after every migration before it", () => {
    const className: string = "AddStatusPageTheme1803200000000";

    expect(index).toContain(
      `import { ${className} } from "./1803200000000-AddStatusPageTheme";`,
    );

    const registered: Array<string> = Array.from(
      index.matchAll(/^\s{2}(\w+?(\d{13})),$/gm),
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
    expect(Math.max(...timestamps)).toBeGreaterThanOrEqual(1803200000000);
  });
});

describe("what a write may hold", () => {
  const refusal: (data: Record<string, unknown>) => string | null = (
    data: Record<string, unknown>,
  ): string | null => {
    try {
      assertStatusPageWriteValues(data);
      return null;
    } catch (err) {
      expect(err).toBeInstanceOf(BadDataException);
      return (err as Error).message;
    }
  };

  test.each(STATUS_PAGE_THEMES.map((theme: StatusPageTheme) => [theme]))(
    "%s is saved as it was sent",
    (theme: StatusPageTheme) => {
      const data: Record<string, unknown> = { theme };

      expect(refusal(data)).toBeNull();
      expect(data["theme"]).toBe(theme);
    },
  );

  test("no theme, or an emptied one, is saved: the page is the light one", () => {
    expect(refusal({ theme: null })).toBeNull();
    expect(refusal({ name: "Acme" })).toBeNull();
  });

  test.each([
    ["another case", "dark"],
    ["an unknown theme", "High Contrast"],
    ["an empty string", ""],
    ["a number", 1],
    ["an object", { theme: "Dark" }],
  ])("%s is refused, naming the three", (_what: string, value: unknown) => {
    expect(refusal({ theme: value })).toBe(STATUS_PAGE_THEME_PROBLEM);
  });

  type Check = (write: unknown) => Promise<void>;

  const hooks: {
    checkCreateBeforeReferences: Check;
    checkUpdateBeforeReferences: Check;
  } = StatusPageService as unknown as {
    checkCreateBeforeReferences: Check;
    checkUpdateBeforeReferences: Check;
  };

  test("every create is checked", async () => {
    const page: StatusPage = new StatusPage();
    page.theme = "Midnight" as StatusPageTheme;

    await expect(
      hooks.checkCreateBeforeReferences({
        data: page,
        props: { isRoot: true },
      } as CreateBy<StatusPage>),
    ).rejects.toThrow(STATUS_PAGE_THEME_PROBLEM);

    page.theme = StatusPageTheme.Dark;

    await hooks.checkCreateBeforeReferences({
      data: page,
      props: { isRoot: true },
    } as CreateBy<StatusPage>);
  });

  test("every update is checked", async () => {
    await expect(
      hooks.checkUpdateBeforeReferences({
        query: {},
        data: { theme: "light" },
        props: { isRoot: true },
      } as unknown as UpdateBy<StatusPage>),
    ).rejects.toThrow(STATUS_PAGE_THEME_PROBLEM);

    await hooks.checkUpdateBeforeReferences({
      query: {},
      data: { theme: StatusPageTheme.System },
      props: { isRoot: true },
    } as unknown as UpdateBy<StatusPage>);
  });
});

describe("a status page created from now on", () => {
  type CreateHook = (createBy: CreateBy<StatusPage>) => Promise<{
    createBy: CreateBy<StatusPage>;
  }>;

  const onBeforeCreate: CreateHook = (
    StatusPageService as unknown as { onBeforeCreate: CreateHook }
  ).onBeforeCreate.bind(StatusPageService);

  const create: (page: StatusPage) => Promise<StatusPage> = async (
    page: StatusPage,
  ): Promise<StatusPage> => {
    jest
      .spyOn(OwnerRuleAssignment, "checkOwnersPickedOnCreate")
      .mockResolvedValue(undefined);
    // With billing on (CI), the create asks the project's plan.
    jest.spyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
      plan: PlanType.Scale,
      isSubscriptionUnpaid: false,
    } as Awaited<ReturnType<typeof ProjectService.getCurrentPlan>>);

    page.projectId = ObjectID.generate();
    page.name = "Acme Status";
    // Named, so the hook does not look the project's statuses up.
    page.downtimeMonitorStatuses = [];

    const result: { createBy: CreateBy<StatusPage> } = await onBeforeCreate({
      data: page,
      props: { isRoot: true },
      miscDataProps: {},
    } as unknown as CreateBy<StatusPage>);

    return result.createBy.data;
  };

  test("with no theme in its create, follows each visitor's device", async () => {
    const created: StatusPage = await create(new StatusPage());

    expect(NEW_STATUS_PAGE_THEME).toBe(StatusPageTheme.System);
    expect(created.theme).toBe(StatusPageTheme.System);
  });

  test("with an emptied theme in its create, follows each visitor's device", async () => {
    const page: StatusPage = new StatusPage();
    page.theme = null as unknown as StatusPageTheme;

    expect((await create(page)).theme).toBe(StatusPageTheme.System);
  });

  test.each(STATUS_PAGE_THEMES.map((theme: StatusPageTheme) => [theme]))(
    "with %s in its create - what Terraform sends, Light included - keeps it",
    async (theme: StatusPageTheme) => {
      const page: StatusPage = new StatusPage();
      page.theme = theme;

      expect((await create(page)).theme).toBe(theme);
    },
  );
});
