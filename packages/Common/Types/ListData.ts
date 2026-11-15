import { JSONArray, JSONObject } from "./JSON";
import PositiveNumber from "./PositiveNumber";

export default class ListData {
  public constructor(obj: {
    data: JSONArray;
    count: PositiveNumber;
    skip: PositiveNumber;
    limit: PositiveNumber;
    hasMore?: boolean | undefined;
    isCountCapped?: boolean | undefined;
  }) {
    this.data = obj.data;
    this.count = obj.count;
    this.skip = obj.skip;
    this.limit = obj.limit;
    this.hasMore = obj.hasMore;
    this.isCountCapped = obj.isCountCapped;
  }

  public data: JSONArray;
  public count: PositiveNumber;
  public skip: PositiveNumber;
  public limit: PositiveNumber;
  /*
   * When set, the response was produced without a full COUNT(*) — the
   * server fetched LIMIT+1 rows and only knows whether at least one
   * more page exists. `count` is still emitted as a lower-bound so
   * older clients keep rendering, but UI that wants accurate "X of Y"
   * should switch to `hasMore`-based pagination.
   */
  public hasMore?: boolean | undefined;

  /*
   * When true, more records match than the list counted: the request asked
   * for a count up to a cap (countUpTo) and `count` is that cap - a reader
   * sees "10,000+". It also means records follow this page. Absent when the
   * count is exact.
   */
  public isCountCapped?: boolean | undefined;

  public toJSON(): JSONObject {
    const json: JSONObject = {
      data: this.data,
      count: this.count.toNumber(),
      skip: this.skip.toNumber(),
      limit: this.limit.toNumber(),
    };

    if (this.hasMore !== undefined) {
      json["hasMore"] = this.hasMore;
    }

    if (this.isCountCapped) {
      json["isCountCapped"] = true;
    }

    return json;
  }
}
