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
} from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ---------------------------------------------------------------------------
 * The traces explorer's filters, in every Dashboard language
 * ---------------------------------------------------------------------------
 *
 * The sidebar has two span filters: Span Type, whose one choice is Root
 * spans, and Span Kind, OpenTelemetry's SpanKind. Japanese named both
 * スパンの種類 and Spanish both "Tipo de span", so a reader saw two filters
 * with one name, and a Root spans chip and a Server chip read the same key.
 * The section headers drew English besides, above chips in the reader's
 * language.
 *
 * The REAL TracesViewer is mounted with the TelemetryViewer shell replaced by
 * a probe that records the props it is handed, against mocked APIs (as in
 * TracesResourceFacets): its facet configs, and the chips a sidebar click on
 * Root spans and on Server makes. The REAL sidebar and chips then draw them
 * under an i18next instance per language, built from the Dashboard's own
 * locale files the way Utils/i18n.ts builds the Dashboard's.
 *
 * What each Span Type choice is used to be an English paragraph under the
 * title in every language. It is behind an (i) beside the title now, and on
 * each option: the (i) is named in the reader's language, and each choice's
 * sentence reads in the language's own words under the choice's name, which
 * stays as written ("Entry spans"), as the translated docs quote it.
 */

const viewerProbe: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();
const apiPostMock: MockFunction = getJestMockFunction();
const getCurrentProjectIdMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * compiled requires, so the mock variables above are still unassigned when
 * the factories run.
 */
jest.mock("../../../UI/Components/TelemetryViewer/TelemetryViewer", () => {
  return {
    __esModule: true,
    default: (props: any) => {
      viewerProbe(props);
      return null;
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return analyticsGetListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return apiPostMock(...args);
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
      getCurrentProjectId: (...args: Array<any>) => {
        return getCurrentProjectIdMock(...args);
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetrySavedViewsControl",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesAnalyticsView",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
      formatDurationMs: (ms: number) => {
        return `${ms} ms`;
      },
    };
  },
);

import TracesViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesViewer";
import ObjectID from "../../../Types/ObjectID";
import { RESOURCE_FACET_CATALOG_KEYS } from "../../../Types/Telemetry/ResourceFacetCatalog";
import {
  TRACE_SPAN_TYPE_OPTIONS,
  TraceSpanTypeOption,
} from "../../../Types/Telemetry/TraceSpanType";
import TelemetryActiveFilterChips from "../../../UI/Components/TelemetryViewer/components/TelemetryActiveFilterChips";
import TelemetryFacetSidebar from "../../../UI/Components/TelemetryViewer/components/TelemetryFacetSidebar";
import {
  ActiveFilter,
  FacetConfig,
  FacetData,
} from "../../../UI/Components/TelemetryViewer/types";
import TelemetryEntityNameResolver from "../../../UI/Utils/Telemetry/TelemetryEntityNames";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const SERVICE_ID: string = "22222222-2222-4222-8222-222222222222";

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

type Locale = Record<string, unknown>;

const LANGUAGES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((file: string): boolean => {
    return file.endsWith(".json");
  })
  .map((file: string): string => {
    return file.slice(0, -".json".length);
  })
  .sort();

const readLocale: (language: string) => Locale = (language: string): Locale => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Locale;
};

const ENGLISH: Locale = readLocale("en");
const LOCALES: Record<string, Locale> = {};
const INSTANCES: Record<string, i18n> = {};

// What the Dashboard draws for an English label: the locale's, or English.
const drawn: (language: string, english: string) => string = (
  language: string,
  english: string,
): string => {
  const value: unknown = (LOCALES[language] as Locale)[english];

  return typeof value === "string" && value.trim() ? value : english;
};

const SPAN_TYPE: string = "Span Type";
const SPAN_KIND: string = "Span Kind";

// A name as a reader tells it from another: case, spaces and hyphens aside.
const GAP: RegExp = /[\s\p{Pd}_·・]+/gu;
const comparable: (name: string) => string = (name: string): string => {
  return name.normalize("NFKC").toLowerCase().replace(GAP, " ").trim();
};

type LastViewerPropsFunction = () => any;

const lastViewerProps: LastViewerPropsFunction = (): any => {
  const calls: Array<Array<any>> = viewerProbe.mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1]![0];
};

// The order TelemetryFacetSidebar lists sections in.
const sortLikeSidebar: (configs: Array<FacetConfig>) => Array<FacetConfig> = (
  configs: Array<FacetConfig>,
): Array<FacetConfig> => {
  return [...configs].sort((a: FacetConfig, b: FacetConfig): number => {
    const priorityA: number = a.priority ?? 100;
    const priorityB: number = b.priority ?? 100;
    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }
    return a.title.localeCompare(b.title);
  });
};

