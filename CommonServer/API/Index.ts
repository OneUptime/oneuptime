import version from './VersionAPI';
import status from './StatusAPI';
import type { ExpressApplication } from '../Utils/Express';
import Express from '../Utils/Express';

const app: ExpressApplication = Express.getExpressApp();

const init: Function = (appName: string): void => {
    app.use([`/${appName}`, '/'], version);
    app.use([`/${appName}`, '/'], status);
};

export default init;
