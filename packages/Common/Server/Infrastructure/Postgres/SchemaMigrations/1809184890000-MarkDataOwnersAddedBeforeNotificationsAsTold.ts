import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Data fix (#9681): the owners already added to a table, a pipeline or a
 * data store are marked told.
 *
 * Data Observability's tables and pipelines, and the data stores it shares
 * with Data Security, write each new owner row not notified yet
 * (isOwnerNotified false): an owner rule whose Notify Owners is on, and a
 * person adding an owner on an Owners page, as for every other record. But
 * no job read those rows, so nobody was told, and every one of them is
 * still waiting. The jobs that tell them come in the same release (Workers
 * DataAssetOwners, DataPipelineOwners and DataStoreOwners); this marks
 * every row they would find told first, so their first run sends no news
 * that is months old. An owner added after it is told.
 *
 * Written out rather than generated (nothing in the schema changes), and
 * run with the schema migrations, so the rows are marked before any worker
 * of the release reads them. Running it twice changes nothing. down()
 * restores nothing: the rows carry no record of which were waiting, and
 * telling those owners now is what this keeps from happening.
 */
export const DATA_OWNER_TABLES: ReadonlyArray<string> = [
  "DataAssetOwnerTeam",
  "DataAssetOwnerUser",
  "DataPipelineOwnerTeam",
  "DataPipelineOwnerUser",
  "DataStoreOwnerTeam",
  "DataStoreOwnerUser",
];

export const getMarkDataOwnersToldStatement: (table: string) => string = (
  table: string,
): string => {
  return `UPDATE "${table}" SET "isOwnerNotified" = true WHERE "isOwnerNotified" = false`;
};

export class MarkDataOwnersAddedBeforeNotificationsAsTold1809184890000
  implements MigrationInterface
{
  public name: string =
    "MarkDataOwnersAddedBeforeNotificationsAsTold1809184890000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of DATA_OWNER_TABLES) {
      await queryRunner.query(getMarkDataOwnersToldStatement(table));
    }
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Nothing to restore; see the note above.
  }
}
