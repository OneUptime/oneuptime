/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const express = require('express');
const router = express.Router();
const InvoiceService = require('../services/invoiceService');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendListResponse = require('../middlewares/response').sendListResponse;

// Description: Getting invoices paid.
// Params:
// Param 1: req.headers-> {token}; req.params-> {userId}
// Returns: 200: "Invoice received"; 400: "Error"
router.post('/:userId', async function(req, res) {
    try {
        const userId = req.params.userId;
        let startingAfter = req.query.startingAfter;
        let endingBefore = req.query.endingBefore;

        if (startingAfter === 'undefined') startingAfter = {};
        if (endingBefore === 'undefined') endingBefore = {};
        const invoices = await InvoiceService.get(
            userId,
            startingAfter,
            endingBefore
        );

        return sendListResponse(req, res, invoices, invoices.data.length);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;
