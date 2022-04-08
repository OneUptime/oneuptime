import { lazy } from 'react';

const Home = lazy(() => import('./Home'));

const Monitor = lazy(() => import('./Monitor'));
const IncidentLog = lazy(() => import('./IncidentLog'));
const Incident = lazy(() => import('./Incident'));
const IncidentSettings = lazy(() => import('./IncidentSettings'));
const MonitorSettings = lazy(() => import('./MonitorSettings'));

const StatusPage = lazy(() => import('./StatusPage'));
const StatusPagesList = lazy(() => import('./status-page/list'));

const OnCall = lazy(() => import('./OnCall'));
const AlertLog = lazy(() => import('./AlertLog'));
const Schedule = lazy(() => import('./Schedule'));

const ScheduledEvent = lazy(() => import('./ScheduledEvent'));
const ScheduledEventDetail = lazy(() => import('./ScheduledEventDetail'));

const ChangePassword = lazy(() => import('./ChangePassword'));

const TeamMembers = lazy(() => import('./TeamMembers'));
const TeamMemberProfile = lazy(() => import('./TeamMemberProfile'));
const Profile = lazy(() => import('./Profile'));
const Settings = lazy(() => import('./Settings'));

const Billing = lazy(() => import('./Billing'));
const Resources = lazy(() => import('./Resources'));
const Component = lazy(() => import('./Component'));
const Integrations = lazy(() => import('./Integrations'));

const EmailTemplates = lazy(() => import('./EmailTemplates'));
const SmsTemplates = lazy(() => import('./SmsTemplates'));

const MonitorView = lazy(() => import('./MonitorView'));
const WebsiteMonitorIssues = lazy(() => import('./WebsiteMonitorIssues'));
const Reports = lazy(() => import('./Reports'));

const Probe = lazy(() => import('./Probe'));
const ProfileBilling = lazy(() => import('./ProfileBilling'));

const ApplicationLog = lazy(() => import('./ApplicationLog'));
const ApplicationLogView = lazy(() => import('./ApplicationLogView'));
const Container = lazy(() => import('./Container'));
const Application = lazy(() => import('./Application'));
const ApplicationDetail = lazy(() => import('./ApplicationDetail'));
const ContainerDetail = lazy(() => import('./ContainerDetail'));
const GitCredential = lazy(() => import('./GitCredential'));
const DockerCredential = lazy(() => import('./DockerCredential'));
const OneUptimeApi = lazy(() => import('./OneUptimeApi'));
const ChangePasswordSetting = lazy(() => import('./ChangePasswordSetting'));
const DeleteAccountPage = lazy(() => import('./DeleteAccountPage'));
const Consulting = lazy(() => import('./Consulting'));
const ErrorTracking = lazy(() => import('./ErrorTracking'));
const Advanced = lazy(() => import('./Advanced'));
const ComponentSettings = lazy(() => import('./ComponentSettings'));
const ComponentSettingsAdvanced = lazy(
    () => import('./ComponentSettingsAdvanced')
);
const CallRouting = lazy(() => import('./CallRouting'));
const DomainSettings = lazy(() => import('./DomainSettings'));
const Groups = lazy(() => import('./Group'));
const PerformanceTrackerView = lazy(() => import('./PerformanceTrackerView'));
const PerformanceTracker = lazy(() => import('./PerformanceTracker'));
const AutomationScript = lazy(() => import('./AutomationScript'));
const SsoPage = lazy(() => import('./Sso'));

export default {
    ChangePassword,
    Home,
    Monitor,
    Component,
    Settings,
    OnCall,
    TeamMembers,
    TeamMemberProfile,
    StatusPage,
    StatusPagesList,
    Profile,
    AlertLog,
    IncidentLog,
    Incident,
    IncidentSettings,
    Billing,
    Resources,
    Schedule,
    Integrations,
    EmailTemplates,
    SmsTemplates,
    Reports,
    MonitorView,
    WebsiteMonitorIssues,
    Probe,
    ProfileBilling,
    ApplicationLog,
    ApplicationLogView,
    Container,
    Application,
    ApplicationDetail,
    ContainerDetail,
    GitCredential,
    DockerCredential,
    OneUptimeApi,
    ChangePasswordSetting,
    DeleteAccountPage,
    ScheduledEvent,
    ScheduledEventDetail,
    Consulting,
    ErrorTracking,
    Advanced,
    ComponentSettings,
    ComponentSettingsAdvanced,
    MonitorSettings,
    CallRouting,
    DomainSettings,
    Groups,
    PerformanceTrackerView,
    PerformanceTracker,
    AutomationScript,
    SsoPage,
};
