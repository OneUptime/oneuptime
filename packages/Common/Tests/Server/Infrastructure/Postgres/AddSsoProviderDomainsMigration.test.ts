import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  MigrationInterface,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { JoinTableMetadataArgs } from "typeorm/metadata-args/JoinTableMetadataArgs";
import type { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";
import Domain from "../../../../Models/DatabaseModels/Domain";
import ProjectOIDC from "../../../../Models/DatabaseModels/ProjectOidc";
import ProjectSSO from "../../../../Models/DatabaseModels/ProjectSso";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddSsoProviderDomains1809186400000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809186400000-AddSsoProviderDomains";
import { ColumnAccessControl } from "../../../../Types/BaseDatabase/AccessControl";
import { TableColumnMetadata } from "../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import Permission from "../../../../Types/Permission";

/*
 * THE DOMAINS A PROJECT'S SSO PROVIDER SERVES (#9824): the migration that
 * adds ProjectSSO.domains and ProjectOIDC.domains, the verified domains of
 * the project by which "Sign in with SSO" finds a provider, instead of by
 * the account an address has.
 *
 * The statements are EXECUTED against a fake QueryRunner rather than read as
 * text, so up() and down() are told apart. What matters beyond the SQL:
 *
 *  - two new join tables, each the model's @JoinTable, with nothing else:
 *    no row is written, so no provider lists a domain afterwards and none
 *    is offered by email until an admin adds one (what a domain reveals is
 *    theirs to decide);
 *  - deleting a provider or a domain takes its rows with it (ON DELETE
 *    CASCADE), so a deleted domain offers nothing;
 *  - the relation reads and writes exactly as the providers' teams do, on
 *    the same plans, and is never public;
 *  - the migration is registered, named consistently and ordered after every
 *    migration registered before it, or it silently never runs.
 *
 * (Generated with TypeORM's migration:generate against a database every
 * registered migration had run on; the schema drift check found nothing left
 * to generate once it had run, and down() then up() ran cleanly.)
 */

const MIGRATION_TIMESTAMP: string = "1809186400000";
const MIGRATION_BASE_NAME: string = "AddSsoProviderDomains";
const MIGRATION_FILE_NAME: string = `${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}.ts`;
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

const CLASS_TIMESTAMP: RegExp = /(\d{13})$/;

interface ProviderJoin {
  modelType: typeof ProjectSSO | typeof ProjectOIDC;
  providerTable: string;
  joinTable: string;
  providerColumn: string;
  teamsJoinTable: string;
}

const PROVIDERS: Array<ProviderJoin> = [
  {
    modelType: ProjectSSO,
    providerTable: "ProjectSSO",
    joinTable: "ProjectSsoDomain",
    providerColumn: "projectSsoId",
    teamsJoinTable: "ProjectSsoTeam",
  },
  {
    modelType: ProjectOIDC,
    providerTable: "ProjectOIDC",
    joinTable: "ProjectOidcDomain",
    providerColumn: "projectOidcId",
    teamsJoinTable: "ProjectOidcTeam",
  },
];

const UP: Array<string> = [
  `CREATE TABLE "ProjectSsoDomain" ("projectSsoId" uuid NOT NULL, "domainId" uuid NOT NULL, CONSTRAINT "PK_1891ac1dda28d0024d31bc56446" PRIMARY KEY ("projectSsoId", "domainId"))`,
  `CREATE INDEX "IDX_f67706010f6935678735d741db" ON "ProjectSsoDomain" ("projectSsoId") `,
  `CREATE INDEX "IDX_73e7c4346879567cf9bb58e7bc" ON "ProjectSsoDomain" ("domainId") `,
  `CREATE TABLE "ProjectOidcDomain" ("projectOidcId" uuid NOT NULL, "domainId" uuid NOT NULL, CONSTRAINT "PK_73be40b8c54b80e9a0662ccaf69" PRIMARY KEY ("projectOidcId", "domainId"))`,
  `CREATE INDEX "IDX_02a7fd40608c56045ea6d20362" ON "ProjectOidcDomain" ("projectOidcId") `,
  `CREATE INDEX "IDX_90acd7accb6ec20781af24edab" ON "ProjectOidcDomain" ("domainId") `,
  `ALTER TABLE "ProjectSsoDomain" ADD CONSTRAINT "FK_f67706010f6935678735d741dbe" FOREIGN KEY ("projectSsoId") REFERENCES "ProjectSSO"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "ProjectSsoDomain" ADD CONSTRAINT "FK_73e7c4346879567cf9bb58e7bc3" FOREIGN KEY ("domainId") REFERENCES "Domain"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "ProjectOidcDomain" ADD CONSTRAINT "FK_02a7fd40608c56045ea6d20362d" FOREIGN KEY ("projectOidcId") REFERENCES "ProjectOIDC"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
  `ALTER TABLE "ProjectOidcDomain" ADD CONSTRAINT "FK_90acd7accb6ec20781af24edab3" FOREIGN KEY ("domainId") REFERENCES "Domain"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
];

const DOWN: Array<string> = [
  `ALTER TABLE "ProjectOidcDomain" DROP CONSTRAINT "FK_90acd7accb6ec20781af24edab3"`,
  `ALTER TABLE "ProjectOidcDomain" DROP CONSTRAINT "FK_02a7fd40608c56045ea6d20362d"`,
  `ALTER TABLE "ProjectSsoDomain" DROP CONSTRAINT "FK_73e7c4346879567cf9bb58e7bc3"`,
  `ALTER TABLE "ProjectSsoDomain" DROP CONSTRAINT "FK_f67706010f6935678735d741dbe"`,
  `DROP INDEX "public"."IDX_90acd7accb6ec20781af24edab"`,
  `DROP INDEX "public"."IDX_02a7fd40608c56045ea6d20362"`,
  `DROP TABLE "ProjectOidcDomain"`,
  `DROP INDEX "public"."IDX_73e7c4346879567cf9bb58e7bc"`,
  `DROP INDEX "public"."IDX_f67706010f6935678735d741db"`,
  `DROP TABLE "ProjectSsoDomain"`,
];

async function statementsOf(step: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];
  const runner: QueryRunner = {
    query: (sql: string): Promise<undefined> => {
      statements.push(String(sql));
      return Promise.resolve(undefined);
    },
  } as unknown as QueryRunner;

  await new AddSsoProviderDomains1809186400000()[step](runner);

  return statements;
}

