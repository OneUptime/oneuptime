/**
 * 
 * Copyright HackerBay, Inc. 
 * 
 */

var express = require('express');
var router = express.Router();
var InvoiceService = require('../services/invoiceService');
var isUserOwner = require('../middlewares/project').isUserOwner;
let getUser = require('../middlewares/user').getUser;
const {
    isAuthorized
} = require('../middlewares/authorization');
var sendErrorResponse = require('../middlewares/response').sendErrorResponse;
var sendListResponse = require('../middlewares/response').sendListResponse;


// Description: Getting invoices paid.
// Params:
// Param 1: req.headers-> {token}; req.params-> {projectId}
// Returns: 200: "Invoice received"; 400: "Error"
router.post('/:projectId', getUser, isAuthorized, isUserOwner, async function (req, res) {
    var userId = req.user ? req.user.id : null;
    var startingAfter = req.query.startingAfter;

    if (startingAfter === 'undefined') startingAfter = {};

    try{
        var invoices = await InvoiceService.get(userId, startingAfter);
        return sendListResponse(req, res, invoices);
    }catch(error){
        return sendErrorResponse(req, res, error);
    }
});


module.exports = router;