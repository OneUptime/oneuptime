import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1736675947746 implements MigrationInterface {
  public name = "MigrationName1736675947746";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Incident" ADD "incidentNumber" integer`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0eca9ce7d12a4c472386dfc781" ON "Incident" ("incidentNumber") `,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0eca9ce7d12a4c472386dfc781"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Incident" DROP COLUMN "incidentNumber"`,
    );
  }
}
