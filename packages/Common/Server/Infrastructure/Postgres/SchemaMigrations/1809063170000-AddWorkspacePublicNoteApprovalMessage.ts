import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with TypeORM's migration:generate (the statements it generates
 * for the models), then renumbered after the last registered migration.
 *
 * The approval messages a public note's approvers get in Slack, Microsoft
 * Teams and Mattermost, kept while the note's round of approval is open so
 * they can be replaced by what happened once the note is decided (issue
 * #6317): WorkspacePublicNoteApprovalMessage. A new, empty table: its own
 * indexes and foreign keys are built in the same migration, at once. Each
 * row goes with its note, its project and the person it was sent to (ON
 * DELETE CASCADE).
 */
export class AddWorkspacePublicNoteApprovalMessage1809063170000
  implements MigrationInterface
{
  public name: string = "AddWorkspacePublicNoteApprovalMessage1809063170000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "WorkspacePublicNoteApprovalMessage" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "userId" uuid NOT NULL, "incidentPublicNoteId" uuid, "incidentEpisodePublicNoteId" uuid, "scheduledMaintenancePublicNoteId" uuid, "recordId" uuid NOT NULL, "workspaceType" character varying(100) NOT NULL, "workspaceProjectId" character varying(500) NOT NULL, "channelId" character varying(500) NOT NULL, "messageId" character varying(500) NOT NULL, "serviceUrl" character varying(500), "submittedAt" character varying(100) NOT NULL, "stepId" character varying(100) NOT NULL, "isFinal" boolean NOT NULL DEFAULT false, "isEdit" boolean NOT NULL DEFAULT false, "textDigest" character varying(100) NOT NULL, CONSTRAINT "PK_6c924b5d6e23becd8ac65eb3e31" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3b2400ec629e52cd32e7051d5d" ON "WorkspacePublicNoteApprovalMessage" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_73b755a5ca74d5107f76824e49" ON "WorkspacePublicNoteApprovalMessage" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0eff1e542b15597d9d4352adbd" ON "WorkspacePublicNoteApprovalMessage" ("incidentPublicNoteId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_40c17c9b460244cdba38f63ac3" ON "WorkspacePublicNoteApprovalMessage" ("incidentEpisodePublicNoteId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_66fc5c404db9fb89b699e87294" ON "WorkspacePublicNoteApprovalMessage" ("scheduledMaintenancePublicNoteId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_12f2079be3465363e0df468a63" ON "WorkspacePublicNoteApprovalMessage" ("recordId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspacePublicNoteApprovalMessage" ADD CONSTRAINT "FK_3b2400ec629e52cd32e7051d5d1" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspacePublicNoteApprovalMessage" ADD CONSTRAINT "FK_73b755a5ca74d5107f76824e49d" FOREIGN KEY ("userId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspacePublicNoteApprovalMessage" ADD CONSTRAINT "FK_0eff1e542b15597d9d4352adbd4" FOREIGN KEY ("incidentPublicNoteId") REFERENCES "IncidentPublicNote"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspacePublicNoteApprovalMessage" ADD CONSTRAINT "FK_40c17c9b460244cdba38f63ac33" FOREIGN KEY ("incidentEpisodePublicNoteId") REFERENCES "IncidentEpisodePublicNote"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspacePublicNoteApprovalMessage" ADD CONSTRAINT "FK_66fc5c404db9fb89b699e872949" FOREIGN KEY ("scheduledMaintenancePublicNoteId") REFERENCES "ScheduledMaintenancePublicNote"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "WorkspacePublicNoteApprovalMessage" DROP CONSTRAINT "FK_66fc5c404db9fb89b699e872949"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspacePublicNoteApprovalMessage" DROP CONSTRAINT "FK_40c17c9b460244cdba38f63ac33"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspacePublicNoteApprovalMessage" DROP CONSTRAINT "FK_0eff1e542b15597d9d4352adbd4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspacePublicNoteApprovalMessage" DROP CONSTRAINT "FK_73b755a5ca74d5107f76824e49d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "WorkspacePublicNoteApprovalMessage" DROP CONSTRAINT "FK_3b2400ec629e52cd32e7051d5d1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_12f2079be3465363e0df468a63"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_66fc5c404db9fb89b699e87294"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_40c17c9b460244cdba38f63ac3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0eff1e542b15597d9d4352adbd"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_73b755a5ca74d5107f76824e49"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3b2400ec629e52cd32e7051d5d"`,
    );
    await queryRunner.query(`DROP TABLE "WorkspacePublicNoteApprovalMessage"`);
  }
}
