import BaseAPI from "Common/Server/API/BaseAPI";
import BaseAnalyticsAPI from "Common/Server/API/BaseAnalyticsAPI";
import BillingAPI from "Common/Server/API/BillingAPI";
import BillingInvoiceAPI from "Common/Server/API/BillingInvoiceAPI";
import BillingPaymentMethodAPI from "Common/Server/API/BillingPaymentMethodAPI";
import FileAPI from "Common/Server/API/FileAPI";
import GlobalConfigAPI from "Common/Server/API/GlobalConfigAPI";
import MonitorGroupAPI from "Common/Server/API/MonitorGroupAPI";
import NotificationAPI from "Common/Server/API/NotificationAPI";
import AIBillingAPI from "Common/Server/API/AIBillingAPI";
import TelemetryAPI from "Common/Server/API/TelemetryAPI";
import ProbeAPI from "Common/Server/API/ProbeAPI";
import LlmProviderAPI from "Common/Server/API/LlmProviderAPI";
import ProjectAPI from "Common/Server/API/ProjectAPI";
import ProjectSsoAPI from "Common/Server/API/ProjectSSO";
import WhatsAppLogAPI from "./WhatsAppLogAPI";

// Import API
import ResellerPlanAPI from "Common/Server/API/ResellerPlanAPI";
import EnterpriseLicenseAPI from "Common/Server/API/EnterpriseLicenseAPI";
import MonitorAPI from "Common/Server/API/MonitorAPI";
import ShortLinkAPI from "Common/Server/API/ShortLinkAPI";
import StatusPageAPI from "Common/Server/API/StatusPageAPI";
import WorkspaceNotificationRuleAPI from "Common/Server/API/WorkspaceNotificationRuleAPI";
import StatusPageDomainAPI from "Common/Server/API/StatusPageDomainAPI";
import StatusPageSubscriberAPI from "Common/Server/API/StatusPageSubscriberAPI";
import UserCallAPI from "Common/Server/API/UserCallAPI";
import UserTotpAuthAPI from "Common/Server/API/UserTotpAuthAPI";
import UserWebAuthnAPI from "Common/Server/API/UserWebAuthnAPI";
import MonitorTest from "Common/Models/DatabaseModels/MonitorTest";
import IncidentInternalNoteAPI from "Common/Server/API/IncidentInternalNoteAPI";
import IncidentPublicNoteAPI from "Common/Server/API/IncidentPublicNoteAPI";
import ScheduledMaintenanceInternalNoteAPI from "Common/Server/API/ScheduledMaintenanceInternalNoteAPI";
import ScheduledMaintenancePublicNoteAPI from "Common/Server/API/ScheduledMaintenancePublicNoteAPI";
import IncidentAPI from "Common/Server/API/IncidentAPI";
import ScheduledMaintenanceAPI from "Common/Server/API/ScheduledMaintenanceAPI";
import AlertAPI from "Common/Server/API/AlertAPI";
// User Notification methods.
import UserEmailAPI from "Common/Server/API/UserEmailAPI";
import UserNotificationLogTimelineAPI from "Common/Server/API/UserOnCallLogTimelineAPI";
import UserSMSAPI from "Common/Server/API/UserSmsAPI";
import UserWhatsAppAPI from "Common/Server/API/UserWhatsAppAPI";
import UserPushAPI from "Common/Server/API/UserPushAPI";
import UserAPI from "Common/Server/API/UserAPI";
import ApiKeyPermissionService, {
  Service as ApiKeyPermissionServiceType,
} from "Common/Server/Services/ApiKeyPermissionService";
import ApiKeyService, {
  Service as ApiKeyServiceType,
} from "Common/Server/Services/ApiKeyService";
import CallLogService, {
  Service as CallLogServiceType,
} from "Common/Server/Services/CallLogService";
import DomainService, {
  Service as DomainServiceType,
} from "Common/Server/Services/DomainService";
import EmailLogService, {
  Service as EmailLogServiceType,
} from "Common/Server/Services/EmailLogService";
import TelemetryIngestionKeyService, {
  Service as TelemetryIngestionKeyServiceType,
} from "Common/Server/Services/TelemetryIngestionKeyService";
import EmailVerificationTokenService, {
  Service as EmailVerificationTokenServiceType,
} from "Common/Server/Services/EmailVerificationTokenService";

import AlertCustomFieldService, {
  Service as AlertCustomFieldServiceType,
} from "Common/Server/Services/AlertCustomFieldService";
import AlertInternalNoteAPI from "Common/Server/API/AlertInternalNoteAPI";
import AlertNoteTemplateService, {
  Service as AlertNoteTemplateServiceType,
} from "Common/Server/Services/AlertNoteTemplateService";
import AlertOwnerTeamService, {
  Service as AlertOwnerTeamServiceType,
} from "Common/Server/Services/AlertOwnerTeamService";

import DashboardService, {
  Service as DashboardServiceType,
} from "Common/Server/Services/DashboardService";

import AlertOwnerUserService, {
  Service as AlertOwnerUserServiceType,
} from "Common/Server/Services/AlertOwnerUserService";
import AlertService, {
  Service as AlertServiceType,
} from "Common/Server/Services/AlertService";
import AlertSeverityService, {
  Service as AlertSeverityServiceType,
} from "Common/Server/Services/AlertSeverityService";
import AlertStateService, {
  Service as AlertStateServiceType,
} from "Common/Server/Services/AlertStateService";
import AlertStateTimelineService, {
  Service as AlertStateTimelineServiceType,
} from "Common/Server/Services/AlertStateTimelineService";

import IncidentCustomFieldService, {
  Service as IncidentCustomFieldServiceType,
} from "Common/Server/Services/IncidentCustomFieldService";
import IncidentNoteTemplateService, {
  Service as IncidentNoteTemplateServiceType,
} from "Common/Server/Services/IncidentNoteTemplateService";
import IncidentPostmortemTemplateService, {
  Service as IncidentPostmortemTemplateServiceType,
} from "Common/Server/Services/IncidentPostmortemTemplateService";
import TableViewService, {
  Service as TableViewServiceType,
} from "Common/Server/Services/TableViewService";
import IncidentOwnerTeamService, {
  Service as IncidentOwnerTeamServiceType,
} from "Common/Server/Services/IncidentOwnerTeamService";
import IncidentOwnerUserService, {
  Service as IncidentOwnerUserServiceType,
} from "Common/Server/Services/IncidentOwnerUserService";
import IncidentSeverityService, {
  Service as IncidentSeverityServiceType,
} from "Common/Server/Services/IncidentSeverityService";
import IncidentStateService, {
  Service as IncidentStateServiceType,
} from "Common/Server/Services/IncidentStateService";
import MonitorTestService, {
  Service as MonitorTestServiceType,
} from "Common/Server/Services/MonitorTestService";
import IncidentStateTimelineService, {
  Service as IncidentStateTimelineServiceType,
} from "Common/Server/Services/IncidentStateTimelineService";
import IncidentTemplateOwnerTeamService, {
  Service as IncidentTemplateOwnerTeamServiceType,
} from "Common/Server/Services/IncidentTemplateOwnerTeamService";
import IncidentTemplateOwnerUserService, {
  Service as IncidentTemplateOwnerUserServiceType,
} from "Common/Server/Services/IncidentTemplateOwnerUserService";
import IncidentTemplateService, {
  Service as IncidentTemplateServiceType,
} from "Common/Server/Services/IncidentTemplateService";
import LabelService, {
  Service as LabelServiceType,
} from "Common/Server/Services/LabelService";
import LogService, {
  LogService as LogServiceType,
} from "Common/Server/Services/LogService";

