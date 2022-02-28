import express from 'express';

const router = express.Router();
import FileService from '../services/fileService';
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendFileResponse = require('../middlewares/response').sendFileResponse;

// Route Description: Getting uploaded files stored in mongodb.
// Params:
// Param1: req.params-> {filename};
// Returns: response uploaded files, error message

router.get('/:filename', async function(req:express.Request, res: express.Response) {
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
