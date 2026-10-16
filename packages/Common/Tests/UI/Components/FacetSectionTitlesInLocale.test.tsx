import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { createInstance, i18n } from "i18next";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import LogsFacetSidebar from "../../../UI/Components/LogsViewer/components/LogsFacetSidebar";
import FacetSectionHeader from "../../../UI/Components/TelemetryViewer/components/FacetSectionHeader";
import HiddenFacetsFooter from "../../../UI/Components/TelemetryViewer/components/HiddenFacetsFooter";
import TelemetryActiveFilterChips from "../../../UI/Components/TelemetryViewer/components/TelemetryActiveFilterChips";
import TelemetryFacetSidebar from "../../../UI/Components/TelemetryViewer/components/TelemetryFacetSidebar";
import { buildResourceFacetConfigs } from "../../../UI/Components/TelemetryViewer/ResourceFacetConfigs";
import {
  ActiveFilter,
  FacetConfig,
  FacetData,
} from "../../../UI/Components/TelemetryViewer/types";
import {
  RESOURCE_FACET_CATALOG,
  ResourceFacetDefinition,
} from "../../../Types/Telemetry/ResourceFacetCatalog";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A facet sidebar names each section in the reader's language.
 *
 * The chips above the list and a section's search box always named a facet
 * in the reader's language, but the section headers drew the config's English
 * title: a Japanese reader saw a "SPAN KIND" section above a "スパンの種類:"
 * chip. The shared header (FacetSectionHeader) and the hidden-filters
 * tooltip (HiddenFacetsFooter) now draw the title through the translator, in
 * every explorer: Traces, Metrics, Exceptions and Security Events
 * (TelemetryFacetSidebar) and Logs (LogsFacetSidebar).
 *
 * The test locale is a few Japanese strings keyed by the English text, as
 * App/FeatureSet/Dashboard/src/Locales/ja.json is. The Dashboard's real
 * locales are rendered in Common/Tests/App/Dashboard/
 * TracesFilterNamesInEveryLanguage.
 */

const JAPANESE: Record<string, string> = {
  Service: "サービス",
  Status: "ステータス",
  "Span Type": "スパンタイプ",
  "Span Kind": "スパンの種類",
  Severity: "重大度",
  Host: "ホスト",
  "Docker Host": "Docker ホスト",
  Filters: "フィルター",
  "Search {{name}}": "{{name}}を検索",
  "Search {{name}}...": "{{name}}を検索...",
};

const japanese: i18n = createInstance();

