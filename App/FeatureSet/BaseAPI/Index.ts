import BaseAPI from "Common/Server/API/BaseAPI";
import BaseAnalyticsAPI from "Common/Server/API/BaseAnalyticsAPI";
import BillingInvoiceAPI from "Common/Server/API/BillingInvoiceAPI";
import BillingPaymentMethodAPI from "Common/Server/API/BillingPaymentMethodAPI";
import CopilotCodeRepositoryAPI from "Common/Server/API/CopilotCodeRepositoryAPI";
import CopilotActionAPI from "Common/Server/API/CopilotActionAPI";
import CopilotPullRequestAPI from "Common/Server/API/CopilotPullRequestAPI";
import FileAPI from "Common/Server/API/FileAPI";
import GlobalConfigAPI from "Common/Server/API/GlobalConfigAPI";
import MonitorGroupAPI from "Common/Server/API/MonitorGroupAPI";
import NotificationAPI from "Common/Server/API/NotificationAPI";
import TelemetryAPI from "Common/Server/API/TelemetryAPI";
import Ingestor from "Common/Server/API/ProbeAPI";
import ProjectAPI from "Common/Server/API/ProjectAPI";
import ProjectSsoAPI from "Common/Server/API/ProjectSSO";
// Import API
import ResellerPlanAPI from "Common/Server/API/ResellerPlanAPI";
import ShortLinkAPI from "Common/Server/API/ShortLinkAPI";
import StatusPageAPI from "Common/Server/API/StatusPageAPI";
import StatusPageDomainAPI from "Common/Server/API/StatusPageDomainAPI";
import StatusPageSubscriberAPI from "Common/Server/API/StatusPageSubscriberAPI";
import UserCallAPI from "Common/Server/API/UserCallAPI";
import UserTwoFactorAuthAPI from "Common/Server/API/UserTwoFactorAuthAPI";
// User Notification methods.
import UserEmailAPI from "Common/Server/API/UserEmailAPI";
import UserNotificationLogTimelineAPI from "Common/Server/API/UserOnCallLogTimelineAPI";
import UserSMSAPI from "Common/Server/API/UserSmsAPI";
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
import IncidentCustomFieldService, {
  Service as IncidentCustomFieldServiceType,
} from "Common/Server/Services/IncidentCustomFieldService";
import IncidentInternalNoteService, {
  Service as IncidentInternalNoteServiceType,
} from "Common/Server/Services/IncidentInternalNoteService";
import IncidentNoteTemplateService, {
  Service as IncidentNoteTemplateServiceType,
} from "Common/Server/Services/IncidentNoteTemplateService";
import IncidentOwnerTeamService, {
  Service as IncidentOwnerTeamServiceType,
} from "Common/Server/Services/IncidentOwnerTeamService";
import IncidentOwnerUserService, {
  Service as IncidentOwnerUserServiceType,
} from "Common/Server/Services/IncidentOwnerUserService";
import IncidentPublicNoteService, {
  Service as IncidentPublicNoteServiceType,
} from "Common/Server/Services/IncidentPublicNoteService";
import IncidentService, {
  Service as IncidentServiceType,
} from "Common/Server/Services/IncidentService";
import IncidentSeverityService, {
  Service as IncidentSeverityServiceType,
} from "Common/Server/Services/IncidentSeverityService";
import IncidentStateService, {
  Service as IncidentStateServiceType,
} from "Common/Server/Services/IncidentStateService";
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

import TelemetryAttributeService, {
  TelemetryAttributeService as TelemetryAttributeServiceType,
} from "Common/Server/Services/TelemetryAttributeService";

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
import MonitorMetricsByMinuteService, {
  MonitorMetricsByMinuteService as MonitorMetricsByMinuteServiceType,
} from "Common/Server/Services/MonitorMetricsByMinuteService";
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
import MonitorService, {
  Service as MonitorServiceType,
} from "Common/Server/Services/MonitorService";
import MonitorStatusService, {
  Service as MonitorStatusServiceType,
} from "Common/Server/Services/MonitorStatusService";
import MonitorTimelineStatusService, {
  Service as MonitorTimelineStatusServiceType,
} from "Common/Server/Services/MonitorStatusTimelineService";
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
import OnCallDutyPolicyService, {
  Service as OnCallDutyPolicyServiceType,
} from "Common/Server/Services/OnCallDutyPolicyService";
import ProjectCallSMSConfigService, {
  Service as ProjectCallSMSConfigServiceType,
} from "Common/Server/Services/ProjectCallSMSConfigService";
import ProjectSmtpConfigService, {
  Service as ProjectSMTPConfigServiceType,
} from "Common/Server/Services/ProjectSmtpConfigService";
import PromoCodeService, {
  Service as PromoCodeServiceType,
} from "Common/Server/Services/PromoCodeService";
import ResellerService, {
  Service as ResellerServiceType,
} from "Common/Server/Services/ResellerService";
import ScheduledMaintenanceCustomFieldService, {
  Service as ScheduledMaintenanceCustomFieldServiceType,
} from "Common/Server/Services/ScheduledMaintenanceCustomFieldService";
import ScheduledMaintenanceInternalNoteService, {
  Service as ScheduledMaintenanceInternalNoteServiceType,
} from "Common/Server/Services/ScheduledMaintenanceInternalNoteService";
import ScheduledMaintenanceNoteTemplateService, {
  Service as ScheduledMaintenanceNoteTemplateServiceType,
} from "Common/Server/Services/ScheduledMaintenanceNoteTemplateService";
import ScheduledMaintenanceOwnerTeamService, {
  Service as ScheduledMaintenanceOwnerTeamServiceType,
} from "Common/Server/Services/ScheduledMaintenanceOwnerTeamService";
import ScheduledMaintenanceOwnerUserService, {
  Service as ScheduledMaintenanceOwnerUserServiceType,
} from "Common/Server/Services/ScheduledMaintenanceOwnerUserService";
import ScheduledMaintenancePublicNoteService, {
  Service as ScheduledMaintenancePublicNoteServiceType,
} from "Common/Server/Services/ScheduledMaintenancePublicNoteService";
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
import ServiceCopilotCodeRepositoryService, {
  Service as ServiceCopilotCodeRepositoryType,
} from "Common/Server/Services/ServiceCopilotCodeRepositoryService";
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

