import express, {
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/Utils/Express';
import {
    sendErrorResponse,
    sendItemResponse,
} from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

import ApiStatusService from '../services/apiStatusService';

const router: $TSFixMe = express.getRouter();

// Store account details to the db
router.get('/', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
        const data: $TSFixMe = {
            status: 'online',
            lastOperation: 'create',
        };

        const response: $TSFixMe = {
            backend: {
                status: 200,
                message: 'Service Status - OK',
                serviceType: 'oneuptime-api',
            },
            database: {
                status: 'Up',
                message: 'Mongodb database connection is healthy',
            },
            redis: {
                status: 'Up',
                message: 'Redis connection is healthy',
            },
        };

        // Handle db related operation to test the health
        try {
            let status: $TSFixMe = await ApiStatusService.findOneBy({
                query: {
                    status: 'online',
                },
                select: 'status lastOperation',
            });

            if (!status) {
                status = await ApiStatusService.create(data);
            }

            if (status) {
                data.lastOperation = 'update';
                status = await ApiStatusService.updateOneBy(
                    { _id: status._id },
                    data
                );
            }
        } catch (error) {
            response.database.status = 'Down';
            response.database.message = error.message;
        }

        // Handle redis related operation to test the health
        try {
            if (global.redisClient) {
                await global.redisClient.set(
                    'status',
                    'Redis status is online'
                );

                const value: $TSFixMe = await global.redisClient.get('status');

                if (!value) {
                    response.redis.status = 'Down';
                    response.redis.message =
                        'There is issue with redis CRUD api';
                }
            }
        } catch (error) {
            response.redis.status = 'Down';
            response.redis.message = error.message;
        }

        return sendItemResponse(req, res, response);
    } catch (error) {
        return sendErrorResponse(req, res, error as Exception);
    }
});

export default router;
