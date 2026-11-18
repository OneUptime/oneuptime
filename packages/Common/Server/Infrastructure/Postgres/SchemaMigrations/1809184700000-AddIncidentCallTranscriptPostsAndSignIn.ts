import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then numbered after
 * the last registered migration. The two indexes it generated with these
 * are built online in AddIncidentCallTranscriptSignInIndexes1809184710000.
 *
 * What lets OneUptime take back a call's transcript, and what OneUptime AI
 * read in it, everywhere it went (#9289, #9290):
 *
 *   - IncidentVideoCall."callSummaryPosts": where each reading of the call's
 *     transcript was posted - its item in the incident's feed and its
 *     messages in the incident's Slack, Microsoft Teams and Mattermost
 *     channels - so Remove transcript deletes them too (CallSummaryPosts);
 *   - IncidentVideoCall."transcriptSignInAccountId": the provider account
 *     whose sign-in read the transcript, so that account removing OneUptime
 *     (Zoom's app_deauthorized) finds what was read through it;
 *   - IncidentVideoCall."transcriptSignInRemovedAt": when it did, until the
 *     Workers job has deleted it (DeleteTranscriptsOfRemovedSignIns).
 *
 * Three nullable columns with no default: adding them rewrites nothing and
 * blocks nothing. A server of the release before ignores them. The calls
 * whose transcript an earlier release read through a sign-in get their
 * account from BackfillIncidentCallTranscriptSignInAccount, a data
 * migration.
 */
export class AddIncidentCallTranscriptPostsAndSignIn1809184700000
  implements MigrationInterface
{
  public name: string = "AddIncidentCallTranscriptPostsAndSignIn1809184700000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" ADD "callSummaryPosts" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" ADD "transcriptSignInAccountId" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" ADD "transcriptSignInRemovedAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" DROP COLUMN "transcriptSignInRemovedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" DROP COLUMN "transcriptSignInAccountId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentVideoCall" DROP COLUMN "callSummaryPosts"`,
    );
  }
}
