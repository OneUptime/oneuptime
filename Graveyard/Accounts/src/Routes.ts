import Pages from './Pages/Index';

const {
    Register,
    Login,
    SsoLogin,
    ResetPassword,
    ChangePassword,
    ResendToken,
    VerifyAuthToken,
    VerifyBackupCode,
} = Pages;

export const groups: $TSFixMe = [
    {
        group: 'public',
        isPublic: true,
        routes: [
            {
                title: 'Login',
                path: '/login',
                icon: 'home',
                component: Login,
                subRoutes: [],
                isPublic: true,
                visible: true,
                index: 1,
            },

            {
                title: 'SSO Login',
                path: '/ssologin',
                icon: 'home',
                component: SsoLogin,
                subRoutes: [],
                isPublic: true,
                visible: true,
                index: 2,
            },
            {
                title: 'Register',
                path: '/register',
                icon: 'home',
                component: Register,
                subRoutes: [],
                isPublic: true,
                visible: true,
                index: 3,
            },
            {
                title: 'Password Reset',
                path: '/forgot-password',
                icon: 'home',
                component: ResetPassword,
                subRoutes: [],
                isPublic: true,
                visible: true,
                index: 4,
            },
            {
                title: 'Change Password',
                path: '/change-password/:token',
                icon: 'home',
                component: ChangePassword,
                subRoutes: [],
                isPublic: true,
                visible: true,
                index: 5,
            },
            {
                title: 'Resend Verification',
                path: '/user-verify/resend',
                icon: 'home',
                component: ResendToken,
                subRoutes: [],
                isPublic: true,
                visible: true,
                index: 6,
            },
            {
                title: 'Verify Authenticator Token',
                path: '/user-auth/token',
                icon: 'home',
                component: VerifyAuthToken,
                subRoutes: [],
                isPublic: true,
                visible: true,
                index: 7,
            },
            {
                title: 'Verify Backup Code',
                path: '/user-auth/backup',
                icon: 'home',
                component: VerifyBackupCode,
                subRoutes: [],
                isPublic: true,
                visible: true,
                index: 8,
            },
            {
                title: 'Login',
                path: '/sso/:domain',
                icon: 'home',
                component: Login,
                subRoutes: [],
                isPublic: true,
                visible: true,
                index: 9,
            },
        ],
    },
];

const joinFn: Function = (acc: $TSFixMe = [], curr: $TSFixMe): void => {
    return acc.concat(curr);
};

export const allRoutes: $TSFixMe = groups
    .map((group: $TSFixMe): void => {
        const { routes }: $TSFixMe = group;
        const newRoutes: $TSFixMe = [];
        for (const route of routes) {
            newRoutes.push(route);
            const tempRoute: $TSFixMe = { ...route };
            tempRoute.path = '/accounts' + route.path;
            newRoutes.push(tempRoute);
        }
        const subRoutes: $TSFixMe = newRoutes
            .map((route: $TSFixMe) => {
                const newSubRoutes: $TSFixMe = [];
                for (const subRoute of route.subRoutes) {
                    newSubRoutes.push(subRoute);

                    const tempRoute: $TSFixMe = { ...subRoute };

                    tempRoute.path = '/accounts' + subRoute.path;
                    newSubRoutes.push(tempRoute);
                }
                return newSubRoutes;
            })

            .reduce(joinFn);
        return newRoutes.concat(subRoutes);
    })

    .reduce(joinFn);

export const getGroups: Function = (): void => {
    return groups;
};

export default {
    groups,
    allRoutes,
};
