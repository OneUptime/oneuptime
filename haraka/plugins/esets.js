// esets
const fs = require('fs');
const child_process = require('child_process');
const virus_re = new RegExp('virus="([^"]+)"');

exports.hook_data_post = function(next, connection) {
    const plugin = this;
    const txn = connection.transaction;
    const cfg = this.config.get('esets.ini');

    // Write message to temporary file
    const tmpdir = cfg.main.tmpdir || '/tmp';
    const tmpfile = `${tmpdir}/${txn.uuid}.esets`;
    const ws = fs.createWriteStream(tmpfile);

    ws.once('error', err => {
        connection.logerror(
            plugin,
            `Error writing temporary file: ${err.message}`
        );
        return next();
    });

    let start_time;

    function wsOnClose(error, stdout, stderr) {
        // Remove the temporary file
        fs.unlink(tmpfile, () => {});

        // Timing
        const end_time = Date.now();
        const elapsed = end_time - start_time;

        // Debugging
        [stdout, stderr].forEach(channel => {
            if (channel) {
                const lines = channel.split('\n');
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i])
                        connection.logdebug(plugin, `recv: ${lines[i]}`);
                }
            }
        });

        // Get virus name
        let virus;
        if ((virus = virus_re.exec(stdout))) {
            virus = virus[1];
        }

        // Log a summary
        const exit_code = parseInt(error ? error.code : 0);
        connection.loginfo(
            plugin,
            `elapsed=${elapsed}ms code=${exit_code}${
                exit_code === 0 || (exit_code > 1 && exit_code < 4)
                    ? ` virus="${virus}"`
                    : ` error="${(stdout || stderr || 'UNKNOWN')
                          .replace('\n', ' ')
                          .trim()}"`
            }`
        );

        // esets_cli returns non-zero exit on virus/error
        if (exit_code) {
            if (exit_code > 1 && exit_code < 4) {
                return next(
                    DENY,
                    `Message is infected with ${virus || 'UNKNOWN'}`
                );
            } else {
                return next(DENYSOFT, 'Virus scanner error');
            }
        }
        return next();
    }

    ws.once('close', () => {
        start_time = Date.now();
        child_process.exec(
            `LANG=C /opt/eset/esets/bin/esets_cli ${tmpfile}`,
            { encoding: 'utf8', timeout: 30 * 1000 },
            wsOnClose
        );
    });

    txn.message_stream.pipe(ws, { line_endings: '\r\n' });
};
