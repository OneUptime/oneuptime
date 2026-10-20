import IconProp from "Common/Types/Icon/IconProp";
import Permission from "Common/Types/Permission";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * EVERY BUILT-IN ROLE IS AN ANSWER TO TWO QUESTIONS.
 *
 * "This is very confusing. it gives a lot of information to the user ...
 * Make it natural for people to understand and use." (the maintainer, on
 * the Add a Role dialog: forty look-alike cards under Owner, Project Roles,
 * Administration and Domain Roles, three to a row, two screens of them.)
 *
 * The forty roles are not forty unrelated things. Each one answers:
 *
 *   - how far does it reach? The whole project - Project Owner, Project
 *     Admin, Project Member and Viewer - or one area of it: incidents,
 *     alerts, monitors, billing and the rest;
 *   - and, for one area, how much? Admin, Member or Viewer. Incident
 *     Member is Incidents at Member, Billing Viewer is Billing at Viewer.
 *
 * So that is how they are picked (RolePicker) and listed (the groups of
 * RoleCardSelectOptions): the four whole-project roles most teams and keys
 * need, then twelve areas of three levels each. Only the arrangement is
 * new. The roles, what each grants and every stored value are the ones in
 * Common/Types/Permission, unchanged.
 *
 * Each area wears the icon its product wears in the Products menu
 * (Utils/NavigationItems), so the Incidents area looks like Incidents.
 * Areas are ordered as people meet them: the work of responding first
 * (incidents, alerts, monitors, status pages, on-call, maintenance), then
 * what is observed and secured, then automation, then the project's own
 * settings and billing.
 *
 * Every role is placed exactly once - Common/Tests/App/Dashboard/
 * RoleCatalog.test.ts fails on a role added to Permission and left out
 * here, so a new role is never missing from Add Role. React-free, so tests
 * read it without rendering anything.
 */

// How far a role reaches: the whole project, or one area of it.
export enum RoleReach {
  WholeProject = "WholeProject",
  OneArea = "OneArea",
}

export const ROLE_REACHES: ReadonlyArray<RoleReach> = [
  RoleReach.WholeProject,
  RoleReach.OneArea,
];

// What the two answers are called, in the picker and as list headings.
export const ROLE_REACH_TITLES: Readonly<Record<RoleReach, string>> = {
  [RoleReach.WholeProject]: translationKey("Whole project"),
  [RoleReach.OneArea]: translationKey("One area"),
};

export interface WholeProjectRole {
  permission: Permission;
  icon: IconProp;
}

// The roles that reach the whole project, widest first.
export const WHOLE_PROJECT_ROLES: ReadonlyArray<WholeProjectRole> = [
  { permission: Permission.ProjectOwner, icon: IconProp.ShieldCheck },
  { permission: Permission.ProjectAdmin, icon: IconProp.User },
  { permission: Permission.ProjectMember, icon: IconProp.Team },
  { permission: Permission.Viewer, icon: IconProp.Eye },
];

// How much of one area a role gives.
export enum RoleLevel {
  Admin = "Admin",
  Member = "Member",
  Viewer = "Viewer",
}

// Most first, as each area lists its roles.
export const ROLE_LEVELS: ReadonlyArray<RoleLevel> = [
  RoleLevel.Admin,
  RoleLevel.Member,
  RoleLevel.Viewer,
];

export const ROLE_LEVEL_TITLES: Readonly<Record<RoleLevel, string>> = {
  [RoleLevel.Admin]: translationKey("Admin"),
  [RoleLevel.Member]: translationKey("Member"),
  [RoleLevel.Viewer]: translationKey("Viewer"),
};

/*
 * The level an area starts on, before one is picked: Member, the day-to-day
 * work of the area - what most people given an area's role are there for.
 */
export const DEFAULT_ROLE_LEVEL: RoleLevel = RoleLevel.Member;

export enum RoleAreaId {
  Incidents = "Incidents",
  Alerts = "Alerts",
  Monitors = "Monitors",
  StatusPages = "StatusPages",
  OnCall = "OnCall",
  ScheduledMaintenance = "ScheduledMaintenance",
  Telemetry = "Telemetry",
  Security = "Security",
  Workflows = "Workflows",
  Runbooks = "Runbooks",
  Settings = "Settings",
  Billing = "Billing",
}

export interface RoleArea {
  id: RoleAreaId;
  // English, looked up where it is drawn: the product's own name.
  title: string;
  icon: IconProp;
  // The area's role at each level.
  roles: Readonly<Record<RoleLevel, Permission>>;
}

