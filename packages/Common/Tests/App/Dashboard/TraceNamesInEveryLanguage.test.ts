import { beforeAll, describe, expect, test } from "@jest/globals";
import {
  SpanEntityDisplay,
  UNKNOWN_SPAN_ENTITY_NAME,
  getSpanEntityDisplay,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesEntityDisplay";
import {
  ServiceSummary,
  TraceServiceInfo,
  UNKNOWN_SERVICE_COLOR,
  UNKNOWN_SERVICE_NAME,
  buildServiceInfoMap,
  getServiceInfo,
  summarizeServices,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/TraceDetailPresentation";
import {
  TraceInsightsSpanInput,
  TraceInsightsTrace,
  TraceInsightsTraces,
  UNKNOWN_TRACE_NAME,
  getSlowestTraces,
  summarizeRecentTraces,
  summarizeTrace,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/TraceInsightsTraces";
import { WaterfallSpan } from "../../../../App/FeatureSet/Dashboard/src/Utils/TraceWaterfall";
import { SpanStatus } from "../../../Models/AnalyticsModels/Span";
import Service from "../../../Models/DatabaseModels/Service";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import { ResolvedTelemetryEntity } from "../../../UI/Utils/Telemetry/TelemetryEntityNames";
import { UNKNOWN_SERVICE_NAME as STAND_IN } from "../../../UI/Utils/TelemetryService";
import { Translator } from "../../../UI/Utils/TranslateTemplate";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import {
  ENGLISH,
  LANGUAGES,
  OTHER_LANGUAGES,
  createLanguageInstances,
  hasOwnWording,
  translatorFor,
  word,
} from "./TracesLanguageHarness";

/*
 * ---------------------------------------------------------------------------
 * What a span's service and a trace are called, where nothing names them
 * ---------------------------------------------------------------------------
 *
 * Two different words stand in for a missing service, and they are not one
 * word: "Unknown Service" is OneUptime's bucket for telemetry that names none,
 * and "Unknown service" is what the trace page calls a span whose service it
 * could not find. And a trace with no name reads "Unknown", while a span a
 * person named "Unknown" keeps that name in every language: the summary says
 * which it is (isNameless), so the view never has to guess from the spelling.
 */

const CHECKOUT_ID: string = "20000000-0000-4000-8000-000000000002";
const PAYMENTS_ID: string = "30000000-0000-4000-8000-000000000003";
const MISSING_ID: string = "40000000-0000-4000-8000-000000000004";

const CHECKOUT_COLOR: Color = new Color("#7c3aed");

const makeService: (
  id: string | undefined,
  name?: string | undefined,
) => Service = (id: string | undefined, name?: string | undefined): Service => {
  const service: Service = new Service();

  if (id) {
    service.id = new ObjectID(id);
  }

  if (name !== undefined) {
    service.name = name;
  }

  return service;
};

const checkout: () => Service = (): Service => {
  const service: Service = makeService(CHECKOUT_ID, "checkout-api");
  service.serviceColor = CHECKOUT_COLOR;
  return service;
};

const makeSpan: (
  spanId: string,
  serviceId: string,
  durationUnixNano: number,
  isError?: boolean,
) => WaterfallSpan = (
  spanId: string,
  serviceId: string,
  durationUnixNano: number,
  isError: boolean = false,
): WaterfallSpan => {
  return {
    spanId,
    serviceId,
    durationUnixNano,
    isError,
  } as unknown as WaterfallSpan;
};

const makeInsightsSpan: (
  overrides: Partial<TraceInsightsSpanInput>,
) => TraceInsightsSpanInput = (
  overrides: Partial<TraceInsightsSpanInput>,
): TraceInsightsSpanInput => {
  return {
    traceId: "trace-1",
    spanId: "span-1",
    parentSpanId: "",
    name: "GET /orders",
    primaryEntityId: CHECKOUT_ID,
    startTime: new Date("2026-10-01T10:00:00.000Z"),
    durationNano: 1000,
    statusCode: SpanStatus.Unset,
    ...overrides,
  };
};

const hostEntity: ResolvedTelemetryEntity = {
  id: CHECKOUT_ID,
  name: "web-1",
  entityType: ServiceType.Host,
  typeLabel: "Host",
};

beforeAll(async () => {
  await createLanguageInstances();
});

describe("the words for what nothing names", () => {
  test("are keys of the Dashboard's English, drawn as themselves", () => {
    for (const key of [
      STAND_IN,
      UNKNOWN_SERVICE_NAME,
      UNKNOWN_SPAN_ENTITY_NAME,
      UNKNOWN_TRACE_NAME,
    ]) {
      expect(ENGLISH[key]).toBe(key);
    }
  });

  test("the bucket and the service the trace page could not find are different words", () => {
    expect(UNKNOWN_SERVICE_NAME).not.toBe(STAND_IN);
  });

  test.each(OTHER_LANGUAGES)("%s words each of them", (language: string) => {
    expect(
      [
        STAND_IN,
        UNKNOWN_SERVICE_NAME,
        UNKNOWN_SPAN_ENTITY_NAME,
        UNKNOWN_TRACE_NAME,
      ].filter((key: string): boolean => {
        return !hasOwnWording(language, key);
      }),
    ).toEqual([]);
  });
});

describe.each(LANGUAGES)("a trace's services in %s", (language: string) => {
  const translator: () => Translator = (): Translator => {
    return translatorFor(language);
  };

  test("a person's service keeps its name and color", () => {
    const info: Map<string, TraceServiceInfo> = buildServiceInfoMap(
      [checkout()],
      translator(),
    );

    expect(info.get(CHECKOUT_ID)).toEqual({
      id: CHECKOUT_ID,
      name: "checkout-api",
      color: CHECKOUT_COLOR.toString(),
    });
  });

  test("a service called what the page calls a missing one stays as written", () => {
    const info: Map<string, TraceServiceInfo> = buildServiceInfoMap(
      [makeService(CHECKOUT_ID, "Unknown service")],
      translator(),
    );

    expect(info.get(CHECKOUT_ID)?.name).toBe("Unknown service");
  });

  test("the bucket reads the bucket's word", () => {
    const info: Map<string, TraceServiceInfo> = buildServiceInfoMap(
      [makeService(CHECKOUT_ID, STAND_IN)],
      translator(),
    );

    expect(info.get(CHECKOUT_ID)?.name).toBe(word(language, STAND_IN));
  });

  test("a service with no name reads the page's word, in the fallback color", () => {
    const info: Map<string, TraceServiceInfo> = buildServiceInfoMap(
      [makeService(CHECKOUT_ID)],
      translator(),
    );

    expect(info.get(CHECKOUT_ID)).toEqual({
      id: CHECKOUT_ID,
      name: word(language, UNKNOWN_SERVICE_NAME),
      color: UNKNOWN_SERVICE_COLOR,
    });
  });

  test("a service with no id cannot be looked up, so it is left out", () => {
    expect(
      buildServiceInfoMap([makeService(undefined, "ghost")], translator()).size,
    ).toBe(0);
  });

  test("a span no loaded service claims reads the page's word", () => {
    expect(getServiceInfo(new Map(), MISSING_ID, translator())).toEqual({
      id: MISSING_ID,
      name: word(language, UNKNOWN_SERVICE_NAME),
      color: UNKNOWN_SERVICE_COLOR,
    });
  });

  test("a span a loaded service claims reads that service", () => {
    const info: Map<string, TraceServiceInfo> = buildServiceInfoMap(
      [checkout()],
      translator(),
    );

    expect(getServiceInfo(info, CHECKOUT_ID, translator())).toBe(
      info.get(CHECKOUT_ID),
    );
  });

  test("a summary names the service no one claims and keeps the rest as written", () => {
    const summaries: Array<ServiceSummary> = summarizeServices({
      spans: [
        makeSpan("a", CHECKOUT_ID, 300),
        makeSpan("b", MISSING_ID, 100, true),
      ],
      selfTimes: new Map(),
      serviceInfoById: buildServiceInfoMap([checkout()], translator()),
      translator: translator(),
    });

    expect(
      summaries.map((summary: ServiceSummary): string => {
        return summary.name;
      }),
    ).toEqual(["checkout-api", word(language, UNKNOWN_SERVICE_NAME)]);
    expect(summaries[1]?.errorCount).toBe(1);
    expect(summaries[0]?.percent).toBe(75);
    expect(summaries[1]?.percent).toBe(25);
  });

  test("two services alike in every number are sorted by what the reader reads", () => {
    const summaries: Array<ServiceSummary> = summarizeServices({
      spans: [makeSpan("a", PAYMENTS_ID, 100), makeSpan("b", CHECKOUT_ID, 100)],
      selfTimes: new Map(),
      serviceInfoById: buildServiceInfoMap(
        [makeService(PAYMENTS_ID, "payments"), checkout()],
        translator(),
      ),
      translator: translator(),
    });

    expect(summaries[0]?.name).toBe("checkout-api");
    expect(summaries[1]?.name).toBe("payments");
  });
});

describe("a trace's services with no translator", () => {
  test("read as they always did", () => {
    const info: Map<string, TraceServiceInfo> = buildServiceInfoMap([
      makeService(CHECKOUT_ID, STAND_IN),
      makeService(PAYMENTS_ID),
    ]);

    expect(info.get(CHECKOUT_ID)?.name).toBe(STAND_IN);
    expect(info.get(PAYMENTS_ID)?.name).toBe(UNKNOWN_SERVICE_NAME);
    expect(getServiceInfo(new Map(), MISSING_ID).name).toBe(
      UNKNOWN_SERVICE_NAME,
    );
  });
});

describe.each(LANGUAGES)("a span row's entity in %s", (language: string) => {
  const display: (data: {
    service?: Service | undefined;
    entity?: ResolvedTelemetryEntity | undefined;
  }) => SpanEntityDisplay = (data: {
    service?: Service | undefined;
    entity?: ResolvedTelemetryEntity | undefined;
  }): SpanEntityDisplay => {
    return getSpanEntityDisplay({
      ...data,
      translator: translatorFor(language),
    });
  };

  test("a person's service keeps its name and color, under the language's word for its type", () => {
    expect(display({ service: checkout() })).toEqual({
      name: "checkout-api",
      typeLabel: word(language, "Service"),
      color: CHECKOUT_COLOR.toString(),
    });
  });

  test("the stand-in reads the stand-in's word", () => {
    expect(display({ service: makeService(CHECKOUT_ID, STAND_IN) }).name).toBe(
      word(language, STAND_IN),
    );
  });

  test("a Service with no name borrows the entity's, as written", () => {
    expect(
      display({ service: makeService(CHECKOUT_ID), entity: hostEntity }).name,
    ).toBe("web-1");
  });

  test("a Service with no name and no entity reads the row's word", () => {
    expect(display({ service: makeService(CHECKOUT_ID) }).name).toBe(
      word(language, UNKNOWN_SPAN_ENTITY_NAME),
    );
  });

  test("an entity keeps its name, under the language's word for its type", () => {
    expect(display({ entity: hostEntity })).toEqual({
      name: "web-1",
      typeLabel: word(language, "Host"),
    });
  });

  test("an entity with no type label is a Service", () => {
    expect(
      display({ entity: { ...hostEntity, typeLabel: "" } }).typeLabel,
    ).toBe(word(language, "Service"));
  });

  test("an entity with no name reads the row's word", () => {
    expect(display({ entity: { ...hostEntity, name: "" } })).toEqual({
      name: word(language, UNKNOWN_SPAN_ENTITY_NAME),
      typeLabel: word(language, "Service"),
    });
  });

  test("nothing at all reads the row's word", () => {
    expect(display({})).toEqual({
      name: word(language, UNKNOWN_SPAN_ENTITY_NAME),
      typeLabel: word(language, "Service"),
    });
  });
});

describe("a span row's entity with no translator", () => {
  test("reads as it always did", () => {
    expect(getSpanEntityDisplay({})).toEqual({
      name: UNKNOWN_SPAN_ENTITY_NAME,
      typeLabel: "Service",
    });
    expect(getSpanEntityDisplay({ entity: hostEntity }).typeLabel).toBe("Host");
    expect(
      getSpanEntityDisplay({ service: makeService(CHECKOUT_ID, STAND_IN) })
        .name,
    ).toBe(STAND_IN);
  });
});

describe("a trace's name on the Insights tab", () => {
  test("a trace whose first span has a name keeps it", () => {
    const trace: TraceInsightsTrace | undefined = summarizeTrace("trace-1", [
      makeInsightsSpan({ name: "POST /pay" }),
    ]);

    expect(trace?.name).toBe("POST /pay");
    expect(trace?.isNameless).toBe(false);
  });

  test("a trace with no name says so, and carries the key for the view to look up", () => {
    const trace: TraceInsightsTrace | undefined = summarizeTrace("trace-1", [
      makeInsightsSpan({ name: "" }),
    ]);

    expect(trace?.name).toBe(UNKNOWN_TRACE_NAME);
    expect(trace?.isNameless).toBe(true);
  });

  test("REGRESSION: a span a person named Unknown is a name, not the fallback", () => {
    const trace: TraceInsightsTrace | undefined = summarizeTrace("trace-1", [
      makeInsightsSpan({ name: UNKNOWN_TRACE_NAME }),
    ]);

    expect(trace?.name).toBe(UNKNOWN_TRACE_NAME);
    expect(trace?.isNameless).toBe(false);
  });

  test("any name a span can carry is kept exactly", () => {
    const names: Array<string> = generatedTexts(2000, 5473, [
      "GET",
      " ",
      "/",
      "Unknown",
      "{{count}}",
      "$&",
      "<b>",
      "未知",
      "‏",
    ]);

    for (const name of names) {
      const trace: TraceInsightsTrace | undefined = summarizeTrace("trace-1", [
        makeInsightsSpan({ name }),
      ]);

      if (trace?.isNameless !== !name) {
        throw new Error(`${JSON.stringify(name)} read as nameless wrongly`);
      }

      if (trace.name !== (name || UNKNOWN_TRACE_NAME)) {
        throw new Error(`${JSON.stringify(name)} became ${trace.name}`);
      }
    }
  });

  test("the root span names the trace, whichever span came first", () => {
    const trace: TraceInsightsTrace | undefined = summarizeTrace("trace-1", [
      makeInsightsSpan({ spanId: "child", parentSpanId: "root", name: "" }),
      makeInsightsSpan({ spanId: "root", name: "GET /" }),
    ]);

    expect(trace?.name).toBe("GET /");
    expect(trace?.isNameless).toBe(false);
  });

  test("a nameless root makes the trace nameless, whatever its children are called", () => {
    const trace: TraceInsightsTrace | undefined = summarizeTrace("trace-1", [
      makeInsightsSpan({ spanId: "root", name: "" }),
      makeInsightsSpan({
        spanId: "child",
        parentSpanId: "root",
        name: "SELECT",
      }),
    ]);

    expect(trace?.isNameless).toBe(true);
  });

  test("no spans is no trace", () => {
    expect(summarizeTrace("trace-1", [])).toBeUndefined();
  });

  test("the recent, failing and slowest lists all keep whether a trace has a name", () => {
    const traces: TraceInsightsTraces = summarizeRecentTraces([
      makeInsightsSpan({
        traceId: "named",
        spanId: "a",
        statusCode: SpanStatus.Error,
        durationNano: 10,
      }),
      makeInsightsSpan({
        traceId: "nameless",
        spanId: "b",
        name: "",
        statusCode: SpanStatus.Error,
        durationNano: 20,
      }),
    ]);

    const isNameless: (list: Array<TraceInsightsTrace>) => Array<boolean> = (
      list: Array<TraceInsightsTrace>,
    ): Array<boolean> => {
      return list.map((trace: TraceInsightsTrace): boolean => {
        return trace.isNameless;
      });
    };

    expect(isNameless(traces.allTraces)).toEqual([false, true]);
    expect(isNameless(traces.errorTraces)).toEqual([false, true]);
    expect(isNameless(getSlowestTraces(traces.allTraces, 2))).toEqual([
      true,
      false,
    ]);
  });
});
