import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * The runbook runs and fixes that already outlived the incident or alert
 * they were about (#9103).
 *
 * Before CascadeRunsAndFixesWithTheirRecord, deleting an incident or an
 * alert cleared its runs' and fixes' links to it and kept them, naming no
 * record - and a run or a fix naming none is read by every reader of runs
 * and fixes, whatever its record was. Whether that record was private can't
 * be read back once it is gone, so the runs and fixes that can be told to
 * have had one are deleted, as the database now deletes them with their
 * record:
 *
 *   - every fix that names neither an incident nor an alert: each one is
 *     proposed for exactly one of them (AutoRemediationRuleEngineService,
 *     OpenStackWorkflowFix), so one naming neither lost it;
 *   - the runs those fixes started (runbookExecutionId), first;
 *   - every run a runbook rule or auto-remediation started that names no
 *     incident, alert or scheduled maintenance event: a rule's run is
 *     started for one of them (RunbookRuleEngineService), an auto-
 *     remediation's for its fix's incident or alert, so one naming none lost
 *     it. A maintenance event's is among them: nothing tells the two apart.
 *
 * A run started by a person, by OneUptime AI, by the runbook's schedule or
 * webhook or by a security playbook may never have named a record, and
 * stays: one started by hand from an incident's page whose incident has
 * since been deleted can't be told from one started from the runbook's own
 * page. So does a run from before its trigger was recorded (no
 * triggerType). Each run's Runner jobs go with it (RunnerJob's own ON
 * DELETE CASCADE).
 *
 * In one transaction, so a stop part way leaves nothing half done. Nothing
 * to undo: down() deletes nothing back.
 */
export const DELETE_RUNS_OF_FIXES_OF_DELETED_RECORDS: string = `DELETE FROM "RunbookExecution" WHERE "_id" IN (SELECT "runbookExecutionId" FROM "AutoRemediationSuggestion" WHERE "incidentId" IS NULL AND "alertId" IS NULL AND "runbookExecutionId" IS NOT NULL)`;

export const DELETE_FIXES_OF_DELETED_RECORDS: string = `DELETE FROM "AutoRemediationSuggestion" WHERE "incidentId" IS NULL AND "alertId" IS NULL`;

export const DELETE_RUNS_OF_DELETED_RECORDS: string = `DELETE FROM "RunbookExecution" WHERE "triggerType" IN ('Rule', 'AutoRemediation') AND "incidentId" IS NULL AND "alertId" IS NULL AND "scheduledMaintenanceId" IS NULL`;

export class DeleteRunsAndFixesOfDeletedRecords1809182610000
  implements MigrationInterface
{
  public name: string = "DeleteRunsAndFixesOfDeletedRecords1809182610000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(DELETE_RUNS_OF_FIXES_OF_DELETED_RECORDS);
    await queryRunner.query(DELETE_FIXES_OF_DELETED_RECORDS);
    await queryRunner.query(DELETE_RUNS_OF_DELETED_RECORDS);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // What was deleted is gone; the schema is as up() found it.
  }
}