/*
 * A value for every facet that does not fold away, so each draws its
 * section; the resource types have none and fold into the footer.
 */
const SIDEBAR_FACETS: FacetData = {
  primaryEntityId: [{ value: SERVICE_ID, count: 3 }],
  statusCode: [{ value: "2", count: 1 }],
  spanType: [{ value: "root", count: 2 }],
  hasException: [{ value: "true", count: 1 }],
  kind: [{ value: "SPAN_KIND_SERVER", count: 4 }],
  name: [{ value: "GET /orders", count: 4 }],
  "resource.service.instance.id": [{ value: "checkout-1", count: 4 }],
  "resource.host.name": [{ value: "web-1", count: 4 }],
};

for (const key of RESOURCE_FACET_CATALOG_KEYS) {
  SIDEBAR_FACETS[key] = [];
}

// What the real viewer hands its shell, read once.
let facetConfigs: Array<FacetConfig> = [];
let rootAndServerChips: Array<ActiveFilter> = [];

const configTitled: (title: string) => FacetConfig = (
  title: string,
): FacetConfig => {
  const config: FacetConfig | undefined = facetConfigs.find(
    (candidate: FacetConfig): boolean => {
      return candidate.title === title;
    },
  );

  expect(config).toBeDefined();

  return config as FacetConfig;
};

/*
 * The section headers the sidebar draws, in order: the buttons that fold a
 * section, with its title in small capitals.
 */
const sectionTitles: () => Array<string> = (): Array<string> => {
  return screen
    .queryAllByRole("button")
    .filter((element: HTMLElement): boolean => {
      return (
        element.hasAttribute("aria-expanded") &&
        !element.closest("[data-testid='facet-sidebar-hidden-footer']") &&
        element.querySelector("span.uppercase") !== null
      );
    })
    .map((element: HTMLElement): string => {
      return element.querySelector("span.uppercase")?.textContent || "";
    });
};

const renderInLanguage: (language: string) => void = (
  language: string,
): void => {
  render(
    <I18nextProvider i18n={INSTANCES[language] as i18n}>
      <TelemetryActiveFilterChips
        filters={rootAndServerChips}
        onRemove={jest.fn()}
        onClearAll={jest.fn()}
      />
      <TelemetryFacetSidebar
        facetData={SIDEBAR_FACETS}
        facetConfigs={facetConfigs}
        isLoading={false}
        activeFilters={rootAndServerChips}
        onIncludeFilter={jest.fn()}
        onRemoveFilter={jest.fn()}
      />
    </I18nextProvider>,
  );
};

// The keys the chips draw, without their colons: "スパンタイプ".
const chipKeys: () => Array<string> = (): Array<string> => {
  return screen
    .queryAllByText((_content: string, element: Element | null): boolean => {
      return (
        element !== null &&
        element.tagName === "SPAN" &&
        element.classList.contains("font-medium") &&
        (element.textContent || "").endsWith(":")
      );
    })
    .map((element: HTMLElement): string => {
      return (element.textContent || "").slice(0, -1);
    });
};

