const os = require('os-utils')
const cron = require('cron');
const { postApi, getApi } = require('./api');

const authenticateUser = (projectId, apiKey) => {
  postApi(`serverMonitor/${projectId}/${apiKey}`)
}

let pingServer = new cron.CronJob('* * * * *', function() {  
    const serverStat = {
      cpuCount: os.cpuCount()
    };
    postApi(`serverPackage/uploadServerData/${projectId}`, serverStat);
  }, null, false);

module.exports = {
  pingServer,
  authenticateUser
}
