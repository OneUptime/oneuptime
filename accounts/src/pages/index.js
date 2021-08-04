import { lazy } from 'react';

const Login = lazy(() => import('./Login'));
const SsoLogin = lazy(() => import('./SsoLogin'));
const Register = lazy(() => import('./Register'));
const ResetPassword = lazy(() => import('./ResetPassword'));
const ChangePassword = lazy(() => import('./ChangePassword'));
const ResendToken = lazy(() => import('./ResendToken'));
const VerifyAuthToken = lazy(() => import('./VerifyAuthToken'));
const VerifyBackupCode = lazy(() => import('./VerifyBackupCode'));

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
