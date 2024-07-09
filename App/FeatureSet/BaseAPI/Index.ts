importing various APIs and services from different modules, and the comments are not necessary as the code is self-explanatory. However, I can suggest adding comments for any complex or hard-to-understand code sections.
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
    import ServiceRepositoryService, {
      Service as ServiceRepositoryType,
    } from "CommonServer/Services/ServiceRepositoryService";
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
import Log from "Model/AnalyticsModels/Log";
import Metric from "Model/AnalyticsModels/Metric";
import MonitorMetricsByMinute from "Model/AnalyticsModels/MonitorMetricsByMinute";
import Span from "Model/AnalyticsModels/Span";
import ApiKey from "Model/Models/ApiKey";
import ApiKeyPermission from "Model/Models/ApiKeyPermission";
import CallLog from "Model/Models/CallLog";
import Domain from "Model/Models/Domain";
import EmailLog from "Model/Models/EmailLog";
import EmailVerificationToken from "Model/Models/EmailVerificationToken";
import Incident from "Model/Models/Incident";
import IncidentCustomField from "Model/Models/IncidentCustomField";
import IncidentInternalNote from "Model/Models/IncidentInternalNote";
import IncidentNoteTemplate from "Model/Models/IncidentNoteTemplate";
import IncidentOwnerTeam from "Model/Models/IncidentOwnerTeam";
import IncidentOwnerUser from "Model/Models/IncidentOwnerUser";
import IncidentPublicNote from "Model/Models/IncidentPublicNote";
import IncidentSeverity from "Model/Models/IncidentSeverity";
import IncidentState from "Model/Models/IncidentState";
import IncidentStateTimeline from "Model/Models/IncidentStateTimeline";
import IncidentTemplate from "Model/Models/IncidentTemplate";
import IncidentTemplateOwnerTeam from "Model/Models/IncidentTemplateOwnerTeam";
import IncidentTemplateOwnerUser from "Model/Models/IncidentTemplateOwnerUser";
import Label from "Model/Models/Label";
import Monitor from "Model/Models/Monitor";
import MonitorCustomField from "Model/Models/MonitorCustomField";
import MonitorGroupOwnerTeam from "Model/Models/MonitorGroupOwnerTeam";
import MonitorGroupOwnerUser from "Model/Models/MonitorGroupOwnerUser";
import MonitorGroupResource from "Model/Models/MonitorGroupResource";
import MonitorOwnerTeam from "Model/Models/MonitorOwnerTeam";
import MonitorOwnerUser from "Model/Models/MonitorOwnerUser";
import MonitorProbe from "Model/Models/MonitorProbe";
import MonitorSecret from "Model/Models/MonitorSecret";
import MonitorStatus from "Model/Models/MonitorStatus";
import MonitorTimelineStatus from "Model/Models/MonitorStatusTimeline";
import OnCallDutyPolicy from "Model/Models/OnCallDutyPolicy";
import OnCallDutyPolicyCustomField from "Model/Models/OnCallDutyPolicyCustomField";
import OnCallDutyPolicyEscalationRule from "Model/Models/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleSchedule from "Model/Models/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleTeam from "Model/Models/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleUser from "Model/Models/OnCallDutyPolicyEscalationRuleUser";
import OnCallDutyPolicyExecutionLog from "Model/Models/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogTimeline from "Model/Models/OnCallDutyPolicyExecutionLogTimeline";
import OnCallDutyPolicySchedule from "Model/Models/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleLayer from "Model/Models/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "Model/Models/OnCallDutyPolicyScheduleLayerUser";
import ProjectCallSMSConfig from "Model/Models/ProjectCallSMSConfig";
import ProjectSmtpConfig from "Model/Models/ProjectSmtpConfig";
import PromoCode from "Model/Models/PromoCode";
import Reseller from "Model/Models/Reseller";
import ScheduledMaintenance from "Model/Models/ScheduledMaintenance";
import ScheduledMaintenanceCustomField from "Model/Models/ScheduledMaintenanceCustomField";
import ScheduledMaintenanceInternalNote from "Model/Models/ScheduledMaintenanceInternalNote";
import ScheduledMaintenanceNoteTemplate from "Model/Models/ScheduledMaintenanceNoteTemplate";
import ScheduledMaintenanceOwnerTeam from "Model/Models/ScheduledMaintenanceOwnerTeam";
import ScheduledMaintenanceOwnerUser from "Model/Models/ScheduledMaintenanceOwnerUser";
import ScheduledMaintenancePublicNote from "Model/Models/ScheduledMaintenancePublicNote";
import ScheduledMaintenanceState from "Model/Models/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "Model/Models/ScheduledMaintenanceStateTimeline";
import ServiceCatalog from "Model/Models/ServiceCatalog";
import ServiceCatalogOwnerTeam from "Model/Models/ServiceCatalogOwnerTeam";
import ServiceCatalogOwnerUser from "Model/Models/ServiceCatalogOwnerUser";
import ServiceRepository from "Model/Models/ServiceRepository";
import ShortLink from "Model/Models/ShortLink";
import SmsLog from "Model/Models/SmsLog";
import StatusPageAnnouncement from "Model/Models/StatusPageAnnouncement";
// Custom Fields API
import StatusPageCustomField from "Model/Models/StatusPageCustomField";
import StatusPageFooterLink from "Model/Models/StatusPageFooterLink";
import StatusPageGroup from "Model/Models/StatusPageGroup";
import StatusPageHeaderLink from "Model/Models/StatusPageHeaderLink";
import StatusPageHistoryChartBarColorRule from "Model/Models/StatusPageHistoryChartBarColorRule";
import StatusPageOwnerTeam from "Model/Models/StatusPageOwnerTeam";
import StatusPageOwnerUser from "Model/Models/StatusPageOwnerUser";
import StatusPagePrivateUser from "Model/Models/StatusPagePrivateUser";
import StatusPageResource from "Model/Models/StatusPageResource";
import StatusPageSSO from "Model/Models/StatusPageSso";
import Team from "Model/Models/Team";
import TeamMember from "Model/Models/TeamMember";
import TeamPermission from "Model/Models/TeamPermission";
import TelemetryService from "Model/Models/TelemetryService";
import TelemetryUsageBilling from "Model/Models/TelemetryUsageBilling";
import User from "Model/Models/User";
import UserNotificationRule from "Model/Models/UserNotificationRule";
import UserNotificationSetting from "Model/Models/UserNotificationSetting";
import UserOnCallLog from "Model/Models/UserOnCallLog";
import Workflow from "Model/Models/Workflow";
import WorkflowLog from "Model/Models/WorkflowLog";
import WorkflowVariable from "Model/Models/WorkflowVariable";
import ProbeOwnerTeam from "Model/Models/ProbeOwnerTeam";
import ProbeOwnerUser from "Model/Models/ProbeOwnerUser";

