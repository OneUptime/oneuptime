import ObjectID from 'Common/Types/ObjectID';
import StatusPage from 'Model/Models/StatusPage';
import UserMiddleware from '../Middleware/UserAuthorization';
import StatusPageService, {
    Service as StatusPageServiceType,
} from '../Services/StatusPageService';
import Populate from '../Types/Database/Populate';
import Select from '../Types/Database/Select';
import {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
} from '../Utils/Express';
import BaseAPI from './BaseAPI';
import Response from '../Utils/Response';
import NotAuthorizedException from 'Common/Types/Exception/NotAuthorizedException';
import BadDataException from 'Common/Types/Exception/BadDataException';
import BaseModel from 'Common/Models/BaseModel';
import StatusPageFooterLinkService from '../Services/StatusPageFooterLinkService';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import StatusPageFooterLink from 'Model/Models/StatusPageFooterLink';
import StatusPageHeaderLinkService from '../Services/StatusPageHeaderLinkService';
import StatusPageHeaderLink from 'Model/Models/StatusPageHeaderLink';
import StatusPageDomain from 'Model/Models/StatusPageDomain';
import StatusPageDomainService from '../Services/StatusPageDomainService';
import { JSONObject } from 'Common/Types/JSON';

export default class StatusPageAPI extends BaseAPI<
    StatusPage,
    StatusPageServiceType
> {
    public constructor() {
        super(StatusPage, StatusPageService);

        this.router.post(
            `/${new this.entityType().getCrudApiPath()?.toString()}/domain`,
            UserMiddleware.getUserMiddleware,
            async (
                req: ExpressRequest,
                res: ExpressResponse,
                next: NextFunction
            ) => {
                try {
                    if (req.body['domain']) {
                        throw new BadDataException(
                            'domain is required in request body'
                        );
                    }

                    const domain: string = req.body['domain'] as string;

                    const statusPageDomain: StatusPageDomain | null =
                        await StatusPageDomainService.findOneBy({
                            query: {
                                fullDomain: domain,
                                domain: {
                                    isVerified: true,
                                } as any,
                            },
                            select: {
                                statusPageId: true,
                            },
                            props: {
                                isRoot: true,
                            },
                        });

                    if (!statusPageDomain) {
                        throw new BadDataException(
                            'No status page found with this domain'
                        );
                    }

                    const objectId: ObjectID = statusPageDomain.statusPageId!;

                    if (
                        !(await this.service.hasReadAccess(
                            objectId,
                            this.getDatabaseCommonInteractionProps(req)
                        ))
                    ) {
                        throw new NotAuthorizedException(
                            'You are not authorize to access this status page'
                        );
                    }

                    return Response.sendJsonObjectResponse(req, res, {
                        statusPageId: objectId.toString(),
                    });
                } catch (err) {
                    next(err);
                }
            }
        );

        this.router.post(
            `/${new this.entityType()
                .getCrudApiPath()
                ?.toString()}/master-page/:id`,
            UserMiddleware.getUserMiddleware,
            async (
                req: ExpressRequest,
                res: ExpressResponse,
                next: NextFunction
            ) => {
                try {
                    const objectId: ObjectID = new ObjectID(
                        req.params['id'] as string
                    );

                    if (
                        !(await this.service.hasReadAccess(
                            objectId,
                            this.getDatabaseCommonInteractionProps(req)
                        ))
                    ) {
                        throw new NotAuthorizedException(
                            'You are not authorize to access this status page'
                        );
                    }

                    const select: Select<StatusPage> = {
                        _id: true,
                        slug: true,
                        coverImageFileId: true,
                        logoFileId: true,
                        showAnouncementsPage: true,
                        showFooter: true,
                        showHeader: true,
                        showIncidentsPage: true,
                        showNavbar: true,
                        showOverviewPage: true,
                        showRssPage: true,
                        showScheduledMaintenancePage: true,
                        pageTextColor: true,
                        footerTextColor: true,
                        headerTextColor: true,
                        navBarTextColor: true,
                        pageTitle: true,
                        pageDescription: true,
                        pageBackgroundColor: true,
                        bannerBackgroundColor: true,
                        footerBackgroundColor: true,
                        headerBackgroundColor: true,
                        navBarBackgroundColor: true,
                        copyrightText: true,
                        customCSS: true,
                        customJavaScript: true,
                        headerHTML: true,
                        footerHTML: true,
                        enableSubscribers: true,
                    };

                    const populate: Populate<StatusPage> = {};

                    const item: StatusPage | null =
                        await this.service.findOneById({
                            id: objectId,
                            select,
                            populate,
                            props: this.getDatabaseCommonInteractionProps(req),
                        });

                    if (!item) {
                        throw new BadDataException('Status Page not found');
                    }

                    const footerLinks: Array<StatusPageFooterLink> =
                        await StatusPageFooterLinkService.findBy({
                            query: {
                                statusPageId: objectId,
                            },
                            select: {
                                _id: true,
                                link: true,
                                title: true,
                            },
                            populate: {},
                            limit: LIMIT_PER_PROJECT,
                            skip: 0,
                            props: {
                                isRoot: true,
                            },
                        });

                    const headerLinks: Array<StatusPageHeaderLink> =
                        await StatusPageHeaderLinkService.findBy({
                            query: {
                                statusPageId: objectId,
                            },
                            select: {
                                _id: true,
                                link: true,
                                title: true,
                            },
                            limit: LIMIT_PER_PROJECT,
                            skip: 0,
                            props: {
                                isRoot: true,
                            },
                        });

                    const response: JSONObject = {
                        statusPage: BaseModel.toJSON(item, StatusPage),
                        footerLinks: BaseModel.toJSONArray(
                            footerLinks,
                            StatusPageFooterLink
                        ),
                        headerLinks: BaseModel.toJSONArray(
                            headerLinks,
                            StatusPageHeaderLink
                        ),
                    };

                    return Response.sendJsonObjectResponse(req, res, response);
                } catch (err) {
                    next(err);
                }
            }
        );

        this.router.post(
            `/${new this.entityType()
                .getCrudApiPath()
                ?.toString()}/overview/:id`,
            UserMiddleware.getUserMiddleware,
            async (
                req: ExpressRequest,
                res: ExpressResponse,
                next: NextFunction
            ) => {
                try {
                    const objectId: ObjectID = new ObjectID(
                        req.params['id'] as string
                    );

                    if (
                        !(await this.service.hasReadAccess(
                            objectId,
                            this.getDatabaseCommonInteractionProps(req)
                        ))
                    ) {
                        throw new NotAuthorizedException(
                            'You are not authorize to access this status page'
                        );
                    }

                    const response: JSONObject = {};

                    return Response.sendJsonObjectResponse(req, res, response);
                } catch (err) {
                    next(err);
                }
            }
        );
    }
}
