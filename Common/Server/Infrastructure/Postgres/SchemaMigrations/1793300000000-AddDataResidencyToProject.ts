import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Project.dataResidency: a free-text label a master admin sets on a SaaS
 * project to record where its data lives, shown to the customer in Project
 * Settings once set.
 *
 * - Nullable with no default. NULL is "not set", which is what every existing
 *   project is, and what keeps the row hidden in the customer's settings.
 */
export class AddDataResidencyToProject1793300000000
  implements MigrationInterface
{
  public name: string = "AddDataResidencyToProject1793300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "dataResidency" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "dataResidency"`,
    );
  }
}
