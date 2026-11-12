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
import path from "path";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import EntityType from "../../../Types/Telemetry/EntityType";
import EntitySource from "../../../Types/Telemetry/EntitySource";
import EntityRelationshipType from "../../../Types/Telemetry/EntityRelationshipType";
import ObjectID from "../../../Types/ObjectID";
import { setDateDisplayLanguage } from "../../../Types/DateLanguage";
import {
  PluralTemplate,
  Translator,
  formatInline,
} from "../../../Types/Translator";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * #7105: THE INFRASTRUCTURE EXPLORER'S SENTENCES, WHOLE, IN EVERY LANGUAGE.
 *
 * The explorer built its sentences from English pieces: "Show all" + a
 * count + "in" + a name for the tree's button, "Page" + a number + "of" +
 * a number + a count + a type's English plural for a collection's pager,
 * a count + "resources are known but have been silent..." for an estate
 * with nothing to show. A language whose sentence runs the other way - a
 * Japanese name before its verb, a Persian count after its noun - read
 * each piece in English order, and the type names in English.
 *
 * Every one is now a template of the locale, the name and the count
 * filled in where the language puts them, a count in the reader's digits
 * and in the plural form its language takes for it. Rendered here from the
 * real locale files through a real i18next instance, for English and all
 * seventeen languages. The map, the details drawer and the collection
 * transport are replaced, as in InfrastructureExplorer.test.
 */

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return new ObjectID("dde060c6-fe0d-49ce-b44c-4035a13bc1db");
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Topology/InfrastructureGraph",
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

const mockFetchCollectionPage: MockFunction = getJestMockFunction();
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Topology/InfrastructureCollectionApi",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/Topology/InfrastructureCollectionApi",
    ) as Record<string, unknown>;
    return {
      ...actual,
      __esModule: true,
      fetchCollectionPage: (...args: Array<unknown>): unknown => {
        return mockFetchCollectionPage(...args);
      },
      fetchCollectionSearchCounts: (): Promise<unknown> => {
        return new Promise(() => {});
      },
    };
  },
);

import InfrastructureExplorer from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/InfrastructureExplorer";
import {
  InfrastructureCollection,
  InfrastructureTotals,
  TopologyEntity,
  TopologyRelationship,
  TopologyTruncation,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/TopologyData";
import type { CollectionPage } from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/InfrastructureCollectionApi";

const EXPLORER_SOURCE: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Components/Topology/InfrastructureExplorer.tsx",
);

const DAY: number = 24 * 60 * 60 * 1000;
const NOW: Date = new Date();
const RANGE_START: Date = new Date(NOW.getTime() - DAY);
const LONG_AGO: Date = new Date(NOW.getTime() - 20 * DAY);

const LANGUAGES: Array<string> = ["en", ...DASHBOARD_LANGUAGES];

/*
 * The sentences the explorer draws with a name or a count in them, each a
 * key of the locale (#7105), and the "one" form of each plural.
 */
const SENTENCES: ReadonlyArray<string> = [
  "Expand {{name}}",
  "Collapse {{name}}",
  "Show all {{count}} in {{name}}",
  "Show all {{count}}",
  "Show {{name}} on the service map",
  "Open {{name}}",
  "View details for {{name}}",
  "in {{name}}",
  "Page {{current}} of {{total}}",
  "{{count}} resources",
  "{{count}} resources_one",
  "{{count}} matches",
  "{{count}} matches_one",
  "Names containing {{terms}}",
  "Loading {{name}}…",
  "{{count}} resources are known but have been silent. Pick a longer time range or show inactive resources.",
  "{{count}} resources are known but have been silent. Pick a longer time range or show inactive resources._one",
  // The detail panel's focus button, registered for the panel to look up.
  "Show where it is",
  "Show on the service map",
  "Show its connections",
];

const RESOURCES: PluralTemplate = {
  one: "{{count}} resource",
  other: "{{count}} resources",
};

const MATCHES: PluralTemplate = {
  one: "{{count}} match",
  other: "{{count}} matches",
};

