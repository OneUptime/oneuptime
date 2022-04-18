/*
 * import express, {
 *     ExpressRequest,
 *     ExpressResponse,
 *     ExpressStatic,
 *     NextFunction,
 * } from 'CommonServer/Utils/Express';
 * import logger from 'CommonServer/Utils/Logger';
 * import path from 'path';
 * const app: $TSFixMe = express.getExpressApp();
 */

/*
 * let apiHost: $TSFixMe = 'http://localhost:3002/api';
 * if (process.env['BACKEND_URL']) {
 *     apiHost = 'http://' + process.env['BACKEND_URL'] + '/api';
 * }
 * if (process.env['ONEUPTIME_HOST']) {
 *     apiHost = process.env['BACKEND_PROTOCOL']
 *         ? `${process.env['BACKEND_PROTOCOL']}://${process.env['ONEUPTIME_HOST']}/api`
 *         : `http://${process.env['ONEUPTIME_HOST']}/api`;
 * }
 */

/*
 * app.get(
 *     ['/env.js', '/StatusPage/env.js'],
 *     (req: ExpressRequest, res: ExpressResponse) => {
 *         let REACT_APP_ONEUPTIME_HOST: $TSFixMe = null;
 *         let REACT_APP_BACKEND_PROTOCOL: $TSFixMe = null;
 *         if (!process.env['ONEUPTIME_HOST']) {
 *             REACT_APP_ONEUPTIME_HOST = req.hostname;
 *         } else {
 *             REACT_APP_ONEUPTIME_HOST = process.env['ONEUPTIME_HOST'];
 *             if (REACT_APP_ONEUPTIME_HOST.includes('*.')) {
 *                 REACT_APP_ONEUPTIME_HOST = REACT_APP_ONEUPTIME_HOST.replace(
 *                     '*.',
 *                     ''
 *                 ); //Remove wildcard from host.
 *             }
 *         }
 */

/*
 *         if (
 *             REACT_APP_ONEUPTIME_HOST &&
 *             (REACT_APP_ONEUPTIME_HOST.includes('localhost:') ||
 *                 REACT_APP_ONEUPTIME_HOST.includes('0.0.0.0:') ||
 *                 REACT_APP_ONEUPTIME_HOST.includes('127.0.0.1:'))
 *         ) {
 *             apiHost = 'http://localhost:3002/api';
 *         } else if (REACT_APP_ONEUPTIME_HOST) {
 *             const ONEUPTIME_HOST: $TSFixMe = REACT_APP_ONEUPTIME_HOST.replace(
 *                 /(http:\/\/|https:\/\/)/,
 *                 ''
 *             ); // Remove any protocol that might have been added
 *             let protocol: $TSFixMe = 'http:';
 *             if (process.env['BACKEND_PROTOCOL']) {
 *                 protocol = process.env['BACKEND_PROTOCOL'] + ':';
 *             } else if (req.secure) {
 *                 protocol = 'https:';
 *             }
 */

/*
 *             apiHost = protocol + `//${ONEUPTIME_HOST}/api`;
 *         }
 */

/*
 *         REACT_APP_BACKEND_PROTOCOL = process.env['BACKEND_PROTOCOL'];
 *         const env: $TSFixMe = {
 *             REACT_APP_ONEUPTIME_HOST,
 *             REACT_APP_BACKEND_PROTOCOL,
 *             REACT_APP_BACKEND_URL: process.env['BACKEND_URL'],
 *             REACT_APP_VERSION:
 *                 process.env['REACT_APP_VERSION'] ||
 *                 process.env['npm_package_version'],
 *         };
 */

/*
 *         res.contentType('application/javascript');
 *         res.send('window._env = ' + JSON.stringify(env));
 *     }
 * );
 */

// /*
//  * app.use(
//  *     '/.well-known/acme-challenge/:token',
//  *     async (req: ExpressRequest, res: ExpressResponse) => {
//  *         // Make api call to backend and fetch keyAuthorization
//  *         const { token }: $TSFixMe = req.params;
//  *         const url: string = `${apiHost}/ssl/challenge/authorization/${token}`;
//  *         const response: $TSFixMe = await axios.get(url);
//  *         res.send(response.data);
//  *     }
//  * );
//  */

// /*
//  * Fetch details about a domain from the db
//  * Async function handleCustomDomain(
//  *     Client: $TSFixMe,
//  *     Collection: $TSFixMe,
//  *     Domain: $TSFixMe
//  * ): void {
//  *     Const statusPage: $TSFixMe = await client
//  *         .db(process.env['DB_NAME'])
//  *         .collection(collection)
//  *         .findOne({
//  *             Domains: { $elemMatch: { domain } },
//  *             Deleted: false,
//  *         });
//  */

