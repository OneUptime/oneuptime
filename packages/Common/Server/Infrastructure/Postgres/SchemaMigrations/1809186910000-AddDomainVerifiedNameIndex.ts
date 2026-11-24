import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * "Sign in with SSO" reads an index to find a domain, instead of the whole
 * Domain table (#9988).
 *
 * Every "Sign in with SSO" lookup - GET /identity/service-provider-login and
 * -oidc, which the sign-in page and the mobile app ask with nobody signed in
 * - first finds the verified project domains named like the address's
 * (Server/Utils/ProjectSsoDiscovery.findVerifiedDomains):
 *
 *   WHERE LOWER("Domain"."domain") = $1 AND "Domain"."isVerified" = $2
 *     AND "Domain"."deletedAt" IS NULL
 *   ORDER BY "Domain"."createdAt" ASC, "Domain"."_id" ASC LIMIT ...
 *
 * "Domain" had an index on "projectId" alone, so each lookup - a request
 * anyone can make, as often as the identity routes' limits allow - read
 * every row of the table, and that table grows with every project on
 * OneUptime Cloud that adds a domain.
 *
 * This index answers it: the lower-cased name the lookup compares, whatever
 * case a row was saved in before #9824 lower-cased new ones, over only the
 * rows the lookup can ever return - verified, not deleted. A name has a row
 * or two such rows, so what Postgres sorts afterwards is a row or two.
 *
 * Only those rows, on purpose: anyone can make projects on OneUptime Cloud
 * and add "gmail.com" to each without proving it, but nobody can verify a
 * domain they do not hold. Rows nobody verified never reach the index, so
 * they cannot make the lookup for the addresses everybody types any slower.
 *
 * A Domain row is added, verified and deleted by hand, a handful of times
 * per project, so the index costs its writes nothing worth counting.
 *
 * TypeORM cannot write an expression index, so this is written out, not
 * generated. Domain declares it by name with synchronize: false
 * (Types/Database/UnsynchronizedIndex), so the schema builder neither drops
 * it nor makes one of its own, and the drift check finds nothing.
 *
 * Built online (CREATE INDEX CONCURRENTLY, OnlineDdl): "Domain" already
 * holds rows on every install, and its readers and writers carry on while it
 * builds. Safe to run again after a stop part way. Its names are left
 * unqualified, so the statements act on the "Domain" the connection's
 * search_path finds - public on every install - and the Postgres suite runs
 * this very migration on a copy of the table.
 *
 * AddDomainVerifiedNameIndexMigration pins the statements;
 * AddDomainVerifiedNameIndexPostgres shows, with EXPLAIN on a realistic
 * table, that the lookup read the whole table without it and reads the
 * index, and the one row it returns, with it.
 */
export class AddDomainVerifiedNameIndex1809186910000
  implements MigrationInterface
{
  public name: string = "AddDomainVerifiedNameIndex1809186910000";

  // CREATE INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_domain_verified_lower_domain" ON "Domain" (LOWER("domain")) WHERE "isVerified" = true AND "deletedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "IDX_domain_verified_lower_domain"`,
    );
  }
}
