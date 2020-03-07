const express = require('express');
const router = express.Router();
const  validator = require('../middlewares/checkInput')
const LicenseService = require('../services/licenseService');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;

router.post('/', validator, async(req, res) => {
    var userDetails = {
        license: req.body.license,
        email: req.body.email
    }

    try{
        var item = await LicenseService.confirm(userDetails);

        return sendItemResponse(req, res, item)
    }catch(error){
        return sendErrorResponse(req, res, error)
    }
});

module.exports = router;
