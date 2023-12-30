import {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
} from '../Utils/Express';
import Response from '../Utils/Response';
import FileService, {
    Service as FileServiceType,
} from '../Services/FileService';
import BaseAPI from './BaseAPI';
import ObjectID from 'Common/Types/ObjectID';
import File from 'Model/Models/File';
import NotFoundException from 'Common/Types/Exception/NotFoundException';

export default class FileAPI extends BaseAPI<File, FileServiceType> {
    public constructor() {
        super(File, FileService);

        this.router.get(
            `${new this.entityType()
                .getCrudApiPath()
                ?.toString()}/image/:imageId`,
            async (
                req: ExpressRequest,
                res: ExpressResponse,
                _next: NextFunction
            ) => {
                const file: File | null = await FileService.findOneById({
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
