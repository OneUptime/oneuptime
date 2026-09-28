import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * ProxmoxResource."isNativePush": the row comes from Proxmox VE's built-in
 * OpenTelemetry push, where each node reports only itself, rather than from
 * the Proxmox Agent. Nullable with no default: every existing row reads as
 * not native (NULL), which keeps the prune it already had, and the next push
 * of a native-push cluster sets it. It lets a native-push node that goes
 * quiet stay in the inventory — and be reported Offline by the nodes still
 * alive — for the retention window instead of being pruned after 15 minutes.
 */
export class AddProxmoxResourceIsNativePush1796100000000
  implements MigrationInterface
{
  public name: string = "AddProxmoxResourceIsNativePush1796100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" ADD "isNativePush" boolean`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" DROP COLUMN "isNativePush"`,
    );
  }
}
