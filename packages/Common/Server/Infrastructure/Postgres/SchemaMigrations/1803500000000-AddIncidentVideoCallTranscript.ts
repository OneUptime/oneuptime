import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * An incident call's transcript, and what OneUptime AI read in it
 * (issue #4875).
 *
 * Twelve nullable columns on IncidentVideoCall: the transcript itself (one
 * remark a line), where it came from, a short description of it and who
 * added it when; OneUptime AI's reading of it (the summary as JSON, its
 * status, why it stopped, when it changed); and what a person decided about
 * the root cause it suggested, by whom and when. Every existing call keeps
 * NULL in all of them: no call has a transcript until someone adds one.
 *
 * Generated with `typeorm migration:generate` against a fully migrated
 * throwaway database; only the file/class name and this comment are
 * hand-written. The foreign keys of the two user columns were generated
 * with it and moved to AddIncidentVideoCallTranscriptUserLinks1803550000000,
 * which adds them online.
 */
export class AddIncidentVideoCallTranscript1803500000000
  implements MigrationInterface
{
  public name: string = "AddIncidentVideoCallTranscript1803500000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" ADD "transcript" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" ADD "transcriptSource" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" ADD "transcriptInfo" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" ADD "transcriptAddedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" ADD "transcriptAddedByUserId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" ADD "callSummary" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" ADD "callSummaryStatus" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" ADD "callSummaryStatusMessage" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" ADD "callSummaryUpdatedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" ADD "rootCauseSuggestionStatus" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" ADD "rootCauseSuggestionReviewedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" ADD "rootCauseSuggestionReviewedByUserId" uuid`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" DROP COLUMN "rootCauseSuggestionReviewedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" DROP COLUMN "rootCauseSuggestionReviewedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" DROP COLUMN "rootCauseSuggestionStatus"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" DROP COLUMN "callSummaryUpdatedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" DROP COLUMN "callSummaryStatusMessage"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" DROP COLUMN "callSummaryStatus"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" DROP COLUMN "callSummary"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" DROP COLUMN "transcriptAddedByUserId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" DROP COLUMN "transcriptAddedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" DROP COLUMN "transcriptInfo"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" DROP COLUMN "transcriptSource"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" DROP COLUMN "transcript"`,
    );
  }
}
