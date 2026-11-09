import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Public note approval (issue #5720, Types/StatusPage/PublicNoteApproval):
 * a project can ask for its incidents', episodes' and scheduled maintenance
 * events' public notes to be approved before they are published.
 *
 *   - PublicNoteApprovalStep, with the people and teams of each step
 *     (PublicNoteApprovalStepUser, PublicNoteApprovalStepTeam): who approves,
 *     step by step.
 *   - Project.requireApprovalForIncidentPublicNotes and
 *     requireApprovalForScheduledMaintenancePublicNotes: the switches, off on
 *     every project, so every project posts public notes as it did.
 *   - On the three public note tables, isPublished (true on every existing
 *     note: every note so far was published as it was posted), and
 *     approvalStatus, approval and pendingNote, empty on every one.
 *
 * Generated with npm run generate-postgres-migration. The new columns of the
 * existing tables are booleans with constant defaults or nullable with none,
 * so each is added without rewriting its table and nothing is backfilled.
 * Every index and foreign key is on a table this migration creates, which is
 * empty, so none needs OnlineDdl.
 */
export class AddPublicNoteApproval1808995720000 implements MigrationInterface {
  public name = "AddPublicNoteApproval1808995720000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "PublicNoteApprovalStep" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "eventType" character varying(100) NOT NULL, "name" character varying(100), "order" integer NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "PK_240133b7025bc95859ea0a4cbdb" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5e89eec28ca1565deb55e11c7e" ON "PublicNoteApprovalStep" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_a3ca82204945861d7b94951748" ON "PublicNoteApprovalStep" ("eventType") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_27e7bf7ae4549b7da510451d08" ON "PublicNoteApprovalStep" ("order") `,
    );
    await queryRunner.query(
      `CREATE TABLE "PublicNoteApprovalStepUser" ("publicNoteApprovalStepId" uuid NOT NULL, "userId" uuid NOT NULL, CONSTRAINT "PK_854dc4dc8111b98989b8b2575fa" PRIMARY KEY ("publicNoteApprovalStepId", "userId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0bc94ca4d51cb71ece09059660" ON "PublicNoteApprovalStepUser" ("publicNoteApprovalStepId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e2a4b3744368d796ae4c88e9f4" ON "PublicNoteApprovalStepUser" ("userId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "PublicNoteApprovalStepTeam" ("publicNoteApprovalStepId" uuid NOT NULL, "teamId" uuid NOT NULL, CONSTRAINT "PK_87959e3fb8098bd2ab3f3e541a8" PRIMARY KEY ("publicNoteApprovalStepId", "teamId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5652632944e3fe4d39a6de0e28" ON "PublicNoteApprovalStepTeam" ("publicNoteApprovalStepId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e2468333e13b8571c1c1befc96" ON "PublicNoteApprovalStepTeam" ("teamId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "requireApprovalForIncidentPublicNotes" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "requireApprovalForScheduledMaintenancePublicNotes" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNote" ADD "isPublished" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNote" ADD "approvalStatus" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNote" ADD "approval" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNote" ADD "pendingNote" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePublicNote" ADD "isPublished" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePublicNote" ADD "approvalStatus" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePublicNote" ADD "approval" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePublicNote" ADD "pendingNote" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodePublicNote" ADD "isPublished" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodePublicNote" ADD "approvalStatus" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodePublicNote" ADD "approval" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodePublicNote" ADD "pendingNote" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "PublicNoteApprovalStep" ADD CONSTRAINT "FK_5e89eec28ca1565deb55e11c7eb" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PublicNoteApprovalStep" ADD CONSTRAINT "FK_eb3f241837d75ac4cf96b54e346" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PublicNoteApprovalStep" ADD CONSTRAINT "FK_d17b19b1a45dfba8f9436a73208" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PublicNoteApprovalStepUser" ADD CONSTRAINT "FK_0bc94ca4d51cb71ece090596601" FOREIGN KEY ("publicNoteApprovalStepId") REFERENCES "PublicNoteApprovalStep"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PublicNoteApprovalStepUser" ADD CONSTRAINT "FK_e2a4b3744368d796ae4c88e9f49" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PublicNoteApprovalStepTeam" ADD CONSTRAINT "FK_5652632944e3fe4d39a6de0e282" FOREIGN KEY ("publicNoteApprovalStepId") REFERENCES "PublicNoteApprovalStep"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "PublicNoteApprovalStepTeam" ADD CONSTRAINT "FK_e2468333e13b8571c1c1befc967" FOREIGN KEY ("teamId") REFERENCES "Team"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "PublicNoteApprovalStepTeam" DROP CONSTRAINT "FK_e2468333e13b8571c1c1befc967"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PublicNoteApprovalStepTeam" DROP CONSTRAINT "FK_5652632944e3fe4d39a6de0e282"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PublicNoteApprovalStepUser" DROP CONSTRAINT "FK_e2a4b3744368d796ae4c88e9f49"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PublicNoteApprovalStepUser" DROP CONSTRAINT "FK_0bc94ca4d51cb71ece090596601"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PublicNoteApprovalStep" DROP CONSTRAINT "FK_d17b19b1a45dfba8f9436a73208"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PublicNoteApprovalStep" DROP CONSTRAINT "FK_eb3f241837d75ac4cf96b54e346"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PublicNoteApprovalStep" DROP CONSTRAINT "FK_5e89eec28ca1565deb55e11c7eb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodePublicNote" DROP COLUMN "pendingNote"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodePublicNote" DROP COLUMN "approval"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodePublicNote" DROP COLUMN "approvalStatus"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentEpisodePublicNote" DROP COLUMN "isPublished"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePublicNote" DROP COLUMN "pendingNote"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePublicNote" DROP COLUMN "approval"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePublicNote" DROP COLUMN "approvalStatus"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenancePublicNote" DROP COLUMN "isPublished"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNote" DROP COLUMN "pendingNote"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNote" DROP COLUMN "approval"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNote" DROP COLUMN "approvalStatus"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentPublicNote" DROP COLUMN "isPublished"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "requireApprovalForScheduledMaintenancePublicNotes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "requireApprovalForIncidentPublicNotes"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e2468333e13b8571c1c1befc96"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5652632944e3fe4d39a6de0e28"`,
    );
    await queryRunner.query(`DROP TABLE "PublicNoteApprovalStepTeam"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e2a4b3744368d796ae4c88e9f4"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0bc94ca4d51cb71ece09059660"`,
    );
    await queryRunner.query(`DROP TABLE "PublicNoteApprovalStepUser"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_27e7bf7ae4549b7da510451d08"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_a3ca82204945861d7b94951748"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5e89eec28ca1565deb55e11c7e"`,
    );
    await queryRunner.query(`DROP TABLE "PublicNoteApprovalStep"`);
  }
}
