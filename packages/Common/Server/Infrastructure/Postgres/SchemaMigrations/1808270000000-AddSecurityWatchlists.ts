import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * Watchlists (Types/SecurityEvent/SecurityWatchlist): lists a team keeps
 * that detection and correlation rules match against, by name.
 *
 *   - "SecurityWatchlist": one row per list - its name, what it holds,
 *     where its values come from (the team, or a threat intel feed it
 *     follows) and how many values it holds.
 *   - "SecurityWatchlistItem": one row per value of a list the team keeps,
 *     with an optional note (deleted with its list).
 *
 * Both tables are new and empty, so their indexes and foreign keys are
 * built here; no existing table changes.
 */
export class AddSecurityWatchlists1808270000000 implements MigrationInterface {
  public name: string = "AddSecurityWatchlists1808270000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "SecurityWatchlist" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" character varying(500), "entityType" character varying(100) NOT NULL, "source" character varying(100) NOT NULL DEFAULT 'Values', "threatIntelFeedId" uuid, "valueCount" integer NOT NULL DEFAULT '0', "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_35d6a18b69ff8922a44f99155a2" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5dc94d37bd607bb9fb31b652dd" ON "SecurityWatchlist" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7e77a1ff8c4f137e2fc34560c1" ON "SecurityWatchlist" ("name") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7454841afe15e0f0caa113885e" ON "SecurityWatchlist" ("threatIntelFeedId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "SecurityWatchlistItem" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "securityWatchlistId" uuid NOT NULL, "value" character varying(500) NOT NULL, "note" character varying(500), "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_a4fbd77fd4e4d26b70a7710c071" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5e3025852ea857abbb304ee456" ON "SecurityWatchlistItem" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_845615b7a78b902f6182a1903f" ON "SecurityWatchlistItem" ("securityWatchlistId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_dd7b70e3dfce3e7d6c989b040a" ON "SecurityWatchlistItem" ("securityWatchlistId", "value") `,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityWatchlist" ADD CONSTRAINT "FK_5dc94d37bd607bb9fb31b652dd8" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityWatchlist" ADD CONSTRAINT "FK_7454841afe15e0f0caa113885ef" FOREIGN KEY ("threatIntelFeedId") REFERENCES "ThreatIntelFeed"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityWatchlist" ADD CONSTRAINT "FK_6408a25ed74e7f3e03306caef6c" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityWatchlist" ADD CONSTRAINT "FK_7be7b35047a41d5788f697b1290" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityWatchlistItem" ADD CONSTRAINT "FK_5e3025852ea857abbb304ee456c" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityWatchlistItem" ADD CONSTRAINT "FK_845615b7a78b902f6182a1903f1" FOREIGN KEY ("securityWatchlistId") REFERENCES "SecurityWatchlist"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityWatchlistItem" ADD CONSTRAINT "FK_118a409f3a757208ffa6653e9ef" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityWatchlistItem" ADD CONSTRAINT "FK_8356101c8d85b2193a20b895741" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "SecurityWatchlistItem" DROP CONSTRAINT "FK_8356101c8d85b2193a20b895741"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityWatchlistItem" DROP CONSTRAINT "FK_118a409f3a757208ffa6653e9ef"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityWatchlistItem" DROP CONSTRAINT "FK_845615b7a78b902f6182a1903f1"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityWatchlistItem" DROP CONSTRAINT "FK_5e3025852ea857abbb304ee456c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityWatchlist" DROP CONSTRAINT "FK_7be7b35047a41d5788f697b1290"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityWatchlist" DROP CONSTRAINT "FK_6408a25ed74e7f3e03306caef6c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityWatchlist" DROP CONSTRAINT "FK_7454841afe15e0f0caa113885ef"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityWatchlist" DROP CONSTRAINT "FK_5dc94d37bd607bb9fb31b652dd8"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dd7b70e3dfce3e7d6c989b040a"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_845615b7a78b902f6182a1903f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5e3025852ea857abbb304ee456"`,
    );
    await queryRunner.query(`DROP TABLE "SecurityWatchlistItem"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7454841afe15e0f0caa113885e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7e77a1ff8c4f137e2fc34560c1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5dc94d37bd607bb9fb31b652dd"`,
    );
    await queryRunner.query(`DROP TABLE "SecurityWatchlist"`);
  }
}
