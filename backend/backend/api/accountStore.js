const express = require('express');
const sendErrorResponse = require('../middlewares/response').sendErrorResponse;
const sendItemResponse = require('../middlewares/response').sendItemResponse;
const AccountStoreService = require('../services/accountStoreService');

const router = express.Router();

// store account details to the db
router.post('/store', async (req, res) => {
    try {
        const data = req.body;

        const account = await AccountStoreService.create(data);
        return sendItemResponse(req, res, account);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// update account details in the db
router.put('/store/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const account = await AccountStoreService.updateOneBy({ id }, req.body);

        return sendItemResponse(req, res, account);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// fetch an account detail
router.get('/store/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const account = await AccountStoreService.findOneBy({
            id,
        });

        return sendItemResponse(req, res, account);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

// delete an account detail
router.delete('/store/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const account = await AccountStoreService.deleteBy({ id });
        return sendItemResponse(req, res, account);
    } catch (error) {
        return sendErrorResponse(req, res, error);
    }
});

module.exports = router;
