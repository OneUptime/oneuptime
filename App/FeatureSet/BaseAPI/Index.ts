import BaseAPI from "CommonServer/API/BaseAPI";
import BaseAnalyticsAPI from "CommonServer/API/BaseAnalyticsAPI";
import BillingInvoiceAPI from "CommonServer/API/BillingInvoiceAPI";
import BillingPaymentMethodAPI from "CommonServer/API/BillingPaymentMethodAPI";
import CopilotCodeRepositoryAPI from "CommonServer/API/CopilotCodeRepositoryAPI";
import CopilotActionAPI from "CommonServer/API/CopilotActionAPI";
import CopilotPullRequestAPI from "CommonServer/API/CopilotPullRequestAPI";
import FileAPI from "CommonServer/API/FileAPI";
import GlobalConfigAPI from "CommonServer/API/GlobalConfigAPI";
import MonitorGroupAPI from "CommonServer/API/MonitorGroupAPI";
import NotificationAPI from "CommonServer/API/NotificationAPI";
import TelemetryAPI from "CommonServer/API/TelemetryAPI";
import Ingestor from "CommonServer/API/ProbeAPI";
import ProjectAPI from "CommonServer/API/ProjectAPI";
import ProjectSsoAPI from "CommonServer/API/ProjectSSO";
// Import API
import ResellerPlanAPI from "CommonServer/API/ResellerPlanAPI";
import ShortLinkAPI from "CommonServer/API/ShortLinkAPI";
import StatusPageAPI from "CommonServer/API/StatusPageAPI";
import StatusPageDomainAPI from "CommonServer/API/StatusPageDomainAPI";
import StatusPageSubscriberAPI from "CommonServer/API/StatusPageSubscriberAPI";
import UserCallAPI from "CommonServer/API/UserCallAPI";
import UserTwoFactorAuthAPI from "CommonServer/API/UserTwoFactorAuthAPI";
// User Notification methods.
import UserEmailAPI from "CommonServer/API/UserEmailAPI";
import UserNotificationLogTimelineAPI from "CommonServer/API/UserOnCallLogTimelineAPI";
import UserSMSAPI from "CommonServer/API/UserSmsAPI";
import ApiKeyPermissionService, {
  Service as ApiKeyPermissionServiceType,
} from "CommonServer/Services/ApiKeyPermissionService";
import ApiKeyService, {
  Service as ApiKeyServiceType,
} from "CommonServer/Services/ApiKeyService";
import CallLogService, {
  Service as CallLogServiceType,
} from "CommonServer/Services/CallLogService";
import DomainService, {
  Service as DomainServiceType,
} from "CommonServer/Services/DomainService";
import EmailLogService, {
  Service as EmailLogServiceType,
} from "CommonServer/Services/EmailLogService";
import TelemetryIngestionKeyService, {
  Service as TelemetryIngestionKeyServiceType,
} from "CommonServer/Services/TelemetryIngestionKeyService";
import EmailVerificationTokenService, {
  Service as EmailVerificationTokenServiceType,
} from "CommonServer/Services/EmailVerificationTokenService";
import IncidentCustomFieldService, {
  Service as IncidentCustomFieldServiceType,
} from "CommonServer/Services/IncidentCustomFieldService";
import IncidentInternalNoteService, {
  Service as IncidentInternalNoteServiceType,
} from "CommonServer/Services/IncidentInternalNoteService";
import IncidentNoteTemplateService, {
  Service as IncidentNoteTemplateServiceType,
} from "CommonServer/Services/IncidentNoteTemplateService";
import IncidentOwnerTeamService, {
  Service as IncidentOwnerTeamServiceType,
} from "CommonServer/Services/IncidentOwnerTeamService";
import IncidentOwnerUserService, {
  Service as IncidentOwnerUserServiceType,
} from "CommonServer/Services/IncidentOwnerUserService";
import IncidentPublicNoteService, {
  Service as IncidentPublicNoteServiceType,
} from "CommonServer/Services/IncidentPublicNoteService";
import IncidentService, {
  Service as IncidentServiceType,
} from "CommonServer/Services/IncidentService";
import IncidentSeverityService, {
  Service as IncidentSeverityServiceType,
} from "CommonServer/Services/IncidentSeverityService";
import IncidentStateService, {
  Service as IncidentStateServiceType,
} from "CommonServer/Services/IncidentStateService";
import IncidentStateTimelineService, {
  Service as IncidentStateTimelineServiceType,
} from "CommonServer/Services/IncidentStateTimelineService";
import IncidentTemplateOwnerTeamService, {
  Service as IncidentTemplateOwnerTeamServiceType,
} from "CommonServer/Services/IncidentTemplateOwnerTeamService";
import IncidentTemplateOwnerUserService, {
  Service as IncidentTemplateOwnerUserServiceType,
} from "CommonServer/Services/IncidentTemplateOwnerUserService";
import IncidentTemplateService, {
  Service as IncidentTemplateServiceType,
} from "CommonServer/Services/IncidentTemplateService";
import LabelService, {
  Service as LabelServiceType,
} from "CommonServer/Services/LabelService";
import LogService, {
  LogService as LogServiceType,
} from "CommonServer/Services/LogService";

