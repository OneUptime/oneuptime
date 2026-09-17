import { MigrationInterface, QueryRunner } from "typeorm";

export class AddHotQueryIndexesSecondPass1785148065137
  implements MigrationInterface
{
  public name: string = "AddHotQueryIndexesSecondPass1785148065137";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_9ba5449f967cce45bfa9f79d72" ON "StatusPageDomain" ("fullDomain") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ea265f709c2e27ba37c8c91bb7" ON "DashboardDomain" ("fullDomain") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_62a81ecebd87bb91860b8820ab" ON "StatusPage" ("sendNextReportBy") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c382913dd4288e74af031d7110" ON "OnCallDutyPolicySchedule" ("rosterHandoffAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_814e5dbdcf3b61f3ae43e1da10" ON "OnCallDutyPolicySchedule" ("rosterNextStartAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7d9ec527863baaeb823af7ef04" ON "WorkspaceNotificationSummary" ("nextSendAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_f799bfe4eeb42c29999e5df874" ON "ScheduledMaintenanceTemplate" ("scheduleNextEventAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_14ff60254ae31509cb2ceeb814" ON "NetworkSite" ("lastRollupAt") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_14ff60254ae31509cb2ceeb814"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_f799bfe4eeb42c29999e5df874"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7d9ec527863baaeb823af7ef04"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_814e5dbdcf3b61f3ae43e1da10"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c382913dd4288e74af031d7110"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_62a81ecebd87bb91860b8820ab"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ea265f709c2e27ba37c8c91bb7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_9ba5449f967cce45bfa9f79d72"`,
    );
  }
}
