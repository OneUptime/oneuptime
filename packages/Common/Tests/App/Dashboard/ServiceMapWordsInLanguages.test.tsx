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
  within,
} from "@testing-library/react";
import { chooseDropdownOption } from "../../DropdownPicks";
import { createInstance, i18n } from "i18next";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { Edge, Node, NodeProps } from "reactflow";
import {
  formatReaderFigure,
  setDateDisplayLanguage,
} from "../../../Types/DateLanguage";
import EntityRelationshipType from "../../../Types/Telemetry/EntityRelationshipType";
import EntitySource from "../../../Types/Telemetry/EntitySource";
import EntityType from "../../../Types/Telemetry/EntityType";
import TimeRange from "../../../Types/Time/TimeRange";
import {
  PluralTemplate,
  Translator,
  createTranslator,
  formatInline,
} from "../../../Types/Translator";
import ServiceMapGraph, {
  connectionsForEntry,
  statsForEntry,
  statusLabelForEntry,
  subtitleForEntry,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/ServiceMapGraph";
import {
  ServiceMapEntry,
  ServiceMapModel,
  buildServiceMapModel,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/ServiceMapViewModel";
import {
  TopologyEntity,
  TopologyRelationship,
  TopologyRunsOnCount,
  TopologyRunsOnCounts,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/TopologyData";
import { ServiceOperationalStatus } from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/OperationalOverlay";
import {
  formatCallRate,
  formatDurationMs,
  formatErrorRate,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/TopologyMeta";
import { countOfType } from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/TopologyCounts";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * #7725: EVERY WORD OF THE SERVICE MAP IN THE READER'S LANGUAGE.
 *
 * A card's status line ("3 active incidents"), its subtitle ("Service ·
 * Node.js"), its stats ("600/min in", "10.0% errors") and a connection's
 * label ("10.0% errors") were built in English at run time and looked up
 * whole as a key, which a line with a number or a name in it never is. The
 * list's "1 caller · 1 dependency", its pager and its count of items were
 * glued from English pieces. Every language read them in English, with
 * English plurals and Latin digits, and Arabic said "1 pod".
 *
 * Rendered here from the real locale files through a real i18next
 * instance, in English, German, Arabic and Persian. React Flow draws each
 * card with the map's own card component (its nodeTypes), so a card's
 * every line is the one a reader sees. The viewport guard and the edge
 * drawer are stood in for, the entity drawer shows what it is handed.
 */

let mockStatuses: Map<string, ServiceOperationalStatus> = new Map<
  string,
  ServiceOperationalStatus
>();

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getFirstParam: () => {
        return null;
      },
      getQueryStringByName: (key: string) => {
        return new URLSearchParams(window.location.search).get(key);
      },
      setQueryString: (values: Record<string, string | null>) => {
        const url: URL = new URL(window.location.href);
        for (const [key, value] of Object.entries(values)) {
          if (value === null) {
            url.searchParams.delete(key);
          } else {
            url.searchParams.set(key, value);
          }
        }
        window.history.replaceState({}, "", url.toString());
      },
    },
  };
});
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Topology/OperationalOverlay",
  () => {
    return {
      fetchServiceOperationalStatuses: async () => {
        return mockStatuses;
      },
    };
  },
);
// The drawer shows the status line and the subtitle the map hands it.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Topology/EntityDetailPanel",
  () => {
    return {
      __esModule: true,
      default: (props: {
        traffic?: { statusLabel: string; subtitle: string } | undefined;
      }) => {
        return (
          <div data-testid="drawer">
            <span data-testid="drawer-status">
              {props.traffic?.statusLabel || ""}
            </span>
            <span data-testid="drawer-subtitle">
              {props.traffic?.subtitle || ""}
            </span>
          </div>
        );
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Topology/EdgeDetailPanel",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Topology/FlowViewportGuard",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);
// Each card drawn by the map's own card component; each edge with its label.
jest.mock("reactflow", () => {
  return {
    __esModule: true,
    MarkerType: { ArrowClosed: "arrowclosed" },
    BackgroundVariant: { Dots: "dots" },
    Background: () => {
      return null;
    },
    Controls: () => {
      return null;
    },
    Handle: () => {
      return null;
    },
    Position: { Left: "left", Right: "right", Top: "top", Bottom: "bottom" },
    default: (props: {
      nodes: Array<Node>;
      edges: Array<Edge>;
      nodeTypes: Record<string, React.FunctionComponent<NodeProps>>;
      onNodeClick: (event: React.MouseEvent, node: Node) => void;
      children?: React.ReactNode;
    }) => {
      return (
        <div data-testid="rendered-graph">
          {props.nodes.map((node: Node) => {
            const Card: React.FunctionComponent<NodeProps> = props.nodeTypes[
              node.type || ""
            ] as React.FunctionComponent<NodeProps>;
            return (
              <div
                key={node.id}
                data-testid={`map-card-${node.id}`}
                onClick={(event: React.MouseEvent) => {
                  props.onNodeClick(event, node);
                }}
              >
                <Card {...({ id: node.id, data: node.data } as NodeProps)} />
              </div>
            );
          })}
          {props.edges.map((edge: Edge) => {
            return (
              <span key={edge.id} data-testid={`map-edge-${edge.id}`}>
                {String(edge.label || "")}
              </span>
            );
          })}
          {props.children}
        </div>
      );
    },
  };
});

const NOW: Date = new Date();
const RANGE_START: Date = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
const WINDOW_SECONDS: number = 60;

const LANGUAGES: ReadonlyArray<string> = ["en", "de", "ar", "fa"];

const LATIN_DIGIT: RegExp = /[0-9]/;

const ARABIC_LETTER: RegExp = /\p{Script=Arabic}/u;

/*
 * The card's average duration was written by hand, "25ms" in every
 * language, and the checks below left it out; it is the reader's duration
 * now ("25 ms", "۲۵ میلی‌ثانیه", #7418), so no line is left out. Kept as
 * the negative control's pattern.
 */
const WRITTEN_DURATION: RegExp = /^\d+ms$/;

const ACTIVE_INCIDENTS: PluralTemplate = {
  one: "{{count}} active incident",
  other: "{{count}} active incidents",
};

const ACTIVE_ALERTS: PluralTemplate = {
  one: "{{count}} active alert",
  other: "{{count}} active alerts",
};

const CALLERS: PluralTemplate = {
  one: "{{count}} caller",
  other: "{{count}} callers",
};

const DEPENDENCIES: PluralTemplate = {
  one: "{{count}} dependency",
  other: "{{count}} dependencies",
};

const SHOWN_OF_ITEMS: PluralTemplate = {
  one: "{{shown}} of {{count}} item",
  other: "{{shown}} of {{count}} items",
};

const INACTIVE_NOT_SHOWN: PluralTemplate = {
  one: "{{count}} inactive not shown",
  other: "{{count}} inactive not shown",
};

function item(
  key: string,
  type: EntityType,
  attributes?: Record<string, string>,
  lastSeenAt: Date = NOW,
): TopologyEntity {
  return {
    entityKey: key,
    displayName: key,
    entityType: type,
    source: EntitySource.Discovered,
    lastSeenAt,
    ...(attributes ? { descriptiveAttributes: attributes } : {}),
  };
}

function calls(
  from: string,
  to: string,
  callCount: number,
  errorCount: number,
  avgDurationMs: number,
): TopologyRelationship {
  return {
    fromEntityKey: from,
    toEntityKey: to,
    relationshipType: EntityRelationshipType.DependsOn,
    callCount,
    errorCount,
    avgDurationMs,
  };
}

function status(incidents: number, alerts: number): ServiceOperationalStatus {
  return {
    serviceId: "service-id",
    activeIncidentCount: incidents,
    worstIncidentSeverityName: incidents > 0 ? "Critical" : null,
    worstIncidentSeverityColor: incidents > 0 ? "#dc2626" : null,
    incidents: [],
    activeAlertCount: alerts,
    worstAlertSeverityName: alerts > 0 ? "Warning" : null,
    worstAlertSeverityColor: alerts > 0 ? "#f59e0b" : null,
    alerts: [],
  };
}

/*
 * web (Node.js) calls api, 600 a minute, a tenth of them failing; api calls
 * postgres 1,200 a minute without a failure. api has 3 active incidents and
 * web an active alert; a fourth service, cron, has been silent for days.
 */
const ENTITIES: Array<TopologyEntity> = [
  item("web", EntityType.Service, { "telemetry.sdk.language": "nodejs" }),
  item("api", EntityType.Service),
  item("postgres", EntityType.Database, { "db.system.name": "postgresql" }),
  item(
    "cron",
    EntityType.Service,
    undefined,
    new Date(NOW.getTime() - 9 * 24 * 60 * 60 * 1000),
  ),
];

const RELATIONSHIPS: Array<TopologyRelationship> = [
  calls("web", "api", 600, 60, 25),
  calls("api", "postgres", 1200, 0, 4),
];

function runsOn(entityType: EntityType, count: number): TopologyRunsOnCount {
  return { entityType, active: count, total: count };
}

// api runs on one pod.
const RUNS_ON_COUNTS: TopologyRunsOnCounts = new Map<
  string,
  Array<TopologyRunsOnCount>
>([["api", [runsOn(EntityType.KubernetesPod, 1)]]]);

const instances: Map<string, i18n> = new Map();

function instanceFor(language: string): i18n {
  const existing: i18n | undefined = instances.get(language);

  if (existing) {
    return existing;
  }

  const instance: i18n = createInstance();

  instance.init({
    lng: language,
    fallbackLng: "en",
    resources: {
      en: { translation: readDashboardLocale("en") },
      [language]: { translation: readDashboardLocale(language) },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
    initImmediate: false,
  });
  instances.set(language, instance);

  return instance;
}

interface RenderOptions {
  entities?: Array<TopologyEntity>;
  relationships?: Array<TopologyRelationship>;
}

async function renderIn(
  language: string,
  options: RenderOptions = {},
): Promise<void> {
  setDateDisplayLanguage(language);
  await act(async () => {
    render(
      <I18nextProvider i18n={instanceFor(language)}>
        <MemoryRouter>
          <ServiceMapGraph
            entities={options.entities || ENTITIES}
            relationships={options.relationships || RELATIONSHIPS}
            runsOnCounts={RUNS_ON_COUNTS}
            metricsWindowSeconds={WINDOW_SECONDS}
            timeRange={{ range: TimeRange.PAST_ONE_DAY }}
            rangeStart={RANGE_START}
          />
        </MemoryRouter>
      </I18nextProvider>,
    );
  });
}

// A word of the locale, or the English word where it has none.
function word(language: string, english: string): string {
  return dashboardTranslator(language).translateText(english) || english;
}

function card(key: string): HTMLElement {
  return screen.getByTestId(`service-map-node-${key}`);
}

// A card's lines, top to bottom: title, subtitle, status, stats, footer.
function cardLines(key: string): Array<string> {
  return Array.from(card(key).querySelectorAll("span, div"))
    .filter((element: Element): boolean => {
      return (
        element.children.length === 0 && (element.textContent || "") !== ""
      );
    })
    .map((element: Element): string => {
      return element.textContent || "";
    });
}

// The card's stats, each as "<value> <label>".
function cardStats(key: string): Array<string> {
  const lines: Array<string> = cardLines(key);
  // Title, subtitle, status line, then value and label pairs, then a footer.
  const pairs: Array<string> = lines.slice(3, 9);
  const stats: Array<string> = [];
  for (let index: number = 0; index + 1 < pairs.length; index += 2) {
    stats.push(`${pairs[index]} ${pairs[index + 1]}`);
  }
  return stats;
}

function edgeLabel(id: string): string {
  return screen.getByTestId(`map-edge-${id}`).textContent || "";
}

function showConnectionLabels(metric: "calls" | "errors" | "latency"): void {
  // The picker's options in their order: On hover, Request rate, Error rate, Average latency.
  chooseDropdownOption(
    screen.getByRole("combobox"),
    ["calls", "errors", "latency"].indexOf(metric) + 1,
  );
}

function listRow(name: string): HTMLElement {
  const row: HTMLElement | null = screen
    .getByRole("button", { name, exact: true })
    .closest("tr");

  expect(row).not.toBeNull();

  return row as HTMLElement;
}

// The literal words a reader sees, so a wrong lookup cannot pass unnoticed.
interface Anchors {
  incidents: string;
  alert: string;
  webSubtitle: string;
  errorsEdge: string;
  callsEdge: string;
  apiConnections: string;
}

const ANCHORS: Record<string, Anchors> = {
  en: {
    incidents: "3 active incidents",
    alert: "1 active alert",
    webSubtitle: "Service · Node.js",
    errorsEdge: "10.0% errors",
    callsEdge: "600/min",
    apiConnections: "1 caller · 1 dependency",
  },
  de: {
    incidents: "3 aktive Vorfälle",
    alert: "1 aktive Warnung",
    webSubtitle: "Dienst · Node.js",
    // Intl's German percent: a no-break space before the sign.
    errorsEdge: "10,0\u00a0% Fehler",
    callsEdge: "600/Min.",
    apiConnections: "1 Aufrufer · 1 Abhängigkeit",
  },
  ar: {
    incidents: "الحوادث النشطة: 3",
    alert: "1 تنبيه نشط",
    webSubtitle: "الخدمة · Node.js",
    // Intl's Arabic percent, in Latin digits: the sign between two LRMs.
    errorsEdge: "أخطاء بنسبة 10.0\u200e%\u200e",
    callsEdge: "600/دقيقة",
    apiConnections: "1 جهة مستدعية · 1 اعتمادية",
  },
  fa: {
    incidents: "۳ حادثه فعال",
    alert: "۱ هشدار فعال",
    webSubtitle: "سرویس • Node.js",
    errorsEdge: "۱۰٫۰٪ خطا",
    callsEdge: "۶۰۰/دقیقه",
    apiConnections: "۱ فراخواننده • ۱ وابستگی",
  },
};

// English words a card, an edge or a line must not show in another language.
const ENGLISH_WORDS: RegExp =
  /active incident|active alert|\berrors?\b|\bavg\b|\bin\b|\bout\b|\/min|caller|dependenc|\bitems?\b|\bService\b|Showing|Page \d/;

beforeAll(() => {
  for (const language of LANGUAGES) {
    instanceFor(language);
  }
});

beforeEach(() => {
  mockStatuses = new Map<string, ServiceOperationalStatus>([
    ["api", status(3, 0)],
    ["web", status(0, 1)],
  ]);
});

afterEach(() => {
  cleanup();
  setDateDisplayLanguage(null);
  window.history.replaceState({}, "", "/");
});

describe.each(LANGUAGES)("the service map in %s", (language: string) => {
  const translator: Translator = dashboardTranslator(language);
  const anchors: Anchors = ANCHORS[language] as Anchors;

  test("a card's status line counts its active incidents and alerts in the language's plural", async () => {
    await renderIn(language);

    expect(cardLines("api")).toContain(anchors.incidents);
    expect(cardLines("web")).toContain(anchors.alert);
    expect(anchors.incidents).toBe(
      translator.translatePlural(ACTIVE_INCIDENTS, 3),
    );
    expect(anchors.alert).toBe(translator.translatePlural(ACTIVE_ALERTS, 1));
  });

  test("a card's subtitle names its type in the language, and its runtime as written", async () => {
    await renderIn(language);

    expect(withoutIsolateMarks(cardLines("web")[1] || "")).toBe(
      anchors.webSubtitle,
    );
    expect(cardLines("api")[1]).toBe(word(language, "Service"));
    expect(withoutIsolateMarks(cardLines("postgres")[1] || "")).toBe(
      formatInline([word(language, "Database"), "PostgreSQL"], translator),
    );
  });

  test("a card's stats are the language's words beside the language's figures", async () => {
    await renderIn(language);

    // api answers 600 calls a minute, 10% failing; web makes them.
    expect(cardStats("api")).toEqual([
      `${formatCallRate(600, WINDOW_SECONDS, translator)} ${word(language, "in")}`,
      `${formatErrorRate(600, 60, translator)} ${word(language, "errors")}`,
      `${formatDurationMs(25, translator)} ${word(language, "avg")}`,
    ]);
    expect(cardStats("web")[0]).toBe(
      `${formatCallRate(600, WINDOW_SECONDS, translator)} ${word(language, "out")}`,
    );
    expect(cardStats("api")[0]).toBe(
      `${anchors.callsEdge} ${word(language, "in")}`,
    );
  });

  test("a connection's label says its errors and its rate in the language", async () => {
    await renderIn(language);

    showConnectionLabels("errors");
    expect(edgeLabel("web->api")).toBe(anchors.errorsEdge);

    showConnectionLabels("calls");
    expect(edgeLabel("web->api")).toBe(anchors.callsEdge);
    expect(edgeLabel("api->postgres")).toBe(
      formatCallRate(1200, WINDOW_SECONDS, translator),
    );
  });

  test("the list's status, rates and connections are the language's", async () => {
    await renderIn(language);
    fireEvent.click(screen.getByTestId("service-map-view-list"));

    const api: HTMLElement = listRow("api");
    const cells: Array<string> = Array.from(api.querySelectorAll("td")).map(
      (cell: Element): string => {
        return cell.textContent || "";
      },
    );

    expect(cells[1]).toBe(anchors.incidents);
    expect(cells[2]).toBe(formatCallRate(600, WINDOW_SECONDS, translator));
    expect(cells[3]).toBe(formatErrorRate(600, 60, translator));
    expect(cells[5]).toBe(anchors.apiConnections);
    expect(cells[5]).toBe(
      formatInline(
        [
          translator.translatePlural(CALLERS, 1),
          translator.translatePlural(DEPENDENCIES, 1),
        ],
        translator,
      ),
    );

    // web is called by nothing: the general form, for zero.
    expect(
      within(listRow("web")).getAllByRole("cell")[5]?.textContent || "",
    ).toBe(
      formatInline(
        [
          translator.translatePlural(CALLERS, 0),
          translator.translatePlural(DEPENDENCIES, 1),
        ],
        translator,
      ),
    );
  });

  test("the summary counts in the language's digits, and says how many are not shown", async () => {
    await renderIn(language);

    const summary: HTMLElement = screen.getByTestId("service-map-summary");

    expect(summary).toHaveTextContent(
      translator.translatePlural(INACTIVE_NOT_SHOWN, 1),
    );
    expect(summary).toHaveTextContent(
      word(language, "Databases and APIs your services call"),
    );
    // Two services report, one dependency, two connections, two need attention.
    expect(
      Array.from(summary.querySelectorAll("p.text-3xl")).map(
        (figure: Element): string => {
          return figure.textContent || "";
        },
      ),
    ).toEqual(
      [2, 1, 2, 2].map((value: number): string => {
        return translator.formatNumber(value);
      }),
    );
    expect(
      screen.getByTestId("service-map-attention-filter"),
    ).toHaveTextContent(translator.formatNumber(2));
  });

  test("the count of what is shown is one sentence of the language", async () => {
    await renderIn(language);

    expect(screen.getByTestId("service-map-result-count").textContent).toBe(
      translator.translatePlural(SHOWN_OF_ITEMS, 3, {
        shown: translator.formatNumber(3),
      }),
    );
  });

  test("the focus banner names the service where the language's sentence does", async () => {
    await renderIn(language);
    fireEvent.click(screen.getByTestId("service-map-view-list"));
    fireEvent.click(within(listRow("api")).getAllByRole("button")[1]!);

    expect(
      withoutIsolateMarks(
        screen.getByTestId("service-map-focus-sentence").textContent || "",
      ),
    ).toBe(
      translator.translateTemplate("Direct connections of {{name}}", {
        name: "api",
      }),
    );
  });

  test("the drawer is handed the status line and the subtitle in the language", async () => {
    await renderIn(language);
    fireEvent.click(screen.getByTestId("map-card-api"));

    expect(screen.getByTestId("drawer-status").textContent).toBe(
      anchors.incidents,
    );
    expect(screen.getByTestId("drawer-subtitle").textContent).toBe(
      word(language, "Service"),
    );
  });

  if (language !== "en") {
    test("no card, connection or line of the map is left in English", async () => {
      await renderIn(language);
      showConnectionLabels("errors");

      for (const key of ["web", "api", "postgres"]) {
        const lines: Array<string> = cardLines(key)
          // The title is the service's name, the subtitle may name its runtime.
          .slice(2)
          // No line is left out: the duration is the reader's too (#7418).
          .filter((line: string): boolean => {
            expect(WRITTEN_DURATION.test(line)).toBe(false);
            return true;
          });

        for (const line of lines) {
          expect({ key, line, english: ENGLISH_WORDS.test(line) }).toEqual({
            key,
            line,
            english: false,
          });
        }
      }

      expect(edgeLabel("web->api")).not.toMatch(ENGLISH_WORDS);
      expect(
        screen.getByTestId("service-map-result-count").textContent,
      ).not.toMatch(ENGLISH_WORDS);
    });
  }
});

describe("English reads exactly as it did", () => {
  test("a card, its connections, the list and the summary", async () => {
    await renderIn("en");

    expect(cardLines("api").slice(0, 3)).toEqual([
      "api",
      "Service",
      "3 active incidents",
    ]);
    expect(cardStats("api")).toEqual([
      "600/min in",
      "10.0% errors",
      "25\u00A0ms avg",
    ]);
    expect(cardStats("web")[0]).toBe("600/min out");
    expect(cardStats("postgres")).toEqual([
      "1.2k/min in",
      "0% errors",
      "4\u00A0ms avg",
    ]);

    showConnectionLabels("errors");
    expect(edgeLabel("web->api")).toBe("10.0% errors");
    expect(edgeLabel("api->postgres")).toBe("0% errors");
    showConnectionLabels("calls");
    expect(edgeLabel("api->postgres")).toBe("1.2k/min");
    showConnectionLabels("latency");
    expect(edgeLabel("web->api")).toBe("25\u00A0ms");

    expect(screen.getByTestId("service-map-summary")).toHaveTextContent(
      "1 inactive not shown",
    );
    expect(screen.getByTestId("service-map-result-count").textContent).toBe(
      "3 of 3 items",
    );

    fireEvent.click(screen.getByTestId("service-map-view-list"));
    expect(listRow("web")).toHaveTextContent("0 callers · 1 dependency");
    expect(listRow("api")).toHaveTextContent("1 caller · 1 dependency");
    expect(
      screen.getByRole("button", { name: "Show on map api" }),
    ).toBeInTheDocument();
  });
});

describe("read from the right", () => {
  test("Persian writes every figure of a card in Persian digits, its duration too", async () => {
    await renderIn("fa");

    for (const key of ["web", "api", "postgres"]) {
      for (const line of cardLines(key).slice(2)) {
        expect({ key, line, latin: LATIN_DIGIT.test(line) }).toEqual({
          key,
          line,
          latin: false,
        });
      }
    }
  });

  test("Arabic writes Latin digits, as its pages do", async () => {
    await renderIn("ar");

    expect(cardLines("api")).toContain("الحوادث النشطة: 3");
  });

  test("a runtime in Latin letters is set apart in a subtitle read from the right", () => {
    const model: ServiceMapModel = buildServiceMapModel(
      ENTITIES,
      RELATIONSHIPS,
      { rangeStart: RANGE_START },
    );
    const web: ServiceMapEntry = model.entryByKey.get("web")!;

    expect(subtitleForEntry(web, dashboardTranslator("fa"))).toBe(
      "سرویس • ⁨Node.js⁩",
    );
    // Left to right, a Latin name needs no isolate.
    expect(subtitleForEntry(web, dashboardTranslator("de"))).toBe(
      "Dienst · Node.js",
    );
  });
});

describe("the map's sentences, called on their own", () => {
  const model: ServiceMapModel = buildServiceMapModel(ENTITIES, RELATIONSHIPS, {
    rangeStart: RANGE_START,
    statuses: new Map<string, ServiceOperationalStatus>([
      ["api", status(21, 0)],
      ["web", status(0, 2)],
    ]),
  });

  test("a count Russian reads in its one form, and English's one form", () => {
    const api: ServiceMapEntry = model.entryByKey.get("api")!;

    expect(statusLabelForEntry(api, dashboardTranslator("ru"))).toBe(
      dashboardTranslator("ru").translatePlural(ACTIVE_INCIDENTS, 21),
    );
    expect(statusLabelForEntry(api, createTranslator(undefined))).toBe(
      "21 active incidents",
    );
    expect(
      statusLabelForEntry(
        model.entryByKey.get("web")!,
        dashboardTranslator("de"),
      ),
    ).toBe("2 aktive Warnungen");
  });

  test("a service with neither reads its health in the language", () => {
    const postgres: ServiceMapEntry = model.entryByKey.get("postgres")!;

    expect(statusLabelForEntry(postgres, dashboardTranslator("de"))).toBe(
      word("de", "Healthy"),
    );
    expect(statusLabelForEntry(postgres, createTranslator(undefined))).toBe(
      "Healthy",
    );
  });

  test("a card with no traffic has no stats, and its connections still read", () => {
    const quiet: ServiceMapModel = buildServiceMapModel(
      [item("lonely", EntityType.Service)],
      [],
      { rangeStart: RANGE_START },
    );
    const lonely: ServiceMapEntry = quiet.entryByKey.get("lonely")!;

    expect(
      statsForEntry(lonely, WINDOW_SECONDS, dashboardTranslator("fa")),
    ).toEqual([]);
    expect(connectionsForEntry(lonely, dashboardTranslator("fa"))).toBe(
      "۰ فراخواننده • ۰ وابستگی",
    );
  });
});

describe("a rate and a share of errors in the reader's figures", () => {
  test("English, and every caller that hands no translator, read as before", () => {
    const english: Translator = createTranslator(undefined);

    for (const translator of [undefined, english]) {
      expect(formatCallRate(1200, 60, translator)).toBe("1.2k/min");
      expect(formatCallRate(600, 60, translator)).toBe("600/min");
      expect(formatCallRate(3, 60, translator)).toBe("3.0/min");
      expect(formatErrorRate(600, 60, translator)).toBe("10.0%");
      expect(formatErrorRate(100000, 1, translator)).toBe("<0.1%");
      expect(formatErrorRate(600, 0, translator)).toBe("0%");
      expect(formatErrorRate(0, 0, translator)).toBe("—");
    }
    expect(formatCallRate(5, 0)).toBe("5 calls");
    expect(formatCallRate(1, 0, english)).toBe("1 call");
  });

  test("German groups a large rate and writes its own unit and percent sign", () => {
    const german: Translator = dashboardTranslator("de");

    expect(formatCallRate(1200, 60, german)).toBe("1.200/Min.");
    expect(formatCallRate(72000, 60, german)).toBe("72.000/Min.");
    expect(formatCallRate(3, 60, german)).toBe("3,0/Min.");
    expect(formatErrorRate(600, 60, german)).toBe("10,0\u00a0%");
    expect(formatErrorRate(100000, 1, german)).toBe(
      `<${formatReaderFigure(0.1, { decimals: 1, isPercent: true, language: "de" })}`,
    );
    expect(formatCallRate(5, 0, german)).toBe("5 Aufrufe");
  });

  test("Persian writes Persian digits; Arabic Latin ones", () => {
    expect(formatCallRate(600, 60, dashboardTranslator("fa"))).toBe(
      "۶۰۰/دقیقه",
    );
    expect(formatErrorRate(600, 60, dashboardTranslator("fa"))).toBe("۱۰٫۰٪");
    expect(formatCallRate(600, 60, dashboardTranslator("ar"))).toBe(
      "600/دقيقة",
    );
  });
});

describe("Arabic counts one pod in Arabic (#7725)", () => {
  const arabic: Translator = dashboardTranslator("ar");

  test("one pod, and one of each workload, read with an Arabic word", () => {
    for (const [type, kind] of [
      [EntityType.KubernetesPod, "pod"],
      [EntityType.KubernetesDeployment, "Deployment"],
    ] as Array<[EntityType, string]>) {
      const one: string = countOfType(type, 1, arabic);

      expect(one).toMatch(ARABIC_LETTER);
      expect(one).toBe(`1 مورد ${kind}`);
    }
  });

  test("the Kubernetes pages' one forms are Arabic, not English left in the file", () => {
    const words: Record<string, string> = readDashboardLocale("ar");
    const english: Record<string, string> = readDashboardLocale("en");

    for (const key of [
      "{{count}} pods_one",
      "{{count}} deployments_one",
      "{{count}} cronjobs_one",
      "{{count}} daemonsets_one",
      "{{count}} jobs_one",
      "{{count}} statefulsets_one",
    ]) {
      expect({ key, arabic: ARABIC_LETTER.test(words[key] || "") }).toEqual({
        key,
        arabic: true,
      });
      expect(words[key]).not.toBe(english[key]);
    }
  });

  test("a service's card says where it runs, one pod, in Arabic", async () => {
    await renderIn("ar");

    const footer: string | undefined = cardLines("api").find(
      (line: string): boolean => {
        return line.includes("pod");
      },
    );

    expect(withoutIsolateMarks(footer || "")).toBe("يعمل على: 1 مورد pod");
  });

  test("English left in an Arabic one form reads as English (negative control)", () => {
    const leftInEnglish: Translator = createTranslator((text: string) => {
      return text === "{{count}} pods_one"
        ? "{{count}} pod"
        : readDashboardLocale("ar")[text];
    }, "ar");

    expect(countOfType(EntityType.KubernetesPod, 1, leftInEnglish)).toBe(
      "1 pod",
    );
  });
});

describe("a list longer than a page", () => {
  test.each(LANGUAGES)(
    "%s words the pager whole, in its digits",
    async (language: string) => {
      const translator: Translator = dashboardTranslator(language);
      const many: Array<TopologyEntity> = [];
      for (let index: number = 0; index < 45; index++) {
        many.push(
          item(`service-${String(index).padStart(2, "0")}`, EntityType.Service),
        );
      }

      await renderIn(language, { entities: many, relationships: [] });
      fireEvent.click(screen.getByTestId("service-map-view-list"));

      const pager: HTMLElement = screen.getByTestId("service-map-pagination");

      expect(pager).toHaveTextContent(
        translator.translateTemplate(
          "Showing {{first}}–{{last}} of {{total}}",
          {
            first: translator.formatNumber(1),
            last: translator.formatNumber(40),
            total: translator.formatNumber(45),
          },
        ),
      );
      expect(pager).toHaveTextContent(
        translator.translateTemplate("Page {{current}} of {{total}}", {
          current: translator.formatNumber(1),
          total: translator.formatNumber(2),
        }),
      );
      if (language === "en") {
        expect(pager).toHaveTextContent("Showing 1–40 of 45");
        expect(pager).toHaveTextContent("Page 1 of 2");
      }
      if (language === "fa") {
        expect(pager.textContent || "").not.toMatch(LATIN_DIGIT);
      }
    },
  );
});
