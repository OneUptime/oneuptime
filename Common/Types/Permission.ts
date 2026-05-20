// Have "Project" string in the permission to make sure this permission is by Project.
import Dictionary from "./Dictionary";
import PermissionScope from "./Database/AccessControl/PermissionScope";
import BadDataException from "./Exception/BadDataException";
import { JSONObject } from "./JSON";
import ObjectID from "./ObjectID";

export enum PermissionGroup {
  Project = "Project",
  Incident = "Incident",
  Alert = "Alert",
  Monitor = "Monitor",
  StatusPage = "Status Page",
  ScheduledMaintenance = "Scheduled Maintenance",
  OnCallDutyPolicy = "On-Call Duty Policy",
  Telemetry = "Telemetry",
  Workflow = "Workflow",
  Runbook = "Runbook",
  Team = "Team",
  Billing = "Billing",
  ServiceCatalog = "Service Catalog",
  Settings = "Settings",
  AIAgent = "AI Agent",
  Probe = "Probe",
  NotificationLog = "Notification Log",
  AuditLog = "Audit Log",
}

export interface PermissionProps {
  permission: Permission;
  description: string;
  isAssignableToTenant: boolean;
  title: string;
  isAccessControlPermission: boolean;
  isRolePermission: boolean;
  group: PermissionGroup;
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

  // Role-based permissions (per-domain Admin / Member / Viewer tiers)
  IncidentAdmin = "IncidentAdmin",
  IncidentMember = "IncidentMember",
  IncidentViewer = "IncidentViewer",

  AlertAdmin = "AlertAdmin",
  AlertMember = "AlertMember",
  AlertViewer = "AlertViewer",

  MonitorAdmin = "MonitorAdmin",
  MonitorMember = "MonitorMember",
  MonitorViewer = "MonitorViewer",

  StatusPageAdmin = "StatusPageAdmin",
  StatusPageMember = "StatusPageMember",
  StatusPageViewer = "StatusPageViewer",

  OnCallAdmin = "OnCallAdmin",
  OnCallMember = "OnCallMember",
  OnCallViewer = "OnCallViewer",

  ScheduledMaintenanceAdmin = "ScheduledMaintenanceAdmin",
  ScheduledMaintenanceMember = "ScheduledMaintenanceMember",
  ScheduledMaintenanceViewer = "ScheduledMaintenanceViewer",

  TelemetryAdmin = "TelemetryAdmin",
  TelemetryMember = "TelemetryMember",
  TelemetryViewer = "TelemetryViewer",

  SettingsAdmin = "SettingsAdmin",
  SettingsMember = "SettingsMember",
  SettingsViewer = "SettingsViewer",

  BillingAdmin = "BillingAdmin",
  BillingMember = "BillingMember",
  BillingViewer = "BillingViewer",

  // Project-wide read-only role
  Viewer = "Viewer",

  WorkflowAdmin = "WorkflowAdmin",
  WorkflowMember = "WorkflowMember",
  WorkflowViewer = "WorkflowViewer",

  RunbookAdmin = "RunbookAdmin",
  RunbookMember = "RunbookMember",
  RunbookViewer = "RunbookViewer",

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

  // Dashboard Domains
  CreateDashboardDomain = "CreateDashboardDomain",
  DeleteDashboardDomain = "DeleteDashboardDomain",
  EditDashboardDomain = "EditDashboardDomain",
  ReadDashboardDomain = "ReadDashboardDomain",

  // Logs
  CreateTelemetryServiceLog = "CreateTelemetryServiceLog",
  DeleteTelemetryServiceLog = "DeleteTelemetryServiceLog",
  EditTelemetryServiceLog = "EditTelemetryServiceLog",
  ReadTelemetryServiceLog = "ReadTelemetryServiceLog",

  // Log Pipelines
  CreateProjectLogPipeline = "CreateProjectLogPipeline",
  DeleteProjectLogPipeline = "DeleteProjectLogPipeline",
  EditProjectLogPipeline = "EditProjectLogPipeline",
  ReadProjectLogPipeline = "ReadProjectLogPipeline",

  // Log Pipeline Processors
  CreateProjectLogPipelineProcessor = "CreateProjectLogPipelineProcessor",
  DeleteProjectLogPipelineProcessor = "DeleteProjectLogPipelineProcessor",
  EditProjectLogPipelineProcessor = "EditProjectLogPipelineProcessor",
  ReadProjectLogPipelineProcessor = "ReadProjectLogPipelineProcessor",

  // Log Drop Filters
  CreateProjectLogDropFilter = "CreateProjectLogDropFilter",
  DeleteProjectLogDropFilter = "DeleteProjectLogDropFilter",
  EditProjectLogDropFilter = "EditProjectLogDropFilter",
  ReadProjectLogDropFilter = "ReadProjectLogDropFilter",

  // Log Scrub Rules
  CreateProjectLogScrubRule = "CreateProjectLogScrubRule",
  DeleteProjectLogScrubRule = "DeleteProjectLogScrubRule",
  EditProjectLogScrubRule = "EditProjectLogScrubRule",
  ReadProjectLogScrubRule = "ReadProjectLogScrubRule",

  // Metric Pipeline Rules
  CreateProjectMetricPipelineRule = "CreateProjectMetricPipelineRule",
  DeleteProjectMetricPipelineRule = "DeleteProjectMetricPipelineRule",
  EditProjectMetricPipelineRule = "EditProjectMetricPipelineRule",
  ReadProjectMetricPipelineRule = "ReadProjectMetricPipelineRule",

  // Metric Recording Rules (derived metrics)
  CreateProjectMetricRecordingRule = "CreateProjectMetricRecordingRule",
  DeleteProjectMetricRecordingRule = "DeleteProjectMetricRecordingRule",
  EditProjectMetricRecordingRule = "EditProjectMetricRecordingRule",
  ReadProjectMetricRecordingRule = "ReadProjectMetricRecordingRule",

  // Trace Pipelines
  CreateProjectTracePipeline = "CreateProjectTracePipeline",
  DeleteProjectTracePipeline = "DeleteProjectTracePipeline",
  EditProjectTracePipeline = "EditProjectTracePipeline",
  ReadProjectTracePipeline = "ReadProjectTracePipeline",

  // Trace Pipeline Processors
  CreateProjectTracePipelineProcessor = "CreateProjectTracePipelineProcessor",
  DeleteProjectTracePipelineProcessor = "DeleteProjectTracePipelineProcessor",
  EditProjectTracePipelineProcessor = "EditProjectTracePipelineProcessor",
  ReadProjectTracePipelineProcessor = "ReadProjectTracePipelineProcessor",

  // Trace Drop Filters
  CreateProjectTraceDropFilter = "CreateProjectTraceDropFilter",
  DeleteProjectTraceDropFilter = "DeleteProjectTraceDropFilter",
  EditProjectTraceDropFilter = "EditProjectTraceDropFilter",
  ReadProjectTraceDropFilter = "ReadProjectTraceDropFilter",

  // Trace Scrub Rules
  CreateProjectTraceScrubRule = "CreateProjectTraceScrubRule",
  DeleteProjectTraceScrubRule = "DeleteProjectTraceScrubRule",
  EditProjectTraceScrubRule = "EditProjectTraceScrubRule",
  ReadProjectTraceScrubRule = "ReadProjectTraceScrubRule",

  // Trace Recording Rules (derived metrics from spans)
  CreateProjectTraceRecordingRule = "CreateProjectTraceRecordingRule",
  DeleteProjectTraceRecordingRule = "DeleteProjectTraceRecordingRule",
  EditProjectTraceRecordingRule = "EditProjectTraceRecordingRule",
  ReadProjectTraceRecordingRule = "ReadProjectTraceRecordingRule",

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

  // Profiles
  CreateTelemetryServiceProfiles = "CreateTelemetryServiceProfiles",
  DeleteTelemetryServiceProfiles = "DeleteTelemetryServiceProfiles",
  EditTelemetryServiceProfiles = "EditTelemetryServiceProfiles",
  ReadTelemetryServiceProfiles = "ReadTelemetryServiceProfiles",

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

  CreateProjectAIAgent = "CreateProjectAIAgent",
  DeleteProjectAIAgent = "DeleteProjectAIAgent",
  EditProjectAIAgent = "EditProjectAIAgent",
  ReadProjectAIAgent = "ReadProjectAIAgent",

  CreateProjectAIAgentTask = "CreateProjectAIAgentTask",
  DeleteProjectAIAgentTask = "DeleteProjectAIAgentTask",
  EditProjectAIAgentTask = "EditProjectAIAgentTask",
  ReadProjectAIAgentTask = "ReadProjectAIAgentTask",

  CreateProjectAIAgentTaskTelemetryException = "CreateProjectAIAgentTaskTelemetryException",
  DeleteProjectAIAgentTaskTelemetryException = "DeleteProjectAIAgentTaskTelemetryException",
  EditProjectAIAgentTaskTelemetryException = "EditProjectAIAgentTaskTelemetryException",
  ReadProjectAIAgentTaskTelemetryException = "ReadProjectAIAgentTaskTelemetryException",

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
  ReadTelegramLog = "ReadTelegramLog",
  ReadEmailLog = "ReadEmailLog",
  ReadCallLog = "ReadCallLog",
  ReadPushLog = "ReadPushLog",
  ReadWebhookLog = "ReadWebhookLog",
  ReadWorkspaceNotificationLog = "ReadWorkspaceNotificationLog",
  ReadLlmLog = "ReadLlmLog",

  ReadProjectSCIMLog = "ReadProjectSCIMLog",
  ReadStatusPageSCIMLog = "ReadStatusPageSCIMLog",

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

  CreateIncidentRole = "CreateIncidentRole",
  DeleteIncidentRole = "DeleteIncidentRole",
  EditIncidentRole = "EditIncidentRole",
  ReadIncidentRole = "ReadIncidentRole",

  CreateIncidentMember = "CreateIncidentMember",
  DeleteIncidentMember = "DeleteIncidentMember",
  EditIncidentMember = "EditIncidentMember",
  ReadIncidentMember = "ReadIncidentMember",

  CreateIncidentEpisodeRoleMember = "CreateIncidentEpisodeRoleMember",
  DeleteIncidentEpisodeRoleMember = "DeleteIncidentEpisodeRoleMember",
  EditIncidentEpisodeRoleMember = "EditIncidentEpisodeRoleMember",
  ReadIncidentEpisodeRoleMember = "ReadIncidentEpisodeRoleMember",

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

  // Scheduled Maintenance Owner Rule Permissions
  CreateScheduledMaintenanceOwnerRule = "CreateScheduledMaintenanceOwnerRule",
  DeleteScheduledMaintenanceOwnerRule = "DeleteScheduledMaintenanceOwnerRule",
  EditScheduledMaintenanceOwnerRule = "EditScheduledMaintenanceOwnerRule",
  ReadScheduledMaintenanceOwnerRule = "ReadScheduledMaintenanceOwnerRule",

  // Scheduled Maintenance Label Rule Permissions
  CreateScheduledMaintenanceLabelRule = "CreateScheduledMaintenanceLabelRule",
  DeleteScheduledMaintenanceLabelRule = "DeleteScheduledMaintenanceLabelRule",
  EditScheduledMaintenanceLabelRule = "EditScheduledMaintenanceLabelRule",
  ReadScheduledMaintenanceLabelRule = "ReadScheduledMaintenanceLabelRule",

  CreateStatusPageOwnerTeam = "CreateStatusPageOwnerTeam",
  DeleteStatusPageOwnerTeam = "DeleteStatusPageOwnerTeam",
  EditStatusPageOwnerTeam = "EditStatusPageOwnerTeam",
  ReadStatusPageOwnerTeam = "ReadStatusPageOwnerTeam",

  CreateStatusPageOwnerUser = "CreateStatusPageOwner",
  DeleteStatusPageOwnerUser = "DeleteStatusPageOwnerUser",
  EditStatusPageOwnerUser = "EditStatusPageOwnerUser",
  ReadStatusPageOwnerUser = "ReadStatusPageOwnerUser",

  CreateServiceOwnerTeam = "CreateServiceOwnerTeam",
  DeleteServiceOwnerTeam = "DeleteServiceOwnerTeam",
  EditServiceOwnerTeam = "EditServiceOwnerTeam",
  ReadServiceOwnerTeam = "ReadServiceOwnerTeam",

  CreateServiceOwnerUser = "CreateServiceOwnerUser",
  DeleteServiceOwnerUser = "DeleteServiceOwnerUser",
  EditServiceOwnerUser = "EditServiceOwnerUser",
  ReadServiceOwnerUser = "ReadServiceOwnerUser",

  CreateMonitorOwnerTeam = "CreateMonitorOwnerTeam",
  DeleteMonitorOwnerTeam = "DeleteMonitorOwnerTeam",
  EditMonitorOwnerTeam = "EditMonitorOwnerTeam",
  ReadMonitorOwnerTeam = "ReadMonitorOwnerTeam",

  CreateMonitorOwnerUser = "CreateMonitorOwner",
  DeleteMonitorOwnerUser = "DeleteMonitorOwnerUser",
  EditMonitorOwnerUser = "EditMonitorOwnerUser",
  ReadMonitorOwnerUser = "ReadMonitorOwnerUser",

  // Monitor Owner Rule Permissions
  CreateMonitorOwnerRule = "CreateMonitorOwnerRule",
  DeleteMonitorOwnerRule = "DeleteMonitorOwnerRule",
  EditMonitorOwnerRule = "EditMonitorOwnerRule",
  ReadMonitorOwnerRule = "ReadMonitorOwnerRule",

  // Monitor Label Rule Permissions
  CreateMonitorLabelRule = "CreateMonitorLabelRule",
  DeleteMonitorLabelRule = "DeleteMonitorLabelRule",
  EditMonitorLabelRule = "EditMonitorLabelRule",
  ReadMonitorLabelRule = "ReadMonitorLabelRule",

  // Status Page Owner Rule Permissions
  CreateStatusPageOwnerRule = "CreateStatusPageOwnerRule",
  DeleteStatusPageOwnerRule = "DeleteStatusPageOwnerRule",
  EditStatusPageOwnerRule = "EditStatusPageOwnerRule",
  ReadStatusPageOwnerRule = "ReadStatusPageOwnerRule",

  // Status Page Label Rule Permissions
  CreateStatusPageLabelRule = "CreateStatusPageLabelRule",
  DeleteStatusPageLabelRule = "DeleteStatusPageLabelRule",
  EditStatusPageLabelRule = "EditStatusPageLabelRule",
  ReadStatusPageLabelRule = "ReadStatusPageLabelRule",

  // Host Owner Rule Permissions
  CreateHostOwnerRule = "CreateHostOwnerRule",
  DeleteHostOwnerRule = "DeleteHostOwnerRule",
  EditHostOwnerRule = "EditHostOwnerRule",
  ReadHostOwnerRule = "ReadHostOwnerRule",

  // Host Label Rule Permissions
  CreateHostLabelRule = "CreateHostLabelRule",
  DeleteHostLabelRule = "DeleteHostLabelRule",
  EditHostLabelRule = "EditHostLabelRule",
  ReadHostLabelRule = "ReadHostLabelRule",

  // Service Owner Rule Permissions
  CreateServiceOwnerRule = "CreateServiceOwnerRule",
  DeleteServiceOwnerRule = "DeleteServiceOwnerRule",
  EditServiceOwnerRule = "EditServiceOwnerRule",
  ReadServiceOwnerRule = "ReadServiceOwnerRule",

  // Service Label Rule Permissions
  CreateServiceLabelRule = "CreateServiceLabelRule",
  DeleteServiceLabelRule = "DeleteServiceLabelRule",
  EditServiceLabelRule = "EditServiceLabelRule",
  ReadServiceLabelRule = "ReadServiceLabelRule",

  // Docker Host Owner Rule Permissions
  CreateDockerHostOwnerRule = "CreateDockerHostOwnerRule",
  DeleteDockerHostOwnerRule = "DeleteDockerHostOwnerRule",
  EditDockerHostOwnerRule = "EditDockerHostOwnerRule",
  ReadDockerHostOwnerRule = "ReadDockerHostOwnerRule",

  // Docker Host Label Rule Permissions
  CreateDockerHostLabelRule = "CreateDockerHostLabelRule",
  DeleteDockerHostLabelRule = "DeleteDockerHostLabelRule",
  EditDockerHostLabelRule = "EditDockerHostLabelRule",
  ReadDockerHostLabelRule = "ReadDockerHostLabelRule",

  // Kubernetes Cluster Owner Rule Permissions
  CreateKubernetesClusterOwnerRule = "CreateKubernetesClusterOwnerRule",
  DeleteKubernetesClusterOwnerRule = "DeleteKubernetesClusterOwnerRule",
  EditKubernetesClusterOwnerRule = "EditKubernetesClusterOwnerRule",
  ReadKubernetesClusterOwnerRule = "ReadKubernetesClusterOwnerRule",

  // Kubernetes Cluster Label Rule Permissions
  CreateKubernetesClusterLabelRule = "CreateKubernetesClusterLabelRule",
  DeleteKubernetesClusterLabelRule = "DeleteKubernetesClusterLabelRule",
  EditKubernetesClusterLabelRule = "EditKubernetesClusterLabelRule",
  ReadKubernetesClusterLabelRule = "ReadKubernetesClusterLabelRule",

  // Runbook Owner Rule Permissions
  CreateRunbookOwnerRule = "CreateRunbookOwnerRule",
  DeleteRunbookOwnerRule = "DeleteRunbookOwnerRule",
  EditRunbookOwnerRule = "EditRunbookOwnerRule",
  ReadRunbookOwnerRule = "ReadRunbookOwnerRule",

  // Runbook Label Rule Permissions
  CreateRunbookLabelRule = "CreateRunbookLabelRule",
  DeleteRunbookLabelRule = "DeleteRunbookLabelRule",
  EditRunbookLabelRule = "EditRunbookLabelRule",
  ReadRunbookLabelRule = "ReadRunbookLabelRule",

  // Dashboard Owner Permissions
  CreateDashboardOwnerTeam = "CreateDashboardOwnerTeam",
  DeleteDashboardOwnerTeam = "DeleteDashboardOwnerTeam",
  EditDashboardOwnerTeam = "EditDashboardOwnerTeam",
  ReadDashboardOwnerTeam = "ReadDashboardOwnerTeam",

  CreateDashboardOwnerUser = "CreateDashboardOwnerUser",
  DeleteDashboardOwnerUser = "DeleteDashboardOwnerUser",
  EditDashboardOwnerUser = "EditDashboardOwnerUser",
  ReadDashboardOwnerUser = "ReadDashboardOwnerUser",

  // Dashboard Owner Rule Permissions
  CreateDashboardOwnerRule = "CreateDashboardOwnerRule",
  DeleteDashboardOwnerRule = "DeleteDashboardOwnerRule",
  EditDashboardOwnerRule = "EditDashboardOwnerRule",
  ReadDashboardOwnerRule = "ReadDashboardOwnerRule",

  // Dashboard Label Rule Permissions
  CreateDashboardLabelRule = "CreateDashboardLabelRule",
  DeleteDashboardLabelRule = "DeleteDashboardLabelRule",
  EditDashboardLabelRule = "EditDashboardLabelRule",
  ReadDashboardLabelRule = "ReadDashboardLabelRule",

  // Workflow Owner Permissions
  CreateWorkflowOwnerTeam = "CreateWorkflowOwnerTeam",
  DeleteWorkflowOwnerTeam = "DeleteWorkflowOwnerTeam",
  EditWorkflowOwnerTeam = "EditWorkflowOwnerTeam",
  ReadWorkflowOwnerTeam = "ReadWorkflowOwnerTeam",

  CreateWorkflowOwnerUser = "CreateWorkflowOwnerUser",
  DeleteWorkflowOwnerUser = "DeleteWorkflowOwnerUser",
  EditWorkflowOwnerUser = "EditWorkflowOwnerUser",
  ReadWorkflowOwnerUser = "ReadWorkflowOwnerUser",

  // Workflow Owner Rule Permissions
  CreateWorkflowOwnerRule = "CreateWorkflowOwnerRule",
  DeleteWorkflowOwnerRule = "DeleteWorkflowOwnerRule",
  EditWorkflowOwnerRule = "EditWorkflowOwnerRule",
  ReadWorkflowOwnerRule = "ReadWorkflowOwnerRule",

  // Workflow Label Rule Permissions
  CreateWorkflowLabelRule = "CreateWorkflowLabelRule",
  DeleteWorkflowLabelRule = "DeleteWorkflowLabelRule",
  EditWorkflowLabelRule = "EditWorkflowLabelRule",
  ReadWorkflowLabelRule = "ReadWorkflowLabelRule",

  CreateOnCallDutyPolicyOwnerTeam = "CreateOnCallDutyPolicyOwnerTeam",
  DeleteOnCallDutyPolicyOwnerTeam = "DeleteOnCallDutyPolicyOwnerTeam",
  EditOnCallDutyPolicyOwnerTeam = "EditOnCallDutyPolicyOwnerTeam",
  ReadOnCallDutyPolicyOwnerTeam = "ReadOnCallDutyPolicyOwnerTeam",

  CreateOnCallDutyPolicyOwnerUser = "CreateOnCallDutyPolicyOwner",
  DeleteOnCallDutyPolicyOwnerUser = "DeleteOnCallDutyPolicyOwnerUser",
  EditOnCallDutyPolicyOwnerUser = "EditOnCallDutyPolicyOwnerUser",
  ReadOnCallDutyPolicyOwnerUser = "ReadOnCallDutyPolicyOwnerUser",

  CreateOnCallDutyPolicyScheduleOwnerTeam = "CreateOnCallDutyPolicyScheduleOwnerTeam",
  DeleteOnCallDutyPolicyScheduleOwnerTeam = "DeleteOnCallDutyPolicyScheduleOwnerTeam",
  EditOnCallDutyPolicyScheduleOwnerTeam = "EditOnCallDutyPolicyScheduleOwnerTeam",
  ReadOnCallDutyPolicyScheduleOwnerTeam = "ReadOnCallDutyPolicyScheduleOwnerTeam",

  CreateOnCallDutyPolicyScheduleOwnerUser = "CreateOnCallDutyPolicyScheduleOwnerUser",
  DeleteOnCallDutyPolicyScheduleOwnerUser = "DeleteOnCallDutyPolicyScheduleOwnerUser",
  EditOnCallDutyPolicyScheduleOwnerUser = "EditOnCallDutyPolicyScheduleOwnerUser",
  ReadOnCallDutyPolicyScheduleOwnerUser = "ReadOnCallDutyPolicyScheduleOwnerUser",

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

  CreateTeamMemberCustomField = "CreateTeamMemberCustomField",
  DeleteTeamMemberCustomField = "DeleteTeamMemberCustomField",
  EditTeamMemberCustomField = "EditTeamMemberCustomField",
  ReadTeamMemberCustomField = "ReadTeamMemberCustomField",

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

  ReadAuditLog = "ReadAuditLog",

  CreateWorkflowVariable = "CreateWorkflowVariable",
  DeleteWorkflowVariable = "DeleteWorkflowVariable",
  EditWorkflowVariable = "EditWorkflowVariable",
  ReadWorkflowVariable = "ReadWorkflowVariable",

  CreateRunbook = "CreateRunbook",
  DeleteRunbook = "DeleteRunbook",
  EditRunbook = "EditRunbook",
  ReadRunbook = "ReadRunbook",

  CreateRunbookExecution = "CreateRunbookExecution",
  DeleteRunbookExecution = "DeleteRunbookExecution",
  EditRunbookExecution = "EditRunbookExecution",
  ReadRunbookExecution = "ReadRunbookExecution",

  CreateRunbookRule = "CreateRunbookRule",
  DeleteRunbookRule = "DeleteRunbookRule",
  EditRunbookRule = "EditRunbookRule",
  ReadRunbookRule = "ReadRunbookRule",

  CreateRunbookOwnerTeam = "CreateRunbookOwnerTeam",
  DeleteRunbookOwnerTeam = "DeleteRunbookOwnerTeam",
  EditRunbookOwnerTeam = "EditRunbookOwnerTeam",
  ReadRunbookOwnerTeam = "ReadRunbookOwnerTeam",

  CreateRunbookOwnerUser = "CreateRunbookOwnerUser",
  DeleteRunbookOwnerUser = "DeleteRunbookOwnerUser",
  EditRunbookOwnerUser = "EditRunbookOwnerUser",
  ReadRunbookOwnerUser = "ReadRunbookOwnerUser",

  CreateRunbookAgent = "CreateRunbookAgent",
  DeleteRunbookAgent = "DeleteRunbookAgent",
  EditRunbookAgent = "EditRunbookAgent",
  ReadRunbookAgent = "ReadRunbookAgent",

  CreateRunbookAgentOwnerTeam = "CreateRunbookAgentOwnerTeam",
  DeleteRunbookAgentOwnerTeam = "DeleteRunbookAgentOwnerTeam",
  EditRunbookAgentOwnerTeam = "EditRunbookAgentOwnerTeam",
  ReadRunbookAgentOwnerTeam = "ReadRunbookAgentOwnerTeam",

  CreateRunbookAgentOwnerUser = "CreateRunbookAgentOwnerUser",
  DeleteRunbookAgentOwnerUser = "DeleteRunbookAgentOwnerUser",
  EditRunbookAgentOwnerUser = "EditRunbookAgentOwnerUser",
  ReadRunbookAgentOwnerUser = "ReadRunbookAgentOwnerUser",

  CreateRunbookSecret = "CreateRunbookSecret",
  EditRunbookSecret = "EditRunbookSecret",
  DeleteRunbookSecret = "DeleteRunbookSecret",
  ReadRunbookSecret = "ReadRunbookSecret",

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

  CreateProjectOIDC = "CreateProjectOIDC",
  DeleteProjectOIDC = "DeleteProjectOIDC",
  EditProjectOIDC = "EditProjectOIDC",
  ReadProjectOIDC = "ReadProjectOIDC",

  CreateStatusPageSSO = "CreateStatusPageSSO",
  DeleteStatusPageSSO = "DeleteStatusPageSSO",
  EditStatusPageSSO = "EditStatusPageSSO",
  ReadStatusPageSSO = "ReadStatusPageSSO",

