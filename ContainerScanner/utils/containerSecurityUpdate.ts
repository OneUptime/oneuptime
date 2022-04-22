import BackendAPI from './api';

export default {
    updateContainerSecurityToScanning: async function (
        security: $TSFixMe
    ): void {
        return await BackendAPI.post(`container/scanning`, { security });
    },
    updateContainerSecurityToFailed: async function (security: $TSFixMe): void {
        return await BackendAPI.post(`container/failed`, security);
    },
    updateContainerSecurityLogService: async function (
        securityLog: $TSFixMe
    ): void {
        return await BackendAPI.post(`container/log`, securityLog);
    },
    updateContainerSecurityScanTime: async function (scanTime: $TSFixMe): void {
        return await BackendAPI.post(`container/time`, scanTime);
    },
};
