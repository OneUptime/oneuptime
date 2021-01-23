const prof = require('v8-profiler');

exports.hook_connect_init = (next, conn) => {
    prof.startProfiling(`Connection from: ${conn.remote.ip}`);
    next();
};

exports.hook_disconnect = (next, conn) => {
    prof.stopProfiling(`Connection from: ${conn.remote.ip}`);
    next();
};
