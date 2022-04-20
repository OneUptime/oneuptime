import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
    sendErrorResponse,
    sendFileResponse,
} from 'CommonServer/utils/Express';

const router: ExpressRouter = Express.getRouter();
import FileService from '../services/fileService';
import Exception from 'Common/Types/Exception/Exception';

/*
 * Route Description: Getting uploaded files stored in mongodb.
 * Params:
 * Param1: req.params-> {filename};
 * Returns: response uploaded files, error message
 */

router.get('/:filename', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
        const file: $TSFixMe = await FileService.findOneBy({
            filename: req.params.filename,
        });
        return sendFileResponse(req, res, file);
    } catch (error) {
        return sendErrorResponse(req, res, error as Exception);
    }
});

export default router;
