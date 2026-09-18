import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1765801357168 implements MigrationInterface {
  public name = "MigrationName1765801357168";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogCodeRepository" ADD "enableAutomaticImprovements" boolean NOT NULL DEFAULT true`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogCodeRepository" ADD "maxOpenPullRequests" integer NOT NULL DEFAULT 3`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogCodeRepository" ADD "restrictedImprovementActions" jsonb`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogCodeRepository" DROP COLUMN "restrictedImprovementActions"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogCodeRepository" DROP COLUMN "maxOpenPullRequests"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ServiceCatalogCodeRepository" DROP COLUMN "enableAutomaticImprovements"`,
    );
  }
}