import ShortLinkService, {
  Service as ShortLinkServiceType,
} from "Common/Server/Services/ShortLinkService";
import SmsLogService, {
  Service as SmsLogServiceType,
} from "Common/Server/Services/SmsLogService";
import SpanService, {
  SpanService as SpanServiceType,
} from "Common/Server/Services/SpanService";
import StatusPageAnnouncementService, {
  Service as StatusPageAnnouncementServiceType,
} from "Common/Server/Services/StatusPageAnnouncementService";
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
import UserService, {
  Service as UserServiceType,
} from "Common/Server/Services/UserService";
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

import FeatureSet from "Common/Server/Types/FeatureSet";
import Express, { ExpressApplication } from "Common/Server/Utils/Express";
import Log from "Common/Models/AnalyticsModels/Log";
import Metric from "Common/Models/AnalyticsModels/Metric";
import MonitorMetricsByMinute from "Common/Models/AnalyticsModels/MonitorMetricsByMinute";
import Span from "Common/Models/AnalyticsModels/Span";
import ApiKey from "Common/Models/DatabaseModels/ApiKey";
import ApiKeyPermission from "Common/Models/DatabaseModels/ApiKeyPermission";
import CallLog from "Common/Models/DatabaseModels/CallLog";
import Domain from "Common/Models/DatabaseModels/Domain";
import EmailLog from "Common/Models/DatabaseModels/EmailLog";
import EmailVerificationToken from "Common/Models/DatabaseModels/EmailVerificationToken";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentCustomField from "Common/Models/DatabaseModels/IncidentCustomField";
import IncidentInternalNote from "Common/Models/DatabaseModels/IncidentInternalNote";
import IncidentNoteTemplate from "Common/Models/DatabaseModels/IncidentNoteTemplate";
import IncidentOwnerTeam from "Common/Models/DatabaseModels/IncidentOwnerTeam";
import IncidentOwnerUser from "Common/Models/DatabaseModels/IncidentOwnerUser";
import IncidentPublicNote from "Common/Models/DatabaseModels/IncidentPublicNote";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "Common/Models/DatabaseModels/IncidentStateTimeline";
import IncidentTemplate from "Common/Models/DatabaseModels/IncidentTemplate";
import IncidentTemplateOwnerTeam from "Common/Models/DatabaseModels/IncidentTemplateOwnerTeam";
import IncidentTemplateOwnerUser from "Common/Models/DatabaseModels/IncidentTemplateOwnerUser";
import Label from "Common/Models/DatabaseModels/Label";
import Monitor from "Common/Models/DatabaseModels/Monitor";
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
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
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
import Reseller from "Common/Models/DatabaseModels/Reseller";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceCustomField from "Common/Models/DatabaseModels/ScheduledMaintenanceCustomField";
import ScheduledMaintenanceInternalNote from "Common/Models/DatabaseModels/ScheduledMaintenanceInternalNote";
import ScheduledMaintenanceNoteTemplate from "Common/Models/DatabaseModels/ScheduledMaintenanceNoteTemplate";
import ScheduledMaintenanceOwnerTeam from "Common/Models/DatabaseModels/ScheduledMaintenanceOwnerTeam";
import ScheduledMaintenanceOwnerUser from "Common/Models/DatabaseModels/ScheduledMaintenanceOwnerUser";
import ScheduledMaintenancePublicNote from "Common/Models/DatabaseModels/ScheduledMaintenancePublicNote";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "Common/Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import ServiceCatalog from "Common/Models/DatabaseModels/ServiceCatalog";
import ServiceCatalogOwnerTeam from "Common/Models/DatabaseModels/ServiceCatalogOwnerTeam";
import ServiceCatalogOwnerUser from "Common/Models/DatabaseModels/ServiceCatalogOwnerUser";
import ServiceCopilotCodeRepository from "Common/Models/DatabaseModels/ServiceCopilotCodeRepository";
import ShortLink from "Common/Models/DatabaseModels/ShortLink";
import SmsLog from "Common/Models/DatabaseModels/SmsLog";
import StatusPageAnnouncement from "Common/Models/DatabaseModels/StatusPageAnnouncement";
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
import TelemetryService from "Common/Models/DatabaseModels/TelemetryService";
import TelemetryUsageBilling from "Common/Models/DatabaseModels/TelemetryUsageBilling";
import User from "Common/Models/DatabaseModels/User";
import UserNotificationRule from "Common/Models/DatabaseModels/UserNotificationRule";
import UserNotificationSetting from "Common/Models/DatabaseModels/UserNotificationSetting";
import UserOnCallLog from "Common/Models/DatabaseModels/UserOnCallLog";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import WorkflowLog from "Common/Models/DatabaseModels/WorkflowLog";
import WorkflowVariable from "Common/Models/DatabaseModels/WorkflowVariable";
import ProbeOwnerTeam from "Common/Models/DatabaseModels/ProbeOwnerTeam";
import ProbeOwnerUser from "Common/Models/DatabaseModels/ProbeOwnerUser";
import ServiceCatalogDependency from "Common/Models/DatabaseModels/ServiceCatalogDependency";
import TelemetryAttribute from "Common/Models/AnalyticsModels/TelemetryAttribute";

