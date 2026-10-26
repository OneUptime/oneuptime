import IconProp from "Common/Types/Icon/IconProp";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "Common/Types/Permission";
import {
  CardSelectOption,
  CardSelectOptionGroup,
} from "Common/UI/Components/CardSelect/CardSelect";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ROLE_AREAS,
  ROLE_LEVELS,
  ROLE_REACH_TITLES,
  RoleArea,
  RoleLevel,
  RoleReach,
  WHOLE_PROJECT_ROLES,
  WholeProjectRole,
} from "./RoleCatalog";

/*
 * The roles a team or an API key can be given, as cards and list entries:
 * one per role (PermissionHelper.getRolePermissionProps), with its icon and
 * its one line, grouped as the role catalog arranges them (RoleCatalog) -
 * the whole project first, then one group per area.
 *
 * One list for every place that lists roles - the role picker of Add Role
 * (RolePicker), the roles a new custom role starts with, the Built-in Roles
 * card and the Access choice of a new API key or team - so a role reads and
 * looks the same wherever it is met. React-free, so tests can read it
 * without rendering anything.
 */

/*
 * Each role's icon: a whole-project role's own, an area's role its area's,
 * which is the icon its product wears in the Products menu (RoleCatalog).
 */
export const ROLE_ICONS: Partial<Record<Permission, IconProp>> = (() => {
  const icons: Partial<Record<Permission, IconProp>> = {};

  for (const role of WHOLE_PROJECT_ROLES) {
    icons[role.permission] = role.icon;
  }

  for (const area of ROLE_AREAS) {
    for (const level of ROLE_LEVELS) {
      icons[area.roles[level]] = area.icon;
    }
  }

  return icons;
})();

// A role with no icon of its own (one added later) shows a lock.
export const getRoleIcon: (permission: Permission) => IconProp = (
  permission: Permission,
): IconProp => {
  return ROLE_ICONS[permission] || IconProp.Lock;
};

/*
 * WHAT EACH ROLE'S CARD SAYS: ONE LINE.
 *
 * A role's full description (Common/Types/Permission, held to what the
 * role can do by Common/Tests/Types/RoleDescriptionsMatchAbilities) is a
 * paragraph - Project Member's ran to twelve lines on its card - so the
 * Add Role picker was three screens of small print, with the Scope choice
 * below them. Each card now says in one line what the role is for, in the
 * words Create Team's and Create API Key's Access cards already used for
 * the three project-wide roles. The full rules stay where they are read in
 * full: the Built-in Roles card on the Roles page (fullDescriptions), and
 * the Permission Reference in the docs, built from the descriptions.
 *
 * Written out one by one so the extractor finds every sentence
 * (src/Locales/README.md). A role added later without a line here shows
 * its full description.
 */
