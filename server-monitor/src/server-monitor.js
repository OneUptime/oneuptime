const si = require('systeminformation');
const cron = require('cron');
const { getApi } = require('./api');

const authenticateUser = (projectId, apiKey, monitorId) => {
  const url = monitorId !== null ? `monitor/${projectId}/monitor/${monitorId}` : `monitor/${projectId}/monitor`;
  return getApi(url, apiKey);
};

const pingServer = (server) => {
  // eslint-disable-next-line no-console
  console.log('Starting Server Monitor...');

  return new cron.CronJob('* * * * *', () => {
    si.getAllData()
      .then(data => {
        // eslint-disable-next-line no-console
        console.log(server, data);
        // send data to endpoint
      })
      // eslint-disable-next-line no-console
      .catch(error => { console.error(error) });
  }, null, false);
};

module.exports = {
  authenticateUser,
  pingServer
};
