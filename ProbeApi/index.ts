import { ExpressRequest, ExpressResponse } from 'CommonServer/utils/Express';

import app from 'CommonServer/utils/StartServer';

app.get(
    ['/ProbeAPI/status', '/status'],
    (_req: ExpressRequest, res: ExpressResponse) => {
        res.setHeader('Content-Type', 'application/json');
        res.send(
            JSON.stringify({
                status: 200,
                message: 'Service Status - OK',
                serviceType: 'oneuptime-ProbeAPI',
            })
        );
    }
);

app.use(['/ProbeAPI/probe', '/probe'], require('./api/probe'));

export default app;
