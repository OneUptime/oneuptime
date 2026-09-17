import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1718188920011 implements MigrationInterface {
  public name = "MigrationName1718188920011";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CodeRepository" ADD "mainBranchName" character varying(100) NOT NULL DEFAULT 'master'`,
    );
    await queryRunner.query(
      `ALTER TABLE "CodeRepository" ADD "repositoryHostedAt" character varying(100) NOT NULL DEFAULT 'GitHub'`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "CodeRepository" DROP COLUMN "repositoryHostedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "CodeRepository" DROP COLUMN "mainBranchName"`,
    );
  }
}
