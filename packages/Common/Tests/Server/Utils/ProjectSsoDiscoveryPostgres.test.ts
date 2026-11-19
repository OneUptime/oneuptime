import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import logger from "../../../Server/Utils/Logger";
import ProjectSsoDiscovery from "../../../Server/Utils/ProjectSsoDiscovery";
import Entities from "../../../Models/DatabaseModels/Index";
import ProjectOIDC from "../../../Models/DatabaseModels/ProjectOidc";
import ProjectSSO from "../../../Models/DatabaseModels/ProjectSso";
import Email from "../../../Types/Email";
import ObjectID from "../../../Types/ObjectID";
import { getJestSpyOn } from "../../Spy";
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
import { DataSource } from "typeorm";

/*
 * "SIGN IN WITH SSO" FINDS A PROJECT'S PROVIDERS BY THE ADDRESS'S DOMAIN,
 * AGAINST POSTGRES (#9824).
 *
 * The in-memory suites (App's SsoDiscoveryByDomain and
 * SsoDiscoverySaysNothingOfAccounts) read the lookup's queries through a
 * stand-in. This runs Server/Utils/ProjectSsoDiscovery's real reads on real
 * rows of the migrated tables - Project, Domain, ProjectSSO, ProjectOIDC and
 * the providers' domain lists (ProjectSsoDomain, ProjectOidcDomain) - so the
 * SQL itself is held: a domain matched by its exact name whatever case it
 * was saved in, only a verified one and not one marked deleted, and only the
 * providers of the domain's own project that are on, not deleted, and list
 * it.
 *
 * Opt in with RUN_POSTGRES_SSO_DISCOVERY_TESTS=true against a database the
 * registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_SSO_DISCOVERY_TESTS=true \
 *   SSO_DISCOVERY_TEST_DATABASE_HOST=127.0.0.1 \
 *   SSO_DISCOVERY_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Utils/ProjectSsoDiscoveryPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml. Only the
 * tables' definitions are copied from public, into a uniquely named schema
 * that is dropped afterwards; every row is synthetic.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_SSO_DISCOVERY_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = [
  "Project",
  "Domain",
  "ProjectSSO",
  "ProjectOIDC",
  "ProjectSsoDomain",
  "ProjectOidcDomain",
];

interface ProviderKind {
  label: string;
  table: "ProjectSSO" | "ProjectOIDC";
  joinTable: "ProjectSsoDomain" | "ProjectOidcDomain";
  ownerColumn: "projectSsoId" | "projectOidcId";
  find: (email: Email) => Promise<Array<ProjectSSO | ProjectOIDC>>;
}

const KINDS: Array<ProviderKind> = [
  {
    label: "SAML",
    table: "ProjectSSO",
    joinTable: "ProjectSsoDomain",
    ownerColumn: "projectSsoId",
    find: (email: Email): Promise<Array<ProjectSSO | ProjectOIDC>> => {
      return ProjectSsoDiscovery.findSamlProviders(email);
    },
  },
  {
    label: "OIDC",
    table: "ProjectOIDC",
    joinTable: "ProjectOidcDomain",
    ownerColumn: "projectOidcId",
    find: (email: Email): Promise<Array<ProjectSSO | ProjectOIDC>> => {
      return ProjectSsoDiscovery.findOidcProviders(email);
    },
  },
];

describePostgres("Sign in with SSO's lookup by domain, on Postgres", () => {
  const schema: string = `sso_discovery_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;

  let database: DataSource;

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

  const addProject: (name: string) => Promise<string> = async (
    name: string,
  ): Promise<string> => {
    const id: string = ObjectID.generate().toString();

    await query(
      `INSERT INTO "${schema}"."Project" ("_id", "name", "slug", "version") VALUES ($1, $2, $3, 1)`,
      [id, name, `project-${id}`],
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
    kind: ProviderKind;
    projectId: string;
    name: string;
    isEnabled: boolean;
    domainIds: Array<string>;
    deletedAt?: Date;
  }) => Promise<string> = async (data: {
    kind: ProviderKind;
    projectId: string;
    name: string;
    isEnabled: boolean;
    domainIds: Array<string>;
    deletedAt?: Date;
  }): Promise<string> => {
    const id: string = ObjectID.generate().toString();

    if (data.kind.table === "ProjectSSO") {
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

    for (const domainId of data.domainIds) {
      await query(
        `INSERT INTO "${schema}"."${data.kind.joinTable}" ("${data.kind.ownerColumn}", "domainId") VALUES ($1, $2)`,
        [id, domainId],
      );
    }

    return id;
  };

  const offered: (
    kind: ProviderKind,
    address: string,
  ) => Promise<Array<string>> = async (
    kind: ProviderKind,
    address: string,
  ): Promise<Array<string>> => {
    return (await kind.find(new Email(address))).map(
      (provider: ProjectSSO | ProjectOIDC): string => {
        return provider._id?.toString() || "";
      },
    );
  };

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["SSO_DISCOVERY_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["SSO_DISCOVERY_TEST_DATABASE_PORT"] || "5400"),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["SSO_DISCOVERY_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
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
    for (const table of TABLES) {
      await query(`DELETE FROM "${schema}"."${table}"`);
    }

    clock = Date.UTC(2026, 0, 1);

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);

    for (const silenced of ["debug", "info", "warn", "error"]) {
      getJestSpyOn(logger, silenced).mockImplementation((): void => {
        return undefined;
      });
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe.each(KINDS)("$label providers", (kind: ProviderKind) => {
    test("are offered by a verified domain they list, the domain matched whatever its case, with what the page draws", async () => {
      const acme: string = await addProject("Acme");
      // Saved before names were lower-cased: the same domain.
      const acmeDomain: string = await addDomain({
        projectId: acme,
        domain: "Acme.COM",
        isVerified: true,
      });
      const okta: string = await addProvider({
        kind,
        projectId: acme,
        name: "Okta",
        isEnabled: true,
        domainIds: [acmeDomain],
      });

      expect(await offered(kind, "Grace@ACME.com")).toEqual([okta]);

      const [provider] = await kind.find(new Email("grace@acme.com"));

      expect(provider?.name).toBe("Okta");
      expect(provider?.description).toBe("Synthetic");
      expect(provider?.projectId?.toString()).toBe(acme);
      expect(provider?.project?.name).toBe("Acme");
      // Nothing the page does not draw: no list of domains, no teams, no secrets.
      expect(provider?.domains).toBeUndefined();
      expect(provider?.teams).toBeUndefined();
      expect(provider?.issuerURL).toBeUndefined();
    });

    test("are offered nothing for an unverified domain, another domain, a parent or a subdomain", async () => {
      const acme: string = await addProject("Acme");
      const verified: string = await addDomain({
        projectId: acme,
        domain: "acme.com",
        isVerified: true,
      });
      const unverified: string = await addDomain({
        projectId: acme,
        domain: "acme.dev",
        isVerified: false,
      });
      await addProvider({
        kind,
        projectId: acme,
        name: "Okta",
        isEnabled: true,
        domainIds: [verified, unverified],
      });

      for (const address of [
        "grace@acme.dev",
        "grace@initech.com",
        "grace@eu.acme.com",
        "grace@notacme.com",
        "grace@acme.co",
      ]) {
        expect({ address, offered: await offered(kind, address) }).toEqual({
          address,
          offered: [],
        });
      }
    });

    test("that are off, deleted or list no domain are not offered", async () => {
      const acme: string = await addProject("Acme");
      const domain: string = await addDomain({
        projectId: acme,
        domain: "acme.com",
        isVerified: true,
      });
      const on: string = await addProvider({
        kind,
        projectId: acme,
        name: "On",
        isEnabled: true,
        domainIds: [domain],
      });
      await addProvider({
        kind,
        projectId: acme,
        name: "Off",
        isEnabled: false,
        domainIds: [domain],
      });
      await addProvider({
        kind,
        projectId: acme,
        name: "Deleted",
        isEnabled: true,
        domainIds: [domain],
        deletedAt: new Date(),
      });
      await addProvider({
        kind,
        projectId: acme,
        name: "No domains",
        isEnabled: true,
        domainIds: [],
      });

      expect(await offered(kind, "grace@acme.com")).toEqual([on]);
    });

    test("are not offered once their domain is deleted", async () => {
      const acme: string = await addProject("Acme");
      const domain: string = await addDomain({
        projectId: acme,
        domain: "acme.com",
        isVerified: true,
        deletedAt: new Date(),
      });
      await addProvider({
        kind,
        projectId: acme,
        name: "Okta",
        isEnabled: true,
        domainIds: [domain],
      });

      expect(await offered(kind, "grace@acme.com")).toEqual([]);
    });

    /*
     * Globex's provider lists Acme's acme.com row, which the project check
     * refuses to save: the lookup reads each project's providers with that
     * project's own domains, so it is offered for neither.
     */
    test("of another project, listing the domain's row, are not offered", async () => {
      const acme: string = await addProject("Acme");
      const globex: string = await addProject("Globex");
      const acmeDomain: string = await addDomain({
        projectId: acme,
        domain: "acme.com",
        isVerified: true,
      });
      const acmeOkta: string = await addProvider({
        kind,
        projectId: acme,
        name: "Okta",
        isEnabled: true,
        domainIds: [acmeDomain],
      });
      await addProvider({
        kind,
        projectId: globex,
        name: "Borrowed",
        isEnabled: true,
        domainIds: [acmeDomain],
      });

      expect(await offered(kind, "grace@acme.com")).toEqual([acmeOkta]);

      // Globex verifying acme.com itself does not make the borrowed row count.
      await addDomain({
        projectId: globex,
        domain: "acme.com",
        isVerified: true,
      });

      expect(await offered(kind, "grace@acme.com")).toEqual([acmeOkta]);
    });

    test("of every project that verified the domain are offered, in the order the domains were added", async () => {
      const acme: string = await addProject("Acme");
      const globex: string = await addProject("Globex");
      const globexDomain: string = await addDomain({
        projectId: globex,
        domain: "acme.com",
        isVerified: true,
      });
      const acmeDomain: string = await addDomain({
        projectId: acme,
        domain: "acme.com",
        isVerified: true,
      });
      const acmeFirst: string = await addProvider({
        kind,
        projectId: acme,
        name: "Acme first",
        isEnabled: true,
        domainIds: [acmeDomain],
      });
      const globexOwn: string = await addProvider({
        kind,
        projectId: globex,
        name: "Globex",
        isEnabled: true,
        domainIds: [globexDomain],
      });
      const acmeSecond: string = await addProvider({
        kind,
        projectId: acme,
        name: "Acme second",
        isEnabled: true,
        domainIds: [acmeDomain],
      });

      expect(await offered(kind, "grace@acme.com")).toEqual([
        globexOwn,
        acmeFirst,
        acmeSecond,
      ]);

      // Twice, the same: the answer is the domain's alone.
      expect(await offered(kind, "nobody@acme.com")).toEqual([
        globexOwn,
        acmeFirst,
        acmeSecond,
      ]);
    });
  });
});
