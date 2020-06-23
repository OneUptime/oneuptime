const { find, update, removeField } = require('../util/db');

const statusPageCollection = 'statuspages';

async function run() {
  const statusPages = await find(statusPageCollection,
    {
      monitorIds: { $exists: true },
      deleted: false
    }
  );
  for (let i = 0; i < statusPages.length; i++) {
    const statusPage = statusPages[i];
    const monitors = [];
    for (let j = 0; j < statusPage.monitorIds.length; j++) {
      monitors.push({
        monitor: statusPage.monitorIds[j],
        description: '',
        uptime: true,
        memory: false,
        cpu: false,
        storage: false,
        responseTime: false,
        temperature: false,
        runtime: false,
      });
    }
    const colors = {
      ...statusPage.colors, 
      ...{
        strokeChart: { r: 0, g: 0, b: 0, a: 1 },
        fillChart: { r: 226, g: 225, b: 242, a: 1 },
      }
    };
    await update(
      statusPageCollection,
      { _id: statusPage._id },
      { monitors,colors }
    );
    await removeField(
      statusPageCollection,
      { _id: statusPage._id },
      { monitorIds: '' }
    );

  }


}

module.exports = run;