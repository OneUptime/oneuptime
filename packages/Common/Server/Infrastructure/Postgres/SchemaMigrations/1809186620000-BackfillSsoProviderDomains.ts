import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Data fix (#9918): every project SAML and OIDC provider that lists no
 * domain gets the verified domains its own project, and no other project,
 * holds - so "Sign in with SSO" offers it again, after the upgrade, to the
 * people on those domains.
 *
 * Why. #9824 made "Sign in with SSO" (/accounts/sso, and the mobile app's
 * SSO sign-in) find a project's providers by the address's verified domain
 * alone, never by the account an address has (Server/Utils/
 * ProjectSsoDiscovery): a provider is offered for the domains it lists under
 * Domains (AddSsoProviderDomains1809186480000). Every provider made before
 * that lists none, so after the upgrade the page offered no existing
 * provider to anyone until an admin picked a domain: sign-in started from
 * OneUptime stopped working for every existing customer, while sign-in
 * started at the identity provider went on working.
 *
 * What. Each provider - SAML (ProjectSSO) and OIDC (ProjectOIDC), on or
 * off, of a project that is not deleted - that lists no domain gets every
 * Domain row of its own project that:
 *
 *   - is verified: proved with its TXT record (Project Settings > Advanced >
 *     Domains). A domain added but never verified proves nothing, and is
 *     never given;
 *   - is not deleted;
 *   - is not a name nobody can own: RFC 2606's reserved names, and the test
 *     domains under them that are marked verified without a TXT record
 *     (Types/Domain: RESERVED_NAMES, TEST_DOMAIN_SUFFIXES);
 *   - is verified by no other project that is not deleted, in any case or
 *     with any spaces around it. "Sign in with SSO" offers the providers of
 *     every project that lists a domain, so a domain two projects have
 *     verified is given to neither: which organization's providers its
 *     people should be offered is for those projects' admins to decide, and
 *     the SSO page tells them a provider has none (#9918).
 *
 * Nothing else: a provider that lists a domain already keeps what its admin
 * picked, and the instance-wide and status page providers are not domain
 * lists. No account, membership or invitation is read, as the lookup reads
 * none: what a provider is offered for depends on its project's domains
 * alone, and the answer for an address still says nothing about whether it
 * has an account.
 *
 * Written out rather than generated (nothing in the schema changes), and run
 * with the schema migrations, right after the tables it fills, so the
 * providers list their domains before any server of the release answers
 * "Sign in with SSO" (SchemaMigrationWait). As a data migration of the
 * Workers it would run once the servers were up, and the page would offer
 * nothing in between. It reads and writes few rows: the providers, and the
 * verified domains in one pass.
 *
 * Running it again changes nothing: a provider it gave domains lists them,
 * and a row already there is left alone (ON CONFLICT DO NOTHING). down()
 * removes nothing: a row it wrote cannot be told from one an admin picked
 * since, and reverting AddSsoProviderDomains drops the tables anyway.
 */

/*
 * The names nobody can own (Types/Domain RESERVED_NAMES), each matched as
 * itself and as any name under it. They cover TEST_DOMAIN_SUFFIXES, the
 * domains a project may mark verified without a TXT record.
 */
export const RESERVED_DOMAIN_NAMES: ReadonlyArray<string> = [
  "test",
  "example",
  "invalid",
  "localhost",
  "example.com",
  "example.net",
  "example.org",
];

export interface ProviderDomainsTable {
  // The provider's table.
  providerTable: "ProjectSSO" | "ProjectOIDC";
  // The join table of its Domains (the model's @JoinTable).
  joinTable: "ProjectSsoDomain" | "ProjectOidcDomain";
  // The join table's column naming the provider.
  providerColumn: "projectSsoId" | "projectOidcId";
}

export const PROVIDER_DOMAINS_TABLES: ReadonlyArray<ProviderDomainsTable> = [
  {
    providerTable: "ProjectSSO",
    joinTable: "ProjectSsoDomain",
    providerColumn: "projectSsoId",
  },
  {
    providerTable: "ProjectOIDC",
    joinTable: "ProjectOidcDomain",
    providerColumn: "projectOidcId",
  },
];

// A domain's name as the backfill compares it: trimmed and lower-cased.
const DOMAIN_NAME_SQL: string = `LOWER(TRIM("Domain"."domain"))`;

// The name is none of RESERVED_DOMAIN_NAMES, nor under one.
export const getNotReservedDomainSql: () => string = (): string => {
  const names: string = RESERVED_DOMAIN_NAMES.map((name: string): string => {
    return `'${name}'`;
  }).join(", ");

  const suffixes: string = RESERVED_DOMAIN_NAMES.map((name: string): string => {
    return `${DOMAIN_NAME_SQL} LIKE '%.${name}'`;
  }).join(" OR ");

  return `NOT (${DOMAIN_NAME_SQL} IN (${names}) OR ${suffixes})`;
};

/*
 * The statement that gives one kind of provider its project's domains: every
 * provider of that kind that lists none gets every verified domain of its
 * project that no other project has verified (see above).
 */
export const getBackfillStatement: (table: ProviderDomainsTable) => string = (
  table: ProviderDomainsTable,
): string => {
  return [
    // How many projects, not deleted, have verified each name.
    `WITH "VerifiedName" AS (`,
    `SELECT ${DOMAIN_NAME_SQL} AS "name", COUNT(DISTINCT "Domain"."projectId") AS "projectCount"`,
    `FROM "Domain"`,
    `INNER JOIN "Project" ON "Project"."_id" = "Domain"."projectId" AND "Project"."deletedAt" IS NULL`,
    `WHERE "Domain"."isVerified" = true AND "Domain"."deletedAt" IS NULL`,
    `GROUP BY ${DOMAIN_NAME_SQL}`,
    `),`,
    // The verified domains that are their project's alone.
    `"ProjectOwnDomain" AS (`,
    `SELECT "Domain"."_id" AS "domainId", "Domain"."projectId" AS "projectId"`,
    `FROM "Domain"`,
    `INNER JOIN "Project" ON "Project"."_id" = "Domain"."projectId" AND "Project"."deletedAt" IS NULL`,
    `INNER JOIN "VerifiedName" ON "VerifiedName"."name" = ${DOMAIN_NAME_SQL} AND "VerifiedName"."projectCount" = 1`,
    `WHERE "Domain"."isVerified" = true AND "Domain"."deletedAt" IS NULL AND ${getNotReservedDomainSql()}`,
    `)`,
    `INSERT INTO "${table.joinTable}" ("${table.providerColumn}", "domainId")`,
    `SELECT "Provider"."_id", "ProjectOwnDomain"."domainId"`,
    `FROM "${table.providerTable}" AS "Provider"`,
    `INNER JOIN "ProjectOwnDomain" ON "ProjectOwnDomain"."projectId" = "Provider"."projectId"`,
    `WHERE "Provider"."deletedAt" IS NULL`,
    // Only a provider that lists no domain: one that does keeps its admin's pick.
    `AND NOT EXISTS (SELECT 1 FROM "${table.joinTable}" AS "Listed" WHERE "Listed"."${table.providerColumn}" = "Provider"."_id")`,
    `ON CONFLICT DO NOTHING`,
  ].join(" ");
};

export class BackfillSsoProviderDomains1809186620000
  implements MigrationInterface
{
  public name: string = "BackfillSsoProviderDomains1809186620000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of PROVIDER_DOMAINS_TABLES) {
      await queryRunner.query(getBackfillStatement(table));
    }
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Nothing to restore; see the note above.
  }
}
