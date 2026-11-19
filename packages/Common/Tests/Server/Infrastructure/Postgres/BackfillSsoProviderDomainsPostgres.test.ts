import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import { BackfillSsoProviderDomains1809186620000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809186620000-BackfillSsoProviderDomains";
import logger from "../../../../Server/Utils/Logger";
import ProjectSsoDiscovery from "../../../../Server/Utils/ProjectSsoDiscovery";
import Entities from "../../../../Models/DatabaseModels/Index";
import ProjectOIDC from "../../../../Models/DatabaseModels/ProjectOidc";
import ProjectSSO from "../../../../Models/DatabaseModels/ProjectSso";
import Email from "../../../../Types/Email";
import ObjectID from "../../../../Types/ObjectID";
import { getJestSpyOn } from "../../../Spy";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource, Logger, QueryRunner } from "typeorm";

/*
 * EXISTING SSO PROVIDERS GET THEIR PROJECT'S OWN VERIFIED DOMAINS ON THE
 * UPGRADE, AGAINST POSTGRES (#9918).
 *
 * "Sign in with SSO" finds a project's providers by the address's verified
 * domain alone (#9824, Server/Utils/ProjectSsoDiscovery). Every provider
 * made before that listed no domain, so after the upgrade the page offered
 * no existing provider to anyone. BackfillSsoProviderDomains1809186620000
 * gives each provider that lists none the verified domains its project, and
 * no other project, holds. This runs its real statements on rows shaped as
 * an install has them before the upgrade - projects with no verified
 * domain, one and several; a domain two projects verified; domains claimed
 * and never verified; deleted rows; names nobody can own - and then the
 * lookup itself on the result: an existing customer's people are offered
 * their providers again, and an address still says nothing about whether
 * it has an account.
 *
 * Opt in with RUN_POSTGRES_SSO_DOMAIN_BACKFILL_TESTS=true against a database
 * the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_SSO_DOMAIN_BACKFILL_TESTS=true \
 *   SSO_DOMAIN_BACKFILL_TEST_DATABASE_HOST=127.0.0.1 \
 *   SSO_DOMAIN_BACKFILL_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Infrastructure/Postgres/BackfillSsoProviderDomainsPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml. Only the
 * tables' definitions are copied from public, into a uniquely named schema
 * that is dropped afterwards; every row is synthetic.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_SSO_DOMAIN_BACKFILL_TESTS"] === "true"
    ? describe
    : describe.skip;

// The tables the backfill and the lookup read, and the accounts they never do.
const TABLES: Array<string> = [
  "Project",
  "Domain",
  "ProjectSSO",
  "ProjectOIDC",
  "ProjectSsoDomain",
  "ProjectOidcDomain",
  "User",
  "TeamMember",
];

type ProviderTable = "ProjectSSO" | "ProjectOIDC";

const JOIN_TABLES: Record<
  ProviderTable,
  { joinTable: string; ownerColumn: string }
> = {
  ProjectSSO: { joinTable: "ProjectSsoDomain", ownerColumn: "projectSsoId" },
  ProjectOIDC: { joinTable: "ProjectOidcDomain", ownerColumn: "projectOidcId" },
};

// The SQL and the values of every statement TypeORM ran while recording.
interface RecordedQuery {
  sql: string;
  parameters: Array<unknown>;
}

describePostgres(
  "Existing SSO providers get their project's own verified domains on the upgrade, on Postgres",
  () => {
    const schema: string = `sso_domain_backfill_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;

    let database: DataSource;
    let recording: Array<RecordedQuery> | null = null;

    const recordingLogger: Logger = {
      logQuery: (query: string, parameters?: Array<unknown>): void => {
        recording?.push({ sql: query, parameters: parameters || [] });
      },
      logQueryError: (): void => {
        return undefined;
      },
      logQuerySlow: (): void => {
        return undefined;
      },
      logSchemaBuild: (): void => {
        return undefined;
      },
      logMigration: (): void => {
        return undefined;
      },
      log: (): void => {
        return undefined;
      },
    };

    const query: (sql: string, parameters?: Array<unknown>) => Promise<any> = (
      sql: string,
      parameters?: Array<unknown>,
    ): Promise<any> => {
      return database.query(sql, parameters);
    };

    // Rows are added a second apart, so "the order they were added" is plain.
    let clock: number;

    const nextCreatedAt: () => Date = (): Date => {
      clock += 1000;
      return new Date(clock);
    };

    const addProject: (
      name: string,
      options?: { deletedAt?: Date },
    ) => Promise<string> = async (
      name: string,
      options?: { deletedAt?: Date },
    ): Promise<string> => {
      const id: string = ObjectID.generate().toString();

      await query(
        `INSERT INTO "${schema}"."Project" ("_id", "name", "slug", "version", "createdAt", "deletedAt") VALUES ($1, $2, $3, 1, $4, $5)`,
        [
          id,
          name,
          `project-${id}`,
          nextCreatedAt(),
          options?.deletedAt || null,
        ],
      );

      return id;
    };

    const addDomain: (data: {
      projectId: string;
      domain: string;
      isVerified: boolean;
      deletedAt?: Date;
    }) => Promise<string> = async (data: {
      projectId: string;
      domain: string;
      isVerified: boolean;
      deletedAt?: Date;
    }): Promise<string> => {
      const id: string = ObjectID.generate().toString();

      await query(
        `INSERT INTO "${schema}"."Domain" ("_id", "version", "projectId", "domain", "slug", "isVerified", "domainVerificationText", "createdAt", "deletedAt") VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          id,
          data.projectId,
          data.domain,
          `domain-${id}`,
          data.isVerified,
          `oneuptime-verification-${id}`,
          nextCreatedAt(),
          data.deletedAt || null,
        ],
      );

      return id;
    };

    const addProvider: (data: {
      table: ProviderTable;
      projectId: string;
      name: string;
      isEnabled: boolean;
      domainIds?: Array<string>;
      deletedAt?: Date;
    }) => Promise<string> = async (data: {
      table: ProviderTable;
      projectId: string;
      name: string;
      isEnabled: boolean;
      domainIds?: Array<string>;
      deletedAt?: Date;
    }): Promise<string> => {
      const id: string = ObjectID.generate().toString();

      if (data.table === "ProjectSSO") {
        await query(
          `INSERT INTO "${schema}"."ProjectSSO" ("_id", "version", "projectId", "name", "description", "signatureMethod", "digestMethod", "signOnURL", "issuerURL", "publicCertificate", "isEnabled", "createdAt", "deletedAt") VALUES ($1, 1, $2, $3, 'Synthetic', 'RSA-SHA256', 'SHA256', 'https://idp.example.com/sso', 'https://idp.example.com', 'synthetic-certificate', $4, $5, $6)`,
          [
            id,
            data.projectId,
            data.name,
            data.isEnabled,
            nextCreatedAt(),
            data.deletedAt || null,
          ],
        );
      } else {
        await query(
          `INSERT INTO "${schema}"."ProjectOIDC" ("_id", "version", "projectId", "name", "description", "discoveryURL", "issuerURL", "clientId", "clientSecret", "scopes", "emailClaimName", "nameClaimName", "isEnabled", "createdAt", "deletedAt") VALUES ($1, 1, $2, $3, 'Synthetic', 'https://idp.example.com/.well-known/openid-configuration', 'https://idp.example.com', 'client', 'synthetic-secret', 'openid email profile', 'email', 'name', $4, $5, $6)`,
          [
            id,
            data.projectId,
            data.name,
            data.isEnabled,
            nextCreatedAt(),
            data.deletedAt || null,
          ],
        );
      }

      for (const domainId of data.domainIds || []) {
        await query(
          `INSERT INTO "${schema}"."${JOIN_TABLES[data.table].joinTable}" ("${JOIN_TABLES[data.table].ownerColumn}", "domainId") VALUES ($1, $2)`,
          [id, domainId],
        );
      }

      return id;
    };

    // An account, and its membership of a project: what the lookup never reads.
    const addMember: (data: {
      email: string;
      projectId: string;
    }) => Promise<void> = async (data: {
      email: string;
      projectId: string;
    }): Promise<void> => {
      const userId: string = ObjectID.generate().toString();

      await query(
        `INSERT INTO "${schema}"."User" ("_id", "version", "email", "name", "slug", "createdAt") VALUES ($1, 1, $2, 'Synthetic Person', $3, $4)`,
        [userId, data.email, `user-${userId}`, nextCreatedAt()],
      );
      await query(
        `INSERT INTO "${schema}"."TeamMember" ("_id", "version", "projectId", "userId", "hasAcceptedInvitation", "createdAt") VALUES ($1, 1, $2, $3, true, $4)`,
        [
          ObjectID.generate().toString(),
          data.projectId,
          userId,
          nextCreatedAt(),
        ],
      );
    };

    // The domains each provider lists, by the provider's id, sorted.
    const listed: (
      table: ProviderTable,
    ) => Promise<Record<string, string[]>> = async (
      table: ProviderTable,
    ): Promise<Record<string, string[]>> => {
      const rows: Array<{ providerId: string; domainId: string }> = await query(
        `SELECT "${JOIN_TABLES[table].ownerColumn}"::text AS "providerId", "domainId"::text AS "domainId" FROM "${schema}"."${JOIN_TABLES[table].joinTable}"`,
      );

      const byProvider: Record<string, string[]> = {};

      for (const row of rows) {
        (byProvider[row.providerId] ||= []).push(row.domainId);
      }

      for (const providerId of Object.keys(byProvider)) {
        byProvider[providerId]!.sort();
      }

      return byProvider;
    };

    const rowCount: (table: string) => Promise<number> = async (
      table: string,
    ): Promise<number> => {
      const rows: Array<{ count: string }> = await query(
        `SELECT COUNT(*)::text AS "count" FROM "${schema}"."${table}"`,
      );

      return Number(rows[0]?.count || "0");
    };

    // The upgrade's step: the migration, as the migration runner runs it.
    const runBackfill: () => Promise<void> = async (): Promise<void> => {
      const runner: QueryRunner = database.createQueryRunner();

      try {
        await runner.startTransaction();
        await new BackfillSsoProviderDomains1809186620000().up(runner);
        await runner.commitTransaction();
      } catch (error) {
        await runner.rollbackTransaction();
        throw error;
      } finally {
        await runner.release();
      }
    };

    const sorted: (ids: Array<string>) => Array<string> = (
      ids: Array<string>,
    ): Array<string> => {
      return [...ids].sort();
    };

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["SSO_DOMAIN_BACKFILL_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["SSO_DOMAIN_BACKFILL_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["SSO_DOMAIN_BACKFILL_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        logging: true,
        logger: recordingLogger,
        extra: { options: `-c search_path=${schema},public` },
      });
      await database.initialize();
      await query(`CREATE SCHEMA "${schema}"`);

      for (const table of TABLES) {
        await query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      const currentSchema: Array<{ current_schema: string }> = await query(
        "SELECT current_schema()",
      );
      expect(currentSchema[0]?.current_schema).toBe(schema);
    });

    afterAll(async () => {
      if (database?.isInitialized) {
        await query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    beforeEach(async () => {
      recording = null;

      for (const table of TABLES) {
        await query(`DELETE FROM "${schema}"."${table}"`);
      }

      clock = Date.UTC(2026, 0, 1);

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

      for (const silenced of ["debug", "info", "warn", "error"]) {
        getJestSpyOn(logger, silenced).mockImplementation((): void => {
          return undefined;
        });
      }
    });

    afterEach(() => {
      recording = null;
      jest.restoreAllMocks();
    });

    describe("the backfill", () => {
      test("a project with no verified domain: its providers get nothing, not even the domain it claimed and never verified", async () => {
        const globex: string = await addProject("Globex");
        await addDomain({
          projectId: globex,
          domain: "globex.com",
          isVerified: false,
        });
        await addProvider({
          table: "ProjectSSO",
          projectId: globex,
          name: "Globex Okta",
          isEnabled: true,
        });
        await addProvider({
          table: "ProjectOIDC",
          projectId: globex,
          name: "Globex Google",
          isEnabled: true,
        });

        await runBackfill();

        expect(await listed("ProjectSSO")).toEqual({});
        expect(await listed("ProjectOIDC")).toEqual({});
      });

      test("a project with one verified domain: every provider that lists none gets it, on or off, SAML and OIDC; a deleted provider gets nothing", async () => {
        const initech: string = await addProject("Initech");
        const initechCom: string = await addDomain({
          projectId: initech,
          domain: "initech.com",
          isVerified: true,
        });
        const okta: string = await addProvider({
          table: "ProjectSSO",
          projectId: initech,
          name: "Okta",
          isEnabled: true,
        });
        const oldOkta: string = await addProvider({
          table: "ProjectSSO",
          projectId: initech,
          name: "Old Okta",
          isEnabled: false,
        });
        await addProvider({
          table: "ProjectSSO",
          projectId: initech,
          name: "Removed",
          isEnabled: true,
          deletedAt: new Date(),
        });
        const google: string = await addProvider({
          table: "ProjectOIDC",
          projectId: initech,
          name: "Google Workspace",
          isEnabled: true,
        });

        await runBackfill();

        expect(await listed("ProjectSSO")).toEqual({
          [okta]: [initechCom],
          [oldOkta]: [initechCom],
        });
        expect(await listed("ProjectOIDC")).toEqual({
          [google]: [initechCom],
        });
      });

      test("a project with several verified domains: each provider gets all of them, whatever case they were saved in, and not one never verified or deleted", async () => {
        const acme: string = await addProject("Acme");
        const acmeCom: string = await addDomain({
          projectId: acme,
          domain: "acme.com",
          isVerified: true,
        });
        // Saved before names were lower-cased.
        const acmeIo: string = await addDomain({
          projectId: acme,
          domain: "Acme.IO",
          isVerified: true,
        });
        const acmeDe: string = await addDomain({
          projectId: acme,
          domain: "acme.de",
          isVerified: true,
        });
        await addDomain({
          projectId: acme,
          domain: "acme.dev",
          isVerified: false,
        });
        await addDomain({
          projectId: acme,
          domain: "old-acme.com",
          isVerified: true,
          deletedAt: new Date(),
        });
        const okta: string = await addProvider({
          table: "ProjectSSO",
          projectId: acme,
          name: "Okta",
          isEnabled: true,
        });
        const entra: string = await addProvider({
          table: "ProjectOIDC",
          projectId: acme,
          name: "Entra ID",
          isEnabled: true,
        });

        await runBackfill();

        expect(await listed("ProjectSSO")).toEqual({
          [okta]: sorted([acmeCom, acmeIo, acmeDe]),
        });
        expect(await listed("ProjectOIDC")).toEqual({
          [entra]: sorted([acmeCom, acmeIo, acmeDe]),
        });
      });

      test("a domain verified in two projects is given to neither, whatever its case or spaces; each project's own domains still are", async () => {
        const hooli: string = await addProject("Hooli");
        const hooliStaging: string = await addProject("Hooli Staging");
        await addDomain({
          projectId: hooli,
          domain: "hooli.com",
          isVerified: true,
        });
        await addDomain({
          projectId: hooliStaging,
          domain: " HOOLI.com ",
          isVerified: true,
        });
        const hooliXyz: string = await addDomain({
          projectId: hooli,
          domain: "hooli.xyz",
          isVerified: true,
        });
        const hooliOkta: string = await addProvider({
          table: "ProjectSSO",
          projectId: hooli,
          name: "Hooli Okta",
          isEnabled: true,
        });
        await addProvider({
          table: "ProjectSSO",
          projectId: hooliStaging,
          name: "Staging Okta",
          isEnabled: true,
        });
        await addProvider({
          table: "ProjectOIDC",
          projectId: hooliStaging,
          name: "Staging Google",
          isEnabled: true,
        });

        await runBackfill();

        expect(await listed("ProjectSSO")).toEqual({
          [hooliOkta]: [hooliXyz],
        });
        expect(await listed("ProjectOIDC")).toEqual({});
      });

      test("a domain verified in one project and claimed, never verified, in another is the first project's alone", async () => {
        const umbrella: string = await addProject("Umbrella");
        const squatter: string = await addProject("Squatter");
        const umbrellaCom: string = await addDomain({
          projectId: umbrella,
          domain: "umbrella.com",
          isVerified: true,
        });
        await addDomain({
          projectId: squatter,
          domain: "umbrella.com",
          isVerified: false,
        });
        const umbrellaOkta: string = await addProvider({
          table: "ProjectSSO",
          projectId: umbrella,
          name: "Umbrella Okta",
          isEnabled: true,
        });
        await addProvider({
          table: "ProjectSSO",
          projectId: squatter,
          name: "Squatter SSO",
          isEnabled: true,
        });

        await runBackfill();

        expect(await listed("ProjectSSO")).toEqual({
          [umbrellaOkta]: [umbrellaCom],
        });
      });

      test("a domain that a deleted project, or a deleted domain row, verified does not stand in the way; a deleted project's providers get nothing", async () => {
        const wayne: string = await addProject("Wayne");
        const oldWayne: string = await addProject("Old Wayne", {
          deletedAt: new Date(),
        });
        const leftWayne: string = await addProject("Wayne Labs");
        const wayneCom: string = await addDomain({
          projectId: wayne,
          domain: "wayne.com",
          isVerified: true,
        });
        await addDomain({
          projectId: oldWayne,
          domain: "wayne.com",
          isVerified: true,
        });
        await addDomain({
          projectId: leftWayne,
          domain: "wayne.com",
          isVerified: true,
          deletedAt: new Date(),
        });
        const oldWayneOwn: string = await addDomain({
          projectId: oldWayne,
          domain: "old-wayne.com",
          isVerified: true,
        });
        const wayneOkta: string = await addProvider({
          table: "ProjectSSO",
          projectId: wayne,
          name: "Wayne Okta",
          isEnabled: true,
        });
        await addProvider({
          table: "ProjectSSO",
          projectId: oldWayne,
          name: "Old Wayne Okta",
          isEnabled: true,
        });

        await runBackfill();

        expect(await listed("ProjectSSO")).toEqual({
          [wayneOkta]: [wayneCom],
        });
        expect(oldWayneOwn).toBeTruthy();
      });

      test("names nobody can own are never given, though marked verified", async () => {
        const lab: string = await addProject("Lab");
        for (const name of [
          "lab.test",
          "sso.example.com",
          "example.org",
          "corp.localhost",
          "nothing.invalid",
          "docs.example",
        ]) {
          await addDomain({ projectId: lab, domain: name, isVerified: true });
        }
        const labCom: string = await addDomain({
          projectId: lab,
          domain: "lab.com",
          isVerified: true,
        });
        const okta: string = await addProvider({
          table: "ProjectSSO",
          projectId: lab,
          name: "Okta",
          isEnabled: true,
        });

        await runBackfill();

        expect(await listed("ProjectSSO")).toEqual({ [okta]: [labCom] });
      });

      test("a provider that lists a domain keeps exactly what its admin picked; another of the project's gets every domain", async () => {
        const stark: string = await addProject("Stark");
        const starkCom: string = await addDomain({
          projectId: stark,
          domain: "stark.com",
          isVerified: true,
        });
        const starkIo: string = await addDomain({
          projectId: stark,
          domain: "stark.io",
          isVerified: true,
        });
        const picked: string = await addProvider({
          table: "ProjectSSO",
          projectId: stark,
          name: "Okta",
          isEnabled: true,
          domainIds: [starkCom],
        });
        const notPicked: string = await addProvider({
          table: "ProjectSSO",
          projectId: stark,
          name: "Okta Contractors",
          isEnabled: true,
        });
        const oidcPicked: string = await addProvider({
          table: "ProjectOIDC",
          projectId: stark,
          name: "Google",
          isEnabled: true,
          domainIds: [starkIo],
        });

        await runBackfill();

        expect(await listed("ProjectSSO")).toEqual({
          [picked]: [starkCom],
          [notPicked]: sorted([starkCom, starkIo]),
        });
        expect(await listed("ProjectOIDC")).toEqual({
          [oidcPicked]: [starkIo],
        });
      });

      test("running it again changes nothing, and it never gives another project's domain", async () => {
        const acme: string = await addProject("Acme");
        const globex: string = await addProject("Globex");
        const acmeCom: string = await addDomain({
          projectId: acme,
          domain: "acme.com",
          isVerified: true,
        });
        const globexCom: string = await addDomain({
          projectId: globex,
          domain: "globex.com",
          isVerified: true,
        });
        const acmeOkta: string = await addProvider({
          table: "ProjectSSO",
          projectId: acme,
          name: "Okta",
          isEnabled: true,
        });
        const globexOkta: string = await addProvider({
          table: "ProjectSSO",
          projectId: globex,
          name: "Okta",
          isEnabled: true,
        });

        await runBackfill();
        const once: Record<string, string[]> = await listed("ProjectSSO");

        await runBackfill();

        expect(await listed("ProjectSSO")).toEqual(once);
        expect(once).toEqual({
          [acmeOkta]: [acmeCom],
          [globexOkta]: [globexCom],
        });
        expect(await rowCount("ProjectSsoDomain")).toBe(2);
      });

      test("changes no provider, domain, project, account or membership", async () => {
        const acme: string = await addProject("Acme");
        await addDomain({
          projectId: acme,
          domain: "acme.com",
          isVerified: true,
        });
        await addProvider({
          table: "ProjectSSO",
          projectId: acme,
          name: "Okta",
          isEnabled: false,
        });
        await addMember({ email: "grace@acme.com", projectId: acme });

        const snapshot: () => Promise<Array<unknown>> = async (): Promise<
          Array<unknown>
        > => {
          return [
            await query(`SELECT * FROM "${schema}"."Project" ORDER BY "_id"`),
            await query(`SELECT * FROM "${schema}"."Domain" ORDER BY "_id"`),
            await query(
              `SELECT * FROM "${schema}"."ProjectSSO" ORDER BY "_id"`,
            ),
            await query(`SELECT * FROM "${schema}"."User" ORDER BY "_id"`),
            await query(
              `SELECT * FROM "${schema}"."TeamMember" ORDER BY "_id"`,
            ),
          ];
        };

        const before: Array<unknown> = await snapshot();

        await runBackfill();

        expect(await snapshot()).toEqual(before);
        expect(await rowCount("ProjectSsoDomain")).toBe(1);
      });
    });

    /*
     * The upgrade as an existing customer meets it: Acme's people signed in
     * from OneUptime with Okta (SAML) and Entra ID (OIDC) before #9824,
     * found through their accounts. After the upgrade and its backfill, the
     * lookup finds the same providers by the domain alone.
     */
    describe("Sign in with SSO after the upgrade", () => {
      interface Estate {
        acmeOkta: string;
        acmeEntra: string;
        hooliXyzOkta: string;
      }

      const buildEstate: () => Promise<Estate> = async (): Promise<Estate> => {
        const acme: string = await addProject("Acme");
        await addDomain({
          projectId: acme,
          domain: "acme.com",
          isVerified: true,
        });
        await addDomain({
          projectId: acme,
          domain: "acme.dev",
          isVerified: false,
        });
        const acmeOkta: string = await addProvider({
          table: "ProjectSSO",
          projectId: acme,
          name: "Okta",
          isEnabled: true,
        });
        await addProvider({
          table: "ProjectSSO",
          projectId: acme,
          name: "Old Okta",
          isEnabled: false,
        });
        const acmeEntra: string = await addProvider({
          table: "ProjectOIDC",
          projectId: acme,
          name: "Entra ID",
          isEnabled: true,
        });
        await addMember({ email: "grace@acme.com", projectId: acme });

        const hooli: string = await addProject("Hooli");
        const hooliStaging: string = await addProject("Hooli Staging");
        await addDomain({
          projectId: hooli,
          domain: "hooli.com",
          isVerified: true,
        });
        await addDomain({
          projectId: hooliStaging,
          domain: "hooli.com",
          isVerified: true,
        });
        await addDomain({
          projectId: hooli,
          domain: "hooli.xyz",
          isVerified: true,
        });
        const hooliXyzOkta: string = await addProvider({
          table: "ProjectSSO",
          projectId: hooli,
          name: "Hooli Okta",
          isEnabled: true,
        });
        await addProvider({
          table: "ProjectSSO",
          projectId: hooliStaging,
          name: "Staging Okta",
          isEnabled: true,
        });
        await addMember({ email: "gavin@hooli.com", projectId: hooli });

        return { acmeOkta, acmeEntra, hooliXyzOkta };
      };

      const offeredSaml: (address: string) => Promise<Array<string>> = async (
        address: string,
      ): Promise<Array<string>> => {
        return (
          await ProjectSsoDiscovery.findSamlProviders(new Email(address))
        ).map((provider: ProjectSSO): string => {
          return provider._id?.toString() || "";
        });
      };

      const offeredOidc: (address: string) => Promise<Array<string>> = async (
        address: string,
      ): Promise<Array<string>> => {
        return (
          await ProjectSsoDiscovery.findOidcProviders(new Email(address))
        ).map((provider: ProjectOIDC): string => {
          return provider._id?.toString() || "";
        });
      };

      test("before the backfill nothing is offered: the regression it fixes", async () => {
        await buildEstate();

        expect(await offeredSaml("grace@acme.com")).toEqual([]);
        expect(await offeredOidc("grace@acme.com")).toEqual([]);
      });

      test("an existing customer's people are offered their providers again, by their domain, the ones that are on", async () => {
        const estate: Estate = await buildEstate();

        await runBackfill();

        expect(await offeredSaml("grace@acme.com")).toEqual([estate.acmeOkta]);
        expect(await offeredOidc("Grace@ACME.com")).toEqual([estate.acmeEntra]);

        const [okta] = await ProjectSsoDiscovery.findSamlProviders(
          new Email("grace@acme.com"),
        );

        expect(okta?.name).toBe("Okta");
        expect(okta?.project?.name).toBe("Acme");
      });

      test("an address with no account at the domain gets the same answer, after the same reads, and no read touches an account", async () => {
        await buildEstate();
        await runBackfill();

        recording = [];
        const member: Array<string> = await offeredSaml("grace@acme.com");
        const memberQueries: Array<RecordedQuery> = recording;

        recording = [];
        const stranger: Array<string> = await offeredSaml(
          "nobody-has-this@acme.com",
        );
        const strangerQueries: Array<RecordedQuery> = recording;
        recording = null;

        expect(stranger).toEqual(member);
        expect(member).toHaveLength(1);
        expect(strangerQueries).toEqual(memberQueries);
        expect(memberQueries.length).toBeGreaterThan(0);

        for (const recorded of memberQueries) {
          expect(recorded.sql).not.toMatch(/"User"|"TeamMember"/);
        }
      });

      test("an unknown, unverified or contested domain is offered nothing, account or not", async () => {
        const estate: Estate = await buildEstate();
        await runBackfill();

        for (const address of [
          "grace@acme.dev",
          "gavin@hooli.com",
          "someone@hooli.com",
          "grace@gmail.com",
          "grace@eu.acme.com",
        ]) {
          expect({ address, offered: await offeredSaml(address) }).toEqual({
            address,
            offered: [],
          });
          expect({ address, offered: await offeredOidc(address) }).toEqual({
            address,
            offered: [],
          });
        }

        expect(await offeredSaml("gavin@hooli.xyz")).toEqual([
          estate.hooliXyzOkta,
        ]);
      });
    });
  },
);
