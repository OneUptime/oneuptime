const os = require('os-utils');
const cron = require('cron');
// eslint-disable-next-line no-unused-vars
const { postApi, getApi } = require('./api');
const { getServerStats } = require('./monitor');

const authenticateUser = (projectId, apiKey) => {
  postApi(`serverMonitor/${projectId}/${apiKey}`);
};

let pingServer = new cron.CronJob(
  '* * * * *',
  function () {
    getServerStats()
      .then(data => {
        // eslint-disable-next-line no-console
        console.log(data);

        // eslint-disable-next-line no-unused-vars
        const serverStat = {
          cpuCount: os.cpuCount()
        };

        // postApi(`serverPackage/uploadServerData/${projectId}`, serverStat);
      })
      // eslint-disable-next-line no-console
      .catch(error => console.log(error));
  },
  null,
  false
);

module.exports = {
  pingServer,
  authenticateUser
};
