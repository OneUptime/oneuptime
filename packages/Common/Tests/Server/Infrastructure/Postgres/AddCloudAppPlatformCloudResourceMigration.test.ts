import CloudApp from "../../../../Models/DatabaseModels/CloudApp";
import OnlineDdl from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import { AddCloudAppPlatformCloudResource1809187383700 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187383700-AddCloudAppPlatformCloudResource";
import { AddCloudAppPlatformCloudResourceIndexAndKey1809187383710 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187383710-AddCloudAppPlatformCloudResourceIndexAndKey";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import {
  DefaultNamingStrategy,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import type { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import type { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * AN APP SERVICE APP KEEPS THE SITE IT IS TIED TO (#10407).
 *
 * CloudApp.platformCloudResourceId: the Cloud Resource the app runs as in
 * its cloud's monitoring, set by CloudAppService.linkPlatformResources, so
 * the lists, monitors and the AI read the app's site without looking it up
 * again. One nullable column, an index and a foreign key, named as TypeORM
 * names them, so the schema drift check finds nothing to change. No row is
 * rewritten: a nullable column with no default is added without one.
 *
 * The index and foreign key are built online, in a migration of their own
 * outside a transaction (OnlineDdl): the ingest writes "CloudApp" for every
 * app of every environment. The key empties the link when the site's row
 * is deleted (ON DELETE SET NULL): the app stays, untied.
 *
 * Pure SQL-contract assertions against a fake QueryRunner; OnlineDdl's own
 * steps are recorded as "online: <statement>".
 */

const naming: DefaultNamingStrategy = new DefaultNamingStrategy();
const INDEX: string = naming.indexName("CloudApp", ["platformCloudResourceId"]);
const FOREIGN_KEY: string = naming.foreignKeyName(
  "CloudApp",
  ["platformCloudResourceId"],
  "CloudResource",
  ["_id"],
);

const UPDATE_STATEMENT: RegExp = /^UPDATE/;

async function statementsOf(
  run: (runner: QueryRunner) => Promise<void>,
): Promise<Array<string>> {
  const statements: Array<string> = [];

  for (const step of ["createIndex", "addForeignKey", "dropIndex"] as const) {
    jest.spyOn(OnlineDdl, step).mockImplementation((async (
      _runner: QueryRunner,
      statement: string,
    ) => {
      statements.push(`online: ${statement}`);
    }) as never);
  }

  await run({
    isTransactionActive: false,
    query: (sql: string): Promise<undefined> => {
      statements.push(sql);
      return Promise.resolve(undefined);
    },
  } as unknown as QueryRunner);

  return statements;
}

afterEach(() => {
  jest.restoreAllMocks();
});

function columnOf(property: string): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage()
    .columns.filter((args: ColumnMetadataArgs) => {
      return args.target === CloudApp && args.propertyName === property;
    })
    .pop();
}

describe("AddCloudAppPlatformCloudResource1809187383700", () => {
  test("adds the site's column - and nothing else", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddCloudAppPlatformCloudResource1809187383700().up(runner);
      }),
    ).toEqual([`ALTER TABLE "CloudApp" ADD "platformCloudResourceId" uuid`]);
  });

  test("never rewrites the table: the column is nullable, with no default", async () => {
    const statements: Array<string> = await statementsOf(
      (runner: QueryRunner) => {
        return new AddCloudAppPlatformCloudResource1809187383700().up(runner);
      },
    );

    for (const statement of statements) {
      expect(statement).not.toContain("DEFAULT");
      expect(statement).not.toContain("NOT NULL");
      expect(statement).not.toMatch(UPDATE_STATEMENT);
    }
  });

  test("down() takes back exactly what up() added", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddCloudAppPlatformCloudResource1809187383700().down(runner);
      }),
    ).toEqual([`ALTER TABLE "CloudApp" DROP COLUMN "platformCloudResourceId"`]);
  });

  test("is registered after the migrations before it, and named for its class", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: unknown): string => {
        return (migration as { name: string }).name;
      },
    );
    const index: number = names.indexOf(
      "AddCloudAppPlatformCloudResource1809187383700",
    );

    expect(index).toBeGreaterThan(-1);
    // CloudApp's own columns came before it.
    expect(index).toBeGreaterThan(
      names.indexOf("AddFormPrivateUsersAndSingleSignOn1809187140120"),
    );
    expect(new AddCloudAppPlatformCloudResource1809187383700().name).toBe(
      "AddCloudAppPlatformCloudResource1809187383700",
    );
  });
});

