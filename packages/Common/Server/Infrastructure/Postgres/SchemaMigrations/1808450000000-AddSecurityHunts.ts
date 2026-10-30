import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * Hunts (Types/SecurityEvent/SecurityHunt): searches over security events,
 * saved with a name, that can run on a schedule and tell people what they
 * find; and security events bookmarked onto a case as evidence.
 *
 *   - "SecurityHunt": one row per hunt - its search, its chips, how far back
 *     it looks, its schedule, and what its scheduled runs found. Read by
 *     its next run time (nextRunAt) to find the hunts that are due.
 *   - "SecurityHuntNotifyUser" and "SecurityHuntNotifyTeam": the people and
 *     teams a hunt tells when a scheduled run finds events (deleted with
 *     the hunt, the person or the team).
 *   - "SecurityCaseEvidence" gains three nullable columns for an event kept
 *     on a case (eventUid, eventTime, eventSnapshot). No index or foreign key
 *     is added to that existing table, so nothing scans or locks it.
 *
 * The new tables are empty, so their indexes and foreign keys are built
 * here.
 */
export class AddSecurityHunts1808450000000 implements MigrationInterface {
  public name: string = "AddSecurityHunts1808450000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "SecurityHunt" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "description" text, "searchQuery" text, "filters" jsonb, "timeRange" character varying(100) NOT NULL DEFAULT 'Past 1 Week', "schedule" character varying(100) NOT NULL DEFAULT 'Not Scheduled', "scheduledByUserId" uuid, "searchedUpToAt" TIMESTAMP WITH TIME ZONE, "nextRunAt" TIMESTAMP WITH TIME ZONE, "lastRunAt" TIMESTAMP WITH TIME ZONE, "lastRunEventCount" integer, "lastRunError" text, "lastFoundAt" TIMESTAMP WITH TIME ZONE, "lastFoundSinceAt" TIMESTAMP WITH TIME ZONE, "lastFoundEventCount" integer, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_a10925e96a5a7c946f657fe6573" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_58b2e5d756de6c9deaf6dfd2b5" ON "SecurityHunt" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1c7db49979a90580d1bc31b1da" ON "SecurityHunt" ("nextRunAt") `,
    );
    await queryRunner.query(
      `CREATE TABLE "SecurityHuntNotifyUser" ("securityHuntId" uuid NOT NULL, "userId" uuid NOT NULL, CONSTRAINT "PK_d2a59ebce93acf8b8c2894a2687" PRIMARY KEY ("securityHuntId", "userId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_23e86f412406411e68b9088033" ON "SecurityHuntNotifyUser" ("securityHuntId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e87724f5ec15682d4ff4dd9af6" ON "SecurityHuntNotifyUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "SecurityHuntNotifyTeam" ("securityHuntId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_495c5c79c29d5e78955f62a1102" PRIMARY KEY ("securityHuntId", "teamId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_6467dea83f21f96e7e2d2e4b49" ON "SecurityHuntNotifyTeam" ("securityHuntId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_961ca2eb5875024daff9584436" ON "SecurityHuntNotifyTeam" ("teamId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseEvidence" ADD "eventUid" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseEvidence" ADD "eventTime" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseEvidence" ADD "eventSnapshot" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityHunt" ADD CONSTRAINT "FK_58b2e5d756de6c9deaf6dfd2b50" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityHunt" ADD CONSTRAINT "FK_47c756a54b4f469bf9a4cb68214" FOREIGN KEY ("scheduledByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityHunt" ADD CONSTRAINT "FK_b66c411ff452659e71873ffb6aa" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityHunt" ADD CONSTRAINT "FK_b3189091a5c3c4baed6b649a872" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityHuntNotifyUser" ADD CONSTRAINT "FK_23e86f412406411e68b9088033f" FOREIGN KEY ("securityHuntId") REFERENCES "SecurityHunt"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityHuntNotifyUser" ADD CONSTRAINT "FK_e87724f5ec15682d4ff4dd9af66" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityHuntNotifyTeam" ADD CONSTRAINT "FK_6467dea83f21f96e7e2d2e4b49f" FOREIGN KEY ("securityHuntId") REFERENCES "SecurityHunt"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityHuntNotifyTeam" ADD CONSTRAINT "FK_961ca2eb5875024daff9584436e" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "SecurityHuntNotifyTeam" DROP CONSTRAINT "FK_961ca2eb5875024daff9584436e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityHuntNotifyTeam" DROP CONSTRAINT "FK_6467dea83f21f96e7e2d2e4b49f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityHuntNotifyUser" DROP CONSTRAINT "FK_e87724f5ec15682d4ff4dd9af66"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityHuntNotifyUser" DROP CONSTRAINT "FK_23e86f412406411e68b9088033f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityHunt" DROP CONSTRAINT "FK_b3189091a5c3c4baed6b649a872"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityHunt" DROP CONSTRAINT "FK_b66c411ff452659e71873ffb6aa"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityHunt" DROP CONSTRAINT "FK_47c756a54b4f469bf9a4cb68214"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityHunt" DROP CONSTRAINT "FK_58b2e5d756de6c9deaf6dfd2b50"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseEvidence" DROP COLUMN "eventSnapshot"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseEvidence" DROP COLUMN "eventTime"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseEvidence" DROP COLUMN "eventUid"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_961ca2eb5875024daff9584436"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6467dea83f21f96e7e2d2e4b49"`,
    );
    await queryRunner.query(`DROP TABLE "SecurityHuntNotifyTeam"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e87724f5ec15682d4ff4dd9af6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_23e86f412406411e68b9088033"`,
    );
    await queryRunner.query(`DROP TABLE "SecurityHuntNotifyUser"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1c7db49979a90580d1bc31b1da"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_58b2e5d756de6c9deaf6dfd2b5"`,
    );
    await queryRunner.query(`DROP TABLE "SecurityHunt"`);
  }
}
