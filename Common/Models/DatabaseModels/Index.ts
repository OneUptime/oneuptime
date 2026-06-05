import AcmeCertificate from "./AcmeCertificate";
import AcmeChallenge from "./AcmeChallenge";
import KubernetesCluster from "./KubernetesCluster";
import KubernetesClusterOwnerTeam from "./KubernetesClusterOwnerTeam";
import KubernetesClusterOwnerUser from "./KubernetesClusterOwnerUser";
import KubernetesResource from "./KubernetesResource";
import KubernetesContainer from "./KubernetesContainer";
import DockerHost from "./DockerHost";
import DockerHostOwnerTeam from "./DockerHostOwnerTeam";
import DockerHostOwnerUser from "./DockerHostOwnerUser";
import DockerResource from "./DockerResource";
import Host from "./Host";
import HostOwnerTeam from "./HostOwnerTeam";
import HostOwnerUser from "./HostOwnerUser";
// API Keys
import ApiKey from "./ApiKey";
import ApiKeyPermission from "./ApiKeyPermission";
import BillingInvoice from "./BillingInvoice";
import BillingPaymentMethods from "./BillingPaymentMethod";
import CallLog from "./CallLog";
// Date migration
import DataMigration from "./DataMigration";
import Domain from "./Domain";
import EmailLog from "./EmailLog";
import EmailVerificationToken from "./EmailVerificationToken";
import File from "./File";
import GlobalConfig from "./GlobalConfig";
import GreenlockCertificate from "./GreenlockCertificate";
// Greenlock
import GreenlockChallenge from "./GreenlockChallenge";
// Incidents
import Incident from "./Incident";
import IncidentFeed from "./IncidentFeed";
import IncidentCustomField from "./IncidentCustomField";
import IncidentInternalNote from "./IncidentInternalNote";
import IncidentNoteTemplate from "./IncidentNoteTemplate";
import IncidentPostmortemTemplate from "./IncidentPostmortemTemplate";
import IncidentOwnerTeam from "./IncidentOwnerTeam";
import IncidentOwnerUser from "./IncidentOwnerUser";
import IncidentRole from "./IncidentRole";
import IncidentMember from "./IncidentMember";
import IncidentPublicNote from "./IncidentPublicNote";
import IncidentSeverity from "./IncidentSeverity";
import IncidentState from "./IncidentState";
import IncidentStateTimeline from "./IncidentStateTimeline";
import IncidentTemplate from "./IncidentTemplate";
import IncidentTemplateOwnerTeam from "./IncidentTemplateOwnerTeam";
import IncidentTemplateOwnerUser from "./IncidentTemplateOwnerUser";
//Labels.
import Label from "./Label";
import LogSavedView from "./LogSavedView";
import MetricSavedView from "./MetricSavedView";
import TraceSavedView from "./TraceSavedView";
import LogPipeline from "./LogPipeline";
import LogPipelineProcessor from "./LogPipelineProcessor";
import LogDropFilter from "./LogDropFilter";
import LogScrubRule from "./LogScrubRule";
import MetricPipelineRule from "./MetricPipelineRule";
import MetricRecordingRule from "./MetricRecordingRule";
import TracePipeline from "./TracePipeline";
import TracePipelineProcessor from "./TracePipelineProcessor";
import TraceDropFilter from "./TraceDropFilter";
import TraceScrubRule from "./TraceScrubRule";
import TraceRecordingRule from "./TraceRecordingRule";
// Monitors
import Monitor from "./Monitor";
import MonitorCustomField from "./MonitorCustomField";
import MonitorTemplate from "./MonitorTemplate";
// Monitor Groups
import MonitorGroup from "./MonitorGroup";
import MonitorGroupOwnerTeam from "./MonitorGroupOwnerTeam";
import MonitorGroupOwnerUser from "./MonitorGroupOwnerUser";
import MonitorGroupResource from "./MonitorGroupResource";
import MonitorOwnerTeam from "./MonitorOwnerTeam";
import MonitorOwnerUser from "./MonitorOwnerUser";
import MonitorProbe from "./MonitorProbe";
import MonitorSecret from "./MonitorSecret";
import MonitorStatus from "./MonitorStatus";
import MonitorStatusTimeline from "./MonitorStatusTimeline";
// On-Call Duty
import OnCallDutyPolicy from "./OnCallDutyPolicy";
import OnCallDutyPolicyCustomField from "./OnCallDutyPolicyCustomField";
import OnCallDutyPolicyEscalationRule from "./OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleSchedule from "./OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleTeam from "./OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleUser from "./OnCallDutyPolicyEscalationRuleUser";
import OnCallDutyPolicyExecutionLog from "./OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogTimeline from "./OnCallDutyPolicyExecutionLogTimeline";
// owner team
import OnCallDutyPolicyOwnerTeam from "./OnCallDutyPolicyOwnerTeam";
import OnCallDutyPolicyOwnerUser from "./OnCallDutyPolicyOwnerUser";

