import { join } from 'path';
import { performance } from 'perf_hooks';
import { isMainThread, Worker, parentPort, workerData } from 'worker_threads';

// TODO - make this configurable from AdminDashboard
const runConfig: $TSFixMe = {
    availableImports: ['axios', 'request'], // Init allowed modules
    maxSyncStatementDuration: 3000,
    maxScriptRunTime: 5000,
};

class ScriptError extends Error {
    public errors: $TSFixMe;
    public constructor(errors: $TSFixMe, message = 'Script resource error') {
        super();
        this.message = message;
        this.errors = Array.isArray(errors)
            ? errors.reduce((allErr: $TSFixMe, err: $TSFixMe) => {
                  return [...allErr, err.message].join(',');
              }, [])
            : errors.message ?? errors;
    }
}

const {
    availableImports,
    maxScriptRunTime,
    maxSyncStatementDuration,
}: $TSFixMe = runConfig;

const run: Function = async (
    functionCode: $TSFixMe,
    isCalled: $TSFixMe, // Skip IIFE calls
    options: $TSFixMe = { maxScriptRunTime, maxSyncStatementDuration }
): void => {
    if (isMainThread) {
        // Modifiable option in development mode only
        const { maxScriptRunTime, maxSyncStatementDuration }: $TSFixMe =
            options;
        if (!isCalled) {
            return;
        }
        const start: $TSFixMe = performance.now();
        return new Promise((resolve: $TSFixMe) => {
            const worker: $TSFixMe = new Worker(__filename, {
                workerData: { functionCode },
                execArgv: [
                    ...process.execArgv,
                    '--unhandled-rejections=strict',
                ], // Handle promise rejection warnings
            });

            const consoleLogs: $TSFixMe = [];
            let lastMessage: $TSFixMe = null;

            worker.on('message', ({ type, payload }: $TSFixMe) => {
                switch (type) {
                    case 'ping': {
                        lastMessage = Date.now();
                        break;
                    }
                    case 'log': {
                        consoleLogs.push(payload);
                        break;
                    }
                    default: {
                        if (type.error) {
                            resolve({
                                success: false,
                                error: type.error,
                                status: 'failed',
                                executionTime: performance.now() - start,
                                consoleLogs,
                            });
                        }
                        break;
                    }
                }
            });
            worker.on('online', () => {
                lastMessage = Date.now();
            });
            worker.on('exit', (exitCode: $TSFixMe) => {
                // Logger.info('exitCode:::', exitCode);
                switch (exitCode) {
                    case 0:
                        resolve({
                            success: true,
                            status: 'success',
                            executionTime: performance.now() - start,
                            consoleLogs,
                        });
                        break;
                    case 1: {
                        const message: $TSFixMe = statementTimeExceeded
                            ? `Max. synchronous statement execution time exceeded (${maxSyncStatementDuration}ms)`
                            : scriptTimeExceeded
                            ? `Max. script execution time exceeded (${maxScriptRunTime}ms)`
                            : 'Script was terminated';
                        resolve({
                            success: false,
                            message,
                            status: 'timeout',
                            executionTime: performance.now() - start,
                            consoleLogs,
                        });
                        break;
                    }
                    default:
                        resolve({
                            success: false,
                            message: 'Unknown Error: script terminated',
                            status: 'terminated',
                            executionTime: performance.now() - start,
                            consoleLogs,
                        });
                        break;
                }

                clearInterval(checker);
            });
            worker.on('error', (err: $TSFixMe) => {
                // Append errors to console log
                consoleLogs.push(`[error]: ${err.message}`);

                if (err.errors) {
                    // If callback passed value append to console log
                    consoleLogs.push(`[callback-errors]: ${err.errors}`);

                    resolve({
                        success: false,
                        message: err.message,
                        errors: err.errors,
                        status: 'nonEmptyCallback',
                        executionTime: performance.now() - start,
                        consoleLogs,
                    });
                    return;
                }

                resolve({
                    success: false,
                    message: err.message,
                    status: 'failed',
                    executionTime: performance.now() - start,
                    consoleLogs,
                });
                clearInterval(checker);
                worker.terminate();
            });

            let totalRuntime: $TSFixMe = 0,
                statementTimeExceeded: $TSFixMe = false,
                scriptTimeExceeded: $TSFixMe = false;

            const checker: $TSFixMe = setInterval(
                () => {
                    totalRuntime += 1000;
                    if (totalRuntime > maxScriptRunTime) {
                        clearInterval(checker);
                        scriptTimeExceeded = true;
                        worker.terminate();
                    }
                    // Last ping was too long ago, terminate it
                    if (
                        lastMessage !== null &&
                        Date.now() - lastMessage >= maxSyncStatementDuration
                    ) {
                        clearInterval(checker);
                        statementTimeExceeded = true;
                        worker.terminate();
                    }
                },
                1000,
                maxSyncStatementDuration
            );
        });
    }
    // Worker_threads code

    import { NodeVM } from 'vm2';
    const vm: $TSFixMe = new NodeVM({
        eval: false,
        wasm: false,
        require: {
            root: './',
            external: availableImports,
            import: availableImports,
        },
        console: 'redirect',
    });

    vm.on('logger.info', (log: $TSFixMe) => {
        parentPort.postMessage({
            type: 'log',
            payload: `[log]: ${
                typeof log === 'string' ? log : JSON.stringify(log, null, 2)
            }`,
        });
    });

    vm.on('logger.error', (error: $TSFixMe) => {
        parentPort.postMessage({
            type: 'log',
            payload: `[error]: ${
                typeof error === 'string'
                    ? error
                    : JSON.stringify(error, null, 2)
            }`,
        });
    });

    vm.on('console.warn', (error: $TSFixMe) => {
        parentPort.postMessage({
            type: 'log',
            payload: `[warn]: $${
                typeof error === 'string'
                    ? error
                    : JSON.stringify(error, null, 2)
            }`,
        });
    });

    const scriptCompletedCallback: Function = (err: $TSFixMe): void => {
        if (err) {
            throw new ScriptError(err);
        }
    };

    const code: $TSFixMe = workerData.functionCode;
    setInterval(() => {
        return parentPort.postMessage({ type: 'ping' });
    }, 500);
    const sandboxFunction: $TSFixMe = await vm.run(
        `export default ${code}`,
        join(process.cwd(), 'node_modules')
    );

    await sandboxFunction(scriptCompletedCallback);
    process.exit();
};

export default run(); // DO NOT call default export directly (used by worker thread)
module.exports.run = run; // Call named export only
