import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
} from 'CommonServer/Utils/Express';
import PositiveNumber from 'Common/Types/PositiveNumber';
const router: ExpressRouter = Express.getRouter();
import Response from 'CommonServer/Utils/Response';
import Email from 'Common/Types/Email';
import BadDataException from 'Common/Types/Exception/BadDataException';

import LicenseService from '../Services/LicenseService';
import Exception from 'Common/Types/Exception/Exception';
import { JSONObject } from 'Common/Types/JSON';

router.post('/', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
        const data: JSONObject = req.body;

        if (!data['license']) {
            return Response.sendErrorResponse(
                req,
                res,
                new BadDataException('License must be present.')
            );
        }

        if (typeof data['license'] !== 'string') {
            return Response.sendErrorResponse(
                req,
                res,
                new BadDataException('License is not in string format.')
            );
        }

        if (!data['email']) {
            return Response.sendErrorResponse(
                req,
                res,
                new BadDataException('Email must be present.')
            );
        }

        if (typeof data['email'] !== 'string') {
            return Response.sendErrorResponse(
                req,
                res,
                new BadDataException('Email is not in string format.')
            );
        }

        const limit: PositiveNumber = new PositiveNumber(
            parseInt((req.query['limit'] as string) || '100')
        );

        const item: string = await LicenseService.confirm(
            data['license'],
            new Email(data['email']),
            limit
        );

        return Response.sendItemResponse(req, res, { license: item });
    } catch (error) {
        return Response.sendErrorResponse(req, res, error as Exception);
    }
});

export default router;
