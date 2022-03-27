import BackendAPI from './api';

export default {
    updateApplicationSecurityToScanning: async function (security: $TSFixMe) {
        return await BackendAPI.post(`application/scanning`, { security });
    },
    updateApplicationSecurityToFailed: async function (security: $TSFixMe) {
        return await BackendAPI.post(`application/failed`, security);
    },
    updateApplicationSecurityLogService: async function (
        securityLog: $TSFixMe
    ) {
        return await BackendAPI.post(`application/log`, securityLog);
    },
    updateApplicationSecurityScanTime: async function (scanTime: $TSFixMe) {
        return await BackendAPI.post(`application/time`, scanTime);
    },
};
