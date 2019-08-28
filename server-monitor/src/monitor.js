// monitor system params
// Promise.all([
//   si.currentLoad(),
//   si.mem(),
//   si.blockDevices(),
//   si.networkStats(),
//   si.cpuTemperature(),
//   si.cpu(),
//   si.users(),
//   si.networkConnections(),
//   si.vboxInfo()
// ]).then(data => data);
// do something with data and pass it on

const si = require('systeminformation');

const getServerStats = () => {
  return si.getAllData();
};

module.exports = { getServerStats };
