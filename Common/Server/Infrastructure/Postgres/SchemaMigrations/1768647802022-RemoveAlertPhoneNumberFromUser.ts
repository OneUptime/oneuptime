import { MigrationInterface, QueryRunner } from "typeorm";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export class RemoveAlertPhoneNumberFromUser1768647802022
  implements MigrationInterface
{
  public name = "RemoveAlertPhoneNumberFromUser1768647802022";

  @CaptureSpan()
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "User" DROP COLUMN IF EXISTS "alertPhoneNumber"`,
    );
  }

  @CaptureSpan()
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "User" ADD "alertPhoneNumber" character varying(30)`,
    );
  }
}
