import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration and rewritten to ALTER the column's type in
 * place.
 *
 * ProjectCallSMSConfig.twilioAuthToken is now stored encrypted, whose
 * ciphertext is longer than the plaintext token, so the column widens from
 * ShortText (varchar 100) to LongText (varchar 500). The generator emitted a
 * DROP COLUMN + ADD COLUMN for the length change, which would throw every
 * existing token away before the backfill (EncryptProjectCallSMSConfigTwilio
 * AuthToken) can encrypt it; an ALTER COLUMN TYPE keeps the stored values,
 * which the backfill then encrypts in place. The end state is the same
 * varchar(500), so the schema-drift check sees nothing to generate.
 */
export class TwilioAuthTokenEncryptedColumn1801800000000
  implements MigrationInterface
{
  public name: string = "TwilioAuthTokenEncryptedColumn1801800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ProjectCallSMSConfig" ALTER COLUMN "twilioAuthToken" TYPE character varying(500)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ProjectCallSMSConfig" ALTER COLUMN "twilioAuthToken" TYPE character varying(100)`,
    );
  }
}