import TelemetryAttributeService, {
  TelemetryAttributeService as TelemetryAttributeServiceType,
} from "CommonServer/Services/TelemetryAttributeService";

import MetricService, {
  MetricService as MetricServiceType,
} from "CommonServer/Services/MetricService";
import MonitorCustomFieldService, {
  Service as MonitorCustomFieldServiceType,
} from "CommonServer/Services/MonitorCustomFieldService";
import MonitorGroupOwnerTeamService, {
  Service as MonitorGroupOwnerTeamServiceType,
} from "CommonServer/Services/MonitorGroupOwnerTeamService";
import MonitorGroupOwnerUserService, {
  Service as MonitorGroupOwnerUserServiceType,
} from "CommonServer/Services/MonitorGroupOwnerUserService";
import MonitorGroupResourceService, {
  Service as MonitorGroupResourceServiceType,
} from "CommonServer/Services/MonitorGroupResourceService";
import MonitorMetricsByMinuteService, {
  MonitorMetricsByMinuteService as MonitorMetricsByMinuteServiceType,
} from "CommonServer/Services/MonitorMetricsByMinuteService";
import MonitorOwnerTeamService, {
  Service as MonitorOwnerTeamServiceType,
} from "CommonServer/Services/MonitorOwnerTeamService";
import MonitorOwnerUserService, {
  Service as MonitorOwnerUserServiceType,
} from "CommonServer/Services/MonitorOwnerUserService";
import MonitorProbeService, {
  Service as MonitorProbeServiceType,
} from "CommonServer/Services/MonitorProbeService";
import MonitorSecretService, {
  Service as MonitorSecretServiceType,
} from "CommonServer/Services/MonitorSecretService";
import MonitorService, {
  Service as MonitorServiceType,
} from "CommonServer/Services/MonitorService";
import MonitorStatusService, {
  Service as MonitorStatusServiceType,
} from "CommonServer/Services/MonitorStatusService";
import MonitorTimelineStatusService, {
  Service as MonitorTimelineStatusServiceType,
} from "CommonServer/Services/MonitorStatusTimelineService";
import OnCallDutyPolicyCustomFieldService, {
  Service as OnCallDutyPolicyCustomFieldServiceType,
} from "CommonServer/Services/OnCallDutyPolicyCustomFieldService";
import OnCallDutyPolicyEscalationRuleScheduleService, {
  Service as OnCallDutyPolicyEscalationRuleScheduleServiceType,
} from "CommonServer/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyEscalationRuleService, {
  Service as OnCallDutyPolicyEscalationRuleServiceType,
} from "CommonServer/Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyEscalationRuleTeamService, {
  Service as OnCallDutyPolicyEscalationRuleTeamServiceType,
} from "CommonServer/Services/OnCallDutyPolicyEscalationRuleTeamService";
import OnCallDutyPolicyEscalationRuleUserService, {
  Service as OnCallDutyPolicyEscalationRuleUserServiceType,
} from "CommonServer/Services/OnCallDutyPolicyEscalationRuleUserService";
import OnCallDutyPolicyExecutionLogService, {
  Service as OnCallDutyPolicyExecutionLogServiceType,
} from "CommonServer/Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyExecutionLogTimelineService, {
  Service as OnCallDutyPolicyExecutionLogTimelineServiceType,
} from "CommonServer/Services/OnCallDutyPolicyExecutionLogTimelineService";
import OnCallDutyPolicyScheduleLayerService, {
  Service as OnCallDutyPolicyScheduleLayerServiceType,
} from "CommonServer/Services/OnCallDutyPolicyScheduleLayerService";
import OnCallDutyPolicyScheduleLayerUserService, {
  Service as OnCallDutyPolicyScheduleLayerUserServiceType,
} from "CommonServer/Services/OnCallDutyPolicyScheduleLayerUserService";
import OnCallDutyPolicyScheduleService, {
  Service as OnCallDutyPolicyScheduleServiceType,
} from "CommonServer/Services/OnCallDutyPolicyScheduleService";
import OnCallDutyPolicyService, {
  Service as OnCallDutyPolicyServiceType,
} from "CommonServer/Services/OnCallDutyPolicyService";
import ProjectCallSMSConfigService, {
  Service as ProjectCallSMSConfigServiceType,
} from "CommonServer/Services/ProjectCallSMSConfigService";
import ProjectSmtpConfigService, {
  Service as ProjectSMTPConfigServiceType,
} from "CommonServer/Services/ProjectSmtpConfigService";
import PromoCodeService, {
  Service as PromoCodeServiceType,
} from "CommonServer/Services/PromoCodeService";
import ResellerService, {
  Service as ResellerServiceType,
} from "CommonServer/Services/ResellerService";
import ScheduledMaintenanceCustomFieldService, {
  Service as ScheduledMaintenanceCustomFieldServiceType,
} from "CommonServer/Services/ScheduledMaintenanceCustomFieldService";
import ScheduledMaintenanceInternalNoteService, {
  Service as ScheduledMaintenanceInternalNoteServiceType,
} from "CommonServer/Services/ScheduledMaintenanceInternalNoteService";
import ScheduledMaintenanceNoteTemplateService, {
  Service as ScheduledMaintenanceNoteTemplateServiceType,
} from "CommonServer/Services/ScheduledMaintenanceNoteTemplateService";
import ScheduledMaintenanceOwnerTeamService, {
  Service as ScheduledMaintenanceOwnerTeamServiceType,
} from "CommonServer/Services/ScheduledMaintenanceOwnerTeamService";
import ScheduledMaintenanceOwnerUserService, {
  Service as ScheduledMaintenanceOwnerUserServiceType,
} from "CommonServer/Services/ScheduledMaintenanceOwnerUserService";
import ScheduledMaintenancePublicNoteService, {
  Service as ScheduledMaintenancePublicNoteServiceType,
} from "CommonServer/Services/ScheduledMaintenancePublicNoteService";
import ScheduledMaintenanceService, {
  Service as ScheduledMaintenanceServiceType,
} from "CommonServer/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService, {
  Service as ScheduledMaintenanceStateServiceType,
} from "CommonServer/Services/ScheduledMaintenanceStateService";
import ScheduledMaintenanceStateTimelineService, {
  Service as ScheduledMaintenanceStateTimelineServiceType,
} from "CommonServer/Services/ScheduledMaintenanceStateTimelineService";
import ServiceCatalogOwnerTeamService, {
  Service as ServiceCatalogOwnerTeamServiceType,
} from "CommonServer/Services/ServiceCatalogOwnerTeamService";
import ServiceCatalogOwnerUserService, {
  Service as ServiceCatalogOwnerUserServiceType,
} from "CommonServer/Services/ServiceCatalogOwnerUserService";
import ServiceCatalogService, {
  Service as ServiceCatalogServiceType,
} from "CommonServer/Services/ServiceCatalogService";
import ServiceCopilotCodeRepositoryService, {
  Service as ServiceCopilotCodeRepositoryType,
} from "CommonServer/Services/ServiceCopilotCodeRepositoryService";
import ServiceCatalogDependencyService, {
  Service as ServiceCatalogDependencyServiceType,
} from "CommonServer/Services/ServiceCatalogDependencyService";
import ServiceCatalogMonitor from "Common/AppModels/Models/ServiceCatalogMonitor";
import ServiceCatalogMonitorService, {
  Service as ServiceCatalogMonitorServiceType,
} from "CommonServer/Services/ServiceCatalogMonitorService";

