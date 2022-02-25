import { postApi } from './api'

export default {
    updateContainerSecurityToScanning: async function(security) {
        return await postApi(`container/scanning`, { security });
    },
    updateContainerSecurityToFailed: async function(security) {
        return await postApi(`container/failed`, security);
    },
    updateContainerSecurityLogService: async function(securityLog) {
        return await postApi(`container/log`, securityLog);
    },
    updateContainerSecurityScanTime: async function(scanTime) {
        return await postApi(`container/time`, scanTime);
    },
};
