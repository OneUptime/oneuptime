const { exec } = require('child_process');
const { performance } = require('perf_hooks');

const run = async script => {
    const start = performance.now();
    return new Promise(resolve => {
        exec(script, (err, stdout) => {
            if (err) {
                return resolve({
                    success: false,
                    errors: err.message,
                    status: 'failed',
                    executionTime: performance.now() - start,
                    consoleLogs: err.message,
                });
            } else {
                resolve({
                    success: true,
                    status: 'success',
                    executionTime: performance.now() - start,
                    consoleLogs: stdout,
                });
            }
        });
    });
};

module.exports.run = run;