beforeAll(async () => {
  for (const language of LANGUAGES) {
    LOCALES[language] = readLocale(language);

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

  // The real viewer, once: its facet configs and its chips.
  TelemetryEntityNameResolver.clearCache();
  getCurrentProjectIdMock.mockReturnValue(new ObjectID(PROJECT_ID));
  getListMock.mockImplementation(async () => {
    return { data: [], count: 0 };
  });
  apiPostMock.mockImplementation(async () => {
    return { data: {} };
  });
  analyticsGetListMock.mockImplementation(async () => {
    return { data: [], count: 0 };
  });
  window.history.replaceState({}, "", "/");

  await act(async (): Promise<void> => {
    render(<TracesViewer />);
  });

  facetConfigs = lastViewerProps().facetConfigs as Array<FacetConfig>;

  await act(async (): Promise<void> => {
    (lastViewerProps().onFacetInclude as (k: string, v: string) => void)(
      "spanType",
      "root",
    );
  });
  await act(async (): Promise<void> => {
    (lastViewerProps().onFacetInclude as (k: string, v: string) => void)(
      "kind",
      "SPAN_KIND_SERVER",
    );
  });

  await waitFor(() => {
    expect(
      (lastViewerProps().activeFilters as Array<ActiveFilter>).length,
    ).toBe(2);
  });

  rootAndServerChips = lastViewerProps().activeFilters as Array<ActiveFilter>;

  cleanup();
});

beforeEach(() => {
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  cleanup();
});

describe("what the traces explorer hands its sidebar", () => {
  test("every Dashboard language is read: English and the 16 others", () => {
    expect(LANGUAGES).toHaveLength(17);
    expect(LANGUAGES).toEqual(expect.arrayContaining(["en", "ja", "es"]));
  });

  test("a Span Type facet choosing Entry, Root or All spans, and a Span Kind facet", () => {
    expect(configTitled(SPAN_TYPE)).toMatchObject({
      key: "spanType",
      valueDisplayMap: {
        entry: "Entry spans",
        root: "Root spans",
        all: "All spans",
      },
      chosenValue: "entry",
    });
    expect(configTitled(SPAN_KIND).key).toBe("kind");
  });

  test("a click on Root spans and on Server makes one chip under each filter's English name", () => {
    expect(
      rootAndServerChips.map((chip: ActiveFilter): Array<string> => {
        return [chip.facetKey, chip.value, chip.displayKey];
      }),
    ).toEqual(
      expect.arrayContaining([
        ["spanType", "root", SPAN_TYPE],
        ["kind", "SPAN_KIND_SERVER", SPAN_KIND],
      ]),
    );
  });
});

describe.each(LANGUAGES)("the traces sidebar in %s", (language: string) => {
  test("names every section as the language's Dashboard words it, in the sidebar's order", () => {
    renderInLanguage(language);

    const shown: Array<FacetConfig> = sortLikeSidebar(facetConfigs).filter(
      (config: FacetConfig): boolean => {
        return (SIDEBAR_FACETS[config.key] || []).length > 0;
      },
    );

    expect(sectionTitles()).toEqual(
      shown.map((config: FacetConfig): string => {
        return drawn(language, config.title);
      }),
    );
  });

  test("names Span Type and Span Kind apart, and no two sections alike", () => {
    renderInLanguage(language);

    const titles: Array<string> = sectionTitles();
    const spanType: string = drawn(language, SPAN_TYPE);
    const spanKind: string = drawn(language, SPAN_KIND);

    expect(titles).toContain(spanType);
    expect(titles).toContain(spanKind);
    expect(comparable(spanType)).not.toBe(comparable(spanKind));
    expect(new Set(titles.map(comparable)).size).toBe(titles.length);
  });

  test("the Root spans and Server chips name their filters as the sections do", () => {
    renderInLanguage(language);

    const keys: Array<string> = chipKeys();

    expect(keys).toEqual(
      expect.arrayContaining([
        drawn(language, SPAN_TYPE),
        drawn(language, SPAN_KIND),
      ]),
    );
    expect(new Set(keys.map(comparable)).size).toBe(keys.length);

    for (const key of keys) {
      expect(sectionTitles()).toContain(key);
    }
  });
});

describe("the two filters in Japanese and Spanish", () => {
  test("Japanese: スパンタイプ above Root spans, スパンの種類 (OpenTelemetry's word) above Server", () => {
    renderInLanguage("ja");

    const titles: Array<string> = sectionTitles();

    expect(titles).toEqual(
      expect.arrayContaining(["スパンタイプ", "スパンの種類"]),
    );
    expect(titles).not.toContain(SPAN_TYPE);
    expect(titles).not.toContain(SPAN_KIND);
    expect(chipKeys()).toEqual(
      expect.arrayContaining(["スパンタイプ", "スパンの種類"]),
    );
    // Each name once: the two filters no longer share スパンの種類.
    expect(
      titles.filter((title: string): boolean => {
        return title === "スパンの種類";
      }),
    ).toHaveLength(1);
  });

  test("Spanish: Categoría de span above Root spans, Tipo de span above Server", () => {
    renderInLanguage("es");

    const titles: Array<string> = sectionTitles();

    expect(titles).toEqual(
      expect.arrayContaining(["Categoría de span", "Tipo de span"]),
    );
    expect(
      titles.filter((title: string): boolean => {
        return title === "Tipo de span";
      }),
    ).toHaveLength(1);
    expect(chipKeys()).toEqual(
      expect.arrayContaining(["Categoría de span", "Tipo de span"]),
    );
  });

  test("English: Span Type and Span Kind, as before", () => {
    renderInLanguage("en");

    expect(sectionTitles()).toEqual(
      expect.arrayContaining([SPAN_TYPE, SPAN_KIND]),
    );
    expect(chipKeys()).toEqual(expect.arrayContaining([SPAN_TYPE, SPAN_KIND]));
  });
});

// The paragraph every language used to show, in English, under Span Type.
const OLD_SPAN_TYPE_HELP: string =
  "Entry spans: where a request or message enters a service. Root spans: where a trace starts. All spans: every operation, including database calls and internal steps.";

// The real explorer's Span Type facet, a count for each of its choices.
const renderSpanTypeInLanguage: (language: string) => void = (
  language: string,
): void => {
  render(
    <I18nextProvider i18n={INSTANCES[language] as i18n}>
      <TelemetryFacetSidebar
        facetData={{
          spanType: [
            { value: "entry", count: 40 },
            { value: "root", count: 2 },
            { value: "all", count: 900 },
          ],
        }}
        facetConfigs={[configTitled(SPAN_TYPE)]}
        isLoading={false}
        activeFilters={[]}
        onIncludeFilter={jest.fn()}
        onRemoveFilter={jest.fn()}
      />
    </I18nextProvider>,
  );
};

// "About Span Type" as the language words it, the facet's name in it.
const aboutSpanType: (language: string) => string = (
  language: string,
): string => {
  return drawn(language, "About {{label}}").replace(
    "{{label}}",
    drawn(language, SPAN_TYPE),
  );
};

// Each choice's name as written, and its sentence as the language words it.
const choicesIn: (language: string) => Array<[string, string]> = (
  language: string,
): Array<[string, string]> => {
  return TRACE_SPAN_TYPE_OPTIONS.map(
    (option: TraceSpanTypeOption): [string, string] => {
      return [option.label, drawn(language, option.description)];
    },
  );
};

describe("what each Span Type choice is", () => {
  test("the real explorer hands its sidebar each choice's sentence, and no paragraph", () => {
    const config: FacetConfig = configTitled(SPAN_TYPE);

    expect(config.valueDescriptionMap).toEqual({
      entry: "Where a request or message enters a service.",
      root: "Where a trace starts.",
      all: "Every operation, including database calls and internal steps.",
    });
    expect(config.description).toBeUndefined();
  });

  test("each sentence is a key of the Dashboard's locales; each choice's name is not, and reads as written", () => {
    for (const option of TRACE_SPAN_TYPE_OPTIONS) {
      expect(ENGLISH[option.description]).toBe(option.description);
      expect({ name: option.label, isKey: option.label in ENGLISH }).toEqual({
        name: option.label,
        isKey: false,
      });
    }
  });

  test.each(
    LANGUAGES.filter((language: string): boolean => {
      return language !== "en";
    }),
  )("%s words every sentence in its own words", (language: string) => {
    for (const option of TRACE_SPAN_TYPE_OPTIONS) {
      const value: unknown = (LOCALES[language] as Locale)[option.description];

      expect(typeof value).toBe("string");
      expect({
        language,
        sentence: option.description,
        isEnglish: value === option.description,
        isBlank: String(value).trim() === "",
      }).toEqual({
        language,
        sentence: option.description,
        isEnglish: false,
        isBlank: false,
      });
    }
  });
});

describe.each(LANGUAGES)("the Span Type in %s", (language: string) => {
  test("shows its title and its three options, with no paragraph between them", () => {
    renderSpanTypeInLanguage(language);

    expect(sectionTitles()).toEqual([drawn(language, SPAN_TYPE)]);
    expect(screen.queryByText(OLD_SPAN_TYPE_HELP)).toBeNull();
    expect(document.querySelectorAll("p")).toHaveLength(0);
    expect(
      screen.getAllByRole("radio").map((radio: HTMLElement): string => {
        return radio.textContent || "";
      }),
    ).toEqual(["Entry spans", "Root spans", "All spans"]);
  });

  test("its (i) is named in the language, and lists each choice as written with its sentence in the language's words", async () => {
    renderSpanTypeInLanguage(language);

    const button: HTMLElement = screen.getByRole("button", {
      name: aboutSpanType(language),
    });

    // A screen reader hears the same, whether or not the tooltip shows.
    expect(button).toHaveAccessibleDescription(
      choicesIn(language)
        .map((choice: [string, string]): string => {
          return `${choice[0]}: ${choice[1]}`;
        })
        .join(" "),
    );

    fireEvent.mouseEnter(button);
    await act(async () => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 250);
      });
    });

    const tooltip: HTMLElement = screen.getByRole("tooltip");
    expect(
      Array.from(tooltip.querySelectorAll("dt")).map(
        (term: Element): [string, string] => {
          return [
            term.textContent || "",
            term.nextElementSibling?.textContent || "",
          ];
        },
      ),
    ).toEqual(choicesIn(language));
  });

  test("each option is described in the language's words", () => {
    renderSpanTypeInLanguage(language);

    for (const [name, sentence] of choicesIn(language)) {
      expect(
        screen.getByRole("radio", { name: name }),
      ).toHaveAccessibleDescription(sentence);
    }
  });
});
