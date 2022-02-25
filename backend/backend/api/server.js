import express from 'express'
const router = express.Router();

import { IS_SAAS_SERVICE } from '../config/server'
const sendItemResponse = require('../middlewares/response').sendItemResponse;

//This API is used to get the backend response if it's a consumer service deployed on OneUptime Cloud or an Enterprise Service deployed on Enterprise customer's cloud.
router.get('/is-saas-service', function(req, res) {
    if (IS_SAAS_SERVICE) {
        return sendItemResponse(req, res, { result: true });
    } else {
        return sendItemResponse(req, res, { result: false });
    }
});

router.get('/hosts', function(req, res) {
    return sendItemResponse(req, res, {
        api: global.apiHost,
        home: global.homeHost,
        accounts: global.accountsHost,
        dashboard: global.dashboardHost,
    });
});

export default router;
