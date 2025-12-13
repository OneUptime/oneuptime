// Have "Project" string in the permission to make sure this permission is by Project.
import Dictionary from "./Dictionary";
import BadDataException from "./Exception/BadDataException";
import { JSONObject } from "./JSON";
import ObjectID from "./ObjectID";

export interface PermissionProps {
  permission: Permission;
  description: string;
  isAssignableToTenant: boolean;
  title: string;
  isAccessControlPermission: boolean;
}

enum Permission {
  // All users in the project will have this permission.
  ProjectUser = "ProjectUser",

  AuthenticatedRequest = "AuthenticatedRequest", // Authenticated request - could be API, User, MCP server or any other authenticated request.

  // Users who are in the project but do not have SSO authorization.
  UnAuthorizedSsoUser = "UnAuthorizedSsoUser",

  // Owner of a Project
  ProjectOwner = "ProjectOwner",

  // Project Admin
  ProjectAdmin = "ProjectAdmin",

  ProjectMember = "ProjectMember", // member of a project

  User = "User", //registered user. Can or cannot belong to a project.

  CurrentUser = "CurrentUser", // Current logged in user.

  CustomerSupport = "CustomerSupport", // Customer Support for OneUptime.

  Public = "Public", // non-registered user. Everyone has this permission.

  // Billing Permissions (Owner Permission)
  CreateProjectApiKey = "CreateProjectApiKey",
  DeleteProjectApiKey = "DeleteProjectApiKey",
  ReadProjectApiKey = "ReadProjectApiKey",
  EditProjectApiKey = "EditProjectApiKey",
  EditProjectApiKeyPermissions = "EditProjectApiKeyPermissions",

  CreateTelemetryIngestionKey = "CreateTelemetryIngestionKey",
  DeleteTelemetryIngestionKey = "DeleteTelemetryIngestionKey",
  ReadTelemetryIngestionKey = "ReadTelemetryIngestionKey",
  EditTelemetryIngestionKey = "EditTelemetryIngestionKey",

  // Dashboards

  CreateDashboard = "CreateDashboard",
  DeleteDashboard = "DeleteDashboard",
  ReadDashboard = "ReadDashboard",
  EditDashboard = "EditDashboard",

  // Logs
  CreateTelemetryServiceLog = "CreateTelemetryServiceLog",
  DeleteTelemetryServiceLog = "DeleteTelemetryServiceLog",
  EditTelemetryServiceLog = "EditTelemetryServiceLog",
  ReadTelemetryServiceLog = "ReadTelemetryServiceLog",

  // Exceptions
  CreateTelemetryException = "CreateTelemetryException",
  DeleteTelemetryException = "DeleteTelemetryException",
  EditTelemetryException = "EditTelemetryException",
  ReadTelemetryException = "ReadTelemetryException",

  // Spans
  CreateTelemetryServiceTraces = "CreateTelemetryServiceTraces",
  DeleteTelemetryServiceTraces = "DeleteTelemetryServiceTraces",
  EditTelemetryServiceTraces = "EditTelemetryServiceTraces",
  ReadTelemetryServiceTraces = "ReadTelemetryServiceTraces",

  // Metrics
  CreateTelemetryServiceMetrics = "CreateTelemetryServiceMetrics",
  DeleteTelemetryServiceMetrics = "DeleteTelemetryServiceMetrics",
  EditTelemetryServiceMetrics = "EditTelemetryServiceMetrics",
  ReadTelemetryServiceMetrics = "ReadTelemetryServiceMetrics",

  // Billing Permissions (Owner Permission)
  ManageProjectBilling = "ManageProjectBilling",

  // Billing Permissions (Owner Permission)
  CreateProjectTeam = "CreateProjectTeam",
  DeleteProjectTeam = "DeleteProjectTeam",
  ReadProjectTeam = "ReadProjectTeam",
  EditProjectTeam = "EditProjectTeam",
  InviteProjectTeamMembers = "InviteProjectTeamMembers",
  EditProjectTeamPermissions = "EditProjectTeamPermissions",

  CreateProjectProbe = "CreateProjectProbe",
  DeleteProjectProbe = "DeleteProjectProbe",
  EditProjectProbe = "EditProjectProbe",
  ReadProjectProbe = "ReadProjectProbe",

  CreateProjectLlm = "CreateProjectLlm",
  DeleteProjectLlm = "DeleteProjectLlm",
  EditProjectLlm = "EditProjectLlm",
  ReadProjectLlm = "ReadProjectLlm",

  CreateTelemetryService = "CreateTelemetryService",
  DeleteTelemetryService = "DeleteTelemetryService",
  EditTelemetryService = "EditTelemetryService",
  ReadTelemetryService = "ReadTelemetryService",

  CreateMonitorGroupResource = "CreateMonitorGroupResource",
  DeleteMonitorGroupResource = "DeleteMonitorGroupResource",
  EditMonitorGroupResource = "EditMonitorGroupResource",
  ReadMonitorGroupResource = "ReadMonitorGroupResource",

  CreateMonitorCustomField = "CreateMonitorCustomField",
  DeleteMonitorCustomField = "DeleteMonitorCustomField",
  EditMonitorCustomField = "EditMonitorCustomField",
  ReadMonitorCustomField = "ReadMonitorCustomField",

  CreateOnCallDutyPolicyCustomField = "CreateOnCallDutyPolicyCustomField",
  DeleteOnCallDutyPolicyCustomField = "DeleteOnCallDutyPolicyCustomField",
  EditOnCallDutyPolicyCustomField = "EditOnCallDutyPolicyCustomField",
  ReadOnCallDutyPolicyCustomField = "ReadOnCallDutyPolicyCustomField",

  CreateOnCallDutyPolicyScheduleLayer = "CreateOnCallDutyPolicyScheduleLayer",
  DeleteOnCallDutyPolicyScheduleLayer = "DeleteOnCallDutyPolicyScheduleLayer",
  EditOnCallDutyPolicyScheduleLayer = "EditOnCallDutyPolicyScheduleLayer",
  ReadOnCallDutyPolicyScheduleLayer = "ReadOnCallDutyPolicyScheduleLayer",

  CreateOnCallDutyPolicyScheduleLayerUser = "CreateOnCallDutyPolicyScheduleLayerUser",
  DeleteOnCallDutyPolicyScheduleLayerUser = "DeleteOnCallDutyPolicyScheduleLayerUser",
  EditOnCallDutyPolicyScheduleLayerUser = "EditOnCallDutyPolicyScheduleLayerUser",
  ReadOnCallDutyPolicyScheduleLayerUser = "ReadOnCallDutyPolicyScheduleLayerUser",

  CreateScheduledMaintenanceCustomField = "CreateScheduledMaintenanceCustomField",
  DeleteScheduledMaintenanceCustomField = "DeleteScheduledMaintenanceCustomField",
  EditScheduledMaintenanceCustomField = "EditScheduledMaintenanceCustomField",
  ReadScheduledMaintenanceCustomField = "ReadScheduledMaintenanceCustomField",

  CreateMonitorProbe = "CreateMonitorProbe",
  DeleteMonitorProbe = "DeleteMonitorProbe",
  EditMonitorProbe = "EditMonitorProbe",
  ReadMonitorProbe = "ReadMonitorProbe",

  ReadSmsLog = "ReadSmsLog",
  ReadWhatsAppLog = "ReadWhatsAppLog",
  ReadEmailLog = "ReadEmailLog",
  ReadCallLog = "ReadCallLog",
  ReadPushLog = "ReadPushLog",
  ReadWorkspaceNotificationLog = "ReadWorkspaceNotificationLog",

  CreateIncidentOwnerTeam = "CreateIncidentOwnerTeam",
  DeleteIncidentOwnerTeam = "DeleteIncidentOwnerTeam",
  EditIncidentOwnerTeam = "EditIncidentOwnerTeam",
  ReadIncidentOwnerTeam = "ReadIncidentOwnerTeam",

  CreateAlertOwnerTeam = "CreateAlertOwnerTeam",
  DeleteAlertOwnerTeam = "DeleteAlertOwnerTeam",
  EditAlertOwnerTeam = "EditAlertOwnerTeam",
  ReadAlertOwnerTeam = "ReadAlertOwnerTeam",

  CreateAlertOwnerUser = "CreateAlertOwnerUser",
  DeleteAlertOwnerUser = "DeleteAlertOwnerUser",
  EditAlertOwnerUser = "EditAlertOwnerUser",
  ReadAlertOwnerUser = "ReadAlertOwnerUser",

  CreateIncidentOwnerUser = "CreateIncidentOwnerUser",
  DeleteIncidentOwnerUser = "DeleteIncidentOwnerUser",
  EditIncidentOwnerUser = "EditIncidentOwnerUser",
  ReadIncidentOwnerUser = "ReadIncidentOwnerUser",

  CreateIncidentTemplate = "CreateIncidentTemplate",
  DeleteIncidentTemplate = "DeleteIncidentTemplate",
  EditIncidentTemplate = "EditIncidentTemplate",
  ReadIncidentTemplate = "ReadIncidentTemplate",

  CreateIncidentNoteTemplate = "CreateIncidentNoteTemplate",
  DeleteIncidentNoteTemplate = "DeleteIncidentNoteTemplate",
  EditIncidentNoteTemplate = "EditIncidentNoteTemplate",
  ReadIncidentNoteTemplate = "ReadIncidentNoteTemplate",

  CreateAlertNoteTemplate = "CreateAlertNoteTemplate",
  DeleteAlertNoteTemplate = "DeleteAlertNoteTemplate",
  EditAlertNoteTemplate = "EditAlertNoteTemplate",
  ReadAlertNoteTemplate = "ReadAlertNoteTemplate",

  CreateScheduledMaintenanceNoteTemplate = "CreateScheduledMaintenanceNoteTemplate",
  DeleteScheduledMaintenanceNoteTemplate = "DeleteScheduledMaintenanceNoteTemplate",
  EditScheduledMaintenanceNoteTemplate = "EditScheduledMaintenanceNoteTemplate",
  ReadScheduledMaintenanceNoteTemplate = "ReadScheduledMaintenanceNoteTemplate",

  CreateIncidentTemplateOwnerTeam = "CreateIncidentTemplateOwnerTeam",
  DeleteIncidentTemplateOwnerTeam = "DeleteIncidentTemplateOwnerTeam",
  EditIncidentTemplateOwnerTeam = "EditIncidentTemplateOwnerTeam",
  ReadIncidentTemplateOwnerTeam = "ReadIncidentTemplateOwnerTeam",

  CreateIncidentTemplateOwnerUser = "CreateIncidentTemplateOwner",
  DeleteIncidentTemplateOwnerUser = "DeleteIncidentTemplateOwnerUser",
  EditIncidentTemplateOwnerUser = "EditIncidentTemplateOwnerUser",
  ReadIncidentTemplateOwnerUser = "ReadIncidentTemplateOwnerUser",

  CreateScheduledMaintenanceOwnerTeam = "CreateScheduledMaintenanceOwnerTeam",
  DeleteScheduledMaintenanceOwnerTeam = "DeleteScheduledMaintenanceOwnerTeam",
  EditScheduledMaintenanceOwnerTeam = "EditScheduledMaintenanceOwnerTeam",
  ReadScheduledMaintenanceOwnerTeam = "ReadScheduledMaintenanceOwnerTeam",

  CreateScheduledMaintenanceOwnerUser = "CreateScheduledMaintenanceOwnerUser",
  DeleteScheduledMaintenanceOwnerUser = "DeleteScheduledMaintenanceOwnerUser",
  EditScheduledMaintenanceOwnerUser = "EditScheduledMaintenanceOwnerUser",
  ReadScheduledMaintenanceOwnerUser = "ReadScheduledMaintenanceOwnerUser",

  CreateScheduledMaintenanceTemplateOwnerUser = "CreateScheduledMaintenanceOwnerUser",
  DeleteScheduledMaintenanceTemplateOwnerUser = "DeleteScheduledMaintenanceTemplateOwnerUser",
  EditScheduledMaintenanceTemplateOwnerUser = "EditScheduledMaintenanceTemplateOwnerUser",
  ReadScheduledMaintenanceTemplateOwnerUser = "ReadScheduledMaintenanceTemplateOwnerUser",

  CreateScheduledMaintenanceTemplateOwnerTeam = "CreateScheduledMaintenanceOwnerTeam",
  DeleteScheduledMaintenanceTemplateOwnerTeam = "DeleteScheduledMaintenanceTemplateOwnerTeam",
  EditScheduledMaintenanceTemplateOwnerTeam = "EditScheduledMaintenanceTemplateOwnerTeam",
  ReadScheduledMaintenanceTemplateOwnerTeam = "ReadScheduledMaintenanceTemplateOwnerTeam",

  CreateStatusPageOwnerTeam = "CreateStatusPageOwnerTeam",
  DeleteStatusPageOwnerTeam = "DeleteStatusPageOwnerTeam",
  EditStatusPageOwnerTeam = "EditStatusPageOwnerTeam",
  ReadStatusPageOwnerTeam = "ReadStatusPageOwnerTeam",

  CreateStatusPageOwnerUser = "CreateStatusPageOwner",
  DeleteStatusPageOwnerUser = "DeleteStatusPageOwnerUser",
  EditStatusPageOwnerUser = "EditStatusPageOwnerUser",
  ReadStatusPageOwnerUser = "ReadStatusPageOwnerUser",