const SILENT: PluralTemplate = {
  one: "{{count}} resource is known but has been silent. Pick a longer time range or show inactive resources.",
  other:
    "{{count}} resources are known but have been silent. Pick a longer time range or show inactive resources.",
};

// What the old sentence was made of: a count, then the rest in one fragment.
const OLD_SILENT_FRAGMENT: string =
  "resources are known but have been silent. Pick a longer time range or show inactive resources.";

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

// A fixed word as the explorer looks it up: the locale's, or the English.
function word(language: string, english: string): string {
  return dashboardTranslator(language).translateText(english) || english;
}

function entity(
  key: string,
  type: EntityType,
  name: string = key,
  lastSeenAt: Date = NOW,
): TopologyEntity {
  return {
    entityKey: key,
    entityType: type,
    displayName: name,
    lastSeenAt,
    source: EntitySource.Discovered,
  };
}

function hostedOn(from: string, to: string): TopologyRelationship {
  return {
    fromEntityKey: from,
    toEntityKey: to,
    relationshipType: EntityRelationshipType.HostedOn,
  };
}

interface Estate {
  entities: Array<TopologyEntity>;
  relationships: Array<TopologyRelationship>;
  collections?: Array<InfrastructureCollection>;
  totals?: InfrastructureTotals;
  truncation?: TopologyTruncation | null;
}

/*
 * Two services on their hosts, and a host with nothing on it: the
 * explorer groups the replicas of a service ("oneuptime-app") and lists
 * build-server alone.
 */
function smallEstate(): Estate {
  return {
    entities: [
      entity("api", EntityType.Service),
      entity("home", EntityType.Service),
      entity("h1", EntityType.Host, "oneuptime-app-685856b7d7-48xkt"),
      entity("h2", EntityType.Host, "oneuptime-app-685856b7d7-4vnkt"),
      entity("home-1", EntityType.Host, "oneuptime-home-56d657f4b4-7kslf"),
      entity("home-2", EntityType.Host, "oneuptime-home-56d657f4b4-zvcr6"),
      entity("builder", EntityType.Host, "build-server"),
    ],
    relationships: [
      hostedOn("api", "h1"),
      hostedOn("api", "h2"),
      hostedOn("home", "home-1"),
      hostedOn("home", "home-2"),
    ],
  };
}

/*
 * 150 hosts that each hold a container: few enough for the tree to open
 * fully, more than the 100 a level lists before it offers the rest.
 */
function hostsWithContainers(count: number): Estate {
  const entities: Array<TopologyEntity> = [];
  const relationships: Array<TopologyRelationship> = [];

  for (let index: number = 0; index < count; index++) {
    const host: string = `host-${String(index).padStart(3, "0")}`;

    entities.push(entity(host, EntityType.Host, `${host}.internal`));
    entities.push(
      entity(`${host}/c`, EntityType.Container, `${host}-container`),
    );
    relationships.push({
      fromEntityKey: `${host}/c`,
      toEntityKey: host,
      relationshipType: EntityRelationshipType.PartOf,
    });
  }

  return { entities, relationships };
}

// IoT devices the server summarized: 4,200 of 5,000 reporting.
function withIoTCollection(): Estate {
  return {
    ...smallEstate(),
    collections: [
      {
        entityType: EntityType.IoTDevice,
        total: 5000,
        active: 4200,
        lastSeenAt: NOW,
        activeLastSeenAt: NOW,
      },
    ],
  };
}

interface ExplorerOptions {
  includeInactive?: boolean;
  onOpenServiceMap?: (key: string) => void;
}

