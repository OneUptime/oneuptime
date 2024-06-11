import BadDataException from 'Common/Types/Exception/BadDataException';
import UserMiddleware from '../Middleware/UserAuthorization';
import CodeRepositoryService, {
    Service as CodeRepositoryServiceType,
} from '../Services/CodeRepositoryService';
import {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
} from '../Utils/Express';
import Response from '../Utils/Response';
import BaseAPI from './BaseAPI';
import CodeRepository from 'Model/Models/CodeRepository';
import ObjectID from 'Common/Types/ObjectID';

export default class CodeRepositoryAPI extends BaseAPI<CodeRepository, CodeRepositoryServiceType> {
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

                    if(!secretkey) {
                        throw new BadDataException('Secret key is required');
                    }

                    const codeRepository: CodeRepository | null = await CodeRepositoryService.findOneBy({
                        query: {
                            secretToken: new ObjectID(secretkey),
                        },
                        select: {
                            name: true,
                        },
                        props: {
                            isRoot: true,
                        },
                    });

                    return Response.sendEntityResponse(req, res, codeRepository, CodeRepository);
                } catch (err) {
                    next(err);
                }
            }
        );
    }
}
