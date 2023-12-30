import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
    NextFunction,
} from 'CommonServer/Utils/Express';
import BadDataException from 'Common/Types/Exception/BadDataException';
import Reseller from 'Model/Models/Reseller';
import ResellerService from 'CommonServer/Services/ResellerService';
import JSONWebToken from 'CommonServer/Utils/JsonWebToken';
import OneUptimeDate from 'Common/Types/Date';
import Response from 'CommonServer/Utils/Response';

const router: ExpressRouter = Express.getRouter();

router.post(
    '/reseller/auth/:resellerid',
    async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): Promise<void> => {
        try {
            const resellerId: string | undefined = req.params['resellerid'];

            if (!resellerId) {
                throw new BadDataException('Reseller ID not found');
            }

            const username: string = req.body['username'];
            const password: string = req.body['password'];

            if (!username) {
                throw new BadDataException('Username not found');
            }

            if (!password) {
                throw new BadDataException('Password not found');
            }

            // get the reseller user.
            const reseller: Reseller | null = await ResellerService.findOneBy({
                query: {
                    resellerId: resellerId,
                    username: username,
                    password: password,
                },
                select: {
                    _id: true,
                    resellerId: true,
                },
                props: {
                    isRoot: true,
                },
            });

            if (!reseller) {
                throw new BadDataException(
                    'Reseller not found or username and password is incorrect'
                );
            }

            // if found then generate a token and return it.

            const token: string = JSONWebToken.sign(
                { resellerId: resellerId },
                OneUptimeDate.getDayInSeconds(365)
            );

            return Response.sendJsonObjectResponse(req, res, {
                access: token,
            });
        } catch (err) {
            return next(err);
        }
    }
);

export default router;