// OnCall Duty Policy Feed
import OnCallDutyPolicyFeed from "./OnCallDutyPolicyFeed";
// On call duty policy schedule
import OnCallDutyPolicySchedule from "./OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleLayer from "./OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "./OnCallDutyPolicyScheduleLayerUser";
import OnCallDutyPolicyScheduleOwnerTeam from "./OnCallDutyPolicyScheduleOwnerTeam";
import OnCallDutyPolicyScheduleOwnerUser from "./OnCallDutyPolicyScheduleOwnerUser";

// On-Call Duty Label and Owner Rules
import OnCallDutyPolicyLabelRule from "./OnCallDutyPolicyLabelRule";
import OnCallDutyPolicyOwnerRule from "./OnCallDutyPolicyOwnerRule";
import OnCallDutyPolicyScheduleLabelRule from "./OnCallDutyPolicyScheduleLabelRule";
import OnCallDutyPolicyScheduleOwnerRule from "./OnCallDutyPolicyScheduleOwnerRule";

// Incoming Call Policy Owners and Rules
import IncomingCallPolicyOwnerTeam from "./IncomingCallPolicyOwnerTeam";
import IncomingCallPolicyOwnerUser from "./IncomingCallPolicyOwnerUser";
import IncomingCallPolicyLabelRule from "./IncomingCallPolicyLabelRule";
import IncomingCallPolicyOwnerRule from "./IncomingCallPolicyOwnerRule";
import OnCallDutyPolicyTimeLog from "./OnCallDutyPolicyTimeLog";

// Incoming Call Policy
import IncomingCallPolicy from "./IncomingCallPolicy";
import IncomingCallPolicyEscalationRule from "./IncomingCallPolicyEscalationRule";
import IncomingCallLog from "./IncomingCallLog";
import IncomingCallLogItem from "./IncomingCallLogItem";

