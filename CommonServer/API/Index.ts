import version from './VersionAPI';
import status from './StatusAPI';
import Express, { ExpressApplication } from '../Utils/Express';

const app: ExpressApplication = Express.getExpressApp();

export default (appName: string) => {
    app.use([`/${appName}`, '/'], version);
    app.use([`/${appName}`, '/'], status);
};
