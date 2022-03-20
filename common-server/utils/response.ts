import JsonToCsv from './jsonToCsv';
import logger from './logger';
import { GridFSBucket } from 'mongodb';
import { Request, Response } from './express';
import { JSONObject, JSONArray, JSONValue } from '../types/json';
import { File } from '../types/file';
import { Exception } from '../types/error';
import { ListData } from '../types/list';

function logResponse(req: Request, res: Response, responsebody: JSONValue) {
    const requestEndedAt = Date.now();
    const method = req.method;
    const url = req.url;

    const duration_info = `OUTGOING RESPONSE ID: ${req.id} -- POD NAME: ${
        process.env.POD_NAME
    } -- METHOD: ${method} -- URL: ${url} -- DURATION: ${
        requestEndedAt - req.requestStartedAt
    }ms -- STATUS: ${res.statusCode}`;

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

export const sendEmptyResponse = (req: Request, res: Response) => {
    res.set('Request-Id', req.id);
    res.set('Pod-Id', process.env.POD_NAME);

    res.status(200).send();

    return logResponse(req, res);
};

export const sendFileResponse = (req: Request, res: Response, file: File) => {
    /** create read stream */

    const gfs = new GridFSBucket(global.client, {
        bucketName: 'uploads',
    });

    const readstream = gfs.openDownloadStreamByName(file.name);

    /** set the proper content type */
    res.set('Content-Type', file.contentType);
    res.status(200);
    /** return response */
    readstream.pipe(res);

    return logResponse(req, res, 'FILE');
};

export const sendErrorResponse = (
    req: Request,
    res: Response,
    error: Exception
) => {
    let status, message;
    if (error.statusCode && error.message) {
        res.logBody = { message: error.message }; // To be used in 'auditLog' middleware to log reponse data;
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
        res.logBody = { message: error.message };
        message = error.message;
    } else {
        res.logBody = { message: 'Server Error.' };
        status = 500;
        message = 'Server Error.';
    }

    if (!req.logdata) {
        req.logdata = {};
    }

    req.logdata.errorCode = status;

    logger.error(message);

    res.set('Request-Id', req.id);
    res.set('Pod-Id', process.env.POD_NAME);

    res.status(status).send({ message });
    return logResponse(req, res, { message });
};

export const sendListResponse = async (
    req: Request,
    res: Response,
    list: JSONArray,
    count: Number
) => {
    res.set('Request-Id', req.id);
    res.set('Pod-Id', process.env.POD_NAME);

    const response: ListData = {
        data: [],
        count: 0,
        skip: 0,
        limit: 0,
    };

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
        response.skip = parseInt(req.query.skip.toString());
    }

    if (req.query.limit) {
        response.limit = parseInt(req.query.limit.toString());
    }

    if (req.query['output-type'] === 'csv') {
        const csv = await JsonToCsv.ToCsv(response.data);
        res.status(200).send(csv);
    } else {
        res.status(200).send(response);
        res.logBody = response; // To be used in 'auditLog' middleware to log reponse data;
        res.status(200).send(response);
        return logResponse(req, res, response);
    }
};

export const sendItemResponse = async (
    req: Request,
    res: Response,
    item: JSONObject
) => {
    res.set('Request-Id', req.id);
    res.set('Pod-Id', process.env.POD_NAME);

    if (req.query['output-type'] === 'csv') {
        const csv = JsonToCsv.ToCsv([item]);
        res.logBody = csv;
        res.status(200).send(csv);
        return logResponse(req, res, csv);
    }

    res.logBody = item;
    res.status(200).send(item);
    return logResponse(req, res, item);
};
