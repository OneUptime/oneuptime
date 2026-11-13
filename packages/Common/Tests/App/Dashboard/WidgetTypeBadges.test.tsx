import "@testing-library/jest-dom";
import {
  afterAll,
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
} from "@testing-library/react";
import i18next from "i18next";
import * as React from "react";
import { initReactI18next } from "react-i18next";

/*
 * THE WIDGET'S BADGES SAY WHAT IT IS, BY ITS NAME, IN THE READER'S LANGUAGE
 * (issue #6720).
 *
 * Two badges say which kind of widget one is: the one before its size in
 * its settings dialog, and the one on it while the board is edited, under
 * its handles. Both printed the stored type, through Tailwind's
 * `capitalize`: "ProductAnalyticsFunnel", "DockerHostList",
 * "DataSourceChart" - in English in every language. Both now print the
 * widget's name from the widget catalog, looked up in the reader's
 * language, and a type OneUptime has no widget of as it was stored.
 *
 * The settings dialog's badge and size sat beside its title, and on a
 * phone squeezed the title into a column a word wide ("Kompo / nenten /
 * einstell..."); they are now the line under the title, in place of a
 * description that said nothing ("Edit the settings of this component"),
 * and the size is in the reader's language and digits ("۸ × ۵ واحد"),
 * where 15 languages said "units" in English and Persian drew it back to
 * front ("x 5 units 8").
 *
 * Drawn here for real: the settings dialog (its form a stub, its live
 * preview never measured - jsdom lays nothing out) and the widget's card,
 * its widget a stub; in English, German, Persian and Japanese, from the
 * Dashboard's own locale files.
 */

function stubModule(testId: string): () => {
  __esModule: boolean;
  default: () => React.ReactElement;
} {
  return () => {
    const reactModule: typeof React = jest.requireActual(
      "react",
    ) as typeof React;

    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return reactModule.createElement("div", { "data-testid": testId });
      },
    };
  };
}

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/ArgumentsForm",
  stubModule("arguments-form-stub"),
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardProductAnalyticsFunnelComponent",
  stubModule("widget-stub"),
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardProductAnalyticsRetentionComponent",
  stubModule("widget-stub"),
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardDockerHostListComponent",
  stubModule("widget-stub"),
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardDataSourceChartComponent",
  stubModule("widget-stub"),
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardKubernetesJobListComponent",
  stubModule("widget-stub"),
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardTextComponent",
  stubModule("widget-stub"),
);

import ComponentSettingsModal, {
  WIDGET_SETTINGS_SIZE_TEST_ID,
  WIDGET_SETTINGS_SUMMARY_CLASS_NAME,
  WIDGET_SETTINGS_TYPE_BADGE_CLASS_NAME,
  WIDGET_SETTINGS_TYPE_BADGE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/ComponentSettingsModal";
import DashboardBaseComponentElement, {
  ComponentProps as DashboardBaseComponentElementProps,
  WIDGET_TYPE_BADGE_BOX_CLASS_NAME,
  WIDGET_TYPE_BADGE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import { getWidgetTypeName } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/WidgetCatalog";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import TimeRange from "../../../Types/Time/TimeRange";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import {
  EmittedRule,
  addClassNames,
  declarationsForSelector,
  loadPlayCdn,
  unloadPlayCdn,
} from "../../Helpers/TailwindPlayCdn";

const COMPONENT_ID: ObjectID = new ObjectID(
  "6720aaaa-0000-4000-8000-000000000001",
);

const LANGUAGES: ReadonlyArray<string> = ["de", "fa", "ja"];

// jsdom has none: the dialog watches its preview's width with one.
class FakeResizeObserver {
  public observe(): void {
    // Nothing is laid out, so nothing ever changes size.
  }

  public unobserve(): void {
    // As above.
  }

  public disconnect(): void {
    // As above.
  }
}

const originalResizeObserver: unknown = (
  globalThis as unknown as { ResizeObserver?: unknown }
).ResizeObserver;

beforeAll(async () => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    FakeResizeObserver;

  const resources: Record<string, { translation: Record<string, string> }> = {
    en: { translation: readDashboardLocale("en") },
  };

  for (const language of LANGUAGES) {
    resources[language] = { translation: readDashboardLocale(language) };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: resources,
    interpolation: { escapeValue: false },
  });
});

