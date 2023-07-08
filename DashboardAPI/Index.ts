import 'ejs';
import Redis from 'CommonServer/Infrastructure/Redis';
import Express, { ExpressApplication } from 'CommonServer/Utils/Express';
import logger from 'CommonServer/Utils/Logger';
import BaseAPI from 'CommonServer/API/BaseAPI';
import App from 'CommonServer/Utils/StartServer';
import { PostgresAppInstance } from 'CommonServer/Infrastructure/PostgresDatabase';

import User from 'Model/Models/User';
import UserService, {
    Service as UserServiceType,
} from 'CommonServer/Services/UserService';

import BillingPaymentMethodAPI from 'CommonServer/API/BillingPaymentMethodAPI';

import BillingInvoiceAPI from 'CommonServer/API/BillingInvoiceAPI';

import Project from 'Model/Models/Project';
import ProjectService, {
    Service as ProjectServiceType,
} from 'CommonServer/Services/ProjectService';

import ShortLink from 'Model/Models/ShortLink';
import ShortLinkService, {
    Service as ShortLinkServiceType,
} from 'CommonServer/Services/ShortLinkService';

import IncidentOwnerTeam from 'Model/Models/IncidentOwnerTeam';
import IncidentOwnerTeamService, {
    Service as IncidentOwnerTeamServiceType,
} from 'CommonServer/Services/IncidentOwnerTeamService';

import MonitorOwnerTeam from 'Model/Models/MonitorOwnerTeam';
import MonitorOwnerTeamService, {
    Service as MonitorOwnerTeamServiceType,
} from 'CommonServer/Services/MonitorOwnerTeamService';

import StatusPageOwnerTeam from 'Model/Models/StatusPageOwnerTeam';
import StatusPageOwnerTeamService, {
    Service as StatusPageOwnerTeamServiceType,
} from 'CommonServer/Services/StatusPageOwnerTeamService';

import ScheduledMaintenanceOwnerTeam from 'Model/Models/ScheduledMaintenanceOwnerTeam';
import ScheduledMaintenanceOwnerTeamService, {
    Service as ScheduledMaintenanceOwnerTeamServiceType,
} from 'CommonServer/Services/ScheduledMaintenanceOwnerTeamService';

import IncidentOwnerUser from 'Model/Models/IncidentOwnerUser';
import IncidentOwnerUserService, {
    Service as IncidentOwnerUserServiceType,
} from 'CommonServer/Services/IncidentOwnerUserService';

import MonitorOwnerUser from 'Model/Models/MonitorOwnerUser';
import MonitorOwnerUserService, {
    Service as MonitorOwnerUserServiceType,
} from 'CommonServer/Services/MonitorOwnerUserService';

import StatusPageOwnerUser from 'Model/Models/StatusPageOwnerUser';
import StatusPageOwnerUserService, {
    Service as StatusPageOwnerUserServiceType,
} from 'CommonServer/Services/StatusPageOwnerUserService';

import ScheduledMaintenanceOwnerUser from 'Model/Models/ScheduledMaintenanceOwnerUser';
import ScheduledMaintenanceOwnerUserService, {
    Service as ScheduledMaintenanceOwnerUserServiceType,
} from 'CommonServer/Services/ScheduledMaintenanceOwnerUserService';

import Workflow from 'Model/Models/Workflow';
import WorkflowService, {
    Service as WorkflowServiceType,
} from 'CommonServer/Services/WorkflowService';

import WorkflowLog from 'Model/Models/WorkflowLog';
import WorkflowLogService, {
    Service as WorkflowLogServiceType,
} from 'CommonServer/Services/WorkflowLogService';

import ProjectSSO from 'Model/Models/ProjectSso';
import ProjectSSOService, {
    Service as ProjectSSOServiceType,
} from 'CommonServer/Services/ProjectSsoService';

import SmsLog from 'Model/Models/SmsLog';
import SmsLogService, {
    Service as SmsLogServiceType,
} from 'CommonServer/Services/SmsLogService';

import CallLog from 'Model/Models/CallLog';
import CallLogService, {
    Service as CallLogServiceType,
} from 'CommonServer/Services/CallLogService';

import StatusPageSSO from 'Model/Models/StatusPageSso';
import StatusPageSSOService, {
    Service as StatusPageSSOServiceType,
} from 'CommonServer/Services/StatusPageSsoService';

