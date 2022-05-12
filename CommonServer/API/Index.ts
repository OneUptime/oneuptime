import version from './VersionAPI';
import status from './StatusAPI';
import Express, { ExpressApplication } from '../Utils/Express';

const app: ExpressApplication = Express.getExpressApp();

app.use('/version', version);
app.use('/status', status);
