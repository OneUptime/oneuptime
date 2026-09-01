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
import DataMigrationService from "./DataMigrationService";
import MigrationFailureService from "./MigrationFailureService";
import InstanceHealthLogService from "./InstanceHealthLogService";
import DomainService from "./DomainService";
import EmailLogService from "./EmailLogService";
import EmailVerificationTokenService from "./EmailVerificationTokenService";
import FileService from "./FileService";
import GreenlockCertificateService from "./GreenlockCertificateService";
// Greenlock
import GreenlockChallengeService from "./GreenlockChallengeService";
import IncidentCustomFieldService from "./IncidentCustomFieldService";
import IncidentOnCallRuleService from "./IncidentOnCallRuleService";
import IncidentPrivacyRuleService from "./IncidentPrivacyRuleService";
import IncidentPostmortemTemplateService from "./IncidentPostmortemTemplateService";
import IncidentNoteTemplateService from "./IncidentNoteTemplateService";
import IncidentLabelRuleService from "./IncidentLabelRuleService";
import IncidentGroupingRuleService from "./IncidentGroupingRuleService";
import IncidentTemplateService from "./IncidentTemplateService";
import IncidentTemplateOwnerTeamService from "./IncidentTemplateOwnerTeamService";
import IncidentTemplateOwnerUserService from "./IncidentTemplateOwnerUserService";
import IncidentInternalNoteService from "./IncidentInternalNoteService";
import IncidentOwnerTeamService from "./IncidentOwnerTeamService";
import IncidentOwnerRuleService from "./IncidentOwnerRuleService";
import IncidentOwnerUserService from "./IncidentOwnerUserService";
import IncidentRoleService from "./IncidentRoleService";
import IncidentMemberService from "./IncidentMemberService";
import IncidentPublicNoteService from "./IncidentPublicNoteService";
// Incidents
import IncidentService from "./IncidentService";
import IncidentSeverityService from "./IncidentSeverityService";
import IncidentStateService from "./IncidentStateService";
import IncidentStateTimelineService from "./IncidentStateTimelineService";
//Labels.
import LabelService from "./LabelService";
import KubernetesClusterService from "./KubernetesClusterService";
import KubernetesClusterOwnerRuleService from "./KubernetesClusterOwnerRuleService";
import KubernetesClusterOwnerUserService from "./KubernetesClusterOwnerUserService";
import KubernetesClusterOwnerTeamService from "./KubernetesClusterOwnerTeamService";
import KubernetesClusterLabelRuleService from "./KubernetesClusterLabelRuleService";
import DockerHostService from "./DockerHostService";
import DockerHostOwnerRuleService from "./DockerHostOwnerRuleService";
import DockerHostOwnerUserService from "./DockerHostOwnerUserService";
import DockerHostOwnerTeamService from "./DockerHostOwnerTeamService";
import DockerHostLabelRuleService from "./DockerHostLabelRuleService";
import NetworkDeviceService from "./NetworkDeviceService";
import NetworkDeviceOwnerTeamService from "./NetworkDeviceOwnerTeamService";
import NetworkDeviceOwnerUserService from "./NetworkDeviceOwnerUserService";
import NetworkDeviceOwnerRuleService from "./NetworkDeviceOwnerRuleService";
import NetworkDeviceLabelRuleService from "./NetworkDeviceLabelRuleService";
import NetworkDeviceAutoImportRuleService from "./NetworkDeviceAutoImportRuleService";
import NetworkDeviceOidTemplateService from "./NetworkDeviceOidTemplateService";
import NetworkDeviceDiscoveryScanService from "./NetworkDeviceDiscoveryScanService";
import NetworkInterfaceService from "./NetworkInterfaceService";
import NetworkSiteService from "./NetworkSiteService";
import NetworkSiteTypeService from "./NetworkSiteTypeService";
import NetworkEndpointService from "./NetworkEndpointService";
import NetworkSiteStatusTimelineService from "./NetworkSiteStatusTimelineService";
import NetworkSiteLinkService from "./NetworkSiteLinkService";
import NetworkDeviceLinkService from "./NetworkDeviceLinkService";
import NetworkDeviceLinkRuleService from "./NetworkDeviceLinkRuleService";
import NetworkTopologySuppressionService from "./NetworkTopologySuppressionService";
import NetworkSiteAssignmentRuleService from "./NetworkSiteAssignmentRuleService";
import PodmanHostService from "./PodmanHostService";
import PodmanHostOwnerRuleService from "./PodmanHostOwnerRuleService";
import PodmanHostOwnerUserService from "./PodmanHostOwnerUserService";
import PodmanHostOwnerTeamService from "./PodmanHostOwnerTeamService";
import PodmanHostLabelRuleService from "./PodmanHostLabelRuleService";
import ProxmoxClusterService from "./ProxmoxClusterService";
import DockerSwarmClusterService from "./DockerSwarmClusterService";
import CephClusterService from "./CephClusterService";
import ProxmoxResourceService from "./ProxmoxResourceService";
import DockerSwarmResourceService from "./DockerSwarmResourceService";
import CephResourceService from "./CephResourceService";
import ProxmoxClusterLabelRuleService from "./ProxmoxClusterLabelRuleService";
import DockerSwarmClusterLabelRuleService from "./DockerSwarmClusterLabelRuleService";
import ProxmoxClusterOwnerRuleService from "./ProxmoxClusterOwnerRuleService";
import DockerSwarmClusterOwnerRuleService from "./DockerSwarmClusterOwnerRuleService";
import ProxmoxClusterOwnerTeamService from "./ProxmoxClusterOwnerTeamService";
import DockerSwarmClusterOwnerTeamService from "./DockerSwarmClusterOwnerTeamService";
import ProxmoxClusterOwnerUserService from "./ProxmoxClusterOwnerUserService";
import DockerSwarmClusterOwnerUserService from "./DockerSwarmClusterOwnerUserService";
import CephClusterLabelRuleService from "./CephClusterLabelRuleService";
import CephClusterOwnerRuleService from "./CephClusterOwnerRuleService";
import CephClusterOwnerTeamService from "./CephClusterOwnerTeamService";
import CephClusterOwnerUserService from "./CephClusterOwnerUserService";
import LlmProviderService from "./LlmProviderService";
import DataSourceService from "./DataSourceService";
import AuditLogService from "./AuditLogService";
import LogService from "./LogService";
import SecurityEventService from "./SecurityEventService";
import ChangeEventService from "./ChangeEventService";
import MailService from "./MailService";
import MetricService from "./MetricService";
import MetricItemAggMV1mService from "./MetricItemAggMV1mService";
import MetricItemAggMV1mByHostV2Service from "./MetricItemAggMV1mByHostV2Service";
import MetricItemAggMV1mByServiceService from "./MetricItemAggMV1mByServiceService";
import MetricItemAggMV1mByK8sClusterService from "./MetricItemAggMV1mByK8sClusterService";
import MetricItemAggMV1mByContainerService from "./MetricItemAggMV1mByContainerService";
import MutableMetricService from "./MutableMetricService";
import MetricBaselineService from "./MetricBaselineService";
import SpanCountBaselineService from "./SpanCountBaselineService";
import LogCountBaselineService from "./LogCountBaselineService";
import MonitorCustomFieldService from "./MonitorCustomFieldService";
import MonitorLabelRuleService from "./MonitorLabelRuleService";
import MonitorTemplateService from "./MonitorTemplateService";
import MonitorGroupOwnerTeamService from "./MonitorGroupOwnerTeamService";
import MonitorGroupOwnerUserService from "./MonitorGroupOwnerUserService";
import MonitorGroupResourceService from "./MonitorGroupResourceService";
import MonitorGroupService from "./MonitorGroupService";
import MonitorOwnerTeamService from "./MonitorOwnerTeamService";
import MonitorOwnerRuleService from "./MonitorOwnerRuleService";
import MonitorOwnerUserService from "./MonitorOwnerUserService";
import MonitorProbeService from "./MonitorProbeService";
import MonitorSecretService from "./MonitorSecretService";
import RunbookCredentialService from "./RunbookCredentialService";
import RunbookOwnerRuleService from "./RunbookOwnerRuleService";
import RunbookOwnerUserService from "./RunbookOwnerUserService";
import RunbookOwnerTeamService from "./RunbookOwnerTeamService";
import RunbookLabelRuleService from "./RunbookLabelRuleService";
import RunbookSecretService from "./RunbookSecretService";
import AIInsightService from "./AIInsightService";

