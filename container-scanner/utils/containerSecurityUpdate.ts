import { postApi } from './api';

export default {
    updateContainerSecurityToScanning: async function (security: $TSFixMe) {
        return await postApi(`container/scanning`, { security });
    },
    updateContainerSecurityToFailed: async function (security: $TSFixMe) {
        return await postApi(`container/failed`, security);
    },
    updateContainerSecurityLogService: async function (securityLog: $TSFixMe) {
        return await postApi(`container/log`, securityLog);
    },
    updateContainerSecurityScanTime: async function (scanTime: $TSFixMe) {
        return await postApi(`container/time`, scanTime);
    },
};
