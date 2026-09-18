import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class MigrationName1741955609393 implements MigrationInterface {
  public name = "MigrationName1741955609393";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" RENAME COLUMN "twilioPhoneNumber" TO "twilioPrimaryPhoneNumber"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectCallSMSConfig" RENAME COLUMN "twilioPhoneNumber" TO "twilioPrimaryPhoneNumber"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" ADD "twilioSecondaryPhoneNumbers" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectCallSMSConfig" ADD "twilioSecondaryPhoneNumbers" character varying(500)`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ProjectCallSMSConfig" DROP COLUMN "twilioSecondaryPhoneNumbers"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" DROP COLUMN "twilioSecondaryPhoneNumbers"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProjectCallSMSConfig" RENAME COLUMN "twilioPrimaryPhoneNumber" TO "twilioPhoneNumber"`,
    );
    await queryRunner.query(
      `ALTER TABLE "GlobalConfig" RENAME COLUMN "twilioPrimaryPhoneNumber" TO "twilioPhoneNumber"`,
    );
  }
}