const BaseAPIFeatureSet: FeatureSet = {
  init: async (): Promise<void> => {
    const app: ExpressApplication = Express.getExpressApp();

    const APP_NAME: string = "api";

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAnalyticsAPI<TelemetryAttribute, TelemetryAttributeServiceType>(
        TelemetryAttribute,
        TelemetryAttributeService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAnalyticsAPI<Log, LogServiceType>(Log, LogService).getRouter(),
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
      new BaseAnalyticsAPI<
        MonitorMetricsByMinute,
        MonitorMetricsByMinuteServiceType
      >(MonitorMetricsByMinute, MonitorMetricsByMinuteService).getRouter(),
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
      new BaseAPI<StatusPageAnnouncement, StatusPageAnnouncementServiceType>(
        StatusPageAnnouncement,
        StatusPageAnnouncementService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<Team, TeamServiceType>(Team, TeamService).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<
        ServiceCopilotCodeRepository,
        ServiceCopilotCodeRepositoryType
      >(
        ServiceCopilotCodeRepository,
        ServiceCopilotCodeRepositoryService,
      ).getRouter(),
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
      new BaseAPI<MonitorStatus, MonitorStatusServiceType>(
        MonitorStatus,
        MonitorStatusService,
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

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<Incident, IncidentServiceType>(
        Incident,
        IncidentService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<ScheduledMaintenance, ScheduledMaintenanceServiceType>(
        ScheduledMaintenance,
        ScheduledMaintenanceService,
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
      new BaseAPI<Monitor, MonitorServiceType>(
        Monitor,
        MonitorService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<SmsLog, SmsLogServiceType>(SmsLog, SmsLogService).getRouter(),
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
    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new StatusPageAPI().getRouter(),
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
      new GlobalConfigAPI().getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new CopilotCodeRepositoryAPI().getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new CopilotActionAPI().getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new CopilotPullRequestAPI().getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new UserNotificationLogTimelineAPI().getRouter(),
    );
    app.use(`/${APP_NAME.toLocaleLowerCase()}`, new UserCallAPI().getRouter());
    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new UserTwoFactorAuthAPI().getRouter(),
    );
    app.use(`/${APP_NAME.toLocaleLowerCase()}`, new UserEmailAPI().getRouter());
    app.use(`/${APP_NAME.toLocaleLowerCase()}`, new UserSMSAPI().getRouter());
    app.use(`/${APP_NAME.toLocaleLowerCase()}`, new Ingestor().getRouter());

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

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<
        ScheduledMaintenancePublicNote,
        ScheduledMaintenancePublicNoteServiceType
      >(
        ScheduledMaintenancePublicNote,
        ScheduledMaintenancePublicNoteService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<
        ScheduledMaintenanceInternalNote,
        ScheduledMaintenanceInternalNoteServiceType
      >(
        ScheduledMaintenanceInternalNote,
        ScheduledMaintenanceInternalNoteService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<IncidentPublicNote, IncidentPublicNoteServiceType>(
        IncidentPublicNote,
        IncidentPublicNoteService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<IncidentInternalNote, IncidentInternalNoteServiceType>(
        IncidentInternalNote,
        IncidentInternalNoteService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<OnCallDutyPolicy, OnCallDutyPolicyServiceType>(
        OnCallDutyPolicy,
        OnCallDutyPolicyService,
      ).getRouter(),
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

    app.use(`/${APP_NAME.toLocaleLowerCase()}`, TelemetryAPI);

    //attach api's
    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<User, UserServiceType>(User, UserService).getRouter(),
    );
  },
};

export default BaseAPIFeatureSet;
