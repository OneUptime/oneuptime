import { MigrationInterface, QueryRunner } from "typeorm";

export class MigrationName1737129427011 implements MigrationInterface {
    public name = 'MigrationName1737129427011'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" ADD "triggeredByAlertId" uuid NOT NULL`);
        await queryRunner.query(`ALTER TABLE "UserOnCallLog" ADD "triggeredByAlertId" uuid NOT NULL`);
        await queryRunner.query(`ALTER TABLE "UserOnCallLogTimeline" ADD "triggeredByAlertId" uuid NOT NULL`);
        await queryRunner.query(`CREATE INDEX "IDX_30358ab25e4c6c9ad72e74f201" ON "OnCallDutyPolicyExecutionLogTimeline" ("triggeredByAlertId") `);
        await queryRunner.query(`CREATE INDEX "IDX_42d9916277fcbefa0cdd3904c6" ON "UserOnCallLogTimeline" ("triggeredByAlertId") `);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" ADD CONSTRAINT "FK_30358ab25e4c6c9ad72e74f201c" FOREIGN KEY ("triggeredByAlertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "UserOnCallLog" ADD CONSTRAINT "FK_0ee3711cdc64957845d9d028c31" FOREIGN KEY ("triggeredByAlertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "UserOnCallLogTimeline" ADD CONSTRAINT "FK_42d9916277fcbefa0cdd3904c63" FOREIGN KEY ("triggeredByAlertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "UserOnCallLogTimeline" DROP CONSTRAINT "FK_42d9916277fcbefa0cdd3904c63"`);
        await queryRunner.query(`ALTER TABLE "UserOnCallLog" DROP CONSTRAINT "FK_0ee3711cdc64957845d9d028c31"`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" DROP CONSTRAINT "FK_30358ab25e4c6c9ad72e74f201c"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_42d9916277fcbefa0cdd3904c6"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_30358ab25e4c6c9ad72e74f201"`);
        await queryRunner.query(`ALTER TABLE "UserOnCallLogTimeline" DROP COLUMN "triggeredByAlertId"`);
        await queryRunner.query(`ALTER TABLE "UserOnCallLog" DROP COLUMN "triggeredByAlertId"`);
        await queryRunner.query(`ALTER TABLE "OnCallDutyPolicyExecutionLogTimeline" DROP COLUMN "triggeredByAlertId"`);
    }

}
