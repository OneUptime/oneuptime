import express from 'express';
import logger from './Logger';
import { JSONObjectOrArray } from 'common/types/JSON';

export type RequestHandler = express.RequestHandler;
export type NextFunction = express.NextFunction;
export const ExpressStatic = express.static;
export const ExpressJson = express.json;
export const ExpressUrlEncoded = express.urlencoded;

type Probe = {
    id: String;
};

export type ExpressRequest = express.Request;
export type ExpressResponse = express.Response;

export interface OneUptimeRequest extends express.Request {
    probe?: Probe;
    id: string;
    requestStartedAt: Date;
    requestEndedAt: Date;
}

export interface OneUptimeResponse extends express.Response {
    logBody: JSONObjectOrArray;
}

class Express {
    private static app: express.Application;

    static getRouter() {
        return express.Router();
    }

    static setupExpress() {
        this.app = express();
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