function joinTableOf(
  modelType: ProviderJoin["modelType"],
  propertyName: string,
): JoinTableMetadataArgs | undefined {
  return getMetadataArgsStorage().joinTables.find(
    (joinTable: JoinTableMetadataArgs): boolean => {
      return (
        joinTable.target === modelType &&
        joinTable.propertyName === propertyName
      );
    },
  );
}

function relationOf(
  modelType: ProviderJoin["modelType"],
  propertyName: string,
): RelationMetadataArgs | undefined {
  return getMetadataArgsStorage().relations.find(
    (relation: RelationMetadataArgs): boolean => {
      return (
        relation.target === modelType && relation.propertyName === propertyName
      );
    },
  );
}

function sortedAccess(
  access: ColumnAccessControl | null | undefined,
): Record<string, Array<Permission>> {
  return {
    create: [...(access?.create || [])].sort(),
    read: [...(access?.read || [])].sort(),
    update: [...(access?.update || [])].sort(),
  };
}

describe("executing it", () => {
  test("up() creates the two join tables, their indexes and keys, and nothing else", async () => {
    expect(await statementsOf("up")).toEqual(UP);
  });

  test("down() takes them back, keys first", async () => {
    expect(await statementsOf("down")).toEqual(DOWN);
  });

  /*
   * No provider is linked to a domain by the migration: Sign in with SSO
   * offers a provider by email only once an admin has chosen its domains.
   */
  test("writes no row: no provider lists a domain until an admin adds one", async () => {
    for (const statement of [
      ...(await statementsOf("up")),
      ...(await statementsOf("down")),
    ]) {
      // A statement that writes rows starts with what it does.
      expect(statement).not.toMatch(/^\s*(INSERT|UPDATE|DELETE|COPY)\b/i);
    }
  });

  test("deleting a provider or a domain deletes its rows", async () => {
    const keys: Array<string> = (await statementsOf("up")).filter(
      (statement: string): boolean => {
        return statement.includes("FOREIGN KEY");
      },
    );

    expect(keys).toHaveLength(4);

    for (const key of keys) {
      expect(key).toContain("ON DELETE CASCADE");
    }
  });

  test("is a MigrationInterface whose two steps are still named up and down", () => {
    const migration: MigrationInterface =
      new AddSsoProviderDomains1809186400000();

    expect(typeof migration.up).toBe("function");
    expect(typeof migration.down).toBe("function");
  });
});