  CreateServiceCatalogOwnerTeam = "CreateServiceCatalogOwnerTeam",
  DeleteServiceCatalogOwnerTeam = "DeleteServiceCatalogOwnerTeam",
  EditServiceCatalogOwnerTeam = "EditServiceCatalogOwnerTeam",
  ReadServiceCatalogOwnerTeam = "ReadServiceCatalogOwnerTeam",

  CreateServiceCatalogOwnerUser = "CreateServiceCatalogOwner",
  DeleteServiceCatalogOwnerUser = "DeleteServiceCatalogOwnerUser",
  EditServiceCatalogOwnerUser = "EditServiceCatalogOwnerUser",
  ReadServiceCatalogOwnerUser = "ReadServiceCatalogOwnerUser",

  CreateMonitorOwnerTeam = "CreateMonitorOwnerTeam",
  DeleteMonitorOwnerTeam = "DeleteMonitorOwnerTeam",
  EditMonitorOwnerTeam = "EditMonitorOwnerTeam",
  ReadMonitorOwnerTeam = "ReadMonitorOwnerTeam",

  CreateMonitorOwnerUser = "CreateMonitorOwner",
  DeleteMonitorOwnerUser = "DeleteMonitorOwnerUser",
  EditMonitorOwnerUser = "EditMonitorOwnerUser",
  ReadMonitorOwnerUser = "ReadMonitorOwnerUser",

  CreateOnCallDutyPolicyOwnerTeam = "CreateOnCallDutyPolicyOwnerTeam",
  DeleteOnCallDutyPolicyOwnerTeam = "DeleteOnCallDutyPolicyOwnerTeam",
  EditOnCallDutyPolicyOwnerTeam = "EditOnCallDutyPolicyOwnerTeam",
  ReadOnCallDutyPolicyOwnerTeam = "ReadOnCallDutyPolicyOwnerTeam",

  CreateOnCallDutyPolicyOwnerUser = "CreateOnCallDutyPolicyOwner",
  DeleteOnCallDutyPolicyOwnerUser = "DeleteOnCallDutyPolicyOwnerUser",
  EditOnCallDutyPolicyOwnerUser = "EditOnCallDutyPolicyOwnerUser",
  ReadOnCallDutyPolicyOwnerUser = "ReadOnCallDutyPolicyOwnerUser",

  CreateMonitorGroupOwnerTeam = "CreateMonitorGroupOwnerTeam",
  DeleteMonitorGroupOwnerTeam = "DeleteMonitorGroupOwnerTeam",
  EditMonitorGroupOwnerTeam = "EditMonitorGroupOwnerTeam",
  ReadMonitorGroupOwnerTeam = "ReadMonitorGroupOwnerTeam",

  CreateMonitorGroupOwnerUser = "CreateMonitorGroupOwner",
  DeleteMonitorGroupOwnerUser = "DeleteMonitorGroupOwnerUser",
  EditMonitorGroupOwnerUser = "EditMonitorGroupOwnerUser",
  ReadMonitorGroupOwnerUser = "ReadMonitorGroupOwnerUser",

  CreateStatusPageCustomField = "CreateStatusPageCustomField",
  DeleteStatusPageCustomField = "DeleteStatusPageCustomField",
  EditStatusPageCustomField = "EditStatusPageCustomField",
  ReadStatusPageCustomField = "ReadStatusPageCustomField",

  CreateIncidentCustomField = "CreateIncidentCustomField",
  DeleteIncidentCustomField = "DeleteIncidentCustomField",
  EditIncidentCustomField = "EditIncidentCustomField",
  ReadIncidentCustomField = "ReadIncidentCustomField",

  CreateAlertCustomField = "CreateAlertCustomField",
  DeleteAlertCustomField = "DeleteAlertCustomField",
  EditAlertCustomField = "EditAlertCustomField",
  ReadAlertCustomField = "ReadAlertCustomField",

  CreateProjectIncident = "CreateProjectIncident",
  DeleteProjectIncident = "DeleteProjectIncident",
  EditProjectIncident = "EditProjectIncident",
  ReadProjectIncident = "ReadProjectIncident",

  CreateAlert = "CreateAlert",
  DeleteAlert = "DeleteAlert",
  EditAlert = "EditAlert",
  ReadAlert = "ReadAlert",

  CreateScheduledMaintenanceTemplate = "CreateScheduledMaintenanceTemplate",
  DeleteScheduledMaintenanceTemplate = "DeleteScheduledMaintenanceTemplate",
  EditScheduledMaintenanceTemplate = "EditScheduledMaintenanceTemplate",
  ReadScheduledMaintenanceTemplate = "ReadScheduledMaintenanceTemplate",

  CreateStatusPageSubscriber = "CreateStatusPageSubscriber",
  DeleteStatusPageSubscriber = "DeleteStatusPageSubscriber",
  EditStatusPageSubscriber = "EditStatusPageSubscriber",
  ReadStatusPageSubscriber = "ReadStatusPageSubscriber",

  CreateStatusPagePrivateUser = "CreateStatusPagePrivateUser",
  DeleteStatusPagePrivateUser = "DeleteStatusPagePrivateUser",
  EditStatusPagePrivateUser = "EditStatusPagePrivateUser",
  ReadStatusPagePrivateUser = "ReadStatusPagePrivateUser",

  CreateProjectDomain = "CreateProjectDomain",
  DeleteProjectDomain = "DeleteProjectDomain",
  EditProjectDomain = "EditProjectDomain",
  ReadProjectDomain = "ReadProjectDomain",

  CreateStatusPageHeaderLink = "CreateStatusPageHeaderLink",
  DeleteStatusPageHeaderLink = "DeleteStatusPageHeaderLink",
  EditStatusPageHeaderLink = "EditStatusPageHeaderLink",
  ReadStatusPageHeaderLink = "ReadStatusPageHeaderLink",

  CreateStatusPageFooterLink = "CreateStatusPageFooterLink",
  DeleteStatusPageFooterLink = "DeleteStatusPageFooterLink",
  EditStatusPageFooterLink = "EditStatusPageFooterLink",
  ReadStatusPageFooterLink = "ReadStatusPageFooterLink",

  CreateStatusPageResource = "CreateStatusPageResource",
  DeleteStatusPageResource = "DeleteStatusPageResource",
  EditStatusPageResource = "EditStatusPageResource",
  ReadStatusPageResource = "ReadStatusPageResource",

  CreateStatusPageHistoryChartBarColorRule = "CreateStatusPageHistoryChartBarColorRule",
  DeleteStatusPageHistoryChartBarColorRule = "DeleteStatusPageHistoryChartBarColorRule",
  EditStatusPageHistoryChartBarColorRule = "EditStatusPageHistoryChartBarColorRule",
  ReadStatusPageHistoryChartBarColorRule = "ReadStatusPageHistoryChartBarColorRule",

  CreateWorkflow = "CreateWorkflow",
  DeleteWorkflow = "DeleteWorkflow",
  EditWorkflow = "EditWorkflow",
  ReadWorkflow = "ReadWorkflow",

  DeleteProject = "DeleteProject",
  EditProject = "EditProject",
  ReadProject = "ReadProject",

  CreateWorkflowLog = "CreateWorkflowLog",
  DeleteWorkflowLog = "DeleteWorkflowLog",
  EditWorkflowLog = "EditWorkflowLog",
  ReadWorkflowLog = "ReadWorkflowLog",

  CreateWorkflowVariable = "CreateWorkflowVariable",
  DeleteWorkflowVariable = "DeleteWorkflowVariable",
  EditWorkflowVariable = "EditWorkflowVariable",
  ReadWorkflowVariable = "ReadWorkflowVariable",

  CreateStatusPageGroup = "CreateStatusPageGroup",
  DeleteStatusPageGroup = "DeleteStatusPageGroup",
  EditStatusPageGroup = "EditStatusPageGroup",
  ReadStatusPageGroup = "ReadStatusPageGroup",

  CreateStatusPageDomain = "CreateStatusPageDomain",
  DeleteStatusPageDomain = "DeleteStatusPageDomain",
  EditStatusPageDomain = "EditStatusPageDomain",
  ReadStatusPageDomain = "ReadStatusPageDomain",

  CreateMonitorGroup = "CreateMonitorGroup",
  DeleteMonitorGroup = "DeleteMonitorGroup",
  EditMonitorGroup = "EditMonitorGroup",
  ReadMonitorGroup = "ReadMonitorGroup",

  CreateProjectSSO = "CreateProjectSSO",
  DeleteProjectSSO = "DeleteProjectSSO",
  EditProjectSSO = "EditProjectSSO",
  ReadProjectSSO = "ReadProjectSSO",

  CreateStatusPageSSO = "CreateStatusPageSSO",
  DeleteStatusPageSSO = "DeleteStatusPageSSO",
  EditStatusPageSSO = "EditStatusPageSSO",
  ReadStatusPageSSO = "ReadStatusPageSSO",

  // Label Permissions (Owner + Admin Permission by default)
  CreateProjectLabel = "CreateProjectLabel",
  EditProjectLabel = "EditProjectLabel",
  ReadProjectLabel = "ReadProjectLabel",
  DeleteProjectLabel = "DeleteProjectLabel",
  AddLabelsToProjectResources = "AddLabelsToProjectResources",

  // Scheduled Maintenance

  // Scheduled Maintenance Status Permissions (Owner + Admin Permission by default)
  CreateScheduledMaintenanceState = "CreateScheduledMaintenanceState",
  EditScheduledMaintenanceState = "EditScheduledMaintenanceState",
  ReadScheduledMaintenanceState = "ReadScheduledMaintenanceState",
  DeleteScheduledMaintenanceState = "DeleteScheduledMaintenanceState",

  // Scheduled Maintenance Status Permissions (Owner + Admin Permission by default)
  CreateScheduledMaintenanceStateTimeline = "CreateScheduledMaintenanceStateTimeline",
  EditScheduledMaintenanceStateTimeline = "EditScheduledMaintenanceStateTimeline",
  ReadScheduledMaintenanceStateTimeline = "ReadScheduledMaintenanceStateTimeline",
  DeleteScheduledMaintenanceStateTimeline = "DeleteScheduledMaintenanceStateTimeline",

  // Resource Permissions (Team Permission)
  CreateScheduledMaintenanceInternalNote = "CreateScheduledMaintenanceInternalNote",
  EditScheduledMaintenanceInternalNote = "EditScheduledMaintenanceInternalNote",
  DeleteScheduledMaintenanceInternalNote = "DeleteScheduledMaintenanceInternalNote",
  ReadScheduledMaintenanceInternalNote = "ReadScheduledMaintenanceInternalNote",

  CreateScheduledMaintenancePublicNote = "CreateScheduledMaintenancePublicNote",
  EditScheduledMaintenancePublicNote = "EditScheduledMaintenancePublicNote",
  DeleteScheduledMaintenancePublicNote = "DeleteScheduledMaintenancePublicNote",
  ReadScheduledMaintenancePublicNote = "ReadScheduledMaintenancePublicNote",

  CreateProjectScheduledMaintenance = "CreateProjectScheduledMaintenance",
  DeleteProjectScheduledMaintenance = "DeleteProjectScheduledMaintenance",
  EditProjectScheduledMaintenance = "EditProjectScheduledMaintenance",
  ReadProjectScheduledMaintenance = "ReadProjectScheduledMaintenance",

  // Incident Status Permissions (Owner + Admin Permission by default)
  CreateIncidentState = "CreateIncidentState",
  EditIncidentState = "EditIncidentState",
  ReadIncidentState = "ReadIncidentState",
  DeleteIncidentState = "DeleteIncidentState",

  CreateAlertState = "CreateAlertState",
  EditAlertState = "EditAlertState",
  ReadAlertState = "ReadAlertState",
  DeleteAlertState = "DeleteAlertState",

  // Incident Status Permissions (Owner + Admin Permission by default)
  CreateAlertStateTimeline = "CreateAlertStateTimeline",
  EditAlertStateTimeline = "EditAlertStateTimeline",
  ReadAlertStateTimeline = "ReadAlertStateTimeline",
  DeleteAlertStateTimeline = "DeleteAlertStateTimeline",

  // Incident Status Permissions (Owner + Admin Permission by default)
  CreateIncidentStateTimeline = "CreateIncidentStateTimeline",
  EditIncidentStateTimeline = "EditIncidentStateTimeline",
  ReadIncidentStateTimeline = "ReadIncidentStateTimeline",
  DeleteIncidentStateTimeline = "DeleteIncidentStateTimeline",

  CreateIncidentFeed = "CreateIncidentFeed",
  EditIncidentFeed = "EditIncidentFeed",
  ReadIncidentFeed = "ReadIncidentFeed",

  CreateOnCallDutyPolicyFeed = "CreateOnCallDutyPolicyFeed",
  EditOnCallDutyPolicyFeed = "EditOnCallDutyPolicyFeed",
  ReadOnCallDutyPolicyFeed = "ReadOnCallDutyPolicyFeed",

  CreateMonitorFeed = "CreateMonitorFeed",
  EditMonitorFeed = "EditMonitorFeed",
  ReadMonitorFeed = "ReadMonitorFeed",

  CreateScheduledMaintenanceFeed = "CreateScheduledMaintenanceFeed",
  EditScheduledMaintenanceFeed = "EditScheduledMaintenanceFeed",
  ReadScheduledMaintenanceFeed = "ReadScheduledMaintenanceFeed",

  CreateAlertFeed = "CreateAlertFeed",
  EditAlertFeed = "EditAlertFeed",
  ReadAlertFeed = "ReadAlertFeed",

