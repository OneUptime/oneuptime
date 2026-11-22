import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renamed and
 * renumbered after the last registered migration.
 *
 * Blocklist feeds (#10345): SecurityBlocklistFeed, a secret URL a firewall
 * reads the project's blocklist from - its secret kept only as its hash,
 * with the one a rotation replaced, and what the firewall fetched last - and
 * SecurityBlocklistFeedFetch, every fetch of one, kept 30 days. Both are new
 * tables, empty until someone makes a feed, so their indexes and keys are
 * built with them.
 */
export class AddSecurityBlocklistFeeds1809187440000
  implements MigrationInterface
{
  public name: string = "AddSecurityBlocklistFeeds1809187440000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "SecurityBlocklistFeed" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "createdByActorType" character varying(100), "createdByActorId" uuid, "lastModifiedAt" TIMESTAMP WITH TIME ZONE, "lastModifiedByActorType" character varying(100), "lastModifiedByActorId" uuid, "lastModifiedByUserId" uuid, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "firewall" character varying(100) NOT NULL DEFAULT 'Other', "family" character varying(100) NOT NULL DEFAULT 'Both', "allowedSourceAddresses" text, "secret" character varying(255), "secretHint" character varying(100), "secretMadeAt" TIMESTAMP WITH TIME ZONE, "previousSecret" character varying(255), "previousSecretExpiresAt" TIMESTAMP WITH TIME ZONE, "revokedAt" TIMESTAMP WITH TIME ZONE, "lastFetchedAt" TIMESTAMP WITH TIME ZONE, "lastFetchSourceIp" character varying(100), "lastFetchUserAgent" character varying(500), "usualFetchIntervalInSeconds" integer, "stoppedReadingToldAt" TIMESTAMP WITH TIME ZONE, "servedValues" jsonb, "servedCount" integer, "servedConfirmedAt" TIMESTAMP WITH TIME ZONE, "servedBodyMd5" character varying(100), CONSTRAINT "PK_817854043b66f3113ba1af02dad" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f8db287ffd55e831bb709f2533" ON "SecurityBlocklistFeed" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "SecurityBlocklistFeedFetch" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "createdByActorType" character varying(100), "createdByActorId" uuid, "lastModifiedAt" TIMESTAMP WITH TIME ZONE, "lastModifiedByActorType" character varying(100), "lastModifiedByActorId" uuid, "lastModifiedByUserId" uuid, "projectId" uuid NOT NULL, "securityBlocklistFeedId" uuid NOT NULL, "fetchedAt" TIMESTAMP WITH TIME ZONE NOT NULL, "sourceIp" character varying(100), "userAgent" character varying(500), "file" character varying(100), "authMethod" character varying(100), "usedPreviousSecret" boolean NOT NULL DEFAULT false, "statusCode" integer, "isChanged" boolean NOT NULL DEFAULT false, "entryCount" integer, CONSTRAINT "PK_d2481d224bd3bb18b33bb6fe069" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6a6efa3c385be850307ffd2059" ON "SecurityBlocklistFeedFetch" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e59969d59966ed7627c9b17d99" ON "SecurityBlocklistFeedFetch" ("fetchedAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ffab6b14dfa404242f25e989d7" ON "SecurityBlocklistFeedFetch" ("securityBlocklistFeedId", "fetchedAt") `,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityBlocklistFeed" ADD CONSTRAINT "FK_f8db287ffd55e831bb709f25338" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityBlocklistFeedFetch" ADD CONSTRAINT "FK_6a6efa3c385be850307ffd20599" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityBlocklistFeedFetch" ADD CONSTRAINT "FK_f2e27ecc7c184901aa20482c6e4" FOREIGN KEY ("securityBlocklistFeedId") REFERENCES "SecurityBlocklistFeed"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "SecurityBlocklistFeedFetch" DROP CONSTRAINT "FK_f2e27ecc7c184901aa20482c6e4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityBlocklistFeedFetch" DROP CONSTRAINT "FK_6a6efa3c385be850307ffd20599"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityBlocklistFeed" DROP CONSTRAINT "FK_f8db287ffd55e831bb709f25338"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ffab6b14dfa404242f25e989d7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e59969d59966ed7627c9b17d99"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6a6efa3c385be850307ffd2059"`,
    );
    await queryRunner.query(`DROP TABLE "SecurityBlocklistFeedFetch"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f8db287ffd55e831bb709f2533"`,
    );
    await queryRunner.query(`DROP TABLE "SecurityBlocklistFeed"`);
  }
}