afterEach(async () => {
  cleanup();
  await i18next.changeLanguage("en");
});

afterAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    originalResizeObserver;
});

// A widget of a type, stored as the board keeps it: any text, or none.
function widget(componentType: unknown): DashboardBaseComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentId: COMPONENT_ID,
    componentType: componentType as DashboardComponentType,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 8,
    heightInDashboardUnits: 5,
    minWidthInDashboardUnits: 3,
    minHeightInDashboardUnits: 3,
    arguments: {},
  };
}

function viewConfig(componentType: unknown): DashboardViewConfig {
  return {
    _type: ObjectType.DashboardViewConfig,
    components: [widget(componentType)],
    heightInDashboardUnits: 60,
  };
}

function renderSettings(componentType: unknown): ReturnType<typeof render> {
  return render(
    <ComponentSettingsModal
      title="Component Settings"
      onClose={() => {}}
      onComponentUpdate={() => {}}
      onComponentDelete={() => {}}
      onComponentDuplicate={() => {}}
      componentId={COMPONENT_ID}
      dashboardViewConfig={viewConfig(componentType)}
      dashboardStartAndEndDate={{ range: TimeRange.PAST_ONE_HOUR }}
      totalCurrentDashboardWidthInPx={1200}
      metrics={{ metricTypes: [], telemetryAttributes: [] }}
    />,
  );
}

function cardProps(
  componentType: unknown,
  overrides?: Partial<DashboardBaseComponentElementProps>,
): DashboardBaseComponentElementProps {
  return {
    componentId: COMPONENT_ID,
    isEditMode: true,
    isSelected: true,
    key: "badge-card",
    onComponentUpdate: () => {},
    totalCurrentDashboardWidthInPx: 1200,
    dashboardCanvasTopInPx: 0,
    dashboardCanvasLeftInPx: 0,
    dashboardCanvasWidthInPx: 1200,
    dashboardCanvasHeightInPx: 800,
    dashboardComponentWidthInPx: 521,
    dashboardComponentHeightInPx: 360,
    dashboardViewConfig: viewConfig(componentType),
    dashboardStartAndEndDate: { range: TimeRange.PAST_ONE_HOUR },
    metricTypes: [],
    onClick: () => {},
    dndActiveMode: null,
    isAnyGestureActive: false,
    onMovePointerDown: () => {},
    onResizePointerDown: () => {},
    ...overrides,
  };
}

function renderCard(
  componentType: unknown,
  overrides?: Partial<DashboardBaseComponentElementProps>,
): ReturnType<typeof render> {
  return render(
    <DashboardBaseComponentElement {...cardProps(componentType, overrides)} />,
  );
}

function settingsBadge(): HTMLElement {
  return screen.getByTestId(WIDGET_SETTINGS_TYPE_BADGE_TEST_ID);
}

function cardBadge(): HTMLElement {
  return screen.getByTestId(WIDGET_TYPE_BADGE_TEST_ID);
}

function settingsSize(): HTMLElement {
  return screen.getByTestId(WIDGET_SETTINGS_SIZE_TEST_ID);
}

// The size's sentence, the key every locale words.
const SIZE_KEY: string = "{{width}} x {{height}} units";

// A lower-case letter then a capital: an identifier's hump.
const HUMP: RegExp = /[a-z][A-Z]/;

// The stored types that are identifiers, not words: "ProductAnalyticsFunnel".
const IDENTIFIER_TYPES: Array<DashboardComponentType> = Object.values(
  DashboardComponentType,
).filter((type: DashboardComponentType): boolean => {
  return HUMP.test(type);
});

