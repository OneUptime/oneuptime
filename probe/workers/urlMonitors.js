/* eslint-disable no-console */
const ApiService = require('../utils/apiService');
const ErrorService = require('../utils/errorService');
const ConditionCheck = require('../utils/conditionCheck');
const fetch = require('node-fetch');


// it collects all monitors then ping them one by one to store their response
// checks if the website of the url in the monitors is up or down
// creates incident if a website is down and resolves it when they come back up
module.exports = {
    ping: async (monitor) => {
        if (monitor && monitor.type) {
            if (monitor.data.url) {
                try {
                    var { res, resp } = await pingfetch(monitor.data.url);
                } catch (error) {
                    ErrorService.log('ping.pingFetch', error);
                    throw error;
                }
                try {
                    await pingService(monitor, res, resp);
                } catch (error) {
                    ErrorService.log('ping.pingService', error);
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


var pingService = async (monitor, res, resp) => {
    let validUp = await (monitor && monitor.criteria && monitor.criteria.up ? ConditionCheck.conditions(res, resp, monitor.criteria.up) : false);
    let validDegraded = await (monitor && monitor.criteria && monitor.criteria.degraded ? ConditionCheck.conditions(res, resp, monitor.criteria.degraded) : false);
    let validDown = await (monitor && monitor.criteria && monitor.criteria.down ? ConditionCheck.conditions(res, resp, monitor.criteria.down) : false);
    if (validDown) {
        try {
            await ApiService.setMonitorTime(monitor._id, res, resp.status || null, 'offline');
        } catch (error) {
            ErrorService.log('ApiService.setMonitorTime', error);
            throw error;
        }
    }
    else if (validDegraded) {
        try {
            await ApiService.setMonitorTime(monitor._id, res, resp.status || null, 'degraded');
        } catch (error) {
            ErrorService.log('ApiService.setMonitorTime', error);
            throw error;
        }
    }
    else if (validUp) {
        try {
            await ApiService.setMonitorTime(monitor._id, res, resp.status || null, 'online');
        } catch (error) {
            ErrorService.log('ApiService.setMonitorTime', error);
            throw error;
        }
    }
    else {
        try {
            await ApiService.setMonitorTime(monitor._id, res, resp.status || null, 'unknown');
        } catch (error) {
            ErrorService.log('ApiService.setMonitorTime', error);
            throw error;
        }
    }
};

const pingfetch = async (url) => {
    let now = (new Date()).getTime();
    var resp = null;
    var res = null;
    try {
        resp = await fetch(url, { timeout: 5000 });
        res = (new Date()).getTime() - now;
    } catch (error) {
        resp = error;
    }
    return { res, resp };
};