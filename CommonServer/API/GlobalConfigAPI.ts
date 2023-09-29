import GlobalConfig from 'Model/Models/GlobalConfig';
import GlobalConfigService, {
    Service as GlobalConfigServiceType,
} from '../Services/GlobalConfigService';
import {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
} from '../Utils/Express';
import Response from '../Utils/Response';
import BaseAPI from './BaseAPI';
// import ObjectID from 'Common/Types/ObjectID';

export default class GlobalConfigAPI extends BaseAPI<
    GlobalConfig,
    GlobalConfigServiceType
> {
    public constructor() {
        super(GlobalConfig, GlobalConfigService);

        this.router.get(
            `${new this.entityType().getCrudApiPath()?.toString()}/vars`,
            async (
                req: ExpressRequest,
                res: ExpressResponse,
                next: NextFunction
            ) => {
                try {
                    // const globalConfig: GlobalConfig | null =
                    //     await GlobalConfigService.findOneById({
                    //         id: ObjectID.getZeroObjectID(),
                    //         select: {
                    //             useHttps: true,
                    //         },
                    //         props: {
                    //             isRoot: true,
                    //         },
                    //     });

                    return Response.sendJsonObjectResponse(req, res, {
                        // USE_HTTPS:
                        //     globalConfig?.useHttps?.toString() || 'false',
                    });
                } catch (err) {
                    next(err);
                }
            }
        );
    }
}