// /*
//  *     Let domainObj: $TSFixMe = {};
//  *     statusPage &&
//  *         statusPage.domains &&
//  *         statusPage.domains.forEach((eachDomain: $TSFixMe) => {
//  *             if (eachDomain.domain === domain) {
//  *                 domainObj = eachDomain;
//  *             }
//  *         });
//  */

// /*
//  *     Return {
//  *         cert: domainObj.cert,
//  */

// //         PrivateKey: domainObj.privateKey,

// //         AutoProvisioning: domainObj.autoProvisioning,

// //         EnableHttps: domainObj.enableHttps,

// /*
//  *         Domain: domainObj.domain,
//  *     };
//  * }
//  */

// /*
//  * Fetch certificate for a particular domain
//  * Async function handleCertificate(
//  *     Client: $TSFixMe,
//  *     Collection: $TSFixMe,
//  *     Domain: $TSFixMe
//  * ): void {
//  *     Const certificate: $TSFixMe = await client
//  *         .db(process.env['DB_NAME'])
//  *         .collection(collection)
//  *         .findOne({ id: domain });
//  */

// /*
//  *     Return certificate;
//  * }
//  */

/*
 * app.use(
 *     '/',
 *     async (
 *         req: ExpressRequest,
 *         res: ExpressResponse,
 *         next: NextFunction
 *     ): void => {
 *         const host: $TSFixMe = req.hostname;
 *         if (
 *             host &&
 *             (host === 'oneuptime.com' ||
 *                 host === 'staging.oneuptime.com' ||
 *                 host === 'oneuptime.com' ||
 *                 host === 'staging.oneuptime.com' ||
 *                 host.indexOf('localhost') > -1)
 *         ) {
 *             return next();
 *         }
 */

/*
 *         try {
 *             const response: $TSFixMe = await handleCustomDomain(
 *                 global.MongoClient,
 *                 'statuspages',
 *                 host
 *             );
 */

/*
 *             const { enableHttps }: $TSFixMe = response;
 *             if (enableHttps) {
 *                 if (!req.secure) {
 *                     res.writeHead(301, {
 *                         Location: `https://${host}${req.url}`,
 *                     });
 *                     return res.end();
 *                 }
 *                 return next();
 *             }
 *             if (req.secure) {
 *                 res.writeHead(301, {
 *                     Location: `http://${host}${req.url}`,
 *                 });
 *                 return res.end();
 *             }
 *             return next();
 *         } catch (error) {
 *             logger.info('Error with fetch', error);
 *             return next();
 *         }
 *     }
 * );
 */

/*
 * app.get(
 *     ['/StatusPage/status', '/status'],
 *     (req: ExpressRequest, res: ExpressResponse) => {
 *         res.setHeader('Content-Type', 'application/json');
 *         res.send(
 *             JSON.stringify({
 *                 status: 200,
 *                 message: 'Service Status - OK',
 *                 serviceType: 'oneuptime-StatusPage',
 *             })
 *         );
 *     }
 * );
 */

/*
 * app.use(ExpressStatic(path.join(__dirname, 'build')));
 * app.use('/StatusPage', ExpressStatic(path.join(__dirname, 'build')));
 * app.use(
 *     '/StatusPage/static/js',
 *     ExpressStatic(path.join(__dirname, 'build/static/js'))
 * );
 */

/*
 * app.get('/*', (req: ExpressRequest, res: ExpressResponse) => {
 *     res.sendFile(path.join(__dirname, 'build', 'index.html'));
 * });
 */

/*
 * async function fetchCredential(
 *     apiHost: $TSFixMe,
 *     credentialName: $TSFixMe,
 *     configPath: $TSFixMe
 * ): void {
 *     return new Promise((resolve: Function, reject: Function) => {
 *         fetch(`${apiHost}/file/${credentialName}`).then(
 *             (res: ExpressResponse) => {
 *                 const dest: $TSFixMe = fs.createWriteStream(configPath);
 *                 res.body.pipe(dest);
 *                 // At this point, writing to the specified file is complete
 *                 dest.on('finish', async () => {
 *                     resolve('done writing to file');
 *                 });
 */

/*
 *                 dest.on('error', async (error: Error) => {
 *                     reject(error);
 *                 });
 *             }
 *         );
 *     });
 * }
 */

/*
 * function decodeAndSave(content: $TSFixMe, filePath: $TSFixMe): void {
 *     return new Promise((resolve: $TSFixMe) => {
 *         const command: string = `echo ${content} | base64 -d`;
 *         let output: $TSFixMe = '';
 */

/*
 *         const commandOutput: $TSFixMe = spawn(command, {
 *             cwd: process.cwd(),
 *             shell: true,
 *         });
 *         commandOutput.stdout.on('data', (data: $TSFixMe) => {
 *             const strData: $TSFixMe = data.toString();
 *             output += strData;
 *         });
 *         commandOutput.on('close', () => {
 *             fs.writeFile(filePath, output, 'utf8', (): void => {
 *                 resolve('Done writing to disc');
 *             });
 *         });
 *     });
 * }
 */

