import TracePipelineService, {
  LoadedTracePipeline,
} from "../../FeatureSet/Telemetry/Services/TracePipelineService";
import {
  CompiledFilter,
  compileFilter,
  evaluateCompiledFilter,
} from "../../FeatureSet/Telemetry/Utils/LogFilterEvaluator";
import {
  buildFilterQuery,
  parseFilterQuery,
} from "../../FeatureSet/Dashboard/src/Components/FilterQueryBuilder/FilterQueryParser";
import TraceFilterConfig from "../../FeatureSet/Dashboard/src/Components/FilterQueryBuilder/TraceFilterConfig";
import {
  FilterConditionData,
  FilterFieldDefinition,
  FilterFieldValueOption,
} from "../../FeatureSet/Dashboard/src/Components/FilterQueryBuilder/Types";
import TracePipeline from "Common/Models/DatabaseModels/TracePipeline";
import TracePipelineProcessor from "Common/Models/DatabaseModels/TracePipelineProcessor";
import { SpanKind, SpanStatus } from "Common/Models/AnalyticsModels/Span";
import TracePipelineProcessorType from "Common/Types/Trace/TracePipelineProcessorType";
import logger from "Common/Server/Utils/Logger";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The span status recipes the Traces help and docs give customers (#4118).
 *
 * Unset is OpenTelemetry's default status: instrumentation sets Error when an
 * operation fails and leaves a successful span Unset. The Traces UI now reads
 * Unset as "no error", and the help tells customers two things that only
 * hold if ingest does what the help says:
 *
 * - Pipelines help and docs: to show successful HTTP spans as Ok, create a
 *   pipeline with the filter condition Status = Unset (`statusCode = '0'`,
 *   what the visual filter builder saves) and a Status Remapper on
 *   http.response.status_code (http.status_code on older SDKs) mapping 200,
 *   201, 204 and 304 to Ok. Spans already marked Error are never changed,
 *   and each mapping matches one exact value.
 * - Drop Filters help: "not an error" is `statusCode != 2`. The old example
 *   sampled `statusCode = 1`, which only matches spans some code explicitly
 *   marked Ok, so it never touched the typical successful span (Unset).
 *
 * Everything runs through the real code: the Dashboard's filter builder and
 * trace filter config build the pipeline filter, TracePipelineService
 * applies the pipeline the way ingest does, and the drop filter is compiled
 * and evaluated the way TraceDropFilterService does it.
 */

const HTTP_RESPONSE_STATUS_CODE: string = "http.response.status_code";
// The same value under the HTTP semantic conventions older SDKs still emit.
const LEGACY_HTTP_STATUS_CODE: string = "http.status_code";

// The codes the Pipelines help maps to Ok, one mapping each.
const DOCUMENTED_SUCCESS_CODES: Array<string> = ["200", "201", "204", "304"];

// The Drop Filters help's "Sample successful CRUD" example, and the old one.
const SAMPLE_SUCCESSFUL_CLIENT_SPANS: string =
  "kind = 'SPAN_KIND_CLIENT' AND statusCode != 2";
const OLD_SAMPLE_SUCCESSFUL_CLIENT_SPANS: string =
  "kind = 'SPAN_KIND_CLIENT' AND statusCode = 1";

const DASHBOARD_TRACE_SETTINGS_DIR: string = path.resolve(
  __dirname,
  "../../FeatureSet/Dashboard/src/Pages/Traces/Settings",
);
const TRACES_MONITOR_DOC: string = path.resolve(
  __dirname,
  "../../FeatureSet/Docs/Content/en/monitor/traces-monitor.md",
);

const PROJECT_ID: string = ObjectID.generate().toString();
const SERVICE_ID: string = ObjectID.generate().toString();

/*
 * Minimal structural view of a jest spy — the @jest/globals and
 * @types/jest spy types disagree in this repo, so annotate with just the
 * surface this test reads.
 */
type SpyLike = {
  mock: { calls: Array<Array<unknown>> };
  mockImplementation: (fn: (...args: Array<unknown>) => unknown) => SpyLike;
  mockRestore: () => void;
};

/*
 * processSpan logs a processor that throws and moves on, which leaves the
 * span exactly as it arrived. Fail on that, so "left alone" can only pass
 * because the recipe really left the span alone.
 */
let loggerErrorSpy: SpyLike;

beforeEach(() => {
  loggerErrorSpy = (
    jest.spyOn(logger, "error") as unknown as SpyLike
  ).mockImplementation(() => {
    return undefined;
  });
});

afterEach(() => {
  const loggedErrors: Array<Array<unknown>> = loggerErrorSpy.mock.calls;
  loggerErrorSpy.mockRestore();
  expect(loggedErrors).toEqual([]);
});

/*
 * A span row as OtelTracesIngestService hands it to drop filters and
 * pipelines: statusCode is the stored number (0 Unset, 1 Ok, 2 Error), kind
 * is the SPAN_KIND_* name, and attributes is one flat map with the resource
 * attributes under "resource.".
 */
function spanRow(span: {
  statusCode: SpanStatus;
  kind: SpanKind;
  name: string;
  attributes: JSONObject;
  statusMessage?: string | undefined;
}): JSONObject {
  const attributes: JSONObject = {
    "resource.service.name": "checkout",
    "resource.telemetry.sdk.language": "nodejs",
    ...span.attributes,
  };
  const isRootSpan: boolean = span.kind === SpanKind.Server;

  return {
    projectId: PROJECT_ID,
    primaryEntityId: SERVICE_ID,
    startTimeUnixNano: "1790582400000000000",
    endTimeUnixNano: "1790582400042000000",
    durationUnixNano: "42000000",
    traceId: "0af7651916cd43dd8448eb211c80319c",
    spanId: "b7ad6b7169203331",
    sessionId: "",
    parentSpanId: isRootSpan ? "" : "53995c3f42cd8ad8",
    traceState: "",
    attributes: attributes,
    attributeKeys: Object.keys(attributes),
    statusCode: span.statusCode,
    statusMessage: span.statusMessage || "",
    name: span.name,
    kind: span.kind,
    events: [],
    links: [],
    hasException: false,
    isRootSpan: isRootSpan,
  };
}

// An inbound request, as current HTTP server instrumentation records it.
function serverSpan(
  statusCode: SpanStatus,
  responseAttributes: JSONObject,
): JSONObject {
  return spanRow({
    statusCode: statusCode,
    kind: SpanKind.Server,
    name: "GET /api/cart",
    attributes: {
      "http.request.method": "GET",
      "http.route": "/api/cart",
      "url.scheme": "https",
      ...responseAttributes,
    },
  });
}

// An outbound call to another service: what the drop filter example samples.
function clientSpan(statusCode: SpanStatus): JSONObject {
  return spanRow({
    statusCode: statusCode,
    kind: SpanKind.Client,
    name: "POST",
    attributes: {
      "http.request.method": "POST",
      "server.address": "inventory",
      [HTTP_RESPONSE_STATUS_CODE]: statusCode === SpanStatus.Error ? 503 : 200,
    },
  });
}

/*
 * The filter the pipeline page saves when a customer picks the Status field,
 * "equals" and the named status in the visual filter builder.
 */
function builderStatusFilter(statusLabel: string): string {
  const statusField: FilterFieldDefinition | undefined =
    TraceFilterConfig.fields.find((field: FilterFieldDefinition): boolean => {
      return field.label === "Status";
    });
  const option: FilterFieldValueOption | undefined =
    statusField?.valueOptions?.find(
      (candidate: FilterFieldValueOption): boolean => {
        return candidate.label === statusLabel;
      },
    );

  if (!statusField || !option) {
    throw new Error(`The trace filter builder has no Status = ${statusLabel}`);
  }

  const condition: FilterConditionData = {
    field: statusField.key,
    operator: "=",
    value: option.value,
  };

  return buildFilterQuery([condition], "AND", TraceFilterConfig);
}

/*
 * The pipeline the help describes, as TracePipelineService.loadPipelines
 * hands it to processSpan: the saved pipeline with its filter compiled once,
 * and one Status Remapper whose configuration has the shape the processor
 * form saves (a matchValue string and a numeric statusCode per mapping).
 */
function statusToOkPipeline(data: {
  filterQuery: string;
  sourceKey: string;
}): LoadedTracePipeline {
  const pipeline: TracePipeline = new TracePipeline();
  pipeline.name = "Mark successful HTTP spans Ok";
  pipeline.filterQuery = data.filterQuery;
  pipeline.isEnabled = true;
  pipeline.sortOrder = 1;

  const processor: TracePipelineProcessor = new TracePipelineProcessor();
  processor.name = "HTTP success is Ok";
  processor.processorType = TracePipelineProcessorType.StatusRemapper;
  processor.configuration = {
    sourceKey: data.sourceKey,
    mappings: DOCUMENTED_SUCCESS_CODES.map((code: string): JSONObject => {
      return { matchValue: code, statusCode: SpanStatus.Ok };
    }),
  };
  processor.isEnabled = true;
  processor.sortOrder = 1;

  return {
    pipeline: pipeline,
    compiledFilter: compileFilter(pipeline.filterQuery || ""),
    processors: [processor],
  };
}

// The recipe exactly as the help gives it.
function recipePipelines(
  sourceKey: string = HTTP_RESPONSE_STATUS_CODE,
): Array<LoadedTracePipeline> {
  return [
    statusToOkPipeline({
      filterQuery: builderStatusFilter("Unset"),
      sourceKey: sourceKey,
    }),
  ];
}

/*
 * Which of the spans a saved drop filter selects. Compiled the way
 * TraceDropFilterService.loadDropFilters compiles one.
 */
function dropFilterMatches(
  filterQuery: string,
  spans: Array<JSONObject>,
): Array<boolean> {
  const compiled: CompiledFilter = compileFilter(filterQuery, {
    emptyQueryMatches: false,
  });

  return spans.map((span: JSONObject): boolean => {
    return evaluateCompiledFilter(span, compiled);
  });
}

/*
 * The help markdown lives in a template literal, so its code spans are
 * written \`like this\` in the source. Read them back as markdown.
 */
function readSettingsHelp(fileName: string): string {
  return fs
    .readFileSync(path.join(DASHBOARD_TRACE_SETTINGS_DIR, fileName), "utf8")
    .split("\\`")
    .join("`");
}

describe("the pipeline filter: Status = Unset", () => {
  test("the visual builder saves statusCode = '0' and reads it back as Status = Unset", () => {
    const filterQuery: string = builderStatusFilter("Unset");

    expect(filterQuery).toBe("statusCode = '0'");
    expect(parseFilterQuery(filterQuery, TraceFilterConfig)).toEqual({
      connector: "AND",
      conditions: [{ field: "statusCode", operator: "=", value: "0" }],
    });
  });

  test("the saved filter matches stored Unset spans and nothing else", () => {
    // statusCode is stored as a number; the quoted '0' still has to match it.
    const compiled: CompiledFilter = compileFilter(
      builderStatusFilter("Unset"),
    );

    expect(
      [SpanStatus.Unset, SpanStatus.Ok, SpanStatus.Error].map(
        (statusCode: SpanStatus): boolean => {
          return evaluateCompiledFilter(
            serverSpan(statusCode, { [HTTP_RESPONSE_STATUS_CODE]: 200 }),
            compiled,
          );
        },
      ),
    ).toEqual([true, false, false]);
  });
});

describe("the Status Remapper recipe at ingest", () => {
  test("an Unset span with http.response.status_code 200 becomes Ok, and nothing else about it changes", () => {
    const span: JSONObject = serverSpan(SpanStatus.Unset, {
      [HTTP_RESPONSE_STATUS_CODE]: 200,
    });

    const stored: JSONObject = TracePipelineService.processSpan(
      span,
      recipePipelines(),
    );

    expect(stored).toEqual({ ...span, statusCode: SpanStatus.Ok });
    // processSpan works on a copy: the row it was handed still reads Unset.
    expect(span["statusCode"]).toBe(SpanStatus.Unset);
  });

  test("the status code also matches when it arrives as text", () => {
    /*
     * OTLP/JSON encodes int values as strings, and the gRPC and protobuf
     * decoders keep 64-bit ints as strings, so "200" is a common shape.
     */
    const span: JSONObject = serverSpan(SpanStatus.Unset, {
      [HTTP_RESPONSE_STATUS_CODE]: "200",
    });

    expect(TracePipelineService.processSpan(span, recipePipelines())).toEqual({
      ...span,
      statusCode: SpanStatus.Ok,
    });
  });

  test.each(DOCUMENTED_SUCCESS_CODES)(
    "an Unset %s becomes Ok, as a number or as text",
    (code: string) => {
      for (const value of [Number(code), code]) {
        const span: JSONObject = serverSpan(SpanStatus.Unset, {
          [HTTP_RESPONSE_STATUS_CODE]: value,
        });

        expect(
          TracePipelineService.processSpan(span, recipePipelines())[
            "statusCode"
          ],
        ).toBe(SpanStatus.Ok);
      }
    },
  );

  test("an Unset 404 stays Unset, and so does an unlisted 202: each mapping matches one exact value", () => {
    // HTTP server instrumentation leaves a 4xx Unset: the client erred.
    const notFound: JSONObject = serverSpan(SpanStatus.Unset, {
      [HTTP_RESPONSE_STATUS_CODE]: 404,
    });
    const accepted: JSONObject = serverSpan(SpanStatus.Unset, {
      [HTTP_RESPONSE_STATUS_CODE]: 202,
    });

    expect(
      TracePipelineService.processSpan(notFound, recipePipelines()),
    ).toEqual(notFound);
    expect(
      TracePipelineService.processSpan(accepted, recipePipelines()),
    ).toEqual(accepted);
  });

  test("an Error span with a 200 stays Error because the Status = Unset filter leaves it out", () => {
    // The response went out with a 200, then the handler failed.
    const failed: JSONObject = spanRow({
      statusCode: SpanStatus.Error,
      kind: SpanKind.Server,
      name: "GET /api/cart",
      attributes: {
        "http.request.method": "GET",
        "http.route": "/api/cart",
        [HTTP_RESPONSE_STATUS_CODE]: 200,
      },
      statusMessage: "Error: aborted",
    });

    expect(TracePipelineService.processSpan(failed, recipePipelines())).toEqual(
      failed,
    );

    /*
     * The filter is what protects it: the same remapper in a pipeline with
     * no filter condition would overwrite the error.
     */
    const unfiltered: LoadedTracePipeline = statusToOkPipeline({
      filterQuery: "",
      sourceKey: HTTP_RESPONSE_STATUS_CODE,
    });
    expect(
      TracePipelineService.processSpan(failed, [unfiltered])["statusCode"],
    ).toBe(SpanStatus.Ok);
  });

  test("an Unset span without an HTTP status code stays Unset", () => {
    const internal: JSONObject = spanRow({
      statusCode: SpanStatus.Unset,
      kind: SpanKind.Internal,
      name: "render cart",
      attributes: { "code.function": "renderCart" },
    });

    expect(
      TracePipelineService.processSpan(internal, recipePipelines()),
    ).toEqual(internal);
  });

  test("a span with only the older http.status_code needs the source key the help names for older SDKs", () => {
    const legacy: JSONObject = spanRow({
      statusCode: SpanStatus.Unset,
      kind: SpanKind.Server,
      name: "GET /api/cart",
      attributes: {
        "http.method": "GET",
        "http.target": "/api/cart",
        [LEGACY_HTTP_STATUS_CODE]: 200,
      },
    });

    expect(
      TracePipelineService.processSpan(
        legacy,
        recipePipelines(HTTP_RESPONSE_STATUS_CODE),
      ),
    ).toEqual(legacy);
    expect(
      TracePipelineService.processSpan(
        legacy,
        recipePipelines(LEGACY_HTTP_STATUS_CODE),
      ),
    ).toEqual({ ...legacy, statusCode: SpanStatus.Ok });
  });
});

describe("the drop filter guidance: not an error is statusCode != 2", () => {
  const unsetOkAndErrorClientSpans: Array<JSONObject> = [
    clientSpan(SpanStatus.Unset),
    clientSpan(SpanStatus.Ok),
    clientSpan(SpanStatus.Error),
  ];

  test("the example selects Unset and Ok client spans, never an Error one", () => {
    expect(
      dropFilterMatches(
        SAMPLE_SUCCESSFUL_CLIENT_SPANS,
        unsetOkAndErrorClientSpans,
      ),
    ).toEqual([true, true, false]);

    // The kind condition still holds: a successful server span is kept.
    expect(
      dropFilterMatches(SAMPLE_SUCCESSFUL_CLIENT_SPANS, [
        serverSpan(SpanStatus.Unset, { [HTTP_RESPONSE_STATUS_CODE]: 200 }),
      ]),
    ).toEqual([false]);
  });

  test("REGRESSION: the old statusCode = 1 example selects only the Ok span and misses the typical Unset one", () => {
    expect(
      dropFilterMatches(
        OLD_SAMPLE_SUCCESSFUL_CLIENT_SPANS,
        unsetOkAndErrorClientSpans,
      ),
    ).toEqual([false, true, false]);
  });
});

describe("the help gives customers the recipes these tests run", () => {
  test("the Pipelines help names the Status = Unset filter, both source keys and the codes to map", () => {
    const help: string = readSettingsHelp("Pipelines.tsx");

    expect(help).toContain("**Status = Unset** (`statusCode = '0'`)");
    expect(help).toContain("**Status Remapper**");
    expect(help).toContain(`\`${HTTP_RESPONSE_STATUS_CODE}\``);
    expect(help).toContain(`\`${LEGACY_HTTP_STATUS_CODE}\``);
    for (const code of DOCUMENTED_SUCCESS_CODES) {
      expect(help).toContain(`\`${code}\` → Ok`);
    }
  });

  test("the traces monitor docs point to the same pipeline", () => {
    const docs: string = fs.readFileSync(TRACES_MONITOR_DOC, "utf8");

    expect(docs).toContain("**Status = Unset**");
    expect(docs).toContain("**Status Remapper**");
    expect(docs).toContain(`\`${HTTP_RESPONSE_STATUS_CODE}\``);
  });

  test("REGRESSION: the Drop Filters help samples statusCode != 2, no longer statusCode = 1", () => {
    const help: string = readSettingsHelp("DropFilters.tsx");

    expect(help).toContain(
      `\`${SAMPLE_SUCCESSFUL_CLIENT_SPANS}\` (action: Sample, 10%)`,
    );
    expect(help).not.toContain(OLD_SAMPLE_SUCCESSFUL_CLIENT_SPANS);
  });
});
