import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class AddLogSavedView1772355000000 implements MigrationInterface {
  public name = "AddLogSavedView1772355000000";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "LogSavedView" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "name" character varying(100) NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "query" jsonb NOT NULL, "columns" jsonb NOT NULL DEFAULT '[]', "sortField" character varying(100), "sortOrder" character varying(100), "pageSize" integer NOT NULL DEFAULT '100', "isDefault" boolean NOT NULL DEFAULT false, CONSTRAINT "PK_b1d3249a8cce9f7168bded6d55a" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_56e1d744839c4e59c50de300a9" ON "LogSavedView" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_80241afbecf0a3749cc775f93f" ON "LogSavedView" ("isDefault") `,
    );
    await queryRunner.query(
      `ALTER TABLE "LogSavedView" ADD CONSTRAINT "FK_56e1d744839c4e59c50de300a9d" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogSavedView" ADD CONSTRAINT "FK_fa55f4b8cb6e6ce31554b7b021f" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogSavedView" ADD CONSTRAINT "FK_8bd2b62c5f269dc8b2c74da0f27" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "LogSavedView" DROP CONSTRAINT "FK_8bd2b62c5f269dc8b2c74da0f27"`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogSavedView" DROP CONSTRAINT "FK_fa55f4b8cb6e6ce31554b7b021f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "LogSavedView" DROP CONSTRAINT "FK_56e1d744839c4e59c50de300a9d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_80241afbecf0a3749cc775f93f"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_56e1d744839c4e59c50de300a9"`,
    );
    await queryRunner.query(`DROP TABLE "LogSavedView"`);
  }
}
