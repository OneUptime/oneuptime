import AnalyticsBaseModel from "../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { JSONArray, JSONObject, JSONObjectOrArray } from "../JSON";
import JSONFunctions from "../JSONFunctions";
import Typeof from "../Typeof";
import Headers from "./Headers";

/*
 * Whether a body is a list envelope: the server's answer to a list read
 * (ListData), its rows in a `data` array with count, skip and limit beside
 * them. An endpoint's own answer may say count, skip and limit too, about
 * rows it keeps under another name - Telemetry Usage's page of projects
 * keeps them under `projects` (issue #7794). That is no envelope: reading
 * it as one looked for rows that were never there, threw "array is not
 * iterable", and the page never loaded. It is read whole, as any object.
 */
export const isListEnvelope: (body: unknown) => boolean = (
  body: unknown,
): boolean => {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return false;
  }

  const keys: Array<string> = Object.keys(body);

  return (
    Array.isArray((body as JSONObject)["data"]) &&
    keys.includes("count") &&
    keys.includes("skip") &&
    keys.includes("limit")
  );
};

export default class HTTPResponse<
  T extends
    | JSONObjectOrArray
    | BaseModel
    | Array<BaseModel>
    | AnalyticsBaseModel
    | Array<AnalyticsBaseModel>,
> {
  private _statusCode: number = -1;
  public get statusCode(): number {
    return this._statusCode;
  }
  public set statusCode(v: number) {
    this._statusCode = v;
  }

  private _jsonData!: JSONObjectOrArray;
  public get jsonData(): JSONObjectOrArray {
    return this._jsonData;
  }
  public set jsonData(v: JSONObjectOrArray) {
    this._jsonData = v;
  }

  private _data!: T;
  public get data(): T {
    return this._data;
  }
  public set data(v: T) {
    this._data = v;
  }

  private _headers: Headers = {};
  public get headers(): Headers {
    return this._headers;
  }
  public set headers(v: Headers) {
    this._headers = v;
  }

  private _count: number = 0;
  public get count(): number {
    return this._count;
  }
  public set count(v: number) {
    this._count = v;
  }

  private _limit: number = 0;
  public get limit(): number {
    return this._limit;
  }
  public set limit(v: number) {
    this._limit = v;
  }

  private _skip: number = 0;
  public get skip(): number {
    return this._skip;
  }
  public set skip(v: number) {
    this._skip = v;
  }

  /*
   * Optional. Set by analytics list endpoints that skip the expensive
   * COUNT(*) and instead over-fetch by one row. When defined, `count`
   * is only a lower bound — UI should drive next/prev from `hasMore`.
   */
  private _hasMore: boolean | undefined = undefined;
  public get hasMore(): boolean | undefined {
    return this._hasMore;
  }
  public set hasMore(v: boolean | undefined) {
    this._hasMore = v;
  }

  /*
   * Optional. True when a list read asked for its count up to a cap
   * (countUpTo) and more records match: `count` is the cap, a lower bound,
   * and records follow this page. Undefined when the count is exact.
   */
  private _isCountCapped: boolean | undefined = undefined;
  public get isCountCapped(): boolean | undefined {
    return this._isCountCapped;
  }
  public set isCountCapped(v: boolean | undefined) {
    this._isCountCapped = v;
  }

  /*
   * Whether the body came as text rather than JSON: a page a proxy or a
   * captive portal answered with, or a body that was not JSON at all. It is
   * kept under `data` ({ data: "<html>..." }), so a read that wants a
   * record or rows asks this rather than taking that object for one
   * (AnswerReader, #8413).
   */
  private _isText: boolean = false;
  public get isText(): boolean {
    return this._isText;
  }

  public constructor(
    statusCode: number,
    data: JSONObject | Array<JSONObject>,
    headers: Headers,
  ) {
    this.statusCode = statusCode;

    if (isListEnvelope(data)) {
      const envelope: JSONObject = data as JSONObject;

      this.count = envelope["count"] as number;
      this.skip = envelope["skip"] as number;
      this.limit = envelope["limit"] as number;
      if (Object.keys(envelope).includes("hasMore")) {
        this.hasMore = envelope["hasMore"] as boolean;
      }
      if (envelope["isCountCapped"] === true) {
        this.isCountCapped = true;
      }
      this.jsonData = JSONFunctions.deserializeArray(
        envelope["data"] as JSONArray,
      );
    } else if (Array.isArray(data)) {
      this.jsonData = JSONFunctions.deserializeArray(data as JSONArray);
    } else if (Typeof.String === typeof data) {
      this._isText = true;
      this.jsonData = {
        data,
      };
    } else {
      this.jsonData = JSONFunctions.deserialize(data as JSONObject);
    }
    this.headers = headers;
    this.data = this.jsonData as T;
  }

  public isSuccess(): boolean {
    return this.statusCode === 200;
  }

  public isFailure(): boolean {
    return this.statusCode !== 200;
  }

  public isNotAuthorized(): boolean {
    return this.statusCode === 401;
  }

  public isTooManyRequests(): boolean {
    return this.statusCode === 429;
  }

  public isPaymentDeclined(): boolean {
    return this.statusCode === 402;
  }

  public isServerError(): boolean {
    return this.statusCode === 500;
  }
}
