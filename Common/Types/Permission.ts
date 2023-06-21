// Have "Project" string in the permission to make sure this permission is by Project.
import Dictionary from './Dictionary';
import BadDataException from './Exception/BadDataException';
import { JSONObject } from './JSON';
import ObjectID from './ObjectID';

export interface PermissionProps {
    permission: Permission;
    description: string;
    isAssignableToTenant: boolean;
    title: string;
    isAccessControlPermission: boolean;
}

enum Permission {
    // All users in the project will have this permission.
    ProjectUser = 'ProjectUser',

    // Users who are in the project but do not have SSO authorization.
    UnAuthorizedSsoUser = 'UnAuthorizedSsoUser',

    // Owner of a Project
    ProjectOwner = 'ProjectOwner',

    // Project Admin
    ProjectAdmin = 'ProjectAdmin',

    ProjectMember = 'ProjectMember', // member of a project

    User = 'User', //registered user. Can or cannot belong to a project.

    CurrentUser = 'CurrentUser', // Current logged in user.

    CustomerSupport = 'CustomerSupport', // Customer Support for OneUptime.

    Public = 'Public', // non-registered user. Everyone has this permission.

    // Billing Permissions (Owner Permission)
    CanCreateProjectApiKey = 'CanCreateProjectApiKey',
    CanDeleteProjectApiKey = 'CanDeleteProjectApiKey',
    CanReadProjectApiKey = 'CanReadProjectApiKey',
    CanEditProjectApiKey = 'CanEditProjectApiKey',
    CanEditProjectApiKeyPermissions = 'CanEditProjectApiKeyPermissions',

    // Billing Permissions (Owner Permission)
    CanManageProjectBilling = 'CanManageProjectBilling',

    // Billing Permissions (Owner Permission)
    CanCreateProjectTeam = 'CanCreateProjectTeam',
    CanDeleteProjectTeam = 'CanDeleteProjectTeam',
    CanReadProjectTeam = 'CanReadProjectTeam',
    CanEditProjectTeam = 'CanEditProjectTeam',
    CanInviteProjectTeamMembers = 'CanInviteProjectTeamMembers',
    CanEditProjectTeamPermissions = 'CanEditProjectTeamPermissions',

    CanCreateProjectProbe = 'CanCreateProjectProbe',
    CanDeleteProjectProbe = 'CanDeleteProjectProbe',
    CanEditProjectProbe = 'CanEditProjectProbe',
    CanReadProjectProbe = 'CanReadProjectProbe',

    CanCreateMonitorCustomField = 'CanCreateMonitorCustomField',
    CanDeleteMonitorCustomField = 'CanDeleteMonitorCustomField',
    CanEditMonitorCustomField = 'CanEditMonitorCustomField',
    CanReadMonitorCustomField = 'CanReadMonitorCustomField',

    CanCreateOnCallDutyPolicyCustomField = 'CanCreateOnCallDutyPolicyCustomField',
    CanDeleteOnCallDutyPolicyCustomField = 'CanDeleteOnCallDutyPolicyCustomField',
    CanEditOnCallDutyPolicyCustomField = 'CanEditOnCallDutyPolicyCustomField',
    CanReadOnCallDutyPolicyCustomField = 'CanReadOnCallDutyPolicyCustomField',

    CanCreateScheduledMaintenanceCustomField = 'CanCreateScheduledMaintenanceCustomField',
    CanDeleteScheduledMaintenanceCustomField = 'CanDeleteScheduledMaintenanceCustomField',
    CanEditScheduledMaintenanceCustomField = 'CanEditScheduledMaintenanceCustomField',
    CanReadScheduledMaintenanceCustomField = 'CanReadScheduledMaintenanceCustomField',

    CanCreateMonitorProbe = 'CanCreateMonitorProbe',
    CanDeleteMonitorProbe = 'CanDeleteMonitorProbe',
    CanEditMonitorProbe = 'CanEditMonitorProbe',
    CanReadMonitorProbe = 'CanReadMonitorProbe',

    CanReadSmsLog = 'CanReadSmsLog',

    CanReadCallLog = 'CanReadCallLog',

    CanCreateIncidentOwnerTeam = 'CanCreateIncidentOwnerTeam',
    CanDeleteIncidentOwnerTeam = 'CanDeleteIncidentOwnerTeam',
    CanEditIncidentOwnerTeam = 'CanEditIncidentOwnerTeam',
    CanReadIncidentOwnerTeam = 'CanReadIncidentOwnerTeam',

    CanCreateIncidentOwnerUser = 'CanCreateIncidentOwner',
    CanDeleteIncidentOwnerUser = 'CanDeleteIncidentOwnerUser',
    CanEditIncidentOwnerUser = 'CanEditIncidentOwnerUser',
    CanReadIncidentOwnerUser = 'CanReadIncidentOwnerUser',

    CanCreateScheduledMaintenanceOwnerTeam = 'CanCreateScheduledMaintenanceOwnerTeam',
    CanDeleteScheduledMaintenanceOwnerTeam = 'CanDeleteScheduledMaintenanceOwnerTeam',
    CanEditScheduledMaintenanceOwnerTeam = 'CanEditScheduledMaintenanceOwnerTeam',
    CanReadScheduledMaintenanceOwnerTeam = 'CanReadScheduledMaintenanceOwnerTeam',

    CanCreateScheduledMaintenanceOwnerUser = 'CanCreateScheduledMaintenanceOwner',
    CanDeleteScheduledMaintenanceOwnerUser = 'CanDeleteScheduledMaintenanceOwnerUser',
    CanEditScheduledMaintenanceOwnerUser = 'CanEditScheduledMaintenanceOwnerUser',
    CanReadScheduledMaintenanceOwnerUser = 'CanReadScheduledMaintenanceOwnerUser',

    CanCreateStatusPageOwnerTeam = 'CanCreateStatusPageOwnerTeam',
    CanDeleteStatusPageOwnerTeam = 'CanDeleteStatusPageOwnerTeam',
    CanEditStatusPageOwnerTeam = 'CanEditStatusPageOwnerTeam',
    CanReadStatusPageOwnerTeam = 'CanReadStatusPageOwnerTeam',

    CanCreateStatusPageOwnerUser = 'CanCreateStatusPageOwner',
    CanDeleteStatusPageOwnerUser = 'CanDeleteStatusPageOwnerUser',
    CanEditStatusPageOwnerUser = 'CanEditStatusPageOwnerUser',
    CanReadStatusPageOwnerUser = 'CanReadStatusPageOwnerUser',

    CanCreateMonitorOwnerTeam = 'CanCreateMonitorOwnerTeam',
    CanDeleteMonitorOwnerTeam = 'CanDeleteMonitorOwnerTeam',
    CanEditMonitorOwnerTeam = 'CanEditMonitorOwnerTeam',
    CanReadMonitorOwnerTeam = 'CanReadMonitorOwnerTeam',

    CanCreateMonitorOwnerUser = 'CanCreateMonitorOwner',
    CanDeleteMonitorOwnerUser = 'CanDeleteMonitorOwnerUser',
    CanEditMonitorOwnerUser = 'CanEditMonitorOwnerUser',
    CanReadMonitorOwnerUser = 'CanReadMonitorOwnerUser',

    CanCreateStatusPageCustomField = 'CanCreateStatusPageCustomField',
    CanDeleteStatusPageCustomField = 'CanDeleteStatusPageCustomField',
    CanEditStatusPageCustomField = 'CanEditStatusPageCustomField',
    CanReadStatusPageCustomField = 'CanReadStatusPageCustomField',

    CanCreateIncidentCustomField = 'CanCreateIncidentCustomField',
    CanDeleteIncidentCustomField = 'CanDeleteIncidentCustomField',
    CanEditIncidentCustomField = 'CanEditIncidentCustomField',
    CanReadIncidentCustomField = 'CanReadIncidentCustomField',

    CanCreateProjectIncident = 'CanCreateProjectIncident',
    CanDeleteProjectIncident = 'CanDeleteProjectIncident',
    CanEditProjectIncident = 'CanEditProjectIncident',
    CanReadProjectIncident = 'CanReadProjectIncident',

