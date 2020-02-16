/**
 * 
 * Copyright HackerBay, Inc. 
 * 
 */

let express = require('express');

let router = express.Router();
let UserService = require('../services/userService');
let sendErrorResponse = require('../middlewares/response').sendErrorResponse;
let sendItemResponse = require('../middlewares/response').sendItemResponse;

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
        let jwtRefreshToken = req.body.refreshToken;
    
        if(!jwtRefreshToken){
            return sendErrorResponse( req, res, {
                code: 400, 
                message: 'Refresh Token not found.'
            });
        }
        let token = await UserService.getNewToken(jwtRefreshToken);
        let tokenData = {
            jwtAccessToken: token.accessToken,
            jwtRefreshToken: token.refreshToken,
        };
        
        return sendItemResponse(req, res, tokenData);
    } catch(error) {
        return sendErrorResponse(req, res, error);
    }

});

module.exports = router;  