import express from 'express';
import cors from 'cors';
import logger from './logger';

class Express {
    static app: express.Application;

    static getExpress(): express.Express {
        return express;
    }

    static setupExpress() {
        this.app = express();
        this.app.set('port', process.env.PORT);

        this.app.use(cors());
        this.app.use(function(
            req: express.Request,
            res: express.Response,
            next: express.RequestHandler
        ) {
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

            return next();
        });

        // Add limit of 10 MB to avoid "Request Entity too large error"
        // https://stackoverflow.com/questions/19917401/error-request-entity-too-large
        this.app.use(express.urlencoded({ limit: '10mb', extended: true }));
        this.app.use(express.json({ limit: '10mb' }));

        this.app.use(function(
            req: express.Request,
            res: express.Response,
            next: express.RequestHandler
        ) {
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
            const start = process.hrtime();

            const log = `[${formatted_date}] ${method}:${url} ${status}`;
            logger.info(log);
            return next();
        });
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