  CreateStatusPageOIDC = "CreateStatusPageOIDC",
  DeleteStatusPageOIDC = "DeleteStatusPageOIDC",
  EditStatusPageOIDC = "EditStatusPageOIDC",
  ReadStatusPageOIDC = "ReadStatusPageOIDC",

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

  CreateMonitorTemplate = "CreateMonitorTemplate",
  DeleteMonitorTemplate = "DeleteMonitorTemplate",
  EditMonitorTemplate = "EditMonitorTemplate",
  ReadMonitorTemplate = "ReadMonitorTemplate",

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

  // Incoming Call Policy Permissions
  CreateProjectIncomingCallPolicy = "CreateProjectIncomingCallPolicy",
  EditProjectIncomingCallPolicy = "EditProjectIncomingCallPolicy",
  DeleteProjectIncomingCallPolicy = "DeleteProjectIncomingCallPolicy",
  ReadProjectIncomingCallPolicy = "ReadProjectIncomingCallPolicy",

  // Incoming Call Policy Escalation Rule Permissions
  CreateProjectIncomingCallPolicyEscalationRule = "CreateProjectIncomingCallPolicyEscalationRule",
  EditProjectIncomingCallPolicyEscalationRule = "EditProjectIncomingCallPolicyEscalationRule",
  DeleteProjectIncomingCallPolicyEscalationRule = "DeleteProjectIncomingCallPolicyEscalationRule",
  ReadProjectIncomingCallPolicyEscalationRule = "ReadProjectIncomingCallPolicyEscalationRule",

  // Incoming Call Policy Owner Permissions
  CreateIncomingCallPolicyOwnerTeam = "CreateIncomingCallPolicyOwnerTeam",
  DeleteIncomingCallPolicyOwnerTeam = "DeleteIncomingCallPolicyOwnerTeam",
  EditIncomingCallPolicyOwnerTeam = "EditIncomingCallPolicyOwnerTeam",
  ReadIncomingCallPolicyOwnerTeam = "ReadIncomingCallPolicyOwnerTeam",

  CreateIncomingCallPolicyOwnerUser = "CreateIncomingCallPolicyOwnerUser",
  DeleteIncomingCallPolicyOwnerUser = "DeleteIncomingCallPolicyOwnerUser",
  EditIncomingCallPolicyOwnerUser = "EditIncomingCallPolicyOwnerUser",
  ReadIncomingCallPolicyOwnerUser = "ReadIncomingCallPolicyOwnerUser",

  // On-Call Duty Policy Label Rule Permissions
  CreateOnCallDutyPolicyLabelRule = "CreateOnCallDutyPolicyLabelRule",
  DeleteOnCallDutyPolicyLabelRule = "DeleteOnCallDutyPolicyLabelRule",
  EditOnCallDutyPolicyLabelRule = "EditOnCallDutyPolicyLabelRule",
  ReadOnCallDutyPolicyLabelRule = "ReadOnCallDutyPolicyLabelRule",

  // On-Call Duty Policy Owner Rule Permissions
  CreateOnCallDutyPolicyOwnerRule = "CreateOnCallDutyPolicyOwnerRule",
  DeleteOnCallDutyPolicyOwnerRule = "DeleteOnCallDutyPolicyOwnerRule",
  EditOnCallDutyPolicyOwnerRule = "EditOnCallDutyPolicyOwnerRule",
  ReadOnCallDutyPolicyOwnerRule = "ReadOnCallDutyPolicyOwnerRule",

  // On-Call Duty Schedule Label Rule Permissions
  CreateOnCallDutyPolicyScheduleLabelRule = "CreateOnCallDutyPolicyScheduleLabelRule",
  DeleteOnCallDutyPolicyScheduleLabelRule = "DeleteOnCallDutyPolicyScheduleLabelRule",
  EditOnCallDutyPolicyScheduleLabelRule = "EditOnCallDutyPolicyScheduleLabelRule",
  ReadOnCallDutyPolicyScheduleLabelRule = "ReadOnCallDutyPolicyScheduleLabelRule",

  // On-Call Duty Schedule Owner Rule Permissions
  CreateOnCallDutyPolicyScheduleOwnerRule = "CreateOnCallDutyPolicyScheduleOwnerRule",
  DeleteOnCallDutyPolicyScheduleOwnerRule = "DeleteOnCallDutyPolicyScheduleOwnerRule",
  EditOnCallDutyPolicyScheduleOwnerRule = "EditOnCallDutyPolicyScheduleOwnerRule",
  ReadOnCallDutyPolicyScheduleOwnerRule = "ReadOnCallDutyPolicyScheduleOwnerRule",

  // Incoming Call Policy Label Rule Permissions
  CreateIncomingCallPolicyLabelRule = "CreateIncomingCallPolicyLabelRule",
  DeleteIncomingCallPolicyLabelRule = "DeleteIncomingCallPolicyLabelRule",
  EditIncomingCallPolicyLabelRule = "EditIncomingCallPolicyLabelRule",
  ReadIncomingCallPolicyLabelRule = "ReadIncomingCallPolicyLabelRule",

  // Incoming Call Policy Owner Rule Permissions
  CreateIncomingCallPolicyOwnerRule = "CreateIncomingCallPolicyOwnerRule",
  DeleteIncomingCallPolicyOwnerRule = "DeleteIncomingCallPolicyOwnerRule",
  EditIncomingCallPolicyOwnerRule = "EditIncomingCallPolicyOwnerRule",
  ReadIncomingCallPolicyOwnerRule = "ReadIncomingCallPolicyOwnerRule",

  // Incoming Call Log Permissions
  ReadProjectIncomingCallLog = "ReadProjectIncomingCallLog",

  // Incoming Call Log Item Permissions
  ReadProjectIncomingCallLogItem = "ReadProjectIncomingCallLogItem",

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

  CreateKubernetesCluster = "CreateKubernetesCluster",
  DeleteKubernetesCluster = "DeleteKubernetesCluster",
  EditKubernetesCluster = "EditKubernetesCluster",
  ReadKubernetesCluster = "ReadKubernetesCluster",

  CreateKubernetesClusterOwnerTeam = "CreateKubernetesClusterOwnerTeam",
  DeleteKubernetesClusterOwnerTeam = "DeleteKubernetesClusterOwnerTeam",
  EditKubernetesClusterOwnerTeam = "EditKubernetesClusterOwnerTeam",
  ReadKubernetesClusterOwnerTeam = "ReadKubernetesClusterOwnerTeam",

  CreateKubernetesClusterOwnerUser = "CreateKubernetesClusterOwnerUser",
  DeleteKubernetesClusterOwnerUser = "DeleteKubernetesClusterOwnerUser",
  EditKubernetesClusterOwnerUser = "EditKubernetesClusterOwnerUser",
  ReadKubernetesClusterOwnerUser = "ReadKubernetesClusterOwnerUser",

  CreateDockerHost = "CreateDockerHost",
  DeleteDockerHost = "DeleteDockerHost",
  EditDockerHost = "EditDockerHost",
  ReadDockerHost = "ReadDockerHost",

  CreateDockerHostOwnerTeam = "CreateDockerHostOwnerTeam",
  DeleteDockerHostOwnerTeam = "DeleteDockerHostOwnerTeam",
  EditDockerHostOwnerTeam = "EditDockerHostOwnerTeam",
  ReadDockerHostOwnerTeam = "ReadDockerHostOwnerTeam",

  CreateDockerHostOwnerUser = "CreateDockerHostOwnerUser",
  DeleteDockerHostOwnerUser = "DeleteDockerHostOwnerUser",
  EditDockerHostOwnerUser = "EditDockerHostOwnerUser",
  ReadDockerHostOwnerUser = "ReadDockerHostOwnerUser",

  CreateHost = "CreateHost",
  DeleteHost = "DeleteHost",
  EditHost = "EditHost",
  ReadHost = "ReadHost",

  CreateHostOwnerTeam = "CreateHostOwnerTeam",
  DeleteHostOwnerTeam = "DeleteHostOwnerTeam",
  EditHostOwnerTeam = "EditHostOwnerTeam",
  ReadHostOwnerTeam = "ReadHostOwnerTeam",

  CreateHostOwnerUser = "CreateHostOwnerUser",
  DeleteHostOwnerUser = "DeleteHostOwnerUser",
  EditHostOwnerUser = "EditHostOwnerUser",
  ReadHostOwnerUser = "ReadHostOwnerUser",

  CreateService = "CreateService",
  DeleteService = "DeleteService",
  EditService = "EditService",
  ReadService = "ReadService",

  CreateServiceMonitor = "CreateServiceMonitor",
  DeleteServiceMonitor = "DeleteServiceMonitor",
  EditServiceMonitor = "EditServiceMonitor",
  ReadServiceMonitor = "ReadServiceMonitor",

  CreateServiceTelemetryService = "CreateServiceTelemetryService",
  DeleteServiceTelemetryService = "DeleteServiceTelemetryService",
  EditServiceTelemetryService = "EditServiceTelemetryService",
  ReadServiceTelemetryService = "ReadServiceTelemetryService",

  CreateServiceCodeRepository = "CreateServiceCodeRepository",
  DeleteServiceCodeRepository = "DeleteServiceCodeRepository",
  EditServiceCodeRepository = "EditServiceCodeRepository",
  ReadServiceCodeRepository = "ReadServiceCodeRepository",

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

  CreateAIAgentOwnerTeam = "CreateAIAgentOwnerTeam",
  DeleteAIAgentOwnerTeam = "DeleteAIAgentOwnerTeam",
  EditAIAgentOwnerTeam = "EditAIAgentOwnerTeam",
  ReadAIAgentOwnerTeam = "ReadAIAgentOwnerTeam",

  CreateAIAgentOwnerUser = "CreateAIAgentOwnerUser",
  DeleteAIAgentOwnerUser = "DeleteAIAgentOwnerUser",
  EditAIAgentOwnerUser = "EditAIAgentOwnerUser",
  ReadAIAgentOwnerUser = "ReadAIAgentOwnerUser",

  CreateTableView = "CreateTableView",
  DeleteTableView = "DeleteTableView",
  EditTableView = "EditTableView",
  ReadTableView = "ReadTableView",

  CreateWorkspaceNotificationRule = "CreateWorkspaceNotificationRule",
  DeleteWorkspaceNotificationRule = "DeleteWorkspaceNotificationRule",
  EditWorkspaceNotificationRule = "EditWorkspaceNotificationRule",
  ReadWorkspaceNotificationRule = "ReadWorkspaceNotificationRule",

  CreateWorkspaceNotificationSummary = "CreateWorkspaceNotificationSummary",
  DeleteWorkspaceNotificationSummary = "DeleteWorkspaceNotificationSummary",
  EditWorkspaceNotificationSummary = "EditWorkspaceNotificationSummary",
  ReadWorkspaceNotificationSummary = "ReadWorkspaceNotificationSummary",

  // Alert Episode Permissions
  CreateAlertEpisode = "CreateAlertEpisode",
  DeleteAlertEpisode = "DeleteAlertEpisode",
  EditAlertEpisode = "EditAlertEpisode",
  ReadAlertEpisode = "ReadAlertEpisode",

  // Alert Episode Member Permissions
  CreateAlertEpisodeMember = "CreateAlertEpisodeMember",
  DeleteAlertEpisodeMember = "DeleteAlertEpisodeMember",
  EditAlertEpisodeMember = "EditAlertEpisodeMember",
  ReadAlertEpisodeMember = "ReadAlertEpisodeMember",

  // Alert Grouping Rule Permissions
  CreateAlertGroupingRule = "CreateAlertGroupingRule",
  DeleteAlertGroupingRule = "DeleteAlertGroupingRule",
  EditAlertGroupingRule = "EditAlertGroupingRule",
  ReadAlertGroupingRule = "ReadAlertGroupingRule",

  // Alert On-Call Rule Permissions
  CreateAlertOnCallRule = "CreateAlertOnCallRule",
  DeleteAlertOnCallRule = "DeleteAlertOnCallRule",
  EditAlertOnCallRule = "EditAlertOnCallRule",
  ReadAlertOnCallRule = "ReadAlertOnCallRule",

  // Alert Owner Rule Permissions
  CreateAlertOwnerRule = "CreateAlertOwnerRule",
  DeleteAlertOwnerRule = "DeleteAlertOwnerRule",
  EditAlertOwnerRule = "EditAlertOwnerRule",
  ReadAlertOwnerRule = "ReadAlertOwnerRule",

  CreateAlertPrivacyRule = "CreateAlertPrivacyRule",
  DeleteAlertPrivacyRule = "DeleteAlertPrivacyRule",
  EditAlertPrivacyRule = "EditAlertPrivacyRule",
  ReadAlertPrivacyRule = "ReadAlertPrivacyRule",

  // Alert Episode On-Call Rule Permissions
  CreateAlertEpisodeOnCallRule = "CreateAlertEpisodeOnCallRule",
  DeleteAlertEpisodeOnCallRule = "DeleteAlertEpisodeOnCallRule",
  EditAlertEpisodeOnCallRule = "EditAlertEpisodeOnCallRule",
  ReadAlertEpisodeOnCallRule = "ReadAlertEpisodeOnCallRule",

  // Alert Episode Owner Rule Permissions
  CreateAlertEpisodeOwnerRule = "CreateAlertEpisodeOwnerRule",
  DeleteAlertEpisodeOwnerRule = "DeleteAlertEpisodeOwnerRule",
  EditAlertEpisodeOwnerRule = "EditAlertEpisodeOwnerRule",
  ReadAlertEpisodeOwnerRule = "ReadAlertEpisodeOwnerRule",

  CreateAlertEpisodePrivacyRule = "CreateAlertEpisodePrivacyRule",
  DeleteAlertEpisodePrivacyRule = "DeleteAlertEpisodePrivacyRule",
  EditAlertEpisodePrivacyRule = "EditAlertEpisodePrivacyRule",
  ReadAlertEpisodePrivacyRule = "ReadAlertEpisodePrivacyRule",

  // Alert Label Rule Permissions
  CreateAlertLabelRule = "CreateAlertLabelRule",
  DeleteAlertLabelRule = "DeleteAlertLabelRule",
  EditAlertLabelRule = "EditAlertLabelRule",
  ReadAlertLabelRule = "ReadAlertLabelRule",

  // Alert Episode Label Rule Permissions
  CreateAlertEpisodeLabelRule = "CreateAlertEpisodeLabelRule",
  DeleteAlertEpisodeLabelRule = "DeleteAlertEpisodeLabelRule",
  EditAlertEpisodeLabelRule = "EditAlertEpisodeLabelRule",
  ReadAlertEpisodeLabelRule = "ReadAlertEpisodeLabelRule",

  // Alert Episode State Timeline Permissions
  CreateAlertEpisodeStateTimeline = "CreateAlertEpisodeStateTimeline",
  DeleteAlertEpisodeStateTimeline = "DeleteAlertEpisodeStateTimeline",
  EditAlertEpisodeStateTimeline = "EditAlertEpisodeStateTimeline",
  ReadAlertEpisodeStateTimeline = "ReadAlertEpisodeStateTimeline",

  // Alert Episode Owner User Permissions
  CreateAlertEpisodeOwnerUser = "CreateAlertEpisodeOwnerUser",
  DeleteAlertEpisodeOwnerUser = "DeleteAlertEpisodeOwnerUser",
  EditAlertEpisodeOwnerUser = "EditAlertEpisodeOwnerUser",
  ReadAlertEpisodeOwnerUser = "ReadAlertEpisodeOwnerUser",

  // Alert Episode Owner Team Permissions
  CreateAlertEpisodeOwnerTeam = "CreateAlertEpisodeOwnerTeam",
  DeleteAlertEpisodeOwnerTeam = "DeleteAlertEpisodeOwnerTeam",
  EditAlertEpisodeOwnerTeam = "EditAlertEpisodeOwnerTeam",
  ReadAlertEpisodeOwnerTeam = "ReadAlertEpisodeOwnerTeam",

  // Alert Episode Internal Note Permissions
  CreateAlertEpisodeInternalNote = "CreateAlertEpisodeInternalNote",
  DeleteAlertEpisodeInternalNote = "DeleteAlertEpisodeInternalNote",
  EditAlertEpisodeInternalNote = "EditAlertEpisodeInternalNote",
  ReadAlertEpisodeInternalNote = "ReadAlertEpisodeInternalNote",

  // Alert Episode Feed Permissions
  CreateAlertEpisodeFeed = "CreateAlertEpisodeFeed",
  EditAlertEpisodeFeed = "EditAlertEpisodeFeed",
  ReadAlertEpisodeFeed = "ReadAlertEpisodeFeed",

  // Incident Episode Permissions
  CreateIncidentEpisode = "CreateIncidentEpisode",
  DeleteIncidentEpisode = "DeleteIncidentEpisode",
  EditIncidentEpisode = "EditIncidentEpisode",
  ReadIncidentEpisode = "ReadIncidentEpisode",

  // Incident Episode Member Permissions
  CreateIncidentEpisodeMember = "CreateIncidentEpisodeMember",
  DeleteIncidentEpisodeMember = "DeleteIncidentEpisodeMember",
  EditIncidentEpisodeMember = "EditIncidentEpisodeMember",
  ReadIncidentEpisodeMember = "ReadIncidentEpisodeMember",

  // Incident Episode State Timeline Permissions
  CreateIncidentEpisodeStateTimeline = "CreateIncidentEpisodeStateTimeline",
  DeleteIncidentEpisodeStateTimeline = "DeleteIncidentEpisodeStateTimeline",
  EditIncidentEpisodeStateTimeline = "EditIncidentEpisodeStateTimeline",
  ReadIncidentEpisodeStateTimeline = "ReadIncidentEpisodeStateTimeline",

  // Incident Episode Owner User Permissions
  CreateIncidentEpisodeOwnerUser = "CreateIncidentEpisodeOwnerUser",
  DeleteIncidentEpisodeOwnerUser = "DeleteIncidentEpisodeOwnerUser",
  EditIncidentEpisodeOwnerUser = "EditIncidentEpisodeOwnerUser",
  ReadIncidentEpisodeOwnerUser = "ReadIncidentEpisodeOwnerUser",

  // Incident Episode Owner Team Permissions
  CreateIncidentEpisodeOwnerTeam = "CreateIncidentEpisodeOwnerTeam",
  DeleteIncidentEpisodeOwnerTeam = "DeleteIncidentEpisodeOwnerTeam",
  EditIncidentEpisodeOwnerTeam = "EditIncidentEpisodeOwnerTeam",
  ReadIncidentEpisodeOwnerTeam = "ReadIncidentEpisodeOwnerTeam",

  // Incident Episode Internal Note Permissions
  CreateIncidentEpisodeInternalNote = "CreateIncidentEpisodeInternalNote",
  DeleteIncidentEpisodeInternalNote = "DeleteIncidentEpisodeInternalNote",
  EditIncidentEpisodeInternalNote = "EditIncidentEpisodeInternalNote",
  ReadIncidentEpisodeInternalNote = "ReadIncidentEpisodeInternalNote",

  // Incident Episode Feed Permissions
  CreateIncidentEpisodeFeed = "CreateIncidentEpisodeFeed",
  EditIncidentEpisodeFeed = "EditIncidentEpisodeFeed",
  ReadIncidentEpisodeFeed = "ReadIncidentEpisodeFeed",

  // Incident Episode Public Note Permissions
  CreateIncidentEpisodePublicNote = "CreateIncidentEpisodePublicNote",
  DeleteIncidentEpisodePublicNote = "DeleteIncidentEpisodePublicNote",
  EditIncidentEpisodePublicNote = "EditIncidentEpisodePublicNote",
  ReadIncidentEpisodePublicNote = "ReadIncidentEpisodePublicNote",

  // Incident Grouping Rule Permissions
  CreateIncidentGroupingRule = "CreateIncidentGroupingRule",
  DeleteIncidentGroupingRule = "DeleteIncidentGroupingRule",
  EditIncidentGroupingRule = "EditIncidentGroupingRule",
  ReadIncidentGroupingRule = "ReadIncidentGroupingRule",

  // Incident On-Call Rule Permissions
  CreateIncidentOnCallRule = "CreateIncidentOnCallRule",
  DeleteIncidentOnCallRule = "DeleteIncidentOnCallRule",
  EditIncidentOnCallRule = "EditIncidentOnCallRule",
  ReadIncidentOnCallRule = "ReadIncidentOnCallRule",

  // Incident Owner Rule Permissions
  CreateIncidentOwnerRule = "CreateIncidentOwnerRule",
  DeleteIncidentOwnerRule = "DeleteIncidentOwnerRule",
  EditIncidentOwnerRule = "EditIncidentOwnerRule",
  ReadIncidentOwnerRule = "ReadIncidentOwnerRule",

  CreateIncidentPrivacyRule = "CreateIncidentPrivacyRule",
  DeleteIncidentPrivacyRule = "DeleteIncidentPrivacyRule",
  EditIncidentPrivacyRule = "EditIncidentPrivacyRule",
  ReadIncidentPrivacyRule = "ReadIncidentPrivacyRule",

  // Incident Episode On-Call Rule Permissions
  CreateIncidentEpisodeOnCallRule = "CreateIncidentEpisodeOnCallRule",
  DeleteIncidentEpisodeOnCallRule = "DeleteIncidentEpisodeOnCallRule",
  EditIncidentEpisodeOnCallRule = "EditIncidentEpisodeOnCallRule",
  ReadIncidentEpisodeOnCallRule = "ReadIncidentEpisodeOnCallRule",

  // Incident Episode Owner Rule Permissions
  CreateIncidentEpisodeOwnerRule = "CreateIncidentEpisodeOwnerRule",
  DeleteIncidentEpisodeOwnerRule = "DeleteIncidentEpisodeOwnerRule",
  EditIncidentEpisodeOwnerRule = "EditIncidentEpisodeOwnerRule",
  ReadIncidentEpisodeOwnerRule = "ReadIncidentEpisodeOwnerRule",

  CreateIncidentEpisodePrivacyRule = "CreateIncidentEpisodePrivacyRule",
  DeleteIncidentEpisodePrivacyRule = "DeleteIncidentEpisodePrivacyRule",
  EditIncidentEpisodePrivacyRule = "EditIncidentEpisodePrivacyRule",
  ReadIncidentEpisodePrivacyRule = "ReadIncidentEpisodePrivacyRule",

  // Incident Label Rule Permissions
  CreateIncidentLabelRule = "CreateIncidentLabelRule",
  DeleteIncidentLabelRule = "DeleteIncidentLabelRule",
  EditIncidentLabelRule = "EditIncidentLabelRule",
  ReadIncidentLabelRule = "ReadIncidentLabelRule",

  // Incident Episode Label Rule Permissions
  CreateIncidentEpisodeLabelRule = "CreateIncidentEpisodeLabelRule",
  DeleteIncidentEpisodeLabelRule = "DeleteIncidentEpisodeLabelRule",
  EditIncidentEpisodeLabelRule = "EditIncidentEpisodeLabelRule",
  ReadIncidentEpisodeLabelRule = "ReadIncidentEpisodeLabelRule",

  // Incident SLA Rule Permissions
  CreateIncidentSlaRule = "CreateIncidentSlaRule",
  DeleteIncidentSlaRule = "DeleteIncidentSlaRule",
  EditIncidentSlaRule = "EditIncidentSlaRule",
  ReadIncidentSlaRule = "ReadIncidentSlaRule",

  // Incident SLA Permissions
  CreateIncidentSla = "CreateIncidentSla",
  DeleteIncidentSla = "DeleteIncidentSla",
  EditIncidentSla = "EditIncidentSla",
  ReadIncidentSla = "ReadIncidentSla",

  /*
   * Wildcard permissions covering all models marked @OperationalResource().
   * These short-circuit table-level checks for that resource class. Scope on
   * the TeamPermission row still applies (All / Owned / Labels).
   */
  ReadAllOperationalResources = "ReadAllOperationalResources",
  EditAllOperationalResources = "EditAllOperationalResources",
  DeleteAllOperationalResources = "DeleteAllOperationalResources",
  CreateAllOperationalResources = "CreateAllOperationalResources",
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

  public static getRolePermissionProps(): Array<PermissionProps> {
    return this.getTenantPermissionProps().filter((item: PermissionProps) => {
      return item.isRolePermission;
    });
  }

  public static getAccessControlPermissionProps(): Array<PermissionProps> {
    return this.getAllPermissionProps().filter((item: PermissionProps) => {
      return item.isAccessControlPermission;
    });
  }

