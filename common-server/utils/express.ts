import express from 'express';
import cors from 'cors';

class Express {

    static app: express.Application;


    static setupExpress() {
        this.app = express();
        this.app.set('port', process.env.PORT);

        this.app.use(cors());
        this.app.use(function (req, res, next) {
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

            return next();
        });

        // Add limit of 10 MB to avoid "Request Entity too large error"
        // https://stackoverflow.com/questions/19917401/error-request-entity-too-large
        this.app.use(express.urlencoded({ limit: '10mb', extended: true }));
        this.app.use(express.json({ limit: '10mb' }));

        const getActualRequestDurationInMilliseconds = start => {
            const NS_PER_SEC = 1e9; //  convert to nanoseconds
            const NS_TO_MS = 1e6; // convert to milliseconds
            const diff = process.hrtime(start);
            return (diff[0] * NS_PER_SEC + diff[1]) / NS_TO_MS;
        };


        this.app.use(function (req, res, next) {
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
            const durationInMilliseconds = getActualRequestDurationInMilliseconds(
                start
            );
            const log = `[${formatted_date}] ${method}:${url} ${status} ${durationInMilliseconds.toLocaleString()} ms`;
            console.log(log);
            return next();
        });

    }

    static getExpressApp(): express.Application{
        if(!this.app){
            this.setupExpress();
        }

        return this.app;
    }

    static launchApplication() {
        if(!this.app){
            this.setupExpress();
        }

        this.app.listen(this.app.get('port'), function() {
            // eslint-disable-next-line
            console.log('probe-api server started on port ' + this.app.get('port'));
        });
        
        return this.app; 
    }
}


export default Express;