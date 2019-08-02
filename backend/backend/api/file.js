/**
 *
 * Copyright HackerBay, Inc.
 *
 */

var express = require('express');

var router = express.Router();
var FileService = require('../services/fileService');
var sendErrorResponse = require('../middlewares/response').sendErrorResponse;
var sendFileResponse = require('../middlewares/response').sendFileResponse;

// Route Description: Getting uploaded files stored in mongodb.
// Params:
// Param1: req.params-> {filename};
// Returns: response uploaded files, error message

router.get('/:filename', async function (req, res) {
    try{
        var file = await FileService.findOneBy({filename: req.params.filename});
        return sendFileResponse(req, res, file);
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;