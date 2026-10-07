import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, then renumbered after
 * the last registered migration.
 *
 * When a project's owners were last emailed that its plan stops its API
 * keys or limits its SCIM connections (PlanDowngradeOwnerNotice): a plan
 * change that tells them writes it, and the one-time notice to the projects
 * that were already below those plans claims it - one conditional UPDATE,
 * only while it is still empty - so no project's owners are told twice
 * (data migration NotifyOwnersOfStoppedApiKeysAndScim).
 *
 * Nullable with no default, so this only adds the column: every project
 * starts as "not told yet".
 */
export class AddProjectPlanCutoffNoticeSentAt1799400000000
  implements MigrationInterface
{
  public name: string = "AddProjectPlanCutoffNoticeSentAt1799400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "planCutoffNoticeSentAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "planCutoffNoticeSentAt"`,
    );
  }
}
