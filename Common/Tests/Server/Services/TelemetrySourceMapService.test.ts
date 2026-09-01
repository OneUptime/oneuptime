/*
 * The per-release ceiling used to be a hardcoded 100 that also bounded what
 * resolveFramesForService would READ. This suite pins the two apart:
 *
 *   - the ceiling is an operator knob (SOURCE_MAP_MAX_MAPS_PER_RELEASE) that
 *     gates WRITES, enforced on the create path itself;
 *   - the read path bounds itself by BYTES loaded
 *     (SOURCE_MAP_MAX_BYTES_PER_RESOLVE), so a release that fits the write
 *     gate always resolves in full.
 *
 * SourceMapMaxBytesPerResolve is read at call time, so a getter over the real
 * config lets a case pick a budget measured in tens of bytes while every
 * other value stays production-real. bytesPerResolve === null means "use the
 * configured value", which is what every non-budget case runs with.
 */
const mockResolveBudget: { bytesPerResolve: number | null } = {
  bytesPerResolve: null,
};

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actualConfig: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  const mockedConfig: Record<string, unknown> = { ...actualConfig };

  Object.defineProperty(mockedConfig, "SourceMapMaxBytesPerResolve", {
    configurable: true,
    enumerable: true,
    get: (): number => {
      return (
        mockResolveBudget.bytesPerResolve ??
        (actualConfig["SourceMapMaxBytesPerResolve"] as number)
      );
    },
  });

  return mockedConfig;
});

import TelemetrySourceMapService, {
  MAX_SOURCE_MAP_SIZE_IN_BYTES,
  MAX_SOURCE_MAPS_PER_RELEASE,
  SOURCE_MAP_RETENTION_DAYS,
} from "../../../Server/Services/TelemetrySourceMapService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import TelemetrySourceMap from "../../../Models/DatabaseModels/TelemetrySourceMap";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import logger from "../../../Server/Utils/Logger";
import { MAX_FRAMES_TO_RESOLVE } from "../../../Server/Utils/Telemetry/SourceMapResolver";
import {
  SourceMapMaxMapsPerRelease,
  SourceMapRetentionInDays,
} from "../../../Server/EnvironmentConfig";
import {
  MinifiedStackFrame,
  ResolveStackTraceResult,
} from "../../../Types/Telemetry/SourceMap";
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

type CaptureOnBeforeCreateRejectionFunction = (
  createBy: CreateBy<TelemetrySourceMap>,
) => Promise<Error>;

/*
 * The rejection itself, not just its type: the per-release message has to
 * name the knob an operator would raise, so the message is asserted on.
 */
const captureOnBeforeCreateRejection: CaptureOnBeforeCreateRejectionFunction =
  async (createBy: CreateBy<TelemetrySourceMap>): Promise<Error> => {
    try {
      await invokeOnBeforeCreate(createBy);
    } catch (err) {
      return err as Error;
    }

    throw new Error("Expected onBeforeCreate to reject, but it resolved.");
  };

type MakeRowFunction = (
  bundlePath: string,
  content?: string,
) => TelemetrySourceMap;

const makeRow: MakeRowFunction = (
  bundlePath: string,
  content?: string,
): TelemetrySourceMap => {
  const row: TelemetrySourceMap = new TelemetrySourceMap();
  row._id = ObjectID.generate().toString();
  row.bundlePath = bundlePath;
  if (content !== undefined) {
    row.content = content;
  }
  return row;
};

type MakeListingRowFunction = (data: {
  bundlePath: string;
  sizeInBytes?: number | null | undefined;
  createdAt?: Date | undefined;
}) => TelemetrySourceMap;

/*
 * A row as the resolver's FIRST findBy returns it: no content, but the two
 * columns the byte budget reads — the stored size, and the timestamp that
 * breaks ties between maps that match a frame equally well.
 */
const makeListingRow: MakeListingRowFunction = (data: {
  bundlePath: string;
  sizeInBytes?: number | null | undefined;
  createdAt?: Date | undefined;
}): TelemetrySourceMap => {
  const row: TelemetrySourceMap = makeRow(data.bundlePath);

  if (data.sizeInBytes !== undefined) {
    /*
     * Widened deliberately: the column is typed number, but a row written
     * outside the create hook can hold null or a nonsense count, and the
     * budget has to charge those something.
     */
    (row as unknown as { sizeInBytes: number | null | undefined }).sizeInBytes =
      data.sizeInBytes;
  }

  if (data.createdAt) {
    row.createdAt = data.createdAt;
  }

  return row;
};

type MakeFrameFunction = (fileName: string) => MinifiedStackFrame;

/*
 * A frame that the fixture map can actually resolve (line 1, column 46 maps
 * to onSelect), so "did this map get loaded" and "did this frame resolve" are
 * the same question.
 */
const makeFrame: MakeFrameFunction = (fileName: string): MinifiedStackFrame => {
  return {
    functionName: "e.onSelect",
    fileName: fileName,
    lineNumber: 1,
    columnNumber: 46,
    inApp: true,
  };
};

type FindBySpy = ReturnType<typeof jest.spyOn>;

type ContentFetchArgsFunction = (findBySpy: FindBySpy) => {
  query: Record<string, unknown>;
  limit: number;
};

/** Arguments of the SECOND findBy — the content fetch. */
const contentFetchArgs: ContentFetchArgsFunction = (
  findBySpy: FindBySpy,
): { query: Record<string, unknown>; limit: number } => {
  return findBySpy.mock.calls[1]![0] as never;
};

type RequestedContentIdsFunction = (findBySpy: FindBySpy) => Array<string>;

/*
 * The ids the content fetch actually asked for. QueryHelper.any produces a
 * TypeORM Raw operator whose parameters object holds the id list under a
 * random key, so it is dug out rather than compared structurally.
 */
const requestedContentIds: RequestedContentIdsFunction = (
  findBySpy: FindBySpy,
): Array<string> => {
  const idOperator: { objectLiteralParameters?: Record<string, unknown> } =
    contentFetchArgs(findBySpy).query["_id"] as never;

  const idList: Array<unknown> = Object.values(
    idOperator.objectLiteralParameters || {},
  )[0] as Array<unknown>;

  return idList.map((id: unknown) => {
    return String(id);
  });
};

type MockReleaseRowCountFunction = (count: number) => FindBySpy;

const mockReleaseRowCount: MockReleaseRowCountFunction = (
  count: number,
): FindBySpy => {
  return jest
    .spyOn(TelemetrySourceMapService, "countBy")
    .mockResolvedValue(new PositiveNumber(count) as never);
};

type MockStoredBundlePathsFunction = (bundlePaths: Array<string>) => FindBySpy;

