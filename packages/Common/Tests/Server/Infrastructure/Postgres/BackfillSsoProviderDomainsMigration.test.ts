import {
  BackfillSsoProviderDomains1809186540000,
  PROVIDER_DOMAINS_TABLES,
  ProviderDomainsTable,
  RESERVED_DOMAIN_NAMES,
  getBackfillStatement,
  getNotReservedDomainSql,
} from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809186540000-BackfillSsoProviderDomains";
import { AddSsoProviderDomains1809186480000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809186480000-AddSsoProviderDomains";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import ProjectOIDC from "../../../../Models/DatabaseModels/ProjectOidc";
import ProjectSSO from "../../../../Models/DatabaseModels/ProjectSso";
import DomainType from "../../../../Types/Domain";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  MigrationInterface,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { JoinTableMetadataArgs } from "typeorm/metadata-args/JoinTableMetadataArgs";

/*
 * EXISTING SSO PROVIDERS GET THEIR PROJECT'S OWN VERIFIED DOMAINS ON THE
 * UPGRADE (#9918).
 *
 * "Sign in with SSO" finds a project's providers by the address's verified
 * domain alone (#9824), and every provider made before that listed none, so
 * the page offered no existing provider to anyone after the upgrade.
 * BackfillSsoProviderDomains gives each provider that lists no domain the
 * verified domains its project alone holds. What is held here, with the
 * statements EXECUTED against a fake QueryRunner (the Postgres suite,
 * BackfillSsoProviderDomainsPostgres, runs them on real rows):
 *
 *  - one statement per kind of provider, writing only that kind's domain
 *    list, never changing or deleting a row anywhere;
 *  - it reads the domains, their projects and the providers, and no
 *    account, membership or invitation: what a provider is offered for
 *    depends on its project's domains, never on who has an account;
 *  - only a verified domain, not deleted, of a project not deleted, given
 *    only to a provider of that project that is not deleted and lists no
 *    domain yet;
 *  - never a name nobody can own (the reserved names, and the test domains
 *    that are verified without a TXT record);
 *  - never a name two projects have verified;
 *  - safe to run again; down() writes nothing;
 *  - registered once, after the migration that makes the tables it fills.
 */

const MIGRATION_TIMESTAMP: string = "1809186540000";
const MIGRATION_BASE_NAME: string = "BackfillSsoProviderDomains";
const MIGRATION_FILE_NAME: string = `${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}.ts`;
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

const CLASS_TIMESTAMP: RegExp = /(\d{13})$/;

async function statementsOf(step: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];
  const runner: QueryRunner = {
    query: (sql: string): Promise<undefined> => {
      statements.push(String(sql));
      return Promise.resolve(undefined);
    },
  } as unknown as QueryRunner;

  await new BackfillSsoProviderDomains1809186540000()[step](runner);

  return statements;
}

// Every table a statement names after FROM, JOIN or INTO.
function tablesOf(statement: string): Array<string> {
  const tables: Set<string> = new Set<string>();

  for (const match of statement.matchAll(/\b(?:FROM|JOIN|INTO)\s+"(\w+)"/g)) {
    tables.add(match[1] as string);
  }

  return Array.from(tables).sort();
}

const statementFor: (
  statements: Array<string>,
  table: ProviderDomainsTable,
) => string = (
  statements: Array<string>,
  table: ProviderDomainsTable,
): string => {
  const statement: string | undefined = statements.find(
    (sql: string): boolean => {
      return sql.includes(`INSERT INTO "${table.joinTable}"`);
    },
  );

  expect(statement).toBeDefined();

  return statement as string;
};