describe.each(PROVIDERS)("$providerTable.domains", (provider: ProviderJoin) => {
  test("is the join table the migration creates", async () => {
    const joinTable: JoinTableMetadataArgs | undefined = joinTableOf(
      provider.modelType,
      "domains",
    );

    expect(joinTable?.name).toBe(provider.joinTable);
    expect(joinTable?.joinColumns).toEqual([
      { name: provider.providerColumn, referencedColumnName: "_id" },
    ]);
    expect(joinTable?.inverseJoinColumns).toEqual([
      { name: "domainId", referencedColumnName: "_id" },
    ]);

    const up: Array<string> = await statementsOf("up");

    expect(up).toContain(
      UP.find((statement: string): boolean => {
        return statement.startsWith(
          `CREATE TABLE "${provider.joinTable}" ("${provider.providerColumn}" uuid NOT NULL, "domainId" uuid NOT NULL`,
        );
      }),
    );
    expect(
      up.filter((statement: string): boolean => {
        return statement.includes(`"${provider.joinTable}" ADD CONSTRAINT`);
      }),
    ).toEqual([
      expect.stringContaining(
        `FOREIGN KEY ("${provider.providerColumn}") REFERENCES "${provider.providerTable}"("_id")`,
      ),
      expect.stringContaining(
        `FOREIGN KEY ("domainId") REFERENCES "Domain"("_id")`,
      ),
    ]);
  });

  test("lists the project's domains, as the teams list its teams", () => {
    const metadata: TableColumnMetadata =
      new provider.modelType().getTableColumnMetadata("domains");

    expect(metadata.type).toBe(TableColumnType.EntityArray);
    expect(metadata.modelType).toBe(Domain);
    expect(Boolean(metadata.required)).toBe(false);
    expect(relationOf(provider.modelType, "domains")?.relationType).toBe(
      "many-to-many",
    );
    expect(joinTableOf(provider.modelType, "teams")?.name).toBe(
      provider.teamsJoinTable,
    );
  });

  test("is read, created and changed by whoever may do so with its teams", () => {
    const model: ProjectSSO | ProjectOIDC = new provider.modelType();

    expect(sortedAccess(model.getColumnAccessControlFor("domains"))).toEqual(
      sortedAccess(model.getColumnAccessControlFor("teams")),
    );
  });

  /*
   * Which domains a provider serves is the project's own business: the
   * sign-in page is told the providers of a domain, never a provider's
   * domains.
   */
  test("is never read by a visitor or a person signing in", () => {
    const read: Array<Permission> =
      new provider.modelType().getColumnAccessControlFor("domains")?.read || [];

    expect(read).not.toContain(Permission.Public);
    expect(read).not.toContain(Permission.UnAuthorizedSsoUser);
    expect(read).not.toContain(Permission.CurrentUser);
  });

  test("needs the plan its teams need", () => {
    const model: ProjectSSO | ProjectOIDC = new provider.modelType();

    expect(model.getColumnBillingAccessControl("domains")).toEqual(
      model.getColumnBillingAccessControl("teams"),
    );
  });
});

describe("registering it", () => {
  test("the file, the class and its name agree", () => {
    expect(
      fs.existsSync(path.join(MIGRATION_DIRECTORY, MIGRATION_FILE_NAME)),
    ).toBe(true);
    expect(new AddSsoProviderDomains1809186400000().name).toBe(
      MIGRATION_CLASS_NAME,
    );
  });

  test("it is registered once, after every migration registered before it", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: unknown): string => {
        return (migration as { name: string }).name;
      },
    );

    expect(
      names.filter((name: string): boolean => {
        return name === MIGRATION_CLASS_NAME;
      }),
    ).toHaveLength(1);

    const position: number = names.indexOf(MIGRATION_CLASS_NAME);

    for (const earlier of names.slice(0, position)) {
      const timestamp: string | undefined = earlier.match(CLASS_TIMESTAMP)?.[1];

      if (timestamp) {
        expect([
          earlier,
          Number(timestamp) < Number(MIGRATION_TIMESTAMP),
        ]).toEqual([earlier, true]);
      }
    }
  });

  test("no other migration file creates the join tables - the wall-clock one typeorm generated was not left behind", () => {
    expect(
      fs
        .readdirSync(MIGRATION_DIRECTORY)
        .filter((fileName: string): boolean => {
          if (fileName === MIGRATION_FILE_NAME) {
            return false;
          }

          const source: string = fs.readFileSync(
            path.join(MIGRATION_DIRECTORY, fileName),
            "utf8",
          );

          return (
            source.includes(`CREATE TABLE "ProjectSsoDomain"`) ||
            source.includes(`CREATE TABLE "ProjectOidcDomain"`)
          );
        }),
    ).toEqual([]);
  });
});
