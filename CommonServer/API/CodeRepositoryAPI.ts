import UserMiddleware from '../Middleware/UserAuthorization';
import CodeRepositoryService, {
    Service as CodeRepositoryServiceType,
} from '../Services/CodeRepositoryService';
import ServiceRepositoryService from '../Services/ServiceRepositoryService';
import {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
} from '../Utils/Express';
import Response from '../Utils/Response';
import BaseAPI from './BaseAPI';
import { LIMIT_PER_PROJECT } from 'Common/Types/Database/LimitMax';
import BadDataException from 'Common/Types/Exception/BadDataException';
import ObjectID from 'Common/Types/ObjectID';
import CodeRepository from 'Model/Models/CodeRepository';
import ServiceRepository from 'Model/Models/ServiceRepository';

export default class CodeRepositoryAPI extends BaseAPI<
    CodeRepository,
    CodeRepositoryServiceType
> {
    public constructor() {
        super(CodeRepository, CodeRepositoryService);

        this.router.get(
            `${new this.entityType()
                .getCrudApiPath()
                ?.toString()}/get-code-repository/:secretkey`,
            UserMiddleware.getUserMiddleware,
            async (
                req: ExpressRequest,
                res: ExpressResponse,
                next: NextFunction
            ) => {
                try {
                    const secretkey: string = req.params['secretkey']!;

                    if (!secretkey) {
                        throw new BadDataException('Secret key is required');
                    }

                    const codeRepository: CodeRepository | null =
                        await CodeRepositoryService.findOneBy({
                            query: {
                                secretToken: new ObjectID(secretkey),
                            },
                            select: {
                                name: true,
                                mainBranchName: true,
                            },
                            props: {
                                isRoot: true,
                            },
                        });

                    if (!codeRepository) {
                        throw new BadDataException('Code repository not found');
                    }

                    const servicesRepository: Array<ServiceRepository> =
                        await ServiceRepositoryService.findBy({
                            query: {
                                codeRepositoryId: codeRepository.id!,
                                enablePullRequests: true,
                            },
                            select: {
                                serviceCatalog: {
                                    name: true,
                                    _id: true,
                                },
                                servicePathInRepository: true,
                                limitNumberOfOpenPullRequestsCount: true,
                            },
                            limit: LIMIT_PER_PROJECT,
                            skip: 0,
                            props: {
                                isRoot: true,
                            },
                        });

                    return Response.sendJsonObjectResponse(req, res, {
                        codeRepository: CodeRepository.toJSON(
                            codeRepository,
                            CodeRepository
                        ),
                        servicesRepository: ServiceRepository.toJSONArray(
                            servicesRepository,
                            ServiceRepository
                        ),
                    });
                } catch (err) {
                    next(err);
                }
            }
        );
    }
}