import MetricService, {
  MetricService as MetricServiceType,
} from "Common/Server/Services/MetricService";
import MonitorCustomFieldService, {
  Service as MonitorCustomFieldServiceType,
} from "Common/Server/Services/MonitorCustomFieldService";
import MonitorGroupOwnerTeamService, {
  Service as MonitorGroupOwnerTeamServiceType,
} from "Common/Server/Services/MonitorGroupOwnerTeamService";
import MonitorGroupOwnerUserService, {
  Service as MonitorGroupOwnerUserServiceType,
} from "Common/Server/Services/MonitorGroupOwnerUserService";
import MonitorGroupResourceService, {
  Service as MonitorGroupResourceServiceType,
} from "Common/Server/Services/MonitorGroupResourceService";
import MonitorOwnerTeamService, {
  Service as MonitorOwnerTeamServiceType,
} from "Common/Server/Services/MonitorOwnerTeamService";
import MonitorOwnerUserService, {
  Service as MonitorOwnerUserServiceType,
} from "Common/Server/Services/MonitorOwnerUserService";
import MonitorProbeService, {
  Service as MonitorProbeServiceType,
} from "Common/Server/Services/MonitorProbeService";
import MonitorSecretService, {
  Service as MonitorSecretServiceType,
} from "Common/Server/Services/MonitorSecretService";
import MonitorStatusService, {
  Service as MonitorStatusServiceType,
} from "Common/Server/Services/MonitorStatusService";
import MonitorTimelineStatusService, {
  Service as MonitorTimelineStatusServiceType,
} from "Common/Server/Services/MonitorStatusTimelineService";
// user override
import OnCallDutyPolicyUserOverrideService, {
  Service as OnCallDutyPolicyUserOverrideServiceType,
} from "Common/Server/Services/OnCallDutyPolicyUserOverrideService";
import OnCallDutyPolicyUserOverride from "Common/Models/DatabaseModels/OnCallDutyPolicyUserOverride";
import OnCallDutyPolicyCustomFieldService, {
  Service as OnCallDutyPolicyCustomFieldServiceType,
} from "Common/Server/Services/OnCallDutyPolicyCustomFieldService";
import OnCallDutyPolicyEscalationRuleScheduleService, {
  Service as OnCallDutyPolicyEscalationRuleScheduleServiceType,
} from "Common/Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyEscalationRuleService, {
  Service as OnCallDutyPolicyEscalationRuleServiceType,
} from "Common/Server/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyEscalationRuleTeamService, {
  Service as OnCallDutyPolicyEscalationRuleTeamServiceType,
} from "Common/Server/Services/OnCallDutyPolicyEscalationRuleTeamService";
import OnCallDutyPolicyEscalationRuleUserService, {
  Service as OnCallDutyPolicyEscalationRuleUserServiceType,
} from "Common/Server/Services/OnCallDutyPolicyEscalationRuleUserService";
import OnCallDutyPolicyExecutionLogService, {
  Service as OnCallDutyPolicyExecutionLogServiceType,
} from "Common/Server/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyExecutionLogTimelineService, {
  Service as OnCallDutyPolicyExecutionLogTimelineServiceType,
} from "Common/Server/Services/OnCallDutyPolicyExecutionLogTimelineService";
import OnCallDutyPolicyScheduleLayerService, {
  Service as OnCallDutyPolicyScheduleLayerServiceType,
} from "Common/Server/Services/OnCallDutyPolicyScheduleLayerService";
import OnCallDutyPolicyScheduleLayerUserService, {
  Service as OnCallDutyPolicyScheduleLayerUserServiceType,
} from "Common/Server/Services/OnCallDutyPolicyScheduleLayerUserService";
import OnCallDutyPolicyScheduleService, {
  Service as OnCallDutyPolicyScheduleServiceType,
} from "Common/Server/Services/OnCallDutyPolicyScheduleService";
import ProjectCallSMSConfigService, {
  Service as ProjectCallSMSConfigServiceType,
} from "Common/Server/Services/ProjectCallSMSConfigService";
import ProjectSmtpConfigService, {
  Service as ProjectSMTPConfigServiceType,
} from "Common/Server/Services/ProjectSmtpConfigService";
import PromoCodeService, {
  Service as PromoCodeServiceType,
} from "Common/Server/Services/PromoCodeService";
import CodeRepositoryService, {
  Service as CodeRepositoryServiceType,
} from "Common/Server/Services/CodeRepositoryService";
import ResellerService, {
  Service as ResellerServiceType,
} from "Common/Server/Services/ResellerService";
import ScheduledMaintenanceCustomFieldService, {
  Service as ScheduledMaintenanceCustomFieldServiceType,
} from "Common/Server/Services/ScheduledMaintenanceCustomFieldService";
import ScheduledMaintenanceNoteTemplateService, {
  Service as ScheduledMaintenanceNoteTemplateServiceType,
} from "Common/Server/Services/ScheduledMaintenanceNoteTemplateService";
import ScheduledMaintenanceOwnerTeamService, {
  Service as ScheduledMaintenanceOwnerTeamServiceType,
} from "Common/Server/Services/ScheduledMaintenanceOwnerTeamService";
import ScheduledMaintenanceOwnerUserService, {
  Service as ScheduledMaintenanceOwnerUserServiceType,
} from "Common/Server/Services/ScheduledMaintenanceOwnerUserService";
import ScheduledMaintenanceService, {
  Service as ScheduledMaintenanceServiceType,
} from "Common/Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService, {
  Service as ScheduledMaintenanceStateServiceType,
} from "Common/Server/Services/ScheduledMaintenanceStateService";
import ScheduledMaintenanceStateTimelineService, {
  Service as ScheduledMaintenanceStateTimelineServiceType,
} from "Common/Server/Services/ScheduledMaintenanceStateTimelineService";
import ServiceCatalogOwnerTeamService, {
  Service as ServiceCatalogOwnerTeamServiceType,
} from "Common/Server/Services/ServiceCatalogOwnerTeamService";
import ServiceCatalogOwnerUserService, {
  Service as ServiceCatalogOwnerUserServiceType,
} from "Common/Server/Services/ServiceCatalogOwnerUserService";
import ServiceCatalogService, {
  Service as ServiceCatalogServiceType,
} from "Common/Server/Services/ServiceCatalogService";
import ServiceCatalogDependencyService, {
  Service as ServiceCatalogDependencyServiceType,
} from "Common/Server/Services/ServiceCatalogDependencyService";
import ServiceCatalogMonitor from "Common/Models/DatabaseModels/ServiceCatalogMonitor";
import ServiceCatalogMonitorService, {
  Service as ServiceCatalogMonitorServiceType,
} from "Common/Server/Services/ServiceCatalogMonitorService";

