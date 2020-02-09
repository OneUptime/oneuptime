const PKG_VERSION = require('./package.json').version.split('.')[2];

const fs = require('fs');
const util = require('./util/db');
const start = require('./scripts/start');
const end = require('./scripts/end');

(async function () {

  global.client = await util.connectToDb();
  global.db = global.client.db();

  await start();

  fs.readdirSync('scripts')
    .filter(file => file !== 'start.js' && file !== 'end.js') // Exclude start and end scripts
    .sort((a, b) => a.split('.')[2] > b.split('.')[2] ? 1 : 0)
    .forEach(function (file) {
      if (PKG_VERSION < file.split('.')[2]) {
        require(`./scripts/${file}`)();
      }
    });

  await end();

  global.client.close();

})();