export const ROLE_CARD_SUMMARIES: Partial<Record<Permission, string>> = {
  [Permission.ProjectOwner]: translationKey(
    "Everything, billing and deleting the project included.",
  ),
  [Permission.ProjectAdmin]: translationKey(
    "Create, change and delete anything, settings included. Billing and deleting the project are left out.",
  ),
  [Permission.ProjectMember]: translationKey(
    "Create, change and delete monitors, incidents, status pages and other resources.",
  ),
  [Permission.Viewer]: translationKey(
    "Read everything in the project. Change nothing.",
  ),

  [Permission.IncidentAdmin]: translationKey(
    "Incidents and incident episodes, with their severities and states.",
  ),
  [Permission.IncidentMember]: translationKey(
    "Create and work on incidents and incident episodes.",
  ),
  [Permission.IncidentViewer]: translationKey(
    "Read incidents. Change nothing.",
  ),

  [Permission.AlertAdmin]: translationKey(
    "Alerts and alert episodes, with their severities and states.",
  ),
  [Permission.AlertMember]: translationKey(
    "Create and work on alerts and alert episodes.",
  ),
  [Permission.AlertViewer]: translationKey("Read alerts. Change nothing."),

  [Permission.MonitorAdmin]: translationKey(
    "Monitors and monitor groups, with their statuses.",
  ),
  [Permission.MonitorMember]: translationKey(
    "Create, change and delete monitors and monitor groups.",
  ),
  [Permission.MonitorViewer]: translationKey("Read monitors. Change nothing."),

  // Status Page Member is the same as Status Page Admin, so it says the same.
  [Permission.StatusPageAdmin]: translationKey(
    "Create, change and delete status pages and what they show.",
  ),
  [Permission.StatusPageMember]: translationKey(
    "Create, change and delete status pages and what they show.",
  ),
  [Permission.StatusPageViewer]: translationKey(
    "Read status pages. Change nothing.",
  ),

  // On-Call Member is the same as On-Call Admin, so it says the same.
  [Permission.OnCallAdmin]: translationKey(
    "Create, change and delete on-call policies, schedules and overrides.",
  ),
  [Permission.OnCallMember]: translationKey(
    "Create, change and delete on-call policies, schedules and overrides.",
  ),
  [Permission.OnCallViewer]: translationKey(
    "Read on-call policies and schedules. Change nothing.",
  ),

  [Permission.ScheduledMaintenanceAdmin]: translationKey(
    "Scheduled maintenance events, with their states.",
  ),
  [Permission.ScheduledMaintenanceMember]: translationKey(
    "Create, change and delete scheduled maintenance events.",
  ),
  [Permission.ScheduledMaintenanceViewer]: translationKey(
    "Read scheduled maintenance. Change nothing.",
  ),

  [Permission.TelemetryAdmin]: translationKey(
    "Logs, traces, metrics and exceptions, session replays included.",
  ),
  [Permission.TelemetryMember]: translationKey(
    "Read and send logs, traces, metrics and exceptions.",
  ),
  [Permission.TelemetryViewer]: translationKey(
    "Read logs, traces, metrics and exceptions. Change nothing.",
  ),

  [Permission.SecurityAdmin]: translationKey(
    "Everything in security: events, cases, playbooks, rules and connections.",
  ),
  [Permission.SecurityMember]: translationKey(
    "Work security cases, run playbooks and manage detection rules.",
  ),
  [Permission.SecurityViewer]: translationKey(
    "Read security events, cases and rules. Change nothing.",
  ),

  [Permission.SettingsAdmin]: translationKey(
    "Services, infrastructure and integrations, video calls and the audit log.",
  ),
  [Permission.SettingsMember]: translationKey(
    "Create, change and delete services, infrastructure and integrations.",
  ),
  [Permission.SettingsViewer]: translationKey(
    "Read the project's settings. Change nothing.",
  ),

  [Permission.BillingAdmin]: translationKey(
    "Billing contacts, and turning SMS, calls, WhatsApp and Telegram on or off.",
  ),
  [Permission.BillingMember]: translationKey(
    "Read billing, download invoices and change billing contacts.",
  ),
  [Permission.BillingViewer]: translationKey(
    "Read the plan, invoices, usage and balances. Change nothing.",
  ),

  [Permission.WorkflowAdmin]: translationKey(
    "Build, run and delete workflows.",
  ),
  [Permission.WorkflowMember]: translationKey(
    "Open and run workflows, but not change them.",
  ),
  [Permission.WorkflowViewer]: translationKey(
    "Read workflows and their runs. Change nothing.",
  ),

  [Permission.RunbookAdmin]: translationKey(
    "Build, run and delete runbooks and their Runners.",
  ),
  [Permission.RunbookMember]: translationKey(
    "Open and run runbooks, but not change them.",
  ),
  [Permission.RunbookViewer]: translationKey(
    "Read runbooks and their runs. Run nothing.",
  ),
};

