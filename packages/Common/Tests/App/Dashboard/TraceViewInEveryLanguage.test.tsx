import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ---------------------------------------------------------------------------
 * The trace view, in every Dashboard language
 * ---------------------------------------------------------------------------
 *
 * Traces > a trace drew its words in English in every language. The
 * minimap's tooltip and the name a screen reader reads it by, and the flame
 * graph's line of instructions, were the last three the translation of the
 * Analytics toolbar found; the rest of the page was no different: the
 * waterfall's header, its rows' badges and tooltips, the header's numbers,
 * the toolbar and its filter summary, the span panel and every tab of it,
 * the operations table, the service map, the related signals and the LLM
 * call panel. Most of those words were keys of the locales already, and
 * translated in some languages, but no component looked them up.
 *
 * Each is looked up now, with the reader's translator, where it is drawn;
 * a count is a plural template and a sentence with a value one whole
 * template. Every locale has its own wording for each, or says it as
 * English does on record (Top P, "span {{spanId}}" in Spanish).
 *
 * What stays as written in every language: what the user's own telemetry
 * says - span, service and attribute names, the span kind (OpenTelemetry's
 * SpanKind, as the sidebar draws it), an LLM message's role.
 *
 * The REAL components are mounted under an i18next instance per language,
 * built from the Dashboard's own locale files the way Utils/i18n.ts builds
 * the Dashboard's (as in ChartZoomHintsInEveryLanguage.test.tsx), and the
 * whole trace page against a mocked data boundary (as in
 * TraceExplorer.test.tsx). What each one should draw is what the reader's
 * translator - useTranslator's, over that same instance - says for its key.
 */

const getListMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();
const serviceListMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();
const logsViewerProps: MockFunction = getJestMockFunction();
const exceptionTableProps: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * compiled requires, so the mock variables above are still unassigned when
 * the factories run.
 */
jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      count: (...args: Array<any>) => {
        return countMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return serviceListMock(...args);
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: () => {
        return "error";
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        const { default: ObjectIDInFactory } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDInFactory("10000000-0000-4000-8000-000000000001");
      },
      getCurrentProject: () => {
        return null;
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsViewer",
  () => {
    const ReactInFactory: typeof React = jest.requireActual(
      "react",
    ) as typeof React;
    return {
      __esModule: true,
      default: (props: any) => {
        logsViewerProps(props);
        return ReactInFactory.createElement("div", {
          "data-testid": "logs-viewer",
        });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionInstanceTable",
  () => {
    const ReactInFactory: typeof React = jest.requireActual(
      "react",
    ) as typeof React;
    return {
      __esModule: true,
      default: (props: any) => {
        exceptionTableProps(props);
        return ReactInFactory.createElement("div", {
          "data-testid": "exception-table",
        });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TraceScopedFlamegraph",
  () => {
    const ReactInFactory: typeof React = jest.requireActual(
      "react",
    ) as typeof React;
    return {
      __esModule: true,
      default: () => {
        return ReactInFactory.createElement("div", {
          "data-testid": "scoped-flamegraph",
        });
      },
    };
  },
);

// A session recording of every span: the panel offers Watch session.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/RumSessionLookup",
  () => {
    const { default: RouteInFactory } = jest.requireActual(
      "../../../Types/API/Route",
    ) as { default: new (route: string) => unknown };
    return {
      __esModule: true,
      resolveReplayMomentRouteForSession: async () => {
        return new RouteInFactory("/dashboard/session-replay/view/session-1");
      },
    };
  },
);

// What the message panes would render: the message, as written.
jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  const ReactInFactory: typeof React = jest.requireActual(
    "react",
  ) as typeof React;
  return {
    __esModule: true,
    default: (props: { text: string }) => {
      return ReactInFactory.createElement("div", {}, props.text);
    },
  };
});

/*
 * The service map's canvas, as a probe: each node drawn by its node type,
 * and each edge's label as text. React Flow lays nothing out in jsdom.
 */
jest.mock("reactflow", () => {
  const ReactInFactory: typeof React = jest.requireActual(
    "react",
  ) as typeof React;

  const nothing: () => null = (): null => {
    return null;
  };

  return {
    __esModule: true,
    default: (props: any) => {
      return ReactInFactory.createElement(
        "div",
        { "data-testid": "react-flow" },
        ...(props.nodes || []).map((node: any) => {
          return ReactInFactory.createElement(
            "div",
            { key: node.id, "data-testid": "flow-node" },
            ReactInFactory.createElement(props.nodeTypes[node.type], {
              id: node.id,
              data: node.data,
            }),
          );
        }),
        ...(props.edges || []).map((edge: any) => {
          return ReactInFactory.createElement(
            "span",
            { key: edge.id, "data-testid": "flow-edge-label" },
            edge.label,
          );
        }),
      );
    },
    Background: nothing,
    Controls: nothing,
    Handle: nothing,
    BackgroundVariant: { Dots: "dots" },
    MarkerType: { ArrowClosed: "arrowclosed" },
    Position: { Top: "top", Bottom: "bottom" },
  };
});

import FlameGraph, {
  FLAME_GRAPH_INSTRUCTIONS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/FlameGraph";
import LlmSpanPanel from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/LlmSpanPanel";
import TraceExplorer from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TraceExplorer";
import TraceTimelineMinimap, {
  TRACE_MINIMAP_LABEL,
  TRACE_MINIMAP_TITLE,
  TRACE_MINIMAP_ZOOMED_LABEL,
  TRACE_MINIMAP_ZOOMED_TITLE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TraceDetail/TraceTimelineMinimap";
import TraceWaterfall from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TraceDetail/TraceWaterfall";
import {
  ATTRIBUTE_COUNT,
  ERROR_COUNT,
  EXCEPTION_COUNT,
  MATCH_COUNT,
  SPAN_COUNT,
  TraceServiceInfo,
  formatDurationNano,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/TraceDetailPresentation";
import {
  FULL_VIEWPORT,
  SpanTree,
  TimeViewport,
  WaterfallSpan,
  buildSpanTree,
  flattenVisibleRows,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/TraceWaterfall";
import ExceptionInstance from "../../../Models/AnalyticsModels/ExceptionInstance";
import Span, {
  SpanKind,
  SpanStatus,
} from "../../../Models/AnalyticsModels/Span";
import Service from "../../../Models/DatabaseModels/Service";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Color from "../../../Types/Color";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  PluralTemplate,
  TemplateValues,
  Translator,
  composedValue,
  createTranslator,
} from "../../../UI/Utils/TranslateTemplate";

jest.setTimeout(180000);

const DASHBOARD_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard",
);
const LOCALES_DIR: string = path.join(DASHBOARD_DIR, "src", "Locales");
const PROGRESS_DIR: string = path.join(DASHBOARD_DIR, "i18n", "Progress");

type Locale = Record<string, unknown>;

const readJson: (file: string) => unknown = (file: string): unknown => {
  return JSON.parse(fs.readFileSync(file, "utf8"));
};

const LANGUAGES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((file: string): boolean => {
    return file.endsWith(".json");
  })
  .map((file: string): string => {
    return file.slice(0, -".json".length);
  })
  .sort();

const OTHER_LANGUAGES: Array<string> = LANGUAGES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

const LOCALES: Record<string, Locale> = {};
for (const language of LANGUAGES) {
  LOCALES[language] = readJson(
    path.join(LOCALES_DIR, `${language}.json`),
  ) as Locale;
}
const ENGLISH: Locale = LOCALES["en"] as Locale;

// Languages with no "one" form: their _one keys are never read.
const NO_ONE_FORM: Array<string> = ["ja", "ko", "zh-CN", "zh-TW"];

/*
 * The words a language says the same way as English, on record: its own
 * (i18n/Progress/<language>.json) and every language's (SameAsEnglish.json).
 */
const EVERY_LANGUAGE_SAME_AS_ENGLISH: Array<string> = readJson(
  path.join(DASHBOARD_DIR, "i18n", "SameAsEnglish.json"),
) as Array<string>;

const sameAsEnglish: (language: string) => Array<string> = (
  language: string,
): Array<string> => {
  const progress: { sameAsEnglish?: Array<string> } = readJson(
    path.join(PROGRESS_DIR, `${language}.json`),
  ) as { sameAsEnglish?: Array<string> };

  return [...EVERY_LANGUAGE_SAME_AS_ENGLISH, ...(progress.sameAsEnglish || [])];
};

/*
 * ---------------------------------------------------------------------------
 * The trace view's own words, by where they are drawn
 * ---------------------------------------------------------------------------
 */

const MINIMAP_WORDS: Array<string> = [
  TRACE_MINIMAP_TITLE,
  TRACE_MINIMAP_ZOOMED_TITLE,
  TRACE_MINIMAP_LABEL,
  TRACE_MINIMAP_ZOOMED_LABEL,
  "Zoom in",
  "Zoom out",
  "Reset zoom",
];

const FLAME_GRAPH_WORDS: Array<string> = [
  FLAME_GRAPH_INSTRUCTIONS,
  "Reset Zoom",
  "No spans to display",
  "Service:",
  "Duration:",
  "Self Time:",
];

const WATERFALL_WORDS: Array<string> = [
  "Span",
  "Expand all",
  "Collapse all",
  "Resize the span name column",
  "Spans in this trace",
  "(unnamed span)",
  "This span has an error status",
  "This span was named in the link that opened this page",
  "Linked",
  "The same request, recorded twice (for example by the Kubernetes agent and by an SDK in the app). Shown inside the other recording so their spans read as one.",
  "Same request",
  "No spans match the current filters.",
  "Expand {{name}}",
  "Collapse {{name}}",
  "{{name}} · {{duration}} · starts {{offset}}",
];

const HEADER_WORDS: Array<string> = [
  "Duration",
  "Spans",
  "Services",
  "Errors",
  "Depth",
  "The deepest chain of nested spans",
  "Show only the spans with an error status",
  "No errors",
  "Trace",
  "Copy trace ID",
  "Copy link",
  "Link copied",
  "Copy a link to this trace",
  "Refresh",
  "Time spent by service",
  "(self time — click a service to filter the spans)",
  "Show all services",
  "of {{total}}",
  "{{percent}} of spans",
  "Started {{relative}} · {{time}}",
  "Started {{time}}",
  // Why a span's parent is missing: the orphan badge's tooltip.
  "This span names a parent span that was not received, so it is shown at the top level. The sender may have dropped the parent (for example, when its export queue was full), or the parent is still arriving: refresh in a few seconds for a recent trace.",
  "Each of these spans names a parent span that was not received, so it is shown at the top level. The sender may have dropped the parent (for example, when its export queue was full), or the parent is still arriving: refresh in a few seconds for a recent trace.",
  "This span names a parent span that is not among the spans loaded so far, so it is shown at the top level. The parent may be in a batch not loaded yet, so this may change as more spans load. Otherwise the sender may have dropped the parent (for example, when its export queue was full), or the parent is still arriving: refresh in a few seconds for a recent trace.",
  "Each of these spans names a parent span that is not among the spans loaded so far, so it is shown at the top level. The parent may be in a batch not loaded yet, so this may change as more spans load. Otherwise the sender may have dropped the parent (for example, when its export queue was full), or the parent is still arriving: refresh in a few seconds for a recent trace.",
];

const TOOLBAR_WORDS: Array<string> = [
  "Trace view",
  "Waterfall",
  "Flame graph",
  "Service map",
  "Operations",
  "Search spans by name, ID or service",
  "Search spans",
  "Previous match",
  "Next match",
  "Clear search",
  "Press / to search",
  "No span in this trace has an error status",
  "Show only spans with an error status",
  "Errors only",
  "Highlight the chain of spans that determined how long the trace took",
  "Critical path",
  "Critical path:",
  "Remove search filter",
  "Remove errors only filter",
  "Clear filters",
  "Large traces load in batches; totals above cover the loaded spans.",
  "Loading spans…",
  "Load more spans",
  "Loading trace",
  "No spans found for this trace",
  "Spans usually arrive within a minute of the request finishing. Refresh to check again, or look for its logs below.",
  "{{position}} of {{count}}",
  "Search: “{{search}}”",
  "Remove {{name}} filter",
  "Load all {{count}}",
];

const SPAN_PANEL_WORDS: Array<string> = [
  "Span details",
  "Close span details",
  "Copy a link to this span",
  "Error",
  "No error",
  "On critical path",
  "Self time",
  "Starts",
  "Children",
  "Where this span sits in the trace",
  "Zoom to span",
  "Open the session recording at the moment this span started",
  "Watch session",
  "Span ID",
  "Copy span ID",
  "Parent",
  "None — root span",
  "Attributes",
  "Events",
  "Logs",
  "Exceptions",
  "Links",
  "Profile samples",
  "This span has no attributes.",
  "No attributes match this filter.",
  "Filter attributes",
  "Find traces with this attribute value",
  "No events were recorded on this span.",
  "Event attributes",
  "event attributes",
  "No logs were written inside this span. The trace's logs are listed below the waterfall.",
  "No exceptions were recorded on this span.",
  "Exception",
  "View exception",
  "Stack trace",
  "This span does not link to other spans.",
  "Show span",
  "Open trace",
  "Link attributes",
  "link attributes",
  "{{offset}} into the trace",
  "Copy {{key}}",
  "Exception: {{name}}",
  "{{offset}} from the start of the trace",
  "trace {{traceId}}",
  "span {{spanId}}",
  "Select {{name}}",
  "Parent span {{spanId}} was not received",
  "Missing ({{spanId}}…)",
];

const OPERATIONS_WORDS: Array<string> = [
  "Operation",
  "Calls",
  "Total",
  "Avg",
  "Max",
  "Service and span name",
  "How many spans ran this operation",
  "Calls with an error status",
  "Time spent in the operation itself, excluding its child spans",
  "Sum of every call's duration",
  "Average call duration",
  "The slowest call",
  "No operations match the current filters.",
  "Show these spans in the waterfall",
  "Called many times from a single parent span. This is often an N+1 query or a loop that could be batched.",
  "×{{count}} from one parent",
];

const SERVICE_MAP_WORDS: Array<string> = [
  "No services found in this trace",
  "Service flow for this trace. Arrows show cross-service calls with count and latency. Click a service or call to open its slowest span.",
  "{{count}}x · avg {{duration}}",
];

const SIGNALS_WORDS: Array<string> = [
  "Related signals",
  "Logs, exceptions, metrics and profiles recorded during this trace.",
  "Metrics",
  "Exceptions for this Trace",
  "Exception instances captured on this trace's spans.",
  "No metric datapoints reference this trace.",
  "Logs that carry this trace's ID appear here.",
  "Metric",
  "Sampled values",
  "Min",
  "trace ids",
  "Metric links open the explorer over this trace's time window (±{{minutes}} min). Not carried over: {{fields}}.",
  "Open {{metric}} in the metric explorer over this trace's window",
  "(of {{count}})",
];

const LLM_WORDS: Array<string> = [
  "AI / LLM Call",
  "Provider",
  "Model",
  "Agent",
  "Tool",
  "User",
  "User ID",
  "Team",
  "End user (customer)",
  "Input tokens",
  "Output tokens",
  "Total tokens",
  "Cost",
  "not reported by SDK",
  "Latency",
  "Temperature",
  "Max tokens",
  "Top P",
  "Finish reason",
  "Prompt",
  "Completion",
  "message",
  "(no text content)",
];

const TRACE_VIEW_WORDS: Array<string> = Array.from(
  new Set<string>([
    ...MINIMAP_WORDS,
    ...FLAME_GRAPH_WORDS,
    ...WATERFALL_WORDS,
    ...HEADER_WORDS,
    ...TOOLBAR_WORDS,
    ...SPAN_PANEL_WORDS,
    ...OPERATIONS_WORDS,
    ...SERVICE_MAP_WORDS,
    ...SIGNALS_WORDS,
    ...LLM_WORDS,
  ]),
);

// The trace view's count-dependent sentences.
const ORPHAN_SPANS: PluralTemplate = {
  one: "{{count}} span missing a parent",
  other: "{{count}} spans missing a parent",
};
const ORPHAN_SPANS_SO_FAR: PluralTemplate = {
  one: "{{count}} span missing a parent so far",
  other: "{{count}} spans missing a parent so far",
};
const HIDDEN_SPANS: PluralTemplate = {
  one: "{{count}} hidden span",
  other: "{{count}} hidden spans",
};
const SPANS_MATCH: PluralTemplate = {
  one: "{{count}} span of {{total}} match",
  other: "{{count}} spans of {{total}} match",
};
const CRITICAL_PATH_SUMMARY: PluralTemplate = {
  one: "{{count}} span · outlined in the waterfall; other spans are dimmed",
  other: "{{count}} spans · outlined in the waterfall; other spans are dimmed",
};
const SHOWING_FIRST: PluralTemplate = {
  one: "Showing the first {{count}} span.",
  other: "Showing the first {{count}} spans.",
};
const SHOWING_OF: PluralTemplate = {
  one: "Showing {{loaded}} of {{count}} span.",
  other: "Showing {{loaded}} of {{count}} spans.",
};
const LOAD_MORE: PluralTemplate = {
  one: "Load {{count}} more span",
  other: "Load {{count}} more spans",
};
const FILTER_ATTRIBUTES: PluralTemplate = {
  one: "Filter {{count}} attribute",
  other: "Filter {{count}} attributes",
};
const TRACE_PROFILE_SCOPE: PluralTemplate = {
  one: "Flame graph built from the {{count}} profile sample linked to the spans of this trace.",
  other:
    "Flame graph built from the {{count}} profile samples linked to the spans of this trace.",
};
const SPAN_PROFILE_SCOPE: PluralTemplate = {
  one: "Flame graph built from the {{count}} profile sample linked to this span.",
  other:
    "Flame graph built from the {{count}} profile samples linked to this span.",
};
const SPAN_PROFILE_SCOPE_WITH_ONE_CHILD: PluralTemplate = {
  one: "Flame graph built from the {{count}} profile sample linked to this span and the {{spans}} span nested under it.",
  other:
    "Flame graph built from the {{count}} profile samples linked to this span and the {{spans}} span nested under it.",
};
const SPAN_PROFILE_SCOPE_WITH_CHILDREN: PluralTemplate = {
  one: "Flame graph built from the {{count}} profile sample linked to this span and the {{spans}} spans nested under it.",
  other:
    "Flame graph built from the {{count}} profile samples linked to this span and the {{spans}} spans nested under it.",
};
const SPAN_PROFILE_SCOPE_WITH_NEAREST_CHILDREN: PluralTemplate = {
  one: "Flame graph built from the {{count}} profile sample linked to this span and the nearest {{included}} of the {{spans}} spans nested under it.",
  other:
    "Flame graph built from the {{count}} profile samples linked to this span and the nearest {{included}} of the {{spans}} spans nested under it.",
};

const TRACE_VIEW_COUNTS: Array<PluralTemplate> = [
  SPAN_COUNT,
  ERROR_COUNT,
  ATTRIBUTE_COUNT,
  EXCEPTION_COUNT,
  MATCH_COUNT,
  ORPHAN_SPANS,
  ORPHAN_SPANS_SO_FAR,
  HIDDEN_SPANS,
  SPANS_MATCH,
  CRITICAL_PATH_SUMMARY,
  SHOWING_FIRST,
  SHOWING_OF,
  LOAD_MORE,
  FILTER_ATTRIBUTES,
  TRACE_PROFILE_SCOPE,
  SPAN_PROFILE_SCOPE,
  SPAN_PROFILE_SCOPE_WITH_ONE_CHILD,
  SPAN_PROFILE_SCOPE_WITH_CHILDREN,
  SPAN_PROFILE_SCOPE_WITH_NEAREST_CHILDREN,
];

// Every locale key the counts are stored under: the general form and _one.
const COUNT_KEYS: Array<{ key: string; english: string; isOne: boolean }> =
  TRACE_VIEW_COUNTS.flatMap((template: PluralTemplate) => {
    return [
      { key: template.other, english: template.other, isOne: false },
      { key: `${template.other}_one`, english: template.one, isOne: true },
    ];
  });

/*
 * ---------------------------------------------------------------------------
 * The reader's translator, over the language's own i18next instance
 * ---------------------------------------------------------------------------
 */

const INSTANCES: Record<string, i18n> = {};

// What useTranslator hands a component under that language's instance.
const translatorFor: (language: string) => Translator = (
  language: string,
): Translator => {
  const instance: i18n = INSTANCES[language] as i18n;

  return createTranslator((text: string): string | undefined => {
    const translated: unknown = instance.t(text, {
      defaultValue: text,
      keySeparator: false,
      nsSeparator: false,
    });

    return typeof translated === "string" ? translated : text;
  }, language);
};

const word: (language: string, english: string) => string = (
  language: string,
  english: string,
): string => {
  return translatorFor(language).translateText(english) || english;
};

const sentence: (
  language: string,
  template: string,
  values: TemplateValues,
) => string = (
  language: string,
  template: string,
  values: TemplateValues,
): string => {
  return translatorFor(language).translateTemplate(template, values);
};

const counted: (
  language: string,
  template: PluralTemplate,
  count: number,
  values?: TemplateValues,
) => string = (
  language: string,
  template: PluralTemplate,
  count: number,
  values: TemplateValues = {},
): string => {
  return translatorFor(language).translatePlural(template, count, values);
};

const escapeRegExp: (text: string) => string = (text: string): string => {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
};

/*
 * A sentence whose values are dates or times the test does not pin down
 * (how long ago a trace started): the language's wording around them.
 */
const sentenceShape: (language: string, template: string) => RegExp = (
  language: string,
  template: string,
): RegExp => {
  const wording: string = word(language, template);

  return new RegExp(
    `^${wording
      .split(/\{\{[^}]+\}\}/)
      .map(escapeRegExp)
      .join(".+")}$`,
  );
};

const inLanguage: (
  language: string,
  element: React.ReactElement,
) => React.ReactElement = (
  language: string,
  element: React.ReactElement,
): React.ReactElement => {
  return (
    <I18nextProvider i18n={INSTANCES[language] as i18n}>
      {element}
    </I18nextProvider>
  );
};

const settle: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 20);
    });
  });
};

