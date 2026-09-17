import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMonitorTemplate1777201966799 implements MigrationInterface {
  public name: string = "AddMonitorTemplate1777201966799";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "MonitorTemplate" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "templateName" character varying(100) NOT NULL, "templateDescription" character varying(500) NOT NULL, "slug" character varying(100) NOT NULL, "monitorName" character varying(100) NOT NULL, "monitorDescription" character varying(500), "monitorType" character varying(100) NOT NULL, "monitorSteps" jsonb, "monitoringInterval" character varying(100), "customFields" jsonb, "minimumProbeAgreement" integer, "createdByUserId" uuid, "deletedByUserId" uuid, CONSTRAINT "UQ_44d0705ce05869f58c0cca19768" UNIQUE ("slug"), CONSTRAINT "PK_aa127d91863993490d4b78d0b40" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_4f4c83113c33f5679717153ae6" ON "MonitorTemplate" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_d2104dfbd9d812c1ffec4331a3" ON "MonitorTemplate" ("templateName") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_44d0705ce05869f58c0cca1976" ON "MonitorTemplate" ("slug") `,
    );
    await queryRunner.query(
      `CREATE TABLE "MonitorTemplateLabel" ("monitorTemplateId" uuid NOT NULL, "labelId" uuid NOT NULL, CONSTRAINT "PK_cb5b139e80d4b03cf1b5fbf6871" PRIMARY KEY ("monitorTemplateId", "labelId"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0185217ee7d17f6acb7614ee2d" ON "MonitorTemplateLabel" ("monitorTemplateId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_fd0a5f48cc316d45c79fb31f37" ON "MonitorTemplateLabel" ("labelId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorTemplate" ADD CONSTRAINT "FK_4f4c83113c33f5679717153ae66" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorTemplate" ADD CONSTRAINT "FK_c137132ee431237b4fd12c3fcb6" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorTemplate" ADD CONSTRAINT "FK_1ae8af32297ba8e1b9a2c03b38f" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorTemplateLabel" ADD CONSTRAINT "FK_0185217ee7d17f6acb7614ee2d3" FOREIGN KEY ("monitorTemplateId") REFERENCES "MonitorTemplate"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorTemplateLabel" ADD CONSTRAINT "FK_fd0a5f48cc316d45c79fb31f37b" FOREIGN KEY ("labelId") REFERENCES "Label"("_id") ON DELETE CASCADE ON UPDATE CASCADE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "MonitorTemplateLabel" DROP CONSTRAINT "FK_fd0a5f48cc316d45c79fb31f37b"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorTemplateLabel" DROP CONSTRAINT "FK_0185217ee7d17f6acb7614ee2d3"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorTemplate" DROP CONSTRAINT "FK_1ae8af32297ba8e1b9a2c03b38f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorTemplate" DROP CONSTRAINT "FK_c137132ee431237b4fd12c3fcb6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorTemplate" DROP CONSTRAINT "FK_4f4c83113c33f5679717153ae66"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fd0a5f48cc316d45c79fb31f37"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0185217ee7d17f6acb7614ee2d"`,
    );
    await queryRunner.query(`DROP TABLE "MonitorTemplateLabel"`);
    await queryRunner.query(
      `DROP INDEX "public"."IDX_44d0705ce05869f58c0cca1976"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d2104dfbd9d812c1ffec4331a3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4f4c83113c33f5679717153ae6"`,
    );
    await queryRunner.query(`DROP TABLE "MonitorTemplate"`);
  }
}
