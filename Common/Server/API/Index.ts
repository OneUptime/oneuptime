import Express, { ExpressApplication } from "../Utils/Express";
import StatusAPI, { StatusAPIOptions } from "./StatusAPI";
import IPWhitelistAPI from "./IPWhitelistAPI";
import version from "./VersionAPI";

const app: ExpressApplication = Express.getExpressApp();

export interface InitOptions {
  appName: string;
  statusOptions: StatusAPIOptions;
}

type InitFunction = (data: InitOptions) => void;

const init: InitFunction = (data: InitOptions): void => {
  app.use([`/${data.appName}`, "/"], version);
  app.use([`/${data.appName}`, "/"], StatusAPI.init(data.statusOptions));
  app.use([`/${data.appName}`, "/"], IPWhitelistAPI.init());
};

export default init;
