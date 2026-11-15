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
import { readOwnValue } from "Common/Utils/LookupTable";
import { INHERITED_PROPERTY_NAMES } from "Common/Tests/Helpers/InheritedNames";

jest.mock("Common/Server/Services/DatabaseService", () => {
  return {
    __esModule: true,
    default: class DatabaseServiceStub {
      public hardDeleteItemsOlderThanInDays(): void {}
      public setDoNotAllowDelete(): void {}
      public keepRowsOnDeleteByQuery(): void {}
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

    /*
     * A key named like an Object member (constructor, toString, __proto__)
     * is one the record may or may not carry, like any other key.
     */
    test("the attribute remapper reads and writes only the record's own keys", () => {
      const remap: (configuration: JSONObject) => Array<PipelineSpec> = (
        configuration: JSONObject,
      ): Array<PipelineSpec> => {
        return pipelinesWith([
          {
            name: "remap",
            processorType: adapter.remapperType,
            configuration,
          },
        ]);
      };

      // No attribute named constructor: nothing to copy.
      expect(
        adapter.process(
          row(),
          remap({
            sourceKey: "constructor",
            targetKey: "copied",
            preserveSource: true,
          }),
        ),
      ).toEqual(row());

      // No attribute named toString yet: the target is free to write.
      expect(
        JSON.stringify(
          adapter.process(
            row(),
            remap({
              sourceKey: "level",
              targetKey: "toString",
              preserveSource: true,
              overrideOnConflict: false,
            }),
          )["attributes"],
        ),
      ).toBe('{"level":"error","service":"api","toString":"error"}');

      const moved: JSONObject = adapter.process(
        row(),
        remap({
          sourceKey: "level",
          targetKey: "__proto__",
          preserveSource: false,
        }),
      );

      expect(JSON.stringify(moved["attributes"])).toBe(
        '{"service":"api","__proto__":"error"}',
      );
      expect(moved["attributeKeys"]).toEqual(["service", "__proto__"]);
    });

    test("the category processor writes a target key named __proto__ as an attribute", () => {
      const output: JSONObject = adapter.process(
        row(),
        pipelinesWith([
          categoryProcessor(adapter, {
            ...categoryConfiguration(),
            targetKey: "__proto__",
          }),
        ]),
      );

      expect(JSON.stringify(output["attributes"])).toBe(
        '{"level":"error","service":"api","__proto__":"errors"}',
      );
      expect(output["attributeKeys"]).toEqual([
        "level",
        "service",
        "__proto__",
      ]);
    });

    /*
     * Issue #8025: each processor starts from a copy of the record's
     * attributes. A spread dropped a key named __proto__, so one a
     * processor wrote was gone after the next processor's copy.
     */
    test("a __proto__ attribute one processor writes is kept by every processor after it", () => {
      const output: JSONObject = adapter.process(
        row(),
        pipelinesWith([
          {
            name: "remap to __proto__",
            processorType: adapter.remapperType,
            configuration: {
              sourceKey: "level",
              targetKey: "__proto__",
              preserveSource: true,
            },
          },
          {
            name: "remap service",
            processorType: adapter.remapperType,
            configuration: {
              sourceKey: "service",
              targetKey: "owner",
              preserveSource: false,
            },
          },
          categoryProcessor(adapter, categoryConfiguration()),
          {
            name: "remap the __proto__ attribute itself",
            processorType: adapter.remapperType,
            configuration: {
              sourceKey: "__proto__",
              targetKey: "copied",
              preserveSource: true,
            },
          },
        ]),
      );
      const attributes: JSONObject = output["attributes"] as JSONObject;

      expect(JSON.stringify(attributes)).toBe(
        '{"level":"error","__proto__":"error","owner":"api","category":"errors","copied":"error"}',
      );
      expect(output["attributeKeys"]).toEqual([
        "level",
        "__proto__",
        "owner",
        "category",
        "copied",
      ]);
      expect(Object.getPrototypeOf(attributes)).toBe(Object.prototype);
    });

    test("a record's own __proto__ attribute, as JSON carries it, is kept by a processor that writes another key", () => {
      const input: JSONObject = {
        ...row(),
        attributes: JSON.parse(
          '{"level":"error","__proto__":"sent","service":"api"}',
        ) as JSONObject,
        attributeKeys: ["level", "__proto__", "service"],
      };

      const output: JSONObject = adapter.process(
        input,
        pipelinesWith([categoryProcessor(adapter, categoryConfiguration())]),
      );

      expect(
        readOwnValue(output["attributes"] as JSONObject, "__proto__"),
      ).toBe("sent");
      expect(output["attributeKeys"]).toEqual([
        "level",
        "__proto__",
        "service",
        "category",
      ]);
    });

    /*
     * Every name an object inherits - Object.prototype's own: constructor,
     * toString, valueOf, __proto__ and the rest - as the attribute
     * remapper's source and target and the category processor's target. A
     * record without that attribute has nothing to copy, and its target is
     * free. A record with it copies its own value, and keeps it when
     * overrideOnConflict is off. __proto__ too: each processor copied the
     * attributes with a spread first, which dropped a key so named (issue
     * #8025), and copies them with copyOwnValues now.
     */
    describe.each(INHERITED_PROPERTY_NAMES)(
      "an attribute named %s",
      (name: string) => {
        const remap: (configuration: JSONObject) => Array<PipelineSpec> = (
          configuration: JSONObject,
        ): Array<PipelineSpec> => {
          return pipelinesWith([
            {
              name: "remap",
              processorType: adapter.remapperType,
              configuration,
            },
          ]);
        };

        const rowWith: (value: string) => JSONObject = (
          value: string,
        ): JSONObject => {
          return {
            ...row(),
            attributes: { level: "error", service: "api", [name]: value },
            attributeKeys: ["level", "service", name],
          };
        };

        test("is copied only from a record that has it", () => {
          for (const preserveSource of [true, false]) {
            expect(
              adapter.process(
                row(),
                remap({ sourceKey: name, targetKey: "copied", preserveSource }),
              ),
            ).toEqual(row());
          }

          const moved: JSONObject = adapter.process(
            rowWith("own"),
            remap({
              sourceKey: name,
              targetKey: "copied",
              preserveSource: false,
            }),
          );

          expect(moved["attributes"]).toEqual({
            level: "error",
            service: "api",
            copied: "own",
          });
          expect(moved["attributeKeys"]).toEqual([
            "level",
            "service",
            "copied",
          ]);
        });

        test("is a free target on a record without it, and with overrideOnConflict off kept on one with it", () => {
          const written: JSONObject = adapter.process(
            row(),
            remap({
              sourceKey: "level",
              targetKey: name,
              preserveSource: true,
              overrideOnConflict: false,
            }),
          );
          const attributes: JSONObject = written["attributes"] as JSONObject;

          expect(readOwnValue(attributes, name)).toBe("error");
          expect(JSON.stringify(attributes)).toBe(
            `{"level":"error","service":"api","${name}":"error"}`,
          );
          expect(written["attributeKeys"]).toEqual(["level", "service", name]);
          expect(Object.getPrototypeOf(attributes)).toBe(Object.prototype);

          for (const [overrideOnConflict, value] of [
            [false, "kept"],
            [true, "error"],
          ] as Array<[boolean, string]>) {
            expect(
              adapter.process(
                rowWith("kept"),
                remap({
                  sourceKey: "level",
                  targetKey: name,
                  preserveSource: true,
                  overrideOnConflict,
                }),
              )["attributes"],
            ).toEqual({ level: "error", service: "api", [name]: value });
          }
        });

        test("is written by the category processor as an attribute", () => {
          const output: JSONObject = adapter.process(
            row(),
            pipelinesWith([
              categoryProcessor(adapter, {
                ...categoryConfiguration(),
                targetKey: name,
              }),
            ]),
          );

          expect(readOwnValue(output["attributes"] as JSONObject, name)).toBe(
            "errors",
          );
          expect(output["attributeKeys"]).toEqual(["level", "service", name]);
        });
      },
    );
  },
);

/*
 * The span remappers that read an attribute and compare its text with each
 * mapping: a span without the attribute is left as it is, whatever text a
 * mapping names, here the text a plain read of the name gives on a span
 * without it ("function Object() { [native code] }" for constructor,
 * "[object Object]" for __proto__). Every name an object inherits, each:
 * these remappers read the span's attributes where they are, without
 * copying them, so a span given an attribute of that name - a computed
 * key, __proto__ too - has it as its own.
 */
describe.each(INHERITED_PROPERTY_NAMES)(
  "trace remappers read only the span's own attribute named %s",
  (name: string) => {
    const INHERITED_TEXT: string = String(
      (Object.create(Object.prototype) as Record<string, unknown>)[name],
    );

    const traces: (
      processorType: TracePipelineProcessorType,
      configuration: JSONObject,
    ) => Array<LoadedTracePipeline> = (
      processorType: TracePipelineProcessorType,
      configuration: JSONObject,
    ): Array<LoadedTracePipeline> => {
      return pipelinesWith([
        { name: "remap", processorType, configuration },
      ]) as unknown as Array<LoadedTracePipeline>;
    };

    const span: (attributes: JSONObject) => JSONObject = (
      attributes: JSONObject,
    ): JSONObject => {
      return {
        name: "GET /",
        kind: "SPAN_KIND_SERVER",
        statusCode: 0,
        attributes,
        attributeKeys: Object.keys(attributes),
      };
    };

    test.each([
      [
        TracePipelineProcessorType.SpanNameRemapper,
        { newName: "renamed" },
        { name: "renamed" },
      ],
      [
        TracePipelineProcessorType.StatusRemapper,
        { statusCode: 1, statusMessage: "ok" },
        { statusCode: 1, statusMessage: "ok" },
      ],
      [
        TracePipelineProcessorType.SpanKindRemapper,
        { kind: "SPAN_KIND_CLIENT" },
        { kind: "SPAN_KIND_CLIENT" },
      ],
    ])(
      "%s maps the attribute only on a span that has one",
      (
        processorType: TracePipelineProcessorType,
        mapping: JSONObject,
        changed: JSONObject,
      ) => {
        const pipelines: Array<LoadedTracePipeline> = traces(processorType, {
          sourceKey: name,
          mappings: [
            { matchValue: "web", ...mapping },
            { matchValue: INHERITED_TEXT, ...mapping },
          ],
        });

        for (const without of [
          span({ service: "api" }),
          span({}),
          span({ [`resource.${name}`]: "web" }),
        ]) {
          expect(TracePipelineService.processSpan(without, pipelines)).toEqual(
            without,
          );
        }

        const withIt: JSONObject = span({ [name]: "web" });

        expect(TracePipelineService.processSpan(withIt, pipelines)).toEqual({
          ...withIt,
          ...changed,
        });
        // A value no mapping names leaves the span as it is.
        const unmapped: JSONObject = span({ [name]: "other" });

        expect(TracePipelineService.processSpan(unmapped, pipelines)).toEqual(
          unmapped,
        );
      },
    );
  },
);
