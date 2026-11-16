import OnlineDdl from "../OnlineDdl";
import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * A runbook run linked to an incident or an alert, and a fix OneUptime AI
 * proposed for one, are deleted with that incident or alert (#9103).
 *
 * Their links to it were cleared when it was deleted (ON DELETE SET NULL):
 * the run and the fix stayed, naming no record. What is done about a
 * private incident or alert is read only by those who see the record
 * (PrivateRecordReadFilter), and a row naming none is read by everyone - so
 * deleting a private incident handed its runs' output and its fixes' plans
 * to every reader of runs and fixes. Now the database deletes them with the
 * record (ON DELETE CASCADE), as it already deletes the record's pages,
 * logs, notes and OneUptime AI's decisions about it: however the record is
 * deleted - one or many at once, from the dashboard, the API, Terraform,
 * MCP or a workflow, by the retention purge, with its project. A run's
 * Runner jobs go with the run, as before.
 *
 * Generated as a DROP and an ADD of the same four constraints. Each is
 * handed, its ADD as generated, to OnlineDdl.replaceForeignKey: dropped and
 * added NOT VALID in one statement - an instant's ACCESS EXCLUSIVE on both
 * tables, and never a moment without the key in which a delete could leave
 * a run or a fix naming nothing - then validated without blocking either
 * table. Safe to run again after a stop part way: a key already replaced is
 * not swapped again, and one left NOT VALID is validated. Before each, the
 * rows naming a record that is gone are deleted, as the key now deletes
 * them (deleteRowsOfDeletedRecords): there are none while the key holds,
 * but a database that lost it, or never validated it, would fail the
 * validation on them. DeleteRunsAndFixesOfDeletedRecords, after this,
 * deletes the runs and fixes that lost their record before.
 */

// One link of a run or a fix to the record it is about.
export interface RecordLink {
  table: string;
  column: string;
  recordTable: string;
  constraintName: string;
}

export const RECORD_LINKS: ReadonlyArray<RecordLink> = [
  {
    table: "RunbookExecution",
    column: "incidentId",
    recordTable: "Incident",
    constraintName: "FK_e7db3e611dbd7ab1d826808031e",
  },
  {
    table: "RunbookExecution",
    column: "alertId",
    recordTable: "Alert",
    constraintName: "FK_75204c7fb1e4318b1a9afa42753",
  },
  {
    table: "AutoRemediationSuggestion",
    column: "incidentId",
    recordTable: "Incident",
    constraintName: "FK_f5f825e9d20fd9c235182302134",
  },
  {
    table: "AutoRemediationSuggestion",
    column: "alertId",
    recordTable: "Alert",
    constraintName: "FK_b8f9bc9c1db4b135b648561671e",
  },
];

export class CascadeRunsAndFixesWithTheirRecord1809182600000
  implements MigrationInterface
{
  public name: string = "CascadeRunsAndFixesWithTheirRecord1809182600000";

  // OnlineDdl.replaceForeignKey validates outside a transaction.
  public transaction: boolean = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await this.deleteRowsOfDeletedRecords(queryRunner, RECORD_LINKS[0]!);
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "RunbookExecution" ADD CONSTRAINT "FK_e7db3e611dbd7ab1d826808031e" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await this.deleteRowsOfDeletedRecords(queryRunner, RECORD_LINKS[1]!);
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "RunbookExecution" ADD CONSTRAINT "FK_75204c7fb1e4318b1a9afa42753" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await this.deleteRowsOfDeletedRecords(queryRunner, RECORD_LINKS[2]!);
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "AutoRemediationSuggestion" ADD CONSTRAINT "FK_f5f825e9d20fd9c235182302134" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );

    await this.deleteRowsOfDeletedRecords(queryRunner, RECORD_LINKS[3]!);
    await OnlineDdl.replaceForeignKey(
      queryRunner,
      `ALTER TABLE "AutoRemediationSuggestion" ADD CONSTRAINT "FK_b8f9bc9c1db4b135b648561671e" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" DROP CONSTRAINT "FK_b8f9bc9c1db4b135b648561671e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" DROP CONSTRAINT "FK_f5f825e9d20fd9c235182302134"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookExecution" DROP CONSTRAINT "FK_75204c7fb1e4318b1a9afa42753"`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookExecution" DROP CONSTRAINT "FK_e7db3e611dbd7ab1d826808031e"`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" ADD CONSTRAINT "FK_b8f9bc9c1db4b135b648561671e" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "AutoRemediationSuggestion" ADD CONSTRAINT "FK_f5f825e9d20fd9c235182302134" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookExecution" ADD CONSTRAINT "FK_75204c7fb1e4318b1a9afa42753" FOREIGN KEY ("alertId") REFERENCES "Alert"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "RunbookExecution" ADD CONSTRAINT "FK_e7db3e611dbd7ab1d826808031e" FOREIGN KEY ("incidentId") REFERENCES "Incident"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
  }

  /*
   * The runs or fixes naming a record that no longer exists: none while
   * the key holds the link (it cleared them), but a database that lost the
   * key, or never validated it, may hold some, and the validation would
   * refuse them. Deleted, as the key now deletes them. A record deleted
   * after this and before the swap leaves none while the old key holds: it
   * clears the link. Without one, such a row fails the validation once,
   * the new key in place NOT VALID; run again, it is deleted here and the
   * key validated.
   */
  private async deleteRowsOfDeletedRecords(
    queryRunner: QueryRunner,
    link: RecordLink,
  ): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "${link.table}" row_of_record
        WHERE row_of_record."${link.column}" IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM "${link.recordTable}" named_record
             WHERE named_record."_id" = row_of_record."${link.column}"
          )`,
    );
  }
}
