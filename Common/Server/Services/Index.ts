import AccessTokenService from "./AccessTokenService";
import AcmeCertificateService from "./AcmeCertificateService";
// import LogService from './LogService';
import AnalyticsDatabaseService from "./AnalyticsDatabaseService";
import ApiKeyPermissionService from "./ApiKeyPermissionService";
// API Keys
import ApiKeyService from "./ApiKeyService";
import BaseService from "./BaseService";
import BillingInvoiceService from "./BillingInvoiceService";
import BillingPaymentMethodsService from "./BillingPaymentMethodService";
import BillingService from "./BillingService";
import CallLogService from "./CallLogService";
import CallService from "./CallService";
import CodeRepositoryService from "./CopilotCodeRepositoryService";
import CopilotActionService from "./CopilotActionService";
import DataMigrationService from "./DataMigrationService";
import DomainService from "./DomainService";
import EmailLogService from "./EmailLogService";
import EmailVerificationTokenService from "./EmailVerificationTokenService";
import FileService from "./FileService";
import GreenlockCertificateService from "./GreenlockCertificateService";
// Greenlock
import GreenlockChallengeService from "./GreenlockChallengeService";
import IncidentCustomFieldService from "./IncidentCustomFieldService";
import IncidentInternalNoteService from "./IncidentInternalNoteService";
import IncidentOwnerTeamService from "./IncidentOwnerTeamService";
import IncidentOwnerUserService from "./IncidentOwnerUserService";
import IncidentPublicNoteService from "./IncidentPublicNoteService";
// Incidents
import IncidentService from "./IncidentService";
import IncidentSeverityService from "./IncidentSeverityService";
import IncidentStateService from "./IncidentStateService";
import IncidentStateTimelineService from "./IncidentStateTimelineService";
//Labels.
import LabelService from "./LabelService";
import LogService from "./LogService";
import MailService from "./MailService";
import MetricService from "./MetricService";
import MonitorCustomFieldService from "./MonitorCustomFieldService";
import MonitorGroupOwnerTeamService from "./MonitorGroupOwnerTeamService";
import MonitorGroupOwnerUserService from "./MonitorGroupOwnerUserService";
import MonitorGroupResourceService from "./MonitorGroupResourceService";
import MonitorGroupService from "./MonitorGroupService";
import MonitorOwnerTeamService from "./MonitorOwnerTeamService";
import MonitorOwnerUserService from "./MonitorOwnerUserService";
import MonitorProbeService from "./MonitorProbeService";
import MonitorSecretService from "./MonitorSecretService";

