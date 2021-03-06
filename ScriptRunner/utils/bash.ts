import { exec } from 'child_process';
import { performance } from 'perf_hooks';

const run: Function = async (script: $TSFixMe): void => {
    const start: $TSFixMe = performance.now();
    return new Promise((resolve: $TSFixMe) => {
        exec(script, (err: $TSFixMe, stdout: $TSFixMe) => {
            if (err) {
                return resolve({
                    success: false,
                    errors: err.message,
                    status: 'failed',
                    executionTime: performance.now() - start,
                    consoleLogs: err.message,
                });
            }
            resolve({
                success: true,
                status: 'success',
                executionTime: performance.now() - start,
                consoleLogs: stdout,
            });
        });
    });
};

module.exports.run = run;
