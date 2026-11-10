import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Written as TypeORM's migration:generate writes these columns, numbered
 * after the last registered migration.
 *
 * A code task's turn that fails for a reason trying again can fix (the AI
 * model provider busy or down, a timeout, the network, its Runner going
 * away) is queued again in place, up to three attempts in all (issues
 * #6439 and #6442, Types/AI/CodeTaskRetry): "autoRetryCount" counts the
 * times it was, "nextAttemptAt" holds it back until its short wait is over
 * (no worker claims it before), and "retryReason" keeps what the attempt
 * before failed with. Three nullable or defaulted columns on AIRun: every
 * existing run reads as never tried again and waiting for nothing.
 */
export class AddCodeFixRunAutoRetry1809080300000 implements MigrationInterface {
  public name: string = "AddCodeFixRunAutoRetry1809080300000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AIRun" ADD "autoRetryCount" integer NOT NULL DEFAULT '0'`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIRun" ADD "nextAttemptAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "AIRun" ADD "retryReason" character varying(500)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "AIRun" DROP COLUMN "retryReason"`);
    await queryRunner.query(`ALTER TABLE "AIRun" DROP COLUMN "nextAttemptAt"`);
    await queryRunner.query(`ALTER TABLE "AIRun" DROP COLUMN "autoRetryCount"`);
  }
}
