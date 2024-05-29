import {
    ExpressRequest,
    ExpressResponse,
    OneUptimeRequest,
    OneUptimeResponse,
} from './Express';
import JsonToCsv from './JsonToCsv';
import logger from './Logger';
import AnalyticsDataModel, {
    AnalyticsBaseModelType,
} from 'Common/AnalyticsModels/BaseModel';
import BaseModel, { BaseModelType } from 'Common/Models/BaseModel';
import FileModel from 'Common/Models/FileModel';
import EmptyResponse from 'Common/Types/API/EmptyResponse';
import StatusCode from 'Common/Types/API/StatusCode';
import URL from 'Common/Types/API/URL';
import { DEFAULT_LIMIT } from 'Common/Types/Database/LimitMax';
import Dictionary from 'Common/Types/Dictionary';
import Exception from 'Common/Types/Exception/Exception';
import { JSONArray, JSONObject } from 'Common/Types/JSON';
import ListData from 'Common/Types/ListData';
import PositiveNumber from 'Common/Types/PositiveNumber';

export default class Response {
    public static sendEmptySuccessResponse(
        _req: ExpressRequest,
        res: ExpressResponse
    ): void {
        const oneUptimeResponse: OneUptimeResponse = res as OneUptimeResponse;

        oneUptimeResponse.status(200).send({} as EmptyResponse);
    }

    public static sendCustomResponse(
        _req: ExpressRequest,
        res: ExpressResponse,
        statusCode: number,
        body: JSONObject | string,
        headers: Dictionary<string>
    ): void {
        const oneUptimeResponse: OneUptimeResponse = res as OneUptimeResponse;

        if (headers) {
            for (const key in headers) {
                oneUptimeResponse.set(key, headers[key]?.toString() || '');
            }
        }

        oneUptimeResponse.status(statusCode).send(body);
    }

    public static async sendFileResponse(
        _req: ExpressRequest | ExpressRequest,
        res: ExpressResponse,
        file: FileModel
    ): Promise<void> {
        /** Create read stream */

        const oneUptimeResponse: OneUptimeResponse = res as OneUptimeResponse;

        /** Set the proper content type */
        oneUptimeResponse.set('Content-Type', file.type);
        oneUptimeResponse.status(200);
        /** Return response */
        // readstream.pipe(res);

        oneUptimeResponse.send(file.file);
    }

    public static render(
        _req: ExpressRequest,
        res: ExpressResponse,
        path: string,
        vars: JSONObject
    ): void {
        const oneUptimeResponse: OneUptimeResponse = res as OneUptimeResponse;

        oneUptimeResponse.render(path, vars);
    }

    public static sendErrorResponse(
        _req: ExpressRequest,
        res: ExpressResponse,
        error: Exception
    ): void {
        const oneUptimeResponse: OneUptimeResponse = res as OneUptimeResponse;

        oneUptimeResponse.logBody = { message: error.message }; // To be used in 'auditLog' middleware to log response data;
        const status: number = error.code || 500;
        const message: string = error.message || 'Server Error';

        logger.error(error);

        oneUptimeResponse.status(status).send({ message });
    }

    public static sendEntityArrayResponse(
        req: ExpressRequest,
        res: ExpressResponse,
        list: Array<BaseModel | AnalyticsDataModel>,
        count: PositiveNumber | number,
        modelType: { new (): BaseModel | AnalyticsDataModel }
    ): void {
        if (!(count instanceof PositiveNumber)) {
            count = new PositiveNumber(count);
        }

        let jsonArray: JSONArray = [];

        const model: BaseModel | AnalyticsDataModel = new modelType();

        if (model instanceof BaseModel) {
            jsonArray = BaseModel.toJSONArray(
                list as Array<BaseModel>,
                modelType as BaseModelType
            );
        }

        if (model instanceof AnalyticsDataModel) {
            jsonArray = AnalyticsDataModel.toJSONArray(
                list as Array<AnalyticsDataModel>,
                modelType as AnalyticsBaseModelType
            );
        }

        return this.sendJsonArrayResponse(req, res, jsonArray, count);
    }

