import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1743186793413 implements MigrationInterface {
  public name = "MigrationName1743186793413";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9bfee6c29045d1c236d9395f65"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Monitor" DROP COLUMN "incomingRequestReceivedAt"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Monitor" ADD "incomingRequestReceivedAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9bfee6c29045d1c236d9395f65" ON "Monitor" ("incomingRequestReceivedAt") `,
    );
  }
}
