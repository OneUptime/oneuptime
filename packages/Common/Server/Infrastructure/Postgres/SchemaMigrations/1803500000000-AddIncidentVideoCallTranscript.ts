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
 * hand-written. The two foreign keys are on columns this migration adds,
 * which hold NULL on every existing row, so checking them reads nothing.
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
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" ADD CONSTRAINT "FK_a266b1ee7d197f69c0ff4b5d069" FOREIGN KEY ("transcriptAddedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" ADD CONSTRAINT "FK_77c2a11e31a23826f7d1d65dd4c" FOREIGN KEY ("rootCauseSuggestionReviewedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" DROP CONSTRAINT "FK_77c2a11e31a23826f7d1d65dd4c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" DROP CONSTRAINT "FK_a266b1ee7d197f69c0ff4b5d069"`,
    );
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