function renderIn(
  language: string,
  estate: Estate,
  options: ExplorerOptions = {},
): void {
  setDateDisplayLanguage(language);
  render(
    <I18nextProvider i18n={instanceFor(language)}>
      <MemoryRouter>
        <InfrastructureExplorer
          entities={estate.entities}
          relationships={estate.relationships}
          collections={estate.collections}
          totals={estate.totals}
          truncation={estate.truncation}
          metricsWindowSeconds={900}
          rangeStart={RANGE_START}
          includeInactive={options.includeInactive}
          onOpenServiceMap={options.onOpenServiceMap}
        />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

function tree(): HTMLElement {
  const aside: HTMLElement | null = document.querySelector("aside[aria-label]");

  expect(aside).not.toBeNull();

  return aside as HTMLElement;
}

// The line under the scope's title that counts what is listed.
function countLine(): HTMLElement {
  const title: HTMLElement = screen.getByTestId("infrastructure-scope-title");
  const line: HTMLElement | null =
    title.parentElement?.querySelector('p[role="status"]') || null;

  expect(line).not.toBeNull();

  return line as HTMLElement;
}

beforeAll(() => {
  for (const language of LANGUAGES) {
    instanceFor(language);
  }
});

beforeEach(() => {
  window.history.replaceState(
    {},
    "",
    "/dashboard/project/topology/overview?tab=Infrastructure",
  );
  mockFetchCollectionPage.mockReset();
});

afterEach(() => {
  cleanup();
  setDateDisplayLanguage(null);
});

describe("the explorer's sentences, as keys of every locale", () => {
  test("each is a key of the English locale, holding its English", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    for (const key of SENTENCES) {
      const expected: string = key.endsWith("_one")
        ? key === "{{count}} resources_one"
          ? RESOURCES.one
          : key === "{{count}} matches_one"
            ? MATCHES.one
            : SILENT.one
        : key;

      expect({ key, english: english[key] }).toEqual({
        key,
        english: expected,
      });
    }
  });

  test.each(DASHBOARD_LANGUAGES)(
    "%s words every one, with its placeholders",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);
      const english: Record<string, string> = readDashboardLocale("en");

      for (const key of SENTENCES) {
        expect({
          language,
          key,
          worded: isWordedInDashboardLocale(key, language),
          placeholders: placeholdersOf(String(words[key])),
        }).toEqual({
          language,
          key,
          worded: true,
          placeholders: placeholdersOf(String(english[key])),
        });
      }
    },
  );

  test("the check sees a sentence a language does not word (negative control)", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      expect(
        isWordedInDashboardLocale(
          "Show all {{count}} under {{name}}",
          language,
        ),
      ).toBe(false);
    }
  });

  /*
   * No sentence is pieced together from English fragments any more: no
   * t("in") between a word and a name, no lookup inside a template string
   * with a name or a number after it, no type's English plural.
   */
  test("the explorer looks up no fragment of a sentence", () => {
    const source: string = fs.readFileSync(EXPLORER_SOURCE, "utf8");
    const fragments: ReadonlyArray<string> = [
      "in",
      "of",
      "Page",
      "Show",
      "Loading",
      "matching",
      "Names containing",
      "on the service map",
      "View details for",
      "Expand",
      "Collapse",
      "resources",
      OLD_SILENT_FRAGMENT,
    ];

    for (const fragment of fragments) {
      expect({
        fragment,
        lookedUp: source.includes(`t(${JSON.stringify(fragment)})`),
      }).toEqual({ fragment, lookedUp: false });
    }

    expect(source).not.toMatch(/`[^`]*\$\{t\(/);
    expect(source).not.toMatch(/\bnounForType\b/);

    // The template-string check sees the old aria-label (negative control).
    expect(
      'aria-label={`${t("Show")} ${name} ${t("on the service map")}`}',
    ).toMatch(/`[^`]*\$\{t\(/);
  });
});

