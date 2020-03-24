import pages from './pages';

const {
    Register,
    Login,
    ResetPassword,
    ChangePassword,
    ResendToken,
    VerifyAuthToken,
    VerifyBackupCode,
} = pages;

export const groups = [
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
                title: 'Register',
                path: '/register',
                icon: 'home',
                component: Register,
                subRoutes: [],
                isPublic: true,
                visible: true,
                index: 2,
            },
            {
                title: 'Password Reset',
                path: '/forgot-password',
                icon: 'home',
                component: ResetPassword,
                subRoutes: [],
                isPublic: true,
                visible: true,
                index: 3,
            },
            {
                title: 'Change Password',
                path: '/change-password/:token',
                icon: 'home',
                component: ChangePassword,
                subRoutes: [],
                isPublic: true,
                visible: true,
                index: 4,
            },
            {
                title: 'Resend Verification',
                path: '/user-verify/resend',
                icon: 'home',
                component: ResendToken,
                subRoutes: [],
                isPublic: true,
                visible: true,
                index: 5,
            },
            {
                title: 'Verify Authenticator Token',
                path: '/user-auth/token',
                icon: 'home',
                component: VerifyAuthToken,
                subRoutes: [],
                isPublic: true,
                visible: true,
                index: 5,
            },
            {
                title: 'Verify Backup Code',
                path: '/user-auth/backup',
                icon: 'home',
                component: VerifyBackupCode,
                subRoutes: [],
                isPublic: true,
                visible: true,
                index: 6,
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
            tempRoute.path = '/accounts' + route.path;
            newRoutes.push(tempRoute);
        }
        const subRoutes = newRoutes
            .map(route => {
                const newSubRoutes = [];
                for (const subRoute of route.subRoutes) {
                    newSubRoutes.push(subRoute);
                    const tempRoute = { ...subRoute };
                    tempRoute.path = '/accounts' + subRoute.path;
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
