import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1731433043136 implements MigrationInterface {
  public name = "MigrationName1731433043136";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5218e92f700d91afe6a8db79cb"`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_5218e92f700d91afe6a8db79cb" ON "Incident" ("rootCause") `,
    );
  }
}