    CanCreateStatusPageSubscriber = 'CanCreateStatusPageSubscriber',
    CanDeleteStatusPageSubscriber = 'CanDeleteStatusPageSubscriber',
    CanEditStatusPageSubscriber = 'CanEditStatusPageSubscriber',
    CanReadStatusPageSubscriber = 'CanReadStatusPageSubscriber',

    CanCreateStatusPagePrivateUser = 'CanCreateStatusPagePrivateUser',
    CanDeleteStatusPagePrivateUser = 'CanDeleteStatusPagePrivateUser',
    CanEditStatusPagePrivateUser = 'CanEditStatusPagePrivateUser',
    CanReadStatusPagePrivateUser = 'CanReadStatusPagePrivateUser',

    CanCreateProjectDomain = 'CanCreateProjectDomain',
    CanDeleteProjectDomain = 'CanDeleteProjectDomain',
    CanEditProjectDomain = 'CanEditProjectDomain',
    CanReadProjectDomain = 'CanReadProjectDomain',

    CanCreateStatusPageHeaderLink = 'CanCreateStatusPageHeaderLink',
    CanDeleteStatusPageHeaderLink = 'CanDeleteStatusPageHeaderLink',
    CanEditStatusPageHeaderLink = 'CanEditStatusPageHeaderLink',
    CanReadStatusPageHeaderLink = 'CanReadStatusPageHeaderLink',

    CanCreateStatusPageFooterLink = 'CanCreateStatusPageFooterLink',
    CanDeleteStatusPageFooterLink = 'CanDeleteStatusPageFooterLink',
    CanEditStatusPageFooterLink = 'CanEditStatusPageFooterLink',
    CanReadStatusPageFooterLink = 'CanReadStatusPageFooterLink',

    CanCreateStatusPageResource = 'CanCreateStatusPageResource',
    CanDeleteStatusPageResource = 'CanDeleteStatusPageResource',
    CanEditStatusPageResource = 'CanEditStatusPageResource',
    CanReadStatusPageResource = 'CanReadStatusPageResource',

    CanCreateWorkflow = 'CanCreateWorkflow',
    CanDeleteWorkflow = 'CanDeleteWorkflow',
    CanEditWorkflow = 'CanEditWorkflow',
    CanReadWorkflow = 'CanReadWorkflow',

    CanDeleteProject = 'CanDeleteProject',
    CanEditProject = 'CanEditProject',
    CanReadProject = 'CanReadProject',

    CanCreateWorkflowLog = 'CanCreateWorkflowLog',
    CanDeleteWorkflowLog = 'CanDeleteWorkflowLog',
    CanEditWorkflowLog = 'CanEditWorkflowLog',
    CanReadWorkflowLog = 'CanReadWorkflowLog',

    CanCreateWorkflowVariable = 'CanCreateWorkflowVariable',
    CanDeleteWorkflowVariable = 'CanDeleteWorkflowVariable',
    CanEditWorkflowVariable = 'CanEditWorkflowVariable',
    CanReadWorkflowVariable = 'CanReadWorkflowVariable',

    CanCreateStatusPageGroup = 'CanCreateStatusPageGroup',
    CanDeleteStatusPageGroup = 'CanDeleteStatusPageGroup',
    CanEditStatusPageGroup = 'CanEditStatusPageGroup',
    CanReadStatusPageGroup = 'CanReadStatusPageGroup',

    CanCreateStatusPageDomain = 'CanCreateStatusPageDomain',
    CanDeleteStatusPageDomain = 'CanDeleteStatusPageDomain',
    CanEditStatusPageDomain = 'CanEditStatusPageDomain',
    CanReadStatusPageDomain = 'CanReadStatusPageDomain',

    CanCreateProjectSSO = 'CanCreateProjectSSO',
    CanDeleteProjectSSO = 'CanDeleteProjectSSO',
    CanEditProjectSSO = 'CanEditProjectSSO',
    CanReadProjectSSO = 'CanReadProjectSSO',

    CanCreateStatusPageSSO = 'CanCreateStatusPageSSO',
    CanDeleteStatusPageSSO = 'CanDeleteStatusPageSSO',
    CanEditStatusPageSSO = 'CanEditStatusPageSSO',
    CanReadStatusPageSSO = 'CanReadStatusPageSSO',

    // Label Permissions (Owner + Admin Permission by default)
    CanCreateProjectLabel = 'CanCreateProjectLabel',
    CanEditProjectLabel = 'CanEditProjectLabel',
    CanReadProjectLabel = 'CanReadProjectLabel',
    CanDeleteProjectLabel = 'CanDeleteProjectLabel',
    CanAddLabelsToProjectResources = 'CanAddLabelsToProjectResources',

    // Scheduled Maintenance

    // Scheduled Maintenance Status Permissions (Owner + Admin Permission by default)
    CanCreateScheduledMaintenanceState = 'CanCreateScheduledMaintenanceState',
    CanEditScheduledMaintenanceState = 'CanEditScheduledMaintenanceState',
    CanReadScheduledMaintenanceState = 'CanReadScheduledMaintenanceState',
    CanDeleteScheduledMaintenanceState = 'CanDeleteScheduledMaintenanceState',

    // Scheduled Maintenance Status Permissions (Owner + Admin Permission by default)
    CanCreateScheduledMaintenanceStateTimeline = 'CanCreateScheduledMaintenanceStateTimeline',
    CanEditScheduledMaintenanceStateTimeline = 'CanEditScheduledMaintenanceStateTimeline',
    CanReadScheduledMaintenanceStateTimeline = 'CanReadScheduledMaintenanceStateTimeline',
    CanDeleteScheduledMaintenanceStateTimeline = 'CanDeleteScheduledMaintenanceStateTimeline',

    // Resource Permissions (Team Permission)
    CanCreateScheduledMaintenanceInternalNote = 'CanCreateScheduledMaintenanceInternalNote',
    CanEditScheduledMaintenanceInternalNote = 'CanEditScheduledMaintenanceInternalNote',
    CanDeleteScheduledMaintenanceInternalNote = 'CanDeleteScheduledMaintenanceInternalNote',
    CanReadScheduledMaintenanceInternalNote = 'CanReadScheduledMaintenanceInternalNote',

    CanCreateScheduledMaintenancePublicNote = 'CanCreateScheduledMaintenancePublicNote',
    CanEditScheduledMaintenancePublicNote = 'CanEditScheduledMaintenancePublicNote',
    CanDeleteScheduledMaintenancePublicNote = 'CanDeleteScheduledMaintenancePublicNote',
    CanReadScheduledMaintenancePublicNote = 'CanReadScheduledMaintenancePublicNote',

    CanCreateProjectScheduledMaintenance = 'CanCreateProjectScheduledMaintenance',
    CanDeleteProjectScheduledMaintenance = 'CanDeleteProjectScheduledMaintenance',
    CanEditProjectScheduledMaintenance = 'CanEditProjectScheduledMaintenance',
    CanReadProjectScheduledMaintenance = 'CanReadProjectScheduledMaintenance',

    // Incident Status Permissions (Owner + Admin Permission by default)
    CanCreateIncidentState = 'CanCreateIncidentState',
    CanEditIncidentState = 'CanEditIncidentState',
    CanReadIncidentState = 'CanReadIncidentState',
    CanDeleteIncidentState = 'CanDeleteIncidentState',

    // Incident Status Permissions (Owner + Admin Permission by default)
    CanCreateIncidentStateTimeline = 'CanCreateIncidentStateTimeline',
    CanEditIncidentStateTimeline = 'CanEditIncidentStateTimeline',
    CanReadIncidentStateTimeline = 'CanReadIncidentStateTimeline',
    CanDeleteIncidentStateTimeline = 'CanDeleteIncidentStateTimeline',

    // MonitorStatus Permissions (Owner + Admin Permission by default)
    CanCreateProjectMonitorStatus = 'CanCreateProjectMonitorStatus',
    CanEditProjectMonitorStatus = 'CanEditProjectMonitorStatus',
    CanReadProjectMonitorStatus = 'CanReadProjectMonitorStatus',
    CanDeleteProjectMonitorStatus = 'CanDeleteProjectMonitorStatus',

