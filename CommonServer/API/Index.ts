import version from './Version';
import status from './Status';
import Express, { ExpressApplication} from '../Utils/Express';

const app: ExpressApplication = Express.getExpressApp();

app.use('/version', version);
app.use('/status', status);
