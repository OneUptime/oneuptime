import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1786551733814 implements MigrationInterface {
  public name: string = "MigrationName1786551733814";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "TelemetryEntity" ADD "source" character varying(100) NOT NULL DEFAULT 'discovered'`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryEntity" ADD "description" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryEntityRelationship" ADD "source" character varying(100) NOT NULL DEFAULT 'discovered'`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8106b1d6443d982b12e3318318" ON "TelemetryEntity" ("source") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_26ea726e2ee8fa622348581ac1" ON "TelemetryEntityRelationship" ("source") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_26ea726e2ee8fa622348581ac1"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8106b1d6443d982b12e3318318"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryEntityRelationship" DROP COLUMN "source"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryEntity" DROP COLUMN "description"`,
    );
    await queryRunner.query(
      `ALTER TABLE "TelemetryEntity" DROP COLUMN "source"`,
    );
  }
}