import Probe from "./Probe";
import ProbeOwnerTeam from "./ProbeOwnerTeam";
import ProbeOwnerUser from "./ProbeOwnerUser";
import AIAgent from "./AIAgent";
import AIAgentOwnerTeam from "./AIAgentOwnerTeam";
import AIAgentOwnerUser from "./AIAgentOwnerUser";
import AIAgentTask from "./AIAgentTask";
import AIAgentTaskLog from "./AIAgentTaskLog";
import AIAgentTaskPullRequest from "./AIAgentTaskPullRequest";
import AIAgentTaskTelemetryException from "./AIAgentTaskTelemetryException";
import LlmProvider from "./LlmProvider";
import LlmLog from "./LlmLog";
import Project from "./Project";
import ProjectCallSMSConfig from "./ProjectCallSMSConfig";
import ProjectUserProfile from "./ProjectUserProfile";
// Project SMTP Config.
import ProjectSmtpConfig from "./ProjectSmtpConfig";
//SSO
import ProjectSSO from "./ProjectSso";
import ProjectOIDC from "./ProjectOidc";
import PromoCode from "./PromoCode";
import EnterpriseLicense from "./EnterpriseLicense";
import OpenSourceDeployment from "./OpenSourceDeployment";
import Reseller from "./Reseller";
import ResellerPlan from "./ResellerPlan";
// ScheduledMaintenances
import ScheduledMaintenance from "./ScheduledMaintenance";
import ScheduledMaintenanceCustomField from "./ScheduledMaintenanceCustomField";
import ScheduledMaintenanceInternalNote from "./ScheduledMaintenanceInternalNote";
import ScheduledMaintenanceNoteTemplate from "./ScheduledMaintenanceNoteTemplate";
import ScheduledMaintenanceOwnerTeam from "./ScheduledMaintenanceOwnerTeam";
import ScheduledMaintenanceOwnerUser from "./ScheduledMaintenanceOwnerUser";
import ScheduledMaintenancePublicNote from "./ScheduledMaintenancePublicNote";
import ScheduledMaintenanceState from "./ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "./ScheduledMaintenanceStateTimeline";
import Service from "./Service";
import ServiceOwnerTeam from "./ServiceOwnerTeam";
import ServiceOwnerUser from "./ServiceOwnerUser";
import ServiceCodeRepository from "./ServiceCodeRepository";
import CodeRepository from "./CodeRepository";
// Short link.
import ShortLink from "./ShortLink";
// SMS
import SmsLog from "./SmsLog";
import WhatsAppLog from "./WhatsAppLog";
import TelegramLog from "./TelegramLog";
import WebhookLog from "./WebhookLog";
import PushNotificationLog from "./PushNotificationLog";
import WorkspaceNotificationLog from "./WorkspaceNotificationLog";
// Status Page
import StatusPage from "./StatusPage";
import StatusPageAnnouncement from "./StatusPageAnnouncement";
import StatusPageAnnouncementTemplate from "./StatusPageAnnouncementTemplate";
import StatusPageCustomField from "./StatusPageCustomField";
import StatusPageDomain from "./StatusPageDomain";
import StatusPageFooterLink from "./StatusPageFooterLink";
import StatusPageGroup from "./StatusPageGroup";
import StatusPageHeaderLink from "./StatusPageHeaderLink";
import StatusPageHistoryChartBarColorRule from "./StatusPageHistoryChartBarColorRule";
import StatusPageOwnerTeam from "./StatusPageOwnerTeam";
import StatusPageOwnerUser from "./StatusPageOwnerUser";
import StatusPagePrivateUser from "./StatusPagePrivateUser";
import StatusPagePrivateUserSession from "./StatusPagePrivateUserSession";
import StatusPageResource from "./StatusPageResource";
import StatusPageSCIM from "./StatusPageSCIM";
import StatusPageSSO from "./StatusPageSso";
import StatusPageOIDC from "./StatusPageOidc";
import StatusPageSubscriber from "./StatusPageSubscriber";
import StatusPageSubscriberNotificationTemplate from "./StatusPageSubscriberNotificationTemplate";
import StatusPageSubscriberNotificationTemplateStatusPage from "./StatusPageSubscriberNotificationTemplateStatusPage";
// Team
import Team from "./Team";
import TeamCustomField from "./TeamCustomField";
import TeamMember from "./TeamMember";
import TeamMemberCustomField from "./TeamMemberCustomField";
import TeamPermission from "./TeamPermission";
import TeamComplianceSetting from "./TeamComplianceSetting";
import UsageBilling from "./TelemetryUsageBilling";
import User from "./User";
import UserSession from "./UserSession";
import UserCall from "./UserCall";
// Notification Methods
import UserEmail from "./UserEmail";
import UserPush from "./UserPush";
import UserWhatsApp from "./UserWhatsApp";
import UserTelegram from "./UserTelegram";
import UserWebhook from "./UserWebhook";
// User Notification Rules
import UserNotificationRule from "./UserNotificationRule";
import UserNotificationSetting from "./UserNotificationSetting";
import UserOnCallLog from "./UserOnCallLog";
import UserOnCallLogTimeline from "./UserOnCallLogTimeline";
import UserSms from "./UserSMS";
import UserIncomingCallNumber from "./UserIncomingCallNumber";
// Workflows.
import Workflow from "./Workflow";
import WorkflowLog from "./WorkflowLog";
import WorkflowVariables from "./WorkflowVariable";
import WorkflowOwnerTeam from "./WorkflowOwnerTeam";
import WorkflowOwnerUser from "./WorkflowOwnerUser";
// Runbooks.
import Runbook from "./Runbook";
import RunbookAgent from "./RunbookAgent";
import RunbookAgentJob from "./RunbookAgentJob";
import RunbookAgentOwnerTeam from "./RunbookAgentOwnerTeam";
import RunbookAgentOwnerUser from "./RunbookAgentOwnerUser";
import RunbookSecret from "./RunbookSecret";
import RunbookExecution from "./RunbookExecution";
import RunbookOwnerTeam from "./RunbookOwnerTeam";
import RunbookOwnerUser from "./RunbookOwnerUser";
import RunbookRule from "./RunbookRule";

