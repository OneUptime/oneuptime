/* eslint-disable no-console */
const ApiService = require('../utils/apiService');
const ErrorService = require('../utils/errorService');
const fetch = require('node-fetch');


// it collects all monitors then ping them one by one to store their response
// checks if the website of the url in the monitors is up or down
// creates incident if a website is down and resolves it when they come back up
module.exports = {
    ping: async (monitor) => {
        try {
            if (monitor && monitor.type) {
                if (monitor.data.url) {

                    const headers = await ApiService.headers(monitor.headers, monitor.bodyType);
                    const body = await ApiService.body(monitor && monitor.text && monitor.text.length ? monitor.text : monitor.formData, monitor && monitor.text && monitor.text.length ? 'text' : 'formData');
                    const { res, resp } = await pingfetch(monitor.data.url, monitor.method, body, headers);


                    await ApiService.ping(monitor._id, { monitor, res, resp, type: monitor.type });
                }
            }
        } catch (error) {
            ErrorService.log('apiMonitors.ping', error);
            throw error;
        }
    }
};

const pingfetch = async (url, method, body, headers) => {
    const now = (new Date()).getTime();
    let resp = null;
    let res = null;
    try {
        const response = await fetch(url, {
            method: method,
            body: body,
            headers: headers,
            timeout: 30000
        });
        const data = await response.json();
        resp = { status: response.status, body: data };
    } catch (error) {
        resp = { status: 408, body: error };
    }
    res = (new Date()).getTime() - now;
    return { res, resp };
};