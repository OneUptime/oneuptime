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

/*
 * The roles a team or an API key can be given, as the cards of an "Add Role"
 * picker: one card per role (PermissionHelper.getRolePermissionProps), with
 * an icon for the area it covers, grouped from the widest to the narrowest.
 *
 * One list for every place that offers roles - a team's permissions, an API
 * key's permissions and the Access choice of a new API key - so a role reads
 * and looks the same wherever it is picked. React-free, so tests can read it
 * without rendering anything.
 */

export const ROLE_ICONS: Partial<Record<Permission, IconProp>> = {
  [Permission.ProjectOwner]: IconProp.ShieldCheck,
  [Permission.ProjectAdmin]: IconProp.User,
  [Permission.ProjectMember]: IconProp.Team,
  [Permission.Viewer]: IconProp.Eye,

  [Permission.IncidentAdmin]: IconProp.Alert,
  [Permission.IncidentMember]: IconProp.Alert,
  [Permission.IncidentViewer]: IconProp.Alert,

  [Permission.AlertAdmin]: IconProp.BellAlert,
  [Permission.AlertMember]: IconProp.BellAlert,
  [Permission.AlertViewer]: IconProp.BellAlert,

  [Permission.MonitorAdmin]: IconProp.Activity,
  [Permission.MonitorMember]: IconProp.Activity,
  [Permission.MonitorViewer]: IconProp.Activity,

  [Permission.StatusPageAdmin]: IconProp.Globe,
  [Permission.StatusPageMember]: IconProp.Globe,
  [Permission.StatusPageViewer]: IconProp.Globe,

  [Permission.OnCallAdmin]: IconProp.Phone,
  [Permission.OnCallMember]: IconProp.Phone,
  [Permission.OnCallViewer]: IconProp.Phone,

  [Permission.ScheduledMaintenanceAdmin]: IconProp.Calendar,
  [Permission.ScheduledMaintenanceMember]: IconProp.Calendar,
  [Permission.ScheduledMaintenanceViewer]: IconProp.Calendar,

  [Permission.TelemetryAdmin]: IconProp.ChartBar,
  [Permission.TelemetryMember]: IconProp.ChartBar,
  [Permission.TelemetryViewer]: IconProp.ChartBar,

  [Permission.SecurityAdmin]: IconProp.ShieldExclamation,
  [Permission.SecurityMember]: IconProp.ShieldExclamation,
  [Permission.SecurityViewer]: IconProp.ShieldExclamation,

  [Permission.SettingsAdmin]: IconProp.Settings,
  [Permission.SettingsMember]: IconProp.Settings,
  [Permission.SettingsViewer]: IconProp.Settings,

  [Permission.BillingAdmin]: IconProp.CreditCard,
  [Permission.BillingMember]: IconProp.CreditCard,
  [Permission.BillingViewer]: IconProp.CreditCard,

  [Permission.WorkflowAdmin]: IconProp.Workflow,
  [Permission.WorkflowMember]: IconProp.Workflow,
  [Permission.WorkflowViewer]: IconProp.Workflow,

  [Permission.RunbookAdmin]: IconProp.PlayCircle,
  [Permission.RunbookMember]: IconProp.PlayCircle,
  [Permission.RunbookViewer]: IconProp.PlayCircle,
};

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

const OWNER_ROLES: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
];

const PROJECT_ROLES: Array<Permission> = [
  Permission.ProjectMember,
  Permission.Viewer,
];

const ADMINISTRATION_ROLES: Array<Permission> = [
  Permission.SettingsAdmin,
  Permission.SettingsMember,
  Permission.SettingsViewer,
  Permission.BillingAdmin,
  Permission.BillingMember,
  Permission.BillingViewer,
];

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
 * Every role, in four groups: Owner (owner and admin of the whole project),
 * Project Roles (member and viewer of the whole project), Administration
 * (settings and billing) and Domain Roles (one product area each). Empty
 * groups are left out.
 */
export const getRoleCardSelectOptions: (
  filter?: RoleCardSelectOptionsFilter,
) => Array<CardSelectOptionGroup> = (
  filter?: RoleCardSelectOptionsFilter,
): Array<CardSelectOptionGroup> => {
  const ownerRoles: Array<CardSelectOption> = [];
  const projectRoles: Array<CardSelectOption> = [];
  const administrationRoles: Array<CardSelectOption> = [];
  const domainRoles: Array<CardSelectOption> = [];

  for (const props of PermissionHelper.getRolePermissionProps()) {
    if (filter?.excludeRoles?.includes(props.permission)) {
      continue;
    }

    const option: CardSelectOption = getRoleCardSelectOption(props, {
      fullDescription: filter?.fullDescriptions,
    });

    if (OWNER_ROLES.includes(props.permission)) {
      ownerRoles.push(option);
    } else if (PROJECT_ROLES.includes(props.permission)) {
      projectRoles.push(option);
    } else if (ADMINISTRATION_ROLES.includes(props.permission)) {
      administrationRoles.push(option);
    } else {
      domainRoles.push(option);
    }
  }

  const groups: Array<CardSelectOptionGroup> = [
    {
      label: "Owner",
      options: ownerRoles,
    },
    {
      label: "Project Roles",
      options: projectRoles,
    },
    {
      label: "Administration",
      options: administrationRoles,
    },
    {
      label: "Domain Roles",
      options: domainRoles,
    },
  ];

  return groups.filter((group: CardSelectOptionGroup): boolean => {
    return group.options.length > 0;
  });
};
