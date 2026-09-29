import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1764324618043 implements MigrationInterface {
  public name = "MigrationName1764324618043";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Incident" ADD "declaredAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `UPDATE "Incident" SET "declaredAt" = "createdAt" WHERE "declaredAt" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" ALTER COLUMN "declaredAt" SET DEFAULT now()`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" ALTER COLUMN "declaredAt" SET NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b26979b9f119310661734465a4" ON "Incident" ("declaredAt") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b26979b9f119310661734465a4"`,
    );
    await queryRunner.query(`ALTER TABLE "Incident" DROP COLUMN "declaredAt"`);
  }
}
