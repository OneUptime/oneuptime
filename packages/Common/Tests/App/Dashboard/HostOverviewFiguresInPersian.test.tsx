// UX rule: Docs/ux/README.md#numbers-dates-and-plurals
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
import { act, cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import * as React from "react";
import { initReactI18next } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { settle } from "./HostTooltipHarness";
import { setDateDisplayLanguage } from "../../../Types/DateLanguage";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * A HOST'S OVERVIEW ON A PERSIAN PAGE: NO LATIN DIGIT IN ITS FIGURES
 * (issue #7106).
 *
 * The page is drawn for real with its data layer mocked: a host at 40%
 * CPU, half its 16 GiB of memory, /var 96% full, a load of 1 on four
 * cores and its heartbeats in. Its tiles said "40.0%", "50.0%", "1.00"
 * in Latin digits under sentences in Persian ones ("در ۴ هسته"); every
 * figure a tile, its sentence, the uptime badge and the Filesystems table
 * draw is in Persian digits now. The same page in English is the negative
 * control: its figures read exactly as they did.
 */

const MODEL_ID: string = "84858d6c-1111-4aaa-8bbb-000000000002";
const GIB: number = 1024 * 1024 * 1024;

const LATIN_DIGIT: RegExp = /[0-9]/;

const PERSIAN_DIGIT: RegExp = /[\u06F0-\u06F9]/;

const getItemMock: MockFunction = getJestMockFunction();
const aggregateMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: (...args: Array<unknown>) => {
        return aggregateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (error: unknown) => {
        return String((error as Error)?.message || error);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("84858d6c-1111-4aaa-8bbb-000000000002");
      },
      navigate: () => {},
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

// Recharts has nothing to measure under jsdom; a chart's axes are not under test.
jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return {
    __esModule: true,
    default: () => {
      return <div data-testid="line-chart" />;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceActivity/ResourceActivityCards",
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
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/AutoRefreshControl",
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
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourcePartAlertsCard",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

import HostOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/View/Overview";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";

type Row = {
  timestamp: Date;
  value: number;
  attributes?: Record<string, string>;
};

interface AggregateCall {
  aggregateBy: {
    query: { name: string; attributes: Record<string, string> };
  };
}

function minutesAgo(minutes: number): Date {
  return new Date(Date.now() - minutes * 60_000);
}

function perMinute(
  value: number,
  attributes?: Record<string, string>,
): Array<Row> {
  const rows: Array<Row> = [];

  for (let minute: number = 29; minute >= 0; minute--) {
    rows.push({
      timestamp: minutesAgo(minute),
      value: value,
      ...(attributes ? { attributes } : {}),
    });
  }

  return rows;
}

function mountRows(
  mountpoint: string,
  usedGib: number,
  freeGib: number,
): Array<Row> {
  const attributes: Record<string, string> = {
    mountpoint: mountpoint,
    device: "/dev/nvme0n1p2",
    type: "ext4",
  };

  return [
    ...perMinute(usedGib * GIB, { ...attributes, state: "used" }),
    ...perMinute(freeGib * GIB, { ...attributes, state: "free" }),
  ];
}

// The host's readings, each named by the metric the page asks for.
function hostRows(call: AggregateCall): Array<Row> {
  switch (call.aggregateBy.query.name) {
    case "system.cpu.utilization":
      return perMinute(0.2);
    case "system.memory.utilization":
      return perMinute(0.5);
    case "system.cpu.load_average.1m":
      return perMinute(1);
    case "system.processes.count":
      return perMinute(3);
    case "system.filesystem.usage":
      return [...mountRows("/", 30, 70), ...mountRows("/var", 96, 4)];
    case "oneuptime.host.heartbeat":
      return perMinute(2);
    default:
      return [];
  }
}

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: readDashboardLocale("en") },
      fa: { translation: readDashboardLocale("fa") },
      de: { translation: readDashboardLocale("de") },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  jest.useFakeTimers();
  getItemMock.mockReset();
  aggregateMock.mockReset();
  getItemMock.mockResolvedValue({
    _id: MODEL_ID,
    name: "db-01",
    hostIdentifier: "db-01",
    otelCollectorStatus: "connected",
    lastSeenAt: new Date(),
    cpuCores: 4,
    totalMemoryBytes: 16 * GIB,
    osType: "linux",
  });
  aggregateMock.mockImplementation((call: unknown) => {
    return Promise.resolve({ data: hostRows(call as AggregateCall) });
  });
});

afterEach(async () => {
  cleanup();
  jest.useRealTimers();
  setDateDisplayLanguage("en");
  await act(async () => {
    await i18next.changeLanguage("en");
  });
});

// The page in `language`, as the Dashboard sets it: its words and its dates.
async function renderIn(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
  setDateDisplayLanguage(language);
  render(<HostOverview {...PAGE_PROPS} />);
  await settle();
}

interface DrawnTile {
  value: string;
  sublabel: string;
}

// Each tile's figure and the sentence under it, as drawn.
function drawnTiles(): Array<DrawnTile> {
  return screen
    .getAllByTestId("golden-metric-tile-title")
    .map((title: HTMLElement): DrawnTile => {
      const card: HTMLElement = title.closest("div.rounded-xl") as HTMLElement;
      const value: HTMLElement | null = card.querySelector(".text-2xl");
      const sublabel: HTMLElement | null = card.querySelector(
        '[data-testid="golden-metric-tile-sublabel"]',
      );

      return {
        value: withoutIsolateMarks(value?.textContent || "").trim(),
        // A mount point is the host's own path, as written: never a figure.
        sublabel: sublabel?.querySelector("bdi")
          ? ""
          : withoutIsolateMarks(sublabel?.textContent || "").trim(),
      };
    });
}

// The Filesystems table's use column: "96.0%" a row.
function drawnFilesystemUse(): Array<string> {
  return screen
    .queryAllByTestId("host-filesystem-utilization")
    .map((cell: HTMLElement): string => {
      return withoutIsolateMarks(cell.textContent || "").trim();
    });
}

// Every figure the page drew that should be in the reader's digits.
function drawnFigures(): Array<string> {
  const tiles: Array<DrawnTile> = drawnTiles();
  const figures: Array<string> = [];

  for (const tile of tiles) {
    figures.push(tile.value);

    if (tile.sublabel) {
      figures.push(tile.sublabel);
    }
  }

  return [...figures, ...drawnFilesystemUse()].filter(
    (text: string): boolean => {
      return text !== "" && text !== "—";
    },
  );
}

describe("a host's Overview on a Persian page", () => {
  test("its five tiles have figures, and none of them is in Latin digits", async () => {
    await renderIn("fa");

    const tiles: Array<DrawnTile> = drawnTiles();

    expect(tiles).toHaveLength(5);

    for (const tile of tiles) {
      expect({ tile, persian: PERSIAN_DIGIT.test(tile.value) }).toEqual({
        tile,
        persian: true,
      });
    }

    const latin: Array<string> = drawnFigures().filter(
      (text: string): boolean => {
        return LATIN_DIGIT.test(text);
      },
    );

    expect(latin).toEqual([]);
  });

  test("the tiles read the Persian figures for its CPU, half the memory, /var 96% full and a load of 1", async () => {
    await renderIn("fa");

    const values: Array<string> = drawnTiles().map(
      (tile: DrawnTile): string => {
        return tile.value;
      },
    );

    expect(values).toEqual(["۴۰٫۰٪", "۵۰٫۰٪", "۹۶٫۰٪", "۱٫۰۰", "۳"]);
  });

  test("the Filesystems table writes each mount's use in Persian digits", async () => {
    await renderIn("fa");

    const use: Array<string> = drawnFilesystemUse();

    expect(use.length).toBeGreaterThan(0);
    expect(use).toContain("۹۶٫۰٪");

    for (const cell of use) {
      expect({ cell, latin: LATIN_DIGIT.test(cell) }).toEqual({
        cell,
        latin: false,
      });
    }
  });

  test("the uptime badge's figure is the sentence's: Persian digits and Persian's percent sign", async () => {
    await renderIn("fa");

    const badge: HTMLElement | undefined = screen
      .queryAllByText(/در دسترس/)
      .find((element: HTMLElement): boolean => {
        return (
          element.tagName === "SPAN" &&
          (element.textContent || "").includes("٪")
        );
      });

    expect(badge).toBeDefined();
    expect(LATIN_DIGIT.test(badge?.textContent || "")).toBe(false);
  });
});

// What the host calls itself and its disks: written as the host wrote them.
const NAMES: Array<string> = ["db-01", "ext4", "/dev/nvme0n1p2"];

// Every text the page drew with a Latin digit in it, the host's names left out.
function latinTexts(): Array<string> {
  const walker: TreeWalker = document.createTreeWalker(
    document.body,
    NodeFilter.SHOW_TEXT,
  );
  const found: Array<string> = [];
  let node: Node | null = walker.nextNode();

  while (node) {
    const text: string = withoutIsolateMarks(node.textContent || "").trim();

    if (LATIN_DIGIT.test(text) && !NAMES.includes(text)) {
      found.push(text);
    }

    node = walker.nextNode();
  }

  return found;
}

describe("the whole Persian page", () => {
  test("nothing on it is in Latin digits but the names the host gave its parts", async () => {
    await renderIn("fa");

    expect(latinTexts()).toEqual([]);
  });

  test("the guard has something to find on an English page", async () => {
    await renderIn("en");

    expect(latinTexts()).toContain("40.0%");
  });
});

describe("the same page in English and German (the negative control)", () => {
  test("English reads exactly as before, in Latin digits", async () => {
    await renderIn("en");

    expect(
      drawnTiles().map((tile: DrawnTile): string => {
        return tile.value;
      }),
    ).toEqual(["40.0%", "50.0%", "96.0%", "1.00", "3"]);
    expect(drawnFilesystemUse()).toContain("96.0%");
    expect(
      drawnFigures().some((text: string): boolean => {
        return PERSIAN_DIGIT.test(text);
      }),
    ).toBe(false);
  });

  test("German writes its decimal comma and its percent", async () => {
    await renderIn("de");

    expect(
      drawnTiles().map((tile: DrawnTile): string => {
        return tile.value;
      }),
    ).toEqual(["40,0\u{00A0}%", "50,0\u{00A0}%", "96,0\u{00A0}%", "1,00", "3"]);
  });
});

/*
 * A HOST THAT NEEDS ATTENTION.
 *
 * The host above reports nothing worth a look, so its Needs attention card
 * is empty. A full disk, busy memory and a high load put three reasons on
 * the card, whose figures the rules write as plain "96%" and "9.6": the
 * card drew them as written, "96% پر" under the Filesystem tile's
 * "۹۶٫۰٪". (Details, with the cached process count, is checked on the
 * offline Host pages: E2E/HostPages.)
 */
describe("a host that needs attention, on a Persian page", () => {
  beforeEach(() => {
    getItemMock.mockResolvedValue({
      _id: MODEL_ID,
      name: "db-01",
      hostIdentifier: "db-01",
      otelCollectorStatus: "connected",
      lastSeenAt: new Date(),
      cpuCores: 4,
      totalMemoryBytes: 16 * GIB,
      osType: "linux",
      processCount: 312,
      latestDiskPercent: 96.4,
      latestDiskMountpoint: "/var",
      latestMemoryPercent: 93,
      latestLoadAverage15m: 9.62,
      readingsUpdatedAt: new Date(),
    });
  });

  test("Needs attention's reasons write their figures in Persian digits", async () => {
    await renderIn("fa");

    const reasons: Array<string> = screen
      .getAllByTestId("host-needs-attention-reason")
      .map((reason: HTMLElement): string => {
        return withoutIsolateMarks(reason.textContent || "");
      });

    expect(reasons).toContain("۹۶٪ پر");
    expect(reasons).toContain("۹۳٪ از حافظه استفاده شده");
    expect(reasons).toContain("بار ۱۵ دقیقه‌ای ۹٫۶ روی ۴ هسته");

    for (const reason of reasons) {
      expect({ reason, latin: LATIN_DIGIT.test(reason) }).toEqual({
        reason,
        latin: false,
      });
    }
  });

  test("nothing on the page is in Latin digits but the names the host gave its parts", async () => {
    await renderIn("fa");

    expect(latinTexts()).toEqual([]);
  });

  test("in English the reasons and the count read as the rules wrote them", async () => {
    await renderIn("en");

    const reasons: Array<string> = screen
      .getAllByTestId("host-needs-attention-reason")
      .map((reason: HTMLElement): string => {
        return withoutIsolateMarks(reason.textContent || "");
      });

    expect(reasons).toContain("96% full");
    expect(reasons).toContain("15-minute load 9.6 on 4 cores");
  });
});
