import { StatusPageCNameRecord } from '../EnvironmentConfig';
import UserMiddleware from '../Middleware/UserAuthorization';
import StatusPageDomainService, {
    Service as StatusPageDomainServiceType,
} from '../Services/StatusPageDomainService';
import {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
} from '../Utils/Express';
import logger from '../Utils/Logger';
import Response from '../Utils/Response';
import BaseAPI from './BaseAPI';
import CommonAPI from './CommonAPI';
import DatabaseCommonInteractionProps from 'Common/Types/BaseDatabase/DatabaseCommonInteractionProps';
import BadDataException from 'Common/Types/Exception/BadDataException';
import ObjectID from 'Common/Types/ObjectID';
import PositiveNumber from 'Common/Types/PositiveNumber';
import StatusPageDomain from 'Model/Models/StatusPageDomain';

export default class StatusPageDomainAPI extends BaseAPI<
    StatusPageDomain,
    StatusPageDomainServiceType
> {
    public constructor() {
        super(StatusPageDomain, StatusPageDomainService);

        // CNAME verification api. THis API will be used from the dashboard to validate the CNAME MANUALLY.
        this.router.get(
            `${new this.entityType()
                .getCrudApiPath()
                ?.toString()}/verify-cname/:id`,
            UserMiddleware.getUserMiddleware,
            async (
                req: ExpressRequest,
                res: ExpressResponse,
                next: NextFunction
            ) => {
                try {
                    if (!StatusPageCNameRecord) {
                        return Response.sendErrorResponse(
                            req,
                            res,
                            new BadDataException(
                                `Custom Domains not enabled for this
                                OneUptime installation. Please contact
                                your server admin to enable this
                                feature.`
                            )
                        );
                    }

                    const databaseProps: DatabaseCommonInteractionProps =
                        await CommonAPI.getDatabaseCommonInteractionProps(req);

                    const id: ObjectID = new ObjectID(
                        req.params['id'] as string
                    );

                    // check if the user can read the domain.

                    const domainCount: PositiveNumber =
                        await StatusPageDomainService.countBy({
                            query: {
                                _id: id.toString(),
                            },
                            props: databaseProps,
                        });

                    if (domainCount.toNumber() === 0) {
                        return Response.sendErrorResponse(
                            req,
                            res,
                            new BadDataException(
                                'The domain does not exist or user does not have access to it.'
                            )
                        );
                    }

                    const domain: StatusPageDomain | null =
                        await StatusPageDomainService.findOneBy({
                            query: {
                                _id: id.toString(),
                            },
                            select: {
                                _id: true,
                                fullDomain: true,
                            },
                            props: {
                                isRoot: true,
                            },
                        });

                    if (!domain) {
                        return Response.sendErrorResponse(
                            req,
                            res,
                            new BadDataException('Invalid token.')
                        );
                    }

                    if (!domain.fullDomain) {
                        return Response.sendErrorResponse(
                            req,
                            res,
                            new BadDataException('Invalid domain.')
                        );
                    }

                    const isValid: boolean =
                        await StatusPageDomainService.isCnameValid(
                            domain.fullDomain!
                        );

                    if (!isValid) {
                        return Response.sendErrorResponse(
                            req,
                            res,
                            new BadDataException(
                                'CNAME is not verified. Please make sure you have the correct record and please verify CNAME again. If you are sure that the record is correct, please wait for some time for the DNS to propagate.'
                            )
                        );
                    }

                    return Response.sendEmptySuccessResponse(req, res);
                } catch (e) {
                    next(e);
                }
            }
        );

        // Provision SSL API. THis API will be used from the dashboard to validate the CNAME MANUALLY.
        this.router.get(
            `${new this.entityType()
                .getCrudApiPath()
                ?.toString()}/order-ssl/:id`,
            UserMiddleware.getUserMiddleware,
            async (
                req: ExpressRequest,
                res: ExpressResponse,
                next: NextFunction
            ) => {
                try {
                    if (!StatusPageCNameRecord) {
                        return Response.sendErrorResponse(
                            req,
                            res,
                            new BadDataException(
                                `Custom Domains not enabled for this
                                OneUptime installation. Please contact
                                your server admin to enable this
                                feature.`
                            )
                        );
                    }

                    const databaseProps: DatabaseCommonInteractionProps =
                        await CommonAPI.getDatabaseCommonInteractionProps(req);

                    const id: ObjectID = new ObjectID(
                        req.params['id'] as string
                    );

                    // check if the user can read the domain.

                    const domainCount: PositiveNumber =
                        await StatusPageDomainService.countBy({
                            query: {
                                _id: id.toString(),
                            },
                            props: databaseProps,
                        });

                    if (domainCount.toNumber() === 0) {
                        return Response.sendErrorResponse(
                            req,
                            res,
                            new BadDataException(
                                'The domain does not exist or user does not have access to it.'
                            )
                        );
                    }

                    const domain: StatusPageDomain | null =
                        await StatusPageDomainService.findOneBy({
                            query: {
                                _id: id.toString(),
                            },
                            select: {
                                _id: true,
                                fullDomain: true,
                                cnameVerificationToken: true,
                                isCnameVerified: true,
                                isSslProvisioned: true,
                            },
                            props: {
                                isRoot: true,
                            },
                        });

                    if (!domain) {
                        return Response.sendErrorResponse(
                            req,
                            res,
                            new BadDataException('Invalid token.')
                        );
                    }

                    if (!domain.cnameVerificationToken) {
                        return Response.sendErrorResponse(
                            req,
                            res,
                            new BadDataException('Invalid token.')
                        );
                    }

                    if (!domain.isCnameVerified) {
                        return Response.sendErrorResponse(
                            req,
                            res,
                            new BadDataException(
                                'CNAME is not verified. Please verify CNAME first before you provision SSL.'
                            )
                        );
                    }

                    if (domain.isSslProvisioned) {
                        return Response.sendErrorResponse(
                            req,
                            res,
                            new BadDataException('SSL is already provisioned.')
                        );
                    }

                    if (!domain.fullDomain) {
                        return Response.sendErrorResponse(
                            req,
                            res,
                            new BadDataException('Invalid domain.')
                        );
                    }

                    logger.debug('Ordering SSL');

                    // provision SSL
                    await StatusPageDomainService.orderCert(domain);

                    logger.debug(
                        'SSL Provisioned for domain - ' + domain.fullDomain
                    );

                    return Response.sendEmptySuccessResponse(req, res);
                } catch (e) {
                    next(e);
                }
            }
        );
    }
}
