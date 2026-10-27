/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it (DatabaseService, the base class of
 * every concrete service, imports it). Nothing password-related is under
 * test here, so the module is replaced WITH A FACTORY — an automock would
 * still require (and type-check) the real file.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/Logger");

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import { SpanStatusCode } from "@opentelemetry/api";
import { ReadableSpan } from "@opentelemetry/sdk-trace-base";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import OTelIngestService, {
  TelemetryServiceMetadata,
} from "../../../Server/Services/OpenTelemetryIngestService";
import HostService from "../../../Server/Services/HostService";
import ProjectService from "../../../Server/Services/ProjectService";
import Telemetry from "../../../Server/Utils/Telemetry";
import Host from "../../../Models/DatabaseModels/Host";
import Project from "../../../Models/DatabaseModels/Project";
import ObjectID from "../../../Types/ObjectID";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import {
  clearExportedSpans,
  getExportedSpanNames,
  getExportedSpans,
  inRequestSpan,
  startExportingSpans,
  stopExportingSpans,
} from "../../Helpers/ExportedSpans";
import {
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "../Enterprise/FakeEnterpriseModule";

/*
 * A MEMOIZED RETENTION LOOKUP IS TRACED ONLY WHEN IT MISSES.
 *
 * Every resource block of a telemetry job builds its rows' retention from
 * the project's retention context and the resource's own override. Both are
 * memoized in the process, and 99.6% of the project lookups in sampled job
 * traces returned from that memo in under 50 µs - each with a span of its
 * own, as did buildResourceMetadataForNonService around them. Now a memo hit
 * creates no span, and a miss - a Valkey read, a Postgres read - still does,
 * under the name the lookup's span always had.
 *
 * Every test uses fresh ids, so the module-level memos cannot carry an
 * answer from one test into another.
 */

const PROJECT_SPAN: string = "OTelIngestService.getProjectRetentionContext";
const RESOURCE_SPAN: string = "OTelIngestService.getResourceRetention";

function build(data: {
  projectId: ObjectID;
  resourceId: ObjectID;
}): Promise<TelemetryServiceMetadata> {
  return OTelIngestService.buildResourceMetadataForNonService({
    serviceName: "host/web-1",
    resourceId: data.resourceId,
    primaryEntityType: ServiceType.Host,
    projectId: data.projectId,
  });
}

function exportedSpan(name: string): ReadableSpan {
  const span: ReadableSpan | undefined = getExportedSpans().find(
    (candidate: ReadableSpan): boolean => {
      return candidate.name === name;
    },
  );
  expect(span).toBeDefined();
  return span!;
}

/*
 * A resource's own retention applies only while the Enterprise feature is
 * active, so the suite runs as a licensed Enterprise Edition: the values
 * show which lookup answered.
 */
beforeAll(() => {
  installFakeEnterpriseModule();
  startExportingSpans();
});

afterAll(() => {
  stopExportingSpans();
  uninstallEnterpriseModule();
});

beforeEach(() => {
  clearExportedSpans();
  jest.spyOn(Telemetry, "isSpanExportEnabled").mockReturnValue(true);

  // Valkey knows no project: the context is read from Postgres.
  jest.spyOn(GlobalCache, "getJSONObject").mockResolvedValue(null);
  jest.spyOn(GlobalCache, "setJSON").mockResolvedValue(undefined);
  jest.spyOn(ProjectService, "findOneById").mockResolvedValue({
    defaultTelemetryRetentionInDays: 20,
    telemetryRetentionConfig: null,
  } as unknown as Project);
  jest.spyOn(HostService, "findOneById").mockResolvedValue({
    retainTelemetryDataForDays: 40,
    telemetryRetentionConfig: null,
  } as unknown as Host);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("retention lookups that hit their memo", () => {
  test("create no span, and neither does the metadata built from them", async () => {
    const projectId: ObjectID = ObjectID.generate();
    const resourceId: ObjectID = ObjectID.generate();
    await build({ projectId, resourceId });
    clearExportedSpans();

    const metadata: TelemetryServiceMetadata = await inRequestSpan(() => {
      return build({ projectId, resourceId });
    });

    expect(getExportedSpanNames()).toEqual(["request"]);
    expect(metadata.projectRetentionInDays).toBe(20);
    expect(metadata.serviceRetentionInDays).toBe(40);
  });
});

describe("retention lookups that miss their memo", () => {
  test("each keep their span, as children of the request", async () => {
    const metadata: TelemetryServiceMetadata = await inRequestSpan(() => {
      return build({
        projectId: ObjectID.generate(),
        resourceId: ObjectID.generate(),
      });
    });

    expect(getExportedSpanNames()).toEqual([
      PROJECT_SPAN,
      RESOURCE_SPAN,
      "request",
    ]);
    const request: ReadableSpan = exportedSpan("request");
    for (const name of [PROJECT_SPAN, RESOURCE_SPAN]) {
      expect(exportedSpan(name).parentSpanContext?.spanId).toBe(
        request.spanContext().spanId,
      );
    }
    expect(metadata.projectRetentionInDays).toBe(20);
    expect(metadata.serviceRetentionInDays).toBe(40);
  });

  test("a project context found in Valkey is still a lookup with a span", async () => {
    jest.spyOn(GlobalCache, "getJSONObject").mockResolvedValue({
      projectRetentionConfig: null,
      projectRetentionInDays: 25,
    });
    const projectId: ObjectID = ObjectID.generate();
    const resourceId: ObjectID = ObjectID.generate();
    await build({ projectId, resourceId: ObjectID.generate() });
    clearExportedSpans();
    // The project's context is memoized now; only the resource misses.

    await inRequestSpan(() => {
      return build({ projectId, resourceId });
    });

    expect(getExportedSpanNames()).toEqual([RESOURCE_SPAN, "request"]);

    clearExportedSpans();
    const fresh: TelemetryServiceMetadata = await inRequestSpan(() => {
      return build({ projectId: ObjectID.generate(), resourceId });
    });

    expect(getExportedSpanNames()).toEqual([PROJECT_SPAN, "request"]);
    expect(fresh.projectRetentionInDays).toBe(25);
    expect(ProjectService.findOneById).not.toHaveBeenCalled();
  });

  test("a resource lookup that fails keeps its span, marked OK as before, and falls back to no override", async () => {
    const projectId: ObjectID = ObjectID.generate();
    await build({ projectId, resourceId: ObjectID.generate() });
    clearExportedSpans();
    jest
      .spyOn(HostService, "findOneById")
      .mockRejectedValue(new Error("Postgres said no"));

    const metadata: TelemetryServiceMetadata = await inRequestSpan(() => {
      return build({ projectId, resourceId: ObjectID.generate() });
    });

    expect(getExportedSpanNames()).toEqual([RESOURCE_SPAN, "request"]);
    expect(exportedSpan(RESOURCE_SPAN).status.code).toBe(SpanStatusCode.OK);
    expect(metadata.serviceRetentionInDays).toBeNull();
    expect(metadata.dataRententionInDays).toBe(20);
  });
});
