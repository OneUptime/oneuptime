/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const express = require('express');

const router = express.Router();
const FileService = require('../services/fileService');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendFileResponse = require('../middlewares/response').sendFileResponse;

// Route Description: Getting uploaded files stored in mongodb.
// Params:
// Param1: req.params-> {filename};
// Returns: response uploaded files, error message

router.get('/:filename', async function (req, res) {
    try{
        const file = await FileService.findOneBy({filename: req.params.filename});
        return sendFileResponse(req, res, file);
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;