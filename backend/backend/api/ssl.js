const express = require('express');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const SslService = require('../services/sslService');

const router = express.Router();

// store acme challenge to the db
router.post('/challenge', async (req, res) => {
    try {
        const data = req.body;

        const acmeChallenge = await SslService.create(data);
        return sendItemResponse(req, res, acmeChallenge);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// fetch an acme challenge
router.get('/challenge/:token', async (req, res) => {
    try {
        const { token } = req.params;
        const acmeChallenge = await SslService.findOneBy({
            token,
        });

        return sendItemResponse(req, res, acmeChallenge);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// fetch keyAuthorization for a token
// api to be consumed from the statuspage
router.get('/challenge/authorization/:token', async (req, res) => {
    try {
        const { token } = req.params;
        const acmeChallenge = await SslService.findOneBy({ token });
        return sendItemResponse(req, res, acmeChallenge.keyAuthorization);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// delete an acme challenge
router.delete('/challenge/:token', async (req, res) => {
    try {
        const { token } = req.params;

        const acmeChallenge = await SslService.deleteBy({ token });
        return sendItemResponse(req, res, acmeChallenge);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;
