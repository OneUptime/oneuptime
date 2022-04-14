import express, {
    ExpressRequest,
    ExpressResponse,
    ExpressStatic,
    NextFunction,
} from 'CommonServer/Utils/Express';
import logger from 'CommonServer/Utils/Logger';
import path from 'path';
const app: $TSFixMe = express.getExpressApp();

import https from 'https';
import http from 'http';
import tls from 'tls';
import fs from 'fs';

import fetch from 'node-fetch';
import { spawn } from 'child_process';
import axios from 'axios';

import cors from 'cors';

// mongodb
const MongoClient: $TSFixMe = require('mongodb').MongoClient;
const mongoUrl: $TSFixMe =
    process.env['MONGO_URL'] || 'mongodb://localhost:27017/oneuptimedb';

const { NODE_ENV }: $TSFixMe = process.env;

function getMongoClient(): void {
    return new MongoClient(mongoUrl, {
        useNewUrlParser: true,
        useUnifiedTopology: true,
    });
}

// setup mongodb connection
const client: $TSFixMe = getMongoClient();
(async function (): void {
    try {
        logger.info('connecting to db');
        await client.connect();

        logger.info('connected to db');
    } catch (error) {
        logger.info('connection error: ', error);
    }
})();

if (!NODE_ENV || NODE_ENV === 'development') {
    // Load env vars from /StatusPage/.env
    import dotenv from 'dotenv';
    dotenv.config();
}

app.use(cors());

let apiHost: $TSFixMe = 'http://localhost:3002/api';
if (process.env.BACKEND_URL) {
    apiHost = 'http://' + process.env.BACKEND_URL + '/api';
}
if (process.env['ONEUPTIME_HOST']) {
    apiHost = process.env.BACKEND_PROTOCOL
        ? `${process.env.BACKEND_PROTOCOL}://${process.env['ONEUPTIME_HOST']}/api`
        : `http://${process.env['ONEUPTIME_HOST']}/api`;
}

app.get(
    ['/env.js', '/StatusPage/env.js'],
    (req: ExpressRequest, res: ExpressResponse) => {
        let REACT_APP_ONEUPTIME_HOST = null;
        let REACT_APP_BACKEND_PROTOCOL = null;
        if (!process.env['ONEUPTIME_HOST']) {
            REACT_APP_ONEUPTIME_HOST = req.hostname;
        } else {
            REACT_APP_ONEUPTIME_HOST = process.env['ONEUPTIME_HOST'];
            if (REACT_APP_ONEUPTIME_HOST.includes('*.')) {
                REACT_APP_ONEUPTIME_HOST = REACT_APP_ONEUPTIME_HOST.replace(
                    '*.',
                    ''
                ); //remove wildcard from host.
            }
        }

        if (
            REACT_APP_ONEUPTIME_HOST &&
            (REACT_APP_ONEUPTIME_HOST.includes('localhost:') ||
                REACT_APP_ONEUPTIME_HOST.includes('0.0.0.0:') ||
                REACT_APP_ONEUPTIME_HOST.includes('127.0.0.1:'))
        ) {
            apiHost = 'http://localhost:3002/api';
        } else if (REACT_APP_ONEUPTIME_HOST) {
            const ONEUPTIME_HOST: $TSFixMe = REACT_APP_ONEUPTIME_HOST.replace(
                /(http:\/\/|https:\/\/)/,
                ''
            ); // remove any protocol that might have been added
            let protocol: $TSFixMe = 'http:';
            if (process.env.BACKEND_PROTOCOL) {
                protocol = process.env.BACKEND_PROTOCOL + ':';
            } else if (req.secure) {
                protocol = 'https:';
            }

            apiHost = protocol + `//${ONEUPTIME_HOST}/api`;
        }

        REACT_APP_BACKEND_PROTOCOL = process.env.BACKEND_PROTOCOL;
        const env: $TSFixMe = {
            REACT_APP_ONEUPTIME_HOST,
            REACT_APP_BACKEND_PROTOCOL,
            REACT_APP_BACKEND_URL: process.env.BACKEND_URL,
            REACT_APP_VERSION:
                process.env['REACT_APP_VERSION'] ||
                process.env['npm_package_version'],
        };

        res.contentType('application/javascript');
        res.send('window._env = ' + JSON.stringify(env));
    }
);

app.use(
    '/.well-known/acme-challenge/:token',
    async (req: ExpressRequest, res: ExpressResponse) => {
        // make api call to backend and fetch keyAuthorization
        const { token }: $TSFixMe = req.params;
        const url: string = `${apiHost}/ssl/challenge/authorization/${token}`;
        const response: $TSFixMe = await axios.get(url);
        res.send(response.data);
    }
);

