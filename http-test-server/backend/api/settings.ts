// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'expr... Remove this comment to see the full error message
import express from 'express'
import http from 'http'

const router = express.Router();

router.get('/settings', function(req: $TSFixMe, res: $TSFixMe) {
    res.status(200).render('settings.ejs', {
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'httpServerResponse' does not exist on ty... Remove this comment to see the full error message
        data: global.httpServerResponse,
    });
});

router.post('/api/settings', function(req: $TSFixMe, res: $TSFixMe) {
    const { responseTime, statusCode, responseType, header, body } = req.body;
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'httpServerResponse' does not exist on ty... Remove this comment to see the full error message
    let { httpServerResponse } = global;
    const newResponseType = {
        ...httpServerResponse.responseType,
        currentType: responseType,
    };
    httpServerResponse = {
        ...httpServerResponse,
        body,
        header,
        responseTime,
        statusCode,
        responseType: newResponseType,
    };
    if (isNaN(parseInt(responseTime))) {
        httpServerResponse.error = 'Response Time should be a number';
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'httpServerResponse' does not exist on ty... Remove this comment to see the full error message
        global.httpServerResponse = httpServerResponse;
        res.redirect('/settings');
    } else if (isNaN(parseInt(statusCode))) {
        httpServerResponse.error = 'Status code should be a number';
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'httpServerResponse' does not exist on ty... Remove this comment to see the full error message
        global.httpServerResponse = httpServerResponse;
        res.redirect('/settings');
    } else if (!http.STATUS_CODES[statusCode]) {
        httpServerResponse.error = 'Please provide a valid status code';
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'httpServerResponse' does not exist on ty... Remove this comment to see the full error message
        global.httpServerResponse = httpServerResponse;
        res.redirect('/settings');
    } else {
        httpServerResponse.error = null;
        // @ts-expect-error ts-migrate(2339) FIXME: Property 'httpServerResponse' does not exist on ty... Remove this comment to see the full error message
        global.httpServerResponse = httpServerResponse;
        res.redirect('/settings');
    }
});

export default router;