const textOf: (element: Element | null) => string = (
  element: Element | null,
): string => {
  return (element?.textContent || "").replace(/\s+/g, " ").trim();
};

/*
 * ---------------------------------------------------------------------------
 * A checkout trace, as the trace page reads it
 * ---------------------------------------------------------------------------
 */

const TRACE_ID: string = "4bf92f3577b34da6a3ce929d0e0e4736";
const GATEWAY: string = "60000000-0000-4000-8000-000000000001";
const INVENTORY: string = "60000000-0000-4000-8000-000000000002";
const CHECKOUT: string = "60000000-0000-4000-8000-000000000003";
const MS: number = 1_000_000;
const EPOCH_MS: number = Date.UTC(2026, 9, 30, 12, 0, 0);
const PROFILE_SAMPLES: number = 42;

interface SpanDefinition {
  spanId: string;
  parentSpanId: string;
  name: string;
  serviceId: string;
  startMs: number;
  durationMs: number;
  isError?: boolean;
  kind?: SpanKind;
}

const makeSpan: (definition: SpanDefinition) => Span = (
  definition: SpanDefinition,
): Span => {
  const start: number = (EPOCH_MS + definition.startMs) * MS;

  return Object.assign(new Span(), {
    traceId: TRACE_ID,
    spanId: definition.spanId,
    parentSpanId: definition.parentSpanId,
    name: definition.name,
    kind: definition.kind || SpanKind.Internal,
    statusCode: definition.isError ? SpanStatus.Error : SpanStatus.Ok,
    primaryEntityId: new ObjectID(definition.serviceId),
    startTime: new Date(EPOCH_MS + definition.startMs),
    endTime: new Date(EPOCH_MS + definition.startMs + definition.durationMs),
    startTimeUnixNano: start,
    endTimeUnixNano: start + definition.durationMs * MS,
    durationUnixNano: definition.durationMs * MS,
    k8sPodEntityKey: "",
  });
};

/*
 *   POST /api/v1/checkout (gateway, 0-1000ms)
 *   ├── auth.verifyToken (gateway)
 *   ├── POST /reserve (inventory, error)
 *   │   └── UPDATE stock (inventory)
 *   ├── OrderService.validateCart (checkout)
 *   │   └── SELECT products WHERE id = $1  × 12   (an N+1)
 *   cache.lookup (checkout), whose parent was never received
 */
const checkoutDefinitions: () => Array<SpanDefinition> =
  (): Array<SpanDefinition> => {
    const definitions: Array<SpanDefinition> = [
      {
        spanId: "root",
        parentSpanId: "",
        name: "POST /api/v1/checkout",
        serviceId: GATEWAY,
        startMs: 0,
        durationMs: 1000,
        kind: SpanKind.Server,
      },
      {
        spanId: "auth",
        parentSpanId: "root",
        name: "auth.verifyToken",
        serviceId: GATEWAY,
        startMs: 5,
        durationMs: 20,
      },
      {
        spanId: "reserve",
        parentSpanId: "root",
        name: "POST /reserve",
        serviceId: INVENTORY,
        startMs: 100,
        durationMs: 300,
        isError: true,
        kind: SpanKind.Client,
      },
      {
        spanId: "update",
        parentSpanId: "reserve",
        name: "UPDATE stock",
        serviceId: INVENTORY,
        startMs: 150,
        durationMs: 200,
      },
      {
        spanId: "validate",
        parentSpanId: "root",
        name: "OrderService.validateCart",
        serviceId: CHECKOUT,
        startMs: 440,
        durationMs: 60,
      },
      {
        spanId: "orphan",
        parentSpanId: "feedfacecafebeef",
        name: "cache.lookup",
        serviceId: CHECKOUT,
        startMs: 600,
        durationMs: 10,
      },
    ];

    for (let index: number = 0; index < 12; index++) {
      definitions.push({
        spanId: `query-${index}`,
        parentSpanId: "validate",
        name: "SELECT products WHERE id = $1",
        serviceId: CHECKOUT,
        startMs: 442 + index * 4,
        durationMs: 3,
      });
    }

    return definitions;
  };

const services: () => Array<Service> = (): Array<Service> => {
  return [
    Object.assign(new Service(), {
      _id: GATEWAY,
      name: "api-gateway",
      serviceColor: new Color("#6366f1"),
    }),
    Object.assign(new Service(), {
      _id: INVENTORY,
      name: "inventory-service",
      serviceColor: new Color("#f59e0b"),
    }),
    Object.assign(new Service(), {
      _id: CHECKOUT,
      name: "checkout-service",
      serviceColor: new Color("#10b981"),
    }),
  ];
};

// Ten attributes: more than the panel lists without a filter box.
const MANY_ATTRIBUTES: JSONObject = {
  "db.system": "postgresql",
  "db.statement": "UPDATE stock SET quantity = $1",
  "http.status_code": 409,
  "custom.key1": "value 1",
  "custom.key2": "value 2",
  "custom.key3": "value 3",
  "custom.key4": "value 4",
  "custom.key5": "value 5",
  "custom.key6": "value 6",
  "custom.key7": "value 7",
};

// What the panel reads of each span when it opens: its full record.
const spanDetail: (spanId: string) => Partial<Span> = (
  spanId: string,
): Partial<Span> => {
  const start: number = (EPOCH_MS + 150) * MS;

  if (spanId === "update") {
    return {
      attributes: MANY_ATTRIBUTES,
      sessionId: "session-1",
      statusMessage: "",
      events: [
        {
          name: "lock.acquired",
          time: new Date(EPOCH_MS + 170),
          timeUnixNano: start + 20 * MS,
          attributes: { "lock.wait_ms": 18 },
        },
        {
          name: "exception",
          time: new Date(EPOCH_MS + 330),
          timeUnixNano: start + 180 * MS,
          attributes: {
            "exception.type": "SerializationError",
            "exception.message": "could not serialize access",
          },
        },
      ] as Span["events"],
      links: [
        { traceId: TRACE_ID, spanId: "auth" },
        {
          traceId: "0af7651916cd43dd8448eb211c80319c",
          spanId: "b7ad6b7169203331",
          attributes: { "link.reason": "retry" },
        },
      ] as Span["links"],
    } as Partial<Span>;
  }

  // Everything else carries nothing: every tab says so.
  return {
    attributes: {},
    events: [],
    links: [],
    statusMessage: "",
  } as Partial<Span>;
};

const EXCEPTIONS: Array<ExceptionInstance> = [
  Object.assign(new ExceptionInstance(), {
    exceptionType: "InventoryReservationError",
    message: "",
    fingerprint: "9f86d081884c7d659a2feaa0c55ad015",
    stackTrace:
      "InventoryReservationError\\n    at reserve (inventory.ts:12:3)",
    time: new Date(EPOCH_MS + 390),
  }),
];

// Six samples of one metric (more than the table lists) and one of another.
const METRIC_ITEMS: Array<JSONObject> = [
  ...[1, 2, 3, 4, 5, 6].map((index: number): JSONObject => {
    return {
      name: "http.server.duration",
      time: new Date(EPOCH_MS + index).toISOString(),
      value: 1000 + index,
      spanId: "root",
      serviceId: GATEWAY,
      attributes: {},
    };
  }),
  {
    name: "db.client.connections.usage",
    time: new Date(EPOCH_MS).toISOString(),
    value: 4,
    spanId: "update",
    serviceId: INVENTORY,
    attributes: {},
  },
];

interface Backend {
  traceSpans: Array<Span>;
}

let backend: Backend = { traceSpans: [] };

type ListArgs = {
  modelType: unknown;
  query: JSONObject;
  skip: number;
  limit: number;
};

type PostArgs = { url: { toString: () => string }; data: JSONObject };

const installBackend: () => void = (): void => {
  serviceListMock.mockImplementation(async () => {
    return { data: services(), count: 3, skip: 0, limit: 10000 };
  });

  countMock.mockImplementation(async (modelType: unknown) => {
    return modelType === Span ? backend.traceSpans.length : 0;
  });

  getListMock.mockImplementation(async (args: ListArgs) => {
    if (args.modelType === Span && args.query["spanId"]) {
      return {
        data: [
          Object.assign(new Span(), spanDetail(String(args.query["spanId"]))),
        ],
        count: 1,
        skip: 0,
        limit: 1,
      };
    }

    if (args.modelType === Span) {
      const page: Array<Span> = backend.traceSpans.slice(
        args.skip,
        args.skip + args.limit,
      );
      const hasMore: boolean =
        backend.traceSpans.length > args.skip + args.limit;

      return {
        data: page,
        count: args.skip + page.length + (hasMore ? 1 : 0),
        skip: args.skip,
        limit: args.limit,
        hasMore,
      };
    }

    if (args.modelType === ExceptionInstance) {
      const rows: Array<ExceptionInstance> =
        args.query["spanId"] === "reserve" ? EXCEPTIONS : [];
      return { data: rows, count: rows.length, skip: 0, limit: 50 };
    }

    return { data: [], count: 0, skip: 0, limit: 10 };
  });

  postMock.mockImplementation(async (args: PostArgs) => {
    const url: string = args.url.toString();

    if (url.includes("/telemetry/profiles/trace-presence")) {
      return new HTTPResponse(200, { sampleCount: PROFILE_SAMPLES }, {});
    }

    if (url.includes("/telemetry/metrics/for-trace")) {
      return new HTTPResponse(200, { items: METRIC_ITEMS }, {});
    }

    return new HTTPResponse(200, {}, {});
  });
};

const renderTrace: (
  language: string,
  spans?: Array<Span>,
  // What the page shows once it has read the trace.
  loadedTestId?: string,
) => Promise<void> = async (
  language: string,
  spans?: Array<Span>,
  loadedTestId: string = "trace-header",
): Promise<void> => {
  backend = { traceSpans: spans || checkoutDefinitions().map(makeSpan) };

  await act(async () => {
    render(inLanguage(language, <TraceExplorer traceId={TRACE_ID} />));
  });

  await screen.findByTestId(loadedTestId);
  await settle();
};

const row: (spanId: string) => HTMLElement = (spanId: string): HTMLElement => {
  return document.querySelector(`[data-span-id="${spanId}"]`) as HTMLElement;
};

