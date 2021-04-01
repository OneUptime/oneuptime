const express = require('express');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const CertificateStoreService = require('../services/certificateStoreService');

const router = express.Router();

// store certificate details to the db
router.post('/store', async (req, res) => {
    try {
        const data = req.body;

        const certificate = await CertificateStoreService.create(data);
        return sendItemResponse(req, res, certificate);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// update certificate details in the db
router.put('/store/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const certificate = await CertificateStoreService.updateOneBy(
            { id },
            req.body
        );

        return sendItemResponse(req, res, certificate);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// fetch a certificate detail
router.get('/store/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const certificate = await CertificateStoreService.findOneBy({
            id,
        });

        return sendItemResponse(req, res, certificate);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// fetch a certificate by the subject
// called from the status page project
router.get('/store/cert/:subject', async (req, res) => {
    try {
        const { subject } = req.params;
        const certificate = await CertificateStoreService.findOneBy({
            subject,
        });

        return sendItemResponse(req, res, certificate);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// delete an certificate detail
router.delete('/store/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const certificate = await CertificateStoreService.deleteBy({ id });
        return sendItemResponse(req, res, certificate);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;
