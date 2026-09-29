import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1743530326936 implements MigrationInterface {
  public name = "MigrationName1743530326936";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicySchedule" ADD "currentUserIdOnRoster" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicySchedule" ADD "nextUserIdOnRoster" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicySchedule" ADD "rosterNextHandoffAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ADD "nextUserIdOnLayer" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ADD "layerNextHandoffAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicySchedule" ADD CONSTRAINT "FK_49ffa461b854ad28bebd3661db5" FOREIGN KEY ("currentUserIdOnRoster") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicySchedule" ADD CONSTRAINT "FK_775f3837d5094d9d8f433596238" FOREIGN KEY ("nextUserIdOnRoster") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" ADD CONSTRAINT "FK_815023b155d367f28cc6855b843" FOREIGN KEY ("nextUserIdOnLayer") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" DROP CONSTRAINT "FK_815023b155d367f28cc6855b843"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicySchedule" DROP CONSTRAINT "FK_775f3837d5094d9d8f433596238"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicySchedule" DROP CONSTRAINT "FK_49ffa461b854ad28bebd3661db5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" DROP COLUMN "layerNextHandoffAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyScheduleLayer" DROP COLUMN "nextUserIdOnLayer"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicySchedule" DROP COLUMN "rosterNextHandoffAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicySchedule" DROP COLUMN "nextUserIdOnRoster"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicySchedule" DROP COLUMN "currentUserIdOnRoster"`,
    );
  }
}