// Monitors
import MonitorService from "./MonitorService";
import MonitorFeedService from "./MonitorFeedService";
import KubernetesClusterFeedService from "./KubernetesClusterFeedService";
import DockerHostFeedService from "./DockerHostFeedService";
import DockerSwarmClusterFeedService from "./DockerSwarmClusterFeedService";
import CephClusterFeedService from "./CephClusterFeedService";
import PodmanHostFeedService from "./PodmanHostFeedService";
import ProxmoxClusterFeedService from "./ProxmoxClusterFeedService";
import HostFeedService from "./HostFeedService";
import CloudResourceFeedService from "./CloudResourceFeedService";
import ServiceFeedService from "./ServiceFeedService";
import MonitorStatusService from "./MonitorStatusService";
import MonitorStatusTimelineService from "./MonitorStatusTimelineService";
import NotificationService from "./NotificationService";
import OnCallDutyPolicyCustomFieldService from "./OnCallDutyPolicyCustomFieldService";
import OnCallDutyPolicyOwnerRuleService from "./OnCallDutyPolicyOwnerRuleService";
import OnCallDutyPolicyOwnerUserService from "./OnCallDutyPolicyOwnerUserService";
import OnCallDutyPolicyOwnerTeamService from "./OnCallDutyPolicyOwnerTeamService";
import OnCallDutyPolicyLabelRuleService from "./OnCallDutyPolicyLabelRuleService";
import OnCallDutyPolicyFeedService from "./OnCallDutyPolicyFeedService";
import OnCallDutyPolicyEscalationRuleScheduleService from "./OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyEscalationRuleService from "./OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyEscalationRuleTeamService from "./OnCallDutyPolicyEscalationRuleTeamService";
import OnCallDutyPolicyEscalationRuleUserService from "./OnCallDutyPolicyEscalationRuleUserService";
import OnCallDutyPolicyExecutionLogService from "./OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyExecutionLogTimelineService from "./OnCallDutyPolicyExecutionLogTimelineService";
import OnCallDutyPolicyScheduleLayerService from "./OnCallDutyPolicyScheduleLayerService";
import OnCallDutyPolicyScheduleOwnerRuleService from "./OnCallDutyPolicyScheduleOwnerRuleService";
import OnCallDutyPolicyScheduleOwnerUserService from "./OnCallDutyPolicyScheduleOwnerUserService";
import OnCallDutyPolicyScheduleOwnerTeamService from "./OnCallDutyPolicyScheduleOwnerTeamService";
import OnCallDutyPolicyScheduleLabelRuleService from "./OnCallDutyPolicyScheduleLabelRuleService";
import OnCallDutyPolicyScheduleLayerUserService from "./OnCallDutyPolicyScheduleLayerUserService";
import OnCallDutyPolicyScheduleService from "./OnCallDutyPolicyScheduleService";
// On-call calendar feeds and shift reminders
import UserOnCallCalendarFeedService from "./UserOnCallCalendarFeedService";
import OnCallDutyPolicyScheduleCalendarFeedService from "./OnCallDutyPolicyScheduleCalendarFeedService";
import ProjectOnCallCalendarFeedService from "./ProjectOnCallCalendarFeedService";
import UserOnCallShiftReminderService from "./UserOnCallShiftReminderService";
import UserOnCallShiftReminderLogService from "./UserOnCallShiftReminderLogService";
// On-Call Duty
import OnCallDutyPolicyService from "./OnCallDutyPolicyService";
import ProbeService from "./ProbeService";
import ProbeOwnerTeamService from "./ProbeOwnerTeamService";
import ProbeOwnerUserService from "./ProbeOwnerUserService";
import AIAgentService from "./AIAgentService";
import AIAgentOwnerUserService from "./AIAgentOwnerUserService";
import AIAgentOwnerTeamService from "./AIAgentOwnerTeamService";
import AIAgentTaskPullRequestService from "./AIAgentTaskPullRequestService";
import ProjectCallSMSConfigService from "./ProjectCallSMSConfigService";
import ProjectService from "./ProjectService";
import ProjectUserProfileService from "./ProjectUserProfileService";
import ProfileService from "./ProfileService";
import ProfileSampleService from "./ProfileSampleService";
import RumSessionService from "./RumSessionService";
import RumApplicationLabelRuleService from "./RumApplicationLabelRuleService";
import RumApplicationOwnerRuleService from "./RumApplicationOwnerRuleService";
import RumApplicationOwnerUserService from "./RumApplicationOwnerUserService";
import RumApplicationOwnerTeamService from "./RumApplicationOwnerTeamService";
import RumSessionChunkService from "./RumSessionChunkService";
import RumSessionReplayViewService from "./RumSessionReplayViewService";
import RumSessionErasureRequestService from "./RumSessionErasureRequestService";
import RumSessionPinService from "./RumSessionPinService";
// Project SMTP Config.
import ProjectSmtpConfigService from "./ProjectSmtpConfigService";
import ProjectSsoService from "./ProjectSsoService";
import ProjectOidcService from "./ProjectOidcService";
import GlobalSsoService from "./GlobalSsoService";
import GlobalOidcService from "./GlobalOidcService";
import GlobalSsoProjectService from "./GlobalSsoProjectService";
import GlobalOidcProjectService from "./GlobalOidcProjectService";
import PromoCodeService from "./PromoCodeService";
import EnterpriseLicenseService from "./EnterpriseLicenseService";
import EnterpriseLicenseInstanceService from "./EnterpriseLicenseInstanceService";
import OpenSourceDeploymentService from "./OpenSourceDeploymentService";
import RecommendationDismissalService from "./RecommendationDismissalService";
import ResellerPlanService from "./ResellerPlanService";
import ResellerService from "./ResellerService";
import ScheduledMaintenanceCustomFieldService from "./ScheduledMaintenanceCustomFieldService";
import ScheduledMaintenanceNoteTemplateService from "./ScheduledMaintenanceNoteTemplateService";
import ScheduledMaintenanceLabelRuleService from "./ScheduledMaintenanceLabelRuleService";
import ScheduledMaintenanceInternalNoteService from "./ScheduledMaintenanceInternalNoteService";
import ScheduledMaintenanceOwnerTeamService from "./ScheduledMaintenanceOwnerTeamService";
import ScheduledMaintenanceOwnerRuleService from "./ScheduledMaintenanceOwnerRuleService";
import ScheduledMaintenanceOwnerUserService from "./ScheduledMaintenanceOwnerUserService";
import ScheduledMaintenancePublicNoteService from "./ScheduledMaintenancePublicNoteService";
// ScheduledMaintenances
import ScheduledMaintenanceService from "./ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "./ScheduledMaintenanceStateService";
import ScheduledMaintenanceStateTimelineService from "./ScheduledMaintenanceStateTimelineService";
import ServiceOwnerTeamService from "./ServiceOwnerTeamService";
import ServiceOwnerRuleService from "./ServiceOwnerRuleService";
import ServiceLabelRuleService from "./ServiceLabelRuleService";
import ServiceOwnerUserService from "./ServiceOwnerUserService";
import ServiceService from "./ServiceService";
import ShortLinkService from "./ShortLinkService";
// SMS Log Service
import SmsLogService from "./SmsLogService";
import WhatsAppLogService from "./WhatsAppLogService";
import TelegramLogService from "./TelegramLogService";
import SmsService from "./SmsService";
import TelegramService from "./TelegramService";
import SpanService from "./SpanService";
import StatusPageAnnouncementService from "./StatusPageAnnouncementService";
import StatusPageLabelRuleService from "./StatusPageLabelRuleService";
import StatusPageAnnouncementTemplateService from "./StatusPageAnnouncementTemplateService";
import StatusPageCustomFieldService from "./StatusPageCustomFieldService";
import DashboardDomainService from "./DashboardDomainService";
import DashboardOwnerRuleService from "./DashboardOwnerRuleService";
import DashboardOwnerUserService from "./DashboardOwnerUserService";
import DashboardOwnerTeamService from "./DashboardOwnerTeamService";
import DashboardLabelRuleService from "./DashboardLabelRuleService";
import DashboardService from "./DashboardService";
import StatusPageDomainService from "./StatusPageDomainService";
import StatusPageFooterLinkService from "./StatusPageFooterLinkService";
import StatusPageGroupService from "./StatusPageGroupService";
import StatusPageHeaderLinkService from "./StatusPageHeaderLinkService";
import StatusPageHistoryChartBarColorRuleService from "./StatusPageHistoryChartBarColorRuleService";
import StatusPageOwnerTeamService from "./StatusPageOwnerTeamService";
import StatusPageOwnerRuleService from "./StatusPageOwnerRuleService";
import StatusPageOwnerUserService from "./StatusPageOwnerUserService";
import StatusPagePrivateUserService from "./StatusPagePrivateUserService";
import StatusPagePrivateUserSessionService from "./StatusPagePrivateUserSessionService";
import StatusPageResourceService from "./StatusPageResourceService";
import StatusPageMonitorRuleService from "./StatusPageMonitorRuleService";
// Status Page
import StatusPageService from "./StatusPageService";
import StatusPageSsoService from "./StatusPageSsoService";
import StatusPageOidcService from "./StatusPageOidcService";
import StatusPageSubscriberService from "./StatusPageSubscriberService";
import StatusPageSubscriberNotificationTemplateService from "./StatusPageSubscriberNotificationTemplateService";
import StatusPageSubscriberNotificationTemplateStatusPageService from "./StatusPageSubscriberNotificationTemplateStatusPageService";
import TeamMemberService from "./TeamMemberService";
import TeamMemberCustomFieldService from "./TeamMemberCustomFieldService";
import TeamPermissionService from "./TeamPermissionService";
import TeamComplianceSettingService from "./TeamComplianceSettingService";
// Team
import TeamService from "./TeamService";
import UsageBillingService from "./TelemetryUsageBillingService";
import UserCallService from "./UserCallService";
import UserEmailService from "./UserEmailService";
import UserNotificationRuleService from "./UserNotificationRuleService";
import UserNotificationSettingService from "./UserNotificationSettingService";
import UserOnCallLogService from "./UserOnCallLogService";
import UserOnCallLogTimelineService from "./UserOnCallLogTimelineService";
import UserService from "./UserService";
import UserSessionService from "./UserSessionService";
import UserTotpAuthService from "./UserTotpAuthService";
import UserTwoFactorBackupCodeService from "./UserTwoFactorBackupCodeService";
import UserWebAuthnService from "./UserWebAuthnService";
import UserSmsService from "./UserSmsService";
import UserIncomingCallNumberService from "./UserIncomingCallNumberService";
import UserWhatsAppService from "./UserWhatsAppService";
import UserTelegramService from "./UserTelegramService";
import UserSlackService from "./UserSlackService";
import UserMicrosoftTeamsService from "./UserMicrosoftTeamsService";
import WorkflowLogService from "./WorkflowLogService";
import WorkflowOwnerRuleService from "./WorkflowOwnerRuleService";
import WorkflowOwnerUserService from "./WorkflowOwnerUserService";
import WorkflowOwnerTeamService from "./WorkflowOwnerTeamService";
import WorkflowLabelRuleService from "./WorkflowLabelRuleService";
// Workflows.
import WorkflowService from "./WorkflowService";
import WorkflowVariablesService from "./WorkflowVariableService";
import AnalyticsBaseModel from "../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import TelemetryExceptionService from "./TelemetryExceptionService";
import TelemetrySourceMapService from "./TelemetrySourceMapService";
import InventoryItemService from "./InventoryItemService";
import InventoryItemCustomFieldService from "./InventoryItemCustomFieldService";
import InventoryItemRelationshipService from "./InventoryItemRelationshipService";
import ExceptionInstanceService from "./ExceptionInstanceService";
import KubernetesCostAllocationService from "./KubernetesCostAllocationService";
import ScheduledMaintenanceTemplateService from "./ScheduledMaintenanceTemplateService";
import ScheduledMaintenanceTemplateOwnerTeamService from "./ScheduledMaintenanceTemplateOwnerTeamService";
import ScheduledMaintenanceTemplateOwnerUserService from "./ScheduledMaintenanceTemplateOwnerUserService";

