import express, {
    ExpressRequest,
    ExpressResponse,
} from 'common-server/utils/Express';
const router = express.getRouter();
import InvoiceService from '../services/invoiceService';
import { sendErrorResponse } from 'common-server/utils/response';
import Exception from 'common/types/exception/Exception';

import { sendListResponse } from 'common-server/utils/response';

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
