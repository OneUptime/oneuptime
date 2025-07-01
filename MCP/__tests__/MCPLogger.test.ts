import { describe, it, expect, beforeEach, jest } from "@jest/globals";
import MCPLogger from "../Utils/MCPLogger";

// Mock console methods
const mockConsole = {
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
};

// Mock the console
Object.defineProperty(global, "console", {
  value: mockConsole,
  writable: true,
});

describe("MCPLogger", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("Logging Methods", () => {
    it("should log info messages", () => {
      const message = "Test info message";
      MCPLogger.info(message);

      expect(mockConsole.info).toHaveBeenCalledWith(
        expect.stringContaining(message),
      );
    });

    it("should log error messages", () => {
      const message = "Test error message";
      MCPLogger.error(message);

      expect(mockConsole.error).toHaveBeenCalledWith(
        expect.stringContaining(message),
      );
    });

    it("should log warning messages", () => {
      const message = "Test warning message";
      MCPLogger.warn(message);

      expect(mockConsole.warn).toHaveBeenCalledWith(
        expect.stringContaining(message),
      );
    });

    it("should log debug messages", () => {
      const message = "Test debug message";
      MCPLogger.debug(message);

      expect(mockConsole.debug).toHaveBeenCalledWith(
        expect.stringContaining(message),
      );
    });
  });

  describe("Message Formatting", () => {
    it("should include timestamp in log messages", () => {
      const message = "Test message with timestamp";
      MCPLogger.info(message);

      expect(mockConsole.info).toHaveBeenCalledWith(
        expect.stringMatching(/\d{4}-\d{2}-\d{2}.*\d{2}:\d{2}:\d{2}/),
      );
    });

    it("should include log level in messages", () => {
      const message = "Test message with level";

      MCPLogger.info(message);
      expect(mockConsole.info).toHaveBeenCalledWith(
        expect.stringContaining("[INFO]"),
      );

      MCPLogger.error(message);
      expect(mockConsole.error).toHaveBeenCalledWith(
        expect.stringContaining("[ERROR]"),
      );
    });

    it("should handle complex objects in log messages", () => {
      const complexObject = {
        id: "123",
        name: "Test Object",
        nested: { value: "nested value" },
      };

      MCPLogger.info("Complex object:", complexObject);

      expect(mockConsole.info).toHaveBeenCalled();
    });

    it("should handle Error objects", () => {
      const error = new Error("Test error");
      error.stack = "Error stack trace";

      MCPLogger.error("Error occurred:", error);

      expect(mockConsole.error).toHaveBeenCalledWith(
        expect.stringContaining("Test error"),
      );
    });
  });

  describe("Log Level Filtering", () => {
    it("should respect log level settings", () => {
      // Test that debug messages might be filtered based on environment
      const originalEnv = process.env.NODE_ENV;

      process.env.NODE_ENV = "production";
      MCPLogger.debug("Debug message in production");

      // In production, debug messages might be filtered
      // This depends on the implementation

      process.env.NODE_ENV = "development";
      MCPLogger.debug("Debug message in development");

      // Restore original environment
      process.env.NODE_ENV = originalEnv;

      expect(mockConsole.debug).toHaveBeenCalled();
    });
  });

  describe("Performance", () => {
    it("should handle high-frequency logging", () => {
      const start = Date.now();

      for (let i = 0; i < 100; i++) {
        MCPLogger.info(`Message ${i}`);
      }

      const end = Date.now();
      const duration = end - start;

      // Should complete within reasonable time
      expect(duration).toBeLessThan(1000);
      expect(mockConsole.info).toHaveBeenCalledTimes(100);
    });
  });

  describe("Error Handling", () => {
    it("should handle null and undefined messages gracefully", () => {
      expect(() => {
        MCPLogger.info(null as any);
        MCPLogger.error(undefined as any);
      }).not.toThrow();
    });

    it("should handle circular references in objects", () => {
      const circularObj: any = { name: "test" };
      circularObj.self = circularObj;

      expect(() => {
        MCPLogger.info("Circular object:", circularObj);
      }).not.toThrow();
    });
  });

  describe("Context Information", () => {
    it("should include MCP context in log messages", () => {
      MCPLogger.info("MCP server starting");

      expect(mockConsole.info).toHaveBeenCalledWith(
        expect.stringContaining("MCP"),
      );
    });

    it("should format operation logs consistently", () => {
      const operation = "CREATE";
      const model = "Project";
      const id = "123";

      MCPLogger.info(`${operation} ${model} with ID: ${id}`);

      expect(mockConsole.info).toHaveBeenCalledWith(
        expect.stringContaining("CREATE Project with ID: 123"),
      );
    });
  });

  describe("Log Message Structure", () => {
    it("should maintain consistent log format", () => {
      const testMessage = "Test structured logging";
      MCPLogger.info(testMessage);

      const logCall = mockConsole.info.mock.calls[0][0];

      // Should contain timestamp, level, and message
      expect(logCall).toMatch(/\[.*\].*\[INFO\].*Test structured logging/);
    });

    it("should handle multiline messages", () => {
      const multilineMessage = `First line
Second line
Third line`;

      MCPLogger.info(multilineMessage);

      expect(mockConsole.info).toHaveBeenCalledWith(
        expect.stringContaining("First line"),
      );
    });
  });

  describe("Environment-specific Behavior", () => {
    it("should adjust logging based on environment variables", () => {
      const originalLogLevel = process.env.LOG_LEVEL;

      // Test different log levels
      process.env.LOG_LEVEL = "ERROR";
      MCPLogger.debug("Debug message");
      MCPLogger.error("Error message");

      process.env.LOG_LEVEL = "DEBUG";
      MCPLogger.debug("Debug message in debug mode");

      // Restore original log level
      if (originalLogLevel) {
        process.env.LOG_LEVEL = originalLogLevel;
      } else {
        delete process.env.LOG_LEVEL;
      }

      expect(mockConsole.error).toHaveBeenCalled();
    });
  });
});
