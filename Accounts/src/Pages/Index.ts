import { lazy } from 'react';

const Login: $TSFixMe = lazy((): $TSFixMe => {
    return import('./Login');
});
const SsoLogin: $TSFixMe = lazy((): $TSFixMe => {
    return import('./SsoLogin');
});
const Register: $TSFixMe = lazy((): $TSFixMe => {
    return import('./Register');
});
const ResetPassword: $TSFixMe = lazy((): $TSFixMe => {
    return import('./ResetPassword');
});
const ChangePassword: $TSFixMe = lazy((): $TSFixMe => {
    return import('./ChangePassword');
});
const ResendToken: $TSFixMe = lazy((): $TSFixMe => {
    return import('./ResendToken');
});
const VerifyAuthToken: $TSFixMe = lazy((): $TSFixMe => {
    return import('./VerifyAuthToken');
});
const VerifyBackupCode: $TSFixMe = lazy((): $TSFixMe => {
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
