import pages from './pages';
import {
    IS_SAAS_SERVICE,
    IS_THIRD_PARTY_BILLING,
    DASHBOARD_URL,
} from './config';

const {
    Users,
    User,
    Projects,
    Project,
    Probes,
    AuditLogs,
    Settings,
    License,
    EmailLogs,
    SmsLogs,
    CallLogs,
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
                shortcut: 'f+u',
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
                shortcut: 'f+p',
                subRoutes: [
                    {
                        title: 'Project',
                        path: '/admin/projects/:slug',
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
                shortcut: 'f+b',
            },
        ],
    },
    {
        group: 'Logs',
        visible: true,
        routes: [
            {
                title: 'Logs',
                exact: true,
                visible: true,
                shortcut: 'f+a',
                path: '/admin/audit-logs',
                icon: 'LogsIcon',
                component: AuditLogs,
                index: 1,
                subRoutes: [
                    {
                        title: 'Audit Logs',
                        path: '/admin/audit-logs',
                        icon: 'appLog',
                        component: AuditLogs,
                        visible: true,
                        subRoutes: [],
                        index: 4,
                        shortcut: 'f+a',
                    },
                    {
                        title: 'Call Logs',
                        path: '/admin/call-logs',
                        icon: 'emailIcon',
                        component: CallLogs,
                        visible: true,
                        subRoutes: [],
                        index: 5,
                        shortcut: 'f+w',
                    },
                    {
                        title: 'Email Logs',
                        path: '/admin/email-logs',
                        icon: 'emailIcon',
                        component: EmailLogs,
                        visible: true,
                        subRoutes: [],
                        index: 6,
                        shortcut: 'f+e',
                    },
                    {
                        title: 'SMS Logs',
                        path: '/admin/sms-logs',
                        icon: 'smsIcon',
                        component: SmsLogs,
                        visible: true,
                        subRoutes: [],
                        index: 7,
                        shortcut: 'f+k',
                    },
                ],
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
                shortcut: 'f+s',
                subRoutes: [
                    {
                        title: 'License',
                        path: '/admin/settings/license',
                        icon: 'activate',
                        component: License,
                        visible: !IS_THIRD_PARTY_BILLING && !IS_SAAS_SERVICE,
                        subRoutes: [],
                        index: 1,
                        shortcut: 'f+l',
                    },
                    {
                        title: 'SMTP',
                        path: '/admin/settings/smtp',
                        icon: 'settings',
                        component: Settings,
                        visible: true,
                        subRoutes: [],
                        index: 2,
                        shortcut: 'f+m',
                    },
                    {
                        title: 'Twilio',
                        path: '/admin/settings/twilio',
                        icon: 'settings',
                        component: Settings,
                        visible: true,
                        subRoutes: [],
                        index: 3,
                        shortcut: 'f+t',
                    },
                    {
                        title: 'SSO',
                        path: '/admin/settings/sso',
                        icon: 'settings',
                        component: Settings,
                        visible: true,
                        subRoutes: [],
                        index: 4,
                        shortcut: 'f+o',
                    },
                    {
                        title: 'Audit Log',
                        path: '/admin/settings/audit-logs',
                        icon: 'appLog',
                        component: Settings,
                        visible: true,
                        subRoutes: [],
                        index: 5,
                        shortcut: 'f+g',
                    },
                    {
                        title: 'Call Log',
                        path: '/admin/settings/call-logs',
                        icon: 'emailIcon',
                        component: Settings,
                        visible: true,
                        subRoutes: [],
                        index: 6,
                        shortcut: 'f+h',
                    },
                    {
                        title: 'Email Log',
                        path: '/admin/settings/email-logs',
                        icon: 'emailIcon',
                        component: Settings,
                        visible: true,
                        subRoutes: [],
                        index: 7,
                        shortcut: 'f+i',
                    },
                    {
                        title: 'SMS Log',
                        path: '/admin/settings/sms-logs',
                        icon: 'smsIcon',
                        component: Settings,
                        visible: true,
                        subRoutes: [],
                        index: 8,
                        shortcut: 'f+c',
                    },
                ],
                index: 1,
            },
        ],
    },
    {
        group: 'External',
        visible: true,
        routes: [
            {
                title: 'Go to User Dashboard',
                path: DASHBOARD_URL,
                icon: 'square',
                component: null,
                visible: true,
                subRoutes: [],
                index: 1,
                external: true,
                shortcut: 'f+d',
            },
        ],
    },
];

const joinFn = (acc = [], curr: $TSFixMe) => {
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
            // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '(acc: never[] | undefined, curr:... Remove this comment to see the full error message
            .reduce(joinFn);
        // @ts-expect-error ts-migrate(2769) FIXME: No overload matches this call.
        return newRoutes.concat(subRoutes);
    })
    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type '(acc: never[] | undefined, curr:... Remove this comment to see the full error message
    .reduce(joinFn);

export const getGroups = () => groups;

export default {
    groups,
    allRoutes,
};
