import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration and rewritten to ALTER the columns' types in
 * place.
 *
 * A project's credentials are now stored encrypted (#8989), among them its
 * SMTP configs' passwords and its members' webhook signing secrets. A
 * ciphertext is longer than the value it holds - a 500-character password
 * is stored as 704 characters - so the two columns that were a varchar
 * become text, as the other encrypted columns are:
 *
 *   - ProjectSMTPConfig.password: varchar(500);
 *   - UserWebhook.secret: varchar(100).
 *
 * The generator emitted a DROP COLUMN + ADD COLUMN for each, which would
 * throw every stored value away before the EncryptProjectCredentials data
 * migration can encrypt it; an ALTER COLUMN TYPE keeps it (and from a
 * varchar to text rewrites no row). Neither column is unique or indexed.
 *
 * The end state is the one the generator wanted, so the schema-drift check
 * sees nothing to generate. down() puts back the types as they were, which
 * holds only values that fit them, as before this ran.
 */
export class ProjectCredentialsEncryptedColumns1809181400000
  implements MigrationInterface
{
  public name: string = "ProjectCredentialsEncryptedColumns1809181400000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" ALTER COLUMN "password" TYPE text`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserWebhook" ALTER COLUMN "secret" TYPE text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "UserWebhook" ALTER COLUMN "secret" TYPE character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectSMTPConfig" ALTER COLUMN "password" TYPE character varying(500)`,
    );
  }
}
