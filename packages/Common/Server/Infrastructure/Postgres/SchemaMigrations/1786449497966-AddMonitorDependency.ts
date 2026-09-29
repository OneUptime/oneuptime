import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMonitorDependency1786449497966 implements MigrationInterface {
  public name = "AddMonitorDependency1786449497966";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "MonitorDependency" ("monitorId" uuid NOT NULL, "dependsOnMonitorId" uuid NOT NULL, CONSTRAINT "PK_26790391f134c5a87b2aa70a902" PRIMARY KEY ("monitorId", "dependsOnMonitorId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_953533a93dba2f345283474c60" ON "MonitorDependency" ("monitorId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_43f849731e1bda0ada73b3d887" ON "MonitorDependency" ("dependsOnMonitorId") `,
    );
    await queryRunner.query(
      `CREATE TABLE "MonitorDependencySuppressionStatus" ("monitorId" uuid NOT NULL, "monitorStatusId" uuid NOT NULL, CONSTRAINT "PK_2889f58c301e8a07d46dd82382c" PRIMARY KEY ("monitorId", "monitorStatusId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_747378c59669e4639c4209adc7" ON "MonitorDependencySuppressionStatus" ("monitorId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_354bf0c679a6dfd64910eb6441" ON "MonitorDependencySuppressionStatus" ("monitorStatusId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorDependency" ADD CONSTRAINT "FK_953533a93dba2f345283474c60f" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorDependency" ADD CONSTRAINT "FK_43f849731e1bda0ada73b3d8874" FOREIGN KEY ("dependsOnMonitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorDependencySuppressionStatus" ADD CONSTRAINT "FK_747378c59669e4639c4209adc78" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorDependencySuppressionStatus" ADD CONSTRAINT "FK_354bf0c679a6dfd64910eb64418" FOREIGN KEY ("monitorStatusId") REFERENCES "MonitorStatus"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "MonitorDependencySuppressionStatus" DROP CONSTRAINT "FK_354bf0c679a6dfd64910eb64418"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorDependencySuppressionStatus" DROP CONSTRAINT "FK_747378c59669e4639c4209adc78"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorDependency" DROP CONSTRAINT "FK_43f849731e1bda0ada73b3d8874"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorDependency" DROP CONSTRAINT "FK_953533a93dba2f345283474c60f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_354bf0c679a6dfd64910eb6441"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_747378c59669e4639c4209adc7"`,
    );
    await queryRunner.query(`DROP TABLE "MonitorDependencySuppressionStatus"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_43f849731e1bda0ada73b3d887"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_953533a93dba2f345283474c60"`,
    );
    await queryRunner.query(`DROP TABLE "MonitorDependency"`);
  }
}
