import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration and rewritten to ALTER the column's type in
 * place.
 *
 * A project's Twilio auth token is stored encrypted, and a ciphertext is
 * about 40% longer than the token it holds: a token of 352 to 500
 * characters fitted its type's 500 characters as written, which
 * DatabaseService checks before it encrypts it, but not the varchar(500)
 * column as stored, and Postgres refused the write in an error that named
 * no field (#9267). So ProjectCallSMSConfig.twilioAuthToken becomes text,
 * as every other encrypted column is, and the token as written keeps its
 * 500 characters.
 *
 * The generator emitted a DROP COLUMN + ADD COLUMN, which would throw every
 * stored token away; an ALTER COLUMN TYPE keeps it, and from a varchar to
 * text rewrites no row. The column is neither unique nor indexed.
 *
 * The end state is the one the generator wanted, so the schema-drift check
 * sees nothing to generate. down() puts back the varchar(500), which holds
 * only values that fit it, as before this ran.
 */
export class TwilioAuthTokenTextColumn1809182960000
  implements MigrationInterface
{
  public name: string = "TwilioAuthTokenTextColumn1809182960000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ProjectCallSMSConfig" ALTER COLUMN "twilioAuthToken" TYPE text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ProjectCallSMSConfig" ALTER COLUMN "twilioAuthToken" TYPE character varying(500)`,
    );
  }
}
