import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1731435514287 implements MigrationInterface {
  public name = "MigrationName1731435514287";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7db6b1a8fbbc9eb44c2e7f5047"`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_7db6b1a8fbbc9eb44c2e7f5047" ON "IncidentStateTimeline" ("rootCause") `,
    );
  }
}
