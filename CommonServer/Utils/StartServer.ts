import './Envrionment';
import './Process';
import logger from './Logger';
import cors from 'cors';
import type Port from 'Common/Types/Port';
import type {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
    ExpressApplication,
    RequestHandler,
    OneUptimeRequest,
} from './Express';
import Express, {
    ExpressJson,
    ExpressUrlEncoded,
    ExpressStatic,
} from './Express';
// Connect common api's.
import CommonAPI from '../API/Index';
import NotFoundException from 'Common/Types/Exception/NotFoundException';

import OneUptimeDate from 'Common/Types/Date';
import LocalCache from '../Infrastructure/LocalCache';
import Exception from 'Common/Types/Exception/Exception';
import ObjectID from 'Common/Types/ObjectID';
import StatusCode from 'Common/Types/API/StatusCode';
import Typeof from 'Common/Types/Typeof';
import Response from './Response';
// import OpenTelemetrySDK from "./OpenTelemetry";

const app: ExpressApplication = Express.getExpressApp();

app.set('port', process.env['PORT']);
app.set('view engine', 'ejs');

const logRequest: RequestHandler = (
    req: ExpressRequest,
    _res: ExpressResponse,
    next: NextFunction
): void => {
    (req as OneUptimeRequest).id = ObjectID.generate();
    (req as OneUptimeRequest).requestStartedAt = OneUptimeDate.getCurrentDate();

    const method: string = req.method;
    const url: string = req.url;

    const header_info: string = `Request ID: ${
        (req as OneUptimeRequest).id
    } -- POD NAME: ${
        process.env['POD_NAME'] || 'NONE'
    } -- METHOD: ${method} -- URL: ${url.toString()}`;

    const body_info: string = `Request ID: ${
        (req as OneUptimeRequest).id
    } -- Request Body: ${
        req.body ? JSON.stringify(req.body, null, 2) : 'EMPTY'
    }`;

    logger.info(header_info + '\n ' + body_info);
    next();
};

const setDefaultHeaders: RequestHandler = (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction
): void => {
    if (typeof req.body === Typeof.String) {
        req.body = JSON.parse(req.body);
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

app.use(ExpressJson({ limit: '50mb' }));
app.use(ExpressUrlEncoded({ limit: '50mb' }));

app.use(logRequest);

const init: Function = async (
    appName: string,
    port?: Port,
    isFrontendApp?: boolean
): Promise<ExpressApplication> => {
    await Express.launchApplication(appName, port);
    LocalCache.setString('app', 'name', appName);
    CommonAPI(appName);

    if (isFrontendApp) {
        app.use(ExpressStatic('/usr/src/app/public'));

        app.get(
            [`/${appName}/env.js`, '/env.js'],
            (req: ExpressRequest, res: ExpressResponse) => {
                const script: string = `
    if(!window.process){
      window.process = {}
    }

    if(!window.process.env){
      window.process.env = {}
    }
    const envVars = '${JSON.stringify(process.env)}';
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
                        StatusCode.isValidStausCode(
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