  // Incident Status Permissions (Owner + Admin Permission by default)
  CreateMonitorStatusTimeline = "CreateMonitorStatusTimeline",
  EditMonitorStatusTimeline = "EditMonitorStatusTimeline",
  ReadMonitorStatusTimeline = "ReadMonitorStatusTimeline",
  DeleteMonitorStatusTimeline = "DeleteMonitorStatusTimeline",

  // MonitorStatus Permissions (Owner + Admin Permission by default)
  CreateProjectMonitorStatus = "CreateProjectMonitorStatus",
  EditProjectMonitorStatus = "EditProjectMonitorStatus",
  ReadProjectMonitorStatus = "ReadProjectMonitorStatus",
  DeleteProjectMonitorStatus = "DeleteProjectMonitorStatus",

  // MonitorStatus Permissions (Owner + Admin Permission by default)
  CreateStatusPageAnnouncement = "CreateStatusPageAnnouncement",
  EditStatusPageAnnouncement = "EditStatusPageAnnouncement",
  ReadStatusPageAnnouncement = "ReadStatusPageAnnouncement",
  DeleteStatusPageAnnouncement = "DeleteStatusPageAnnouncement",

  // Status Page Announcement Template Permissions (Owner + Admin Permission by default)
  CreateStatusPageAnnouncementTemplate = "CreateStatusPageAnnouncementTemplate",
  EditStatusPageAnnouncementTemplate = "EditStatusPageAnnouncementTemplate",
  ReadStatusPageAnnouncementTemplate = "ReadStatusPageAnnouncementTemplate",
  DeleteStatusPageAnnouncementTemplate = "DeleteStatusPageAnnouncementTemplate",

  // Status Page Subscriber Notification Template Permissions (Owner + Admin Permission by default)
  CreateStatusPageSubscriberNotificationTemplate = "CreateStatusPageSubscriberNotificationTemplate",
  EditStatusPageSubscriberNotificationTemplate = "EditStatusPageSubscriberNotificationTemplate",
  ReadStatusPageSubscriberNotificationTemplate = "ReadStatusPageSubscriberNotificationTemplate",
  DeleteStatusPageSubscriberNotificationTemplate = "DeleteStatusPageSubscriberNotificationTemplate",

  // Status Page Subscriber Notification Template Status Page Permissions (Owner + Admin Permission by default)
  CreateStatusPageSubscriberNotificationTemplateStatusPage = "CreateStatusPageSubscriberNotificationTemplateStatusPage",
  EditStatusPageSubscriberNotificationTemplateStatusPage = "EditStatusPageSubscriberNotificationTemplateStatusPage",
  ReadStatusPageSubscriberNotificationTemplateStatusPage = "ReadStatusPageSubscriberNotificationTemplateStatusPage",
  DeleteStatusPageSubscriberNotificationTemplateStatusPage = "DeleteStatusPageSubscriberNotificationTemplateStatusPage",

  // Resource Permissions (Team Permission)
  CreateIncidentInternalNote = "CreateIncidentInternalNote",
  EditIncidentInternalNote = "EditIncidentInternalNote",
  DeleteIncidentInternalNote = "DeleteIncidentInternalNote",
  ReadIncidentInternalNote = "ReadIncidentInternalNote",

  CreateAlertInternalNote = "CreateAlertInternalNote",
  EditAlertInternalNote = "EditAlertInternalNote",
  DeleteAlertInternalNote = "DeleteAlertInternalNote",
  ReadAlertInternalNote = "ReadAlertInternalNote",

  CreateIncidentPublicNote = "CreateIncidentPublicNote",
  EditIncidentPublicNote = "EditIncidentPublicNote",
  DeleteIncidentPublicNote = "DeleteIncidentPublicNote",
  ReadIncidentPublicNote = "ReadIncidentPublicNote",

  CreateInvoices = "CreateInvoices",
  EditInvoices = "EditInvoices",
  DeleteInvoices = "DeleteInvoices",
  ReadInvoices = "ReadInvoices",

  CreateBillingPaymentMethod = "CreateBillingPaymentMethod",
  EditBillingPaymentMethod = "EditBillingPaymentMethod",
  DeleteBillingPaymentMethod = "DeleteBillingPaymentMethod",
  ReadBillingPaymentMethod = "ReadBillingPaymentMethod",

  CreateProjectMonitor = "CreateProjectMonitor",
  EditProjectMonitor = "EditProjectMonitor",
  DeleteProjectMonitor = "DeleteProjectMonitor",
  ReadProjectMonitor = "ReadProjectMonitor",

  // Resource Permissions (Team Permission)
  CreateProjectStatusPage = "CreateProjectStatusPage",
  EditProjectStatusPage = "EditProjectStatusPage",
  DeleteProjectStatusPage = "DeleteProjectStatusPage",
  ReadProjectStatusPage = "ReadProjectStatusPage",

  // Resource Permissions (Team Permission)
  CreateProjectOnCallDutyPolicy = "CreateProjectOnCallDutyPolicy",
  EditProjectOnCallDutyPolicy = "EditProjectOnCallDutyPolicy",
  DeleteProjectOnCallDutyPolicy = "DeleteProjectOnCallDutyPolicy",
  ReadProjectOnCallDutyPolicy = "ReadProjectOnCallDutyPolicy",

  // Resource Permissions (Team Permission)
  CreateProjectOnCallDutyPolicySchedule = "CreateProjectOnCallDutyPolicySchedule",
  EditProjectOnCallDutyPolicySchedule = "EditProjectOnCallDutyPolicySchedule",
  DeleteProjectOnCallDutyPolicySchedule = "DeleteProjectOnCallDutyPolicySchedule",
  ReadProjectOnCallDutyPolicySchedule = "ReadProjectOnCallDutyPolicySchedule",

  ReadProjectOnCallDutyPolicyExecutionLogTimeline = "ReadProjectOnCallDutyPolicyExecutionLogTimeline",
  ReadProjectOnCallDutyPolicyExecutionLog = "ReadProjectOnCallDutyPolicyExecutionLog",
  CreateProjectOnCallDutyPolicyExecutionLog = "CreateProjectOnCallDutyPolicyExecutionLog",

  // Resource Permissions (Team Permission)
  CreateProjectOnCallDutyPolicyEscalationRule = "CreateProjectOnCallDutyPolicyEscalationRule",
  EditProjectOnCallDutyPolicyEscalationRule = "EditProjectOnCallDutyPolicyEscalationRule",
  DeleteProjectOnCallDutyPolicyEscalationRule = "DeleteProjectOnCallDutyPolicyEscalationRule",
  ReadProjectOnCallDutyPolicyEscalationRule = "ReadProjectOnCallDutyPolicyEscalationRule",

  CreateOnCallDutyPolicyUserOverride = "CreateOnCallDutyPolicyUserOverride",
  EditOnCallDutyPolicyUserOverride = "EditOnCallDutyPolicyUserOverride",
  DeleteOnCallDutyPolicyUserOverride = "DeleteOnCallDutyPolicyUserOverride",
  ReadOnCallDutyPolicyUserOverride = "ReadOnCallDutyPolicyUserOverride",

  ReadOnCallDutyPolicyTimeLog = "ReadOnCallDutyPolicyTimeLog",

  // Resource Permissions (Team Permission)
  CreateProjectOnCallDutyPolicyEscalationRuleUser = "CreateProjectOnCallDutyPolicyEscalationRuleUser",
  EditProjectOnCallDutyPolicyEscalationRuleUser = "EditProjectOnCallDutyPolicyEscalationRuleUser",
  DeleteProjectOnCallDutyPolicyEscalationRuleUser = "DeleteProjectOnCallDutyPolicyEscalationRuleUser",
  ReadProjectOnCallDutyPolicyEscalationRuleUser = "ReadProjectOnCallDutyPolicyEscalationRuleUser",

  // Resource Permissions (Team Permission)
  CreateProjectOnCallDutyPolicyEscalationRuleSchedule = "CreateProjectOnCallDutyPolicyEscalationRuleSchedule",
  EditProjectOnCallDutyPolicyEscalationRuleSchedule = "EditProjectOnCallDutyPolicyEscalationRuleSchedule",
  DeleteProjectOnCallDutyPolicyEscalationRuleSchedule = "DeleteProjectOnCallDutyPolicyEscalationRuleSchedule",
  ReadProjectOnCallDutyPolicyEscalationRuleSchedule = "ReadProjectOnCallDutyPolicyEscalationRuleSchedule",

  // Monitor Secret Permissions
  CreateMonitorSecret = "CreateMonitorSecret",
  EditMonitorSecret = "EditMonitorSecret",
  DeleteMonitorSecret = "DeleteMonitorSecret",
  ReadMonitorSecret = "ReadMonitorSecret",

  CreateProjectOnCallDutyPolicyEscalationRuleTeam = "CreateProjectOnCallDutyPolicyEscalationRuleTeam",
  EditProjectOnCallDutyPolicyEscalationRuleTeam = "EditProjectOnCallDutyPolicyEscalationRuleTeam",
  DeleteProjectOnCallDutyPolicyEscalationRuleTeam = "DeleteProjectOnCallDutyPolicyEscalationRuleTeam",
  ReadProjectOnCallDutyPolicyEscalationRuleTeam = "ReadProjectOnCallDutyPolicyEscalationRuleTeam",

  // Project SMTP Config (Team Permission)
  CreateProjectSMTPConfig = "CreateProjectSMTPConfig",
  EditProjectSMTPConfig = "EditProjectSMTPConfig",
  DeleteProjectSMTPConfig = "DeleteProjectSMTPConfig",
  ReadProjectSMTPConfig = "ReadProjectSMTPConfig",

  CreateProjectCallSMSConfig = "CreateProjectCallSMSConfig",
  EditProjectCallSMSConfig = "EditProjectCallSMSConfig",
  DeleteProjectCallSMSConfig = "DeleteProjectCallSMSConfig",
  ReadProjectCallSMSConfig = "ReadProjectCallSMSConfig",

  // Project SMTP Config (Team Permission)
  CreateIncidentSeverity = "CreateIncidentSeverity",
  EditIncidentSeverity = "EditIncidentSeverity",
  DeleteIncidentSeverity = "DeleteIncidentSeverity",
  ReadIncidentSeverity = "ReadIncidentSeverity",

  CreateAlertSeverity = "CreateAlertSeverity",
  EditAlertSeverity = "EditAlertSeverity",
  DeleteAlertSeverity = "DeleteAlertSeverity",
  ReadAlertSeverity = "ReadAlertSeverity",

  CreateServiceCatalog = "CreateServiceCatalog",
  DeleteServiceCatalog = "DeleteServiceCatalog",
  EditServiceCatalog = "EditServiceCatalog",
  ReadServiceCatalog = "ReadServiceCatalog",

  CreateServiceCatlogDependency = "CreateServiceCatlogDependency",
  DeleteServiceCatlogDependency = "DeleteServiceCatlogDependency",
  EditServiceCatlogDependency = "EditServiceCatlogDependency",
  ReadServiceCatlogDependency = "ReadServiceCatlogDependency",

  CreateServiceCatalogMonitor = "CreateServiceCatalogMonitor",
  DeleteServiceCatalogMonitor = "DeleteServiceCatalogMonitor",
  EditServiceCatalogMonitor = "EditServiceCatalogMonitor",
  ReadServiceCatalogMonitor = "ReadServiceCatalogMonitor",

  CreateServiceCatalogTelemetryService = "CreateServiceCatalogTelemetryService",
  DeleteServiceCatalogTelemetryService = "DeleteServiceCatalogTelemetryService",
  EditServiceCatalogTelemetryService = "EditServiceCatalogTelemetryService",
  ReadServiceCatalogTelemetryService = "ReadServiceCatalogTelemetryService",

  CreateServiceCatalogCodeRepository = "CreateServiceCatalogCodeRepository",
  DeleteServiceCatalogCodeRepository = "DeleteServiceCatalogCodeRepository",
  EditServiceCatalogCodeRepository = "EditServiceCatalogCodeRepository",
  ReadServiceCatalogCodeRepository = "ReadServiceCatalogCodeRepository",

  // Code Repository
  CreateCodeRepository = "CreateCodeRepository",
  DeleteCodeRepository = "DeleteCodeRepository",
  EditCodeRepository = "EditCodeRepository",
  ReadCodeRepository = "ReadCodeRepository",

  CreateProbeOwnerTeam = "CreateProbeOwnerTeam",
  DeleteProbeOwnerTeam = "DeleteProbeOwnerTeam",
  EditProbeOwnerTeam = "EditProbeOwnerTeam",
  ReadProbeOwnerTeam = "ReadProbeOwnerTeam",

  CreateProbeOwnerUser = "CreateProbeOwnerUser",
  DeleteProbeOwnerUser = "DeleteProbeOwnerUser",
  EditProbeOwnerUser = "EditProbeOwnerUser",
  ReadProbeOwnerUser = "ReadProbeOwnerUser",

  CreateTableView = "CreateTableView",
  DeleteTableView = "DeleteTableView",
  EditTableView = "EditTableView",
  ReadTableView = "ReadTableView",

  CreateWorkspaceNotificationRule = "CreateWorkspaceNotificationRule",
  DeleteWorkspaceNotificationRule = "DeleteWorkspaceNotificationRule",
  EditWorkspaceNotificationRule = "EditWorkspaceNotificationRule",
  ReadWorkspaceNotificationRule = "ReadWorkspaceNotificationRule",
}

