const { join } = require("path");

// TODO - make this configurable from admin-dashboard
const runConfig = {
    availableImports: ['axios'], // init allowed modules
    maxSyncStatementDuration: 3000,
    maxScriptRunTime: 5000,
};

class ScriptMonitorError extends Error {
    constructor(errors, message = "Script monitor resource error") {
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

const runScript = async (functionCode, isCalled, options = { maxScriptRunTime, maxSyncStatementDuration }) => {
    const { isMainThread, Worker, parentPort, workerData } = require('worker_threads');

    if (isMainThread) {
        // modifiable option in development mode only
        const { maxScriptRunTime, maxSyncStatementDuration } = options; 
        if (!isCalled) return;
        return new Promise(resolve => {
            const worker = new Worker(__filename, { workerData: { functionCode }, execArgv: [...process.execArgv, '--unhandled-rejections=strict' ] });

            let lastMessage = null;

            worker.on('message', msg => {
                switch (msg) {
                    case 'ping': {
                        lastMessage = Date.now();
                        break;
                    }
                    default: {
                        if (msg.error) {
                            resolve({
                                success: false,
                                error: msg.error,
                            });
                        }
                        break;
                    }
                }
            });
            worker.on('online', () => {
                lastMessage = Date.now();                
            });
            worker.on('exit', exitCode => {
                switch (exitCode) {
                    case 0:
                        resolve({ success: true });
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
                        });
                        break;
                    }
                    default:
                        resolve({
                            success: false,
                            message: "Unknown Error: script terminated"
                        })
                        break;
                }

                clearInterval(checker);
            });
            worker.on('error', err => {
                if (err.errors) {
                    resolve({ success: false, message: err.message, errors: err.errors});
                    return;
                }
                resolve({ success: false, message: err.message });
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
                        (Date.now() - lastMessage >= maxSyncStatementDuration)
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
        const { NodeVM } = require('vm2');
        const vm = new NodeVM({
            eval: false,
            wasm: false,
            require: {
                root: "./",
                external: availableImports, 
                import: availableImports,
            },
            console: "inherit"
        });

        const scriptCompletedCallback = err => {
            if (err) {
                throw new ScriptMonitorError(err);
            }
        };

        const code = workerData.functionCode;
        setInterval(() => parentPort.postMessage('ping'), 500);
        const sandboxFunction = await vm.run(`module.exports = ${code}`, join(process.cwd(), "node_modules"));
        
        await sandboxFunction(scriptCompletedCallback);
        process.exit();

    }
};

module.exports = runScript();
module.exports.runScript = runScript;