import UserTotpAuth from "./UserTotpAuth";
import UserWebAuthn from "./UserWebAuthn";

import TelemetryIngestionKey from "./TelemetryIngestionKey";

import TelemetryException from "./TelemetryException";
import ScheduledMaintenanceTemplate from "./ScheduledMaintenanceTemplate";
import ScheduledMaintenanceTemplateOwnerTeam from "./ScheduledMaintenanceTemplateOwnerTeam";
import ScheduledMaintenanceTemplateOwnerUser from "./ScheduledMaintenanceTemplateOwnerUser";

import BaseModel from "./DatabaseBaseModel/DatabaseBaseModel";

import AlertState from "./AlertState";
import Alert from "./Alert";
import AlertCustomField from "./AlertCustomField";
import AlertStateTimeline from "./AlertStateTimeline";
import AlertInternalNote from "./AlertInternalNote";
import AlertOwnerTeam from "./AlertOwnerTeam";
import AlertOwnerUser from "./AlertOwnerUser";
import AlertSeverity from "./AlertSeverity";
import AlertNoteTemplate from "./AlertNoteTemplate";
import AlertFeed from "./AlertFeed";

import AlertEpisode from "./AlertEpisode";
import AlertEpisodeMember from "./AlertEpisodeMember";
import AlertEpisodeStateTimeline from "./AlertEpisodeStateTimeline";
import AlertEpisodeOwnerUser from "./AlertEpisodeOwnerUser";
import AlertEpisodeOwnerTeam from "./AlertEpisodeOwnerTeam";
import AlertEpisodeInternalNote from "./AlertEpisodeInternalNote";
import AlertEpisodeFeed from "./AlertEpisodeFeed";
import AlertGroupingRule from "./AlertGroupingRule";
import AlertOnCallRule from "./AlertOnCallRule";
import AlertOwnerRule from "./AlertOwnerRule";
import AlertPrivacyRule from "./AlertPrivacyRule";
import AlertLabelRule from "./AlertLabelRule";
import AlertEpisodeOnCallRule from "./AlertEpisodeOnCallRule";
import AlertEpisodeOwnerRule from "./AlertEpisodeOwnerRule";
import AlertEpisodePrivacyRule from "./AlertEpisodePrivacyRule";
import AlertEpisodeLabelRule from "./AlertEpisodeLabelRule";

import IncidentEpisode from "./IncidentEpisode";
import IncidentEpisodeMember from "./IncidentEpisodeMember";
import IncidentEpisodeRoleMember from "./IncidentEpisodeRoleMember";
import IncidentEpisodeStateTimeline from "./IncidentEpisodeStateTimeline";
import IncidentEpisodeOwnerUser from "./IncidentEpisodeOwnerUser";
import IncidentEpisodeOwnerTeam from "./IncidentEpisodeOwnerTeam";
import IncidentEpisodeInternalNote from "./IncidentEpisodeInternalNote";
import IncidentEpisodeFeed from "./IncidentEpisodeFeed";
import IncidentEpisodePublicNote from "./IncidentEpisodePublicNote";
import IncidentGroupingRule from "./IncidentGroupingRule";
import IncidentOnCallRule from "./IncidentOnCallRule";
import IncidentOwnerRule from "./IncidentOwnerRule";
import IncidentPrivacyRule from "./IncidentPrivacyRule";
import IncidentLabelRule from "./IncidentLabelRule";
import ScheduledMaintenanceOwnerRule from "./ScheduledMaintenanceOwnerRule";
import ScheduledMaintenanceLabelRule from "./ScheduledMaintenanceLabelRule";
import IncidentEpisodeOnCallRule from "./IncidentEpisodeOnCallRule";
import IncidentEpisodeOwnerRule from "./IncidentEpisodeOwnerRule";
import IncidentEpisodePrivacyRule from "./IncidentEpisodePrivacyRule";
import IncidentEpisodeLabelRule from "./IncidentEpisodeLabelRule";
import IncidentSlaRule from "./IncidentSlaRule";
import IncidentSla from "./IncidentSla";
import MonitorOwnerRule from "./MonitorOwnerRule";
import MonitorLabelRule from "./MonitorLabelRule";
import StatusPageOwnerRule from "./StatusPageOwnerRule";
import StatusPageLabelRule from "./StatusPageLabelRule";
import HostOwnerRule from "./HostOwnerRule";
import HostLabelRule from "./HostLabelRule";
import ServiceOwnerRule from "./ServiceOwnerRule";
import ServiceLabelRule from "./ServiceLabelRule";
import DockerHostOwnerRule from "./DockerHostOwnerRule";
import DockerHostLabelRule from "./DockerHostLabelRule";
import KubernetesClusterOwnerRule from "./KubernetesClusterOwnerRule";
import KubernetesClusterLabelRule from "./KubernetesClusterLabelRule";
import RunbookOwnerRule from "./RunbookOwnerRule";
import RunbookLabelRule from "./RunbookLabelRule";
import WorkflowOwnerRule from "./WorkflowOwnerRule";
import WorkflowLabelRule from "./WorkflowLabelRule";
import DashboardOwnerRule from "./DashboardOwnerRule";
import DashboardLabelRule from "./DashboardLabelRule";

