import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with TypeORM's migration:generate for the models, and numbered
 * after the last registered migration.
 *
 * A case's Overview now has a response plan - what to do now about the
 * case: confirm it, contain it, fix what let it happen (#9557). Ticking a
 * step off makes it one of the case's tasks, and the task keeps the step it
 * was made from (SecurityCaseTask.responseStepKey), so the plan knows the
 * step again whatever language the task's title was written in.
 *
 * One nullable column, no default, no index, nothing backfilled: adding it
 * rewrites no row, a server of the release before ignores it, and a task
 * added by hand or by a playbook has none.
 */
export class AddSecurityCaseTaskResponseStepKey1809184690000
  implements MigrationInterface
{
  public name: string = "AddSecurityCaseTaskResponseStepKey1809184690000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseTask" ADD "responseStepKey" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "SecurityCaseTask" DROP COLUMN "responseStepKey"`,
    );
  }
}