import ServiceCatalogTelemetryService from "Common/AppModels/Models/ServiceCatalogTelemetryService";
import ServiceCatalogTelemetryServiceService, {
  Service as ServiceCatalogTelemetryServiceServiceType,
} from "CommonServer/Services/ServiceCatalogTelemetryServiceService";

import ShortLinkService, {
  Service as ShortLinkServiceType,
} from "CommonServer/Services/ShortLinkService";
import SmsLogService, {
  Service as SmsLogServiceType,
} from "CommonServer/Services/SmsLogService";
import SpanService, {
  SpanService as SpanServiceType,
} from "CommonServer/Services/SpanService";
import StatusPageAnnouncementService, {
  Service as StatusPageAnnouncementServiceType,
} from "CommonServer/Services/StatusPageAnnouncementService";
import StatusPageCustomFieldService, {
  Service as StatusPageCustomFieldServiceType,
} from "CommonServer/Services/StatusPageCustomFieldService";
import StatusPageFooterLinkService, {
  Service as StatusPageFooterLinkServiceType,
} from "CommonServer/Services/StatusPageFooterLinkService";
import StatusPageGroupService, {
  Service as StatusPageGroupServiceType,
} from "CommonServer/Services/StatusPageGroupService";
import StatusPageHeaderLinkService, {
  Service as StatusPageHeaderLinkServiceType,
} from "CommonServer/Services/StatusPageHeaderLinkService";
import StatusPageHistoryChartBarColorRuleService, {
  Service as StatusPageHistoryChartBarColorRuleServiceType,
} from "CommonServer/Services/StatusPageHistoryChartBarColorRuleService";
import StatusPageOwnerTeamService, {
  Service as StatusPageOwnerTeamServiceType,
} from "CommonServer/Services/StatusPageOwnerTeamService";
import StatusPageOwnerUserService, {
  Service as StatusPageOwnerUserServiceType,
} from "CommonServer/Services/StatusPageOwnerUserService";
import StatusPagePrivateUserService, {
  Service as StatusPagePrivateUserServiceType,
} from "CommonServer/Services/StatusPagePrivateUserService";
import StatusPageResourceService, {
  Service as StatusPageResourceServiceType,
} from "CommonServer/Services/StatusPageResourceService";
import StatusPageSSOService, {
  Service as StatusPageSSOServiceType,
} from "CommonServer/Services/StatusPageSsoService";
import TeamMemberService, {
  TeamMemberService as TeamMemberServiceType,
} from "CommonServer/Services/TeamMemberService";
import TeamPermissionService, {
  Service as TeamPermissionServiceType,
} from "CommonServer/Services/TeamPermissionService";
import TeamService, {
  Service as TeamServiceType,
} from "CommonServer/Services/TeamService";
import TelemetryServiceService, {
  Service as TelemetryServiceServiceType,
} from "CommonServer/Services/TelemetryServiceService";
import TelemetryUsageBillingService, {
  Service as TelemetryUsageBillingServiceType,
} from "CommonServer/Services/TelemetryUsageBillingService";
import UserNotificationRuleService, {
  Service as UserNotificationRuleServiceType,
} from "CommonServer/Services/UserNotificationRuleService";
import UserNotificationSettingService, {
  Service as UserNotificationSettingServiceType,
} from "CommonServer/Services/UserNotificationSettingService";
import UserOnCallLogService, {
  Service as UserNotificationLogServiceType,
} from "CommonServer/Services/UserOnCallLogService";
import UserService, {
  Service as UserServiceType,
} from "CommonServer/Services/UserService";
import WorkflowLogService, {
  Service as WorkflowLogServiceType,
} from "CommonServer/Services/WorkflowLogService";
import WorkflowService, {
  Service as WorkflowServiceType,
} from "CommonServer/Services/WorkflowService";
import WorkflowVariableService, {
  Service as WorkflowVariableServiceType,
} from "CommonServer/Services/WorkflowVariableService";