describe("executing it", () => {
  test("up() gives each kind of provider its domains, SAML first, in one statement each", async () => {
    expect(await statementsOf("up")).toEqual(
      PROVIDER_DOMAINS_TABLES.map((table: ProviderDomainsTable): string => {
        return getBackfillStatement(table);
      }),
    );
    expect(
      PROVIDER_DOMAINS_TABLES.map((table: ProviderDomainsTable): string => {
        return table.joinTable;
      }),
    ).toEqual(["ProjectSsoDomain", "ProjectOidcDomain"]);
  });

  test("down() writes nothing: a row it wrote cannot be told from one an admin picked since", async () => {
    expect(await statementsOf("down")).toEqual([]);
  });

  test("is a MigrationInterface whose two steps are still named up and down", () => {
    const migration: MigrationInterface =
      new BackfillSsoProviderDomains1809186540000();

    expect(typeof migration.up).toBe("function");
    expect(typeof migration.down).toBe("function");
  });

  test("the tables it fills are the providers' Domains join tables", () => {
    const joinTableOf: (
      modelType: typeof ProjectSSO | typeof ProjectOIDC,
    ) => JoinTableMetadataArgs | undefined = (
      modelType: typeof ProjectSSO | typeof ProjectOIDC,
    ): JoinTableMetadataArgs | undefined => {
      return getMetadataArgsStorage().joinTables.find(
        (joinTable: JoinTableMetadataArgs): boolean => {
          return (
            joinTable.target === modelType &&
            joinTable.propertyName === "domains"
          );
        },
      );
    };

    expect(
      PROVIDER_DOMAINS_TABLES.map(
        (
          table: ProviderDomainsTable,
        ): { table: string; join: string; column: string } => {
          const modelType: typeof ProjectSSO | typeof ProjectOIDC =
            table.providerTable === "ProjectSSO" ? ProjectSSO : ProjectOIDC;
          const joinTable: JoinTableMetadataArgs | undefined =
            joinTableOf(modelType);

          return {
            table: new modelType().tableName || "",
            join: joinTable?.name || "",
            column:
              (
                joinTable?.joinColumns as Array<{ name?: string }> | undefined
              )?.[0]?.name || "",
          };
        },
      ),
    ).toEqual(
      PROVIDER_DOMAINS_TABLES.map(
        (
          table: ProviderDomainsTable,
        ): { table: string; join: string; column: string } => {
          return {
            table: table.providerTable,
            join: table.joinTable,
            column: table.providerColumn,
          };
        },
      ),
    );
  });
});