describe.each(LANGUAGES)("the explorer in %s", (language: string) => {
  const translator: Translator = dashboardTranslator(language);

  test("rows, the tree and the service chips are named by whole sentences", () => {
    const onOpenServiceMap: MockFunction = getJestMockFunction();

    renderIn(language, smallEstate(), {
      includeInactive: true,
      onOpenServiceMap,
    });

    const category: string = word(language, "Hosts & containers");

    // The tree's category, collapsed and expanded by its name.
    const collapse: HTMLElement = within(tree()).getByLabelText(
      translator.translateTemplate("Collapse {{name}}", { name: category }),
    );

    expect(collapse).toHaveAttribute("aria-expanded", "true");

    // A group of replicas opens; a plain host shows its details.
    expect(
      screen.getByLabelText(
        translator.translateTemplate("Open {{name}}", {
          name: "oneuptime-app",
        }),
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByLabelText(
        translator.translateTemplate("View details for {{name}}", {
          name: "build-server",
        }),
      ),
    ).toBeInTheDocument();

    // A service chip names the service where the sentence puts it.
    const chips: Array<HTMLElement> = screen.getAllByLabelText(
      translator.translateTemplate("Show {{name}} on the service map", {
        name: "api",
      }),
    );

    expect(chips.length).toBeGreaterThan(0);
    fireEvent.click(chips[0]!);
    expect(onOpenServiceMap).toHaveBeenCalledWith("api");

    fireEvent.click(collapse);
    expect(
      within(tree()).getByLabelText(
        translator.translateTemplate("Expand {{name}}", { name: category }),
      ),
    ).toHaveAttribute("aria-expanded", "false");
  });

  test("the count of what is listed, and of what a search found, in the language's plural", () => {
    renderIn(language, smallEstate(), { includeInactive: true });

    // 5 resources: the five hosts (a service is placed on them, not counted).
    expect(countLine().textContent).toBe(
      translator.translatePlural(RESOURCES, 5),
    );

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "home" },
    });

    // The group and its two hosts.
    expect(countLine().textContent).toBe(
      translator.translatePlural(MATCHES, 3),
    );

    /*
     * A found host says where it is: its type, and "in" its group as one
     * sentence of its own, set off from the type as the language does.
     */
    const hostRow: HTMLElement | undefined = screen
      .getAllByTestId("infrastructure-row")
      .find((row: HTMLElement): boolean => {
        return (row.textContent || "").includes("7kslf");
      });

    expect(hostRow).toBeDefined();
    expect(hostRow!.textContent).toContain(
      formatInline(
        [
          word(language, "Host"),
          translator.translateTemplate("in {{name}}", {
            name: "oneuptime-home",
          }),
        ],
        translator,
      ),
    );
  });

  test("one match and one resource read in the one form", () => {
    renderIn(
      language,
      {
        entities: [entity("solo", EntityType.Host, "solo-host")],
        relationships: [],
      },
      { includeInactive: true },
    );

    expect(countLine().textContent).toBe(
      translator.translatePlural(RESOURCES, 1),
    );

    fireEvent.change(screen.getByRole("searchbox"), {
      target: { value: "solo" },
    });

    expect(countLine().textContent).toBe(
      translator.translatePlural(MATCHES, 1),
    );

    if (language === "en") {
      expect(countLine().textContent).toBe("1 match");
    }
  });

  test("a level with more than a hundred lists the first and offers the rest by count and name", () => {
    renderIn(language, hostsWithContainers(150), { includeInactive: true });

    const category: string = word(language, "Hosts & containers");
    const count: string = translator.formatNumber(150);
    const showAll: HTMLElement = within(tree()).getByLabelText(
      translator.translateTemplate("Show all {{count}} in {{name}}", {
        count,
        name: category,
      }),
    );

    expect(showAll.textContent).toBe(
      translator.translateTemplate("Show all {{count}}", { count }),
    );
    expect(
      within(tree()).queryByTestId("infrastructure-tree-host-149"),
    ).not.toBeInTheDocument();

    fireEvent.click(showAll);

    expect(
      within(tree()).getByTestId("infrastructure-tree-host-149"),
    ).toBeInTheDocument();
  });

  test("an estate with nothing reporting says how many are silent, as one sentence", () => {
    renderIn(language, {
      entities: [entity("gone", EntityType.Host, "old-host", LONG_AGO)],
      relationships: [],
    });

    const one: string =
      screen.getByTestId("infrastructure-all-inactive").querySelector("p")
        ?.textContent || "";

    expect(one).toBe(translator.translatePlural(SILENT, 1));

    if (language === "en") {
      // One resource is one: not a count before the old "resources are ...".
      expect(one).toBe(
        "1 resource is known but has been silent. Pick a longer time range or show inactive resources.",
      );
      expect(one).not.toBe(`1 ${OLD_SILENT_FRAGMENT}`);
    }
    cleanup();

    // The server counted 1,500 past the safety cap.
    renderIn(language, {
      entities: [entity("gone", EntityType.Host, "old-host", LONG_AGO)],
      relationships: [],
      totals: { resources: 1500, activeResources: 0 },
      truncation: { shown: 1, total: 1500 },
    });

    const many: string =
      screen.getByTestId("infrastructure-all-inactive").querySelector("p")
        ?.textContent || "";

    expect(many).toBe(translator.translatePlural(SILENT, 1500));
    expect(many).toContain(translator.formatNumber(1500));
  });

  test("a collection says it is loading, then pages its items by page and by count", async () => {
    let resolvePage: (page: CollectionPage) => void = (): void => {};

    mockFetchCollectionPage.mockReturnValue(
      new Promise<CollectionPage>((resolve: (page: CollectionPage) => void) => {
        resolvePage = resolve;
      }),
    );

    renderIn(language, withIoTCollection());

    fireEvent.click(
      screen.getByLabelText(
        translator.translateTemplate("Open {{name}}", { name: "IoT Devices" }),
      ),
    );

    expect(
      screen.getByText(
        translator.translateTemplate("Loading {{name}}…", {
          name: "IoT Devices",
        }),
      ),
    ).toHaveAttribute("aria-busy", "true");

    await act(async () => {
      resolvePage({
        rangeStart: RANGE_START,
        entityType: EntityType.IoTDevice,
        total: 4200,
        items: [
          entity("iot-1", EntityType.IoTDevice, "sensor-001"),
          entity("iot-2", EntityType.IoTDevice, "sensor-002"),
        ],
        nextCursor: { name: "sensor-002", key: "iot-2" },
      });
    });

    await waitFor(() => {
      expect(
        screen.getAllByTestId("infrastructure-collection-row"),
      ).toHaveLength(2);
    });

    // 4,200 at 50 a page: page 1 of 84, and how many resources in all.
    const pager: string = formatInline(
      [
        translator.translateTemplate("Page {{current}} of {{total}}", {
          current: translator.formatNumber(1),
          total: translator.formatNumber(84),
        }),
        translator.translatePlural(RESOURCES, 4200),
      ],
      translator,
    );

    // The pager's label, compared as drawn: French's 4 200 holds a narrow space.
    const labels: Array<string> = Array.from(
      screen
        .getByTestId("infrastructure-collection-table")
        .parentElement!.parentElement!.querySelectorAll("span"),
    )
      .map((span: HTMLSpanElement): string => {
        return span.textContent || "";
      })
      .filter((text: string): boolean => {
        return text.includes(translator.formatNumber(84));
      });

    expect(labels).toEqual([pager]);
    // A count of resources, never the type's English plural.
    expect(pager).not.toContain("IoT devices");
    expect(
      screen.getByLabelText(
        translator.translateTemplate("View details for {{name}}", {
          name: "sensor-001",
        }),
      ),
    ).toBeInTheDocument();
  });
});