import WorkflowVariable from 'Model/Models/WorkflowVariable';
import WorkflowVariableService, {
    Service as WorkflowVariableServiceType,
} from 'CommonServer/Services/WorkflowVariableService';

import MonitorProbe from 'Model/Models/MonitorProbe';
import MonitorProbeService, {
    Service as MonitorProbeServiceType,
} from 'CommonServer/Services/MonitorProbeService';

import StatusPagePrivateUser from 'Model/Models/StatusPagePrivateUser';
import StatusPagePrivateUserService, {
    Service as StatusPagePrivateUserServiceType,
} from 'CommonServer/Services/StatusPagePrivateUserService';

import StatusPageFooterLink from 'Model/Models/StatusPageFooterLink';
import StatusPageFooterLinkService, {
    Service as StatusPageFooterLinkServiceType,
} from 'CommonServer/Services/StatusPageFooterLinkService';

import StatusPageHeaderLink from 'Model/Models/StatusPageHeaderLink';
import StatusPageHeaderLinkService, {
    Service as StatusPageHeaderLinkServiceType,
} from 'CommonServer/Services/StatusPageHeaderLinkService';

import UserNotificationRule from 'Model/Models/UserNotificationRule';
import UserNotificationRuleService, {
    Service as UserNotificationRuleServiceType,
} from 'CommonServer/Services/UserNotificationRuleService';

import StatusPageAnnouncement from 'Model/Models/StatusPageAnnouncement';
import StatusPageAnnouncementService, {
    Service as StatusPageAnnouncementServiceType,
} from 'CommonServer/Services/StatusPageAnnouncementService';

import EmailVerificationToken from 'Model/Models/EmailVerificationToken';
import EmailVerificationTokenService, {
    Service as EmailVerificationTokenServiceType,
} from 'CommonServer/Services/EmailVerificationTokenService';

import Team from 'Model/Models/Team';
import TeamService, {
    Service as TeamServiceType,
} from 'CommonServer/Services/TeamService';

import TeamMember from 'Model/Models/TeamMember';
import TeamMemberService, {
    TeamMemberService as TeamMemberServiceType,
} from 'CommonServer/Services/TeamMemberService';

import TeamPermission from 'Model/Models/TeamPermission';
import TeamPermissionService, {
    Service as TeamPermissionServiceType,
} from 'CommonServer/Services/TeamPermissionService';

import Label from 'Model/Models/Label';
import LabelService, {
    Service as LabelServiceType,
} from 'CommonServer/Services/LabelService';

import ProjectSmtpConfig from 'Model/Models/ProjectSmtpConfig';
import ProjectSmtpConfigService, {
    Service as ProjectSMTPConfigServiceType,
} from 'CommonServer/Services/ProjectSmtpConfigService';

import ApiKey from 'Model/Models/ApiKey';
import ApiKeyService, {
    Service as ApiKeyServiceType,
} from 'CommonServer/Services/ApiKeyService';

import ApiKeyPermission from 'Model/Models/ApiKeyPermission';
import ApiKeyPermissionService, {
    Service as ApiKeyPermissionServiceType,
} from 'CommonServer/Services/ApiKeyPermissionService';

import Monitor from 'Model/Models/Monitor';
import MonitorService, {
    Service as MonitorServiceType,
} from 'CommonServer/Services/MonitorService';

import OnCallDutyPolicy from 'Model/Models/OnCallDutyPolicy';
import OnCallDutyPolicyService, {
    Service as OnCallDutyPolicyServiceType,
} from 'CommonServer/Services/OnCallDutyPolicyService';

import MonitorStatus from 'Model/Models/MonitorStatus';
import MonitorStatusService, {
    Service as MonitorStatusServiceType,
} from 'CommonServer/Services/MonitorStatusService';

import MonitorTimelineStatus from 'Model/Models/MonitorStatusTimeline';
import MonitorTimelineStatusService, {
    Service as MonitorTimelineStatusServiceType,
} from 'CommonServer/Services/MonitorStatusTimelineService';

import ScheduledMaintenanceState from 'Model/Models/ScheduledMaintenanceState';
import ScheduledMaintenanceStateService, {
    Service as ScheduledMaintenanceStateServiceType,
} from 'CommonServer/Services/ScheduledMaintenanceStateService';

import ScheduledMaintenance from 'Model/Models/ScheduledMaintenance';
import ScheduledMaintenanceService, {
    Service as ScheduledMaintenanceServiceType,
} from 'CommonServer/Services/ScheduledMaintenanceService';

