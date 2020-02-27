/**
 *
 * Copyright HackerBay, Inc.
 *
 */

const express = require('express');

const router = express.Router();
const UserService = require('../services/userService');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;

// Route
// Description: reset refresh token and access token.
// Params:
// Param 1: req.body-> {refreshToken};
// Returns: 400: Error; 500: Server Error; 200: {
//                                                   jwtAccessToken: token.accessToken,
//                                                   jwtRefreshToken: token.refreshToken,
//                                               }
router.post('/new', async function(req, res) {
    try {
        const jwtRefreshToken = req.body.refreshToken;

        if (!jwtRefreshToken) {
            return sendErrorResponse(req, res, {
                code: 400,
                message: 'Refresh Token not found.',
            });
        }
        const token = await UserService.getNewToken(jwtRefreshToken);
        const tokenData = {
            jwtAccessToken: token.accessToken,
            jwtRefreshToken: token.refreshToken,
        };

        return sendItemResponse(req, res, tokenData);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;
