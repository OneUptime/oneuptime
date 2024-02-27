import version from './VersionAPI';
import status from './StatusAPI';
import Express, { ExpressApplication } from '../Utils/Express';

const app: ExpressApplication = Express.getExpressApp();


type InitFunction = (appName: string) => void;

const init: InitFunction = (appName: string): void => {
    app.use([`/${appName}`, '/'], version);
    app.use([`/${appName}`, '/'], status);
};

export default init;
