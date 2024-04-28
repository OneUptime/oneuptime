import StatusPageDomain from 'Model/Models/StatusPageDomain';
import BaseAPI from './BaseAPI';
import StatusPageDomainService, {
    Service as StatusPageDomainServiceType,
} from '../Services/StatusPageDomainService';
import { ExpressRequest, ExpressResponse, NextFunction } from '../Utils/Express';
import BadDataException from 'Common/Types/Exception/BadDataException';
import Response from '../Utils/Response';
import ObjectID from 'Common/Types/ObjectID';
import UserMiddleware from '../Middleware/UserAuthorization';
import DatabaseCommonInteractionProps from 'Common/Types/BaseDatabase/DatabaseCommonInteractionProps';
import CommonAPI from './CommonAPI';

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
            async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
                try {
                    const databaseProps: DatabaseCommonInteractionProps =
                        await CommonAPI.getDatabaseCommonInteractionProps(req);

                    const id: ObjectID = new ObjectID(req.params['id'] as string);

                    const domain: StatusPageDomain | null =
                        await StatusPageDomainService.findOneBy({
                            query: {
                                id: id,
                            },
                            select: {
                                _id: true,
                                fullDomain: true,
                                cnameVerificationToken: true,
                            },
                            props: databaseProps,
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

                    if (!domain.fullDomain) {
                        return Response.sendErrorResponse(
                            req,
                            res,
                            new BadDataException('Invalid domain.')
                        );
                    }

                    const isValid: boolean =
                        await StatusPageDomainService.isCnameValid(
                            domain.fullDomain!,
                            domain.cnameVerificationToken!
                        );

                    if (isValid) {
                        // mark as verified.
                        await StatusPageDomainService.updateOneById({
                            id: domain.id!,
                            data: {
                                isCnameVerified: true,
                            },
                            props: {
                                isRoot: true,
                            },
                        });
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
                ?.toString()}/provision-ssl/:id`,
            UserMiddleware.getUserMiddleware,
            async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
                try {
                    const databaseProps: DatabaseCommonInteractionProps =
                        await CommonAPI.getDatabaseCommonInteractionProps(req);

                    const id: ObjectID = new ObjectID(req.params['id'] as string);

                    const domain: StatusPageDomain | null =
                        await StatusPageDomainService.findOneBy({
                            query: {
                                id: id,
                            },
                            select: {
                                _id: true,
                                fullDomain: true,
                                cnameVerificationToken: true,
                                isCnameVerified: true,
                                isSslProvisioned: true,
                                isAddedToGreenlock: true,
                            },
                            props: databaseProps,
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

                    // check cname again, just to be sure.
                    const isCnameValid: boolean =
                        await StatusPageDomainService.isCnameValid(
                            domain.fullDomain!,
                            domain.cnameVerificationToken!
                        );

                    if (!isCnameValid) {
                        await StatusPageDomainService.updateOneById({
                            id: domain.id!,
                            data: {
                                isCnameVerified: false,
                            },
                            props: {
                                isRoot: true,
                            },
                        });

                        return Response.sendErrorResponse(
                            req,
                            res,
                            new BadDataException(
                                'CNAME is not verified. Please verify CNAME first before you provision SSL.'
                            )
                        );
                    }

                    // add to greenlock.

                    if (!domain.isAddedToGreenlock) {
                        await StatusPageDomainService.addDomainToGreenlock(domain);
                    }

                    // provision SSL
                    await StatusPageDomainService.orderCert(domain);

                    return Response.sendEmptySuccessResponse(req, res);
                } catch (e) {
                    next(e);
                }
            }

        );
    }
}
