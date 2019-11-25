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
    var endingBefore = req.query.endingBefore;

    if (startingAfter === 'undefined') startingAfter = {};
    if (endingBefore === 'undefined') endingBefore = {};

    try {
        var invoices = await InvoiceService.get(userId, startingAfter, endingBefore);
        
        // modify request query to pass the has_more and total_count props to the response middleware
        req.query.has_more = invoices.has_more;
        req.query.total_count = invoices.total_count;
        return sendListResponse(req, res, invoices.data);
    } catch(error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;