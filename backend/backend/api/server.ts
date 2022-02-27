import express from 'express';
const router = express.Router();

// @ts-expect-error ts-migrate(2614) FIXME: Module '"../config/server"' has no exported member... Remove this comment to see the full error message
import { IS_SAAS_SERVICE } from '../config/server';
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
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'apiHost' does not exist on type 'Global ... Remove this comment to see the full error message
        api: global.apiHost,
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'homeHost' does not exist on type 'Global... Remove this comment to see the full error message
        home: global.homeHost,
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'accountsHost' does not exist on type 'Gl... Remove this comment to see the full error message
        accounts: global.accountsHost,
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'dashboardHost' does not exist on type 'G... Remove this comment to see the full error message
        dashboard: global.dashboardHost,
    });
});

export default router;