// Alert Services
import AlertStateService from "./AlertStateService";
import AlertOnCallRuleService from "./AlertOnCallRuleService";
import AlertPrivacyRuleService from "./AlertPrivacyRuleService";
import AlertLabelRuleService from "./AlertLabelRuleService";
import AlertService from "./AlertService";
import AlertCustomFieldService from "./AlertCustomFieldService";
import AlertStateTimelineService from "./AlertStateTimelineService";
import AlertInternalNoteService from "./AlertInternalNoteService";
import AlertOwnerTeamService from "./AlertOwnerTeamService";
import AlertOwnerRuleService from "./AlertOwnerRuleService";
import AlertOwnerUserService from "./AlertOwnerUserService";
import AlertSeverityService from "./AlertSeverityService";
import DetectionRuleService from "./DetectionRuleService";
import GoogleSecOpsConnectionService from "./GoogleSecOpsConnectionService";
import ThreatIntelFeedService from "./ThreatIntelFeedService";
import ThreatIntelIndicatorService from "./ThreatIntelIndicatorService";
import AlertNoteTemplateService from "./AlertNoteTemplateService";

// AlertEpisode Services
import AlertEpisodeService from "./AlertEpisodeService";
import AlertEpisodeOnCallRuleService from "./AlertEpisodeOnCallRuleService";
import AlertEpisodePrivacyRuleService from "./AlertEpisodePrivacyRuleService";
import AlertEpisodeLabelRuleService from "./AlertEpisodeLabelRuleService";
import AlertEpisodeFeedService from "./AlertEpisodeFeedService";
import AlertEpisodeInternalNoteService from "./AlertEpisodeInternalNoteService";
import AlertEpisodeMemberService from "./AlertEpisodeMemberService";
import AlertEpisodeOwnerTeamService from "./AlertEpisodeOwnerTeamService";
import AlertEpisodeOwnerRuleService from "./AlertEpisodeOwnerRuleService";
import AlertEpisodeOwnerUserService from "./AlertEpisodeOwnerUserService";
import AlertEpisodeStateTimelineService from "./AlertEpisodeStateTimelineService";

