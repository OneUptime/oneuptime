import type { ExpressApplication } from 'CommonServer/Utils/Express';
import Express from 'CommonServer/Utils/Express';

const app: ExpressApplication = Express.getExpressApp();

export default app;
