const fs = require('fs');
const util = require('./util/db');
const scripts = require('./scripts');

async function run() {
    const excludedScripts = ['index.js', 'start.js', 'end.js'];

    // eslint-disable-next-line no-console
    console.log('Connecting to MongoDB.');

    const connection = await util.connectToDb();
    global.db = connection.db();

    // eslint-disable-next-line no-console
    console.log('Connected to MongoDB.');

    let currentVersion = await util.getVersion();

    // eslint-disable-next-line no-console
    console.log('Current Version: ' + currentVersion);

    if (currentVersion) {
        currentVersion = currentVersion.split('.')[2];
    }

    // eslint-disable-next-line no-console
    console.log('START SCRIPT: Running script.');

    await scripts.start();

    // eslint-disable-next-line no-console
    console.log('START SCRIPT: Completed');

    const files = fs
        .readdirSync('./scripts')
        .filter(file => excludedScripts.indexOf(file) < 0) // Exclude index, start and end scripts
        .sort((a, b) =>
            parseInt(a.split('.')[2]) > parseInt(b.split('.')[2]) ? 1 : 0
        );

    // Switched to for loop, forEach does not await the callback
    for (let i = 0; i < files.length; i++) {
        const file = files[i];
        
        // eslint-disable-next-line no-console
        console.log(file + ': Running script.');

        await require(`./scripts/${file}`)();

        // eslint-disable-next-line no-console
        console.log(file + ': Completed. ');

    }

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
