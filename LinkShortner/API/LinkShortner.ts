import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
} from 'CommonServer/Utils/Express';
import Response from 'CommonServer/Utils/Response';
import BadDataException from 'Common/Types/Exception/BadDataException';
import ShortLinkService from 'CommonServer/Services/ShortLinkService';
import ShortLink from 'Model/Models/ShortLink';

const router: ExpressRouter = Express.getRouter();

router.get('/:id', async (req: ExpressRequest, res: ExpressResponse) => {
    

    if (!req.params['id']) {
        return Response.sendErrorResponse(
            req,
            res,
            new BadDataException('id is required')
        );
    }

    if(req.params['id'] === "status"){
        return Response.sendJsonObjectResponse(req, res, {
            status: "ok"
        });
    }

    const link: ShortLink | null = await ShortLinkService.getShortLinkFor(
        req.params['id']
    );

    if (!link || !link.link) {
        return Response.sendErrorResponse(
            req,
            res,
            new BadDataException('This URL is invalid or expired')
        );
    }

    return Response.redirect(req, res, link.link);
});

export default router;
