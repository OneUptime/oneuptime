import JsonToCsv from './JsonToCsv';
import logger from './Logger';
import {
    OneUptimeRequest,
    ExpressResponse,
    ExpressRequest,
    OneUptimeResponse,
} from './Express';
import { JSONObject, JSONArray, JSONObjectOrArray } from 'Common/Types/JSON';
import { File } from 'Common/Types/File';
import Exception from 'Common/Types/Exception/Exception';
import ListData from 'Common/Types/ListData';
import PositiveNumber from 'Common/Types/PositiveNumber';
import URL from 'Common/Types/API/URL';

export default class Response {
    private static logResponse(
        req: ExpressRequest,
        res: ExpressResponse,
        responsebody?: JSONObjectOrArray
    ): void {
        const oneUptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
        const oneUptimeResponse: OneUptimeResponse = res as OneUptimeResponse;
    
        const requestEndedAt: Date = new Date();
        const method: string = oneUptimeRequest.method;
        const url: URL = URL.fromString(oneUptimeRequest.url);
    
        const duration_info: string = `OUTGOING RESPONSE ID: ${
            oneUptimeRequest.id
        } -- POD NAME: ${
            process.env['POD_NAME'] || 'NONE'
        } -- METHOD: ${method} -- URL: ${url.toString()} -- DURATION: ${(
            requestEndedAt.getTime() - oneUptimeRequest.requestStartedAt.getTime()
        ).toString()}ms -- STATUS: ${oneUptimeResponse.statusCode}`;
    
        const body_info: string = `OUTGOING RESPONSE ID: ${
            oneUptimeRequest.id
        } -- RESPONSE BODY: ${
            responsebody ? JSON.stringify(responsebody, null, 2) : 'EMPTY'
        }`;
    
        if (oneUptimeResponse.statusCode > 299) {
            logger.error(duration_info);
            logger.error(body_info);
        } else {
            logger.info(duration_info);
            logger.info(body_info);
        }
    }
    
    public static sendEmptyResponse(
        req: ExpressRequest,
        res: ExpressResponse
    ): void {
        const oneUptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
        const oneUptimeResponse: OneUptimeResponse = res as OneUptimeResponse;
    
        oneUptimeResponse.set('ExpressRequest-Id', oneUptimeRequest.id.toString());
        oneUptimeResponse.set('Pod-Id', process.env['POD_NAME']);
    
        oneUptimeResponse.status(200).send();
    
        return this.logResponse(req, res, undefined);
    }
    
    public static async sendFileResponse (
        req: ExpressRequest | ExpressRequest,
        res: ExpressResponse,
        file: File
    ): Promise<void> {
        /** Create read stream */
    
        const oneUptimeResponse: OneUptimeResponse = res as OneUptimeResponse;
    
        /*
         * const gfs: GridFSBucket = new GridFSBucket(await Database.getDatabase(), {
         *     bucketName: 'uploads',
         * });
         */
    
        /*
         * const readstream: GridFSBucketReadStream = gfs.openDownloadStreamByName(
         *     file.name
         * );
         */
    
        /** Set the proper content type */
        oneUptimeResponse.set('Content-Type', file.contentType);
        oneUptimeResponse.status(200);
        /** Return response */
        // readstream.pipe(res);
    
        this.logResponse(req, res);
    };
    
    public static sendErrorResponse (
        req: ExpressRequest,
        res: ExpressResponse,
        error: Exception
    ): void  {
        const oneUptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
        const oneUptimeResponse: OneUptimeResponse = res as OneUptimeResponse;
    
        oneUptimeResponse.logBody = { message: error.message }; // To be used in 'auditLog' middleware to log reponse data;
        const status: number = error.code || 500;
        const message: string = error.message || 'Server Error';
    
        logger.error(error);
    
        oneUptimeResponse.set('ExpressRequest-Id', oneUptimeRequest.id.toString());
        oneUptimeResponse.set('Pod-Id', process.env['POD_NAME']);
    
        oneUptimeResponse.status(status).send({ message });
        return this.logResponse(req, res, { message });
    };
    
   public static sendListResponse (
        req: ExpressRequest,
        res: ExpressResponse,
        list: JSONArray,
        count: PositiveNumber
    ): void {
        const oneUptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
        const oneUptimeResponse: OneUptimeResponse = res as OneUptimeResponse;
    
        oneUptimeResponse.set('ExpressRequest-Id', oneUptimeRequest.id.toString());
        oneUptimeResponse.set('Pod-Id', process.env['POD_NAME']);
    
        const listData: ListData = new ListData({
            data: [],
            count: new PositiveNumber(0),
            skip: new PositiveNumber(0),
            limit: new PositiveNumber(0),
        });
    
        if (!list) {
            list = [];
        }
    
        if (list) {
            listData.data = list;
        }
    
        if (count) {
            listData.count = count;
        } else if (list) {
            listData.count = new PositiveNumber(list.length);
        }
    
        if (oneUptimeRequest.query['skip']) {
            listData.skip = new PositiveNumber(
                parseInt(oneUptimeRequest.query['skip'].toString())
            );
        }
    
        if (oneUptimeRequest.query['limit']) {
            listData.limit = new PositiveNumber(
                parseInt(oneUptimeRequest.query['limit'].toString())
            );
        }
    
        if (oneUptimeRequest.query['output-type'] === 'csv') {
            const csv: string = JsonToCsv.ToCsv(listData.data);
            oneUptimeResponse.status(200).send(csv);
        } else {
            oneUptimeResponse.status(200).send(listData);
            oneUptimeResponse.logBody = listData.toJSON(); // To be used in 'auditLog' middleware to log reponse data;
            oneUptimeResponse.status(200).send(listData);
            this.logResponse(req, res, listData.toJSON());
        }
    };
    
    public static sendItemResponse (
        req: ExpressRequest,
        res: ExpressResponse,
        item: JSONObject
    ): void {
        const oneUptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
        const oneUptimeResponse: OneUptimeResponse = res as OneUptimeResponse;
    
        oneUptimeResponse.set('ExpressRequest-Id', oneUptimeRequest.id.toString());
        oneUptimeResponse.set('Pod-Id', process.env['POD_NAME']);
    
        if (oneUptimeRequest.query['output-type'] === 'csv') {
            const csv: string = JsonToCsv.ToCsv([item]);
            oneUptimeResponse.status(200).send(csv);
            this.logResponse(req, res);
            return;
        }
    
        oneUptimeResponse.logBody = item;
        oneUptimeResponse.status(200).send(item);
        this.logResponse(req, res, item);
    };
    
}
