import LogPipelineService, {
  LoadedPipeline,
} from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import TracePipelineService, {
  LoadedTracePipeline,
} from "../../FeatureSet/Telemetry/Services/TracePipelineService";
import * as FilterEvaluator from "../../FeatureSet/Telemetry/Utils/LogFilterEvaluator";
import { CompiledFilter } from "../../FeatureSet/Telemetry/Utils/LogFilterEvaluator";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import LogPipelineProcessorType from "Common/Types/Log/LogPipelineProcessorType";
import TracePipelineProcessorType from "Common/Types/Trace/TracePipelineProcessorType";

jest.mock("Common/Server/Services/DatabaseService", () => {
  return {
    __esModule: true,
    default: class DatabaseServiceStub {
      public hardDeleteItemsOlderThanInDays(): void {}
      public setDoNotAllowDelete(): void {}
      public findBy(...args: Array<unknown>): Promise<Array<unknown>> {
        return mockFindBy(...args);
      }
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return { __esModule: true, default: { error: jest.fn() } };
});

const mockFindBy: jest.Mock = jest.fn();

interface ProcessorSpec {
  name: string;
  processorType: string;
  configuration: unknown;
}

interface PipelineSpec {
  pipeline: { name: string };
  compiledFilter: CompiledFilter;
  processors: Array<ProcessorSpec>;
}

interface PipelineAdapter {
  signal: string;
  categoryType: string;
  remapperType: string;
  process: (row: JSONObject, pipelines: Array<PipelineSpec>) => JSONObject;
  load: (projectId: ObjectID) => Promise<Array<PipelineSpec>>;
}

const adapters: Array<PipelineAdapter> = [
  {
    signal: "logs",
    categoryType: LogPipelineProcessorType.CategoryProcessor,
    remapperType: LogPipelineProcessorType.AttributeRemapper,
    process: (row: JSONObject, pipelines: Array<PipelineSpec>): JSONObject => {
      return LogPipelineService.processLog(
        row,
        pipelines as unknown as Array<LoadedPipeline>,
      );
    },
    load: async (projectId: ObjectID): Promise<Array<PipelineSpec>> => {
      return (await LogPipelineService.loadPipelines(
        projectId,
      )) as unknown as Array<PipelineSpec>;
    },
  },
  {
    signal: "traces",
    categoryType: TracePipelineProcessorType.CategoryProcessor,
    remapperType: TracePipelineProcessorType.AttributeRemapper,
    process: (row: JSONObject, pipelines: Array<PipelineSpec>): JSONObject => {
      return TracePipelineService.processSpan(
        row,
        pipelines as unknown as Array<LoadedTracePipeline>,
      );
    },
    load: async (projectId: ObjectID): Promise<Array<PipelineSpec>> => {
      return (await TracePipelineService.loadPipelines(
        projectId,
      )) as unknown as Array<PipelineSpec>;
    },
  },
];

function categoryConfiguration(name: string = "errors"): JSONObject {
  return {
    targetKey: "category",
    categories: [
      {
        name,
        filterQuery: "attributes.level = 'error' AND body LIKE 'request %'",
      },
      { name: "api", filterQuery: "attributes.service IN ('api', 'worker')" },
    ],
  };
}

function categoryProcessor(
  adapter: PipelineAdapter,
  configuration: unknown,
): ProcessorSpec {
  return {
    name: "categorize",
    processorType: adapter.categoryType,
    configuration,
  };
}

function pipelinesWith(
  processors: Array<ProcessorSpec>,
  filterQuery: string = "",
): Array<PipelineSpec> {
  return [
    {
      pipeline: { name: "test" },
      compiledFilter: FilterEvaluator.compileFilter(filterQuery),
      processors,
    },
  ];
}

function row(level: string = "error", service: string = "api"): JSONObject {
  return {
    body: "request failed",
    name: "request failed",
    attributes: { level, service },
    attributeKeys: ["level", "service"],
  };
}

describe.each(adapters)(
  "$signal processor configuration reuse",
  (adapter: PipelineAdapter) => {
    afterEach(() => {
      jest.restoreAllMocks();
      mockFindBy.mockReset();
    });

    test("parses once and compiles each category once across 1,000 records", () => {
      const processor: ProcessorSpec = categoryProcessor(
        adapter,
        JSON.stringify(categoryConfiguration()),
      );
      const pipelines: Array<PipelineSpec> = pipelinesWith([processor]);
      const parse: jest.SpyInstance = jest.spyOn(JSON, "parse");
      const compile: jest.SpyInstance = jest.spyOn(
        FilterEvaluator,
        "compileFilter",
      );

      for (let index: number = 0; index < 1_000; index++) {
        const level: string = index % 2 === 0 ? "error" : "info";
        expect(adapter.process(row(level), pipelines)["attributes"]).toEqual({
          level,
          service: "api",
          category: level === "error" ? "errors" : "api",
        });
      }

      expect(parse).toHaveBeenCalledTimes(1);
      expect(compile).toHaveBeenCalledTimes(2);
      expect(typeof processor.configuration).toBe("string");
    });

    test("preserves category priority, unmatched rows and input immutability", () => {
      const pipelines: Array<PipelineSpec> = pipelinesWith([
        categoryProcessor(adapter, JSON.stringify(categoryConfiguration())),
      ]);
      const original: JSONObject = row();
      const before: string = JSON.stringify(original);
      const matched: JSONObject = adapter.process(original, pipelines);
      expect((matched["attributes"] as JSONObject)["category"]).toBe("errors");
      expect(matched["attributeKeys"]).toEqual([
        "level",
        "service",
        "category",
      ]);
      expect(JSON.stringify(original)).toBe(before);
      const unmatched: JSONObject = row("info", "other");
      expect(adapter.process(unmatched, pipelines)).toEqual(unmatched);
    });

    test("produces identical rows for object and string configurations", () => {
      const fromObject: Array<PipelineSpec> = pipelinesWith([
        categoryProcessor(adapter, categoryConfiguration()),
      ]);
      const fromString: Array<PipelineSpec> = pipelinesWith([
        categoryProcessor(adapter, JSON.stringify(categoryConfiguration())),
      ]);
      for (const level of ["error", "info", "debug"]) {
        for (const service of ["api", "worker", "other"]) {
          expect(adapter.process(row(level, service), fromString)).toEqual(
            adapter.process(row(level, service), fromObject),
          );
        }
      }
    });

    test("does not parse configurations in pipelines whose filters do not match", () => {
      const pipelines: Array<PipelineSpec> = pipelinesWith(
        [categoryProcessor(adapter, JSON.stringify(categoryConfiguration()))],
        "attributes.service = 'other'",
      );
      const parse: jest.SpyInstance = jest.spyOn(JSON, "parse");
      const compile: jest.SpyInstance = jest.spyOn(
        FilterEvaluator,
        "compileFilter",
      );
      expect(adapter.process(row(), pipelines)).toEqual(row());
      expect(parse).not.toHaveBeenCalled();
      expect(compile).not.toHaveBeenCalled();
    });

    test("invalidates category filters after a same-length config replacement", () => {
      const processor: ProcessorSpec = categoryProcessor(
        adapter,
        JSON.stringify(categoryConfiguration()),
      );
      const pipelines: Array<PipelineSpec> = pipelinesWith([processor]);
      adapter.process(row(), pipelines);
      const compile: jest.SpyInstance = jest.spyOn(
        FilterEvaluator,
        "compileFilter",
      );
      processor.configuration = JSON.stringify({
        targetKey: "classification",
        categories: [
          { name: "info", filterQuery: "attributes.level = 'info'" },
          { name: "fallback", filterQuery: "" },
        ],
      });
      const output: JSONObject = adapter.process(row(), pipelines);
      expect(output["attributes"]).toEqual({
        level: "error",
        service: "api",
        classification: "fallback",
      });
      expect(compile).toHaveBeenCalledTimes(2);
      expect(
        (adapter.process(row("info"), pipelines)["attributes"] as JSONObject)[
          "classification"
        ],
      ).toBe("info");
      expect(compile).toHaveBeenCalledTimes(2);
    });

    test("observes in-place object configuration changes", () => {
      const configuration: JSONObject = {
        sourceKey: "level",
        targetKey: "first",
        preserveSource: true,
      };
      const processor: ProcessorSpec = {
        name: "remap",
        processorType: adapter.remapperType,
        configuration,
      };
      const pipelines: Array<PipelineSpec> = pipelinesWith([processor]);
      expect(
        (adapter.process(row(), pipelines)["attributes"] as JSONObject)[
          "first"
        ],
      ).toBe("error");
      configuration["targetKey"] = "second";
      expect(adapter.process(row(), pipelines)["attributes"]).toEqual({
        level: "error",
        service: "api",
        second: "error",
      });
    });

    test("retains processor order and lets later filters see earlier changes", () => {
      const remapper: ProcessorSpec = {
        name: "remap",
        processorType: adapter.remapperType,
        configuration: JSON.stringify({
          sourceKey: "level",
          targetKey: "remapped",
          preserveSource: false,
        }),
      };
      const category: ProcessorSpec = categoryProcessor(
        adapter,
        JSON.stringify({
          targetKey: "category",
          categories: [
            {
              name: "after-remap",
              filterQuery: "attributes.remapped = 'error'",
            },
          ],
        }),
      );
      const pipelines: Array<PipelineSpec> = [
        ...pipelinesWith([remapper]),
        ...pipelinesWith([category], "attributes.remapped = 'error'"),
      ];
      expect(adapter.process(row(), pipelines)["attributes"]).toEqual({
        service: "api",
        remapped: "error",
        category: "after-remap",
      });
    });

    test("handles malformed saved config without preventing later processors", () => {
      const broken: ProcessorSpec = categoryProcessor(adapter, "not json");
      const working: ProcessorSpec = categoryProcessor(
        adapter,
        JSON.stringify(categoryConfiguration()),
      );
      const pipelines: Array<PipelineSpec> = pipelinesWith([broken, working]);
      expect(
        (adapter.process(row(), pipelines)["attributes"] as JSONObject)[
          "category"
        ],
      ).toBe("errors");
      broken.configuration = JSON.stringify(categoryConfiguration("repaired"));
      pipelines[0]!.processors = [broken];
      expect(
        (adapter.process(row(), pipelines)["attributes"] as JSONObject)[
          "category"
        ],
      ).toBe("repaired");
    });

    test("keeps processor configurations separate across projects", async () => {
      const firstProcessor: ProcessorSpec = categoryProcessor(
        adapter,
        JSON.stringify(categoryConfiguration("first")),
      );
      const secondProcessor: ProcessorSpec = categoryProcessor(
        adapter,
        JSON.stringify(categoryConfiguration("second")),
      );
      mockFindBy
        .mockResolvedValueOnce([
          { _id: "pipeline", name: "first", filterQuery: "" },
        ])
        .mockResolvedValueOnce([firstProcessor]);
      const first: Array<PipelineSpec> = await adapter.load(
        ObjectID.generate(),
      );
      mockFindBy
        .mockResolvedValueOnce([
          { _id: "pipeline", name: "second", filterQuery: "" },
        ])
        .mockResolvedValueOnce([secondProcessor]);
      const second: Array<PipelineSpec> = await adapter.load(
        ObjectID.generate(),
      );
      expect(
        (adapter.process(row(), first)["attributes"] as JSONObject)["category"],
      ).toBe("first");
      expect(
        (adapter.process(row(), second)["attributes"] as JSONObject)[
          "category"
        ],
      ).toBe("second");
      expect(
        (adapter.process(row(), first)["attributes"] as JSONObject)["category"],
      ).toBe("first");
    });

    test("reuses loaded configs until expiry then compiles refreshed processor objects", async () => {
      const projectId: ObjectID = ObjectID.generate();
      const now: jest.SpyInstance = jest
        .spyOn(Date, "now")
        .mockReturnValue(1_000_000);
      const oldProcessor: ProcessorSpec = categoryProcessor(
        adapter,
        JSON.stringify(categoryConfiguration("old")),
      );
      mockFindBy
        .mockResolvedValueOnce([
          { _id: "pipeline", name: "pipeline", filterQuery: "" },
        ])
        .mockResolvedValueOnce([oldProcessor]);
      const first: Array<PipelineSpec> = await adapter.load(projectId);
      const parse: jest.SpyInstance = jest.spyOn(JSON, "parse");
      expect(
        (adapter.process(row(), first)["attributes"] as JSONObject)["category"],
      ).toBe("old");
      const cached: Array<PipelineSpec> = await adapter.load(projectId);
      expect(cached).toBe(first);
      adapter.process(row(), cached);
      expect(parse).toHaveBeenCalledTimes(1);
      expect(mockFindBy).toHaveBeenCalledTimes(2);

      now.mockReturnValue(1_060_001);
      const newProcessor: ProcessorSpec = categoryProcessor(
        adapter,
        JSON.stringify(categoryConfiguration("new")),
      );
      mockFindBy
        .mockResolvedValueOnce([
          { _id: "pipeline", name: "pipeline", filterQuery: "" },
        ])
        .mockResolvedValueOnce([newProcessor]);
      const refreshed: Array<PipelineSpec> = await adapter.load(projectId);
      expect(refreshed).not.toBe(first);
      expect(
        (adapter.process(row(), refreshed)["attributes"] as JSONObject)[
          "category"
        ],
      ).toBe("new");
      expect(parse).toHaveBeenCalledTimes(2);
      expect(mockFindBy).toHaveBeenCalledTimes(4);
    });
  },
);
