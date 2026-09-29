import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Widen every HashedString column from varchar(64) to varchar(255).
 *
 * A bare SHA-256 digest is 64 hex characters, which is exactly what the old
 * column held. User passwords are now scrypt hashes that carry the cost
 * parameters they were produced with — `scrypt$N=16384,r=8,p=1$<64 hex>`,
 * about 90 characters — so that raising the cost later needs no migration and
 * no password reset. The other HashedString columns (session refresh tokens,
 * master passwords) still store a bare digest and simply do not use the room;
 * they are widened only because they share ColumnLength.HashedString.
 *
 * WHY THIS FILE IS NOT WHAT `migration:generate` PRODUCED.
 *
 * TypeORM does not express a varchar length change as ALTER COLUMN TYPE. It
 * emits DROP COLUMN followed by ADD COLUMN, which for these six columns means
 * deleting every password, every status page and dashboard master password,
 * and every active session in the instance. The generated `up()` also had to
 * drop and recreate the refresh-token unique constraints and indexes, purely
 * to work around its own DROP.
 *
 * ALTER COLUMN TYPE to a WIDER varchar is the correct statement and is
 * cheaper besides: Postgres skips the table rewrite entirely when a varchar
 * is only being lengthened (no rewrite means the unique indexes survive
 * untouched too), so this is a catalog update behind a brief ACCESS EXCLUSIVE
 * lock rather than a full copy of six tables.
 *
 * The resulting schema is identical to what the generated migration would
 * have produced, which is what `npm run check-postgres-schema-drift` verifies.
 */

const WIDENED_COLUMNS: ReadonlyArray<{ table: string; column: string }> = [
  { table: "User", column: "password" },
  { table: "StatusPagePrivateUser", column: "password" },
  { table: "StatusPage", column: "masterPassword" },
  { table: "Dashboard", column: "masterPassword" },
  { table: "UserSession", column: "refreshToken" },
  { table: "StatusPagePrivateUserSession", column: "refreshToken" },
];

export class WidenHashedStringColumnsForScrypt1786023262402
  implements MigrationInterface
{
  public name = "WidenHashedStringColumnsForScrypt1786023262402";

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const { table, column } of WIDENED_COLUMNS) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE character varying(255)`,
      );
    }
  }

  /*
   * Narrowing back to 64 fails loudly if any scrypt hash has been written,
   * because those do not fit. That is the intended behaviour: a down
   * migration that truncated password hashes would lock every user out
   * silently instead of refusing.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const { table, column } of [...WIDENED_COLUMNS].reverse()) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ALTER COLUMN "${column}" TYPE character varying(64)`,
      );
    }
  }
}
