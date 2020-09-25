import pages from './pages';
import { IS_SAAS_SERVICE } from './config';

const {
    Home,
    Settings,
    TeamMembers,
    TeamMemberProfile,
    StatusPage,
    StatusPages,
    Profile,
    OnCall,
    Monitor,
    Component,
    AlertLog,
    IncidentLog,
    Incident,
    IncidentSettings,
    Billing,
    Monitors,
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
    FyipeApi,
    ChangePasswordSetting,
    DeleteAccountPage,
    ScheduledEvent,
    ScheduledEventDetail,
    Consulting,
    Advanced,
} = pages;

export const groups = [
    {
        group: 'VisibleOnComponentDetail',
        visible: true,
        visibleOnComponentDetail: true,
        routes: [
            {
                title: 'Monitors',
                path: '/dashboard/project/:projectId/:componentId/monitoring',
                icon: 'monitor',
                component: Monitor,
                exact: true,
                visible: true,
                shortcut: 'c+m',
                subRoutes: [
                    {
                        title: 'Monitor View',
                        path:
                            '/dashboard/project/:projectId/:componentId/monitoring/:monitorId',
                        icon: 'monitor',
                        visible: true,
                        subRoutes: [],
                        component: MonitorView,
                        exact: true,
                        index: 1,
                    },
                    {
                        title: 'Website Issues',
                        path:
                            '/dashboard/project/:projectId/:componentId/monitoring/:monitorId/issues/:issueId',
                        icon: 'info',
                        visible: true,
                        subRoutes: [],
                        component: WebsiteMonitorIssues,
                        index: 2,
                    },
                ],
                index: 2,
            },
            {
                title: 'Incident Log',
                path: '/dashboard/project/:projectId/:componentId/incident-log',
                icon: 'info',
                visible: true,
                component: IncidentLog,
                shortcut: 'c+i',
                subRoutes: [
                    {
                        title: 'Incident',
                        path:
                            '/dashboard/project/:projectId/:componentId/incidents/:incidentId',
                        icon: 'info',
                        visible: true,
                        subRoutes: [],
                        component: Incident,
                        index: 1,
                    },
                ],
                index: 3,
            },
            {
                title: 'Logs',
                path:
                    '/dashboard/project/:projectId/:componentId/application-log',
                icon: 'appLog',
                visible: true,
                exact: true,
                component: ApplicationLog,
                index: 4,
                shortcut: 'c+l',
                subRoutes: [
                    {
                        title: 'Log Container View',
                        path:
                            '/dashboard/project/:projectId/:componentId/application-logs/:applicationLogId',
                        icon: 'radar',
                        visible: true,
                        subRoutes: [],
                        component: ApplicationLogView,
                        index: 1,
                    },
                ],
            },
            {
                title: 'Security',
                path:
                    '/dashboard/project/:projectId/:componentId/security/container',
                icon: 'security',
                visible: true,
                component: Container,
                exact: true,
                shortcut: 'c+s',
                subRoutes: [
                    {
                        title: 'Container',
                        path:
                            '/dashboard/project/:projectId/:componentId/security/container',
                        icon: 'security',
                        visible: true,
                        subRoute: [],
                        component: Container,
                        index: 1,
                        exact: true,
                        shortcut: 'c+s',
                    },
                    {
                        title: 'Container Detail',
                        path:
                            '/dashboard/project/:projectId/:componentId/security/container/:containerSecurityId',
                        icon: 'docker',
                        visible: true,
                        subRoute: [],
                        index: 2,
                        component: ContainerDetail,
                        exact: true,
                    },
                    {
                        title: 'Application',
                        path:
                            '/dashboard/project/:projectId/:componentId/security/application',
                        icon: 'security',
                        visible: true,
                        component: Application,
                        index: 3,
                        subRoute: [],
                        exact: true,
                        shortcut: 'c+a',
                    },
                    {
                        title: 'Application Detail',
                        path:
                            '/dashboard/project/:projectId/:componentId/security/application/:applicationSecurityId',
                        icon: 'info',
                        visible: true,
                        component: ApplicationDetail,
                        index: 4,
                        subRoute: [],
                        exact: true,
                    },
                ],
                index: 5,
            },
            {
                title: 'Back to Dashboard',
                path: '/dashboard/project/:projectId/components',
                icon: 'back',
                component: Component,
                visible: true,
                subRoutes: [],
                index: 6,
                shortcut: 'c+d',
            },
        ],
    },
    {
        group: 'Products',
        visible: true,
        routes: [
            {
                title: 'Home',
                path: '/dashboard/project/:projectId',
                icon: 'home',
                exact: true,
                visible: true,
                component: Home,
                subRoutes: [],
                index: 1,
                shortcut: 'f+h',
            },
            {
                title: 'Components',
                path: '/dashboard/project/:projectId/components',
                icon: 'square',
                component: Component,
                visible: true,
                exact: true,
                subRoutes: [],
                index: 2,
                shortcut: 'f+c',
            },
            {
                title: 'Incidents',
                path: '/dashboard/project/:projectId/incidents',
                icon: 'info',
                visible: true,
                subRoutes: [],
                component: IncidentLog,
                index: 6,
                shortcut: 'f+l',
            },
            {
                title: 'Status Pages',
                path: '/dashboard/project/:projectId/status-pages',
                icon: 'radar',
                visible: true,
                shortcut: 'f+u',
                subRoutes: [
                    {
                        title: 'Status Page',
                        path:
                            '/dashboard/project/:projectId/sub-project/:subProjectId/status-page/:scheduleId',
                        icon: 'radar',
                        visible: true,
                        subRoutes: [],
                        component: StatusPage,
                        index: 1,
                    },
                ],
                component: StatusPages,
                index: 3,
            },
            {
                title: 'On-Call Schedules',
                path: '/dashboard/project/:projectId/on-call',
                icon: 'call',
                visible: true,
                shortcut: 'f+o',
                subRoutes: [
                    {
                        title: 'Alert Log',
                        path: '/dashboard/project/:projectId/alert-log',
                        icon: 'info',
                        visible: true,
                        subRoutes: [],
                        component: AlertLog,
                        index: 1,
                        shortcut: 'f+a',
                    },
                    {
                        title: 'Schedule',
                        path:
                            '/dashboard/project/:projectId/sub-project/:subProjectId/schedule/:scheduleId',
                        icon: 'call',
                        visible: true,
                        subRoutes: [],
                        component: Schedule,
                        index: 1,
                    },
                ],
                component: OnCall,
                index: 4,
            },
            {
                title: 'Scheduled Events',
                path: '/dashboard/project/:projectId/scheduledEvents',
                icon: 'connect',
                visible: true,
                component: ScheduledEvent,
                exact: true,
                subRoutes: [
                    {
                        title: 'Scheduled Event Detail',
                        path:
                            '/dashboard/project/:projectId/scheduledEvents/:scheduledEventId',
                        icon: 'connect',
                        visible: true,
                        component: ScheduledEventDetail,
                        subRoutes: [],
                        index: 1,
                    },
                ],
                index: 5,
                shortcut: 'f+v',
            },
            {
                title: 'Reports',
                path: '/dashboard/project/:projectId/reports',
                icon: 'report',
                visible: true,
                subRoutes: [],
                component: Reports,
                index: 5,
                shortcut: 'f+r',
            },
        ],
    },
    {
        group: 'Settings',
        visible: true,
        routes: [
            {
                title: 'Team Members',
                path: '/dashboard/project/:projectId/team',
                icon: 'customers',
                visible: true,
                component: TeamMembers,
                subRoutes: [],
                index: 1,
                shortcut: 'f+t',
            },
            {
                title: 'Project Settings',
                path: '/dashboard/project/:projectId/settings',
                icon: 'businessSettings',
                exact: true,
                visible: true,
                shortcut: 'f+p',
                subRoutes: [
                    {
                        title: 'Billing',
                        path: '/dashboard/project/:projectId/settings/billing',
                        icon: 'radar',
                        visible: IS_SAAS_SERVICE,
                        subRoutes: [],
                        component: Billing,
                        index: 1,
                        shortcut: 'f+b',
                    },
                    {
                        title: 'Monitors',
                        path: '/dashboard/project/:projectId/settings/monitors',
                        icon: 'monitor',
                        visible: true,
                        subRoutes: [],
                        component: Monitors,
                        index: 2,
                        shortcut: 'f+m',
                    },
                    {
                        title: 'Incident Settings',
                        path:
                            '/dashboard/project/:projectId/settings/incidents',
                        icon: 'incidentSettings',
                        visible: true,
                        subRoutes: [],
                        component: IncidentSettings,
                        index: 3,
                    },
                    {
                        title: 'Integrations',
                        path:
                            '/dashboard/project/:projectId/settings/integrations',
                        icon: 'integration',
                        visible: true,
                        subRoutes: [],
                        component: Integrations,
                        index: 4,
                        shortcut: 'f+i',
                    },
                    {
                        title: 'Email',
                        path: '/dashboard/project/:projectId/settings/emails',
                        icon: 'email',
                        visible: true,
                        subRoutes: [],
                        component: EmailTemplates,
                        index: 5,
                        shortcut: 'f+e',
                    },
                    {
                        title: 'SMS & Calls',
                        path: '/dashboard/project/:projectId/settings/sms',
                        icon: 'sms',
                        visible: true,
                        subRoutes: [],
                        component: SmsTemplates,
                        index: 6,
                        shortcut: 'f+s',
                    },
                    {
                        title: 'Probe',
                        path: '/dashboard/project/:projectId/settings/probe',
                        icon: 'probes',
                        visible: true,
                        subRoutes: [],
                        component: Probe,
                        index: 7,
                        shortcut: 'f+x',
                    },
                    {
                        title: 'Git Credentials',
                        path:
                            '/dashboard/project/:projectId/settings/gitCredential',
                        icon: 'git',
                        visible: true,
                        subRoutes: [],
                        component: GitCredential,
                        index: 8,
                        shortcut: 'f+g',
                    },
                    {
                        title: 'Docker Credentials',
                        path:
                            '/dashboard/project/:projectId/settings/dockerCredential',
                        icon: 'docker',
                        visible: true,
                        subRoutes: [],
                        component: DockerCredential,
                        index: 9,
                        shortcut: 'f+d',
                    },
                    {
                        title: 'API',
                        path: '/dashboard/project/:projectId/settings/api',
                        icon: 'apis',
                        visible: true,
                        subRoutes: [],
                        component: FyipeApi,
                        index: 10,
                        shortcut: 'f+w',
                    },
                    {
                        title: 'Advanced',
                        path: '/dashboard/project/:projectId/settings/advanced',
                        icon: 'businessSettings',
                        visible: true,
                        subRoutes: [],
                        component: Advanced,
                        index: 11,
                        shortcut: 'f+n',
                    },
                ],
                component: Settings,
                index: 2,
            },
        ],
    },
    {
        group: 'VisibleOnProfile',
        visible: true,
        visibleOnProfile: true,
        routes: [
            {
                title: 'Profile Settings',
                path: '/dashboard/profile/settings',
                icon: 'user',
                visible: true,
                component: Profile,
                subRoutes: [],
                index: 1,
                shortcut: 'p+s',
            },
            {
                title: 'Change Password',
                path: '/dashboard/profile/changePassword',
                icon: 'password',
                visible: true,
                component: ChangePasswordSetting,
                subRoutes: [],
                index: 2,
                shortcut: 'p+c',
            },
            {
                title: 'Billing',
                path: '/dashboard/profile/billing',
                icon: 'receipt',
                visible: IS_SAAS_SERVICE,
                component: ProfileBilling,
                subRoutes: [],
                index: 3,
                shortcut: 'p+b',
            },
            {
                title: 'Advanced',
                path: '/dashboard/profile/advanced',
                icon: 'businessSettings',
                visible: true,
                component: DeleteAccountPage,
                subRoutes: [],
                index: 4,
                shortcut: 'p+a',
            },
            {
                title: 'Team Member Profile',
                path: '/dashboard/profile/:memberId',
                icon: 'user',
                visible: true,
                component: TeamMemberProfile,
                subRoutes: [],
                index: 5,
            },
            {
                title: 'Back to Dashboard',
                path: '/dashboard/project/:projectId/components',
                icon: 'back',
                component: Component,
                visible: true,
                subRoutes: [],
                index: 6,
                shortcut: 'p+d',
            },
        ],
    },
    {
        group: 'services',
        visible: true,
        routes: [
            {
                title: 'Consulting & Services',
                path: '/dashboard/project/:projectId/consulting',
                icon: 'consulting',
                visible: true,
                component: Consulting,
                subRoutes: [],
                index: 1,
                shortcut: 'f+z',
            },
        ],
    },
];

const joinFn = (acc = [], curr) => {
    return acc.concat(curr);
};

export const allRoutes = groups
    .map(function merge(group) {
        const { routes } = group;
        const newRoutes = [];
        for (const route of routes) {
            newRoutes.push(route);
        }
        const subRoutes = newRoutes
            .map(route => {
                const newSubRoutes = [];
                for (const subRoute of route.subRoutes) {
                    newSubRoutes.push(subRoute);
                }
                return newSubRoutes;
            })
            .reduce(joinFn);
        return newRoutes.concat(subRoutes);
    })
    .reduce(joinFn);

export const getGroups = () => groups;

export default {
    groups,
    allRoutes,
};
