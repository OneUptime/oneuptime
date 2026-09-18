import { MigrationInterface, QueryRunner } from "typeorm";

export class AddAutoImportRuleOidTemplate1790600000000
  implements MigrationInterface
{
  public name: string = "AddAutoImportRuleOidTemplate1790600000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceAutoImportRule" ADD "oidTemplateId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceAutoImportRule" ADD CONSTRAINT "FK_022aca601b5a2ce29cf82f9ba25" FOREIGN KEY ("oidTemplateId") REFERENCES "NetworkDeviceOidTemplate"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceAutoImportRule" DROP CONSTRAINT "FK_022aca601b5a2ce29cf82f9ba25"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceAutoImportRule" DROP COLUMN "oidTemplateId"`,
    );
  }
}