import ServiceCatalogTelemetryService from "Common/Models/DatabaseModels/ServiceCatalogTelemetryService";
import ServiceCatalogTelemetryServiceService, {
  Service as ServiceCatalogTelemetryServiceServiceType,
} from "Common/Server/Services/ServiceCatalogTelemetryServiceService";

import ServiceCatalogCodeRepository from "Common/Models/DatabaseModels/ServiceCatalogCodeRepository";
import ServiceCatalogCodeRepositoryService, {
  Service as ServiceCatalogCodeRepositoryServiceType,
} from "Common/Server/Services/ServiceCatalogCodeRepositoryService";

import ShortLinkService, {
  Service as ShortLinkServiceType,
} from "Common/Server/Services/ShortLinkService";
import SmsLogService, {
  Service as SmsLogServiceType,
} from "Common/Server/Services/SmsLogService";
import PushNotificationLogService, {
  Service as PushNotificationLogServiceType,
} from "Common/Server/Services/PushNotificationLogService";
import SpanService, {
  SpanService as SpanServiceType,
} from "Common/Server/Services/SpanService";
import StatusPageAnnouncementAPI from "Common/Server/API/StatusPageAnnouncementAPI";
import StatusPageCustomFieldService, {
  Service as StatusPageCustomFieldServiceType,
} from "Common/Server/Services/StatusPageCustomFieldService";
import StatusPageFooterLinkService, {
  Service as StatusPageFooterLinkServiceType,
} from "Common/Server/Services/StatusPageFooterLinkService";
import StatusPageGroupService, {
  Service as StatusPageGroupServiceType,
} from "Common/Server/Services/StatusPageGroupService";
import StatusPageHeaderLinkService, {
  Service as StatusPageHeaderLinkServiceType,
} from "Common/Server/Services/StatusPageHeaderLinkService";
import StatusPageHistoryChartBarColorRuleService, {
  Service as StatusPageHistoryChartBarColorRuleServiceType,
} from "Common/Server/Services/StatusPageHistoryChartBarColorRuleService";
import StatusPageOwnerTeamService, {
  Service as StatusPageOwnerTeamServiceType,
} from "Common/Server/Services/StatusPageOwnerTeamService";
import StatusPageOwnerUserService, {
  Service as StatusPageOwnerUserServiceType,
} from "Common/Server/Services/StatusPageOwnerUserService";
import StatusPagePrivateUserService, {
  Service as StatusPagePrivateUserServiceType,
} from "Common/Server/Services/StatusPagePrivateUserService";
import StatusPageResourceService, {
  Service as StatusPageResourceServiceType,
} from "Common/Server/Services/StatusPageResourceService";
import StatusPageSSOService, {
  Service as StatusPageSSOServiceType,
} from "Common/Server/Services/StatusPageSsoService";
import TeamMemberService, {
  TeamMemberService as TeamMemberServiceType,
} from "Common/Server/Services/TeamMemberService";
import TeamPermissionService, {
  Service as TeamPermissionServiceType,
} from "Common/Server/Services/TeamPermissionService";
import TeamComplianceSettingService, {
  TeamComplianceSettingService as TeamComplianceSettingServiceType,
} from "Common/Server/Services/TeamComplianceSettingService";
import TeamService, {
  Service as TeamServiceType,
} from "Common/Server/Services/TeamService";
import TelemetryServiceService, {
  Service as TelemetryServiceServiceType,
} from "Common/Server/Services/TelemetryServiceService";
import TelemetryUsageBillingService, {
  Service as TelemetryUsageBillingServiceType,
} from "Common/Server/Services/TelemetryUsageBillingService";
import UserNotificationRuleService, {
  Service as UserNotificationRuleServiceType,
} from "Common/Server/Services/UserNotificationRuleService";
import UserNotificationSettingService, {
  Service as UserNotificationSettingServiceType,
} from "Common/Server/Services/UserNotificationSettingService";
import UserOnCallLogService, {
  Service as UserNotificationLogServiceType,
} from "Common/Server/Services/UserOnCallLogService";
import WorkflowLogService, {
  Service as WorkflowLogServiceType,
} from "Common/Server/Services/WorkflowLogService";
import WorkflowService, {
  Service as WorkflowServiceType,
} from "Common/Server/Services/WorkflowService";
import WorkflowVariableService, {
  Service as WorkflowVariableServiceType,
} from "Common/Server/Services/WorkflowVariableService";

import ProbeOwnerTeamService, {
  Service as ProbeOwnerTeamServiceType,
} from "Common/Server/Services/ProbeOwnerTeamService";

import ProbeOwnerUserService, {
  Service as ProbeOwnerUserServiceType,
} from "Common/Server/Services/ProbeOwnerUserService";

import LlmLogService, {
  Service as LlmLogServiceType,
} from "Common/Server/Services/LlmLogService";

import TelemetryExceptionService, {
  Service as TelemetryExceptionServiceType,
} from "Common/Server/Services/TelemetryExceptionService";

import ExceptionInstanceService, {
  ExceptionInstanceService as ExceptionInstanceServiceType,
} from "Common/Server/Services/ExceptionInstanceService";
import AcmeChallengeAPI from "Common/Server/API/AcmeChallengeAPI";

import FeatureSet from "Common/Server/Types/FeatureSet";
import Express, { ExpressApplication } from "Common/Server/Utils/Express";
import Log from "Common/Models/AnalyticsModels/Log";
import Metric from "Common/Models/AnalyticsModels/Metric";
import Span from "Common/Models/AnalyticsModels/Span";
import ApiKey from "Common/Models/DatabaseModels/ApiKey";
import ApiKeyPermission from "Common/Models/DatabaseModels/ApiKeyPermission";
import CallLog from "Common/Models/DatabaseModels/CallLog";
import PushNotificationLog from "Common/Models/DatabaseModels/PushNotificationLog";
import WorkspaceNotificationLog from "Common/Models/DatabaseModels/WorkspaceNotificationLog";
import Domain from "Common/Models/DatabaseModels/Domain";
import EmailLog from "Common/Models/DatabaseModels/EmailLog";
import EmailVerificationToken from "Common/Models/DatabaseModels/EmailVerificationToken";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";

import Alert from "Common/Models/DatabaseModels/Alert";
import AlertCustomField from "Common/Models/DatabaseModels/AlertCustomField";
import AlertNoteTemplate from "Common/Models/DatabaseModels/AlertNoteTemplate";
import AlertOwnerTeam from "Common/Models/DatabaseModels/AlertOwnerTeam";
import AlertOwnerUser from "Common/Models/DatabaseModels/AlertOwnerUser";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import AlertStateTimeline from "Common/Models/DatabaseModels/AlertStateTimeline";

import IncidentCustomField from "Common/Models/DatabaseModels/IncidentCustomField";
import IncidentNoteTemplate from "Common/Models/DatabaseModels/IncidentNoteTemplate";
import IncidentPostmortemTemplate from "Common/Models/DatabaseModels/IncidentPostmortemTemplate";
import IncidentOwnerTeam from "Common/Models/DatabaseModels/IncidentOwnerTeam";
import IncidentOwnerUser from "Common/Models/DatabaseModels/IncidentOwnerUser";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "Common/Models/DatabaseModels/IncidentStateTimeline";
import IncidentTemplate from "Common/Models/DatabaseModels/IncidentTemplate";
import IncidentTemplateOwnerTeam from "Common/Models/DatabaseModels/IncidentTemplateOwnerTeam";
import IncidentTemplateOwnerUser from "Common/Models/DatabaseModels/IncidentTemplateOwnerUser";