// IncidentEpisode Services
import IncidentEpisodeService from "./IncidentEpisodeService";
import IncidentEpisodeOnCallRuleService from "./IncidentEpisodeOnCallRuleService";
import IncidentEpisodePrivacyRuleService from "./IncidentEpisodePrivacyRuleService";
import IncidentEpisodeLabelRuleService from "./IncidentEpisodeLabelRuleService";
import IncidentEpisodeFeedService from "./IncidentEpisodeFeedService";
import IncidentEpisodeInternalNoteService from "./IncidentEpisodeInternalNoteService";
import IncidentEpisodeMemberService from "./IncidentEpisodeMemberService";
import IncidentEpisodeRoleMemberService from "./IncidentEpisodeRoleMemberService";
import IncidentEpisodeOwnerTeamService from "./IncidentEpisodeOwnerTeamService";
import IncidentEpisodeOwnerRuleService from "./IncidentEpisodeOwnerRuleService";
import IncidentEpisodeOwnerUserService from "./IncidentEpisodeOwnerUserService";
import IncidentEpisodeStateTimelineService from "./IncidentEpisodeStateTimelineService";
import IncidentEpisodePublicNoteService from "./IncidentEpisodePublicNoteService";
import AlertGroupingRuleService from "./AlertGroupingRuleService";
import IncidentSlaRuleService from "./IncidentSlaRuleService";
import IncidentMeasurementService from "./IncidentMeasurementService";
import IncidentMeasurementValueService from "./IncidentMeasurementValueService";
import AlertMeasurementService from "./AlertMeasurementService";
import AlertMeasurementValueService from "./AlertMeasurementValueService";
import ScheduledMaintenanceMeasurementService from "./ScheduledMaintenanceMeasurementService";
import ScheduledMaintenanceMeasurementValueService from "./ScheduledMaintenanceMeasurementValueService";
import IncidentSlaService from "./IncidentSlaService";
import ServiceLevelObjectiveService from "./ServiceLevelObjectiveService";
import ServiceLevelObjectiveBurnRateRuleService from "./ServiceLevelObjectiveBurnRateRuleService";
import LlmCostBudgetService from "./LlmCostBudgetService";
import LlmModelPriceService from "./LlmModelPriceService";
import ServiceLevelObjectiveOwnerUserService from "./ServiceLevelObjectiveOwnerUserService";
import ServiceLevelObjectiveOwnerTeamService from "./ServiceLevelObjectiveOwnerTeamService";
import SloHistoryService from "./SloHistoryService";
import IncidentReminderRuleService from "./IncidentReminderRuleService";
import AlertReminderRuleService from "./AlertReminderRuleService";
import ScheduledMaintenanceReminderRuleService from "./ScheduledMaintenanceReminderRuleService";

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
import WorkspaceNotificationSummaryService from "./WorkspaceNotificationSummaryService";
import WorkspaceUserNotificationService from "./WorkspaceUserNotificationService";
import OnCallDutyPolicyUserOverrideService from "./OnCallDutyPolicyUserOverrideService";

