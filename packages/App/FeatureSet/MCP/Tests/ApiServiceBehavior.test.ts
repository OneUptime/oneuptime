/**
 * OneUptimeApiService behavior tests.
 *
 * Covers the request-building and resilience behavior around executeOperation:
 * - missing/undefined args are normalized to {} (parameterless list calls work)
 * - non-UUID ids are rejected before any HTTP request is attempted
 * - select accepts an array of field names (converted to { field: true })
 * - select-permission errors drop the denied column and retry
 * - OneUptimeApiError carries statusCode and details
 *
 * The HTTP layer is mocked by spying on the private static makeApiRequest,
 * so no network traffic occurs.
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";

jest.mock("../Utils/MCPLogger");

import OneUptimeApiService, {
  OneUptimeApiError,
} from "../Services/OneUptimeApiService";
import OneUptimeOperation from "../Types/OneUptimeOperation";
import ModelType from "../Types/ModelType";
import { OneUptimeToolCallArgs } from "../Types/McpTypes";
import { JSONObject } from "Common/Types/JSON";
import Route from "Common/Types/API/Route";
import Headers from "Common/Types/API/Headers";

const VALID_UUID: string = "550e8400-e29b-41d4-a716-446655440000";
const API_KEY: string = "test-api-key";

type MakeApiRequestArgs = [
  OneUptimeOperation,
  Route,
  Headers,
  JSONObject | undefined,
];

describe("OneUptimeApiService behavior", () => {
  // Bare SpyInstance keeps the annotation compatible across @types/jest versions
  let makeApiRequestSpy: jest.SpyInstance;

  beforeAll(() => {
    OneUptimeApiService.initialize({ url: "https://test.oneuptime.com" });
  });

  beforeEach(() => {
    makeApiRequestSpy = jest
      .spyOn(
        OneUptimeApiService as unknown as {
          makeApiRequest: (...args: MakeApiRequestArgs) => Promise<unknown>;
        },
        "makeApiRequest",
      )
      .mockResolvedValue({ data: [], count: 0 }) as unknown as jest.SpyInstance;
  });

  afterEach(() => {
    makeApiRequestSpy.mockRestore();
  });

  describe("argument normalization", () => {
    it("treats undefined args as {} for list operations", async () => {
      await expect(
        OneUptimeApiService.executeOperation(
          "Incident",
          OneUptimeOperation.List,
          ModelType.Database,
          "/incident",
          undefined as unknown as OneUptimeToolCallArgs,
          API_KEY,
        ),
      ).resolves.toEqual({ data: [], count: 0 });

      expect(makeApiRequestSpy).toHaveBeenCalledTimes(1);
      const requestData: JSONObject | undefined =
        makeApiRequestSpy.mock.calls[0]?.[3];
      expect(requestData?.["query"]).toEqual({});
    });

    it("treats null args as {} for count operations", async () => {
      await expect(
        OneUptimeApiService.executeOperation(
          "Incident",
          OneUptimeOperation.Count,
          ModelType.Database,
          "/incident",
          null as unknown as OneUptimeToolCallArgs,
          API_KEY,
        ),
      ).resolves.toBeDefined();

      expect(makeApiRequestSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("id validation", () => {
    it("rejects a non-UUID id with a friendly error before any HTTP call", async () => {
      await expect(
        OneUptimeApiService.executeOperation(
          "Incident",
          OneUptimeOperation.Read,
          ModelType.Database,
          "/incident",
          { id: "abc" },
          API_KEY,
        ),
      ).rejects.toThrow(/UUID/);

      expect(makeApiRequestSpy).not.toHaveBeenCalled();
    });

    it("accepts a valid UUID id and routes to get-item", async () => {
      makeApiRequestSpy.mockResolvedValue({ _id: VALID_UUID });

      await OneUptimeApiService.executeOperation(
        "Incident",
        OneUptimeOperation.Read,
        ModelType.Database,
        "/incident",
        { id: VALID_UUID },
        API_KEY,
      );

      const route: Route | undefined = makeApiRequestSpy.mock.calls[0]?.[1];
      expect(route?.toString()).toContain(`/${VALID_UUID}/get-item`);
    });
  });

  describe("select handling", () => {
    it("converts an array select into a { field: true } object", async () => {
      await OneUptimeApiService.executeOperation(
        "Incident",
        OneUptimeOperation.List,
        ModelType.Database,
        "/incident",
        { select: ["_id", "title"] },
        API_KEY,
      );

      const requestData: JSONObject | undefined =
        makeApiRequestSpy.mock.calls[0]?.[3];
      expect(requestData?.["select"]).toEqual({ _id: true, title: true });
    });

    it("falls back to the generated select for an empty array", async () => {
      await OneUptimeApiService.executeOperation(
        "Incident",
        OneUptimeOperation.List,
        ModelType.Database,
        "/incident",
        { select: [] },
        API_KEY,
      );

      const requestData: JSONObject | undefined =
        makeApiRequestSpy.mock.calls[0]?.[3];
      const select: JSONObject = requestData?.["select"] as JSONObject;
      expect(Object.keys(select).length).toBeGreaterThan(0);
    });

    it("drops a column named in a select-permission error and retries", async () => {
      makeApiRequestSpy
        .mockRejectedValueOnce(
          new OneUptimeApiError(
            "API request failed: 403 - You do not have permissions to select on - internalNote.",
            403,
          ),
        )
        .mockResolvedValueOnce({ data: [], count: 0 });

      await expect(
        OneUptimeApiService.executeOperation(
          "Incident",
          OneUptimeOperation.List,
          ModelType.Database,
          "/incident",
          { select: ["_id", "internalNote"] },
          API_KEY,
        ),
      ).resolves.toEqual({ data: [], count: 0 });

      expect(makeApiRequestSpy).toHaveBeenCalledTimes(2);
      const retryData: JSONObject | undefined =
        makeApiRequestSpy.mock.calls[1]?.[3];
      const retrySelect: JSONObject = retryData?.["select"] as JSONObject;
      expect(retrySelect).toEqual({ _id: true });
      expect("internalNote" in retrySelect).toBe(false);
    });

    it("does not retry errors that are not select-permission failures", async () => {
      makeApiRequestSpy.mockRejectedValue(
        new OneUptimeApiError("API request failed: 500 - boom", 500),
      );

      await expect(
        OneUptimeApiService.executeOperation(
          "Incident",
          OneUptimeOperation.List,
          ModelType.Database,
          "/incident",
          { select: ["_id"] },
          API_KEY,
        ),
      ).rejects.toThrow(/boom/);

      expect(makeApiRequestSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe("API key validation", () => {
    it("rejects operations without an API key", async () => {
      await expect(
        OneUptimeApiService.executeOperation(
          "Incident",
          OneUptimeOperation.List,
          ModelType.Database,
          "/incident",
          {},
          "",
        ),
      ).rejects.toThrow(/API key is required/);

      expect(makeApiRequestSpy).not.toHaveBeenCalled();
    });
  });

  describe("OneUptimeApiError", () => {
    it("carries statusCode and details", () => {
      const error: OneUptimeApiError = new OneUptimeApiError(
        "API request failed: 403 - Forbidden",
        403,
        { field: "internalNote" },
      );

      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe("OneUptimeApiError");
      expect(error.statusCode).toBe(403);
      expect(error.details).toEqual({ field: "internalNote" });
    });
  });
});
