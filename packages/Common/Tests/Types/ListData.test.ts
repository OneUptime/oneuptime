import { JSONArray, JSONObject } from "../../Types/JSON";
import ListData from "../../Types/ListData";
import PositiveNumber from "../../Types/PositiveNumber";

describe("ListData", () => {
  test("should create a ListData instance", () => {
    const data: JSONArray = [{ foo: 1 }, { foo: 2 }];
    const skip: PositiveNumber = new PositiveNumber(0);
    const count: PositiveNumber = new PositiveNumber(0);
    const limit: PositiveNumber = new PositiveNumber(0);

    const listData: ListData = new ListData({
      data,
      count,
      skip,
      limit,
    });
    expect(listData).toBeInstanceOf(ListData);

    expect(listData.count.toNumber()).toBe(count.toNumber());
    expect(listData.skip.toNumber()).toBe(skip.toNumber());
    expect(listData.limit.toNumber()).toBe(limit.toNumber());
  });

  test("toJSON converts ListData to JSONObject", () => {
    const listData: ListData = new ListData({
      data: [{ foo: "bar" }],
      count: new PositiveNumber(0),
      skip: new PositiveNumber(0),
      limit: new PositiveNumber(0),
    });

    const jsonObject: JSONObject = listData.toJSON();

    expect(jsonObject["data"]).toEqual([{ foo: "bar" }]);
    expect(jsonObject["count"]).toEqual(0);
    expect(jsonObject["skip"]).toEqual(0);
    expect(jsonObject["limit"]).toEqual(0);
  });

  /*
   * A list read that asked for its count up to a cap (countUpTo) and found
   * more says so: the count is the cap, and isCountCapped is set. A count
   * that is exact carries no flag, as before.
   */
  test("toJSON carries isCountCapped only when the count stopped at its cap", () => {
    const capped: JSONObject = new ListData({
      data: [],
      count: new PositiveNumber(10000),
      skip: new PositiveNumber(0),
      limit: new PositiveNumber(10),
      isCountCapped: true,
    }).toJSON();

    expect(capped["count"]).toBe(10000);
    expect(capped["isCountCapped"]).toBe(true);

    for (const isCountCapped of [false, undefined]) {
      const exact: JSONObject = new ListData({
        data: [],
        count: new PositiveNumber(240),
        skip: new PositiveNumber(0),
        limit: new PositiveNumber(10),
        isCountCapped: isCountCapped,
      }).toJSON();

      expect(Object.keys(exact)).not.toContain("isCountCapped");
      expect(exact["count"]).toBe(240);
    }
  });

  test("a capped count and has-more are told apart", () => {
    const json: JSONObject = new ListData({
      data: [],
      count: new PositiveNumber(10000),
      skip: new PositiveNumber(0),
      limit: new PositiveNumber(10),
      hasMore: true,
      isCountCapped: true,
    }).toJSON();

    expect(json["hasMore"]).toBe(true);
    expect(json["isCountCapped"]).toBe(true);
  });
});