describe("the settings dialog's badge", () => {
  test.each([
    [DashboardComponentType.ProductAnalyticsFunnel, "Funnel"],
    [DashboardComponentType.ProductAnalyticsRetention, "User Retention"],
    [DashboardComponentType.DockerHostList, "Docker Hosts"],
    [DashboardComponentType.DataSourceChart, "Data Source Chart"],
    [DashboardComponentType.LogStream, "Log Stream"],
    [DashboardComponentType.VMwareHostList, "ESXi Hosts"],
    [DashboardComponentType.StorageArrayHardwareList, "Storage Array Hardware"],
    [DashboardComponentType.Chart, "Chart"],
  ])("a %s widget: %s", (type: DashboardComponentType, name: string) => {
    renderSettings(type);

    expect(settingsBadge()).toHaveTextContent(name);
    expect(settingsBadge().textContent).toBe(name);
    // Whole under the pointer, where a narrow header cuts it.
    expect(settingsBadge()).toHaveAttribute("title", name);
  });

  test.each(IDENTIFIER_TYPES)(
    "a %s widget: its catalog name, never the stored type",
    (type: DashboardComponentType) => {
      renderSettings(type);

      expect(settingsBadge().textContent).toBe(getWidgetTypeName(type));
      expect(settingsBadge().textContent).not.toBe(type);
      // No one word with a hump in it, as an identifier is ("DockerHostList").
      expect(settingsBadge().textContent).not.toMatch(/^\S*[a-z][A-Z]\S*$/);
    },
  );

  test("is no longer capitalized by its class, and is cut at its end only when wider than the whole line", () => {
    renderSettings(DashboardComponentType.ProductAnalyticsFunnel);

    expect(settingsBadge()).not.toHaveClass("capitalize");
    expect(settingsBadge().className).toBe(
      WIDGET_SETTINGS_TYPE_BADGE_CLASS_NAME,
    );
    expect(settingsBadge()).toHaveClass("truncate", "min-w-0", "max-w-full");
    // No fixed cap of its own: a long name in a long language is read whole on a wide screen.
    expect(settingsBadge().className).not.toMatch(/max-w-\[/);
    expect(settingsSize()).toHaveClass("whitespace-nowrap");
  });

  test("the line under the title: the kind, then the size, in place of a description that said nothing", () => {
    renderSettings(DashboardComponentType.ProductAnalyticsRetention);

    const dialog: HTMLElement = screen.getByRole("dialog", {
      name: "Component Settings",
    });
    const description: HTMLElement = screen.getByTestId("modal-description");
    const line: HTMLElement = settingsBadge().parentElement!;

    // Under the title, not beside it: nothing at the header's end but the close button.
    expect(screen.queryByTestId("right-element")).not.toBeInTheDocument();
    expect(description).toContainElement(settingsBadge());
    expect(description).toContainElement(settingsSize());
    expect(line.className).toBe(WIDGET_SETTINGS_SUMMARY_CLASS_NAME);
    expect(line).toHaveClass("flex", "flex-wrap", "min-w-0");
    expect(line).toBe(settingsSize().parentElement);
    // The kind first, then its size.
    expect(Array.from(line.children)).toEqual([
      settingsBadge(),
      settingsSize(),
    ]);
    expect(settingsSize().textContent).toBe("8 x 5 units");

    // What the dialog is described by, to a screen reader: what it edits.
    expect(dialog.getAttribute("aria-describedby")).toBe(description.id);
    expect(description.textContent).toBe("User Retention8 x 5 units");
    expect(description.textContent).not.toContain(
      "Edit the settings of this component",
    );
  });

  test("the size is the widget's own: another widget's numbers are not borrowed", () => {
    const config: DashboardViewConfig = viewConfig(
      DashboardComponentType.ProductAnalyticsFunnel,
    );

    config.components[0]!.widthInDashboardUnits = 12;
    config.components[0]!.heightInDashboardUnits = 3;

    render(
      <ComponentSettingsModal
        title="Component Settings"
        onClose={() => {}}
        onComponentUpdate={() => {}}
        onComponentDelete={() => {}}
        onComponentDuplicate={() => {}}
        componentId={COMPONENT_ID}
        dashboardViewConfig={config}
        dashboardStartAndEndDate={{ range: TimeRange.PAST_ONE_HOUR }}
        totalCurrentDashboardWidthInPx={1200}
        metrics={{ metricTypes: [], telemetryAttributes: [] }}
      />,
    );

    expect(settingsSize().textContent).toBe("12 x 3 units");
  });

  test("its size in German and Persian: their words, and Persian's digits in Persian's order", async () => {
    await act(async () => {
      await i18next.changeLanguage("de");
    });

    renderSettings(DashboardComponentType.ProductAnalyticsFunnel);
    expect(settingsSize().textContent).toBe("8 × 5 Einheiten");
    cleanup();

    await act(async () => {
      await i18next.changeLanguage("fa");
    });

    renderSettings(DashboardComponentType.ProductAnalyticsFunnel);
    // Its words the page's own way: never "8 x 5 units", which Persian drew as "x 5 units 8".
    expect(settingsSize().textContent).toBe("۸ × ۵ واحد");
    expect(settingsSize().textContent).not.toMatch(/[0-9]/);
    expect(settingsSize().textContent).not.toContain("units");
  });

  test.each(["ar", "fa"])(
    "in %s, read from the right: a multiplication sign between the numbers, never a Latin x, which made the numbers read back to front",
    (language: string) => {
      const value: string = readDashboardLocale(language)[SIZE_KEY] || "";

      // A Latin x is a letter read from the left: "6 x 3" drew as "x 3 6".
      expect(value).toContain("{{width}} × {{height}}");
      expect(value).not.toMatch(/\{\{width\}\}\s*x\s*\{\{height\}\}/);
      expect(value).not.toContain("units");
    },
  );

  test.each(DASHBOARD_LANGUAGES)(
    "the size is worded in %s, with both numbers",
    (language: string) => {
      const value: string | undefined = readDashboardLocale(language)[SIZE_KEY];

      expect(isWordedInDashboardLocale(SIZE_KEY, language)).toBe(true);
      expect(value).toContain("{{width}}");
      expect(value).toContain("{{height}}");
      // Width before height, as the board counts them.
      expect(value!.indexOf("{{width}}")).toBeLessThan(
        value!.indexOf("{{height}}"),
      );
    },
  );

  test("a type OneUptime has no widget of: as it was stored, beside the reason there are no settings", () => {
    renderSettings("HostMetricChart");

    expect(settingsBadge().textContent).toBe("HostMetricChart");
    expect(
      screen.getByTestId("widget-settings-unknown-type"),
    ).toHaveTextContent('OneUptime has no "HostMetricChart" widget');
    expect(screen.queryByTestId("arguments-form-stub")).not.toBeInTheDocument();
  });

  test("a stored type with spaces around it: trimmed", () => {
    renderSettings("  LegacyWidget  ");

    expect(settingsBadge().textContent).toBe("LegacyWidget");
  });

  test.each([
    ["no type", undefined],
    ["an empty type", ""],
    ["a type of spaces", "   "],
    ["a type that is not text", 42],
  ])(
    "%s: no badge, and the size is still there",
    (_name: string, type: unknown) => {
      renderSettings(type);

      expect(
        screen.queryByTestId(WIDGET_SETTINGS_TYPE_BADGE_TEST_ID),
      ).not.toBeInTheDocument();
      expect(screen.getByText("8 x 5 units")).toBeInTheDocument();
    },
  );

  test("in German: the German names", async () => {
    await act(async () => {
      await i18next.changeLanguage("de");
    });

    renderSettings(DashboardComponentType.ProductAnalyticsFunnel);
    expect(settingsBadge().textContent).toBe("Trichter");
    cleanup();

    renderSettings(DashboardComponentType.DockerHostList);
    expect(settingsBadge().textContent).toBe("Docker-Hosts");
    expect(settingsBadge()).toHaveAttribute("title", "Docker-Hosts");
    cleanup();

    renderSettings(DashboardComponentType.DockerImageList);
    expect(settingsBadge().textContent).toBe("Docker-Images");
    cleanup();

    // A type there is no widget of is not looked up: it is no word.
    renderSettings("HostMetricChart");
    expect(settingsBadge().textContent).toBe("HostMetricChart");
  });

  test("in Persian and Japanese: the names their files give", async () => {
    await act(async () => {
      await i18next.changeLanguage("fa");
    });

    renderSettings(DashboardComponentType.ProductAnalyticsRetention);
    expect(settingsBadge().textContent).toBe(
      readDashboardLocale("fa")["User Retention"],
    );
    expect(settingsBadge().textContent).not.toBe("User Retention");
    cleanup();

    await act(async () => {
      await i18next.changeLanguage("ja");
    });

    renderSettings(DashboardComponentType.KubernetesJobList);
    expect(settingsBadge().textContent).toBe("Kubernetes Job");
  });

  test("follows a change of language while the dialog is open", async () => {
    renderSettings(DashboardComponentType.ProductAnalyticsFunnel);

    expect(settingsBadge().textContent).toBe("Funnel");

    await act(async () => {
      await i18next.changeLanguage("de");
    });

    expect(settingsBadge().textContent).toBe("Trichter");
  });
});

describe("the badge on a widget while the board is edited", () => {
  test("a selected widget: its name, cut at its end, no longer capitalized by its class", () => {
    renderCard(DashboardComponentType.ProductAnalyticsFunnel);

    expect(cardBadge().textContent).toBe("Funnel");
    expect(cardBadge()).not.toHaveClass("capitalize");
    expect(cardBadge()).toHaveClass("truncate");
    expect(cardBadge()).toHaveClass("block");
    // Never wider than the widget, less the 6px it keeps from each edge.
    expect(cardBadge().parentElement).toHaveStyle({
      maxWidth: "calc(100% - 12px)",
    });
    expect(screen.getByTestId("widget-stub")).toBeInTheDocument();
  });

  test("under the drag bar at the line's end: by classes a page read from the right turns round, no physical side of its own", () => {
    renderCard(DashboardComponentType.ProductAnalyticsRetention);

    const box: HTMLElement = cardBadge().parentElement!;

    expect(box.className).toBe(WIDGET_TYPE_BADGE_BOX_CLASS_NAME);
    expect(box).toHaveClass("absolute", "top-8", "right-1.5", "z-20");
    /*
     * An inline right: 6px stayed on the right of a Persian card, over the
     * first words of its title.
     */
    expect(box.style.right).toBe("");
    expect(box.style.left).toBe("");
    expect(box.style.top).toBe("");
  });

  test.each([
    [DashboardComponentType.DockerHostList, "Docker Hosts"],
    [DashboardComponentType.DataSourceChart, "Data Source Chart"],
    [DashboardComponentType.ProductAnalyticsRetention, "User Retention"],
    [DashboardComponentType.KubernetesJobList, "Kubernetes Jobs"],
    [DashboardComponentType.Text, "Text"],
  ])("a %s widget: %s", (type: DashboardComponentType, name: string) => {
    renderCard(type);

    expect(cardBadge().textContent).toBe(name);
  });

  test("an unselected widget: only while the pointer is over it", () => {
    const { container } = renderCard(DashboardComponentType.DockerHostList, {
      isSelected: false,
    });

    expect(
      screen.queryByTestId(WIDGET_TYPE_BADGE_TEST_ID),
    ).not.toBeInTheDocument();

    const card: HTMLElement = container.firstElementChild as HTMLElement;

    fireEvent.mouseEnter(card);
    expect(cardBadge().textContent).toBe("Docker Hosts");

    fireEvent.mouseLeave(card);
    expect(
      screen.queryByTestId(WIDGET_TYPE_BADGE_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("not while it is dragged, and never on a board that is not edited", () => {
    renderCard(DashboardComponentType.DockerHostList, {
      dndActiveMode: "move",
    });
    expect(
      screen.queryByTestId(WIDGET_TYPE_BADGE_TEST_ID),
    ).not.toBeInTheDocument();
    cleanup();

    renderCard(DashboardComponentType.DockerHostList, { isEditMode: false });
    expect(
      screen.queryByTestId(WIDGET_TYPE_BADGE_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("a type OneUptime has no widget of: as it was stored", () => {
    renderCard("HostMetricChart");

    expect(cardBadge().textContent).toBe("HostMetricChart");
  });

  test.each([
    ["no type", undefined],
    ["an empty type", ""],
    ["a type of spaces", "  "],
  ])("%s: no badge at all", (_name: string, type: unknown) => {
    renderCard(type);

    expect(
      screen.queryByTestId(WIDGET_TYPE_BADGE_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("in German and Persian: their names, the same as the settings dialog's", async () => {
    await act(async () => {
      await i18next.changeLanguage("de");
    });

    renderCard(DashboardComponentType.DockerHostList);
    expect(cardBadge().textContent).toBe("Docker-Hosts");
    cleanup();

    renderSettings(DashboardComponentType.DockerHostList);
    expect(settingsBadge().textContent).toBe("Docker-Hosts");
    cleanup();

    await act(async () => {
      await i18next.changeLanguage("fa");
    });

    renderCard(DashboardComponentType.DataSourceChart);
    expect(cardBadge().textContent).toBe(
      readDashboardLocale("fa")["Data Source Chart"],
    );
    expect(cardBadge().textContent).not.toBe("Data Source Chart");
  });
});

/*
 * jsdom has no stylesheet, so the class names alone prove nothing: the
 * Dashboard styles itself with the vendored Tailwind runtime and the
 * reading-direction script (its index.ejs), run here over the badge box's
 * classes. Last in the file: the runtime watches the page from here on.
 */
describe("the CSS the page writes for the badge's box", () => {
  const DASHBOARD_CONFIG: Record<string, unknown> = {
    darkMode: "class",
    theme: {
      extend: {
        fontFamily: {
          display: ["Inter", "sans-serif"],
          body: ["Inter", "sans-serif"],
        },
      },
    },
  };

  let rules: Array<EmittedRule> = [];

  beforeAll(async () => {
    await loadPlayCdn({
      withReadingDirection: true,
      config: DASHBOARD_CONFIG,
    });

    rules = await addClassNames([
      WIDGET_TYPE_BADGE_BOX_CLASS_NAME,
      WIDGET_SETTINGS_SUMMARY_CLASS_NAME,
      WIDGET_SETTINGS_TYPE_BADGE_CLASS_NAME,
    ]);
  }, 60000);

  afterAll(() => {
    unloadPlayCdn();
  });

  test("6px in from the line's end - the right, or the left of a page read from the right - and 32px down, under the drag bar", () => {
    expect(declarationsForSelector(rules, ".right-1\\.5")).toEqual({
      "inset-inline-end": "0.375rem",
    });
    expect(declarationsForSelector(rules, ".top-8")).toEqual({
      top: "2rem",
    });
    expect(declarationsForSelector(rules, ".absolute")).toEqual({
      position: "absolute",
    });
    expect(declarationsForSelector(rules, ".z-20")).toEqual({
      "z-index": "20",
    });
    expect(declarationsForSelector(rules, ".pointer-events-none")).toEqual({
      "pointer-events": "none",
    });
  });

  test("the settings dialog's line wraps the size under the kind before it cuts either; the kind is cut only at the line's width", () => {
    expect(declarationsForSelector(rules, ".flex-wrap")).toEqual({
      "flex-wrap": "wrap",
    });
    expect(declarationsForSelector(rules, ".min-w-0")).toEqual({
      "min-width": "0px",
    });
    expect(declarationsForSelector(rules, ".max-w-full")).toEqual({
      "max-width": "100%",
    });
    expect(declarationsForSelector(rules, ".truncate")).toEqual({
      overflow: "hidden",
      "text-overflow": "ellipsis",
      "white-space": "nowrap",
    });
  });
});
