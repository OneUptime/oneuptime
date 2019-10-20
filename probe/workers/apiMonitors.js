/* eslint-disable no-console */
const ConditionCheck = require('../utils/conditionCheck');
const ApiService = require('../utils/apiService');
const ErrorService = require('../utils/errorService');
const fetch = require('node-fetch');


// it collects all monitors then ping them one by one to store their response
// checks if the website of the url in the monitors is up or down
// creates incident if a website is down and resolves it when they come back up
module.exports = {
    ping: async (monitor) => {
        if (monitor && monitor.type) {
            if (monitor.data.url) {
                try {
                    let headers = await ConditionCheck.headers(monitor.headers, monitor.bodyType);
                    let body = await ConditionCheck.body(monitor && monitor.text && monitor.text.length ? monitor.text : monitor.formData, monitor && monitor.text && monitor.text.length ? 'text' : 'formData');
                    var { res, resp } = await pingfetch(monitor.data.url, monitor.method, body, headers);
                } catch (error) {
                    ErrorService.log('ping.pingFetch', error);
                    throw error;
                }
                try {
                    await ApiService.ping(monitor._id, { monitor, res, resp, type: monitor.type });
                } catch (error) {
                    ErrorService.log('ApiService.ping', error);
                    throw error;
                }
            } else {
                return;
            }
        } else {
            return;
        }
    }
};

var pingfetch = async (url, method, body, headers) => {
    let now = (new Date()).getTime();
    var resp = null;
    var res = null;
    try {
        resp = await fetch(url, {
            method: method,
            body: body,
            headers: headers,
            timeout: 10000
        });
        res = (new Date()).getTime() - now;
    } catch (error) {
        resp = error;
    }
    return { res, resp };
};