import ScheduledMaintenanceStateTimeline from 'Model/Models/ScheduledMaintenanceStateTimeline';
import ScheduledMaintenanceStateTimelineService, {
    Service as ScheduledMaintenanceStateTimelineServiceType,
} from 'CommonServer/Services/ScheduledMaintenanceStateTimelineService';

import ScheduledMaintenanceInternalNote from 'Model/Models/ScheduledMaintenanceInternalNote';
import ScheduledMaintenanceInternalNoteService, {
    Service as ScheduledMaintenanceInternalNoteServiceType,
} from 'CommonServer/Services/ScheduledMaintenanceInternalNoteService';

import ScheduledMaintenancePublicNote from 'Model/Models/ScheduledMaintenancePublicNote';
import ScheduledMaintenancePublicNoteService, {
    Service as ScheduledMaintenancePublicNoteServiceType,
} from 'CommonServer/Services/ScheduledMaintenancePublicNoteService';

import IncidentState from 'Model/Models/IncidentState';
import IncidentStateService, {
    Service as IncidentStateServiceType,
} from 'CommonServer/Services/IncidentStateService';

import Incident from 'Model/Models/Incident';
import IncidentService, {
    Service as IncidentServiceType,
} from 'CommonServer/Services/IncidentService';

import IncidentStateTimeline from 'Model/Models/IncidentStateTimeline';
import IncidentStateTimelineService, {
    Service as IncidentStateTimelineServiceType,
} from 'CommonServer/Services/IncidentStateTimelineService';

import IncidentInternalNote from 'Model/Models/IncidentInternalNote';
import IncidentInternalNoteService, {
    Service as IncidentInternalNoteServiceType,
} from 'CommonServer/Services/IncidentInternalNoteService';

import IncidentPublicNote from 'Model/Models/IncidentPublicNote';
import IncidentPublicNoteService, {
    Service as IncidentPublicNoteServiceType,
} from 'CommonServer/Services/IncidentPublicNoteService';

import Domain from 'Model/Models/Domain';
import DomainService, {
    Service as DomainServiceType,
} from 'CommonServer/Services/DomainService';

import StatusPageGroup from 'Model/Models/StatusPageGroup';
import StatusPageGroupService, {
    Service as StatusPageGroupServiceType,
} from 'CommonServer/Services/StatusPageGroupService';

import StatusPageResource from 'Model/Models/StatusPageResource';
import StatusPageResourceService, {
    Service as StatusPageResourceServiceType,
} from 'CommonServer/Services/StatusPageResourceService';

import IncidentSeverity from 'Model/Models/IncidentSeverity';
import IncidentSeverityService, {
    Service as IncidentSeverityServiceType,
} from 'CommonServer/Services/IncidentSeverityService';

import StatusPageDomain from 'Model/Models/StatusPageDomain';
import StatusPageDomainService, {
    Service as StatusPageDomainServiceType,
} from 'CommonServer/Services/StatusPageDomainService';

// User Notification methods.
import UserEmailAPI from 'CommonServer/API/UserEmailAPI';
import UserSMSAPI from 'CommonServer/API/UserSmsAPI';
import UserCallAPI from 'CommonServer/API/UserCallAPI';

// Import API

import StatusPageAPI from 'CommonServer/API/StatusPageAPI';
import NotificationAPI from 'CommonServer/API/NotificationAPI';

import ProbeAPI from 'CommonServer/API/ProbeAPI';

import StatusPageSubscriberAPI from 'CommonServer/API/StatusPageSubscriberAPI';

// Custom Fields API
import StatusPageCustomField from 'Model/Models/StatusPageCustomField';
import StatusPageCustomFieldService, {
    Service as StatusPageCustomFieldServiceType,
} from 'CommonServer/Services/StatusPageCustomFieldService';

import MonitorCustomField from 'Model/Models/MonitorCustomField';
import MonitorCustomFieldService, {
    Service as MonitorCustomFieldServiceType,
} from 'CommonServer/Services/MonitorCustomFieldService';

import IncidentCustomField from 'Model/Models/IncidentCustomField';
import IncidentCustomFieldService, {
    Service as IncidentCustomFieldServiceType,
} from 'CommonServer/Services/IncidentCustomFieldService';

