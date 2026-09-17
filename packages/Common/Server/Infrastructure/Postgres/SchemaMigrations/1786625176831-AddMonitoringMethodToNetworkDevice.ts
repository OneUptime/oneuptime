import { MigrationInterface, QueryRunner } from "typeorm";

export class AddMonitoringMethodToNetworkDevice1786625176831
  implements MigrationInterface
{
  public name: string = "AddMonitoringMethodToNetworkDevice1786625176831";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD "monitoringMethod" character varying(100) DEFAULT 'SNMP'`,
    );
    await queryRunner.query(`ALTER TABLE "NetworkDevice" ADD "monitorId" uuid`);
    await queryRunner.query(
      `CREATE INDEX "IDX_dfad846062f455bf09d918a8eb" ON "NetworkDevice" ("monitorId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD CONSTRAINT "FK_dfad846062f455bf09d918a8eb9" FOREIGN KEY ("monitorId") REFERENCES "Monitor"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP CONSTRAINT "FK_dfad846062f455bf09d918a8eb9"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_dfad846062f455bf09d918a8eb"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP COLUMN "monitorId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP COLUMN "monitoringMethod"`,
    );
  }
}
