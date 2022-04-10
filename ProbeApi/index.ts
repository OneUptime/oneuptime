import { ExpressRequest, ExpressResponse } from 'Common-server/Utils/Express';

import app from 'Common-server/utils/StartServer';

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
