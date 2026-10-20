import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import Span from "../../../../Models/AnalyticsModels/Span";
import SpanService from "../../../../Server/Services/SpanService";
import ServiceService from "../../../../Server/Services/ServiceService";
import TraceAggregationService, {
  ServiceLatencyProfile,
  ServiceLatencyProfileRow,
} from "../../../../Server/Services/TraceAggregationService";
import ModelPermission from "../../../../Server/Types/AnalyticsDatabase/ModelPermission";
import TraceLatencyRegressionDetector from "../../../../Server/Utils/AI/SRE/Insights/Detectors/TraceLatencyRegressionDetector";
import { InsightCandidate } from "../../../../Server/Utils/AI/SRE/Insights/Types";
import {
  GetTraceTool,
  QueryTracesTool,
} from "../../../../Server/Utils/AI/Toolbox/TraceTools";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import LlmConversationPrivacy from "../../../../Server/Utils/LlmObservability/LlmConversationPrivacy";
import TelemetryReadScopeUtil from "../../../../Server/Utils/Telemetry/TelemetryReadScope";
import { AIChatWidgetSpan } from "../../../../Types/AI/AIChatTypes";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";

/*
 * WHAT ONEUPTIME READS ON ITS OWN LEAVES A COMPANY AI TOOL'S PRIVATE CHATS
 * OUT.
 *
 * A company AI tool's chats (Claude Enterprise, Microsoft 365 Copilot) are
 * read by project owners and admins only, by default. A person's read is
 * held to that by the permission layer (LlmConversationPrivacy.test.ts).
 * Two reads OneUptime makes on its own run as root, which that layer leaves
 * alone, and write what they find where everyone on the project reads it:
 *
 *   - an automatic AI investigation (props { isRoot, tenantId }, as
 *     AIInvestigationEngine passes them), whose tools read spans and whose
 *     answer lands on the incident or alert;
 *   - the trace latency insight scan, whose insights everyone reads.
 *
 * Both leave the private chat services out themselves.
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const CHAT_SERVICE: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const APP_SERVICE: string = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const NOW: Date = new Date("2026-10-20T12:00:00.000Z");

// What AIInvestigationEngine hands the tools.
function systemRun(): ToolContext {
  return {
    projectId: PROJECT,
    props: { isRoot: true, tenantId: PROJECT },
  };
}

function personRun(): ToolContext {
  const userId: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");

  return {
    projectId: PROJECT,
    props: {
      tenantId: PROJECT,
      userId: userId,
      userTenantAccessPermission: {
        [PROJECT.toString()]: {
          _type: "UserTenantAccessPermission",
          projectId: PROJECT,
          permissions: [
            {
              _type: "UserPermission",
              permission: Permission.ProjectMember,
              labelIds: [],
              isBlockPermission: false,
            },
          ],
        },
      },
    },
  };
}

function span(input: {
  spanId: string;
  parentSpanId?: string;
  name: string;
  serviceId?: string;
  startMs: number;
}): Span {
  return {
    spanId: input.spanId,
    parentSpanId: input.parentSpanId || "",
    name: input.name,
    startTimeUnixNano: input.startMs * 1_000_000,
    durationUnixNano: 20 * 1_000_000,
    statusCode: 0,
    kind: "SPAN_KIND_CLIENT",
    ...(input.serviceId
      ? { primaryEntityId: new ObjectID(input.serviceId) }
      : {}),
  } as unknown as Span;
}

let restrictedSpy: jest.SpyInstance;

beforeEach(() => {
  restrictedSpy = jest
    .spyOn(LlmConversationPrivacy, "getRestrictedServiceIds")
    .mockResolvedValue([CHAT_SERVICE]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function idsOf(list: unknown): Array<string> {
  return ((list as Array<ObjectID> | undefined) || []).map(
    (id: ObjectID): string => {
      return id.toString();
    },
  );
}

describe("An automatic AI investigation's trace analytics", () => {
  test("leave the private chat services out of the aggregation", async () => {
    const table: jest.SpyInstance = jest
      .spyOn(TraceAggregationService, "getAnalyticsTable")
      .mockResolvedValue([]);

    await QueryTracesTool.execute({ groupBy: "primaryEntityId" }, systemRun());

    expect(restrictedSpy).toHaveBeenCalledWith(PROJECT);
    expect(table).toHaveBeenCalledTimes(1);
    const request: Record<string, unknown> = table.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(request["projectId"]).toEqual(PROJECT);
    expect(idsOf(request["excludedServiceIds"])).toEqual([CHAT_SERVICE]);
  });

  test("and a private chat service the investigation names matches nothing", async () => {
    const table: jest.SpyInstance = jest
      .spyOn(TraceAggregationService, "getAnalyticsTable")
      .mockResolvedValue([]);

    await QueryTracesTool.execute({ serviceId: CHAT_SERVICE }, systemRun());

    const request: Record<string, unknown> = table.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(idsOf(request["serviceIds"])).toEqual([
      ObjectID.getZeroObjectID().toString(),
    ]);
  });

  test("a person's run is held by the permission layer, not asked again here", async () => {
    jest.spyOn(ModelPermission, "getReadScope").mockResolvedValue({
      readableIds: null,
      blockedIds: [CHAT_SERVICE],
    });
    const table: jest.SpyInstance = jest
      .spyOn(TraceAggregationService, "getAnalyticsTable")
      .mockResolvedValue([]);

    await QueryTracesTool.execute({}, personRun());

    expect(restrictedSpy).not.toHaveBeenCalled();
    const request: Record<string, unknown> = table.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(idsOf(request["excludedServiceIds"])).toEqual([CHAT_SERVICE]);
  });

  test("an owner's run, which may read them, is left as the permission layer reads it", async () => {
    jest
      .spyOn(ModelPermission, "getReadScope")
      .mockResolvedValue(TelemetryReadScopeUtil.getUnrestrictedScope());
    const table: jest.SpyInstance = jest
      .spyOn(TraceAggregationService, "getAnalyticsTable")
      .mockResolvedValue([]);

    await QueryTracesTool.execute({}, personRun());

    const request: Record<string, unknown> = table.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(request["excludedServiceIds"]).toBeUndefined();
    expect(restrictedSpy).not.toHaveBeenCalled();
  });
});

describe("An automatic AI investigation's trace waterfall", () => {
  test("drops the spans of private chat services", async () => {
    const find: jest.SpyInstance = jest
      .spyOn(SpanService, "findBy")
      .mockResolvedValue([
        span({
          spanId: "a",
          name: "POST /checkout",
          serviceId: APP_SERVICE,
          startMs: 0,
        }),
        span({
          spanId: "b",
          parentSpanId: "a",
          name: "chat claude-opus-4-1",
          serviceId: CHAT_SERVICE.toUpperCase(),
          startMs: 5,
        }),
      ]);

    const result: ToolExecutionResult = await GetTraceTool.execute(
      { traceId: "trace-1" },
      systemRun(),
    );

    const request: Record<string, unknown> = find.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(request["select"]).toEqual(
      expect.objectContaining({ primaryEntityId: true }),
    );
    expect(restrictedSpy).toHaveBeenCalledWith(PROJECT);

    expect(result.dataForLlm).toContain("POST /checkout");
    expect(result.dataForLlm).not.toContain("chat claude-opus-4-1");
    expect(result.rowCount).toBe(1);
    expect(result.citationLabel).toContain("(1 spans)");
    const widgetSpans: Array<AIChatWidgetSpan> = (
      result.widget as unknown as { data: { spans: Array<AIChatWidgetSpan> } }
    ).data.spans;
    expect(
      widgetSpans.map((item: AIChatWidgetSpan): string => {
        return item.name;
      }),
    ).toEqual(["POST /checkout"]);
  });

  test("a trace of private chat spans alone reads as empty", async () => {
    jest.spyOn(SpanService, "findBy").mockResolvedValue([
      span({
        spanId: "b",
        name: "chat claude-opus-4-1",
        serviceId: CHAT_SERVICE,
        startMs: 0,
      }),
    ]);

    const result: ToolExecutionResult = await GetTraceTool.execute(
      { traceId: "trace-2" },
      systemRun(),
    );

    expect(result.rowCount).toBe(0);
    expect(result.dataForLlm).not.toContain("chat claude-opus-4-1");
  });

  test("a person's run asks for no service column and keeps what the permission layer returned", async () => {
    const find: jest.SpyInstance = jest
      .spyOn(SpanService, "findBy")
      .mockResolvedValue([
        span({ spanId: "a", name: "POST /checkout", startMs: 0 }),
        span({
          spanId: "c",
          parentSpanId: "a",
          name: "SELECT orders",
          startMs: 2,
        }),
      ]);

    const result: ToolExecutionResult = await GetTraceTool.execute(
      { traceId: "trace-3" },
      personRun(),
    );

    const request: Record<string, unknown> = find.mock.calls[0]![0] as Record<
      string,
      unknown
    >;
    expect(
      Object.keys(request["select"] as Record<string, unknown>),
    ).not.toContain("primaryEntityId");
    expect(restrictedSpy).not.toHaveBeenCalled();
    expect(result.rowCount).toBe(2);
  });
});

describe("The trace latency insight scan", () => {
  function row(entityId: string, p99Ms: number): ServiceLatencyProfileRow {
    return { primaryEntityId: entityId, count: 500, p99DurationMs: p99Ms };
  }

  function profile(
    rows: Array<ServiceLatencyProfileRow>,
  ): ServiceLatencyProfile {
    return { rows, isPartial: false };
  }

  test("files nothing about a private chat service, and never drills into its chats", async () => {
    jest
      .spyOn(TraceAggregationService, "getServiceLatencyProfile")
      .mockResolvedValueOnce(profile([row(CHAT_SERVICE, 5000)]))
      .mockResolvedValueOnce(profile([row(CHAT_SERVICE, 1000)]));
    const topList: jest.SpyInstance = jest
      .spyOn(TraceAggregationService, "getAnalyticsTopList")
      .mockResolvedValue([]);
    const find: jest.SpyInstance = jest.spyOn(SpanService, "findBy");

    const candidates: Array<InsightCandidate> =
      await new TraceLatencyRegressionDetector().detect({
        projectId: PROJECT,
        now: NOW,
      });

    expect(restrictedSpy).toHaveBeenCalledWith(PROJECT);
    expect(candidates).toEqual([]);
    expect(topList).not.toHaveBeenCalled();
    expect(find).not.toHaveBeenCalled();
  });

  test("still files the regression of a service of the project's own next to it", async () => {
    jest
      .spyOn(TraceAggregationService, "getServiceLatencyProfile")
      .mockResolvedValueOnce(
        profile([
          row(CHAT_SERVICE.toUpperCase(), 5000),
          row(APP_SERVICE, 5000),
        ]),
      )
      .mockResolvedValueOnce(
        profile([
          row(CHAT_SERVICE.toUpperCase(), 1000),
          row(APP_SERVICE, 1000),
        ]),
      );
    const topList: jest.SpyInstance = jest
      .spyOn(TraceAggregationService, "getAnalyticsTopList")
      .mockResolvedValue([]);
    jest.spyOn(ServiceService, "findOneById").mockResolvedValue(null);

    const candidates: Array<InsightCandidate> =
      await new TraceLatencyRegressionDetector().detect({
        projectId: PROJECT,
        now: NOW,
      });

    expect(candidates).toHaveLength(1);
    expect(topList).toHaveBeenCalledTimes(1);
    const request: Record<string, unknown> = topList.mock
      .calls[0]![0] as Record<string, unknown>;
    expect(idsOf(request["serviceIds"])).toEqual([APP_SERVICE]);
  });
});

describe("Every span read in the AI toolbox", () => {
  const TOOLBOX_DIRECTORY: string = path.join(
    __dirname,
    "../../../../Server/Utils/AI/Toolbox",
  );

  const sources: Array<{ file: string; source: string }> = fs
    .readdirSync(TOOLBOX_DIRECTORY)
    .filter((file: string): boolean => {
      return file.endsWith(".ts");
    })
    .map((file: string): { file: string; source: string } => {
      return {
        file,
        source: fs.readFileSync(path.join(TOOLBOX_DIRECTORY, file), "utf8"),
      };
    });

  test("works its span scope out through ToolArgs.spanScope", () => {
    const SPAN_SCOPE: RegExp = /TelemetryReadAccess\.getScope\(\s*Span\b/g;
    let reads: number = 0;

    for (const { file, source } of sources) {
      for (const match of source.matchAll(SPAN_SCOPE)) {
        reads++;
        const before: string = source.slice(
          Math.max(0, (match.index || 0) - 120),
          match.index,
        );
        expect(`${file}: ${before}`).toContain("ToolArgs.spanScope(");
      }
    }

    // TraceTools and ResourceTools read spans this way today.
    expect(reads).toBeGreaterThanOrEqual(2);
  });

  test("and a file that reads span rows holds a system run to it as well", () => {
    const readers: Array<string> = sources
      .filter(({ source }: { source: string }): boolean => {
        return source.includes("SpanService.");
      })
      .map(({ file }: { file: string }): string => {
        return file;
      });

    expect(readers).toContain("TraceTools.ts");

    for (const file of readers) {
      const source: string = sources.find((item: { file: string }): boolean => {
        return item.file === file;
      })!.source;
      expect(`${file}: ${source.includes("ToolArgs.spanScope(")}`).toBe(
        `${file}: true`,
      );
    }
  });
});
