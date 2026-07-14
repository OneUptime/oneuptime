import { describe, expect, test, afterEach } from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import LogPipelineProcessorType from "Common/Types/Log/LogPipelineProcessorType";
import LogPipeline from "Common/Models/DatabaseModels/LogPipeline";
import LogPipelineProcessor from "Common/Models/DatabaseModels/LogPipelineProcessor";
import logger from "Common/Server/Utils/Logger";
import {
  LogPipelineService,
  LoadedPipeline,
} from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import { compileFilter } from "../../FeatureSet/Telemetry/Utils/LogFilterEvaluator";

/*
 * Unit tests for LogPipelineService.processLog — the per-record transform that
 * runs on the log ingest path. Exercised through the public processLog() with
 * an empty filter (matches every log) so each processor type runs.
 */
describe("LogPipelineService.processLog", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  const makeProcessor: (
    processorType: LogPipelineProcessorType,
    configuration: JSONObject,
    name?: string,
  ) => LogPipelineProcessor = (
    processorType: LogPipelineProcessorType,
    configuration: JSONObject,
    name: string = "test-processor",
  ): LogPipelineProcessor => {
    const processor: LogPipelineProcessor = new LogPipelineProcessor();
    processor.name = name;
    processor.processorType = processorType;
    processor.configuration = configuration;
    return processor;
  };

  // A pipeline whose empty filter matches every log row.
  const matchAllPipeline: (
    processors: Array<LogPipelineProcessor>,
  ) => LoadedPipeline = (
    processors: Array<LogPipelineProcessor>,
  ): LoadedPipeline => {
    const pipeline: LogPipeline = new LogPipeline();
    pipeline.name = "test-pipeline";
    return {
      pipeline,
      compiledFilter: compileFilter(""),
      processors,
    };
  };

  describe("AttributeRemapper", () => {
    test("copies the source attribute to the target key and drops the source", () => {
      const result: JSONObject = LogPipelineService.processLog(
        { attributes: { http_status: "500" }, attributeKeys: ["http_status"] },
        [
          matchAllPipeline([
            makeProcessor(LogPipelineProcessorType.AttributeRemapper, {
              sourceKey: "http_status",
              targetKey: "status_code",
            }),
          ]),
        ],
      );

      const attrs: Record<string, unknown> = result["attributes"] as Record<
        string,
        unknown
      >;
      expect(attrs["status_code"]).toBe("500");
      expect(attrs["http_status"]).toBeUndefined();
      expect(result["attributeKeys"]).toContain("status_code");
      expect(result["attributeKeys"]).not.toContain("http_status");
    });

    test("preserves the source attribute when preserveSource is true", () => {
      const result: JSONObject = LogPipelineService.processLog(
        { attributes: { http_status: "500" }, attributeKeys: ["http_status"] },
        [
          matchAllPipeline([
            makeProcessor(LogPipelineProcessorType.AttributeRemapper, {
              sourceKey: "http_status",
              targetKey: "status_code",
              preserveSource: true,
            }),
          ]),
        ],
      );

      const attrs: Record<string, unknown> = result["attributes"] as Record<
        string,
        unknown
      >;
      expect(attrs["status_code"]).toBe("500");
      expect(attrs["http_status"]).toBe("500");
    });
  });

  describe("SeverityRemapper", () => {
    test("maps a matching source value to severityText/severityNumber", () => {
      const result: JSONObject = LogPipelineService.processLog(
        { attributes: { level: "ERROR" } },
        [
          matchAllPipeline([
            makeProcessor(LogPipelineProcessorType.SeverityRemapper, {
              sourceKey: "level",
              mappings: [
                {
                  matchValue: "error",
                  severityText: "Error",
                  severityNumber: 17,
                },
              ],
            }),
          ]),
        ],
      );

      expect(result["severityText"]).toBe("Error");
      expect(result["severityNumber"]).toBe(17);
    });

    test("leaves the log unchanged when no mapping matches", () => {
      const input: JSONObject = { attributes: { level: "TRACE" } };
      const result: JSONObject = LogPipelineService.processLog(input, [
        matchAllPipeline([
          makeProcessor(LogPipelineProcessorType.SeverityRemapper, {
            sourceKey: "level",
            mappings: [
              {
                matchValue: "error",
                severityText: "Error",
                severityNumber: 17,
              },
            ],
          }),
        ]),
      ]);

      expect(result["severityText"]).toBeUndefined();
      expect(result["severityNumber"]).toBeUndefined();
    });
  });

  describe("CategoryProcessor", () => {
    test("tags the log with the first matching category name", () => {
      const result: JSONObject = LogPipelineService.processLog(
        { attributes: { env: "prod" }, attributeKeys: ["env"] },
        [
          matchAllPipeline([
            makeProcessor(LogPipelineProcessorType.CategoryProcessor, {
              targetKey: "category",
              categories: [{ name: "production", filterQuery: "" }],
            }),
          ]),
        ],
      );

      const attrs: Record<string, unknown> = result["attributes"] as Record<
        string,
        unknown
      >;
      expect(attrs["category"]).toBe("production");
    });
  });

  describe("unsupported processor type (e.g. GrokParser)", () => {
    test("returns the log unchanged and logs a warning instead of silently dropping it", () => {
      const warnSpy: jest.SpyInstance = jest.spyOn(
        logger,
        "warn",
      ) as jest.SpyInstance;
      warnSpy.mockImplementation(() => {});

      const input: JSONObject = { body: "raw log line", attributes: {} };
      const result: JSONObject = LogPipelineService.processLog(input, [
        matchAllPipeline([
          makeProcessor(
            LogPipelineProcessorType.GrokParser,
            { matchPattern: "%{GREEDYDATA:msg}" },
            "my-grok",
          ),
        ]),
      ]);

      expect(result["body"]).toBe("raw log line");
      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0]![0]).toContain("GrokParser");
      expect(warnSpy.mock.calls[0]![0]).toContain("my-grok");
    });
  });

  describe("filter gating", () => {
    test("does not apply processors when the pipeline filter does not match", () => {
      const pipeline: LoadedPipeline = matchAllPipeline([
        makeProcessor(LogPipelineProcessorType.AttributeRemapper, {
          sourceKey: "http_status",
          targetKey: "status_code",
        }),
      ]);
      // Replace the match-all filter with one that requires a missing attribute.
      pipeline.compiledFilter = compileFilter("attributes.never_present = yes");

      const input: JSONObject = {
        attributes: { http_status: "500" },
        attributeKeys: ["http_status"],
      };
      const result: JSONObject = LogPipelineService.processLog(input, [
        pipeline,
      ]);

      const attrs: Record<string, unknown> = result["attributes"] as Record<
        string,
        unknown
      >;
      expect(attrs["status_code"]).toBeUndefined();
      expect(attrs["http_status"]).toBe("500");
    });
  });

  test("does not mutate the input log row", () => {
    const input: JSONObject = {
      attributes: { http_status: "500" },
      attributeKeys: ["http_status"],
    };

    LogPipelineService.processLog(input, [
      matchAllPipeline([
        makeProcessor(LogPipelineProcessorType.AttributeRemapper, {
          sourceKey: "http_status",
          targetKey: "status_code",
        }),
      ]),
    ]);

    // Original object is untouched — processLog works on a copy.
    expect(input["attributes"]).toEqual({ http_status: "500" });
  });
});
