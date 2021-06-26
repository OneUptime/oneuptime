/* eslint-disable no-console */
const ApiService = require('../utils/apiService');
const ErrorService = require('../utils/errorService');
const scriptSandbox = require('../utils/scriptSandbox');

// it collects all monitors then ping them one by one to store their response
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
                        status,
                        executionTime,
                        consoleLogs,
                    } = await scriptSandbox.runScript(code, true);

                    // normalize response
                    const resp = {
                        success,
                        statusText: status,
                        error: success ? undefined : message + ': ' + errors,
                        executionTime,
                        consoleLogs,
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
