import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPerformanceIndexes1779392970424 implements MigrationInterface {
  public name: string = "AddPerformanceIndexes1779392970424";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Active-X badge counters on the dashboard.
    await queryRunner.query(
      `CREATE INDEX "IDX_d846ce00a02d1073efc07178fa" ON "Incident" ("projectId", "currentIncidentStateId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_0c7286dfa90fd7d8201ec6f217" ON "Alert" ("projectId", "currentAlertStateId") `,
    );

    // Alert filtering by monitor (monitor detail page).
    await queryRunner.query(
      `CREATE INDEX "IDX_b57071fc2f1e27430e651382ee" ON "Alert" ("monitorId") `,
    );

    // Notification log tables: filter by project + status / time range.
    await queryRunner.query(
      `CREATE INDEX "IDX_8a0f032f20cd845c9bb908f38c" ON "CallLog" ("projectId", "status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_b59ee5f702882c10066cdd1128" ON "CallLog" ("projectId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_8f4eea9e7f20eaf121625f5787" ON "EmailLog" ("projectId", "status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_33d38c24249a256f89001acf83" ON "EmailLog" ("projectId", "createdAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c37d2fcfcb591afb284dad27d9" ON "SmsLog" ("projectId", "status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_c6bbede6b3bb66781bc7c82463" ON "SmsLog" ("projectId", "createdAt") `,
    );

    // Feed timelines on alert/incident/monitor detail pages.
    await queryRunner.query(
      `CREATE INDEX "IDX_6f97cb7c189e6339cf364a3608" ON "AlertFeed" ("alertId", "postedAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_e26bf84ec503bbfb06bcde139e" ON "IncidentFeed" ("incidentId", "postedAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_5771fc57305fb0f508153b53ce" ON "MonitorFeed" ("monitorId", "postedAt") `,
    );

    // Monitor probe scheduler.
    await queryRunner.query(
      `CREATE INDEX "IDX_4bf4109d325af5e5b5a5665bc7" ON "MonitorProbe" ("probeId", "isEnabled", "nextPingAt") `,
    );

    // On-call duty time logs (active-on-call lookups).
    await queryRunner.query(
      `CREATE INDEX "IDX_43da7ffeee531e9452d36a89ba" ON "OnCallDutyPolicyTimeLog" ("userId") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_977d907fb45cbc1a2067f490af" ON "OnCallDutyPolicyTimeLog" ("startsAt") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_002727a958120be971790fd016" ON "OnCallDutyPolicyTimeLog" ("endsAt") `,
    );

    // Telemetry exceptions dashboard.
    await queryRunner.query(
      `CREATE INDEX "IDX_fa102ae5073b428e514cc2ceea" ON "TelemetryException" ("occuranceCount") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3836772be478de8a9df86a938d" ON "TelemetryException" ("projectId", "isResolved", "isArchived") `,
    );

    // Status page subscriber dedupe.
    await queryRunner.query(
      `CREATE INDEX "IDX_c28628545faa67976e1d462e69" ON "StatusPageSubscriber" ("statusPageId", "subscriberPhone") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_3a2d83fc5107c639d10a7c5cc0" ON "StatusPageSubscriber" ("statusPageId", "subscriberEmail") `,
    );

    // Worker sweeps.
    await queryRunner.query(
      `CREATE INDEX "IDX_094b044a3d6a79695ba754cdfb" ON "UserOnCallLog" ("status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_7a5dc4760803e57f2d0b363e6e" ON "WorkflowLog" ("workflowStatus", "createdAt") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "public"."IDX_7a5dc4760803e57f2d0b363e6e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_094b044a3d6a79695ba754cdfb"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3a2d83fc5107c639d10a7c5cc0"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c28628545faa67976e1d462e69"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_3836772be478de8a9df86a938d"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_fa102ae5073b428e514cc2ceea"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_002727a958120be971790fd016"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_977d907fb45cbc1a2067f490af"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_43da7ffeee531e9452d36a89ba"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_4bf4109d325af5e5b5a5665bc7"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_5771fc57305fb0f508153b53ce"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_e26bf84ec503bbfb06bcde139e"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_6f97cb7c189e6339cf364a3608"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c6bbede6b3bb66781bc7c82463"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_c37d2fcfcb591afb284dad27d9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_33d38c24249a256f89001acf83"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8f4eea9e7f20eaf121625f5787"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b59ee5f702882c10066cdd1128"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_8a0f032f20cd845c9bb908f38c"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_b57071fc2f1e27430e651382ee"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_0c7286dfa90fd7d8201ec6f217"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_d846ce00a02d1073efc07178fa"`,
    );
  }
}
