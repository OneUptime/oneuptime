import { MigrationInterface, QueryRunner } from "typeorm";

export class AddLldpNeighborsToNetworkDevice1783750000000
  implements MigrationInterface
{
  public name = "AddLldpNeighborsToNetworkDevice1783750000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD "lldpNeighbors" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP COLUMN "lldpNeighbors"`,
    );
  }
}
