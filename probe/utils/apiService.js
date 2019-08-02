const postApi = require('./api').postApi;

module.exports = {
    setMonitorTime: async function (monitorId,responseTime,responseStatus,status) {
        return await postApi(`probe/setTime/${monitorId}`,{responseTime,responseStatus,status});
    },
    getMonitorTime: async function (monitorId,date) {
        return await postApi(`probe/getTime/${monitorId}`,date);
    },
};