const BaseAPIFeatureSet: FeatureSet = {
  init: async (): Promise<void> => {
    const app: ExpressApplication = Express.getExpressApp();

    const APP_NAME: string = "api";



app.use(
  `/${APP_NAME.toLocaleLowerCase()}`, // Set the base path for the API
  new BaseAnalyticsAPI<Log, LogServiceType>(Log, LogService).getRouter(), // Initialize the Log API
);

app.use(
  `/${APP_NAME.toLocaleLowerCase()}`, 
  new BaseAnalyticsAPI<Metric, MetricServiceType>(Metric, MetricService).getRouter(), // Initialize the Metric API
);

app.use(
  `/${APP_NAME.toLocaleLowerCase()}`, 
  new BaseAnalyticsAPI<MonitorMetricsByMinute, MonitorMetricsByMinuteServiceType>(MonitorMetricsByMinute, MonitorMetricsByMinuteService).getRouter(), // Initialize the Monitor Metrics by Minute API
);

app.use(
  `/${APP_NAME.toLocaleLowerCase()}`, 
  new BaseAnalyticsAPI<Span, SpanServiceType>(Span, SpanService).getRouter(), // Initialize the Span API
);

app.use(
  `/${APP_NAME.toLocaleLowerCase()}`, 
  new BaseAPI<TelemetryUsageBilling, TelemetryUsageBillingServiceType>(TelemetryUsageBilling, TelemetryUsageBillingService).getRouter(), // Initialize the Telemetry Usage Billing API
);

app.use(
  `/${APP_NAME.toLocaleLowerCase()}`, 
  new BaseAPI<ShortLink, ShortLinkServiceType>(ShortLink, ShortLinkService).getRouter(), // Initialize the Short Link API
);

app.use(
  `/${APP_NAME.toLocaleLowerCase()}`, 
  new BaseAPI<StatusPageHistoryChartBarColorRule, StatusPageHistoryChartBarColorRuleServiceType>(StatusPageHistoryChartBarColorRule, StatusPageHistoryChartBarColorRuleService).getRouter(), // Initialize the Status Page History Chart Bar Color Rule API
);

app.use(
  `/${APP_NAME.toLocaleLowerCase()}`, 
  new BaseAPI<MonitorProbe, MonitorProbeServiceType>(MonitorProbe, MonitorProbeService).getRouter(), // Initialize the Monitor Probe API
);

app.use(
  `/${APP_NAME.toLocaleLowerCase()}`, 
  new BaseAPI<ProbeOwnerUser, ProbeOwnerUserServiceType>(ProbeOwnerUser, ProbeOwnerUserService).getRouter(), // Initialize the Probe Owner User API
);

app.use(
  `/${APP_NAME.toLocaleLowerCase()}`, 
  new BaseAPI<ProbeOwnerTeam, ProbeOwnerTeamServiceType>(ProbeOwnerTeam, // Initialize the Probe Owner Team API
);
ProbeOwnerTeamService,
  ).getRouter(),
);

app.use(
  `/${APP_NAME.toLocaleLowerCase()}`, // Adding prefix to the route
  new BaseAPI<MonitorSecret, MonitorSecretServiceType>(
    MonitorSecret, // Model
    MonitorSecretService, // Service
  ).getRouter(), // Registering router for MonitorSecretService
);

app.use(
  `/${APP_NAME.toLocaleLowerCase()}`, // Adding prefix to the route
  new BaseAPI<StatusPageAnnouncement, StatusPageAnnouncementServiceType>(
    StatusPageAnnouncement, // Model
    StatusPageAnnouncementService, // Service
  ).getRouter(), // Registering router for StatusPageAnnouncementService
);

app.use(
  `/${APP_NAME.toLocaleLowerCase()}`, // Adding prefix to the route
  new BaseAPI<Team, TeamServiceType>(Team, TeamService).getRouter(), // Registering router for TeamService
);

app.use(
  `/${APP_NAME.toLocaleLowerCase()}`, // Adding prefix to the route
  new BaseAPI<ServiceRepository, ServiceRepositoryType>(
    ServiceRepository, // Model
    ServiceRepositoryService, // Service
  ).getRouter(), // Registering router for ServiceRepositoryService
);

app.use(
  `/${APP_NAME.toLocaleLowerCase()}`, // Adding prefix to the route
  new BaseAPI<MonitorGroupOwnerUser, MonitorGroupOwnerUserServiceType>(
    MonitorGroupOwnerUser, // Model
    MonitorGroupOwnerUserService, // Service
  ).getRouter(), // Registering router for MonitorGroupOwnerUserService
);

app.use(
  `/${APP_NAME.toLocaleLowerCase()}`, // Adding prefix to the route
  new BaseAPI<ServiceCatalog, ServiceCatalogServiceType>(
    ServiceCatalog, // Model
    ServiceCatalogService, // Service
  ).getRouter(), // Registering router for ServiceCatalogService
);

app.use(
  `/${APP_NAME.toLocaleLowerCase()}`, // Adding prefix to the route
  new BaseAPI<ServiceCatalogOwnerTeam, ServiceCatalogOwnerTeamServiceType>(
    ServiceCatalogOwnerTeam, // Model
    ServiceCatalogOwnerTeamService, // Service
  ).getRouter(), // Registering router for ServiceCatalogOwnerTeamService
);

app.use(
  `/${APP_NAME.toLocaleLowerCase()}`, // Adding prefix to the route
  new BaseAPI<ServiceCatalogOwnerUser, ServiceCatalogOwnerUserServiceType>(
    ServiceCatalogOwnerUser, // Model
    ServiceCatalogOwnerUserService, // Service
  ).getRouter(), // Registering router for ServiceCatalogOwnerUserService
);

app.use(
  `/${APP_NAME.toLocaleLowerCase()}`, // Adding prefix to the route
  new BaseAPI<
    OnCallDutyPolicySchedule,
    OnCallDutyPolicyScheduleServiceType
  >(OnCallDutyPolicySchedule, OnCallDutyPolicyScheduleService).getRouter(), // Registering router for OnCallDutyPolicyScheduleService
);

app.use(
  `/${APP_NAME.toLocaleLowerCase()}`, // Adding prefix to the route
  new BaseAPI<
    OnCallDutyPolicyScheduleLayer,

OnCallDutyPolicyScheduleLayerServiceType
      >(
        OnCallDutyPolicyScheduleLayer,
        OnCallDutyPolicyScheduleLayerService,
      ).getRouter(),
    );

    // Set up API routes for OnCallDutyPolicyScheduleLayerUser
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

    // Set up API routes for MonitorGroupOwnerTeam
    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<MonitorGroupOwnerTeam, MonitorGroupOwnerTeamServiceType>(
        MonitorGroupOwnerTeam,
        MonitorGroupOwnerTeamService,
      ).getRouter(),
    );

    // Set up API routes for ProjectCallSMSConfig
    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<ProjectCallSMSConfig, ProjectCallSMSConfigServiceType>(
        ProjectCallSMSConfig,
        ProjectCallSMSConfigService,
      ).getRouter(),
    );

    // Set up API routes for MonitorGroupResource
    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<MonitorGroupResource, MonitorGroupResourceServiceType>(
        MonitorGroupResource,
        MonitorGroupResourceService,
      ).getRouter(),
    );

    // Set up API routes for TeamMember
    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<TeamMember, TeamMemberServiceType>(
        TeamMember,
        TeamMemberService,
      ).getRouter(),
    );

    // Set up API routes for TeamPermission
    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<TeamPermission, TeamPermissionServiceType>(
        TeamPermission,
        TeamPermissionService,
      ).getRouter(),
    );

    // Set up API routes for MonitorStatus
    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      new BaseAPI<MonitorStatus, MonitorStatusServiceType>(
        MonitorStatus,
        MonitorStatusService,
      ).getRouter(),
    );

    // Set up API routes for IncidentState
    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,

