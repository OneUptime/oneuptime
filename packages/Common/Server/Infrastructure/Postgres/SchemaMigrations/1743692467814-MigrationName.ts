import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1743692467814 implements MigrationInterface {
  public name = "MigrationName1743692467814";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" DROP CONSTRAINT "FK_815023b155d367f28cc6855b843"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" DROP COLUMN "nextUserIdOnLayer"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" DROP COLUMN "layerNextHandoffAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicySchedule" ADD "rosterHandoffAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicySchedule" DROP COLUMN "rosterHandoffAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ADD "layerNextHandoffAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ADD "nextUserIdOnLayer" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ADD CONSTRAINT "FK_815023b155d367f28cc6855b843" FOREIGN KEY ("nextUserIdOnLayer") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }
}
