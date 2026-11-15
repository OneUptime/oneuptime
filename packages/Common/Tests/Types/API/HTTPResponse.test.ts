import HTTPResponse, { isListEnvelope } from "../../../Types/API/HTTPResponse";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ProductType from "../../../Types/MeteredPlan/ProductType";
import ObjectID from "../../../Types/ObjectID";
import { TelemetryProjectUsagePage } from "../../../Types/Telemetry/TelemetryUsage";
import { describe, expect, it } from "@jest/globals";

/*
 * HTTPResponse's constructor picks one of four shapes for the incoming body
 * (paginated list, plain array, string, plain object) and its status-code
 * predicates classify the response. Response.test.ts covers only the happy
 * object/array path, so the list-detection branch, the hasMore flag, the
 * string branch, and every predicate were previously untested.
 */
describe("HTTPResponse", () => {
  describe("constructor - plain object body", () => {
    it("stores a single object as jsonData and data", () => {
      const response: HTTPResponse<JSONObject> = new HTTPResponse(
        200,
        { name: "oneuptime" },
        {},
      );

      expect(response.statusCode).toBe(200);
      expect(response.jsonData).toEqual({ name: "oneuptime" });
      expect(response.data).toEqual({ name: "oneuptime" });
      // A plain object body is not a list, so pagination stays at defaults.
      expect(response.count).toBe(0);
      expect(response.skip).toBe(0);
      expect(response.limit).toBe(0);
      expect(response.hasMore).toBeUndefined();
    });

    it("keeps the provided headers", () => {
      const response: HTTPResponse<JSONObject> = new HTTPResponse(
        200,
        { ok: true },
        { "content-type": "application/json" },
      );

      expect(response.headers).toEqual({ "content-type": "application/json" });
    });
  });

  describe("constructor - array body", () => {
    it("stores an array as jsonData without touching pagination", () => {
      const response: HTTPResponse<Array<JSONObject>> = new HTTPResponse(
        200,
        [{ id: 1 }, { id: 2 }],
        {},
      );

      expect(response.jsonData).toEqual([{ id: 1 }, { id: 2 }]);
      expect(response.data).toEqual([{ id: 1 }, { id: 2 }]);
      expect(response.count).toBe(0);
    });
  });

  describe("constructor - paginated list body", () => {
    it("extracts count, skip, limit and the nested data array", () => {
      const listData: JSONObject = {
        count: 42,
        skip: 10,
        limit: 20,
        data: [{ id: "a" }, { id: "b" }] as JSONArray,
      };

      const response: HTTPResponse<Array<JSONObject>> = new HTTPResponse(
        200,
        listData,
        {},
      );

      expect(response.count).toBe(42);
      expect(response.skip).toBe(10);
      expect(response.limit).toBe(20);
      expect(response.jsonData).toEqual([{ id: "a" }, { id: "b" }]);
      // hasMore is absent from the body, so it must remain undefined.
      expect(response.hasMore).toBeUndefined();
    });

    it("reads hasMore when the list body carries it", () => {
      const listData: JSONObject = {
        count: 5,
        skip: 0,
        limit: 5,
        hasMore: true,
        data: [] as JSONArray,
      };

      const response: HTTPResponse<Array<JSONObject>> = new HTTPResponse(
        200,
        listData,
        {},
      );

      expect(response.hasMore).toBe(true);
      expect(response.jsonData).toEqual([]);
    });

    it("preserves hasMore === false as a real value, not a default", () => {
      const listData: JSONObject = {
        count: 3,
        skip: 0,
        limit: 10,
        hasMore: false,
        data: [{ id: 1 }] as JSONArray,
      };

      const response: HTTPResponse<Array<JSONObject>> = new HTTPResponse(
        200,
        listData,
        {},
      );

      expect(response.hasMore).toBe(false);
    });

    it("does not treat an object missing one pagination key as a list", () => {
      // count + skip but no limit => plain object branch, no pagination parse.
      const response: HTTPResponse<JSONObject> = new HTTPResponse(
        200,
        { count: 9, skip: 0, data: [{ id: 1 }] as JSONArray },
        {},
      );

      expect(response.count).toBe(0);
      expect(response.skip).toBe(0);
      expect(response.limit).toBe(0);
      // The whole object is kept as jsonData since it was not a list.
      expect(response.jsonData).toEqual({
        count: 9,
        skip: 0,
        data: [{ id: 1 }],
      });
    });
  });

  describe("status code predicates", () => {
    const makeResponse: (statusCode: number) => HTTPResponse<JSONObject> = (
      statusCode: number,
    ): HTTPResponse<JSONObject> => {
      return new HTTPResponse<JSONObject>(statusCode, { ok: true }, {});
    };

    it("isSuccess is true only for 200", () => {
      expect(makeResponse(200).isSuccess()).toBe(true);
      expect(makeResponse(201).isSuccess()).toBe(false);
      expect(makeResponse(404).isSuccess()).toBe(false);
    });

    it("isFailure is the inverse of a 200 response", () => {
      expect(makeResponse(200).isFailure()).toBe(false);
      expect(makeResponse(500).isFailure()).toBe(true);
      expect(makeResponse(201).isFailure()).toBe(true);
    });

    it("isNotAuthorized is true only for 401", () => {
      expect(makeResponse(401).isNotAuthorized()).toBe(true);
      expect(makeResponse(403).isNotAuthorized()).toBe(false);
    });

    it("isTooManyRequests is true only for 429", () => {
      expect(makeResponse(429).isTooManyRequests()).toBe(true);
      expect(makeResponse(400).isTooManyRequests()).toBe(false);
    });

    it("isPaymentDeclined is true only for 402", () => {
      expect(makeResponse(402).isPaymentDeclined()).toBe(true);
      expect(makeResponse(200).isPaymentDeclined()).toBe(false);
    });

    it("isServerError is true only for 500", () => {
      expect(makeResponse(500).isServerError()).toBe(true);
      expect(makeResponse(502).isServerError()).toBe(false);
    });
  });

  /*
   * A list read that asked for its count up to a cap (countUpTo) reads
   * isCountCapped off the answer: set when more records match than the
   * count says, undefined when the count is exact.
   */
  describe("a list's capped count", () => {
    it("reads isCountCapped when the answer carries it", () => {
      const response: HTTPResponse<JSONObject> = new HTTPResponse<JSONObject>(
        200,
        { data: [], count: 10000, skip: 0, limit: 10, isCountCapped: true },
        {},
      );

      expect(response.count).toBe(10000);
      expect(response.isCountCapped).toBe(true);
      expect(response.hasMore).toBeUndefined();
    });

    it("leaves it undefined for an exact count, or anything but true", () => {
      for (const extra of [
        {},
        { isCountCapped: false },
        { isCountCapped: "true" },
      ]) {
        const response: HTTPResponse<JSONObject> = new HTTPResponse<JSONObject>(
          200,
          { data: [], count: 240, skip: 0, limit: 10, ...extra } as JSONObject,
          {},
        );

        expect(response.isCountCapped).toBeUndefined();
        expect(response.count).toBe(240);
      }
    });

    it("is not read off an answer that is not a list", () => {
      const response: HTTPResponse<JSONObject> = new HTTPResponse<JSONObject>(
        200,
        { isCountCapped: true },
        {},
      );

      expect(response.isCountCapped).toBeUndefined();
    });
  });

  /*
   * A list envelope is the server's answer to a list read (ListData): the
   * rows in a `data` array, with count, skip and limit beside them. Any
   * other object is an endpoint's own answer and reaches the page as the
   * server sent it - also one that says count, skip and limit about rows
   * it keeps under another name. Admin Dashboard > Telemetry Usage's page
   * of projects is one (issue #7794): it was taken for an envelope with no
   * rows, every load failed with "array is not iterable", and the table of
   * projects never showed.
   */
  describe("an answer that only looks like a list envelope", () => {
    const usagePage: TelemetryProjectUsagePage = {
      startDay: "2026-10-17",
      endDay: "2026-11-15",
      isCostIncluded: true,
      total: { dataIngestedInGB: 12.5, totalCostInUSD: 1.25 },
      byProduct: {
        [ProductType.Logs]: { dataIngestedInGB: 10, totalCostInUSD: 1 },
        [ProductType.Traces]: { dataIngestedInGB: 2.5, totalCostInUSD: 0.25 },
      },
      projects: [
        {
          projectId: "11111111-1111-4111-8111-111111111111",
          projectName: "Checkout",
          byProduct: {
            [ProductType.Logs]: { dataIngestedInGB: 10, totalCostInUSD: 1 },
          },
          total: { dataIngestedInGB: 10, totalCostInUSD: 1 },
        },
        {
          projectId: "22222222-2222-4222-8222-222222222222",
          projectName: "Payments",
          byProduct: {
            [ProductType.Traces]: {
              dataIngestedInGB: 2.5,
              totalCostInUSD: 0.25,
            },
          },
          total: { dataIngestedInGB: 2.5, totalCostInUSD: 0.25 },
        },
      ],
      count: 2,
      skip: 0,
      limit: 25,
    };

    it("keeps Telemetry Usage's page of projects whole, its rows under projects", () => {
      const body: JSONObject = JSON.parse(JSON.stringify(usagePage));

      const response: HTTPResponse<JSONObject> = new HTTPResponse<JSONObject>(
        200,
        body,
        {},
      );

      expect(response.data).toEqual(usagePage);
      expect(response.jsonData).toEqual(usagePage);
      expect(
        (response.data as unknown as TelemetryProjectUsagePage).projects,
      ).toHaveLength(2);
    });

    it("keeps a page with no projects whole too", () => {
      const emptyPage: TelemetryProjectUsagePage = {
        ...usagePage,
        isCostIncluded: false,
        total: { dataIngestedInGB: 0 },
        byProduct: {},
        projects: [],
        count: 0,
      };

      const response: HTTPResponse<JSONObject> = new HTTPResponse<JSONObject>(
        200,
        JSON.parse(JSON.stringify(emptyPage)),
        {},
      );

      expect(response.data).toEqual(emptyPage);
    });

    it("keeps an object that says count, skip and limit and holds no rows at all", () => {
      const response: HTTPResponse<JSONObject> = new HTTPResponse<JSONObject>(
        200,
        { count: 3, skip: 0, limit: 10 },
        {},
      );

      expect(response.data).toEqual({ count: 3, skip: 0, limit: 10 });
    });

    it("keeps an object whose data is not a list: an object, text, a number, true or null", () => {
      for (const data of [
        { rows: [{ id: "a" }] },
        "a,b",
        7,
        true,
        null,
      ] as Array<JSONObject[string]>) {
        const body: JSONObject = { data: data, count: 1, skip: 0, limit: 10 };

        const response: HTTPResponse<JSONObject> = new HTTPResponse<JSONObject>(
          200,
          body,
          {},
        );

        expect(response.data).toEqual(body);
      }
    });

    it("reads no list paging off such an answer", () => {
      const response: HTTPResponse<JSONObject> = new HTTPResponse<JSONObject>(
        200,
        {
          ...(JSON.parse(JSON.stringify(usagePage)) as JSONObject),
          hasMore: true,
          isCountCapped: true,
        },
        {},
      );

      // The page says its own count, skip and limit; the envelope's stay unset.
      expect(response.count).toBe(0);
      expect(response.skip).toBe(0);
      expect(response.limit).toBe(0);
      expect(response.hasMore).toBeUndefined();
      expect(response.isCountCapped).toBeUndefined();
      expect(response.data["count"]).toBe(2);
      expect(response.data["limit"]).toBe(25);
    });

    it("reads the values such an answer carries as any other object's", () => {
      const projectId: ObjectID = new ObjectID(
        "33333333-3333-4333-8333-333333333333",
      );

      const response: HTTPResponse<JSONObject> = new HTTPResponse<JSONObject>(
        200,
        {
          items: [{ projectId: projectId.toJSON() }],
          owner: projectId.toJSON(),
          count: 1,
          skip: 0,
          limit: 10,
        },
        {},
      );

      expect(response.data["owner"]).toBeInstanceOf(ObjectID);
      expect((response.data["owner"] as ObjectID).toString()).toBe(
        projectId.toString(),
      );
      expect(
        (response.data["items"] as Array<JSONObject>)[0]!["projectId"],
      ).toBeInstanceOf(ObjectID);
    });
  });

  describe("isListEnvelope", () => {
    it("is a list read's answer: rows in a data array, with count, skip and limit", () => {
      expect(
        isListEnvelope({ data: [{ id: "a" }], count: 1, skip: 0, limit: 10 }),
      ).toBe(true);
      expect(isListEnvelope({ data: [], count: 0, skip: 0, limit: 10 })).toBe(
        true,
      );
      expect(
        isListEnvelope({
          data: [],
          count: 10000,
          skip: 0,
          limit: 10,
          hasMore: true,
          isCountCapped: true,
        }),
      ).toBe(true);
    });

    it("is not an answer whose rows are under another name, or are missing", () => {
      expect(
        isListEnvelope({ projects: [], count: 0, skip: 0, limit: 25 }),
      ).toBe(false);
      expect(isListEnvelope({ count: 0, skip: 0, limit: 25 })).toBe(false);
      expect(
        isListEnvelope({ data: { rows: [] }, count: 0, skip: 0, limit: 25 }),
      ).toBe(false);
      expect(isListEnvelope({ data: null, count: 0, skip: 0, limit: 25 })).toBe(
        false,
      );
    });

    it("is not rows that lack any of count, skip and limit", () => {
      expect(isListEnvelope({ data: [], skip: 0, limit: 10 })).toBe(false);
      expect(isListEnvelope({ data: [], count: 0, limit: 10 })).toBe(false);
      expect(isListEnvelope({ data: [], count: 0, skip: 0 })).toBe(false);
    });

    it("is not a list, text, a number or nothing", () => {
      expect(isListEnvelope([{ data: [], count: 0, skip: 0, limit: 0 }])).toBe(
        false,
      );
      expect(isListEnvelope("data")).toBe(false);
      expect(isListEnvelope(3)).toBe(false);
      expect(isListEnvelope(null)).toBe(false);
      expect(isListEnvelope(undefined)).toBe(false);
    });
  });

  describe("a list envelope", () => {
    it("with no rows is an empty list, its paging read", () => {
      const response: HTTPResponse<Array<JSONObject>> = new HTTPResponse(
        200,
        { data: [], count: 0, skip: 50, limit: 25 },
        {},
      );

      expect(response.data).toEqual([]);
      expect(response.count).toBe(0);
      expect(response.skip).toBe(50);
      expect(response.limit).toBe(25);
    });

    it("reads each row's values, as the server's list reads send them", () => {
      const projectId: ObjectID = new ObjectID(
        "44444444-4444-4444-8444-444444444444",
      );

      const response: HTTPResponse<Array<JSONObject>> = new HTTPResponse(
        200,
        {
          data: [{ _id: projectId.toJSON(), name: "Checkout" }],
          count: 1,
          skip: 0,
          limit: 10,
        },
        {},
      );

      expect(response.data).toHaveLength(1);
      expect(response.data[0]!["_id"]).toBeInstanceOf(ObjectID);
      expect(response.data[0]!["name"]).toBe("Checkout");
      expect(response.count).toBe(1);
    });
  });
});
