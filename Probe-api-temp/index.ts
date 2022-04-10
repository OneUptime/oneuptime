import { ExpressRequest, ExpressResponse } from 'common-server/Utils/Express';

import app from 'common-server/utils/StartServer';

app.get(
    ['/probe-api/status', '/status'],
    (_req: ExpressRequest, res: ExpressResponse) => {
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

app.use(['/probe-api/probe', '/probe'], require('./api/probe'));

export default app;