    // MonitorStatus Permissions (Owner + Admin Permission by default)
    CanCreateStatusPageAnnouncement = 'CanCreateStatusPageAnnouncement',
    CanEditStatusPageAnnouncement = 'CanEditStatusPageAnnouncement',
    CanReadStatusPageAnnouncement = 'CanReadStatusPageAnnouncement',
    CanDeleteStatusPageAnnouncement = 'CanDeleteStatusPageAnnouncement',

    // Resource Permissions (Team Permission)
    CanCreateIncidentInternalNote = 'CanCreateIncidentInternalNote',
    CanEditIncidentInternalNote = 'CanEditIncidentInternalNote',
    CanDeleteIncidentInternalNote = 'CanDeleteIncidentInternalNote',
    CanReadIncidentInternalNote = 'CanReadIncidentInternalNote',

    CanCreateIncidentPublicNote = 'CanCreateIncidentPublicNote',
    CanEditIncidentPublicNote = 'CanEditIncidentPublicNote',
    CanDeleteIncidentPublicNote = 'CanDeleteIncidentPublicNote',
    CanReadIncidentPublicNote = 'CanReadIncidentPublicNote',

    CanCreateInvoices = 'CanCreateInvoices',
    CanEditInvoices = 'CanEditInvoices',
    CanDeleteInvoices = 'CanDeleteInvoices',
    CanReadInvoices = 'CanReadInvoices',

    CanCreateBillingPaymentMethod = 'CanCreateBillingPaymentMethod',
    CanEditBillingPaymentMethod = 'CanEditBillingPaymentMethod',
    CanDeleteBillingPaymentMethod = 'CanDeleteBillingPaymentMethod',
    CanReadBillingPaymentMethod = 'CanReadBillingPaymentMethod',

    CanCreateProjectMonitor = 'CanCreateProjectMonitor',
    CanEditProjectMonitor = 'CanEditProjectMonitor',
    CanDeleteProjectMonitor = 'CanDeleteProjectMonitor',
    CanReadProjectMonitor = 'CanReadProjectMonitor',

    // Resource Permissions (Team Permission)
    CanCreateProjectStatusPage = 'CanCreateProjectStatusPage',
    CanEditProjectStatusPage = 'CanEditProjectStatusPage',
    CanDeleteProjectStatusPage = 'CanDeleteProjectStatusPage',
    CanReadProjectStatusPage = 'CanReadProjectStatusPage',

    // Resource Permissions (Team Permission)
    CanCreateProjectOnCallDutyPolicy = 'CanCreateProjectOnCallDutyPolicy',
    CanEditProjectOnCallDutyPolicy = 'CanEditProjectOnCallDutyPolicy',
    CanDeleteProjectOnCallDutyPolicy = 'CanDeleteProjectOnCallDutyPolicy',
    CanReadProjectOnCallDutyPolicy = 'CanReadProjectOnCallDutyPolicy',

    CanReadProjectOnCallDutyPolicyExecutionLogTimeline = 'CanReadProjectOnCallDutyPolicyExecutionLogTimeline',
    CanReadProjectOnCallDutyPolicyExecutionLog = 'CanReadProjectOnCallDutyPolicyExecutionLog',

    // Resource Permissions (Team Permission)
    CanCreateProjectOnCallDutyPolicyEscalationRule = 'CanCreateProjectOnCallDutyPolicyEscalationRule',
    CanEditProjectOnCallDutyPolicyEscalationRule = 'CanEditProjectOnCallDutyPolicyEscalationRule',
    CanDeleteProjectOnCallDutyPolicyEscalationRule = 'CanDeleteProjectOnCallDutyPolicyEscalationRule',
    CanReadProjectOnCallDutyPolicyEscalationRule = 'CanReadProjectOnCallDutyPolicyEscalationRule',

    // Resource Permissions (Team Permission)
    CanCreateProjectOnCallDutyPolicyEscalationRuleUser = 'CanCreateProjectOnCallDutyPolicyEscalationRuleUser',
    CanEditProjectOnCallDutyPolicyEscalationRuleUser = 'CanEditProjectOnCallDutyPolicyEscalationRuleUser',
    CanDeleteProjectOnCallDutyPolicyEscalationRuleUser = 'CanDeleteProjectOnCallDutyPolicyEscalationRuleUser',
    CanReadProjectOnCallDutyPolicyEscalationRuleUser = 'CanReadProjectOnCallDutyPolicyEscalationRuleUser',

    // Resource Permissions (Team Permission)
    CanCreateProjectOnCallDutyPolicyEscalationRuleTeam = 'CanCreateProjectOnCallDutyPolicyEscalationRuleTeam',
    CanEditProjectOnCallDutyPolicyEscalationRuleTeam = 'CanEditProjectOnCallDutyPolicyEscalationRuleTeam',
    CanDeleteProjectOnCallDutyPolicyEscalationRuleTeam = 'CanDeleteProjectOnCallDutyPolicyEscalationRuleTeam',
    CanReadProjectOnCallDutyPolicyEscalationRuleTeam = 'CanReadProjectOnCallDutyPolicyEscalationRuleTeam',

    // Project SMTP Config (Team Permission)
    CanCreateProjectSMTPConfig = 'CanCreateProjectSMTPConfig',
    CanEditProjectSMTPConfig = 'CanEditProjectSMTPConfig',
    CanDeleteProjectSMTPConfig = 'CanDeleteProjectSMTPConfig',
    CanReadProjectSMTPConfig = 'CanReadProjectSMTPConfig',

    // Project SMTP Config (Team Permission)
    CanCreateIncidentSeverity = 'CanCreateIncidentSeverity',
    CanEditIncidentSeverity = 'CanEditIncidentSeverity',
    CanDeleteIncidentSeverity = 'CanDeleteIncidentSeverity',
    CanReadIncidentSeverity = 'CanReadIncidentSeverity',
}

export class PermissionHelper {
    public static doesPermissionsIntersect(
        permissions1: Array<Permission>,
        permissions2: Array<Permission>
    ): boolean {
        if (!permissions1) {
            permissions1 = [];
        }

        if (!permissions2) {
            permissions2 = [];
        }
        return (
            permissions1.filter((value: Permission) => {
                return permissions2.includes(value);
            }).length > 0
        );
    }

    public static getIntersectingPermissions(
        permissions1: Array<Permission>,
        permissions2: Array<Permission>
    ): Array<Permission> {
        return permissions1.filter((value: Permission) => {
            return permissions2.includes(value);
        });
    }

    public static getTenantPermissionProps(): Array<PermissionProps> {
        return this.getAllPermissionProps().filter((item: PermissionProps) => {
            return item.isAssignableToTenant;
        });
    }

    public static getAccessControlPermissionProps(): Array<PermissionProps> {
        return this.getAllPermissionProps().filter((item: PermissionProps) => {
            return item.isAccessControlPermission;
        });
    }

    public static isAccessControlPermission(permission: Permission): boolean {
        return (
            this.getAllPermissionProps()
                .filter((item: PermissionProps) => {
                    return item.permission === permission;
                })
                .filter((prop: PermissionProps) => {
                    return prop.isAccessControlPermission;
                }).length > 0
        );
    }

    public static getNonAccessControlPermissions(
        userPermissions: Array<UserPermission>
    ): Array<Permission> {
        return userPermissions
            .filter((i: UserPermission) => {
                return (
                    i.labelIds.length === 0 ||
                    !PermissionHelper.isAccessControlPermission(i.permission)
                );
            })
            .map((i: UserPermission) => {
                return i.permission;
            });
    }

    public static getAccessControlPermissions(
        userPermissions: Array<UserPermission>
    ): Array<UserPermission> {
        return userPermissions.filter((i: UserPermission) => {
            return (
                i.labelIds.length > 0 &&
                PermissionHelper.isAccessControlPermission(i.permission)
            );
        });
    }

    public static getDescription(permission: Permission): string {
        const permissionProps: Array<PermissionProps> =
            this.getAllPermissionProps().filter((item: PermissionProps) => {
                return item.permission === permission;
            });

        if (!permissionProps[0]) {
            throw new BadDataException(
                `${permission} does not have permission props`
            );
        }

        return permissionProps[0].description;
    }

