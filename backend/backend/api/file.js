/**
 *
 * Copyright HackerBay, Inc.
 *
 */

let express = require('express');

let router = express.Router();
let FileService = require('../services/fileService');
let sendErrorResponse = require('../middlewares/response').sendErrorResponse;
let sendFileResponse = require('../middlewares/response').sendFileResponse;

// Route Description: Getting uploaded files stored in mongodb.
// Params:
// Param1: req.params-> {filename};
// Returns: response uploaded files, error message

router.get('/:filename', async function (req, res) {
    try{
        let file = await FileService.findOneBy({filename: req.params.filename});
        return sendFileResponse(req, res, file);
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;