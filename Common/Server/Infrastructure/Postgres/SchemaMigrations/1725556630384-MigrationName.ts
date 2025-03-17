import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1725556630384 implements MigrationInterface {
  public name = "MigrationName1725556630384";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "BillingInvoice" ADD "invoiceDate" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "BillingInvoice" ADD "invoiceNumber" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "CopilotAction" ADD "statusChangedAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CopilotAction" DROP COLUMN "statusChangedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "BillingInvoice" DROP COLUMN "invoiceNumber"`,
    );
    await queryRunner.query(
      `ALTER TABLE "BillingInvoice" DROP COLUMN "invoiceDate"`,
    );
  }
}
