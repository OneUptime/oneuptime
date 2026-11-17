import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Generated with npm run generate-postgres-migration alongside
 * AddOnCallFireDrillResults1809183100000, and moved into a migration of its
 * own: "OnCallDutyPolicyExecutionLog" holds every page a project has ever
 * sent, and is written on every page, so both statements run online,
 * without blocking its readers or writers (Docs/migrations/README.md).
 *
 *   - The index a monitor's last fire drill is read by (#9386): its runs
 *     that name the monitor, newest first. Partial, so it holds only a
 *     fire drill's tests - a handful of rows - and it serves the key's ON
 *     DELETE SET NULL when a monitor is deleted, without reading the table.
 *   - The key from a drill's test to its monitor, ON DELETE SET NULL: the
 *     policy's test stays in its history when the monitor goes. Added NOT
 *     VALID, then validated; every existing row names no monitor.
 *
 * The names are TypeORM's own, so the drift check finds nothing to change.
 * Safe to run again after a stop part way.
 */
export class AddOnCallFireDrillResultsIndexAndKey1809183110000
  implements MigrationInterface
{
  public name: string = "AddOnCallFireDrillResultsIndexAndKey1809183110000";

  // CREATE INDEX CONCURRENTLY and VALIDATE CONSTRAINT run outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await OnlineDdl.createIndex(
      queryRunner,
      `CREATE INDEX "IDX_4820183028729f3fceae04dafd" ON "OnCallDutyPolicyExecutionLog" ("testPageFireDrillMonitorId", "createdAt") WHERE "testPageFireDrillMonitorId" IS NOT NULL`,
    );
    await OnlineDdl.addForeignKey(
      queryRunner,
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" ADD CONSTRAINT "FK_d75b2b6de2c8cf161836d749833" FOREIGN KEY ("testPageFireDrillMonitorId") REFERENCES "Monitor"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "OnCallDutyPolicyExecutionLog" DROP CONSTRAINT "FK_d75b2b6de2c8cf161836d749833"`,
    );
    await OnlineDdl.dropIndex(
      queryRunner,
      `DROP INDEX "public"."IDX_4820183028729f3fceae04dafd"`,
    );
  }
}
