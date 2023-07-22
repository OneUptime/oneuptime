import UserService from './UserService';
import ProbeService from './ProbeService';
import ProjectService from './ProjectService';
import EmailVerificationTokenService from './EmailVerificationTokenService';

// Team
import TeamService from './TeamService';
import TeamMemberService from './TeamMemberService';
import TeamPermissionService from './TeamPermissionService';

// API Keys
import ApiKeyService from './ApiKeyService';
import ApiKeyPermissionService from './ApiKeyPermissionService';

//Labels.
import LabelService from './LabelService';

// Status Page
import StatusPageService from './StatusPageService';
import StatusPageGroupService from './StatusPageGroupService';
import StatusPageDomainService from './StatusPageDomainService';
import StatusPageResourceService from './StatusPageResourceService';
import StatusPageAnnouncementService from './StatusPageAnnouncementService';
import StatusPageSubscriberService from './StatusPageSubscriberService';
import StatusPageFooterLinkService from './StatusPageFooterLinkService';
import StatusPageHeaderLinkService from './StatusPageHeaderLinkService';
import StatusPagePrivateUserService from './StatusPagePrivateUserService';

// On Call Duty
import OnCallDutyPolicyService from './OnCallDutyPolicyService';

// Monitors
import MonitorService from './MonitorService';
import MonitorStatusService from './MonitorStatusService';
import MonitorStatusTimelineService from './MonitorStatusTimelineService';

// Incidents
import IncidentService from './IncidentService';
import IncidentStateService from './IncidentStateService';
import IncidentStateTimelineService from './IncidentStateTimelineService';
import IncidentPublicNoteService from './IncidentPublicNoteService';
import IncidentInternalNoteService from './IncidentInternalNoteService';
import IncidentSeverityService from './IncidentSeverityService';

// ScheduledMaintenances
import ScheduledMaintenanceService from './ScheduledMaintenanceService';
import ScheduledMaintenanceStateService from './ScheduledMaintenanceStateService';
import ScheduledMaintenanceStateTimelineService from './ScheduledMaintenanceStateTimelineService';
import ScheduledMaintenancePublicNoteService from './ScheduledMaintenancePublicNoteService';
import ScheduledMaintenanceInternalNoteService from './ScheduledMaintenanceInternalNoteService';

import BillingPaymentMethodsService from './BillingPaymentMethodService';

// Project SMTP Config.
import ProjectSmtpConfigService from './ProjectSmtpConfigService';

import DomainService from './DomainService';

import FileService from './FileService';
import BillingInvoiceService from './BillingInvoiceService';

// Greenlock
import GreenlockChallengeService from './GreenlockChallengeService';
import GreenlockCertificateService from './GreenlockCertificateService';

// Workflows.
import WorkflowService from './WorkflowService';
import WorkflowVariablesService from './WorkflowVariableService';
import WorkflowLogService from './WorkflowLogService';

