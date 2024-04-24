import version from './VersionAPI';
import StatusAPI, { StatusAPIOptions } from './StatusAPI';
import Express, { ExpressApplication } from '../Utils/Express';

const app: ExpressApplication = Express.getExpressApp();

export interface InitOptions {
    appName: string;
    statusOptions: StatusAPIOptions;
}

type InitFunction = (data: InitOptions) => void;

const init: InitFunction = (data: InitOptions): void => {
    app.use([`/${data.appName}`, '/'], version);
    app.use([`/${data.appName}`, '/'], StatusAPI.init(data.statusOptions));
};

export default init;
