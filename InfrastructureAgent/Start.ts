import MonitorInfrastructure from "./Jobs/MonitorInfrastructure";
import { argv } from 'yargs';

const secretKey: string | undefined = (argv as any)['secret-key'];
const oneuptimeHost: string =
    (argv as any)['oneuptime-url'] || 'https://oneuptime.com';

if (!secretKey) {
    throw new Error(
        'No secret-key argument found. You can find secret key for this monitor on OneUptime Dashboard'
    );
}

MonitorInfrastructure.initJob(secretKey, oneuptimeHost);