/**
 * 
 * Copyright HackerBay, Inc. 
 * 
 */

let express = require('express');
let router = express.Router();
let InvoiceService = require('../services/invoiceService');
let isUserOwner = require('../middlewares/project').isUserOwner;
let getUser = require('../middlewares/user').getUser;
const {
    isAuthorized
} = require('../middlewares/authorization');
let sendErrorResponse = require('../middlewares/response').sendErrorResponse;
let sendListResponse = require('../middlewares/response').sendListResponse;


// Description: Getting invoices paid.
// Params:
// Param 1: req.headers-> {token}; req.params-> {projectId}
// Returns: 200: "Invoice received"; 400: "Error"
router.post('/:projectId', getUser, isAuthorized, isUserOwner, async function (req, res) {
    try {
        let userId = req.user ? req.user.id : null;
        let startingAfter = req.query.startingAfter;
        let endingBefore = req.query.endingBefore;
    
        if (startingAfter === 'undefined') startingAfter = {};
        if (endingBefore === 'undefined') endingBefore = {};
        let invoices = await InvoiceService.get(userId, startingAfter, endingBefore);

        return sendListResponse(req, res, invoices, invoices.data.length);
    } catch(error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;