/*
 * EACH BUILT-IN ROLE'S NAME, AS A KEY OF ITS OWN.
 *
 * The names are Common/Types/Permission's titles - the server's words too,
 * in its refusals - and the extractor does not read that catalog (its 1,500
 * permission titles are mostly the server's). The roles are what people
 * pick and read, so their names are listed here, written out one by one for
 * the extractor, and every place that draws a role looks its name up: the
 * role picker, the Built-in Roles card, the team and API key permission
 * tables and the "You need one of these permissions" sentences
 * (Common/UI/Utils/PermissionGate). A test holds this list to Permission's
 * role permissions, name for name.
 */
export const ROLE_NAMES: Partial<Record<Permission, string>> = {
  [Permission.ProjectOwner]: translationKey("Project Owner"),
  [Permission.ProjectAdmin]: translationKey("Project Admin"),
  [Permission.ProjectMember]: translationKey("Project Member"),
  [Permission.Viewer]: translationKey("Viewer"),
  [Permission.IncidentAdmin]: translationKey("Incident Admin"),
  [Permission.IncidentMember]: translationKey("Incident Member"),
  [Permission.IncidentViewer]: translationKey("Incident Viewer"),
  [Permission.AlertAdmin]: translationKey("Alert Admin"),
  [Permission.AlertMember]: translationKey("Alert Member"),
  [Permission.AlertViewer]: translationKey("Alert Viewer"),
  [Permission.MonitorAdmin]: translationKey("Monitor Admin"),
  [Permission.MonitorMember]: translationKey("Monitor Member"),
  [Permission.MonitorViewer]: translationKey("Monitor Viewer"),
  [Permission.StatusPageAdmin]: translationKey("Status Page Admin"),
  [Permission.StatusPageMember]: translationKey("Status Page Member"),
  [Permission.StatusPageViewer]: translationKey("Status Page Viewer"),
  [Permission.OnCallAdmin]: translationKey("On-Call Admin"),
  [Permission.OnCallMember]: translationKey("On-Call Member"),
  [Permission.OnCallViewer]: translationKey("On-Call Viewer"),
  [Permission.ScheduledMaintenanceAdmin]: translationKey(
    "Scheduled Maintenance Admin",
  ),
  [Permission.ScheduledMaintenanceMember]: translationKey(
    "Scheduled Maintenance Member",
  ),
  [Permission.ScheduledMaintenanceViewer]: translationKey(
    "Scheduled Maintenance Viewer",
  ),
  [Permission.TelemetryAdmin]: translationKey("Telemetry Admin"),
  [Permission.TelemetryMember]: translationKey("Telemetry Member"),
  [Permission.TelemetryViewer]: translationKey("Telemetry Viewer"),
  [Permission.SecurityAdmin]: translationKey("Security Admin"),
  [Permission.SecurityMember]: translationKey("Security Member"),
  [Permission.SecurityViewer]: translationKey("Security Viewer"),
  [Permission.SettingsAdmin]: translationKey("Settings Admin"),
  [Permission.SettingsMember]: translationKey("Settings Member"),
  [Permission.SettingsViewer]: translationKey("Settings Viewer"),
  [Permission.BillingAdmin]: translationKey("Billing Admin"),
  [Permission.BillingMember]: translationKey("Billing Member"),
  [Permission.BillingViewer]: translationKey("Billing Viewer"),
  [Permission.WorkflowAdmin]: translationKey("Workflow Admin"),
  [Permission.WorkflowMember]: translationKey("Workflow Member"),
  [Permission.WorkflowViewer]: translationKey("Workflow Viewer"),
  [Permission.RunbookAdmin]: translationKey("Runbook Admin"),
  [Permission.RunbookMember]: translationKey("Runbook Member"),
  [Permission.RunbookViewer]: translationKey("Runbook Viewer"),
};

// A role's line on its card: its summary, else its full description.
export const getRoleCardSummary: (props: PermissionProps) => string = (
  props: PermissionProps,
): string => {
  return ROLE_CARD_SUMMARIES[props.permission] || props.description;
};

/*
 * Whether a permission is one of the built-in roles the cards offer, rather
 * than a single permission from the full list: what a row is edited with is
 * the picker it was added with (Add Role or Add Permission).
 */