import Label from "Common/Models/DatabaseModels/Label";
import MonitorCustomField from "Common/Models/DatabaseModels/MonitorCustomField";
import MonitorGroupOwnerTeam from "Common/Models/DatabaseModels/MonitorGroupOwnerTeam";
import MonitorGroupOwnerUser from "Common/Models/DatabaseModels/MonitorGroupOwnerUser";
import MonitorGroupResource from "Common/Models/DatabaseModels/MonitorGroupResource";
import MonitorOwnerTeam from "Common/Models/DatabaseModels/MonitorOwnerTeam";
import MonitorOwnerUser from "Common/Models/DatabaseModels/MonitorOwnerUser";
import MonitorProbe from "Common/Models/DatabaseModels/MonitorProbe";
import MonitorSecret from "Common/Models/DatabaseModels/MonitorSecret";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import MonitorTimelineStatus from "Common/Models/DatabaseModels/MonitorStatusTimeline";
import OnCallDutyPolicyCustomField from "Common/Models/DatabaseModels/OnCallDutyPolicyCustomField";
import OnCallDutyPolicyEscalationRule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleSchedule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleTeam from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleUser from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import OnCallDutyPolicyExecutionLog from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogTimeline from "Common/Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import OnCallDutyPolicySchedule from "Common/Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleLayer from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import ProjectCallSMSConfig from "Common/Models/DatabaseModels/ProjectCallSMSConfig";
import ProjectSmtpConfig from "Common/Models/DatabaseModels/ProjectSmtpConfig";
import PromoCode from "Common/Models/DatabaseModels/PromoCode";
import CodeRepository from "Common/Models/DatabaseModels/CodeRepository";
import Reseller from "Common/Models/DatabaseModels/Reseller";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceCustomField from "Common/Models/DatabaseModels/ScheduledMaintenanceCustomField";
import ScheduledMaintenanceNoteTemplate from "Common/Models/DatabaseModels/ScheduledMaintenanceNoteTemplate";
import ScheduledMaintenanceOwnerTeam from "Common/Models/DatabaseModels/ScheduledMaintenanceOwnerTeam";
import ScheduledMaintenanceOwnerUser from "Common/Models/DatabaseModels/ScheduledMaintenanceOwnerUser";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "Common/Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import ServiceCatalog from "Common/Models/DatabaseModels/ServiceCatalog";
import ServiceCatalogOwnerTeam from "Common/Models/DatabaseModels/ServiceCatalogOwnerTeam";
import ServiceCatalogOwnerUser from "Common/Models/DatabaseModels/ServiceCatalogOwnerUser";
import ShortLink from "Common/Models/DatabaseModels/ShortLink";
import SmsLog from "Common/Models/DatabaseModels/SmsLog";
// Custom Fields API
import StatusPageCustomField from "Common/Models/DatabaseModels/StatusPageCustomField";
import StatusPageFooterLink from "Common/Models/DatabaseModels/StatusPageFooterLink";
import StatusPageGroup from "Common/Models/DatabaseModels/StatusPageGroup";
import StatusPageHeaderLink from "Common/Models/DatabaseModels/StatusPageHeaderLink";
import TelemetryIngestionKey from "Common/Models/DatabaseModels/TelemetryIngestionKey";
import StatusPageHistoryChartBarColorRule from "Common/Models/DatabaseModels/StatusPageHistoryChartBarColorRule";
import StatusPageOwnerTeam from "Common/Models/DatabaseModels/StatusPageOwnerTeam";
import StatusPageOwnerUser from "Common/Models/DatabaseModels/StatusPageOwnerUser";
import StatusPagePrivateUser from "Common/Models/DatabaseModels/StatusPagePrivateUser";
import StatusPageResource from "Common/Models/DatabaseModels/StatusPageResource";
import StatusPageSSO from "Common/Models/DatabaseModels/StatusPageSso";
import Team from "Common/Models/DatabaseModels/Team";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import TeamPermission from "Common/Models/DatabaseModels/TeamPermission";
import TeamComplianceSetting from "Common/Models/DatabaseModels/TeamComplianceSetting";
import TelemetryService from "Common/Models/DatabaseModels/TelemetryService";
import TelemetryUsageBilling from "Common/Models/DatabaseModels/TelemetryUsageBilling";
import UserNotificationRule from "Common/Models/DatabaseModels/UserNotificationRule";
import UserNotificationSetting from "Common/Models/DatabaseModels/UserNotificationSetting";
import UserOnCallLog from "Common/Models/DatabaseModels/UserOnCallLog";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import WorkflowLog from "Common/Models/DatabaseModels/WorkflowLog";
import WorkflowVariable from "Common/Models/DatabaseModels/WorkflowVariable";
import ProbeOwnerTeam from "Common/Models/DatabaseModels/ProbeOwnerTeam";
import ProbeOwnerUser from "Common/Models/DatabaseModels/ProbeOwnerUser";
import LlmLog from "Common/Models/DatabaseModels/LlmLog";
import ServiceCatalogDependency from "Common/Models/DatabaseModels/ServiceCatalogDependency";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import TelemetyException from "Common/Models/DatabaseModels/TelemetryException";
import WorkspaceNotificationLogService, {
  Service as WorkspaceNotificationLogServiceType,
} from "Common/Server/Services/WorkspaceNotificationLogService";

// scheduled maintenance template
import ScheduledMaintenanceTemplate from "Common/Models/DatabaseModels/ScheduledMaintenanceTemplate";
import ScheduledMaintenanceTemplateOwnerTeam from "Common/Models/DatabaseModels/ScheduledMaintenanceTemplateOwnerTeam";
import ScheduledMaintenanceTemplateOwnerUser from "Common/Models/DatabaseModels/ScheduledMaintenanceTemplateOwnerUser";
import ScheduledMaintenanceTemplateService, {
  Service as ScheduledMaintenanceTemplateServiceType,
} from "Common/Server/Services/ScheduledMaintenanceTemplateService";
import ScheduledMaintenanceTemplateOwnerTeamService, {
  Service as ScheduledMaintenanceTemplateOwnerTeamServiceType,
} from "Common/Server/Services/ScheduledMaintenanceTemplateOwnerTeamService";
import ScheduledMaintenanceTemplateOwnerUserService, {
  Service as ScheduledMaintenanceTemplateOwnerUserServiceType,
} from "Common/Server/Services/ScheduledMaintenanceTemplateOwnerUserService";
import TableView from "Common/Models/DatabaseModels/TableView";

import IncidentFeed from "Common/Models/DatabaseModels/IncidentFeed";
import AlertFeed from "Common/Models/DatabaseModels/AlertFeed";
import ScheduledMaintenanceFeed from "Common/Models/DatabaseModels/ScheduledMaintenanceFeed";