export class PermissionHelper {
  public static doesPermissionsIntersect(
    permissions1: Array<Permission>,
    permissions2: Array<Permission>,
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
    permissions2: Array<Permission>,
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
    userPermissions: Array<UserPermission>,
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
    userPermissions: Array<UserPermission>,
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
        `${permission} does not have permission props`,
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
        `${permission} does not have permission props`,
      );
    }

    return permissionProps[0].title;
  }

  public static getPermissionTitles(
    permissions: Array<Permission>,
  ): Array<string> {
    const props: Array<PermissionProps> = this.getAllPermissionProps();
    const titles: Array<string> = [];

    for (const permission of permissions) {
      const permissionProp: PermissionProps | undefined = props.find(
        (item: PermissionProps) => {
          return item.permission === permission;
        },
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
        title: "Project Owner",
        description:
          "Owner of this project. Manages billing, inviting other admins to this project, and can delete this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ProjectMember,
        title: "Project Member",
        description:
          "Member of this project. Can view most resources unless restricted.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ProjectAdmin,
        title: "Project Admin",
        description:
          "Admin of this project. Manages team members in this project, however cannot manage billing or delete this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ProjectUser,
        title: "Project User",
        description: "User of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.CurrentUser,
        title: "Logged in User",
        description: "This permission is assigned to any registered user.",
        isAssignableToTenant: false,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.CustomerSupport,
        title: "Customer Support",
        description: "Customer Support Resource of OneUptime.",
        isAssignableToTenant: false,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.User,
        title: "User",
        description:
          "Owner of this project, manages billing, inviting other admins to this project, and can delete this project.",
        isAssignableToTenant: false,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.Public,
        title: "Public",
        description:
          "Non registered user. Typically used for sign up or log in.",
        isAssignableToTenant: false,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.ManageProjectBilling,
        title: "Manage Billing",
        description: "This permission can update project billing.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.CreateProjectApiKey,
        title: "Create API Key",
        description: "This permission can create api keys of this project",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteProjectApiKey,
        title: "Delete API Key",
        description: "This permission can delete api keys of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditProjectApiKeyPermissions,
        title: "Edit API Key Permissions",
        description:
          "This permission can edit api key permissions of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditProjectApiKey,
        title: "Edit API Key",
        description: "This permission can edit api keys of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadProjectApiKey,
        title: "Read API Key",
        description: "This permission can read api keys of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateTelemetryIngestionKey,
        title: "Create Telemetry Ingestion Key",
        description:
          "This permission can create Telemetry Ingestion Keys of this project",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteTelemetryIngestionKey,
        title: "Delete Telemetry Ingestion Key",
        description:
          "This permission can delete Telemetry Ingestion Keys of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditTelemetryIngestionKey,
        title: "Edit Telemetry Ingestion Key",
        description:
          "This permission can edit Telemetry Ingestion Keys of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadTelemetryIngestionKey,
        title: "Read Telemetry Ingestion Key",
        description:
          "This permission can read Telemetry Ingestion Keys of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      // Dashboards.

      {
        permission: Permission.CreateDashboard,
        title: "Create Dashboard",
        description: "This permission can create Dashboards of this project",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
      },
      {
        permission: Permission.DeleteDashboard,
        title: "Delete Dashboard",
        description: "This permission can delete Dashboard of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
      },
      {
        permission: Permission.EditDashboard,
        title: "Edit Dashboard",
        description: "This permission can edit Dashboards of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
      },
      {
        permission: Permission.ReadDashboard,
        title: "Read Dashboard",
        description: "This permission can read Dashboards of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
      },

      // Table view permissions

      {
        permission: Permission.CreateTableView,
        title: "Create Table View",
        description: "This permission can create table views of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteTableView,
        title: "Delete Table View",
        description: "This permission can delete table views of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditTableView,
        title: "Edit Table View",
        description: "This permission can edit table views of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadTableView,
        title: "Read Table View",
        description: "This permission can read table views of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateProjectLabel,
        title: "Create Label",
        description: "This permission can create labels this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteProjectLabel,
        title: "Delete Label",
        description: "This permission can delete labels of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.AddLabelsToProjectResources,
        title: "Add Label to Resources",
        description:
          "This permission can add project labels to resources of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditProjectLabel,
        title: "Edit Label",
        description: "This permission can edit labels of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadProjectLabel,
        title: "Read Label",
        description: "This permission can read labels of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateIncidentState,
        title: "Create Incident State",
        description: "This permission can create incident states this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteIncidentState,
        title: "Delete Incident State",
        description:
          "This permission can delete incident states of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditIncidentState,
        title: "Edit Incident State",
        description:
          "This permission can edit incident states of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadIncidentState,
        title: "Read Incident State",
        description:
          "This permission can read incident states of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateAlertState,
        title: "Create Alert State",
        description: "This permission can create alert states this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteAlertState,
        title: "Delete Alert State",
        description: "This permission can delete alert states of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditAlertState,
        title: "Edit Alert State",
        description: "This permission can edit alert states of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadAlertState,
        title: "Read Alert State",
        description: "This permission can read alert states of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateWorkspaceNotificationRule,
        title: "Create Workspace Notification Rule",
        description: "This permission can create alert states this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteWorkspaceNotificationRule,
        title: "Delete Workspace Notification Rule",
        description: "This permission can delete alert states of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditWorkspaceNotificationRule,
        title: "Edit Workspace Notification Rule",
        description: "This permission can edit alert states of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadWorkspaceNotificationRule,
        title: "Read Workspace Notification Rule",
        description: "This permission can read alert states of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateIncidentStateTimeline,
        title: "Create Incident State Timeline",
        description:
          "This permission can create incident state history of an incident in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteIncidentStateTimeline,
        title: "Delete Incident State Timeline",
        description:
          "This permission can delete incident state history of an incident in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditIncidentStateTimeline,
        title: "Edit Incident State Timeline",
        description:
          "This permission can edit incident state history of an incident in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadIncidentStateTimeline,
        title: "Read Incident State Timeline",
        description:
          "This permission can read incident state history of an incident in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateMonitorFeed,
        title: "Create Monitor Feed",
        description:
          "This permission can create log of an monitor in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditMonitorFeed,
        title: "Edit Monitor Feed",
        description:
          "This permission can edit log of an monitor in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadMonitorFeed,
        title: "Read Monitor Feed",
        description:
          "This permission can read log of an monitor in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateIncidentFeed,
        title: "Create Incident Feed",
        description:
          "This permission can create log of an incident in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditIncidentFeed,
        title: "Edit Incident Feed",
        description:
          "This permission can edit log of an incident in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadIncidentFeed,
        title: "Read Incident Feed",
        description:
          "This permission can read log of an incident in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateOnCallDutyPolicyFeed,
        title: "Create On Call Duty Policy Feed",
        description:
          "This permission can create log of an on-call policy in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditOnCallDutyPolicyFeed,
        title: "Edit On Call Duty Policy Feed",
        description:
          "This permission can edit log of an on-call policy in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadOnCallDutyPolicyFeed,
        title: "Read On Call Duty Policy Feed",
        description:
          "This permission can read log of an on-call policy in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateAlertFeed,
        title: "Create Alert Feed",
        description:
          "This permission can create log of an alert in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditAlertFeed,
        title: "Edit Alert Feed",
        description:
          "This permission can edit log of an alert in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadAlertFeed,
        title: "Read Alert Feed",
        description:
          "This permission can read log of an alert in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateScheduledMaintenanceFeed,
        title: "Create Scheduled Maintenance Log",
        description:
          "This permission can create log of a scheduled maintenance in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditScheduledMaintenanceFeed,
        title: "Edit Scheduled Maintenance Log",
        description:
          "This permission can edit log of an scheduled maintenance in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadScheduledMaintenanceFeed,
        title: "Read Scheduled Maintenance Log",
        description:
          "This permission can read log of an scheduled maintenance in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateAlertStateTimeline,
        title: "Create Alert State Timeline",
        description:
          "This permission can create alert state history of an alert in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteAlertStateTimeline,
        title: "Delete Alert State Timeline",
        description:
          "This permission can delete alert state history of an alert in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditAlertStateTimeline,
        title: "Edit  Alert State  Timeline",
        description:
          "This permission can edit incident alert history of an alert in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadAlertStateTimeline,
        title: "Read Alert State Timeline",
        description:
          "This permission can read alert state history of an alert in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateMonitorStatusTimeline,
        title: "Create Monitor Status Timeline",
        description:
          "This permission can create Monitor Status history of an incident in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteMonitorStatusTimeline,
        title: "Delete Monitor Status Timeline",
        description:
          "This permission can delete Monitor Status history of an incident in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditMonitorStatusTimeline,
        title: "Edit Monitor Status Timeline",
        description:
          "This permission can edit Monitor Status history of an incident in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadMonitorStatusTimeline,
        title: "Read Monitor Status Timeline",
        description:
          "This permission can read Monitor Status history of an incident in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.ReadEmailLog,
        title: "Read Email Log",
        description: "This permission can read email logs of the project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateProjectMonitorStatus,
        title: "Create Monitor Status",
        description:
          "This permission can create monitor statuses this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteProjectMonitorStatus,
        title: "Delete Monitor Status",
        description:
          "This permission can delete monitor statuses of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditProjectMonitorStatus,
        title: "Edit Monitor Status",
        description:
          "This permission can edit monitor statuses of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadProjectMonitorStatus,
        title: "Read Monitor Status",
        description:
          "This permission can read monitor statuses of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateStatusPageAnnouncement,
        title: "Create Status Page Announcement",
        description:
          "This permission can create Status Page Announcement this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteStatusPageAnnouncement,
        title: "Delete Status Page Announcement",
        description:
          "This permission can delete Status Page Announcement of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditStatusPageAnnouncement,
        title: "Edit Status Page Announcement",
        description:
          "This permission can edit Status Page Announcement of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadStatusPageAnnouncement,
        title: "Read Status Page Announcement",
        description:
          "This permission can read Status Page Announcement of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateStatusPageAnnouncementTemplate,
        title: "Create Status Page Announcement Template",
        description:
          "This permission can create Status Page Announcement Templates in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteStatusPageAnnouncementTemplate,
        title: "Delete Status Page Announcement Template",
        description:
          "This permission can delete Status Page Announcement Templates of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditStatusPageAnnouncementTemplate,
        title: "Edit Status Page Announcement Template",
        description:
          "This permission can edit Status Page Announcement Templates of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadStatusPageAnnouncementTemplate,
        title: "Read Status Page Announcement Template",
        description:
          "This permission can read Status Page Announcement Templates of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateStatusPageAnnouncement,
        title: "Create Status Page Announcement",
        description:
          "This permission can create Status Page Announcements in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteStatusPageAnnouncement,
        title: "Delete Status Page Announcement",
        description:
          "This permission can delete Status Page Announcements of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditStatusPageAnnouncement,
        title: "Edit Status Page Announcement",
        description:
          "This permission can edit Status Page Announcements of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadStatusPageAnnouncement,
        title: "Read Status Page Announcement",
        description:
          "This permission can read Status Page Announcements of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateStatusPageAnnouncementTemplate,
        title: "Create Status Page Announcement Template",
        description:
          "This permission can create Status Page Announcement Templates in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteStatusPageAnnouncementTemplate,
        title: "Delete Status Page Announcement Template",
        description:
          "This permission can delete Status Page Announcement Templates of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditStatusPageAnnouncementTemplate,
        title: "Edit Status Page Announcement Template",
        description:
          "This permission can edit Status Page Announcement Templates of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadStatusPageAnnouncementTemplate,
        title: "Read Status Page Announcement Template",
        description:
          "This permission can read Status Page Announcement Templates of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateStatusPageSubscriberNotificationTemplate,
        title: "Create Status Page Subscriber Notification Template",
        description:
          "This permission can create Status Page Subscriber Notification Templates in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteStatusPageSubscriberNotificationTemplate,
        title: "Delete Status Page Subscriber Notification Template",
        description:
          "This permission can delete Status Page Subscriber Notification Templates of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditStatusPageSubscriberNotificationTemplate,
        title: "Edit Status Page Subscriber Notification Template",
        description:
          "This permission can edit Status Page Subscriber Notification Templates of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadStatusPageSubscriberNotificationTemplate,
        title: "Read Status Page Subscriber Notification Template",
        description:
          "This permission can read Status Page Subscriber Notification Templates of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission:
          Permission.CreateStatusPageSubscriberNotificationTemplateStatusPage,
        title: "Create Status Page Subscriber Notification Template Link",
        description:
          "This permission can create Status Page Subscriber Notification Template Links in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission:
          Permission.DeleteStatusPageSubscriberNotificationTemplateStatusPage,
        title: "Delete Status Page Subscriber Notification Template Link",
        description:
          "This permission can delete Status Page Subscriber Notification Template Links of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission:
          Permission.EditStatusPageSubscriberNotificationTemplateStatusPage,
        title: "Edit Status Page Subscriber Notification Template Link",
        description:
          "This permission can edit Status Page Subscriber Notification Template Links of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission:
          Permission.ReadStatusPageSubscriberNotificationTemplateStatusPage,
        title: "Read Status Page Subscriber Notification Template Link",
        description:
          "This permission can read Status Page Subscriber Notification Template Links of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateProjectDomain,
        title: "Create Domain",
        description: "This permission can create Domain in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteProjectDomain,
        title: "Delete Domain",
        description: "This permission can delete Domain in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditProjectDomain,
        title: "Edit Domain",
        description: "This permission can edit Domain in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadProjectDomain,
        title: "Read Domain",
        description: "This permission can read Domain in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateStatusPageHeaderLink,
        title: "Create Header Link",
        description: "This permission can create Header Link in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteStatusPageHeaderLink,
        title: "Delete Header Link",
        description: "This permission can delete Header Link in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditStatusPageHeaderLink,
        title: "Edit Header Link",
        description: "This permission can edit Header Link in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadStatusPageHeaderLink,
        title: "Read Header Link",
        description: "This permission can read Header Link in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateStatusPageFooterLink,
        title: "Create Footer Link",
        description: "This permission can create Footer Link in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteStatusPageFooterLink,
        title: "Delete Footer Link",
        description: "This permission can delete Footer Link in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditStatusPageFooterLink,
        title: "Edit Footer Link",
        description: "This permission can edit Footer Link in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadStatusPageFooterLink,
        title: "Read Footer Link",
        description: "This permission can read Footer Link in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateStatusPageResource,
        title: "Create Status Page Resource",
        description:
          "This permission can create Status Page Resource in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteStatusPageResource,
        title: "Delete Status Page Resource",
        description:
          "This permission can delete Status Page Resource in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditStatusPageResource,
        title: "Edit Status Page Resource",
        description:
          "This permission can edit Status Page Resource in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadStatusPageResource,
        title: "Read Status Page Resource",
        description:
          "This permission can read Status Page Resource in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateStatusPageHistoryChartBarColorRule,
        title: "Create Status Page History Chart Bar Color Rule",
        description:
          "This permission can create Status Page History Chart Bar Color Rule in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteStatusPageHistoryChartBarColorRule,
        title: "Delete Status Page History Chart Bar Color Rule",
        description:
          "This permission can delete Status Page History Chart Bar Color Rule in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditStatusPageHistoryChartBarColorRule,
        title: "Edit Status Page History Chart Bar Color Rule",
        description:
          "This permission can edit Status Page History Chart Bar Color Rule in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadStatusPageHistoryChartBarColorRule,
        title: "Read Status Page History Chart Bar Color Rule",
        description:
          "This permission can read Status Page History Chart Bar Color Rule in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateWorkflow,
        title: "Create Workflow",
        description: "This permission can create Workflow in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteWorkflow,
        title: "Delete Workflow",
        description: "This permission can delete Workflow in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
      },
      {
        permission: Permission.EditWorkflow,
        title: "Edit Workflow",
        description: "This permission can edit Workflow in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
      },
      {
        permission: Permission.ReadWorkflow,
        title: "Read Workflow",
        description: "This permission can read Workflow in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
      },

      {
        permission: Permission.DeleteProject,
        title: "Delete Project",
        description: "This permission can delete Project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditProject,
        title: "Edit Project",
        description: "This permission can edit Project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadProject,
        title: "Read Project",
        description: "This permission can read this Project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateWorkflowVariable,
        title: "Create Workflow Variables",
        description:
          "This permission can create Workflow Variables in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteWorkflowVariable,
        title: "Delete Workflow Variables",
        description:
          "This permission can delete Workflow Variables in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditWorkflowVariable,
        title: "Edit Workflow Variables",
        description:
          "This permission can edit Workflow Variables in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadWorkflowVariable,
        title: "Read Workflow Variables",
        description:
          "This permission can read Workflow Variables in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateWorkflowLog,
        title: "Create Workflow Log",
        description: "This permission can create Workflow Log in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteWorkflowLog,
        title: "Delete Workflow Log",
        description: "This permission can delete Workflow Log in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditWorkflowLog,
        title: "Edit Workflow Log",
        description: "This permission can edit Workflow Log in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadWorkflowLog,
        title: "Read Workflow Log",
        description: "This permission can read Workflow Log in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateStatusPageGroup,
        title: "Create Status Page Group",
        description:
          "This permission can create Status Page Group in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteStatusPageGroup,
        title: "Delete Status Page Group",
        description:
          "This permission can delete Status Page Group in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditStatusPageGroup,
        title: "Edit Status Page Group",
        description:
          "This permission can edit Status Page Group in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadStatusPageGroup,
        title: "Read Status Page Group",
        description:
          "This permission can read Status Page Group in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateStatusPageDomain,
        title: "Create Status Page Domain",
        description:
          "This permission can create Status Page Domain in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteStatusPageDomain,
        title: "Delete Status Page Domain",
        description:
          "This permission can delete Status Page Domain in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditStatusPageDomain,
        title: "Edit Status Page Domain",
        description:
          "This permission can edit Status Page Domain in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadStatusPageDomain,
        title: "Read Status Page Domain",
        description:
          "This permission can read Status Page Domain in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateMonitorGroup,
        title: "Create Monitor Group",
        description:
          "This permission can create Monitor Group in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteMonitorGroup,
        title: "Delete Monitor Group",
        description:
          "This permission can delete Monitor Group in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
      },
      {
        permission: Permission.EditMonitorGroup,
        title: "Edit Monitor Group",
        description: "This permission can edit Monitor Group in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
      },
      {
        permission: Permission.ReadMonitorGroup,
        title: "Read Monitor Group",
        description: "This permission can read Monitor Group in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
      },

      {
        permission: Permission.CreateProjectSSO,
        title: "Create Project SSO",
        description: "This permission can create Project SSO in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteProjectSSO,
        title: "Delete Project SSO",
        description: "This permission can delete Project SSO in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditProjectSSO,
        title: "Edit Project SSO",
        description: "This permission can edit Project SSO in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadProjectSSO,
        title: "Read Project SSO",
        description: "This permission can read Project SSO in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateStatusPageSSO,
        title: "Create Status Page SSO",
        description:
          "This permission can create Status Page SSO in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteStatusPageSSO,
        title: "Delete Status Page SSO",
        description:
          "This permission can delete Status Page SSO in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditStatusPageSSO,
        title: "Edit Status Page SSO",
        description:
          "This permission can edit Status Page SSO in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadStatusPageSSO,
        title: "Read Status Page SSO",
        description:
          "This permission can read Status Page SSO in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateProjectSMTPConfig,
        title: "Create SMTP Config",
        description: "This permission can create SMTP configs this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteProjectSMTPConfig,
        title: "Delete SMTP Config",
        description: "This permission can delete SMTP configs of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditProjectSMTPConfig,
        title: "Edit SMTP Config",
        description: "This permission can edit SMTP configs of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadProjectSMTPConfig,
        title: "Read SMTP Config",
        description: "This permission can read SMTP configs of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateProjectCallSMSConfig,
        title: "Create Call and SMS",
        description: "This permission can create Call and SMS this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteProjectCallSMSConfig,
        title: "Delete Call and SMS",
        description: "This permission can delete Call and SMS of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditProjectCallSMSConfig,
        title: "Edit Call and SMS",
        description: "This permission can edit Call and SMS of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadProjectCallSMSConfig,
        title: "Read Call and SMS",
        description: "This permission can read Call and SMS of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateStatusPageDomain,
        title: "Create Status Page Domain",
        description:
          "This permission can create Status Page Domain in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteStatusPageDomain,
        title: "Delete Status Page Domain",
        description:
          "This permission can delete Status Page Domain in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditStatusPageDomain,
        title: "Edit Status Page Domain",
        description:
          "This permission can edit Status Page Domain in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadStatusPageDomain,
        title: "Read Status Page Domain",
        description:
          "This permission can read Status Page Domain in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateIncidentSeverity,
        title: "Create Incident Severity",
        description:
          "This permission can create Incident Severity this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteIncidentSeverity,
        title: "Delete Incident Severity",
        description:
          "This permission can delete Incident Severity of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditIncidentSeverity,
        title: "Edit Incident Severity",
        description:
          "This permission can edit Incident Severity of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadIncidentSeverity,
        title: "Read Incident Severity",
        description:
          "This permission can read Incident Severity of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateAlertSeverity,
        title: "Create Alert Severity",
        description: "This permission can create Alert Severity this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteAlertSeverity,
        title: "Delete Alert Severity",
        description:
          "This permission can delete Alert Severity of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditAlertSeverity,
        title: "Edit Alert Severity",
        description: "This permission can edit Alert Severity of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadAlertSeverity,
        title: "Read Alert Severity",
        description: "This permission can read Alert Severity of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateProjectTeam,
        title: "Create Team",
        description: "This permission can create teams this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteProjectTeam,
        title: "Delete Team",
        description: "This permission can delete teams of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.InviteProjectTeamMembers,
        title: "Invite New Members",
        description: "This permission can invite users to the team.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditProjectTeamPermissions,
        title: "Edit Team Permissions",
        description:
          "This permission can edit team permissions of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditProjectTeam,
        title: "Edit Team",
        description: "This permission can edit teams of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadProjectTeam,
        title: "Read Teams",
        description: "This permission can read teams of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateProjectMonitor,
        title: "Create Monitor",
        description: "This permission can create monitor this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteProjectMonitor,
        title: "Delete Monitor",
        description: "This permission can delete monitor of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
      },
      {
        permission: Permission.EditProjectMonitor,
        title: "Edit Monitor",
        description: "This permission can edit monitor of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
      },
      {
        permission: Permission.ReadProjectMonitor,
        title: "Read Monitor",
        description: "This permission can read monitor of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
      },

      {
        permission: Permission.CreateIncidentInternalNote,
        title: "Create Incident Internal Note",
        description:
          "This permission can create Incident Internal Note this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteIncidentInternalNote,
        title: "Delete Incident Internal Note",
        description:
          "This permission can delete Incident Internal Note of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditIncidentInternalNote,
        title: "Edit Incident Internal Note",
        description:
          "This permission can edit Incident Internal Note of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadIncidentInternalNote,
        title: "Read Incident Internal Note",
        description:
          "This permission can read Incident Internal Note of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateAlertInternalNote,
        title: "Create Alert Internal Note",
        description:
          "This permission can create Alert Internal Note this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteAlertInternalNote,
        title: "Delete Alert Internal Note",
        description:
          "This permission can delete Alert Internal Note of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditAlertInternalNote,
        title: "Edit Alert Internal Note",
        description:
          "This permission can edit Alert Internal Note of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadAlertInternalNote,
        title: "Read Alert Internal Note",
        description:
          "This permission can read Alert Internal Note of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateIncidentPublicNote,
        title: "Create Incident Status Page Note",
        description:
          "This permission can create Incident Status Page Note this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteIncidentPublicNote,
        title: "Delete Incident Status Page Note",
        description:
          "This permission can delete Incident Status Page Note of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditIncidentPublicNote,
        title: "Edit Incident Status Page Note",
        description:
          "This permission can edit Incident Status Page Note of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadIncidentPublicNote,
        title: "Read Incident Status Page Note",
        description:
          "This permission can read Incident Status Page Note of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateInvoices,
        title: "Create Invoices",
        description: "This permission can create Invoices this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteInvoices,
        title: "Delete Invoices",
        description: "This permission can delete Invoices of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditInvoices,
        title: "Edit Invoices",
        description: "This permission can edit Invoices of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadInvoices,
        title: "Read Invoices",
        description: "This permission can read Invoices of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateBillingPaymentMethod,
        title: "Create Payment Method",
        description: "This permission can create Payment Method this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteBillingPaymentMethod,
        title: "Delete Payment Method",
        description:
          "This permission can delete Payment Method of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditBillingPaymentMethod,
        title: "Edit Payment Method",
        description: "This permission can edit Payment Method of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadBillingPaymentMethod,
        title: "Read Payment Method",
        description: "This permission can read Payment Method of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.ReadProjectOnCallDutyPolicyExecutionLogTimeline,
        title: "Read On-Call Duty Policy Execution Log Timeline",
        description:
          "This permission can read teams in on-call duty execution log timeline.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.ReadProjectOnCallDutyPolicyExecutionLog,
        title: "Read On-Call Duty Policy Execution Log",
        description: "This permission can read on-call duty execution log.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.CreateProjectOnCallDutyPolicyExecutionLog,
        title: "Create On-Call Duty Policy Execution Log",
        description: "This permission can create on-call duty execution log.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateProjectOnCallDutyPolicyEscalationRuleTeam,
        title: "Create On-Call Duty Policy Escalation Rule",
        description:
          "This permission can create teams in on-call duty escalation rule this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteProjectOnCallDutyPolicyEscalationRuleTeam,
        title: "Delete On-Call Duty Policy Escalation Rule Team",
        description:
          "This permission can delete teams in on-call duty escalation rule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditProjectOnCallDutyPolicyEscalationRuleTeam,
        title: "Edit On-Call Duty Policy Escalation Rule Team",
        description:
          "This permission can edit teams in on-call duty escalation rule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadProjectOnCallDutyPolicyEscalationRuleTeam,
        title: "Read On-Call Duty Policy Escalation Rule Team",
        description:
          "This permission can read teams in on-call duty escalation rule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission:
          Permission.CreateProjectOnCallDutyPolicyEscalationRuleSchedule,
        title: "Create On-Call Duty Policy Escalation Rule Schedule",
        description:
          "This permission can create teams in on-call duty escalation rule schedule this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission:
          Permission.DeleteProjectOnCallDutyPolicyEscalationRuleSchedule,
        title: "Delete On-Call Duty Policy Escalation Rule Schedule",
        description:
          "This permission can delete teams in on-call duty escalation rule schedule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission:
          Permission.EditProjectOnCallDutyPolicyEscalationRuleSchedule,
        title: "Edit On-Call Duty Policy Escalation Rule Schedule",
        description:
          "This permission can edit teams in on-call duty escalation rule schedule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission:
          Permission.ReadProjectOnCallDutyPolicyEscalationRuleSchedule,
        title: "Read On-Call Duty Policy Escalation Rule Schedule",
        description:
          "This permission can read teams in on-call duty escalation rule schedule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateMonitorSecret,
        title: "Create Monitor Secret",
        description: "This permission can create monitor secret.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteMonitorSecret,
        title: "Delete Monitor Secret",
        description: "This permission can delete monitor secret",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditMonitorSecret,
        title: "Edit Monitor Secret",
        description: "This permission can edit monitor secret.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadMonitorSecret,
        title: "Read Monitor Secret",
        description: "This permission can read monitor secret.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateProjectOnCallDutyPolicyEscalationRuleUser,
        title: "Create On-Call Duty Policy Escalation Rule User",
        description:
          "This permission can create on-call duty escalation rule this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteProjectOnCallDutyPolicyEscalationRuleUser,
        title: "Delete On-Call Duty Policy Escalation Rule User",
        description:
          "This permission can delete on-call duty escalation rule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditProjectOnCallDutyPolicyEscalationRuleUser,
        title: "Edit On-Call Duty Policy Escalation Rule User",
        description:
          "This permission can edit on-call duty escalation rule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadProjectOnCallDutyPolicyEscalationRuleUser,
        title: "Read On-Call Duty Policy Escalation Rule User",
        description:
          "This permission can read on-call duty escalation rule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateProjectOnCallDutyPolicyEscalationRule,
        title: "Create On-Call Duty Policy Escalation Rule",
        description:
          "This permission can create on-call duty escalation rule this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteProjectOnCallDutyPolicyEscalationRule,
        title: "Delete On-Call Duty Policy Escalation Rule",
        description:
          "This permission can delete on-call duty escalation rule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditProjectOnCallDutyPolicyEscalationRule,
        title: "Edit On-Call Duty Policy Escalation Rule",
        description:
          "This permission can edit on-call duty escalation rule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadProjectOnCallDutyPolicyEscalationRule,
        title: "Read On-Call Duty Policy Escalation Rule",
        description:
          "This permission can read on-call duty escalation rule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.ReadOnCallDutyPolicyTimeLog,
        title: "Create On-Call Policy Time Log",
        description:
          "This permission can read on-call policy time log this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateOnCallDutyPolicyUserOverride,
        title: "Create On-Call Duty Policy User Override",
        description:
          "This permission can create on-call duty policy user override this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteOnCallDutyPolicyUserOverride,
        title: "Delete On-Call Duty Policy User Override",
        description:
          "This permission can delete on-call duty policy user override of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditOnCallDutyPolicyUserOverride,
        title: "Edit On-Call Duty Policy User Override",
        description:
          "This permission can edit on-call duty policy user override of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadOnCallDutyPolicyUserOverride,
        title: "Read On-Call Duty Policy User Override",
        description:
          "This permission can read on-call duty policy user override of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateProjectOnCallDutyPolicy,
        title: "Create On-Call Duty Policy",
        description: "This permission can create on-call duty this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteProjectOnCallDutyPolicy,
        title: "Delete On-Call Duty Policy",
        description: "This permission can delete on-call duty of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
      },
      {
        permission: Permission.EditProjectOnCallDutyPolicy,
        title: "Edit On-Call Duty Policy",
        description: "This permission can edit on-call duty of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
      },
      {
        permission: Permission.ReadProjectOnCallDutyPolicy,
        title: "Read On-Call Duty Policy",
        description: "This permission can read on-call duty of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
      },

      {
        permission: Permission.CreateProjectOnCallDutyPolicySchedule,
        title: "Create On-Call Duty Policy Schedule",
        description:
          "This permission can create on-call duty schedule this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteProjectOnCallDutyPolicySchedule,
        title: "Delete On-Call Duty Policy Schedule",
        description:
          "This permission can delete on-call duty schedule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
      },
      {
        permission: Permission.EditProjectOnCallDutyPolicySchedule,
        title: "Edit On-Call Duty Policy Schedule",
        description:
          "This permission can edit on-call duty schedule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
      },
      {
        permission: Permission.ReadProjectOnCallDutyPolicySchedule,
        title: "Read On-Call Duty Policy Schedule",
        description:
          "This permission can read on-call duty schedule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
      },

      {
        permission: Permission.CreateProjectStatusPage,
        title: "Create Status Page",
        description: "This permission can create status pages this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteProjectStatusPage,
        title: "Delete Status Page",
        description: "This permission can delete status pages of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
      },
      {
        permission: Permission.EditProjectStatusPage,
        title: "Edit Status Page",
        description: "This permission can edit status pages of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
      },
      {
        permission: Permission.ReadProjectStatusPage,
        title: "Read Status Page",
        description: "This permission can read status pages of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
      },

      {
        permission: Permission.CreateProjectProbe,
        title: "Create Probe",
        description: "This permission can create probe this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
      },
      {
        permission: Permission.DeleteProjectProbe,
        title: "Delete Probe",
        description: "This permission can delete probe of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
      },
      {
        permission: Permission.EditProjectProbe,
        title: "Edit Probe",
        description: "This permission can edit probe of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
      },
      {
        permission: Permission.ReadProjectProbe,
        title: "Read Probe",
        description: "This permission can read probe of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
      },

      {
        permission: Permission.CreateProjectLlm,
        title: "Create LLM",
        description:
          "This permission can create LLM configurations for this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteProjectLlm,
        title: "Delete LLM",
        description:
          "This permission can delete LLM configurations of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditProjectLlm,
        title: "Edit LLM",
        description:
          "This permission can edit LLM configurations of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadProjectLlm,
        title: "Read LLM",
        description:
          "This permission can read LLM configurations of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateTelemetryService,
        title: "Create Telemetry Service",
        description:
          "This permission can create Telemetry Service this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteTelemetryService,
        title: "Delete Telemetry Service",
        description:
          "This permission can delete Telemetry Service of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
      },
      {
        permission: Permission.EditTelemetryService,
        title: "Edit Telemetry Service",
        description:
          "This permission can edit Telemetry Service of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
      },
      {
        permission: Permission.ReadTelemetryService,
        title: "Read Telemetry Service",
        description: "This permission can read Service of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
      },

      {
        permission: Permission.CreateMonitorGroupResource,
        title: "Create Monitor Group Resource",
        description: "This permission can create monitor group resource.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteMonitorGroupResource,
        title: "Delete Monitor Group Resource",
        description: "This permission can delete monitor group resource.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditMonitorGroupResource,
        title: "Edit Monitor Group Resource",
        description: "This permission can edit monitor group resource.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadMonitorGroupResource,
        title: "Read Monitor Group Resource",
        description: "This permission can read monitor group resource.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateOnCallDutyPolicyCustomField,
        title: "Create On-Call Policy Custom Field",
        description:
          "This permission can create On-Call Policy Custom Field this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteOnCallDutyPolicyCustomField,
        title: "Delete On-Call Policy Custom Field",
        description:
          "This permission can delete On-Call Policy Custom Field of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditOnCallDutyPolicyCustomField,
        title: "Edit On-Call Policy Custom Field",
        description:
          "This permission can edit On-Call Policy Custom Field of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadOnCallDutyPolicyCustomField,
        title: "Read On-Call Policy Custom Field",
        description:
          "This permission can read On-Call Policy Custom Field of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateOnCallDutyPolicyScheduleLayer,
        title: "Create On-Call Schedule Layer",
        description:
          "This permission can create On-Call Schedule Layer this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteOnCallDutyPolicyScheduleLayer,
        title: "Delete On-Call Schedule Layer",
        description:
          "This permission can delete On-Call Schedule Layer of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditOnCallDutyPolicyScheduleLayer,
        title: "Edit On-Call Schedule Layer",
        description:
          "This permission can edit On-Call Schedule Layer of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadOnCallDutyPolicyScheduleLayer,
        title: "Read On-Call Schedule Layer",
        description:
          "This permission can read On-Call Schedule Layer of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateOnCallDutyPolicyScheduleLayerUser,
        title: "Create On-Call Schedule Layer User",
        description:
          "This permission can create On-Call Schedule Layer User this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteOnCallDutyPolicyScheduleLayerUser,
        title: "Delete On-Call Schedule Layer User",
        description:
          "This permission can delete On-Call Schedule Layer User of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditOnCallDutyPolicyScheduleLayerUser,
        title: "Edit On-Call Schedule Layer User",
        description:
          "This permission can edit On-Call Schedule Layer User of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadOnCallDutyPolicyScheduleLayerUser,
        title: "Read On-Call Schedule Layer User",
        description:
          "This permission can read On-Call Schedule Layer User of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateMonitorCustomField,
        title: "Create Monitor Custom Field",
        description:
          "This permission can create Monitor Custom Field this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteMonitorCustomField,
        title: "Delete Monitor Custom Field",
        description:
          "This permission can delete Monitor Custom Field of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditMonitorCustomField,
        title: "Edit Monitor Custom Field",
        description:
          "This permission can edit Monitor Custom Field of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadMonitorCustomField,
        title: "Read Monitor Custom Field",
        description:
          "This permission can read Monitor Custom Field of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateIncidentCustomField,
        title: "Create Incident Custom Field",
        description:
          "This permission can create Incident Custom Field this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteIncidentCustomField,
        title: "Delete Incident Custom Field",
        description:
          "This permission can delete Incident Custom Field of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditIncidentCustomField,
        title: "Edit Incident Custom Field",
        description:
          "This permission can edit Incident Custom Field of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadIncidentCustomField,
        title: "Read Incident Custom Field",
        description:
          "This permission can read Incident Custom Field of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateAlertCustomField,
        title: "Create Alert Custom Field",
        description:
          "This permission can create Alert Custom Field this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteAlertCustomField,
        title: "Delete Alert Custom Field",
        description:
          "This permission can delete Alert Custom Field of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditAlertCustomField,
        title: "Edit Alert Custom Field",
        description:
          "This permission can edit Alert Custom Field of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadAlertCustomField,
        title: "Read Alert Custom Field",
        description:
          "This permission can read Alert Custom Field of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateStatusPageCustomField,
        title: "Create Status Page Custom Field",
        description:
          "This permission can create Status Page Custom Field this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteStatusPageCustomField,
        title: "Delete Status Page Custom Field",
        description:
          "This permission can delete Status Page Custom Field of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditStatusPageCustomField,
        title: "Edit Status Page Custom Field",
        description:
          "This permission can edit Status Page Custom Field of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadStatusPageCustomField,
        title: "Read Status Page Custom Field",
        description:
          "This permission can read Status Page Custom Field of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateScheduledMaintenanceCustomField,
        title: "Create Scheduled Maintenance Custom Field",
        description:
          "This permission can create Scheduled Maintenance Custom Field this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteScheduledMaintenanceCustomField,
        title: "Delete Scheduled Maintenance Custom Field",
        description:
          "This permission can delete Scheduled Maintenance Custom Field of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditScheduledMaintenanceCustomField,
        title: "Edit Scheduled Maintenance Custom Field",
        description:
          "This permission can edit Scheduled Maintenance Custom Field of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadScheduledMaintenanceCustomField,
        title: "Read Scheduled Maintenance Custom Field",
        description:
          "This permission can read Scheduled Maintenance Custom Field of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.ReadSmsLog,
        title: "Read SMS Log",
        description: "This permission can read SMS Log of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.ReadWhatsAppLog,
        title: "Read WhatsApp Log",
        description: "This permission can read WhatsApp Log of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.ReadCallLog,
        title: "Read Call Log",
        description: "This permission can read Call Logs of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.ReadPushLog,
        title: "Read Push Log",
        description:
          "This permission can read Push Notification Logs of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.ReadWorkspaceNotificationLog,
        title: "Read Workspace Notification Log",
        description:
          "This permission can read Workspace Notification Logs (Slack / Microsoft Teams) of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateMonitorProbe,
        title: "Create Monitor Probe",
        description: "This permission can create Monitor Probe this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteMonitorProbe,
        title: "Delete Monitor Probe",
        description:
          "This permission can delete Monitor Probe of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditMonitorProbe,
        title: "Edit Monitor Probe",
        description: "This permission can edit Monitor Probe of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadMonitorProbe,
        title: "Read Monitor Probe",
        description: "This permission can read Monitor Probe of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateTelemetryServiceLog,
        title: "Create Telemetry Service Log",
        description:
          "This permission can create Telemetry Service Log this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteTelemetryServiceLog,
        title: "Delete Telemetry Service Log",
        description:
          "This permission can delete Telemetry Service Log of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditTelemetryServiceLog,
        title: "Edit Telemetry Service Log",
        description:
          "This permission can edit Telemetry Service Log of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadTelemetryServiceLog,
        title: "Read Telemetry Service Log",
        description:
          "This permission can read Telemetry Service Log of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateTelemetryException,
        title: "Create Telemetry Service Exception",
        description:
          "This permission can create Telemetry Service Exception this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteTelemetryException,
        title: "Delete Telemetry Service Exception",
        description:
          "This permission can delete Telemetry Service Exception of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditTelemetryException,
        title: "Edit Telemetry Service Exception",
        description:
          "This permission can edit Telemetry Service Exception of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadTelemetryException,
        title: "Read Telemetry Service Exception",
        description:
          "This permission can read Telemetry Service Exception of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateProbeOwnerTeam,
        title: "Create Probe Owner Team",
        description: "This permission can create owners for probes.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteProbeOwnerTeam,
        title: "Delete Probe Owner Team",
        description: "This permission can delete owners for probes",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditProbeOwnerTeam,
        title: "Edit Probe Owner Team",
        description: "This permission can edit owners for probes",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadProbeOwnerTeam,
        title: "Read Probe Owner Team",
        description: "This permission can read owners for probes",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateProbeOwnerUser,
        title: "Create Probe Owner User",
        description: "This permission can create owners for probes.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteProbeOwnerUser,
        title: "Delete Probe Owner User",
        description: "This permission can delete owners for probes",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditProbeOwnerUser,
        title: "Edit Probe Owner User",
        description: "This permission can edit owners for probes",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadProbeOwnerUser,
        title: "Read Probe Owner User",
        description: "This permission can read owners for probes",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateServiceCatalog,
        title: "Create Service Catalog",
        description: "This permission can create Service Catalog this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
      },
      {
        permission: Permission.DeleteServiceCatalog,
        title: "Delete Service Catalog",
        description:
          "This permission can delete Service Catalog of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
      },
      {
        permission: Permission.EditServiceCatalog,
        title: "Edit Service Catalog",
        description:
          "This permission can edit Service Catalog of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
      },
      {
        permission: Permission.ReadServiceCatalog,
        title: "Read Service Catalog",
        description:
          "This permission can read Service Catalog of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
      },

      {
        permission: Permission.CreateServiceCatlogDependency,
        title: "Create Service Catalog Dependency",
        description:
          "This permission can create Service Catalog Dependencies this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteServiceCatlogDependency,
        title: "Delete Service Catalog Dependency",
        description:
          "This permission can delete Service Catalog Dependencies of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditServiceCatlogDependency,
        title: "Edit Service Catalog Dependency",
        description:
          "This permission can edit Service Catalog Dependencies of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadServiceCatlogDependency,
        title: "Read Service Catalog Dependency",
        description:
          "This permission can read Service Catalog Dependencies of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateServiceCatalogMonitor,
        title: "Create Service Catalog Monitor",
        description:
          "This permission can create Service Catalog Monitor this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteServiceCatalogMonitor,
        title: "Delete Service Catalog Monitor",
        description:
          "This permission can delete Service Catalog Monitor of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditServiceCatalogMonitor,
        title: "Edit Service Catalog Monitor",
        description:
          "This permission can edit Service Catalog Monitor of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadServiceCatalogMonitor,
        title: "Read Service Catalog Monitor",
        description:
          "This permission can read Service Catalog Monitor of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateServiceCatalogTelemetryService,
        title: "Create Service Catalog Telemetry Service",
        description:
          "This permission can create Service Catalog Telemetry Service this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteServiceCatalogTelemetryService,
        title: "Delete Service Catalog Telemetry Service",
        description:
          "This permission can delete Service Catalog Telemetry Service of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditServiceCatalogTelemetryService,
        title: "Edit Service Catalog Telemetry Service",
        description:
          "This permission can edit Service Catalog Telemetry Service of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadServiceCatalogTelemetryService,
        title: "Read Service Catalog Telemetry Service",
        description:
          "This permission can read Service Catalog Telemetry Service of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateServiceCatalogCodeRepository,
        title: "Create Service Catalog Code Repository",
        description:
          "This permission can create Service Catalog Code Repository in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteServiceCatalogCodeRepository,
        title: "Delete Service Catalog Code Repository",
        description:
          "This permission can delete Service Catalog Code Repository of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditServiceCatalogCodeRepository,
        title: "Edit Service Catalog Code Repository",
        description:
          "This permission can edit Service Catalog Code Repository of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadServiceCatalogCodeRepository,
        title: "Read Service Catalog Code Repository",
        description:
          "This permission can read Service Catalog Code Repository of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      // Code Repository Permissions
      {
        permission: Permission.CreateCodeRepository,
        title: "Create Code Repository",
        description:
          "This permission can create Code Repositories in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
      },
      {
        permission: Permission.DeleteCodeRepository,
        title: "Delete Code Repository",
        description:
          "This permission can delete Code Repositories of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
      },
      {
        permission: Permission.EditCodeRepository,
        title: "Edit Code Repository",
        description:
          "This permission can edit Code Repositories of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
      },
      {
        permission: Permission.ReadCodeRepository,
        title: "Read Code Repository",
        description:
          "This permission can read Code Repositories of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
      },

      {
        permission: Permission.CreateTelemetryServiceTraces,
        title: "Create Telemetry Service Traces",
        description:
          "This permission can create Telemetry Service Traces this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteTelemetryServiceTraces,
        title: "Delete Telemetry Service Traces",
        description:
          "This permission can delete Telemetry Service Traces of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditTelemetryServiceTraces,
        title: "Edit Telemetry Service Traces",
        description:
          "This permission can edit Telemetry Service Traces of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadTelemetryServiceTraces,
        title: "Read Telemetry Service Traces",
        description:
          "This permission can read Telemetry Service Traces of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateTelemetryServiceMetrics,
        title: "Create Telemetry Service Metrics",
        description:
          "This permission can create Telemetry Service Metrics this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteTelemetryServiceMetrics,
        title: "Delete Telemetry Service Metrics",
        description:
          "This permission can delete Telemetry Service Metrics of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditTelemetryServiceMetrics,
        title: "Edit Telemetry Service Metrics",
        description:
          "This permission can edit Telemetry Service Metrics of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadTelemetryServiceMetrics,
        title: "Read Telemetry Service Metrics",
        description:
          "This permission can read Telemetry Service Metrics of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateScheduledMaintenanceOwnerTeam,
        title: "Create Scheduled Maintenance Team Owner",
        description:
          "This permission can create Scheduled Maintenance Team Owner this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteScheduledMaintenanceOwnerTeam,
        title: "Delete Scheduled Maintenance Team Owner",
        description:
          "This permission can delete Scheduled Maintenance Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditScheduledMaintenanceOwnerTeam,
        title: "Edit Scheduled Maintenance Team Owner",
        description:
          "This permission can edit Scheduled Maintenance Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadScheduledMaintenanceOwnerTeam,
        title: "Read Scheduled Maintenance Team Owner",
        description:
          "This permission can read Scheduled Maintenance Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateScheduledMaintenanceOwnerUser,
        title: "Create Scheduled Maintenance User Owner",
        description:
          "This permission can create Scheduled Maintenance User Owner this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteScheduledMaintenanceOwnerUser,
        title: "Delete Scheduled Maintenance User Owner",
        description:
          "This permission can delete Scheduled Maintenance User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditScheduledMaintenanceOwnerUser,
        title: "Edit Scheduled Maintenance User Owner",
        description:
          "This permission can edit Scheduled Maintenance User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadScheduledMaintenanceOwnerUser,
        title: "Read Scheduled Maintenance User Owner",
        description:
          "This permission can read Scheduled Maintenance User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateScheduledMaintenanceTemplateOwnerUser,
        title: "Create Scheduled Maintenance Template User Owner",
        description:
          "This permission can create Scheduled Maintenance Template User Owner this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteScheduledMaintenanceTemplateOwnerUser,
        title: "Delete Scheduled Maintenance Template User Owner",
        description:
          "This permission can delete Scheduled Maintenance Template User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditScheduledMaintenanceTemplateOwnerUser,
        title: "Edit Scheduled Maintenance Template User Owner",
        description:
          "This permission can edit Scheduled Maintenance Template User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadScheduledMaintenanceTemplateOwnerUser,
        title: "Read Scheduled Maintenance Template User Owner",
        description:
          "This permission can read Scheduled Maintenance Template User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateScheduledMaintenanceTemplateOwnerTeam,
        title: "Create Scheduled Maintenance Template User Team",
        description:
          "This permission can create Scheduled Maintenance Template User Owner this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteScheduledMaintenanceTemplateOwnerTeam,
        title: "Delete Scheduled Maintenance Template User Team",
        description:
          "This permission can delete Scheduled Maintenance Template User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditScheduledMaintenanceTemplateOwnerTeam,
        title: "Edit Scheduled Maintenance Template User Team",
        description:
          "This permission can edit Scheduled Maintenance Template User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadScheduledMaintenanceTemplateOwnerTeam,
        title: "Read Scheduled Maintenance Template User Team",
        description:
          "This permission can read Scheduled Maintenance Template User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateIncidentOwnerTeam,
        title: "Create Incident Team Owner",
        description:
          "This permission can create Incident Team Owner this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteIncidentOwnerTeam,
        title: "Delete Incident Team Owner",
        description:
          "This permission can delete Incident Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditIncidentOwnerTeam,
        title: "Edit Incident Team Owner",
        description:
          "This permission can edit Incident Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadIncidentOwnerTeam,
        title: "Read Incident Team Owner",
        description:
          "This permission can read Incident Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateAlertOwnerTeam,
        title: "Create Alert Team Owner",
        description:
          "This permission can create Alert Team Owner this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteAlertOwnerTeam,
        title: "Delete Alert Team Owner",
        description:
          "This permission can delete Alert Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditAlertOwnerTeam,
        title: "Edit Alert Team Owner",
        description:
          "This permission can edit Alert Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadAlertOwnerTeam,
        title: "Read Alert Team Owner",
        description:
          "This permission can read Alert Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateIncidentNoteTemplate,
        title: "Create Incident Note Template",
        description:
          "This permission can create Incident Note Template this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteIncidentNoteTemplate,
        title: "Delete Incident Note Template",
        description:
          "This permission can delete Incident Note Template of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditIncidentNoteTemplate,
        title: "Edit Incident Note Template",
        description:
          "This permission can edit Incident Note Template of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadIncidentNoteTemplate,
        title: "Read Incident Note Template",
        description:
          "This permission can read Incident Note Template of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateAlertNoteTemplate,
        title: "Create Alert Note Template",
        description:
          "This permission can create Alert Note Template this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteAlertNoteTemplate,
        title: "Delete Alert Note Template",
        description:
          "This permission can delete Alert Note Template of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditAlertNoteTemplate,
        title: "Edit Alert Note Template",
        description:
          "This permission can edit Alert Note Template of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadAlertNoteTemplate,
        title: "Read Alert Note Template",
        description:
          "This permission can read Alert Note Template of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateScheduledMaintenanceNoteTemplate,
        title: "Create Scheduled Maintenance Note Template",
        description:
          "This permission can create Scheduled Maintenance Note Template this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteScheduledMaintenanceNoteTemplate,
        title: "Delete Scheduled Maintenance Note Template",
        description:
          "This permission can delete Scheduled Maintenance Note Template of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditScheduledMaintenanceNoteTemplate,
        title: "Edit Scheduled Maintenance Note Template",
        description:
          "This permission can edit Scheduled Maintenance Note Template of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadScheduledMaintenanceNoteTemplate,
        title: "Read Scheduled Maintenance Note Template",
        description:
          "This permission can read Scheduled Maintenance Note Template of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateIncidentTemplate,
        title: "Create Incident Template",
        description:
          "This permission can create Incident Template this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteIncidentTemplate,
        title: "Delete Incident Template",
        description:
          "This permission can delete Incident Template of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditIncidentTemplate,
        title: "Edit Incident Template",
        description:
          "This permission can edit Incident Template of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadIncidentTemplate,
        title: "Read Incident Template",
        description:
          "This permission can read Incident Template of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateIncidentOwnerUser,
        title: "Create Incident User Owner",
        description:
          "This permission can create Incident User Owner this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteIncidentOwnerUser,
        title: "Delete Incident User Owner",
        description:
          "This permission can delete Incident User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditIncidentOwnerUser,
        title: "Edit Incident User Owner",
        description:
          "This permission can edit Incident User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadIncidentOwnerUser,
        title: "Read Incident User Owner",
        description:
          "This permission can read Incident User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateAlertOwnerUser,
        title: "Create Alert User Owner",
        description:
          "This permission can create Alert User Owner this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteAlertOwnerUser,
        title: "Delete Alert User Owner",
        description:
          "This permission can delete Alert User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditAlertOwnerUser,
        title: "Edit Alert User Owner",
        description:
          "This permission can edit Alert User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadAlertOwnerUser,
        title: "Read Alert User Owner",
        description:
          "This permission can read Alert User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateStatusPageOwnerTeam,
        title: "Create Status Page Team Owner",
        description:
          "This permission can create Status Page Team Owner this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteStatusPageOwnerTeam,
        title: "Delete Status Page Team Owner",
        description:
          "This permission can delete Status Page Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditStatusPageOwnerTeam,
        title: "Edit Status Page Team Owner",
        description:
          "This permission can edit Status Page Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadStatusPageOwnerTeam,
        title: "Read Status Page Team Owner",
        description:
          "This permission can read Status Page Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateIncidentTemplateOwnerTeam,
        title: "Create IncidentTemplate Team Owner",
        description:
          "This permission can create IncidentTemplate Team Owner this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteIncidentTemplateOwnerTeam,
        title: "Delete IncidentTemplate Team Owner",
        description:
          "This permission can delete IncidentTemplate Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditIncidentTemplateOwnerTeam,
        title: "Edit IncidentTemplate Team Owner",
        description:
          "This permission can edit IncidentTemplate Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadIncidentTemplateOwnerTeam,
        title: "Read IncidentTemplate Team Owner",
        description:
          "This permission can read IncidentTemplate Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateServiceCatalogOwnerTeam,
        title: "Create Service Catalog Team Owner",
        description:
          "This permission can create Service Catalog Team Owner this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteServiceCatalogOwnerTeam,
        title: "Delete Service Catalog Team Owner",
        description:
          "This permission can delete Service Catalog Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditServiceCatalogOwnerTeam,
        title: "Edit Service Catalog Team Owner",
        description:
          "This permission can edit Service Catalog Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadServiceCatalogOwnerTeam,
        title: "Read Service Catalog Team Owner",
        description:
          "This permission can read Service Catalog Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateServiceCatalogOwnerUser,
        title: "Create Service Catalog User Owner",
        description:
          "This permission can create Service Catalog User Owner this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteServiceCatalogOwnerUser,
        title: "Delete Service Catalog User Owner",
        description:
          "This permission can delete Service Catalog User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditServiceCatalogOwnerUser,
        title: "Edit Service Catalog User Owner",
        description:
          "This permission can edit Service Catalog User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadServiceCatalogOwnerUser,
        title: "Read Service Catalog User Owner",
        description:
          "This permission can read Service Catalog User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateIncidentTemplateOwnerUser,
        title: "Create IncidentTemplate User Owner",
        description:
          "This permission can create IncidentTemplate User Owner this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteIncidentTemplateOwnerUser,
        title: "Delete IncidentTemplate User Owner",
        description:
          "This permission can delete IncidentTemplate User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditIncidentTemplateOwnerUser,
        title: "Edit IncidentTemplate User Owner",
        description:
          "This permission can edit IncidentTemplate User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadIncidentTemplateOwnerUser,
        title: "Read IncidentTemplate User Owner",
        description:
          "This permission can read IncidentTemplate User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateStatusPageOwnerTeam,
        title: "Create Status Page Team Owner",
        description:
          "This permission can create Status Page Team Owner this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteStatusPageOwnerTeam,
        title: "Delete Status Page Team Owner",
        description:
          "This permission can delete Status Page Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditStatusPageOwnerTeam,
        title: "Edit Status Page Team Owner",
        description:
          "This permission can edit Status Page Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadStatusPageOwnerTeam,
        title: "Read Status Page Team Owner",
        description:
          "This permission can read Status Page Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateStatusPageOwnerUser,
        title: "Create Status Page User Owner",
        description:
          "This permission can create Status Page User Owner this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteStatusPageOwnerUser,
        title: "Delete Status Page User Owner",
        description:
          "This permission can delete Status Page User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditStatusPageOwnerUser,
        title: "Edit Status Page User Owner",
        description:
          "This permission can edit Status Page User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadStatusPageOwnerUser,
        title: "Read Status Page User Owner",
        description:
          "This permission can read Status Page User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateMonitorOwnerTeam,
        title: "Create Monitor Team Owner",
        description:
          "This permission can create Monitor Team Owner this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteMonitorOwnerTeam,
        title: "Delete Monitor Team Owner",
        description:
          "This permission can delete Monitor Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditMonitorOwnerTeam,
        title: "Edit Monitor Team Owner",
        description:
          "This permission can edit Monitor Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadMonitorOwnerTeam,
        title: "Read Monitor Team Owner",
        description:
          "This permission can read Monitor Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateMonitorOwnerUser,
        title: "Create Monitor User Owner",
        description:
          "This permission can create Monitor User Owner this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteMonitorOwnerUser,
        title: "Delete Monitor User Owner",
        description:
          "This permission can delete Monitor User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditMonitorOwnerUser,
        title: "Edit Monitor User Owner",
        description:
          "This permission can edit Monitor User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadMonitorOwnerUser,
        title: "Read Monitor User Owner",
        description:
          "This permission can read Monitor User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateMonitorGroupOwnerTeam,
        title: "Create Monitor Group Team Owner",
        description:
          "This permission can create Monitor Group Team Owner this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteMonitorGroupOwnerTeam,
        title: "Delete Monitor Group Team Owner",
        description:
          "This permission can delete Monitor Group Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditMonitorGroupOwnerTeam,
        title: "Edit Monitor Group Team Owner",
        description:
          "This permission can edit Monitor Group Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadMonitorGroupOwnerTeam,
        title: "Read Monitor Group Team Owner",
        description:
          "This permission can read Monitor Group Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateOnCallDutyPolicyOwnerUser,
        title: "Create On Call Duty Policy User Owner",
        description:
          "This permission can create On Call Duty Policy User Owner this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteOnCallDutyPolicyOwnerUser,
        title: "Delete On Call Duty Policy User Owner",
        description:
          "This permission can delete On Call Duty Policy User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditOnCallDutyPolicyOwnerUser,
        title: "Edit On Call Duty Policy User Owner",
        description:
          "This permission can edit On Call Duty Policy User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadOnCallDutyPolicyOwnerUser,
        title: "Read On Call Duty Policy User Owner",
        description:
          "This permission can read On Call Duty Policy User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateOnCallDutyPolicyOwnerTeam,
        title: "Create On Call Duty Policy Team Owner",
        description:
          "This permission can create On Call Duty Policy Team Owner this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteOnCallDutyPolicyOwnerTeam,
        title: "Delete On Call Duty Policy Team Owner",
        description:
          "This permission can delete On Call Duty Policy Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditOnCallDutyPolicyOwnerTeam,
        title: "Edit On Call Duty Policy Team Owner",
        description:
          "This permission can edit On Call Duty Policy Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadOnCallDutyPolicyOwnerTeam,
        title: "Read On Call Duty Policy Team Owner",
        description:
          "This permission can read On Call Duty Policy Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateMonitorGroupOwnerUser,
        title: "Create Monitor Group User Owner",
        description:
          "This permission can create Monitor Group User Owner this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteMonitorGroupOwnerUser,
        title: "Delete Monitor Group User Owner",
        description:
          "This permission can delete Monitor Group User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditMonitorGroupOwnerUser,
        title: "Edit Monitor Group User Owner",
        description:
          "This permission can edit Monitor Group User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadMonitorGroupOwnerUser,
        title: "Read Monitor Group User Owner",
        description:
          "This permission can read Monitor Group User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateProjectIncident,
        title: "Create Incident",
        description: "This permission can create incident this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteProjectIncident,
        title: "Delete Incident",
        description: "This permission can delete incident of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
      },
      {
        permission: Permission.EditProjectIncident,
        title: "Edit Incident",
        description: "This permission can edit incident of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
      },
      {
        permission: Permission.ReadProjectIncident,
        title: "Read Incident",
        description: "This permission can read incident of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
      },

      {
        permission: Permission.CreateAlert,
        title: "Create Alert",
        description: "This permission can create alerts for this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteAlert,
        title: "Delete Alert",
        description: "This permission can delete alerts of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
      },
      {
        permission: Permission.EditAlert,
        title: "Edit Alert",
        description: "This permission can edit alerts of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
      },
      {
        permission: Permission.ReadAlert,
        title: "Read Alert",
        description: "This permission can read alerts of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
      },

      {
        permission: Permission.CreateScheduledMaintenanceTemplate,
        title: "Create Scheduled Maintenance Template",
        description:
          "This permission can create scheduled maintenance template in the project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteScheduledMaintenanceTemplate,
        title: "Delete Scheduled Maintenance Template",
        description:
          "This permission can delete scheduled maintenance template in the project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditScheduledMaintenanceTemplate,
        title: "Edit Scheduled Maintenance Template",
        description:
          "This permission can edit scheduled maintenance template in the project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadScheduledMaintenanceTemplate,
        title: "Read Scheduled Maintenance Template",
        description:
          "This permission can read scheduled maintenance template in the project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateStatusPageSubscriber,
        title: "Create Status Page Subscriber",
        description:
          "This permission can create subscriber on status page this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteStatusPageSubscriber,
        title: "Delete Status Page Subscriber",
        description:
          "This permission can delete subscriber on status page of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditStatusPageSubscriber,
        title: "Edit Status Page Subscriber",
        description:
          "This permission can edit subscriber on status page of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadStatusPageSubscriber,
        title: "Read Status Page Subscriber",
        description:
          "This permission can read subscriber on status page of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateStatusPagePrivateUser,
        title: "Create Status Page Private User",
        description:
          "This permission can create private user on status page this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteStatusPagePrivateUser,
        title: "Delete Status Page PrivateUser",
        description:
          "This permission can delete private user on status page of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditStatusPagePrivateUser,
        title: "Edit Status Page PrivateUser",
        description:
          "This permission can edit private user on status page of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadStatusPagePrivateUser,
        title: "Read Status Page Private User",
        description:
          "This permission can read private user on status page of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      // Scheduled Maintenance Permissions.

      {
        permission: Permission.CreateScheduledMaintenanceState,
        title: "Create Scheduled Maintenance State",
        description:
          "This permission can create Scheduled Maintenance states this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteScheduledMaintenanceState,
        title: "Delete Scheduled Maintenance State",
        description:
          "This permission can delete Scheduled Maintenance states of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditScheduledMaintenanceState,
        title: "Edit Scheduled Maintenance State",
        description:
          "This permission can edit Scheduled Maintenance states of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadScheduledMaintenanceState,
        title: "Read Scheduled Maintenance State",
        description:
          "This permission can read Scheduled Maintenance states of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateProjectScheduledMaintenance,
        title: "Create Scheduled Maintenance",
        description:
          "This permission can create Scheduled Maintenance this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteProjectScheduledMaintenance,
        title: "Delete Scheduled Maintenance",
        description:
          "This permission can delete Scheduled Maintenance of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
      },
      {
        permission: Permission.EditProjectScheduledMaintenance,
        title: "Edit Scheduled Maintenance",
        description:
          "This permission can edit Scheduled Maintenance of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
      },
      {
        permission: Permission.ReadProjectScheduledMaintenance,
        title: "Read Scheduled Maintenance",
        description:
          "This permission can read Scheduled Maintenance of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
      },

      {
        permission: Permission.CreateScheduledMaintenanceStateTimeline,
        title: "Create Scheduled Maintenance State Timeline",
        description:
          "This permission can create Scheduled Maintenance state history of an Scheduled Maintenance in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteScheduledMaintenanceStateTimeline,
        title: "Delete Scheduled Maintenance State Timeline",
        description:
          "This permission can delete Scheduled Maintenance state history of an Scheduled Maintenance in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditScheduledMaintenanceStateTimeline,
        title: "Edit Scheduled Maintenance State Timeline",
        description:
          "This permission can edit Scheduled Maintenance state history of an Scheduled Maintenance in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadScheduledMaintenanceStateTimeline,
        title: "Read Scheduled Maintenance State Timeline",
        description:
          "This permission can read Scheduled Maintenance state history of an Scheduled Maintenance in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateScheduledMaintenanceInternalNote,
        title: "Create Scheduled Maintenance Internal Note",
        description:
          "This permission can create Scheduled Maintenance Internal Note this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteScheduledMaintenanceInternalNote,
        title: "Delete Scheduled Maintenance Internal Note",
        description:
          "This permission can delete Scheduled Maintenance Internal Note of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditScheduledMaintenanceInternalNote,
        title: "Edit Scheduled Maintenance Internal Note",
        description:
          "This permission can edit Scheduled Maintenance Internal Note of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadScheduledMaintenanceInternalNote,
        title: "Read Scheduled Maintenance Internal Note",
        description:
          "This permission can read Scheduled Maintenance Internal Note of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },

      {
        permission: Permission.CreateScheduledMaintenancePublicNote,
        title: "Create Scheduled Maintenance Status Page Note",
        description:
          "This permission can create Scheduled Maintenance Status Page Note this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.DeleteScheduledMaintenancePublicNote,
        title: "Delete Scheduled Maintenance Status Page Note",
        description:
          "This permission can delete Scheduled Maintenance Status Page Note of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.EditScheduledMaintenancePublicNote,
        title: "Edit Scheduled Maintenance Status Page Note",
        description:
          "This permission can edit Scheduled Maintenance Status Page Note of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
      },
      {
        permission: Permission.ReadScheduledMaintenancePublicNote,
        title: "Read Scheduled Maintenance Status Page Note",
        description:
          "This permission can read Scheduled Maintenance Status Page Note of this project.",
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
  _type: "UserGlobalAccessPermission";
}

export interface UserPermission extends JSONObject {
  _type: "UserPermission";
  permission: Permission;
  labelIds: Array<ObjectID>;
  isBlockPermission?: boolean | undefined;
}

export interface UserTenantAccessPermission extends JSONObject {
  _type: "UserTenantAccessPermission";
  projectId: ObjectID;
  permissions: Array<UserPermission>;
}

export const PermissionsArray: Array<string> = [
  ...new Set(Object.keys(Permission)),
]; // Returns ["Owner", "Administrator"...]

export function instanceOfUserTenantAccessPermission(
  object: any,
): object is UserTenantAccessPermission {
  return object._type === "UserTenantAccessPermission";
}

export function instanceOfUserPermission(
  object: any,
): object is UserPermission {
  return object._type === "UserPermission";
}

export function instanceOfUserGlobalAccessPermission(
  object: any,
): object is UserGlobalAccessPermission {
  return object._type === "UserGlobalAccessPermission";
}

export default Permission;
