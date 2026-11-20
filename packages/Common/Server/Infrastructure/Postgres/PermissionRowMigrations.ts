/*
 * THE SCHEMA MIGRATIONS THAT CHANGE PERMISSION ROWS, AND THE PERMISSION
 * SETS CACHED BEFORE THEM.
 *
 * A member's permission set in a project is built from their teams' rows
 * (TeamMember, TeamPermission) and kept in Redis for up to 30 days
 * (AccessTokenService, PermissionNamespace.ProjectPermission). The request
 * middleware serves it from there until a change to one of their teams,
 * their memberships or a sign-in rebuilds it. A migration changes rows in
 * Postgres directly, so none of that happens: a member whose team held a
 * row a migration took away kept it in their cached set (#8373).
 *
 * So every set is cached with PERMISSION_ROWS_VERSION, the number of the
 * newest migration listed below, and a set cached with an older one - or
 * with none, as every set cached before this existed - is read as missing
 * and deleted (UserPermissionUtil.getUserTenantAccessPermissionFromCache),
 * and the caller rebuilds it from the rows as they are now. A release that
 * ships a migration listed here makes every server read each member's set
 * again, once, the first time it is asked for it: no step after the
 * migrations, and no Redis, is needed for it.
 *
 * Servers of the release before keep their sets while both run: a set one
 * of them caches has the older number (or none), and every server of the
 * new release rebuilds it; a set a new server caches has a newer number,
 * which an older server takes as it is, as it was built from the rows the
 * migration left. Servers of a new release start only once the schema
 * migrations have run (SchemaMigrationWait), so no set with the new number
 * holds a row the migration took away. A version in the cache key instead
 * would split them: a change an older server made would refresh only the
 * key it reads, and a newer server would go on serving its own.
 *
 * API keys need nothing of this: their rows are kept in each process for a
 * minute at most (ApiKeyPermissionService), and a process of a new release
 * starts with none.
 *
 * A schema migration that deletes, changes or inserts rows of a table
 * below (PERMISSION_ROW_TABLES) is listed here, in the order the registry
 * runs them. PermissionRowMigrationsGuard fails until it is.
 */
export const PERMISSION_ROW_MIGRATIONS: ReadonlyArray<string> = [
  "MigrateLegacyManagerRolesToAdmin1778900000000",
  "RenameRunbookAgentToRunner1785810000000",
  "MigrateIncidentFormsToForms1797400000000",
  "RemoveRunbookCredentials1805780000000",
  "RemoveServiceTelemetryLinkPermissions1809176500000",
  "RemovePermissionsTeamsCannotBeGiven1809178100000",
  "RemovePermissionsThatGrantNothing1809178600000",
  /*
   * Writes only the address of an invitation not yet accepted, which no
   * permission set reads (a set is built from accepted memberships). Listed
   * all the same, as every write to these tables is: the guard cannot tell
   * which columns a set reads, and the cost is one rebuild of each set.
   */
  "BackfillTeamMemberInviteeEmail1809186970000",
];

/*
 * The tables a member's or an API key's permissions are read from: a row
 * written to one of them by a migration changes what someone may do.
 */
export const PERMISSION_ROW_TABLES: ReadonlyArray<string> = [
  "TeamMember",
  "TeamPermission",
  "TeamPermissionLabel",
  "ApiKeyPermission",
  "ApiKeyPermissionLabel",
  "CustomRolePermission",
  "CustomRolePermissionLabel",
];

// A migration's 13-digit number, read off the end of its class name.
const NUMBER_OF_MIGRATION: RegExp = /(\d{13})$/;

export const getMigrationNumber: (migrationName: string) => number = (
  migrationName: string,
): number => {
  const match: RegExpMatchArray | null =
    migrationName.match(NUMBER_OF_MIGRATION);

  if (!match) {
    throw new Error(
      `${migrationName} does not end in the 13-digit number of a schema migration.`,
    );
  }

  return Number(match[1]);
};

/*
 * What a cached permission set must have been cached with to be served:
 * the number of the newest migration that changed permission rows.
 */
export const PERMISSION_ROWS_VERSION: number = getMigrationNumber(
  PERMISSION_ROW_MIGRATIONS[PERMISSION_ROW_MIGRATIONS.length - 1]!,
);
