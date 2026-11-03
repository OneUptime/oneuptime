import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddSecurityWatchlistExpiryAndUrlReads1808905000000, and moved into a
 * migration of its own: SecurityWatchlist and SecurityWatchlistItem already
 * exist, and every value a team adds or imports is written to the second,
 * so the two indexes the minute-by-minute sweeps read by are built online:
 *
 *   - "nextImportAt" on SecurityWatchlist: the lists read from an address
 *     that are due (SecurityWatchlistUrlImport);
 *   - "expiresAt" on SecurityWatchlistItem: the values whose moment to
 *     leave their list has come (SecurityWatchlistExpiry).
 *
 * Every existing row's column is null. Safe to run again after a stop part
 * way: an index that is already there is left as it is.
 */
export class AddSecurityWatchlistExpiryAndUrlReadIndexes1808906000000
  implements MigrationInterface
{
  public name: string =
    "AddSecurityWatchlistExpiryAndUrlReadIndexes1808906000000";

  // CREATE INDEX CONCURRENTLY runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_e1d72d9ccdaf3422d4da604979" ON "SecurityWatchlist" ("nextImportAt") `,
    );
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_c314c7a269390d32a71764a83c" ON "SecurityWatchlistItem" ("expiresAt") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_c314c7a269390d32a71764a83c"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_e1d72d9ccdaf3422d4da604979"`,
    );
  }
}
