import { MigrationInterface, QueryRunner } from "typeorm";

export class AddServiceLevelObjectiveRequestFilter1809179600000
  implements MigrationInterface
{
  public name: string = "AddServiceLevelObjectiveRequestFilter1809179600000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjective" ADD "requestFilter" character varying(500)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ServiceLevelObjective" DROP COLUMN "requestFilter"`,
    );
  }
}
