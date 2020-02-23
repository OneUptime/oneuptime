const PKG_VERSION = require('./package.json').version.split('.')[2];

const fs = require('fs');
const util = require('./util/db');
const scripts = require('./scripts');

async function run() {
  // eslint-disable-next-line no-console
  console.log('Connecting to MongoDB.');

  const connection = await util.connectToDb();
  global.db = connection.db();

  // eslint-disable-next-line no-console
  console.log('Connected to MongoDB.');

  // eslint-disable-next-line no-console
  console.log('START SCRIPT: Running script.');

  await scripts.start();

  // eslint-disable-next-line no-console
  console.log('START SCRIPT: Completed');

  fs.readdirSync('./scripts')
    .filter(file => file !== 'start.js' && file !== 'end.js') // Exclude start and end scripts
    .sort((a, b) => parseInt(a.split('.')[2]) > parseInt(b.split('.')[2]) ? 1 : 0)
    .forEach(async function (file) {
      if (PKG_VERSION < file.split('.')[2]) {
        // eslint-disable-next-line no-console
        console.log(file + ': Running script.');

        await require(`./scripts/${file}`)();

        // eslint-disable-next-line no-console
        console.log(file + ': Completed. ');
      }
    });

  // eslint-disable-next-line no-console
  console.log('END SCRIPT: Running script.');

  await scripts.end();

  // eslint-disable-next-line no-console
  console.log('END SCRIPT: Completed');

  connection.close();

  // eslint-disable-next-line no-console
  console.log('Mongo connection closed.');

}

module.exports = run;

run();
