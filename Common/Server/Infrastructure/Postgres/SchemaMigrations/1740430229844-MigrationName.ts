import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1740430229844 implements MigrationInterface {
  public name = "MigrationName1740430229844";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" ADD "triggeredByUserId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" ADD CONSTRAINT "FK_0ed55adc637e8ed7a524f942b18" FOREIGN KEY ("triggeredByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" DROP CONSTRAINT "FK_0ed55adc637e8ed7a524f942b18"`,
    );
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" DROP COLUMN "triggeredByUserId"`,
    );
  }
}