// Opens a span's panel and waits for its full record.
const openSpan: (spanId: string) => Promise<HTMLElement> = async (
  spanId: string,
): Promise<HTMLElement> => {
  fireEvent.click(row(spanId));

  const panel: HTMLElement = await screen.findByTestId("trace-span-panel");

  await waitFor(() => {
    expect(
      within(panel).getByTestId("span-panel-tab-attributes"),
    ).toHaveTextContent(/\d/);
  });
  await settle();

  return panel;
};

const openTab: (tab: string) => Promise<void> = async (
  tab: string,
): Promise<void> => {
  fireEvent.click(screen.getByTestId(`span-panel-tab-${tab}`));
  await settle();
};

/*
 * ---------------------------------------------------------------------------
 * The waterfall's own tree, and the minimap over it
 * ---------------------------------------------------------------------------
 */

const waterfallSpan: (
  spanId: string,
  parentSpanId: string,
  startMs: number,
  durationMs: number,
  overrides?: Partial<WaterfallSpan>,
) => WaterfallSpan = (
  spanId: string,
  parentSpanId: string,
  startMs: number,
  durationMs: number,
  overrides: Partial<WaterfallSpan> = {},
): WaterfallSpan => {
  return {
    spanId,
    parentSpanId,
    name: spanId,
    serviceId: "svc-gateway",
    startTimeUnixNano: startMs * MS,
    endTimeUnixNano: (startMs + durationMs) * MS,
    durationUnixNano: durationMs * MS,
    isError: false,
    kind: SpanKind.Internal,
    ...overrides,
  };
};

const WATERFALL_SERVICES: Map<string, TraceServiceInfo> = new Map([
  ["svc-gateway", { id: "svc-gateway", name: "api-gateway", color: "#6366f1" }],
  [
    "svc-inventory",
    { id: "svc-inventory", name: "inventory-service", color: "#f59e0b" },
  ],
]);

/*
 * A request recorded twice under the same caller (an eBPF server span and an
 * SDK one, nested in time), a failed call, a span with no name and a span
 * named by the link that opened the page.
 */
const waterfallTree: () => SpanTree = (): SpanTree => {
  return buildSpanTree([
    waterfallSpan("root", "", 0, 1000, { name: "POST /api/v1/checkout" }),
    waterfallSpan("call", "root", 100, 400, {
      name: "POST /reserve",
      kind: SpanKind.Client,
      isError: true,
    }),
    waterfallSpan("agent", "call", 110, 380, {
      name: "POST /reserve (agent)",
      serviceId: "svc-inventory",
      kind: SpanKind.Server,
    }),
    waterfallSpan("sdk", "call", 115, 360, {
      name: "POST /reserve (sdk)",
      serviceId: "svc-inventory",
      kind: SpanKind.Server,
    }),
    waterfallSpan("nameless", "root", 600, 50, { name: "" }),
    waterfallSpan("linked", "root", 700, 100, { name: "auth.verifyToken" }),
  ]);
};

const renderWaterfall: (
  language: string,
  options: { collapsed?: Array<string>; empty?: boolean },
) => void = (
  language: string,
  options: { collapsed?: Array<string>; empty?: boolean },
): void => {
  const tree: SpanTree = waterfallTree();
  const noop: () => void = (): void => {
    return undefined;
  };

  render(
    inLanguage(
      language,
      <TraceWaterfall
        tree={tree}
        rows={
          options.empty
            ? []
            : flattenVisibleRows(tree, new Set(options.collapsed || []), null)
        }
        serviceInfoById={WATERFALL_SERVICES}
        selectedSpanId={null}
        onSelectSpan={noop}
        onSetCollapsed={noop}
        onExpandAll={noop}
        onCollapseAll={noop}
        linkedSpanIds={new Set(["linked"])}
        criticalPathSpanIds={null}
        searchText=""
        viewport={FULL_VIEWPORT}
        onViewportChange={noop}
        revealRequest={0}
        emptyMessage="No spans match the current filters."
      />,
    ),
  );
};

const minimapTrack: () => HTMLElement = (): HTMLElement => {
  return within(screen.getByTestId("trace-minimap")).getByRole("img");
};

const renderMinimap: (language: string, viewport: TimeViewport) => void = (
  language: string,
  viewport: TimeViewport,
): void => {
  render(
    inLanguage(
      language,
      <TraceTimelineMinimap
        tree={waterfallTree()}
        serviceInfoById={WATERFALL_SERVICES}
        viewport={viewport}
        onViewportChange={(): void => {
          return undefined;
        }}
      />,
    ),
  );
};

/*
 * ---------------------------------------------------------------------------
 * An LLM call, as the span panel's LLM tab hands it
 * ---------------------------------------------------------------------------
 */

const LLM_ATTRIBUTES: JSONObject = {
  "gen_ai.system": "openai",
  "gen_ai.operation.name": "chat",
  "gen_ai.request.model": "gpt-4o",
  "gen_ai.agent.name": "triage-bot",
  "gen_ai.tool.name": "search_runbooks",
  "user.email": "dana@example.com",
  "user.id": "u-42",
  "team.id": "sre",
  "gen_ai.user": "customer-981",
  "gen_ai.usage.input_tokens": 1200,
  "gen_ai.usage.output_tokens": 300,
  "gen_ai.request.temperature": "0.2",
  "gen_ai.request.max_tokens": "1024",
  "gen_ai.request.top_p": "0.9",
  "gen_ai.response.finish_reasons": "stop",
  // A prompt that names no role, and an answer that says nothing.
  "gen_ai.prompt.0.content": "Summarise the incident",
  "gen_ai.completion.0.role": "assistant",
};

beforeAll(async () => {
  for (const language of LANGUAGES) {
    const instance: i18n = createInstance();

    // The Dashboard's own configuration (Utils/i18n.ts): default separators.
    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: ENGLISH },
        [language]: { translation: LOCALES[language] as Locale },
      },
      interpolation: { escapeValue: false },
    });

    INSTANCES[language] = instance;
  }
});

beforeEach(() => {
  installBackend();
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  countMock.mockReset();
  serviceListMock.mockReset();
  postMock.mockReset();
  logsViewerProps.mockReset();
  exceptionTableProps.mockReset();
});

/*
 * ---------------------------------------------------------------------------
 * The words, in the Dashboard's locales
 * ---------------------------------------------------------------------------
 */

describe("the trace view's words, in the Dashboard's locales", () => {
  test("every Dashboard language is read: English and the 16 others", () => {
    expect(LANGUAGES).toHaveLength(17);
    expect(OTHER_LANGUAGES).toEqual(
      expect.arrayContaining(["de", "ja", "fa", "zh-TW"]),
    );
  });

  test("each word is a key of the Dashboard's English, drawn as itself", () => {
    expect(
      TRACE_VIEW_WORDS.filter((english: string): boolean => {
        return ENGLISH[english] !== english;
      }),
    ).toEqual([]);
  });

  test("each count is a plural of the Dashboard's English: its sentence, and its _one form", () => {
    expect(
      COUNT_KEYS.filter((entry: { key: string; english: string }): boolean => {
        return ENGLISH[entry.key] !== entry.english;
      }),
    ).toEqual([]);
  });

  test.each(OTHER_LANGUAGES)(
    "%s has its own wording for each word and count, or says it as English does on record",
    (language: string) => {
      const kept: Array<string> = sameAsEnglish(language);
      const locale: Locale = LOCALES[language] as Locale;

      const isUntranslated: (key: string, english: string) => boolean = (
        key: string,
        english: string,
      ): boolean => {
        const value: unknown = locale[key];

        return (
          typeof value !== "string" ||
          !value.trim() ||
          (value === english && !kept.includes(english))
        );
      };

      expect(
        TRACE_VIEW_WORDS.filter((english: string): boolean => {
          return isUntranslated(english, english);
        }),
      ).toEqual([]);
      expect(
        COUNT_KEYS.filter(
          (entry: { key: string; english: string; isOne: boolean }) => {
            // Japanese, Korean and Chinese never read a _one form.
            if (entry.isOne && NO_ONE_FORM.includes(language)) {
              return false;
            }
            return isUntranslated(entry.key, entry.english);
          },
        ).map((entry: { key: string }): string => {
          return entry.key;
        }),
      ).toEqual([]);
    },
  );

  test.each(LANGUAGES)(
    "%s tells the minimap's four sentences apart, and the views, tabs and toolbar buttons from one another",
    (language: string) => {
      const groups: Array<Array<string>> = [
        [
          TRACE_MINIMAP_TITLE,
          TRACE_MINIMAP_ZOOMED_TITLE,
          TRACE_MINIMAP_LABEL,
          TRACE_MINIMAP_ZOOMED_LABEL,
        ],
        ["Waterfall", "Flame graph", "Service map", "Operations"],
        [
          "Attributes",
          "Events",
          "Logs",
          "Exceptions",
          "Links",
          "Profile samples",
        ],
        ["Errors only", "Critical path"],
        ["Zoom in", "Zoom out", "Reset zoom"],
        ["Expand all", "Collapse all"],
      ];

      for (const group of groups) {
        const words: Array<string> = group.map((english: string): string => {
          return word(language, english).toLocaleLowerCase(language);
        });

        expect(new Set(words).size).toBe(words.length);
      }
    },
  );
});

/*
 * ---------------------------------------------------------------------------
 * The real components, mounted in every language
 * ---------------------------------------------------------------------------
 */

