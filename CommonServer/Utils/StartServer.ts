import './Environment';
import './Process';
import logger from './Logger';
import cors from 'cors';
import Port from 'Common/Types/Port';
import Express, {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
    ExpressJson,
    ExpressUrlEncoded,
    ExpressApplication,
    RequestHandler,
    OneUptimeRequest,
    ExpressStatic,
} from './Express';
// Connect common api's.
import CommonAPI from '../API/Index';
import NotFoundException from 'Common/Types/Exception/NotFoundException';
import { JSONObject } from 'Common/Types/JSON';
import OneUptimeDate from 'Common/Types/Date';
import LocalCache from '../Infrastructure/LocalCache';
import Exception from 'Common/Types/Exception/Exception';
import ObjectID from 'Common/Types/ObjectID';
import StatusCode from 'Common/Types/API/StatusCode';
import Typeof from 'Common/Types/Typeof';
import Response from './Response';
import JSONFunctions from 'Common/Types/JSONFunctions';
import { AppVersion } from '../EnvironmentConfig';
import ServerException from 'Common/Types/Exception/ServerException';
import zlib from 'zlib';
import CookieParser from 'cookie-parser';

// Make sure we have stack trace for debugging.
Error.stackTraceLimit = Infinity;

const app: ExpressApplication = Express.getExpressApp();

app.disable('x-powered-by');
app.set('port', process.env['PORT']);
app.set('view engine', 'ejs');
app.use(CookieParser());

const jsonBodyParserMiddleware: Function = ExpressJson({
    limit: '50mb',
    extended: true,
}); // 50 MB limit.

const urlEncodedMiddleware: Function = ExpressUrlEncoded({
    limit: '50mb',
    extended: true,
}); // 50 MB limit.

const logRequest: RequestHandler = (
    req: ExpressRequest,
    _res: ExpressResponse,
    next: NextFunction
): void => {
    (req as OneUptimeRequest).id = ObjectID.generate();
    (req as OneUptimeRequest).requestStartedAt = OneUptimeDate.getCurrentDate();

    let requestBody: string =
        req.body && req.headers['content-encoding'] !== 'gzip'
            ? JSON.stringify(req.body)
            : 'EMPTY';

    if (req.headers['content-encoding'] === 'gzip') {
        requestBody = 'GZIP';
    }

    const oneUptimeRequest: OneUptimeRequest = req as OneUptimeRequest;

    const method: string = oneUptimeRequest.method;
    const path: string = oneUptimeRequest.originalUrl.toString();

    const logLine: JSONObject = {
        RequestID: `${oneUptimeRequest.id}`,

        PodName: `${process.env['POD_NAME'] || 'NONE'}`,

        HTTPMethod: `${method}`,

        Path: `${path.toString()}`,

        Host: `${oneUptimeRequest.hostname}`,

        RequestBody: `${requestBody}`,
    };

    logger.info(logLine);
    next();
};

const setDefaultHeaders: RequestHandler = (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction
): void => {
    if (typeof req.body === Typeof.String) {
        req.body = JSONFunctions.parse(req.body);
    }
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Origin', req.headers['origin']);
    res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
    res.header(
        'Access-Control-Allow-Headers',
        'X-Requested-With, X-HTTP-Method-Override, Content-Type, Accept,Authorization'
    );

    next();
};

app.use(cors());
app.use(setDefaultHeaders);

/*
 * Add limit of 10 MB to avoid "Request Entity too large error"
 * https://stackoverflow.com/questions/19917401/error-request-entity-too-large
 */

app.use((req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    if (req.headers['content-encoding'] === 'gzip') {
        const buffers: any = [];

        req.on('data', (chunk: any) => {
            buffers.push(chunk);
        });

        req.on('end', () => {
            const buffer: Buffer = Buffer.concat(buffers);
            zlib.gunzip(buffer, (err: unknown, decoded: Buffer) => {
                if (err) {
                    logger.error(err);
                    return Response.sendErrorResponse(
                        req,
                        res,
                        new ServerException('Error decompressing data')
                    );
                }

                req.body = decoded;

                next();
            });
        });
    } else {
        jsonBodyParserMiddleware(req, res, next);
    }
});

app.use((req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
    if (req.headers['content-encoding'] === 'gzip') {
        next();
    } else {
        urlEncodedMiddleware(req, res, next);
    }
});

app.use(logRequest);

const init: Function = async (
    appName: string,
    port?: Port,
    isFrontendApp?: boolean
): Promise<ExpressApplication> => {
    logger.info(`App Version: ${AppVersion.toString()}`);

    await Express.launchApplication(appName, port);
    LocalCache.setString('app', 'name', appName);
    CommonAPI(appName);

    if (isFrontendApp) {
        app.use(ExpressStatic('/usr/src/app/public'));

        app.get(
            [`/${appName}/env.js`, '/env.js'],
            async (req: ExpressRequest, res: ExpressResponse) => {
                // ping api server for database config.

                const env: JSONObject = {
                    ...process.env,
                };

                const script: string = `
    if(!window.process){
      window.process = {}
    }

    if(!window.process.env){
      window.process.env = {}
    }
    const envVars = '${JSON.stringify(env)}';
    window.process.env = JSON.parse(envVars);
  `;

                Response.sendJavaScriptResponse(req, res, script);
            }
        );

        app.use(`/${appName}`, ExpressStatic('/usr/src/app/public'));

        app.get(
            `/${appName}/dist/bundle.js`,
            (_req: ExpressRequest, res: ExpressResponse) => {
                res.sendFile('/usr/src/app/public/dist/bundle.js');
            }
        );

        app.get('/*', (_req: ExpressRequest, res: ExpressResponse) => {
            res.sendFile('/usr/src/app/public/index.html');
        });
    }

    // Attach Error Handler.
    app.use(
        (
            err: Error | Exception,
            _req: ExpressRequest,
            res: ExpressResponse,
            next: NextFunction
        ) => {
            logger.error(err);

            if (res.headersSent) {
                return next(err);
            }

            if (err instanceof Promise) {
                err.catch((exception: Exception) => {
                    if (
                        StatusCode.isValidStatusCode(
                            (exception as Exception).code
                        )
                    ) {
                        res.status((exception as Exception).code);
                        res.send({ error: (exception as Exception).message });
                    } else {
                        res.status(500);
                        res.send({ error: 'Server Error' });
                    }
                });
            } else if (err instanceof Exception) {
                res.status((err as Exception).code);
                res.send({ error: (err as Exception).message });
            } else {
                res.status(500);
                res.send({ error: 'Server Error' });
            }
        }
    );

    app.post('*', (req: ExpressRequest, res: ExpressResponse) => {
        return Response.sendErrorResponse(
            req,
            res,
            new NotFoundException('Not found')
        );
    });

    app.put('*', (req: ExpressRequest, res: ExpressResponse) => {
        return Response.sendErrorResponse(
            req,
            res,
            new NotFoundException('Not found')
        );
    });

    app.delete('*', (req: ExpressRequest, res: ExpressResponse) => {
        return Response.sendErrorResponse(
            req,
            res,
            new NotFoundException('Not found')
        );
    });

    app.get('*', (req: ExpressRequest, res: ExpressResponse) => {
        return Response.sendErrorResponse(
            req,
            res,
            new NotFoundException('Not found')
        );
    });

    // await OpenTelemetrySDK.start();

    return app;
};

export default init;