import IncidentFeedService, {
  Service as IncidentFeedServiceType,
} from "Common/Server/Services/IncidentFeedService";

import AlertFeedService, {
  Service as AlertFeedServiceType,
} from "Common/Server/Services/AlertFeedService";

import ScheduledMaintenanceFeedService, {
  Service as ScheduledMaintenanceFeedServiceType,
} from "Common/Server/Services/ScheduledMaintenanceFeedService";

import SlackAPI from "Common/Server/API/SlackAPI";
import MicrosoftTeamsAPI from "Common/Server/API/MicrosoftTeamsAPI";
import GitHubAPI from "Common/Server/API/GitHubAPI";

import WorkspaceProjectAuthToken from "Common/Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceProjectAuthTokenService, {
  Service as WorkspaceProjectAuthTokenServiceType,
} from "Common/Server/Services/WorkspaceProjectAuthTokenService";

import WorkspaceUserAuthToken from "Common/Models/DatabaseModels/WorkspaceUserAuthToken";

import WorkspaceUserAuthTokenService, {
  Service as WorkspaceUserAuthTokenServiceType,
} from "Common/Server/Services/WorkspaceUserAuthTokenService";

import WorkspaceSetting from "Common/Models/DatabaseModels/WorkspaceSetting";
import WorkspaceSettingService, {
  Service as WorkspaceSettingServiceType,
} from "Common/Server/Services/WorkspaceSettingService";

import MonitorFeed from "Common/Models/DatabaseModels/MonitorFeed";
import MonitorFeedService, {
  Service as MonitorFeedServiceType,
} from "Common/Server/Services/MonitorFeedService";

// MetricType.
import MetricTypeService, {
  Service as MetricTypeServiceType,
} from "Common/Server/Services/MetricTypeService";
import MetricType from "Common/Models/DatabaseModels/MetricType";

import OnCallDutyPolicyAPI from "Common/Server/API/OnCallDutyPolicyAPI";
import TeamComplianceAPI from "Common/Server/API/TeamComplianceAPI";

import OnCallDutyPolicyFeed from "Common/Models/DatabaseModels/OnCallDutyPolicyFeed";
import OnCallDutyPolicyFeedService, {
  Service as OnCallDutyPolicyFeedServiceType,
} from "Common/Server/Services/OnCallDutyPolicyFeedService";

import OnCallDutyPolicyOwnerTeam from "Common/Models/DatabaseModels/OnCallDutyPolicyOwnerTeam";
import OnCallDutyPolicyOwnerTeamService, {
  Service as OnCallDutyPolicyOwnerTeamServiceType,
} from "Common/Server/Services/OnCallDutyPolicyOwnerTeamService";

import OnCallDutyPolicyOwnerUser from "Common/Models/DatabaseModels/OnCallDutyPolicyOwnerUser";
import OnCallDutyPolicyOwnerUserService, {
  Service as OnCallDutyPolicyOwnerUserServiceType,
} from "Common/Server/Services/OnCallDutyPolicyOwnerUserService";
import MonitorLog from "Common/Models/AnalyticsModels/MonitorLog";
import MonitorLogService, {
  Service as MonitorLogServiceType,
} from "Common/Server/Services/MonitorLogService";

//OnCallDutyPolicyTimeLog
import OnCallDutyPolicyTimeLog from "Common/Models/DatabaseModels/OnCallDutyPolicyTimeLog";
import OnCallDutyPolicyTimeLogService, {
  Service as OnCallDutyPolicyTimeLogServiceType,
} from "Common/Server/Services/OnCallDutyPolicyTimeLogService";

// statu spage announcement templates
import StatusPageAnnouncementTemplate from "Common/Models/DatabaseModels/StatusPageAnnouncementTemplate";
import StatusPageAnnouncementTemplateService, {
  Service as StatusPageAnnouncementTemplateServiceType,
} from "Common/Server/Services/StatusPageAnnouncementTemplateService";

// status page subscriber notification templates
import StatusPageSubscriberNotificationTemplate from "Common/Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import StatusPageSubscriberNotificationTemplateService, {
  Service as StatusPageSubscriberNotificationTemplateServiceType,
} from "Common/Server/Services/StatusPageSubscriberNotificationTemplateService";

// status page subscriber notification template status page (linking table)
import StatusPageSubscriberNotificationTemplateStatusPage from "Common/Models/DatabaseModels/StatusPageSubscriberNotificationTemplateStatusPage";
import StatusPageSubscriberNotificationTemplateStatusPageService, {
  Service as StatusPageSubscriberNotificationTemplateStatusPageServiceType,
} from "Common/Server/Services/StatusPageSubscriberNotificationTemplateStatusPageService";

// ProjectSCIM
import ProjectSCIM from "Common/Models/DatabaseModels/ProjectSCIM";
import ProjectSCIMService, {
  Service as ProjectSCIMServiceType,
} from "Common/Server/Services/ProjectSCIMService";

// StatusPageSCIM
import StatusPageSCIM from "Common/Models/DatabaseModels/StatusPageSCIM";
import StatusPageSCIMService, {
  Service as StatusPageSCIMServiceType,
} from "Common/Server/Services/StatusPageSCIMService";

// Open API Spec
import OpenAPI from "Common/Server/API/OpenAPI";

