import 'common-server/utils/env';
import 'common-server/utils/process';
import Express, { Request, Response } from 'common-server/utils/express';
const app = Express.launchApplication();

app.get(
    ['/probe-api/status', '/status'],
    (req: ExpressRequest, res: ExpressResponse) => {
        res.setHeader('Content-Type', 'application/json');
        res.send(
            JSON.stringify({
                status: 200,
                message: 'Service Status - OK',
                serviceType: 'oneuptime-probe-api',
            })
        );
    }
);

app.use(['/probe', '/api/probe'], require('./api/probe'));

export default app;
