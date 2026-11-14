import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
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
import { createInstance, i18n } from "i18next";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { Node } from "reactflow";
import { setDateDisplayLanguage } from "../../../Types/DateLanguage";
import EntityRelationshipType from "../../../Types/Telemetry/EntityRelationshipType";
import EntitySource from "../../../Types/Telemetry/EntitySource";
import EntityType from "../../../Types/Telemetry/EntityType";
import TimeRange from "../../../Types/Time/TimeRange";
import ServiceMapGraph from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/ServiceMapGraph";
import {
  TopologyEntity,
  TopologyRelationship,
  TopologyRunsOnCount,
  TopologyRunsOnCounts,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/TopologyData";
import { drawLine, getDrawnText } from "../../Helpers/BidiLayout";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { isolated, withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * #7658: WHERE A SERVICE RUNS, ON THE SERVICE MAP, IN THE READER'S LANGUAGE.
 *
 * A service's line in the list ("Service · 12 pods · 3 Docker hosts"), the
 * last line of its card ("Runs on ...", "Called by 2 services") and its
 * line in the tray of services not connected were English in every
 * language, their counts in Latin digits. Persian drew its line of counts
 * out of order besides: a noun left in Latin letters ("میزبان Docker") took
 * the separator and the next count's digits into its left-to-right run.
 *
 * Rendered here from the real locale files through a real i18next
 * instance. React Flow, the viewport guard, the drawers and the overlay's
 * transport are stood in for, as in ServiceMapGraph.test.
 */

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
        return new Map();
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Topology/EntityDetailPanel",
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
// A card's last line, as the map hands it to React Flow.
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
    default: (props: { nodes: Array<Node>; children?: React.ReactNode }) => {
      return (
        <div data-testid="rendered-graph">
          {props.nodes.map((node: Node) => {
            return (
              <span
                key={node.id}
                data-testid={`map-node-${node.id}`}
                data-footer={node.data.footer || ""}
              >
                {node.data.label}
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

const LATIN_DIGIT: RegExp = /[0-9]/;

function item(key: string, type: EntityType): TopologyEntity {
  return {
    entityKey: key,
    displayName: key,
    entityType: type,
    source: EntitySource.Discovered,
    lastSeenAt: NOW,
  };
}

function calls(from: string, to: string): TopologyRelationship {
  return {
    fromEntityKey: from,
    toEntityKey: to,
    relationshipType: EntityRelationshipType.DependsOn,
    callCount: 600,
    errorCount: 0,
    avgDurationMs: 25,
  };
}

function runsOn(entityType: EntityType, count: number): TopologyRunsOnCount {
  return { entityType, active: count, total: count };
}

/*
 * web calls api, api calls postgres; api runs on 3 Docker hosts and 2 pods,
 * and worker - connected to nothing - on 12 nodes and a Docker host.
 */
const ENTITIES: Array<TopologyEntity> = [
  item("web", EntityType.Service),
  item("api", EntityType.Service),
  item("worker", EntityType.Service),
  item("postgres", EntityType.Database),
];

const RELATIONSHIPS: Array<TopologyRelationship> = [
  calls("web", "api"),
  calls("api", "postgres"),
];

const RUNS_ON_COUNTS: TopologyRunsOnCounts = new Map<
  string,
  Array<TopologyRunsOnCount>
>([
  [
    "api",
    [runsOn(EntityType.KubernetesPod, 2), runsOn(EntityType.DockerHost, 3)],
  ],
  [
    "worker",
    [runsOn(EntityType.DockerHost, 1), runsOn(EntityType.KubernetesNode, 12)],
  ],
]);

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

async function renderIn(language: string): Promise<void> {
  setDateDisplayLanguage(language);
  await act(async () => {
    render(
      <I18nextProvider i18n={instanceFor(language)}>
        <MemoryRouter>
          <ServiceMapGraph
            entities={ENTITIES}
            relationships={RELATIONSHIPS}
            runsOnCounts={RUNS_ON_COUNTS}
            metricsWindowSeconds={60}
            timeRange={{ range: TimeRange.PAST_ONE_DAY }}
            rangeStart={RANGE_START}
          />
        </MemoryRouter>
      </I18nextProvider>,
    );
  });
}

// The line under a service's name in the list.
function listLine(name: string): string {
  fireEvent.click(screen.getByTestId("service-map-view-list"));

  const row: HTMLElement | null = screen
    .getByRole("button", { name, exact: true })
    .closest("tr");

  expect(row).not.toBeNull();

  return (
    within(row as HTMLElement).getByTestId("service-map-list-row-kind")
      .textContent || ""
  );
}

// A service's line in the tray of services connected to nothing.
function trayLine(name: string): string {
  const button: HTMLElement = within(
    screen.getByTestId("service-map-unconnected"),
  ).getByRole("button", { name: new RegExp(name) });

  return (
    Array.from(button.querySelectorAll("span.block"))
      .map((span: Element): string => {
        return span.textContent || "";
      })
      .find((text: string): boolean => {
        return text !== name;
      }) || ""
  );
}

function footer(key: string): string {
  return (
    screen.getByTestId(`map-node-${key}`).getAttribute("data-footer") || ""
  );
}

/*
 * A line of facts read from the right, as a browser draws it (BidiLayout):
 * each part drawn as it is drawn on its own, the first on the right.
 */
function drawnAsParts(parts: ReadonlyArray<string>, separator: string): string {
  return parts
    .map((part: string): string => {
      return getDrawnText(drawLine(part, "rtl"));
    })
    .reverse()
    .join(separator);
}

interface Expected {
  listLine: string;
  trayLine: string;
  runsOnFooter: string;
  calledByFooter: string;
}

const PERSIAN_PARTS: ReadonlyArray<string> = [
  "سرویس",
  "۳ میزبان Docker",
  "۲ پاد",
];

const ARABIC_PARTS: ReadonlyArray<string> = [
  "الخدمة",
  "مضيفو Docker: 3",
  "2 من الـ pods",
];

const EXPECTED: Record<string, Expected> = {
  en: {
    listLine: "Service · 3 Docker hosts · 2 pods",
    trayLine: "Service · 12 nodes · 1 Docker host",
    runsOnFooter: "Runs on 3 Docker hosts · 2 pods",
    calledByFooter: "Called by 1 service",
  },
  fa: {
    listLine: `سرویس • ${isolated("۳ میزبان Docker")} • ${isolated("۲ پاد")}`,
    trayLine: `سرویس • ${isolated("۱۲ گره")} • ${isolated("۱ میزبان Docker")}`,
    runsOnFooter: `اجرا روی ${isolated("۳ میزبان Docker")} • ${isolated("۲ پاد")}`,
    calledByFooter: "فراخوانده‌شده توسط ۱ سرویس",
  },
  ar: {
    listLine: `الخدمة · ${isolated("مضيفو Docker: 3")} · ${isolated("2 من الـ pods")}`,
    trayLine: `الخدمة · ${isolated("العقد: 12")} · ${isolated("1 مضيف Docker")}`,
    runsOnFooter: `يعمل على: ${isolated("مضيفو Docker: 3")} · ${isolated("2 من الـ pods")}`,
    calledByFooter: "مستدعى من 1 خدمة",
  },
};

beforeAll(() => {
  for (const language of Object.keys(EXPECTED)) {
    instanceFor(language);
  }
});

afterEach(() => {
  cleanup();
  setDateDisplayLanguage(null);
  window.history.replaceState({}, "", "/");
});

describe.each(Object.keys(EXPECTED))(
  "the service map in %s",
  (language: string) => {
    const expected: Expected = EXPECTED[language] as Expected;

    test("a card's last line says where it runs, or how many call it", async () => {
      await renderIn(language);

      expect(footer("api")).toBe(expected.runsOnFooter);
      expect(footer("postgres")).toBe(expected.calledByFooter);
    });

    test("the tray's line of a service connected to nothing", async () => {
      await renderIn(language);

      expect(trayLine("worker")).toBe(expected.trayLine);
    });

    test("the list's line under a service", async () => {
      await renderIn(language);

      expect(listLine("api")).toBe(expected.listLine);
    });
  },
);

describe("read from the right", () => {
  test("Persian's line in the list is one line of Persian digits, each count drawn whole, in order", async () => {
    await renderIn("fa");

    const line: string = listLine("api");

    expect(line).not.toMatch(LATIN_DIGIT);
    expect(withoutIsolateMarks(line)).toBe(PERSIAN_PARTS.join(" • "));
    expect(getDrawnText(drawLine(line, "rtl"))).toBe(
      drawnAsParts(PERSIAN_PARTS, " • "),
    );
  });

  test("Arabic's too", async () => {
    await renderIn("ar");

    const line: string = listLine("api");

    expect(withoutIsolateMarks(line)).toBe(ARABIC_PARTS.join(" · "));
    expect(getDrawnText(drawLine(line, "rtl"))).toBe(
      drawnAsParts(ARABIC_PARTS, " · "),
    );
  });

  test("the same parts joined without isolates are drawn out of order (negative control)", () => {
    const persian: string = PERSIAN_PARTS.join(" • ");
    const arabic: string = ARABIC_PARTS.join(" · ");

    expect(getDrawnText(drawLine(persian, "rtl"))).not.toBe(
      drawnAsParts(PERSIAN_PARTS, " • "),
    );
    expect(getDrawnText(drawLine(arabic, "rtl"))).not.toBe(
      drawnAsParts(ARABIC_PARTS, " · "),
    );
  });
});
