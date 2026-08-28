import {
  ExpressRequest,
  ExpressResponse,
  OneUptimeRequest,
  OneUptimeResponse,
} from "./Express";
import JsonToCsv from "./JsonToCsv";
import logger, { getLogAttributesFromRequest } from "./Logger";
import AnalyticsDataModel, {
  AnalyticsBaseModelType,
} from "../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import FileModel from "../../Models/DatabaseModels/DatabaseBaseModel/FileModel";
import EmptyResponse from "../../Types/API/EmptyResponse";
import StatusCode from "../../Types/API/StatusCode";
import URL from "../../Types/API/URL";
import { DEFAULT_LIMIT } from "../../Types/Database/LimitMax";
import Dictionary from "../../Types/Dictionary";
import Exception from "../../Types/Exception/Exception";
import { JSONArray, JSONObject } from "../../Types/JSON";
import ListData from "../../Types/ListData";
import MimeType from "../../Types/File/MimeType";
import PositiveNumber from "../../Types/PositiveNumber";
import Route from "../../Types/API/Route";
import CaptureSpan from "./Telemetry/CaptureSpan";
import { GoogleTagManagerEnabled } from "../EnvironmentConfig";

/*
 * Raster image types, which is to say the types that cannot carry script and
 * are therefore safe both to echo back verbatim and to render in our own
 * origin. An SVG is not here on purpose: it is a document, not a picture, and
 * a PDF is not here either because it gets its own scripting engine.
 *
 * The list is deliberately wider than the MimeType enum. Until November 2025
 * (62d74c1d84) the file picker stored the browser's own MIME string verbatim,
 * so installs upgrading through this change hold rows with values that never
 * appeared in the enum - "image/vnd.microsoft.icon" from a favicon upload,
 * "image/jpg" from assorted tools. Collapsing those to octet-stream would stop
 * every one of those avatars and logos from rendering, because nosniff means
 * an <img> cannot recover from a type it was given wrongly.
 */
const SAFE_IMAGE_MIME_TYPES: Set<string> = new Set<string>([
  MimeType.png,
  // MimeType.jpg is the same string as MimeType.jpeg, so it is covered.
  MimeType.jpeg,
  MimeType.gif,
  MimeType.webp,
  MimeType.ico,
  MimeType.bmp,
  MimeType.tiff,
  MimeType.avif,
  MimeType.heic,
  "image/jpg",
  "image/pjpeg",
  "image/vnd.microsoft.icon",
  "image/x-ms-bmp",
]);

/*
 * `fileType` is a plain varchar filled in from the upload request body, so by
 * the time a file is served back it holds whatever string the uploader chose -
 * the MimeType enum is a compile-time type and is erased at runtime. Echoing
 * that string back as Content-Type is what turns "upload an image" into "run
 * script on the dashboard origin", because /api, /file and /dashboard are the
 * same origin. Only types we actually recognise get echoed back.
 *
 * Note this read-side list is wider than the one FileService enforces on
 * upload: new rows are held to the canonical enum, old rows only have to be
 * servable.
 */
const ALLOWED_MIME_TYPES: Set<string> = new Set<string>([
  ...Object.values(MimeType),
  ...SAFE_IMAGE_MIME_TYPES,
]);

// What an unrecognised fileType degrades to: opaque bytes, never a document.
const FALLBACK_MIME_TYPE: string = "application/octet-stream";

export default class Response {
  @CaptureSpan()
  public static sendEmptySuccessResponse(
    _req: ExpressRequest,
    res: ExpressResponse,
  ): void {
    const oneUptimeResponse: OneUptimeResponse = res as OneUptimeResponse;

    oneUptimeResponse.status(200).send({} as EmptyResponse);
  }

  @CaptureSpan()
  public static sendFileByPath(
    _req: ExpressRequest,
    res: ExpressResponse,
    path: string,
  ): void {
    Response.setNoCacheHeaders(res);
    res.sendFile(path);
  }