import MonitorLogService from "./MonitorLogService";
import NetworkFlowService from "./NetworkFlowService";

import OnCallDutyPolicyTimeLogService from "./OnCallDutyPolicyTimeLogService";
import ProjectSCIMLogService from "./ProjectSCIMLogService";
import StatusPageSCIMLogService from "./StatusPageSCIMLogService";
import DeletedProjectService from "./DeletedProjectService";
import CodeRepositoryService from "./CodeRepositoryService";
import WebhookLogService from "./WebhookLogService";
import HostLabelRuleService from "./HostLabelRuleService";
import HostOwnerRuleService from "./HostOwnerRuleService";
import HostOwnerTeamService from "./HostOwnerTeamService";
import HostOwnerUserService from "./HostOwnerUserService";
import IncomingCallPolicyService from "./IncomingCallPolicyService";
import PushNotificationLogService from "./PushNotificationLogService";
import RunnerOwnerTeamService from "./RunnerOwnerTeamService";
import RunnerOwnerUserService from "./RunnerOwnerUserService";
import CloudResourceLabelRuleService from "./CloudResourceLabelRuleService";
import CloudResourceOwnerRuleService from "./CloudResourceOwnerRuleService";
import CloudResourceOwnerTeamService from "./CloudResourceOwnerTeamService";
import CloudResourceOwnerUserService from "./CloudResourceOwnerUserService";
import ServerlessFunctionLabelRuleService from "./ServerlessFunctionLabelRuleService";
import ServerlessFunctionOwnerRuleService from "./ServerlessFunctionOwnerRuleService";
import ServerlessFunctionOwnerTeamService from "./ServerlessFunctionOwnerTeamService";
import ServerlessFunctionOwnerUserService from "./ServerlessFunctionOwnerUserService";
import IncomingCallPolicyEscalationRuleService from "./IncomingCallPolicyEscalationRuleService";
import IncomingCallPolicyLabelRuleService from "./IncomingCallPolicyLabelRuleService";
import IncomingCallPolicyOwnerRuleService from "./IncomingCallPolicyOwnerRuleService";
import IncomingCallPolicyOwnerTeamService from "./IncomingCallPolicyOwnerTeamService";
import IncomingCallPolicyOwnerUserService from "./IncomingCallPolicyOwnerUserService";
import IoTFleetLabelRuleService from "./IoTFleetLabelRuleService";
import IoTFleetOwnerRuleService from "./IoTFleetOwnerRuleService";
import IoTFleetOwnerTeamService from "./IoTFleetOwnerTeamService";
import IoTFleetOwnerUserService from "./IoTFleetOwnerUserService";