describe.each(PROVIDER_DOMAINS_TABLES)(
  "for $providerTable",
  (table: ProviderDomainsTable) => {
    test("writes only its own domain list, and changes or deletes nothing", async () => {
      const statement: string = statementFor(await statementsOf("up"), table);

      expect(statement).toContain(
        `INSERT INTO "${table.joinTable}" ("${table.providerColumn}", "domainId")`,
      );
      expect(statement.match(/\bINSERT\b/g)).toHaveLength(1);
      expect(statement).not.toMatch(/\b(UPDATE|DELETE|TRUNCATE|DROP|ALTER)\b/);
    });

    test("reads the domains, their projects and the providers, and no account, membership or invitation", async () => {
      const statement: string = statementFor(await statementsOf("up"), table);

      expect(tablesOf(statement)).toEqual(
        [
          "Domain",
          "Project",
          "ProjectOwnDomain",
          "VerifiedName",
          table.providerTable,
          table.joinTable,
        ].sort(),
      );

      for (const accountTable of [
        "User",
        "TeamMember",
        "UserSession",
        "Team",
      ]) {
        expect(statement).not.toContain(`"${accountTable}"`);
      }
    });

    test("gives only verified domains that are not deleted, of projects that are not deleted", async () => {
      const statement: string = statementFor(await statementsOf("up"), table);

      // Counted and given alike: each reads "Domain" twice over.
      expect(statement.match(/"Domain"\."isVerified" = true/g)?.length).toBe(2);
      expect(statement.match(/"Domain"\."deletedAt" IS NULL/g)?.length).toBe(2);
      expect(
        statement.match(
          /INNER JOIN "Project" ON "Project"\."_id" = "Domain"\."projectId" AND "Project"\."deletedAt" IS NULL/g,
        )?.length,
      ).toBe(2);
    });

    test("gives a provider only its own project's domains, and only a provider that is not deleted", async () => {
      const statement: string = statementFor(await statementsOf("up"), table);

      expect(statement).toContain(
        `FROM "${table.providerTable}" AS "Provider" INNER JOIN "ProjectOwnDomain" ON "ProjectOwnDomain"."projectId" = "Provider"."projectId"`,
      );
      expect(statement).toContain(`WHERE "Provider"."deletedAt" IS NULL`);
    });

    test("leaves a provider that lists a domain as its admin left it", async () => {
      const statement: string = statementFor(await statementsOf("up"), table);

      expect(statement).toContain(
        `AND NOT EXISTS (SELECT 1 FROM "${table.joinTable}" AS "Listed" WHERE "Listed"."${table.providerColumn}" = "Provider"."_id")`,
      );
    });

    test("never gives a name another project has verified too, whatever its case or spaces", async () => {
      const statement: string = statementFor(await statementsOf("up"), table);

      expect(statement).toContain(
        `SELECT LOWER(TRIM("Domain"."domain")) AS "name", COUNT(DISTINCT "Domain"."projectId") AS "projectCount"`,
      );
      expect(statement).toContain(`GROUP BY LOWER(TRIM("Domain"."domain"))`);
      expect(statement).toContain(
        `INNER JOIN "VerifiedName" ON "VerifiedName"."name" = LOWER(TRIM("Domain"."domain")) AND "VerifiedName"."projectCount" = 1`,
      );
    });

    test("never gives a name nobody can own", async () => {
      const statement: string = statementFor(await statementsOf("up"), table);

      expect(statement).toContain(getNotReservedDomainSql());
    });

    test("can run again: a row already there is left alone", async () => {
      const statement: string = statementFor(await statementsOf("up"), table);

      expect(statement.endsWith("ON CONFLICT DO NOTHING")).toBe(true);
    });
  },
);

describe("the names nobody can own", () => {
  const sql: string = getNotReservedDomainSql();

  test("are every name Types/Domain reserves, as itself and as a parent", () => {
    expect([...RESERVED_DOMAIN_NAMES].sort()).toEqual(
      [...DomainType.RESERVED_NAMES].sort(),
    );

    for (const name of DomainType.RESERVED_NAMES) {
      expect(sql).toContain(`'${name}'`);
      expect(sql).toContain(`LOWER(TRIM("Domain"."domain")) LIKE '%.${name}'`);
    }
  });

  /*
   * A project may mark these verified as it adds them, with no TXT record
   * (DomainService): verified proves nothing of them.
   */
  test("cover every test domain verified without a TXT record", () => {
    for (const suffix of DomainType.TEST_DOMAIN_SUFFIXES) {
      expect(
        RESERVED_DOMAIN_NAMES.some((name: string): boolean => {
          return suffix === `.${name}` || suffix.endsWith(`.${name}`);
        }),
      ).toBe(true);
    }
  });

  test("are written as the statement's own words, with no value anyone sent", () => {
    expect(sql.startsWith("NOT (")).toBe(true);

    for (const name of RESERVED_DOMAIN_NAMES) {
      expect(name).toMatch(/^[a-z.]+$/);
    }
  });
});

describe("registering it", () => {
  test("the file, the class and its name agree", () => {
    expect(
      fs.existsSync(path.join(MIGRATION_DIRECTORY, MIGRATION_FILE_NAME)),
    ).toBe(true);
    expect(new BackfillSsoProviderDomains1809186540000().name).toBe(
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

  test("it runs after the migration that makes the tables it fills", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: unknown): string => {
        return (migration as { name: string }).name;
      },
    );

    expect(names.indexOf(MIGRATION_CLASS_NAME)).toBeGreaterThan(
      names.indexOf(new AddSsoProviderDomains1809186480000().name),
    );
    expect(
      names.indexOf(new AddSsoProviderDomains1809186480000().name),
    ).toBeGreaterThan(-1);
  });
});
