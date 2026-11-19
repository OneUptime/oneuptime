import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Written as npm run generate-postgres-migration writes a nullable boolean
 * column with a default (AddProjectDefaultPagingLadder), and numbered after
 * the last registered migration.
 *
 * Project.detectVoicemailOnCalls (#6594): whether each on-call call the
 * project's members get through Twilio asks Twilio whether a person or
 * voicemail answered it, so a call voicemail answered counts as not
 * answered.
 *
 * One nullable column on an existing table, with no index and no key. Its
 * default is a constant, which Postgres keeps in the catalog: adding it
 * rewrites nothing and blocks nothing. Every existing project reads it as
 * on, as a new one starts.
 */
export class AddProjectDetectVoicemailOnCalls1809186500000
  implements MigrationInterface
{
  public name: string = "AddProjectDetectVoicemailOnCalls1809186500000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "detectVoicemailOnCalls" boolean DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "detectVoicemailOnCalls"`,
    );
  }
}
