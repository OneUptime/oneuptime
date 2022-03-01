import express from 'express';
const router = express.Router();
import InvoiceService from '../services/invoiceService';
import { sendErrorResponse } from 'common-server/utils/response';

import { sendListResponse } from 'common-server/utils/response';

// Description: Getting invoices paid.
// Params:
// Param 1: req.headers-> {token}; req.params-> {userId}
// Returns: 200: "Invoice received"; 400: "Error"
router.post('/:userId', async function(req: Request, res: Response) {
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

export default router;
