import { lazy } from 'react';

const Home: $TSFixMe = lazy((): $TSFixMe => import('./Home'));

const Monitor: $TSFixMe = lazy((): $TSFixMe => import('./Monitor'));
const IncidentLog: $TSFixMe = lazy((): $TSFixMe => import('./IncidentLog'));
const Incident: $TSFixMe = lazy((): $TSFixMe => import('./Incident'));
const IncidentSettings: $TSFixMe = lazy(
    (): $TSFixMe => import('./IncidentSettings')
);
const MonitorSettings: $TSFixMe = lazy(
    (): $TSFixMe => import('./MonitorSettings')
);

const StatusPage: $TSFixMe = lazy((): $TSFixMe => import('./StatusPage'));
const StatusPagesList: $TSFixMe = lazy(
    (): $TSFixMe => import('./StatusPage/list')
);

const OnCall: $TSFixMe = lazy((): $TSFixMe => import('./OnCall'));
const AlertLog: $TSFixMe = lazy((): $TSFixMe => import('./AlertLog'));
const Schedule: $TSFixMe = lazy((): $TSFixMe => import('./Schedule'));

const ScheduledEvent: $TSFixMe = lazy(
    (): $TSFixMe => import('./ScheduledEvent')
);
const ScheduledEventDetail: $TSFixMe = lazy(
    (): $TSFixMe => import('./ScheduledEventDetail')
);

const ChangePassword: $TSFixMe = lazy(
    (): $TSFixMe => import('./ChangePassword')
);

const TeamMembers: $TSFixMe = lazy((): $TSFixMe => import('./TeamMembers'));
const TeamMemberProfile: $TSFixMe = lazy(
    (): $TSFixMe => import('./TeamMemberProfile')
);
const Profile: $TSFixMe = lazy((): $TSFixMe => import('./Profile'));
const Settings: $TSFixMe = lazy((): $TSFixMe => import('./Settings'));

const Billing: $TSFixMe = lazy((): $TSFixMe => import('./Billing'));
const Resources: $TSFixMe = lazy((): $TSFixMe => import('./Resources'));
const Component: $TSFixMe = lazy((): $TSFixMe => import('./Component'));
const Integrations: $TSFixMe = lazy((): $TSFixMe => import('./Integrations'));

const EmailTemplates: $TSFixMe = lazy(
    (): $TSFixMe => import('./EmailTemplates')
);
const SmsTemplates: $TSFixMe = lazy((): $TSFixMe => import('./SmsTemplates'));

const MonitorView: $TSFixMe = lazy((): $TSFixMe => import('./MonitorView'));
const WebsiteMonitorIssues: $TSFixMe = lazy(
    (): $TSFixMe => import('./WebsiteMonitorIssues')
);
const Reports: $TSFixMe = lazy((): $TSFixMe => import('./Reports'));

const Probe: $TSFixMe = lazy((): $TSFixMe => import('./Probe'));
const ProfileBilling: $TSFixMe = lazy(
    (): $TSFixMe => import('./ProfileBilling')
);

const ApplicationLog: $TSFixMe = lazy(
    (): $TSFixMe => import('./ApplicationLog')
);
const ApplicationLogView: $TSFixMe = lazy(
    (): $TSFixMe => import('./ApplicationLogView')
);
const Container: $TSFixMe = lazy((): $TSFixMe => import('./Container'));
const Application: $TSFixMe = lazy((): $TSFixMe => import('./Application'));
const ApplicationDetail: $TSFixMe = lazy(
    (): $TSFixMe => import('./ApplicationDetail')
);
const ContainerDetail: $TSFixMe = lazy(
    (): $TSFixMe => import('./ContainerDetail')
);
const GitCredential: $TSFixMe = lazy((): $TSFixMe => import('./GitCredential'));
const DockerCredential: $TSFixMe = lazy(
    (): $TSFixMe => import('./DockerCredential')
);
const OneUptimeApi: $TSFixMe = lazy((): $TSFixMe => import('./OneUptimeApi'));
const ChangePasswordSetting: $TSFixMe = lazy(
    (): $TSFixMe => import('./ChangePasswordSetting')
);
const DeleteAccountPage: $TSFixMe = lazy(
    (): $TSFixMe => import('./DeleteAccountPage')
);
const Consulting: $TSFixMe = lazy((): $TSFixMe => import('./Consulting'));
const ErrorTracking: $TSFixMe = lazy((): $TSFixMe => import('./ErrorTracking'));
const Advanced: $TSFixMe = lazy((): $TSFixMe => import('./Advanced'));
const ComponentSettings: $TSFixMe = lazy(
    (): $TSFixMe => import('./ComponentSettings')
);
const ComponentSettingsAdvanced: $TSFixMe = lazy(
    () => import('./ComponentSettingsAdvanced')
);
const CallRouting: $TSFixMe = lazy((): $TSFixMe => import('./CallRouting'));
const DomainSettings: $TSFixMe = lazy(
    (): $TSFixMe => import('./DomainSettings')
);
const Groups: $TSFixMe = lazy((): $TSFixMe => import('./Group'));
const PerformanceTrackerView: $TSFixMe = lazy(
    (): $TSFixMe => import('./PerformanceTrackerView')
);
const PerformanceTracker: $TSFixMe = lazy(
    (): $TSFixMe => import('./PerformanceTracker')
);
const AutomationScript: $TSFixMe = lazy(
    (): $TSFixMe => import('./AutomationScript')
);
const SsoPage: $TSFixMe = lazy((): $TSFixMe => import('./Sso'));

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
