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
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import React from "react";
import { Edge, Node } from "reactflow";
import EntityType from "../../../Types/Telemetry/EntityType";
import EntityRelationshipType from "../../../Types/Telemetry/EntityRelationshipType";
import EntitySource from "../../../Types/Telemetry/EntitySource";
import { createTranslator, Translator } from "../../../Types/Translator";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import InfrastructureGraph, {
  InfrastructureMapLayout,
  TRAFFIC_AVERAGE_DURATION,
  TRAFFIC_ERROR_RATE,
  TRAFFIC_NO_CALLS_COUNTED,
  describeTrafficLink,
  layoutInfrastructureMap,
  trafficEdges,
  trafficMetricLabel,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/InfrastructureGraph";
import {
  InfrastructureTopologyModel,
  InfrastructureTrafficLink,
  buildInfrastructureTopologyModel,
  collectMapCards,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/InfrastructureTopologyModel";
import {
  formatDurationMs,
  formatErrorRate,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/TopologyMeta";
import {
  TopologyEntity,
  TopologyRelationship,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/TopologyData";

/*
 * React Flow's canvas is the one boundary replaced: each line is a button
 * named by its description and labeled with its metric, so what a reader
 * hears and sees of a line can be read off the page.
 */
jest.mock("reactflow", () => {
  return {
    __esModule: true,
    default: (props: {
      nodes: Array<Node>;
      edges: Array<Edge>;
      onEdgeMouseEnter?: (event: React.MouseEvent, edge: Edge) => void;
      onEdgeMouseLeave?: (event: React.MouseEvent, edge: Edge) => void;
    }): React.ReactElement => {
      return (
        <div data-testid="infrastructure-canvas">
          {props.edges.map((edge: Edge): React.ReactElement => {
            return (
              <button
                type="button"
                key={edge.id}
                data-testid={`edge-${edge.id}`}
                aria-label={edge.ariaLabel}
                onMouseEnter={(event: React.MouseEvent): void => {
                  props.onEdgeMouseEnter?.(event, edge);
                }}
                onMouseLeave={(event: React.MouseEvent): void => {
                  props.onEdgeMouseLeave?.(event, edge);
                }}
              >
                {typeof edge.label === "string" ? edge.label : ""}
              </button>
            );
          })}
        </div>
      );
    },
    Background: (): null => {
      return null;
    },
    Controls: (): null => {
      return null;
    },
    Handle: (): null => {
      return null;
    },
    BackgroundVariant: { Dots: "dots" },
    MarkerType: { ArrowClosed: "arrowclosed" },
    Position: { Left: "left", Right: "right" },
  };
});

/*
 * AN INFRASTRUCTURE MAP'S TRAFFIC LINES, IN THE READER'S LANGUAGE (#8350).
 *
 * A line between two cards carries the calls between the services on them,
 * labeled with one metric and described for the reader and their screen
 * reader: "wb-ims-backend → wb-ims-blob: 80/min · 0.5% errors · 45 ms avg".
 * Its label and its description were English built in code, the rate in
 * Latin digits, on every page; each is a sentence of the locale now, its
 * figures in the reader's digits. The services' names have no digits, so a
 * Latin digit in a Persian line is the map's.
 */

const LANGUAGES: ReadonlyArray<string> = ["en", "de", "ar", "fa"];

const LATIN_DIGIT: RegExp = /[0-9]/;
const PERSIAN_DIGIT: RegExp = /[\u{06F0}-\u{06F9}]/u;
const ARABIC_INDIC_DIGIT: RegExp = /[\u{0660}-\u{0669}]/u;

const NOW: Date = new Date("2026-09-07T10:00:00Z");
const WINDOW_SECONDS: number = 15 * 60;

async function readIn(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

function translatorIn(language: string): Translator {
  const words: Record<string, string> = readDashboardLocale(language);

  return createTranslator((key: string): string | undefined => {
    return words[key];
  }, language);
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: Object.fromEntries(
      LANGUAGES.map((language: string) => {
        return [language, { translation: readDashboardLocale(language) }];
      }),
    ),
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(async () => {
  await readIn("en");
});

afterEach(() => {
  cleanup();
});

function entity(key: string, type: EntityType, name: string): TopologyEntity {
  return {
    entityKey: key,
    displayName: name,
    entityType: type,
    lastSeenAt: NOW,
    source: EntitySource.Discovered,
  };
}

function edge(
  from: string,
  to: string,
  type: EntityRelationshipType,
): TopologyRelationship {
  return { fromEntityKey: from, toEntityKey: to, relationshipType: type };
}

function call(
  from: string,
  to: string,
  callCount: number,
  errorCount: number,
  avgDurationMs: number,
): TopologyRelationship {
  return {
    ...edge(from, to, EntityRelationshipType.DependsOn),
    callCount,
    errorCount,
    avgDurationMs,
  };
}

/* A node with three pods: the backend calls the blob store and a slow edh. */
function nodeModel(
  calls: Array<TopologyRelationship> = [
    call("svc-backend", "svc-blob", 1200, 6, 45),
    call("svc-backend", "svc-edh", 300, 30, 1250),
  ],
): InfrastructureTopologyModel {
  return buildInfrastructureTopologyModel(
    [
      entity("svc-backend", EntityType.Service, "backend"),
      entity("svc-blob", EntityType.Service, "blob"),
      entity("svc-edh", EntityType.Service, "edh"),
      entity("node-k", EntityType.KubernetesNode, "agentpool"),
      entity("pod-backend", EntityType.KubernetesPod, "backend-pod"),
      entity("pod-blob", EntityType.KubernetesPod, "blob-pod"),
      entity("pod-edh", EntityType.KubernetesPod, "edh-pod"),
    ],
    [
      edge("pod-backend", "node-k", EntityRelationshipType.RunsOn),
      edge("pod-blob", "node-k", EntityRelationshipType.RunsOn),
      edge("pod-edh", "node-k", EntityRelationshipType.RunsOn),
      edge("svc-backend", "pod-backend", EntityRelationshipType.RunsOn),
      edge("svc-blob", "pod-blob", EntityRelationshipType.RunsOn),
      edge("svc-edh", "pod-edh", EntityRelationshipType.RunsOn),
      ...calls,
    ],
    { rangeStart: new Date("2026-09-06T10:00:00Z") },
  );
}

function layoutOf(model: InfrastructureTopologyModel): InfrastructureMapLayout {
  return layoutInfrastructureMap({
    model,
    nodeIds: collectMapCards(model, "node-k"),
    now: NOW,
  });
}

function linkFor(
  layout: InfrastructureMapLayout,
  from: string,
  to: string,
): InfrastructureTrafficLink {
  return layout.traffic.links.find((link: InfrastructureTrafficLink) => {
    return link.from === from && link.to === to;
  })!;
}

describe("a line's label, metric by metric", () => {
  test("English reads exactly as it always did, with or without a translator", () => {
    const layout: InfrastructureMapLayout = layoutOf(nodeModel());
    const blob: InfrastructureTrafficLink = linkFor(
      layout,
      "pod-backend",
      "pod-blob",
    );

    for (const translator of [undefined, translatorIn("en")]) {
      expect(
        trafficMetricLabel(blob, "calls", WINDOW_SECONDS, translator),
      ).toBe("80/min");
      expect(
        trafficMetricLabel(blob, "errors", WINDOW_SECONDS, translator),
      ).toBe("0.5% errors");
      expect(
        trafficMetricLabel(blob, "latency", WINDOW_SECONDS, translator),
      ).toBe("45\u00A0ms");
    }
  });

  test("German: its own words, decimal comma and units", () => {
    const layout: InfrastructureMapLayout = layoutOf(nodeModel());
    const german: Translator = translatorIn("de");
    const blob: InfrastructureTrafficLink = linkFor(
      layout,
      "pod-backend",
      "pod-blob",
    );
    const edh: InfrastructureTrafficLink = linkFor(
      layout,
      "pod-backend",
      "pod-edh",
    );

    expect(trafficMetricLabel(blob, "calls", WINDOW_SECONDS, german)).toBe(
      "80/Min.",
    );
    expect(trafficMetricLabel(blob, "errors", WINDOW_SECONDS, german)).toBe(
      german.translateTemplate(TRAFFIC_ERROR_RATE, {
        rate: formatErrorRate(1200, 6, german),
      }),
    );
    expect(
      trafficMetricLabel(blob, "errors", WINDOW_SECONDS, german),
    ).not.toContain("errors");
    expect(trafficMetricLabel(edh, "latency", WINDOW_SECONDS, german)).toBe(
      "1,25\u00A0Sek.",
    );
  });

  test("Persian: every metric in Persian digits", () => {
    const layout: InfrastructureMapLayout = layoutOf(nodeModel());
    const persian: Translator = translatorIn("fa");

    for (const link of layout.traffic.links) {
      for (const metric of ["calls", "errors", "latency"] as const) {
        const label: string = withoutIsolateMarks(
          trafficMetricLabel(link, metric, WINDOW_SECONDS, persian),
        );

        expect({ metric, label, latin: LATIN_DIGIT.test(label) }).toEqual({
          metric,
          label,
          latin: false,
        });
        expect(PERSIAN_DIGIT.test(label)).toBe(true);
      }
    }
  });

  test("Arabic: its own words, in Latin digits", () => {
    const layout: InfrastructureMapLayout = layoutOf(nodeModel());
    const arabic: Translator = translatorIn("ar");
    const edh: InfrastructureTrafficLink = linkFor(
      layout,
      "pod-backend",
      "pod-edh",
    );
    const errors: string = trafficMetricLabel(
      edh,
      "errors",
      WINDOW_SECONDS,
      arabic,
    );

    expect(errors).not.toContain("errors");
    expect(LATIN_DIGIT.test(errors)).toBe(true);
    expect(PERSIAN_DIGIT.test(errors)).toBe(false);
    expect(ARABIC_INDIC_DIGIT.test(errors)).toBe(false);
  });
});

describe("a line's description", () => {
  test("English reads exactly as it always did", () => {
    const model: InfrastructureTopologyModel = nodeModel();
    const layout: InfrastructureMapLayout = layoutOf(model);

    expect(
      describeTrafficLink(
        model,
        linkFor(layout, "pod-backend", "pod-blob"),
        WINDOW_SECONDS,
      ),
    ).toBe("backend → blob: 80/min · 0.5% errors · 45\u00A0ms avg");
    expect(
      describeTrafficLink(
        model,
        linkFor(layout, "pod-backend", "pod-edh"),
        WINDOW_SECONDS,
        translatorIn("en"),
      ),
    ).toBe("backend → edh: 20/min · 10.0% errors · 1.25s avg");
  });

  test("German: every fact the locale's, set apart the German way", () => {
    const model: InfrastructureTopologyModel = nodeModel();
    const layout: InfrastructureMapLayout = layoutOf(model);
    const german: Translator = translatorIn("de");

    expect(
      describeTrafficLink(
        model,
        linkFor(layout, "pod-backend", "pod-blob"),
        WINDOW_SECONDS,
        german,
      ),
    ).toBe(
      `backend → blob: 80/Min. · ${german.translateTemplate(
        TRAFFIC_ERROR_RATE,
        {
          rate: formatErrorRate(1200, 6, german),
        },
      )} · ${german.translateTemplate(TRAFFIC_AVERAGE_DURATION, {
        duration: "45\u00A0ms",
      })}`,
    );
  });

  test("Persian: no Latin digit, its arrows pointing the way Persian reads", () => {
    const model: InfrastructureTopologyModel = nodeModel();
    const layout: InfrastructureMapLayout = layoutOf(model);
    const persian: Translator = translatorIn("fa");

    for (const link of layout.traffic.links) {
      const description: string = withoutIsolateMarks(
        describeTrafficLink(model, link, WINDOW_SECONDS, persian),
      );

      expect(LATIN_DIGIT.test(description)).toBe(false);
      expect(PERSIAN_DIGIT.test(description)).toBe(true);
      expect(description).toContain("←");
      expect(description).not.toContain("errors");
      expect(description).not.toContain("avg");
    }
  });

  test("a line whose calls reported no count says so in the reader's words", () => {
    const model: InfrastructureTopologyModel = nodeModel([
      edge("svc-backend", "svc-blob", EntityRelationshipType.DependsOn),
    ]);
    const layout: InfrastructureMapLayout = layoutOf(model);
    const [link] = layout.traffic.links;

    expect(describeTrafficLink(model, link!, WINDOW_SECONDS)).toBe(
      "backend → blob: no calls counted",
    );
    expect(
      describeTrafficLink(model, link!, WINDOW_SECONDS, translatorIn("de")),
    ).toBe(
      `backend → blob: ${translatorIn("de").translateText(TRAFFIC_NO_CALLS_COUNTED)}`,
    );
    expect(
      describeTrafficLink(model, link!, WINDOW_SECONDS, translatorIn("fa")),
    ).not.toContain("no calls counted");
  });

  test("a line standing for many calls counts the rest in the reader's digits", () => {
    const model: InfrastructureTopologyModel = buildInfrastructureTopologyModel(
      [
        entity("a", EntityType.Service, "alpha"),
        entity("c", EntityType.Service, "charlie"),
        entity("d", EntityType.Service, "delta"),
        entity("e", EntityType.Service, "echo"),
        entity("f", EntityType.Service, "foxtrot"),
        entity("h-a", EntityType.Host, "host-a"),
        entity("h-b", EntityType.Host, "host-b"),
      ],
      [
        edge("a", "h-a", EntityRelationshipType.RunsOn),
        edge("c", "h-b", EntityRelationshipType.RunsOn),
        edge("d", "h-b", EntityRelationshipType.RunsOn),
        edge("e", "h-b", EntityRelationshipType.RunsOn),
        edge("f", "h-b", EntityRelationshipType.RunsOn),
        call("a", "c", 40, 0, 1),
        call("a", "d", 30, 0, 1),
        call("a", "e", 20, 0, 1),
        call("a", "f", 10, 0, 1),
      ],
      { rangeStart: new Date("2026-09-06T10:00:00Z") },
    );
    const layout: InfrastructureMapLayout = layoutInfrastructureMap({
      model,
      nodeIds: ["h-a", "h-b"],
      now: NOW,
    });
    const link: InfrastructureTrafficLink = linkFor(layout, "h-a", "h-b");

    expect(describeTrafficLink(model, link, WINDOW_SECONDS)).toContain(
      "alpha → echo +1:",
    );

    const persian: string = withoutIsolateMarks(
      describeTrafficLink(model, link, WINDOW_SECONDS, translatorIn("fa")),
    );

    expect(persian).toContain("+۱");
    expect(persian).toContain("، ");
    expect(LATIN_DIGIT.test(persian)).toBe(false);
  });

  test("a sentence the language has not worded reads wholly in English", () => {
    const model: InfrastructureTopologyModel = nodeModel();
    const layout: InfrastructureMapLayout = layoutOf(model);
    const words: Record<string, string> = readDashboardLocale("de");
    const unworded: Translator = createTranslator(
      (key: string): string | undefined => {
        return key === TRAFFIC_ERROR_RATE ? undefined : words[key];
      },
      "de",
    );

    expect(
      trafficMetricLabel(
        linkFor(layout, "pod-backend", "pod-blob"),
        "errors",
        WINDOW_SECONDS,
        unworded,
      ),
    ).toBe("0.5% errors");
  });
});

describe("trafficEdges hands each line its words", () => {
  test("in Persian, every label and name in Persian digits", () => {
    const model: InfrastructureTopologyModel = nodeModel();
    const layout: InfrastructureMapLayout = layoutOf(model);

    for (const label of ["calls", "errors", "latency"] as const) {
      const edges: Array<Edge> = trafficEdges({
        model,
        links: layout.traffic.links,
        label,
        metricsWindowSeconds: WINDOW_SECONDS,
        translator: translatorIn("fa"),
      });

      for (const drawn of edges) {
        const texts: Array<string> = [
          String(drawn.label || ""),
          drawn.ariaLabel || "",
        ].map(withoutIsolateMarks);

        expect(
          texts.filter((text: string): boolean => {
            return LATIN_DIGIT.test(text);
          }),
        ).toEqual([]);
      }
    }
  });
});

describe("the map, drawn in each language", () => {
  function renderMap(model: InfrastructureTopologyModel = nodeModel()): void {
    render(
      <InfrastructureGraph
        model={model}
        nodeIds={collectMapCards(model, "node-k")}
        onOpenNode={() => {}}
        metricsWindowSeconds={WINDOW_SECONDS}
        now={NOW}
      />,
    );
  }

  function lines(): Array<HTMLElement> {
    return screen.getAllByTestId(/^edge-traffic:/);
  }

  test("Persian: the lines' labels, names and hover in Persian digits", async () => {
    await readIn("fa");
    renderMap();

    expect(lines().length).toBe(2);

    for (const line of lines()) {
      const label: string = withoutIsolateMarks(line.textContent || "");
      const name: string = withoutIsolateMarks(
        line.getAttribute("aria-label") || "",
      );

      expect(LATIN_DIGIT.test(label)).toBe(false);
      expect(PERSIAN_DIGIT.test(label)).toBe(true);
      expect(LATIN_DIGIT.test(name)).toBe(false);
    }

    fireEvent.mouseEnter(lines()[0]!);

    const hover: string = withoutIsolateMarks(
      screen.getByTestId("infrastructure-traffic-hover").textContent || "",
    );

    expect(LATIN_DIGIT.test(hover)).toBe(false);
    expect(hover).not.toContain("errors");
  });

  test("German: the lines' names in German", async () => {
    await readIn("de");
    renderMap();

    const names: Array<string> = lines().map((line: HTMLElement): string => {
      return line.getAttribute("aria-label") || "";
    });

    expect(names.join(" ")).toContain("/Min.");
    expect(names.join(" ")).not.toContain(" errors");
    expect(names.join(" ")).not.toContain(" avg");
  });

  test("English: as it always read", async () => {
    renderMap();

    expect(
      screen.getByRole("button", {
        name: "backend → blob: 80/min · 0.5% errors · 45\u00A0ms avg",
      }),
    ).toBeInTheDocument();
  });
});

describe("formatDurationMs, from a second up", () => {
  test("English keeps its seconds as written", () => {
    expect(formatDurationMs(1250)).toBe("1.25s");
    expect(formatDurationMs(1250, translatorIn("en"))).toBe("1.25s");
    expect(formatDurationMs(12_000)).toBe("12.00s");
  });

  test("another language writes its own seconds", () => {
    expect(formatDurationMs(1250, translatorIn("de"))).toBe("1,25\u00A0Sek.");
    expect(formatDurationMs(1250, translatorIn("fa"))).toBe("۱٫۲۵\u00A0ثانیه");
    expect(formatDurationMs(1250, translatorIn("ar"))).toBe("1.25\u00A0ث");
  });

  test("the check would find a Latin digit in a Persian line", () => {
    expect(LATIN_DIGIT.test("80/min · 0.5% errors")).toBe(true);
    expect(LATIN_DIGIT.test(formatDurationMs(1250, translatorIn("fa")))).toBe(
      false,
    );
  });
});
