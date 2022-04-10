import express, {
    ExpressRequest,
    ExpressResponse,
} from 'common-server/Utils/Express';
const router = express.getRouter();

import {
    sendErrorResponse,
    sendItemResponse,
} from 'common-server/Utils/Response';
import Exception from 'common/types/exception/Exception';

router.get('/', (req: ExpressRequest, res: ExpressResponse) => {
    try {
        return sendItemResponse(req, res, {
            server: process.env['npm_package_version'],
            client: '',
        });
    } catch (error) {
        return sendErrorResponse(req, res, error as Exception);
    }
});

export default router;
