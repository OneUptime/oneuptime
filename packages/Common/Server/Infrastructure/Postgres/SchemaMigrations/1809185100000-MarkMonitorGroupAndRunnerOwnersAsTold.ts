import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Data fix (#9758): the owners already added to a monitor group or a runner
 * are marked told.
 *
 * A person adding an owner on a monitor group's Owners page, or on a
 * runner's, wrote the owner row not notified yet (isOwnerNotified false), as
 * for every other record. But no job read those rows, so nobody was told,
 * and every one of them is still waiting. The jobs that tell them come in
 * the same release (Workers MonitorGroupOwners and RunnerOwners); this marks
 * every row they would find told first, so their first run sends no news
 * that is months old. An owner added after it is told.
 *
 * Written out rather than generated (nothing in the schema changes), and
 * run with the schema migrations, so the rows are marked before any worker
 * of the release reads them. Running it twice changes nothing. down()
 * restores nothing: the rows carry no record of which were waiting, and
 * telling those owners now is what this keeps from happening.
 */
export const MONITOR_GROUP_AND_RUNNER_OWNER_TABLES: ReadonlyArray<string> = [
  "MonitorGroupOwnerTeam",
  "MonitorGroupOwnerUser",
  "RunnerOwnerTeam",
  "RunnerOwnerUser",
];

export const getMarkMonitorGroupAndRunnerOwnersToldStatement: (
  table: string,
) => string = (table: string): string => {
  return `UPDATE "${table}" SET "isOwnerNotified" = true WHERE "isOwnerNotified" = false`;
};

export class MarkMonitorGroupAndRunnerOwnersAsTold1809185100000
  implements MigrationInterface
{
  public name: string = "MarkMonitorGroupAndRunnerOwnersAsTold1809185100000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of MONITOR_GROUP_AND_RUNNER_OWNER_TABLES) {
      await queryRunner.query(
        getMarkMonitorGroupAndRunnerOwnersToldStatement(table),
      );
    }
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Nothing to restore; see the note above.
  }
}
