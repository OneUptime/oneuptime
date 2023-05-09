import API from 'Common/Utils/API';
import RunCron from '../Utils/Cron';
import { EVERY_MINUTE } from 'Common/Utils/CronTime';
import { PROBE_API_URL } from '../Config';
import LocalCache from 'CommonServer/Infrastructure/LocalCache';
import URL from 'Common/Types/API/URL';
import logger from 'CommonServer/Utils/Logger';
import ProbeAPIRequest from '../Utils/ProbeAPIRequest';
import Register from '../Services/Register';

RunCron(
    'Basic:Alive',
    {
        schedule: EVERY_MINUTE,
        runOnStartup: false,
    },
    async () => {
        if (!LocalCache.getString('PROBE', 'PROBE_ID')) {
            logger.warn(
                'Probe is not registered yet. Skipping alive check. Trying to register probe again...'
            );
            await Register.registerProbe();
            return;
        }

        await API.post(
            URL.fromString(PROBE_API_URL.toString()).addRoute('/alive'),
            ProbeAPIRequest.getDefaultRequestBody()
        );
    }
);
