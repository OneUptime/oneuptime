import express, {
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/Utils/Express';

const router: $TSFixMe = express.getRouter();
import FileService from '../services/fileService';
import { sendErrorResponse } from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

import { sendFileResponse } from 'CommonServer/Utils/response';

// Route Description: Getting uploaded files stored in mongodb.
// Params:
// Param1: req.params-> {filename};
// Returns: response uploaded files, error message

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
