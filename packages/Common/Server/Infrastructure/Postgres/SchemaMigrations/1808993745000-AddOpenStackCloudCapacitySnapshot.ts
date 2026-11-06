import { MigrationInterface, QueryRunner } from "typeorm";

export class AddOpenStackCloudCapacitySnapshot1808993745000
  implements MigrationInterface
{
  public name: string = "AddOpenStackCloudCapacitySnapshot1808993745000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OpenStackCloud" ADD "capacitySnapshot" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OpenStackCloud" DROP COLUMN "capacitySnapshot"`,
    );
  }
}
