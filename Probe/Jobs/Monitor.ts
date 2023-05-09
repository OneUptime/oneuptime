import API from 'Common/Utils/API';
import RunCron from '../Utils/Cron';
import { EVERY_MINUTE } from 'Common/Utils/CronTime';
import { PROBE_API_URL, PROBE_KEY } from '../Config';
import LocalCache from 'CommonServer/Infrastructure/LocalCache';
import URL from 'Common/Types/API/URL';
import logger from 'CommonServer/Utils/Logger';
import Register from '../Services/Register';

RunCron(
    'Basic:Monitor',
    {
        schedule: EVERY_MINUTE,
        runOnStartup: false,
    },
    async () => {
        // get a list of monitors from probe-api

        // for each monitor, ping and then report back to probe-api

        if (!LocalCache.getString('PROBE', 'PROBE_ID')) {
            logger.warn('Probe is not registered yet. Skipping alive check. Trying to register probe again...');
            await Register.registerProbe();
            return;
        }

        await API.post(
            URL.fromString(PROBE_API_URL.toString()).addRoute('/alive'),
            {
                probeKey: PROBE_KEY,
                probeId: LocalCache.getString('PROBE', 'PROBE_ID'),
            }
        );
    }
);
