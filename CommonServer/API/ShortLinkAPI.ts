import ShortLinkService, {
    Service as ShortLinkServiceType,
} from '../Services/ShortLinkService';
import { ExpressRequest, ExpressResponse } from '../Utils/Express';
import Response from '../Utils/Response';
import BaseAPI from './BaseAPI';
import BadDataException from 'Common/Types/Exception/BadDataException';
import ShortLink from 'Model/Models/ShortLink';

export default class ShortLinkAPI extends BaseAPI<
    ShortLink,
    ShortLinkServiceType
> {
    public constructor() {
        super(ShortLink, ShortLinkService);

        this.router.get(
            `${new this.entityType()
                .getCrudApiPath()
                ?.toString()}/redirect-to-shortlink/:id`,
            async (req: ExpressRequest, res: ExpressResponse) => {
                if (!req.params['id']) {
                    return Response.sendErrorResponse(
                        req,
                        res,
                        new BadDataException('id is required')
                    );
                }

                if (req.params['id'] === 'status') {
                    return Response.sendJsonObjectResponse(req, res, {
                        status: 'ok',
                    });
                }

                const link: ShortLink | null =
                    await ShortLinkService.getShortLinkFor(req.params['id']);

                if (!link || !link.link) {
                    return Response.sendErrorResponse(
                        req,
                        res,
                        new BadDataException('This URL is invalid or expired')
                    );
                }

                return Response.redirect(req, res, link.link);
            }
        );
    }
}
