/* eslint-disable no-console */
const ApiService = require('../utils/apiService');
const ErrorService = require('../utils/errorService');
const scriptSandbox = require('../utils/scriptSandbox');

// it collects all monitors then ping them one by one to store their response
// checks if the website of the url in the monitors is up or down
// creates incident if a website is down and resolves it when they come back up
module.exports = {
    run: async monitor => {
        try {
            if (monitor && monitor.type) {
                if (monitor.data.script) {
                    const code = monitor.data.script; // redundant now but may be expanded in future
                    const {
                        success,
                        message,
                        errors,
                    } = await scriptSandbox.runScript(code, true);

                    // convert array to string
                    const errorString = Array.isArray(errors)
                        ? errors.join(', ')
                        : errors;

                    // normalize response
                    const resp = {
                        status: success ? 'success' : 'failed',
                        error: success
                            ? undefined
                            : message + ': ' + errorString,
                    };

                    await ApiService.ping(monitor._id, {
                        monitor,
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
