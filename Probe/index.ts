import 'common-server/utils/env';
import 'common-server/utils/process';

import asyncSleep from 'await-sleep';

import Main from './workers/main';
import config from './utils/config';
import logger from 'CommonServer/Utils/Logger';

const cronMinuteStartTime = Math.floor(Math.random() * 50);

setTimeout(async () => {
    // keep monitoring in an infinate loop.

    //eslint-disable-next-line no-constant-condition
    while (true) {
        try {
            await Main.runJob();
        } catch (error) {
            logger.error(error);
            logger.info('Sleeping for 30 seconds...');
            await asyncSleep(30 * 1000);
        }
    }
}, cronMinuteStartTime * 1000);

logger.info(
    `Probe with Probe Name ${config.probeName} and Probe Key ${config.probeKey}. OneUptime Probe API URL: ${config.probeApiUrl}`
);
