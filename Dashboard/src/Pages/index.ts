import { lazy } from 'react';

const Home: $TSFixMe = lazy((): $TSFixMe => {
    return import('./Home');
});

const Monitor: $TSFixMe = lazy((): $TSFixMe => {
    return import('./Monitor');
});
const IncidentLog: $TSFixMe = lazy((): $TSFixMe => {
    return import('./IncidentLog');
});
const Incident: $TSFixMe = lazy((): $TSFixMe => {
    return import('./Incident');
});
const IncidentSettings: $TSFixMe = lazy((): $TSFixMe => {
    return import('./IncidentSettings');
});
const MonitorSettings: $TSFixMe = lazy((): $TSFixMe => {
    return import('./MonitorSettings');
});

const StatusPage: $TSFixMe = lazy((): $TSFixMe => {
    return import('./StatusPage');
});
const StatusPagesList: $TSFixMe = lazy((): $TSFixMe => {
    return import('./StatusPage/list');
});

const OnCall: $TSFixMe = lazy((): $TSFixMe => {
    return import('./OnCall');
});
const AlertLog: $TSFixMe = lazy((): $TSFixMe => {
    return import('./AlertLog');
});
const Schedule: $TSFixMe = lazy((): $TSFixMe => {
    return import('./Schedule');
});

const ScheduledEvent: $TSFixMe = lazy((): $TSFixMe => {
    return import('./ScheduledEvent');
});
const ScheduledEventDetail: $TSFixMe = lazy((): $TSFixMe => {
    return import('./ScheduledEventDetail');
});

const ChangePassword: $TSFixMe = lazy((): $TSFixMe => {
    return import('./ChangePassword');
});

const TeamMembers: $TSFixMe = lazy((): $TSFixMe => {
    return import('./TeamMembers');
});
const TeamMemberProfile: $TSFixMe = lazy((): $TSFixMe => {
    return import('./TeamMemberProfile');
});
const Profile: $TSFixMe = lazy((): $TSFixMe => {
    return import('./Profile');
});
const Settings: $TSFixMe = lazy((): $TSFixMe => {
    return import('./Settings');
});

const Billing: $TSFixMe = lazy((): $TSFixMe => {
    return import('./Billing');
});
const Resources: $TSFixMe = lazy((): $TSFixMe => {
    return import('./Resources');
});
const Component: $TSFixMe = lazy((): $TSFixMe => {
    return import('./Component');
});
const Integrations: $TSFixMe = lazy((): $TSFixMe => {
    return import('./Integrations');
});

const EmailTemplates: $TSFixMe = lazy((): $TSFixMe => {
    return import('./EmailTemplates');
});
const SmsTemplates: $TSFixMe = lazy((): $TSFixMe => {
    return import('./SmsTemplates');
});

const MonitorView: $TSFixMe = lazy((): $TSFixMe => {
    return import('./MonitorView');
});
const WebsiteMonitorIssues: $TSFixMe = lazy((): $TSFixMe => {
    return import('./WebsiteMonitorIssues');
});
const Reports: $TSFixMe = lazy((): $TSFixMe => {
    return import('./Reports');
});

const Probe: $TSFixMe = lazy((): $TSFixMe => {
    return import('./Probe');
});
const ProfileBilling: $TSFixMe = lazy((): $TSFixMe => {
    return import('./ProfileBilling');
});

const ApplicationLog: $TSFixMe = lazy((): $TSFixMe => {
    return import('./ApplicationLog');
});
const ApplicationLogView: $TSFixMe = lazy((): $TSFixMe => {
    return import('./ApplicationLogView');
});
const Container: $TSFixMe = lazy((): $TSFixMe => {
    return import('./Container');
});
const Application: $TSFixMe = lazy((): $TSFixMe => {
    return import('./Application');
});
const ApplicationDetail: $TSFixMe = lazy((): $TSFixMe => {
    return import('./ApplicationDetail');
});
const ContainerDetail: $TSFixMe = lazy((): $TSFixMe => {
    return import('./ContainerDetail');
});
const GitCredential: $TSFixMe = lazy((): $TSFixMe => {
    return import('./GitCredential');
});
const DockerCredential: $TSFixMe = lazy((): $TSFixMe => {
    return import('./DockerCredential');
});
const OneUptimeApi: $TSFixMe = lazy((): $TSFixMe => {
    return import('./OneUptimeApi');
});
const ChangePasswordSetting: $TSFixMe = lazy((): $TSFixMe => {
    return import('./ChangePasswordSetting');
});
const DeleteAccountPage: $TSFixMe = lazy((): $TSFixMe => {
    return import('./DeleteAccountPage');
});
const Consulting: $TSFixMe = lazy((): $TSFixMe => {
    return import('./Consulting');
});
const ErrorTracking: $TSFixMe = lazy((): $TSFixMe => {
    return import('./ErrorTracking');
});
const Advanced: $TSFixMe = lazy((): $TSFixMe => {
    return import('./Advanced');
});
const ComponentSettings: $TSFixMe = lazy((): $TSFixMe => {
    return import('./ComponentSettings');
});
const ComponentSettingsAdvanced: $TSFixMe = lazy(() => {
    return import('./ComponentSettingsAdvanced');
});
const CallRouting: $TSFixMe = lazy((): $TSFixMe => {
    return import('./CallRouting');
});
const DomainSettings: $TSFixMe = lazy((): $TSFixMe => {
    return import('./DomainSettings');
});
const Groups: $TSFixMe = lazy((): $TSFixMe => {
    return import('./Group');
});
const PerformanceTrackerView: $TSFixMe = lazy((): $TSFixMe => {
    return import('./PerformanceTrackerView');
});
const PerformanceTracker: $TSFixMe = lazy((): $TSFixMe => {
    return import('./PerformanceTracker');
});
const AutomationScript: $TSFixMe = lazy((): $TSFixMe => {
    return import('./AutomationScript');
});
const SsoPage: $TSFixMe = lazy((): $TSFixMe => {
    return import('./Sso');
});

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
