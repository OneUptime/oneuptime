/* eslint-disable no-console */
const ApiService = require('../utils/apiService');
const ErrorService = require('../utils/errorService');
const { NodeVM } = require('vm2');

const vm = new NodeVM({
    timeout: 30000,
    console: 'inherit',
    sandbox: {},
    require: {
        external: true,
        root: './',
    },
});

// it collects all monitors then ping them one by one to store their response
// checks if the website of the url in the monitors is up or down
// creates incident if a website is down and resolves it when they come back up
module.exports = {
    run: async monitor => {
        try {
            if (monitor && monitor.type) {
                if (monitor.data.script) {
                    const code = `const axios = require('axios');
                    const lighthouse = require('lighthouse');
                    module.exports = (success, error) => {
                        ${monitor.data.script}
                    }`;
                    const { res, resp } = await runScript(code);
                    await ApiService.ping(monitor._id, {
                        monitor,
                        res,
                        resp,
                        type: monitor.type,
                    });
                }
            }
        } catch (error) {
            ErrorService.log('scriptMonitors.run', error);
            throw error;
        }
    },
};

const runScript = async code => {
    const now = new Date().getTime();
    let resp = null;
    let res = null;
    const success = value => {
        res = new Date().getTime() - now;
        resp = { status: 'success', body: value };
    };

    const error = value => {
        res = new Date().getTime() - now;
        resp = { status: 'failed', body: value };
    };
    try {
        const vmRunner = vm.run(code, 'vm.js');
        vmRunner(success, error);
    } catch (err) {
        res = new Date().getTime() - now;
        resp = { status: 'timeout', body: err };
    }
    return { res, resp };
};