/*
 * function createDir(dirPath: $TSFixMe): void {
 *     return new Promise((resolve: Function, reject: Function) => {
 *         const workPath: $TSFixMe = path.resolve(process.cwd(), 'src', dirPath);
 *         if (fs.existsSync(workPath)) {
 *             resolve(workPath);
 *         }
 */

/*
 *         fs.mkdir(workPath, (error: Error) => {
 *             if (error) {
 *                 reject(error);
 *             }
 *             resolve(workPath);
 *         });
 *     });
 * }
 */

/*
 * function countFreq(pat: $TSFixMe, txt: $TSFixMe): void {
 *     const M: $TSFixMe = pat.length;
 *     const N: $TSFixMe = txt.length;
 *     let res: $TSFixMe = 0;
 */

//     // A loop to slide pat[] one by one
//     for (let i: $TSFixMe = 0; i <= N - M; i++) {
//         /*
//          * For current index i, check for
//          * Pattern match
//          */
//         let j: $TSFixMe;
//         for (j = 0; j < M; j++) {
//             if (txt[i + j] !== pat[j]) {
//                 break;
//             }
//         }

/*
 *         if (j === M) {
 *             res++;
 *             j = 0;
 *         }
 *     }
 *     return res;
 * }
 */

/*
 * Using an IIFE here because we have an asynchronous code we want to run as we start the server
 * And since we can't await outside an async function, we had to use an IIFE to handle that
 */
// const setupCerts: Function = async (): void => {
//     try {
//         // Create https server
//         await createDir('credentials');
//         /*
//          * Decode base64 of the cert and private key
//          * Store the value to disc
//          */
//         const cert: $TSFixMe = process.env['STATUSPAGE_CERT'];
//         const certPath: $TSFixMe = path.resolve(
//             process.cwd(),
//             'src',
//             'credentials',
//             'certificate.crt'
//         );
//         const privateKey: $TSFixMe = process.env['STATUSPAGE_PRIVATEKEY'];
//         const privateKeyPath: $TSFixMe = path.resolve(
//             process.cwd(),
//             'src',
//             'credentials',
//             'private.key'
//         );
//         await Promise.all([
//             decodeAndSave(cert, certPath),
//             decodeAndSave(privateKey, privateKeyPath),
//         ]);

/*
 * TODO: Needs to be refactored.
 * const options: $TSFixMe = {
 *     cert: fs.readFileSync(
 *         path.resolve(
 *             process.cwd(),
 *             'src',
 *             'credentials',
 *             'certificate.crt'
 *         )
 *     ),
 *     key: fs.readFileSync(
 *         path.resolve(process.cwd(), 'src', 'credentials', 'private.key')
 *     ),
 *     SNICallback: async function (domain: $TSFixMe, cb: $TSFixMe): void {
 *         const res: $TSFixMe = await handleCustomDomain(
 *             global.MongoClient,
 *             'statuspages',
 *             domain
 *         );
 */

//         Let certPath: $TSFixMe, privateKeyPath: $TSFixMe;
//         If (res) {
//             Const {
//                 Cert,
//                 PrivateKey,
//                 AutoProvisioning,
//                 EnableHttps,
//                 Domain,
//             } = res;
//             /*
//              * Have a condition to check for autoProvisioning
//              * If auto provisioning is set
//              * Fetch the stored cert/privateKey
//              * Cert and private key is a string
//              * Store it to a file on disk
//              */
//             If (enableHttps && autoProvisioning) {
//                 Const certificate: $TSFixMe = await handleCertificate(
//                     Global.MongoClient,
//                     'certificates',
//                     Domain
//                 );
//                 If (certificate) {
//                     CertPath = path.resolve(
//                         Process.cwd(),
//                         'src',
//                         'credentials',
//                         `${certificate.id}.crt`
//                     );
//                     PrivateKeyPath = path.resolve(
//                         Process.cwd(),
//                         'src',
//                         'credentials',
//                         `${certificate.id}.key`
//                     );

//                     /*
//                      * Check if the certificate is container chain
//                      * If not, add anc show update view for the frontend
//                      */
//                     Let fullCert: $TSFixMe = certificate.cert;
//                     If (
//                         CountFreq(
//                             'BEGIN CERTIFICATE',
//                             Certificate.cert
//                         ) === 1
//                     ) {
//                         FullCert =
//                             Certificate.cert +
//                             '\n' +
//                             '\n' +
//                             Certificate.chain;
//                     }
//                     Fs.writeFileSync(certPath, fullCert);
//                     Fs.writeFileSync(
//                         PrivateKeyPath,
//                         Certificate.privateKeyPem
//                     );

