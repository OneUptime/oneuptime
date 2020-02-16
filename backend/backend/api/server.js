/**
 * 
 * Copyright HackerBay, Inc. 
 * 
 */

let express = require('express');
let router = express.Router();

let sendItemResponse = require('../middlewares/response').sendItemResponse;

//This API is used to get the backend response if it's a consumer service deployed on Fyipe Cloud or an Enterprise Service deployed on Enterprise customer's cloud.
router.get('/is-consumer-service', function (req, res) {
    if(process.env['IS_CONSUMER_SERVICE']){
        return sendItemResponse(req, res, {result: true});
    }else{
        return sendItemResponse(req, res, {result: false});
    }
});

module.exports = router;