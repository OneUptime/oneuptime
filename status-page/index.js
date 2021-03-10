const express = require('express');
const path = require('path');
const app = express();

const https = require('https');
const http = require('http');
const net = require('net');
const tls = require('tls');
const fs = require('fs');
const fetch = require('node-fetch');

app.get(['/env.js', '/status-page/env.js'], function(req, res) {
    let REACT_APP_FYIPE_HOST = null;
    let REACT_APP_BACKEND_PROTOCOL = null;
    if (!process.env.FYIPE_HOST) {
        if (req.host.includes('localhost')) {
            REACT_APP_FYIPE_HOST = 'http://' + req.host;
        } else {
            REACT_APP_FYIPE_HOST = 'https://' + req.host;
        }
    } else {
        REACT_APP_FYIPE_HOST = process.env.FYIPE_HOST;
        if (REACT_APP_FYIPE_HOST.includes('*.')) {
            REACT_APP_FYIPE_HOST = REACT_APP_FYIPE_HOST.replace('*.', ''); //remove wildcard from host.
        }
    }

    REACT_APP_BACKEND_PROTOCOL = process.env.BACKEND_PROTOCOL;

    const env = {
        REACT_APP_FYIPE_HOST,
        REACT_APP_BACKEND_PROTOCOL,
    };

    res.contentType('application/javascript');
    res.send('window._env = ' + JSON.stringify(env));
});

app.use(express.static(path.join(__dirname, 'build')));
app.use('/status-page', express.static(path.join(__dirname, 'build')));
app.use(
    '/status-page/static/js',
    express.static(path.join(__dirname, 'build/static/js'))
);

app.get('/*', function(req, res) {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

async function fetchCredential(apiHost, credentialName, configPath) {
    return new Promise((resolve, reject) => {
        fetch(`${apiHost}/file/${credentialName}`).then(res => {
            const dest = fs.createWriteStream(configPath);
            res.body.pipe(dest);
            // at this point, writing to the specified file is complete
            dest.on('finish', async () => {
                resolve('done writing to file');
            });

            dest.on('error', async error => {
                reject(error);
            });
        });
    });
}

const options = {
    cert: fs.readFileSync(
        path.resolve(process.cwd(), 'src', 'credentials', 'fyipe.com.crt')
    ),
    key: fs.readFileSync(
        path.resolve(process.cwd(), 'src', 'credentials', 'fyipe.com.key')
    ),
    SNICallback: async function(domain, cb) {
        let apiHost;
        if (process.env.FYIPE_HOST) {
            apiHost = 'https://' + process.env.FYIPE_HOST + '/api';
        } else {
            apiHost = 'http://localhost:3002/api';
        }

        const res = await fetch(
            `${apiHost}/statusPage/tlsCredential?domain=${domain}`
        ).then(res => res.json());

        let certPath, privateKeyPath;
        if (res.data) {
            const { cert, privateKey } = res.data;
            if (cert && privateKey) {
                certPath = path.resolve(
                    process.cwd(),
                    'src',
                    'credentials',
                    `${cert}.crt`
                );
                privateKeyPath = path.resolve(
                    process.cwd(),
                    'src',
                    'credentials',
                    `${privateKey}.key`
                );

                await Promise.all([
                    fetchCredential(apiHost, cert, certPath),
                    fetchCredential(apiHost, privateKey, privateKeyPath),
                ]);
            }
        }

        if (certPath && privateKeyPath) {
            cb(
                null,
                tls.createSecureContext({
                    key: fs.readFileSync(privateKeyPath),
                    cert: fs.readFileSync(certPath),
                })
            );
        } else {
            cb(
                null,
                tls.createSecureContext({
                    cert: fs.readFileSync(
                        path.resolve(
                            process.cwd(),
                            'src',
                            'credentials',
                            'fyipe.com.crt'
                        )
                    ),
                    key: fs.readFileSync(
                        path.resolve(
                            process.cwd(),
                            'src',
                            'credentials',
                            'fyipe.com.key'
                        )
                    ),
                })
            );
        }
    },
};

function createServer(opts, handler) {
    const server = net.createServer(socket => {
        socket.once('data', buffer => {
            // Pause the socket
            socket.pause();

            // Determine if this is an HTTP(s) request
            const byte = buffer[0];

            let protocol;
            if (byte === 22) {
                protocol = 'https';
            } else if (32 < byte && byte < 127) {
                protocol = 'http';
            }

            const proxy = server[protocol];
            if (proxy) {
                // Push the buffer back onto the front of the data stream
                socket.unshift(buffer);

                // Emit the socket to the HTTP(s) server
                proxy.emit('connection', socket);
            }

            // As of NodeJS 10.x the socket must be
            // resumed asynchronously or the socket
            // connection hangs, potentially crashing
            // the process. Prior to NodeJS 10.x
            // the socket may be resumed synchronously.
            process.nextTick(() => socket.resume());
        });
    });

    server.http = http.createServer(handler);
    server.https = https.createServer(opts, handler);
    return server;
}

const PORT = process.env.PORT || 3006;
createServer(options, app).listen(PORT, () =>
    // eslint-disable-next-line no-console
    console.log('server running on port ', PORT)
);
