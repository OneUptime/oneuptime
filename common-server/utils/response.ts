import JsonToCsv from './jsonToCsv';
import logger from './logger';
import { GridFSBucket } from 'mongodb';
import { Request, Response } from './express';
import { JSONObject, JSONArray, JSONValue } from '../types/json';
import { File } from '../types/file';
import { Exception } from '../types/error';
import { ListData } from '../types/list';
import Database from './database';

function logResponse(req: Request, res: Response, responsebody?: JSONValue) {
    const requestEndedAt: Date = new Date();
    const method = req.method;
    const url = req.url;

    const duration_info = `OUTGOING RESPONSE ID: ${req.id} -- POD NAME: ${
        process.env['POD_NAME'] || 'NONE'
    } -- METHOD: ${method} -- URL: ${url} -- DURATION: ${(
        requestEndedAt.getTime() - req.requestStartedAt.getTime()
    ).toString()}ms -- STATUS: ${res.statusCode}`;

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
    res.set('Pod-Id', process.env['POD_NAME']);

    res.status(200).send();

    return logResponse(req, res, undefined);
};

export const sendFileResponse = async (
    req: Request,
    res: Response,
    file: File
) => {
    /** create read stream */

    const gfs = new GridFSBucket(await Database.getDatabase(), {
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
    res.logBody = { message: error.message }; // To be used in 'auditLog' middleware to log reponse data;
    const status: number = error.code || 500;
    const message: string = error.message || 'Server Error';

    logger.error(error);

    res.set('Request-Id', req.id);
    res.set('Pod-Id', process.env['POD_NAME']);

    res.status(status).send({ message });
    return logResponse(req, res, { message });
};

export const sendListResponse = async (
    req: Request,
    res: Response,
    list: JSONArray,
    count: number
) => {
    res.set('Request-Id', req.id);
    res.set('Pod-Id', process.env['POD_NAME']);

    const listData: ListData = new ListData({
        data: [],
        count: 0,
        skip: 0,
        limit: 0,
    });

    if (!list) {
        list = [];
    }

    if (list) {
        listData.data = list;
    }

    if (count) {
        listData.count = count;
    } else {
        if (list) listData.count = list.length;
    }

    if (req.query['skip']) {
        listData.skip = parseInt(req.query['skip'].toString());
    }

    if (req.query['limit']) {
        listData.limit = parseInt(req.query['limit'].toString());
    }

    if (req.query['output-type'] === 'csv') {
        const csv = await JsonToCsv.ToCsv(listData.data);
        res.status(200).send(csv);
    } else {
        res.status(200).send(listData);
        res.logBody = listData.toJSONValue(); // To be used in 'auditLog' middleware to log reponse data;
        res.status(200).send(listData);
        return logResponse(req, res, listData.toJSONValue());
    }
};

export const sendItemResponse = async (
    req: Request,
    res: Response,
    item: JSONObject
) => {
    res.set('Request-Id', req.id);
    res.set('Pod-Id', process.env['POD_NAME']);

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
