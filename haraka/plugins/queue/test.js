const fs = require('fs');
const os = require('os');

const tempDir = os.tmpdir();

exports.hook_queue = function(next, connection) {
    const ws = fs.createWriteStream(`${tempDir}/mail.eml`);
    connection.logdebug(this, `Saving to ${tempDir}/mail.eml`);
    ws.once('close', () => next(OK));
    connection.transaction.message_stream.pipe(ws);
};
