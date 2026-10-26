/** @timezone UTC */

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
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import * as React from "react";
import { initReactI18next } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * An embedded logs list with nothing in it says each thing once, in the
 * reader's language.
 *
 * The empty list is the shared LogsTable's: the title "No logs found", and
 * under it the line the embedding page hands over. About twenty pages
 * handed over a line that said the title again ("No logs found / No logs
 * found for this host. Make sure your OTel collector..."), and the title and
 * the table's own hint were English in twelve of the sixteen languages.
 *
 * Drawn here by the real Dashboard LogsViewer over the real Common one, with
 * the Dashboard's shipped locale files and a mocked data layer that answers
 * an empty window. The App guard LogsEmptyHintsGuard holds every embed's line
 * to the same rule.
 */

const getListMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();
const analyticsCountMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();

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
      count: (...args: Array<any>) => {
        return analyticsCountMock(...args);
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
      getFriendlyMessage: (error: Error) => {
        return error?.message || "error";
      },
      getFriendlyErrorMessage: (error: Error) => {
        return error?.message || "error";
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
        return new ObjectIDType("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

jest.mock("../../../UI/Utils/Realtime", () => {
  return {
    __esModule: true,
    default: {
      listenToAnalyticsModelEvent: () => {
        return () => {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/Telemetry/UseTelemetryEntityNames", () => {
  return {
    __esModule: true,
    default: () => {
      return new Map();
    },
  };
});

jest.mock("recharts", () => {
  const react: typeof React = jest.requireActual("react") as typeof React;

  const chart: (props: {
    children?: React.ReactNode;
  }) => React.ReactElement = (props: {
    children?: React.ReactNode;
  }): React.ReactElement => {
    return react.createElement("div", null, props.children);
  };

  const nothing: () => null = (): null => {
    return null;
  };

  return {
    __esModule: true,
    ResponsiveContainer: (props: { children: React.ReactNode }) => {
      return react.createElement("div", null, props.children);
    },
    AreaChart: chart,
    BarChart: chart,
    Area: nothing,
    Bar: nothing,
    XAxis: nothing,
    YAxis: nothing,
    CartesianGrid: nothing,
    Tooltip: nothing,
    ReferenceArea: nothing,
  };
});

import DashboardLogsViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsViewer";
import {
  LOGS_TABLE_EMPTY_HINT,
  LOGS_TABLE_EMPTY_TITLE,
} from "../../../UI/Components/LogsViewer/components/LogsTable";
import { LOGS_VIEWER_TOOLBAR_TEST_ID } from "../../../UI/Components/LogsViewer/components/LogsViewerToolbar";
import Log from "../../../Models/AnalyticsModels/Log";
import Query from "../../../Types/BaseDatabase/Query";

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

const LANGUAGES: Array<string> = ["de", "it", "ja", "fa"];

// The line a host's Logs tab hands over (Pages/Host/View/Logs.tsx).
const HOST_HINT: string =
  "Make sure your OTel collector forwards logs with the host.name resource attribute.";

// The line a service's Logs tab hands over (Pages/Service/View/Logs.tsx).
const SERVICE_HINT: string =
  "Logs appear here as soon as this service sends them.";

const HOST_QUERY: Query<Log> = {
  attributes: { "resource.host.name": "web-01" },
} as unknown as Query<Log>;

const NOW: Date = new Date("2026-10-26T12:00:00.000Z");

function readLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

const LOCALES: Record<string, Record<string, string>> = {
  en: readLocale("en"),
};

for (const language of LANGUAGES) {
  LOCALES[language] = readLocale(language);
}

async function settle(): Promise<void> {
  for (let round: number = 0; round < 6; round++) {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }
}

async function readIn(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

// The empty block of a list the window left with no line in it.
async function mountEmpty(noLogsMessage: string): Promise<HTMLElement> {
  await act(async () => {
    render(
      <DashboardLogsViewer
        id="embedded-logs"
        logQuery={HOST_QUERY}
        showFilters={true}
        noLogsMessage={noLogsMessage}
      />,
    );
  });
  await waitFor(() => {
    expect(screen.getByTestId(LOGS_VIEWER_TOOLBAR_TEST_ID)).toBeInTheDocument();
  });
  await settle();

  return await screen.findByTestId("logs-table-empty");
}

// Each line of the block, as a reader sees it.
function linesOf(block: HTMLElement): Array<string> {
  return Array.from(block.querySelectorAll("p")).map(
    (line: HTMLParagraphElement): string => {
      return (line.textContent || "").trim();
    },
  );
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const [language, values] of Object.entries(LOCALES)) {
    resources[language] = { translation: values };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: resources,
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  window.history.replaceState({}, "", "/");
  window.localStorage.clear();

  getListMock.mockReset();
  analyticsGetListMock.mockReset();
  analyticsCountMock.mockReset();
  postMock.mockReset();

  getListMock.mockImplementation(async () => {
    return { data: [], count: 0, skip: 0, limit: 0 };
  });
  analyticsGetListMock.mockImplementation(async () => {
    return { data: [], count: 0, skip: 0, limit: 100, hasMore: false };
  });
  analyticsCountMock.mockImplementation(async () => {
    return 0;
  });
  postMock.mockImplementation(async (args: unknown) => {
    const url: string = (
      args as { url: { toString: () => string } }
    ).url.toString();
    if (url.endsWith("/telemetry/logs/histogram")) {
      return { data: { bucketSizeInMinutes: 1, buckets: [] } };
    }
    if (url.endsWith("/telemetry/logs/facets")) {
      return { data: { facets: {} } };
    }
    return { data: {} };
  });
});

afterEach(async () => {
  cleanup();
  jest.useRealTimers();
  await readIn("en");
});

describe("an embedded logs list with nothing in it", () => {
  test("says the title once, then the page's own line", async () => {
    const block: HTMLElement = await mountEmpty(HOST_HINT);

    expect(linesOf(block)).toEqual([LOGS_TABLE_EMPTY_TITLE, HOST_HINT]);
    expect(
      within(block).getAllByText(LOGS_TABLE_EMPTY_TITLE, { exact: false }),
    ).toHaveLength(1);
  });

  test("a service's list says how its logs get here", async () => {
    const block: HTMLElement = await mountEmpty(SERVICE_HINT);

    expect(linesOf(block)).toEqual([LOGS_TABLE_EMPTY_TITLE, SERVICE_HINT]);
  });

  test("a line that only says the title again gives way to the table's hint", async () => {
    const block: HTMLElement = await mountEmpty("No logs found");

    expect(linesOf(block)).toEqual([
      LOGS_TABLE_EMPTY_TITLE,
      LOGS_TABLE_EMPTY_HINT,
    ]);
  });

  for (const language of LANGUAGES) {
    test(`reads wholly in ${language}: the title and the page's line`, async () => {
      await readIn(language);

      const block: HTMLElement = await mountEmpty(HOST_HINT);
      const lines: Array<string> = linesOf(block);
      const words: Record<string, string> = LOCALES[language]!;

      expect(lines).toEqual([words[LOGS_TABLE_EMPTY_TITLE], words[HOST_HINT]]);
      // Translated, not the English shown as a fallback.
      expect(lines[0]).not.toBe(LOGS_TABLE_EMPTY_TITLE);
      expect(lines[1]).not.toBe(HOST_HINT);
    });

    test(`the table's own hint reads in ${language} too`, async () => {
      await readIn(language);

      const block: HTMLElement = await mountEmpty("No logs found");
      const words: Record<string, string> = LOCALES[language]!;

      expect(linesOf(block)).toEqual([
        words[LOGS_TABLE_EMPTY_TITLE],
        words[LOGS_TABLE_EMPTY_HINT],
      ]);
      expect(words[LOGS_TABLE_EMPTY_HINT]).not.toBe(LOGS_TABLE_EMPTY_HINT);
    });
  }
});
