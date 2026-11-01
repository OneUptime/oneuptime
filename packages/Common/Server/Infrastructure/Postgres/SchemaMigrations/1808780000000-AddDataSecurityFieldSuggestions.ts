import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * OneUptime AI's suggestions for the fields a content scan could not place,
 * and a person's confirmation of a finding:
 *
 *   - DataStore.fieldSuggestionState: the fields the store's last scan could
 *     not place, by their names and the shapes of their values, and
 *     OneUptime AI's answers about them (Server/Utils/DataSecurity/
 *     FieldSuggestionState). Read by nobody through the API.
 *   - DataStoreFinding.isAiSuggested and aiReason: the finding is OneUptime
 *     AI's suggestion, and why. Every existing finding is a detector's, so
 *     false is right for them all.
 *   - DataStoreFinding.isConfirmed: a person confirmed the finding, and it
 *     counts as High confidence. No finding has been confirmed yet, so
 *     false is right for them all.
 *
 * Only added columns, each with a default or nullable: existing rows need
 * nothing else.
 */
export class AddDataSecurityFieldSuggestions1808780000000
  implements MigrationInterface
{
  public name: string = "AddDataSecurityFieldSuggestions1808780000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataStore" ADD "fieldSuggestionState" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreFinding" ADD "isConfirmed" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreFinding" ADD "isAiSuggested" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreFinding" ADD "aiReason" character varying(500)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DataStoreFinding" DROP COLUMN "aiReason"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreFinding" DROP COLUMN "isAiSuggested"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStoreFinding" DROP COLUMN "isConfirmed"`,
    );
    await queryRunner.query(
      `ALTER TABLE "DataStore" DROP COLUMN "fieldSuggestionState"`,
    );
  }
}
