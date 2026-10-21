import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddArchiveToValues1805800000000, and moved into a migration of its own:
 * incidents, alerts, monitors and everything else that picks one of these
 * values reads the tables all the time, so each foreign key from the new
 * "archivedByUserId" column to "User" is added NOT VALID and then validated,
 * without blocking them. Every existing row's column is null, so the
 * validation finds nothing to refuse. Safe to run again after a stop part
 * way.
 */
export class AddArchiveToValuesUserKeys1805810000000
  implements MigrationInterface
{
  public name: string = "AddArchiveToValuesUserKeys1805810000000";

  // The validation runs outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "AlertSeverity" ADD CONSTRAINT "FK_68a480f89231ff24bc0dcd9fba9" FOREIGN KEY ("archivedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "IncidentSeverity" ADD CONSTRAINT "FK_1c523ebcb77b541cb035757081f" FOREIGN KEY ("archivedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "Label" ADD CONSTRAINT "FK_68b07db354428cfb32485b5d57c" FOREIGN KEY ("archivedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "MonitorStatus" ADD CONSTRAINT "FK_33d796695f6cbbf8e53c5f73ae0" FOREIGN KEY ("archivedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "IncidentRole" ADD CONSTRAINT "FK_8ca6cb493ab1babc8bb2e81fa6c" FOREIGN KEY ("archivedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "IncidentState" ADD CONSTRAINT "FK_138c8e28d687133cdfeda718728" FOREIGN KEY ("archivedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "AlertState" ADD CONSTRAINT "FK_e9edde48db8cf3deae6ad952bd2" FOREIGN KEY ("archivedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "ScheduledMaintenanceState" ADD CONSTRAINT "FK_45af43ba512b087b9bfb1df2eb5" FOREIGN KEY ("archivedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "ScheduledMaintenanceState" DROP CONSTRAINT "FK_45af43ba512b087b9bfb1df2eb5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertState" DROP CONSTRAINT "FK_e9edde48db8cf3deae6ad952bd2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentState" DROP CONSTRAINT "FK_138c8e28d687133cdfeda718728"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentRole" DROP CONSTRAINT "FK_8ca6cb493ab1babc8bb2e81fa6c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "MonitorStatus" DROP CONSTRAINT "FK_33d796695f6cbbf8e53c5f73ae0"`,
    );
    await queryRunner.query(
      `ALTER TABLE "Label" DROP CONSTRAINT "FK_68b07db354428cfb32485b5d57c"`,
    );
    await queryRunner.query(
      `ALTER TABLE "IncidentSeverity" DROP CONSTRAINT "FK_1c523ebcb77b541cb035757081f"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AlertSeverity" DROP CONSTRAINT "FK_68a480f89231ff24bc0dcd9fba9"`,
    );
  }
}
