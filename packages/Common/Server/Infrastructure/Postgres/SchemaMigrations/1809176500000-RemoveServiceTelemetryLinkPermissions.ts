import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * The four Service Telemetry Link permissions (Create, Read, Edit and
 * Delete ServiceTelemetryService) guarded the links between a service and
 * its telemetry services. That link, its model and its pages went when
 * telemetry came to name its service directly, and nothing has checked the
 * four since: no model's access control, no API, no page. They are no
 * longer offered (isAssignableToTenant: false), and this takes them from
 * every team, API key and custom role that holds them. They granted
 * nothing, so nobody loses anything they could do, and every other
 * permission of the same team, key or role stays.
 *
 * A custom role's permission count (CustomRole.permissionCount, shown on
 * the Roles page) is counted again first, without the four, the way
 * CustomRolePermissionService.recountPermissions counts it, and only for
 * the roles that hold one of them. The teams' and API keys' copies of a
 * role's rows (CustomRoleSync) hold the same permission, so they go with
 * the deletes from their own tables, as well as by ON DELETE CASCADE.
 *
 * A schema migration rather than a data migration, as
 * RemoveRunbookCredentials1805780000000 was: the servers of this release
 * stop offering the four, and start only once the schema migrations have
 * run (SchemaMigrationWait), so no role's page ever shows a permission its
 * editor no longer offers. Each statement only removes rows of the four,
 * so a second run changes nothing.
 */
export const REMOVED_PERMISSIONS: Array<string> = [
  "CreateServiceTelemetryService",
  "DeleteServiceTelemetryService",
  "EditServiceTelemetryService",
  "ReadServiceTelemetryService",
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

export class RemoveServiceTelemetryLinkPermissions1809176500000
  implements MigrationInterface
{
  public name: string = "RemoveServiceTelemetryLinkPermissions1809176500000";

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
    // The permission rows deleted above are not put back: they granted nothing.
  }
}
