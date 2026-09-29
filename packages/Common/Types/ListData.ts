import { JSONArray, JSONObject } from "./JSON";
import PositiveNumber from "./PositiveNumber";

export default class ListData {
  public constructor(obj: {
    data: JSONArray;
    count: PositiveNumber;
    skip: PositiveNumber;
    limit: PositiveNumber;
    hasMore?: boolean | undefined;
  }) {
    this.data = obj.data;
    this.count = obj.count;
    this.skip = obj.skip;
    this.limit = obj.limit;
    this.hasMore = obj.hasMore;
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

    return json;
  }
}