// SMS Log Servce
import SmsLogService from './SmsLogService';
import CallLogService from './CallLogService';
import EmailLogService from './EmailLogService';
import BillingService from './BillingService';
import AccessTokenService from './AccessTokenService';
import CallService from './CallService';
import DataMigrationService from './DataMigrationService';
import IncidentCustomFieldService from './IncidentCustomFieldService';
import IncidentOwnerTeamService from './IncidentOwnerTeamService';
import IncidentOwnerUserService from './IncidentOwnerUserService';
import MailService from './MailService';
import MonitorCustomFieldService from './MonitorCustomFieldService';
import MonitorOwnerTeamService from './MonitorOwnerTeamService';
import MonitorOwnerUserService from './MonitorOwnerUserService';
import MonitorProbeService from './MonitorProbeService';
import NotificationService from './NotificationService';
import OnCallDutyPolicyCustomFieldService from './OnCallDutyPolicyCustomFieldService';
import OnCallDutyPolicyEscalationRuleService from './OnCallDutyPolicyEscalationRuleService';
import OnCallDutyPolicyEscalationRuleTeamService from './OnCallDutyPolicyEscalationRuleTeamService';
import OnCallDutyPolicyEscalationRuleUserService from './OnCallDutyPolicyEscalationRuleUserService';
import OnCallDutyPolicyExecutionLogService from './OnCallDutyPolicyExecutionLogService';
import OnCallDutyPolicyExecutionLogTimelineService from './OnCallDutyPolicyExecutionLogTimelineService';
import ProjectSsoService from './ProjectSsoService';
import ScheduledMaintenanceCustomFieldService from './ScheduledMaintenanceCustomFieldService';
import ScheduledMaintenanceOwnerTeamService from './ScheduledMaintenanceOwnerTeamService';
import ScheduledMaintenanceOwnerUserService from './ScheduledMaintenanceOwnerUserService';
import ShortLinkService from './ShortLinkService';
import SmsService from './SmsService';
import StatusPageCertificateService from './StatusPageCertificateService';
import StatusPageCustomFieldService from './StatusPageCustomFieldService';
import StatusPageOwnerTeamService from './StatusPageOwnerTeamService';
import StatusPageOwnerUserService from './StatusPageOwnerUserService';
import StatusPageSsoService from './StatusPageSsoService';
import UserCallService from './UserCallService';
import UserEmailService from './UserEmailService';
import UserSmsService from './UserSmsService';
import UserNotificationRuleService from './UserNotificationRuleService';
import UserNotificationSettingService from './UserNotificationSettingService';
import UserOnCallLogService from './UserOnCallLogService';
import UserOnCallLogTimelineService from './UserOnCallLogTimelineService';
import BaseService from './BaseService';

const services: Array<BaseService> = [
    // Import all services in current folder here.
    AccessTokenService,
    ApiKeyPermissionService,
    ApiKeyService,

    BillingInvoiceService,
    BillingPaymentMethodsService,
    BillingService,

    CallLogService,
    CallService,

    DataMigrationService,
    DomainService,

    EmailLogService,
    EmailVerificationTokenService,

    FileService,

    GreenlockCertificateService,
    GreenlockChallengeService,

    IncidentCustomFieldService,
    IncidentInternalNoteService,
    IncidentOwnerTeamService,
    IncidentOwnerUserService,
    IncidentPublicNoteService,
    IncidentService,
    IncidentSeverityService,
    IncidentStateService,
    IncidentStateTimelineService,

    LabelService,

    MailService,
    MonitorCustomFieldService,
    MonitorOwnerTeamService,
    MonitorOwnerUserService,
    MonitorProbeService,
    MonitorService,
    MonitorStatusService,
    MonitorStatusTimelineService,

    NotificationService,

    OnCallDutyPolicyCustomFieldService,
    OnCallDutyPolicyEscalationRuleService,
    OnCallDutyPolicyEscalationRuleTeamService,
    OnCallDutyPolicyEscalationRuleUserService,
    OnCallDutyPolicyExecutionLogService,
    OnCallDutyPolicyExecutionLogTimelineService,
    OnCallDutyPolicyService,

    ProjectService,
    ProjectSmtpConfigService,
    ProbeService,
    ProjectSsoService,

    ScheduledMaintenanceCustomFieldService,
    ScheduledMaintenanceInternalNoteService,
    ScheduledMaintenanceOwnerTeamService,
    ScheduledMaintenanceOwnerUserService,
    ScheduledMaintenancePublicNoteService,
    ScheduledMaintenanceService,
    ScheduledMaintenanceStateService,
    ScheduledMaintenanceStateTimelineService,

    ShortLinkService,
    SmsLogService,
    SmsService,

    StatusPageAnnouncementService,
    StatusPageCertificateService,
    StatusPageCustomFieldService,
    StatusPageDomainService,
    StatusPageFooterLinkService,
    StatusPageGroupService,
    StatusPageHeaderLinkService,
    StatusPageOwnerTeamService,
    StatusPageOwnerUserService,
    StatusPagePrivateUserService,
    StatusPageResourceService,
    StatusPageService,
    StatusPageSsoService,
    StatusPageSubscriberService,

    TeamMemberService,
    TeamPermissionService,
    TeamService,

    UserService,
    UserCallService,
    UserEmailService,
    UserNotificationRuleService,
    UserNotificationSettingService,
    UserOnCallLogService,
    UserOnCallLogTimelineService,
    UserSmsService,

    WorkflowLogService,
    WorkflowService,
    WorkflowVariablesService,
];

export default services;
