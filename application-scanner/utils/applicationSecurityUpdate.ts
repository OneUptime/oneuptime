import { postApi } from './api';

export default {
    updateApplicationSecurityToScanning: async function(security: $TSFixMe) {
        return await postApi(`application/scanning`, { security });
    },
    updateApplicationSecurityToFailed: async function(security: $TSFixMe) {
        return await postApi(`application/failed`, security);
    },
    updateApplicationSecurityLogService: async function(securityLog: $TSFixMe) {
        return await postApi(`application/log`, securityLog);
    },
    updateApplicationSecurityScanTime: async function(scanTime: $TSFixMe) {
        return await postApi(`application/time`, scanTime);
    },
};
