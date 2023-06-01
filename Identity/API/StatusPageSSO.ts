import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
    NextFunction,
} from 'CommonServer/Utils/Express';
import BadRequestException from 'Common/Types/Exception/BadRequestException';
import ServerException from 'Common/Types/Exception/ServerException';
import Response from 'CommonServer/Utils/Response';
import StatusPageSsoService from 'CommonServer/Services/StatusPageSsoService';
import ObjectID from 'Common/Types/ObjectID';
import xml2js from 'xml2js';
import { JSONObject } from 'Common/Types/JSON';
import logger from 'CommonServer/Utils/Logger';
import Email from 'Common/Types/Email';
import OneUptimeDate from 'Common/Types/Date';
import PositiveNumber from 'Common/Types/PositiveNumber';
import JSONWebToken from 'CommonServer/Utils/JsonWebToken';
import URL from 'Common/Types/API/URL';
import SSOUtil from '../Utils/SSO';
import Exception from 'Common/Types/Exception/Exception';
import StatusPageSSO from 'Model/Models/StatusPageSso';
import StatusPagePrivateUser from 'Model/Models/StatusPagePrivateUser';
import StatusPagePrivateUserService from 'CommonServer/Services/StatusPagePrivateUserService';
import HashedString from 'Common/Types/HashedString';
import StatusPageService from 'CommonServer/Services/StatusPageService';

const router: ExpressRouter = Express.getRouter();

router.get(
    '/status-page-sso/:statusPageId/:statusPageSsoId',
    async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): Promise<void> => {
        try {
            if (!req.params['statusPageId']) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('Status Page ID not found')
                );
            }

            if (!req.params['statusPageSsoId']) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('Status Page SSO ID not found')
                );
            }

            const statusPageId: ObjectID = new ObjectID(
                req.params['statusPageId']
            );

            const statusPageSSO: StatusPageSSO | null =
                await StatusPageSsoService.findOneBy({
                    query: {
                        statusPageId: statusPageId,
                        _id: req.params['statusPageSsoId'],
                        isEnabled: true,
                    },
                    select: {
                        signOnURL: true,
                    },
                    props: {
                        isRoot: true,
                    },
                });

            if (!statusPageSSO) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('SSO Config not found')
                );
            }

            // redirect to Identity Provider.

            if (!statusPageSSO.signOnURL) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('Sign On URL not found')
                );
            }

            return Response.redirect(req, res, statusPageSSO.signOnURL);
        } catch (err) {
            return next(err);
        }
    }
);

router.post(
    '/status-page-idp-login/:statusPageId/:statusPageSsoId',
    async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
        try {
            const samlResponseBase64: string = req.body.SAMLResponse;

            const samlResponse: string = Buffer.from(
                samlResponseBase64,
                'base64'
            ).toString();

            const response: JSONObject = await xml2js.parseStringPromise(
                samlResponse
            );

            let issuerUrl: string = '';
            let email: Email | null = null;

            if (!req.params['statusPageId']) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('Status Page ID not found')
                );
            }

            if (!req.params['statusPageSsoId']) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('Status Page SSO ID not found')
                );
            }

            const statusPageId: ObjectID = new ObjectID(
                req.params['statusPageId']
            );

            const statusPageSSO: StatusPageSSO | null =
                await StatusPageSsoService.findOneBy({
                    query: {
                        statusPageId: statusPageId,
                        _id: req.params['statusPageSsoId'],
                        isEnabled: true,
                    },
                    select: {
                        signOnURL: true,
                        issuerURL: true,
                        publicCertificate: true,
                        projectId: true,
                    },
                    props: {
                        isRoot: true,
                    },
                });

            if (!statusPageSSO) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('SSO Config not found')
                );
            }

            if (!statusPageSSO.projectId) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('SSO Config Project ID not found')
                );
            }

            const projectId: ObjectID = statusPageSSO.projectId;

            // redirect to Identity Provider.

            if (!statusPageSSO.issuerURL) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('Issuer URL not found')
                );
            }

            // redirect to Identity Provider.

            if (!statusPageSSO.signOnURL) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('Sign on URL not found')
                );
            }

            if (!statusPageSSO.publicCertificate) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('Public Certificate not found')
                );
            }

            try {
                SSOUtil.isPayloadValid(response);

                if (
                    !SSOUtil.isSignatureValid(
                        samlResponse,
                        statusPageSSO.publicCertificate
                    )
                ) {
                    return Response.sendErrorResponse(
                        req,
                        res,
                        new BadRequestException('Signature is not valid')
                    );
                }

                issuerUrl = SSOUtil.getIssuer(response);

                email = SSOUtil.getEmail(response);
            } catch (err: unknown) {
                if (err instanceof Exception) {
                    return Response.sendErrorResponse(req, res, err);
                }
                return Response.sendErrorResponse(
                    req,
                    res,
                    new ServerException()
                );
            }

            if (statusPageSSO.issuerURL.toString() !== issuerUrl) {
                return Response.sendErrorResponse(
                    req,
                    res,
                    new BadRequestException('Issuer URL does not match')
                );
            }

            // Check if he already belongs to the project, If he does - then log in.

            let alreadySavedUser: StatusPagePrivateUser | null =
                await StatusPagePrivateUserService.findOneBy({
                    query: { email: email, statusPageId: statusPageId },
                    select: {
                        _id: true,
                        email: true,
                        statusPageId: true,
                        projectId: true,
                    },
                    props: {
                        isRoot: true,
                    },
                });

            if (!alreadySavedUser) {
                /// Create a user.

                alreadySavedUser = new StatusPagePrivateUser();
                alreadySavedUser.projectId = projectId;
                alreadySavedUser.statusPageId = statusPageId;
                alreadySavedUser.email = email;
                alreadySavedUser.password = new HashedString(
                    ObjectID.generate().toString()
                );
                alreadySavedUser.isSsoUser = true;

                alreadySavedUser = await StatusPagePrivateUserService.create({
                    data: alreadySavedUser,
                    props: { isRoot: true },
                });
            }

            const token: string = JSONWebToken.sign(
                alreadySavedUser,
                OneUptimeDate.getSecondsInDays(new PositiveNumber(30))
            );

            // get status page URL.
            const statusPageURL: string =
                await StatusPageService.getStatusPageURL(statusPageId);

            return Response.redirect(
                req,
                res,
                URL.fromString(statusPageURL).addQueryParams({
                    sso_token: token,
                })
            );
        } catch (err) {
            logger.error(err);
            Response.sendErrorResponse(req, res, new ServerException());
        }
    }
);

export default router;
