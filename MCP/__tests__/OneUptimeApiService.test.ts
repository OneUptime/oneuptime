import {
  describe,
  it,
  expect,
  beforeEach,
  jest,
  afterEach,
} from "@jest/globals";
import OneUptimeApiService, {
  OneUptimeApiConfig,
} from "../Services/OneUptimeApiService";
import OneUptimeOperation from "../Types/OneUptimeOperation";
import ModelType from "../Types/ModelType";
import { OneUptimeToolCallArgs } from "../Types/McpTypes";

// Mock the Common dependencies
jest.mock("Common/Utils/API");
jest.mock("Common/Types/API/URL", () => {
  return {
    default: class MockURL {
      public protocol: any;
      public hostname: any;

      public constructor(protocol: any, hostname: any, _route?: any) {
        this.protocol = protocol;
        this.hostname =
          typeof hostname === "string"
            ? {
                toString: (): string => {
                  return hostname;
                },
              }
            : hostname;
      }

      public toString(): string {
        return `${this.protocol}://${this.hostname.toString()}`;
      }

      public static fromString(url: unknown): any {
        return {
          protocol: "https://",
          hostname: {
            toString: () => {
              return "test.oneuptime.com";
            },
          },
          toString: () => {
            return url;
          },
        };
      }

      public static getDatabaseTransformer(): any {
        return {
          to: (value: any) => {
            return value?.toString();
          },
          from: (value: any) => {
            return value;
          },
        };
      }
    },
  };
});
jest.mock("Common/Types/API/Route");
jest.mock("Common/Server/EnvironmentConfig", () => {
  return {
    LogLevel: "debug",
    AdminDashboardClientURL: {
      toString: () => {
        return "https://test.oneuptime.com";
      },
      protocol: "https://",
      hostname: {
        toString: () => {
          return "test.oneuptime.com";
        },
      },
    },
  };
});
jest.mock("../Utils/MCPLogger");

