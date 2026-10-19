import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * Record and transcribe incident calls (Video Calls page): the project's
 * switch (Project.recordAndTranscribeIncidentCalls, off), where OneUptime
 * stands in getting a call's transcript by itself
 * (IncidentVideoCall.transcriptFetch*), and when an incident's automatic
 * postmortem draft started waiting for what its calls said
 * (Incident.postmortemDraftWaitingSince). Nullable columns and one with a
 * constant default: no table is rewritten, and no index or foreign key is
 * built.
 */
export class AddIncidentCallTranscriptAutoFetch1803850000000
  implements MigrationInterface
{
  public name: string = "AddIncidentCallTranscriptAutoFetch1803850000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "recordAndTranscribeIncidentCalls" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" ADD "postmortemDraftWaitingSince" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" ADD "transcriptFetchStatus" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" ADD "transcriptFetchReason" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" ADD "transcriptFetchCheckedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" ADD "transcriptFetchNextAttemptAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" DROP COLUMN "transcriptFetchNextAttemptAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" DROP COLUMN "transcriptFetchCheckedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" DROP COLUMN "transcriptFetchReason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" DROP COLUMN "transcriptFetchStatus"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" DROP COLUMN "postmortemDraftWaitingSince"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "recordAndTranscribeIncidentCalls"`,
    );
  }
}
