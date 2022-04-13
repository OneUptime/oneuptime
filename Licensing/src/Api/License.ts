import Express, {
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/Utils/Express';
import PositiveNumber from 'Common/Types/PositiveNumber';
const router = Express.getRouter();
import {
    sendErrorResponse,
    sendItemResponse,
} from 'CommonServer/Utils/Response';
import Email from 'Common/Types/email';
import BadDataException from 'Common/Types/Exception/BadDataException';

import LicenseService from '../Services/LicenseService';
import Exception from 'Common/Types/Exception/Exception';

router.post('/', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
        const data = req.body;

        if (!data.license) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('License must be present.')
            );
        }

        if (typeof data.license !== 'string') {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('License is not in string format.')
            );
        }

        if (!data.email) {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Email must be present.')
            );
        }

        if (typeof data.email !== 'string') {
            return sendErrorResponse(
                req,
                res,
                new BadDataException('Email is not in string format.')
            );
        }

        const limit = new PositiveNumber(
            parseInt((req.query['limit'] as string) || '100')
        );

        const item = await LicenseService.confirm(
            data.license,
            new Email(data.email),
            limit
        );

        return sendItemResponse(req, res, item);
    } catch (error) {
        return sendErrorResponse(req, res, error as Exception);
    }
});

export default router;
