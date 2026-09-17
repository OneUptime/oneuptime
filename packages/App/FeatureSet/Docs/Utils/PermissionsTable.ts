import { TranslateFn, makeT } from "./I18n";
import Permission, {
  PermissionGroup,
  PermissionHelper,
  PermissionProps,
} from "Common/Types/Permission";

/*
 * Renders the permission reference tables that the docs page embeds.
 *
 * Common/Types/Permission.ts is the ONLY source of permission titles,
 * descriptions and groupings — the same list the dashboard's permission
 * picker and the API render from. Nothing here restates a permission; a
 * hand-maintained copy in markdown would drift the moment somebody adds a
 * permission, and a docs page that lies about permissions is worse than no
 * page at all.
 *
 * Only the surrounding chrome (column headers, yes/no, scope wording) is
 * translated, which is why these functions take a language rather than
 * pre-built strings: the markdown they emit differs per locale.
 */

/*
 * Every placeholder the docs content may embed. Nothing else is substituted —
 * docs pages legitimately contain other {{...}} tokens (e.g. the monitor
 * docs document `{{timestamp}}` request placeholders) and must be left alone.
 */
export enum PermissionPlaceholder {
  RoleTables = "{{PERMISSION_ROLE_TABLES}}",
  GranularTables = "{{PERMISSION_GRANULAR_TABLES}}",
  ScopeExemptRoles = "{{PERMISSION_SCOPE_EXEMPT_ROLES}}",
  RoleCount = "{{PERMISSION_ROLE_COUNT}}",
  TotalCount = "{{PERMISSION_TOTAL_COUNT}}",
  GroupCount = "{{PERMISSION_GROUP_COUNT}}",
}

/*
 * Generated markdown is deterministic per language and the granular table is
 * ~1,200 rows, so build each language once and serve it from memory rather
 * than re-walking the permission list on every request.
 */
const roleTablesCache: Map<string, string> = new Map();
const granularTablesCache: Map<string, string> = new Map();
const scopeExemptCache: Map<string, string> = new Map();

/*
 * Markdown table cells are pipe-delimited and single-line. A permission
 * description containing either character would otherwise split the row into
 * extra columns or terminate the table early.
 */
export function toTableCell(text: string): string {
  return text
    .replace(/\r?\n/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\|/g, "\\|")
    .trim();
}

/*
 * Groups the given permissions in first-seen order. PermissionGroup's
 * declaration order is not the order permissions are declared in, and the
 * dashboard's picker groups by first appearance — matching it keeps the docs
 * and the UI in the same sequence.
 */
export function groupPermissions(
  permissions: Array<PermissionProps>,
): Map<PermissionGroup, Array<PermissionProps>> {
  const grouped: Map<PermissionGroup, Array<PermissionProps>> = new Map();

  for (const permission of permissions) {
    const existing: Array<PermissionProps> | undefined = grouped.get(
      permission.group,
    );

    if (existing) {
      existing.push(permission);
    } else {
      grouped.set(permission.group, [permission]);
    }
  }

  return grouped;
}

/*
 * Every permission that can be granted to a team. This used to de-duplicate:
 * getAllPermissionProps() listed sixteen permissions twice, so the reference
 * rendered them twice. The duplicates are gone from Permission.ts and a test in
 * Common/Tests/Types/Permission.test.ts now keeps them gone, so this reads the
 * catalogue straight. Collapsing here as well would only hide the next
 * duplicate from that test.
 */
export function getAssignablePermissionProps(): Array<PermissionProps> {
  return PermissionHelper.getTenantPermissionProps();
}

// Roles — the bundled Admin / Member / Viewer grants per product area.
export function getRolePermissionProps(): Array<PermissionProps> {
  return PermissionHelper.getRolePermissionProps();
}

// Permissions a team can be granted that are not one of the built-in roles.
export function getGranularPermissionProps(): Array<PermissionProps> {
  return getAssignablePermissionProps().filter((item: PermissionProps) => {
    return !item.isRolePermission;
  });
}

function buildTable(
  headers: Array<string>,
  rows: Array<Array<string>>,
): Array<string> {
  const lines: Array<string> = [];

  lines.push(`| ${headers.join(" | ")} |`);
  lines.push(
    `| ${headers
      .map(() => {
        return "---";
      })
      .join(" | ")} |`,
  );

  for (const row of rows) {
    lines.push(`| ${row.join(" | ")} |`);
  }

  return lines;
}

/*
 * One `###` section per permission group, each holding a table. The headings
 * are what the page's "On This Page" sidebar links to, so a reader can jump
 * straight to the group they care about instead of scrolling a 1,200 row
 * table.
 */