// fetch details about a domain from the db
async function handleCustomDomain(
    client: $TSFixMe,
    collection: $TSFixMe,
    domain: $TSFixMe
): void {
    const statusPage: $TSFixMe = await client
        .db(process.env['DB_NAME'])
        .collection(collection)
        .findOne({
            domains: { $elemMatch: { domain } },
            deleted: false,
        });

    let domainObj: $TSFixMe = {};
    statusPage &&
        statusPage.domains &&
        statusPage.domains.forEach((eachDomain: $TSFixMe) => {
            if (eachDomain.domain === domain) {
                domainObj = eachDomain;
            }
        });

    return {
        cert: domainObj.cert,

        privateKey: domainObj.privateKey,

        autoProvisioning: domainObj.autoProvisioning,

        enableHttps: domainObj.enableHttps,

        domain: domainObj.domain,
    };
}

// fetch certificate for a particular domain
async function handleCertificate(
    client: $TSFixMe,
    collection: $TSFixMe,
    domain: $TSFixMe
): void {
    const certificate: $TSFixMe = await client
        .db(process.env['DB_NAME'])
        .collection(collection)
        .findOne({ id: domain });

    return certificate;
}

app.use(
    '/',
    async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction
    ): void => {
        const host: $TSFixMe = req.hostname;
        if (
            host &&
            (host === 'oneuptime.com' ||
                host === 'staging.oneuptime.com' ||
                host === 'oneuptime.com' ||
                host === 'staging.oneuptime.com' ||
                host.indexOf('localhost') > -1)
        ) {
            return next();
        }

        try {
            const response: $TSFixMe = await handleCustomDomain(
                client,
                'statuspages',
                host
            );

            const { enableHttps }: $TSFixMe = response;
            if (enableHttps) {
                if (!req.secure) {
                    res.writeHead(301, {
                        Location: `https://${host}${req.url}`,
                    });
                    return res.end();
                }
                return next();
            } else {
                if (req.secure) {
                    res.writeHead(301, {
                        Location: `http://${host}${req.url}`,
                    });
                    return res.end();
                }
                return next();
            }
        } catch (error) {
            logger.info('Error with fetch', error);
            return next();
        }
    }
);

app.get(
    ['/StatusPage/status', '/status'],
    (req: ExpressRequest, res: ExpressResponse) => {
        res.setHeader('Content-Type', 'application/json');
        res.send(
            JSON.stringify({
                status: 200,
                message: 'Service Status - OK',
                serviceType: 'oneuptime-StatusPage',
            })
        );
    }
);

app.use(ExpressStatic(path.join(__dirname, 'build')));
app.use('/StatusPage', ExpressStatic(path.join(__dirname, 'build')));
app.use(
    '/StatusPage/static/js',
    ExpressStatic(path.join(__dirname, 'build/static/js'))
);

app.get('/*', (req: ExpressRequest, res: ExpressResponse) => {
    res.sendFile(path.join(__dirname, 'build', 'index.html'));
});

async function fetchCredential(
    apiHost: $TSFixMe,
    credentialName: $TSFixMe,
    configPath: $TSFixMe
): void {
    return new Promise((resolve, reject) => {
        fetch(`${apiHost}/file/${credentialName}`).then(
            (res: ExpressResponse) => {
                const dest: $TSFixMe = fs.createWriteStream(configPath);
                res.body.pipe(dest);
                // at this point, writing to the specified file is complete
                dest.on('finish', async () => {
                    resolve('done writing to file');
                });

                dest.on('error', async error => {
                    reject(error);
                });
            }
        );
    });
}

function decodeAndSave(content: $TSFixMe, filePath: $TSFixMe): void {
    return new Promise(resolve => {
        const command: string = `echo ${content} | base64 -d`;
        let output: $TSFixMe = '';

        const commandOutput: $TSFixMe = spawn(command, {
            cwd: process.cwd(),
            shell: true,
        });
        commandOutput.stdout.on('data', data => {
            const strData: $TSFixMe = data.toString();
            output += strData;
        });
        commandOutput.on('close', () => {
            fs.writeFile(filePath, output, 'utf8', (): void => {
                resolve('Done writing to disc');
            });
        });
    });
}

function createDir(dirPath: $TSFixMe): void {
    return new Promise((resolve, reject) => {
        const workPath: $TSFixMe = path.resolve(process.cwd(), 'src', dirPath);
        if (fs.existsSync(workPath)) {
            resolve(workPath);
        }

        fs.mkdir(workPath, error => {
            if (error) {
                reject(error);
            }
            resolve(workPath);
        });
    });
}

