import express from 'express';
const router = express.Router();
import LeadService from '../services/leadService';
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;

//Public API to capture leads. Type is Demo or Whitepaper.
router.post('/', async function(req, res) {
    try {
        const body = req.body;
        const data = {};
        if (body.volume) {
            if (typeof body.volume === 'string') {
                body.volume = JSON.parse(body.volume);
            }
        }
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'type' does not exist on type '{}'.
        data.type = body.type;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'name' does not exist on type '{}'.
        data.name = body.fullname;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'email' does not exist on type '{}'.
        data.email = body.email;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'phone' does not exist on type '{}'.
        data.phone = body.phone;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'website' does not exist on type '{}'.
        data.website = body.website;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'companySize' does not exist on type '{}'... Remove this comment to see the full error message
        data.companySize =
            body.volume && body.volume.text ? body.volume.text : null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'country' does not exist on type '{}'.
        data.country = body.country;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'message' does not exist on type '{}'.
        data.message = body.message || null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'whitepaperName' does not exist on type '... Remove this comment to see the full error message
        data.whitepaperName = body.whitepaper_name || null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'source' does not exist on type '{}'.
        data.source = JSON.parse(body.source) || null;
        const lead = await LeadService.create(data);
        return sendItemResponse(req, res, lead);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

export default router;
