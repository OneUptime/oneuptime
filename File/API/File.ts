import FileModel from 'Common/Models/FileModel';
import NotFoundException from 'Common/Types/Exception/NotFoundException';
import ObjectID from 'Common/Types/ObjectID';
import FileService from 'CommonServer/Services/FileService';
import Express, {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
    ExpressRouter,
} from 'CommonServer/Utils/Express';
import Response from 'CommonServer/Utils/Response';

export default class FileAPI {
    public router!: ExpressRouter;

    public constructor() {
        this.router = Express.getRouter();

        this.router.get(
            `//image/:imageId`,
            async (
                req: ExpressRequest,
                res: ExpressResponse,
                _next: NextFunction
            ) => {
                const file: FileModel | null = await FileService.findOneById({
                    id: new ObjectID(req.params['imageId']!),
                    props: {
                        isRoot: true,
                        ignoreHooks: true,
                    },
                    select: {
                        file: true,
                        type: true,
                    },
                });

                if (!file || !file.file || !file.type) {
                    return Response.sendErrorResponse(
                        req,
                        res,
                        new NotFoundException('File not found')
                    );
                }

                return Response.sendFileResponse(req, res, file);
            }
        );
    }
}
