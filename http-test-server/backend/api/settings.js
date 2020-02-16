let express = require('express');
let http = require('http');

let router = express.Router();

router.get('/settings', function (req, res) {
    res.status(200).render('settings.ejs', {
        data: global.httpServerResponse,
    });
});

router.post('/api/settings', function (req, res) {
    const { responseTime, statusCode, responseType, body } = req.body;
    let { httpServerResponse } = global;
    let newResponseType = {...httpServerResponse.responseType, currentType: responseType};
    httpServerResponse = {
        ...httpServerResponse,
        body,
        responseTime,
        statusCode,
        responseType: newResponseType,
    };
    if (isNaN(parseInt(responseTime))) {
        httpServerResponse.error = 'Response Time should be a number';
        global.httpServerResponse = httpServerResponse;
        res.redirect('/settings');
    } else if (isNaN(parseInt(statusCode))) {
        httpServerResponse.error = 'Status code should be a number';
        global.httpServerResponse = httpServerResponse;
        res.redirect('/settings');
    } else if (!http.STATUS_CODES[statusCode]) {
        httpServerResponse.error = 'Please provide a valid status code';
        global.httpServerResponse = httpServerResponse;
        res.redirect('/settings');
    } else {
        httpServerResponse.error = null;
        global.httpServerResponse = httpServerResponse;
        res.redirect('/settings');
    }
});

module.exports = router;
