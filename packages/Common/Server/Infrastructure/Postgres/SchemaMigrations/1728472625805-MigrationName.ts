import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1728472625805 implements MigrationInterface {
  public name = "MigrationName1728472625805";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPageDomain" ADD "customCertificate" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageDomain" ADD "customCertificateKey" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageDomain" ADD "isCustomCertificate" boolean NOT NULL DEFAULT false`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "StatusPageDomain" DROP COLUMN "isCustomCertificate"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageDomain" DROP COLUMN "customCertificateKey"`,
    );
    await queryRunner.query(
      `ALTER TABLE "StatusPageDomain" DROP COLUMN "customCertificate"`,
    );
  }
}
