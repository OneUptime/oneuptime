import {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
} from 'CommonServer/Utils/Express';
import { ProbeExpressRequest } from '../Types/Request';
import BadRequestException from 'Common/Types/Exception/BadRequestException';
import GlobalCache from 'CommonServer/Infrastructure/GlobalCache';
import DiskSize from 'Common/Types/DiskSize';
import ObjectID from 'Common/Types/ObjectID';
import UsageBillingService from 'CommonServer/Services/UsageBillingService';
import { ProductType } from 'Model/Models/UsageBilling';
import TelemetryServiceService from 'CommonServer/Services/TelemetryServiceService';
import TelemetryService from 'Model/Models/TelemetryService';
import logger from 'CommonServer/Utils/Logger';

export interface TelemetryRequest extends ExpressRequest {
    serviceId: ObjectID; // Service ID
    projectId: ObjectID; // Project ID
    productType: ProductType; // what is the product type of the request - logs, metrics or traces.
}

export default class TelemetryIngest {
    public static async isAuthorizedServiceMiddleware(
        req: ProbeExpressRequest,
        _res: ExpressResponse,
        next: NextFunction
    ): Promise<void> {
        try {
            // check header.

            const serviceTokenInHeader: string | undefined = req.headers[
                'x-oneuptime-service-token'
            ] as string | undefined;

            if (!serviceTokenInHeader) {
                throw new BadRequestException(
                    'Missing header: x-oneuptime-service-token'
                );
            }

            // size of req.body in bytes.
            const sizeInBytes: number = Buffer.byteLength(
                JSON.stringify(req.body)
            );

            const sizeToGb: number = DiskSize.byteSizeToGB(sizeInBytes);

            const cachedServiceId: string | null = await GlobalCache.getString(
                'service-token',
                serviceTokenInHeader as string
            );
            
            const serviceProjectId: string | null = await GlobalCache.getString(
                'service-project-id',
                serviceTokenInHeader as string
            );

            if (!cachedServiceId || !serviceProjectId) {
                // load from the database and set the cache.
                const service: TelemetryService | null =
                    await TelemetryServiceService.findOneBy({
                        query: {
                            telemetryServiceToken: new ObjectID(
                                serviceTokenInHeader as string
                            ),
                        },
                        select: {
                            _id: true,
                            projectId: true,
                        },
                        props: {
                            isRoot: true,
                        },
                    });

                if (!service) {
                    throw new BadRequestException('Invalid service token');
                }

                await GlobalCache.setString(
                    'service-token',
                    serviceTokenInHeader as string,
                    service._id?.toString() as string
                );
                await GlobalCache.setString(
                    'service-project-id',
                    serviceTokenInHeader as string,
                    service.projectId?.toString() as string
                );

                (req as TelemetryRequest).serviceId = service.id as ObjectID;
                (req as TelemetryRequest).projectId =
                    service.projectId as ObjectID;
            }

            (req as TelemetryRequest).serviceId = ObjectID.fromString(
                cachedServiceId as string
            );
            (req as TelemetryRequest).projectId = ObjectID.fromString(
                serviceProjectId as string
            );

            // report to Usage Service.
            UsageBillingService.updateUsageBilling({
                projectId: (req as TelemetryRequest).projectId,
                productType: (req as TelemetryRequest).productType,
                usageCount: sizeToGb,
            }).catch((err: Error) => {
                logger.error('Failed to update usage billing for OTel');
                logger.error(err);
            });

            next();
        } catch (err) {
            return next(err);
        }
    }
}