const services: Array<BaseService> = [
  OnCallDutyPolicyTimeLogService,
  OnCallDutyPolicyOwnerRuleService,
  OnCallDutyPolicyOwnerUserService,
  OnCallDutyPolicyOwnerTeamService,
  OnCallDutyPolicyLabelRuleService,
  OnCallDutyPolicyFeedService,
  AcmeCertificateService,
  DeletedProjectService,
  PromoCodeService,
  EnterpriseLicenseService,
  EnterpriseLicenseInstanceService,
  OpenSourceDeploymentService,

  ResellerService,
  ResellerPlanService,
  RecommendationDismissalService,
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
  MigrationFailureService,
  InstanceHealthLogService,
  DomainService,

  EmailLogService,
  EmailVerificationTokenService,

  FileService,

  GreenlockCertificateService,
  GreenlockChallengeService,

  IncidentCustomFieldService,
  IncidentOnCallRuleService,
  IncidentPrivacyRuleService,
  IncidentPostmortemTemplateService,
  IncidentNoteTemplateService,
  IncidentLabelRuleService,
  IncidentGroupingRuleService,
  IncidentTemplateService,
  IncidentTemplateOwnerTeamService,
  IncidentTemplateOwnerUserService,
  IncidentInternalNoteService,
  IncidentOwnerTeamService,
  IncidentOwnerRuleService,
  IncidentOwnerUserService,
  IncidentRoleService,
  IncidentMemberService,
  IncidentPublicNoteService,
  IncidentService,
  IncidentSeverityService,
  IncidentStateService,
  IncidentStateTimelineService,
  IncidentFeedService,

  LabelService,
  KubernetesClusterService,
  KubernetesClusterOwnerRuleService,
  KubernetesClusterOwnerUserService,
  KubernetesClusterOwnerTeamService,
  KubernetesClusterLabelRuleService,
  DockerHostService,
  DockerHostOwnerRuleService,
  DockerHostOwnerUserService,
  DockerHostOwnerTeamService,
  DockerHostLabelRuleService,
  NetworkDeviceService,
  NetworkDeviceOwnerTeamService,
  NetworkDeviceOwnerUserService,
  NetworkDeviceOwnerRuleService,
  NetworkDeviceLabelRuleService,
  NetworkDeviceAutoImportRuleService,
  NetworkDeviceOidTemplateService,
  NetworkDeviceDiscoveryScanService,
  NetworkInterfaceService,
  NetworkSiteService,
  NetworkSiteTypeService,
  NetworkEndpointService,
  NetworkSiteStatusTimelineService,
  NetworkSiteLinkService,
  NetworkDeviceLinkService,
  NetworkDeviceLinkRuleService,
  NetworkTopologySuppressionService,
  NetworkSiteAssignmentRuleService,
  PodmanHostService,
  PodmanHostOwnerRuleService,
  PodmanHostOwnerUserService,
  PodmanHostOwnerTeamService,
  PodmanHostLabelRuleService,
  ProxmoxClusterService,
  DockerSwarmClusterService,
  CephClusterService,
  ProxmoxResourceService,
  DockerSwarmResourceService,
  CephResourceService,
  ProxmoxClusterLabelRuleService,
  DockerSwarmClusterLabelRuleService,
  ProxmoxClusterOwnerRuleService,
  DockerSwarmClusterOwnerRuleService,
  ProxmoxClusterOwnerTeamService,
  DockerSwarmClusterOwnerTeamService,
  ProxmoxClusterOwnerUserService,
  DockerSwarmClusterOwnerUserService,
  CephClusterLabelRuleService,
  CephClusterOwnerRuleService,
  CephClusterOwnerTeamService,
  CephClusterOwnerUserService,
  LlmProviderService,
  DataSourceService,

  MailService,
  MonitorCustomFieldService,
  MonitorLabelRuleService,
  MonitorTemplateService,
  MonitorOwnerTeamService,
  MonitorOwnerRuleService,
  MonitorOwnerUserService,
  MonitorProbeService,
  MonitorService,
  MonitorStatusService,
  MonitorStatusTimelineService,
  MonitorSecretService,
  RunbookCredentialService,
  RunbookOwnerRuleService,
  RunbookOwnerUserService,
  RunbookOwnerTeamService,
  RunbookLabelRuleService,
  RunbookSecretService,
  AIInsightService,
  MonitorFeedService,
  KubernetesClusterFeedService,
  DockerHostFeedService,
  DockerSwarmClusterFeedService,
  CephClusterFeedService,
  PodmanHostFeedService,
  ProxmoxClusterFeedService,
  HostFeedService,
  CloudResourceFeedService,
  ServiceFeedService,

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
  ProbeOwnerTeamService,
  ProbeOwnerUserService,
  AIAgentService,
  AIAgentOwnerUserService,
  AIAgentOwnerTeamService,
  AIAgentTaskPullRequestService,
  ProjectSsoService,
  ProjectOidcService,
  GlobalSsoService,
  GlobalOidcService,
  GlobalSsoProjectService,
  GlobalOidcProjectService,

  ScheduledMaintenanceCustomFieldService,
  ScheduledMaintenanceNoteTemplateService,
  ScheduledMaintenanceLabelRuleService,
  ScheduledMaintenanceInternalNoteService,
  ScheduledMaintenanceOwnerTeamService,
  ScheduledMaintenanceOwnerRuleService,
  ScheduledMaintenanceOwnerUserService,
  ScheduledMaintenancePublicNoteService,
  ScheduledMaintenanceService,
  ScheduledMaintenanceStateService,
  ScheduledMaintenanceStateTimelineService,
  ScheduledMaintenanceFeedService,

  ShortLinkService,
  SmsLogService,
  WhatsAppLogService,
  TelegramLogService,
  SmsService,
  TelegramService,

  StatusPageAnnouncementService,
  StatusPageLabelRuleService,
  StatusPageAnnouncementTemplateService,
  StatusPageCustomFieldService,
  DashboardDomainService,
  DashboardOwnerRuleService,
  DashboardOwnerUserService,
  DashboardOwnerTeamService,
  DashboardLabelRuleService,
  DashboardService,
  StatusPageDomainService,
  StatusPageFooterLinkService,
  StatusPageGroupService,
  StatusPageHeaderLinkService,
  StatusPageOwnerTeamService,
  StatusPageOwnerRuleService,
  StatusPageOwnerUserService,
  StatusPagePrivateUserService,
  StatusPagePrivateUserSessionService,
  StatusPageResourceService,
  StatusPageMonitorRuleService,
  StatusPageService,
  StatusPageSsoService,
  StatusPageOidcService,
  StatusPageSubscriberService,
  StatusPageSubscriberNotificationTemplateService,
  StatusPageSubscriberNotificationTemplateStatusPageService,
  StatusPageHistoryChartBarColorRuleService,

  TeamMemberService,
  TeamMemberCustomFieldService,
  TeamPermissionService,
  TeamComplianceSettingService,
  TeamService,

  UserService,
  UserSessionService,
  UserCallService,
  UserEmailService,
  UserNotificationRuleService,
  UserNotificationSettingService,
  UserOnCallLogService,
  UserOnCallLogTimelineService,
  UserSmsService,
  UserIncomingCallNumberService,
  UserWhatsAppService,
  UserTelegramService,
  UserSlackService,
  UserMicrosoftTeamsService,
  UserTotpAuthService,
  UserTwoFactorBackupCodeService,
  UserWebAuthnService,

  WorkflowLogService,
  WorkflowOwnerRuleService,
  WorkflowOwnerUserService,
  WorkflowOwnerTeamService,
  WorkflowLabelRuleService,
  WorkflowService,
  WorkflowVariablesService,

  // Monitor Group Service
  MonitorGroupService,
  MonitorGroupResourceService,
  MonitorGroupOwnerUserService,
  MonitorGroupOwnerTeamService,

  // On Call Duty Policy Schedule
  OnCallDutyPolicyScheduleService,
  OnCallDutyPolicyScheduleOwnerRuleService,
  OnCallDutyPolicyScheduleOwnerUserService,
  OnCallDutyPolicyScheduleOwnerTeamService,
  OnCallDutyPolicyScheduleLabelRuleService,
  OnCallDutyPolicyScheduleLayerUserService,
  // On-call calendar feeds and shift reminders
  UserOnCallCalendarFeedService,
  OnCallDutyPolicyScheduleCalendarFeedService,
  ProjectOnCallCalendarFeedService,
  UserOnCallShiftReminderService,
  UserOnCallShiftReminderLogService,
  OnCallDutyPolicyScheduleLayerService,
  OnCallDutyPolicyEscalationRuleScheduleService,

  UsageBillingService,
  ProjectCallSMSConfigService,
  ProjectUserProfileService,

  ServiceService,
  ServiceLabelRuleService,
  ServiceOwnerTeamService,
  ServiceOwnerRuleService,
  ServiceOwnerUserService,

  TelemetryExceptionService,
  TelemetrySourceMapService,
  InventoryItemService,
  InventoryItemCustomFieldService,
  InventoryItemRelationshipService,

  // scheduled maintenance templates
  ScheduledMaintenanceTemplateService,
  ScheduledMaintenanceTemplateOwnerTeamService,
  ScheduledMaintenanceTemplateOwnerUserService,

  AlertStateService,
  AlertOnCallRuleService,
  AlertPrivacyRuleService,
  AlertLabelRuleService,
  AlertService,
  AlertCustomFieldService,
  AlertStateTimelineService,
  AlertInternalNoteService,
  AlertOwnerTeamService,
  AlertOwnerRuleService,
  AlertOwnerUserService,
  AlertSeverityService,
  DetectionRuleService,
  GoogleSecOpsConnectionService,
  ThreatIntelFeedService,
  AlertNoteTemplateService,
  AlertFeedService,

  // AlertEpisode Services
  AlertEpisodeService,
  AlertEpisodeOnCallRuleService,
  AlertEpisodePrivacyRuleService,
  AlertEpisodeLabelRuleService,
  AlertEpisodeFeedService,
  AlertEpisodeInternalNoteService,
  AlertEpisodeMemberService,
  AlertEpisodeOwnerTeamService,
  AlertEpisodeOwnerRuleService,
  AlertEpisodeOwnerUserService,
  AlertEpisodeStateTimelineService,

  // IncidentEpisode Services
  IncidentEpisodeService,
  IncidentEpisodeOnCallRuleService,
  IncidentEpisodePrivacyRuleService,
  IncidentEpisodeLabelRuleService,
  IncidentEpisodeFeedService,
  IncidentEpisodeInternalNoteService,
  IncidentEpisodeMemberService,
  IncidentEpisodeRoleMemberService,
  IncidentEpisodeOwnerTeamService,
  IncidentEpisodeOwnerRuleService,
  IncidentEpisodeOwnerUserService,
  IncidentEpisodeStateTimelineService,
  IncidentEpisodePublicNoteService,
  AlertGroupingRuleService,
  IncidentSlaRuleService,
  IncidentMeasurementService,
  IncidentMeasurementValueService,
  AlertMeasurementService,
  AlertMeasurementValueService,
  ScheduledMaintenanceMeasurementService,
  ScheduledMaintenanceMeasurementValueService,
  IncidentSlaService,
  ServiceLevelObjectiveService,
  ServiceLevelObjectiveBurnRateRuleService,
  LlmCostBudgetService,
  LlmModelPriceService,
  ServiceLevelObjectiveOwnerUserService,
  ServiceLevelObjectiveOwnerTeamService,
  IncidentReminderRuleService,
  AlertReminderRuleService,
  ScheduledMaintenanceReminderRuleService,

  TableViewService,
  MonitorTestService,

  WorkspaceProjectAuthTokenService,
  WorkspaceUserAuthTokenService,
  WorkspaceSettingService,
  WorkspaceNotificationRuleService,
  WorkspaceNotificationLogService,
  WorkspaceNotificationSummaryService,
  WorkspaceUserNotificationService,

  ProjectSCIMLogService,
  StatusPageSCIMLogService,

  // Session replay control tables (the recordings themselves are in ClickHouse).
  RumSessionReplayViewService,
  RumApplicationLabelRuleService,
  RumApplicationOwnerRuleService,
  RumApplicationOwnerUserService,
  RumApplicationOwnerTeamService,
  RumSessionErasureRequestService,
  RumSessionPinService,

  /*
   * Workflow-enabled models whose services had never been registered here,
   * so their components showed up in the editor palette but threw
   * "Component <id> not found" at execution time. Kept together because
   * none of these families has an existing entry to sit next to.
   */
  CloudResourceLabelRuleService,
  CloudResourceOwnerRuleService,
  CloudResourceOwnerTeamService,
  CloudResourceOwnerUserService,
  CodeRepositoryService,
  HostLabelRuleService,
  HostOwnerRuleService,
  HostOwnerTeamService,
  HostOwnerUserService,
  IncomingCallPolicyService,
  IncomingCallPolicyEscalationRuleService,
  IncomingCallPolicyLabelRuleService,
  IncomingCallPolicyOwnerRuleService,
  IncomingCallPolicyOwnerTeamService,
  IncomingCallPolicyOwnerUserService,
  IoTFleetLabelRuleService,
  IoTFleetOwnerRuleService,
  IoTFleetOwnerTeamService,
  IoTFleetOwnerUserService,
  PushNotificationLogService,
  RunnerOwnerTeamService,
  RunnerOwnerUserService,
  ServerlessFunctionLabelRuleService,
  ServerlessFunctionOwnerRuleService,
  ServerlessFunctionOwnerTeamService,
  ServerlessFunctionOwnerUserService,
  WebhookLogService,
];

