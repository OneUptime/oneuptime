import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * PresentedKeysEncryptedColumns1809182700000, and moved into a migration of
 * its own: every status page view reads "StatusPage", so its lock is taken
 * in a migration that waits for no other table.
 *
 * A status page's embed token is kept encrypted now (#9012), and a
 * ciphertext is longer than the varchar(100) it was: it becomes text. From
 * a varchar to text rewrites no row, and the index on the token stays, by
 * its name. The generator's DROP COLUMN + ADD COLUMN would have thrown every
 * token away - and every badge embedded with one - before the
 * PresentedKeys:ProtectAtRest job can encrypt it, a day after the upgrade.
 *
 * down() puts back the varchar(100), which no ciphertext fits: a token
 * stored encrypted is cleared, and the page's Regenerate makes another in
 * the release before. A token not encrypted yet is kept.
 */

// How every ciphertext OneUptime writes begins (Encryption.CIPHERTEXT_PREFIX).
const CIPHERTEXT_LIKE: string = "U2FsdGVkX1%";

export class StatusPageEmbedTokenEncryptedColumn1809182710000
  implements MigrationInterface
{
  public name: string = "StatusPageEmbedTokenEncryptedColumn1809182710000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ALTER COLUMN "embeddedOverallStatusToken" TYPE text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPage" ALTER COLUMN "embeddedOverallStatusToken" TYPE character varying(100) USING (CASE WHEN "embeddedOverallStatusToken" LIKE '${CIPHERTEXT_LIKE}' THEN NULL ELSE "embeddedOverallStatusToken" END)`,
    );
  }
}
