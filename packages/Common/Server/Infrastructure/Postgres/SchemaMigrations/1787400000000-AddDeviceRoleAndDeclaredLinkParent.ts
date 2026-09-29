import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Two nullable columns, both of them an operator stating something the
 * network cannot be asked:
 *
 *   NetworkDevice.deviceRole      — what this box actually is, for devices
 *                                   with no SNMP identity to classify.
 *   NetworkDeviceLink.parentDeviceId — which end of a declared link is up.
 *
 * Nullable on purpose, with no backfill. NULL is a meaningful value in
 * both cases and it is the value every existing row should hold: no role
 * override (so the classifier keeps deciding) and no declared hierarchy
 * (so the map keeps inferring one). Defaulting either would silently
 * restate every device and every link in every project as something an
 * operator had chosen, which is the one thing neither column may mean.
 */
export class AddDeviceRoleAndDeclaredLinkParent1787400000000
  implements MigrationInterface
{
  public name = "AddDeviceRoleAndDeclaredLinkParent1787400000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" ADD "deviceRole" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLink" ADD "parentDeviceId" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_01752cd47b773df38b4a54ae53" ON "NetworkDeviceLink" ("parentDeviceId") `,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLink" ADD CONSTRAINT "FK_01752cd47b773df38b4a54ae539" FOREIGN KEY ("parentDeviceId") REFERENCES "NetworkDevice"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLink" DROP CONSTRAINT "FK_01752cd47b773df38b4a54ae539"`,
    );
    await queryRunner.query(
      `DROP INDEX "public"."IDX_01752cd47b773df38b4a54ae53"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDeviceLink" DROP COLUMN "parentDeviceId"`,
    );
    await queryRunner.query(
      `ALTER TABLE "NetworkDevice" DROP COLUMN "deviceRole"`,
    );
  }
}
