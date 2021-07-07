const { postApi } = require('./api');

module.exports = {
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
