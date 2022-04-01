import version from './version';
import status from './status';
import Express from '../utils/express';

const app = Express.getExpressApp();

app.use('/version', version);
app.use('/status', status);
