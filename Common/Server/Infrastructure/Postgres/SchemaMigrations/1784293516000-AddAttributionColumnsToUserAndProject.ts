import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAttributionColumnsToUserAndProject1784293516000
  implements MigrationInterface
{
  public name: string = "AddAttributionColumnsToUserAndProject1784293516000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "User" ADD "clickIds" jsonb`);
    await queryRunner.query(
      `ALTER TABLE "User" ADD "firstTouchAttribution" jsonb`,
    );
    await queryRunner.query(`ALTER TABLE "Project" ADD "clickIds" jsonb`);
    await queryRunner.query(
      `ALTER TABLE "Project" ADD "firstTouchAttribution" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Project" DROP COLUMN "firstTouchAttribution"`,
    );
    await queryRunner.query(`ALTER TABLE "Project" DROP COLUMN "clickIds"`);
    await queryRunner.query(
      `ALTER TABLE "User" DROP COLUMN "firstTouchAttribution"`,
    );
    await queryRunner.query(`ALTER TABLE "User" DROP COLUMN "clickIds"`);
  }
}
