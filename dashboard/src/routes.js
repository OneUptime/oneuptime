import pages from './pages';
import { IS_SAAS_SERVICE } from './config';

const {
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
    Billing,
    Monitors,
    Schedule,
    Integrations,
    EmailTemplates,
    SmsTemplates,
    Reports,
    MonitorView,
    Probe,
    ProfileBilling,
} = pages;

export const groups = [
    {
        group: 'VisibleOnComponentDetail',
        visible: true,
        visibleOnComponentDetail: true,
        routes: [
            {
                title: '',
                path: '/project/:projectId/components',
                component: Component,
                visible: true,
                disabled: true,
                exact: true,
                subRoutes: [],
                index: 1,
            },
            {
                title: 'Monitors',
                path: '/project/:projectId/:componentId/monitoring',
                icon: 'atlas',
                component: Monitor,
                exact: true,
                visible: true,
                subRoutes: [
                    {
                        title: 'Monitor View',
                        path:
                            '/project/:projectId/:componentId/monitoring/:monitorId',
                        icon: 'radar',
                        visible: true,
                        subRoutes: [],
                        component: MonitorView,
                        index: 1,
                    },
                ],
                index: 2,
            },
            {
                title: 'Incident Log',
                path: '/project/:projectId/:componentId/incident-log',
                icon: 'info',
                visible: true,
                component: IncidentLog,
                subRoutes: [
                    {
                        title: 'Incident',
                        path:
                            '/project/:projectId/:componentId/incidents/:incidentId',
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
                title: 'Back to Dashboard',
                path: '/project/:projectId/components',
                icon: 'back',
                component: Monitor,
                visible: true,
                subRoutes: [],
                index: 4,
            },
        ],
    },
    {
        group: 'Products',
        visible: true,
        routes: [
            {
                title: 'Components',
                path: '/project/:projectId/components',
                icon: 'square',
                component: Component,
                visible: true,
                exact: true,
                subRoutes: [],
                index: 1,
            },
            {
                title: 'Status Pages',
                path: '/project/:projectId/status-pages',
                icon: 'radar',
                visible: true,
                subRoutes: [
                    {
                        title: 'Status Page',
                        path:
                            '/project/:projectId/sub-project/:subProjectId/status-page/:scheduleId',
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
                title: 'Call Schedules',
                path: '/project/:projectId/on-call',
                icon: 'connect',
                visible: true,
                subRoutes: [
                    {
                        title: 'Alert Log',
                        path: '/project/:projectId/alert-log',
                        icon: 'radar',
                        visible: true,
                        subRoutes: [],
                        component: AlertLog,
                        index: 1,
                    },
                    {
                        title: 'Schedule',
                        path:
                            '/project/:projectId/sub-project/:subProjectId/schedule/:scheduleId',
                        icon: 'radar',
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
                title: 'Reports',
                path: '/project/:projectId/reports',
                icon: 'report',
                visible: true,
                subRoutes: [],
                component: Reports,
                index: 5,
            },
        ],
    },
    {
        group: 'Settings',
        visible: true,
        routes: [
            {
                title: 'Team Members',
                path: '/project/:projectId/team',
                icon: 'customers',
                visible: true,
                component: TeamMembers,
                subRoutes: [],
                index: 1,
            },
            {
                title: 'Project Settings',
                path: '/project/:projectId/settings',
                icon: 'businessSettings',
                exact: true,
                visible: true,
                subRoutes: [
                    {
                        title: 'Billing',
                        path: '/project/:projectId/settings/billing',
                        icon: 'radar',
                        visible: IS_SAAS_SERVICE,
                        subRoutes: [],
                        component: Billing,
                        index: 1,
                    },
                    {
                        title: 'Monitors',
                        path: '/project/:projectId/settings/monitors',
                        icon: 'atlas',
                        visible: true,
                        subRoutes: [],
                        component: Monitors,
                        index: 2,
                    },
                    {
                        title: 'Integrations',
                        path: '/project/:projectId/settings/integrations',
                        icon: 'radar',
                        visible: true,
                        subRoutes: [],
                        component: Integrations,
                        index: 3,
                    },
                    {
                        title: 'Email',
                        path: '/project/:projectId/settings/emails',
                        icon: 'radar',
                        visible: true,
                        subRoutes: [],
                        component: EmailTemplates,
                        index: 4,
                    },
                    {
                        title: 'SMS',
                        path: '/project/:projectId/settings/sms',
                        icon: 'radar',
                        visible: true,
                        subRoutes: [],
                        component: SmsTemplates,
                        index: 5,
                    },
                    {
                        title: 'Probe',
                        path: '/project/:projectId/settings/probe',
                        icon: 'radar',
                        visible: true,
                        subRoutes: [],
                        component: Probe,
                        index: 6,
                    },
                ],
                component: Settings,
                index: 2,
            },
        ],
    },
    {
        group: 'Profile',
        routes: [
            {
                title: 'Billing',
                path: '/profile/billing',
                icon: 'customers',
                visible: IS_SAAS_SERVICE,
                component: ProfileBilling,
                subRoutes: [],
                index: 1,
            },
            {
                title: 'Profile Settings',
                path: '/profile/settings',
                icon: 'customers',
                visible: true,
                component: Profile,
                subRoutes: [],
                index: 2,
            },
            {
                title: 'Team Member Profile',
                path: '/profile/:memberId',
                icon: 'customers',
                visible: true,
                component: TeamMemberProfile,
                subRoutes: [],
                index: 3,
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
        const subRoutes = routes.map(route => route.subRoutes).reduce(joinFn);
        return routes.concat(subRoutes);
    })
    .reduce(joinFn);

export const getGroups = () => groups;

export default {
    groups,
    allRoutes,
};
