import JsonToCsv from './jsonToCsv';
import ErrorService from './error';
import logger from './logger';
import { GridFSBucket } from 'mongodb';

function logResponse(
    req: express.Request,
    res: express.Response,
    responsebody: $TSFixMe
) {
    const requestEndedAt = Date.now();
    const method = req.method;
    const url = req.url;

    const duration_info = `OUTGOING RESPONSE ID: ${req.id} -- POD NAME: ${
        process.env.POD_NAME
    } -- METHOD: ${method} -- URL: ${url} -- DURATION: ${requestEndedAt -
        req.requestStartedAt}ms -- STATUS: ${res.statusCode}`;

    const body_info = `OUTGOING RESPONSE ID: ${req.id} -- RESPONSE BODY: ${
        responsebody ? JSON.stringify(responsebody, null, 2) : 'EMPTY'
    }`;

    if (res.statusCode > 299) {
        logger.error(duration_info);
        logger.error(body_info);
    } else {
        logger.info(duration_info);
        logger.info(body_info);
    }
}

export const sendEmptyResponse = (
    req: express.Request,
    res: express.Response
) => {
    res.set('Request-Id', req.id);
    res.set('Pod-Id', process.env.POD_NAME);

    res.status(200).send();

    return logResponse(req, res);
};

export const sendFileResponse = (
    req: express.Request,
    res: express.Response,
    file: $TSFixMe
) => {
    /** create read stream */

    const gfs = new GridFSBucket(global.client, {
        bucketName: 'uploads',
    });

    const readstream = gfs.openDownloadStreamByName(file.filename);

    /** set the proper content type */
    res.set('Content-Type', file.contentType);
    res.status(200);
    /** return response */
    readstream.pipe(res);

    return logResponse(req, res, 'FILE');
};

export const sendErrorResponse = (
    req: express.Request,
    res: express.Response,
    error: $TSFixMe
) => {
    let status, message;
    if (error.statusCode && error.message) {
        res.resBody = { message: error.message }; // To be used in 'auditLog' middleware to log reponse data;
        status = error.statusCode;
        message = error.message;
    } else if (error.code && error.message && typeof error.code === 'number') {
        status = error.code;
        if (
            error.code &&
            error.status &&
            typeof error.code === 'number' &&
            typeof error.status === 'number' &&
            error.code > 600
        ) {
            status = error.status;
        }
        res.resBody = { message: error.message };
        message = error.message;
    } else {
        res.resBody = { message: 'Server Error.' };
        status = 500;
        message = 'Server Error.';
    }

    if (!req.logdata) {
        req.logdata = {};
    }

    req.logdata.errorCode = status;
    ErrorService.log('sendErrorResponse', message, req.logdata);

    res.set('Request-Id', req.id);
    res.set('Pod-Id', process.env.POD_NAME);

    res.status(status).send({ message });
    return logResponse(req, res, { message });
};

export const sendListResponse = async (
    req: express.Request,
    res: express.Response,
    list: $TSFixMe,
    count: $TSFixMe
) => {
    const response = {};

    if (!list) {
        list = [];
    }

    if (list) {
        response.data = list;
    }

    if (count) {
        response.count = count;
    } else {
        if (list) response.count = list.length;
    }

    if (req.query.skip) {
        response.skip = parseInt(req.query.skip);
    }

    if (req.query.limit) {
        response.limit = parseInt(req.query.limit);
    }

    if (req.query['output-type'] === 'csv') {
        if (!Array.isArray(response.data)) {
            const properties = Object.keys(response.data);
            const newObj = {};
            properties.forEach(prop => {
                if (
                    typeof response.data[[prop]] === 'object' &&
                    response.data[[prop]] !== null
                ) {
                    if (response.data[[prop]].name)
                        response.data[[prop]] = response.data[[prop]].name;
                    else if (response.data[[prop]].title)
                        response.data[[prop]] = response.data[[prop]].title;
                    else if (response.data[[prop]]._id)
                        response.data[[prop]] = response.data[[prop]]._id;
                }

                newObj[[prop]] = response.data[[prop]];
            });

            response.data = JSON.parse(JSON.stringify(newObj));

            response.data = [response.data];
        } else {
            response.data = response.data.map((i: $TSFixMe) => {
                i = i._doc ? i._doc : i;
                const properties = Object.keys(i);
                const newObj = {};
                properties.forEach(prop => {
                    if (typeof i[[prop]] === 'object' && i[[prop]] !== null) {
                        if (i[[prop]].name) i[[prop]] = i[[prop]].name;
                        else if (i[[prop]].title) i[[prop]] = i[[prop]].title;
                        else if (i[[prop]]._id) i[[prop]] = i[[prop]]._id;
                    }

                    newObj[[prop]] = i[[prop]];
                });
                return JSON.parse(JSON.stringify(newObj));
            });
        }

        response.data = await JsonToCsv.ToCsv(response.data);
    }

    res.resBody = response; // To be used in 'auditLog' middleware to log reponse data;
    res.set('Request-Id', req.id);
    res.set('Pod-Id', process.env.POD_NAME);
    res.status(200).send(response);

    return logResponse(req, res, response);
};

export const sendItemResponse = async (
    req: express.Request,
    res: express.Response,
    item: $TSFixMe
) => {
    if (req.query['output-type'] === 'csv') {
        if (!Array.isArray(item)) {
            const properties = Object.keys(item);
            const newObj = {};
            properties.forEach(prop => {
                if (typeof item[[prop]] === 'object' && item[[prop]] !== null) {
                    if (item[[prop]].name) item[[prop]] = item[[prop]].name;
                    else if (item[[prop]].title)
                        item[[prop]] = item[[prop]].title;
                    else if (item[[prop]]._id) item[[prop]] = item[[prop]]._id;
                }

                newObj[[prop]] = item[[prop]];
            });
            item = JSON.parse(JSON.stringify(newObj));
            item = [item];
        } else {
            item = item.map(i => {
                i = i._doc ? i._doc : i;
                const properties = Object.keys(i);
                const newObj = {};
                properties.forEach(prop => {
                    if (typeof i[[prop]] === 'object' && i[[prop]] !== null) {
                        if (i[[prop]].name) i[[prop]] = i[[prop]].name;
                        else if (i[[prop]].title) i[[prop]] = i[[prop]].title;
                        else if (i[[prop]]._id) i[[prop]] = i[[prop]]._id;
                    }

                    newObj[[prop]] = i[[prop]];
                });
                return JSON.parse(JSON.stringify(newObj));
            });
        }
        item = await JsonToCsv.ToCsv(item);
    }

    res.resBody = item; // To be used in 'auditLog' middleware to log reponse data;

    res.set('Request-Id', req.id);
    res.set('Pod-Id', process.env.POD_NAME);

    res.status(200).send(item);

    return logResponse(req, res, item);
};
