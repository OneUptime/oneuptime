import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with TypeORM's migration:generate (the statements it generates
 * for the models), then renumbered after the last registered migration.
 *
 * Whom OneUptime asked to approve each step of a public note, and how
 * (issue #6353): PublicNoteApprovalRequest. When who approves a waiting note
 * changes - its approval steps, or the members of a team a step names - the
 * people of the step it waits for who were not asked yet are asked, and
 * nobody twice: the unique index writes each request once. A new, empty
 * table: its own indexes and foreign keys are built in the same migration,
 * at once. Each row goes with its note, its project and the person it was
 * about (ON DELETE CASCADE).
 */
export class AddPublicNoteApprovalRequest1809063230000
  implements MigrationInterface
{
  public name: string = "AddPublicNoteApprovalRequest1809063230000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "PublicNoteApprovalRequest" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "userId" uuid NOT NULL, "noteId" uuid NOT NULL, "incidentPublicNoteId" uuid, "incidentEpisodePublicNoteId" uuid, "scheduledMaintenancePublicNoteId" uuid, "submittedAt" character varying(100) NOT NULL, "stepId" character varying(100) NOT NULL, "kind" character varying(100) NOT NULL, "isFinal" boolean NOT NULL DEFAULT false, "isAskedAgain" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_b0f8dcd1db4804b52b0deb8c543" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_169fc8163f96b1320276df91d8" ON "PublicNoteApprovalRequest" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_923075a9fff89e06867d6e0501" ON "PublicNoteApprovalRequest" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c439264605c538bc4fd833fe08" ON "PublicNoteApprovalRequest" ("incidentPublicNoteId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3a32ba61f6957ff8d8f43b05aa" ON "PublicNoteApprovalRequest" ("incidentEpisodePublicNoteId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ef8c6f9a16d03051c6059f5eb5" ON "PublicNoteApprovalRequest" ("scheduledMaintenancePublicNoteId") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_ea8dbd0e3b78505561e633567f" ON "PublicNoteApprovalRequest" ("noteId", "submittedAt", "stepId", "kind", "isFinal", "isAskedAgain", "userId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "PublicNoteApprovalRequest" ADD CONSTRAINT "FK_169fc8163f96b1320276df91d85" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PublicNoteApprovalRequest" ADD CONSTRAINT "FK_923075a9fff89e06867d6e05011" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PublicNoteApprovalRequest" ADD CONSTRAINT "FK_c439264605c538bc4fd833fe08f" FOREIGN KEY ("incidentPublicNoteId") REFERENCES "IncidentPublicNote"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PublicNoteApprovalRequest" ADD CONSTRAINT "FK_3a32ba61f6957ff8d8f43b05aa4" FOREIGN KEY ("incidentEpisodePublicNoteId") REFERENCES "IncidentEpisodePublicNote"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "PublicNoteApprovalRequest" ADD CONSTRAINT "FK_ef8c6f9a16d03051c6059f5eb53" FOREIGN KEY ("scheduledMaintenancePublicNoteId") REFERENCES "ScheduledMaintenancePublicNote"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "PublicNoteApprovalRequest" DROP CONSTRAINT "FK_ef8c6f9a16d03051c6059f5eb53"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PublicNoteApprovalRequest" DROP CONSTRAINT "FK_3a32ba61f6957ff8d8f43b05aa4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PublicNoteApprovalRequest" DROP CONSTRAINT "FK_c439264605c538bc4fd833fe08f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PublicNoteApprovalRequest" DROP CONSTRAINT "FK_923075a9fff89e06867d6e05011"`,
    );
    await queryRunner.query(
      `ALTER TABLE "PublicNoteApprovalRequest" DROP CONSTRAINT "FK_169fc8163f96b1320276df91d85"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ea8dbd0e3b78505561e633567f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ef8c6f9a16d03051c6059f5eb5"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3a32ba61f6957ff8d8f43b05aa"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c439264605c538bc4fd833fe08"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_923075a9fff89e06867d6e0501"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_169fc8163f96b1320276df91d8"`,
    );
    await queryRunner.query(`DROP TABLE "PublicNoteApprovalRequest"`);
  }
}