export const AnalyticsServices: Array<
  AnalyticsDatabaseService<AnalyticsBaseModel>
> = [
  LogService,
  SpanService,
  MetricService,
  MutableMetricService,
  SloHistoryService,
  /*
   * Materialized-view target tables. The auto-create flow runs
   * `CREATE TABLE IF NOT EXISTS` for these, idempotent with the legacy
   * DataMigrations that also create them. Both kept for backward compat.
   */
  MetricItemAggMV1mService,
  MetricItemAggMV1mByHostV2Service,
  MetricItemAggMV1mByServiceService,
  MetricItemAggMV1mByK8sClusterService,
  MetricItemAggMV1mByContainerService,
  MetricBaselineService,
  /*
   * Span/log volume baselines for the count anomaly criteria. Same MV
   * target pattern as MetricBaselineService.
   */
  SpanCountBaselineService,
  LogCountBaselineService,
  ExceptionInstanceService,
  KubernetesCostAllocationService,
  MonitorLogService,
  NetworkFlowService,
  ProfileService,
  ProfileSampleService,
  /*
   * Session replay. THIS is the array boot-time createTables() iterates —
   * omitting it here means the tables are silently never created, however
   * correctly the models are registered elsewhere.
   */
  RumSessionService,
  RumSessionChunkService,
  AuditLogService,
  SecurityEventService,
  ThreatIntelIndicatorService,
  ChangeEventService,
];

export default services;