const BaseAPIFeatureSet: FeatureSet = {
  init: async (): Promise<void> => {
    const app: ExpressApplication = Express.getExpressApp();

    const APP_NAME: string = "api";

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new AcmeChallengeAPI().getRouter(),
    );

    app.use(`/${APP_NAME.toLocaleLowerCase()}`, OpenAPI.getRouter());

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAnalyticsAPI<MonitorLog, MonitorLogServiceType>(
        MonitorLog,
        MonitorLogService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<AlertState, AlertStateServiceType>(
        AlertState,
        AlertStateService,
      ).getRouter(),
    );

    // Project SCIM
    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<ProjectSCIM, ProjectSCIMServiceType>(
        ProjectSCIM,
        ProjectSCIMService,
      ).getRouter(),
    );

    // Status Page SCIM
    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<StatusPageSCIM, StatusPageSCIMServiceType>(
        StatusPageSCIM,
        StatusPageSCIMService,
      ).getRouter(),
    );

    // status page announcement templates
    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<
        StatusPageAnnouncementTemplate,
        StatusPageAnnouncementTemplateServiceType
      >(
        StatusPageAnnouncementTemplate,
        StatusPageAnnouncementTemplateService,
      ).getRouter(),
    );

    // status page subscriber notification templates
    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<
        StatusPageSubscriberNotificationTemplate,
        StatusPageSubscriberNotificationTemplateServiceType
      >(
        StatusPageSubscriberNotificationTemplate,
        StatusPageSubscriberNotificationTemplateService,
      ).getRouter(),
    );

    // status page subscriber notification template status page (linking table)
    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<
        StatusPageSubscriberNotificationTemplateStatusPage,
        StatusPageSubscriberNotificationTemplateStatusPageServiceType
      >(
        StatusPageSubscriberNotificationTemplateStatusPage,
        StatusPageSubscriberNotificationTemplateStatusPageService,
      ).getRouter(),
    );

    // OnCallDutyPolicyTimeLogService
    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<OnCallDutyPolicyTimeLog, OnCallDutyPolicyTimeLogServiceType>(
        OnCallDutyPolicyTimeLog,
        OnCallDutyPolicyTimeLogService,
      ).getRouter(),
    );

    // on-call policy owner user.
    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<
        OnCallDutyPolicyOwnerUser,
        OnCallDutyPolicyOwnerUserServiceType
      >(
        OnCallDutyPolicyOwnerUser,
        OnCallDutyPolicyOwnerUserService,
      ).getRouter(),
    );

    // on-call policy owner team.
    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<
        OnCallDutyPolicyOwnerTeam,
        OnCallDutyPolicyOwnerTeamServiceType
      >(
        OnCallDutyPolicyOwnerTeam,
        OnCallDutyPolicyOwnerTeamService,
      ).getRouter(),
    );

    // on-call policy feed.
    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<OnCallDutyPolicyFeed, OnCallDutyPolicyFeedServiceType>(
        OnCallDutyPolicyFeed,
        OnCallDutyPolicyFeedService,
      ).getRouter(),
    );

    // monitor feed
    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<MonitorFeed, MonitorFeedServiceType>(
        MonitorFeed,
        MonitorFeedService,
      ).getRouter(),
    );

    // MetricType
    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<MetricType, MetricTypeServiceType>(
        MetricType,
        MetricTypeService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<MonitorTest, MonitorTestServiceType>(
        MonitorTest,
        MonitorTestService,
      ).getRouter(),
    );

    //service provider setting
    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<WorkspaceSetting, WorkspaceSettingServiceType>(
        WorkspaceSetting,
        WorkspaceSettingService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<IncidentFeed, IncidentFeedServiceType>(
        IncidentFeed,
        IncidentFeedService,
      ).getRouter(),
    );

    // user override
    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<
        OnCallDutyPolicyUserOverride,
        OnCallDutyPolicyUserOverrideServiceType
      >(
        OnCallDutyPolicyUserOverride,
        OnCallDutyPolicyUserOverrideService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<AlertFeed, AlertFeedServiceType>(
        AlertFeed,
        AlertFeedService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<
        ScheduledMaintenanceFeed,
        ScheduledMaintenanceFeedServiceType
      >(ScheduledMaintenanceFeed, ScheduledMaintenanceFeedService).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<AlertNoteTemplate, AlertNoteTemplateServiceType>(
        AlertNoteTemplate,
        AlertNoteTemplateService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<
        WorkspaceProjectAuthToken,
        WorkspaceProjectAuthTokenServiceType
      >(
        WorkspaceProjectAuthToken,
        WorkspaceProjectAuthTokenService,
      ).getRouter(),
    );

    // user auth token
    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<WorkspaceUserAuthToken, WorkspaceUserAuthTokenServiceType>(
        WorkspaceUserAuthToken,
        WorkspaceUserAuthTokenService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new AlertAPI().getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<AlertSeverity, AlertSeverityServiceType>(
        AlertSeverity,
        AlertSeverityService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<AlertOwnerTeam, AlertOwnerTeamServiceType>(
        AlertOwnerTeam,
        AlertOwnerTeamService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<AlertOwnerUser, AlertOwnerUserServiceType>(
        AlertOwnerUser,
        AlertOwnerUserService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<AlertCustomField, AlertCustomFieldServiceType>(
        AlertCustomField,
        AlertCustomFieldService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new AlertInternalNoteAPI().getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<AlertStateTimeline, AlertStateTimelineServiceType>(
        AlertStateTimeline,
        AlertStateTimelineService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAnalyticsAPI<ExceptionInstance, ExceptionInstanceServiceType>(
        ExceptionInstance,
        ExceptionInstanceService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<TelemetyException, TelemetryExceptionServiceType>(
        TelemetyException,
        TelemetryExceptionService,
      ).getRouter(),
    );

    // scheduled maintenance template
    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<
        ScheduledMaintenanceTemplate,
        ScheduledMaintenanceTemplateServiceType
      >(
        ScheduledMaintenanceTemplate,
        ScheduledMaintenanceTemplateService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<
        ScheduledMaintenanceTemplateOwnerTeam,
        ScheduledMaintenanceTemplateOwnerTeamServiceType
      >(
        ScheduledMaintenanceTemplateOwnerTeam,
        ScheduledMaintenanceTemplateOwnerTeamService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<
        ScheduledMaintenanceTemplateOwnerUser,
        ScheduledMaintenanceTemplateOwnerUserServiceType
      >(
        ScheduledMaintenanceTemplateOwnerUser,
        ScheduledMaintenanceTemplateOwnerUserService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAnalyticsAPI<Log, LogServiceType>(Log, LogService).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<Dashboard, DashboardServiceType>(
        Dashboard,
        DashboardService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAnalyticsAPI<Metric, MetricServiceType>(
        Metric,
        MetricService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<TelemetryIngestionKey, TelemetryIngestionKeyServiceType>(
        TelemetryIngestionKey,
        TelemetryIngestionKeyService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAnalyticsAPI<Span, SpanServiceType>(
        Span,
        SpanService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<TelemetryUsageBilling, TelemetryUsageBillingServiceType>(
        TelemetryUsageBilling,
        TelemetryUsageBillingService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<ShortLink, ShortLinkServiceType>(
        ShortLink,
        ShortLinkService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<
        ServiceCatalogDependency,
        ServiceCatalogDependencyServiceType
      >(ServiceCatalogDependency, ServiceCatalogDependencyService).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<
        StatusPageHistoryChartBarColorRule,
        StatusPageHistoryChartBarColorRuleServiceType
      >(
        StatusPageHistoryChartBarColorRule,
        StatusPageHistoryChartBarColorRuleService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<ServiceCatalogMonitor, ServiceCatalogMonitorServiceType>(
        ServiceCatalogMonitor,
        ServiceCatalogMonitorService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<
        ServiceCatalogTelemetryService,
        ServiceCatalogTelemetryServiceServiceType
      >(
        ServiceCatalogTelemetryService,
        ServiceCatalogTelemetryServiceService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<
        ServiceCatalogCodeRepository,
        ServiceCatalogCodeRepositoryServiceType
      >(
        ServiceCatalogCodeRepository,
        ServiceCatalogCodeRepositoryService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<MonitorProbe, MonitorProbeServiceType>(
        MonitorProbe,
        MonitorProbeService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<ProbeOwnerUser, ProbeOwnerUserServiceType>(
        ProbeOwnerUser,
        ProbeOwnerUserService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<ProbeOwnerTeam, ProbeOwnerTeamServiceType>(
        ProbeOwnerTeam,
        ProbeOwnerTeamService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<MonitorSecret, MonitorSecretServiceType>(
        MonitorSecret,
        MonitorSecretService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new StatusPageAnnouncementAPI().getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<Team, TeamServiceType>(Team, TeamService).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<MonitorGroupOwnerUser, MonitorGroupOwnerUserServiceType>(
        MonitorGroupOwnerUser,
        MonitorGroupOwnerUserService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<ServiceCatalog, ServiceCatalogServiceType>(
        ServiceCatalog,
        ServiceCatalogService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<ServiceCatalogOwnerTeam, ServiceCatalogOwnerTeamServiceType>(
        ServiceCatalogOwnerTeam,
        ServiceCatalogOwnerTeamService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<ServiceCatalogOwnerUser, ServiceCatalogOwnerUserServiceType>(
        ServiceCatalogOwnerUser,
        ServiceCatalogOwnerUserService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<
        OnCallDutyPolicySchedule,
        OnCallDutyPolicyScheduleServiceType
      >(OnCallDutyPolicySchedule, OnCallDutyPolicyScheduleService).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<
        OnCallDutyPolicyScheduleLayer,
        OnCallDutyPolicyScheduleLayerServiceType
      >(
        OnCallDutyPolicyScheduleLayer,
        OnCallDutyPolicyScheduleLayerService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<
        OnCallDutyPolicyScheduleLayerUser,
        OnCallDutyPolicyScheduleLayerUserServiceType
      >(
        OnCallDutyPolicyScheduleLayerUser,
        OnCallDutyPolicyScheduleLayerUserService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<MonitorGroupOwnerTeam, MonitorGroupOwnerTeamServiceType>(
        MonitorGroupOwnerTeam,
        MonitorGroupOwnerTeamService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<ProjectCallSMSConfig, ProjectCallSMSConfigServiceType>(
        ProjectCallSMSConfig,
        ProjectCallSMSConfigService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<MonitorGroupResource, MonitorGroupResourceServiceType>(
        MonitorGroupResource,
        MonitorGroupResourceService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<TeamMember, TeamMemberServiceType>(
        TeamMember,
        TeamMemberService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<TeamPermission, TeamPermissionServiceType>(
        TeamPermission,
        TeamPermissionService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<TeamComplianceSetting, TeamComplianceSettingServiceType>(
        TeamComplianceSetting,
        TeamComplianceSettingService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<MonitorStatus, MonitorStatusServiceType>(
        MonitorStatus,
        MonitorStatusService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<TableView, TableViewServiceType>(
        TableView,
        TableViewService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<IncidentState, IncidentStateServiceType>(
        IncidentState,
        IncidentStateService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<
        ScheduledMaintenanceState,
        ScheduledMaintenanceStateServiceType
      >(
        ScheduledMaintenanceState,
        ScheduledMaintenanceStateService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<StatusPageResource, StatusPageResourceServiceType>(
        StatusPageResource,
        StatusPageResourceService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<Workflow, WorkflowServiceType>(
        Workflow,
        WorkflowService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<TelemetryService, TelemetryServiceServiceType>(
        TelemetryService,
        TelemetryServiceService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<WorkflowVariable, WorkflowVariableServiceType>(
        WorkflowVariable,
        WorkflowVariableService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<WorkflowLog, WorkflowLogServiceType>(
        WorkflowLog,
        WorkflowLogService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<Domain, DomainServiceType>(Domain, DomainService).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<StatusPageGroup, StatusPageGroupServiceType>(
        StatusPageGroup,
        StatusPageGroupService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<IncidentStateTimeline, IncidentStateTimelineServiceType>(
        IncidentStateTimeline,
        IncidentStateTimelineService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<
        ScheduledMaintenanceStateTimeline,
        ScheduledMaintenanceStateTimelineServiceType
      >(
        ScheduledMaintenanceStateTimeline,
        ScheduledMaintenanceStateTimelineService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<StatusPagePrivateUser, StatusPagePrivateUserServiceType>(
        StatusPagePrivateUser,
        StatusPagePrivateUserService,
      ).getRouter(),
    );

    app.use(`/${APP_NAME.toLocaleLowerCase()}`, new IncidentAPI().getRouter());

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new ScheduledMaintenanceAPI().getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<ApiKey, ApiKeyServiceType>(ApiKey, ApiKeyService).getRouter(),
    );
    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<ApiKeyPermission, ApiKeyPermissionServiceType>(
        ApiKeyPermission,
        ApiKeyPermissionService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<StatusPageHeaderLink, StatusPageHeaderLinkServiceType>(
        StatusPageHeaderLink,
        StatusPageHeaderLinkService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<UserNotificationRule, UserNotificationRuleServiceType>(
        UserNotificationRule,
        UserNotificationRuleService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<StatusPageFooterLink, StatusPageFooterLinkServiceType>(
        StatusPageFooterLink,
        StatusPageFooterLinkService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<ApiKey, ApiKeyServiceType>(ApiKey, ApiKeyService).getRouter(),
    );
    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<ApiKeyPermission, ApiKeyPermissionServiceType>(
        ApiKeyPermission,
        ApiKeyPermissionService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<IncidentSeverity, IncidentSeverityServiceType>(
        IncidentSeverity,
        IncidentSeverityService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<IncidentOwnerUser, IncidentOwnerUserServiceType>(
        IncidentOwnerUser,
        IncidentOwnerUserService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<IncidentOwnerTeam, IncidentOwnerTeamServiceType>(
        IncidentOwnerTeam,
        IncidentOwnerTeamService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<IncidentTemplate, IncidentTemplateServiceType>(
        IncidentTemplate,
        IncidentTemplateService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<IncidentNoteTemplate, IncidentNoteTemplateServiceType>(
        IncidentNoteTemplate,
        IncidentNoteTemplateService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<
        IncidentPostmortemTemplate,
        IncidentPostmortemTemplateServiceType
      >(
        IncidentPostmortemTemplate,
        IncidentPostmortemTemplateService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<
        ScheduledMaintenanceNoteTemplate,
        ScheduledMaintenanceNoteTemplateServiceType
      >(
        ScheduledMaintenanceNoteTemplate,
        ScheduledMaintenanceNoteTemplateService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<
        IncidentTemplateOwnerTeam,
        IncidentTemplateOwnerTeamServiceType
      >(
        IncidentTemplateOwnerTeam,
        IncidentTemplateOwnerTeamService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<
        IncidentTemplateOwnerUser,
        IncidentTemplateOwnerUserServiceType
      >(
        IncidentTemplateOwnerUser,
        IncidentTemplateOwnerUserService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<MonitorOwnerUser, MonitorOwnerUserServiceType>(
        MonitorOwnerUser,
        MonitorOwnerUserService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<MonitorOwnerTeam, MonitorOwnerTeamServiceType>(
        MonitorOwnerTeam,
        MonitorOwnerTeamService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<
        ScheduledMaintenanceOwnerUser,
        ScheduledMaintenanceOwnerUserServiceType
      >(
        ScheduledMaintenanceOwnerUser,
        ScheduledMaintenanceOwnerUserService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<
        ScheduledMaintenanceOwnerTeam,
        ScheduledMaintenanceOwnerTeamServiceType
      >(
        ScheduledMaintenanceOwnerTeam,
        ScheduledMaintenanceOwnerTeamService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<StatusPageOwnerUser, StatusPageOwnerUserServiceType>(
        StatusPageOwnerUser,
        StatusPageOwnerUserService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<StatusPageOwnerTeam, StatusPageOwnerTeamServiceType>(
        StatusPageOwnerTeam,
        StatusPageOwnerTeamService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<Label, LabelServiceType>(Label, LabelService).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<EmailVerificationToken, EmailVerificationTokenServiceType>(
        EmailVerificationToken,
        EmailVerificationTokenService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<UserOnCallLog, UserNotificationLogServiceType>(
        UserOnCallLog,
        UserOnCallLogService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<UserNotificationSetting, UserNotificationSettingServiceType>(
        UserNotificationSetting,
        UserNotificationSettingService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<
        OnCallDutyPolicyCustomField,
        OnCallDutyPolicyCustomFieldServiceType
      >(
        OnCallDutyPolicyCustomField,
        OnCallDutyPolicyCustomFieldService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<ProjectSmtpConfig, ProjectSMTPConfigServiceType>(
        ProjectSmtpConfig,
        ProjectSmtpConfigService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<SmsLog, SmsLogServiceType>(SmsLog, SmsLogService).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new WhatsAppLogAPI().getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<PushNotificationLog, PushNotificationLogServiceType>(
        PushNotificationLog,
        PushNotificationLogService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<
        WorkspaceNotificationLog,
        WorkspaceNotificationLogServiceType
      >(WorkspaceNotificationLog, WorkspaceNotificationLogService).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<EmailLog, EmailLogServiceType>(
        EmailLog,
        EmailLogService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<Reseller, ResellerServiceType>(
        Reseller,
        ResellerService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<CallLog, CallLogServiceType>(
        CallLog,
        CallLogService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<StatusPageSSO, StatusPageSSOServiceType>(
        StatusPageSSO,
        StatusPageSSOService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<MonitorTimelineStatus, MonitorTimelineStatusServiceType>(
        MonitorTimelineStatus,
        MonitorTimelineStatusService,
      ).getRouter(),
    );
    app.use(`/${APP_NAME.toLocaleLowerCase()}`, new ShortLinkAPI().getRouter());
    app.use(`/${APP_NAME.toLocaleLowerCase()}`, new MonitorAPI().getRouter());
    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new StatusPageAPI().getRouter(),
    );

    // OnCallDutyPolicyAPI
    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new OnCallDutyPolicyAPI().getRouter(),
    );

    // TeamComplianceAPI
    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new TeamComplianceAPI().getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new WorkspaceNotificationRuleAPI().getRouter(),
    );
    app.use(`/${APP_NAME.toLocaleLowerCase()}`, new FileAPI().getRouter());
    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new MonitorGroupAPI().getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new StatusPageDomainAPI().getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new ProjectSsoAPI().getRouter(),
    );
    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new ResellerPlanAPI().getRouter(),
    );
    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new EnterpriseLicenseAPI().getRouter(),
    );
    app.use(`/${APP_NAME.toLocaleLowerCase()}`, new SlackAPI().getRouter());
    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new MicrosoftTeamsAPI().getRouter(),
    );
    app.use(`/${APP_NAME.toLocaleLowerCase()}`, new GitHubAPI().getRouter());
    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new GlobalConfigAPI().getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new UserNotificationLogTimelineAPI().getRouter(),
    );
    app.use(`/${APP_NAME.toLocaleLowerCase()}`, new UserCallAPI().getRouter());
    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new UserTotpAuthAPI().getRouter(),
    );
    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new UserWebAuthnAPI().getRouter(),
    );
    app.use(`/${APP_NAME.toLocaleLowerCase()}`, new UserEmailAPI().getRouter());
    app.use(`/${APP_NAME.toLocaleLowerCase()}`, new UserSMSAPI().getRouter());
    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new UserWhatsAppAPI().getRouter(),
    );
    app.use(`/${APP_NAME.toLocaleLowerCase()}`, new UserPushAPI().getRouter());
    app.use(`/${APP_NAME.toLocaleLowerCase()}`, new ProbeAPI().getRouter());
    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new LlmProviderAPI().getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<LlmLog, LlmLogServiceType>(LlmLog, LlmLogService).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new StatusPageSubscriberAPI().getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BillingPaymentMethodAPI().getRouter(),
    );

    app.use(`/${APP_NAME.toLocaleLowerCase()}`, new ProjectAPI().getRouter());

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BillingInvoiceAPI().getRouter(),
    );

    app.use(`/${APP_NAME.toLocaleLowerCase()}`, new BillingAPI().getRouter());

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new ScheduledMaintenancePublicNoteAPI().getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new ScheduledMaintenanceInternalNoteAPI().getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new IncidentPublicNoteAPI().getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new IncidentInternalNoteAPI().getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<
        ScheduledMaintenanceCustomField,
        ScheduledMaintenanceCustomFieldServiceType
      >(
        ScheduledMaintenanceCustomField,
        ScheduledMaintenanceCustomFieldService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<
        OnCallDutyPolicyEscalationRuleUser,
        OnCallDutyPolicyEscalationRuleUserServiceType
      >(
        OnCallDutyPolicyEscalationRuleUser,
        OnCallDutyPolicyEscalationRuleUserService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<
        OnCallDutyPolicyEscalationRuleTeam,
        OnCallDutyPolicyEscalationRuleTeamServiceType
      >(
        OnCallDutyPolicyEscalationRuleTeam,
        OnCallDutyPolicyEscalationRuleTeamService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<
        OnCallDutyPolicyEscalationRuleSchedule,
        OnCallDutyPolicyEscalationRuleScheduleServiceType
      >(
        OnCallDutyPolicyEscalationRuleSchedule,
        OnCallDutyPolicyEscalationRuleScheduleService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<
        OnCallDutyPolicyExecutionLog,
        OnCallDutyPolicyExecutionLogServiceType
      >(
        OnCallDutyPolicyExecutionLog,
        OnCallDutyPolicyExecutionLogService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<PromoCode, PromoCodeServiceType>(
        PromoCode,
        PromoCodeService,
      ).getRouter(),
    );

    // Code Repository
    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<CodeRepository, CodeRepositoryServiceType>(
        CodeRepository,
        CodeRepositoryService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<
        OnCallDutyPolicyExecutionLogTimeline,
        OnCallDutyPolicyExecutionLogTimelineServiceType
      >(
        OnCallDutyPolicyExecutionLogTimeline,
        OnCallDutyPolicyExecutionLogTimelineService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<IncidentCustomField, IncidentCustomFieldServiceType>(
        IncidentCustomField,
        IncidentCustomFieldService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<
        OnCallDutyPolicyEscalationRule,
        OnCallDutyPolicyEscalationRuleServiceType
      >(
        OnCallDutyPolicyEscalationRule,
        OnCallDutyPolicyEscalationRuleService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<MonitorCustomField, MonitorCustomFieldServiceType>(
        MonitorCustomField,
        MonitorCustomFieldService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<StatusPageCustomField, StatusPageCustomFieldServiceType>(
        StatusPageCustomField,
        StatusPageCustomFieldService,
      ).getRouter(),
    );

    app.use(`/${APP_NAME.toLocaleLowerCase()}`, NotificationAPI);

    app.use(`/${APP_NAME.toLocaleLowerCase()}`, AIBillingAPI);

    app.use(`/${APP_NAME.toLocaleLowerCase()}`, TelemetryAPI);

    //attach api's
    app.use(`/${APP_NAME.toLocaleLowerCase()}`, new UserAPI().getRouter());
  },
};

export default BaseAPIFeatureSet;
