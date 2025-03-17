import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1736365532085 implements MigrationInterface {
  public name = "MigrationName1736365532085";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "ScheduledMaintenanceLog" ("_id" uuid NOT NULL DEFAULT uuid_generate_v4(), "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "deletedAt" TIMESTAMP WITH TIME ZONE, "version" integer NOT NULL, "projectId" uuid NOT NULL, "scheduledMaintenanceId" uuid NOT NULL, "createdByUserId" uuid, "deletedByUserId" uuid, "logInMarkdown" text NOT NULL, "moreInformationInMarkdown" text NOT NULL, "scheduledMaintenanceLogEvent" character varying NOT NULL, CONSTRAINT "PK_27b89f28bf48418fabba9a1ea14" PRIMARY KEY ("_id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_9239de1ee33f9505c30f255a99" ON "ScheduledMaintenanceLog" ("projectId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_58e403ba261dfa94addb5f04d3" ON "ScheduledMaintenanceLog" ("scheduledMaintenanceId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceLog" ADD CONSTRAINT "FK_9239de1ee33f9505c30f255a994" FOREIGN KEY ("projectId") REFERENCES "Project"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceLog" ADD CONSTRAINT "FK_58e403ba261dfa94addb5f04d36" FOREIGN KEY ("scheduledMaintenanceId") REFERENCES "ScheduledMaintenance"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceLog" ADD CONSTRAINT "FK_9152528e4f7f59adaba3e9bc41f" FOREIGN KEY ("createdByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceLog" ADD CONSTRAINT "FK_a957f435d1504f41808f20a2c45" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceLog" DROP CONSTRAINT "FK_a957f435d1504f41808f20a2c45"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceLog" DROP CONSTRAINT "FK_9152528e4f7f59adaba3e9bc41f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceLog" DROP CONSTRAINT "FK_58e403ba261dfa94addb5f04d36"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceLog" DROP CONSTRAINT "FK_9239de1ee33f9505c30f255a994"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_58e403ba261dfa94addb5f04d3"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9239de1ee33f9505c30f255a99"`,
    );
    await queryRunner.query(`DROP TABLE "ScheduledMaintenanceLog"`);
  }
}