    public static getTitle(permission: Permission): string {
        const permissionProps: Array<PermissionProps> =
            this.getAllPermissionProps().filter((item: PermissionProps) => {
                return item.permission === permission;
            });

        if (!permissionProps[0]) {
            throw new BadDataException(
                `${permission} does not have permission props`
            );
        }

        return permissionProps[0].title;
    }

    public static getPermissionTitles(
        permissions: Array<Permission>
    ): Array<string> {
        const props: Array<PermissionProps> = this.getAllPermissionProps();
        const titles: Array<string> = [];

        for (const permission of permissions) {
            const permissionProp: PermissionProps | undefined = props.find(
                (item: PermissionProps) => {
                    return item.permission === permission;
                }
            );

            if (permissionProp) {
                titles.push(permissionProp.title);
            }
        }

        return titles;
    }

    public static getAllPermissionProps(): Array<PermissionProps> {
        const permissions: Array<PermissionProps> = [
            {
                permission: Permission.ProjectOwner,
                title: 'Project Owner',
                description:
                    'Owner of this project, manages billing, inviting other admins to this project, and can delete this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.ProjectMember,
                title: 'Project Member',
                description:
                    'Member of this project. Can view most resources unless restricted.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.ProjectAdmin,
                title: 'Project Admin',
                description:
                    'Owner of this project, manages billing, inviting other admins to this project, and can delete this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CurrentUser,
                title: 'Logged in User',
                description:
                    'This permission is assigned to any registered user.',
                isAssignableToTenant: false,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CustomerSupport,
                title: 'Customer Support',
                description: 'Customer Support Resource of OneUptime.',
                isAssignableToTenant: false,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.User,
                title: 'User',
                description:
                    'Owner of this project, manages billing, inviting other admins to this project, and can delete this project.',
                isAssignableToTenant: false,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.Public,
                title: 'Public',
                description:
                    'Non registered user. Typically used for sign up or log in.',
                isAssignableToTenant: false,
                isAccessControlPermission: false,
            },

            {
                permission: Permission.CanManageProjectBilling,
                title: 'Can Manage Billing',
                description: 'This permission can update project billing.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanCreateProjectApiKey,
                title: 'Can Create API Key',
                description:
                    'This permission can create api keys of this project',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanDeleteProjectApiKey,
                title: 'Can Delete API Key',
                description:
                    'This permission  can delete api keys of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanEditProjectApiKeyPermissions,
                title: 'Can Edit API Key Permissions',
                description:
                    'This permission  can edit api key permissions of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanEditProjectApiKey,
                title: 'Can Edit API Key',
                description:
                    'This permission can edit api keys of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanReadProjectApiKey,
                title: 'Can Read API Key',
                description:
                    'This permission  can read api keys of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },

            {
                permission: Permission.CanCreateProjectLabel,
                title: 'Can Create Label',
                description: 'This permission can create labels this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanDeleteProjectLabel,
                title: 'Can Delete Label',
                description:
                    'This permission  can delete labels of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanAddLabelsToProjectResources,
                title: 'Can Add Label to Resources',
                description:
                    'This permission can add project labels to resources of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanEditProjectLabel,
                title: 'Can Edit Label',
                description: 'This permission can edit labels of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanReadProjectLabel,
                title: 'Can Read Label',
                description:
                    'This permission  can read labels of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },

            {
                permission: Permission.CanCreateIncidentState,
                title: 'Can Create Incident State',
                description:
                    'This permission can create incident states this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanDeleteIncidentState,
                title: 'Can Delete Incident State',
                description:
                    'This permission  can delete incident states of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanEditIncidentState,
                title: 'Can Edit Incident State',
                description:
                    'This permission can edit incident states of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanReadIncidentState,
                title: 'Can Read Incident State',
                description:
                    'This permission  can read incident states of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },

            {
                permission: Permission.CanCreateIncidentStateTimeline,
                title: 'Can Create Incident State Timeline',
                description:
                    'This permission can create incident state history of an incident in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanDeleteIncidentStateTimeline,
                title: 'Can Delete Incident State Timeline',
                description:
                    'This permission  can delete incident state history of an incident in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanEditIncidentStateTimeline,
                title: 'Can Edit Incident State Timeline',
                description:
                    'This permission can edit incident state history of an incident in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanReadIncidentStateTimeline,
                title: 'Can Read Incident State Timeline',
                description:
                    'This permission can read incident state history of an incident in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },

            {
                permission: Permission.CanCreateProjectMonitorStatus,
                title: 'Can Create Monitor Status',
                description:
                    'This permission can create monitor statuses this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanDeleteProjectMonitorStatus,
                title: 'Can Delete Monitor Status',
                description:
                    'This permission  can delete monitor statuses of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanEditProjectMonitorStatus,
                title: 'Can Edit Monitor Status',
                description:
                    'This permission can edit monitor statuses of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanReadProjectMonitorStatus,
                title: 'Can Read Monitor Status',
                description:
                    'This permission  can read monitor statuses of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },

            {
                permission: Permission.CanCreateStatusPageAnnouncement,
                title: 'Can Create Status Page Announcement',
                description:
                    'This permission can create Status Page Announcement this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanDeleteStatusPageAnnouncement,
                title: 'Can Delete Status Page Announcement',
                description:
                    'This permission  can delete Status Page Announcement of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanEditStatusPageAnnouncement,
                title: 'Can Edit Status Page Announcement',
                description:
                    'This permission can edit Status Page Announcement of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanReadStatusPageAnnouncement,
                title: 'Can Read Status Page Announcement',
                description:
                    'This permission  can read Status Page Announcement of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },

            {
                permission: Permission.CanCreateStatusPageAnnouncement,
                title: 'Can Create Monitor Status',
                description:
                    'This permission can create monitor statuses this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanDeleteStatusPageAnnouncement,
                title: 'Can Delete Monitor Status',
                description:
                    'This permission  can delete monitor statuses of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanEditStatusPageAnnouncement,
                title: 'Can Edit Monitor Status',
                description:
                    'This permission can edit monitor statuses of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanReadStatusPageAnnouncement,
                title: 'Can Read Monitor Status',
                description:
                    'This permission  can read monitor statuses of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },

            {
                permission: Permission.CanCreateProjectDomain,
                title: 'Can Create Domain',
                description:
                    'This permission can create Domain in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanDeleteProjectDomain,
                title: 'Can Delete Domain',
                description:
                    'This permission  can delete Domain in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanEditProjectDomain,
                title: 'Can Edit Domain',
                description: 'This permission can edit Domain in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanReadProjectDomain,
                title: 'Can Read Domain',
                description:
                    'This permission  can read Domain in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },

            {
                permission: Permission.CanCreateStatusPageHeaderLink,
                title: 'Can Create Header Link',
                description:
                    'This permission can create Header Link in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanDeleteStatusPageHeaderLink,
                title: 'Can Delete Header Link',
                description:
                    'This permission  can delete Header Link in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanEditStatusPageHeaderLink,
                title: 'Can Edit Header Link',
                description:
                    'This permission can edit Header Link in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanReadStatusPageHeaderLink,
                title: 'Can Read Header Link',
                description:
                    'This permission  can read Header Link in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },

            {
                permission: Permission.CanCreateStatusPageFooterLink,
                title: 'Can Create Footer Link',
                description:
                    'This permission can create Footer Link in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanDeleteStatusPageFooterLink,
                title: 'Can Delete Footer Link',
                description:
                    'This permission  can delete Footer Link in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanEditStatusPageFooterLink,
                title: 'Can Edit Footer Link',
                description:
                    'This permission can edit Footer Link in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanReadStatusPageFooterLink,
                title: 'Can Read Footer Link',
                description:
                    'This permission  can read Footer Link in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },

            {
                permission: Permission.CanCreateStatusPageResource,
                title: 'Can Create Status Page Resource',
                description:
                    'This permission can create Status Page Resource in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanDeleteStatusPageResource,
                title: 'Can Delete Status Page Resource',
                description:
                    'This permission  can delete Status Page Resource in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanEditStatusPageResource,
                title: 'Can Edit Status Page Resource',
                description:
                    'This permission can edit Status Page Resource in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanReadStatusPageResource,
                title: 'Can Read Status Page Resource',
                description:
                    'This permission  can read Status Page Resource in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },

            {
                permission: Permission.CanCreateWorkflow,
                title: 'Can Create Workflow',
                description:
                    'This permission can create Workflow in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanDeleteWorkflow,
                title: 'Can Delete Workflow',
                description:
                    'This permission  can delete Workflow in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanEditWorkflow,
                title: 'Can Edit Workflow',
                description:
                    'This permission can edit Workflow in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanReadWorkflow,
                title: 'Can Read Workflow',
                description:
                    'This permission  can read Workflow in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },

            {
                permission: Permission.CanDeleteProject,
                title: 'Can Delete Project',
                description: 'This permission  can delete Project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanEditProject,
                title: 'Can Edit Project',
                description: 'This permission can edit Project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanReadProject,
                title: 'Can Read Project',
                description: 'This permission  can read this Project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },

            {
                permission: Permission.CanCreateWorkflowVariable,
                title: 'Can Create Workflow Variables',
                description:
                    'This permission can create Workflow Variables in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanDeleteWorkflowVariable,
                title: 'Can Delete Workflow Variables',
                description:
                    'This permission  can delete Workflow Variables in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanEditWorkflowVariable,
                title: 'Can Edit Workflow Variables',
                description:
                    'This permission can edit Workflow Variables in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanReadWorkflowVariable,
                title: 'Can Read Workflow Variables',
                description:
                    'This permission  can read Workflow Variables in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },

            {
                permission: Permission.CanCreateWorkflowLog,
                title: 'Can Create Workflow Log',
                description:
                    'This permission can create Workflow Log in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanDeleteWorkflowLog,
                title: 'Can Delete Workflow Log',
                description:
                    'This permission  can delete Workflow Log in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanEditWorkflowLog,
                title: 'Can Edit Workflow Log',
                description:
                    'This permission can edit Workflow Log in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanReadWorkflowLog,
                title: 'Can Read Workflow Log',
                description:
                    'This permission  can read Workflow Log in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },

            {
                permission: Permission.CanCreateStatusPageGroup,
                title: 'Can Create Status Page Group',
                description:
                    'This permission can create Status Page Group in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanDeleteStatusPageGroup,
                title: 'Can Delete Status Page Group',
                description:
                    'This permission  can delete Status Page Group in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanEditStatusPageGroup,
                title: 'Can Edit Status Page Group',
                description:
                    'This permission can edit Status Page Group in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanReadStatusPageGroup,
                title: 'Can Read Status Page Group',
                description:
                    'This permission  can read Status Page Group in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },

            {
                permission: Permission.CanCreateStatusPageDomain,
                title: 'Can Create Status Page Domain',
                description:
                    'This permission can create Status Page Domain in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanDeleteStatusPageDomain,
                title: 'Can Delete Status Page Domain',
                description:
                    'This permission  can delete Status Page Domain in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanEditStatusPageDomain,
                title: 'Can Edit Status Page Domain',
                description:
                    'This permission can edit Status Page Domain in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanReadStatusPageDomain,
                title: 'Can Read Status Page Domain',
                description:
                    'This permission  can read Status Page Domain in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },

            {
                permission: Permission.CanCreateProjectSSO,
                title: 'Can Create Project SSO',
                description:
                    'This permission can create Project SSO in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanDeleteProjectSSO,
                title: 'Can Delete Project SSO',
                description:
                    'This permission  can delete Project SSO in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanEditProjectSSO,
                title: 'Can Edit Project SSO',
                description:
                    'This permission can edit Project SSO in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanReadProjectSSO,
                title: 'Can Read Project SSO',
                description:
                    'This permission  can read Project SSO in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },

            {
                permission: Permission.CanCreateStatusPageSSO,
                title: 'Can Create Status Page SSO',
                description:
                    'This permission can create Status Page SSO in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanDeleteStatusPageSSO,
                title: 'Can Delete Status Page SSO',
                description:
                    'This permission  can delete Status Page SSO in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanEditStatusPageSSO,
                title: 'Can Edit Status Page SSO',
                description:
                    'This permission can edit Status Page SSO in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanReadStatusPageSSO,
                title: 'Can Read Status Page SSO',
                description:
                    'This permission  can read Status Page SSO in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },

            {
                permission: Permission.CanCreateProjectSMTPConfig,
                title: 'Can Create SMTP Config',
                description:
                    'This permission can create SMTP configs this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanDeleteProjectSMTPConfig,
                title: 'Can Delete SMTP Config',
                description:
                    'This permission  can delete SMTP configs of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanEditProjectSMTPConfig,
                title: 'Can Edit SMTP Config',
                description:
                    'This permission can edit SMTP configs of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanReadProjectSMTPConfig,
                title: 'Can Read SMTP Config',
                description:
                    'This permission  can read SMTP configs of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },

            {
                permission: Permission.CanCreateStatusPageDomain,
                title: 'Can Create Status Page Domain',
                description:
                    'This permission can create Status Page Domain in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanDeleteStatusPageDomain,
                title: 'Can Delete Status Page Domain',
                description:
                    'This permission  can delete Status Page Domain in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanEditStatusPageDomain,
                title: 'Can Edit Status Page Domain',
                description:
                    'This permission can edit Status Page Domain in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanReadStatusPageDomain,
                title: 'Can Read Status Page Domain',
                description:
                    'This permission  can read Status Page Domain in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },

            {
                permission: Permission.CanCreateIncidentSeverity,
                title: 'Can Create Incident Severity',
                description:
                    'This permission can create Incident Severity this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanDeleteIncidentSeverity,
                title: 'Can Delete Incident Severity',
                description:
                    'This permission  can delete Incident Severity of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanEditIncidentSeverity,
                title: 'Can Edit Incident Severity',
                description:
                    'This permission can edit Incident Severity of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanReadIncidentSeverity,
                title: 'Can Read Incident Severity',
                description:
                    'This permission  can read Incident Severity of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },

            {
                permission: Permission.CanCreateProjectTeam,
                title: 'Can Create Team',
                description: 'This permission can create teams this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanDeleteProjectTeam,
                title: 'Can Delete Team',
                description:
                    'This permission  can delete teams of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanInviteProjectTeamMembers,
                title: 'Can Invite New Members',
                description: 'This permission can inivte users to the team.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanEditProjectTeamPermissions,
                title: 'Can Edit Team Permissions',
                description:
                    'This permission can edit team permissions of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanEditProjectTeam,
                title: 'Can Edit Team',
                description: 'This permission can edit teams of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanReadProjectTeam,
                title: 'Can Read Teams',
                description: 'This permission  can read teams of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },

            {
                permission: Permission.CanCreateProjectMonitor,
                title: 'Can Create Monitor',
                description: 'This permission can create monitor this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: true,
            },
            {
                permission: Permission.CanDeleteProjectMonitor,
                title: 'Can Delete Monitor',
                description:
                    'This permission  can delete monitor of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: true,
            },
            {
                permission: Permission.CanEditProjectMonitor,
                title: 'Can Edit Monitor',
                description:
                    'This permission can edit monitor of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: true,
            },
            {
                permission: Permission.CanReadProjectMonitor,
                title: 'Can Read Monitor',
                description:
                    'This permission  can read monitor of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: true,
            },

            {
                permission: Permission.CanCreateIncidentInternalNote,
                title: 'Can Create Incident Internal Note',
                description:
                    'This permission can create Incident Internal Note this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanDeleteIncidentInternalNote,
                title: 'Can Delete Incident Internal Note',
                description:
                    'This permission  can delete Incident Internal Note of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanEditIncidentInternalNote,
                title: 'Can Edit Incident Internal Note',
                description:
                    'This permission can edit Incident Internal Note of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanReadIncidentInternalNote,
                title: 'Can Read Incident Internal Note',
                description:
                    'This permission  can read Incident Internal Note of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },

            {
                permission: Permission.CanCreateIncidentPublicNote,
                title: 'Can Create Incident Status Page Note',
                description:
                    'This permission can create Incident Status Page Note this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanDeleteIncidentPublicNote,
                title: 'Can Delete Incident Status Page Note',
                description:
                    'This permission  can delete Incident Status Page Note of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanEditIncidentPublicNote,
                title: 'Can Edit Incident Status Page Note',
                description:
                    'This permission can edit Incident Status Page Note of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanReadIncidentPublicNote,
                title: 'Can Read Incident Status Page Note',
                description:
                    'This permission  can read Incident Status Page Note of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },

            {
                permission: Permission.CanCreateInvoices,
                title: 'Can Create Invoices',
                description:
                    'This permission can create Invoices this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanDeleteInvoices,
                title: 'Can Delete Invoices',
                description:
                    'This permission  can delete Invoices of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanEditInvoices,
                title: 'Can Edit Invoices',
                description:
                    'This permission can edit Invoices of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanReadInvoices,
                title: 'Can Read Invoices',
                description:
                    'This permission  can read Invoices of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },

            {
                permission: Permission.CanCreateBillingPaymentMethod,
                title: 'Can Create Payment Method',
                description:
                    'This permission can create Payment Method this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanDeleteBillingPaymentMethod,
                title: 'Can Delete Payment Method',
                description:
                    'This permission  can delete Payment Method of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanEditBillingPaymentMethod,
                title: 'Can Edit Payment Method',
                description:
                    'This permission can edit Payment Method of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanReadBillingPaymentMethod,
                title: 'Can Read Payment Method',
                description:
                    'This permission  can read Payment Method of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },

            {
                permission:
                    Permission.CanReadProjectOnCallDutyPolicyExecutionLogTimeline,
                title: 'Can Read On-Call Duty Policy Execution Log Timeline',
                description:
                    'This permission can read teams in on-call duty execution log timeline.',
                isAssignableToTenant: true,
                isAccessControlPermission: true,
            },

            {
                permission:
                    Permission.CanReadProjectOnCallDutyPolicyExecutionLog,
                title: 'Can Read On-Call Duty Policy Execution Log',
                description:
                    'This permission can read teams in on-call duty execution log.',
                isAssignableToTenant: true,
                isAccessControlPermission: true,
            },

            {
                permission:
                    Permission.CanCreateProjectOnCallDutyPolicyEscalationRuleTeam,
                title: 'Can Create On-Call Duty Policy Escalation Rule',
                description:
                    'This permission can create teams in on-call duty escalation rule this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: true,
            },
            {
                permission:
                    Permission.CanDeleteProjectOnCallDutyPolicyEscalationRuleTeam,
                title: 'Can Delete On-Call Duty Policy Escalation Rule Team',
                description:
                    'This permission  can delete teams in on-call duty escalation rule of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: true,
            },
            {
                permission:
                    Permission.CanEditProjectOnCallDutyPolicyEscalationRuleTeam,
                title: 'Can Edit On-Call Duty Policy Escalation Rule Team',
                description:
                    'This permission can edit teams in on-call duty escalation rule of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: true,
            },
            {
                permission:
                    Permission.CanReadProjectOnCallDutyPolicyEscalationRuleTeam,
                title: 'Can Read On-Call Duty Policy Escalation Rule Team',
                description:
                    'This permission  can read teams in on-call duty escalation rule of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: true,
            },

            {
                permission:
                    Permission.CanCreateProjectOnCallDutyPolicyEscalationRuleUser,
                title: 'Can Create On-Call Duty Policy Escalation Rule User',
                description:
                    'This permission can create on-call duty escalation rule this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: true,
            },
            {
                permission:
                    Permission.CanDeleteProjectOnCallDutyPolicyEscalationRuleUser,
                title: 'Can Delete On-Call Duty Policy Escalation Rule User',
                description:
                    'This permission  can delete on-call duty escalation rule of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: true,
            },
            {
                permission:
                    Permission.CanEditProjectOnCallDutyPolicyEscalationRuleUser,
                title: 'Can Edit On-Call Duty Policy Escalation Rule User',
                description:
                    'This permission can edit on-call duty escalation rule of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: true,
            },
            {
                permission:
                    Permission.CanReadProjectOnCallDutyPolicyEscalationRuleUser,
                title: 'Can Read On-Call Duty Policy Escalation Rule User',
                description:
                    'This permission  can read on-call duty escalation rule of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: true,
            },

            {
                permission:
                    Permission.CanCreateProjectOnCallDutyPolicyEscalationRule,
                title: 'Can Create On-Call Duty Policy Escalation Rule',
                description:
                    'This permission can create on-call duty escalation rule this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: true,
            },
            {
                permission:
                    Permission.CanDeleteProjectOnCallDutyPolicyEscalationRule,
                title: 'Can Delete On-Call Duty Policy Escalation Rule',
                description:
                    'This permission  can delete on-call duty escalation rule of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: true,
            },
            {
                permission:
                    Permission.CanEditProjectOnCallDutyPolicyEscalationRule,
                title: 'Can Edit On-Call Duty Policy Escalation Rule',
                description:
                    'This permission can edit on-call duty escalation rule of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: true,
            },
            {
                permission:
                    Permission.CanReadProjectOnCallDutyPolicyEscalationRule,
                title: 'Can Read On-Call Duty Policy Escalation Rule',
                description:
                    'This permission  can read on-call duty escalation rule of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: true,
            },

            {
                permission: Permission.CanCreateProjectOnCallDutyPolicy,
                title: 'Can Create On-Call Duty Policy',
                description:
                    'This permission can create on-call duty this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: true,
            },
            {
                permission: Permission.CanDeleteProjectOnCallDutyPolicy,
                title: 'Can Delete On-Call Duty Policy',
                description:
                    'This permission  can delete on-call duty of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: true,
            },
            {
                permission: Permission.CanEditProjectOnCallDutyPolicy,
                title: 'Can Edit On-Call Duty Policy',
                description:
                    'This permission can edit on-call duty of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: true,
            },
            {
                permission: Permission.CanReadProjectOnCallDutyPolicy,
                title: 'Can Read On-Call Duty Policy',
                description:
                    'This permission  can read on-call duty of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: true,
            },

            {
                permission: Permission.CanCreateProjectStatusPage,
                title: 'Can Create Status Page',
                description:
                    'This permission can create status pages this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: true,
            },
            {
                permission: Permission.CanDeleteProjectStatusPage,
                title: 'Can Delete Status Page',
                description:
                    'This permission  can delete status pages of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: true,
            },
            {
                permission: Permission.CanEditProjectStatusPage,
                title: 'Can Edit Status Page',
                description:
                    'This permission can edit status pages of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: true,
            },
            {
                permission: Permission.CanReadProjectStatusPage,
                title: 'Can Read Status Page',
                description:
                    'This permission  can read status pages of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: true,
            },

            {
                permission: Permission.CanCreateProjectProbe,
                title: 'Can Create Probe',
                description: 'This permission can create probe this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanDeleteProjectProbe,
                title: 'Can Delete Probe',
                description:
                    'This permission  can delete probe of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanEditProjectProbe,
                title: 'Can Edit Probe',
                description: 'This permission can edit probe of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanReadProjectProbe,
                title: 'Can Read Probe',
                description: 'This permission  can read probe of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },

            {
                permission: Permission.CanCreateOnCallDutyPolicyCustomField,
                title: 'Can Create On Call Policy Custom Field',
                description:
                    'This permission can create On Call Policy Custom Field this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanDeleteOnCallDutyPolicyCustomField,
                title: 'Can Delete On Call Policy Custom Field',
                description:
                    'This permission  can delete On Call Policy Custom Field of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanEditOnCallDutyPolicyCustomField,
                title: 'Can Edit On Call Policy Custom Field',
                description:
                    'This permission can edit On Call Policy Custom Field of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanReadOnCallDutyPolicyCustomField,
                title: 'Can Read On Call Policy Custom Field',
                description:
                    'This permission  can read On Call Policy Custom Field of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },

            {
                permission: Permission.CanCreateMonitorCustomField,
                title: 'Can Create Monitor Custom Field',
                description:
                    'This permission can create Monitor Custom Field this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanDeleteMonitorCustomField,
                title: 'Can Delete Monitor Custom Field',
                description:
                    'This permission  can delete Monitor Custom Field of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanEditMonitorCustomField,
                title: 'Can Edit Monitor Custom Field',
                description:
                    'This permission can edit Monitor Custom Field of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanReadMonitorCustomField,
                title: 'Can Read Monitor Custom Field',
                description:
                    'This permission  can read Monitor Custom Field of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },

            {
                permission: Permission.CanCreateIncidentCustomField,
                title: 'Can Create Incident Custom Field',
                description:
                    'This permission can create Incident Custom Field this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanDeleteIncidentCustomField,
                title: 'Can Delete Incident Custom Field',
                description:
                    'This permission  can delete Incident Custom Field of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanEditIncidentCustomField,
                title: 'Can Edit Incident Custom Field',
                description:
                    'This permission can edit Incident Custom Field of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanReadIncidentCustomField,
                title: 'Can Read Incident Custom Field',
                description:
                    'This permission  can read Incident Custom Field of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },

            {
                permission: Permission.CanCreateStatusPageCustomField,
                title: 'Can Create Status Page Custom Field',
                description:
                    'This permission can create Status Page Custom Field this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanDeleteStatusPageCustomField,
                title: 'Can Delete Status Page Custom Field',
                description:
                    'This permission  can delete Status Page Custom Field of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanEditStatusPageCustomField,
                title: 'Can Edit Status Page Custom Field',
                description:
                    'This permission can edit Status Page Custom Field of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanReadStatusPageCustomField,
                title: 'Can Read Status Page Custom Field',
                description:
                    'This permission  can read Status Page Custom Field of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },

            {
                permission: Permission.CanCreateScheduledMaintenanceCustomField,
                title: 'Can Create Scheduled Maintenance Custom Field',
                description:
                    'This permission can create Scheduled Maintenance Custom Field this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanDeleteScheduledMaintenanceCustomField,
                title: 'Can Delete Scheduled Maintenance Custom Field',
                description:
                    'This permission  can delete Scheduled Maintenance Custom Field of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanEditScheduledMaintenanceCustomField,
                title: 'Can Edit Scheduled Maintenance Custom Field',
                description:
                    'This permission can edit Scheduled Maintenance Custom Field of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanReadScheduledMaintenanceCustomField,
                title: 'Can Read Scheduled Maintenance Custom Field',
                description:
                    'This permission  can read Scheduled Maintenance Custom Field of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },

            {
                permission: Permission.CanReadSmsLog,
                title: 'Can Read SMS Log',
                description:
                    'This permission  can read SMS Log of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },

            {
                permission: Permission.CanReadCallLog,
                title: 'Can Read Call Log',
                description:
                    'This permission  can read Call Logs of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },

            {
                permission: Permission.CanCreateMonitorProbe,
                title: 'Can Create Monitor Probe',
                description:
                    'This permission can create Monitor Probe this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanDeleteMonitorProbe,
                title: 'Can Delete Monitor Probe',
                description:
                    'This permission  can delete Monitor Probe of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanEditMonitorProbe,
                title: 'Can Edit Monitor Probe',
                description:
                    'This permission can edit Monitor Probe of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanReadMonitorProbe,
                title: 'Can Read Monitor Probe',
                description:
                    'This permission  can read Monitor Probe of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },

            {
                permission: Permission.CanCreateScheduledMaintenanceOwnerTeam,
                title: 'Can Create Scheduled Maintenance Team Owner',
                description:
                    'This permission can create Scheduled Maintenance Team Owner this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanDeleteScheduledMaintenanceOwnerTeam,
                title: 'Can Delete Scheduled Maintenance Team Owner',
                description:
                    'This permission  can delete Scheduled Maintenance Team Owner of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanEditScheduledMaintenanceOwnerTeam,
                title: 'Can Edit Scheduled Maintenance Team Owner',
                description:
                    'This permission can edit Scheduled Maintenance Team Owner of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanReadScheduledMaintenanceOwnerTeam,
                title: 'Can Read Scheduled Maintenance Team Owner',
                description:
                    'This permission  can read Scheduled Maintenance Team Owner of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },

            {
                permission: Permission.CanCreateScheduledMaintenanceOwnerUser,
                title: 'Can Create Scheduled Maintenance User Owner',
                description:
                    'This permission can create Scheduled Maintenance User Owner this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanDeleteScheduledMaintenanceOwnerUser,
                title: 'Can Delete Scheduled Maintenance User Owner',
                description:
                    'This permission  can delete Scheduled Maintenance User Owner of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanEditScheduledMaintenanceOwnerUser,
                title: 'Can Edit Scheduled Maintenance User Owner',
                description:
                    'This permission can edit Scheduled Maintenance User Owner of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanReadScheduledMaintenanceOwnerUser,
                title: 'Can Read Scheduled Maintenance User Owner',
                description:
                    'This permission  can read Scheduled Maintenance User Owner of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },

            {
                permission: Permission.CanCreateIncidentOwnerTeam,
                title: 'Can Create Incident Team Owner',
                description:
                    'This permission can create Incident Team Owner this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanDeleteIncidentOwnerTeam,
                title: 'Can Delete Incident Team Owner',
                description:
                    'This permission  can delete Incident Team Owner of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanEditIncidentOwnerTeam,
                title: 'Can Edit Incident Team Owner',
                description:
                    'This permission can edit Incident Team Owner of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanReadIncidentOwnerTeam,
                title: 'Can Read Incident Team Owner',
                description:
                    'This permission  can read Incident Team Owner of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },

            {
                permission: Permission.CanCreateIncidentOwnerUser,
                title: 'Can Create Incident User Owner',
                description:
                    'This permission can create Incident User Owner this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanDeleteIncidentOwnerUser,
                title: 'Can Delete Incident User Owner',
                description:
                    'This permission  can delete Incident User Owner of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanEditIncidentOwnerUser,
                title: 'Can Edit Incident User Owner',
                description:
                    'This permission can edit Incident User Owner of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanReadIncidentOwnerUser,
                title: 'Can Read Incident User Owner',
                description:
                    'This permission  can read Incident User Owner of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },

            {
                permission: Permission.CanCreateStatusPageOwnerTeam,
                title: 'Can Create Status Page Team Owner',
                description:
                    'This permission can create Status Page Team Owner this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanDeleteStatusPageOwnerTeam,
                title: 'Can Delete Status Page Team Owner',
                description:
                    'This permission  can delete Status Page Team Owner of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanEditStatusPageOwnerTeam,
                title: 'Can Edit Status Page Team Owner',
                description:
                    'This permission can edit Status Page Team Owner of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanReadStatusPageOwnerTeam,
                title: 'Can Read Status Page Team Owner',
                description:
                    'This permission  can read Status Page Team Owner of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },

            {
                permission: Permission.CanCreateStatusPageOwnerUser,
                title: 'Can Create Status Page User Owner',
                description:
                    'This permission can create Status Page User Owner this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanDeleteStatusPageOwnerUser,
                title: 'Can Delete Status Page User Owner',
                description:
                    'This permission  can delete Status Page User Owner of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanEditStatusPageOwnerUser,
                title: 'Can Edit Status Page User Owner',
                description:
                    'This permission can edit Status Page User Owner of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanReadStatusPageOwnerUser,
                title: 'Can Read Status Page User Owner',
                description:
                    'This permission  can read Status Page User Owner of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },

            {
                permission: Permission.CanCreateMonitorOwnerTeam,
                title: 'Can Create Monitor Team Owner',
                description:
                    'This permission can create Monitor Team Owner this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanDeleteMonitorOwnerTeam,
                title: 'Can Delete Monitor Team Owner',
                description:
                    'This permission  can delete Monitor Team Owner of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanEditMonitorOwnerTeam,
                title: 'Can Edit Monitor Team Owner',
                description:
                    'This permission can edit Monitor Team Owner of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanReadMonitorOwnerTeam,
                title: 'Can Read Monitor Team Owner',
                description:
                    'This permission  can read Monitor Team Owner of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },

            {
                permission: Permission.CanCreateMonitorOwnerUser,
                title: 'Can Create Monitor User Owner',
                description:
                    'This permission can create Monitor User Owner this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanDeleteMonitorOwnerUser,
                title: 'Can Delete Monitor User Owner',
                description:
                    'This permission  can delete Monitor User Owner of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanEditMonitorOwnerUser,
                title: 'Can Edit Monitor User Owner',
                description:
                    'This permission can edit Monitor User Owner of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanReadMonitorOwnerUser,
                title: 'Can Read Monitor User Owner',
                description:
                    'This permission  can read Monitor User Owner of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },

            {
                permission: Permission.CanCreateProjectIncident,
                title: 'Can Create Incident',
                description:
                    'This permission can create incident this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: true,
            },
            {
                permission: Permission.CanDeleteProjectIncident,
                title: 'Can Delete Incident',
                description:
                    'This permission  can delete incident of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: true,
            },
            {
                permission: Permission.CanEditProjectIncident,
                title: 'Can Edit Incident',
                description:
                    'This permission can edit incident of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: true,
            },
            {
                permission: Permission.CanReadProjectIncident,
                title: 'Can Read Incident',
                description:
                    'This permission  can read incident of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: true,
            },

            {
                permission: Permission.CanCreateStatusPageSubscriber,
                title: 'Can Create Status Page Subscriber',
                description:
                    'This permission can create subscriber on status page this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanDeleteStatusPageSubscriber,
                title: 'Can Delete Status Page Subscriber',
                description:
                    'This permission  can delete subscriber on status page of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanEditStatusPageSubscriber,
                title: 'Can Edit Status Page Subscriber',
                description:
                    'This permission can edit subscriber on status page of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanReadStatusPageSubscriber,
                title: 'Can Read Status Page Subscriber',
                description:
                    'This permission  can read subscriber on status page of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },

            {
                permission: Permission.CanCreateStatusPagePrivateUser,
                title: 'Can Create Status Page Private User',
                description:
                    'This permission can create private user on status page this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanDeleteStatusPagePrivateUser,
                title: 'Can Delete Status Page PrivateUser',
                description:
                    'This permission  can delete private user on status page of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanEditStatusPagePrivateUser,
                title: 'Can Edit Status Page PrivateUser',
                description:
                    'This permission can edit private user on status page of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanReadStatusPagePrivateUser,
                title: 'Can Read Status Page Private User',
                description:
                    'This permission  can read private user on status page of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },

            // Scheduled Maintenance Permissions.

            {
                permission: Permission.CanCreateScheduledMaintenanceState,
                title: 'Can Create Scheduled Maintenance State',
                description:
                    'This permission can create Scheduled Maintenance states this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanDeleteScheduledMaintenanceState,
                title: 'Can Delete Scheduled Maintenance State',
                description:
                    'This permission  can delete Scheduled Maintenance states of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanEditScheduledMaintenanceState,
                title: 'Can Edit Scheduled Maintenance State',
                description:
                    'This permission can edit Scheduled Maintenance states of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanReadScheduledMaintenanceState,
                title: 'Can Read Scheduled Maintenance State',
                description:
                    'This permission  can read Scheduled Maintenance states of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },

            {
                permission: Permission.CanCreateProjectScheduledMaintenance,
                title: 'Can Create Scheduled Maintenance',
                description:
                    'This permission can create Scheduled Maintenance this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: true,
            },
            {
                permission: Permission.CanDeleteProjectScheduledMaintenance,
                title: 'Can Delete Scheduled Maintenance',
                description:
                    'This permission  can delete Scheduled Maintenance of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: true,
            },
            {
                permission: Permission.CanEditProjectScheduledMaintenance,
                title: 'Can Edit Scheduled Maintenance',
                description:
                    'This permission can edit Scheduled Maintenance of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: true,
            },
            {
                permission: Permission.CanReadProjectScheduledMaintenance,
                title: 'Can Read Scheduled Maintenance',
                description:
                    'This permission  can read Scheduled Maintenance of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: true,
            },

            {
                permission:
                    Permission.CanCreateScheduledMaintenanceStateTimeline,
                title: 'Can Create Scheduled Maintenance State Timeline',
                description:
                    'This permission can create Scheduled Maintenance state history of an Scheduled Maintenance in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission:
                    Permission.CanDeleteScheduledMaintenanceStateTimeline,
                title: 'Can Delete Scheduled Maintenance State Timeline',
                description:
                    'This permission  can delete Scheduled Maintenance state history of an Scheduled Maintenance in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanEditScheduledMaintenanceStateTimeline,
                title: 'Can Edit Scheduled Maintenance State Timeline',
                description:
                    'This permission can edit Scheduled Maintenance state history of an Scheduled Maintenance in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanReadScheduledMaintenanceStateTimeline,
                title: 'Can Read Scheduled Maintenance State Timeline',
                description:
                    'This permission can read Scheduled Maintenance state history of an Scheduled Maintenance in this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },

            {
                permission:
                    Permission.CanCreateScheduledMaintenanceInternalNote,
                title: 'Can Create Scheduled Maintenance Internal Note',
                description:
                    'This permission can create Scheduled Maintenance Internal Note this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission:
                    Permission.CanDeleteScheduledMaintenanceInternalNote,
                title: 'Can Delete Scheduled Maintenance Internal Note',
                description:
                    'This permission  can delete Scheduled Maintenance Internal Note of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanEditScheduledMaintenanceInternalNote,
                title: 'Can Edit Scheduled Maintenance Internal Note',
                description:
                    'This permission can edit Scheduled Maintenance Internal Note of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanReadScheduledMaintenanceInternalNote,
                title: 'Can Read Scheduled Maintenance Internal Note',
                description:
                    'This permission  can read Scheduled Maintenance Internal Note of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },

            {
                permission: Permission.CanCreateScheduledMaintenancePublicNote,
                title: 'Can Create Scheduled Maintenance Status Page Note',
                description:
                    'This permission can create Scheduled Maintenance Status Page Note this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanDeleteScheduledMaintenancePublicNote,
                title: 'Can Delete Scheduled Maintenance Status Page Note',
                description:
                    'This permission  can delete Scheduled Maintenance Status Page Note of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanEditScheduledMaintenancePublicNote,
                title: 'Can Edit Scheduled Maintenance Status Page Note',
                description:
                    'This permission can edit Scheduled Maintenance Status Page Note of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
            {
                permission: Permission.CanReadScheduledMaintenancePublicNote,
                title: 'Can Read Scheduled Maintenance Status Page Note',
                description:
                    'This permission  can read Scheduled Maintenance Status Page Note of this project.',
                isAssignableToTenant: true,
                isAccessControlPermission: false,
            },
        ];

        return permissions;
    }

    public static getAllPermissionPropsAsDictionary(): Dictionary<PermissionProps> {
        const permissions: Array<PermissionProps> =
            PermissionHelper.getAllPermissionProps();

        const dict: Dictionary<PermissionProps> = {};

        for (const permission of permissions) {
            dict[permission.permission] = permission;
        }

        return dict;
    }
}

export interface UserGlobalAccessPermission extends JSONObject {
    projectIds: Array<ObjectID>;
    globalPermissions: Array<Permission>;
    _type: 'UserGlobalAccessPermission';
}

export interface UserPermission extends JSONObject {
    _type: 'UserPermission';
    permission: Permission;
    labelIds: Array<ObjectID>;
}

export interface UserTenantAccessPermission extends JSONObject {
    _type: 'UserTenantAccessPermission';
    projectId: ObjectID;
    permissions: Array<UserPermission>;
}

export const PermissionsArray: Array<string> = [
    ...new Set(Object.keys(Permission)),
]; // Returns ["Owner", "Administrator"...]

export function instaceOfUserTenantAccessPermission(
    object: any
): object is UserTenantAccessPermission {
    return object._type === 'UserTenantAccessPermission';
}

export function instaceOfUserPermission(object: any): object is UserPermission {
    return object._type === 'UserPermission';
}

export function instaceOfUserGlobalAccessPermission(
    object: any
): object is UserGlobalAccessPermission {
    return object._type === 'UserGlobalAccessPermission';
}

export default Permission;