/*
 * The languages the issue named, pinned as their locales word them, so a
 * template that loses its words or its order shows here by name.
 */
describe("the sentences the issue showed", () => {
  test("Japanese puts the name before the verb and the count in its own place", () => {
    const ja: Translator = dashboardTranslator("ja");

    expect(ja.translateTemplate("Open {{name}}", { name: "web-01" })).toMatch(
      /^web-01/,
    );
    expect(
      ja.translateTemplate("Show all {{count}} in {{name}}", {
        count: "150",
        name: "X",
      }),
    ).not.toBe(`${word("ja", "Show all")} 150 ${word("ja", "in")} X`);
  });

  test("Persian writes a pager's numbers in Persian digits and sets the facts apart with a bullet", () => {
    const fa: Translator = dashboardTranslator("fa");
    const pager: string = formatInline(
      [
        fa.translateTemplate("Page {{current}} of {{total}}", {
          current: fa.formatNumber(1),
          total: fa.formatNumber(84),
        }),
        fa.translatePlural(RESOURCES, 4200),
      ],
      fa,
    );

    expect(pager).toContain("۸۴");
    expect(pager).toContain("۴٬۲۰۰");
    expect(pager).toContain(" • ");
    expect(pager).not.toMatch(/[0-9]/);
  });
});
