import { executeApiRequest, ApiRequestOptions } from "../Core/ApiClient";
import API from "Common/Utils/API";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";

// Mock the Common/Utils/API module
jest.mock("Common/Utils/API", () => {
  const mockPost = jest.fn();
  const mockPut = jest.fn();
  const mockDelete = jest.fn();

  function MockAPI(protocol, hostname, _route) {
    this.protocol = protocol;
    this.hostname = hostname;
  }

  MockAPI.post = mockPost;
  MockAPI.put = mockPut;
  MockAPI.delete = mockDelete;

  return {
    __esModule: true,
    default: MockAPI,
  };
});

function createSuccessResponse(data) {
  return { data, statusCode: 200 };
}

function createErrorResponse(statusCode, message) {
  // HTTPErrorResponse computes `message` from `.data` via a getter.
  // We create a proper prototype chain and set data to contain the message.
  const resp = Object.create(HTTPErrorResponse.prototype);
  resp.statusCode = statusCode;
  // HTTPResponse stores data in _jsonData and exposes it via `data` getter
  // But since the prototype chain may not have full getters, we define them
  Object.defineProperty(resp, "data", {
    get: () => ({ message: message }),
    configurable: true,
  });
  return resp;
}

describe("ApiClient", () => {
  let mockPost;
  let mockPut;
  let mockDelete;

  beforeEach(() => {
    mockPost = API.post;
    mockPut = API.put;
    mockDelete = API.delete;
    (mockPost as any).mockReset();
    (mockPut as any).mockReset();
    (mockDelete as any).mockReset();
  });

  const baseOptions: ApiRequestOptions = {
    apiUrl: "https://oneuptime.com",
    apiKey: "test-api-key",
    apiPath: "/incident",
    operation: "create",
  };

  describe("create operation", () => {
    it("should make a POST request with data wrapped in { data: ... }", async () => {
      (mockPost as any).mockResolvedValue(createSuccessResponse({ _id: "123" }));

      const result = await executeApiRequest({
        ...baseOptions,
        operation: "create",
        data: { name: "Test Incident" },
      });

      expect(mockPost).toHaveBeenCalledTimes(1);
      const callArgs = (mockPost as any).mock.calls[0][0];
      expect(callArgs.data).toEqual({ data: { name: "Test Incident" } });
      expect(result).toEqual({ _id: "123" });
    });

    it("should use empty object when no data provided for create", async () => {
      (mockPost as any).mockResolvedValue(createSuccessResponse({ _id: "123" }));

      await executeApiRequest({
        ...baseOptions,
        operation: "create",
      });

      const callArgs = (mockPost as any).mock.calls[0][0];
      expect(callArgs.data).toEqual({ data: {} });
    });
  });

  describe("read operation", () => {
    it("should make a POST request with select and id in route", async () => {
      (mockPost as any).mockResolvedValue(
        createSuccessResponse({ _id: "abc", name: "Test" }),
      );

      const result = await executeApiRequest({
        ...baseOptions,
        operation: "read",
        id: "abc-123",
        select: { _id: true, name: true },
      });

      expect(mockPost).toHaveBeenCalledTimes(1);
      const callArgs = (mockPost as any).mock.calls[0][0];
      expect(callArgs.url.toString()).toContain("abc-123/get-item");
      expect(callArgs.data).toEqual({ select: { _id: true, name: true } });
      expect(result).toEqual({ _id: "abc", name: "Test" });
    });

    it("should use empty select when none provided", async () => {
      (mockPost as any).mockResolvedValue(createSuccessResponse({}));

      await executeApiRequest({
        ...baseOptions,
        operation: "read",
        id: "abc-123",
      });

      const callArgs = (mockPost as any).mock.calls[0][0];
      expect(callArgs.data).toEqual({ select: {} });
    });

    it("should build route without id when no id provided", async () => {
      (mockPost as any).mockResolvedValue(createSuccessResponse({}));

      await executeApiRequest({
        ...baseOptions,
        operation: "read",
      });

      const callArgs = (mockPost as any).mock.calls[0][0];
      expect(callArgs.url.toString()).toContain("/api/incident");
      expect(callArgs.url.toString()).not.toContain("/get-item");
    });
  });

  describe("list operation", () => {
    it("should make a POST request with query, select, skip, limit, sort", async () => {
      (mockPost as any).mockResolvedValue(createSuccessResponse({ data: [] }));

      await executeApiRequest({
        ...baseOptions,
        operation: "list",
        query: { status: "active" },
        select: { _id: true },
        skip: 5,
        limit: 20,
        sort: { createdAt: -1 },
      });

      expect(mockPost).toHaveBeenCalledTimes(1);
      const callArgs = (mockPost as any).mock.calls[0][0];
      expect(callArgs.url.toString()).toContain("/get-list");
      expect(callArgs.data).toEqual({
        query: { status: "active" },
        select: { _id: true },
        skip: 5,
        limit: 20,
        sort: { createdAt: -1 },
      });
    });

    it("should use defaults when no query options provided", async () => {
      (mockPost as any).mockResolvedValue(createSuccessResponse({ data: [] }));

      await executeApiRequest({
        ...baseOptions,
        operation: "list",
      });

      const callArgs = (mockPost as any).mock.calls[0][0];
      expect(callArgs.data).toEqual({
        query: {},
        select: {},
        skip: 0,
        limit: 10,
        sort: {},
      });
    });
  });

  describe("count operation", () => {
    it("should make a POST request to /count path", async () => {
      (mockPost as any).mockResolvedValue(createSuccessResponse({ count: 42 }));

      const result = await executeApiRequest({
        ...baseOptions,
        operation: "count",
        query: { status: "active" },
      });

      expect(mockPost).toHaveBeenCalledTimes(1);
      const callArgs = (mockPost as any).mock.calls[0][0];
      expect(callArgs.url.toString()).toContain("/count");
      expect(result).toEqual({ count: 42 });
    });
  });

  describe("update operation", () => {
    it("should make a PUT request with data", async () => {
      (mockPut as any).mockResolvedValue(createSuccessResponse({ _id: "abc" }));

      const result = await executeApiRequest({
        ...baseOptions,
        operation: "update",
        id: "abc-123",
        data: { name: "Updated" },
      });

      expect(mockPut).toHaveBeenCalledTimes(1);
      const callArgs = (mockPut as any).mock.calls[0][0];
      expect(callArgs.url.toString()).toContain("abc-123");
      expect(callArgs.data).toEqual({ data: { name: "Updated" } });
      expect(result).toEqual({ _id: "abc" });
    });

    it("should use empty object when no data provided for update", async () => {
      (mockPut as any).mockResolvedValue(createSuccessResponse({}));

      await executeApiRequest({
        ...baseOptions,
        operation: "update",
        id: "abc-123",
      });

      const callArgs = (mockPut as any).mock.calls[0][0];
      expect(callArgs.data).toEqual({ data: {} });
    });

    it("should build route without id when no id provided", async () => {
      (mockPut as any).mockResolvedValue(createSuccessResponse({}));

      await executeApiRequest({
        ...baseOptions,
        operation: "update",
      });

      const callArgs = (mockPut as any).mock.calls[0][0];
      expect(callArgs.url.toString()).toContain("/api/incident");
    });
  });

  describe("delete operation", () => {
    it("should make a DELETE request", async () => {
      (mockDelete as any).mockResolvedValue(createSuccessResponse({}));

      await executeApiRequest({
        ...baseOptions,
        operation: "delete",
        id: "abc-123",
      });

      expect(mockDelete).toHaveBeenCalledTimes(1);
      const callArgs = (mockDelete as any).mock.calls[0][0];
      expect(callArgs.url.toString()).toContain("abc-123");
      expect(callArgs.data).toBeUndefined();
    });

    it("should build route without id when no id provided", async () => {
      (mockDelete as any).mockResolvedValue(createSuccessResponse({}));

      await executeApiRequest({
        ...baseOptions,
        operation: "delete",
      });

      const callArgs = (mockDelete as any).mock.calls[0][0];
      expect(callArgs.url.toString()).toContain("/api/incident");
    });
  });

  describe("error handling", () => {
    it("should throw on HTTPErrorResponse", async () => {
      (mockPost as any).mockResolvedValue(createErrorResponse(500, "Server Error"));

      await expect(
        executeApiRequest({ ...baseOptions, operation: "create", data: {} }),
      ).rejects.toThrow("API error");
    });

    it("should include status code in error message", async () => {
      (mockPost as any).mockResolvedValue(createErrorResponse(403, "Forbidden"));

      await expect(
        executeApiRequest({ ...baseOptions, operation: "list" }),
      ).rejects.toThrow("403");
    });

    it("should handle error response with no message", async () => {
      (mockPost as any).mockResolvedValue(createErrorResponse(500, ""));

      await expect(
        executeApiRequest({ ...baseOptions, operation: "list" }),
      ).rejects.toThrow("API error");
    });
  });

  describe("headers", () => {
    it("should include APIKey, Content-Type, and Accept headers", async () => {
      (mockPost as any).mockResolvedValue(createSuccessResponse({}));

      await executeApiRequest({
        ...baseOptions,
        operation: "create",
        data: { name: "Test" },
      });

      const callArgs = (mockPost as any).mock.calls[0][0];
      expect(callArgs.headers["APIKey"]).toBe("test-api-key");
      expect(callArgs.headers["Content-Type"]).toBe("application/json");
      expect(callArgs.headers["Accept"]).toBe("application/json");
    });
  });

  describe("default/unknown operation", () => {
    it("should handle unknown operation in buildRequestData (falls to default)", async () => {
      // The "delete" case hits the default branch in buildRequestData returning undefined
      (mockDelete as any).mockResolvedValue(createSuccessResponse({}));

      await executeApiRequest({
        ...baseOptions,
        operation: "delete",
        id: "123",
      });

      // Should not send data for delete
      const callArgs = (mockDelete as any).mock.calls[0][0];
      expect(callArgs.data).toBeUndefined();
    });
  });
});
