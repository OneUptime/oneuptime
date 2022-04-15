import './Env';
import './Process';
import logger from './Logger';
import cors from 'cors';

import Express, {
    ExpressRequest,
    ExpressResponse,
    NextFunction,
    ExpressJson,
    ExpressUrlEncoded,
} from './Express';

// Connect common api's.
import '../API/Index';

const app: $TSFixMe = Express.getExpressApp();

app.set('port', process.env.PORT);

const logRequest: Function = (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction
): void => {
    const current_datetime: $TSFixMe = new Date();
    const formatted_date: $TSFixMe =
        current_datetime.getFullYear() +
        '-' +
        (current_datetime.getMonth() + 1) +
        '-' +
        current_datetime.getDate() +
        ' ' +
        current_datetime.getHours() +
        ':' +
        current_datetime.getMinutes() +
        ':' +
        current_datetime.getSeconds();

    const method: $TSFixMe = req.method;
    const url: $TSFixMe = req.url;
    const status: $TSFixMe = res.statusCode;

    const log: string = `[${formatted_date}] ${method}:${url} ${status}`;
    logger.info(log);
    next();
};

const setDefaultHeaders: Function = (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction
): void => {
    if (typeof req.body === 'string') {
        req.body = JSON.parse(req.body);
    }
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Allow-Origin', req.headers.origin);
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
app.use(ExpressJson({ limit: '10mb' }));
app.use(ExpressUrlEncoded({ limit: '10mb' }));

app.use(logRequest);

Express.launchApplication();

export default app;