// Monitors
import MonitorService from "./MonitorService";
import MonitorFeedService from "./MonitorFeedService";
import MonitorStatusService from "./MonitorStatusService";
import MonitorStatusTimelineService from "./MonitorStatusTimelineService";
import NotificationService from "./NotificationService";
import OnCallDutyPolicyCustomFieldService from "./OnCallDutyPolicyCustomFieldService";
import OnCallDutyPolicyEscalationRuleScheduleService from "./OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyEscalationRuleService from "./OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyEscalationRuleTeamService from "./OnCallDutyPolicyEscalationRuleTeamService";
import OnCallDutyPolicyEscalationRuleUserService from "./OnCallDutyPolicyEscalationRuleUserService";
import OnCallDutyPolicyExecutionLogService from "./OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyExecutionLogTimelineService from "./OnCallDutyPolicyExecutionLogTimelineService";
import OnCallDutyPolicyScheduleLayerService from "./OnCallDutyPolicyScheduleLayerService";
import OnCallDutyPolicyScheduleLayerUserService from "./OnCallDutyPolicyScheduleLayerUserService";
import OnCallDutyPolicyScheduleService from "./OnCallDutyPolicyScheduleService";
// On-Call Duty
import OnCallDutyPolicyService from "./OnCallDutyPolicyService";
import ProbeService from "./ProbeService";
import ProjectCallSMSConfigService from "./ProjectCallSMSConfigService";
import ProjectService from "./ProjectService";
// Project SMTP Config.
import ProjectSmtpConfigService from "./ProjectSmtpConfigService";
import ProjectSsoService from "./ProjectSsoService";
import PromoCodeService from "./PromoCodeService";
import ResellerPlanService from "./ResellerPlanService";
import ResellerService from "./ResellerService";
import ScheduledMaintenanceCustomFieldService from "./ScheduledMaintenanceCustomFieldService";
import ScheduledMaintenanceInternalNoteService from "./ScheduledMaintenanceInternalNoteService";
import ScheduledMaintenanceOwnerTeamService from "./ScheduledMaintenanceOwnerTeamService";
import ScheduledMaintenanceOwnerUserService from "./ScheduledMaintenanceOwnerUserService";
import ScheduledMaintenancePublicNoteService from "./ScheduledMaintenancePublicNoteService";
// ScheduledMaintenances
import ScheduledMaintenanceService from "./ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "./ScheduledMaintenanceStateService";
import ScheduledMaintenanceStateTimelineService from "./ScheduledMaintenanceStateTimelineService";
import ServiceCatalogOwnerTeamService from "./ServiceCatalogOwnerTeamService";
import ServiceCatalogOwnerUserService from "./ServiceCatalogOwnerUserService";
import ServiceCatalogService from "./ServiceCatalogService";
import ServiceCatalogMonitorService from "./ServiceCatalogMonitorService";
import ServiceCatalogTelemetryServiceService from "./ServiceCatalogTelemetryServiceService";
import ServiceCopilotCodeRepositoryService from "./ServiceCopilotCodeRepositoryService";
import ShortLinkService from "./ShortLinkService";
// SMS Log Service
import SmsLogService from "./SmsLogService";
import SmsService from "./SmsService";
import SpanService from "./SpanService";
import StatusPageAnnouncementService from "./StatusPageAnnouncementService";
import StatusPageAnnouncementTemplateService from "./StatusPageAnnouncementTemplateService";
import StatusPageCustomFieldService from "./StatusPageCustomFieldService";
import StatusPageDomainService from "./StatusPageDomainService";
import StatusPageFooterLinkService from "./StatusPageFooterLinkService";
import StatusPageGroupService from "./StatusPageGroupService";
import StatusPageHeaderLinkService from "./StatusPageHeaderLinkService";
import StatusPageHistoryChartBarColorRuleService from "./StatusPageHistoryChartBarColorRuleService";
import StatusPageOwnerTeamService from "./StatusPageOwnerTeamService";
import StatusPageOwnerUserService from "./StatusPageOwnerUserService";
import StatusPagePrivateUserService from "./StatusPagePrivateUserService";
import StatusPageResourceService from "./StatusPageResourceService";
// Status Page
import StatusPageService from "./StatusPageService";
import StatusPageSsoService from "./StatusPageSsoService";
import StatusPageSubscriberService from "./StatusPageSubscriberService";
import TeamMemberService from "./TeamMemberService";
import TeamPermissionService from "./TeamPermissionService";
import TeamComplianceSettingService from "./TeamComplianceSettingService";
// Team
import TeamService from "./TeamService";
import TelemetryServiceService from "./TelemetryServiceService";
import UsageBillingService from "./TelemetryUsageBillingService";
import UserCallService from "./UserCallService";
import UserEmailService from "./UserEmailService";
import UserNotificationRuleService from "./UserNotificationRuleService";
import UserNotificationSettingService from "./UserNotificationSettingService";
import UserOnCallLogService from "./UserOnCallLogService";
import UserOnCallLogTimelineService from "./UserOnCallLogTimelineService";
import UserService from "./UserService";
import UserTwoFactorAuthService from "./UserTwoFactorAuthService";
import UserSmsService from "./UserSmsService";
import WorkflowLogService from "./WorkflowLogService";
// Workflows.
import WorkflowService from "./WorkflowService";
import WorkflowVariablesService from "./WorkflowVariableService";
import AnalyticsBaseModel from "../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import CopilotPullRequestService from "./CopilotPullRequestService";
import ServiceCatalogDependencyService from "./ServiceCatalogDependencyService";
import TelemetryAttributeService from "./TelemetryAttributeService";
import TelemetryExceptionService from "./TelemetryExceptionService";
import ExceptionInstanceService from "./ExceptionInstanceService";
import CopilotActionTypePriorityService from "./CopilotActionTypePriorityService";
import ScheduledMaintenanceTemplateService from "./ScheduledMaintenanceTemplateService";
import ScheduledMaintenanceTemplateOwnerTeamService from "./ScheduledMaintenanceTemplateOwnerTeamService";
import ScheduledMaintenanceTemplateOwnerUserService from "./ScheduledMaintenanceTemplateOwnerUserService";

// Alert Services
import AlertStateService from "./AlertStateService";
import AlertService from "./AlertService";
import AlertCustomFieldService from "./AlertCustomFieldService";
import AlertStateTimelineService from "./AlertStateTimelineService";
import AlertInternalNoteService from "./AlertInternalNoteService";
import AlertOwnerTeamService from "./AlertOwnerTeamService";
import AlertOwnerUserService from "./AlertOwnerUserService";
import AlertSeverityService from "./AlertSeverityService";
import AlertNoteTemplateService from "./AlertNoteTemplateService";
import TableViewService from "./TableViewService";
import ScheduledMaintenanceFeedService from "./ScheduledMaintenanceFeedService";
import AlertFeedService from "./AlertFeedService";
import IncidentFeedService from "./IncidentFeedService";

