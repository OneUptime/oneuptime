import { executeApiRequest, ApiRequestOptions } from "../Core/ApiClient";
import API from "Common/Utils/API";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { JSONValue } from "Common/Types/JSON";

// Mock the Common/Utils/API module
jest.mock("Common/Utils/API", () => {
  const mockPost: jest.Mock = jest.fn();
  const mockPut: jest.Mock = jest.fn();
  const mockDelete: jest.Mock = jest.fn();

  function MockAPI(
    this: { protocol: string; hostname: string },
    protocol: string,
    hostname: string,
    _route: string,
  ): void {
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

function createSuccessResponse(
  data: Record<string, unknown> | Record<string, unknown>[],
): {
  data: Record<string, unknown> | Record<string, unknown>[];
  statusCode: number;
} {
  return { data, statusCode: 200 };
}

function createErrorResponse(
  statusCode: number,
  message: string,
): HTTPErrorResponse {
  /*
   * HTTPErrorResponse computes `message` from `.data` via a getter.
   * We create a proper prototype chain and set data to contain the message.
   */
  const resp: HTTPErrorResponse = Object.create(HTTPErrorResponse.prototype);
  resp.statusCode = statusCode;
  /*
   * HTTPResponse stores data in _jsonData and exposes it via `data` getter
   * But since the prototype chain may not have full getters, we define them
   */
  Object.defineProperty(resp, "data", {
    get: (): { message: string } => {
      return { message: message };
    },
    configurable: true,
  });
  return resp;
}

describe("ApiClient", () => {
  let mockPost: jest.Mock;
  let mockPut: jest.Mock;
  let mockDelete: jest.Mock;

  beforeEach(() => {
    mockPost = API.post as jest.Mock;
    mockPut = API.put as jest.Mock;
    mockDelete = API.delete as jest.Mock;
    (mockPost as jest.Mock).mockReset();
    (mockPut as jest.Mock).mockReset();
    (mockDelete as jest.Mock).mockReset();
  });

  const baseOptions: ApiRequestOptions = {
    apiUrl: "https://oneuptime.com",
    apiKey: "test-api-key",
    apiPath: "/incident",
    operation: "create",
  };

  describe("create operation", () => {
    it("should make a POST request with data wrapped in { data: ... }", async () => {
      (mockPost as jest.Mock).mockResolvedValue(
        createSuccessResponse({ _id: "123" }),
      );

      const result: JSONValue = await executeApiRequest({
        ...baseOptions,
        operation: "create",
        data: { name: "Test Incident" },
      });

      expect(mockPost).toHaveBeenCalledTimes(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const callArgs: any = (mockPost as jest.Mock).mock.calls[0][0];
      expect(callArgs.data).toEqual({ data: { name: "Test Incident" } });
      expect(result).toEqual({ _id: "123" });
    });

    it("should use empty object when no data provided for create", async () => {
      (mockPost as jest.Mock).mockResolvedValue(
        createSuccessResponse({ _id: "123" }),
      );

      await executeApiRequest({
        ...baseOptions,
        operation: "create",
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const callArgs: any = (mockPost as jest.Mock).mock.calls[0][0];
      expect(callArgs.data).toEqual({ data: {} });
    });
  });

  describe("read operation", () => {
    it("should make a POST request with select and id in route", async () => {
      (mockPost as jest.Mock).mockResolvedValue(
        createSuccessResponse({ _id: "abc", name: "Test" }),
      );

      const result: JSONValue = await executeApiRequest({
        ...baseOptions,
        operation: "read",
        id: "abc-123",
        select: { _id: true, name: true },
      });

      expect(mockPost).toHaveBeenCalledTimes(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const callArgs: any = (mockPost as jest.Mock).mock.calls[0][0];
      expect(callArgs.url.toString()).toContain("abc-123/get-item");
      expect(callArgs.data).toEqual({ select: { _id: true, name: true } });
      expect(result).toEqual({ _id: "abc", name: "Test" });
    });

    it("should use empty select when none provided", async () => {
      (mockPost as jest.Mock).mockResolvedValue(createSuccessResponse({}));

      await executeApiRequest({
        ...baseOptions,
        operation: "read",
        id: "abc-123",
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const callArgs: any = (mockPost as jest.Mock).mock.calls[0][0];
      expect(callArgs.data).toEqual({ select: {} });
    });

    it("should build route without id when no id provided", async () => {
      (mockPost as jest.Mock).mockResolvedValue(createSuccessResponse({}));

      await executeApiRequest({
        ...baseOptions,
        operation: "read",
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const callArgs: any = (mockPost as jest.Mock).mock.calls[0][0];
      expect(callArgs.url.toString()).toContain("/api/incident");
      expect(callArgs.url.toString()).not.toContain("/get-item");
    });
  });

  describe("list operation", () => {
    it("should make a POST request with query, select, skip, limit, sort", async () => {
      (mockPost as jest.Mock).mockResolvedValue(
        createSuccessResponse({ data: [] }),
      );

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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const callArgs: any = (mockPost as jest.Mock).mock.calls[0][0];
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
      (mockPost as jest.Mock).mockResolvedValue(
        createSuccessResponse({ data: [] }),
      );

      await executeApiRequest({
        ...baseOptions,
        operation: "list",
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const callArgs: any = (mockPost as jest.Mock).mock.calls[0][0];
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
      (mockPost as jest.Mock).mockResolvedValue(
        createSuccessResponse({ count: 42 }),
      );

      const result: JSONValue = await executeApiRequest({
        ...baseOptions,
        operation: "count",
        query: { status: "active" },
      });

      expect(mockPost).toHaveBeenCalledTimes(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const callArgs: any = (mockPost as jest.Mock).mock.calls[0][0];
      expect(callArgs.url.toString()).toContain("/count");
      expect(result).toEqual({ count: 42 });
    });
  });

  describe("update operation", () => {
    it("should make a PUT request with data", async () => {
      (mockPut as jest.Mock).mockResolvedValue(
        createSuccessResponse({ _id: "abc" }),
      );

      const result: JSONValue = await executeApiRequest({
        ...baseOptions,
        operation: "update",
        id: "abc-123",
        data: { name: "Updated" },
      });

      expect(mockPut).toHaveBeenCalledTimes(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const callArgs: any = (mockPut as jest.Mock).mock.calls[0][0];
      expect(callArgs.url.toString()).toContain("abc-123");
      expect(callArgs.data).toEqual({ data: { name: "Updated" } });
      expect(result).toEqual({ _id: "abc" });
    });

    it("should use empty object when no data provided for update", async () => {
      (mockPut as jest.Mock).mockResolvedValue(createSuccessResponse({}));

      await executeApiRequest({
        ...baseOptions,
        operation: "update",
        id: "abc-123",
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const callArgs: any = (mockPut as jest.Mock).mock.calls[0][0];
      expect(callArgs.data).toEqual({ data: {} });
    });

    it("should build route without id when no id provided", async () => {
      (mockPut as jest.Mock).mockResolvedValue(createSuccessResponse({}));

      await executeApiRequest({
        ...baseOptions,
        operation: "update",
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const callArgs: any = (mockPut as jest.Mock).mock.calls[0][0];
      expect(callArgs.url.toString()).toContain("/api/incident");
    });
  });

  describe("delete operation", () => {
    it("should make a DELETE request", async () => {
      (mockDelete as jest.Mock).mockResolvedValue(createSuccessResponse({}));

      await executeApiRequest({
        ...baseOptions,
        operation: "delete",
        id: "abc-123",
      });

      expect(mockDelete).toHaveBeenCalledTimes(1);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const callArgs: any = (mockDelete as jest.Mock).mock.calls[0][0];
      expect(callArgs.url.toString()).toContain("abc-123");
      expect(callArgs.data).toBeUndefined();
    });

    it("should build route without id when no id provided", async () => {
      (mockDelete as jest.Mock).mockResolvedValue(createSuccessResponse({}));

      await executeApiRequest({
        ...baseOptions,
        operation: "delete",
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const callArgs: any = (mockDelete as jest.Mock).mock.calls[0][0];
      expect(callArgs.url.toString()).toContain("/api/incident");
    });
  });

  describe("error handling", () => {
    it("should throw on HTTPErrorResponse", async () => {
      (mockPost as jest.Mock).mockResolvedValue(
        createErrorResponse(500, "Server Error"),
      );

      await expect(
        executeApiRequest({ ...baseOptions, operation: "create", data: {} }),
      ).rejects.toThrow("API error");
    });

    it("should include status code in error message", async () => {
      (mockPost as jest.Mock).mockResolvedValue(
        createErrorResponse(403, "Forbidden"),
      );

      await expect(
        executeApiRequest({ ...baseOptions, operation: "list" }),
      ).rejects.toThrow("403");
    });

    it("should handle error response with no message", async () => {
      (mockPost as jest.Mock).mockResolvedValue(createErrorResponse(500, ""));

      await expect(
        executeApiRequest({ ...baseOptions, operation: "list" }),
      ).rejects.toThrow("API error");
    });
  });

  describe("headers", () => {
    it("should include APIKey, Content-Type, and Accept headers", async () => {
      (mockPost as jest.Mock).mockResolvedValue(createSuccessResponse({}));

      await executeApiRequest({
        ...baseOptions,
        operation: "create",
        data: { name: "Test" },
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const callArgs: any = (mockPost as jest.Mock).mock.calls[0][0];
      expect(callArgs.headers["APIKey"]).toBe("test-api-key");
      expect(callArgs.headers["Content-Type"]).toBe("application/json");
      expect(callArgs.headers["Accept"]).toBe("application/json");
    });
  });

  describe("default/unknown operation", () => {
    it("should handle unknown operation in buildRequestData (falls to default)", async () => {
      // The "delete" case hits the default branch in buildRequestData returning undefined
      (mockDelete as jest.Mock).mockResolvedValue(createSuccessResponse({}));

      await executeApiRequest({
        ...baseOptions,
        operation: "delete",
        id: "123",
      });

      // Should not send data for delete
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const callArgs: any = (mockDelete as jest.Mock).mock.calls[0][0];
      expect(callArgs.data).toBeUndefined();
    });
  });
});
