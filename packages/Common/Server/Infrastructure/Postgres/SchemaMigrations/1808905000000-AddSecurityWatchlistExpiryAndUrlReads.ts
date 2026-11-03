import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Watchlists, next (#5391's follow-ups):
 *
 *   - a value can leave its list at a moment it is given
 *     (SecurityWatchlistItem.expiresAt);
 *   - a list can be read from a file at an https address on a schedule,
 *     and keeps what each read did (SecurityWatchlist.importUrl,
 *     importSchedule, nextImportAt and the lastImport* columns).
 *
 * Every column is nullable, with no default and no row written: every
 * value stays until someone removes it, and every list keeps its values as
 * it did. Adding them is a catalogue change, not a rewrite. Generated with
 * npm run generate-postgres-migration; its two indexes, on tables that
 * already exist, are built online in
 * AddSecurityWatchlistExpiryAndUrlReadIndexes1808906000000.
 */
export class AddSecurityWatchlistExpiryAndUrlReads1808905000000
  implements MigrationInterface
{
  public name = "AddSecurityWatchlistExpiryAndUrlReads1808905000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "SecurityWatchlist" ADD "importUrl" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityWatchlist" ADD "importSchedule" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityWatchlist" ADD "nextImportAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityWatchlist" ADD "lastImportAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityWatchlist" ADD "lastImportSucceededAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityWatchlist" ADD "lastImportError" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityWatchlist" ADD "lastImportErrorDetail" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityWatchlist" ADD "lastImportLinesLeftOut" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityWatchlistItem" ADD "expiresAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "SecurityWatchlistItem" DROP COLUMN "expiresAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityWatchlist" DROP COLUMN "lastImportLinesLeftOut"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityWatchlist" DROP COLUMN "lastImportErrorDetail"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityWatchlist" DROP COLUMN "lastImportError"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityWatchlist" DROP COLUMN "lastImportSucceededAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityWatchlist" DROP COLUMN "lastImportAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityWatchlist" DROP COLUMN "nextImportAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityWatchlist" DROP COLUMN "importSchedule"`,
    );
    await queryRunner.query(
      `ALTER TABLE "SecurityWatchlist" DROP COLUMN "importUrl"`,
    );
  }
}