/*
 *                     Return cb(
 *                         null,
 *                         tls.createSecureContext({
 *                             key: fs.readFileSync(privateKeyPath),
 *                             cert: fs.readFileSync(certPath),
 *                         })
 *                     );
 *                 }
 *             }
 */

/*
 *             If (cert && privateKey) {
 *                 certPath = path.resolve(
 *                     process.cwd(),
 *                     'src',
 *                     'credentials',
 *                     `${cert}.crt`
 *                 );
 *                 privateKeyPath = path.resolve(
 *                     process.cwd(),
 *                     'src',
 *                     'credentials',
 *                     `${privateKey}.key`
 *                 );
 */

/*
 *                 Await Promise.all([
 *                     fetchCredential(apiHost, cert, certPath),
 *                     fetchCredential(
 *                         apiHost,
 *                         privateKey,
 *                         privateKeyPath
 *                     ),
 *                 ]);
 */

/*
 *                 Return cb(
 *                     null,
 *                     tls.createSecureContext({
 *                         key: fs.readFileSync(privateKeyPath),
 *                         cert: fs.readFileSync(certPath),
 *                     })
 *                 );
 *             }
 *         }
 */

/*
 *         // Default for custom domains without cert/key credentials
 *         return cb(
 *             null,
 *             tls.createSecureContext({
 *                 cert: fs.readFileSync(
 *                     path.resolve(
 *                         process.cwd(),
 *                         'src',
 *                         'credentials',
 *                         'certificate.crt'
 *                     )
 *                 ),
 *                 key: fs.readFileSync(
 *                     path.resolve(
 *                         process.cwd(),
 *                         'src',
 *                         'credentials',
 *                         'private.key'
 *                     )
 *                 ),
 *             })
 *         );
 *     },
 * };
 */
/*
 * } catch (e) {
 *     logger.info('Unable to create HTTPS Server');
 */

/*
 *         logger.info(e);
 *     }
 * };
 */

// setupCerts();

/*
 * app.post('/unsubscribe', async (req: ExpressRequest, res: ExpressResponse) => {
 *     let apiHost: string;
 *     if (process.env['ONEUPTIME_HOST']) {
 *         apiHost = 'https://' + process.env['ONEUPTIME_HOST'] + '/api';
 *     } else {
 *         apiHost = 'http://localhost:3002/api';
 *     }
 */

/*
 *     try {
 *         const { email, monitors } = req.body;
 *         if (
 *             !email ||
 *             email[0] === null ||
 *             email[0] === undefined ||
 *             email[0] === ''
 *         ) {
 *             throw Error;
 *         } else if (
 *             !monitors ||
 *             monitors === null ||
 *             monitors === undefined ||
 *             monitors.length === 0
 *         ) {
 *             res.render('unsubscribe', {
 *                 message: 'No monitor was selected',
 *             });
 *         } else {
 *             monitors.forEach(async (monitorId: ObjectID) => {
 *                 await axios({
 *                     method: 'PUT',
 *                     url: `${apiHost}/subscriber/unsubscribe/${monitorId}/${email}`,
 *                 });
 *             });
 */

/*
 *             res.render('unsubscribe', {
 *                 message: 'You have been successfully unsubscribed.',
 *             });
 *         }
 *     } catch (err) {
 *         res.render('unsubscribe', {
 *             message:
 *                 'Encountered an error while trying to unsubscribe you from this monitor',
 *         });
 *     }
 * });
 */

/*
 * app.get(
 *     '/unsubscribe/:monitorId/:subscriberId',
 *     async (req: ExpressRequest, res: ExpressResponse) => {
 *         const { monitorId, subscriberId } = req.params;
 *         let apiHost: $TSFixMe;
 *         if (process.env['ONEUPTIME_HOST']) {
 *             apiHost = 'https://' + process.env['ONEUPTIME_HOST'] + '/api';
 *         } else {
 *             apiHost = 'http://localhost:3002/api';
 *         }
 */

/*
 *         try {
 *             const subscriptions: $TSFixMe = await axios({
 *                 method: 'GET',
 *                 url: `${apiHost}/subscriber/monitorList/${subscriberId}`,
 *             });
 */

/*
 *             if (subscriptions.data.data.length < 1) {
 *                 res.render('unsubscribe', {
 *                     message: 'You are currently not subscribed to any monitor',
 *                 });
 *             } else {
 *                 res.render('subscriberMonitors', {
 *                     subscriptions: subscriptions.data.data,
 *                     defaultMonitor: monitorId,
 *                 });
 *             }
 *         } catch (err) {
 *             res.render('unsubscribe', {
 *                 message:
 *                     'Encountered an error while trying to display your monitor list',
 *             });
 *         }
 *     }
 * );
 */
