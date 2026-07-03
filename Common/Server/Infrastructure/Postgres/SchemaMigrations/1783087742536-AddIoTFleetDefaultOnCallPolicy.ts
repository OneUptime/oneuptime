import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * IoTFleet.defaultOnCallDutyPolicyId — on-call policy attached by
 * default to alert templates created for the fleet, so
 * out-of-the-box IoT alerts page someone instead of defaulting to
 * nobody.
 */
export class AddIoTFleetDefaultOnCallPolicy1783087742536
  implements MigrationInterface
{
  public name = "AddIoTFleetDefaultOnCallPolicy1783087742536";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IoTFleet" ADD "defaultOnCallDutyPolicyId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleet" ADD CONSTRAINT "FK_b48947d8b40e58bf9ad9a83a087" FOREIGN KEY ("defaultOnCallDutyPolicyId") REFERENCES "OnCallDutyPolicy"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "IoTFleet" DROP CONSTRAINT "FK_b48947d8b40e58bf9ad9a83a087"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IoTFleet" DROP COLUMN "defaultOnCallDutyPolicyId"`,
    );
  }
}