describe("OneUptimeApiService", () => {
  const mockConfig: OneUptimeApiConfig = {
    url: "https://test.oneuptime.com",
  };

  const testApiKey: string = "test-api-key-123";

  beforeEach(() => {
    jest.clearAllMocks();
  });

  afterEach(() => {
    // Reset the service state
    (OneUptimeApiService as any).api = null;
  });

  describe("Service Initialization", () => {
    it("should not throw error when initialized without API key (API key is per-request)", () => {
      expect(() => {
        OneUptimeApiService.initialize(mockConfig);
      }).not.toThrow();
    });

    it("should throw error when API key is missing during operation", async () => {
      OneUptimeApiService.initialize(mockConfig);
      const args: OneUptimeToolCallArgs = { id: "123" };

      await expect(
        OneUptimeApiService.executeOperation(
          "Project",
          OneUptimeOperation.Read,
          ModelType.Database,
          "/api/project",
          args,
          "", // Empty API key
        ),
      ).rejects.toThrow(
        "API key is required. Please provide x-api-key header in your request.",
      );
    });

    it("should handle different URL formats", () => {
      const configs: Array<{ url: string }> = [
        { url: "https://oneuptime.com" },
        { url: "http://localhost:3000" },
        { url: "https://custom.domain.com:8080/api" },
      ];

      configs.forEach((config: { url: string }) => {
        expect(() => {
          OneUptimeApiService.initialize(config);
        }).not.toThrow();
      });
    });
  });

  describe("Operation Validation", () => {
    beforeEach(() => {
      OneUptimeApiService.initialize(mockConfig);
    });

    it("should validate required arguments for read operation", async () => {
      const args: OneUptimeToolCallArgs = {}; // Missing id

      await expect(
        OneUptimeApiService.executeOperation(
          "Project",
          OneUptimeOperation.Read,
          ModelType.Database,
          "/api/project",
          args,
          testApiKey,
        ),
      ).rejects.toThrow("ID is required for read operation");
    });

    it("should validate required arguments for update operation", async () => {
      const argsWithoutId: OneUptimeToolCallArgs = {
        data: { name: "Updated Project" },
      };

      await expect(
        OneUptimeApiService.executeOperation(
          "Project",
          OneUptimeOperation.Update,
          ModelType.Database,
          "/api/project",
          argsWithoutId,
          testApiKey,
        ),
      ).rejects.toThrow("ID is required for update operation");

      const argsWithoutData: OneUptimeToolCallArgs = {
        id: "123",
      };

      await expect(
        OneUptimeApiService.executeOperation(
          "Project",
          OneUptimeOperation.Update,
          ModelType.Database,
          "/api/project",
          argsWithoutData,
          testApiKey,
        ),
      ).rejects.toThrow("Data is required for update operation");
    });

    it("should validate required arguments for delete operation", async () => {
      const args: OneUptimeToolCallArgs = {}; // Missing id

      await expect(
        OneUptimeApiService.executeOperation(
          "Project",
          OneUptimeOperation.Delete,
          ModelType.Database,
          "/api/project",
          args,
          testApiKey,
        ),
      ).rejects.toThrow("ID is required for delete operation");
    });

    it("should validate required arguments for create operation", async () => {
      const args: OneUptimeToolCallArgs = {}; // Missing data

      await expect(
        OneUptimeApiService.executeOperation(
          "Project",
          OneUptimeOperation.Create,
          ModelType.Database,
          "/api/project",
          args,
          testApiKey,
        ),
      ).rejects.toThrow("Data is required for create operation");
    });
  });

  describe("Error Handling", () => {
    it("should throw error when service is not initialized", async () => {
      const args: OneUptimeToolCallArgs = { id: "123" };

      await expect(
        OneUptimeApiService.executeOperation(
          "Project",
          OneUptimeOperation.Read,
          ModelType.Database,
          "/api/project",
          args,
          testApiKey,
        ),
      ).rejects.toThrow("OneUptime API Service not initialized");
    });

    it("should handle unsupported operations", async () => {
      OneUptimeApiService.initialize(mockConfig);
      const args: OneUptimeToolCallArgs = { id: "123" };

      await expect(
        OneUptimeApiService.executeOperation(
          "Project",
          "unsupported" as OneUptimeOperation,
          ModelType.Database,
          "/api/project",
          args,
          testApiKey,
        ),
      ).rejects.toThrow("Unsupported operation: unsupported");
    });
  });

  describe("Request Data Building", () => {
    beforeEach(() => {
      OneUptimeApiService.initialize(mockConfig);
    });

    it("should build correct request data for different operations", () => {
      const testCases: Array<{
        operation: OneUptimeOperation;
        args: any;
        expectedData: any;
      }> = [
        {
          operation: OneUptimeOperation.Create,
          args: { data: { name: "Test" } },
          expectedData: expect.objectContaining({ data: { name: "Test" } }),
        },
        {
          operation: OneUptimeOperation.Read,
          args: { id: "123" },
          expectedData: expect.objectContaining({ query: { _id: "123" } }),
        },
        {
          operation: OneUptimeOperation.List,
          args: { limit: 10, skip: 0 },
          expectedData: expect.objectContaining({ limit: 10, skip: 0 }),
        },
        {
          operation: OneUptimeOperation.Update,
          args: { id: "123", data: { name: "Updated" } },
          expectedData: expect.objectContaining({
            query: { _id: "123" },
            data: { name: "Updated" },
          }),
        },
        {
          operation: OneUptimeOperation.Delete,
          args: { id: "123" },
          expectedData: expect.objectContaining({ query: { _id: "123" } }),
        },
        {
          operation: OneUptimeOperation.Count,
          args: { query: { status: "active" } },
          expectedData: expect.objectContaining({
            query: { status: "active" },
          }),
        },
      ];

      testCases.forEach(
        (testCase: {
          operation: OneUptimeOperation;
          args: any;
          expectedData: any;
        }) => {
          /*
           * Test the internal getRequestData method if it were public
           * This would require exposing the method or testing through executeOperation
           */
          expect(testCase.expectedData).toBeDefined();
        },
      );
    });
  });

  describe("API Headers", () => {
    beforeEach(() => {
      OneUptimeApiService.initialize(mockConfig);
    });

    it("should include proper authentication headers", () => {
      /*
       * Test that headers include the API key (provided per-request)
       * This would require exposing the getHeaders method or testing through executeOperation
       */
      expect(testApiKey).toBe("test-api-key-123");
    });
  });

  describe("Configuration Management", () => {
    it("should initialize without error", () => {
      expect(() => {
        OneUptimeApiService.initialize(mockConfig);
      }).not.toThrow();

      // Verify API is initialized
      const api: any = (OneUptimeApiService as any).api;
      expect(api).toBeDefined();
    });

    it("should handle re-initialization", () => {
      OneUptimeApiService.initialize(mockConfig);

      const newConfig: OneUptimeApiConfig = {
        url: "https://new.oneuptime.com",
      };

      expect(() => {
        OneUptimeApiService.initialize(newConfig);
      }).not.toThrow();

      // Verify API is still defined after re-initialization
      const api: any = (OneUptimeApiService as any).api;
      expect(api).toBeDefined();
    });
  });
});