function countFreq(pat: $TSFixMe, txt: $TSFixMe): void {
    const M: $TSFixMe = pat.length;
    const N: $TSFixMe = txt.length;
    let res: $TSFixMe = 0;

    // A loop to slide pat[] one by one
    for (let i: $TSFixMe = 0; i <= N - M; i++) {
        // For current index i, check for
        // pattern match
        let j;
        for (j = 0; j < M; j++) {
            if (txt[i + j] != pat[j]) {
                break;
            }
        }

        if (j == M) {
            res++;
            j = 0;
        }
    }
    return res;
}

// using an IIFE here because we have an asynchronous code we want to run as we start the server
// and since we can't await outside an async function, we had to use an IIFE to handle that
(async function (): void {
    // create http server
    http.createServer(app).listen(3006, () =>
        logger.info('Server running on port 3006')
    );

    try {
        // create https server
        await createDir('credentials');
        // decode base64 of the cert and private key
        // store the value to disc
        const cert: $TSFixMe = process.env.STATUSPAGE_CERT;
        const certPath: $TSFixMe = path.resolve(
            process.cwd(),
            'src',
            'credentials',
            'certificate.crt'
        );
        const privateKey: $TSFixMe = process.env.STATUSPAGE_PRIVATEKEY;
        const privateKeyPath: $TSFixMe = path.resolve(
            process.cwd(),
            'src',
            'credentials',
            'private.key'
        );
        await Promise.all([
            decodeAndSave(cert, certPath),
            decodeAndSave(privateKey, privateKeyPath),
        ]);

        const options: $TSFixMe = {
            cert: fs.readFileSync(
                path.resolve(
                    process.cwd(),
                    'src',
                    'credentials',
                    'certificate.crt'
                )
            ),
            key: fs.readFileSync(
                path.resolve(process.cwd(), 'src', 'credentials', 'private.key')
            ),
            SNICallback: async function (domain: $TSFixMe, cb: $TSFixMe): void {
                const res: $TSFixMe = await handleCustomDomain(
                    client,
                    'statuspages',
                    domain
                );

                let certPath, privateKeyPath;
                if (res) {
                    const {
                        cert,
                        privateKey,
                        autoProvisioning,
                        enableHttps,
                        domain,
                    } = res;
                    // have a condition to check for autoProvisioning
                    // if auto provisioning is set
                    // fetch the stored cert/privateKey
                    // cert and private key is a string
                    // store it to a file on disk
                    if (enableHttps && autoProvisioning) {
                        const certificate: $TSFixMe = await handleCertificate(
                            client,
                            'certificates',
                            domain
                        );
                        if (certificate) {
                            certPath = path.resolve(
                                process.cwd(),
                                'src',
                                'credentials',
                                `${certificate.id}.crt`
                            );
                            privateKeyPath = path.resolve(
                                process.cwd(),
                                'src',
                                'credentials',
                                `${certificate.id}.key`
                            );

                            // check if the certificate is container chain
                            // if not, add anc show update view for the frontend
                            let fullCert: $TSFixMe = certificate.cert;
                            if (
                                countFreq(
                                    'BEGIN CERTIFICATE',
                                    certificate.cert
                                ) === 1
                            ) {
                                fullCert =
                                    certificate.cert +
                                    '\n' +
                                    '\n' +
                                    certificate.chain;
                            }
                            fs.writeFileSync(certPath, fullCert);
                            fs.writeFileSync(
                                privateKeyPath,
                                certificate.privateKeyPem
                            );

                            return cb(
                                null,
                                tls.createSecureContext({
                                    key: fs.readFileSync(privateKeyPath),
                                    cert: fs.readFileSync(certPath),
                                })
                            );
                        }
                    }

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
                            fetchCredential(
                                apiHost,
                                privateKey,
                                privateKeyPath
                            ),
                        ]);

                        return cb(
                            null,
                            tls.createSecureContext({
                                key: fs.readFileSync(privateKeyPath),
                                cert: fs.readFileSync(certPath),
                            })
                        );
                    }
                }

                // default for custom domains without cert/key credentials
                return cb(
                    null,
                    tls.createSecureContext({
                        cert: fs.readFileSync(
                            path.resolve(
                                process.cwd(),
                                'src',
                                'credentials',
                                'certificate.crt'
                            )
                        ),
                        key: fs.readFileSync(
                            path.resolve(
                                process.cwd(),
                                'src',
                                'credentials',
                                'private.key'
                            )
                        ),
                    })
                );
            },
        };

        https.createServer(options, app).listen(3007, () => {
            logger.info('Server running on port 3007');
        });
    } catch (e) {
        logger.info('Unable to create HTTPS Server');

        logger.info(e);
    }
})();
