import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1739210586538 implements MigrationInterface {
  public name = "MigrationName1739210586538";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "Alert" ADD "alertNumber" integer`);
    await queryRunner.query(
      `CREATE INDEX "IDX_aa91b2228a2b35424a3ae93fdc" ON "Alert" ("alertNumber") `,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_aa91b2228a2b35424a3ae93fdc"`,
    );
    await queryRunner.query(`ALTER TABLE "Alert" DROP COLUMN "alertNumber"`);
  }
}
