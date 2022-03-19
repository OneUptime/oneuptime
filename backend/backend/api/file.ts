import express, {
    Request,
    Response,
    NextFunction,
} from 'common-server/utils/express';

const router = express.getRouter();
import FileService from '../services/fileService';
import { sendErrorResponse } from 'common-server/utils/response';

import { sendFileResponse } from 'common-server/utils/response';

// Route Description: Getting uploaded files stored in mongodb.
// Params:
// Param1: req.params-> {filename};
// Returns: response uploaded files, error message

router.get('/:filename', async function(req: Request, res: Response) {
    try {
        const file = await FileService.findOneBy({
            filename: req.params.filename,
        });
        return sendFileResponse(req, res, file);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

export default router;