beforeAll(async () => {
  await japanese.init({
    lng: "ja",
    resources: { ja: { translation: JAPANESE } },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(() => {
  cleanup();
});

const inJapanese: (element: ReactElement) => void = (
  element: ReactElement,
): void => {
  render(<I18nextProvider i18n={japanese}>{element}</I18nextProvider>);
};

// What a header draws for an English title in the test locale.
const japaneseName: (english: string) => string = (
  english: string,
): string => {
  return JAPANESE[english] ?? english;
};

/*
 * The section headers of a sidebar, in the order it draws them: the buttons
 * that fold a section, with its title in small capitals.
 */
function sectionTitles(): Array<string> {
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
}

const SERVICE: FacetConfig = {
  key: "primaryEntityId",
  title: "Service",
  priority: 1,
  serverSearchable: true,
};

const STATUS: FacetConfig = { key: "statusCode", title: "Status", priority: 6 };

const SPAN_TYPE: FacetConfig = {
  key: "spanType",
  title: "Span Type",
  valueDisplayMap: { root: "Root spans" },
  priority: 6.5,
};

const SPAN_KIND: FacetConfig = {
  key: "kind",
  title: "Span Kind",
  valueDisplayMap: { SPAN_KIND_SERVER: "Server" },
  priority: 7,
};

// The traces explorer's sidebar in small: Service, the resource types, then its span facets.
const TRACES_CONFIGS: Array<FacetConfig> = [
  SPAN_KIND,
  STATUS,
  ...buildResourceFacetConfigs({ basePriority: 2 }),
  SPAN_TYPE,
  SERVICE,
];

// Hosts have values; every other resource type is empty and folds away.
const TRACES_FACETS: FacetData = {
  primaryEntityId: [{ value: "svc-1", count: 3, displayName: "checkout" }],
  hostId: [{ value: "host-1", count: 2, displayName: "web-1" }],
  statusCode: [{ value: "2", count: 1 }],
  spanType: [{ value: "root", count: 2 }],
  kind: [{ value: "SPAN_KIND_SERVER", count: 4 }],
};

for (const definition of RESOURCE_FACET_CATALOG) {
  if (definition.facetKey !== "hostId") {
    TRACES_FACETS[definition.facetKey] = [];
  }
}

const FOLDED_RESOURCE_TITLES: Array<string> = RESOURCE_FACET_CATALOG.filter(
  (definition: ResourceFacetDefinition): boolean => {
    return definition.facetKey !== "hostId";
  },
).map((definition: ResourceFacetDefinition): string => {
  return definition.label;
});

const ROOT_SPANS_CHIP: ActiveFilter = {
  facetKey: "spanType",
  value: "root",
  displayKey: "Span Type",
  displayValue: "Root spans",
};

const SERVER_CHIP: ActiveFilter = {
  facetKey: "kind",
  value: "SPAN_KIND_SERVER",
  displayKey: "Span Kind",
  displayValue: "Server",
};

function tracesSidebar(options?: {
  onIncludeFilter?: MockFunction | undefined;
  activeFilters?: Array<ActiveFilter> | undefined;
}): ReactElement {
  return (
    <TelemetryFacetSidebar
      facetData={TRACES_FACETS}
      facetConfigs={TRACES_CONFIGS}
      isLoading={false}
      activeFilters={options?.activeFilters}
      onIncludeFilter={
        (options?.onIncludeFilter as unknown as (
          facetKey: string,
          value: string,
        ) => void) || jest.fn()
      }
      onRemoveFilter={jest.fn()}
      // Service searches the server, so its section gets a search box.
      onFacetSearchChange={jest.fn()}
    />
  );
}

describe("a facet section's header", () => {
  test("draws the facet's name in the reader's language", () => {
    inJapanese(
      <FacetSectionHeader
        title="Span Kind"
        activeCount={0}
        isExpanded={false}
        onToggle={jest.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "スパンの種類" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Span Kind")).toBeNull();
  });

  test("keeps the English of a name the reader's language has no wording for", () => {
    inJapanese(
      <FacetSectionHeader
        title="Has Exception"
        activeCount={0}
        isExpanded={true}
        onToggle={jest.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Has Exception" }),
    ).toBeInTheDocument();
  });

  test("draws the English it is given where no language is set up", () => {
    render(
      <FacetSectionHeader
        title="Span Kind"
        activeCount={2}
        isExpanded={true}
        onToggle={jest.fn()}
      />,
    );

    const header: HTMLElement = screen.getByRole("button", {
      name: /Span Kind/,
    });

    expect(header.querySelector("span.uppercase")?.textContent).toBe(
      "Span Kind",
    );
    // The count badge and the toggle are untouched.
    expect(within(header).getByText("2")).toBeInTheDocument();
    expect(header).toHaveAttribute("aria-expanded", "true");
  });

  test("still toggles its section", () => {
    const onToggle: MockFunction = getJestMockFunction();

    inJapanese(
      <FacetSectionHeader
        title="Span Type"
        activeCount={0}
        isExpanded={false}
        onToggle={onToggle as unknown as () => void}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "スパンタイプ" }));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });
});

describe("the traces sidebar, in Japanese", () => {
  test("names every section in Japanese, in the order the configs give", () => {
    inJapanese(tracesSidebar());

    expect(sectionTitles()).toEqual(
      ["Service", "Host", "Status", "Span Type", "Span Kind"].map(
        japaneseName,
      ),
    );
    expect(screen.getByText("フィルター")).toBeInTheDocument();
  });

  test("names Span Type and Span Kind apart, and neither in English", () => {
    inJapanese(tracesSidebar());

    const titles: Array<string> = sectionTitles();

    expect(titles).toContain("スパンタイプ");
    expect(titles).toContain("スパンの種類");
    expect(titles).not.toContain("Span Type");
    expect(titles).not.toContain("Span Kind");
    expect(new Set(titles).size).toBe(titles.length);
  });

  test("a section's search box names the facet as its header does", () => {
    inJapanese(tracesSidebar());

    expect(
      screen.getByRole("textbox", { name: "サービスを検索" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "サービス" }),
    ).toBeInTheDocument();
  });

  test("lists the folded empty filters in Japanese where it has their names", () => {
    inJapanese(tracesSidebar());

    const hiddenCount: HTMLElement = screen.getByTestId(
      "facet-sidebar-hidden-count",
    );

    expect(hiddenCount).toHaveAttribute(
      "title",
      FOLDED_RESOURCE_TITLES.map(japaneseName).join(", "),
    );
    expect(hiddenCount.getAttribute("title")).toContain("Docker ホスト");
    expect(hiddenCount.getAttribute("title")).not.toContain("Docker Host");
  });

  test("a click on a value hands back the facet's key, not the name it draws", () => {
    const onIncludeFilter: MockFunction = getJestMockFunction();

    inJapanese(tracesSidebar({ onIncludeFilter }));

    fireEvent.click(screen.getByRole("checkbox", { name: /Server/ }));

    expect(onIncludeFilter).toHaveBeenCalledWith("kind", "SPAN_KIND_SERVER");
  });
});

describe("a section and its chip name a facet alike", () => {
  test("in Japanese: the Root spans chip under スパンタイプ, the Server chip under スパンの種類", () => {
    const filters: Array<ActiveFilter> = [ROOT_SPANS_CHIP, SERVER_CHIP];

    inJapanese(
      <>
        <TelemetryActiveFilterChips
          filters={filters}
          onRemove={jest.fn()}
          onClearAll={jest.fn()}
        />
        {tracesSidebar({ activeFilters: filters })}
      </>,
    );

    expect(screen.getByText("スパンタイプ:")).toBeInTheDocument();
    expect(screen.getByText("スパンの種類:")).toBeInTheDocument();

    const titles: Array<string> = sectionTitles();

    for (const chip of filters) {
      expect(titles).toContain(japaneseName(chip.displayKey));
    }
  });

  test("in English, where no language is set up", () => {
    const filters: Array<ActiveFilter> = [ROOT_SPANS_CHIP, SERVER_CHIP];

    render(
      <>
        <TelemetryActiveFilterChips
          filters={filters}
          onRemove={jest.fn()}
          onClearAll={jest.fn()}
        />
        {tracesSidebar({ activeFilters: filters })}
      </>,
    );

    expect(screen.getByText("Span Type:")).toBeInTheDocument();
    expect(screen.getByText("Span Kind:")).toBeInTheDocument();
    expect(sectionTitles()).toEqual([
      "Service",
      "Host",
      "Status",
      "Span Type",
      "Span Kind",
    ]);
  });
});

describe("the logs sidebar, in Japanese", () => {
  test("names its sections in Japanese too", () => {
    inJapanese(
      <LogsFacetSidebar
        facetData={{
          severityText: [{ value: "ERROR", count: 2 }],
          primaryEntityId: [{ value: "svc-1", count: 1 }],
          hostId: [{ value: "host-1", count: 1, displayName: "web-1" }],
        }}
        isLoading={false}
        serviceMap={{}}
        onIncludeFilter={jest.fn()}
        onRemoveFilter={jest.fn()}
        savedViews={[]}
        selectedSavedViewId={null}
        onSavedViewSelect={jest.fn()}
        onClearSavedView={jest.fn()}
      />,
    );

    expect(sectionTitles()).toEqual(
      ["Severity", "Service", "Host"].map(japaneseName),
    );
  });
});

describe("the hidden filters' tooltip", () => {
  test("lists the folded filters in the reader's language", () => {
    inJapanese(
      <HiddenFacetsFooter
        hiddenCount={2}
        hiddenTitles={["Docker Host", "Podman Host"]}
        isShowingHidden={false}
        onToggle={jest.fn()}
      />,
    );

    expect(screen.getByTestId("facet-sidebar-hidden-count")).toHaveAttribute(
      "title",
      "Docker ホスト, Podman Host",
    );
  });

  test("and on the Hide button once they are shown", () => {
    inJapanese(
      <HiddenFacetsFooter
        hiddenCount={1}
        hiddenTitles={["Host"]}
        isShowingHidden={true}
        onToggle={jest.fn()}
      />,
    );

    expect(
      within(screen.getByTestId("facet-sidebar-hidden-footer")).getByRole(
        "button",
      ),
    ).toHaveAttribute("title", "ホスト");
  });

  test("lists them in English where no language is set up", () => {
    render(
      <HiddenFacetsFooter
        hiddenCount={2}
        hiddenTitles={["Docker Host", "Podman Host"]}
        isShowingHidden={false}
        onToggle={jest.fn()}
      />,
    );

    expect(screen.getByTestId("facet-sidebar-hidden-count")).toHaveAttribute(
      "title",
      "Docker Host, Podman Host",
    );
  });
});
