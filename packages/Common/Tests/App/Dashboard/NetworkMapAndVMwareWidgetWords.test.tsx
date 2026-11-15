import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { Mock } from "jest-mock";
import {
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  waitFor,
} from "@testing-library/react";
import fs from "fs";
import path from "path";
import i18next from "i18next";
import React, { FunctionComponent } from "react";
import { initReactI18next } from "react-i18next";
import { DashboardBaseComponentProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import { setPublicDashboardContext } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Utils/PublicDashboardContext";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import TimeRange from "../../../Types/Time/TimeRange";
import { getInlineSeparator, Translator } from "../../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * THE NETWORK MAP'S AND THE VMWARE HOST LIST'S WORDS, IN THE READER'S
 * LANGUAGE (#7520).
 *
 * PR #7413 worded what the list widgets write for a value they do not
 * have. The Network Map and the VMware host list still wrote words of
 * their own, in English on every board:
 *
 * - a site with no name read "Unnamed site", one with no status yet "No
 *   status yet", in the site list, the drawer and the tooltips, and the
 *   statuses a project starts with ("Operational") stayed English;
 * - the line under the map was built from English fragments ("3 of 12
 *   sites in view · 4 without coordinates · more sites not shown"), in
 *   gray-300 at 10px: 1.5:1 on a light card;
 * - a VMware host's tooltip read "42.5% of 2.4 GHz", English "of" and an
 *   English decimal point.
 *
 * Each is the reader's now: a whole sentence per fact, in their digits,
 * set apart the way their language sets facts apart. English reads exactly
 * as it did.
 */

type ListRequest = { query: JSONObject; limit: number };
type ListResponse = { data: Array<JSONObject>; count: number };

const listMock: Mock<(request: ListRequest) => Promise<ListResponse>> =
  jest.fn<(request: ListRequest) => Promise<ListResponse>>();

// Lazy dereference: jest.mock factories are hoisted above these assignments.
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return {};
      },
      getList: (request: ListRequest) => {
        return listMock(request);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("44444444-4444-4444-8444-444444444444");
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyErrorMessage: (error: Error) => {
        return error.message;
      },
    },
  };
});

// The map's land outlines: none, and nothing to fetch.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NetworkSite/Geo/WorldGeometry",
  () => {
    return {
      __esModule: true,
      getCachedGeometryFeatures: () => {
        return [];
      },
      loadGeometryFeatures: () => {
        return Promise.resolve([]);
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLink",
  () => {
    return {
      __esModule: true,
      default: (props: { children: React.ReactNode }) => {
        return React.createElement("a", {}, props.children);
      },
    };
  },
);

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap", () => {
  return {
    __esModule: true,
    default: {},
    RouteUtil: {
      populateRouteParams: () => {
        return {
          toString: () => {
            return "/dashboard/resource";
          },
        };
      },
    },
  };
});

import DashboardNetworkMapComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardNetworkMapComponent";
import DashboardVMwareHostListComponentElement, {
  formatVMwareHostBytes,
  formatVMwareHostMhz,
  formatVMwareHostPercent,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardVMwareHostListComponent";
import {
  buildNetworkMapMarkers,
  describeNetworkMapCoverage,
  NETWORK_MAP_LEGEND,
  NetworkMapLegendEntry,
  NetworkMapMarker,
  NetworkMapSite,
  NetworkMapSiteInput,
  toNetworkMapSites,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/NetworkMapWidgetData";

const NBSP: string = String.fromCharCode(0xa0);
const LATIN_DIGIT: RegExp = /[0-9]/;
const DRAWN_LANGUAGES: ReadonlyArray<string> = ["en", "de", "ar", "fa"];

// The English the coverage line and the tooltips were glued from.
const ENGLISH_WORDS: ReadonlyArray<RegExp> = [
  /\bsites?\b/,
  /\bmapped\b/,
  /\bin view\b/,
  /\bwithout coordinates\b/,
  /\bnot shown\b/,
  /\bUnnamed\b/,
  /\bNo status\b/,
  /\bOperational\b/,
  /\bmore\b/,
  / of /,
];

const COMPONENT_ID: ObjectID = new ObjectID(
  "c0000000-0000-4000-8000-000000007520",
);
const DASHBOARD_ID: string = "d0000000-0000-4000-8000-000000007520";

const DASHBOARD_VIEW_CONFIG: DashboardViewConfig = {
  _type: ObjectType.DashboardViewConfig,
  components: [],
  heightInDashboardUnits: 12,
};

function words(language: string): Record<string, string> {
  return readDashboardLocale(language);
}

function englishWordsIn(text: string): Array<string> {
  return ENGLISH_WORDS.filter((word: RegExp): boolean => {
    return word.test(text);
  }).map((word: RegExp): string => {
    return word.source;
  });
}

async function inLanguage(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

function propsOf(
  type: DashboardComponentType,
  widgetArguments: JSONObject,
): DashboardBaseComponentProps & { component: DashboardBaseComponent } {
  return {
    componentId: COMPONENT_ID,
    key: COMPONENT_ID.toString(),
    isEditMode: false,
    isSelected: false,
    onComponentUpdate: (): void => {
      // A widget never writes back through this here.
    },
    totalCurrentDashboardWidthInPx: 1280,
    dashboardCanvasTopInPx: 0,
    dashboardCanvasLeftInPx: 0,
    dashboardCanvasWidthInPx: 1280,
    dashboardCanvasHeightInPx: 800,
    dashboardComponentHeightInPx: 400,
    dashboardComponentWidthInPx: 640,
    dashboardViewConfig: DASHBOARD_VIEW_CONFIG,
    dashboardStartAndEndDate: { range: TimeRange.PAST_ONE_HOUR },
    metricTypes: [],
    refreshTick: 0,
    variables: [],
    dashboardId: DASHBOARD_ID,
    component: {
      _type: ObjectType.DashboardComponent,
      componentId: COMPONENT_ID,
      componentType: type,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      widthInDashboardUnits: 8,
      heightInDashboardUnits: 6,
      minWidthInDashboardUnits: 4,
      minHeightInDashboardUnits: 3,
      arguments: widgetArguments,
    } as unknown as DashboardBaseComponent,
  };
}

type WidgetElement = FunctionComponent<
  DashboardBaseComponentProps & { component: DashboardBaseComponent }
>;

/*
 * The honeycomb watches its width; jsdom has no ResizeObserver, and
 * nothing here resizes.
 */
class StillResizeObserver {
  public observe(): void {
    // Nothing resizes here.
  }

  public unobserve(): void {
    // Nothing to stop watching.
  }

  public disconnect(): void {
    // Nothing to disconnect.
  }
}

const ORIGINAL_RESIZE_OBSERVER: unknown = (
  globalThis as unknown as { ResizeObserver: unknown }
).ResizeObserver;

beforeAll(async () => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    StillResizeObserver;

  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const language of ["en", ...DASHBOARD_LANGUAGES]) {
    resources[language] = { translation: readDashboardLocale(language) };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: resources,
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(async () => {
  listMock.mockReset();
  window.localStorage.clear();
  setPublicDashboardContext(null);
  await inLanguage("en");
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

afterAll(async () => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    ORIGINAL_RESIZE_OBSERVER;
  await i18next.changeLanguage("en");
});

// The words the widgets draw, each worded in every Dashboard language.
const WIDGET_KEYS: ReadonlyArray<string> = [
  "Unnamed site",
  "No status yet",
  "Operational",
  "Degraded",
  "Offline",
  "No status",
  "{{count}} sites mapped",
  "{{count}} sites mapped_one",
  "{{inView}} of {{count}} sites in view",
  "{{inView}} of {{count}} sites in view_one",
  "{{count}} without coordinates",
  "{{count}} without coordinates_one",
  "more sites not shown",
  "{{count}} sites: {{names}}",
  "{{count}} sites: {{names}}, +{{more}} more",
  "{{used}} of {{capacity}}",
  "Capacity {{capacity}}",
];

describe("the words, in every Dashboard language", () => {
  test.each(WIDGET_KEYS)("%s is worded in every language", (key: string) => {
    for (const language of DASHBOARD_LANGUAGES) {
      expect({
        language,
        key,
        worded: isWordedInDashboardLocale(key, language),
      }).toEqual({ language, key, worded: true });
    }
  });

  test("negative control: a key the locales leave English is not worded", () => {
    expect(isWordedInDashboardLocale("a key no locale has", "de")).toBe(false);
  });
});

describe("the coverage line under the map", () => {
  const ALL: Parameters<typeof describeNetworkMapCoverage>[0] = {
    siteCount: 250,
    inViewCount: 90,
    unplacedCount: 4,
    isTruncated: true,
  };

  test("in English, word for word as it always read", () => {
    const english: Translator = dashboardTranslator("en");

    expect(describeNetworkMapCoverage(ALL, english)).toBe(
      "90 of 250 sites in view · 4 without coordinates · more sites not shown",
    );
    expect(
      describeNetworkMapCoverage(
        { siteCount: 1, inViewCount: 1, unplacedCount: 1, isTruncated: false },
        english,
      ),
    ).toBe("1 site mapped · 1 without coordinates");
    expect(
      describeNetworkMapCoverage(
        {
          siteCount: 12,
          inViewCount: 12,
          unplacedCount: 0,
          isTruncated: false,
        },
        english,
      ),
    ).toBe("12 sites mapped");
    // With no translator, the page's: English until a language is set.
    expect(describeNetworkMapCoverage(ALL)).toBe(
      describeNetworkMapCoverage(ALL, english),
    );
  });

  test("in German, each fact a German sentence", () => {
    const de: Translator = dashboardTranslator("de");

    expect(describeNetworkMapCoverage(ALL, de)).toBe(
      "90 von 250 Standorten im Blick · 4 ohne Koordinaten · weitere Standorte nicht angezeigt",
    );
    expect(
      describeNetworkMapCoverage(
        { siteCount: 1, inViewCount: 1, unplacedCount: 0, isTruncated: false },
        de,
      ),
    ).toBe("1 Standort auf der Karte");
    expect(
      describeNetworkMapCoverage(
        {
          siteCount: 1200,
          inViewCount: 1200,
          unplacedCount: 0,
          isTruncated: false,
        },
        de,
      ),
    ).toBe("1.200 Standorte auf der Karte");
  });

  test("in Persian: Persian digits, and the facts set apart by a bullet, not a dot its zero would read as", () => {
    const fa: Translator = dashboardTranslator("fa");
    const line: string = describeNetworkMapCoverage(ALL, fa);

    expect(line).toBe(
      "۹۰ از ۲۵۰ سایت در نما • ۴ بدون مختصات • سایت‌های بیشتری نشان داده نشده است",
    );
    expect(line).not.toMatch(LATIN_DIGIT);
    expect(line).not.toContain("·");
  });

  test.each(
    DRAWN_LANGUAGES.filter((l: string) => {
      return l !== "en";
    }),
  )("on a %s board no English word is left in it", (language: string) => {
    const translator: Translator = dashboardTranslator(language);

    for (const input of [
      ALL,
      {
        siteCount: 12,
        inViewCount: 12,
        unplacedCount: 0,
        isTruncated: false,
      },
      { siteCount: 1, inViewCount: 0, unplacedCount: 1, isTruncated: false },
    ]) {
      const line: string = describeNetworkMapCoverage(input, translator);

      expect({ language, line, english: englishWordsIn(line) }).toEqual({
        language,
        line,
        english: [],
      });
    }
  });

  test("every language words each fact, with its own separator between them", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const translator: Translator = dashboardTranslator(language);
      const line: string = describeNetworkMapCoverage(ALL, translator);

      expect(line.split(getInlineSeparator(language))).toHaveLength(3);
      expect(line).not.toContain("more sites not shown");
      expect(line).not.toContain("without coordinates");
    }
  });
});

describe("a site's words: no name, no status yet, a status a project starts with", () => {
  const ROWS: Array<NetworkMapSiteInput> = [
    { id: "a", name: "", latitude: 52.37, longitude: 4.9, statusName: "" },
    {
      id: "b",
      name: "Rotterdam edge",
      latitude: 51.92,
      longitude: 4.48,
      statusName: "Operational",
      isOperational: true,
    },
    {
      id: "c",
      name: "Utrecht core",
      latitude: 52.09,
      longitude: 5.12,
      // A status the project named itself is the project's word.
      statusName: "Open",
    },
  ];

  test("in English, as they always read", () => {
    const sites: Array<NetworkMapSite> = toNetworkMapSites(
      ROWS,
      dashboardTranslator("en"),
    ).sites;

    expect(
      sites.map((site: NetworkMapSite) => {
        return site.name;
      }),
    ).toEqual(["Unnamed site", "Rotterdam edge", "Utrecht core"]);
    expect(
      sites.map((site: NetworkMapSite) => {
        return site.statusName;
      }),
    ).toEqual(["No status yet", "Operational", "Open"]);
  });

  test.each(
    DRAWN_LANGUAGES.filter((l: string) => {
      return l !== "en";
    }),
  )(
    "on a %s board, in the reader's words; a name the project gave, as written",
    (language: string) => {
      const sites: Array<NetworkMapSite> = toNetworkMapSites(
        ROWS,
        dashboardTranslator(language),
      ).sites;

      expect(sites[0]!.name).toBe(words(language)["Unnamed site"]);
      expect(sites[0]!.statusName).toBe(words(language)["No status yet"]);
      expect(sites[1]!.name).toBe("Rotterdam edge");
      expect(sites[1]!.statusName).toBe(words(language)["Operational"]);
      expect(sites[2]!.statusName).toBe("Open");

      for (const site of sites) {
        expect(site.name).not.toBe("Unnamed site");
        expect(site.statusName).not.toBe("No status yet");
        expect(site.statusName).not.toBe("Operational");
      }
    },
  );

  test("a site's tooltip: its name, type and status, set apart as the reader's language does", () => {
    for (const language of DRAWN_LANGUAGES) {
      const translator: Translator = dashboardTranslator(language);
      const sites: Array<NetworkMapSite> = toNetworkMapSites(
        [
          {
            id: "solo",
            name: "",
            siteType: "Store",
            latitude: -33.87,
            longitude: 151.21,
            statusName: "Operational",
            isOperational: true,
          },
        ],
        translator,
      ).sites;
      const marker: NetworkMapMarker = buildNetworkMapMarkers({
        sites,
        cellSize: 1,
        showLabels: true,
        zoom: 1,
        translator,
      })[0]!;

      expect({ language, tooltip: marker.tooltip }).toEqual({
        language,
        tooltip: [
          words(language)["Unnamed site"],
          "Store",
          words(language)["Operational"],
        ].join(getInlineSeparator(language)),
      });
      // The marker's name under it is the reader's word too.
      expect(marker.label).toBe(
        words(language)["Unnamed site"]!.slice(0, marker.label.length),
      );
    }
  });

  function cluster(language: string, count: number): string {
    const translator: Translator = dashboardTranslator(language);
    const sites: Array<NetworkMapSite> = toNetworkMapSites(
      Array.from({ length: count }, (_unused: unknown, index: number) => {
        return {
          id: `site-${index}`,
          name: index === 0 ? "" : `Store ${index}`,
          latitude: 51.5 + index * 0.0001,
          longitude: -0.12,
        };
      }),
      translator,
    ).sites;

    return buildNetworkMapMarkers({
      sites,
      cellSize: 1000,
      showLabels: true,
      zoom: 1,
      translator,
    })[0]!.tooltip;
  }

  test("a cluster's tooltip: in English as it always read", () => {
    expect(cluster("en", 8)).toBe(
      "8 sites: Unnamed site, Store 1, Store 2, Store 3, Store 4, +3 more",
    );
    expect(cluster("en", 3)).toBe("3 sites: Unnamed site, Store 1, Store 2");
  });

  test("a cluster's tooltip: in German and Persian, their count and list", () => {
    expect(cluster("de", 8)).toBe(
      "8 Standorte: Unbenannter Standort, Store 1, Store 2, Store 3, Store 4, +3 weitere",
    );

    const persian: string = cluster("fa", 8);

    expect(persian.startsWith("۸ سایت: سایت بی‌نام، Store 1، ")).toBe(true);
    expect(persian).toContain("۳ مورد دیگر");
    // Its counts in Persian digits; only the sites' own names keep theirs.
    expect(persian).not.toContain("+3");
    expect(persian.startsWith("8")).toBe(false);
  });

  test("the legend's labels are English keys, worded where they are drawn", () => {
    expect(
      NETWORK_MAP_LEGEND.map((entry: NetworkMapLegendEntry) => {
        return entry.label;
      }),
    ).toEqual(["Operational", "Degraded", "Offline", "No status"]);
  });
});

describe("the Network Map widget, drawn", () => {
  /*
   * Five rows for a cap of four: a site with no name, one with no status
   * yet, one Operational, one with no coordinates, and the row past the
   * cap that says more sites exist than the map shows.
   */
  function sitesAre(): void {
    listMock.mockResolvedValue({
      data: [
        {
          _id: ObjectID.generate().toString(),
          name: "",
          latitude: 52.37,
          longitude: 4.9,
          currentMonitorStatus: {
            name: "Degraded",
            isOperationalState: false,
          },
        },
        {
          _id: ObjectID.generate().toString(),
          name: "Rotterdam edge",
          latitude: 51.92,
          longitude: 4.48,
        },
        {
          _id: ObjectID.generate().toString(),
          name: "Utrecht core",
          latitude: 52.09,
          longitude: 5.12,
          currentMonitorStatus: {
            name: "Operational",
            isOperationalState: true,
          },
        },
        {
          _id: ObjectID.generate().toString(),
          name: "Eindhoven depot",
        },
        {
          _id: ObjectID.generate().toString(),
          name: "Zwolle depot",
          latitude: 52.51,
          longitude: 6.09,
        },
      ],
      count: 5,
    });
  }

  async function drawMap(
    viewMode: "map" | "list" = "map",
  ): Promise<RenderResult> {
    sitesAre();

    const Element: WidgetElement =
      DashboardNetworkMapComponentElement as unknown as WidgetElement;
    const result: RenderResult = render(
      <Element
        {...propsOf(DashboardComponentType.NetworkMap, {
          title: "Edge sites",
          maxSites: 4,
          viewMode: viewMode,
        })}
      />,
    );

    if (viewMode === "map") {
      await screen.findByTestId("network-map-widget");
      await waitFor(() => {
        expect(
          screen.getAllByTestId("network-map-widget-marker").length,
        ).toBeGreaterThan(0);
      });
    } else {
      await waitFor(() => {
        expect(result.container.querySelectorAll("tbody tr").length).toBe(3);
      });
    }

    return result;
  }

  function coverage(): HTMLElement {
    return screen.getByTestId("network-map-widget-coverage");
  }

  function markerTooltips(): Array<string> {
    return screen
      .getAllByTestId("network-map-widget-marker")
      .map((marker: HTMLElement): string => {
        return marker.querySelector("title")?.textContent || "";
      });
  }

  test("on an English board the coverage line reads as it always did", async () => {
    await drawMap();

    expect(coverage().textContent).toBe(
      "3 sites mapped · 1 without coordinates · more sites not shown",
    );
  });

  test.each(["de", "ar", "fa"])(
    "on a %s board the coverage line, the legend and the markers are the reader's",
    async (language: string) => {
      await inLanguage(language);
      await drawMap();

      const translator: Translator = dashboardTranslator(language);
      const line: string = coverage().textContent || "";

      expect(line).toBe(
        describeNetworkMapCoverage(
          { siteCount: 3, inViewCount: 3, unplacedCount: 1, isTruncated: true },
          translator,
        ),
      );
      expect(englishWordsIn(line)).toEqual([]);

      for (const entry of NETWORK_MAP_LEGEND) {
        expect(
          screen.getByText(words(language)[entry.label]!),
        ).toBeInTheDocument();
      }

      const tooltips: string = markerTooltips().join("\n");

      expect(tooltips).toContain(words(language)["Unnamed site"]);
      expect(tooltips).toContain(words(language)["No status yet"]);
      expect(tooltips).toContain(words(language)["Operational"]);
      expect(tooltips).toContain(words(language)["Degraded"]);
      expect(tooltips).not.toContain("Unnamed site");
      expect(tooltips).not.toContain("No status yet");

      if (language === "fa") {
        expect(line).not.toMatch(LATIN_DIGIT);
      }
    },
  );

  test("the coverage line can be read: the gray a summary line takes, not gray-300", async () => {
    await drawMap();

    expect(coverage()).toHaveClass("text-gray-500");
    expect(coverage()).not.toHaveClass("text-gray-300");
  });

  test("the map follows the reader when they change language", async () => {
    await drawMap();
    expect(coverage().textContent).toContain("sites mapped");

    await inLanguage("de");
    expect(coverage().textContent).toBe(
      "3 Standorte auf der Karte · 1 ohne Koordinaten · weitere Standorte nicht angezeigt",
    );
    expect(screen.getByText("Kein Status")).toBeInTheDocument();
  });

  test.each(DRAWN_LANGUAGES)(
    "drawn as a list on a %s board, a site with no name or no status reads the reader's words",
    async (language: string) => {
      await inLanguage(language);

      const { container } = await drawMap("list");
      const cells: Array<string> = Array.from(
        container.querySelectorAll("tbody td"),
      ).map((cell: Element): string => {
        return (cell.textContent || "").trim();
      });

      expect(cells).toContain(words(language)["Unnamed site"]);
      expect(cells).toContain(words(language)["No status yet"]);
      expect(cells).toContain(words(language)["Operational"]);
      expect(cells).toContain(words(language)["Degraded"]);
      expect(cells).toContain("Rotterdam edge");

      if (language !== "en") {
        expect(cells).not.toContain("Unnamed site");
        expect(cells).not.toContain("No status yet");
        expect(cells).not.toContain("Operational");
      }
    },
  );
});

describe("the VMware host list's figures", () => {
  const GIB: number = 1024 ** 3;

  test("in English, exactly as toFixed wrote them", () => {
    const english: Translator = dashboardTranslator("en");

    expect(formatVMwareHostPercent(42.5, english)).toBe("42.5%");
    expect(formatVMwareHostPercent(7, english)).toBe("7.0%");
    expect(formatVMwareHostMhz(2400, english)).toBe("2.4 GHz");
    expect(formatVMwareHostMhz(850, english)).toBe("850 MHz");
    expect(formatVMwareHostBytes(64 * GIB, english)).toBe("64.0 GiB");
    expect(formatVMwareHostBytes(512, english)).toBe("512 B");
    expect(formatVMwareHostPercent(undefined, english)).toBe("—");
    expect(formatVMwareHostMhz("", english)).toBe("—");
    expect(formatVMwareHostBytes(null, english)).toBe("—");
  });

  test("in German: a decimal comma and the percent sign set apart", () => {
    const de: Translator = dashboardTranslator("de");

    expect(formatVMwareHostPercent(42.5, de)).toBe(`42,5${NBSP}%`);
    expect(formatVMwareHostMhz(2400, de)).toBe("2,4 GHz");
    expect(formatVMwareHostMhz(1850, de)).toBe("1,9 GHz");
    expect(formatVMwareHostBytes(64 * GIB, de)).toBe("64,0 GiB");
  });

  test("in Persian: Persian digits; in Arabic: the Latin digits Arabic pages write", () => {
    const fa: Translator = dashboardTranslator("fa");
    const ar: Translator = dashboardTranslator("ar");

    expect(formatVMwareHostPercent(42.5, fa)).toBe("۴۲٫۵٪");
    expect(formatVMwareHostMhz(2400, fa)).toBe("۲٫۴ GHz");
    expect(formatVMwareHostBytes(64 * GIB, fa)).toBe("۶۴٫۰ GiB");
    expect(formatVMwareHostMhz(2400, ar)).toBe("2.4 GHz");
    expect(formatVMwareHostPercent(42.5, ar)).toContain("42.5");
  });
});

describe("the VMware host list widget, drawn", () => {
  const GIB: number = 1024 ** 3;

  function hostsAre(): void {
    listMock.mockResolvedValue({
      data: [
        {
          _id: ObjectID.generate().toString(),
          name: "esxi-07.eu-west.example.com",
          kind: "Host",
          clusterName: "eu-west-production",
          datacenterName: "eu-west",
          latestCpuPercent: 42.5,
          latestMemoryPercent: 61.25,
          cpuCapacityMhz: 2400,
          maxMemoryBytes: 64 * GIB,
          vmwareVCenterId: ObjectID.generate().toString(),
          vmwareVCenter: { name: "vcenter.eu-west.example.com" },
        },
      ],
      count: 1,
    });
  }

  async function drawHosts(
    viewMode: "list" | "honeycomb",
  ): Promise<RenderResult> {
    hostsAre();

    const Element: WidgetElement =
      DashboardVMwareHostListComponentElement as unknown as WidgetElement;
    const result: RenderResult = render(
      <Element
        {...propsOf(DashboardComponentType.VMwareHostList, {
          title: "ESXi hosts",
          viewMode: viewMode,
        })}
      />,
    );

    await waitFor(() => {
      expect(
        viewMode === "list"
          ? result.container.querySelectorAll("tbody tr").length
          : result.container.querySelectorAll("div.select-none").length,
      ).toBe(1);
    });

    return result;
  }

  function hoverTile(container: HTMLElement): HTMLElement {
    fireEvent.mouseEnter(container.querySelectorAll("div.select-none")[0]!);

    return document.querySelector("div.fixed.z-50") as HTMLElement;
  }

  test("on an English board the tile's tooltip reads as it always did", async () => {
    const { container } = await drawHosts("honeycomb");
    const tooltip: HTMLElement = hoverTile(container);

    expect(tooltip).toHaveTextContent("42.5% of 2.4 GHz");
    expect(tooltip).toHaveTextContent("61.3% of 64.0 GiB");
  });

  test("on a German board: one German sentence each, in German figures", async () => {
    await inLanguage("de");

    const { container } = await drawHosts("honeycomb");
    const tooltip: HTMLElement = hoverTile(container);

    expect(tooltip.textContent).toContain(`42,5${NBSP}% von 2,4 GHz`);
    expect(tooltip.textContent).toContain(`61,3${NBSP}% von 64,0 GiB`);
    expect(tooltip.textContent).not.toContain(" of ");
  });

  test.each(["fa", "ar"])(
    "on a %s board: the reader's sentence and digits",
    async (language: string) => {
      await inLanguage(language);

      const { container } = await drawHosts("honeycomb");
      const tooltip: HTMLElement = hoverTile(container);
      const translator: Translator = dashboardTranslator(language);

      expect(tooltip.textContent).toContain(
        translator.translateTemplate("{{used}} of {{capacity}}", {
          used: formatVMwareHostPercent(42.5, translator),
          capacity: formatVMwareHostMhz(2400, translator),
        }),
      );
      expect(tooltip.textContent).not.toContain(" of ");

      if (language === "fa") {
        expect(tooltip.textContent).toContain("۴۲٫۵٪ از ۲٫۴ GHz");
        expect(tooltip.textContent).not.toContain("42.5");
      }
    },
  );

  test("as a list on a German board, its CPU and Memory cells and their capacity are German", async () => {
    await inLanguage("de");

    const { container } = await drawHosts("list");
    const cells: Array<HTMLElement> = Array.from(
      container.querySelectorAll<HTMLElement>("tbody td"),
    );
    const cpu: HTMLElement | undefined = cells.find((cell: HTMLElement) => {
      return cell.textContent === `42,5${NBSP}%`;
    });
    const memory: HTMLElement | undefined = cells.find((cell: HTMLElement) => {
      return cell.textContent === `61,3${NBSP}%`;
    });

    expect(cpu).toBeDefined();
    expect(cpu).toHaveAttribute("title", "Kapazität 2,4 GHz");
    expect(memory).toBeDefined();
    expect(memory).toHaveAttribute("title", "Kapazität 64,0 GiB");
  });

  test("as a list on an English board, as it always read", async () => {
    const { container } = await drawHosts("list");

    expect(container.textContent).toContain("42.5%");
    expect(
      Array.from(container.querySelectorAll("tbody td")).some(
        (cell: Element) => {
          return cell.getAttribute("title") === "Capacity 2.4 GHz";
        },
      ),
    ).toBe(true);
  });
});

describe("the widgets' source", () => {
  const COMPONENTS_DIR: string = path.resolve(
    __dirname,
    "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components",
  );

  // The code alone: what a comment says is not drawn.
  function withoutComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  }

  test("the Network Map's words are looked up, none glued from English", () => {
    const code: string = withoutComments(
      fs.readFileSync(
        path.join(COMPONENTS_DIR, "NetworkMapWidgetData.ts"),
        "utf8",
      ),
    );

    expect(code).not.toMatch(/sites in view`/);
    expect(code).not.toMatch(/\} mapped`/);
    expect(code).not.toMatch(/without coordinates`/);
    expect(code).not.toMatch(/more` : ""/);
    expect(code).not.toContain('parts.join(" · ")');
  });

  test('the VMware host list writes no English "of" between its figures', () => {
    const code: string = withoutComments(
      fs.readFileSync(
        path.join(COMPONENTS_DIR, "DashboardVMwareHostListComponent.tsx"),
        "utf8",
      ),
    );

    expect(code).not.toMatch(/\} of \$\{/);
    expect(code).not.toMatch(/toFixed\(1\)\}%/);
  });
});
