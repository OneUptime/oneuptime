import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
    sendListResponse,
} from 'CommonServer/utils/Express';
const router: ExpressRouter = Express.getRouter();
import InvoiceService from '../services/invoiceService';
import { sendErrorResponse } from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

/*
 * Description: Getting invoices paid.
 * Params:
 * Param 1: req.headers-> {token}; req.params-> {userId}
 * Returns: 200: "Invoice received"; 400: "Error"
 */
router.post('/:userId', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
        const userId: $TSFixMe = req.params['userId'];
        let startingAfter: $TSFixMe = req.query['startingAfter'];
        let endingBefore: $TSFixMe = req.query['endingBefore'];

        if (startingAfter === 'undefined') {
            startingAfter = {};
        }
        if (endingBefore === 'undefined') {
            endingBefore = {};
        }
        const invoices: $TSFixMe = await InvoiceService.get(
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
