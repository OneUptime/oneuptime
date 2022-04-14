import { lazy } from 'react';

const Home = lazy((): $TSFixMe => import('./Home'));

const Monitor = lazy((): $TSFixMe => import('./Monitor'));
const IncidentLog = lazy((): $TSFixMe => import('./IncidentLog'));
const Incident = lazy((): $TSFixMe => import('./Incident'));
const IncidentSettings = lazy((): $TSFixMe => import('./IncidentSettings'));
const MonitorSettings = lazy((): $TSFixMe => import('./MonitorSettings'));

const StatusPage = lazy((): $TSFixMe => import('./StatusPage'));
const StatusPagesList = lazy((): $TSFixMe => import('./StatusPage/list'));

const OnCall = lazy((): $TSFixMe => import('./OnCall'));
const AlertLog = lazy((): $TSFixMe => import('./AlertLog'));
const Schedule = lazy((): $TSFixMe => import('./Schedule'));

const ScheduledEvent = lazy((): $TSFixMe => import('./ScheduledEvent'));
const ScheduledEventDetail = lazy(
    (): $TSFixMe => import('./ScheduledEventDetail')
);

const ChangePassword = lazy((): $TSFixMe => import('./ChangePassword'));

const TeamMembers = lazy((): $TSFixMe => import('./TeamMembers'));
const TeamMemberProfile = lazy((): $TSFixMe => import('./TeamMemberProfile'));
const Profile = lazy((): $TSFixMe => import('./Profile'));
const Settings = lazy((): $TSFixMe => import('./Settings'));

const Billing = lazy((): $TSFixMe => import('./Billing'));
const Resources = lazy((): $TSFixMe => import('./Resources'));
const Component = lazy((): $TSFixMe => import('./Component'));
const Integrations = lazy((): $TSFixMe => import('./Integrations'));

const EmailTemplates = lazy((): $TSFixMe => import('./EmailTemplates'));
const SmsTemplates = lazy((): $TSFixMe => import('./SmsTemplates'));

const MonitorView = lazy((): $TSFixMe => import('./MonitorView'));
const WebsiteMonitorIssues = lazy(
    (): $TSFixMe => import('./WebsiteMonitorIssues')
);
const Reports = lazy((): $TSFixMe => import('./Reports'));

const Probe = lazy((): $TSFixMe => import('./Probe'));
const ProfileBilling = lazy((): $TSFixMe => import('./ProfileBilling'));

const ApplicationLog = lazy((): $TSFixMe => import('./ApplicationLog'));
const ApplicationLogView = lazy((): $TSFixMe => import('./ApplicationLogView'));
const Container = lazy((): $TSFixMe => import('./Container'));
const Application = lazy((): $TSFixMe => import('./Application'));
const ApplicationDetail = lazy((): $TSFixMe => import('./ApplicationDetail'));
const ContainerDetail = lazy((): $TSFixMe => import('./ContainerDetail'));
const GitCredential = lazy((): $TSFixMe => import('./GitCredential'));
const DockerCredential = lazy((): $TSFixMe => import('./DockerCredential'));
const OneUptimeApi = lazy((): $TSFixMe => import('./OneUptimeApi'));
const ChangePasswordSetting = lazy(
    (): $TSFixMe => import('./ChangePasswordSetting')
);
const DeleteAccountPage = lazy((): $TSFixMe => import('./DeleteAccountPage'));
const Consulting = lazy((): $TSFixMe => import('./Consulting'));
const ErrorTracking = lazy((): $TSFixMe => import('./ErrorTracking'));
const Advanced = lazy((): $TSFixMe => import('./Advanced'));
const ComponentSettings = lazy((): $TSFixMe => import('./ComponentSettings'));
const ComponentSettingsAdvanced: $TSFixMe = lazy(
    () => import('./ComponentSettingsAdvanced')
);
const CallRouting = lazy((): $TSFixMe => import('./CallRouting'));
const DomainSettings = lazy((): $TSFixMe => import('./DomainSettings'));
const Groups = lazy((): $TSFixMe => import('./Group'));
const PerformanceTrackerView = lazy(
    (): $TSFixMe => import('./PerformanceTrackerView')
);
const PerformanceTracker = lazy((): $TSFixMe => import('./PerformanceTracker'));
const AutomationScript = lazy((): $TSFixMe => import('./AutomationScript'));
const SsoPage = lazy((): $TSFixMe => import('./Sso'));

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