function buildGroupedTables(data: {
  permissions: Array<PermissionProps>;
  headers: Array<string>;
  toRow: (permission: PermissionProps) => Array<string>;
}): string {
  const { permissions, headers, toRow } = data;

  const grouped: Map<
    PermissionGroup,
    Array<PermissionProps>
  > = groupPermissions(permissions);

  const sections: Array<string> = [];

  for (const [group, groupPermissionProps] of grouped) {
    const lines: Array<string> = [];

    lines.push(`### ${group}`);
    lines.push("");
    lines.push(
      ...buildTable(
        headers,
        groupPermissionProps.map((permission: PermissionProps) => {
          return toRow(permission);
        }),
      ),
    );

    sections.push(lines.join("\n"));
  }

  return sections.join("\n\n");
}

/*
 * The built-in roles (Project Owner, Monitor Admin, ...) — the list the
 * "Role" picker offers when adding a permission to a team.
 */
export function getRoleTablesMarkdown(lang: string): string {
  const cached: string | undefined = roleTablesCache.get(lang);

  if (cached !== undefined) {
    return cached;
  }

  const t: TranslateFn = makeT(lang);

  const markdown: string = buildGroupedTables({
    permissions: getRolePermissionProps(),
    headers: [
      t("ui.permissionsColRole"),
      t("ui.permissionsColKey"),
      t("ui.permissionsColScope"),
      t("ui.permissionsColDescription"),
    ],
    toRow: (permission: PermissionProps): Array<string> => {
      return [
        toTableCell(permission.title),
        `\`${permission.permission}\``,
        PermissionHelper.isScopeApplicable(permission.permission)
          ? toTableCell(t("ui.permissionsScopeSelectable"))
          : toTableCell(t("ui.permissionsScopeProjectWide")),
        toTableCell(permission.description),
      ];
    },
  });

  roleTablesCache.set(lang, markdown);

  return markdown;
}

/*
 * Every non-role permission a team or API key can be granted. These are what
 * the "Granular" picker offers, and what the API and Terraform provider
 * expect by key.
 */
export function getGranularTablesMarkdown(lang: string): string {
  const cached: string | undefined = granularTablesCache.get(lang);

  if (cached !== undefined) {
    return cached;
  }

  const t: TranslateFn = makeT(lang);

  const markdown: string = buildGroupedTables({
    permissions: getGranularPermissionProps(),
    headers: [
      t("ui.permissionsColPermission"),
      t("ui.permissionsColKey"),
      t("ui.permissionsColLabels"),
      t("ui.permissionsColDescription"),
    ],
    toRow: (permission: PermissionProps): Array<string> => {
      return [
        toTableCell(permission.title),
        `\`${permission.permission}\``,
        permission.isAccessControlPermission
          ? toTableCell(t("ui.permissionsYes"))
          : toTableCell(t("ui.permissionsNo")),
        toTableCell(permission.description),
      ];
    },
  });

  granularTablesCache.set(lang, markdown);

  return markdown;
}

/*
 * Roles that PermissionHelper.isScopeApplicable() rejects — the dashboard
 * hides the scope picker for these because "Settings Admin, but only for
 * settings I own" has no meaning (settings are not owned resources).
 */
export function getScopeExemptRolesMarkdown(lang: string): string {
  const cached: string | undefined = scopeExemptCache.get(lang);

  if (cached !== undefined) {
    return cached;
  }

  const t: TranslateFn = makeT(lang);

  const exemptRoles: Array<PermissionProps> = getRolePermissionProps().filter(
    (permission: PermissionProps) => {
      return !PermissionHelper.isScopeApplicable(permission.permission);
    },
  );

  const markdown: string = buildTable(
    [t("ui.permissionsColRole"), t("ui.permissionsColKey")],
    exemptRoles.map((permission: PermissionProps): Array<string> => {
      return [toTableCell(permission.title), `\`${permission.permission}\``];
    }),
  ).join("\n");

  scopeExemptCache.set(lang, markdown);

  return markdown;
}

export function getRolePermissionCount(): number {
  return getRolePermissionProps().length;
}

export function getGranularPermissionCount(): number {
  return getGranularPermissionProps().length;
}

export function getPermissionGroupCount(): number {
  return groupPermissions(getAssignablePermissionProps()).size;
}

// Exported for tests — lets them assert on a known permission's row.
export function getPermissionProps(
  permission: Permission,
): PermissionProps | undefined {
  return PermissionHelper.getAllPermissionProps().find(
    (item: PermissionProps) => {
      return item.permission === permission;
    },
  );
}

/*
 * Test seam: the caches are keyed by language and never invalidated in prod
 * (the permission list is compiled in), so tests that change locale data need
 * a way to start clean.
 */
export function clearPermissionTableCaches(): void {
  roleTablesCache.clear();
  granularTablesCache.clear();
  scopeExemptCache.clear();
}
