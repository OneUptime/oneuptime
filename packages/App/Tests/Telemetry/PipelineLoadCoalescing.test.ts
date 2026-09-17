import LogPipelineService, {
  LoadedPipeline,
} from "../../FeatureSet/Telemetry/Services/LogPipelineService";
import TracePipelineService, {
  LoadedTracePipeline,
} from "../../FeatureSet/Telemetry/Services/TracePipelineService";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import * as FilterEvaluator from "../../FeatureSet/Telemetry/Utils/LogFilterEvaluator";

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
type Pipelines = Array<LoadedPipeline> | Array<LoadedTracePipeline>;
interface Adapter {
  signal: string;
  foreignKey: string;
  load: (projectId: ObjectID) => Promise<Pipelines>;
}
const adapters: Array<Adapter> = [
  {
    signal: "logs",
    foreignKey: "logPipelineId",
    load: LogPipelineService.loadPipelines,
  },
  {
    signal: "traces",
    foreignKey: "tracePipelineId",
    load: TracePipelineService.loadPipelines,
  },
];

function pipeline(name: string): {
  _id: string;
  name: string;
  filterQuery: string;
  sortOrder: number;
} {
  return {
    _id: ObjectID.generate().toString(),
    name,
    filterQuery: "",
    sortOrder: 1,
  };
}

