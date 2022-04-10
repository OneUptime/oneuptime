import express, {
    ExpressRequest,
    ExpressResponse,
} from 'common-server/Utils/Express';
const router = express.getRouter();
import LeadService from '../Services/leadService';
import {
    sendErrorResponse,
    sendItemResponse,
} from 'common-server/Utils/Response';
import Exception from 'common/types/exception/Exception';

//Public API to capture leads. Type is Demo or Whitepaper.
router.post('/', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
        const body = req.body;
        const data = {};
        if (body.volume) {
            if (typeof body.volume === 'string') {
                body.volume = JSON.parse(body.volume);
            }
        }

        data.type = body.type;

        data.name = body.fullname;

        data.email = body.email;

        data.phone = body.phone;

        data.website = body.website;

        data.companySize =
            body.volume && body.volume.text ? body.volume.text : null;

        data.country = body.country;

        data.message = body.message || null;

        data.whitepaperName = body.whitepaper_name || null;

        data.source = JSON.parse(body.source) || null;
        const lead = await LeadService.create(data);
        return sendItemResponse(req, res, lead);
    } catch (error) {
        return sendErrorResponse(req, res, error as Exception);
    }
});

export default router;