    public static sendEntityResponse(
        req: ExpressRequest,
        res: ExpressResponse,
        item: BaseModel | AnalyticsDataModel | null,
        modelType: { new (): BaseModel | AnalyticsDataModel },
        options?:
            | {
                  miscData?: JSONObject;
              }
            | undefined
    ): void {
        let response: JSONObject = {};

        if (item && item instanceof BaseModel) {
            response = BaseModel.toJSON(item, modelType as BaseModelType);
        }

        if (item && item instanceof AnalyticsDataModel) {
            response = AnalyticsDataModel.toJSON(
                item,
                modelType as AnalyticsBaseModelType
            );
        }

        if (options?.miscData) {
            response['_miscData'] = options.miscData;
        }

        return this.sendJsonObjectResponse(req, res, response);
    }

    public static redirect(
        _req: ExpressRequest,
        res: ExpressResponse,
        url: URL
    ): void {
        return res.redirect(url.toString());
    }

    public static sendJsonArrayResponse(
        req: ExpressRequest,
        res: ExpressResponse,
        list: Array<JSONObject>,
        count: PositiveNumber
    ): void {
        const oneUptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
        const oneUptimeResponse: OneUptimeResponse = res as OneUptimeResponse;

        const listData: ListData = new ListData({
            data: [],
            count: new PositiveNumber(0),
            skip: new PositiveNumber(0),
            limit: new PositiveNumber(0),
        });

        if (!list) {
            list = [];
        }

        listData.data = list as JSONArray;

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
        } else {
            listData.limit = new PositiveNumber(DEFAULT_LIMIT);
        }

        if (oneUptimeRequest.query['output-type'] === 'csv') {
            const csv: string = JsonToCsv.ToCsv(listData.data);
            oneUptimeResponse.status(200).send(csv);
        } else {
            oneUptimeResponse.status(200).send(listData);
            oneUptimeResponse.logBody = listData.toJSON(); // To be used in 'auditLog' middleware to log response data;
        }
    }

    public static sendJsonObjectResponse(
        req: ExpressRequest,
        res: ExpressResponse,
        item: JSONObject,
        options?: {
            statusCode?: StatusCode;
        }
    ): void {
        const oneUptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
        const oneUptimeResponse: OneUptimeResponse = res as OneUptimeResponse;

        if (oneUptimeRequest.query['output-type'] === 'csv') {
            const csv: string = JsonToCsv.ToCsv([item as JSONObject]);
            oneUptimeResponse.status(200).send(csv);

            return;
        }

        oneUptimeResponse.logBody = item as JSONObject;
        oneUptimeResponse
            .status(options?.statusCode ? options?.statusCode.toNumber() : 200)
            .send(item);
    }

    public static sendTextResponse(
        _req: ExpressRequest,
        res: ExpressResponse,
        text: string
    ): void {
        const oneUptimeResponse: OneUptimeResponse = res as OneUptimeResponse;

        oneUptimeResponse.logBody = { text: text as string };
        oneUptimeResponse.status(200).send(text);
    }

    public static sendHtmlResponse(
        _req: ExpressRequest,
        res: ExpressResponse,
        html: string
    ): void {
        const oneUptimeResponse: OneUptimeResponse = res as OneUptimeResponse;

        oneUptimeResponse.logBody = { html: html as string };
        oneUptimeResponse.writeHead(200, { 'Content-Type': 'text/html' });
        oneUptimeResponse.end(html);
    }

    public static sendXmlResponse(
        _req: ExpressRequest,
        res: ExpressResponse,
        xml: string
    ): void {
        const oneUptimeResponse: OneUptimeResponse = res as OneUptimeResponse;

        oneUptimeResponse.logBody = { xml: xml as string };
        oneUptimeResponse.writeHead(200, { 'Content-Type': 'text/xml' });
        oneUptimeResponse.end(xml);
    }

    public static sendJavaScriptResponse(
        _req: ExpressRequest,
        res: ExpressResponse,
        javascript: string
    ): void {
        const oneUptimeResponse: OneUptimeResponse = res as OneUptimeResponse;

        oneUptimeResponse.logBody = { javascript: javascript as string };
        oneUptimeResponse.writeHead(200, { 'Content-Type': 'text/javascript' });
        oneUptimeResponse.end(javascript);
    }
}
