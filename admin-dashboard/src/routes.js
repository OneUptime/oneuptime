import pages from './pages';
import { IS_SAAS_SERVICE } from './config';

const {
    Users,
    User,
    Projects,
    Project,
    Probes,
    AuditLogs,
    Settings,
    License,
} = pages;

export const groups = [
    {
        group: 'Products',
        visible: true,
        routes: [
            {
                title: 'Users',
                path: '/users',
                icon: 'customers',
                component: Users,
                visible: true,
                subRoutes: [
                    {
                        title: 'User',
                        path: '/users/:userId',
                        icon: 'customers',
                        component: User,
                        visible: true,
                        subRoutes: [],
                        index: 1,
                    },
                ],
                index: 1,
            },
            {
                title: 'Projects',
                path: '/projects',
                icon: 'projects',
                component: Projects,
                visible: true,
                subRoutes: [
                    {
                        title: 'Project',
                        path: '/projects/:projectId',
                        icon: 'projects',
                        component: Project,
                        visible: true,
                        subRoutes: [],
                        index: 1,
                    },
                ],
                index: 2,
            },
            {
                title: 'Probes',
                path: '/probes',
                icon: 'probes',
                component: Probes,
                visible: true,
                subRoutes: [],
                index: 3,
            },
            {
                title: 'Audit Logs',
                path: '/auditLogs',
                icon: 'auditLogs',
                component: AuditLogs,
                visible: true,
                subRoutes: [],
                index: 4,
            },
        ],
    },
    {
        group: 'Settings',
        visible: !IS_SAAS_SERVICE,
        routes: [
            {
                title: 'Settings',
                path: '/settings/license',
                icon: 'businessSettings',
                component: License,
                exact: true,
                visible: true,
                subRoutes: [
                    {
                        title: 'License',
                        path: '/settings/license',
                        icon: 'activate',
                        component: License,
                        visible: true,
                        subRoutes: [],
                        index: 1,
                    },
                    {
                        title: 'SMTP',
                        path: '/settings/smtp',
                        icon: 'settings',
                        component: Settings,
                        visible: true,
                        subRoutes: [],
                        index: 2,
                    },
                    {
                        title: 'Twilio',
                        path: '/settings/twilio',
                        icon: 'settings',
                        component: Settings,
                        visible: true,
                        subRoutes: [],
                        index: 3,
                    },
                ],
                index: 1,
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