describe.each(LANGUAGES)("the trace view in %s", (language: string) => {
  test("the minimap says what a drag does, and while zoomed what a double-click does, to the eye and to a screen reader", () => {
    renderMinimap(language, FULL_VIEWPORT);

    expect(minimapTrack()).toHaveAttribute(
      "title",
      word(language, TRACE_MINIMAP_TITLE),
    );
    expect(minimapTrack()).toHaveAttribute(
      "aria-label",
      word(language, TRACE_MINIMAP_LABEL),
    );
    expect(
      screen.getByRole("button", { name: word(language, "Zoom in") }),
    ).toHaveAttribute("title", word(language, "Zoom in"));
    expect(
      screen.getByRole("button", { name: word(language, "Zoom out") }),
    ).toBeDisabled();
    expect(screen.queryByTestId("trace-reset-zoom")).toBeNull();

    cleanup();
    renderMinimap(language, { start: 0.2, end: 0.4 });

    expect(minimapTrack()).toHaveAttribute(
      "title",
      word(language, TRACE_MINIMAP_ZOOMED_TITLE),
    );
    expect(minimapTrack()).toHaveAttribute(
      "aria-label",
      word(language, TRACE_MINIMAP_ZOOMED_LABEL),
    );
    expect(
      screen.getByRole("button", { name: word(language, "Zoom out") }),
    ).toBeEnabled();
    expect(textOf(screen.getByTestId("trace-reset-zoom"))).toBe(
      word(language, "Reset zoom"),
    );
  });

  test("the flame graph says what a click and a double-click do, labels its hover card and each block's tooltip, and resets its zoom", () => {
    const spans: Array<Span> = checkoutDefinitions().slice(0, 5).map(makeSpan);

    render(
      inLanguage(
        language,
        <FlameGraph
          spans={spans}
          telemetryServices={services()}
          selectedSpanId={undefined}
        />,
      ),
    );

    expect(textOf(screen.getByTestId("flame-graph-instructions"))).toBe(
      word(language, FLAME_GRAPH_INSTRUCTIONS),
    );

    const block: HTMLElement = screen.getByTitle(/^OrderService\.validateCart/);
    const titleLines: Array<string> = (block.getAttribute("title") || "").split(
      "\n",
    );

    expect(titleLines).toHaveLength(3);
    expect(titleLines[0]).toBe("OrderService.validateCart (checkout-service)");
    expect(titleLines[1]!.startsWith(`${word(language, "Duration:")} `)).toBe(
      true,
    );
    expect(titleLines[2]!.startsWith(`${word(language, "Self Time:")} `)).toBe(
      true,
    );

    // Pointing at a block opens its card, each value under its label.
    fireEvent.mouseEnter(block);
    for (const label of ["Service:", "Duration:", "Self Time:"]) {
      expect(screen.getByText(word(language, label))).toBeInTheDocument();
    }

    // A double-click zooms into the block's subtree, and offers the way back.
    expect(
      screen.queryByRole("button", { name: word(language, "Reset Zoom") }),
    ).toBeNull();
    fireEvent.doubleClick(block);
    expect(
      screen.getByRole("button", { name: word(language, "Reset Zoom") }),
    ).toBeVisible();

    cleanup();
    render(
      inLanguage(
        language,
        <FlameGraph
          spans={[]}
          telemetryServices={services()}
          selectedSpanId={undefined}
        />,
      ),
    );
    expect(
      screen.getByText(word(language, "No spans to display")),
    ).toBeInTheDocument();
  });

  test("the waterfall names its column, its tree and its handle, and badges, toggles and tooltips each row in the language's words", () => {
    renderWaterfall(language, { collapsed: ["agent"] });

    const header: HTMLElement = screen.getByTestId("trace-expand-all")
      .parentElement!.parentElement as HTMLElement;

    expect(
      within(header).getByText(word(language, "Span")),
    ).toBeInTheDocument();
    expect(textOf(screen.getByTestId("trace-expand-all"))).toBe(
      word(language, "Expand all"),
    );
    expect(textOf(screen.getByTestId("trace-collapse-all"))).toBe(
      word(language, "Collapse all"),
    );
    expect(screen.getByRole("separator")).toHaveAttribute(
      "aria-label",
      word(language, "Resize the span name column"),
    );
    expect(screen.getByRole("tree")).toHaveAttribute(
      "aria-label",
      word(language, "Spans in this trace"),
    );

    // An open row's toggle collapses it; a collapsed one expands it.
    expect(within(row("root")).getByTestId("trace-row-toggle")).toHaveAttribute(
      "aria-label",
      sentence(language, "Collapse {{name}}", {
        name: "POST /api/v1/checkout",
      }),
    );
    expect(
      within(row("agent")).getByTestId("trace-row-toggle"),
    ).toHaveAttribute(
      "aria-label",
      sentence(language, "Expand {{name}}", { name: "POST /reserve (agent)" }),
    );

    // The collapsed row says how many spans it hides.
    expect(
      within(row("agent")).getByTitle(counted(language, HIDDEN_SPANS, 1)),
    ).toHaveTextContent("+1");

    // The failed call's mark, the link's badge and the same request's.
    expect(
      within(row("call")).getByTitle(
        word(language, "This span has an error status"),
      ),
    ).toBeInTheDocument();
    expect(
      within(row("linked")).getByTitle(
        word(language, "This span was named in the link that opened this page"),
      ),
    ).toHaveTextContent(word(language, "Linked"));

    cleanup();
    renderWaterfall(language, {});

    const sameRequest: HTMLElement = within(row("sdk")).getByTestId(
      "trace-row-same-request",
    );
    expect(sameRequest).toHaveTextContent(word(language, "Same request"));
    expect(sameRequest).toHaveAttribute(
      "title",
      word(
        language,
        "The same request, recorded twice (for example by the Kubernetes agent and by an SDK in the app). Shown inside the other recording so their spans read as one.",
      ),
    );

    // A span with no name is named for that, in the reader's words.
    expect(
      within(row("nameless")).getByText(word(language, "(unnamed span)")),
    ).toBeInTheDocument();

    // A bar's tooltip: the span, its duration and when it starts.
    const bar: HTMLElement = within(row("call")).getByTestId(
      "trace-waterfall-bar",
    ).parentElement as HTMLElement;
    expect(bar).toHaveAttribute(
      "title",
      sentence(language, "{{name}} · {{duration}} · starts {{offset}}", {
        name: "POST /reserve",
        duration: formatDurationNano(400 * MS),
        offset: `+${formatDurationNano(100 * MS)}`,
      }),
    );

    cleanup();
    renderWaterfall(language, { empty: true });
    expect(textOf(screen.getByTestId("trace-waterfall-empty"))).toBe(
      word(language, "No spans match the current filters."),
    );
  });

  test("the header names each number, the trace's status, when it started and where its time went", async () => {
    await renderTrace(language);

    for (const [testId, label] of [
      ["trace-stat-duration", "Duration"],
      ["trace-stat-spans", "Spans"],
      ["trace-stat-services", "Services"],
      ["trace-stat-errors", "Errors"],
      ["trace-stat-depth", "Depth"],
    ] as Array<[string, string]>) {
      expect(textOf(screen.getByTestId(testId).querySelector("dt"))).toBe(
        word(language, label),
      );
    }
    expect(screen.getByTestId("trace-stat-depth")).toHaveAttribute(
      "title",
      word(language, "The deepest chain of nested spans"),
    );

    // One of the 18 spans failed: the status counts it, the number says its share.
    expect(textOf(screen.getByTestId("trace-status"))).toBe(
      counted(language, ERROR_COUNT, 1),
    );
    const errors: HTMLElement = within(
      screen.getByTestId("trace-stat-errors"),
    ).getByRole("button");
    expect(errors).toHaveAttribute(
      "title",
      word(language, "Show only the spans with an error status"),
    );
    expect(errors).toHaveTextContent(
      sentence(language, "{{percent}} of spans", { percent: "5.6%" }),
    );

    const header: HTMLElement = screen.getByTestId("trace-header");
    expect(
      within(header).getByText(word(language, "Trace"), { selector: "span" }),
    ).toBeInTheDocument();
    expect(
      within(header).getByRole("button", {
        name: word(language, "Copy trace ID"),
      }),
    ).toBeInTheDocument();
    expect(
      within(header).getByRole("button", {
        name: word(language, "Copy a link to this trace"),
      }),
    ).toHaveTextContent(word(language, "Copy link"));

    // When it started: how long ago, then when, worded by the language.
    const started: HTMLElement = within(header).getByTitle(/2026/);
    expect(
      [
        sentenceShape(language, "Started {{relative}} · {{time}}"),
        sentenceShape(language, "Started {{time}}"),
      ].some((shape: RegExp): boolean => {
        return shape.test(textOf(started));
      }),
    ).toBe(true);
    if (language !== "en") {
      expect(textOf(started).startsWith("Started ")).toBe(false);
    }

    // The span whose parent never arrived is counted, and the badge says why.
    const orphans: HTMLElement = screen.getByTestId("trace-orphans");
    expect(textOf(orphans)).toBe(counted(language, ORPHAN_SPANS, 1));
    expect(orphans).toHaveAttribute(
      "title",
      word(
        language,
        "This span names a parent span that was not received, so it is shown at the top level. The sender may have dropped the parent (for example, when its export queue was full), or the parent is still arriving: refresh in a few seconds for a recent trace.",
      ),
    );

    const breakdown: HTMLElement = screen.getByTestId(
      "trace-service-breakdown",
    );
    expect(breakdown).toHaveTextContent(
      word(language, "Time spent by service"),
    );
    expect(breakdown).toHaveTextContent(
      word(language, "(self time — click a service to filter the spans)"),
    );

    // The chips count each service's spans and errors.
    const chips: Array<HTMLElement> =
      screen.getAllByTestId("trace-service-chip");
    const inventory: HTMLElement = chips.find((chip: HTMLElement) => {
      return chip.textContent?.includes("inventory-service");
    })!;
    expect(inventory).toHaveTextContent(counted(language, SPAN_COUNT, 2));
    expect(inventory).toHaveTextContent(counted(language, ERROR_COUNT, 1));

    // Picking one offers to show them all again.
    expect(screen.queryByText(word(language, "Show all services"))).toBeNull();
    fireEvent.click(inventory);
    expect(
      screen.getByText(word(language, "Show all services")),
    ).toBeInTheDocument();
  });

  test("the toolbar names its views, its search and its two toggles, and the summary says what the filters keep", async () => {
    await renderTrace(language);

    const views: HTMLElement = screen.getByTestId("trace-view");
    expect(views).toHaveAttribute("aria-label", word(language, "Trace view"));
    for (const [value, label] of [
      ["waterfall", "Waterfall"],
      ["flamegraph", "Flame graph"],
      ["servicemap", "Service map"],
      ["operations", "Operations"],
    ] as Array<[string, string]>) {
      expect(textOf(screen.getByTestId(`trace-view-${value}`))).toContain(
        word(language, label),
      );
    }

    const search: HTMLElement = screen.getByTestId("trace-search");
    expect(search).toHaveAttribute(
      "placeholder",
      word(language, "Search spans by name, ID or service"),
    );
    expect(search).toHaveAttribute(
      "aria-label",
      word(language, "Search spans"),
    );
    expect(
      screen.getByTitle(word(language, "Press / to search")),
    ).toHaveTextContent("/");

    const errorsOnly: HTMLElement = screen.getByTestId("trace-errors-only");
    expect(errorsOnly).toHaveTextContent(word(language, "Errors only"));
    expect(errorsOnly).toHaveAttribute(
      "title",
      word(language, "Show only spans with an error status"),
    );
    const criticalPath: HTMLElement = screen.getByTestId("trace-critical-path");
    expect(criticalPath).toHaveTextContent(word(language, "Critical path"));
    expect(criticalPath).toHaveAttribute(
      "title",
      word(
        language,
        "Highlight the chain of spans that determined how long the trace took",
      ),
    );

    // Twelve spans run the same query: the search counts them.
    fireEvent.change(search, { target: { value: "SELECT" } });
    await settle();

    expect(textOf(screen.getByTestId("trace-search-count"))).toBe(
      counted(language, MATCH_COUNT, 12),
    );
    for (const name of ["Previous match", "Next match", "Clear search"]) {
      expect(
        screen.getByRole("button", { name: word(language, name) }),
      ).toBeInTheDocument();
    }

    const summary: HTMLElement = screen.getByTestId("trace-filter-summary");
    expect(summary).toHaveTextContent(
      counted(language, SPANS_MATCH, 12, {
        total: translatorFor(language).formatNumber(18),
      }),
    );
    expect(summary).toHaveTextContent(
      sentence(language, "Search: “{{search}}”", { search: "SELECT" }),
    );
    expect(
      within(summary).getByRole("button", {
        name: word(language, "Remove search filter"),
      }),
    ).toBeInTheDocument();
    expect(textOf(screen.getByTestId("trace-clear-filters"))).toBe(
      word(language, "Clear filters"),
    );

    // Enter goes to the first match: the count says which of them it is.
    fireEvent.keyDown(search, { key: "Enter" });
    await settle();
    expect(textOf(screen.getByTestId("trace-search-count"))).toBe(
      sentence(language, "{{position}} of {{count}}", {
        position: translatorFor(language).formatNumber(1),
        count: translatorFor(language).formatNumber(12),
      }),
    );

    // Errors only, and a service, are chips of the summary too.
    fireEvent.click(errorsOnly);
    fireEvent.click(
      screen.getAllByTestId("trace-service-chip").find((chip: HTMLElement) => {
        return chip.textContent?.includes("checkout-service");
      })!,
    );
    await settle();
    expect(
      within(screen.getByTestId("trace-filter-summary")).getByRole("button", {
        name: word(language, "Remove errors only filter"),
      }),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("trace-filter-summary")).getByRole("button", {
        name: sentence(language, "Remove {{name}} filter", {
          name: "checkout-service",
        }),
      }),
    ).toBeInTheDocument();

    // The critical path says how many spans it is, and how it is drawn.
    fireEvent.click(screen.getByTestId("trace-clear-filters"));
    fireEvent.click(criticalPath);
    await settle();
    const pathSummary: HTMLElement = screen.getByTestId(
      "trace-critical-path-summary",
    );
    expect(pathSummary).toHaveTextContent(word(language, "Critical path:"));
    const pathLength: number = Number(
      (textOf(pathSummary)
        .replace(word(language, "Critical path:"), "")
        .match(/[\d٠-٩۰-۹]+/) || ["0"])[0]
        .replace(/[٠-٩]/g, (digit: string): string => {
          return String(digit.charCodeAt(0) - 0x0660);
        })
        .replace(/[۰-۹]/g, (digit: string): string => {
          return String(digit.charCodeAt(0) - 0x06f0);
        }),
    );
    expect(pathLength).toBeGreaterThan(0);
    expect(textOf(pathSummary)).toBe(
      `${word(language, "Critical path:")} ${counted(
        language,
        CRITICAL_PATH_SUMMARY,
        pathLength,
      )}`,
    );
  });

  test("the span panel names itself, its timing, its place in the tree and every tab, and each tab says what it holds", async () => {
    await renderTrace(language);

    const panel: HTMLElement = await openSpan("update");

    expect(panel).toHaveAttribute("aria-label", word(language, "Span details"));
    expect(
      within(panel).getByRole("tablist", {
        name: word(language, "Span details"),
      }),
    ).toBeInTheDocument();
    expect(textOf(within(panel).getByTestId("span-panel-status"))).toBe(
      word(language, "No error"),
    );
    expect(
      within(panel).getByRole("button", {
        name: word(language, "Close span details"),
      }),
    ).toBeInTheDocument();
    expect(
      within(panel).getByRole("button", {
        name: word(language, "Copy a link to this span"),
      }),
    ).toBeInTheDocument();

    // Its one exception event is counted under the title.
    expect(panel).toHaveTextContent(counted(language, EXCEPTION_COUNT, 1));

    const timing: HTMLElement = within(panel).getByTestId("span-panel-timing");
    const terms: Array<string> = Array.from(timing.querySelectorAll("dt")).map(
      (term: Element): string => {
        return textOf(term);
      },
    );
    expect(terms).toEqual([
      word(language, "Duration"),
      word(language, "Self time"),
      word(language, "Starts"),
      word(language, "Children"),
      word(language, "Span ID"),
      word(language, "Parent"),
    ]);

    // When it starts, the offset where the language puts it.
    const starts: Element = Array.from(timing.querySelectorAll("dd"))[2]!;
    expect(textOf(starts)).toBe(
      sentence(language, "{{offset}} into the trace", {
        offset: `+${formatDurationNano(150 * MS)}`,
      }),
    );
    expect(
      within(timing).getByTitle(
        word(language, "Where this span sits in the trace"),
      ),
    ).toBeInTheDocument();
    expect(textOf(within(panel).getByTestId("span-panel-zoom"))).toBe(
      word(language, "Zoom to span"),
    );
    expect(
      within(panel).getByTitle(
        word(
          language,
          "Open the session recording at the moment this span started",
        ),
      ),
    ).toHaveTextContent(word(language, "Watch session"));
    expect(
      within(timing).getByRole("button", {
        name: word(language, "Copy span ID"),
      }),
    ).toBeInTheDocument();
    expect(within(panel).getByTestId("span-panel-parent")).toHaveAttribute(
      "title",
      sentence(language, "Select {{name}}", { name: "POST /reserve" }),
    );

    // Each tab by the language's name, the count of what it holds after it.
    for (const [tab, label] of [
      ["attributes", "Attributes"],
      ["events", "Events"],
      ["logs", "Logs"],
      ["exceptions", "Exceptions"],
      ["links", "Links"],
      ["profile", "Profile samples"],
    ] as Array<[string, string]>) {
      expect(
        textOf(within(panel).getByTestId(`span-panel-tab-${tab}`)),
      ).toContain(word(language, label));
    }

    // Attributes: more than it lists bare, so a filter box names the count.
    const filter: HTMLElement = within(panel).getByLabelText(
      word(language, "Filter attributes"),
    );
    expect(filter).toHaveAttribute(
      "placeholder",
      counted(language, FILTER_ATTRIBUTES, 10),
    );
    const attributes: HTMLElement =
      within(panel).getByTestId("span-attributes");
    expect(
      within(attributes).getByRole("button", {
        name: sentence(language, "Copy {{key}}", { key: "db.system" }),
      }),
    ).toBeInTheDocument();
    expect(
      within(attributes).getAllByTitle(
        word(language, "Find traces with this attribute value"),
      ),
    ).toHaveLength(10);
    fireEvent.change(filter, { target: { value: "no-such-attribute" } });
    expect(
      within(panel).getByText(
        word(language, "No attributes match this filter."),
      ),
    ).toBeInTheDocument();

    // Events: an exception names itself as one, each event its attributes and offset.
    await openTab("events");
    const events: Array<HTMLElement> = within(
      within(panel).getByTestId("span-events"),
    ).getAllByRole("listitem");
    expect(events[0]).toHaveTextContent(counted(language, ATTRIBUTE_COUNT, 1));
    expect(events[0]).toHaveTextContent(word(language, "Event attributes"));
    expect(
      within(events[0]!).getByTitle(
        sentence(language, "{{offset}} from the start of the trace", {
          offset: `+${formatDurationNano(170 * MS)}`,
        }),
      ),
    ).toHaveTextContent(`+${formatDurationNano(20 * MS)}`);
    expect(events[1]).toHaveTextContent(
      sentence(language, "Exception: {{name}}", {
        name: "could not serialize access",
      }),
    );

    // Logs: none were written in this span, and it ran in no pod.
    await openTab("logs");
    await waitFor(() => {
      expect(
        within(panel).getByText(
          word(
            language,
            "No logs were written inside this span. The trace's logs are listed below the waterfall.",
          ),
        ),
      ).toBeInTheDocument();
    });

    // Exceptions: none were raised on this span.
    await openTab("exceptions");
    await waitFor(() => {
      expect(
        within(panel).getByText(
          word(language, "No exceptions were recorded on this span."),
        ),
      ).toBeInTheDocument();
    });

    // Links: to a span of this trace, and to another trace.
    await openTab("links");
    const links: HTMLElement = within(panel).getByTestId("span-links");
    expect(links).toHaveTextContent(
      sentence(language, "trace {{traceId}}", { traceId: TRACE_ID }),
    );
    expect(links).toHaveTextContent(
      sentence(language, "span {{spanId}}", { spanId: "b7ad6b7169203331" }),
    );
    expect(within(links).getByText(word(language, "Show span"))).toBeVisible();
    expect(within(links).getByText(word(language, "Open trace"))).toBeVisible();
    expect(links).toHaveTextContent(word(language, "Link attributes"));

    // Profile samples: the line over the flame graph counts them.
    await openTab("profile");
    expect(
      textOf(within(panel).getByTestId("span-profile").querySelector("p")),
    ).toBe(counted(language, SPAN_PROFILE_SCOPE, PROFILE_SAMPLES));
  });

  test("the span panel says what a span with nothing on it lacks, and names a missing parent and a root", async () => {
    await renderTrace(language);

    // The failed call: its status, its exception (with no message) and its stack.
    let panel: HTMLElement = await openSpan("reserve");
    expect(textOf(within(panel).getByTestId("span-panel-status"))).toBe(
      word(language, "Error"),
    );
    expect(
      within(panel).getByText(word(language, "This span has no attributes.")),
    ).toBeInTheDocument();
    await openTab("events");
    expect(
      within(panel).getByText(
        word(language, "No events were recorded on this span."),
      ),
    ).toBeInTheDocument();
    await openTab("links");
    expect(
      within(panel).getByText(
        word(language, "This span does not link to other spans."),
      ),
    ).toBeInTheDocument();
    await openTab("exceptions");
    const exceptions: HTMLElement =
      await within(panel).findByTestId("span-exceptions");
    expect(exceptions).toHaveTextContent(word(language, "Exception"));
    expect(
      within(exceptions).getByText(word(language, "View exception")),
    ).toBeVisible();
    expect(
      within(exceptions).getByText(word(language, "Stack trace")),
    ).toBeVisible();

    // Its subtree reaches one span below it: the profile line says so.
    await openTab("profile");
    expect(
      textOf(within(panel).getByTestId("span-profile").querySelector("p")),
    ).toBe(
      counted(language, SPAN_PROFILE_SCOPE_WITH_ONE_CHILD, PROFILE_SAMPLES, {
        spans: translatorFor(language).formatNumber(1),
      }),
    );

    // A span whose parent was never received.
    panel = await openSpan("orphan");
    const missing: HTMLElement = within(panel).getByTitle(
      sentence(language, "Parent span {{spanId}} was not received", {
        spanId: "feedfacecafebeef",
      }),
    );
    expect(textOf(missing)).toBe(
      sentence(language, "Missing ({{spanId}}…)", { spanId: "feedface" }),
    );

    // The root has none, and its profile covers every span under it.
    panel = await openSpan("root");
    expect(
      within(panel).getByText(word(language, "None — root span")),
    ).toBeInTheDocument();
    await openTab("profile");
    expect(
      textOf(within(panel).getByTestId("span-profile").querySelector("p")),
    ).toBe(
      counted(language, SPAN_PROFILE_SCOPE_WITH_CHILDREN, PROFILE_SAMPLES, {
        spans: translatorFor(language).formatNumber(16),
      }),
    );

    // On the critical path, the panel says so.
    fireEvent.click(screen.getByTestId("trace-critical-path"));
    await settle();
    expect(panel).toHaveTextContent(word(language, "On critical path"));
  });

  test("the operations view heads its columns, explains each, and marks an operation called again and again", async () => {
    await renderTrace(language);

    fireEvent.click(screen.getByTestId("trace-view-operations"));
    await settle();

    const table: HTMLElement = screen.getByTestId("trace-operations");
    const headers: Array<HTMLElement> =
      within(table).getAllByRole("columnheader");
    expect(
      headers.map((header: HTMLElement): string => {
        return textOf(header.querySelector("button"));
      }),
    ).toEqual(
      ["Operation", "Calls", "Errors", "Self time", "Total", "Avg", "Max"].map(
        (label: string): string => {
          return word(language, label);
        },
      ),
    );
    expect(
      headers.map((header: HTMLElement): string | null => {
        return header.querySelector("button")!.getAttribute("title");
      }),
    ).toEqual(
      [
        "Service and span name",
        "How many spans ran this operation",
        "Calls with an error status",
        "Time spent in the operation itself, excluding its child spans",
        "Sum of every call's duration",
        "Average call duration",
        "The slowest call",
      ].map((hint: string): string => {
        return word(language, hint);
      }),
    );

    const operations: Array<HTMLElement> = within(table).getAllByTestId(
      "trace-operation-row",
    );
    for (const operation of operations) {
      expect(operation).toHaveAttribute(
        "title",
        word(language, "Show these spans in the waterfall"),
      );
    }
    const repeated: HTMLElement = within(table).getByTestId(
      "trace-operation-repeated",
    );
    expect(textOf(repeated)).toBe(
      sentence(language, "×{{count}} from one parent", {
        count: translatorFor(language).formatNumber(12),
      }),
    );
    expect(repeated).toHaveAttribute(
      "title",
      word(
        language,
        "Called many times from a single parent span. This is often an N+1 query or a loop that could be batched.",
      ),
    );

    // A search no operation matches empties the table, and it says so.
    fireEvent.change(screen.getByTestId("trace-search"), {
      target: { value: "no-such-operation" },
    });
    await settle();
    expect(
      screen.getByText(
        word(language, "No operations match the current filters."),
      ),
    ).toBeInTheDocument();
  });

  test("the flame graph and service map views say what a click does, and the map counts each service's spans and each call", async () => {
    await renderTrace(language);

    fireEvent.click(screen.getByTestId("trace-view-flamegraph"));
    await settle();
    expect(textOf(screen.getByTestId("flame-graph-instructions"))).toBe(
      word(language, FLAME_GRAPH_INSTRUCTIONS),
    );

    fireEvent.click(screen.getByTestId("trace-view-servicemap"));
    await settle();
    expect(
      screen.getByText(
        word(
          language,
          "Service flow for this trace. Arrows show cross-service calls with count and latency. Click a service or call to open its slowest span.",
        ),
      ),
    ).toBeInTheDocument();

    const nodes: Array<HTMLElement> = screen.getAllByTestId("flow-node");
    const inventory: HTMLElement = nodes.find((node: HTMLElement) => {
      return node.textContent?.includes("inventory-service");
    })!;
    expect(inventory).toHaveTextContent(counted(language, SPAN_COUNT, 2));
    expect(inventory).toHaveTextContent(counted(language, ERROR_COUNT, 1));

    // The gateway's call to the inventory: one, and how long it took.
    const labels: Array<string> = screen
      .getAllByTestId("flow-edge-label")
      .map((label: HTMLElement): string => {
        return textOf(label);
      });
    const shape: RegExp = sentenceShape(
      language,
      "{{count}}x · avg {{duration}}",
    );
    expect(
      labels.filter((label: string): boolean => {
        return shape.test(label.split(" · ").slice(0, 2).join(" · "));
      }),
    ).toHaveLength(labels.length);
    expect(
      labels.some((label: string): boolean => {
        return label.endsWith(` · ${counted(language, ERROR_COUNT, 1)}`);
      }),
    ).toBe(true);

    // A search no span matches leaves no service to draw.
    fireEvent.change(screen.getByTestId("trace-search"), {
      target: { value: "no-such-span" },
    });
    await settle();
    expect(
      screen.getByText(word(language, "No services found in this trace")),
    ).toBeInTheDocument();
  });

  test("the related signals name themselves and their tabs, and the metrics tab heads its table and says what its links leave behind", async () => {
    await renderTrace(language);

    const signals: HTMLElement = screen.getByTestId("trace-signals");
    expect(
      within(signals).getByRole("heading", {
        name: word(language, "Related signals"),
      }),
    ).toBeInTheDocument();
    expect(signals).toHaveTextContent(
      word(
        language,
        "Logs, exceptions, metrics and profiles recorded during this trace.",
      ),
    );
    expect(
      within(signals).getByRole("tablist", {
        name: word(language, "Related signals"),
      }),
    ).toBeInTheDocument();
    for (const [tab, label] of [
      ["logs", "Logs"],
      ["exceptions", "Exceptions"],
      ["metrics", "Metrics"],
      ["profile", "Profile samples"],
    ] as Array<[string, string]>) {
      expect(textOf(screen.getByTestId(`trace-signal-tab-${tab}`))).toContain(
        word(language, label),
      );
    }

    // The logs list and the exceptions table are handed their English keys.
    expect(logsViewerProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        noLogsMessage: "Logs that carry this trace's ID appear here.",
      }),
    );
    fireEvent.click(screen.getByTestId("trace-signal-tab-exceptions"));
    await settle();
    expect(exceptionTableProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: "Exceptions for this Trace",
        description: "Exception instances captured on this trace's spans.",
      }),
    );

    fireEvent.click(screen.getByTestId("trace-signal-tab-metrics"));
    const metrics: HTMLElement = await screen.findByTestId("trace-metrics");
    await within(metrics).findByText("http.server.duration");
    expect(
      within(metrics)
        .getAllByRole("columnheader")
        .map((header: HTMLElement): string => {
          return textOf(header);
        }),
    ).toEqual(
      ["Metric", "Sampled values", "Min", "Max", "Spans"].map(
        (label: string): string => {
          return word(language, label);
        },
      ),
    );
    expect(metrics).toHaveTextContent(
      sentence(
        language,
        "Metric links open the explorer over this trace's time window (±{{minutes}} min). Not carried over: {{fields}}.",
        {
          minutes: translatorFor(language).formatNumber(5),
          // What the links leave behind, worded as the sentence goes on.
          fields: composedValue((inSentence: Translator): string => {
            return inSentence.translateTerm("trace ids", { inSentence: true });
          }),
        },
      ).replace(/\s+/g, " "),
    );
    expect(
      within(metrics).getByTitle(
        sentence(
          language,
          "Open {{metric}} in the metric explorer over this trace's window",
          { metric: "http.server.duration" },
        ),
      ),
    ).toBeInTheDocument();
    expect(metrics).toHaveTextContent(
      sentence(language, "(of {{count}})", {
        count: translatorFor(language).formatNumber(6),
      }),
    );

    fireEvent.click(screen.getByTestId("trace-signal-tab-profile"));
    await settle();
    expect(textOf(screen.getByTestId("trace-profile").querySelector("p"))).toBe(
      counted(language, TRACE_PROFILE_SCOPE, PROFILE_SAMPLES),
    );
  });

  test("a large trace says how much of it is loaded, and offers the next batch and the rest", async () => {
    // 1,250 spans: the page reads the first 500 and counts the rest.
    const spans: Array<Span> = [];
    for (let index: number = 0; index < 1250; index++) {
      spans.push(
        makeSpan({
          spanId: `span-${index}`,
          parentSpanId: index === 0 ? "" : "span-0",
          name: index === 0 ? "GET /report" : `step ${index}`,
          serviceId: GATEWAY,
          startMs: index,
          durationMs: 1,
        }),
      );
    }

    await renderTrace(language, spans);
    await waitFor(() => {
      expect(screen.getByTestId("trace-load-all")).toBeInTheDocument();
    });

    const banner: HTMLElement = screen.getByTestId("trace-load-more");
    const formatNumber: (value: number) => string =
      translatorFor(language).formatNumber;
    /*
     * French, Norwegian, Russian and Swedish group thousands with a
     * no-break space, which the matcher reads as a space.
     */
    expect(banner).toHaveTextContent(
      counted(language, SHOWING_OF, 1250, {
        loaded: formatNumber(500),
      }).replace(/\s+/g, " "),
    );
    expect(banner).toHaveTextContent(
      word(
        language,
        "Large traces load in batches; totals above cover the loaded spans.",
      ),
    );
    expect(textOf(screen.getByTestId("trace-load-next"))).toBe(
      counted(language, LOAD_MORE, 500),
    );
    expect(textOf(screen.getByTestId("trace-load-all"))).toBe(
      sentence(language, "Load all {{count}}", { count: formatNumber(750) }),
    );

    // The header's span count names the total after the loaded ones.
    expect(screen.getByTestId("trace-stat-spans")).toHaveTextContent(
      sentence(language, "of {{total}}", {
        total: (1250).toLocaleString(),
      }),
    );
  });

  test("a trace the store has no spans of yet says so, and when to look again", async () => {
    await renderTrace(language, [], "trace-empty");

    const empty: HTMLElement = screen.getByTestId("trace-empty");
    expect(
      within(empty).getByRole("heading", {
        name: word(language, "No spans found for this trace"),
      }),
    ).toBeInTheDocument();
    expect(empty).toHaveTextContent(
      word(
        language,
        "Spans usually arrive within a minute of the request finishing. Refresh to check again, or look for its logs below.",
      ),
    );
  });

  test("the LLM call panel names the call, each chip, each measure and each parameter, and its prompt and completion", () => {
    render(
      inLanguage(
        language,
        <LlmSpanPanel attributes={LLM_ATTRIBUTES} durationLabel="1.2 s" />,
      ),
    );

    expect(screen.getByText(word(language, "AI / LLM Call"))).toBeVisible();
    for (const label of [
      "Provider",
      "Operation",
      "Model",
      "Agent",
      "Tool",
      "User",
      "User ID",
      "Team",
      "End user (customer)",
      "Input tokens",
      "Output tokens",
      "Total tokens",
      "Cost",
      "Latency",
      "Prompt",
      "Completion",
    ]) {
      expect(screen.getAllByText(word(language, label)).length).toBeGreaterThan(
        0,
      );
    }
    for (const label of [
      "Temperature",
      "Max tokens",
      "Top P",
      "Finish reason",
    ]) {
      expect(screen.getByText(`${word(language, label)}:`)).toBeInTheDocument();
    }
    expect(
      screen.getByText(word(language, "not reported by SDK")),
    ).toBeInTheDocument();

    // A prompt with no role is a message; an answer with no text says so.
    expect(screen.getByText(word(language, "message"))).toBeInTheDocument();
    expect(
      screen.getByText(word(language, "(no text content)")),
    ).toBeInTheDocument();
    // The role the call recorded, as written.
    expect(screen.getByText("assistant")).toBeInTheDocument();
  });
});

