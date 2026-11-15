import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Twenty-eight permissions the pickers offered guard nothing: no model's
 * access control, API or page checks them (#8275, #8276, #8277). They are
 * no longer offered (isAssignableToTenant: false), and this takes them from
 * every team, API key and custom role that holds one:
 *
 *   - The 21 Edit ... Feed permissions. A feed only records what happened:
 *     every feed model's update list is empty, so no entry of a feed can be
 *     edited, whoever asks.
 *   - The four On-Call Schedule Layer User permissions. The people of a
 *     layer have been added, moved, taken out and read with the layer's own
 *     permissions (Create, Edit, Delete and Read On-Call Schedule Layer)
 *     since the layers were made, and still are.
 *   - Create Invoices and Delete Invoices. Invoices come from the payment
 *     provider: BillingInvoice's create and delete lists are empty.
 *   - Add Label to Resources. A label is put on a resource with that
 *     resource's own Edit permission (its labels column's update list).
 *
 * They granted nothing, so nobody loses anything they could do, and every
 * other permission of the same team, key or role stays.
 *
 * A custom role's permission count (CustomRole.permissionCount, shown on
 * the Roles page) is counted again first, without them, the way
 * CustomRolePermissionService.recountPermissions counts it, and only for
 * the roles that hold one. The teams' and API keys' copies of a role's rows
 * (CustomRoleSync) hold the same permission, so they go with the deletes
 * from their own tables, as well as by ON DELETE CASCADE.
 *
 * Members' permission sets cached before this ran are read as missing, and
 * rebuilt from the rows that remain, because it is listed in
 * PERMISSION_ROW_MIGRATIONS (Postgres/PermissionRowMigrations.ts).
 *
 * A schema migration, as RemoveServiceTelemetryLinkPermissions1809176500000
 * and RemovePermissionsTeamsCannotBeGiven1809178100000 are: the servers of
 * this release stop offering them, and start only once the schema
 * migrations have run (SchemaMigrationWait), so no role's page shows a
 * permission its editor no longer offers. Each statement removes only rows
 * of these, so a second run changes nothing. Written out rather than read
 * from Permission.ts, so the migration does what it did when it was
 * written, whatever the catalogue becomes.
 */
export const REMOVED_PERMISSIONS: Array<string> = [
  // Feeds only record what happened.
  "EditAlertEpisodeFeed",
  "EditAlertFeed",
  "EditCephClusterFeed",
  "EditCloudResourceFeed",
  "EditDatabaseServerFeed",
  "EditDockerHostFeed",
  "EditDockerSwarmClusterFeed",
  "EditHostFeed",
  "EditIncidentEpisodeFeed",
  "EditIncidentFeed",
  "EditKubernetesClusterFeed",
  "EditMonitorFeed",
  "EditOnCallDutyPolicyFeed",
  "EditOpenStackCloudFeed",
  "EditPodmanHostFeed",
  "EditProxmoxClusterFeed",
  "EditScheduledMaintenanceFeed",
  "EditServiceFeed",
  "EditServiceLevelObjectiveFeed",
  "EditStorageArrayFeed",
  "EditVMwareVCenterFeed",
  // A layer's people are checked with the layer's own permissions.
  "CreateOnCallDutyPolicyScheduleLayerUser",
  "DeleteOnCallDutyPolicyScheduleLayerUser",
  "EditOnCallDutyPolicyScheduleLayerUser",
  "ReadOnCallDutyPolicyScheduleLayerUser",
  // Invoices come from the payment provider.
  "CreateInvoices",
  "DeleteInvoices",
  // A label is put on a resource with the resource's own Edit permission.
  "AddLabelsToProjectResources",
];

export const PERMISSION_TABLES: Array<string> = [
  "TeamPermission",
  "ApiKeyPermission",
  "CustomRolePermission",
];

// $1: REMOVED_PERMISSIONS.
export const RECOUNT_ROLES_HOLDING_THEM: string = `UPDATE "CustomRole"
SET "permissionCount" = (
  SELECT COUNT(*)::int
  FROM "CustomRolePermission"
  WHERE "CustomRolePermission"."customRoleId" = "CustomRole"."_id"
    AND "CustomRolePermission"."projectId" = "CustomRole"."projectId"
    AND "CustomRolePermission"."deletedAt" IS NULL
    AND NOT ("CustomRolePermission"."permission" = ANY($1::text[]))
)
WHERE "_id" IN (
  SELECT "customRoleId"
  FROM "CustomRolePermission"
  WHERE "permission" = ANY($1::text[])
)`;

export class RemovePermissionsThatGrantNothing1809178600000
  implements MigrationInterface
{
  public name: string = "RemovePermissionsThatGrantNothing1809178600000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(RECOUNT_ROLES_HOLDING_THEM, [REMOVED_PERMISSIONS]);

    for (const table of PERMISSION_TABLES) {
      await queryRunner.query(
        `DELETE FROM "${table}" WHERE "permission" = ANY($1::text[])`,
        [REMOVED_PERMISSIONS],
      );
    }
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // The rows deleted above are not put back: they granted nothing.
  }
}
