const express = require('express');
const router = express.Router();
const { confirmLicense } = require('../services/licenseServices');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;

router.post('/', async(req, res) => {
    var userDetails = {
        license: req.body.license,
        email: req.body.email
    }

    try{
        var item = await confirmLicense(userDetails)
        return sendItemResponse(req, res, item)
    }catch(error){
        return sendErrorResponse(req, res, error)
    }
});

module.exports = router;
