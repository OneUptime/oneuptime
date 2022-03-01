import express from 'express';
const app = express();

const { NODE_ENV } = process.env;

if (!NODE_ENV || NODE_ENV === 'development') {
    // Load env vars from /licensing/.env
    import dotenv from 'dotenv';
    dotenv.config();
}

process.on('exit', () => {
    // eslint-disable-next-line no-console
    console.log('Server Shutting Shutdown');
});

process.on('uncaughtException', err => {
    // eslint-disable-next-line no-console
    console.error('Uncaught exception in server process occurred');
    // eslint-disable-next-line no-console
    console.error(err);
});

import path from 'path';

import http from 'http';

http.createServer(app);

import bodyParser from 'body-parser';

import cors from 'cors';

app.use(cors());

app.use(function (
    req: Request,
    res: Response,
    next: RequestHandler
) {
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
app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));
app.use(bodyParser.json({ limit: '10mb' }));

//View engine setup
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use(express.static(path.join(__dirname, 'views')));
app.use('/', express.static(path.join(__dirname, 'views', 'img')));

// Routes(API)
app.use('/license/validate', require('./src/api/license'));
app.set('port', process.env.PORT || 3004);

const server = http.listen(app.get('port'), function () {
    // eslint-disable-next-line
    console.log('Server Started on port ' + app.get('port'));
});

app.get(['/', '/license'], function (
    req: Request,
    res: Response
) {
    res.setHeader('Content-Type', 'application/json');
    res.send(
        JSON.stringify({
            status: 200,
            message: 'Service Status - OK',
            serviceType: 'oneuptime-license-server',
        })
    );
});

app.use('/*', function (req: Request, res: Response) {
    res.status(404).render('notFound.ejs', {});
});

export default app;
module.exports.close = function () {
    server.close();
};