import TableView from "./TableView";
import Dashboard from "./Dashboard";
import DashboardDomain from "./DashboardDomain";
import DashboardOwnerTeam from "./DashboardOwnerTeam";
import DashboardOwnerUser from "./DashboardOwnerUser";

import MonitorTest from "./MonitorTest";
import ScheduledMaintenanceFeed from "./ScheduledMaintenanceFeed";

import WorkspaceUserAuthToken from "./WorkspaceUserAuthToken";
import WorkspaceProjectAuthToken from "./WorkspaceProjectAuthToken";
import WorkspaceSetting from "./WorkspaceSetting";
import WorkspaceNotificationRule from "./WorkspaceNotificationRule";
import WorkspaceNotificationSummary from "./WorkspaceNotificationSummary";

import OnCallDutyPolicyUserOverride from "./OnCallDutyPolicyUserOverride";
import MonitorFeed from "./MonitorFeed";
import MetricType from "./MetricType";
import ProjectSCIM from "./ProjectSCIM";
import ProjectSCIMLog from "./ProjectSCIMLog";
import StatusPageSCIMLog from "./StatusPageSCIMLog";

const AllModelTypes: Array<{
  new (): BaseModel;
}> = [
  User,
  WorkspaceUserAuthToken,
  WorkspaceProjectAuthToken,
  Probe,
  Project,
  EmailVerificationToken,
  Team,
  TeamCustomField,
  TeamMember,
  TeamMemberCustomField,
  TeamPermission,
  TeamComplianceSetting,
  ApiKey,
  Label,
  LogSavedView,
  MetricSavedView,
  TraceSavedView,
  LogPipeline,
  LogPipelineProcessor,
  LogDropFilter,
  LogScrubRule,
  MetricPipelineRule,
  MetricRecordingRule,
  TracePipeline,
  TracePipelineProcessor,
  TraceDropFilter,
  TraceScrubRule,
  TraceRecordingRule,
  ApiKeyPermission,
  ProjectSmtpConfig,
  StatusPage,

  OnCallDutyPolicy,
  OnCallDutyPolicyCustomField,
  OnCallDutyPolicyEscalationRule,
  OnCallDutyPolicyEscalationRuleTeam,
  OnCallDutyPolicyEscalationRuleUser,
  OnCallDutyPolicyExecutionLog,
  OnCallDutyPolicyExecutionLogTimeline,
  OnCallDutyPolicyUserOverride,

  // Incoming Call Policy
  IncomingCallPolicy,
  IncomingCallPolicyEscalationRule,
  IncomingCallLog,
  IncomingCallLogItem,

  Monitor,
  MonitorSecret,
  MonitorStatus,
  MonitorCustomField,
  MonitorTemplate,

  IncidentState,
  Incident,
  IncidentFeed,
  IncidentCustomField,
  IncidentStateTimeline,
  IncidentInternalNote,
  IncidentPublicNote,
  IncidentTemplate,
  IncidentTemplateOwnerTeam,
  IncidentTemplateOwnerUser,
  IncidentOwnerTeam,
  IncidentOwnerUser,
  IncidentRole,
  IncidentMember,
  IncidentSeverity,
  IncidentNoteTemplate,
  IncidentPostmortemTemplate,

  AlertState,
  Alert,
  AlertFeed,
  AlertCustomField,
  AlertStateTimeline,
  AlertInternalNote,
  AlertOwnerTeam,
  AlertOwnerUser,
  AlertSeverity,
  AlertNoteTemplate,

  AlertEpisode,
  AlertEpisodeMember,
  AlertEpisodeStateTimeline,
  AlertEpisodeOwnerUser,
  AlertEpisodeOwnerTeam,
  AlertEpisodeInternalNote,
  AlertEpisodeFeed,
  AlertGroupingRule,
  AlertOnCallRule,
  AlertOwnerRule,
  AlertPrivacyRule,
  AlertLabelRule,
  AlertEpisodeOnCallRule,
  AlertEpisodeOwnerRule,
  AlertEpisodePrivacyRule,
  AlertEpisodeLabelRule,

  IncidentEpisode,
  IncidentEpisodeMember,
  IncidentEpisodeRoleMember,
  IncidentEpisodeStateTimeline,
  IncidentEpisodeOwnerUser,
  IncidentEpisodeOwnerTeam,
  IncidentEpisodeInternalNote,
  IncidentEpisodeFeed,
  IncidentEpisodePublicNote,
  IncidentGroupingRule,
  IncidentOnCallRule,
  IncidentOwnerRule,
  IncidentPrivacyRule,
  IncidentLabelRule,
  ScheduledMaintenanceOwnerRule,
  ScheduledMaintenanceLabelRule,
  IncidentEpisodeOnCallRule,
  IncidentEpisodeOwnerRule,
  IncidentEpisodePrivacyRule,
  IncidentEpisodeLabelRule,
  IncidentSlaRule,
  IncidentSla,

  MonitorOwnerRule,
  MonitorLabelRule,
  StatusPageOwnerRule,
  StatusPageLabelRule,
  HostOwnerRule,
  HostLabelRule,
  ServiceOwnerRule,
  ServiceLabelRule,
  DockerHostOwnerRule,
  DockerHostLabelRule,
  KubernetesClusterOwnerRule,
  KubernetesClusterLabelRule,
  RunbookOwnerRule,
  RunbookLabelRule,
  WorkflowOwnerRule,
  WorkflowLabelRule,
  DashboardOwnerRule,
  DashboardLabelRule,

  MonitorStatusTimeline,

  File,
  Domain,

  StatusPageGroup,
  StatusPageDomain,
  StatusPageCustomField,
  StatusPageResource,

  StatusPageAnnouncement,
  StatusPageAnnouncementTemplate,
  StatusPageSubscriber,
  StatusPageSubscriberNotificationTemplate,
  StatusPageSubscriberNotificationTemplateStatusPage,
  StatusPageFooterLink,
  StatusPageHeaderLink,
  StatusPagePrivateUser,
  StatusPagePrivateUserSession,
  StatusPageHistoryChartBarColorRule,

  ScheduledMaintenanceState,
  ScheduledMaintenance,
  ScheduledMaintenanceStateTimeline,
  ScheduledMaintenancePublicNote,
  ScheduledMaintenanceInternalNote,
  ScheduledMaintenanceCustomField,
  ScheduledMaintenanceFeed,

  BillingPaymentMethods,
  BillingInvoice,

  GreenlockChallenge,
  GreenlockCertificate,

  Workflow,
  WorkflowVariables,
  WorkflowLog,
  WorkflowOwnerTeam,
  WorkflowOwnerUser,

  Runbook,
  RunbookExecution,
  RunbookOwnerTeam,
  RunbookOwnerUser,
  RunbookRule,
  RunbookAgent,
  RunbookAgentJob,
  RunbookAgentOwnerTeam,
  RunbookAgentOwnerUser,
  RunbookSecret,

  ProjectSSO,
  ProjectOIDC,
  StatusPageSSO,
  StatusPageOIDC,
  StatusPageSCIM,

  MonitorProbe,

  MonitorOwnerTeam,
  MonitorOwnerUser,

  ScheduledMaintenanceOwnerTeam,
  ScheduledMaintenanceOwnerUser,

  StatusPageOwnerTeam,
  StatusPageOwnerUser,

  SmsLog,
  WhatsAppLog,
  TelegramLog,
  WebhookLog,
  PushNotificationLog,
  WorkspaceNotificationLog,
  CallLog,
  EmailLog,

  UserEmail,
  UserSms,
  UserCall,
  UserPush,
  UserWhatsApp,
  UserTelegram,
  UserWebhook,
  UserIncomingCallNumber,

  UserNotificationRule,
  UserOnCallLog,
  UserOnCallLogTimeline,
  UserNotificationSetting,

  DataMigration,

  ShortLink,

  ScheduledMaintenanceTemplate,
  ScheduledMaintenanceTemplateOwnerTeam,
  ScheduledMaintenanceTemplateOwnerUser,
  ScheduledMaintenanceNoteTemplate,

  Reseller,
  ResellerPlan,

  PromoCode,
  EnterpriseLicense,
  OpenSourceDeployment,

  GlobalConfig,

  MonitorGroup,
  MonitorGroupOwnerTeam,
  MonitorGroupOwnerUser,
  MonitorGroupResource,

  OnCallDutyPolicySchedule,
  OnCallDutyPolicyScheduleLayer,
  OnCallDutyPolicyScheduleLayerUser,
  OnCallDutyPolicyScheduleOwnerTeam,
  OnCallDutyPolicyScheduleOwnerUser,
  OnCallDutyPolicyFeed,
  OnCallDutyPolicyOwnerTeam,
  OnCallDutyPolicyOwnerUser,
  OnCallDutyPolicyLabelRule,
  OnCallDutyPolicyOwnerRule,
  OnCallDutyPolicyScheduleLabelRule,
  OnCallDutyPolicyScheduleOwnerRule,
  IncomingCallPolicyOwnerTeam,
  IncomingCallPolicyOwnerUser,
  IncomingCallPolicyLabelRule,
  IncomingCallPolicyOwnerRule,
  OnCallDutyPolicyEscalationRuleSchedule,

  UsageBilling,

  ProjectCallSMSConfig,
  ProjectUserProfile,

  AcmeCertificate,

  AcmeChallenge,

  Service,
  ServiceOwnerTeam,
  ServiceOwnerUser,
  ServiceCodeRepository,

  // Code Repository
  CodeRepository,

  ProbeOwnerTeam,
  ProbeOwnerUser,

  AIAgent,
  AIAgentOwnerTeam,
  AIAgentOwnerUser,
  AIAgentTask,
  AIAgentTaskLog,
  AIAgentTaskPullRequest,
  AIAgentTaskTelemetryException,

  LlmProvider,
  LlmLog,

  UserSession,
  UserTotpAuth,
  UserWebAuthn,

  TelemetryIngestionKey,

  TelemetryException,

  TableView,

  // Dashboards
  Dashboard,
  DashboardDomain,
  DashboardOwnerTeam,
  DashboardOwnerUser,

  MonitorTest,

  WorkspaceSetting,
  WorkspaceNotificationRule,
  WorkspaceNotificationSummary,

  MonitorFeed,

  MetricType,

  OnCallDutyPolicyTimeLog,

  ProjectSCIM,
  ProjectSCIMLog,
  StatusPageSCIMLog,

  KubernetesCluster,
  KubernetesClusterOwnerTeam,
  KubernetesClusterOwnerUser,
  KubernetesResource,
  KubernetesContainer,
  DockerHost,
  DockerHostOwnerTeam,
  DockerHostOwnerUser,
  DockerResource,
  Host,
  HostOwnerTeam,
  HostOwnerUser,
];

const modelTypeMap: { [key: string]: { new (): BaseModel } } = {};

type GetModelTypeByNameFunction = (
  tableName: string,
) => { new (): BaseModel } | null;

export const getModelTypeByName: GetModelTypeByNameFunction = (
  tableName: string,
): { new (): BaseModel } | null => {
  if (modelTypeMap[tableName]) {
    return modelTypeMap[tableName] || null;
  }

  const modelType: { new (): BaseModel } | undefined = AllModelTypes.find(
    (modelType: { new (): BaseModel }) => {
      return new modelType().tableName === tableName;
    },
  );

  if (!modelType) {
    return null;
  }

  modelTypeMap[tableName] = modelType;

  return modelType;
};

export default AllModelTypes;