new BaseAPI instance for ScheduledMaintenanceState
    new BaseAPI<
      ScheduledMaintenanceState,
      ScheduledMaintenanceStateServiceType
    >(
      ScheduledMaintenanceState,
      ScheduledMaintenanceStateService,
    ).getRouter(),
  );

  // Use the router for the APP_NAME
  app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    // Create a new BaseAPI instance for StatusPageResource
    new BaseAPI<StatusPageResource, StatusPageResourceServiceType>(
      StatusPageResource,
      StatusPageResourceService,
    ).getRouter(),
  );

  // Use the router for the APP_NAME
  app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    // Create a new BaseAPI instance for Workflow
    new BaseAPI<Workflow, WorkflowServiceType>(
      Workflow,
      WorkflowService,
    ).getRouter(),
  );

  // Use the router for the APP_NAME
  app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    // Create a new BaseAPI instance for TelemetryService
    new BaseAPI<TelemetryService, TelemetryServiceServiceType>(
      TelemetryService,
      TelemetryServiceService,
    ).getRouter(),
  );

  // Use the router for the APP_NAME
  app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    // Create a new BaseAPI instance for WorkflowVariable
    new BaseAPI<WorkflowVariable, WorkflowVariableServiceType>(
      WorkflowVariable,
      WorkflowVariableService,
    ).getRouter(),
  );

  // Use the router for the APP_NAME
  app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    // Create a new BaseAPI instance for WorkflowLog
    new BaseAPI<WorkflowLog, WorkflowLogServiceType>(
      WorkflowLog,
      WorkflowLogService,
    ).getRouter(),
  );

  // Use the router for the APP_NAME
  app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    // Create a new BaseAPI instance for Domain
    new BaseAPI<Domain, DomainServiceType>(Domain, DomainService).getRouter(),
  );

  // Use the router for the APP_NAME
  app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    // Create a new BaseAPI instance for StatusPageGroup
    new BaseAPI<StatusPageGroup, StatusPageGroupServiceType>(
      StatusPageGroup,
      StatusPageGroupService,
    ).getRouter(),
  );

  // Use the router for the APP_NAME
  app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    // Create a new BaseAPI instance for IncidentStateTimeline
    new BaseAPI<IncidentStateTimeline, IncidentStateTimelineServiceType>(
      IncidentStateTimeline,
      IncidentStateTimelineService,
    ).getRouter(),
  );

  // Use the router for the APP_NAME
  app.use(
    `/${APP_NAME.toLocaleLowerCase()}`,
    // Create a new BaseAPI instance for ScheduledMaintenanceStateTimeline
  new BaseAPI<
    ScheduledMaintenanceStateTimeline,
    ScheduledMaintenanceStateTimelineServiceType
>(
        StatusPagePrivateUser,
        StatusPagePrivateUserService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      // Create a router for Incident and its service
      new BaseAPI<Incident, IncidentServiceType>(
        Incident,
        IncidentService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      // Create a router for ScheduledMaintenance and its service
      new BaseAPI<ScheduledMaintenance, ScheduledMaintenanceServiceType>(
        ScheduledMaintenance,
        ScheduledMaintenanceService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      // Create a router for ApiKey and its service
      new BaseAPI<ApiKey, ApiKeyServiceType>(ApiKey, ApiKeyService).getRouter(),
    );
    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      // Create a router for ApiKeyPermission and its service
      new BaseAPI<ApiKeyPermission, ApiKeyPermissionServiceType>(
        ApiKeyPermission,
        ApiKeyPermissionService,

).getRouter(),
    );

    // Register API routes for each entity type
    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      // BaseAPI for Incident Severity
      new BaseAPI<IncidentSeverity, IncidentSeverityServiceType>(
        IncidentSeverity,
        IncidentSeverityService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      // BaseAPI for Incident Owner User
      new BaseAPI<IncidentOwnerUser, IncidentOwnerUserServiceType>(
        IncidentOwnerUser,
        IncidentOwnerUserService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      // BaseAPI for Incident Owner Team
      new BaseAPI<IncidentOwnerTeam, IncidentOwnerTeamServiceType>(
        IncidentOwnerTeam,
        IncidentOwnerTeamService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      // BaseAPI for Incident Template
      new BaseAPI<IncidentTemplate, IncidentTemplateServiceType>(
        IncidentTemplate,
        IncidentTemplateService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      // BaseAPI for Incident Note Template
      new BaseAPI<IncidentNoteTemplate, IncidentNoteTemplateServiceType>(
        IncidentNoteTemplate,
        IncidentNoteTemplateService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`,
      // BaseAPI for Scheduled Maintenance Note Template
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
      // BaseAPI for Incident Template Owner Team
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

// Routing API for Short Links
app.use(`/${APP_NAME.toLocaleLowerCase()}`, new ShortLinkAPI().getRouter());

// Routing API for Status Pages
app.use(
  `/${APP_NAME.toLocaleLowerCase()}`,
  new StatusPageAPI().getRouter(),
);

// Routing API for Files
app.use(`/${APP_NAME.toLocaleLowerCase()}`, new FileAPI().getRouter());

// Routing API for Monitor Groups
app.use(
  `/${APP_NAME.toLocaleLowerCase()}`,
  new MonitorGroupAPI().getRouter(),
);

// Routing API for Status Page Domains
app.use(
  `/${APP_NAME.toLocaleLowerCase()}`,
  new StatusPageDomainAPI().getRouter(),
);

// Routing API for Project SSO
app.use(
  `/${APP_NAME.toLocaleLowerCase()}`,
  new ProjectSsoAPI().getRouter(),
);

// Routing API for Reseller Plans
app.use(
  `/${APP_NAME.toLocaleLowerCase()}`,
  new ResellerPlanAPI().getRouter(),
);

// Routing API for Global Config
app.use(
  `/${APP_NAME.toLocaleLowerCase()}`,
  new GlobalConfigAPI().getRouter(),
);

// Routing API for Code Repositories
app.use(
  `/${APP_NAME.toLocaleLowerCase()}`,
  new CodeRepositoryAPI().getRouter(),
);

// Routing API for Copilot Actions
app.use(
  `/${APP_NAME.toLocaleLowerCase()}`,
  new CopilotActionAPI().getRouter(),
);

// Routing API for User Notification Logs
app.use(
  `/${APP_NAME.toLocaleLowerCase()}`,
  new UserNotificationLogTimelineAPI().getRouter(),
);

// Routing API for User Calls
app.use(`/${APP_NAME.toLocaleLowerCase()}`, new UserCallAPI().getRouter());

// Routing API for User Emails
app.use(`/${APP_NAME.toLocaleLowerCase()}`, new UserEmailAPI().getRouter());

// Routing API for User SMS
app.use(`/${APP_NAME.toLocaleLowerCase()}`, new UserSMSAPI().getRouter());

// Routing API for Ingestor
app.use(`/${APP_NAME.toLocaleLowerCase()}`, new Ingestor().getRouter());

// Routing API for Status Page Subscribers
app.use(
  `/${APP_NAME.toLocaleLowerCase()}`,
  new StatusPageSubscriberAPI().getRouter(),
);

// Routing API for Billing Payment Methods
app.use(
  `/${APP_NAME.toLocaleLowerCase()}`,
  new BillingPaymentMethodAPI().getRouter(),
);

// Routing API for Projects
app.use(`/${APP_NAME.toLocaleLowerCase()}`, new ProjectAPI().getRouter());

// Routing API for Billing Invoices
app.use(
  `/${APP_NAME.toLocaleLowerCase()}`,
  new BillingInvoiceAPI().getRouter(),
);

// Routing API for Scheduled Maintenance Public Notes
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

// Routing API for Scheduled Maintenance Internal Notes
app.use(
  `/${APP_NAME.toLocaleLowerCase()}`,
  new BaseAPI<
    ScheduledMaintenanceInternalNote,
    ScheduledMaintenanceInternalNoteServiceType
>(
        IncidentPublicNote,
        IncidentPublicNoteService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`, 
      // Create and register the router for IncidentInternalNote
      new BaseAPI<IncidentInternalNote, IncidentInternalNoteServiceType>(
        IncidentInternalNote,
        IncidentInternalNoteService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`, 
      // Create and register the router for OnCallDutyPolicy
      new BaseAPI<OnCallDutyPolicy, OnCallDutyPolicyServiceType>(
        OnCallDutyPolicy,
        OnCallDutyPolicyService,
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`, 
      // Create and register the router for ScheduledMaintenanceCustomField
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
      // Create and register the router for OnCallDutyPolicyEscalationRuleUser
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
      // Create and register the router for OnCallDutyPolicyEscalationRuleTeam
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
      // Create and register the router for OnCallDutyPolicyEscalationRuleSchedule
      new BaseAPI<
        OnCallDutyPolicyEscalationRuleSchedule,
        OnCallDutyPolicyEscalationRuleScheduleServiceType
      >(
        OnCallDutyPolicyEscalationRuleSchedule,
        OnCallDutyPolicyEscalationRuleScheduleService,
      ).getRouter(),
    );


app.use(
      `/${APP_NAME.toLocaleLowerCase()}`, // Define the base path for the API
      new BaseAPI<
        OnCallDutyPolicyExecutionLog, // Type of data being handled
        OnCallDutyPolicyExecutionLogServiceType // Type of service being used
      >(
        OnCallDutyPolicyExecutionLog, // Model for the API
        OnCallDutyPolicyExecutionLogService, // Service for the API
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`, // Define the base path for the API
      new BaseAPI<
        PromoCode, // Type of data being handled
        PromoCodeServiceType // Type of service being used
      >(
        PromoCode, // Model for the API
        PromoCodeService, // Service for the API
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`, // Define the base path for the API
      new BaseAPI<
        OnCallDutyPolicyExecutionLogTimeline, // Type of data being handled
        OnCallDutyPolicyExecutionLogTimelineServiceType // Type of service being used
      >(
        OnCallDutyPolicyExecutionLogTimeline, // Model for the API
        OnCallDutyPolicyExecutionLogTimelineService, // Service for the API
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`, // Define the base path for the API
      new BaseAPI<
        IncidentCustomField, // Type of data being handled
        IncidentCustomFieldServiceType // Type of service being used
      >(
        IncidentCustomField, // Model for the API
        IncidentCustomFieldService, // Service for the API
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`, // Define the base path for the API
      new BaseAPI<
        OnCallDutyPolicyEscalationRule, // Type of data being handled
        OnCallDutyPolicyEscalationRuleServiceType // Type of service being used
      >(
        OnCallDutyPolicyEscalationRule, // Model for the API
        OnCallDutyPolicyEscalationRuleService, // Service for the API
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`, // Define the base path for the API
      new BaseAPI<
        MonitorCustomField, // Type of data being handled
        MonitorCustomFieldServiceType // Type of service being used
      >(
        MonitorCustomField, // Model for the API
        MonitorCustomFieldService, // Service for the API
      ).getRouter(),
    );

    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`, // Define the base path for the API
      new BaseAPI<
        StatusPageCustomField, // Type of data being handled
        StatusPageCustomFieldServiceType // Type of service being used
      >(
        StatusPageCustomField, // Model for the API
        StatusPageCustomFieldService, // Service for the API
      ).getRouter(),
    );

    app.use(`/${APP_NAME.toLocaleLowerCase()}`, NotificationAPI); // Use a separate API for notifications

    //attach api's
    app.use(
      `/${APP_NAME.toLocaleLowerCase()}`, // Define the base path for the API
      new BaseAPI<User, UserServiceType>(User, UserService).getRouter(),
    );
  },
};

export default BaseAPIFeatureSet;