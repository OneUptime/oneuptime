import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONArray, JSONObject } from "../../../Types/JSON";
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
});
