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
import OnCallDutyService from './OnCallDutyService';

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

export default [
    UserService,
    ProbeService,
    ProjectService,
    EmailVerificationTokenService,
    TeamService,
    TeamMemberService,
    TeamPermissionService,
    ApiKeyService,
    LabelService,
    ApiKeyPermissionService,
    ProjectSmtpConfigService,
    StatusPageService,
    OnCallDutyService,
    MonitorService,
    MonitorStatusService,
    IncidentStateService,
    IncidentService,
    IncidentStateTimelineService,
    MonitorStatusTimelineService,
    IncidentPublicNoteService,
    IncidentInternalNoteService,
    FileService,
    DomainService,

    StatusPageGroupService,
    StatusPageDomainService,
    StatusPageResourceService,
    IncidentSeverityService,
    StatusPageAnnouncementService,
    StatusPageSubscriberService,
    StatusPageFooterLinkService,
    StatusPageHeaderLinkService,
    StatusPagePrivateUserService,

    ScheduledMaintenanceStateService,
    ScheduledMaintenanceService,
    ScheduledMaintenanceStateTimelineService,
    ScheduledMaintenancePublicNoteService,
    ScheduledMaintenanceInternalNoteService,

    BillingPaymentMethodsService,
    BillingInvoiceService,

    GreenlockChallengeService,
    GreenlockCertificateService,

    WorkflowService,
    WorkflowVariablesService,
    WorkflowLogService,

    SmsLogService,
];
