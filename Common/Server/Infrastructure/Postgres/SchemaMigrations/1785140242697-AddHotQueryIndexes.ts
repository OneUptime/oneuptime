import { MigrationInterface, QueryRunner } from "typeorm";

export class AddHotQueryIndexes1785140242697 implements MigrationInterface {
  public name = "AddHotQueryIndexes1785140242697";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "IDX_ff92577021975c63c570943872" ON "Monitor" ("monitorType") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_de21b5271b886e528ca36388be" ON "IncidentEpisode" ("subscriberNotificationStatusOnEpisodeCreated") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0a33db54e9454945d865a6461b" ON "Incident" ("subscriberNotificationStatusOnIncidentCreated") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1319bc680d15900efa8f2caac6" ON "Incident" ("subscriberNotificationStatusOnPostmortemPublished") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_33865d2e485cb1b63cf6cb8b67" ON "ScheduledMaintenance" ("subscriberNotificationStatusOnEventScheduled") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_1d37348eb2a0eab9ab6b739e1b" ON "StatusPageAnnouncement" ("subscriberNotificationStatus") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_90c4580b2ad6fe6611f58975f7" ON "IncidentPublicNote" ("subscriberNotificationStatusOnNoteCreated") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b64685d3d7303e1b62477b729e" ON "IncidentStateTimeline" ("subscriberNotificationStatus") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c75caf0b6a8d66a7c64975c015" ON "OnCallDutyPolicyExecutionLog" ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_13813da8afd9f7b4f3bdc27e68" ON "ScheduledMaintenancePublicNote" ("subscriberNotificationStatusOnNoteCreated") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_ae269b43b4d03e69ee3176477c" ON "ScheduledMaintenanceStateTimeline" ("subscriberNotificationStatus") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_203246e9d08f4673386512ca29" ON "IncidentEpisodeStateTimeline" ("subscriberNotificationStatus") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e8b681595d105b37012921df1b" ON "IncidentEpisodePublicNote" ("subscriberNotificationStatusOnNoteCreated") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e8b681595d105b37012921df1b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_203246e9d08f4673386512ca29"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ae269b43b4d03e69ee3176477c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_13813da8afd9f7b4f3bdc27e68"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c75caf0b6a8d66a7c64975c015"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b64685d3d7303e1b62477b729e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_90c4580b2ad6fe6611f58975f7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1d37348eb2a0eab9ab6b739e1b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_33865d2e485cb1b63cf6cb8b67"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_1319bc680d15900efa8f2caac6"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0a33db54e9454945d865a6461b"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_de21b5271b886e528ca36388be"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_ff92577021975c63c570943872"`,
    );
  }
}