  /*
   * Returns true when a permission can meaningfully be scoped by All / Owned /
   * Labels. Some roles are unconditional project-wide grants — scoping them
   * would create confusing semantics ("Settings Admin but only for owned
   * settings" doesn't compute since settings aren't @OperationalResource).
   * UI hides the scope picker for these; the runtime filter also treats a
   * stray Owned-scoped row of one of these as a broader grant so access
   * isn't accidentally narrowed.
   */
  public static isScopeApplicable(permission: Permission): boolean {
    return (
      permission !== Permission.ProjectOwner &&
      permission !== Permission.ProjectAdmin &&
      permission !== Permission.SettingsAdmin &&
      permission !== Permission.SettingsMember &&
      permission !== Permission.SettingsViewer &&
      permission !== Permission.BillingAdmin &&
      permission !== Permission.BillingMember &&
      permission !== Permission.BillingViewer
    );
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
        isRolePermission: true,
        group: PermissionGroup.Project,
      },
      {
        permission: Permission.ProjectMember,
        title: "Project Member",
        description:
          "Member of this project. Can view most resources unless restricted.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: true,
        group: PermissionGroup.Project,
      },
      {
        permission: Permission.ProjectAdmin,
        title: "Project Admin",
        description:
          "Admin of this project. Manages team members in this project, however cannot manage billing or delete this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: true,
        group: PermissionGroup.Project,
      },
      {
        permission: Permission.IncidentAdmin,
        title: "Incident Admin",
        description:
          "Full control over incidents and incident configuration. Can create, edit, and delete incidents, notes, state timelines, templates, severities, and states.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: true,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.IncidentMember,
        title: "Incident Member",
        description:
          "Can create, edit, and delete incidents, incident notes, and incident state timelines. Cannot modify incident severities or states.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: true,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.IncidentViewer,
        title: "Incident Viewer",
        description: "Read-only access to incidents and incident resources.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: true,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.AlertAdmin,
        title: "Alert Admin",
        description:
          "Full control over alerts and alert configuration. Can create, edit, and delete alerts, notes, state timelines, severities, and states.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: true,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.AlertMember,
        title: "Alert Member",
        description:
          "Can create, edit, and delete alerts, alert notes, and alert state timelines. Cannot modify alert severities or states.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: true,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.AlertViewer,
        title: "Alert Viewer",
        description: "Read-only access to alerts and alert resources.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: true,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.MonitorAdmin,
        title: "Monitor Admin",
        description:
          "Full control over monitors and monitor configuration. Can create, edit, and delete monitors, monitor groups, probes, secrets, and statuses.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: true,
        group: PermissionGroup.Monitor,
      },
      {
        permission: Permission.MonitorMember,
        title: "Monitor Member",
        description:
          "Can create, edit, and delete monitors, monitor groups, and monitor secrets. Cannot modify monitor statuses.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: true,
        group: PermissionGroup.Monitor,
      },
      {
        permission: Permission.MonitorViewer,
        title: "Monitor Viewer",
        description: "Read-only access to monitors and monitor resources.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: true,
        group: PermissionGroup.Monitor,
      },
      {
        permission: Permission.StatusPageAdmin,
        title: "Status Page Admin",
        description:
          "Full control over status pages, announcements, subscribers, resources, domains, groups, and SSO configurations.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: true,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.StatusPageMember,
        title: "Status Page Member",
        description:
          "Can create, edit, and delete status pages, announcements, and subscribers.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: true,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.StatusPageViewer,
        title: "Status Page Viewer",
        description:
          "Read-only access to status pages and status page resources.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: true,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.OnCallAdmin,
        title: "On-Call Admin",
        description:
          "Full control over on-call duty policies, schedules, escalation rules, and user overrides.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: true,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.OnCallMember,
        title: "On-Call Member",
        description:
          "Can create, edit, and delete on-call duty policies, schedules, and user overrides.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: true,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.OnCallViewer,
        title: "On-Call Viewer",
        description: "Read-only access to on-call duty policies and schedules.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: true,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.ScheduledMaintenanceAdmin,
        title: "Scheduled Maintenance Admin",
        description:
          "Full control over scheduled maintenances, notes, state timelines, templates, and maintenance states.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: true,
        group: PermissionGroup.ScheduledMaintenance,
      },
      {
        permission: Permission.ScheduledMaintenanceMember,
        title: "Scheduled Maintenance Member",
        description:
          "Can create, edit, and delete scheduled maintenances, notes, and state timelines. Cannot modify maintenance states.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: true,
        group: PermissionGroup.ScheduledMaintenance,
      },
      {
        permission: Permission.ScheduledMaintenanceViewer,
        title: "Scheduled Maintenance Viewer",
        description:
          "Read-only access to scheduled maintenances and maintenance resources.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: true,
        group: PermissionGroup.ScheduledMaintenance,
      },
      {
        permission: Permission.TelemetryAdmin,
        title: "Telemetry Admin",
        description:
          "Full control over telemetry services, logs, traces, metrics, profiles, exceptions, ingestion keys, and log pipelines.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: true,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.TelemetryMember,
        title: "Telemetry Member",
        description:
          "Can create, edit, and delete telemetry services and view all telemetry data.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: true,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.TelemetryViewer,
        title: "Telemetry Viewer",
        description:
          "Read-only access to telemetry services and telemetry data.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: true,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.SettingsAdmin,
        title: "Settings Admin",
        description:
          "Full control over project settings: API keys, teams, team permissions, labels, SSO, SMTP, call/SMS config, domains, probes, and service catalog.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: true,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.SettingsMember,
        title: "Settings Member",
        description:
          "Can manage labels and service catalog. Cannot manage API keys, teams, SSO, or sensitive integrations.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: true,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.SettingsViewer,
        title: "Settings Viewer",
        description: "Read-only access to project settings.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: true,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.BillingAdmin,
        title: "Billing Admin",
        description:
          "Full control over project billing, invoices, and payment methods.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: true,
        group: PermissionGroup.Billing,
      },
      {
        permission: Permission.BillingMember,
        title: "Billing Member",
        description:
          "Can view and manage payment methods. Cannot change the project plan.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: true,
        group: PermissionGroup.Billing,
      },
      {
        permission: Permission.BillingViewer,
        title: "Billing Viewer",
        description: "Read-only access to billing information and invoices.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: true,
        group: PermissionGroup.Billing,
      },
      {
        permission: Permission.Viewer,
        title: "Viewer",
        description:
          "Read-only access across all project resources. Cannot create, edit, or delete any resources.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: true,
        group: PermissionGroup.Project,
      },
      {
        permission: Permission.WorkflowAdmin,
        title: "Workflow Admin",
        description:
          "Full control over workflows, workflow logs, and workflow variables.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: true,
        group: PermissionGroup.Workflow,
      },
      {
        permission: Permission.WorkflowMember,
        title: "Workflow Member",
        description:
          "Can create, edit, and delete workflows and workflow variables.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: true,
        group: PermissionGroup.Workflow,
      },
      {
        permission: Permission.WorkflowViewer,
        title: "Workflow Viewer",
        description: "Read-only access to workflows and workflow logs.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: true,
        group: PermissionGroup.Workflow,
      },
      {
        permission: Permission.RunbookAdmin,
        title: "Runbook Admin",
        description:
          "Full control over runbooks. Can create, edit, delete, and execute runbooks.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: true,
        group: PermissionGroup.Runbook,
      },
      {
        permission: Permission.RunbookMember,
        title: "Runbook Member",
        description:
          "Can create, edit, delete, and execute runbooks in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: true,
        group: PermissionGroup.Runbook,
      },
      {
        permission: Permission.RunbookViewer,
        title: "Runbook Viewer",
        description: "Read-only access to runbooks.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: true,
        group: PermissionGroup.Runbook,
      },
      {
        permission: Permission.ProjectUser,
        title: "Project User",
        description: "User of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Project,
      },
      {
        permission: Permission.CurrentUser,
        title: "Logged in User",
        description: "This permission is assigned to any registered user.",
        isAssignableToTenant: false,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Project,
      },
      {
        permission: Permission.CustomerSupport,
        title: "Customer Support",
        description: "Customer Support Resource of OneUptime.",
        isAssignableToTenant: false,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Project,
      },
      {
        permission: Permission.User,
        title: "User",
        description:
          "Owner of this project, manages billing, inviting other admins to this project, and can delete this project.",
        isAssignableToTenant: false,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Project,
      },
      {
        permission: Permission.Public,
        title: "Public",
        description:
          "Non registered user. Typically used for sign up or log in.",
        isAssignableToTenant: false,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Project,
      },

