import { MigrationInterface, QueryRunner } from "typeorm";

/*
 * Until this release, the API let a team and an API key be given a
 * permission no permission picker offers (isAssignableToTenant: false):
 * TeamPermissionService and ApiKeyPermissionService never asked, so a
 * project owner could give one through the API, the CLI or Terraform
 * (#8281). They refuse them now, and this takes them from every team, API
 * key and custom role that holds one:
 *
 *   - Logged in User (CurrentUser), User, Public, AuthenticatedRequest and
 *     UnAuthorizedSsoUser: OneUptime gives them itself, to every signed-in
 *     person, every API key and every member of a project, where they
 *     apply. A row of one adds nothing its holder lacks.
 *   - Customer Support: OneUptime staff's. It opens a person's isDisabled
 *     and isBlocked (User) to them, which only OneUptime may change.
 *   - The four Service Telemetry Link permissions, retired by
 *     RemoveServiceTelemetryLinkPermissions1809176500000, which the API
 *     could give again after that ran: they grant nothing.
 *
 * Nobody loses anything they may do: the first five are held anyway, and
 * the rest are no team's to hold. Every other permission of the same team,
 * key or role stays - a value that is no permission at all too, such as a
 * name a later data migration renames.
 *
 * A custom role's permission count (CustomRole.permissionCount, shown on
 * the Roles page) is counted again first, without them, the way
 * CustomRolePermissionService.recountPermissions counts it, and only for
 * the roles that hold one. The teams' and API keys' copies of a role's rows
 * (CustomRoleSync) hold the same permission, so they go with the deletes
 * from their own tables, as well as by ON DELETE CASCADE.
 *
 * A schema migration, as RemoveServiceTelemetryLinkPermissions1809176500000
 * is: the servers of this release refuse them, and start only once the
 * schema migrations have run (SchemaMigrationWait), so no page shows a
 * permission its editor refuses to keep. Each statement removes only rows
 * of these, so a second run changes nothing. Written out rather than read
 * from Permission.ts, so the migration does what it did when it was
 * written, whatever the catalogue becomes.
 */
export const REMOVED_PERMISSIONS: Array<string> = [
  "CurrentUser",
  "User",
  "Public",
  "AuthenticatedRequest",
  "UnAuthorizedSsoUser",
  "CustomerSupport",
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

export class RemovePermissionsTeamsCannotBeGiven1809178100000
  implements MigrationInterface
{
  public name: string = "RemovePermissionsTeamsCannotBeGiven1809178100000";

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
    // The rows deleted above are not put back: no team, key or role may hold them.
  }
}