export const ROLE_AREAS: ReadonlyArray<RoleArea> = [
  {
    id: RoleAreaId.Incidents,
    title: translationKey("Incidents"),
    icon: IconProp.Alert,
    roles: {
      [RoleLevel.Admin]: Permission.IncidentAdmin,
      [RoleLevel.Member]: Permission.IncidentMember,
      [RoleLevel.Viewer]: Permission.IncidentViewer,
    },
  },
  {
    id: RoleAreaId.Alerts,
    title: translationKey("Alerts"),
    icon: IconProp.ExclaimationCircle,
    roles: {
      [RoleLevel.Admin]: Permission.AlertAdmin,
      [RoleLevel.Member]: Permission.AlertMember,
      [RoleLevel.Viewer]: Permission.AlertViewer,
    },
  },
  {
    id: RoleAreaId.Monitors,
    title: translationKey("Monitors"),
    icon: IconProp.AltGlobe,
    roles: {
      [RoleLevel.Admin]: Permission.MonitorAdmin,
      [RoleLevel.Member]: Permission.MonitorMember,
      [RoleLevel.Viewer]: Permission.MonitorViewer,
    },
  },
  {
    id: RoleAreaId.StatusPages,
    title: translationKey("Status Pages"),
    icon: IconProp.CheckCircle,
    roles: {
      [RoleLevel.Admin]: Permission.StatusPageAdmin,
      [RoleLevel.Member]: Permission.StatusPageMember,
      [RoleLevel.Viewer]: Permission.StatusPageViewer,
    },
  },
  {
    id: RoleAreaId.OnCall,
    title: translationKey("On-Call"),
    icon: IconProp.Call,
    roles: {
      [RoleLevel.Admin]: Permission.OnCallAdmin,
      [RoleLevel.Member]: Permission.OnCallMember,
      [RoleLevel.Viewer]: Permission.OnCallViewer,
    },
  },
  {
    id: RoleAreaId.ScheduledMaintenance,
    title: translationKey("Scheduled Maintenance"),
    icon: IconProp.Clock,
    roles: {
      [RoleLevel.Admin]: Permission.ScheduledMaintenanceAdmin,
      [RoleLevel.Member]: Permission.ScheduledMaintenanceMember,
      [RoleLevel.Viewer]: Permission.ScheduledMaintenanceViewer,
    },
  },
  {
    id: RoleAreaId.Telemetry,
    title: translationKey("Telemetry"),
    icon: IconProp.ChartBar,
    roles: {
      [RoleLevel.Admin]: Permission.TelemetryAdmin,
      [RoleLevel.Member]: Permission.TelemetryMember,
      [RoleLevel.Viewer]: Permission.TelemetryViewer,
    },
  },
  {
    id: RoleAreaId.Security,
    title: translationKey("Security"),
    icon: IconProp.ShieldExclamation,
    roles: {
      [RoleLevel.Admin]: Permission.SecurityAdmin,
      [RoleLevel.Member]: Permission.SecurityMember,
      [RoleLevel.Viewer]: Permission.SecurityViewer,
    },
  },
  {
    id: RoleAreaId.Workflows,
    title: translationKey("Workflows"),
    icon: IconProp.FlowDiagram,
    roles: {
      [RoleLevel.Admin]: Permission.WorkflowAdmin,
      [RoleLevel.Member]: Permission.WorkflowMember,
      [RoleLevel.Viewer]: Permission.WorkflowViewer,
    },
  },
  {
    id: RoleAreaId.Runbooks,
    title: translationKey("Runbooks"),
    icon: IconProp.BookOpen,
    roles: {
      [RoleLevel.Admin]: Permission.RunbookAdmin,
      [RoleLevel.Member]: Permission.RunbookMember,
      [RoleLevel.Viewer]: Permission.RunbookViewer,
    },
  },
  {
    id: RoleAreaId.Settings,
    title: translationKey("Settings"),
    icon: IconProp.Settings,
    roles: {
      [RoleLevel.Admin]: Permission.SettingsAdmin,
      [RoleLevel.Member]: Permission.SettingsMember,
      [RoleLevel.Viewer]: Permission.SettingsViewer,
    },
  },
  {
    id: RoleAreaId.Billing,
    title: translationKey("Billing"),
    icon: IconProp.CreditCard,
    roles: {
      [RoleLevel.Admin]: Permission.BillingAdmin,
      [RoleLevel.Member]: Permission.BillingMember,
      [RoleLevel.Viewer]: Permission.BillingViewer,
    },
  },
];

// Where a role sits: its reach, and for an area's role its area and level.
export interface RolePlace {
  reach: RoleReach;
  area: RoleArea | null;
  level: RoleLevel | null;
}

/*
 * Where a role sits in the catalog, or null for anything that is not one
 * of its roles (a single permission, an empty pick, a role added later
 * and not placed yet).
 */
export const getRolePlace: (
  permission: Permission | string | null | undefined,
) => RolePlace | null = (
  permission: Permission | string | null | undefined,
): RolePlace | null => {
  if (!permission) {
    return null;
  }

  if (
    WHOLE_PROJECT_ROLES.some((role: WholeProjectRole): boolean => {
      return role.permission === permission;
    })
  ) {
    return { reach: RoleReach.WholeProject, area: null, level: null };
  }

  for (const area of ROLE_AREAS) {
    for (const level of ROLE_LEVELS) {
      if (area.roles[level] === permission) {
        return { reach: RoleReach.OneArea, area: area, level: level };
      }
    }
  }

  return null;
};

// An area by its id, or null for an id no area has.
export const getRoleArea: (
  areaId: RoleAreaId | string | null | undefined,
) => RoleArea | null = (
  areaId: RoleAreaId | string | null | undefined,
): RoleArea | null => {
  return (
    ROLE_AREAS.find((area: RoleArea): boolean => {
      return area.id === areaId;
    }) || null
  );
};