  @CaptureSpan()
  public static sendCustomResponse(
    _req: ExpressRequest,
    res: ExpressResponse,
    statusCode: number,
    body: JSONObject | string,
    headers: Dictionary<string>,
  ): void {
    const oneUptimeResponse: OneUptimeResponse = res as OneUptimeResponse;

    if (headers) {
      Response.setNoCacheHeaders(oneUptimeResponse);
      for (const key in headers) {
        oneUptimeResponse.set(key, headers[key]?.toString() || "");
      }
    }

    oneUptimeResponse.status(statusCode).send(body);
  }

  /*
   * Reduce a stored fileType to something safe to hand back as Content-Type.
   * Anything we do not recognise - a made-up string, "text/html", a row
   * written before uploads were validated - becomes opaque bytes.
   */
  public static getSafeFileType(fileType: string | undefined | null): string {
    const normalizedFileType: string = (fileType || "").trim().toLowerCase();

    if (ALLOWED_MIME_TYPES.has(normalizedFileType)) {
      return normalizedFileType;
    }

    return FALLBACK_MIME_TYPE;
  }

  /*
   * The filename goes into a response header, so it gets the same treatment as
   * the MIME string: no quotes, no CR/LF, nothing that could split the header.
   * This is the ASCII fallback only - see getContentDisposition, which pairs it
   * with an encoded copy so a non-Latin name is not reduced to underscores.
   */
  public static getSafeFileName(name: string | undefined | null): string {
    const safeFileName: string = (name || "")
      .replace(/[^a-zA-Z0-9._-]/g, "_")
      .slice(0, 100);

    return safeFileName || "download";
  }

