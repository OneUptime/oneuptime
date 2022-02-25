import { postApi } from './api'

export default {
    updateApplicationSecurityToScanning: async function(security) {
        return await postApi(`application/scanning`, { security });
    },
    updateApplicationSecurityToFailed: async function(security) {
        return await postApi(`application/failed`, security);
    },
    updateApplicationSecurityLogService: async function(securityLog) {
        return await postApi(`application/log`, securityLog);
    },
    updateApplicationSecurityScanTime: async function(scanTime) {
        return await postApi(`application/time`, scanTime);
    },
};
