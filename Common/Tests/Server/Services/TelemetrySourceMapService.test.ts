import TelemetrySourceMapService, {
  MAX_SOURCE_MAPS_PER_RELEASE,
  SOURCE_MAP_RETENTION_DAYS,
  Service as TelemetrySourceMapServiceClass,
} from "../../../Server/Services/TelemetrySourceMapService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import TelemetrySourceMap from "../../../Models/DatabaseModels/TelemetrySourceMap";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { ResolveStackTraceResult } from "../../../Types/Telemetry/SourceMap";
import { afterEach, describe, expect, it, jest } from "@jest/globals";

/*
 * A minimal but real source map (see SourceMapResolver.test.ts for the
 * mapping table). Enough for resolveFramesForService to produce resolved
 * frames without any database.
 */
const FIXTURE_MAP: string = JSON.stringify({
  version: 3,
  file: "main.abc123.js",
  names: ["greet", "name", "onSelect"],
  sources: ["webpack://my-app/./src/greet.ts"],
  sourcesContent: [
    "export function greet(user) {\n  const name = user.name;\n  return `Hello, ${name}!`;\n}\n\nexport function onSelect(item) {\n  return greet(item.owner);\n}",
  ],
  mappings: "AAAgBA,oBACRC,yBAIQC,eACPF",
});

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

type MakeCreateByFunction = (
  overrides?: Partial<TelemetrySourceMap>,
) => CreateBy<TelemetrySourceMap>;

const makeCreateBy: MakeCreateByFunction = (
  overrides?: Partial<TelemetrySourceMap>,
): CreateBy<TelemetrySourceMap> => {
  const sourceMap: TelemetrySourceMap = new TelemetrySourceMap();
  sourceMap.projectId = PROJECT_ID;
  sourceMap.serviceId = SERVICE_ID;
  sourceMap.serviceVersion = "1.4.2";
  sourceMap.bundlePath = "main.abc123.js";
  sourceMap.content = FIXTURE_MAP;

  Object.assign(sourceMap, overrides || {});

  return {
    data: sourceMap,
    props: { isRoot: true },
  } as CreateBy<TelemetrySourceMap>;
};

type InvokeOnBeforeCreateFunction = (
  createBy: CreateBy<TelemetrySourceMap>,
) => Promise<void>;

/*
 * onBeforeCreate is protected; DatabaseService invokes it internally. Cast
 * through the class the way ProjectServiceDeleteAudit.test.ts reaches
 * protected hooks.
 */
