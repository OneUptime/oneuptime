import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration, and numbered after the
 * last registered migration.
 *
 * ProxmoxResource.lastPowerTask* and powerTaskReadAt (#10017): a stopped
 * guest's last power task - the last task of its task log that started,
 * stopped, shut down, hibernated or restored it - as the Proxmox AI agent
 * reads it (Common/Utils/Proxmox/ProxmoxGuestPowerTask), so a guest that
 * should be running can say who or what stopped it, and when.
 *
 * Five nullable columns on an existing table, with no default, no index and
 * no key: adding them rewrites nothing and blocks nothing. Every guest has
 * none until the agent reads its task log, and says what it said before.
 */
export class AddProxmoxGuestPowerTask1809186941017
  implements MigrationInterface
{
  public name: string = "AddProxmoxGuestPowerTask1809186941017";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" ADD "lastPowerTaskType" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" ADD "lastPowerTaskUser" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" ADD "lastPowerTaskStatus" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" ADD "lastPowerTaskAt" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" ADD "powerTaskReadAt" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" DROP COLUMN "powerTaskReadAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" DROP COLUMN "lastPowerTaskAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" DROP COLUMN "lastPowerTaskStatus"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" DROP COLUMN "lastPowerTaskUser"`,
    );
    await queryRunner.query(
      `ALTER TABLE "ProxmoxResource" DROP COLUMN "lastPowerTaskType"`,
    );
  }
}
