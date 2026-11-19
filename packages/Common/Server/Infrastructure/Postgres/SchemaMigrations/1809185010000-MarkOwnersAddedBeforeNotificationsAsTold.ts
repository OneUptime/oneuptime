import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Data fix (#9700): the owners already added to a service, a piece of
 * infrastructure, a dashboard, a workflow, a runbook, an on-call policy or
 * schedule or an incoming call policy are marked told.
 *
 * Each of these records writes a new owner row not notified yet
 * (isOwnerNotified false): an owner rule whose Notify Owners is on, and a
 * person adding an owner on an Owners page, as for every other record - a
 * service's rows from the column AddServiceOwnerIsOwnerNotified1809185000000
 * gives them. But no job read those rows, so nobody was told, and every one
 * of them is still waiting. The jobs that tell them come in the same release
 * (Workers ResourceOwnersAdded); this marks every row they would find told
 * first, so their first run sends no news that is months old. An owner added
 * after it is told.
 *
 * Written out rather than generated (nothing in the schema changes), and
 * run with the schema migrations, after the service owner tables get their
 * column, so the rows are marked before any worker of the release reads
 * them. Running it twice changes nothing. down() restores nothing: the rows
 * carry no record of which were waiting, and telling those owners now is
 * what this keeps from happening.
 */
export const RESOURCE_OWNER_TABLES: ReadonlyArray<string> = [
  "CephClusterOwnerTeam",
  "CephClusterOwnerUser",
  "CloudResourceOwnerTeam",
  "CloudResourceOwnerUser",
  "DashboardOwnerTeam",
  "DashboardOwnerUser",
  "DatabaseServerOwnerTeam",
  "DatabaseServerOwnerUser",
  "DockerHostOwnerTeam",
  "DockerHostOwnerUser",
  "DockerSwarmClusterOwnerTeam",
  "DockerSwarmClusterOwnerUser",
  "HostOwnerTeam",
  "HostOwnerUser",
  "IncomingCallPolicyOwnerTeam",
  "IncomingCallPolicyOwnerUser",
  "IoTFleetOwnerTeam",
  "IoTFleetOwnerUser",
  "KubernetesClusterOwnerTeam",
  "KubernetesClusterOwnerUser",
  "MessageQueueOwnerTeam",
  "MessageQueueOwnerUser",
  "OnCallDutyPolicyOwnerTeam",
  "OnCallDutyPolicyOwnerUser",
  "OnCallDutyPolicyScheduleOwnerTeam",
  "OnCallDutyPolicyScheduleOwnerUser",
  "OpenStackCloudOwnerTeam",
  "OpenStackCloudOwnerUser",
  "PodmanHostOwnerTeam",
  "PodmanHostOwnerUser",
  "ProxmoxClusterOwnerTeam",
  "ProxmoxClusterOwnerUser",
  "RumApplicationOwnerTeam",
  "RumApplicationOwnerUser",
  "RunbookOwnerTeam",
  "RunbookOwnerUser",
  "ServerlessFunctionOwnerTeam",
  "ServerlessFunctionOwnerUser",
  "ServiceOwnerTeam",
  "ServiceOwnerUser",
  "StorageArrayOwnerTeam",
  "StorageArrayOwnerUser",
  "VMwareVCenterOwnerTeam",
  "VMwareVCenterOwnerUser",
  "WorkflowOwnerTeam",
  "WorkflowOwnerUser",
];

export const getMarkOwnersToldStatement: (table: string) => string = (
  table: string,
): string => {
  return `UPDATE "${table}" SET "isOwnerNotified" = true WHERE "isOwnerNotified" = false`;
};

export class MarkOwnersAddedBeforeNotificationsAsTold1809185010000
  implements MigrationInterface
{
  public name: string = "MarkOwnersAddedBeforeNotificationsAsTold1809185010000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of RESOURCE_OWNER_TABLES) {
      await queryRunner.query(getMarkOwnersToldStatement(table));
    }
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Nothing to restore; see the note above.
  }
}
