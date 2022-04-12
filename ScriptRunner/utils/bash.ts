import { exec } from 'child_process';
import { performance } from 'perf_hooks';

const run = async (script: $TSFixMe): void => {
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
