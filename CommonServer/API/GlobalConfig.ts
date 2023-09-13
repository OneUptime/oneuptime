import Probe from 'Model/Models/Probe';
import ProbeService, {
    Service as ProbeServiceType,
} from '../Services/ProbeService';
import {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
} from '../Utils/Express';
import Response from '../Utils/Response';
import BaseAPI from './BaseAPI';
import GlobalConfigService from '../Services/GlobalConfigService';
import ObjectID from 'Common/Types/ObjectID';
import GlobalConfig from 'Model/Models/GlobalConfig';
import BadDataException from 'Common/Types/Exception/BadDataException';

export default class ProbeAPI extends BaseAPI<Probe, ProbeServiceType> {
    public constructor() {
        super(Probe, ProbeService);

        this.router.get(
            `${new this.entityType().getCrudApiPath()?.toString()}/vars`,
            async (
                req: ExpressRequest,
                res: ExpressResponse,
                next: NextFunction
            ) => {
                try {
                    const globalConfig: GlobalConfig | null =
                        await GlobalConfigService.findOneById({
                            id: ObjectID.getZeroObjectID(),
                            select: {
                                host: true,
                                useHttps: true,
                            },
                            props: {
                                isRoot: true,
                            },
                        });

                    if (!globalConfig) {
                        return Response.sendErrorResponse(
                            req,
                            res,
                            new BadDataException('Global Config not found')
                        );
                    }

                    return Response.sendJsonObjectResponse(req, res, {
                        HOST: globalConfig?.host?.toString() || 'localhost',
                        USE_HTTPS: globalConfig?.useHttps || false,
                    });
                } catch (err) {
                    next(err);
                }
            }
        );
    }
}
