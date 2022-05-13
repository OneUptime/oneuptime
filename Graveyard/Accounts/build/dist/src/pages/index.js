import { lazy } from 'react';
const Login = lazy(() => {
    return import('./Login');
});
const SsoLogin = lazy(() => {
    return import('./SsoLogin');
});
const Register = lazy(() => {
    return import('./Register');
});
const ResetPassword = lazy(() => {
    return import('./ResetPassword');
});
const ChangePassword = lazy(() => {
    return import('./ChangePassword');
});
const ResendToken = lazy(() => {
    return import('./ResendToken');
});
const VerifyAuthToken = lazy(() => {
    return import('./VerifyAuthToken');
});
const VerifyBackupCode = lazy(() => {
    return import('./VerifyBackupCode');
});
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
