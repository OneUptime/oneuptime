/**
 *
 * Copyright HackerBay, Inc.
 *
 */

var express = require('express');
var router = express.Router();
var LeadService = require('../services/leadService');
var sendErrorResponse = require('../middlewares/response').sendErrorResponse;
var sendItemResponse = require('../middlewares/response').sendItemResponse;

//Public API to capture leads. Type is Demo or Whitepaper.
router.post('/', async function (req, res) {
    try {
        let body = req.body;
        let data = {};
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
        data.companySize = body.volume && body.volume.text ? body.volume.text : null;
        data.country = body.country;
        data.message = body.message || null;
        data.whitepaperName = body.whitepaper_name || null;
        let lead = await LeadService.create(data);
        return sendItemResponse(req, res, lead);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;