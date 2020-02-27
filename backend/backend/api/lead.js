/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const express = require('express');
const router = express.Router();
const LeadService = require('../services/leadService');
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
        const lead = await LeadService.create(data);
        return sendItemResponse(req, res, lead);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;