/*
 * ---------------------------------------------------------------------------
 * Written out, so a translator that handed English back could not pass
 * ---------------------------------------------------------------------------
 */

describe("REGRESSION: the minimap and the flame graph drew English in every language", () => {
  test.each([
    {
      language: "de",
      title: "Ziehen Sie über den Trace, um in diesen Zeitbereich zu zoomen",
      zoomedTitle:
        "Ziehen Sie über den Trace, um in diesen Zeitbereich zu zoomen. Doppelklicken Sie, um den gesamten Trace zu sehen.",
      label:
        "Trace-Übersicht. Ziehen Sie, um in einen Zeitraum hineinzuzoomen.",
      zoomedLabel:
        "Trace-Übersicht. Ziehen Sie, um in einen Zeitraum hineinzuzoomen, doppelklicken Sie, um den gesamten Trace zu sehen.",
      flameGraph:
        "Klicken Sie auf einen Span, um Details anzuzeigen. Doppelklicken Sie, um in einen Teilbaum zu zoomen.",
    },
    {
      language: "ja",
      title: "トレース上をドラッグすると、その時間範囲を拡大します",
      zoomedTitle:
        "トレース上をドラッグすると、その時間範囲を拡大します。ダブルクリックするとトレース全体を表示します。",
      label: "トレースの概要。ドラッグすると時間範囲を拡大します。",
      zoomedLabel:
        "トレースの概要。ドラッグすると時間範囲を拡大し、ダブルクリックするとトレース全体を表示します。",
      flameGraph:
        "スパンをクリックすると詳細を表示します。ダブルクリックするとサブツリーを拡大します。",
    },
    {
      language: "fr",
      title: "Faites glisser sur la trace pour zoomer sur cette plage de temps",
      zoomedTitle:
        "Faites glisser sur la trace pour zoomer sur cette plage de temps. Double-cliquez pour voir toute la trace.",
      label:
        "Vue d'ensemble de la trace. Faites glisser pour zoomer sur une plage de temps.",
      zoomedLabel:
        "Vue d'ensemble de la trace. Faites glisser pour zoomer sur une plage de temps, double-cliquez pour voir toute la trace.",
      flameGraph:
        "Cliquez sur un span pour afficher les détails. Double-cliquez pour zoomer sur un sous-arbre.",
    },
    {
      language: "fa",
      title: "برای بزرگ‌نمایی آن بازهٔ زمانی، روی ترِیس بکشید",
      zoomedTitle:
        "برای بزرگ‌نمایی آن بازهٔ زمانی، روی ترِیس بکشید. برای دیدن کل ترِیس دوبار کلیک کنید.",
      label: "نمای کلی ترِیس. برای بزرگ‌نمایی یک بازهٔ زمانی بکشید.",
      zoomedLabel:
        "نمای کلی ترِیس. برای بزرگ‌نمایی یک بازهٔ زمانی بکشید و برای دیدن کل ترِیس دوبار کلیک کنید.",
      flameGraph:
        "برای دیدن جزئیات روی یک اسپن کلیک کنید. برای بزرگ‌نمایی یک زیردرخت دوبار کلیک کنید.",
    },
  ])(
    "$language: the minimap's tooltip and its name, unzoomed and zoomed, and the flame graph's line",
    ({
      language,
      title,
      zoomedTitle,
      label,
      zoomedLabel,
      flameGraph,
    }: {
      language: string;
      title: string;
      zoomedTitle: string;
      label: string;
      zoomedLabel: string;
      flameGraph: string;
    }) => {
      renderMinimap(language, FULL_VIEWPORT);
      expect(minimapTrack()).toHaveAttribute("title", title);
      expect(minimapTrack()).toHaveAttribute("aria-label", label);

      cleanup();
      renderMinimap(language, { start: 0.2, end: 0.4 });
      expect(minimapTrack()).toHaveAttribute("title", zoomedTitle);
      expect(minimapTrack()).toHaveAttribute("aria-label", zoomedLabel);

      cleanup();
      render(
        inLanguage(
          language,
          <FlameGraph
            spans={checkoutDefinitions().slice(0, 2).map(makeSpan)}
            telemetryServices={services()}
            selectedSpanId={undefined}
          />,
        ),
      );
      expect(textOf(screen.getByTestId("flame-graph-instructions"))).toBe(
        flameGraph,
      );
      expect(screen.queryByText(FLAME_GRAPH_INSTRUCTIONS)).toBeNull();
    },
  );

  test("German, Japanese, French and Persian name the toolbar's toggles and the views in their own words", async () => {
    const expected: Record<
      string,
      { errorsOnly: string; criticalPath: string; waterfall: string }
    > = {
      de: {
        errorsOnly: "Nur Fehler",
        criticalPath: "Kritischer Pfad",
        waterfall: "Wasserfall",
      },
      ja: {
        errorsOnly: "エラーのみ",
        criticalPath: "クリティカルパス",
        waterfall: "ウォーターフォール",
      },
      fr: {
        errorsOnly: "Erreurs uniquement",
        criticalPath: "Chemin critique",
        waterfall: "Cascade",
      },
      fa: {
        errorsOnly: "فقط خطاها",
        criticalPath: "مسیر بحرانی",
        waterfall: "آبشاری",
      },
    };

    for (const language of Object.keys(expected)) {
      installBackend();
      await renderTrace(language);

      const words: {
        errorsOnly: string;
        criticalPath: string;
        waterfall: string;
      } = expected[language]!;
      expect(screen.getByTestId("trace-errors-only")).toHaveTextContent(
        words.errorsOnly,
      );
      expect(screen.getByTestId("trace-critical-path")).toHaveTextContent(
        words.criticalPath,
      );
      expect(screen.getByTestId("trace-view-waterfall")).toHaveTextContent(
        words.waterfall,
      );
      expect(screen.queryByText("Errors only")).toBeNull();
      expect(screen.queryByText("Critical path")).toBeNull();

      cleanup();
    }
  });

  test("English reads as it always did", async () => {
    renderMinimap("en", FULL_VIEWPORT);
    expect(minimapTrack()).toHaveAttribute(
      "title",
      "Drag across the trace to zoom into that time range",
    );
    expect(minimapTrack()).toHaveAttribute(
      "aria-label",
      "Trace overview. Drag to zoom into a time range.",
    );
    cleanup();

    await renderTrace("en");
    expect(screen.getByTestId("trace-errors-only")).toHaveTextContent(
      "Errors only",
    );
    expect(screen.getByTestId("trace-status")).toHaveTextContent("1 error");
    expect(screen.getByTestId("trace-search")).toHaveAttribute(
      "placeholder",
      "Search spans by name, ID or service",
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * Nothing the English page draws is missed
 * ---------------------------------------------------------------------------
 */

describe("every word the English trace page puts in a tooltip, a name or a placeholder is one of the view's keys, or the trace's own data", () => {
  // A key's English with each {{placeholder}} matching any value.
  const englishShape: (english: string) => RegExp = (
    english: string,
  ): RegExp => {
    return new RegExp(
      `^${english
        .split(/\{\{[^}]+\}\}/)
        .map(escapeRegExp)
        .join(".+")}$`,
    );
  };

  const SHAPES: Array<RegExp> = [
    ...TRACE_VIEW_WORDS,
    ...TRACE_VIEW_COUNTS.flatMap((template: PluralTemplate) => {
      return [template.one, template.other];
    }),
  ].map(englishShape);

  /*
   * The shared components' own words (each looks its words up itself) and
   * what the trace says about itself: names, ids, durations and shares.
   */
  const SHARED_COMPONENT_WORDS: Array<string> = [
    "Copy",
    "Copy JSON",
    "Choose JSON format",
    "Show attributes as",
    "List",
    "JSON",
    "Refresh",
    "Loading content",
  ];

  const WORDS: RegExp = /[A-Za-z]{3,}/;
  const UNITS: RegExp = /\b(ms|μs|ns|min|s)\b/g;
  const YEAR: RegExp = /\b2026\b/;
  const SERVICE_NAMED: RegExp =
    /^(api-gateway|inventory-service|checkout-service)\b/;
  const COPY_AS_JSON: RegExp = /^Copy \d+ attributes? as .+ JSON$/;

  const isData: (value: string) => boolean = (value: string): boolean => {
    return (
      // No words at all: numbers, durations, shares, ids and arrows.
      !WORDS.test(value.replace(UNITS, "")) ||
      // When the trace started, as the reader's clock writes it.
      YEAR.test(value) ||
      [
        TRACE_ID,
        "POST /api/v1/checkout",
        "auth.verifyToken",
        "POST /reserve",
        "UPDATE stock",
        "OrderService.validateCart",
        "SELECT products WHERE id = $1",
        "cache.lookup",
        "api-gateway",
        "inventory-service",
        "checkout-service",
      ].some((data: string): boolean => {
        return value === data || value.startsWith(`${data} `);
      }) ||
      // The services bar's name and its segments: each service and its share.
      SERVICE_NAMED.test(value) ||
      // An attribute's key or value, as the span recorded it.
      Object.keys(MANY_ATTRIBUTES).includes(value) ||
      COPY_AS_JSON.test(value)
    );
  };

  test("the toolbar, the header, the waterfall, the minimap and an open span's panel", async () => {
    await renderTrace("en");
    await openSpan("update");

    const values: Array<string> = [];
    for (const attribute of ["title", "aria-label", "placeholder"]) {
      document
        .querySelectorAll(`[${attribute}]`)
        .forEach((element: Element) => {
          values.push((element.getAttribute(attribute) || "").trim());
        });
    }

    expect(values.length).toBeGreaterThan(40);
    expect(
      Array.from(new Set(values)).filter((value: string): boolean => {
        return (
          value.length > 0 &&
          !isData(value) &&
          !SHARED_COMPONENT_WORDS.includes(value) &&
          !SHAPES.some((shape: RegExp): boolean => {
            return shape.test(value);
          })
        );
      }),
    ).toEqual([]);
  });
});
