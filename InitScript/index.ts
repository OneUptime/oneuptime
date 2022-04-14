import { ExpressRequest, ExpressResponse } from 'CommonServer/utils/Express';

import app from 'CommonServer/utils/StartServer';

import logger from 'CommonServer/utils/Logger';
import fs from 'fs';
import util from './util/db';
import scripts from './scripts';

import { find, save, update, removeMany } from './util/db';

import bodyParser from 'body-parser';

import cors from 'cors';

async function interactWithDB(req: ExpressRequest, res: ExpressResponse): void {
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

    app.listen(1447, (): void => {
        logger.info('Server running on: 1447');
    });

    app.get(
        '/:dbFunction',
        async (req: ExpressRequest, res: ExpressResponse) => {
            return await interactWithDB(req, res);
        }
    );

    app.post(
        '/:dbFunction',
        async (req: ExpressRequest, res: ExpressResponse) => {
            return await interactWithDB(req, res);
        }
    );
}

async function run(): void {
    const excludedScripts: $TSFixMe = ['index.ts', 'start.ts', 'end.ts'];

    logger.info('Connecting to MongoDB.');

    const connection: $TSFixMe = await util.connectToDb();

    global.db = connection.db();

    logger.info('Connected to MongoDB.');

    let currentVersion = await util.getVersion();

    logger.info('Current Version: ' + currentVersion);

    if (currentVersion) {
        currentVersion = currentVersion.split('.')[2];
    }

    logger.info('START SCRIPT: Running script.');

    await scripts.start();

    logger.info('START SCRIPT: Completed');

    const files: $TSFixMe = fs
        .readdirSync('./scripts')
        .filter(file => excludedScripts.indexOf(file) < 0) // Exclude index, start and end scripts
        .sort((a, b) =>
            parseInt(a.split('.')[2]) > parseInt(b.split('.')[2]) ? 1 : 0
        );

    // Switched to for loop, forEach does not await the callback
    for (let i = 0; i < files.length; i++) {
        const file: $TSFixMe = files[i];

        logger.info(file + ': Running script.');

        await require(`./scripts/${file}`)();

        logger.info(file + ': Completed. ');
    }

    logger.info('END SCRIPT: Running script.');

    await scripts.end();

    logger.info('END SCRIPT: Completed');
    // keep connection open in dev
    if (process.env['NODE_ENV'] !== 'development') {
        connection.close();

        logger.info('Mongo connection closed.');
    } else {
        logger.info('Mongo connection open in development mode.');
    }
}

export default run;

run();
