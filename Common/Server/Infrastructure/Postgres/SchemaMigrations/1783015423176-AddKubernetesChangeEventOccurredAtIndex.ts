import { MigrationInterface, QueryRunner } from "typeorm";

export class AddKubernetesChangeEventOccurredAtIndex1783015423176
  implements MigrationInterface
{
  public name = "AddKubernetesChangeEventOccurredAtIndex1783015423176";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_3457d14491254bf0247d2575ec" ON "KubernetesResourceChangeEvent" ("occurredAt") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3457d14491254bf0247d2575ec"`,
    );
  }
}