const mockStoredBundlePaths: MockStoredBundlePathsFunction = (
  bundlePaths: Array<string>,
): FindBySpy => {
  return jest
    .spyOn(TelemetrySourceMapService, "getStoredBundlePathsForRelease")
    .mockResolvedValue(bundlePaths as never);
};

type MakeBundlePathsFunction = (count: number) => Array<string>;

const makeBundlePaths: MakeBundlePathsFunction = (
  count: number,
): Array<string> => {
  const bundlePaths: Array<string> = [];

  for (let index: number = 0; index < count; index++) {
    bundlePaths.push(`chunk-${index}.js`);
  }

  return bundlePaths;
};

/*
 * One frame, three stored bundles that match it at three different strengths.
 * The score is the number of trailing path segments the frame and the bundle
 * share, so "x/y/main.abc123.js" (3) beats "y/main.abc123.js" (2) beats
 * "main.abc123.js" (1). That ordering is what the byte budget spends: when
 * not everything fits, the weakest match is what goes.
 */
const SCORED_FRAME_FILE_NAME: string =
  "https://cdn.example.com/x/y/main.abc123.js";
const STRONG_MATCH_PATH: string = "x/y/main.abc123.js";
const MEDIUM_MATCH_PATH: string = "y/main.abc123.js";
const WEAK_MATCH_PATH: string = "main.abc123.js";

afterEach(() => {
  jest.restoreAllMocks();
  mockResolveBudget.bytesPerResolve = null;
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

  it("drives retention from the SOURCE_MAP_RETENTION_DAYS knob rather than a literal", () => {
    /*
     * The service must not re-declare the number. If the constant ever drifts
     * from the config, an operator who sets SOURCE_MAP_RETENTION_DAYS gets a
     * sweep interval they did not ask for — silently, since nothing else
     * reports the effective value.
     */
    expect(SOURCE_MAP_RETENTION_DAYS).toBe(SourceMapRetentionInDays);
    expect(TelemetrySourceMapService.hardDeleteItemsOlderThanDays).toBe(
      SourceMapRetentionInDays,
    );
  });

  it("drives the per-release ceiling from the SOURCE_MAP_MAX_MAPS_PER_RELEASE knob", () => {
    expect(MAX_SOURCE_MAPS_PER_RELEASE).toBe(SourceMapMaxMapsPerRelease);
  });

  /*
   * The two assertions above are only as strong as the environment they run
   * in: with nothing configured, SourceMapRetentionInDays IS 90 and
   * SourceMapMaxMapsPerRelease IS 1000, so a service that went back to
   * hardcoding those two literals would satisfy both of them and every other
   * case in this file.
   *
   * The only way to tell "reads the knob" from "happens to equal the knob's
   * default" is to configure something the defaults are not, and re-enter the
   * module — both constants are evaluated once, at import, and
   * hardDeleteItemsOlderThanDays is stamped from one of them in the
   * constructor, so a fresh registry is what it takes to observe them at all.
   */
  it("picks up configured values rather than the defaults it happens to match", async () => {
    const originalEnv: NodeJS.ProcessEnv = { ...process.env };

    // Two numbers no default in this system is, so neither can coincide.
    process.env["SOURCE_MAP_MAX_MAPS_PER_RELEASE"] = "4242";
    process.env["SOURCE_MAP_RETENTION_DAYS"] = "17";

    try {
      /*
       * resetModules rather than isolateModules: the mock factory reaches for
       * the real EnvironmentConfig with requireActual, and an isolated
       * registry still serves that from the copy loaded when this file was
       * imported — so the module would come back holding the defaults and the
       * case would prove nothing. This is the same reload the config suite
       * uses.
       */
      jest.resetModules();

      /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
      const reloaded: {
        default: { hardDeleteItemsOlderThanDays: number };
        MAX_SOURCE_MAPS_PER_RELEASE: number;
        SOURCE_MAP_RETENTION_DAYS: number;
      } = require("../../../Server/Services/TelemetrySourceMapService");
      /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */

      expect(reloaded.MAX_SOURCE_MAPS_PER_RELEASE).toBe(4242);
      expect(reloaded.SOURCE_MAP_RETENTION_DAYS).toBe(17);
      /*
       * And the configured retention reaches the sweep the worker actually
       * reads, not just the exported constant.
       */
      expect(reloaded.default.hardDeleteItemsOlderThanDays).toBe(17);
    } finally {
      process.env = originalEnv;
      /*
       * Leave the registry as it was found. Every other case in this file
       * works against the singleton captured by the imports at the top, which
       * this does not disturb.
       */
      jest.resetModules();
    }
  });
});

