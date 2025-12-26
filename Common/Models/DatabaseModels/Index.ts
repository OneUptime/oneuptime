import AcmeCertificate from "./AcmeCertificate";
import AcmeChallenge from "./AcmeChallenge";
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
import IncidentPublicNote from "./IncidentPublicNote";
import IncidentSeverity from "./IncidentSeverity";
import IncidentState from "./IncidentState";
import IncidentStateTimeline from "./IncidentStateTimeline";
import IncidentTemplate from "./IncidentTemplate";
import IncidentTemplateOwnerTeam from "./IncidentTemplateOwnerTeam";
import IncidentTemplateOwnerUser from "./IncidentTemplateOwnerUser";
//Labels.
import Label from "./Label";
// Monitors
import Monitor from "./Monitor";
import MonitorCustomField from "./MonitorCustomField";
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
import OnCallDutyPolicyTimeLog from "./OnCallDutyPolicyTimeLog";

import Probe from "./Probe";
import ProbeOwnerTeam from "./ProbeOwnerTeam";
import ProbeOwnerUser from "./ProbeOwnerUser";
import AIAgent from "./AIAgent";
import AIAgentOwnerTeam from "./AIAgentOwnerTeam";
import AIAgentOwnerUser from "./AIAgentOwnerUser";
import AIAgentTask from "./AIAgentTask";
import AIAgentTaskLog from "./AIAgentTaskLog";
import AIAgentTaskTelemetryException from "./AIAgentTaskTelemetryException";
import LlmProvider from "./LlmProvider";
import LlmLog from "./LlmLog";
import Project from "./Project";
import ProjectCallSMSConfig from "./ProjectCallSMSConfig";
// Project SMTP Config.
import ProjectSmtpConfig from "./ProjectSmtpConfig";
//SSO
import ProjectSSO from "./ProjectSso";
import PromoCode from "./PromoCode";
import EnterpriseLicense from "./EnterpriseLicense";
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
import ServiceCatalog from "./ServiceCatalog";
import ServiceCatalogOwnerTeam from "./ServiceCatalogOwnerTeam";
import ServiceCatalogOwnerUser from "./ServiceCatalogOwnerUser";
import ServiceCatalogCodeRepository from "./ServiceCatalogCodeRepository";
import CodeRepository from "./CodeRepository";
// Short link.
import ShortLink from "./ShortLink";
// SMS
import SmsLog from "./SmsLog";
import WhatsAppLog from "./WhatsAppLog";
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
import StatusPageSubscriber from "./StatusPageSubscriber";
import StatusPageSubscriberNotificationTemplate from "./StatusPageSubscriberNotificationTemplate";
import StatusPageSubscriberNotificationTemplateStatusPage from "./StatusPageSubscriberNotificationTemplateStatusPage";
// Team
import Team from "./Team";
import TeamMember from "./TeamMember";
import TeamPermission from "./TeamPermission";
import TeamComplianceSetting from "./TeamComplianceSetting";
import TelemetryService from "./TelemetryService";
import UsageBilling from "./TelemetryUsageBilling";
import User from "./User";
import UserSession from "./UserSession";
import UserCall from "./UserCall";
// Notification Methods
import UserEmail from "./UserEmail";
import UserPush from "./UserPush";
import UserWhatsApp from "./UserWhatsApp";
// User Notification Rules
import UserNotificationRule from "./UserNotificationRule";
import UserNotificationSetting from "./UserNotificationSetting";
import UserOnCallLog from "./UserOnCallLog";
import UserOnCallLogTimeline from "./UserOnCallLogTimeline";
import UserSms from "./UserSMS";
// Workflows.
import Workflow from "./Workflow";
import WorkflowLog from "./WorkflowLog";
import WorkflowVariables from "./WorkflowVariable";
import ServiceCatalogDependency from "./ServiceCatalogDependency";
import ServiceCatalogMonitor from "./ServiceCatalogMonitor";
import ServiceCatalogTelemetryService from "./ServiceCatalogTelemetryService";

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

import TableView from "./TableView";
import Dashboard from "./Dashboard";

import MonitorTest from "./MonitorTest";
import ScheduledMaintenanceFeed from "./ScheduledMaintenanceFeed";

import WorkspaceUserAuthToken from "./WorkspaceUserAuthToken";
import WorkspaceProjectAuthToken from "./WorkspaceProjectAuthToken";
import WorkspaceSetting from "./WorkspaceSetting";
import WorkspaceNotificationRule from "./WorkspaceNotificationRule";

import OnCallDutyPolicyUserOverride from "./OnCallDutyPolicyUserOverride";
import MonitorFeed from "./MonitorFeed";
import MetricType from "./MetricType";
import ProjectSCIM from "./ProjectSCIM";

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
  TeamMember,
  TeamPermission,
  TeamComplianceSetting,
  ApiKey,
  Label,
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

  Monitor,
  MonitorSecret,
  MonitorStatus,
  MonitorCustomField,

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

  ProjectSSO,
  StatusPageSSO,
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
  PushNotificationLog,
  WorkspaceNotificationLog,
  CallLog,
  EmailLog,

  UserEmail,
  UserSms,
  UserCall,
  UserPush,
  UserWhatsApp,

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

  GlobalConfig,

  MonitorGroup,
  MonitorGroupOwnerTeam,
  MonitorGroupOwnerUser,
  MonitorGroupResource,

  TelemetryService,

  OnCallDutyPolicySchedule,
  OnCallDutyPolicyScheduleLayer,
  OnCallDutyPolicyScheduleLayerUser,
  OnCallDutyPolicyFeed,
  OnCallDutyPolicyOwnerTeam,
  OnCallDutyPolicyOwnerUser,
  OnCallDutyPolicyEscalationRuleSchedule,

  UsageBilling,

  ProjectCallSMSConfig,

  AcmeCertificate,

  AcmeChallenge,

  ServiceCatalog,
  ServiceCatalogOwnerTeam,
  ServiceCatalogOwnerUser,
  ServiceCatalogDependency,
  ServiceCatalogMonitor,
  ServiceCatalogTelemetryService,
  ServiceCatalogCodeRepository,

  // Code Repository
  CodeRepository,

  ProbeOwnerTeam,
  ProbeOwnerUser,

  AIAgent,
  AIAgentOwnerTeam,
  AIAgentOwnerUser,
  AIAgentTask,
  AIAgentTaskLog,
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

  MonitorTest,

  WorkspaceSetting,
  WorkspaceNotificationRule,

  MonitorFeed,

  MetricType,

  OnCallDutyPolicyTimeLog,

  ProjectSCIM,
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