import MonitorTestService from "./MonitorTestService";
import WorkspaceProjectAuthTokenService from "./WorkspaceProjectAuthTokenService";
import WorkspaceUserAuthTokenService from "./WorkspaceUserAuthTokenService";
import WorkspaceSettingService from "./WorkspaceSettingService";
import WorkspaceNotificationRuleService from "./WorkspaceNotificationRuleService";
import WorkspaceNotificationLogService from "./WorkspaceNotificationLogService";
import OnCallDutyPolicyUserOverrideService from "./OnCallDutyPolicyUserOverrideService";

import MonitorLogService from "./MonitorLogService";

import OnCallDutyPolicyTimeLogService from "./OnCallDutyPolicyTimeLogService";

const services: Array<BaseService> = [
  OnCallDutyPolicyTimeLogService,
  AcmeCertificateService,
  PromoCodeService,

  ResellerService,
  ResellerPlanService,
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
  IncidentFeedService,

  LabelService,

  MailService,
  MonitorCustomFieldService,
  MonitorOwnerTeamService,
  MonitorOwnerUserService,
  MonitorProbeService,
  MonitorService,
  MonitorStatusService,
  MonitorStatusTimelineService,
  MonitorSecretService,
  MonitorFeedService,

  NotificationService,

  OnCallDutyPolicyCustomFieldService,
  OnCallDutyPolicyEscalationRuleService,
  OnCallDutyPolicyEscalationRuleTeamService,
  OnCallDutyPolicyEscalationRuleUserService,
  OnCallDutyPolicyExecutionLogService,
  OnCallDutyPolicyExecutionLogTimelineService,
  OnCallDutyPolicyService,
  OnCallDutyPolicyUserOverrideService,

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
  ScheduledMaintenanceFeedService,

  ShortLinkService,
  SmsLogService,
  SmsService,

  StatusPageAnnouncementService,
  StatusPageAnnouncementTemplateService,
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
  StatusPageHistoryChartBarColorRuleService,

  TeamMemberService,
  TeamPermissionService,
  TeamComplianceSettingService,
  TeamService,

  UserService,
  UserCallService,
  UserEmailService,
  UserNotificationRuleService,
  UserNotificationSettingService,
  UserOnCallLogService,
  UserOnCallLogTimelineService,
  UserSmsService,
  UserTwoFactorAuthService,

  WorkflowLogService,
  WorkflowService,
  WorkflowVariablesService,

  // Monitor Group Service
  MonitorGroupService,
  MonitorGroupResourceService,
  MonitorGroupOwnerUserService,
  MonitorGroupOwnerTeamService,

  TelemetryServiceService,

  // On Call Duty Policy Schedule
  OnCallDutyPolicyScheduleService,
  OnCallDutyPolicyScheduleLayerUserService,
  OnCallDutyPolicyScheduleLayerService,
  OnCallDutyPolicyEscalationRuleScheduleService,

  UsageBillingService,
  ProjectCallSMSConfigService,

  ServiceCatalogService,
  ServiceCatalogOwnerTeamService,
  ServiceCatalogOwnerUserService,
  ServiceCatalogDependencyService,
  ServiceCatalogMonitorService,
  ServiceCatalogTelemetryServiceService,

  CodeRepositoryService,
  CopilotActionService,
  ServiceCopilotCodeRepositoryService,
  CopilotPullRequestService,
  CopilotActionTypePriorityService,

  TelemetryExceptionService,

  // scheduled maintenance templates
  ScheduledMaintenanceTemplateService,
  ScheduledMaintenanceTemplateOwnerTeamService,
  ScheduledMaintenanceTemplateOwnerUserService,

  AlertStateService,
  AlertService,
  AlertCustomFieldService,
  AlertStateTimelineService,
  AlertInternalNoteService,
  AlertOwnerTeamService,
  AlertOwnerUserService,
  AlertSeverityService,
  AlertNoteTemplateService,
  AlertFeedService,

  TableViewService,
  MonitorTestService,

  WorkspaceProjectAuthTokenService,
  WorkspaceUserAuthTokenService,
  WorkspaceSettingService,
  WorkspaceNotificationRuleService,
  WorkspaceNotificationLogService,
];

export const AnalyticsServices: Array<
  AnalyticsDatabaseService<AnalyticsBaseModel>
> = [
  LogService,
  SpanService,
  MetricService,
  TelemetryAttributeService,
  ExceptionInstanceService,
  MonitorLogService,
];

export default services;
