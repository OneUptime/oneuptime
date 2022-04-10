import express, {
    ExpressRequest,
    ExpressResponse,
} from 'CommonServer/Utils/Express';
const router = express.getRouter();
import InvoiceService from '../services/invoiceService';
import { sendErrorResponse } from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

import { sendListResponse } from 'CommonServer/Utils/response';

// Description: Getting invoices paid.
// Params:
// Param 1: req.headers-> {token}; req.params-> {userId}
// Returns: 200: "Invoice received"; 400: "Error"
router.post('/:userId', async (req: ExpressRequest, res: ExpressResponse) => {
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
        return sendErrorResponse(req, res, error as Exception);
    }
});

export default router;
