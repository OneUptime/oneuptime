import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAutoProvisionedNetworkDeviceMonitors1789600000000
  implements MigrationInterface
{
  public name: string = "AddAutoProvisionedNetworkDeviceMonitors1789600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "Monitor" ADD "autoProvisionedNetworkDeviceId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceAutoImportRule" ADD "monitorTemplateId" uuid`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_monitor_auto_provisioned_device_template_unique" ON "Monitor" ("autoProvisionedNetworkDeviceId", "monitorTemplateId") WHERE "deletedAt" IS NULL AND "autoProvisionedNetworkDeviceId" IS NOT NULL AND "monitorTemplateId" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_network_device_auto_import_rule_monitorTemplateId" ON "NetworkDeviceAutoImportRule" ("monitorTemplateId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "Monitor" ADD CONSTRAINT "FK_monitor_auto_provisioned_network_device" FOREIGN KEY ("autoProvisionedNetworkDeviceId") REFERENCES "NetworkDevice"("_id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceAutoImportRule" ADD CONSTRAINT "FK_nd_auto_import_rule_monitorTemplateId" FOREIGN KEY ("monitorTemplateId") REFERENCES "MonitorTemplate"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceAutoImportRule" DROP CONSTRAINT "FK_nd_auto_import_rule_monitorTemplateId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Monitor" DROP CONSTRAINT "FK_monitor_auto_provisioned_network_device"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_network_device_auto_import_rule_monitorTemplateId"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_monitor_auto_provisioned_device_template_unique"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceAutoImportRule" DROP COLUMN "monitorTemplateId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Monitor" DROP COLUMN "autoProvisionedNetworkDeviceId"`,
    );
  }
}
