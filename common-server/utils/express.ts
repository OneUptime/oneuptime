import express from 'express';
import cors from 'cors';
import logger from './logger';
import { JSONValue } from '../types/json';

export type RequestHandler = express.RequestHandler;
export type NextFunction = express.NextFunction;

type Probe = {
    id: String;
};

export interface Request extends express.Request {
    probe?: Probe; // or any other type
    id: string;
}

export interface Response extends express.Response {
    logBody: JSONValue;
}

class Express {
    private static app: express.Application;

    static getRouter() {
        return express.Router();
    }

    static setupExpress() {
        this.app = express();
        this.app.set('port', process.env.PORT);

        const logRequest = (
            req: Request,
            res: Response,
            next: NextFunction
        ) => {
            const current_datetime = new Date();
            const formatted_date =
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
            const method = req.method;
            const url = req.url;
            const status = res.statusCode;

            const log = `[${formatted_date}] ${method}:${url} ${status}`;
            logger.info(log);
            next();
        };

        const setDefaultHeaders = (
            req: Request,
            res: Response,
            next: NextFunction
        ) => {
            if (typeof req.body === 'string') {
                req.body = JSON.parse(req.body);
            }
            res.header('Access-Control-Allow-Credentials', 'true');
            res.header('Access-Control-Allow-Origin', req.headers.origin);
            res.header(
                'Access-Control-Allow-Methods',
                'GET,PUT,POST,DELETE,OPTIONS'
            );
            res.header(
                'Access-Control-Allow-Headers',
                'X-Requested-With, X-HTTP-Method-Override, Content-Type, Accept,Authorization'
            );

            next();
        };

        this.app.use(cors());
        this.app.use(setDefaultHeaders);

        // Add limit of 10 MB to avoid "Request Entity too large error"
        // https://stackoverflow.com/questions/19917401/error-request-entity-too-large
        this.app.use(express.urlencoded({ limit: '10mb', extended: true }));
        this.app.use(express.json({ limit: '10mb' }));

        this.app.use(logRequest);
    }

    static getExpressApp(): express.Application {
        if (!this.app) {
            this.setupExpress();
        }

        return this.app;
    }

    static launchApplication() {
        if (!this.app) {
            this.setupExpress();
        }

        this.app.listen(this.app.get('port'), () => {
            // eslint-disable-next-line
            logger.info(`Server started on port: ${this.app.get('port')}`);
        });

        return this.app;
    }
}

export default Express;
