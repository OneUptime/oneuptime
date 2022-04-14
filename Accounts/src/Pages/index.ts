import { lazy } from 'react';

const Login: $TSFixMe = lazy((): $TSFixMe => import('./Login'));
const SsoLogin: $TSFixMe = lazy((): $TSFixMe => import('./SsoLogin'));
const Register: $TSFixMe = lazy((): $TSFixMe => import('./Register'));
const ResetPassword: $TSFixMe = lazy((): $TSFixMe => import('./ResetPassword'));
const ChangePassword: $TSFixMe = lazy(
    (): $TSFixMe => import('./ChangePassword')
);
const ResendToken: $TSFixMe = lazy((): $TSFixMe => import('./ResendToken'));
const VerifyAuthToken: $TSFixMe = lazy(
    (): $TSFixMe => import('./VerifyAuthToken')
);
const VerifyBackupCode: $TSFixMe = lazy(
    (): $TSFixMe => import('./VerifyBackupCode')
);

export default {
    ResetPassword,
    Register,
    ChangePassword,
    Login,
    SsoLogin,
    ResendToken,
    VerifyAuthToken,
    VerifyBackupCode,
};
