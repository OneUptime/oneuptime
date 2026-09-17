import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1718203144945 implements MigrationInterface {
  public name = "MigrationName1718203144945";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CodeRepository" ADD "organizationName" character varying(100) NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "CodeRepository" ADD "repositoryName" character varying(100) NOT NULL`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CodeRepository" DROP COLUMN "repositoryName"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CodeRepository" DROP COLUMN "organizationName"`,
    );
  }
}