export const isBuiltInRolePermission: (
  permission: Permission | string | undefined | null,
) => boolean = (
  permission: Permission | string | undefined | null,
): boolean => {
  if (!permission) {
    return false;
  }

  return PermissionHelper.getRolePermissionProps().some(
    (props: PermissionProps): boolean => {
      return props.permission === permission;
    },
  );
};

export interface RoleCardSelectOptionStyle {
  // The role's whole description rather than its one line.
  fullDescription?: boolean | undefined;
}

export const getRoleCardSelectOption: (
  props: PermissionProps,
  style?: RoleCardSelectOptionStyle,
) => CardSelectOption = (
  props: PermissionProps,
  style?: RoleCardSelectOptionStyle,
): CardSelectOption => {
  return {
    value: props.permission,
    title: props.title,
    description: style?.fullDescription
      ? props.description
      : getRoleCardSummary(props),
    icon: getRoleIcon(props.permission),
  };
};

export interface RoleCardSelectOptionsFilter {
  /*
   * Roles left out: a custom role's Add Role offers every role but Project
   * Owner, which no custom role holds (Types/Team/CustomRole).
   */
  excludeRoles?: ReadonlyArray<Permission> | undefined;
  /*
   * Each role's whole description instead of its one line: the Built-in
   * Roles card, where roles are looked up rather than picked.
   */
  fullDescriptions?: boolean | undefined;
}

/*
 * Every role, in the catalog's groups (RoleCatalog): Whole project - Project
 * Owner, Project Admin, Project Member and Viewer - then one group per area,
 * titled with the area's name and holding its Admin, Member and Viewer. A
 * role the catalog does not place yet (one added later) is listed last,
 * under Other, so it is never lost; RoleCatalog.test fails until it is
 * placed. Empty groups are left out.
 */
export const getRoleCardSelectOptions: (
  filter?: RoleCardSelectOptionsFilter,
) => Array<CardSelectOptionGroup> = (
  filter?: RoleCardSelectOptionsFilter,
): Array<CardSelectOptionGroup> => {
  const offered: Array<PermissionProps> =
    PermissionHelper.getRolePermissionProps().filter(
      (props: PermissionProps): boolean => {
        return !filter?.excludeRoles?.includes(props.permission);
      },
    );

  const listed: Set<Permission> = new Set<Permission>();

  // The cards of these roles, each once, leaving out what is not offered.
  const optionsOf: (
    permissions: ReadonlyArray<Permission>,
  ) => Array<CardSelectOption> = (
    permissions: ReadonlyArray<Permission>,
  ): Array<CardSelectOption> => {
    const options: Array<CardSelectOption> = [];

    for (const permission of permissions) {
      const props: PermissionProps | undefined = offered.find(
        (candidate: PermissionProps): boolean => {
          return candidate.permission === permission;
        },
      );

      if (!props || listed.has(permission)) {
        continue;
      }

      listed.add(permission);
      options.push(
        getRoleCardSelectOption(props, {
          fullDescription: filter?.fullDescriptions,
        }),
      );
    }

    return options;
  };

  const groups: Array<CardSelectOptionGroup> = [
    {
      label: ROLE_REACH_TITLES[RoleReach.WholeProject],
      options: optionsOf(
        WHOLE_PROJECT_ROLES.map((role: WholeProjectRole): Permission => {
          return role.permission;
        }),
      ),
    },
    ...ROLE_AREAS.map((area: RoleArea): CardSelectOptionGroup => {
      return {
        label: area.title,
        options: optionsOf(
          ROLE_LEVELS.map((level: RoleLevel): Permission => {
            return area.roles[level];
          }),
        ),
      };
    }),
    {
      label: translationKey("Other"),
      options: optionsOf(
        offered.map((props: PermissionProps): Permission => {
          return props.permission;
        }),
      ),
    },
  ];

  return groups.filter((group: CardSelectOptionGroup): boolean => {
    return group.options.length > 0;
  });
};