const invokeOnBeforeCreate: InvokeOnBeforeCreateFunction = async (
  createBy: CreateBy<TelemetrySourceMap>,
): Promise<void> => {
  await (
    TelemetrySourceMapService as unknown as {
      onBeforeCreate: (
        createBy: CreateBy<TelemetrySourceMap>,
      ) => Promise<unknown>;
    }
  ).onBeforeCreate(createBy);
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("retention configuration", () => {
  it("registers age-based hard deletion on createdAt so the daily sweep cleans old maps", () => {
    expect(TelemetrySourceMapService.hardDeleteItemByColumnName).toBe(
      "createdAt",
    );
    expect(TelemetrySourceMapService.hardDeleteItemsOlderThanDays).toBe(
      SOURCE_MAP_RETENTION_DAYS,
    );
  });
});

describe("validateSourceMapContent", () => {
  it("accepts a source map v3 with a mappings string", () => {
    expect(() => {
      return TelemetrySourceMapServiceClass.validateSourceMapContent(
        FIXTURE_MAP,
      );
    }).not.toThrow();
  });

  it("accepts an indexed map with sections instead of mappings", () => {
    expect(() => {
      return TelemetrySourceMapServiceClass.validateSourceMapContent(
        JSON.stringify({ version: 3, sections: [] }),
      );
    }).not.toThrow();
  });

  it("rejects invalid JSON", () => {
    expect(() => {
      return TelemetrySourceMapServiceClass.validateSourceMapContent(
        "{not json",
      );
    }).toThrow(BadDataException);
  });

  it("rejects a JSON array", () => {
    expect(() => {
      return TelemetrySourceMapServiceClass.validateSourceMapContent("[1,2]");
    }).toThrow(BadDataException);
  });

  it("rejects a map that is not version 3", () => {
    expect(() => {
      return TelemetrySourceMapServiceClass.validateSourceMapContent(
        JSON.stringify({ version: 2, mappings: "AAAA" }),
      );
    }).toThrow(BadDataException);
  });

  it("rejects a version given as a string, as required by the spec", () => {
    expect(() => {
      return TelemetrySourceMapServiceClass.validateSourceMapContent(
        JSON.stringify({ version: "3", mappings: "AAAA" }),
      );
    }).toThrow(BadDataException);
  });

  it("rejects a map with neither mappings nor sections", () => {
    expect(() => {
      return TelemetrySourceMapServiceClass.validateSourceMapContent(
        JSON.stringify({ version: 3, sources: [] }),
      );
    }).toThrow(BadDataException);
  });
});

describe("onBeforeCreate", () => {
  it("stamps sizeInBytes from the content", async () => {
    const createBy: CreateBy<TelemetrySourceMap> = makeCreateBy();

    await invokeOnBeforeCreate(createBy);

    expect(createBy.data.sizeInBytes).toBe(
      Buffer.byteLength(FIXTURE_MAP, "utf8"),
    );
  });

  it("rejects a missing content", async () => {
    const createBy: CreateBy<TelemetrySourceMap> = makeCreateBy();
    delete createBy.data.content;

    await expect(invokeOnBeforeCreate(createBy)).rejects.toThrow(
      BadDataException,
    );
  });

  it("rejects invalid source map content", async () => {
    const createBy: CreateBy<TelemetrySourceMap> = makeCreateBy({
      content: "not a map",
    });

    await expect(invokeOnBeforeCreate(createBy)).rejects.toThrow(
      BadDataException,
    );
  });

  it("rejects a missing bundle path", async () => {
    const createBy: CreateBy<TelemetrySourceMap> = makeCreateBy({
      bundlePath: "   ",
    });

    await expect(invokeOnBeforeCreate(createBy)).rejects.toThrow(
      BadDataException,
    );
  });

  it("rejects a missing service version", async () => {
    const createBy: CreateBy<TelemetrySourceMap> = makeCreateBy({
      serviceVersion: "",
    });

    await expect(invokeOnBeforeCreate(createBy)).rejects.toThrow(
      BadDataException,
    );
  });
});

describe("replaceSourceMap", () => {
  it("hard deletes existing rows for the same bundle before creating the new one", async () => {
    const callOrder: Array<string> = [];

    const hardDeleteSpy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(TelemetrySourceMapService, "hardDeleteBy")
      .mockImplementation(async () => {
        callOrder.push("hardDeleteBy");
        return 1;
      });

    const created: TelemetrySourceMap = new TelemetrySourceMap();
    const createSpy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(TelemetrySourceMapService, "create")
      .mockImplementation(async () => {
        callOrder.push("create");
        return created;
      });

    const result: TelemetrySourceMap =
      await TelemetrySourceMapService.replaceSourceMap({
        projectId: PROJECT_ID,
        serviceId: SERVICE_ID,
        serviceVersion: "1.4.2",
        bundlePath: "main.abc123.js",
        content: FIXTURE_MAP,
      });

    expect(result).toBe(created);
    expect(callOrder).toEqual(["hardDeleteBy", "create"]);

    // The delete targets exactly the (project, service, release, bundle) tuple.
    const deleteArgs: {
      query: Record<string, unknown>;
      props: Record<string, unknown>;
    } = hardDeleteSpy.mock.calls[0]![0] as never;
    expect(deleteArgs.query["projectId"]).toBe(PROJECT_ID);
    expect(deleteArgs.query["serviceId"]).toBe(SERVICE_ID);
    expect(deleteArgs.query["serviceVersion"]).toBe("1.4.2");
    expect(deleteArgs.query["bundlePath"]).toBe("main.abc123.js");
    expect(deleteArgs.props["isRoot"]).toBe(true);

    // The created row carries the same tuple plus the content.
    const createArgs: { data: TelemetrySourceMap } = createSpy.mock
      .calls[0]![0] as never;
    expect(createArgs.data.projectId).toBe(PROJECT_ID);
    expect(createArgs.data.serviceId).toBe(SERVICE_ID);
    expect(createArgs.data.serviceVersion).toBe("1.4.2");
    expect(createArgs.data.bundlePath).toBe("main.abc123.js");
    expect(createArgs.data.content).toBe(FIXTURE_MAP);
  });
});

describe("resolveFramesForService", () => {
  type MakeRowFunction = (
    bundlePath: string,
    content: string,
  ) => TelemetrySourceMap;

  const makeRow: MakeRowFunction = (
    bundlePath: string,
    content: string,
  ): TelemetrySourceMap => {
    const row: TelemetrySourceMap = new TelemetrySourceMap();
    row.bundlePath = bundlePath;
    row.content = content;
    return row;
  };

  it("resolves frames against the maps stored for the (service, release) pair", async () => {
    const findBySpy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(TelemetrySourceMapService, "findBy")
      .mockResolvedValue([makeRow("main.abc123.js", FIXTURE_MAP)] as never);

    const result: ResolveStackTraceResult =
      await TelemetrySourceMapService.resolveFramesForService({
        projectId: PROJECT_ID,
        serviceId: SERVICE_ID,
        serviceVersion: "1.4.2",
        frames: [
          {
            functionName: "e.onSelect",
            fileName: "https://app.example.com/assets/main.abc123.js",
            lineNumber: 1,
            columnNumber: 46,
            inApp: true,
          },
        ],
      });

    expect(result.sourceMapCount).toBe(1);
    expect(result.resolvedCount).toBe(1);
    expect(result.frames[0]!.resolved).toBe(true);
    expect(result.frames[0]!.originalFileName).toBe("src/greet.ts");
    expect(result.frames[0]!.originalFunctionName).toBe("onSelect");

    // The lookup is scoped to the exact tenant + service + release.
    const findArgs: { query: Record<string, unknown>; limit: number } =
      findBySpy.mock.calls[0]![0] as never;
    expect(findArgs.query["projectId"]).toBe(PROJECT_ID);
    expect(findArgs.query["serviceId"]).toBe(SERVICE_ID);
    expect(findArgs.query["serviceVersion"]).toBe("1.4.2");
    expect(findArgs.limit).toBe(MAX_SOURCE_MAPS_PER_RELEASE);
  });

  it("dedupes bundles by normalized path, first (newest) row winning", async () => {
    const emptyNamesMap: string = JSON.stringify({
      ...JSON.parse(FIXTURE_MAP),
      names: ["newest", "newest", "newest"],
    });

    jest.spyOn(TelemetrySourceMapService, "findBy").mockResolvedValue([
      // Sorted newest first by the service; same bundle appears twice.
      makeRow("main.abc123.js", emptyNamesMap),
      makeRow("/main.abc123.js", FIXTURE_MAP),
    ] as never);

    const result: ResolveStackTraceResult =
      await TelemetrySourceMapService.resolveFramesForService({
        projectId: PROJECT_ID,
        serviceId: SERVICE_ID,
        serviceVersion: "1.4.2",
        frames: [
          {
            functionName: "e.onSelect",
            fileName: "main.abc123.js",
            lineNumber: 1,
            columnNumber: 46,
            inApp: true,
          },
        ],
      });

    expect(result.sourceMapCount).toBe(1);
    expect(result.frames[0]!.originalFunctionName).toBe("newest");
  });

  it("returns unresolved frames without querying when the release is empty", async () => {
    const findBySpy: ReturnType<typeof jest.spyOn> = jest.spyOn(
      TelemetrySourceMapService,
      "findBy",
    );

    const result: ResolveStackTraceResult =
      await TelemetrySourceMapService.resolveFramesForService({
        projectId: PROJECT_ID,
        serviceId: SERVICE_ID,
        serviceVersion: "",
        frames: [
          {
            functionName: "fn",
            fileName: "main.js",
            lineNumber: 1,
            columnNumber: 1,
            inApp: true,
          },
        ],
      });

    expect(findBySpy).not.toHaveBeenCalled();
    expect(result.sourceMapCount).toBe(0);
    expect(result.resolvedCount).toBe(0);
    expect(result.frames).toHaveLength(1);
    expect(result.frames[0]!.resolved).toBe(false);
  });

  it("returns unresolved frames when no maps exist for the release", async () => {
    jest
      .spyOn(TelemetrySourceMapService, "findBy")
      .mockResolvedValue([] as never);

    const result: ResolveStackTraceResult =
      await TelemetrySourceMapService.resolveFramesForService({
        projectId: PROJECT_ID,
        serviceId: SERVICE_ID,
        serviceVersion: "9.9.9",
        frames: [
          {
            functionName: "fn",
            fileName: "main.js",
            lineNumber: 1,
            columnNumber: 1,
            inApp: true,
          },
        ],
      });

    expect(result.sourceMapCount).toBe(0);
    expect(result.resolvedCount).toBe(0);
    expect(result.frames[0]!.resolved).toBe(false);
  });
});
