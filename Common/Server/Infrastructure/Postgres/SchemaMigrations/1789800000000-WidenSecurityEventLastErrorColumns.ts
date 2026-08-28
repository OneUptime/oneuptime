import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * lastError on both security-event connectors becomes unbounded text.
 *
 * Both columns were varchar(500), and both hold an error produced
 * elsewhere: the Google SecOps client echoes up to 500 characters of the
 * Chronicle response body behind a ~46 character prefix, and a ClickHouse
 * error echoes the whole compiled query. Either overflows 500, and
 * DatabaseService.checkMaxLengthOfFields turns that overflow into a
 * BadDataException — thrown from inside the catch block that was trying to
 * record the failure, which took the whole poll/evaluation tick down with
 * it and left lastError and its lastPolledAt/lastEvaluatedAt stamp null.
 *
 * ALTER COLUMN ... TYPE rather than the DROP + ADD pair TypeORM generates
 * for this change: varchar -> text is binary-coercible in Postgres, so
 * this preserves whatever error is currently stored instead of discarding
 * it on upgrade. Same end state, same shape as the MonitorSecret
 * secretValue widening in 1720024126646.
 */
export class WidenSecurityEventLastErrorColumns1789800000000
  implements MigrationInterface
{
  public name: string = "WidenSecurityEventLastErrorColumns1789800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "DetectionRule" ALTER COLUMN "lastError" TYPE text`,
    );
    await queryRunner.query(
      `ALTER TABLE "GoogleSecOpsConnection" ALTER COLUMN "lastError" TYPE text`,
    );
  }

  /*
   * Reversing narrows the column, so anything already stored past 500
   * characters has to go somewhere: truncate it rather than let the ALTER
   * fail on existing rows.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "GoogleSecOpsConnection" SET "lastError" = LEFT("lastError", 500) WHERE LENGTH("lastError") > 500`,
    );
    await queryRunner.query(
      `ALTER TABLE "GoogleSecOpsConnection" ALTER COLUMN "lastError" TYPE character varying(500)`,
    );
    await queryRunner.query(
      `UPDATE "DetectionRule" SET "lastError" = LEFT("lastError", 500) WHERE LENGTH("lastError") > 500`,
    );
    await queryRunner.query(
      `ALTER TABLE "DetectionRule" ALTER COLUMN "lastError" TYPE character varying(500)`,
    );
  }
}