describe("onBeforeCreate", () => {
  it("stamps sizeInBytes from the content", async () => {
    /*
     * Every create that survives validation now counts the release's rows, so
     * the count is mocked here rather than reaching a database that no unit
     * test connects to.
     */
    mockReleaseRowCount(0);

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

  it("rejects content over the size ceiling", async () => {
    /*
     * A valid JSON envelope padded past 50 MB. The padding is a single
     * string field so JSON.parse never runs (the size check comes first)
     * — this stays fast.
     */
    const oversized: string = `{"version":3,"mappings":"AAAA","pad":"${"x".repeat(
      MAX_SOURCE_MAP_SIZE_IN_BYTES,
    )}"}`;

    const createBy: CreateBy<TelemetrySourceMap> = makeCreateBy({
      content: oversized,
    });

    await expect(invokeOnBeforeCreate(createBy)).rejects.toThrow(
      BadDataException,
    );
  });

  it("rejects invalid source map content (delegates to the canonical validator)", async () => {
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

/*
 * The per-release ceiling on the create path.
 *
 * The upload endpoint checks a whole batch up front, but TelemetrySourceMap
 * is a full CRUD resource: POST /api/telemetry-source-map reaches create()
 * without ever passing that check, so without this hook the configured
 * ceiling was advisory on that path.
 */
describe("onBeforeCreate per-release ceiling", () => {
  it("counts the release's rows scoped to the tenant, service and version, as root", async () => {
    const countBySpy: FindBySpy = mockReleaseRowCount(0);

    await invokeOnBeforeCreate(makeCreateBy());

    const countArgs: {
      query: Record<string, unknown>;
      props: Record<string, unknown>;
      skip: number;
      limit: number;
    } = countBySpy.mock.calls[0]![0] as never;

    expect(countArgs.query["projectId"]).toBe(PROJECT_ID);
    expect(countArgs.query["serviceId"]).toBe(SERVICE_ID);
    expect(countArgs.query["serviceVersion"]).toBe("1.4.2");
    expect(countArgs.skip).toBe(0);
    expect(countArgs.limit).toBe(LIMIT_MAX);
    // The hook runs inside create, before permissions are re-derived.
    expect(countArgs.props["isRoot"]).toBe(true);
  });

  it("admits a create one map under the ceiling without paying for the distinct-bundle listing", async () => {
    mockReleaseRowCount(MAX_SOURCE_MAPS_PER_RELEASE - 1);
    const bundlePathsSpy: FindBySpy = mockStoredBundlePaths([]);

    const createBy: CreateBy<TelemetrySourceMap> = makeCreateBy();

    await invokeOnBeforeCreate(createBy);

    /*
     * Below the ceiling there is nothing to decide, whatever the rows hold —
     * so the second, more expensive query must not run. This is what keeps a
     * bulk upload paying one indexed COUNT per insert and no more.
     */
    expect(bundlePathsSpy).not.toHaveBeenCalled();
    expect(createBy.data.sizeInBytes).toBe(
      Buffer.byteLength(FIXTURE_MAP, "utf8"),
    );
  });

  it("rejects a new bundle when the release already holds the ceiling in distinct bundles", async () => {
    mockReleaseRowCount(MAX_SOURCE_MAPS_PER_RELEASE);
    mockStoredBundlePaths(makeBundlePaths(MAX_SOURCE_MAPS_PER_RELEASE));

    const createBy: CreateBy<TelemetrySourceMap> = makeCreateBy({
      bundlePath: "brand-new-chunk.js",
    });

    const error: Error = await captureOnBeforeCreateRejection(createBy);

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toContain(
      `limit of ${MAX_SOURCE_MAPS_PER_RELEASE} per release`,
    );
    /*
     * The message has to name the knob: the only fix a self-hosted operator
     * has for a full release is raising it (or deleting maps), and nothing
     * else in the response says what it is called.
     */
    expect(error.message).toContain("SOURCE_MAP_MAX_MAPS_PER_RELEASE");
  });

  it("rejects a new bundle when the release is already above the ceiling", async () => {
    const overCeiling: number = MAX_SOURCE_MAPS_PER_RELEASE + 7;

    mockReleaseRowCount(overCeiling);
    mockStoredBundlePaths(makeBundlePaths(overCeiling));

    const createBy: CreateBy<TelemetrySourceMap> = makeCreateBy({
      bundlePath: "brand-new-chunk.js",
    });

    const error: Error = await captureOnBeforeCreateRejection(createBy);

    expect(error).toBeInstanceOf(BadDataException);
    expect(error.message).toContain("SOURCE_MAP_MAX_MAPS_PER_RELEASE");
  });

  it("refuses the full release before stamping sizeInBytes, so nothing half-processed is handed on", async () => {
    mockReleaseRowCount(MAX_SOURCE_MAPS_PER_RELEASE);
    mockStoredBundlePaths(makeBundlePaths(MAX_SOURCE_MAPS_PER_RELEASE));

    const createBy: CreateBy<TelemetrySourceMap> = makeCreateBy({
      bundlePath: "brand-new-chunk.js",
    });

    await captureOnBeforeCreateRejection(createBy);

    expect(createBy.data.sizeInBytes).toBeUndefined();
  });

  it("still admits a re-upload of a bundle the release already holds when it is at the ceiling", async () => {
    /*
     * A CI re-run replaces every bundle of a release. Rejecting a path the
     * release already contains would fail that re-run outright, even though
     * it does not grow the release by a single bundle.
     */
    mockReleaseRowCount(MAX_SOURCE_MAPS_PER_RELEASE);
    mockStoredBundlePaths(makeBundlePaths(MAX_SOURCE_MAPS_PER_RELEASE));

    const createBy: CreateBy<TelemetrySourceMap> = makeCreateBy({
      bundlePath: "chunk-0.js",
    });

    await invokeOnBeforeCreate(createBy);

    expect(createBy.data.sizeInBytes).toBe(
      Buffer.byteLength(FIXTURE_MAP, "utf8"),
    );
  });

  it("compares the incoming bundle against stored paths after normalization", async () => {
    /*
     * "/main.abc123.js" and "main.abc123.js" are the same bundle to the
     * resolver, so they must be the same bundle to the gate too — otherwise a
     * release at the ceiling rejects a re-upload purely over a leading slash.
     */
    mockReleaseRowCount(MAX_SOURCE_MAPS_PER_RELEASE);
    mockStoredBundlePaths([
      "/main.abc123.js",
      ...makeBundlePaths(MAX_SOURCE_MAPS_PER_RELEASE - 1),
    ]);

    const createBy: CreateBy<TelemetrySourceMap> = makeCreateBy({
      bundlePath: "main.abc123.js",
    });

    await invokeOnBeforeCreate(createBy);

    expect(createBy.data.sizeInBytes).toBe(
      Buffer.byteLength(FIXTURE_MAP, "utf8"),
    );
  });

  it("admits a new bundle when duplicate rows, not distinct bundles, reached the row count", async () => {
    /*
     * The model deliberately allows more than one row per bundle (a racing
     * double upload must not fail CI). Rejecting on the ROW count alone would
     * therefore refuse a legitimate new bundle purely because a duplicate row
     * exists somewhere in the release — the ceiling counts distinct bundles.
     */
    mockReleaseRowCount(MAX_SOURCE_MAPS_PER_RELEASE);
    mockStoredBundlePaths([
      ...makeBundlePaths(MAX_SOURCE_MAPS_PER_RELEASE - 1),
      "chunk-0.js",
    ]);

    const createBy: CreateBy<TelemetrySourceMap> = makeCreateBy({
      bundlePath: "brand-new-chunk.js",
    });

    await invokeOnBeforeCreate(createBy);

    expect(createBy.data.sizeInBytes).toBe(
      Buffer.byteLength(FIXTURE_MAP, "utf8"),
    );
  });

  it("falls back to the tenant on props when the row itself carries no projectId", async () => {
    /*
     * A tenant-scoped create leaves projectId to the tenant column, so the
     * gate has to read props.tenantId — otherwise the whole check silently
     * no-ops on exactly the path most creates take.
     */
    const countBySpy: FindBySpy = mockReleaseRowCount(0);

    const createBy: CreateBy<TelemetrySourceMap> = makeCreateBy();
    delete createBy.data.projectId;
    createBy.props.tenantId = PROJECT_ID;

    await invokeOnBeforeCreate(createBy);

    const countArgs: { query: Record<string, unknown> } = countBySpy.mock
      .calls[0]![0] as never;
    expect(countArgs.query["projectId"]).toBe(PROJECT_ID);
  });

  it("does not count when the create can be scoped to no project at all", async () => {
    const countBySpy: FindBySpy = mockReleaseRowCount(0);

    const createBy: CreateBy<TelemetrySourceMap> = makeCreateBy();
    delete createBy.data.projectId;

    await invokeOnBeforeCreate(createBy);

    /*
     * Not a silent pass: the tenant column check rejects this create on its
     * own, with a better message than a count could give.
     */
    expect(countBySpy).not.toHaveBeenCalled();
  });

  it("does not count when the create carries no serviceId", async () => {
    const countBySpy: FindBySpy = mockReleaseRowCount(0);

    const createBy: CreateBy<TelemetrySourceMap> = makeCreateBy();
    delete createBy.data.serviceId;

    await invokeOnBeforeCreate(createBy);

    expect(countBySpy).not.toHaveBeenCalled();
  });

  it("does not count when the release version is missing, because validation rejects first", async () => {
    const countBySpy: FindBySpy = mockReleaseRowCount(0);

    const createBy: CreateBy<TelemetrySourceMap> = makeCreateBy({
      serviceVersion: "",
    });

    await expect(invokeOnBeforeCreate(createBy)).rejects.toThrow(
      BadDataException,
    );
    expect(countBySpy).not.toHaveBeenCalled();
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

describe("getStoredBundlePathsForRelease", () => {
  it("returns the bundle paths for the release, scoped to the tenant", async () => {
    const findBySpy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(TelemetrySourceMapService, "findBy")
      .mockResolvedValue([
        makeRow("main.abc123.js"),
        makeRow("vendor.9c3d4e.js"),
        makeRow(""),
      ] as never);

    const bundlePaths: Array<string> =
      await TelemetrySourceMapService.getStoredBundlePathsForRelease({
        projectId: PROJECT_ID,
        serviceId: SERVICE_ID,
        serviceVersion: "1.4.2",
      });

    expect(bundlePaths).toEqual(["main.abc123.js", "vendor.9c3d4e.js"]);

    const findArgs: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
    } = findBySpy.mock.calls[0]![0] as never;
    expect(findArgs.query["projectId"]).toBe(PROJECT_ID);
    expect(findArgs.query["serviceId"]).toBe(SERVICE_ID);
    expect(findArgs.query["serviceVersion"]).toBe("1.4.2");
    // Cheap listing — content must not be selected.
    expect(findArgs.select["content"]).toBeUndefined();
  });
});

describe("resolveFramesForService", () => {
  it("resolves frames against the maps stored for the (service, release) pair", async () => {
    const listRow: TelemetrySourceMap = makeRow("main.abc123.js");

    const findBySpy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(TelemetrySourceMapService, "findBy")
      // First call: bundle path listing (no content).
      .mockResolvedValueOnce([listRow] as never)
      // Second call: content for matched bundles only.
      .mockResolvedValueOnce([makeRow("main.abc123.js", FIXTURE_MAP)] as never);

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

    // The listing is scoped to the exact tenant + service + release.
    const listArgs: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
      limit: number;
    } = findBySpy.mock.calls[0]![0] as never;
    expect(listArgs.query["projectId"]).toBe(PROJECT_ID);
    expect(listArgs.query["serviceId"]).toBe(SERVICE_ID);
    expect(listArgs.query["serviceVersion"]).toBe("1.4.2");
    /*
     * LIMIT_MAX, deliberately NOT the per-release ceiling. The ceiling counts
     * distinct bundle PATHS while a read limit counts ROWS; tying the read to
     * it made duplicate rows push real bundles out of resolution (see the
     * duplicate-row case below). Memory is bounded by the byte budget now.
     */
    expect(listArgs.limit).toBe(LIMIT_MAX);
    // The listing must not pull content.
    expect(listArgs.select["content"]).toBeUndefined();
    /*
     * It must pull the size, though: the byte budget charges each candidate
     * its stored size, and a listing that did not select the column would
     * charge every row the per-map ceiling instead.
     */
    expect(listArgs.select["sizeInBytes"]).toBe(true);
    expect(listArgs.select["createdAt"]).toBe(true);
    expect(listArgs.select["bundlePath"]).toBe(true);

    // The content fetch stays tenant-scoped too.
    const contentArgs: {
      query: Record<string, unknown>;
      select: Record<string, unknown>;
    } = findBySpy.mock.calls[1]![0] as never;
    expect(contentArgs.query["projectId"]).toBe(PROJECT_ID);
    expect(contentArgs.select["content"]).toBe(true);
  });

  it("fetches content only for bundles that at least one frame matches", async () => {
    const matchedRow: TelemetrySourceMap = makeRow("main.abc123.js");
    const unmatchedRow: TelemetrySourceMap = makeRow("admin.f00baa.js");

    const findBySpy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(TelemetrySourceMapService, "findBy")
      .mockResolvedValueOnce([matchedRow, unmatchedRow] as never)
      .mockResolvedValueOnce([makeRow("main.abc123.js", FIXTURE_MAP)] as never);

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

    // Both stored maps are reported, but only the matched one was loaded.
    expect(result.sourceMapCount).toBe(2);
    expect(result.frames[0]!.resolved).toBe(true);

    /*
     * QueryHelper.any produces a TypeORM Raw operator whose parameters
     * object holds the id list under a random key.
     */
    const contentArgs: { query: Record<string, unknown> } = findBySpy.mock
      .calls[1]![0] as never;
    const idOperator: { objectLiteralParameters?: Record<string, unknown> } =
      contentArgs.query["_id"] as never;
    const idList: Array<unknown> = Object.values(
      idOperator.objectLiteralParameters || {},
    )[0] as Array<unknown>;
    expect(idList).toHaveLength(1);
    expect(String(idList[0])).toBe(matchedRow.id!.toString());
  });

  it("asks the content fetch for exactly as many rows as it selected", async () => {
    /*
     * The content limit used to be the per-release ceiling, which asked the
     * database for room for a thousand rows to fetch two. It is the size of
     * the selected set now, so the query cannot return more than was chosen.
     */
    const findBySpy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(TelemetrySourceMapService, "findBy")
      .mockResolvedValueOnce([
        makeListingRow({ bundlePath: STRONG_MATCH_PATH, sizeInBytes: 100 }),
        makeListingRow({ bundlePath: WEAK_MATCH_PATH, sizeInBytes: 100 }),
        makeListingRow({ bundlePath: "admin.f00baa.js", sizeInBytes: 100 }),
      ] as never)
      .mockResolvedValueOnce([
        makeRow(STRONG_MATCH_PATH, FIXTURE_MAP),
        makeRow(WEAK_MATCH_PATH, FIXTURE_MAP),
      ] as never);

    const result: ResolveStackTraceResult =
      await TelemetrySourceMapService.resolveFramesForService({
        projectId: PROJECT_ID,
        serviceId: SERVICE_ID,
        serviceVersion: "1.4.2",
        frames: [makeFrame(SCORED_FRAME_FILE_NAME)],
      });

    expect(result.sourceMapCount).toBe(3);
    expect(requestedContentIds(findBySpy)).toHaveLength(2);
    expect(contentFetchArgs(findBySpy).limit).toBe(2);
  });

  it("skips the content fetch entirely when no stored bundle matches any frame", async () => {
    const findBySpy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(TelemetrySourceMapService, "findBy")
      .mockResolvedValueOnce([makeRow("admin.f00baa.js")] as never);

    const result: ResolveStackTraceResult =
      await TelemetrySourceMapService.resolveFramesForService({
        projectId: PROJECT_ID,
        serviceId: SERVICE_ID,
        serviceVersion: "1.4.2",
        frames: [
          {
            functionName: "fn",
            fileName: "main.abc123.js",
            lineNumber: 1,
            columnNumber: 1,
            inApp: true,
          },
        ],
      });

    expect(findBySpy).toHaveBeenCalledTimes(1);
    expect(result.sourceMapCount).toBe(1);
    expect(result.resolvedCount).toBe(0);
    expect(result.frames[0]!.resolved).toBe(false);
  });

  it("dedupes bundles by normalized path, first (newest) row winning", async () => {
    const newestNamesMap: string = JSON.stringify({
      ...JSON.parse(FIXTURE_MAP),
      names: ["newest", "newest", "newest"],
    });

    const newestRow: TelemetrySourceMap = makeRow("main.abc123.js");
    const olderDuplicateRow: TelemetrySourceMap = makeRow("/main.abc123.js");

    jest
      .spyOn(TelemetrySourceMapService, "findBy")
      // Sorted newest first by the service; same bundle appears twice.
      .mockResolvedValueOnce([newestRow, olderDuplicateRow] as never)
      .mockResolvedValueOnce([
        makeRow("main.abc123.js", newestNamesMap),
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

  it("still resolves the last distinct bundle of a full release when a duplicate row exists", async () => {
    /*
     * THE REGRESSION THIS FIXES.
     *
     * A release holding the maximum number of distinct bundles, plus one
     * duplicate row of an early bundle — which the model allows, because a
     * racing double upload must not fail CI. That is one row MORE than the
     * per-release ceiling.
     *
     * The listing used to read with limit = MAX_SOURCE_MAPS_PER_RELEASE, so
     * the duplicate consumed the slot of the last distinct bundle: the map
     * uploaded fine, showed in the dashboard, and then silently never
     * resolved, with nothing anywhere saying why. The listing reads LIMIT_MAX
     * and dedupes afterwards now, so a release that fits the write gate is
     * fully reachable however many duplicate rows it accumulated.
     *
     * The findBy mock honours the limit it is handed, exactly as the database
     * would — otherwise this case would pass under the old code too.
     */
    const listingRows: Array<TelemetrySourceMap> = [];

    for (let index: number = 0; index < MAX_SOURCE_MAPS_PER_RELEASE; index++) {
      listingRows.push(
        makeListingRow({ bundlePath: `chunk-${index}.js`, sizeInBytes: 1024 }),
      );

      if (index === 0) {
        // The duplicate row, newest-first next to the bundle it duplicates.
        listingRows.push(
          makeListingRow({ bundlePath: "chunk-0.js", sizeInBytes: 1024 }),
        );
      }
    }

    const lastDistinctBundlePath: string = `chunk-${
      MAX_SOURCE_MAPS_PER_RELEASE - 1
    }.js`;
    const lastDistinctRow: TelemetrySourceMap =
      listingRows[listingRows.length - 1]!;

    expect(listingRows).toHaveLength(MAX_SOURCE_MAPS_PER_RELEASE + 1);
    expect(lastDistinctRow.bundlePath).toBe(lastDistinctBundlePath);

    const findBySpy: ReturnType<typeof jest.spyOn> = jest.spyOn(
      TelemetrySourceMapService,
      "findBy",
    );

    findBySpy.mockImplementationOnce((async (listQuery: {
      limit: number;
      skip: number;
    }): Promise<Array<TelemetrySourceMap>> => {
      return listingRows.slice(
        listQuery.skip,
        listQuery.skip + listQuery.limit,
      );
    }) as never);

    findBySpy.mockResolvedValueOnce([
      makeRow(lastDistinctBundlePath, FIXTURE_MAP),
    ] as never);

    const result: ResolveStackTraceResult =
      await TelemetrySourceMapService.resolveFramesForService({
        projectId: PROJECT_ID,
        serviceId: SERVICE_ID,
        serviceVersion: "1.4.2",
        frames: [makeFrame(lastDistinctBundlePath)],
      });

    // The duplicate collapsed away, leaving every distinct bundle listed.
    expect(result.sourceMapCount).toBe(MAX_SOURCE_MAPS_PER_RELEASE);
    expect(requestedContentIds(findBySpy)).toEqual([
      lastDistinctRow.id!.toString(),
    ]);
    expect(result.resolvedCount).toBe(1);
    expect(result.frames[0]!.resolved).toBe(true);
    expect(result.frames[0]!.originalFunctionName).toBe("onSelect");
    expect(result.sourceMapsSkippedForSize).toBe(0);
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
    /*
     * Zero, never undefined: the field is required on the response, and the
     * dashboard reads it to decide whether to tell the user that symbols are
     * missing for a reason an operator can fix.
     */
    expect(result.sourceMapsSkippedForSize).toBe(0);
  });

  it("returns nothing skipped when there are no frames to resolve", async () => {
    const findBySpy: ReturnType<typeof jest.spyOn> = jest.spyOn(
      TelemetrySourceMapService,
      "findBy",
    );

    const result: ResolveStackTraceResult =
      await TelemetrySourceMapService.resolveFramesForService({
        projectId: PROJECT_ID,
        serviceId: SERVICE_ID,
        serviceVersion: "1.4.2",
        frames: [],
      });

    expect(findBySpy).not.toHaveBeenCalled();
    expect(result.frames).toHaveLength(0);
    expect(result.sourceMapCount).toBe(0);
    expect(result.sourceMapsSkippedForSize).toBe(0);
  });

  it("returns unresolved frames when no maps exist for the release", async () => {
    jest
      .spyOn(TelemetrySourceMapService, "findBy")
      .mockResolvedValueOnce([] as never);

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

/*
 * The byte budget: the bound that used to be implied by the per-release
 * count, and a far tighter one, because it measures the thing that actually
 * consumes memory. Resolution materialises whole maps (up to 50 MB each) and
 * the set it loads is chosen by a caller-supplied frames array.
 */
describe("resolveFramesForService byte budget", () => {
  it("loads every matching map when the whole matched set fits", async () => {
    const warnSpy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(logger, "warn")
      .mockImplementation((): void => {});

    mockResolveBudget.bytesPerResolve = 1024 * 1024;

    const strongRow: TelemetrySourceMap = makeListingRow({
      bundlePath: STRONG_MATCH_PATH,
      sizeInBytes: 100,
    });
    const mediumRow: TelemetrySourceMap = makeListingRow({
      bundlePath: MEDIUM_MATCH_PATH,
      sizeInBytes: 100,
    });
    const weakRow: TelemetrySourceMap = makeListingRow({
      bundlePath: WEAK_MATCH_PATH,
      sizeInBytes: 100,
    });

    const findBySpy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(TelemetrySourceMapService, "findBy")
      .mockResolvedValueOnce([strongRow, mediumRow, weakRow] as never)
      .mockResolvedValueOnce([
        makeRow(STRONG_MATCH_PATH, FIXTURE_MAP),
      ] as never);

    const result: ResolveStackTraceResult =
      await TelemetrySourceMapService.resolveFramesForService({
        projectId: PROJECT_ID,
        serviceId: SERVICE_ID,
        serviceVersion: "1.4.2",
        frames: [makeFrame(SCORED_FRAME_FILE_NAME)],
      });

    expect(requestedContentIds(findBySpy).sort()).toEqual(
      [
        strongRow.id!.toString(),
        mediumRow.id!.toString(),
        weakRow.id!.toString(),
      ].sort(),
    );
    expect(contentFetchArgs(findBySpy).limit).toBe(3);
    expect(result.sourceMapsSkippedForSize).toBe(0);
    // Nothing was dropped, so there is nothing for an operator to hear about.
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("skips the maps that do not fit and reports them on the response", async () => {
    const warnSpy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(logger, "warn")
      .mockImplementation((): void => {});

    // Room for two of the three 100-byte maps.
    mockResolveBudget.bytesPerResolve = 250;

    const strongRow: TelemetrySourceMap = makeListingRow({
      bundlePath: STRONG_MATCH_PATH,
      sizeInBytes: 100,
    });
    const mediumRow: TelemetrySourceMap = makeListingRow({
      bundlePath: MEDIUM_MATCH_PATH,
      sizeInBytes: 100,
    });
    const weakRow: TelemetrySourceMap = makeListingRow({
      bundlePath: WEAK_MATCH_PATH,
      sizeInBytes: 100,
    });

    const findBySpy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(TelemetrySourceMapService, "findBy")
      .mockResolvedValueOnce([strongRow, mediumRow, weakRow] as never)
      .mockResolvedValueOnce([
        makeRow(STRONG_MATCH_PATH, FIXTURE_MAP),
      ] as never);

    const result: ResolveStackTraceResult =
      await TelemetrySourceMapService.resolveFramesForService({
        projectId: PROJECT_ID,
        serviceId: SERVICE_ID,
        serviceVersion: "1.4.2",
        frames: [makeFrame(SCORED_FRAME_FILE_NAME)],
      });

    expect(requestedContentIds(findBySpy).sort()).toEqual(
      [strongRow.id!.toString(), mediumRow.id!.toString()].sort(),
    );
    expect(contentFetchArgs(findBySpy).limit).toBe(2);
    /*
     * The count is the whole point of the field: a half-resolved stack trace
     * looks identical to "the maps were never uploaded" without it.
     */
    expect(result.sourceMapsSkippedForSize).toBe(1);

    // One warning for the whole request, naming the knob that would fix it.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]![0])).toContain(
      "SOURCE_MAP_MAX_BYTES_PER_RESOLVE",
    );
  });

  it("keeps the best-matching map and drops the weakest when only one fits", async () => {
    /*
     * What gets dropped must be the weakest match, not an arbitrary row —
     * that is what makes a budget defensible at all. The frame shares three
     * trailing segments with the strong bundle and one with the weak one.
     */
    mockResolveBudget.bytesPerResolve = 100;

    const strongRow: TelemetrySourceMap = makeListingRow({
      bundlePath: STRONG_MATCH_PATH,
      sizeInBytes: 100,
    });
    const mediumRow: TelemetrySourceMap = makeListingRow({
      bundlePath: MEDIUM_MATCH_PATH,
      sizeInBytes: 100,
    });
    const weakRow: TelemetrySourceMap = makeListingRow({
      bundlePath: WEAK_MATCH_PATH,
      sizeInBytes: 100,
    });

    const findBySpy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(TelemetrySourceMapService, "findBy")
      // Listed weakest-first, so only the score can explain the choice.
      .mockResolvedValueOnce([weakRow, mediumRow, strongRow] as never)
      .mockResolvedValueOnce([
        makeRow(STRONG_MATCH_PATH, FIXTURE_MAP),
      ] as never);

    const result: ResolveStackTraceResult =
      await TelemetrySourceMapService.resolveFramesForService({
        projectId: PROJECT_ID,
        serviceId: SERVICE_ID,
        serviceVersion: "1.4.2",
        frames: [makeFrame(SCORED_FRAME_FILE_NAME)],
      });

    expect(requestedContentIds(findBySpy)).toEqual([strongRow.id!.toString()]);
    expect(result.sourceMapsSkippedForSize).toBe(2);
    // The one map that was worth loading still resolved the frame.
    expect(result.resolvedCount).toBe(1);
  });

  it("still fits a smaller lower-scoring map after skipping a big one", async () => {
    /*
     * The budget loop continues rather than breaking. One oversized map in
     * the middle of the ranking must not cost the rest of the stack trace its
     * symbols — a break here would drop the small map that still fits.
     */
    mockResolveBudget.bytesPerResolve = 1000;

    const strongRow: TelemetrySourceMap = makeListingRow({
      bundlePath: STRONG_MATCH_PATH,
      sizeInBytes: 100,
    });
    const oversizedMediumRow: TelemetrySourceMap = makeListingRow({
      bundlePath: MEDIUM_MATCH_PATH,
      sizeInBytes: 5000,
    });
    const smallWeakRow: TelemetrySourceMap = makeListingRow({
      bundlePath: WEAK_MATCH_PATH,
      sizeInBytes: 50,
    });

    const findBySpy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(TelemetrySourceMapService, "findBy")
      .mockResolvedValueOnce([
        strongRow,
        oversizedMediumRow,
        smallWeakRow,
      ] as never)
      .mockResolvedValueOnce([
        makeRow(STRONG_MATCH_PATH, FIXTURE_MAP),
        makeRow(WEAK_MATCH_PATH, FIXTURE_MAP),
      ] as never);

    const result: ResolveStackTraceResult =
      await TelemetrySourceMapService.resolveFramesForService({
        projectId: PROJECT_ID,
        serviceId: SERVICE_ID,
        serviceVersion: "1.4.2",
        frames: [makeFrame(SCORED_FRAME_FILE_NAME)],
      });

    expect(requestedContentIds(findBySpy).sort()).toEqual(
      [strongRow.id!.toString(), smallWeakRow.id!.toString()].sort(),
    );
    expect(contentFetchArgs(findBySpy).limit).toBe(2);
    expect(result.sourceMapsSkippedForSize).toBe(1);
  });

  it("attempts the single best map even when it alone exceeds the budget", async () => {
    /*
     * A budget configured below the per-map ceiling should degrade to "one
     * map at a time", not to "nothing ever resolves". Peak memory is
     * therefore max(budget, one map) — bounded either way.
     */
    mockResolveBudget.bytesPerResolve = 10;

    const strongRow: TelemetrySourceMap = makeListingRow({
      bundlePath: STRONG_MATCH_PATH,
      sizeInBytes: 5000,
    });

    const findBySpy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(TelemetrySourceMapService, "findBy")
      .mockResolvedValueOnce([strongRow] as never)
      .mockResolvedValueOnce([
        makeRow(STRONG_MATCH_PATH, FIXTURE_MAP),
      ] as never);

    const result: ResolveStackTraceResult =
      await TelemetrySourceMapService.resolveFramesForService({
        projectId: PROJECT_ID,
        serviceId: SERVICE_ID,
        serviceVersion: "1.4.2",
        frames: [makeFrame(SCORED_FRAME_FILE_NAME)],
      });

    expect(requestedContentIds(findBySpy)).toEqual([strongRow.id!.toString()]);
    // It was loaded, not skipped: nothing to report and nothing to warn about.
    expect(result.sourceMapsSkippedForSize).toBe(0);
    expect(result.resolvedCount).toBe(1);
  });

  it("skips everything after the over-budget best map, having already spent the budget", async () => {
    mockResolveBudget.bytesPerResolve = 10;

    const strongRow: TelemetrySourceMap = makeListingRow({
      bundlePath: STRONG_MATCH_PATH,
      sizeInBytes: 5000,
    });
    const tinyWeakRow: TelemetrySourceMap = makeListingRow({
      bundlePath: WEAK_MATCH_PATH,
      sizeInBytes: 5,
    });

    const findBySpy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(TelemetrySourceMapService, "findBy")
      .mockResolvedValueOnce([strongRow, tinyWeakRow] as never)
      .mockResolvedValueOnce([
        makeRow(STRONG_MATCH_PATH, FIXTURE_MAP),
      ] as never);

    const result: ResolveStackTraceResult =
      await TelemetrySourceMapService.resolveFramesForService({
        projectId: PROJECT_ID,
        serviceId: SERVICE_ID,
        serviceVersion: "1.4.2",
        frames: [makeFrame(SCORED_FRAME_FILE_NAME)],
      });

    expect(requestedContentIds(findBySpy)).toEqual([strongRow.id!.toString()]);
    expect(result.sourceMapsSkippedForSize).toBe(1);
  });

  it("loads a map that lands exactly on the budget", async () => {
    // Boundary: the check is "over budget", not "at budget".
    mockResolveBudget.bytesPerResolve = 200;

    const strongRow: TelemetrySourceMap = makeListingRow({
      bundlePath: STRONG_MATCH_PATH,
      sizeInBytes: 100,
    });
    const weakRow: TelemetrySourceMap = makeListingRow({
      bundlePath: WEAK_MATCH_PATH,
      sizeInBytes: 100,
    });

    const findBySpy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(TelemetrySourceMapService, "findBy")
      .mockResolvedValueOnce([strongRow, weakRow] as never)
      .mockResolvedValueOnce([
        makeRow(STRONG_MATCH_PATH, FIXTURE_MAP),
        makeRow(WEAK_MATCH_PATH, FIXTURE_MAP),
      ] as never);

    const result: ResolveStackTraceResult =
      await TelemetrySourceMapService.resolveFramesForService({
        projectId: PROJECT_ID,
        serviceId: SERVICE_ID,
        serviceVersion: "1.4.2",
        frames: [makeFrame(SCORED_FRAME_FILE_NAME)],
      });

    expect(requestedContentIds(findBySpy)).toHaveLength(2);
    expect(result.sourceMapsSkippedForSize).toBe(0);
  });

  it("skips a map that lands one byte over the budget", async () => {
    mockResolveBudget.bytesPerResolve = 199;

    const strongRow: TelemetrySourceMap = makeListingRow({
      bundlePath: STRONG_MATCH_PATH,
      sizeInBytes: 100,
    });
    const weakRow: TelemetrySourceMap = makeListingRow({
      bundlePath: WEAK_MATCH_PATH,
      sizeInBytes: 100,
    });

    const findBySpy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(TelemetrySourceMapService, "findBy")
      .mockResolvedValueOnce([strongRow, weakRow] as never)
      .mockResolvedValueOnce([
        makeRow(STRONG_MATCH_PATH, FIXTURE_MAP),
      ] as never);

    const result: ResolveStackTraceResult =
      await TelemetrySourceMapService.resolveFramesForService({
        projectId: PROJECT_ID,
        serviceId: SERVICE_ID,
        serviceVersion: "1.4.2",
        frames: [makeFrame(SCORED_FRAME_FILE_NAME)],
      });

    expect(requestedContentIds(findBySpy)).toEqual([strongRow.id!.toString()]);
    expect(result.sourceMapsSkippedForSize).toBe(1);
  });

  it("prefers the newer upload when two maps match equally well and only one fits", async () => {
    /*
     * Same match quality, so the tie-break decides — and it is the same
     * newest-wins rule the dedupe uses, rather than whatever order the rows
     * happened to arrive in.
     */
    mockResolveBudget.bytesPerResolve = 100;

    const olderRow: TelemetrySourceMap = makeListingRow({
      bundlePath: "a.abc123.js",
      sizeInBytes: 100,
      createdAt: new Date("2024-01-01T00:00:00.000Z"),
    });
    const newerRow: TelemetrySourceMap = makeListingRow({
      bundlePath: "b.abc123.js",
      sizeInBytes: 100,
      createdAt: new Date("2024-06-01T00:00:00.000Z"),
    });

    const findBySpy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(TelemetrySourceMapService, "findBy")
      .mockResolvedValueOnce([olderRow, newerRow] as never)
      .mockResolvedValueOnce([makeRow("b.abc123.js", FIXTURE_MAP)] as never);

    const result: ResolveStackTraceResult =
      await TelemetrySourceMapService.resolveFramesForService({
        projectId: PROJECT_ID,
        serviceId: SERVICE_ID,
        serviceVersion: "1.4.2",
        frames: [makeFrame("a.abc123.js"), makeFrame("b.abc123.js")],
      });

    expect(requestedContentIds(findBySpy)).toEqual([newerRow.id!.toString()]);
    expect(result.sourceMapsSkippedForSize).toBe(1);
  });

  /*
   * Every shape of "no usable size" a row can carry. onBeforeCreate stamps
   * sizeInBytes on every insert, so these belong to rows written straight to
   * the database — and an unknown size must not become the way to slip past a
   * budget that exists to bound memory. Each is charged the per-map ceiling.
   */
  const UNKNOWN_SIZE_CASES: Array<{
    label: string;
    sizeInBytes: number | null | undefined;
  }> = [
    { label: "undefined", sizeInBytes: undefined },
    { label: "null", sizeInBytes: null },
    { label: "zero", sizeInBytes: 0 },
    { label: "NaN", sizeInBytes: Number.NaN },
    { label: "negative", sizeInBytes: -1 },
  ];

  for (const unknownSizeCase of UNKNOWN_SIZE_CASES) {
    it(`charges a row whose sizeInBytes is ${unknownSizeCase.label} the per-map ceiling, not zero`, async () => {
      mockResolveBudget.bytesPerResolve = 1000;

      const strongRow: TelemetrySourceMap = makeListingRow({
        bundlePath: STRONG_MATCH_PATH,
        sizeInBytes: 100,
      });
      const unknownSizeRow: TelemetrySourceMap = makeListingRow({
        bundlePath: MEDIUM_MATCH_PATH,
        sizeInBytes: unknownSizeCase.sizeInBytes,
      });

      const findBySpy: ReturnType<typeof jest.spyOn> = jest
        .spyOn(TelemetrySourceMapService, "findBy")
        .mockResolvedValueOnce([strongRow, unknownSizeRow] as never)
        .mockResolvedValueOnce([
          makeRow(STRONG_MATCH_PATH, FIXTURE_MAP),
        ] as never);

      const result: ResolveStackTraceResult =
        await TelemetrySourceMapService.resolveFramesForService({
          projectId: PROJECT_ID,
          serviceId: SERVICE_ID,
          serviceVersion: "1.4.2",
          frames: [makeFrame(SCORED_FRAME_FILE_NAME)],
        });

      /*
       * Charged 50 MB against a 1000-byte budget, so it cannot fit — where a
       * zero charge would have let it through unmetered.
       */
      expect(requestedContentIds(findBySpy)).toEqual([
        strongRow.id!.toString(),
      ]);
      expect(result.sourceMapsSkippedForSize).toBe(1);
    });
  }

  it("still loads an unknown-size map when the budget can absorb the per-map ceiling", async () => {
    /*
     * The ceiling is a charge, not a ban: a budget with room for a
     * worst-case map still loads a row whose size was never stamped.
     */
    mockResolveBudget.bytesPerResolve = MAX_SOURCE_MAP_SIZE_IN_BYTES + 100;

    const strongRow: TelemetrySourceMap = makeListingRow({
      bundlePath: STRONG_MATCH_PATH,
      sizeInBytes: 100,
    });
    const unknownSizeRow: TelemetrySourceMap = makeListingRow({
      bundlePath: MEDIUM_MATCH_PATH,
      sizeInBytes: undefined,
    });

    const findBySpy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(TelemetrySourceMapService, "findBy")
      .mockResolvedValueOnce([strongRow, unknownSizeRow] as never)
      .mockResolvedValueOnce([
        makeRow(STRONG_MATCH_PATH, FIXTURE_MAP),
        makeRow(MEDIUM_MATCH_PATH, FIXTURE_MAP),
      ] as never);

    const result: ResolveStackTraceResult =
      await TelemetrySourceMapService.resolveFramesForService({
        projectId: PROJECT_ID,
        serviceId: SERVICE_ID,
        serviceVersion: "1.4.2",
        frames: [makeFrame(SCORED_FRAME_FILE_NAME)],
      });

    expect(requestedContentIds(findBySpy).sort()).toEqual(
      [strongRow.id!.toString(), unknownSizeRow.id!.toString()].sort(),
    );
    expect(result.sourceMapsSkippedForSize).toBe(0);
  });
});

/*
 * Only the frames resolveFrames will actually attempt can pull a map in. The
 * frames array is parsed from client-supplied stack trace text, so matching
 * against all of it would let a caller drive an O(rows x frames) scan and
 * select maps that could never be used anyway.
 */
describe("resolveFramesForService frame budget", () => {
  it("loads a map for a bundle referenced by the last resolvable frame", async () => {
    const frames: Array<MinifiedStackFrame> = [];

    for (let index: number = 0; index < MAX_FRAMES_TO_RESOLVE - 1; index++) {
      frames.push(makeFrame("unrelated-chunk.js"));
    }

    // The 500th frame — the last one resolveFrames will attempt.
    frames.push(makeFrame("main.abc123.js"));
    expect(frames).toHaveLength(MAX_FRAMES_TO_RESOLVE);

    const listRow: TelemetrySourceMap = makeListingRow({
      bundlePath: "main.abc123.js",
      sizeInBytes: 100,
    });

    const findBySpy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(TelemetrySourceMapService, "findBy")
      .mockResolvedValueOnce([listRow] as never)
      .mockResolvedValueOnce([makeRow("main.abc123.js", FIXTURE_MAP)] as never);

    const result: ResolveStackTraceResult =
      await TelemetrySourceMapService.resolveFramesForService({
        projectId: PROJECT_ID,
        serviceId: SERVICE_ID,
        serviceVersion: "1.4.2",
        frames: frames,
      });

    expect(requestedContentIds(findBySpy)).toEqual([listRow.id!.toString()]);
    expect(result.resolvedCount).toBe(1);
    expect(result.frames[MAX_FRAMES_TO_RESOLVE - 1]!.resolved).toBe(true);
  });

  it("does not load a map for a bundle referenced only past the frame budget", async () => {
    const frames: Array<MinifiedStackFrame> = [];

    for (let index: number = 0; index < MAX_FRAMES_TO_RESOLVE; index++) {
      frames.push(makeFrame("unrelated-chunk.js"));
    }

    /*
     * The 501st frame. Its bundle IS stored — but the frame is past what
     * resolveFrames will attempt, so loading its map would spend the budget
     * on symbols that can never be handed back.
     */
    frames.push(makeFrame("main.abc123.js"));

    const findBySpy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(TelemetrySourceMapService, "findBy")
      .mockResolvedValueOnce([
        makeListingRow({ bundlePath: "main.abc123.js", sizeInBytes: 100 }),
      ] as never);

    const result: ResolveStackTraceResult =
      await TelemetrySourceMapService.resolveFramesForService({
        projectId: PROJECT_ID,
        serviceId: SERVICE_ID,
        serviceVersion: "1.4.2",
        frames: frames,
      });

    // No content fetch at all: nothing matched a frame that counts.
    expect(findBySpy).toHaveBeenCalledTimes(1);
    expect(result.sourceMapCount).toBe(1);
    expect(result.resolvedCount).toBe(0);
    expect(result.sourceMapsSkippedForSize).toBe(0);

    /*
     * One output frame per input frame regardless — the dashboard overlay
     * discards length-mismatched responses wholesale.
     */
    expect(result.frames).toHaveLength(MAX_FRAMES_TO_RESOLVE + 1);
    expect(result.frames[MAX_FRAMES_TO_RESOLVE]!.resolved).toBe(false);
  });
});