      {
        permission: Permission.ManageProjectBilling,
        title: "Manage Billing",
        description: "This permission can update project billing.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Billing,
      },
      {
        permission: Permission.CreateProjectApiKey,
        title: "Create API Key",
        description: "This permission can create api keys of this project",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.DeleteProjectApiKey,
        title: "Delete API Key",
        description: "This permission can delete api keys of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.EditProjectApiKeyPermissions,
        title: "Edit API Key Permissions",
        description:
          "This permission can edit api key permissions of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.EditProjectApiKey,
        title: "Edit API Key",
        description: "This permission can edit api keys of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.ReadProjectApiKey,
        title: "Read API Key",
        description: "This permission can read api keys of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },

      {
        permission: Permission.CreateTelemetryIngestionKey,
        title: "Create Telemetry Ingestion Key",
        description:
          "This permission can create Telemetry Ingestion Keys of this project",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.DeleteTelemetryIngestionKey,
        title: "Delete Telemetry Ingestion Key",
        description:
          "This permission can delete Telemetry Ingestion Keys of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.EditTelemetryIngestionKey,
        title: "Edit Telemetry Ingestion Key",
        description:
          "This permission can edit Telemetry Ingestion Keys of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.ReadTelemetryIngestionKey,
        title: "Read Telemetry Ingestion Key",
        description:
          "This permission can read Telemetry Ingestion Keys of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },

      // Dashboards.

      {
        permission: Permission.CreateDashboard,
        title: "Create Dashboard",
        description: "This permission can create Dashboards of this project",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.DeleteDashboard,
        title: "Delete Dashboard",
        description: "This permission can delete Dashboard of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.EditDashboard,
        title: "Edit Dashboard",
        description: "This permission can edit Dashboards of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.ReadDashboard,
        title: "Read Dashboard",
        description: "This permission can read Dashboards of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },

      // Dashboard Owner Team Permissions
      {
        permission: Permission.CreateDashboardOwnerTeam,
        title: "Create Dashboard Team Owner",
        description:
          "This permission can create Dashboard Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.DeleteDashboardOwnerTeam,
        title: "Delete Dashboard Team Owner",
        description:
          "This permission can delete Dashboard Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.EditDashboardOwnerTeam,
        title: "Edit Dashboard Team Owner",
        description:
          "This permission can edit Dashboard Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.ReadDashboardOwnerTeam,
        title: "Read Dashboard Team Owner",
        description:
          "This permission can read Dashboard Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },

      // Dashboard Owner User Permissions
      {
        permission: Permission.CreateDashboardOwnerUser,
        title: "Create Dashboard User Owner",
        description:
          "This permission can create Dashboard User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.DeleteDashboardOwnerUser,
        title: "Delete Dashboard User Owner",
        description:
          "This permission can delete Dashboard User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.EditDashboardOwnerUser,
        title: "Edit Dashboard User Owner",
        description:
          "This permission can edit Dashboard User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.ReadDashboardOwnerUser,
        title: "Read Dashboard User Owner",
        description:
          "This permission can read Dashboard User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },

      // Dashboard Owner Rule Permissions
      {
        permission: Permission.CreateDashboardOwnerRule,
        title: "Create Dashboard Owner Rule",
        description:
          "This permission can create Dashboard Owner Rules in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.DeleteDashboardOwnerRule,
        title: "Delete Dashboard Owner Rule",
        description:
          "This permission can delete Dashboard Owner Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.EditDashboardOwnerRule,
        title: "Edit Dashboard Owner Rule",
        description:
          "This permission can edit Dashboard Owner Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.ReadDashboardOwnerRule,
        title: "Read Dashboard Owner Rule",
        description:
          "This permission can read Dashboard Owner Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },

      // Dashboard Label Rule Permissions
      {
        permission: Permission.CreateDashboardLabelRule,
        title: "Create Dashboard Label Rule",
        description:
          "This permission can create Dashboard Label Rules in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.DeleteDashboardLabelRule,
        title: "Delete Dashboard Label Rule",
        description:
          "This permission can delete Dashboard Label Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.EditDashboardLabelRule,
        title: "Edit Dashboard Label Rule",
        description:
          "This permission can edit Dashboard Label Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.ReadDashboardLabelRule,
        title: "Read Dashboard Label Rule",
        description:
          "This permission can read Dashboard Label Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },

      // Dashboard Domain permissions.
      {
        permission: Permission.CreateDashboardDomain,
        title: "Create Dashboard Domain",
        description:
          "This permission can create Dashboard Domains of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.DeleteDashboardDomain,
        title: "Delete Dashboard Domain",
        description:
          "This permission can delete Dashboard Domains of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.EditDashboardDomain,
        title: "Edit Dashboard Domain",
        description:
          "This permission can edit Dashboard Domains of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.ReadDashboardDomain,
        title: "Read Dashboard Domain",
        description:
          "This permission can read Dashboard Domains of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },

      // Table view permissions

      {
        permission: Permission.CreateTableView,
        title: "Create Table View",
        description: "This permission can create table views of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.DeleteTableView,
        title: "Delete Table View",
        description: "This permission can delete table views of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.EditTableView,
        title: "Edit Table View",
        description: "This permission can edit table views of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.ReadTableView,
        title: "Read Table View",
        description: "This permission can read table views of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },

      {
        permission: Permission.CreateProjectLabel,
        title: "Create Label",
        description: "This permission can create labels this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.DeleteProjectLabel,
        title: "Delete Label",
        description: "This permission can delete labels of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.AddLabelsToProjectResources,
        title: "Add Label to Resources",
        description:
          "This permission can add project labels to resources of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.EditProjectLabel,
        title: "Edit Label",
        description: "This permission can edit labels of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.ReadProjectLabel,
        title: "Read Label",
        description: "This permission can read labels of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },

      {
        permission: Permission.CreateIncidentState,
        title: "Create Incident State",
        description: "This permission can create incident states this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.DeleteIncidentState,
        title: "Delete Incident State",
        description:
          "This permission can delete incident states of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.EditIncidentState,
        title: "Edit Incident State",
        description:
          "This permission can edit incident states of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.ReadIncidentState,
        title: "Read Incident State",
        description:
          "This permission can read incident states of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },

      {
        permission: Permission.CreateAlertState,
        title: "Create Alert State",
        description: "This permission can create alert states this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.DeleteAlertState,
        title: "Delete Alert State",
        description: "This permission can delete alert states of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.EditAlertState,
        title: "Edit Alert State",
        description: "This permission can edit alert states of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.ReadAlertState,
        title: "Read Alert State",
        description: "This permission can read alert states of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },

      {
        permission: Permission.CreateWorkspaceNotificationRule,
        title: "Create Workspace Notification Rule",
        description: "This permission can create alert states this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.DeleteWorkspaceNotificationRule,
        title: "Delete Workspace Notification Rule",
        description: "This permission can delete alert states of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.EditWorkspaceNotificationRule,
        title: "Edit Workspace Notification Rule",
        description: "This permission can edit alert states of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.ReadWorkspaceNotificationRule,
        title: "Read Workspace Notification Rule",
        description: "This permission can read alert states of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },

      {
        permission: Permission.CreateWorkspaceNotificationSummary,
        title: "Create Workspace Notification Summary",
        description:
          "This permission can create workspace notification summaries for this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.DeleteWorkspaceNotificationSummary,
        title: "Delete Workspace Notification Summary",
        description:
          "This permission can delete workspace notification summaries of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.EditWorkspaceNotificationSummary,
        title: "Edit Workspace Notification Summary",
        description:
          "This permission can edit workspace notification summaries of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.ReadWorkspaceNotificationSummary,
        title: "Read Workspace Notification Summary",
        description:
          "This permission can read workspace notification summaries of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },

      {
        permission: Permission.CreateIncidentStateTimeline,
        title: "Create Incident State Timeline",
        description:
          "This permission can create incident state history of an incident in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.DeleteIncidentStateTimeline,
        title: "Delete Incident State Timeline",
        description:
          "This permission can delete incident state history of an incident in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.EditIncidentStateTimeline,
        title: "Edit Incident State Timeline",
        description:
          "This permission can edit incident state history of an incident in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.ReadIncidentStateTimeline,
        title: "Read Incident State Timeline",
        description:
          "This permission can read incident state history of an incident in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },

      {
        permission: Permission.CreateMonitorFeed,
        title: "Create Monitor Feed",
        description:
          "This permission can create log of an monitor in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },
      {
        permission: Permission.EditMonitorFeed,
        title: "Edit Monitor Feed",
        description:
          "This permission can edit log of an monitor in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },
      {
        permission: Permission.ReadMonitorFeed,
        title: "Read Monitor Feed",
        description:
          "This permission can read log of an monitor in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },

      {
        permission: Permission.CreateIncidentFeed,
        title: "Create Incident Feed",
        description:
          "This permission can create log of an incident in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.EditIncidentFeed,
        title: "Edit Incident Feed",
        description:
          "This permission can edit log of an incident in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.ReadIncidentFeed,
        title: "Read Incident Feed",
        description:
          "This permission can read log of an incident in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },

      {
        permission: Permission.CreateOnCallDutyPolicyFeed,
        title: "Create On Call Duty Policy Feed",
        description:
          "This permission can create log of an on-call policy in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.EditOnCallDutyPolicyFeed,
        title: "Edit On Call Duty Policy Feed",
        description:
          "This permission can edit log of an on-call policy in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.ReadOnCallDutyPolicyFeed,
        title: "Read On Call Duty Policy Feed",
        description:
          "This permission can read log of an on-call policy in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },

      {
        permission: Permission.CreateAlertFeed,
        title: "Create Alert Feed",
        description:
          "This permission can create log of an alert in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.EditAlertFeed,
        title: "Edit Alert Feed",
        description:
          "This permission can edit log of an alert in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.ReadAlertFeed,
        title: "Read Alert Feed",
        description:
          "This permission can read log of an alert in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },

      {
        permission: Permission.CreateScheduledMaintenanceFeed,
        title: "Create Scheduled Maintenance Log",
        description:
          "This permission can create log of a scheduled maintenance in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },
      {
        permission: Permission.EditScheduledMaintenanceFeed,
        title: "Edit Scheduled Maintenance Log",
        description:
          "This permission can edit log of an scheduled maintenance in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },
      {
        permission: Permission.ReadScheduledMaintenanceFeed,
        title: "Read Scheduled Maintenance Log",
        description:
          "This permission can read log of an scheduled maintenance in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },

      {
        permission: Permission.CreateAlertStateTimeline,
        title: "Create Alert State Timeline",
        description:
          "This permission can create alert state history of an alert in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.DeleteAlertStateTimeline,
        title: "Delete Alert State Timeline",
        description:
          "This permission can delete alert state history of an alert in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.EditAlertStateTimeline,
        title: "Edit  Alert State  Timeline",
        description:
          "This permission can edit incident alert history of an alert in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.ReadAlertStateTimeline,
        title: "Read Alert State Timeline",
        description:
          "This permission can read alert state history of an alert in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },

      {
        permission: Permission.CreateMonitorStatusTimeline,
        title: "Create Monitor Status Timeline",
        description:
          "This permission can create Monitor Status history of an incident in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },
      {
        permission: Permission.DeleteMonitorStatusTimeline,
        title: "Delete Monitor Status Timeline",
        description:
          "This permission can delete Monitor Status history of an incident in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },
      {
        permission: Permission.EditMonitorStatusTimeline,
        title: "Edit Monitor Status Timeline",
        description:
          "This permission can edit Monitor Status history of an incident in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },
      {
        permission: Permission.ReadMonitorStatusTimeline,
        title: "Read Monitor Status Timeline",
        description:
          "This permission can read Monitor Status history of an incident in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },

      {
        permission: Permission.ReadEmailLog,
        title: "Read Email Log",
        description: "This permission can read email logs of the project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.NotificationLog,
      },

      {
        permission: Permission.ReadProjectSCIMLog,
        title: "Read Project SCIM Log",
        description:
          "This permission can read SCIM provisioning logs of the project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.NotificationLog,
      },
      {
        permission: Permission.ReadStatusPageSCIMLog,
        title: "Read Status Page SCIM Log",
        description:
          "This permission can read SCIM provisioning logs of status pages in the project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },

      {
        permission: Permission.CreateProjectMonitorStatus,
        title: "Create Monitor Status",
        description:
          "This permission can create monitor statuses this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },
      {
        permission: Permission.DeleteProjectMonitorStatus,
        title: "Delete Monitor Status",
        description:
          "This permission can delete monitor statuses of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },
      {
        permission: Permission.EditProjectMonitorStatus,
        title: "Edit Monitor Status",
        description:
          "This permission can edit monitor statuses of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },
      {
        permission: Permission.ReadProjectMonitorStatus,
        title: "Read Monitor Status",
        description:
          "This permission can read monitor statuses of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },

      {
        permission: Permission.CreateStatusPageAnnouncement,
        title: "Create Status Page Announcement",
        description:
          "This permission can create Status Page Announcement this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.DeleteStatusPageAnnouncement,
        title: "Delete Status Page Announcement",
        description:
          "This permission can delete Status Page Announcement of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.EditStatusPageAnnouncement,
        title: "Edit Status Page Announcement",
        description:
          "This permission can edit Status Page Announcement of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.ReadStatusPageAnnouncement,
        title: "Read Status Page Announcement",
        description:
          "This permission can read Status Page Announcement of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },

      {
        permission: Permission.CreateStatusPageAnnouncementTemplate,
        title: "Create Status Page Announcement Template",
        description:
          "This permission can create Status Page Announcement Templates in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.DeleteStatusPageAnnouncementTemplate,
        title: "Delete Status Page Announcement Template",
        description:
          "This permission can delete Status Page Announcement Templates of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.EditStatusPageAnnouncementTemplate,
        title: "Edit Status Page Announcement Template",
        description:
          "This permission can edit Status Page Announcement Templates of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.ReadStatusPageAnnouncementTemplate,
        title: "Read Status Page Announcement Template",
        description:
          "This permission can read Status Page Announcement Templates of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },

      {
        permission: Permission.CreateStatusPageAnnouncement,
        title: "Create Status Page Announcement",
        description:
          "This permission can create Status Page Announcements in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.DeleteStatusPageAnnouncement,
        title: "Delete Status Page Announcement",
        description:
          "This permission can delete Status Page Announcements of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.EditStatusPageAnnouncement,
        title: "Edit Status Page Announcement",
        description:
          "This permission can edit Status Page Announcements of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.ReadStatusPageAnnouncement,
        title: "Read Status Page Announcement",
        description:
          "This permission can read Status Page Announcements of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },

      {
        permission: Permission.CreateStatusPageAnnouncementTemplate,
        title: "Create Status Page Announcement Template",
        description:
          "This permission can create Status Page Announcement Templates in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.DeleteStatusPageAnnouncementTemplate,
        title: "Delete Status Page Announcement Template",
        description:
          "This permission can delete Status Page Announcement Templates of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.EditStatusPageAnnouncementTemplate,
        title: "Edit Status Page Announcement Template",
        description:
          "This permission can edit Status Page Announcement Templates of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.ReadStatusPageAnnouncementTemplate,
        title: "Read Status Page Announcement Template",
        description:
          "This permission can read Status Page Announcement Templates of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },

      {
        permission: Permission.CreateStatusPageSubscriberNotificationTemplate,
        title: "Create Status Page Subscriber Notification Template",
        description:
          "This permission can create Status Page Subscriber Notification Templates in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.DeleteStatusPageSubscriberNotificationTemplate,
        title: "Delete Status Page Subscriber Notification Template",
        description:
          "This permission can delete Status Page Subscriber Notification Templates of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.EditStatusPageSubscriberNotificationTemplate,
        title: "Edit Status Page Subscriber Notification Template",
        description:
          "This permission can edit Status Page Subscriber Notification Templates of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.ReadStatusPageSubscriberNotificationTemplate,
        title: "Read Status Page Subscriber Notification Template",
        description:
          "This permission can read Status Page Subscriber Notification Templates of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },

      {
        permission:
          Permission.CreateStatusPageSubscriberNotificationTemplateStatusPage,
        title: "Create Status Page Subscriber Notification Template Link",
        description:
          "This permission can create Status Page Subscriber Notification Template Links in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission:
          Permission.DeleteStatusPageSubscriberNotificationTemplateStatusPage,
        title: "Delete Status Page Subscriber Notification Template Link",
        description:
          "This permission can delete Status Page Subscriber Notification Template Links of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission:
          Permission.EditStatusPageSubscriberNotificationTemplateStatusPage,
        title: "Edit Status Page Subscriber Notification Template Link",
        description:
          "This permission can edit Status Page Subscriber Notification Template Links of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission:
          Permission.ReadStatusPageSubscriberNotificationTemplateStatusPage,
        title: "Read Status Page Subscriber Notification Template Link",
        description:
          "This permission can read Status Page Subscriber Notification Template Links of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },

      {
        permission: Permission.CreateProjectDomain,
        title: "Create Domain",
        description: "This permission can create Domain in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.DeleteProjectDomain,
        title: "Delete Domain",
        description: "This permission can delete Domain in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.EditProjectDomain,
        title: "Edit Domain",
        description: "This permission can edit Domain in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.ReadProjectDomain,
        title: "Read Domain",
        description: "This permission can read Domain in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },

      {
        permission: Permission.CreateStatusPageHeaderLink,
        title: "Create Header Link",
        description: "This permission can create Header Link in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.DeleteStatusPageHeaderLink,
        title: "Delete Header Link",
        description: "This permission can delete Header Link in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.EditStatusPageHeaderLink,
        title: "Edit Header Link",
        description: "This permission can edit Header Link in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.ReadStatusPageHeaderLink,
        title: "Read Header Link",
        description: "This permission can read Header Link in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },

      {
        permission: Permission.CreateStatusPageFooterLink,
        title: "Create Footer Link",
        description: "This permission can create Footer Link in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.DeleteStatusPageFooterLink,
        title: "Delete Footer Link",
        description: "This permission can delete Footer Link in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.EditStatusPageFooterLink,
        title: "Edit Footer Link",
        description: "This permission can edit Footer Link in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.ReadStatusPageFooterLink,
        title: "Read Footer Link",
        description: "This permission can read Footer Link in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },

      {
        permission: Permission.CreateStatusPageResource,
        title: "Create Status Page Resource",
        description:
          "This permission can create Status Page Resource in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.DeleteStatusPageResource,
        title: "Delete Status Page Resource",
        description:
          "This permission can delete Status Page Resource in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.EditStatusPageResource,
        title: "Edit Status Page Resource",
        description:
          "This permission can edit Status Page Resource in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.ReadStatusPageResource,
        title: "Read Status Page Resource",
        description:
          "This permission can read Status Page Resource in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },

      {
        permission: Permission.CreateStatusPageHistoryChartBarColorRule,
        title: "Create Status Page History Chart Bar Color Rule",
        description:
          "This permission can create Status Page History Chart Bar Color Rule in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.DeleteStatusPageHistoryChartBarColorRule,
        title: "Delete Status Page History Chart Bar Color Rule",
        description:
          "This permission can delete Status Page History Chart Bar Color Rule in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.EditStatusPageHistoryChartBarColorRule,
        title: "Edit Status Page History Chart Bar Color Rule",
        description:
          "This permission can edit Status Page History Chart Bar Color Rule in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.ReadStatusPageHistoryChartBarColorRule,
        title: "Read Status Page History Chart Bar Color Rule",
        description:
          "This permission can read Status Page History Chart Bar Color Rule in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },

      {
        permission: Permission.CreateWorkflow,
        title: "Create Workflow",
        description: "This permission can create Workflow in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Workflow,
      },
      {
        permission: Permission.DeleteWorkflow,
        title: "Delete Workflow",
        description: "This permission can delete Workflow in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.Workflow,
      },
      {
        permission: Permission.EditWorkflow,
        title: "Edit Workflow",
        description: "This permission can edit Workflow in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.Workflow,
      },
      {
        permission: Permission.ReadWorkflow,
        title: "Read Workflow",
        description: "This permission can read Workflow in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.Workflow,
      },

      // Workflow Owner Team Permissions
      {
        permission: Permission.CreateWorkflowOwnerTeam,
        title: "Create Workflow Team Owner",
        description:
          "This permission can create Workflow Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Workflow,
      },
      {
        permission: Permission.DeleteWorkflowOwnerTeam,
        title: "Delete Workflow Team Owner",
        description:
          "This permission can delete Workflow Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Workflow,
      },
      {
        permission: Permission.EditWorkflowOwnerTeam,
        title: "Edit Workflow Team Owner",
        description:
          "This permission can edit Workflow Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Workflow,
      },
      {
        permission: Permission.ReadWorkflowOwnerTeam,
        title: "Read Workflow Team Owner",
        description:
          "This permission can read Workflow Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Workflow,
      },

      // Workflow Owner User Permissions
      {
        permission: Permission.CreateWorkflowOwnerUser,
        title: "Create Workflow User Owner",
        description:
          "This permission can create Workflow User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Workflow,
      },
      {
        permission: Permission.DeleteWorkflowOwnerUser,
        title: "Delete Workflow User Owner",
        description:
          "This permission can delete Workflow User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Workflow,
      },
      {
        permission: Permission.EditWorkflowOwnerUser,
        title: "Edit Workflow User Owner",
        description:
          "This permission can edit Workflow User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Workflow,
      },
      {
        permission: Permission.ReadWorkflowOwnerUser,
        title: "Read Workflow User Owner",
        description:
          "This permission can read Workflow User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Workflow,
      },

      // Workflow Owner Rule Permissions
      {
        permission: Permission.CreateWorkflowOwnerRule,
        title: "Create Workflow Owner Rule",
        description:
          "This permission can create Workflow Owner Rules in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Workflow,
      },
      {
        permission: Permission.DeleteWorkflowOwnerRule,
        title: "Delete Workflow Owner Rule",
        description:
          "This permission can delete Workflow Owner Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Workflow,
      },
      {
        permission: Permission.EditWorkflowOwnerRule,
        title: "Edit Workflow Owner Rule",
        description:
          "This permission can edit Workflow Owner Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Workflow,
      },
      {
        permission: Permission.ReadWorkflowOwnerRule,
        title: "Read Workflow Owner Rule",
        description:
          "This permission can read Workflow Owner Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Workflow,
      },

      // Workflow Label Rule Permissions
      {
        permission: Permission.CreateWorkflowLabelRule,
        title: "Create Workflow Label Rule",
        description:
          "This permission can create Workflow Label Rules in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Workflow,
      },
      {
        permission: Permission.DeleteWorkflowLabelRule,
        title: "Delete Workflow Label Rule",
        description:
          "This permission can delete Workflow Label Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Workflow,
      },
      {
        permission: Permission.EditWorkflowLabelRule,
        title: "Edit Workflow Label Rule",
        description:
          "This permission can edit Workflow Label Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Workflow,
      },
      {
        permission: Permission.ReadWorkflowLabelRule,
        title: "Read Workflow Label Rule",
        description:
          "This permission can read Workflow Label Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Workflow,
      },

      {
        permission: Permission.DeleteProject,
        title: "Delete Project",
        description: "This permission can delete Project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Project,
      },
      {
        permission: Permission.EditProject,
        title: "Edit Project",
        description: "This permission can edit Project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Project,
      },
      {
        permission: Permission.ReadProject,
        title: "Read Project",
        description: "This permission can read this Project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Project,
      },

      {
        permission: Permission.CreateWorkflowVariable,
        title: "Create Workflow Variables",
        description:
          "This permission can create Workflow Variables in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Workflow,
      },
      {
        permission: Permission.DeleteWorkflowVariable,
        title: "Delete Workflow Variables",
        description:
          "This permission can delete Workflow Variables in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Workflow,
      },
      {
        permission: Permission.EditWorkflowVariable,
        title: "Edit Workflow Variables",
        description:
          "This permission can edit Workflow Variables in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Workflow,
      },
      {
        permission: Permission.ReadWorkflowVariable,
        title: "Read Workflow Variables",
        description:
          "This permission can read Workflow Variables in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Workflow,
      },

      {
        permission: Permission.CreateWorkflowLog,
        title: "Create Workflow Log",
        description: "This permission can create Workflow Log in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Workflow,
      },
      {
        permission: Permission.DeleteWorkflowLog,
        title: "Delete Workflow Log",
        description: "This permission can delete Workflow Log in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Workflow,
      },
      {
        permission: Permission.EditWorkflowLog,
        title: "Edit Workflow Log",
        description: "This permission can edit Workflow Log in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Workflow,
      },
      {
        permission: Permission.ReadWorkflowLog,
        title: "Read Workflow Log",
        description: "This permission can read Workflow Log in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Workflow,
      },

      {
        permission: Permission.CreateRunbook,
        title: "Create Runbook",
        description: "This permission can create Runbook in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Runbook,
      },
      {
        permission: Permission.DeleteRunbook,
        title: "Delete Runbook",
        description: "This permission can delete Runbook in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.Runbook,
      },
      {
        permission: Permission.EditRunbook,
        title: "Edit Runbook",
        description: "This permission can edit Runbook in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.Runbook,
      },
      {
        permission: Permission.ReadRunbook,
        title: "Read Runbook",
        description: "This permission can read Runbook in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.Runbook,
      },

      {
        permission: Permission.CreateRunbookExecution,
        title: "Create Runbook Execution",
        description:
          "This permission can create Runbook Executions in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Runbook,
      },
      {
        permission: Permission.DeleteRunbookExecution,
        title: "Delete Runbook Execution",
        description:
          "This permission can delete Runbook Executions in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Runbook,
      },
      {
        permission: Permission.EditRunbookExecution,
        title: "Edit Runbook Execution",
        description:
          "This permission can edit Runbook Executions (e.g. tick off manual steps) in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Runbook,
      },
      {
        permission: Permission.ReadRunbookExecution,
        title: "Read Runbook Execution",
        description:
          "This permission can read Runbook Executions in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Runbook,
      },

      {
        permission: Permission.CreateRunbookRule,
        title: "Create Runbook Rule",
        description:
          "This permission can create Runbook Rules in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Runbook,
      },
      {
        permission: Permission.DeleteRunbookRule,
        title: "Delete Runbook Rule",
        description:
          "This permission can delete Runbook Rules in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Runbook,
      },
      {
        permission: Permission.EditRunbookRule,
        title: "Edit Runbook Rule",
        description: "This permission can edit Runbook Rules in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Runbook,
      },
      {
        permission: Permission.ReadRunbookRule,
        title: "Read Runbook Rule",
        description: "This permission can read Runbook Rules in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Runbook,
      },

      {
        permission: Permission.CreateRunbookOwnerTeam,
        title: "Create Runbook Team Owner",
        description:
          "This permission can create Runbook Team Owner this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Runbook,
      },
      {
        permission: Permission.DeleteRunbookOwnerTeam,
        title: "Delete Runbook Team Owner",
        description:
          "This permission can delete Runbook Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Runbook,
      },
      {
        permission: Permission.EditRunbookOwnerTeam,
        title: "Edit Runbook Team Owner",
        description:
          "This permission can edit Runbook Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Runbook,
      },
      {
        permission: Permission.ReadRunbookOwnerTeam,
        title: "Read Runbook Team Owner",
        description:
          "This permission can read Runbook Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Runbook,
      },

      {
        permission: Permission.CreateRunbookOwnerUser,
        title: "Create Runbook User Owner",
        description:
          "This permission can create Runbook User Owner this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Runbook,
      },
      {
        permission: Permission.DeleteRunbookOwnerUser,
        title: "Delete Runbook User Owner",
        description:
          "This permission can delete Runbook User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Runbook,
      },
      {
        permission: Permission.EditRunbookOwnerUser,
        title: "Edit Runbook User Owner",
        description:
          "This permission can edit Runbook User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Runbook,
      },
      {
        permission: Permission.ReadRunbookOwnerUser,
        title: "Read Runbook User Owner",
        description:
          "This permission can read Runbook User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Runbook,
      },

      {
        permission: Permission.CreateRunbookAgent,
        title: "Create Runbook Agent",
        description:
          "This permission can register Runbook Agents in this project. Runbook Agents execute Bash steps in your own infrastructure.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Runbook,
      },
      {
        permission: Permission.DeleteRunbookAgent,
        title: "Delete Runbook Agent",
        description:
          "This permission can delete Runbook Agents in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.Runbook,
      },
      {
        permission: Permission.EditRunbookAgent,
        title: "Edit Runbook Agent",
        description:
          "This permission can edit Runbook Agents (name, description, tags, key) in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.Runbook,
      },
      {
        permission: Permission.ReadRunbookAgent,
        title: "Read Runbook Agent",
        description: "This permission can read Runbook Agents in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.Runbook,
      },

      {
        permission: Permission.CreateRunbookAgentOwnerTeam,
        title: "Create Runbook Agent Team Owner",
        description:
          "This permission can create Runbook Agent Team Owners of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Runbook,
      },
      {
        permission: Permission.DeleteRunbookAgentOwnerTeam,
        title: "Delete Runbook Agent Team Owner",
        description:
          "This permission can delete Runbook Agent Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Runbook,
      },
      {
        permission: Permission.EditRunbookAgentOwnerTeam,
        title: "Edit Runbook Agent Team Owner",
        description:
          "This permission can edit Runbook Agent Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Runbook,
      },
      {
        permission: Permission.ReadRunbookAgentOwnerTeam,
        title: "Read Runbook Agent Team Owner",
        description:
          "This permission can read Runbook Agent Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Runbook,
      },

      {
        permission: Permission.CreateRunbookAgentOwnerUser,
        title: "Create Runbook Agent User Owner",
        description:
          "This permission can create Runbook Agent User Owners of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Runbook,
      },
      {
        permission: Permission.DeleteRunbookAgentOwnerUser,
        title: "Delete Runbook Agent User Owner",
        description:
          "This permission can delete Runbook Agent User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Runbook,
      },
      {
        permission: Permission.EditRunbookAgentOwnerUser,
        title: "Edit Runbook Agent User Owner",
        description:
          "This permission can edit Runbook Agent User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Runbook,
      },
      {
        permission: Permission.ReadRunbookAgentOwnerUser,
        title: "Read Runbook Agent User Owner",
        description:
          "This permission can read Runbook Agent User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Runbook,
      },

      {
        permission: Permission.CreateRunbookSecret,
        title: "Create Runbook Secret",
        description: "This permission can create runbook secret.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Runbook,
      },
      {
        permission: Permission.DeleteRunbookSecret,
        title: "Delete Runbook Secret",
        description: "This permission can delete runbook secret.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Runbook,
      },
      {
        permission: Permission.EditRunbookSecret,
        title: "Edit Runbook Secret",
        description: "This permission can edit runbook secret.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Runbook,
      },
      {
        permission: Permission.ReadRunbookSecret,
        title: "Read Runbook Secret",
        description: "This permission can read runbook secret.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Runbook,
      },

      {
        permission: Permission.ReadAuditLog,
        title: "Read Audit Log",
        description:
          "This permission can read audit log records of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.AuditLog,
      },

      {
        permission: Permission.CreateStatusPageGroup,
        title: "Create Status Page Group",
        description:
          "This permission can create Status Page Group in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.DeleteStatusPageGroup,
        title: "Delete Status Page Group",
        description:
          "This permission can delete Status Page Group in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.EditStatusPageGroup,
        title: "Edit Status Page Group",
        description:
          "This permission can edit Status Page Group in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.ReadStatusPageGroup,
        title: "Read Status Page Group",
        description:
          "This permission can read Status Page Group in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },

      {
        permission: Permission.CreateStatusPageDomain,
        title: "Create Status Page Domain",
        description:
          "This permission can create Status Page Domain in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.DeleteStatusPageDomain,
        title: "Delete Status Page Domain",
        description:
          "This permission can delete Status Page Domain in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.EditStatusPageDomain,
        title: "Edit Status Page Domain",
        description:
          "This permission can edit Status Page Domain in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.ReadStatusPageDomain,
        title: "Read Status Page Domain",
        description:
          "This permission can read Status Page Domain in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },

      {
        permission: Permission.CreateMonitorGroup,
        title: "Create Monitor Group",
        description:
          "This permission can create Monitor Group in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },
      {
        permission: Permission.DeleteMonitorGroup,
        title: "Delete Monitor Group",
        description:
          "This permission can delete Monitor Group in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },
      {
        permission: Permission.EditMonitorGroup,
        title: "Edit Monitor Group",
        description: "This permission can edit Monitor Group in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },
      {
        permission: Permission.ReadMonitorGroup,
        title: "Read Monitor Group",
        description: "This permission can read Monitor Group in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },

      {
        permission: Permission.CreateProjectSSO,
        title: "Create Project SSO",
        description: "This permission can create Project SSO in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.DeleteProjectSSO,
        title: "Delete Project SSO",
        description: "This permission can delete Project SSO in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.EditProjectSSO,
        title: "Edit Project SSO",
        description: "This permission can edit Project SSO in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.ReadProjectSSO,
        title: "Read Project SSO",
        description: "This permission can read Project SSO in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },

      {
        permission: Permission.CreateProjectOIDC,
        title: "Create Project OIDC",
        description: "This permission can create Project OIDC in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.DeleteProjectOIDC,
        title: "Delete Project OIDC",
        description: "This permission can delete Project OIDC in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.EditProjectOIDC,
        title: "Edit Project OIDC",
        description: "This permission can edit Project OIDC in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.ReadProjectOIDC,
        title: "Read Project OIDC",
        description: "This permission can read Project OIDC in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },

      {
        permission: Permission.CreateStatusPageSSO,
        title: "Create Status Page SSO",
        description:
          "This permission can create Status Page SSO in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.DeleteStatusPageSSO,
        title: "Delete Status Page SSO",
        description:
          "This permission can delete Status Page SSO in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.EditStatusPageSSO,
        title: "Edit Status Page SSO",
        description:
          "This permission can edit Status Page SSO in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.ReadStatusPageSSO,
        title: "Read Status Page SSO",
        description:
          "This permission can read Status Page SSO in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },

      {
        permission: Permission.CreateStatusPageOIDC,
        title: "Create Status Page OIDC",
        description:
          "This permission can create Status Page OIDC in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.DeleteStatusPageOIDC,
        title: "Delete Status Page OIDC",
        description:
          "This permission can delete Status Page OIDC in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.EditStatusPageOIDC,
        title: "Edit Status Page OIDC",
        description:
          "This permission can edit Status Page OIDC in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.ReadStatusPageOIDC,
        title: "Read Status Page OIDC",
        description:
          "This permission can read Status Page OIDC in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },

      {
        permission: Permission.CreateProjectSMTPConfig,
        title: "Create SMTP Config",
        description: "This permission can create SMTP configs this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.DeleteProjectSMTPConfig,
        title: "Delete SMTP Config",
        description: "This permission can delete SMTP configs of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.EditProjectSMTPConfig,
        title: "Edit SMTP Config",
        description: "This permission can edit SMTP configs of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.ReadProjectSMTPConfig,
        title: "Read SMTP Config",
        description: "This permission can read SMTP configs of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },

      {
        permission: Permission.CreateProjectCallSMSConfig,
        title: "Create Call and SMS",
        description: "This permission can create Call and SMS this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.DeleteProjectCallSMSConfig,
        title: "Delete Call and SMS",
        description: "This permission can delete Call and SMS of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.EditProjectCallSMSConfig,
        title: "Edit Call and SMS",
        description: "This permission can edit Call and SMS of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },
      {
        permission: Permission.ReadProjectCallSMSConfig,
        title: "Read Call and SMS",
        description: "This permission can read Call and SMS of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Settings,
      },

      {
        permission: Permission.CreateStatusPageDomain,
        title: "Create Status Page Domain",
        description:
          "This permission can create Status Page Domain in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.DeleteStatusPageDomain,
        title: "Delete Status Page Domain",
        description:
          "This permission can delete Status Page Domain in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.EditStatusPageDomain,
        title: "Edit Status Page Domain",
        description:
          "This permission can edit Status Page Domain in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.ReadStatusPageDomain,
        title: "Read Status Page Domain",
        description:
          "This permission can read Status Page Domain in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },

      {
        permission: Permission.CreateIncidentSeverity,
        title: "Create Incident Severity",
        description:
          "This permission can create Incident Severity this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.DeleteIncidentSeverity,
        title: "Delete Incident Severity",
        description:
          "This permission can delete Incident Severity of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.EditIncidentSeverity,
        title: "Edit Incident Severity",
        description:
          "This permission can edit Incident Severity of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.ReadIncidentSeverity,
        title: "Read Incident Severity",
        description:
          "This permission can read Incident Severity of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },

      {
        permission: Permission.CreateAlertSeverity,
        title: "Create Alert Severity",
        description: "This permission can create Alert Severity this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.DeleteAlertSeverity,
        title: "Delete Alert Severity",
        description:
          "This permission can delete Alert Severity of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.EditAlertSeverity,
        title: "Edit Alert Severity",
        description: "This permission can edit Alert Severity of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.ReadAlertSeverity,
        title: "Read Alert Severity",
        description: "This permission can read Alert Severity of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },

      {
        permission: Permission.CreateProjectTeam,
        title: "Create Team",
        description: "This permission can create teams this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Team,
      },
      {
        permission: Permission.DeleteProjectTeam,
        title: "Delete Team",
        description: "This permission can delete teams of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Team,
      },
      {
        permission: Permission.InviteProjectTeamMembers,
        title: "Invite New Members",
        description: "This permission can invite users to the team.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Team,
      },
      {
        permission: Permission.EditProjectTeamPermissions,
        title: "Edit Team Permissions",
        description:
          "This permission can edit team permissions of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Team,
      },
      {
        permission: Permission.EditProjectTeam,
        title: "Edit Team",
        description: "This permission can edit teams of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Team,
      },
      {
        permission: Permission.ReadProjectTeam,
        title: "Read Teams",
        description: "This permission can read teams of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Team,
      },

      {
        permission: Permission.CreateProjectMonitor,
        title: "Create Monitor",
        description: "This permission can create monitor this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },
      {
        permission: Permission.DeleteProjectMonitor,
        title: "Delete Monitor",
        description: "This permission can delete monitor of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },
      {
        permission: Permission.EditProjectMonitor,
        title: "Edit Monitor",
        description: "This permission can edit monitor of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },
      {
        permission: Permission.ReadProjectMonitor,
        title: "Read Monitor",
        description: "This permission can read monitor of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },

      {
        permission: Permission.CreateMonitorTemplate,
        title: "Create Monitor Template",
        description:
          "This permission can create Monitor Template this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },
      {
        permission: Permission.DeleteMonitorTemplate,
        title: "Delete Monitor Template",
        description:
          "This permission can delete Monitor Template of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },
      {
        permission: Permission.EditMonitorTemplate,
        title: "Edit Monitor Template",
        description:
          "This permission can edit Monitor Template of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },
      {
        permission: Permission.ReadMonitorTemplate,
        title: "Read Monitor Template",
        description:
          "This permission can read Monitor Template of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },

      {
        permission: Permission.CreateIncidentInternalNote,
        title: "Create Incident Internal Note",
        description:
          "This permission can create Incident Internal Note this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.DeleteIncidentInternalNote,
        title: "Delete Incident Internal Note",
        description:
          "This permission can delete Incident Internal Note of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.EditIncidentInternalNote,
        title: "Edit Incident Internal Note",
        description:
          "This permission can edit Incident Internal Note of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.ReadIncidentInternalNote,
        title: "Read Incident Internal Note",
        description:
          "This permission can read Incident Internal Note of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },

      {
        permission: Permission.CreateAlertInternalNote,
        title: "Create Alert Internal Note",
        description:
          "This permission can create Alert Internal Note this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.DeleteAlertInternalNote,
        title: "Delete Alert Internal Note",
        description:
          "This permission can delete Alert Internal Note of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.EditAlertInternalNote,
        title: "Edit Alert Internal Note",
        description:
          "This permission can edit Alert Internal Note of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.ReadAlertInternalNote,
        title: "Read Alert Internal Note",
        description:
          "This permission can read Alert Internal Note of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },

      {
        permission: Permission.CreateIncidentPublicNote,
        title: "Create Incident Status Page Note",
        description:
          "This permission can create Incident Status Page Note this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.DeleteIncidentPublicNote,
        title: "Delete Incident Status Page Note",
        description:
          "This permission can delete Incident Status Page Note of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.EditIncidentPublicNote,
        title: "Edit Incident Status Page Note",
        description:
          "This permission can edit Incident Status Page Note of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.ReadIncidentPublicNote,
        title: "Read Incident Status Page Note",
        description:
          "This permission can read Incident Status Page Note of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },

      {
        permission: Permission.CreateInvoices,
        title: "Create Invoices",
        description: "This permission can create Invoices this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Billing,
      },
      {
        permission: Permission.DeleteInvoices,
        title: "Delete Invoices",
        description: "This permission can delete Invoices of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Billing,
      },
      {
        permission: Permission.EditInvoices,
        title: "Edit Invoices",
        description: "This permission can edit Invoices of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Billing,
      },
      {
        permission: Permission.ReadInvoices,
        title: "Read Invoices",
        description: "This permission can read Invoices of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Billing,
      },

      {
        permission: Permission.CreateBillingPaymentMethod,
        title: "Create Payment Method",
        description: "This permission can create Payment Method this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Billing,
      },
      {
        permission: Permission.DeleteBillingPaymentMethod,
        title: "Delete Payment Method",
        description:
          "This permission can delete Payment Method of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Billing,
      },
      {
        permission: Permission.EditBillingPaymentMethod,
        title: "Edit Payment Method",
        description: "This permission can edit Payment Method of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Billing,
      },
      {
        permission: Permission.ReadBillingPaymentMethod,
        title: "Read Payment Method",
        description: "This permission can read Payment Method of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Billing,
      },

      {
        permission: Permission.ReadProjectOnCallDutyPolicyExecutionLogTimeline,
        title: "Read On-Call Duty Policy Execution Log Timeline",
        description:
          "This permission can read teams in on-call duty execution log timeline.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },

      {
        permission: Permission.ReadProjectOnCallDutyPolicyExecutionLog,
        title: "Read On-Call Duty Policy Execution Log",
        description: "This permission can read on-call duty execution log.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.CreateProjectOnCallDutyPolicyExecutionLog,
        title: "Create On-Call Duty Policy Execution Log",
        description: "This permission can create on-call duty execution log.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },

      {
        permission: Permission.CreateProjectOnCallDutyPolicyEscalationRuleTeam,
        title: "Create On-Call Duty Policy Escalation Rule",
        description:
          "This permission can create teams in on-call duty escalation rule this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.DeleteProjectOnCallDutyPolicyEscalationRuleTeam,
        title: "Delete On-Call Duty Policy Escalation Rule Team",
        description:
          "This permission can delete teams in on-call duty escalation rule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.EditProjectOnCallDutyPolicyEscalationRuleTeam,
        title: "Edit On-Call Duty Policy Escalation Rule Team",
        description:
          "This permission can edit teams in on-call duty escalation rule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.ReadProjectOnCallDutyPolicyEscalationRuleTeam,
        title: "Read On-Call Duty Policy Escalation Rule Team",
        description:
          "This permission can read teams in on-call duty escalation rule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },

      // Incoming Call Policy Permissions
      {
        permission: Permission.CreateProjectIncomingCallPolicy,
        title: "Create Incoming Call Policy",
        description:
          "This permission can create incoming call policies for this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.DeleteProjectIncomingCallPolicy,
        title: "Delete Incoming Call Policy",
        description:
          "This permission can delete incoming call policies of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.EditProjectIncomingCallPolicy,
        title: "Edit Incoming Call Policy",
        description:
          "This permission can edit incoming call policies of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.ReadProjectIncomingCallPolicy,
        title: "Read Incoming Call Policy",
        description:
          "This permission can read incoming call policies of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },

      // Incoming Call Policy Escalation Rule Permissions
      {
        permission: Permission.CreateProjectIncomingCallPolicyEscalationRule,
        title: "Create Incoming Call Policy Escalation Rule",
        description:
          "This permission can create incoming call policy escalation rules for this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.DeleteProjectIncomingCallPolicyEscalationRule,
        title: "Delete Incoming Call Policy Escalation Rule",
        description:
          "This permission can delete incoming call policy escalation rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.EditProjectIncomingCallPolicyEscalationRule,
        title: "Edit Incoming Call Policy Escalation Rule",
        description:
          "This permission can edit incoming call policy escalation rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.ReadProjectIncomingCallPolicyEscalationRule,
        title: "Read Incoming Call Policy Escalation Rule",
        description:
          "This permission can read incoming call policy escalation rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },

      // Incoming Call Policy Owner User Permissions
      {
        permission: Permission.CreateIncomingCallPolicyOwnerUser,
        title: "Create Incoming Call Policy User Owner",
        description:
          "This permission can create Incoming Call Policy User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.DeleteIncomingCallPolicyOwnerUser,
        title: "Delete Incoming Call Policy User Owner",
        description:
          "This permission can delete Incoming Call Policy User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.EditIncomingCallPolicyOwnerUser,
        title: "Edit Incoming Call Policy User Owner",
        description:
          "This permission can edit Incoming Call Policy User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.ReadIncomingCallPolicyOwnerUser,
        title: "Read Incoming Call Policy User Owner",
        description:
          "This permission can read Incoming Call Policy User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },

      // Incoming Call Policy Owner Team Permissions
      {
        permission: Permission.CreateIncomingCallPolicyOwnerTeam,
        title: "Create Incoming Call Policy Team Owner",
        description:
          "This permission can create Incoming Call Policy Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.DeleteIncomingCallPolicyOwnerTeam,
        title: "Delete Incoming Call Policy Team Owner",
        description:
          "This permission can delete Incoming Call Policy Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.EditIncomingCallPolicyOwnerTeam,
        title: "Edit Incoming Call Policy Team Owner",
        description:
          "This permission can edit Incoming Call Policy Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.ReadIncomingCallPolicyOwnerTeam,
        title: "Read Incoming Call Policy Team Owner",
        description:
          "This permission can read Incoming Call Policy Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },

      // On-Call Duty Policy Label Rule Permissions
      {
        permission: Permission.CreateOnCallDutyPolicyLabelRule,
        title: "Create On-Call Duty Policy Label Rule",
        description:
          "This permission can create On-Call Duty Policy Label Rule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.DeleteOnCallDutyPolicyLabelRule,
        title: "Delete On-Call Duty Policy Label Rule",
        description:
          "This permission can delete On-Call Duty Policy Label Rule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.EditOnCallDutyPolicyLabelRule,
        title: "Edit On-Call Duty Policy Label Rule",
        description:
          "This permission can edit On-Call Duty Policy Label Rule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.ReadOnCallDutyPolicyLabelRule,
        title: "Read On-Call Duty Policy Label Rule",
        description:
          "This permission can read On-Call Duty Policy Label Rule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },

      // On-Call Duty Policy Owner Rule Permissions
      {
        permission: Permission.CreateOnCallDutyPolicyOwnerRule,
        title: "Create On-Call Duty Policy Owner Rule",
        description:
          "This permission can create On-Call Duty Policy Owner Rule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.DeleteOnCallDutyPolicyOwnerRule,
        title: "Delete On-Call Duty Policy Owner Rule",
        description:
          "This permission can delete On-Call Duty Policy Owner Rule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.EditOnCallDutyPolicyOwnerRule,
        title: "Edit On-Call Duty Policy Owner Rule",
        description:
          "This permission can edit On-Call Duty Policy Owner Rule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.ReadOnCallDutyPolicyOwnerRule,
        title: "Read On-Call Duty Policy Owner Rule",
        description:
          "This permission can read On-Call Duty Policy Owner Rule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },

      // On-Call Duty Schedule Label Rule Permissions
      {
        permission: Permission.CreateOnCallDutyPolicyScheduleLabelRule,
        title: "Create On-Call Schedule Label Rule",
        description:
          "This permission can create On-Call Schedule Label Rule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.DeleteOnCallDutyPolicyScheduleLabelRule,
        title: "Delete On-Call Schedule Label Rule",
        description:
          "This permission can delete On-Call Schedule Label Rule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.EditOnCallDutyPolicyScheduleLabelRule,
        title: "Edit On-Call Schedule Label Rule",
        description:
          "This permission can edit On-Call Schedule Label Rule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.ReadOnCallDutyPolicyScheduleLabelRule,
        title: "Read On-Call Schedule Label Rule",
        description:
          "This permission can read On-Call Schedule Label Rule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },

      // On-Call Duty Schedule Owner Rule Permissions
      {
        permission: Permission.CreateOnCallDutyPolicyScheduleOwnerRule,
        title: "Create On-Call Schedule Owner Rule",
        description:
          "This permission can create On-Call Schedule Owner Rule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.DeleteOnCallDutyPolicyScheduleOwnerRule,
        title: "Delete On-Call Schedule Owner Rule",
        description:
          "This permission can delete On-Call Schedule Owner Rule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.EditOnCallDutyPolicyScheduleOwnerRule,
        title: "Edit On-Call Schedule Owner Rule",
        description:
          "This permission can edit On-Call Schedule Owner Rule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.ReadOnCallDutyPolicyScheduleOwnerRule,
        title: "Read On-Call Schedule Owner Rule",
        description:
          "This permission can read On-Call Schedule Owner Rule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },

      // Incoming Call Policy Label Rule Permissions
      {
        permission: Permission.CreateIncomingCallPolicyLabelRule,
        title: "Create Incoming Call Policy Label Rule",
        description:
          "This permission can create Incoming Call Policy Label Rule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.DeleteIncomingCallPolicyLabelRule,
        title: "Delete Incoming Call Policy Label Rule",
        description:
          "This permission can delete Incoming Call Policy Label Rule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.EditIncomingCallPolicyLabelRule,
        title: "Edit Incoming Call Policy Label Rule",
        description:
          "This permission can edit Incoming Call Policy Label Rule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.ReadIncomingCallPolicyLabelRule,
        title: "Read Incoming Call Policy Label Rule",
        description:
          "This permission can read Incoming Call Policy Label Rule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },

      // Incoming Call Policy Owner Rule Permissions
      {
        permission: Permission.CreateIncomingCallPolicyOwnerRule,
        title: "Create Incoming Call Policy Owner Rule",
        description:
          "This permission can create Incoming Call Policy Owner Rule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.DeleteIncomingCallPolicyOwnerRule,
        title: "Delete Incoming Call Policy Owner Rule",
        description:
          "This permission can delete Incoming Call Policy Owner Rule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.EditIncomingCallPolicyOwnerRule,
        title: "Edit Incoming Call Policy Owner Rule",
        description:
          "This permission can edit Incoming Call Policy Owner Rule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.ReadIncomingCallPolicyOwnerRule,
        title: "Read Incoming Call Policy Owner Rule",
        description:
          "This permission can read Incoming Call Policy Owner Rule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },

      // Incoming Call Log Permissions
      {
        permission: Permission.ReadProjectIncomingCallLog,
        title: "Read Incoming Call Log",
        description:
          "This permission can read incoming call logs of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },

      // Incoming Call Log Item Permissions
      {
        permission: Permission.ReadProjectIncomingCallLogItem,
        title: "Read Incoming Call Log Item",
        description:
          "This permission can read incoming call log items of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },

      {
        permission:
          Permission.CreateProjectOnCallDutyPolicyEscalationRuleSchedule,
        title: "Create On-Call Duty Policy Escalation Rule Schedule",
        description:
          "This permission can create teams in on-call duty escalation rule schedule this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission:
          Permission.DeleteProjectOnCallDutyPolicyEscalationRuleSchedule,
        title: "Delete On-Call Duty Policy Escalation Rule Schedule",
        description:
          "This permission can delete teams in on-call duty escalation rule schedule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission:
          Permission.EditProjectOnCallDutyPolicyEscalationRuleSchedule,
        title: "Edit On-Call Duty Policy Escalation Rule Schedule",
        description:
          "This permission can edit teams in on-call duty escalation rule schedule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission:
          Permission.ReadProjectOnCallDutyPolicyEscalationRuleSchedule,
        title: "Read On-Call Duty Policy Escalation Rule Schedule",
        description:
          "This permission can read teams in on-call duty escalation rule schedule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },

      {
        permission: Permission.CreateMonitorSecret,
        title: "Create Monitor Secret",
        description: "This permission can create monitor secret.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },
      {
        permission: Permission.DeleteMonitorSecret,
        title: "Delete Monitor Secret",
        description: "This permission can delete monitor secret",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },
      {
        permission: Permission.EditMonitorSecret,
        title: "Edit Monitor Secret",
        description: "This permission can edit monitor secret.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },
      {
        permission: Permission.ReadMonitorSecret,
        title: "Read Monitor Secret",
        description: "This permission can read monitor secret.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },

      {
        permission: Permission.CreateProjectOnCallDutyPolicyEscalationRuleUser,
        title: "Create On-Call Duty Policy Escalation Rule User",
        description:
          "This permission can create on-call duty escalation rule this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.DeleteProjectOnCallDutyPolicyEscalationRuleUser,
        title: "Delete On-Call Duty Policy Escalation Rule User",
        description:
          "This permission can delete on-call duty escalation rule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.EditProjectOnCallDutyPolicyEscalationRuleUser,
        title: "Edit On-Call Duty Policy Escalation Rule User",
        description:
          "This permission can edit on-call duty escalation rule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.ReadProjectOnCallDutyPolicyEscalationRuleUser,
        title: "Read On-Call Duty Policy Escalation Rule User",
        description:
          "This permission can read on-call duty escalation rule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },

      {
        permission: Permission.CreateProjectOnCallDutyPolicyEscalationRule,
        title: "Create On-Call Duty Policy Escalation Rule",
        description:
          "This permission can create on-call duty escalation rule this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.DeleteProjectOnCallDutyPolicyEscalationRule,
        title: "Delete On-Call Duty Policy Escalation Rule",
        description:
          "This permission can delete on-call duty escalation rule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.EditProjectOnCallDutyPolicyEscalationRule,
        title: "Edit On-Call Duty Policy Escalation Rule",
        description:
          "This permission can edit on-call duty escalation rule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.ReadProjectOnCallDutyPolicyEscalationRule,
        title: "Read On-Call Duty Policy Escalation Rule",
        description:
          "This permission can read on-call duty escalation rule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },

      {
        permission: Permission.ReadOnCallDutyPolicyTimeLog,
        title: "Create On-Call Policy Time Log",
        description:
          "This permission can read on-call policy time log this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },

      {
        permission: Permission.CreateOnCallDutyPolicyUserOverride,
        title: "Create On-Call Duty Policy User Override",
        description:
          "This permission can create on-call duty policy user override this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.DeleteOnCallDutyPolicyUserOverride,
        title: "Delete On-Call Duty Policy User Override",
        description:
          "This permission can delete on-call duty policy user override of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.EditOnCallDutyPolicyUserOverride,
        title: "Edit On-Call Duty Policy User Override",
        description:
          "This permission can edit on-call duty policy user override of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.ReadOnCallDutyPolicyUserOverride,
        title: "Read On-Call Duty Policy User Override",
        description:
          "This permission can read on-call duty policy user override of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },

      {
        permission: Permission.CreateProjectOnCallDutyPolicy,
        title: "Create On-Call Duty Policy",
        description: "This permission can create on-call duty this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.DeleteProjectOnCallDutyPolicy,
        title: "Delete On-Call Duty Policy",
        description: "This permission can delete on-call duty of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.EditProjectOnCallDutyPolicy,
        title: "Edit On-Call Duty Policy",
        description: "This permission can edit on-call duty of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.ReadProjectOnCallDutyPolicy,
        title: "Read On-Call Duty Policy",
        description: "This permission can read on-call duty of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },

      {
        permission: Permission.CreateProjectOnCallDutyPolicySchedule,
        title: "Create On-Call Duty Policy Schedule",
        description:
          "This permission can create on-call duty schedule this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.DeleteProjectOnCallDutyPolicySchedule,
        title: "Delete On-Call Duty Policy Schedule",
        description:
          "This permission can delete on-call duty schedule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.EditProjectOnCallDutyPolicySchedule,
        title: "Edit On-Call Duty Policy Schedule",
        description:
          "This permission can edit on-call duty schedule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.ReadProjectOnCallDutyPolicySchedule,
        title: "Read On-Call Duty Policy Schedule",
        description:
          "This permission can read on-call duty schedule of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },

      {
        permission: Permission.CreateProjectStatusPage,
        title: "Create Status Page",
        description: "This permission can create status pages this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.DeleteProjectStatusPage,
        title: "Delete Status Page",
        description: "This permission can delete status pages of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.EditProjectStatusPage,
        title: "Edit Status Page",
        description: "This permission can edit status pages of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.ReadProjectStatusPage,
        title: "Read Status Page",
        description: "This permission can read status pages of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },

      {
        permission: Permission.CreateProjectProbe,
        title: "Create Probe",
        description: "This permission can create probe this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Probe,
      },
      {
        permission: Permission.DeleteProjectProbe,
        title: "Delete Probe",
        description: "This permission can delete probe of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.Probe,
      },
      {
        permission: Permission.EditProjectProbe,
        title: "Edit Probe",
        description: "This permission can edit probe of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.Probe,
      },
      {
        permission: Permission.ReadProjectProbe,
        title: "Read Probe",
        description: "This permission can read probe of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.Probe,
      },

      {
        permission: Permission.CreateProjectAIAgent,
        title: "Create AI Agent",
        description: "This permission can create AI agents for this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.AIAgent,
      },
      {
        permission: Permission.DeleteProjectAIAgent,
        title: "Delete AI Agent",
        description: "This permission can delete AI agents of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.AIAgent,
      },
      {
        permission: Permission.EditProjectAIAgent,
        title: "Edit AI Agent",
        description: "This permission can edit AI agents of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.AIAgent,
      },
      {
        permission: Permission.ReadProjectAIAgent,
        title: "Read AI Agent",
        description: "This permission can read AI agents of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.AIAgent,
      },

      {
        permission: Permission.CreateProjectAIAgentTask,
        title: "Create AI Agent Task",
        description:
          "This permission can create AI agent tasks for this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.AIAgent,
      },
      {
        permission: Permission.DeleteProjectAIAgentTask,
        title: "Delete AI Agent Task",
        description:
          "This permission can delete AI agent tasks of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.AIAgent,
      },
      {
        permission: Permission.EditProjectAIAgentTask,
        title: "Edit AI Agent Task",
        description: "This permission can edit AI agent tasks of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.AIAgent,
      },
      {
        permission: Permission.ReadProjectAIAgentTask,
        title: "Read AI Agent Task",
        description: "This permission can read AI agent tasks of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.AIAgent,
      },

      {
        permission: Permission.CreateProjectAIAgentTaskTelemetryException,
        title: "Create AI Agent Task Exception Link",
        description:
          "This permission can create links between AI agent tasks and telemetry exceptions.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.AIAgent,
      },
      {
        permission: Permission.DeleteProjectAIAgentTaskTelemetryException,
        title: "Delete AI Agent Task Exception Link",
        description:
          "This permission can delete links between AI agent tasks and telemetry exceptions.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.AIAgent,
      },
      {
        permission: Permission.EditProjectAIAgentTaskTelemetryException,
        title: "Edit AI Agent Task Exception Link",
        description:
          "This permission can edit links between AI agent tasks and telemetry exceptions.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.AIAgent,
      },
      {
        permission: Permission.ReadProjectAIAgentTaskTelemetryException,
        title: "Read AI Agent Task Exception Link",
        description:
          "This permission can read links between AI agent tasks and telemetry exceptions.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.AIAgent,
      },

      {
        permission: Permission.CreateProjectLlm,
        title: "Create LLM",
        description:
          "This permission can create LLM configurations for this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.AIAgent,
      },
      {
        permission: Permission.DeleteProjectLlm,
        title: "Delete LLM",
        description:
          "This permission can delete LLM configurations of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.AIAgent,
      },
      {
        permission: Permission.EditProjectLlm,
        title: "Edit LLM",
        description:
          "This permission can edit LLM configurations of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.AIAgent,
      },
      {
        permission: Permission.ReadProjectLlm,
        title: "Read LLM",
        description:
          "This permission can read LLM configurations of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.AIAgent,
      },

      {
        permission: Permission.CreateTelemetryService,
        title: "Create Telemetry Service",
        description:
          "This permission can create Telemetry Service this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.DeleteTelemetryService,
        title: "Delete Telemetry Service",
        description:
          "This permission can delete Telemetry Service of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.EditTelemetryService,
        title: "Edit Telemetry Service",
        description:
          "This permission can edit Telemetry Service of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.ReadTelemetryService,
        title: "Read Telemetry Service",
        description: "This permission can read Service of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },

      {
        permission: Permission.CreateMonitorGroupResource,
        title: "Create Monitor Group Resource",
        description: "This permission can create monitor group resource.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },
      {
        permission: Permission.DeleteMonitorGroupResource,
        title: "Delete Monitor Group Resource",
        description: "This permission can delete monitor group resource.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },
      {
        permission: Permission.EditMonitorGroupResource,
        title: "Edit Monitor Group Resource",
        description: "This permission can edit monitor group resource.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },
      {
        permission: Permission.ReadMonitorGroupResource,
        title: "Read Monitor Group Resource",
        description: "This permission can read monitor group resource.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },

      {
        permission: Permission.CreateOnCallDutyPolicyCustomField,
        title: "Create On-Call Policy Custom Field",
        description:
          "This permission can create On-Call Policy Custom Field this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.DeleteOnCallDutyPolicyCustomField,
        title: "Delete On-Call Policy Custom Field",
        description:
          "This permission can delete On-Call Policy Custom Field of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.EditOnCallDutyPolicyCustomField,
        title: "Edit On-Call Policy Custom Field",
        description:
          "This permission can edit On-Call Policy Custom Field of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.ReadOnCallDutyPolicyCustomField,
        title: "Read On-Call Policy Custom Field",
        description:
          "This permission can read On-Call Policy Custom Field of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },

      {
        permission: Permission.CreateOnCallDutyPolicyScheduleLayer,
        title: "Create On-Call Schedule Layer",
        description:
          "This permission can create On-Call Schedule Layer this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.DeleteOnCallDutyPolicyScheduleLayer,
        title: "Delete On-Call Schedule Layer",
        description:
          "This permission can delete On-Call Schedule Layer of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.EditOnCallDutyPolicyScheduleLayer,
        title: "Edit On-Call Schedule Layer",
        description:
          "This permission can edit On-Call Schedule Layer of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.ReadOnCallDutyPolicyScheduleLayer,
        title: "Read On-Call Schedule Layer",
        description:
          "This permission can read On-Call Schedule Layer of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },

      {
        permission: Permission.CreateOnCallDutyPolicyScheduleLayerUser,
        title: "Create On-Call Schedule Layer User",
        description:
          "This permission can create On-Call Schedule Layer User this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.DeleteOnCallDutyPolicyScheduleLayerUser,
        title: "Delete On-Call Schedule Layer User",
        description:
          "This permission can delete On-Call Schedule Layer User of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.EditOnCallDutyPolicyScheduleLayerUser,
        title: "Edit On-Call Schedule Layer User",
        description:
          "This permission can edit On-Call Schedule Layer User of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.ReadOnCallDutyPolicyScheduleLayerUser,
        title: "Read On-Call Schedule Layer User",
        description:
          "This permission can read On-Call Schedule Layer User of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },

      {
        permission: Permission.CreateMonitorCustomField,
        title: "Create Monitor Custom Field",
        description:
          "This permission can create Monitor Custom Field this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },
      {
        permission: Permission.DeleteMonitorCustomField,
        title: "Delete Monitor Custom Field",
        description:
          "This permission can delete Monitor Custom Field of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },
      {
        permission: Permission.EditMonitorCustomField,
        title: "Edit Monitor Custom Field",
        description:
          "This permission can edit Monitor Custom Field of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },
      {
        permission: Permission.ReadMonitorCustomField,
        title: "Read Monitor Custom Field",
        description:
          "This permission can read Monitor Custom Field of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },

      {
        permission: Permission.CreateIncidentCustomField,
        title: "Create Incident Custom Field",
        description:
          "This permission can create Incident Custom Field this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.DeleteIncidentCustomField,
        title: "Delete Incident Custom Field",
        description:
          "This permission can delete Incident Custom Field of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.EditIncidentCustomField,
        title: "Edit Incident Custom Field",
        description:
          "This permission can edit Incident Custom Field of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.ReadIncidentCustomField,
        title: "Read Incident Custom Field",
        description:
          "This permission can read Incident Custom Field of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },

      {
        permission: Permission.CreateAlertCustomField,
        title: "Create Alert Custom Field",
        description:
          "This permission can create Alert Custom Field this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.DeleteAlertCustomField,
        title: "Delete Alert Custom Field",
        description:
          "This permission can delete Alert Custom Field of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.EditAlertCustomField,
        title: "Edit Alert Custom Field",
        description:
          "This permission can edit Alert Custom Field of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.ReadAlertCustomField,
        title: "Read Alert Custom Field",
        description:
          "This permission can read Alert Custom Field of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },

      {
        permission: Permission.CreateTeamMemberCustomField,
        title: "Create Team Member Custom Field",
        description:
          "This permission can create Team Member Custom Field for this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Team,
      },
      {
        permission: Permission.DeleteTeamMemberCustomField,
        title: "Delete Team Member Custom Field",
        description:
          "This permission can delete Team Member Custom Field of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Team,
      },
      {
        permission: Permission.EditTeamMemberCustomField,
        title: "Edit Team Member Custom Field",
        description:
          "This permission can edit Team Member Custom Field of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Team,
      },
      {
        permission: Permission.ReadTeamMemberCustomField,
        title: "Read Team Member Custom Field",
        description:
          "This permission can read Team Member Custom Field of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Team,
      },

      {
        permission: Permission.CreateStatusPageCustomField,
        title: "Create Status Page Custom Field",
        description:
          "This permission can create Status Page Custom Field this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.DeleteStatusPageCustomField,
        title: "Delete Status Page Custom Field",
        description:
          "This permission can delete Status Page Custom Field of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.EditStatusPageCustomField,
        title: "Edit Status Page Custom Field",
        description:
          "This permission can edit Status Page Custom Field of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.ReadStatusPageCustomField,
        title: "Read Status Page Custom Field",
        description:
          "This permission can read Status Page Custom Field of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },

      {
        permission: Permission.CreateScheduledMaintenanceCustomField,
        title: "Create Scheduled Maintenance Custom Field",
        description:
          "This permission can create Scheduled Maintenance Custom Field this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },
      {
        permission: Permission.DeleteScheduledMaintenanceCustomField,
        title: "Delete Scheduled Maintenance Custom Field",
        description:
          "This permission can delete Scheduled Maintenance Custom Field of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },
      {
        permission: Permission.EditScheduledMaintenanceCustomField,
        title: "Edit Scheduled Maintenance Custom Field",
        description:
          "This permission can edit Scheduled Maintenance Custom Field of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },
      {
        permission: Permission.ReadScheduledMaintenanceCustomField,
        title: "Read Scheduled Maintenance Custom Field",
        description:
          "This permission can read Scheduled Maintenance Custom Field of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },

      {
        permission: Permission.ReadSmsLog,
        title: "Read SMS Log",
        description: "This permission can read SMS Log of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.NotificationLog,
      },

      {
        permission: Permission.ReadWhatsAppLog,
        title: "Read WhatsApp Log",
        description: "This permission can read WhatsApp Log of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.NotificationLog,
      },

      {
        permission: Permission.ReadTelegramLog,
        title: "Read Telegram Log",
        description: "This permission can read Telegram Log of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.NotificationLog,
      },

      {
        permission: Permission.ReadCallLog,
        title: "Read Call Log",
        description: "This permission can read Call Logs of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.NotificationLog,
      },

      {
        permission: Permission.ReadPushLog,
        title: "Read Push Log",
        description:
          "This permission can read Push Notification Logs of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.NotificationLog,
      },

      {
        permission: Permission.ReadWebhookLog,
        title: "Read Webhook Log",
        description:
          "This permission can read outbound Webhook request Logs of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.NotificationLog,
      },

      {
        permission: Permission.ReadWorkspaceNotificationLog,
        title: "Read Workspace Notification Log",
        description:
          "This permission can read Workspace Notification Logs (Slack / Microsoft Teams) of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.NotificationLog,
      },

      {
        permission: Permission.ReadLlmLog,
        title: "Read LLM Log",
        description: "This permission can read LLM Logs of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.NotificationLog,
      },

      {
        permission: Permission.CreateMonitorProbe,
        title: "Create Monitor Probe",
        description: "This permission can create Monitor Probe this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },
      {
        permission: Permission.DeleteMonitorProbe,
        title: "Delete Monitor Probe",
        description:
          "This permission can delete Monitor Probe of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },
      {
        permission: Permission.EditMonitorProbe,
        title: "Edit Monitor Probe",
        description: "This permission can edit Monitor Probe of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },
      {
        permission: Permission.ReadMonitorProbe,
        title: "Read Monitor Probe",
        description: "This permission can read Monitor Probe of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },

      {
        permission: Permission.CreateTelemetryServiceLog,
        title: "Create Telemetry Service Log",
        description:
          "This permission can create Telemetry Service Log this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.DeleteTelemetryServiceLog,
        title: "Delete Telemetry Service Log",
        description:
          "This permission can delete Telemetry Service Log of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.EditTelemetryServiceLog,
        title: "Edit Telemetry Service Log",
        description:
          "This permission can edit Telemetry Service Log of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.ReadTelemetryServiceLog,
        title: "Read Telemetry Service Log",
        description:
          "This permission can read Telemetry Service Log of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },

      // Log Pipeline Permissions
      {
        permission: Permission.CreateProjectLogPipeline,
        title: "Create Log Pipeline",
        description:
          "This permission can create Log Pipelines in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.DeleteProjectLogPipeline,
        title: "Delete Log Pipeline",
        description:
          "This permission can delete Log Pipelines of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.EditProjectLogPipeline,
        title: "Edit Log Pipeline",
        description: "This permission can edit Log Pipelines of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.ReadProjectLogPipeline,
        title: "Read Log Pipeline",
        description: "This permission can read Log Pipelines of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },

      // Log Pipeline Processor Permissions
      {
        permission: Permission.CreateProjectLogPipelineProcessor,
        title: "Create Log Pipeline Processor",
        description:
          "This permission can create Log Pipeline Processors in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.DeleteProjectLogPipelineProcessor,
        title: "Delete Log Pipeline Processor",
        description:
          "This permission can delete Log Pipeline Processors of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.EditProjectLogPipelineProcessor,
        title: "Edit Log Pipeline Processor",
        description:
          "This permission can edit Log Pipeline Processors of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.ReadProjectLogPipelineProcessor,
        title: "Read Log Pipeline Processor",
        description:
          "This permission can read Log Pipeline Processors of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },

      // Log Drop Filter Permissions
      {
        permission: Permission.CreateProjectLogDropFilter,
        title: "Create Log Drop Filter",
        description:
          "This permission can create Log Drop Filters in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.DeleteProjectLogDropFilter,
        title: "Delete Log Drop Filter",
        description:
          "This permission can delete Log Drop Filters of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.EditProjectLogDropFilter,
        title: "Edit Log Drop Filter",
        description:
          "This permission can edit Log Drop Filters of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.ReadProjectLogDropFilter,
        title: "Read Log Drop Filter",
        description:
          "This permission can read Log Drop Filters of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },

      // Log Scrub Rule Permissions
      {
        permission: Permission.CreateProjectLogScrubRule,
        title: "Create Log Scrub Rule",
        description:
          "This permission can create Log Scrub Rules in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.DeleteProjectLogScrubRule,
        title: "Delete Log Scrub Rule",
        description:
          "This permission can delete Log Scrub Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.EditProjectLogScrubRule,
        title: "Edit Log Scrub Rule",
        description:
          "This permission can edit Log Scrub Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.ReadProjectLogScrubRule,
        title: "Read Log Scrub Rule",
        description:
          "This permission can read Log Scrub Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },

      // Metric Pipeline Rule Permissions
      {
        permission: Permission.CreateProjectMetricPipelineRule,
        title: "Create Metric Pipeline Rule",
        description:
          "This permission can create Metric Pipeline Rules in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.DeleteProjectMetricPipelineRule,
        title: "Delete Metric Pipeline Rule",
        description:
          "This permission can delete Metric Pipeline Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.EditProjectMetricPipelineRule,
        title: "Edit Metric Pipeline Rule",
        description:
          "This permission can edit Metric Pipeline Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.ReadProjectMetricPipelineRule,
        title: "Read Metric Pipeline Rule",
        description:
          "This permission can read Metric Pipeline Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },

      // Metric Recording Rule Permissions (derived metrics)
      {
        permission: Permission.CreateProjectMetricRecordingRule,
        title: "Create Metric Recording Rule",
        description:
          "This permission can create Metric Recording Rules (derived metrics) in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.DeleteProjectMetricRecordingRule,
        title: "Delete Metric Recording Rule",
        description:
          "This permission can delete Metric Recording Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.EditProjectMetricRecordingRule,
        title: "Edit Metric Recording Rule",
        description:
          "This permission can edit Metric Recording Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.ReadProjectMetricRecordingRule,
        title: "Read Metric Recording Rule",
        description:
          "This permission can read Metric Recording Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },

      // Trace Pipeline Permissions
      {
        permission: Permission.CreateProjectTracePipeline,
        title: "Create Trace Pipeline",
        description:
          "This permission can create Trace Pipelines in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.DeleteProjectTracePipeline,
        title: "Delete Trace Pipeline",
        description:
          "This permission can delete Trace Pipelines of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.EditProjectTracePipeline,
        title: "Edit Trace Pipeline",
        description:
          "This permission can edit Trace Pipelines of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.ReadProjectTracePipeline,
        title: "Read Trace Pipeline",
        description:
          "This permission can read Trace Pipelines of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },

      // Trace Pipeline Processor Permissions
      {
        permission: Permission.CreateProjectTracePipelineProcessor,
        title: "Create Trace Pipeline Processor",
        description:
          "This permission can create Trace Pipeline Processors in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.DeleteProjectTracePipelineProcessor,
        title: "Delete Trace Pipeline Processor",
        description:
          "This permission can delete Trace Pipeline Processors of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.EditProjectTracePipelineProcessor,
        title: "Edit Trace Pipeline Processor",
        description:
          "This permission can edit Trace Pipeline Processors of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.ReadProjectTracePipelineProcessor,
        title: "Read Trace Pipeline Processor",
        description:
          "This permission can read Trace Pipeline Processors of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },

      // Trace Drop Filter Permissions
      {
        permission: Permission.CreateProjectTraceDropFilter,
        title: "Create Trace Drop Filter",
        description:
          "This permission can create Trace Drop Filters in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.DeleteProjectTraceDropFilter,
        title: "Delete Trace Drop Filter",
        description:
          "This permission can delete Trace Drop Filters of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.EditProjectTraceDropFilter,
        title: "Edit Trace Drop Filter",
        description:
          "This permission can edit Trace Drop Filters of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.ReadProjectTraceDropFilter,
        title: "Read Trace Drop Filter",
        description:
          "This permission can read Trace Drop Filters of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },

      // Trace Scrub Rule Permissions
      {
        permission: Permission.CreateProjectTraceScrubRule,
        title: "Create Trace Scrub Rule",
        description:
          "This permission can create Trace Scrub Rules in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.DeleteProjectTraceScrubRule,
        title: "Delete Trace Scrub Rule",
        description:
          "This permission can delete Trace Scrub Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.EditProjectTraceScrubRule,
        title: "Edit Trace Scrub Rule",
        description:
          "This permission can edit Trace Scrub Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.ReadProjectTraceScrubRule,
        title: "Read Trace Scrub Rule",
        description:
          "This permission can read Trace Scrub Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },

      // Trace Recording Rule Permissions (derived metrics from spans)
      {
        permission: Permission.CreateProjectTraceRecordingRule,
        title: "Create Trace Recording Rule",
        description:
          "This permission can create Trace Recording Rules (derived metrics from spans) in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.DeleteProjectTraceRecordingRule,
        title: "Delete Trace Recording Rule",
        description:
          "This permission can delete Trace Recording Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.EditProjectTraceRecordingRule,
        title: "Edit Trace Recording Rule",
        description:
          "This permission can edit Trace Recording Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.ReadProjectTraceRecordingRule,
        title: "Read Trace Recording Rule",
        description:
          "This permission can read Trace Recording Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },

      {
        permission: Permission.CreateTelemetryException,
        title: "Create Telemetry Service Exception",
        description:
          "This permission can create Telemetry Service Exception this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.DeleteTelemetryException,
        title: "Delete Telemetry Service Exception",
        description:
          "This permission can delete Telemetry Service Exception of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.EditTelemetryException,
        title: "Edit Telemetry Service Exception",
        description:
          "This permission can edit Telemetry Service Exception of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.ReadTelemetryException,
        title: "Read Telemetry Service Exception",
        description:
          "This permission can read Telemetry Service Exception of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },

      {
        permission: Permission.CreateProbeOwnerTeam,
        title: "Create Probe Owner Team",
        description: "This permission can create owners for probes.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Probe,
      },
      {
        permission: Permission.DeleteProbeOwnerTeam,
        title: "Delete Probe Owner Team",
        description: "This permission can delete owners for probes",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Probe,
      },
      {
        permission: Permission.EditProbeOwnerTeam,
        title: "Edit Probe Owner Team",
        description: "This permission can edit owners for probes",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Probe,
      },
      {
        permission: Permission.ReadProbeOwnerTeam,
        title: "Read Probe Owner Team",
        description: "This permission can read owners for probes",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Probe,
      },

      {
        permission: Permission.CreateProbeOwnerUser,
        title: "Create Probe Owner User",
        description: "This permission can create owners for probes.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Probe,
      },
      {
        permission: Permission.DeleteProbeOwnerUser,
        title: "Delete Probe Owner User",
        description: "This permission can delete owners for probes",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Probe,
      },
      {
        permission: Permission.EditProbeOwnerUser,
        title: "Edit Probe Owner User",
        description: "This permission can edit owners for probes",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Probe,
      },
      {
        permission: Permission.ReadProbeOwnerUser,
        title: "Read Probe Owner User",
        description: "This permission can read owners for probes",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Probe,
      },

      {
        permission: Permission.CreateAIAgentOwnerTeam,
        title: "Create AI Agent Owner Team",
        description: "This permission can create team owners for AI agents.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.AIAgent,
      },
      {
        permission: Permission.DeleteAIAgentOwnerTeam,
        title: "Delete AI Agent Owner Team",
        description: "This permission can delete team owners for AI agents",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.AIAgent,
      },
      {
        permission: Permission.EditAIAgentOwnerTeam,
        title: "Edit AI Agent Owner Team",
        description: "This permission can edit team owners for AI agents",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.AIAgent,
      },
      {
        permission: Permission.ReadAIAgentOwnerTeam,
        title: "Read AI Agent Owner Team",
        description: "This permission can read team owners for AI agents",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.AIAgent,
      },

      {
        permission: Permission.CreateAIAgentOwnerUser,
        title: "Create AI Agent Owner User",
        description: "This permission can create user owners for AI agents.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.AIAgent,
      },
      {
        permission: Permission.DeleteAIAgentOwnerUser,
        title: "Delete AI Agent Owner User",
        description: "This permission can delete user owners for AI agents",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.AIAgent,
      },
      {
        permission: Permission.EditAIAgentOwnerUser,
        title: "Edit AI Agent Owner User",
        description: "This permission can edit user owners for AI agents",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.AIAgent,
      },
      {
        permission: Permission.ReadAIAgentOwnerUser,
        title: "Read AI Agent Owner User",
        description: "This permission can read user owners for AI agents",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.AIAgent,
      },

      {
        permission: Permission.CreateKubernetesCluster,
        title: "Create Kubernetes Cluster",
        description:
          "This permission can create Kubernetes Cluster in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.DeleteKubernetesCluster,
        title: "Delete Kubernetes Cluster",
        description:
          "This permission can delete Kubernetes Cluster of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.EditKubernetesCluster,
        title: "Edit Kubernetes Cluster",
        description:
          "This permission can edit Kubernetes Cluster of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.ReadKubernetesCluster,
        title: "Read Kubernetes Cluster",
        description:
          "This permission can read Kubernetes Cluster of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },

      {
        permission: Permission.CreateDockerHost,
        title: "Create Docker Host",
        description: "This permission can create Docker Host in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.DeleteDockerHost,
        title: "Delete Docker Host",
        description: "This permission can delete Docker Host of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.EditDockerHost,
        title: "Edit Docker Host",
        description: "This permission can edit Docker Host of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.ReadDockerHost,
        title: "Read Docker Host",
        description: "This permission can read Docker Host of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },

      {
        permission: Permission.CreateKubernetesClusterOwnerTeam,
        title: "Create Kubernetes Cluster Team Owner",
        description:
          "This permission can create Kubernetes Cluster Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.DeleteKubernetesClusterOwnerTeam,
        title: "Delete Kubernetes Cluster Team Owner",
        description:
          "This permission can delete Kubernetes Cluster Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.EditKubernetesClusterOwnerTeam,
        title: "Edit Kubernetes Cluster Team Owner",
        description:
          "This permission can edit Kubernetes Cluster Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.ReadKubernetesClusterOwnerTeam,
        title: "Read Kubernetes Cluster Team Owner",
        description:
          "This permission can read Kubernetes Cluster Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },

      {
        permission: Permission.CreateKubernetesClusterOwnerUser,
        title: "Create Kubernetes Cluster User Owner",
        description:
          "This permission can create Kubernetes Cluster User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.DeleteKubernetesClusterOwnerUser,
        title: "Delete Kubernetes Cluster User Owner",
        description:
          "This permission can delete Kubernetes Cluster User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.EditKubernetesClusterOwnerUser,
        title: "Edit Kubernetes Cluster User Owner",
        description:
          "This permission can edit Kubernetes Cluster User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.ReadKubernetesClusterOwnerUser,
        title: "Read Kubernetes Cluster User Owner",
        description:
          "This permission can read Kubernetes Cluster User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },

      {
        permission: Permission.CreateDockerHostOwnerTeam,
        title: "Create Docker Host Team Owner",
        description:
          "This permission can create Docker Host Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.DeleteDockerHostOwnerTeam,
        title: "Delete Docker Host Team Owner",
        description:
          "This permission can delete Docker Host Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.EditDockerHostOwnerTeam,
        title: "Edit Docker Host Team Owner",
        description:
          "This permission can edit Docker Host Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.ReadDockerHostOwnerTeam,
        title: "Read Docker Host Team Owner",
        description:
          "This permission can read Docker Host Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },

      {
        permission: Permission.CreateDockerHostOwnerUser,
        title: "Create Docker Host User Owner",
        description:
          "This permission can create Docker Host User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.DeleteDockerHostOwnerUser,
        title: "Delete Docker Host User Owner",
        description:
          "This permission can delete Docker Host User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.EditDockerHostOwnerUser,
        title: "Edit Docker Host User Owner",
        description:
          "This permission can edit Docker Host User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.ReadDockerHostOwnerUser,
        title: "Read Docker Host User Owner",
        description:
          "This permission can read Docker Host User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },

      {
        permission: Permission.CreateHost,
        title: "Create Host",
        description: "This permission can create Host in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.DeleteHost,
        title: "Delete Host",
        description: "This permission can delete Host of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.EditHost,
        title: "Edit Host",
        description: "This permission can edit Host of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.ReadHost,
        title: "Read Host",
        description: "This permission can read Host of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },

      {
        permission: Permission.CreateHostOwnerTeam,
        title: "Create Host Team Owner",
        description:
          "This permission can create Host Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.DeleteHostOwnerTeam,
        title: "Delete Host Team Owner",
        description:
          "This permission can delete Host Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.EditHostOwnerTeam,
        title: "Edit Host Team Owner",
        description:
          "This permission can edit Host Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.ReadHostOwnerTeam,
        title: "Read Host Team Owner",
        description:
          "This permission can read Host Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },

      {
        permission: Permission.CreateHostOwnerUser,
        title: "Create Host User Owner",
        description:
          "This permission can create Host User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.DeleteHostOwnerUser,
        title: "Delete Host User Owner",
        description:
          "This permission can delete Host User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.EditHostOwnerUser,
        title: "Edit Host User Owner",
        description:
          "This permission can edit Host User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.ReadHostOwnerUser,
        title: "Read Host User Owner",
        description:
          "This permission can read Host User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },

      {
        permission: Permission.CreateService,
        title: "Create Service",
        description: "This permission can create Service in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.ServiceCatalog,
      },
      {
        permission: Permission.DeleteService,
        title: "Delete Service",
        description: "This permission can delete Service of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.ServiceCatalog,
      },
      {
        permission: Permission.EditService,
        title: "Edit Service",
        description: "This permission can edit Service of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.ServiceCatalog,
      },
      {
        permission: Permission.ReadService,
        title: "Read Service",
        description: "This permission can read Service of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.ServiceCatalog,
      },

      {
        permission: Permission.CreateServiceMonitor,
        title: "Create Service Monitor",
        description:
          "This permission can create Service Monitor in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ServiceCatalog,
      },
      {
        permission: Permission.DeleteServiceMonitor,
        title: "Delete Service Monitor",
        description:
          "This permission can delete Service Monitor of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ServiceCatalog,
      },
      {
        permission: Permission.EditServiceMonitor,
        title: "Edit Service Monitor",
        description:
          "This permission can edit Service Monitor of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ServiceCatalog,
      },
      {
        permission: Permission.ReadServiceMonitor,
        title: "Read Service Monitor",
        description:
          "This permission can read Service Monitor of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ServiceCatalog,
      },

      {
        permission: Permission.CreateServiceTelemetryService,
        title: "Create Service Telemetry Service",
        description:
          "This permission can create Service Telemetry Service in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ServiceCatalog,
      },
      {
        permission: Permission.DeleteServiceTelemetryService,
        title: "Delete Service Telemetry Service",
        description:
          "This permission can delete Service Telemetry Service of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ServiceCatalog,
      },
      {
        permission: Permission.EditServiceTelemetryService,
        title: "Edit Service Telemetry Service",
        description:
          "This permission can edit Service Telemetry Service of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ServiceCatalog,
      },
      {
        permission: Permission.ReadServiceTelemetryService,
        title: "Read Service Telemetry Service",
        description:
          "This permission can read Service Telemetry Service of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ServiceCatalog,
      },

      {
        permission: Permission.CreateServiceCodeRepository,
        title: "Create Service Code Repository",
        description:
          "This permission can create Service Code Repository in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ServiceCatalog,
      },
      {
        permission: Permission.DeleteServiceCodeRepository,
        title: "Delete Service Code Repository",
        description:
          "This permission can delete Service Code Repository of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ServiceCatalog,
      },
      {
        permission: Permission.EditServiceCodeRepository,
        title: "Edit Service Code Repository",
        description:
          "This permission can edit Service Code Repository of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ServiceCatalog,
      },
      {
        permission: Permission.ReadServiceCodeRepository,
        title: "Read Service Code Repository",
        description:
          "This permission can read Service Code Repository of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ServiceCatalog,
      },

      // Code Repository Permissions
      {
        permission: Permission.CreateCodeRepository,
        title: "Create Code Repository",
        description:
          "This permission can create Code Repositories in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ServiceCatalog,
      },
      {
        permission: Permission.DeleteCodeRepository,
        title: "Delete Code Repository",
        description:
          "This permission can delete Code Repositories of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.ServiceCatalog,
      },
      {
        permission: Permission.EditCodeRepository,
        title: "Edit Code Repository",
        description:
          "This permission can edit Code Repositories of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.ServiceCatalog,
      },
      {
        permission: Permission.ReadCodeRepository,
        title: "Read Code Repository",
        description:
          "This permission can read Code Repositories of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.ServiceCatalog,
      },

      {
        permission: Permission.CreateTelemetryServiceTraces,
        title: "Create Telemetry Service Traces",
        description:
          "This permission can create Telemetry Service Traces this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.DeleteTelemetryServiceTraces,
        title: "Delete Telemetry Service Traces",
        description:
          "This permission can delete Telemetry Service Traces of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.EditTelemetryServiceTraces,
        title: "Edit Telemetry Service Traces",
        description:
          "This permission can edit Telemetry Service Traces of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.ReadTelemetryServiceTraces,
        title: "Read Telemetry Service Traces",
        description:
          "This permission can read Telemetry Service Traces of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },

      {
        permission: Permission.CreateTelemetryServiceMetrics,
        title: "Create Telemetry Service Metrics",
        description:
          "This permission can create Telemetry Service Metrics this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.DeleteTelemetryServiceMetrics,
        title: "Delete Telemetry Service Metrics",
        description:
          "This permission can delete Telemetry Service Metrics of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.EditTelemetryServiceMetrics,
        title: "Edit Telemetry Service Metrics",
        description:
          "This permission can edit Telemetry Service Metrics of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.ReadTelemetryServiceMetrics,
        title: "Read Telemetry Service Metrics",
        description:
          "This permission can read Telemetry Service Metrics of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },

      {
        permission: Permission.CreateTelemetryServiceProfiles,
        title: "Create Telemetry Service Profiles",
        description:
          "This permission can create Telemetry Service Profiles this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.DeleteTelemetryServiceProfiles,
        title: "Delete Telemetry Service Profiles",
        description:
          "This permission can delete Telemetry Service Profiles of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.EditTelemetryServiceProfiles,
        title: "Edit Telemetry Service Profiles",
        description:
          "This permission can edit Telemetry Service Profiles of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.ReadTelemetryServiceProfiles,
        title: "Read Telemetry Service Profiles",
        description:
          "This permission can read Telemetry Service Profiles of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },

      {
        permission: Permission.CreateScheduledMaintenanceOwnerTeam,
        title: "Create Scheduled Maintenance Team Owner",
        description:
          "This permission can create Scheduled Maintenance Team Owner this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },
      {
        permission: Permission.DeleteScheduledMaintenanceOwnerTeam,
        title: "Delete Scheduled Maintenance Team Owner",
        description:
          "This permission can delete Scheduled Maintenance Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },
      {
        permission: Permission.EditScheduledMaintenanceOwnerTeam,
        title: "Edit Scheduled Maintenance Team Owner",
        description:
          "This permission can edit Scheduled Maintenance Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },
      {
        permission: Permission.ReadScheduledMaintenanceOwnerTeam,
        title: "Read Scheduled Maintenance Team Owner",
        description:
          "This permission can read Scheduled Maintenance Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },

      {
        permission: Permission.CreateScheduledMaintenanceOwnerUser,
        title: "Create Scheduled Maintenance User Owner",
        description:
          "This permission can create Scheduled Maintenance User Owner this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },
      {
        permission: Permission.DeleteScheduledMaintenanceOwnerUser,
        title: "Delete Scheduled Maintenance User Owner",
        description:
          "This permission can delete Scheduled Maintenance User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },
      {
        permission: Permission.EditScheduledMaintenanceOwnerUser,
        title: "Edit Scheduled Maintenance User Owner",
        description:
          "This permission can edit Scheduled Maintenance User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },
      {
        permission: Permission.ReadScheduledMaintenanceOwnerUser,
        title: "Read Scheduled Maintenance User Owner",
        description:
          "This permission can read Scheduled Maintenance User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },

      {
        permission: Permission.CreateScheduledMaintenanceTemplateOwnerUser,
        title: "Create Scheduled Maintenance Template User Owner",
        description:
          "This permission can create Scheduled Maintenance Template User Owner this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },
      {
        permission: Permission.DeleteScheduledMaintenanceTemplateOwnerUser,
        title: "Delete Scheduled Maintenance Template User Owner",
        description:
          "This permission can delete Scheduled Maintenance Template User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },
      {
        permission: Permission.EditScheduledMaintenanceTemplateOwnerUser,
        title: "Edit Scheduled Maintenance Template User Owner",
        description:
          "This permission can edit Scheduled Maintenance Template User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },
      {
        permission: Permission.ReadScheduledMaintenanceTemplateOwnerUser,
        title: "Read Scheduled Maintenance Template User Owner",
        description:
          "This permission can read Scheduled Maintenance Template User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },

      {
        permission: Permission.CreateScheduledMaintenanceTemplateOwnerTeam,
        title: "Create Scheduled Maintenance Template User Team",
        description:
          "This permission can create Scheduled Maintenance Template User Owner this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },
      {
        permission: Permission.DeleteScheduledMaintenanceTemplateOwnerTeam,
        title: "Delete Scheduled Maintenance Template User Team",
        description:
          "This permission can delete Scheduled Maintenance Template User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },
      {
        permission: Permission.EditScheduledMaintenanceTemplateOwnerTeam,
        title: "Edit Scheduled Maintenance Template User Team",
        description:
          "This permission can edit Scheduled Maintenance Template User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },
      {
        permission: Permission.ReadScheduledMaintenanceTemplateOwnerTeam,
        title: "Read Scheduled Maintenance Template User Team",
        description:
          "This permission can read Scheduled Maintenance Template User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },

      {
        permission: Permission.CreateIncidentOwnerTeam,
        title: "Create Incident Team Owner",
        description:
          "This permission can create Incident Team Owner this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.DeleteIncidentOwnerTeam,
        title: "Delete Incident Team Owner",
        description:
          "This permission can delete Incident Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.EditIncidentOwnerTeam,
        title: "Edit Incident Team Owner",
        description:
          "This permission can edit Incident Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.ReadIncidentOwnerTeam,
        title: "Read Incident Team Owner",
        description:
          "This permission can read Incident Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },

      {
        permission: Permission.CreateAlertOwnerTeam,
        title: "Create Alert Team Owner",
        description:
          "This permission can create Alert Team Owner this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.DeleteAlertOwnerTeam,
        title: "Delete Alert Team Owner",
        description:
          "This permission can delete Alert Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.EditAlertOwnerTeam,
        title: "Edit Alert Team Owner",
        description:
          "This permission can edit Alert Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.ReadAlertOwnerTeam,
        title: "Read Alert Team Owner",
        description:
          "This permission can read Alert Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },

      {
        permission: Permission.CreateIncidentNoteTemplate,
        title: "Create Incident Note Template",
        description:
          "This permission can create Incident Note Template this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.DeleteIncidentNoteTemplate,
        title: "Delete Incident Note Template",
        description:
          "This permission can delete Incident Note Template of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.EditIncidentNoteTemplate,
        title: "Edit Incident Note Template",
        description:
          "This permission can edit Incident Note Template of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.ReadIncidentNoteTemplate,
        title: "Read Incident Note Template",
        description:
          "This permission can read Incident Note Template of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },

      {
        permission: Permission.CreateAlertNoteTemplate,
        title: "Create Alert Note Template",
        description:
          "This permission can create Alert Note Template this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.DeleteAlertNoteTemplate,
        title: "Delete Alert Note Template",
        description:
          "This permission can delete Alert Note Template of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.EditAlertNoteTemplate,
        title: "Edit Alert Note Template",
        description:
          "This permission can edit Alert Note Template of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.ReadAlertNoteTemplate,
        title: "Read Alert Note Template",
        description:
          "This permission can read Alert Note Template of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },

      {
        permission: Permission.CreateScheduledMaintenanceNoteTemplate,
        title: "Create Scheduled Maintenance Note Template",
        description:
          "This permission can create Scheduled Maintenance Note Template this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },
      {
        permission: Permission.DeleteScheduledMaintenanceNoteTemplate,
        title: "Delete Scheduled Maintenance Note Template",
        description:
          "This permission can delete Scheduled Maintenance Note Template of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },
      {
        permission: Permission.EditScheduledMaintenanceNoteTemplate,
        title: "Edit Scheduled Maintenance Note Template",
        description:
          "This permission can edit Scheduled Maintenance Note Template of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },
      {
        permission: Permission.ReadScheduledMaintenanceNoteTemplate,
        title: "Read Scheduled Maintenance Note Template",
        description:
          "This permission can read Scheduled Maintenance Note Template of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },

      {
        permission: Permission.CreateIncidentTemplate,
        title: "Create Incident Template",
        description:
          "This permission can create Incident Template this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.DeleteIncidentTemplate,
        title: "Delete Incident Template",
        description:
          "This permission can delete Incident Template of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.EditIncidentTemplate,
        title: "Edit Incident Template",
        description:
          "This permission can edit Incident Template of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.ReadIncidentTemplate,
        title: "Read Incident Template",
        description:
          "This permission can read Incident Template of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },

      {
        permission: Permission.CreateIncidentOwnerUser,
        title: "Create Incident User Owner",
        description:
          "This permission can create Incident User Owner this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.DeleteIncidentOwnerUser,
        title: "Delete Incident User Owner",
        description:
          "This permission can delete Incident User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.EditIncidentOwnerUser,
        title: "Edit Incident User Owner",
        description:
          "This permission can edit Incident User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.ReadIncidentOwnerUser,
        title: "Read Incident User Owner",
        description:
          "This permission can read Incident User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },

      {
        permission: Permission.CreateIncidentRole,
        title: "Create Incident Role",
        description:
          "This permission can create Incident Roles for this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.DeleteIncidentRole,
        title: "Delete Incident Role",
        description:
          "This permission can delete Incident Roles of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.EditIncidentRole,
        title: "Edit Incident Role",
        description: "This permission can edit Incident Roles of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.ReadIncidentRole,
        title: "Read Incident Role",
        description: "This permission can read Incident Roles of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },

      {
        permission: Permission.CreateIncidentMember,
        title: "Create Incident Member",
        description:
          "This permission can create Incident Members for this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.DeleteIncidentMember,
        title: "Delete Incident Member",
        description:
          "This permission can delete Incident Members of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.EditIncidentMember,
        title: "Edit Incident Member",
        description:
          "This permission can edit Incident Members of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.ReadIncidentMember,
        title: "Read Incident Member",
        description:
          "This permission can read Incident Members of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },

      {
        permission: Permission.CreateIncidentEpisodeRoleMember,
        title: "Create Incident Episode Role Member",
        description:
          "This permission can create Incident Episode Role Members for this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.DeleteIncidentEpisodeRoleMember,
        title: "Delete Incident Episode Role Member",
        description:
          "This permission can delete Incident Episode Role Members of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.EditIncidentEpisodeRoleMember,
        title: "Edit Incident Episode Role Member",
        description:
          "This permission can edit Incident Episode Role Members of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.ReadIncidentEpisodeRoleMember,
        title: "Read Incident Episode Role Member",
        description:
          "This permission can read Incident Episode Role Members of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },

      {
        permission: Permission.CreateAlertOwnerUser,
        title: "Create Alert User Owner",
        description:
          "This permission can create Alert User Owner this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.DeleteAlertOwnerUser,
        title: "Delete Alert User Owner",
        description:
          "This permission can delete Alert User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.EditAlertOwnerUser,
        title: "Edit Alert User Owner",
        description:
          "This permission can edit Alert User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.ReadAlertOwnerUser,
        title: "Read Alert User Owner",
        description:
          "This permission can read Alert User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },

      {
        permission: Permission.CreateStatusPageOwnerTeam,
        title: "Create Status Page Team Owner",
        description:
          "This permission can create Status Page Team Owner this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.DeleteStatusPageOwnerTeam,
        title: "Delete Status Page Team Owner",
        description:
          "This permission can delete Status Page Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.EditStatusPageOwnerTeam,
        title: "Edit Status Page Team Owner",
        description:
          "This permission can edit Status Page Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.ReadStatusPageOwnerTeam,
        title: "Read Status Page Team Owner",
        description:
          "This permission can read Status Page Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },

      {
        permission: Permission.CreateIncidentTemplateOwnerTeam,
        title: "Create IncidentTemplate Team Owner",
        description:
          "This permission can create IncidentTemplate Team Owner this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.DeleteIncidentTemplateOwnerTeam,
        title: "Delete IncidentTemplate Team Owner",
        description:
          "This permission can delete IncidentTemplate Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.EditIncidentTemplateOwnerTeam,
        title: "Edit IncidentTemplate Team Owner",
        description:
          "This permission can edit IncidentTemplate Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.ReadIncidentTemplateOwnerTeam,
        title: "Read IncidentTemplate Team Owner",
        description:
          "This permission can read IncidentTemplate Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },

      {
        permission: Permission.CreateServiceOwnerTeam,
        title: "Create Service Team Owner",
        description:
          "This permission can create Service Team Owner in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ServiceCatalog,
      },
      {
        permission: Permission.DeleteServiceOwnerTeam,
        title: "Delete Service Team Owner",
        description:
          "This permission can delete Service Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ServiceCatalog,
      },
      {
        permission: Permission.EditServiceOwnerTeam,
        title: "Edit Service Team Owner",
        description:
          "This permission can edit Service Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ServiceCatalog,
      },
      {
        permission: Permission.ReadServiceOwnerTeam,
        title: "Read Service Team Owner",
        description:
          "This permission can read Service Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ServiceCatalog,
      },

      {
        permission: Permission.CreateServiceOwnerUser,
        title: "Create Service User Owner",
        description:
          "This permission can create Service User Owner in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ServiceCatalog,
      },
      {
        permission: Permission.DeleteServiceOwnerUser,
        title: "Delete Service User Owner",
        description:
          "This permission can delete Service User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ServiceCatalog,
      },
      {
        permission: Permission.EditServiceOwnerUser,
        title: "Edit Service User Owner",
        description:
          "This permission can edit Service User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ServiceCatalog,
      },
      {
        permission: Permission.ReadServiceOwnerUser,
        title: "Read Service User Owner",
        description:
          "This permission can read Service User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ServiceCatalog,
      },

      {
        permission: Permission.CreateIncidentTemplateOwnerUser,
        title: "Create IncidentTemplate User Owner",
        description:
          "This permission can create IncidentTemplate User Owner this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.DeleteIncidentTemplateOwnerUser,
        title: "Delete IncidentTemplate User Owner",
        description:
          "This permission can delete IncidentTemplate User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.EditIncidentTemplateOwnerUser,
        title: "Edit IncidentTemplate User Owner",
        description:
          "This permission can edit IncidentTemplate User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.ReadIncidentTemplateOwnerUser,
        title: "Read IncidentTemplate User Owner",
        description:
          "This permission can read IncidentTemplate User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },

      {
        permission: Permission.CreateStatusPageOwnerTeam,
        title: "Create Status Page Team Owner",
        description:
          "This permission can create Status Page Team Owner this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.DeleteStatusPageOwnerTeam,
        title: "Delete Status Page Team Owner",
        description:
          "This permission can delete Status Page Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.EditStatusPageOwnerTeam,
        title: "Edit Status Page Team Owner",
        description:
          "This permission can edit Status Page Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.ReadStatusPageOwnerTeam,
        title: "Read Status Page Team Owner",
        description:
          "This permission can read Status Page Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },

      {
        permission: Permission.CreateStatusPageOwnerUser,
        title: "Create Status Page User Owner",
        description:
          "This permission can create Status Page User Owner this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.DeleteStatusPageOwnerUser,
        title: "Delete Status Page User Owner",
        description:
          "This permission can delete Status Page User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.EditStatusPageOwnerUser,
        title: "Edit Status Page User Owner",
        description:
          "This permission can edit Status Page User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.ReadStatusPageOwnerUser,
        title: "Read Status Page User Owner",
        description:
          "This permission can read Status Page User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },

      {
        permission: Permission.CreateMonitorOwnerTeam,
        title: "Create Monitor Team Owner",
        description:
          "This permission can create Monitor Team Owner this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },
      {
        permission: Permission.DeleteMonitorOwnerTeam,
        title: "Delete Monitor Team Owner",
        description:
          "This permission can delete Monitor Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },
      {
        permission: Permission.EditMonitorOwnerTeam,
        title: "Edit Monitor Team Owner",
        description:
          "This permission can edit Monitor Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },
      {
        permission: Permission.ReadMonitorOwnerTeam,
        title: "Read Monitor Team Owner",
        description:
          "This permission can read Monitor Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },

      {
        permission: Permission.CreateMonitorOwnerUser,
        title: "Create Monitor User Owner",
        description:
          "This permission can create Monitor User Owner this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },
      {
        permission: Permission.DeleteMonitorOwnerUser,
        title: "Delete Monitor User Owner",
        description:
          "This permission can delete Monitor User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },
      {
        permission: Permission.EditMonitorOwnerUser,
        title: "Edit Monitor User Owner",
        description:
          "This permission can edit Monitor User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },
      {
        permission: Permission.ReadMonitorOwnerUser,
        title: "Read Monitor User Owner",
        description:
          "This permission can read Monitor User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },

      // Monitor Owner Rule Permissions
      {
        permission: Permission.CreateMonitorOwnerRule,
        title: "Create Monitor Owner Rule",
        description:
          "This permission can create Monitor Owner Rules in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },
      {
        permission: Permission.DeleteMonitorOwnerRule,
        title: "Delete Monitor Owner Rule",
        description:
          "This permission can delete Monitor Owner Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },
      {
        permission: Permission.EditMonitorOwnerRule,
        title: "Edit Monitor Owner Rule",
        description:
          "This permission can edit Monitor Owner Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },
      {
        permission: Permission.ReadMonitorOwnerRule,
        title: "Read Monitor Owner Rule",
        description:
          "This permission can read Monitor Owner Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },

      // Monitor Label Rule Permissions
      {
        permission: Permission.CreateMonitorLabelRule,
        title: "Create Monitor Label Rule",
        description:
          "This permission can create Monitor Label Rules in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },
      {
        permission: Permission.DeleteMonitorLabelRule,
        title: "Delete Monitor Label Rule",
        description:
          "This permission can delete Monitor Label Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },
      {
        permission: Permission.EditMonitorLabelRule,
        title: "Edit Monitor Label Rule",
        description:
          "This permission can edit Monitor Label Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },
      {
        permission: Permission.ReadMonitorLabelRule,
        title: "Read Monitor Label Rule",
        description:
          "This permission can read Monitor Label Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },

      // Status Page Owner Rule Permissions
      {
        permission: Permission.CreateStatusPageOwnerRule,
        title: "Create Status Page Owner Rule",
        description:
          "This permission can create Status Page Owner Rules in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.DeleteStatusPageOwnerRule,
        title: "Delete Status Page Owner Rule",
        description:
          "This permission can delete Status Page Owner Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.EditStatusPageOwnerRule,
        title: "Edit Status Page Owner Rule",
        description:
          "This permission can edit Status Page Owner Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.ReadStatusPageOwnerRule,
        title: "Read Status Page Owner Rule",
        description:
          "This permission can read Status Page Owner Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },

      // Status Page Label Rule Permissions
      {
        permission: Permission.CreateStatusPageLabelRule,
        title: "Create Status Page Label Rule",
        description:
          "This permission can create Status Page Label Rules in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.DeleteStatusPageLabelRule,
        title: "Delete Status Page Label Rule",
        description:
          "This permission can delete Status Page Label Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.EditStatusPageLabelRule,
        title: "Edit Status Page Label Rule",
        description:
          "This permission can edit Status Page Label Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.ReadStatusPageLabelRule,
        title: "Read Status Page Label Rule",
        description:
          "This permission can read Status Page Label Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },

      // Host Owner Rule Permissions
      {
        permission: Permission.CreateHostOwnerRule,
        title: "Create Host Owner Rule",
        description:
          "This permission can create Host Owner Rules in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.DeleteHostOwnerRule,
        title: "Delete Host Owner Rule",
        description:
          "This permission can delete Host Owner Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.EditHostOwnerRule,
        title: "Edit Host Owner Rule",
        description:
          "This permission can edit Host Owner Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.ReadHostOwnerRule,
        title: "Read Host Owner Rule",
        description:
          "This permission can read Host Owner Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },

      // Host Label Rule Permissions
      {
        permission: Permission.CreateHostLabelRule,
        title: "Create Host Label Rule",
        description:
          "This permission can create Host Label Rules in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.DeleteHostLabelRule,
        title: "Delete Host Label Rule",
        description:
          "This permission can delete Host Label Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.EditHostLabelRule,
        title: "Edit Host Label Rule",
        description:
          "This permission can edit Host Label Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.ReadHostLabelRule,
        title: "Read Host Label Rule",
        description:
          "This permission can read Host Label Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },

      // Service Owner Rule Permissions
      {
        permission: Permission.CreateServiceOwnerRule,
        title: "Create Service Owner Rule",
        description:
          "This permission can create Service Owner Rules in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ServiceCatalog,
      },
      {
        permission: Permission.DeleteServiceOwnerRule,
        title: "Delete Service Owner Rule",
        description:
          "This permission can delete Service Owner Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ServiceCatalog,
      },
      {
        permission: Permission.EditServiceOwnerRule,
        title: "Edit Service Owner Rule",
        description:
          "This permission can edit Service Owner Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ServiceCatalog,
      },
      {
        permission: Permission.ReadServiceOwnerRule,
        title: "Read Service Owner Rule",
        description:
          "This permission can read Service Owner Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ServiceCatalog,
      },

      // Service Label Rule Permissions
      {
        permission: Permission.CreateServiceLabelRule,
        title: "Create Service Label Rule",
        description:
          "This permission can create Service Label Rules in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ServiceCatalog,
      },
      {
        permission: Permission.DeleteServiceLabelRule,
        title: "Delete Service Label Rule",
        description:
          "This permission can delete Service Label Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ServiceCatalog,
      },
      {
        permission: Permission.EditServiceLabelRule,
        title: "Edit Service Label Rule",
        description:
          "This permission can edit Service Label Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ServiceCatalog,
      },
      {
        permission: Permission.ReadServiceLabelRule,
        title: "Read Service Label Rule",
        description:
          "This permission can read Service Label Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ServiceCatalog,
      },

      // Docker Host Owner Rule Permissions
      {
        permission: Permission.CreateDockerHostOwnerRule,
        title: "Create Docker Host Owner Rule",
        description:
          "This permission can create Docker Host Owner Rules in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.DeleteDockerHostOwnerRule,
        title: "Delete Docker Host Owner Rule",
        description:
          "This permission can delete Docker Host Owner Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.EditDockerHostOwnerRule,
        title: "Edit Docker Host Owner Rule",
        description:
          "This permission can edit Docker Host Owner Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.ReadDockerHostOwnerRule,
        title: "Read Docker Host Owner Rule",
        description:
          "This permission can read Docker Host Owner Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },

      // Docker Host Label Rule Permissions
      {
        permission: Permission.CreateDockerHostLabelRule,
        title: "Create Docker Host Label Rule",
        description:
          "This permission can create Docker Host Label Rules in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.DeleteDockerHostLabelRule,
        title: "Delete Docker Host Label Rule",
        description:
          "This permission can delete Docker Host Label Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.EditDockerHostLabelRule,
        title: "Edit Docker Host Label Rule",
        description:
          "This permission can edit Docker Host Label Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.ReadDockerHostLabelRule,
        title: "Read Docker Host Label Rule",
        description:
          "This permission can read Docker Host Label Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },

      // Kubernetes Cluster Owner Rule Permissions
      {
        permission: Permission.CreateKubernetesClusterOwnerRule,
        title: "Create Kubernetes Cluster Owner Rule",
        description:
          "This permission can create Kubernetes Cluster Owner Rules in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.DeleteKubernetesClusterOwnerRule,
        title: "Delete Kubernetes Cluster Owner Rule",
        description:
          "This permission can delete Kubernetes Cluster Owner Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.EditKubernetesClusterOwnerRule,
        title: "Edit Kubernetes Cluster Owner Rule",
        description:
          "This permission can edit Kubernetes Cluster Owner Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.ReadKubernetesClusterOwnerRule,
        title: "Read Kubernetes Cluster Owner Rule",
        description:
          "This permission can read Kubernetes Cluster Owner Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },

      // Kubernetes Cluster Label Rule Permissions
      {
        permission: Permission.CreateKubernetesClusterLabelRule,
        title: "Create Kubernetes Cluster Label Rule",
        description:
          "This permission can create Kubernetes Cluster Label Rules in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.DeleteKubernetesClusterLabelRule,
        title: "Delete Kubernetes Cluster Label Rule",
        description:
          "This permission can delete Kubernetes Cluster Label Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.EditKubernetesClusterLabelRule,
        title: "Edit Kubernetes Cluster Label Rule",
        description:
          "This permission can edit Kubernetes Cluster Label Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },
      {
        permission: Permission.ReadKubernetesClusterLabelRule,
        title: "Read Kubernetes Cluster Label Rule",
        description:
          "This permission can read Kubernetes Cluster Label Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Telemetry,
      },

      // Runbook Owner Rule Permissions
      {
        permission: Permission.CreateRunbookOwnerRule,
        title: "Create Runbook Owner Rule",
        description:
          "This permission can create Runbook Owner Rules in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Runbook,
      },
      {
        permission: Permission.DeleteRunbookOwnerRule,
        title: "Delete Runbook Owner Rule",
        description:
          "This permission can delete Runbook Owner Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Runbook,
      },
      {
        permission: Permission.EditRunbookOwnerRule,
        title: "Edit Runbook Owner Rule",
        description:
          "This permission can edit Runbook Owner Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Runbook,
      },
      {
        permission: Permission.ReadRunbookOwnerRule,
        title: "Read Runbook Owner Rule",
        description:
          "This permission can read Runbook Owner Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Runbook,
      },

      // Runbook Label Rule Permissions
      {
        permission: Permission.CreateRunbookLabelRule,
        title: "Create Runbook Label Rule",
        description:
          "This permission can create Runbook Label Rules in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Runbook,
      },
      {
        permission: Permission.DeleteRunbookLabelRule,
        title: "Delete Runbook Label Rule",
        description:
          "This permission can delete Runbook Label Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Runbook,
      },
      {
        permission: Permission.EditRunbookLabelRule,
        title: "Edit Runbook Label Rule",
        description:
          "This permission can edit Runbook Label Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Runbook,
      },
      {
        permission: Permission.ReadRunbookLabelRule,
        title: "Read Runbook Label Rule",
        description:
          "This permission can read Runbook Label Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Runbook,
      },

      {
        permission: Permission.CreateMonitorGroupOwnerTeam,
        title: "Create Monitor Group Team Owner",
        description:
          "This permission can create Monitor Group Team Owner this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },
      {
        permission: Permission.DeleteMonitorGroupOwnerTeam,
        title: "Delete Monitor Group Team Owner",
        description:
          "This permission can delete Monitor Group Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },
      {
        permission: Permission.EditMonitorGroupOwnerTeam,
        title: "Edit Monitor Group Team Owner",
        description:
          "This permission can edit Monitor Group Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },
      {
        permission: Permission.ReadMonitorGroupOwnerTeam,
        title: "Read Monitor Group Team Owner",
        description:
          "This permission can read Monitor Group Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },

      {
        permission: Permission.CreateOnCallDutyPolicyOwnerUser,
        title: "Create On Call Duty Policy User Owner",
        description:
          "This permission can create On Call Duty Policy User Owner this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.DeleteOnCallDutyPolicyOwnerUser,
        title: "Delete On Call Duty Policy User Owner",
        description:
          "This permission can delete On Call Duty Policy User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.EditOnCallDutyPolicyOwnerUser,
        title: "Edit On Call Duty Policy User Owner",
        description:
          "This permission can edit On Call Duty Policy User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.ReadOnCallDutyPolicyOwnerUser,
        title: "Read On Call Duty Policy User Owner",
        description:
          "This permission can read On Call Duty Policy User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },

      {
        permission: Permission.CreateOnCallDutyPolicyOwnerTeam,
        title: "Create On Call Duty Policy Team Owner",
        description:
          "This permission can create On Call Duty Policy Team Owner this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.DeleteOnCallDutyPolicyOwnerTeam,
        title: "Delete On Call Duty Policy Team Owner",
        description:
          "This permission can delete On Call Duty Policy Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.EditOnCallDutyPolicyOwnerTeam,
        title: "Edit On Call Duty Policy Team Owner",
        description:
          "This permission can edit On Call Duty Policy Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.ReadOnCallDutyPolicyOwnerTeam,
        title: "Read On Call Duty Policy Team Owner",
        description:
          "This permission can read On Call Duty Policy Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },

      {
        permission: Permission.CreateOnCallDutyPolicyScheduleOwnerUser,
        title: "Create On Call Duty Schedule User Owner",
        description:
          "This permission can create On Call Duty Schedule User Owner this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.DeleteOnCallDutyPolicyScheduleOwnerUser,
        title: "Delete On Call Duty Schedule User Owner",
        description:
          "This permission can delete On Call Duty Schedule User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.EditOnCallDutyPolicyScheduleOwnerUser,
        title: "Edit On Call Duty Schedule User Owner",
        description:
          "This permission can edit On Call Duty Schedule User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.ReadOnCallDutyPolicyScheduleOwnerUser,
        title: "Read On Call Duty Schedule User Owner",
        description:
          "This permission can read On Call Duty Schedule User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },

      {
        permission: Permission.CreateOnCallDutyPolicyScheduleOwnerTeam,
        title: "Create On Call Duty Schedule Team Owner",
        description:
          "This permission can create On Call Duty Schedule Team Owner this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.DeleteOnCallDutyPolicyScheduleOwnerTeam,
        title: "Delete On Call Duty Schedule Team Owner",
        description:
          "This permission can delete On Call Duty Schedule Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.EditOnCallDutyPolicyScheduleOwnerTeam,
        title: "Edit On Call Duty Schedule Team Owner",
        description:
          "This permission can edit On Call Duty Schedule Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },
      {
        permission: Permission.ReadOnCallDutyPolicyScheduleOwnerTeam,
        title: "Read On Call Duty Schedule Team Owner",
        description:
          "This permission can read On Call Duty Schedule Team Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.OnCallDutyPolicy,
      },

      {
        permission: Permission.CreateMonitorGroupOwnerUser,
        title: "Create Monitor Group User Owner",
        description:
          "This permission can create Monitor Group User Owner this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },
      {
        permission: Permission.DeleteMonitorGroupOwnerUser,
        title: "Delete Monitor Group User Owner",
        description:
          "This permission can delete Monitor Group User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },
      {
        permission: Permission.EditMonitorGroupOwnerUser,
        title: "Edit Monitor Group User Owner",
        description:
          "This permission can edit Monitor Group User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },
      {
        permission: Permission.ReadMonitorGroupOwnerUser,
        title: "Read Monitor Group User Owner",
        description:
          "This permission can read Monitor Group User Owner of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Monitor,
      },

      {
        permission: Permission.CreateProjectIncident,
        title: "Create Incident",
        description: "This permission can create incident this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.DeleteProjectIncident,
        title: "Delete Incident",
        description: "This permission can delete incident of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.EditProjectIncident,
        title: "Edit Incident",
        description: "This permission can edit incident of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.ReadProjectIncident,
        title: "Read Incident",
        description: "This permission can read incident of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },

      {
        permission: Permission.CreateAlert,
        title: "Create Alert",
        description: "This permission can create alerts for this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.DeleteAlert,
        title: "Delete Alert",
        description: "This permission can delete alerts of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.EditAlert,
        title: "Edit Alert",
        description: "This permission can edit alerts of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.ReadAlert,
        title: "Read Alert",
        description: "This permission can read alerts of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },

      {
        permission: Permission.CreateScheduledMaintenanceTemplate,
        title: "Create Scheduled Maintenance Template",
        description:
          "This permission can create scheduled maintenance template in the project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },
      {
        permission: Permission.DeleteScheduledMaintenanceTemplate,
        title: "Delete Scheduled Maintenance Template",
        description:
          "This permission can delete scheduled maintenance template in the project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },
      {
        permission: Permission.EditScheduledMaintenanceTemplate,
        title: "Edit Scheduled Maintenance Template",
        description:
          "This permission can edit scheduled maintenance template in the project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },
      {
        permission: Permission.ReadScheduledMaintenanceTemplate,
        title: "Read Scheduled Maintenance Template",
        description:
          "This permission can read scheduled maintenance template in the project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },

      {
        permission: Permission.CreateStatusPageSubscriber,
        title: "Create Status Page Subscriber",
        description:
          "This permission can create subscriber on status page this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.DeleteStatusPageSubscriber,
        title: "Delete Status Page Subscriber",
        description:
          "This permission can delete subscriber on status page of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.EditStatusPageSubscriber,
        title: "Edit Status Page Subscriber",
        description:
          "This permission can edit subscriber on status page of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.ReadStatusPageSubscriber,
        title: "Read Status Page Subscriber",
        description:
          "This permission can read subscriber on status page of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },

      {
        permission: Permission.CreateStatusPagePrivateUser,
        title: "Create Status Page Private User",
        description:
          "This permission can create private user on status page this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.DeleteStatusPagePrivateUser,
        title: "Delete Status Page PrivateUser",
        description:
          "This permission can delete private user on status page of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.EditStatusPagePrivateUser,
        title: "Edit Status Page PrivateUser",
        description:
          "This permission can edit private user on status page of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },
      {
        permission: Permission.ReadStatusPagePrivateUser,
        title: "Read Status Page Private User",
        description:
          "This permission can read private user on status page of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.StatusPage,
      },

      // Scheduled Maintenance Permissions.

      {
        permission: Permission.CreateScheduledMaintenanceState,
        title: "Create Scheduled Maintenance State",
        description:
          "This permission can create Scheduled Maintenance states this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },
      {
        permission: Permission.DeleteScheduledMaintenanceState,
        title: "Delete Scheduled Maintenance State",
        description:
          "This permission can delete Scheduled Maintenance states of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },
      {
        permission: Permission.EditScheduledMaintenanceState,
        title: "Edit Scheduled Maintenance State",
        description:
          "This permission can edit Scheduled Maintenance states of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },
      {
        permission: Permission.ReadScheduledMaintenanceState,
        title: "Read Scheduled Maintenance State",
        description:
          "This permission can read Scheduled Maintenance states of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },

      {
        permission: Permission.CreateProjectScheduledMaintenance,
        title: "Create Scheduled Maintenance",
        description:
          "This permission can create Scheduled Maintenance this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },
      {
        permission: Permission.DeleteProjectScheduledMaintenance,
        title: "Delete Scheduled Maintenance",
        description:
          "This permission can delete Scheduled Maintenance of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },
      {
        permission: Permission.EditProjectScheduledMaintenance,
        title: "Edit Scheduled Maintenance",
        description:
          "This permission can edit Scheduled Maintenance of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },
      {
        permission: Permission.ReadProjectScheduledMaintenance,
        title: "Read Scheduled Maintenance",
        description:
          "This permission can read Scheduled Maintenance of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },

      {
        permission: Permission.CreateScheduledMaintenanceStateTimeline,
        title: "Create Scheduled Maintenance State Timeline",
        description:
          "This permission can create Scheduled Maintenance state history of an Scheduled Maintenance in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },
      {
        permission: Permission.DeleteScheduledMaintenanceStateTimeline,
        title: "Delete Scheduled Maintenance State Timeline",
        description:
          "This permission can delete Scheduled Maintenance state history of an Scheduled Maintenance in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },
      {
        permission: Permission.EditScheduledMaintenanceStateTimeline,
        title: "Edit Scheduled Maintenance State Timeline",
        description:
          "This permission can edit Scheduled Maintenance state history of an Scheduled Maintenance in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },
      {
        permission: Permission.ReadScheduledMaintenanceStateTimeline,
        title: "Read Scheduled Maintenance State Timeline",
        description:
          "This permission can read Scheduled Maintenance state history of an Scheduled Maintenance in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },

      {
        permission: Permission.CreateScheduledMaintenanceInternalNote,
        title: "Create Scheduled Maintenance Internal Note",
        description:
          "This permission can create Scheduled Maintenance Internal Note this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },
      {
        permission: Permission.DeleteScheduledMaintenanceInternalNote,
        title: "Delete Scheduled Maintenance Internal Note",
        description:
          "This permission can delete Scheduled Maintenance Internal Note of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },
      {
        permission: Permission.EditScheduledMaintenanceInternalNote,
        title: "Edit Scheduled Maintenance Internal Note",
        description:
          "This permission can edit Scheduled Maintenance Internal Note of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },
      {
        permission: Permission.ReadScheduledMaintenanceInternalNote,
        title: "Read Scheduled Maintenance Internal Note",
        description:
          "This permission can read Scheduled Maintenance Internal Note of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },

      {
        permission: Permission.CreateScheduledMaintenancePublicNote,
        title: "Create Scheduled Maintenance Status Page Note",
        description:
          "This permission can create Scheduled Maintenance Status Page Note this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },
      {
        permission: Permission.DeleteScheduledMaintenancePublicNote,
        title: "Delete Scheduled Maintenance Status Page Note",
        description:
          "This permission can delete Scheduled Maintenance Status Page Note of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },
      {
        permission: Permission.EditScheduledMaintenancePublicNote,
        title: "Edit Scheduled Maintenance Status Page Note",
        description:
          "This permission can edit Scheduled Maintenance Status Page Note of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },
      {
        permission: Permission.ReadScheduledMaintenancePublicNote,
        title: "Read Scheduled Maintenance Status Page Note",
        description:
          "This permission can read Scheduled Maintenance Status Page Note of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },

      // Scheduled Maintenance Owner Rule Permissions
      {
        permission: Permission.CreateScheduledMaintenanceOwnerRule,
        title: "Create Scheduled Maintenance Owner Rule",
        description:
          "This permission can create Scheduled Maintenance Owner Rules in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },
      {
        permission: Permission.DeleteScheduledMaintenanceOwnerRule,
        title: "Delete Scheduled Maintenance Owner Rule",
        description:
          "This permission can delete Scheduled Maintenance Owner Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },
      {
        permission: Permission.EditScheduledMaintenanceOwnerRule,
        title: "Edit Scheduled Maintenance Owner Rule",
        description:
          "This permission can edit Scheduled Maintenance Owner Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },
      {
        permission: Permission.ReadScheduledMaintenanceOwnerRule,
        title: "Read Scheduled Maintenance Owner Rule",
        description:
          "This permission can read Scheduled Maintenance Owner Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },

      // Scheduled Maintenance Label Rule Permissions
      {
        permission: Permission.CreateScheduledMaintenanceLabelRule,
        title: "Create Scheduled Maintenance Label Rule",
        description:
          "This permission can create Scheduled Maintenance Label Rules in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },
      {
        permission: Permission.DeleteScheduledMaintenanceLabelRule,
        title: "Delete Scheduled Maintenance Label Rule",
        description:
          "This permission can delete Scheduled Maintenance Label Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },
      {
        permission: Permission.EditScheduledMaintenanceLabelRule,
        title: "Edit Scheduled Maintenance Label Rule",
        description:
          "This permission can edit Scheduled Maintenance Label Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },
      {
        permission: Permission.ReadScheduledMaintenanceLabelRule,
        title: "Read Scheduled Maintenance Label Rule",
        description:
          "This permission can read Scheduled Maintenance Label Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.ScheduledMaintenance,
      },

      // Alert Episode Permissions
      {
        permission: Permission.CreateAlertEpisode,
        title: "Create Alert Episode",
        description:
          "This permission can create Alert Episodes in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.DeleteAlertEpisode,
        title: "Delete Alert Episode",
        description:
          "This permission can delete Alert Episodes of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.EditAlertEpisode,
        title: "Edit Alert Episode",
        description: "This permission can edit Alert Episodes of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.ReadAlertEpisode,
        title: "Read Alert Episode",
        description: "This permission can read Alert Episodes of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },

      // Alert Episode Member Permissions
      {
        permission: Permission.CreateAlertEpisodeMember,
        title: "Create Alert Episode Member",
        description:
          "This permission can add alerts to Alert Episodes in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.DeleteAlertEpisodeMember,
        title: "Delete Alert Episode Member",
        description:
          "This permission can remove alerts from Alert Episodes of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.EditAlertEpisodeMember,
        title: "Edit Alert Episode Member",
        description:
          "This permission can edit Alert Episode Members of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.ReadAlertEpisodeMember,
        title: "Read Alert Episode Member",
        description:
          "This permission can read Alert Episode Members of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },

      // Alert Grouping Rule Permissions
      {
        permission: Permission.CreateAlertGroupingRule,
        title: "Create Alert Grouping Rule",
        description:
          "This permission can create Alert Grouping Rules in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.DeleteAlertGroupingRule,
        title: "Delete Alert Grouping Rule",
        description:
          "This permission can delete Alert Grouping Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.EditAlertGroupingRule,
        title: "Edit Alert Grouping Rule",
        description:
          "This permission can edit Alert Grouping Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.ReadAlertGroupingRule,
        title: "Read Alert Grouping Rule",
        description:
          "This permission can read Alert Grouping Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },

      // Alert On-Call Rule Permissions
      {
        permission: Permission.CreateAlertOnCallRule,
        title: "Create Alert On-Call Rule",
        description:
          "This permission can create Alert On-Call Rules in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.DeleteAlertOnCallRule,
        title: "Delete Alert On-Call Rule",
        description:
          "This permission can delete Alert On-Call Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.EditAlertOnCallRule,
        title: "Edit Alert On-Call Rule",
        description:
          "This permission can edit Alert On-Call Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.ReadAlertOnCallRule,
        title: "Read Alert On-Call Rule",
        description:
          "This permission can read Alert On-Call Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },

      // Alert Owner Rule Permissions
      {
        permission: Permission.CreateAlertOwnerRule,
        title: "Create Alert Owner Rule",
        description:
          "This permission can create Alert Owner Rules in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.DeleteAlertOwnerRule,
        title: "Delete Alert Owner Rule",
        description:
          "This permission can delete Alert Owner Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.EditAlertOwnerRule,
        title: "Edit Alert Owner Rule",
        description:
          "This permission can edit Alert Owner Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.ReadAlertOwnerRule,
        title: "Read Alert Owner Rule",
        description:
          "This permission can read Alert Owner Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },

      // Alert Privacy Rule Permissions
      {
        permission: Permission.CreateAlertPrivacyRule,
        title: "Create Alert Privacy Rule",
        description:
          "This permission can create Alert Privacy Rules in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.DeleteAlertPrivacyRule,
        title: "Delete Alert Privacy Rule",
        description:
          "This permission can delete Alert Privacy Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.EditAlertPrivacyRule,
        title: "Edit Alert Privacy Rule",
        description:
          "This permission can edit Alert Privacy Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.ReadAlertPrivacyRule,
        title: "Read Alert Privacy Rule",
        description:
          "This permission can read Alert Privacy Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },

      // Alert Episode On-Call Rule Permissions
      {
        permission: Permission.CreateAlertEpisodeOnCallRule,
        title: "Create Alert Episode On-Call Rule",
        description:
          "This permission can create Alert Episode On-Call Rules in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.DeleteAlertEpisodeOnCallRule,
        title: "Delete Alert Episode On-Call Rule",
        description:
          "This permission can delete Alert Episode On-Call Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.EditAlertEpisodeOnCallRule,
        title: "Edit Alert Episode On-Call Rule",
        description:
          "This permission can edit Alert Episode On-Call Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.ReadAlertEpisodeOnCallRule,
        title: "Read Alert Episode On-Call Rule",
        description:
          "This permission can read Alert Episode On-Call Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },

      // Alert Episode Owner Rule Permissions
      {
        permission: Permission.CreateAlertEpisodeOwnerRule,
        title: "Create Alert Episode Owner Rule",
        description:
          "This permission can create Alert Episode Owner Rules in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.DeleteAlertEpisodeOwnerRule,
        title: "Delete Alert Episode Owner Rule",
        description:
          "This permission can delete Alert Episode Owner Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.EditAlertEpisodeOwnerRule,
        title: "Edit Alert Episode Owner Rule",
        description:
          "This permission can edit Alert Episode Owner Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.ReadAlertEpisodeOwnerRule,
        title: "Read Alert Episode Owner Rule",
        description:
          "This permission can read Alert Episode Owner Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },

      // Alert Episode Privacy Rule Permissions
      {
        permission: Permission.CreateAlertEpisodePrivacyRule,
        title: "Create Alert Episode Privacy Rule",
        description:
          "This permission can create Alert Episode Privacy Rules in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.DeleteAlertEpisodePrivacyRule,
        title: "Delete Alert Episode Privacy Rule",
        description:
          "This permission can delete Alert Episode Privacy Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.EditAlertEpisodePrivacyRule,
        title: "Edit Alert Episode Privacy Rule",
        description:
          "This permission can edit Alert Episode Privacy Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.ReadAlertEpisodePrivacyRule,
        title: "Read Alert Episode Privacy Rule",
        description:
          "This permission can read Alert Episode Privacy Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },

      // Alert Label Rule Permissions
      {
        permission: Permission.CreateAlertLabelRule,
        title: "Create Alert Label Rule",
        description:
          "This permission can create Alert Label Rules in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.DeleteAlertLabelRule,
        title: "Delete Alert Label Rule",
        description:
          "This permission can delete Alert Label Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.EditAlertLabelRule,
        title: "Edit Alert Label Rule",
        description:
          "This permission can edit Alert Label Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.ReadAlertLabelRule,
        title: "Read Alert Label Rule",
        description:
          "This permission can read Alert Label Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },

      // Alert Episode Label Rule Permissions
      {
        permission: Permission.CreateAlertEpisodeLabelRule,
        title: "Create Alert Episode Label Rule",
        description:
          "This permission can create Alert Episode Label Rules in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.DeleteAlertEpisodeLabelRule,
        title: "Delete Alert Episode Label Rule",
        description:
          "This permission can delete Alert Episode Label Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.EditAlertEpisodeLabelRule,
        title: "Edit Alert Episode Label Rule",
        description:
          "This permission can edit Alert Episode Label Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.ReadAlertEpisodeLabelRule,
        title: "Read Alert Episode Label Rule",
        description:
          "This permission can read Alert Episode Label Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },

      // Alert Episode State Timeline Permissions
      {
        permission: Permission.CreateAlertEpisodeStateTimeline,
        title: "Create Alert Episode State Timeline",
        description:
          "This permission can create Alert Episode state history in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.DeleteAlertEpisodeStateTimeline,
        title: "Delete Alert Episode State Timeline",
        description:
          "This permission can delete Alert Episode state history of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.EditAlertEpisodeStateTimeline,
        title: "Edit Alert Episode State Timeline",
        description:
          "This permission can edit Alert Episode state history of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.ReadAlertEpisodeStateTimeline,
        title: "Read Alert Episode State Timeline",
        description:
          "This permission can read Alert Episode state history of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },

      // Alert Episode Owner User Permissions
      {
        permission: Permission.CreateAlertEpisodeOwnerUser,
        title: "Create Alert Episode User Owner",
        description:
          "This permission can add user owners to Alert Episodes in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.DeleteAlertEpisodeOwnerUser,
        title: "Delete Alert Episode User Owner",
        description:
          "This permission can remove user owners from Alert Episodes of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.EditAlertEpisodeOwnerUser,
        title: "Edit Alert Episode User Owner",
        description:
          "This permission can edit Alert Episode user owners of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.ReadAlertEpisodeOwnerUser,
        title: "Read Alert Episode User Owner",
        description:
          "This permission can read Alert Episode user owners of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },

      // Alert Episode Owner Team Permissions
      {
        permission: Permission.CreateAlertEpisodeOwnerTeam,
        title: "Create Alert Episode Team Owner",
        description:
          "This permission can add team owners to Alert Episodes in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.DeleteAlertEpisodeOwnerTeam,
        title: "Delete Alert Episode Team Owner",
        description:
          "This permission can remove team owners from Alert Episodes of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.EditAlertEpisodeOwnerTeam,
        title: "Edit Alert Episode Team Owner",
        description:
          "This permission can edit Alert Episode team owners of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.ReadAlertEpisodeOwnerTeam,
        title: "Read Alert Episode Team Owner",
        description:
          "This permission can read Alert Episode team owners of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },

      // Alert Episode Internal Note Permissions
      {
        permission: Permission.CreateAlertEpisodeInternalNote,
        title: "Create Alert Episode Internal Note",
        description:
          "This permission can create Alert Episode internal notes in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.DeleteAlertEpisodeInternalNote,
        title: "Delete Alert Episode Internal Note",
        description:
          "This permission can delete Alert Episode internal notes of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.EditAlertEpisodeInternalNote,
        title: "Edit Alert Episode Internal Note",
        description:
          "This permission can edit Alert Episode internal notes of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.ReadAlertEpisodeInternalNote,
        title: "Read Alert Episode Internal Note",
        description:
          "This permission can read Alert Episode internal notes of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },

      // Alert Episode Feed Permissions
      {
        permission: Permission.CreateAlertEpisodeFeed,
        title: "Create Alert Episode Feed",
        description:
          "This permission can create Alert Episode feed items in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.EditAlertEpisodeFeed,
        title: "Edit Alert Episode Feed",
        description:
          "This permission can edit Alert Episode feed items of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },
      {
        permission: Permission.ReadAlertEpisodeFeed,
        title: "Read Alert Episode Feed",
        description:
          "This permission can read Alert Episode feed items of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Alert,
      },

      // Incident Episode Permissions
      {
        permission: Permission.CreateIncidentEpisode,
        title: "Create Incident Episode",
        description:
          "This permission can create Incident Episodes in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.DeleteIncidentEpisode,
        title: "Delete Incident Episode",
        description:
          "This permission can delete Incident Episodes of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.EditIncidentEpisode,
        title: "Edit Incident Episode",
        description:
          "This permission can edit Incident Episodes of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.ReadIncidentEpisode,
        title: "Read Incident Episode",
        description:
          "This permission can read Incident Episodes of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: true,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },

      // Incident Episode Member Permissions
      {
        permission: Permission.CreateIncidentEpisodeMember,
        title: "Create Incident Episode Member",
        description:
          "This permission can add incidents to Incident Episodes in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.DeleteIncidentEpisodeMember,
        title: "Delete Incident Episode Member",
        description:
          "This permission can remove incidents from Incident Episodes of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.EditIncidentEpisodeMember,
        title: "Edit Incident Episode Member",
        description:
          "This permission can edit Incident Episode Members of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.ReadIncidentEpisodeMember,
        title: "Read Incident Episode Member",
        description:
          "This permission can read Incident Episode Members of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },

      // Incident Episode State Timeline Permissions
      {
        permission: Permission.CreateIncidentEpisodeStateTimeline,
        title: "Create Incident Episode State Timeline",
        description:
          "This permission can create Incident Episode state history in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.DeleteIncidentEpisodeStateTimeline,
        title: "Delete Incident Episode State Timeline",
        description:
          "This permission can delete Incident Episode state history of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.EditIncidentEpisodeStateTimeline,
        title: "Edit Incident Episode State Timeline",
        description:
          "This permission can edit Incident Episode state history of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.ReadIncidentEpisodeStateTimeline,
        title: "Read Incident Episode State Timeline",
        description:
          "This permission can read Incident Episode state history of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },

      // Incident Episode Owner User Permissions
      {
        permission: Permission.CreateIncidentEpisodeOwnerUser,
        title: "Create Incident Episode User Owner",
        description:
          "This permission can add user owners to Incident Episodes in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.DeleteIncidentEpisodeOwnerUser,
        title: "Delete Incident Episode User Owner",
        description:
          "This permission can remove user owners from Incident Episodes of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.EditIncidentEpisodeOwnerUser,
        title: "Edit Incident Episode User Owner",
        description:
          "This permission can edit Incident Episode user owners of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.ReadIncidentEpisodeOwnerUser,
        title: "Read Incident Episode User Owner",
        description:
          "This permission can read Incident Episode user owners of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },

      // Incident Episode Owner Team Permissions
      {
        permission: Permission.CreateIncidentEpisodeOwnerTeam,
        title: "Create Incident Episode Team Owner",
        description:
          "This permission can add team owners to Incident Episodes in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.DeleteIncidentEpisodeOwnerTeam,
        title: "Delete Incident Episode Team Owner",
        description:
          "This permission can remove team owners from Incident Episodes of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.EditIncidentEpisodeOwnerTeam,
        title: "Edit Incident Episode Team Owner",
        description:
          "This permission can edit Incident Episode team owners of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.ReadIncidentEpisodeOwnerTeam,
        title: "Read Incident Episode Team Owner",
        description:
          "This permission can read Incident Episode team owners of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },

      // Incident Episode Internal Note Permissions
      {
        permission: Permission.CreateIncidentEpisodeInternalNote,
        title: "Create Incident Episode Internal Note",
        description:
          "This permission can create Incident Episode internal notes in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.DeleteIncidentEpisodeInternalNote,
        title: "Delete Incident Episode Internal Note",
        description:
          "This permission can delete Incident Episode internal notes of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.EditIncidentEpisodeInternalNote,
        title: "Edit Incident Episode Internal Note",
        description:
          "This permission can edit Incident Episode internal notes of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.ReadIncidentEpisodeInternalNote,
        title: "Read Incident Episode Internal Note",
        description:
          "This permission can read Incident Episode internal notes of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },

      // Incident Episode Feed Permissions
      {
        permission: Permission.CreateIncidentEpisodeFeed,
        title: "Create Incident Episode Feed",
        description:
          "This permission can create Incident Episode feed items in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.EditIncidentEpisodeFeed,
        title: "Edit Incident Episode Feed",
        description:
          "This permission can edit Incident Episode feed items of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.ReadIncidentEpisodeFeed,
        title: "Read Incident Episode Feed",
        description:
          "This permission can read Incident Episode feed items of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },

      // Incident Episode Public Note Permissions
      {
        permission: Permission.CreateIncidentEpisodePublicNote,
        title: "Create Incident Episode Public Note",
        description:
          "This permission can create Incident Episode public notes in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.DeleteIncidentEpisodePublicNote,
        title: "Delete Incident Episode Public Note",
        description:
          "This permission can delete Incident Episode public notes of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.EditIncidentEpisodePublicNote,
        title: "Edit Incident Episode Public Note",
        description:
          "This permission can edit Incident Episode public notes of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.ReadIncidentEpisodePublicNote,
        title: "Read Incident Episode Public Note",
        description:
          "This permission can read Incident Episode public notes of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },

      // Incident Grouping Rule Permissions
      {
        permission: Permission.CreateIncidentGroupingRule,
        title: "Create Incident Grouping Rule",
        description:
          "This permission can create Incident Grouping Rules in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.DeleteIncidentGroupingRule,
        title: "Delete Incident Grouping Rule",
        description:
          "This permission can delete Incident Grouping Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.EditIncidentGroupingRule,
        title: "Edit Incident Grouping Rule",
        description:
          "This permission can edit Incident Grouping Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.ReadIncidentGroupingRule,
        title: "Read Incident Grouping Rule",
        description:
          "This permission can read Incident Grouping Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },

      // Incident On-Call Rule Permissions
      {
        permission: Permission.CreateIncidentOnCallRule,
        title: "Create Incident On-Call Rule",
        description:
          "This permission can create Incident On-Call Rules in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.DeleteIncidentOnCallRule,
        title: "Delete Incident On-Call Rule",
        description:
          "This permission can delete Incident On-Call Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.EditIncidentOnCallRule,
        title: "Edit Incident On-Call Rule",
        description:
          "This permission can edit Incident On-Call Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.ReadIncidentOnCallRule,
        title: "Read Incident On-Call Rule",
        description:
          "This permission can read Incident On-Call Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },

      // Incident Owner Rule Permissions
      {
        permission: Permission.CreateIncidentOwnerRule,
        title: "Create Incident Owner Rule",
        description:
          "This permission can create Incident Owner Rules in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.DeleteIncidentOwnerRule,
        title: "Delete Incident Owner Rule",
        description:
          "This permission can delete Incident Owner Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.EditIncidentOwnerRule,
        title: "Edit Incident Owner Rule",
        description:
          "This permission can edit Incident Owner Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.ReadIncidentOwnerRule,
        title: "Read Incident Owner Rule",
        description:
          "This permission can read Incident Owner Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },

      // Incident Privacy Rule Permissions
      {
        permission: Permission.CreateIncidentPrivacyRule,
        title: "Create Incident Privacy Rule",
        description:
          "This permission can create Incident Privacy Rules in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.DeleteIncidentPrivacyRule,
        title: "Delete Incident Privacy Rule",
        description:
          "This permission can delete Incident Privacy Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.EditIncidentPrivacyRule,
        title: "Edit Incident Privacy Rule",
        description:
          "This permission can edit Incident Privacy Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.ReadIncidentPrivacyRule,
        title: "Read Incident Privacy Rule",
        description:
          "This permission can read Incident Privacy Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },

      // Incident Episode On-Call Rule Permissions
      {
        permission: Permission.CreateIncidentEpisodeOnCallRule,
        title: "Create Incident Episode On-Call Rule",
        description:
          "This permission can create Incident Episode On-Call Rules in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.DeleteIncidentEpisodeOnCallRule,
        title: "Delete Incident Episode On-Call Rule",
        description:
          "This permission can delete Incident Episode On-Call Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.EditIncidentEpisodeOnCallRule,
        title: "Edit Incident Episode On-Call Rule",
        description:
          "This permission can edit Incident Episode On-Call Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.ReadIncidentEpisodeOnCallRule,
        title: "Read Incident Episode On-Call Rule",
        description:
          "This permission can read Incident Episode On-Call Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },

      // Incident Episode Owner Rule Permissions
      {
        permission: Permission.CreateIncidentEpisodeOwnerRule,
        title: "Create Incident Episode Owner Rule",
        description:
          "This permission can create Incident Episode Owner Rules in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.DeleteIncidentEpisodeOwnerRule,
        title: "Delete Incident Episode Owner Rule",
        description:
          "This permission can delete Incident Episode Owner Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.EditIncidentEpisodeOwnerRule,
        title: "Edit Incident Episode Owner Rule",
        description:
          "This permission can edit Incident Episode Owner Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.ReadIncidentEpisodeOwnerRule,
        title: "Read Incident Episode Owner Rule",
        description:
          "This permission can read Incident Episode Owner Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },

      // Incident Episode Privacy Rule Permissions
      {
        permission: Permission.CreateIncidentEpisodePrivacyRule,
        title: "Create Incident Episode Privacy Rule",
        description:
          "This permission can create Incident Episode Privacy Rules in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.DeleteIncidentEpisodePrivacyRule,
        title: "Delete Incident Episode Privacy Rule",
        description:
          "This permission can delete Incident Episode Privacy Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.EditIncidentEpisodePrivacyRule,
        title: "Edit Incident Episode Privacy Rule",
        description:
          "This permission can edit Incident Episode Privacy Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.ReadIncidentEpisodePrivacyRule,
        title: "Read Incident Episode Privacy Rule",
        description:
          "This permission can read Incident Episode Privacy Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },

      // Incident Label Rule Permissions
      {
        permission: Permission.CreateIncidentLabelRule,
        title: "Create Incident Label Rule",
        description:
          "This permission can create Incident Label Rules in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.DeleteIncidentLabelRule,
        title: "Delete Incident Label Rule",
        description:
          "This permission can delete Incident Label Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.EditIncidentLabelRule,
        title: "Edit Incident Label Rule",
        description:
          "This permission can edit Incident Label Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.ReadIncidentLabelRule,
        title: "Read Incident Label Rule",
        description:
          "This permission can read Incident Label Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },

      // Incident Episode Label Rule Permissions
      {
        permission: Permission.CreateIncidentEpisodeLabelRule,
        title: "Create Incident Episode Label Rule",
        description:
          "This permission can create Incident Episode Label Rules in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.DeleteIncidentEpisodeLabelRule,
        title: "Delete Incident Episode Label Rule",
        description:
          "This permission can delete Incident Episode Label Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.EditIncidentEpisodeLabelRule,
        title: "Edit Incident Episode Label Rule",
        description:
          "This permission can edit Incident Episode Label Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.ReadIncidentEpisodeLabelRule,
        title: "Read Incident Episode Label Rule",
        description:
          "This permission can read Incident Episode Label Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },

      // Incident SLA Rule Permissions
      {
        permission: Permission.CreateIncidentSlaRule,
        title: "Create Incident SLA Rule",
        description:
          "This permission can create Incident SLA Rules in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.DeleteIncidentSlaRule,
        title: "Delete Incident SLA Rule",
        description:
          "This permission can delete Incident SLA Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.EditIncidentSlaRule,
        title: "Edit Incident SLA Rule",
        description:
          "This permission can edit Incident SLA Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.ReadIncidentSlaRule,
        title: "Read Incident SLA Rule",
        description:
          "This permission can read Incident SLA Rules of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },

      // Incident SLA Permissions
      {
        permission: Permission.CreateIncidentSla,
        title: "Create Incident SLA",
        description:
          "This permission can create Incident SLA records in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.DeleteIncidentSla,
        title: "Delete Incident SLA",
        description:
          "This permission can delete Incident SLA records of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.EditIncidentSla,
        title: "Edit Incident SLA",
        description:
          "This permission can edit Incident SLA records of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },
      {
        permission: Permission.ReadIncidentSla,
        title: "Read Incident SLA",
        description:
          "This permission can read Incident SLA records of this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Incident,
      },

      // Operational Resource Wildcard Permissions
      {
        permission: Permission.ReadAllOperationalResources,
        title: "Read All Operational Resources",
        description:
          "Wildcard read permission for all operational resources in this project (Monitor, Incident, Alert, StatusPage, etc.).",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Project,
      },
      {
        permission: Permission.EditAllOperationalResources,
        title: "Edit All Operational Resources",
        description:
          "Wildcard edit permission for all operational resources in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Project,
      },
      {
        permission: Permission.DeleteAllOperationalResources,
        title: "Delete All Operational Resources",
        description:
          "Wildcard delete permission for all operational resources in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Project,
      },
      {
        permission: Permission.CreateAllOperationalResources,
        title: "Create All Operational Resources",
        description:
          "Wildcard create permission for all operational resources in this project.",
        isAssignableToTenant: true,
        isAccessControlPermission: false,
        isRolePermission: false,
        group: PermissionGroup.Project,
      },
    ];

    return permissions;
  }

  public static getPermissionsByGroup(
    group: PermissionGroup,
  ): Array<PermissionProps> {
    return this.getAllPermissionProps().filter((item: PermissionProps) => {
      return item.group === group;
    });
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
  /*
   * Scope of this permission row. Absent means `Labels` (legacy default).
   * - `All`: applies project-wide.
   * - `Owned`: applies to resources owned by the user (in *OwnerUser) OR by
   *   this team (in *OwnerTeam).
   * - `Labels`: existing allow/block-list label semantics.
   */
  scope?: PermissionScope | undefined;
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
