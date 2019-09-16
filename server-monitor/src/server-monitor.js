const si = require('systeminformation');
const cron = require('cron');
const { getApi, postApi } = require('./api');

const authenticateUser = (projectId, apiKey, monitorId) => {
  const url = monitorId !== null
    ? `monitor/${projectId}/monitor/${monitorId}/?type=server-monitor`
    : `monitor/${projectId}/monitor/?type=server-monitor`;

  return getApi(url, apiKey);
};

const pingServer = (data, projectId, apiKey) => {
  // eslint-disable-next-line no-console
  console.log('Starting Server Monitor...');

  const monitorId = data._id;

  return new cron.CronJob('* * * * *', () => {
    // eslint-disable-next-line no-undef
    Promise.all([
      si.currentLoad(),
      si.mem(),
      si.fsSize(),
      si.networkStats(),
      si.cpuTemperature(),
      si.cpu(),
      si.users(),
      si.networkConnections(),
      si.vboxInfo()
    ])
      .then(data => ({
        load: data[0],
        memory: data[1],
        disk: data[2],
        traffic: data[3],
        temperature: data[4],
        resources: data[5],
        users: data[6],
        network: data[7],
        vbox: data[8]
      }))
      .then(data => {
        postApi(`monitor/${projectId}/log/${monitorId}`, { data }, apiKey)
          // eslint-disable-next-line no-console
          .catch(error => { console.error(error) });
      })
      // eslint-disable-next-line no-console
      .catch(error => { console.error(error) });
  }, null, false);
};

module.exports = {
  authenticateUser,
  pingServer
};