import OnCallDutyPolicyExecutionLogTimeline from 'Model/Models/OnCallDutyPolicyExecutionLogTimeline';
import OnCallDutyPolicyExecutionLogTimelineService, {
    Service as OnCallDutyPolicyExecutionLogTimelineServiceType,
} from 'CommonServer/Services/OnCallDutyPolicyExecutionLogTimelineService';

import ScheduledMaintenanceCustomField from 'Model/Models/ScheduledMaintenanceCustomField';
import ScheduledMaintenanceCustomFieldService, {
    Service as ScheduledMaintenanceCustomFieldServiceType,
} from 'CommonServer/Services/ScheduledMaintenanceCustomFieldService';

import OnCallDutyPolicyExecutionLog from 'Model/Models/OnCallDutyPolicyExecutionLog';
import OnCallDutyPolicyExecutionLogService, {
    Service as OnCallDutyPolicyExecutionLogServiceType,
} from 'CommonServer/Services/OnCallDutyPolicyExecutionLogService';

import OnCallDutyPolicyEscalationRule from 'Model/Models/OnCallDutyPolicyEscalationRule';
import OnCallDutyPolicyEscalationRuleService, {
    Service as OnCallDutyPolicyEscalationRuleServiceType,
} from 'CommonServer/Services/OnCallDutyPolicyEscalationRuleService';

import OnCallDutyPolicyEscalationRuleTeam from 'Model/Models/OnCallDutyPolicyEscalationRuleTeam';
import OnCallDutyPolicyEscalationRuleTeamService, {
    Service as OnCallDutyPolicyEscalationRuleTeamServiceType,
} from 'CommonServer/Services/OnCallDutyPolicyEscalationRuleTeamService';

import OnCallDutyPolicyEscalationRuleUser from 'Model/Models/OnCallDutyPolicyEscalationRuleUser';
import OnCallDutyPolicyEscalationRuleUserService, {
    Service as OnCallDutyPolicyEscalationRuleUserServiceType,
} from 'CommonServer/Services/OnCallDutyPolicyEscalationRuleUserService';

import OnCallDutyPolicyCustomField from 'Model/Models/OnCallDutyPolicyCustomField';
import OnCallDutyPolicyCustomFieldService, {
    Service as OnCallDutyPolicyCustomFieldServiceType,
} from 'CommonServer/Services/OnCallDutyPolicyCustomFieldService';

import UserNotificationLogTimeline from 'Model/Models/UserNotificationLogTimeline';
import UserNotificationLogTimelineService, {
    Service as UserNotificationLogTimelineServiceType,
} from 'CommonServer/Services/UserNotificationLogTimelineService';

import UserNotificationLog from 'Model/Models/UserNotificationLog';
import UserNotificationLogService, {
    Service as UserNotificationLogServiceType,
} from 'CommonServer/Services/UserNotificationLogService';

const app: ExpressApplication = Express.getExpressApp();

const APP_NAME: string = 'api';

