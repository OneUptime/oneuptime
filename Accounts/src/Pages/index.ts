import { lazy } from 'react';

const Login = lazy((): $TSFixMe => import('./Login'));
const SsoLogin = lazy((): $TSFixMe => import('./SsoLogin'));
const Register = lazy((): $TSFixMe => import('./Register'));
const ResetPassword = lazy((): $TSFixMe => import('./ResetPassword'));
const ChangePassword = lazy((): $TSFixMe => import('./ChangePassword'));
const ResendToken = lazy((): $TSFixMe => import('./ResendToken'));
const VerifyAuthToken = lazy((): $TSFixMe => import('./VerifyAuthToken'));
const VerifyBackupCode = lazy((): $TSFixMe => import('./VerifyBackupCode'));

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
