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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import EntityType from "../../../Types/Telemetry/EntityType";
import EntitySource from "../../../Types/Telemetry/EntitySource";
import ObjectID from "../../../Types/ObjectID";
import { setDateDisplayLanguage } from "../../../Types/DateLanguage";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import {
  DASHBOARD_LANGUAGES,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * #6693: THE INFRASTRUCTURE LIST'S LAST SEEN, WHOLE, IN EVERY LANGUAGE.
 *
 * Last seen was one line - "Aktiv · vor 65 Tagen" - that could not wrap:
 * the column was as wide as the longest language's sentence, and at 1280
 * pixels German's ran past the table's right edge, cut off. It is now the
 * status on one line and how long ago under it, each line whole: the
 * column is as wide as the longer of the two, never their sum.
 *
 * Rendered here from the real locale files through a real i18next
 * instance, with dates written in the reader's language, for the list of
 * resources and for a collection's page of items. The map, the details
 * drawer and the collection transport are replaced, as in
 * InfrastructureExplorer.test.
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
import { formatLastSeenInLanguage } from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/TopologyActivity";
import {
  TopologyEntity,
  TopologyRelationship,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/TopologyData";
import type { CollectionPage } from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/InfrastructureCollectionApi";

const DAY: number = 24 * 60 * 60 * 1000;
const NOW: Date = new Date();
const RANGE_START: Date = new Date(NOW.getTime() - DAY);
const SIXTY_FIVE_DAYS_AGO: Date = new Date(NOW.getTime() - 65 * DAY);
const FIVE_MINUTES_AGO: Date = new Date(NOW.getTime() - 5 * 60 * 1000);

const LANGUAGES: Array<string> = ["en", ...DASHBOARD_LANGUAGES];

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

// Persian's and Arabic's digits as Latin ones: "65 days ago" in Persian holds 65.
function latinDigits(text: string): string {
  return text.replace(/[\u0660-\u0669\u06F0-\u06F9]/g, (digit: string) => {
    const code: number = digit.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

function word(language: string, english: string): string {
  return readDashboardLocale(language)[english] || english;
}

function host(
  key: string,
  name: string,
  lastSeenAt: Date | undefined,
  source: EntitySource = EntitySource.Discovered,
): TopologyEntity {
  return {
    entityKey: key,
    entityType: EntityType.Host,
    displayName: name,
    lastSeenAt,
    source,
  };
}

/*
 * Three plain resources: one that went quiet 65 days ago, one that reported
 * five minutes ago, and a manual one with no time at all.
 */
const ENTITIES: Array<TopologyEntity> = [
  host("gone", "build-server-old", SIXTY_FIVE_DAYS_AGO),
  host("live", "web-01", FIVE_MINUTES_AGO),
  host("manual", "rack-12-pdu", undefined, EntitySource.Manual),
];
const RELATIONSHIPS: Array<TopologyRelationship> = [];

function renderIn(language: string, element: React.ReactElement): void {
  setDateDisplayLanguage(language);
  render(
    <I18nextProvider i18n={instanceFor(language)}>
      <MemoryRouter>{element}</MemoryRouter>
    </I18nextProvider>,
  );
}

function explorer(
  entities: Array<TopologyEntity>,
  extra: Partial<React.ComponentProps<typeof InfrastructureExplorer>> = {},
): React.ReactElement {
  return (
    <InfrastructureExplorer
      entities={entities}
      relationships={RELATIONSHIPS}
      metricsWindowSeconds={900}
      rangeStart={RANGE_START}
      includeInactive={true}
      {...extra}
    />
  );
}

interface LastSeen {
  cell: HTMLElement;
  status: HTMLElement;
  age: HTMLElement | null;
}

// The Last seen of the row that holds `name`.
function lastSeenOf(rowTestId: string, name: string): LastSeen {
  const row: HTMLElement | undefined = screen
    .getAllByTestId(rowTestId)
    .find((candidate: HTMLElement): boolean => {
      return (candidate.textContent || "").includes(name);
    });

  expect(row).toBeDefined();

  const lastSeen: HTMLElement = within(row!).getByTestId(
    "infrastructure-last-seen",
  );

  return {
    cell: lastSeen.closest("td") as HTMLElement,
    status: within(lastSeen).getByTestId("infrastructure-last-seen-status"),
    age: within(lastSeen).queryByTestId("infrastructure-last-seen-age"),
  };
}

// The line an element is drawn on: the element itself or its line's box.
function lineOf(element: HTMLElement, lastSeen: HTMLElement): HTMLElement {
  let line: HTMLElement = element;

  while (line.parentElement && line.parentElement !== lastSeen) {
    line = line.parentElement;
  }

  return line;
}

function expectWholeLines(lastSeen: LastSeen): void {
  const box: HTMLElement = lastSeen.cell.querySelector(
    '[data-testid="infrastructure-last-seen"]',
  ) as HTMLElement;
  const statusLine: HTMLElement = lineOf(lastSeen.status, box);

  // The cell may wrap between the lines; each line never wraps inside.
  expect(lastSeen.cell).not.toHaveClass("whitespace-nowrap");
  expect(statusLine).toHaveClass("whitespace-nowrap");

  if (lastSeen.age) {
    const ageLine: HTMLElement = lineOf(lastSeen.age, box);

    expect(ageLine).toHaveClass("whitespace-nowrap");
    // Two lines, one under the other: two blocks of the cell's box.
    expect(ageLine).not.toBe(statusLine);
    expect(Array.from(box.children)).toEqual([statusLine, ageLine]);
    expect(ageLine.tagName).toBe("DIV");
    expect(statusLine.tagName).toBe("DIV");
  } else {
    expect(Array.from(box.children)).toEqual([statusLine]);
  }
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

test("the German row the issue showed: Inaktiv over vor 65 Tagen", () => {
  renderIn("de", explorer(ENTITIES));

  const gone: LastSeen = lastSeenOf("infrastructure-row", "build-server-old");

  expect(gone.status).toHaveTextContent(/^Inaktiv$/);
  expect(withoutIsolateMarks(gone.age!.textContent || "")).toBe("vor 65 Tagen");
  // Not the old one-line sentence.
  expect(gone.cell).not.toHaveTextContent("·");
  expectWholeLines(gone);
});

describe.each(LANGUAGES)("Last seen in %s", (language: string) => {
  test("a resource is its status on one line and how long ago under it", () => {
    renderIn(language, explorer(ENTITIES));

    const gone: LastSeen = lastSeenOf("infrastructure-row", "build-server-old");
    const live: LastSeen = lastSeenOf("infrastructure-row", "web-01");

    expect(gone.status.textContent).toBe(word(language, "Inactive"));
    expect(live.status.textContent).toBe(word(language, "Active"));
    expect(withoutIsolateMarks(gone.age?.textContent || "")).toBe(
      withoutIsolateMarks(
        formatLastSeenInLanguage(SIXTY_FIVE_DAYS_AGO, new Date(), language),
      ),
    );
    expect(withoutIsolateMarks(live.age?.textContent || "")).toBe(
      withoutIsolateMarks(
        formatLastSeenInLanguage(FIVE_MINUTES_AGO, new Date(), language),
      ),
    );
    // 65, in the age's own line - not joined to the status.
    expect(latinDigits(gone.age?.textContent || "")).toContain("65");
    expect(latinDigits(gone.status.textContent || "")).not.toContain("65");
    expectWholeLines(gone);
    expectWholeLines(live);
  });

  test("a resource with no time to tell is its status alone, with no dash under it", () => {
    renderIn(language, explorer(ENTITIES));

    const manual: LastSeen = lastSeenOf("infrastructure-row", "rack-12-pdu");

    expect(manual.status.textContent).toBe(word(language, "Active"));
    expect(manual.age).toBeNull();
    expect(manual.cell).not.toHaveTextContent("—");
    expectWholeLines(manual);
  });
});

/*
 * A collection's page of items (IoT devices the server pages) draws its
 * Last seen with the same two lines.
 */
describe.each(["en", "de", "ru", "ar"])(
  "a collection's items in %s",
  (language: string) => {
    test("each item's Last seen is its status over how long ago", async () => {
      const items: Array<TopologyEntity> = [
        {
          entityKey: "iot-1",
          entityType: EntityType.IoTDevice,
          displayName: "sensor-001",
          lastSeenAt: FIVE_MINUTES_AGO,
          source: EntitySource.Discovered,
        },
        {
          entityKey: "iot-2",
          entityType: EntityType.IoTDevice,
          displayName: "sensor-002",
          lastSeenAt: SIXTY_FIVE_DAYS_AGO,
          source: EntitySource.Discovered,
        },
      ];
      const collectionPage: CollectionPage = {
        rangeStart: RANGE_START,
        entityType: EntityType.IoTDevice,
        total: 2,
        items,
        nextCursor: null,
      };
      mockFetchCollectionPage.mockResolvedValue(collectionPage);

      renderIn(
        language,
        explorer(ENTITIES, {
          collections: [
            {
              entityType: EntityType.IoTDevice,
              total: 2,
              active: 1,
              lastSeenAt: NOW,
              activeLastSeenAt: NOW,
            },
          ],
        }),
      );

      // The collection's row, listed before the plain resources.
      const collectionRow: HTMLElement | undefined = screen
        .getAllByTestId("infrastructure-row")
        .find((row: HTMLElement): boolean => {
          return (row.textContent || "").includes("IoT");
        });

      expect(collectionRow).toBeDefined();
      fireEvent.click(collectionRow!.querySelector("button")!);

      await waitFor(() => {
        expect(
          screen.getAllByTestId("infrastructure-collection-row"),
        ).toHaveLength(2);
      });

      const gone: LastSeen = lastSeenOf(
        "infrastructure-collection-row",
        "sensor-002",
      );
      const live: LastSeen = lastSeenOf(
        "infrastructure-collection-row",
        "sensor-001",
      );

      expect(gone.status.textContent).toBe(word(language, "Inactive"));
      expect(live.status.textContent).toBe(word(language, "Active"));
      expect(withoutIsolateMarks(gone.age?.textContent || "")).toBe(
        withoutIsolateMarks(
          formatLastSeenInLanguage(SIXTY_FIVE_DAYS_AGO, new Date(), language),
        ),
      );
      expectWholeLines(gone);
      expectWholeLines(live);
    });
  },
);
