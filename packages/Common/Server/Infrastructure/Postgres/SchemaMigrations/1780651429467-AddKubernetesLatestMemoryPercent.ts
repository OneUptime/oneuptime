import { MigrationInterface, QueryRunner } from "typeorm";

export class AddKubernetesLatestMemoryPercent1780651429467
  implements MigrationInterface
{
  public name = "AddKubernetesLatestMemoryPercent1780651429467";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" ADD "latestMemoryPercent" numeric`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "KubernetesResource" DROP COLUMN "latestMemoryPercent"`,
    );
  }
}
