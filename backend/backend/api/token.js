/**
 * 
 * Copyright HackerBay, Inc. 
 * 
 */

var express = require('express');

var router = express.Router();
var UserService = require('../services/userService');
var sendErrorResponse = require('../middlewares/response').sendErrorResponse;
var sendItemResponse = require('../middlewares/response').sendItemResponse;

// Route
// Description: reset refresh token and access token.
// Params:
// Param 1: req.body-> {refreshToken};
// Returns: 400: Error; 500: Server Error; 200: {
//                                                   jwtAccessToken: token.accessToken,
//                                                   jwtRefreshToken: token.refreshToken,
//                                               }
router.post('/new', async function (req, res) {
    try {
        var jwtRefreshToken = req.body.refreshToken;
    
        if(!jwtRefreshToken){
            return sendErrorResponse( req, res, {
                code: 400, 
                message: 'Refresh Token not found.'
            });
        }
        var token = await UserService.getNewToken(jwtRefreshToken);
        var tokenData = {
            jwtAccessToken: token.accessToken,
            jwtRefreshToken: token.refreshToken,
        };
        
        return sendItemResponse(req, res, tokenData);
    } catch(error) {
        return sendErrorResponse(req, res, error);
    }

});

module.exports = router;  