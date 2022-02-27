process.on('exit', () => {
    // eslint-disable-next-line no-console
    console.log('Shutting Shutdown');
});

process.on('unhandledRejection', err => {
    // eslint-disable-next-line no-console
    console.error('Unhandled rejection in process occurred');
    // eslint-disable-next-line no-console
    console.error(err);
});

process.on('uncaughtException', err => {
    // eslint-disable-next-line no-console
    console.error('Uncaught exception in process occurred');
    // eslint-disable-next-line no-console
    console.error(err);
});

const { NODE_ENV } = process.env;
if (!NODE_ENV || NODE_ENV === 'development') {
    // Load env vars from /backend/.env
    require('custom-env').env();
}

import fs from 'fs'
import util from './util/db'
import scripts from './scripts'
// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'express' or its corresponding ... Remove this comment to see the full error message
import express from 'express'
const app = express();
// @ts-expect-error ts-migrate(2614) FIXME: Module '"./util/db"' has no exported member 'find'... Remove this comment to see the full error message
import { find, save, update, removeMany } from './util/db'
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'body... Remove this comment to see the full error message
import bodyParser from 'body-parser'
// @ts-expect-error ts-migrate(2307) FIXME: Cannot find module 'cors' or its corresponding typ... Remove this comment to see the full error message
import cors from 'cors'

async function interactWithDB(req: $TSFixMe, res: $TSFixMe) {
    if (req.params.dbFunction === 'find') {
        res.send(await find(req.body.collection, req.body.query));
    }
    if (req.params.dbFunction === 'save') {
        res.send(await save(req.body.collection, req.body.docs));
    }
    if (req.params.dbFunction === 'update') {
        res.send(
            await update(req.body.collection, req.body.query, req.body.value)
        );
    }
    if (req.params.dbFunction === 'removeMany') {
        res.send(await removeMany(req.body.collection, req.body.query));
    }
}

// IMPORTANT: only attach this server in development.
if (process.env['NODE_ENV'] === 'development') {
    app.use(cors());

    app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));
    app.use(bodyParser.json({ limit: '10mb' }));

    app.listen(1447, function() {
        // eslint-disable-next-line no-console
        console.log('Server running on: 1447');
    });

    app.get('/:dbFunction', async function(req: $TSFixMe, res: $TSFixMe) {
        return await interactWithDB(req, res);
    });

    app.post('/:dbFunction', async function(req: $TSFixMe, res: $TSFixMe) {
        return await interactWithDB(req, res);
    });
}

async function run() {
    const excludedScripts = ['index.js', 'start.js', 'end.js'];

    // eslint-disable-next-line no-console
    console.log('Connecting to MongoDB.');

    const connection = await util.connectToDb();
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'db' does not exist on type 'Global & typ... Remove this comment to see the full error message
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
    // keep connection open in dev
    if (process.env['NODE_ENV'] !== 'development') {
        connection.close();
        // eslint-disable-next-line no-console
        console.log('Mongo connection closed.');
    } else {
        // eslint-disable-next-line no-console
        console.log('Mongo connection open in development mode.');
    }
}

export default run;

run();
