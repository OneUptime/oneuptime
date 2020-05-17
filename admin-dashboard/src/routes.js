import pages from './pages';
import { IS_SAAS_SERVICE, IS_THIRD_PARTY_BILLING } from './config';

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
                path: '/admin/users',
                icon: 'customers',
                component: Users,
                visible: true,
                subRoutes: [
                    {
                        title: 'User',
                        path: '/admin/users/:userId',
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
                path: '/admin/projects',
                icon: 'projects',
                component: Projects,
                visible: true,
                subRoutes: [
                    {
                        title: 'Project',
                        path: '/admin/projects/:projectId',
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
                path: '/admin/probes',
                icon: 'probes',
                component: Probes,
                visible: true,
                subRoutes: [],
                index: 3,
            },
            {
                title: 'Audit Logs',
                path: '/admin/auditLogs',
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
        visible: true,
        routes: [
            {
                title: 'Settings',
                path:
                    !IS_THIRD_PARTY_BILLING && !IS_SAAS_SERVICE
                        ? '/admin/settings/license'
                        : '/admin/settings/smtp',
                icon: 'businessSettings',
                component:
                    !IS_THIRD_PARTY_BILLING && !IS_SAAS_SERVICE
                        ? License
                        : Settings,
                exact: true,
                visible: true,
                subRoutes: [
                    {
                        title: 'License',
                        path: '/admin/settings/license',
                        icon: 'activate',
                        component: License,
                        visible: !IS_THIRD_PARTY_BILLING && !IS_SAAS_SERVICE,
                        subRoutes: [],
                        index: 1,
                    },
                    {
                        title: 'SMTP',
                        path: '/admin/settings/smtp',
                        icon: 'settings',
                        component: Settings,
                        visible: true,
                        subRoutes: [],
                        index: 2,
                    },
                    {
                        title: 'Twilio',
                        path: '/admin/settings/twilio',
                        icon: 'settings',
                        component: Settings,
                        visible: true,
                        subRoutes: [],
                        index: 3,
                    },
                    {
                        title: 'SSO',
                        path: '/admin/settings/sso',
                        icon: 'settings',
                        component: Settings,
                        visible: true,
                        subRoutes: [],
                        index: 4,
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
        const newRoutes = [];
        for (const route of routes) {
            newRoutes.push(route);
            const tempRoute = { ...route };
            tempRoute.path = '/admin' + route.path;
            newRoutes.push(tempRoute);
        }
        const subRoutes = newRoutes
            .map(route => {
                const newSubRoutes = [];
                for (const subRoute of route.subRoutes) {
                    newSubRoutes.push(subRoute);
                    const tempRoute = { ...subRoute };
                    tempRoute.path = '/admin' + subRoute.path;
                    newSubRoutes.push(tempRoute);
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
