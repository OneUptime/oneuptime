const express = require('express');
const router = express.Router();
const  validator = require('../middlewares/checkInput')
const licenseService = require('../services/licenseService');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;

router.post('/', async(req, res) => {
    var userDetails = {
        license: req.body.license,
        email: req.body.email
    }

    try{
        validator.checkPayload(userDetails)

        var item = await licenseService.confirmService(userDetails);

        return sendItemResponse(req, res, item)
    }catch(error){
        return sendErrorResponse(req, res, error)
    }
});

module.exports = router;
