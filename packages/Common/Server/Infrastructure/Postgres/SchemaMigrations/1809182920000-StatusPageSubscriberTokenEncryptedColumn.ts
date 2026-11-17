import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * PresentedKeysEncryptedColumns1809182900000, and moved into a migration of
 * its own: every notification a status page sends reads
 * "StatusPageSubscriber", so its lock is taken in a migration that waits for
 * no other table.
 *
 * A subscriber's unsubscribe token is kept encrypted now (#9012), and a
 * ciphertext is longer than the varchar(100) it was: it becomes text. From
 * a varchar to text rewrites no row. The generator's DROP COLUMN + ADD
 * COLUMN would have thrown every token away - and the unsubscribe link in
 * every email sent - before the PresentedKeys:ProtectAtRest job can encrypt
 * it, a day after the upgrade.
 *
 * down() puts back the varchar(100), which no ciphertext fits: a token
 * stored encrypted is cleared, and the release before gives the subscriber
 * another when it next writes to them (StatusPageSubscriberService, the
 * unsubscribe token backfill). A token not encrypted yet is kept.
 */

// How every ciphertext OneUptime writes begins (Encryption.CIPHERTEXT_PREFIX).
const CIPHERTEXT_LIKE: string = "U2FsdGVkX1%";

export class StatusPageSubscriberTokenEncryptedColumn1809182920000
  implements MigrationInterface
{
  public name: string = "StatusPageSubscriberTokenEncryptedColumn1809182920000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" ALTER COLUMN "unsubscribeToken" TYPE text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPageSubscriber" ALTER COLUMN "unsubscribeToken" TYPE character varying(100) USING (CASE WHEN "unsubscribeToken" LIKE '${CIPHERTEXT_LIKE}' THEN NULL ELSE "unsubscribeToken" END)`,
    );
  }
}