describe.each(adapters)(
  "$signal overlapping database loads",
  (adapter: Adapter) => {
    afterEach(() => {
      mockFindBy.mockReset();
      jest.restoreAllMocks();
    });

    test("1,000 concurrent ingests load 20 pipelines only once and share compiled filters", async () => {
      const project: ObjectID = ObjectID.generate();
      const rows: Array<ReturnType<typeof pipeline>> = Array.from(
        { length: 20 },
        (_: unknown, index: number) => {
          return pipeline(`pipeline-${index}`);
        },
      );
      const processors: Array<{ _id: string; configuration: string }> = [
        { _id: "processor", configuration: "{}" },
      ];
      mockFindBy.mockResolvedValue(processors).mockResolvedValueOnce(rows);
      const compile: jest.SpyInstance = jest.spyOn(
        FilterEvaluator,
        "compileFilter",
      );
      const results: Array<Pipelines> = await Promise.all(
        Array.from({ length: 1_000 }, () => {
          return adapter.load(new ObjectID(project.toString()));
        }),
      );
      expect(mockFindBy).toHaveBeenCalledTimes(21);
      expect(compile).toHaveBeenCalledTimes(20);
      const first: Pipelines = results[0]!;
      expect(
        first.map((item: LoadedPipeline | LoadedTracePipeline) => {
          return item.pipeline.name;
        }),
      ).toEqual(
        rows.map((item: ReturnType<typeof pipeline>) => {
          return item.name;
        }),
      );
      for (const result of results) {
        expect(result).toBe(first);
        expect(result[0]!.processors).toBe(processors);
      }
      expect(await adapter.load(project)).toBe(first);
      expect(mockFindBy).toHaveBeenCalledTimes(21);
    });

    test("preserves project scope, enabled filters, limits and database ordering", async () => {
      const project: ObjectID = ObjectID.generate();
      const row: ReturnType<typeof pipeline> = pipeline("enabled");
      mockFindBy.mockResolvedValueOnce([row]).mockResolvedValueOnce([]);
      const loaded: Pipelines = await adapter.load(project);
      expect(loaded[0]!.pipeline).toBe(row);
      expect(mockFindBy).toHaveBeenNthCalledWith(1, {
        query: { projectId: project, isEnabled: true },
        skip: 0,
        limit: LIMIT_MAX,
        sort: { sortOrder: SortOrder.Ascending },
        select: { _id: true, name: true, filterQuery: true, sortOrder: true },
        props: { isRoot: true },
      });
      expect(mockFindBy).toHaveBeenNthCalledWith(2, {
        query: { [adapter.foreignKey]: row._id, isEnabled: true },
        skip: 0,
        limit: LIMIT_MAX,
        sort: { sortOrder: SortOrder.Ascending },
        select: {
          _id: true,
          name: true,
          processorType: true,
          configuration: true,
          sortOrder: true,
        },
        props: { isRoot: true },
      });
    });

    test("a cold project with no pipelines performs one query for the whole burst", async () => {
      mockFindBy.mockResolvedValue([]);
      const project: ObjectID = ObjectID.generate();
      const results: Array<Pipelines> = await Promise.all(
        Array.from({ length: 1_000 }, () => {
          return adapter.load(project);
        }),
      );
      expect(mockFindBy).toHaveBeenCalledTimes(1);
      expect(results[0]).toEqual([]);
      for (const result of results) {
        expect(result).toBe(results[0]);
      }
      expect(await adapter.load(project)).toBe(results[0]);
      expect(mockFindBy).toHaveBeenCalledTimes(1);
    });

    test("different projects retain their own results during overlapping loads", async () => {
      const first: ObjectID = ObjectID.generate();
      const second: ObjectID = ObjectID.generate();
      const firstRow: ReturnType<typeof pipeline> = pipeline("first");
      const secondRow: ReturnType<typeof pipeline> = pipeline("second");
      mockFindBy.mockImplementation(
        async (args: { query: { projectId?: ObjectID } }) => {
          if (args.query.projectId) {
            return args.query.projectId.toString() === first.toString()
              ? [firstRow]
              : [secondRow];
          }
          return [];
        },
      );
      const results: Array<Pipelines> = await Promise.all([
        adapter.load(first),
        adapter.load(second),
        adapter.load(first),
        adapter.load(second),
      ]);
      expect(mockFindBy).toHaveBeenCalledTimes(4);
      expect(results[0]![0]!.pipeline).toBe(firstRow);
      expect(results[1]![0]!.pipeline).toBe(secondRow);
      expect(results[0]).toBe(results[2]);
      expect(results[1]).toBe(results[3]);
      expect(results[0]).not.toBe(results[1]);
    });

    test.each(["pipelines", "processors"])(
      "a failed %s query rejects every waiter and is retried",
      async (stage: string) => {
        const project: ObjectID = ObjectID.generate();
        const row: ReturnType<typeof pipeline> = pipeline("pipeline");
        const error: Error = new Error("database failure");
        if (stage === "processors") {
          mockFindBy.mockResolvedValueOnce([row]);
        }
        mockFindBy.mockRejectedValueOnce(error);
        const results: Array<PromiseSettledResult<Pipelines>> =
          await Promise.allSettled(
            Array.from({ length: 100 }, () => {
              return adapter.load(project);
            }),
          );
        for (const result of results) {
          expect(result).toEqual({ status: "rejected", reason: error });
        }
        expect(mockFindBy).toHaveBeenCalledTimes(stage === "pipelines" ? 1 : 2);
        mockFindBy
          .mockReset()
          .mockResolvedValueOnce([row])
          .mockResolvedValueOnce([]);
        const recovered: Pipelines = await adapter.load(project);
        expect(recovered[0]!.pipeline).toBe(row);
        expect(mockFindBy).toHaveBeenCalledTimes(2);
      },
    );

    test("partially loaded pipelines are never exposed when a later query fails", async () => {
      const project: ObjectID = ObjectID.generate();
      const first: ReturnType<typeof pipeline> = pipeline("first");
      const second: ReturnType<typeof pipeline> = pipeline("second");
      mockFindBy
        .mockResolvedValueOnce([first, second])
        .mockResolvedValueOnce([])
        .mockRejectedValueOnce(new Error("second failed"));
      const results: Array<PromiseSettledResult<Pipelines>> =
        await Promise.allSettled([
          adapter.load(project),
          adapter.load(project),
        ]);
      expect(
        results.map((result: PromiseSettledResult<Pipelines>) => {
          return result.status;
        }),
      ).toEqual(["rejected", "rejected"]);
      mockFindBy
        .mockReset()
        .mockResolvedValueOnce([first, second])
        .mockResolvedValue([]);
      expect(await adapter.load(project)).toHaveLength(2);
      expect(mockFindBy).toHaveBeenCalledTimes(3);
    });

    test("coalesces refresh after expiry and exposes edited configuration", async () => {
      const now: jest.SpyInstance = jest.spyOn(Date, "now").mockReturnValue(0);
      const project: ObjectID = ObjectID.generate();
      const old: ReturnType<typeof pipeline> = pipeline("old");
      const replacement: ReturnType<typeof pipeline> = pipeline("replacement");
      mockFindBy.mockResolvedValueOnce([old]).mockResolvedValueOnce([]);
      const original: Pipelines = await adapter.load(project);
      now.mockReturnValue(60_001);
      mockFindBy
        .mockReset()
        .mockResolvedValueOnce([replacement])
        .mockResolvedValueOnce([]);
      const results: Array<Pipelines> = await Promise.all(
        Array.from({ length: 1_000 }, () => {
          return adapter.load(project);
        }),
      );
      expect(mockFindBy).toHaveBeenCalledTimes(2);
      expect(results[0]).not.toBe(original);
      expect(results[0]![0]!.pipeline.name).toBe("replacement");
      expect(original[0]!.pipeline.name).toBe("old");
      for (const result of results) {
        expect(result).toBe(results[0]);
      }
    });

    test("does not resolve any waiter until the final processor query completes", async () => {
      const project: ObjectID = ObjectID.generate();
      let finish!: (value: Array<unknown>) => void;
      const processors: Promise<Array<unknown>> = new Promise(
        (resolve: (value: Array<unknown>) => void) => {
          finish = resolve;
        },
      );
      mockFindBy
        .mockResolvedValueOnce([pipeline("first"), pipeline("second")])
        .mockResolvedValueOnce([])
        .mockReturnValueOnce(processors);
      const complete: jest.Mock = jest.fn();
      const first: Promise<Pipelines> = adapter
        .load(project)
        .then((result: Pipelines) => {
          complete();
          return result;
        });
      for (let turn: number = 0; turn < 10; turn++) {
        await Promise.resolve();
      }
      const second: Promise<Pipelines> = adapter.load(project);
      expect(mockFindBy).toHaveBeenCalledTimes(3);
      expect(complete).not.toHaveBeenCalled();
      finish([]);
      const results: Array<Pipelines> = await Promise.all([first, second]);
      expect(results[0]).toHaveLength(2);
      expect(results[0]).toBe(results[1]);
    });
  },
);

test("log and trace loads for the same project never share signal configuration", async () => {
  const project: ObjectID = ObjectID.generate();
  const logs: ReturnType<typeof pipeline> = pipeline("logs");
  const traces: ReturnType<typeof pipeline> = pipeline("traces");
  mockFindBy
    .mockReset()
    .mockResolvedValueOnce([logs])
    .mockResolvedValueOnce([traces])
    .mockResolvedValue([]);
  const result: Array<Pipelines> = await Promise.all([
    LogPipelineService.loadPipelines(project),
    TracePipelineService.loadPipelines(project),
  ]);
  expect(result[0]![0]!.pipeline).toBe(logs);
  expect(result[1]![0]!.pipeline).toBe(traces);
  expect(mockFindBy).toHaveBeenCalledTimes(4);
  mockFindBy.mockReset();
});
