const PKG_VERSION = require('./package.json').version.split('.')[2];

const fs = require('fs');
const util = require('./util/db');
const scripts = require('./scripts');

async function run () {

  const connection = await util.connectToDb();
  global.db = connection.db();

  await scripts.start();

  fs.readdirSync('./scripts')
    .filter(file => file !== 'start.js' && file !== 'end.js') // Exclude start and end scripts
    .sort((a, b) => parseInt(a.split('.')[2]) > parseInt(b.split('.')[2]) ? 1 : 0)
    .forEach(function (file) {
      if (PKG_VERSION < file.split('.')[2]) {
        require(`./scripts/${file}`)();
      }
    });

  await scripts.end();

  connection.close();

}

module.exports = run;

run();
