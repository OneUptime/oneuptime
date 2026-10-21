import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Two ProxmoxResource columns for Proxmox VE's built-in OpenTelemetry push,
 * where each node reports only itself:
 *
 * - "isNativePush": the row comes from the native push rather than the
 *   Proxmox Agent. Such a Node row is kept — and reported Offline by the
 *   nodes still alive — for the retention window instead of being pruned
 *   after 15 minutes, because the native push carries no membership.
 * - "notReportingMarkedAt": when the nodes still alive last reported this
 *   node as having stopped reporting; cleared by its own next report. It
 *   lets those reports carry on through a short gap in OneUptime's own
 *   processing.
 *
 * Both nullable with no default: every existing row reads as an agent row
 * that was never reported down, which keeps the behaviour it already had,
 * and the next push of a native-push cluster sets them.
 */
export class AddProxmoxResourceNativePushColumns1796200000000
  implements MigrationInterface
{
  public name: string = "AddProxmoxResourceNativePushColumns1796200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" ADD "isNativePush" boolean`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" ADD "notReportingMarkedAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" DROP COLUMN "notReportingMarkedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" DROP COLUMN "isNativePush"`,
    );
  }
}
