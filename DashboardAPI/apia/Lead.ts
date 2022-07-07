import Express, {
    ExpressRequest,
    ExpressResponse,
    ExpressRouter,
} from 'CommonServer/utils/Express';
const router: ExpressRouter = Express.getRouter();
import LeadService from '../services/leadService';
import {
    sendErrorResponse,
    sendItemResponse,
} from 'CommonServer/Utils/response';
import Exception from 'Common/Types/Exception/Exception';

//Public API to capture leads. Type is Demo or Whitepaper.
router.post('/', async (req: ExpressRequest, res: ExpressResponse) => {
    try {
        const body: $TSFixMe = req.body;
        const data: $TSFixMe = {};
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
        const lead: $TSFixMe = await LeadService.create(data);
        return sendItemResponse(req, res, lead);
    } catch (error) {
        return sendErrorResponse(req, res, error as Exception);
    }
});

export default router;
