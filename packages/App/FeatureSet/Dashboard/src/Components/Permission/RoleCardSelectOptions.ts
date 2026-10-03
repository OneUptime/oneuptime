import IconProp from "Common/Types/Icon/IconProp";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "Common/Types/Permission";
import {
  CardSelectOption,
  CardSelectOptionGroup,
} from "Common/UI/Components/CardSelect/CardSelect";

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

export const getRoleCardSelectOption: (
  props: PermissionProps,
) => CardSelectOption = (props: PermissionProps): CardSelectOption => {
  return {
    value: props.permission,
    title: props.title,
    description: props.description,
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

/*
 * Every role, in four groups: Owner (owner and admin of the whole project),
 * Project Roles (member and viewer of the whole project), Administration
 * (settings and billing) and Domain Roles (one product area each). Empty
 * groups are left out.
 */
export const getRoleCardSelectOptions: () => Array<CardSelectOptionGroup> =
  (): Array<CardSelectOptionGroup> => {
    const ownerRoles: Array<CardSelectOption> = [];
    const projectRoles: Array<CardSelectOption> = [];
    const administrationRoles: Array<CardSelectOption> = [];
    const domainRoles: Array<CardSelectOption> = [];

    for (const props of PermissionHelper.getRolePermissionProps()) {
      const option: CardSelectOption = getRoleCardSelectOption(props);

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