  /*
   * RFC 6266: `filename` carries an ASCII-safe fallback for old clients and
   * `filename*` carries the real name percent-encoded, so "月次レポート.pdf"
   * downloads under its own name instead of as a row of underscores. Both are
   * escaped, so neither can close the quoted string or inject a header.
   */
  public static getContentDisposition(
    disposition: "inline" | "attachment",
    name: string | undefined | null,
  ): string {
    const fileName: string = (name || "").trim().slice(0, 100) || "download";

    /*
     * encodeURIComponent leaves !'()* alone and RFC 5987's attr-char does not
     * allow them - single quote especially, since it delimits the value.
     */
    const encodedFileName: string = encodeURIComponent(fileName).replace(
      /['()*!]/g,
      (character: string): string => {
        return `%${character.charCodeAt(0).toString(16).toUpperCase()}`;
      },
    );

    return `${disposition}; filename="${Response.getSafeFileName(fileName)}"; filename*=UTF-8''${encodedFileName}`;
  }

  @CaptureSpan()
  public static async sendFileResponse(
    _req: ExpressRequest | ExpressRequest,
    res: ExpressResponse,
    file: FileModel,
  ): Promise<void> {
    const oneUptimeResponse: OneUptimeResponse = res as OneUptimeResponse;

    const fileType: string = Response.getSafeFileType(file.fileType);

    oneUptimeResponse.set("Content-Type", fileType);

    /*
     * Belt and braces for the types we do echo back. nosniff stops the browser
     * from guessing its way to a different type; the CSP gives the response an
     * opaque origin with no scripting even if it is opened as a top-level
     * document, so a crafted file cannot reach dashboard cookies; and nothing
     * we serve here is ever meant to be framed.
     */
    oneUptimeResponse.set("X-Content-Type-Options", "nosniff");
    oneUptimeResponse.set(
      "Content-Security-Policy",
      "sandbox; script-src 'none'; object-src 'none'; frame-ancestors 'none'",
    );
    oneUptimeResponse.set("X-Frame-Options", "DENY");

    /*
     * Inline is reserved for raster images, which cannot execute anything.
     * Everything else - SVG, PDF, office docs, whatever an older row happens
     * to hold - downloads instead of rendering. This is deliberately not an
     * SVG ban: <img> and <link rel="icon"> ignore Content-Disposition, so
     * status page logos, favicons and avatars still render. The only
     * behaviour that changes is a top-level navigation to the file URL, and
     * that is exactly the navigation an XSS payload needs.
     */
    oneUptimeResponse.set(
      "Content-Disposition",
      Response.getContentDisposition(
        SAFE_IMAGE_MIME_TYPES.has(fileType) ? "inline" : "attachment",
        file.name,
      ),
    );

    oneUptimeResponse.status(200);

    oneUptimeResponse.send(file.file);
  }

  @CaptureSpan()
  public static render(
    _req: ExpressRequest,
    res: ExpressResponse,
    path: string,
    vars: JSONObject,
  ): void {
    const oneUptimeResponse: OneUptimeResponse = res as OneUptimeResponse;

    /*
     * Analytics is opt-in per render, and off unless this is the hosted
     * product. A self-hosted install has no reason to load Google Tag Manager
     * from googletagmanager.com, and an air-gapped one cannot - it would just
     * be another request left hanging. Same default the frontend index pages
     * already use; passing the flag explicitly still wins.
     */
    oneUptimeResponse.render(path, {
      enableGoogleTagManager: GoogleTagManagerEnabled,
      ...vars,
    });
  }

  @CaptureSpan()
  public static sendErrorResponse(
    _req: ExpressRequest,
    res: ExpressResponse,
    error: Exception,
  ): void {
    const oneUptimeResponse: OneUptimeResponse = res as OneUptimeResponse;

    oneUptimeResponse.logBody = { message: error.message }; // To be used in 'auditLog' middleware to log response data;
    /*
     * Exception.code is an ExceptionCode, and several of its members are not
     * HTTP statuses at all (APIException is 2, GeneralException 1,
     * BadOperationException 5, WebRequestException 6). `|| 500` only rescues
     * the zero-valued one; the rest reach res.status(), where Node throws
     * ERR_HTTP_INVALID_STATUS_CODE and Express answers with an HTML 500 that
     * carries none of this message. Fall back for every out-of-range code.
     */
    const status: number = StatusCode.isValidStatusCode(error.code)
      ? error.code
      : 500;
    const message: string = error.message || "Server Error";

    logger.error(error, getLogAttributesFromRequest(_req as any));

    oneUptimeResponse.status(status).send({ message });
  }

  @CaptureSpan()
  public static sendEntityArrayResponse(
    req: ExpressRequest,
    res: ExpressResponse,
    list: Array<BaseModel | AnalyticsDataModel>,
    count: PositiveNumber | number,
    modelType: { new (): BaseModel | AnalyticsDataModel },
    options?: { hasMore?: boolean | undefined } | undefined,
  ): void {
    if (!(count instanceof PositiveNumber)) {
      count = new PositiveNumber(count);
    }

    let jsonArray: JSONArray = [];

    const model: BaseModel | AnalyticsDataModel = new modelType();

    if (model instanceof BaseModel) {
      jsonArray = BaseModel.toJSONArray(
        list as Array<BaseModel>,
        modelType as DatabaseBaseModelType,
      );
    }

    if (model instanceof AnalyticsDataModel) {
      jsonArray = AnalyticsDataModel.toJSONArray(
        list as Array<AnalyticsDataModel>,
        modelType as AnalyticsBaseModelType,
      );
    }

    return this.sendJsonArrayResponse(req, res, jsonArray, count, options);
  }

  @CaptureSpan()
  public static sendEntityResponse(
    req: ExpressRequest,
    res: ExpressResponse,
    item: BaseModel | AnalyticsDataModel | null,
    modelType: { new (): BaseModel | AnalyticsDataModel },
    options?:
      | {
          miscData?: JSONObject;
        }
      | undefined,
  ): void {
    let response: JSONObject = {};

    if (item && item instanceof BaseModel) {
      response = BaseModel.toJSON(item, modelType as DatabaseBaseModelType);
    }

    if (item && item instanceof AnalyticsDataModel) {
      response = AnalyticsDataModel.toJSON(
        item,
        modelType as AnalyticsBaseModelType,
      );
    }

    if (options?.miscData) {
      response["_miscData"] = options.miscData;
    }

    return this.sendJsonObjectResponse(req, res, response);
  }

  @CaptureSpan()
  public static redirect(
    _req: ExpressRequest,
    res: ExpressResponse,
    to: URL | Route,
  ): void {
    return res.redirect(to.toString());
  }

  @CaptureSpan()
  public static sendJsonArrayResponse(
    req: ExpressRequest,
    res: ExpressResponse,
    list: Array<JSONObject>,
    count: PositiveNumber,
    options?: { hasMore?: boolean | undefined } | undefined,
  ): void {
    const oneUptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
    const oneUptimeResponse: OneUptimeResponse = res as OneUptimeResponse;

    const listData: ListData = new ListData({
      data: [],
      count: new PositiveNumber(0),
      skip: new PositiveNumber(0),
      limit: new PositiveNumber(0),
      hasMore: options?.hasMore,
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

    if (oneUptimeRequest.query["skip"]) {
      listData.skip = new PositiveNumber(
        parseInt(oneUptimeRequest.query["skip"].toString()),
      );
    }

    if (oneUptimeRequest.query["limit"]) {
      listData.limit = new PositiveNumber(
        parseInt(oneUptimeRequest.query["limit"].toString()),
      );
    } else {
      listData.limit = new PositiveNumber(DEFAULT_LIMIT);
    }

    if (oneUptimeRequest.query["output-type"] === "csv") {
      const csv: string = JsonToCsv.ToCsv(listData.data);
      oneUptimeResponse.status(200).send(csv);
    } else {
      oneUptimeResponse.status(200).send(listData);
      oneUptimeResponse.logBody = listData.toJSON(); // To be used in 'auditLog' middleware to log response data;
    }
  }

  @CaptureSpan()
  public static sendJsonObjectResponse(
    req: ExpressRequest,
    res: ExpressResponse,
    item: JSONObject,
    options?: {
      statusCode?: StatusCode;
    },
  ): void {
    const oneUptimeRequest: OneUptimeRequest = req as OneUptimeRequest;
    const oneUptimeResponse: OneUptimeResponse = res as OneUptimeResponse;

    if (oneUptimeRequest.query["output-type"] === "csv") {
      const csv: string = JsonToCsv.ToCsv([item as JSONObject]);
      oneUptimeResponse.status(200).send(csv);

      return;
    }

    oneUptimeResponse.logBody = item as JSONObject;
    oneUptimeResponse
      .status(options?.statusCode ? options?.statusCode.toNumber() : 200)
      .send(item);
  }

  @CaptureSpan()
  public static sendTextResponse(
    _req: ExpressRequest,
    res: ExpressResponse,
    text: string,
  ): void {
    const oneUptimeResponse: OneUptimeResponse = res as OneUptimeResponse;

    oneUptimeResponse.logBody = { text: text as string };
    oneUptimeResponse.status(200).send(text);
  }

  @CaptureSpan()
  public static sendHtmlResponse(
    _req: ExpressRequest,
    res: ExpressResponse,
    html: string,
  ): void {
    const oneUptimeResponse: OneUptimeResponse = res as OneUptimeResponse;

    oneUptimeResponse.logBody = { html: html as string };
    oneUptimeResponse.writeHead(200, { "Content-Type": "text/html" });
    oneUptimeResponse.end(html);
  }

  @CaptureSpan()
  public static sendMarkdownResponse(
    _req: ExpressRequest,
    res: ExpressResponse,
    html: string,
  ): void {
    return Response.sendHtmlResponse(_req, res, html);
  }

  @CaptureSpan()
  public static sendXmlResponse(
    _req: ExpressRequest,
    res: ExpressResponse,
    xml: string,
  ): void {
    const oneUptimeResponse: OneUptimeResponse = res as OneUptimeResponse;

    oneUptimeResponse.logBody = { xml: xml as string };
    oneUptimeResponse.writeHead(200, { "Content-Type": "text/xml" });
    oneUptimeResponse.end(xml);
  }

  @CaptureSpan()
  public static sendJavaScriptResponse(
    _req: ExpressRequest,
    res: ExpressResponse,
    javascript: string,
  ): void {
    const oneUptimeResponse: OneUptimeResponse = res as OneUptimeResponse;

    oneUptimeResponse.logBody = { javascript: javascript as string };
    oneUptimeResponse.writeHead(200, { "Content-Type": "text/javascript" });
    oneUptimeResponse.end(javascript);
  }

  public static setNoCacheHeaders(res: ExpressResponse): void {
    const oneUptimeResponse: OneUptimeResponse = res as OneUptimeResponse;

    oneUptimeResponse.setHeader(
      "Cache-Control",
      "no-store, no-cache, must-revalidate",
    );
    oneUptimeResponse.setHeader("Pragma", "no-cache");
    oneUptimeResponse.setHeader("Expires", "0");
  }
}
