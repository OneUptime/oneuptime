import express, { Request, Response } from 'common-server/utils/express';
const router = express.Router();
import LeadService from '../services/leadService';
import {
    sendErrorResponse,
    sendItemResponse,
} from 'common-server/utils/response';

//Public API to capture leads. Type is Demo or Whitepaper.
router.post('/', async function (req: Request, res: Response) {
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
        return sendErrorResponse(req, res, error);
    }
});

export default router;
