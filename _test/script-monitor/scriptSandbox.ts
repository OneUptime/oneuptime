import { join } from "path"
import {performance} from 'perf_hooks'

// TODO - make this configurable from admin-dashboard
const runConfig = {
    availableImports: ['axios'], // init allowed modules
    maxSyncStatementDuration: 3000,
    maxScriptRunTime: 5000,
};

class ScriptMonitorError extends Error {
    errors: $TSFixMe;
    constructor(errors: $TSFixMe, message = "Script monitor resource error") {
        super();
        this.message = message;
        this.errors = Array.isArray(errors)
        ? errors.reduce(
              (allErr, err) => [...allErr, err.message].join(','),
              []
          )
        : (errors.message ?? errors);
    }
}

const {
    availableImports,
    maxScriptRunTime,
    maxSyncStatementDuration,
} = runConfig;

const runScript = async (functionCode: $TSFixMe, isCalled: $TSFixMe, options = { maxScriptRunTime, maxSyncStatementDuration }) => {
    const {
        isMainThread,
        Worker,
        parentPort,
        workerData,
    } = require('worker_threads');

    if (isMainThread) {
        // modifiable option in development mode only
        const { maxScriptRunTime, maxSyncStatementDuration } = options;
        if (!isCalled) return;
        const start = performance.now();
        return new Promise(resolve => {
            const worker = new Worker(__filename, {
                workerData: { functionCode },
                execArgv: [
                    ...process.execArgv,
                    '--unhandled-rejections=strict',
                ], // handle promise rejection warnings
            });

            const consoleLogs: $TSFixMe = [];
            let lastMessage: $TSFixMe = null;

            worker.on('message', ({
                type,
                payload
            }: $TSFixMe) => {
                switch (type) {
                    case 'ping': {
                        lastMessage = Date.now();
                        break;
                    }
                    case 'log':{
                        consoleLogs.push(payload);
                        break;
                    }
                    default: {
                        if (type.error) {
                            resolve({
                                success: false,
                                error: type.error,
                                status: 'error',
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
                switch (exitCode) {
                    case 0:
                        resolve({
                            success: true,
                            status: 'completed',
                            executionTime: performance.now() - start,
                            consoleLogs,
                        });
                        break;
                    case 1: {
                        const message = statementTimeExceeded
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
                if (err.errors) {
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
                    status: 'error',
                    executionTime: performance.now() - start,
                    consoleLogs,
                });
                clearInterval(checker);
                worker.terminate();
            });

            let totalRuntime = 0,
                statementTimeExceeded = false,
                scriptTimeExceeded = false;

            const checker = setInterval(
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
    } else {
        // worker_threads code
        // @ts-expect-error ts-migrate(1232) FIXME: An import declaration can only be used in a namesp... Remove this comment to see the full error message
        import { NodeVM } from 'vm2'
        const vm = new NodeVM({
            eval: false,
            wasm: false,
            require: {
                root: './',
                external: availableImports,
                import: availableImports,
            },
            console: 'redirect',
        });

        vm.on('console.log', (log: $TSFixMe) => {
            parentPort.postMessage({type: 'log', payload: `[log]: ${log}`});
        });

        vm.on('console.error', (error: $TSFixMe) => {
            parentPort.postMessage({type: 'log', payload: `[error]: ${error}`});
        });

        vm.on('console.warn', (error: $TSFixMe) => {
            parentPort.postMessage({type: 'log', payload: `[warn]: ${error}`});
        });

        const scriptCompletedCallback = (err: $TSFixMe) => {
            if (err) {
                throw new ScriptMonitorError(err);
            }
        };

        const code = workerData.functionCode;
        setInterval(() => parentPort.postMessage({type: 'ping'}), 500);
        const sandboxFunction = await vm.run(
            `export default ${code}`,
            join(process.cwd(), 'node_modules')
        );

        await sandboxFunction(scriptCompletedCallback);
        process.exit();
    }
};

// @ts-expect-error ts-migrate(2554) FIXME: Expected 2-3 arguments, but got 0.
export default runScript();
module.exports.runScript = runScript;