describe("AddCloudAppPlatformCloudResourceIndexAndKey1809187383710", () => {
  test("the index and the key are named as TypeORM names them: the drift check finds nothing", () => {
    expect(INDEX).toBe("IDX_1b04c802f1e89284dfeaf2bdfe");
    expect(FOREIGN_KEY).toBe("FK_1b04c802f1e89284dfeaf2bdfe2");
  });

  test("builds the site's index and foreign key online, outside a transaction", async () => {
    const migration: AddCloudAppPlatformCloudResourceIndexAndKey1809187383710 =
      new AddCloudAppPlatformCloudResourceIndexAndKey1809187383710();

    expect(migration.transaction).toBe(false);
    expect(
      await statementsOf((runner: QueryRunner) => {
        return migration.up(runner);
      }),
    ).toEqual([
      `online: CREATE INDEX "${INDEX}" ON "CloudApp" ("platformCloudResourceId") `,
      `online: ALTER TABLE "CloudApp" ADD CONSTRAINT "${FOREIGN_KEY}" FOREIGN KEY ("platformCloudResourceId") REFERENCES "CloudResource"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    ]);
  });

  test("down() takes the key, then the index, away - the column's migration then the column", async () => {
    expect(
      await statementsOf((runner: QueryRunner) => {
        return new AddCloudAppPlatformCloudResourceIndexAndKey1809187383710().down(
          runner,
        );
      }),
    ).toEqual([
      `ALTER TABLE "CloudApp" DROP CONSTRAINT "${FOREIGN_KEY}"`,
      `online: DROP INDEX "public"."${INDEX}"`,
    ]);
  });

  test("is registered right after the column's migration, once, named for its class", () => {
    const registered: Array<unknown> = SchemaMigrations as Array<unknown>;
    const at: number = registered.indexOf(
      AddCloudAppPlatformCloudResource1809187383700,
    );

    expect(at).toBeGreaterThan(-1);
    expect(registered[at + 1]).toBe(
      AddCloudAppPlatformCloudResourceIndexAndKey1809187383710,
    );
    expect(
      registered.filter((candidate: unknown): boolean => {
        return (
          candidate === AddCloudAppPlatformCloudResourceIndexAndKey1809187383710
        );
      }),
    ).toHaveLength(1);
    expect(
      new AddCloudAppPlatformCloudResourceIndexAndKey1809187383710().name,
    ).toBe("AddCloudAppPlatformCloudResourceIndexAndKey1809187383710");
  });
});

describe("the CloudApp model says the same", () => {
  test("the site: a nullable id, indexed, emptied when the site's row is deleted - the app stays", () => {
    expect(columnOf("platformCloudResourceId")?.options.nullable).toBe(true);

    const indexed: Array<unknown> = getMetadataArgsStorage()
      .indices.filter((index: IndexMetadataArgs) => {
        return index.target === CloudApp;
      })
      .map((index: IndexMetadataArgs): unknown => {
        return index.columns;
      });

    expect(indexed).toContainEqual(["platformCloudResourceId"]);

    const relation: RelationMetadataArgs | undefined = getMetadataArgsStorage()
      .relations.filter((args: RelationMetadataArgs) => {
        return (
          args.target === CloudApp &&
          args.propertyName === "platformCloudResource"
        );
      })
      .pop();

    expect(relation?.relationType).toBe("many-to-one");
    expect(relation?.options.onDelete).toBe("SET NULL");
    expect(relation?.options.nullable).toBe(true);
  });

  test("read as the app's other columns are; nobody writes it through the API", () => {
    const app: CloudApp = new CloudApp();

    for (const column of ["platformCloudResourceId", "platformCloudResource"]) {
      const access: {
        create: Array<unknown>;
        read: Array<unknown>;
        update: Array<unknown>;
      } = app.getColumnAccessControlForAllColumns()[column] as {
        create: Array<unknown>;
        read: Array<unknown>;
        update: Array<unknown>;
      };

      expect(access.create).toEqual([]);
      expect(access.update).toEqual([]);
      expect(access.read).toEqual(
        app.getColumnAccessControlForAllColumns()["providerResourceId"]?.read,
      );
    }
  });
});