import ProbeOwnerTeamService, {
  Service as ProbeOwnerTeamServiceType,
} from "CommonServer/Services/ProbeOwnerTeamService";

import ProbeOwnerUserService, {
  Service as ProbeOwnerUserServiceType,
} from "CommonServer/Services/ProbeOwnerUserService";

import FeatureSet from "CommonServer/Types/FeatureSet";
import Express, { ExpressApplication } from "CommonServer/Utils/Express";
import Log from "Common/AppModels/AnalyticsModels/Log";
import Metric from "Common/AppModels/AnalyticsModels/Metric";
import MonitorMetricsByMinute from "Common/AppModels/AnalyticsModels/MonitorMetricsByMinute";
import Span from "Common/AppModels/AnalyticsModels/Span";
import ApiKey from "Common/AppModels/Models/ApiKey";
import ApiKeyPermission from "Common/AppModels/Models/ApiKeyPermission";
import CallLog from "Common/AppModels/Models/CallLog";
import Domain from "Common/AppModels/Models/Domain";
import EmailLog from "Common/AppModels/Models/EmailLog";
import EmailVerificationToken from "Common/AppModels/Models/EmailVerificationToken";
import Incident from "Common/AppModels/Models/Incident";
import IncidentCustomField from "Common/AppModels/Models/IncidentCustomField";
import IncidentInternalNote from "Common/AppModels/Models/IncidentInternalNote";
import IncidentNoteTemplate from "Common/AppModels/Models/IncidentNoteTemplate";
import IncidentOwnerTeam from "Common/AppModels/Models/IncidentOwnerTeam";
import IncidentOwnerUser from "Common/AppModels/Models/IncidentOwnerUser";
import IncidentPublicNote from "Common/AppModels/Models/IncidentPublicNote";
import IncidentSeverity from "Common/AppModels/Models/IncidentSeverity";
import IncidentState from "Common/AppModels/Models/IncidentState";
import IncidentStateTimeline from "Common/AppModels/Models/IncidentStateTimeline";
import IncidentTemplate from "Common/AppModels/Models/IncidentTemplate";
import IncidentTemplateOwnerTeam from "Common/AppModels/Models/IncidentTemplateOwnerTeam";
import IncidentTemplateOwnerUser from "Common/AppModels/Models/IncidentTemplateOwnerUser";
import Label from "Common/AppModels/Models/Label";
import Monitor from "Common/AppModels/Models/Monitor";
import MonitorCustomField from "Common/AppModels/Models/MonitorCustomField";
import MonitorGroupOwnerTeam from "Common/AppModels/Models/MonitorGroupOwnerTeam";
import MonitorGroupOwnerUser from "Common/AppModels/Models/MonitorGroupOwnerUser";
import MonitorGroupResource from "Common/AppModels/Models/MonitorGroupResource";
import MonitorOwnerTeam from "Common/AppModels/Models/MonitorOwnerTeam";
import MonitorOwnerUser from "Common/AppModels/Models/MonitorOwnerUser";
import MonitorProbe from "Common/AppModels/Models/MonitorProbe";
import MonitorSecret from "Common/AppModels/Models/MonitorSecret";
import MonitorStatus from "Common/AppModels/Models/MonitorStatus";
import MonitorTimelineStatus from "Common/AppModels/Models/MonitorStatusTimeline";
import OnCallDutyPolicy from "Common/AppModels/Models/OnCallDutyPolicy";
import OnCallDutyPolicyCustomField from "Common/AppModels/Models/OnCallDutyPolicyCustomField";
import OnCallDutyPolicyEscalationRule from "Common/AppModels/Models/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleSchedule from "Common/AppModels/Models/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleTeam from "Common/AppModels/Models/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleUser from "Common/AppModels/Models/OnCallDutyPolicyEscalationRuleUser";
import OnCallDutyPolicyExecutionLog from "Common/AppModels/Models/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogTimeline from "Common/AppModels/Models/OnCallDutyPolicyExecutionLogTimeline";
import OnCallDutyPolicySchedule from "Common/AppModels/Models/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleLayer from "Common/AppModels/Models/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "Common/AppModels/Models/OnCallDutyPolicyScheduleLayerUser";
import ProjectCallSMSConfig from "Common/AppModels/Models/ProjectCallSMSConfig";
import ProjectSmtpConfig from "Common/AppModels/Models/ProjectSmtpConfig";
import PromoCode from "Common/AppModels/Models/PromoCode";
import Reseller from "Common/AppModels/Models/Reseller";
import ScheduledMaintenance from "Common/AppModels/Models/ScheduledMaintenance";
import ScheduledMaintenanceCustomField from "Common/AppModels/Models/ScheduledMaintenanceCustomField";
import ScheduledMaintenanceInternalNote from "Common/AppModels/Models/ScheduledMaintenanceInternalNote";
import ScheduledMaintenanceNoteTemplate from "Common/AppModels/Models/ScheduledMaintenanceNoteTemplate";
import ScheduledMaintenanceOwnerTeam from "Common/AppModels/Models/ScheduledMaintenanceOwnerTeam";
import ScheduledMaintenanceOwnerUser from "Common/AppModels/Models/ScheduledMaintenanceOwnerUser";
import ScheduledMaintenancePublicNote from "Common/AppModels/Models/ScheduledMaintenancePublicNote";
import ScheduledMaintenanceState from "Common/AppModels/Models/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "Common/AppModels/Models/ScheduledMaintenanceStateTimeline";
import ServiceCatalog from "Common/AppModels/Models/ServiceCatalog";
import ServiceCatalogOwnerTeam from "Common/AppModels/Models/ServiceCatalogOwnerTeam";
import ServiceCatalogOwnerUser from "Common/AppModels/Models/ServiceCatalogOwnerUser";
import ServiceCopilotCodeRepository from "Common/AppModels/Models/ServiceCopilotCodeRepository";
import ShortLink from "Common/AppModels/Models/ShortLink";
import SmsLog from "Common/AppModels/Models/SmsLog";
import StatusPageAnnouncement from "Common/AppModels/Models/StatusPageAnnouncement";
// Custom Fields API
import StatusPageCustomField from "Common/AppModels/Models/StatusPageCustomField";
import StatusPageFooterLink from "Common/AppModels/Models/StatusPageFooterLink";
import StatusPageGroup from "Common/AppModels/Models/StatusPageGroup";
import StatusPageHeaderLink from "Common/AppModels/Models/StatusPageHeaderLink";
import TelemetryIngestionKey from "Common/AppModels/Models/TelemetryIngestionKey";
import StatusPageHistoryChartBarColorRule from "Common/AppModels/Models/StatusPageHistoryChartBarColorRule";
import StatusPageOwnerTeam from "Common/AppModels/Models/StatusPageOwnerTeam";
import StatusPageOwnerUser from "Common/AppModels/Models/StatusPageOwnerUser";
import StatusPagePrivateUser from "Common/AppModels/Models/StatusPagePrivateUser";
import StatusPageResource from "Common/AppModels/Models/StatusPageResource";
import StatusPageSSO from "Common/AppModels/Models/StatusPageSso";
import Team from "Common/AppModels/Models/Team";
import TeamMember from "Common/AppModels/Models/TeamMember";
import TeamPermission from "Common/AppModels/Models/TeamPermission";
import TelemetryService from "Common/AppModels/Models/TelemetryService";
import TelemetryUsageBilling from "Common/AppModels/Models/TelemetryUsageBilling";
import User from "Common/AppModels/Models/User";
import UserNotificationRule from "Common/AppModels/Models/UserNotificationRule";
import UserNotificationSetting from "Common/AppModels/Models/UserNotificationSetting";
import UserOnCallLog from "Common/AppModels/Models/UserOnCallLog";
import Workflow from "Common/AppModels/Models/Workflow";
import WorkflowLog from "Common/AppModels/Models/WorkflowLog";
import WorkflowVariable from "Common/AppModels/Models/WorkflowVariable";
import ProbeOwnerTeam from "Common/AppModels/Models/ProbeOwnerTeam";
import ProbeOwnerUser from "Common/AppModels/Models/ProbeOwnerUser";
import ServiceCatalogDependency from "Common/AppModels/Models/ServiceCatalogDependency";
import TelemetryAttribute from "Common/AppModels/AnalyticsModels/TelemetryAttribute";

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
