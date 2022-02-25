import ApiService from '../utils/apiService'
import ErrorService from '../utils/errorService'
import { run: runScript } from '../utils/scriptSandbox'

// it collects all monitors then ping them one by one to store their response
export default {
    run: async monitor => {
        try {
            if (monitor && monitor.type === 'script') {
                if (monitor.data.script) {
                    const code = monitor.data.script; // redundant now but may be expanded in future
                    const {
                        success,
                        message,
                        errors,
                        status,
                        executionTime,
                        consoleLogs,
                    } = await runScript(code, true);

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
                    });
                }
            }
        } catch (error) {
            ErrorService.log('scriptMonitors.run', error);
            throw error;
        }
    },
};
