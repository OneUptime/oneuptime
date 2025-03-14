import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1741957080431 implements MigrationInterface {
  public name = "MigrationName1741957080431";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLog" ADD "overridedByUserId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLog" ADD CONSTRAINT "FK_702b8c74c8f0d7fb220bc407776" FOREIGN KEY ("overridedByUserId") REFERENCES "User"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLog" DROP CONSTRAINT "FK_702b8c74c8f0d7fb220bc407776"`,
    );
    await queryRunner.query(
      `ALTER TABLE "UserOnCallLog" DROP COLUMN "overridedByUserId"`,
    );
  }
}
