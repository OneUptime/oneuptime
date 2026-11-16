import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * THE GREENLOCK STORE'S TABLES GO, AND THE OLD ACME KEYS THEY HOLD (#8990).
 *
 * ACME certificates (AcmeCertificate) replaced the Greenlock store in April
 * 2024, and nothing has read or written its two tables since:
 *
 *   - "GreenlockCertificate": the store's certificate chains and, where
 *     "isKeyPair" is true, the private keys of the ACME account and of each
 *     domain's certificate - kept on every installation that ran OneUptime
 *     before then. #8920 encrypted them at rest; gone is safer still.
 *   - "GreenlockChallenge": the store's HTTP-01 challenges.
 *
 * Their models and services are gone with this migration. The data
 * migration that read the store's domains once (MoveGreenlockCertsToAcmeCerts)
 * has nothing to do any more: a domain that says it has a certificate
 * ordered but has none is ordered again by the certificate sweeps
 * (checkOrderStatus), and one never ordered by the order sweep. So these
 * tables can go before the data migrations run, in this schema migration.
 *
 * Hand-written: the generator writes no drops for an entity that is gone.
 *
 * Online, as Docs/migrations/README.md asks of any migration on a table that
 * is in use. Each table's one foreign key points at "User" ("deletedByUserId"),
 * and dropping it removes the key's triggers on "User", which takes ACCESS
 * EXCLUSIVE on "User" for as long as the drop holds it. Under the
 * SchemaMigrationRunner a statement waits at most
 * DATABASE_MIGRATION_LOCK_TIMEOUT_MS (2 s) for that lock, and the migration is
 * rolled back and tried again in the gaps, so a long transaction on "User"
 * never parks its readers behind this migration for longer than that. Both
 * tables go in one statement, so "User" is locked once, for the instant two
 * empty-of-use tables take to drop: nothing scans "User", and nothing waits
 * on the two tables, which no process touches.
 *
 * Idempotent (IF EXISTS): a fresh installation, which creates the tables
 * from the initial migration just before, and one that dropped them already
 * are left as they are.
 */
export class DropGreenlockTables1809182470000 implements MigrationInterface {
  public name: string = "DropGreenlockTables1809182470000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "GreenlockChallenge", "GreenlockCertificate"`,
    );
  }

  /*
   * The two tables as the last migrations that changed them left them,
   * empty: what they held is not brought back.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "GreenlockCertificate" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "key" character varying(500) NOT NULL, "blob" text NOT NULL, "isKeyPair" boolean NOT NULL DEFAULT false, "deletedByUserId" uuid, CONSTRAINT "PK_f7a338910a034c62b3efa5aa701" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_d47fcf292f2ceae490da8404d8" ON "GreenlockCertificate" ("key") `,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "GreenlockChallenge" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "key" character varying(500) NOT NULL, "token" character varying(500) NOT NULL, "challenge" character varying NOT NULL, "deletedByUserId" uuid, CONSTRAINT "PK_e2685e2af35bad33efc615c365c" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_36dde33ab3f3fefb63cb164c7d" ON "GreenlockChallenge" ("key") `,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_8358adfc13448a58e30a799f6e" ON "GreenlockChallenge" ("token") `,
    );
    await queryRunner.query(
      `ALTER TABLE "GreenlockCertificate" ADD CONSTRAINT "FK_895b9b802ed002a3804136bacf1" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "GreenlockChallenge" ADD CONSTRAINT "FK_7517f5a285255f031b0f6d9663c" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }
}