//attach api's
app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<User, UserServiceType>(User, UserService).getRouter()
);
app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<Project, ProjectServiceType>(
        Project,
        ProjectService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<ShortLink, ShortLinkServiceType>(
        ShortLink,
        ShortLinkService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<MonitorProbe, MonitorProbeServiceType>(
        MonitorProbe,
        MonitorProbeService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<StatusPageAnnouncement, StatusPageAnnouncementServiceType>(
        StatusPageAnnouncement,
        StatusPageAnnouncementService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<Team, TeamServiceType>(Team, TeamService).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<TeamMember, TeamMemberServiceType>(
        TeamMember,
        TeamMemberService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<TeamPermission, TeamPermissionServiceType>(
        TeamPermission,
        TeamPermissionService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<MonitorStatus, MonitorStatusServiceType>(
        MonitorStatus,
        MonitorStatusService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<IncidentState, IncidentStateServiceType>(
        IncidentState,
        IncidentStateService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<
        ScheduledMaintenanceState,
        ScheduledMaintenanceStateServiceType
    >(ScheduledMaintenanceState, ScheduledMaintenanceStateService).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<StatusPageResource, StatusPageResourceServiceType>(
        StatusPageResource,
        StatusPageResourceService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<Workflow, WorkflowServiceType>(
        Workflow,
        WorkflowService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<WorkflowVariable, WorkflowVariableServiceType>(
        WorkflowVariable,
        WorkflowVariableService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<WorkflowLog, WorkflowLogServiceType>(
        WorkflowLog,
        WorkflowLogService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<Domain, DomainServiceType>(Domain, DomainService).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<StatusPageGroup, StatusPageGroupServiceType>(
        StatusPageGroup,
        StatusPageGroupService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<StatusPageDomain, StatusPageDomainServiceType>(
        StatusPageDomain,
        StatusPageDomainService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<IncidentStateTimeline, IncidentStateTimelineServiceType>(
        IncidentStateTimeline,
        IncidentStateTimelineService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<
        ScheduledMaintenanceStateTimeline,
        ScheduledMaintenanceStateTimelineServiceType
    >(
        ScheduledMaintenanceStateTimeline,
        ScheduledMaintenanceStateTimelineService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<StatusPagePrivateUser, StatusPagePrivateUserServiceType>(
        StatusPagePrivateUser,
        StatusPagePrivateUserService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<Incident, IncidentServiceType>(
        Incident,
        IncidentService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<ScheduledMaintenance, ScheduledMaintenanceServiceType>(
        ScheduledMaintenance,
        ScheduledMaintenanceService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<ApiKey, ApiKeyServiceType>(ApiKey, ApiKeyService).getRouter()
);
app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<ApiKeyPermission, ApiKeyPermissionServiceType>(
        ApiKeyPermission,
        ApiKeyPermissionService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<StatusPageHeaderLink, StatusPageHeaderLinkServiceType>(
        StatusPageHeaderLink,
        StatusPageHeaderLinkService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<UserNotificationRule, UserNotificationRuleServiceType>(
        UserNotificationRule,
        UserNotificationRuleService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<StatusPageFooterLink, StatusPageFooterLinkServiceType>(
        StatusPageFooterLink,
        StatusPageFooterLinkService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<ApiKey, ApiKeyServiceType>(ApiKey, ApiKeyService).getRouter()
);
app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<ApiKeyPermission, ApiKeyPermissionServiceType>(
        ApiKeyPermission,
        ApiKeyPermissionService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<IncidentSeverity, IncidentSeverityServiceType>(
        IncidentSeverity,
        IncidentSeverityService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<IncidentOwnerUser, IncidentOwnerUserServiceType>(
        IncidentOwnerUser,
        IncidentOwnerUserService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<IncidentOwnerTeam, IncidentOwnerTeamServiceType>(
        IncidentOwnerTeam,
        IncidentOwnerTeamService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<MonitorOwnerUser, MonitorOwnerUserServiceType>(
        MonitorOwnerUser,
        MonitorOwnerUserService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<MonitorOwnerTeam, MonitorOwnerTeamServiceType>(
        MonitorOwnerTeam,
        MonitorOwnerTeamService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<
        ScheduledMaintenanceOwnerUser,
        ScheduledMaintenanceOwnerUserServiceType
    >(
        ScheduledMaintenanceOwnerUser,
        ScheduledMaintenanceOwnerUserService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<
        ScheduledMaintenanceOwnerTeam,
        ScheduledMaintenanceOwnerTeamServiceType
    >(
        ScheduledMaintenanceOwnerTeam,
        ScheduledMaintenanceOwnerTeamService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<StatusPageOwnerUser, StatusPageOwnerUserServiceType>(
        StatusPageOwnerUser,
        StatusPageOwnerUserService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<StatusPageOwnerTeam, StatusPageOwnerTeamServiceType>(
        StatusPageOwnerTeam,
        StatusPageOwnerTeamService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<Label, LabelServiceType>(Label, LabelService).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<EmailVerificationToken, EmailVerificationTokenServiceType>(
        EmailVerificationToken,
        EmailVerificationTokenService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<UserNotificationLog, UserNotificationLogServiceType>(
        UserNotificationLog,
        UserNotificationLogService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<
        UserNotificationLogTimeline,
        UserNotificationLogTimelineServiceType
    >(
        UserNotificationLogTimeline,
        UserNotificationLogTimelineService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<
        OnCallDutyPolicyCustomField,
        OnCallDutyPolicyCustomFieldServiceType
    >(
        OnCallDutyPolicyCustomField,
        OnCallDutyPolicyCustomFieldService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<ProjectSmtpConfig, ProjectSMTPConfigServiceType>(
        ProjectSmtpConfig,
        ProjectSmtpConfigService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<Monitor, MonitorServiceType>(
        Monitor,
        MonitorService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<ProjectSSO, ProjectSSOServiceType>(
        ProjectSSO,
        ProjectSSOService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<SmsLog, SmsLogServiceType>(SmsLog, SmsLogService).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<CallLog, CallLogServiceType>(
        CallLog,
        CallLogService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<StatusPageSSO, StatusPageSSOServiceType>(
        StatusPageSSO,
        StatusPageSSOService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<MonitorTimelineStatus, MonitorTimelineStatusServiceType>(
        MonitorTimelineStatus,
        MonitorTimelineStatusService
    ).getRouter()
);

app.use(`/${APP_NAME.toLocaleLowerCase()}`, new StatusPageAPI().getRouter());
app.use(`/${APP_NAME.toLocaleLowerCase()}`, new UserCallAPI().getRouter());
app.use(`/${APP_NAME.toLocaleLowerCase()}`, new UserEmailAPI().getRouter());
app.use(`/${APP_NAME.toLocaleLowerCase()}`, new UserSMSAPI().getRouter());
app.use(`/${APP_NAME.toLocaleLowerCase()}`, new ProbeAPI().getRouter());

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new StatusPageSubscriberAPI().getRouter()
);
app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BillingPaymentMethodAPI().getRouter()
);
app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BillingInvoiceAPI().getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<
        ScheduledMaintenancePublicNote,
        ScheduledMaintenancePublicNoteServiceType
    >(
        ScheduledMaintenancePublicNote,
        ScheduledMaintenancePublicNoteService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<
        ScheduledMaintenanceInternalNote,
        ScheduledMaintenanceInternalNoteServiceType
    >(
        ScheduledMaintenanceInternalNote,
        ScheduledMaintenanceInternalNoteService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<IncidentPublicNote, IncidentPublicNoteServiceType>(
        IncidentPublicNote,
        IncidentPublicNoteService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<IncidentInternalNote, IncidentInternalNoteServiceType>(
        IncidentInternalNote,
        IncidentInternalNoteService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<OnCallDutyPolicy, OnCallDutyPolicyServiceType>(
        OnCallDutyPolicy,
        OnCallDutyPolicyService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<
        ScheduledMaintenanceCustomField,
        ScheduledMaintenanceCustomFieldServiceType
    >(
        ScheduledMaintenanceCustomField,
        ScheduledMaintenanceCustomFieldService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<
        OnCallDutyPolicyEscalationRuleUser,
        OnCallDutyPolicyEscalationRuleUserServiceType
    >(
        OnCallDutyPolicyEscalationRuleUser,
        OnCallDutyPolicyEscalationRuleUserService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<
        OnCallDutyPolicyEscalationRuleTeam,
        OnCallDutyPolicyEscalationRuleTeamServiceType
    >(
        OnCallDutyPolicyEscalationRuleTeam,
        OnCallDutyPolicyEscalationRuleTeamService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<
        OnCallDutyPolicyExecutionLog,
        OnCallDutyPolicyExecutionLogServiceType
    >(
        OnCallDutyPolicyExecutionLog,
        OnCallDutyPolicyExecutionLogService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<
        OnCallDutyPolicyExecutionLogTimeline,
        OnCallDutyPolicyExecutionLogTimelineServiceType
    >(
        OnCallDutyPolicyExecutionLogTimeline,
        OnCallDutyPolicyExecutionLogTimelineService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<IncidentCustomField, IncidentCustomFieldServiceType>(
        IncidentCustomField,
        IncidentCustomFieldService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<
        OnCallDutyPolicyEscalationRule,
        OnCallDutyPolicyEscalationRuleServiceType
    >(
        OnCallDutyPolicyEscalationRule,
        OnCallDutyPolicyEscalationRuleService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<MonitorCustomField, MonitorCustomFieldServiceType>(
        MonitorCustomField,
        MonitorCustomFieldService
    ).getRouter()
);

app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    new BaseAPI<StatusPageCustomField, StatusPageCustomFieldServiceType>(
        StatusPageCustomField,
        StatusPageCustomFieldService
    ).getRouter()
);

app.use(`/${APP_NAME.toLocaleLowerCase()}`, NotificationAPI);

const init: Function = async (): Promise<void> => {
    try {
        // init the app
        await App(APP_NAME);
        // connect to the database.
        await PostgresAppInstance.connect(
            PostgresAppInstance.getDatasourceOptions()
        );

        // connect redis
        await Redis.connect();
    } catch (err) {
        logger.error('App Init Failed:');
        logger.error(err);
    }
};

init();
