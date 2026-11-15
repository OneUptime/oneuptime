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
import { Translator } from "../../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * THE HOST LIST WIDGET'S LAST SEEN AND CPU / MEMORY, IN THE READER'S
 * LANGUAGE (#7519).
 *
 * The Host list wrote two cells in English shorthand of its own on every
 * board: Last Seen as "5m ago" and CPU / Memory as "8c / 32.0 GB", with
 * Latin digits and an English decimal point on a German or Persian board.
 * And on an Arabic or Persian board, a CPU / Memory cell too long for its
 * column lost its start ("… / 64.0 GB"): the cell lined up right to left
 * while its text read left to right.
 *
 * Both are the reader's now - "vor 5 Min." and "8 Kerne / 32,0 GB" in
 * German, "۵ دقیقه پیش" and "۸ هسته / ۳۲٫۰ GB" in Persian - and the CPU /
 * Memory cell reads the way its words do, so it is cut at its own end. The
 * Docker and Podman host lists' tiles ("3 running / 1 stopped") and the
 * container lists' CPU and memory cells follow. English reads as it did.
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

import DashboardHostListComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardHostListComponent";
import DashboardDockerHostListComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardDockerHostListComponent";
import DashboardPodmanHostListComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardPodmanHostListComponent";
import DashboardDockerContainerListComponentElement, {
  formatBytes as formatDockerContainerBytes,
  formatCpuPercent as formatDockerContainerCpu,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardDockerContainerListComponent";
import DashboardPodmanContainerListComponentElement, {
  formatBytes as formatPodmanContainerBytes,
  formatCpuPercent as formatPodmanContainerCpu,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardPodmanContainerListComponent";
import {
  formatHostContainerCounts,
  formatHostCpuMemory,
  formatHostLastSeen,
  formatHostListBytes,
  getHostLastSeenAmount,
  HostLastSeenAmount,
  NO_HOST_FIGURE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/HostListFigures";

const NBSP: string = String.fromCharCode(0xa0);
const LATIN_DIGIT: RegExp = /[0-9]/;
// A count followed by English's letter for cores: "8c".
const BARE_CORES: RegExp = /\d\s?c(?!\p{L})/u;
// English's word and its shorthand for a time behind now: "5m ago".
const ENGLISH_AGO: RegExp = /\bago\b/;
const ENGLISH_SHORTHAND: RegExp = /^\d+[smhd] ago$/;
const GIB: number = 1024 ** 3;
const NOW: Date = new Date("2026-11-15T12:00:00.000Z");

const COMPONENT_ID: ObjectID = new ObjectID(
  "c0000000-0000-4000-8000-000000007519",
);
const DASHBOARD_ID: string = "d0000000-0000-4000-8000-000000007519";

const DASHBOARD_VIEW_CONFIG: DashboardViewConfig = {
  _type: ObjectType.DashboardViewConfig,
  components: [],
  heightInDashboardUnits: 12,
};

function secondsBefore(seconds: number, now: Date = NOW): Date {
  return new Date(now.getTime() - seconds * 1000);
}

async function inLanguage(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

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

describe("Last Seen, counted as it always was", () => {
  test.each([
    [0, { count: 0, unit: "second" }],
    [12, { count: 12, unit: "second" }],
    [59, { count: 59, unit: "second" }],
    [60, { count: 1, unit: "minute" }],
    [5 * 60 + 59, { count: 5, unit: "minute" }],
    [59 * 60 + 59, { count: 59, unit: "minute" }],
    [60 * 60, { count: 1, unit: "hour" }],
    [23 * 3600 + 3599, { count: 23, unit: "hour" }],
    [24 * 3600, { count: 1, unit: "day" }],
    [2 * 86400 + 3600, { count: 2, unit: "day" }],
    [400 * 86400, { count: 400, unit: "day" }],
  ] as Array<[number, HostLastSeenAmount]>)(
    "%d seconds before now: %j",
    (seconds: number, expected: HostLastSeenAmount) => {
      expect(getHostLastSeenAmount(secondsBefore(seconds), NOW)).toEqual(
        expected,
      );
    },
  );

  test("a time ahead of now - a host's clock running fast - is 0 seconds", () => {
    expect(getHostLastSeenAmount(secondsBefore(-90), NOW)).toEqual({
      count: 0,
      unit: "second",
    });
  });
});

describe("Last Seen, in the reader's language", () => {
  const AMOUNTS: ReadonlyArray<number> = [12, 5 * 60, 4 * 3600, 2 * 86400];

  function lastSeen(language: string, seconds: number): string {
    return formatHostLastSeen(
      secondsBefore(seconds),
      dashboardTranslator(language),
      NOW,
    );
  }

  test("in English, word for word as it always read", () => {
    expect(
      AMOUNTS.map((seconds: number) => {
        return lastSeen("en", seconds);
      }),
    ).toEqual(["12s ago", "5m ago", "4h ago", "2d ago"]);
    expect(lastSeen("en", 0)).toBe("0s ago");
  });

  test("in German, as Intl shortens it to fit the column", () => {
    expect(
      AMOUNTS.map((seconds: number) => {
        return lastSeen("de", seconds);
      }),
    ).toEqual(["vor 12\u00A0Sek.", "vor 5\u00A0Min.", "vor 4\u00A0Std.", "vor 2\u00A0Tagen"]);
    // Just now is the past too, never "in 0 Sek.".
    expect(lastSeen("de", 0)).toBe("vor 0\u00A0Sek.");
  });

  test("in Persian, in Persian digits; in Arabic, in its words and Latin digits", () => {
    expect(lastSeen("fa", 12)).toBe("۱۲\u00A0ثانیه پیش");
    expect(lastSeen("fa", 5 * 60)).toBe("۵\u00A0دقیقه پیش");
    expect(lastSeen("ar", 5 * 60)).toBe("قبل 5\u00A0دقائق");
    expect(lastSeen("ar", 4 * 3600)).toBe("قبل 4\u00A0ساعات");

    for (const seconds of AMOUNTS) {
      expect(lastSeen("fa", seconds)).not.toMatch(LATIN_DIGIT);
    }
  });

  test("no language but English says 'ago', or writes a bare s, m, h or d after the count", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      for (const seconds of AMOUNTS) {
        const written: string = lastSeen(language, seconds);

        expect({ language, written, ago: ENGLISH_AGO.test(written) }).toEqual({
          language,
          written,
          ago: false,
        });
        expect({
          language,
          written,
          english: ENGLISH_SHORTHAND.test(written),
        }).toEqual({ language, written, english: false });
      }
    }
  });

  test("no date, or one that is not a date, is the dash", () => {
    const de: Translator = dashboardTranslator("de");

    expect(formatHostLastSeen(undefined, de, NOW)).toBe(NO_HOST_FIGURE);
    expect(formatHostLastSeen(null, de, NOW)).toBe(NO_HOST_FIGURE);
    expect(formatHostLastSeen(new Date("not a date"), de, NOW)).toBe(
      NO_HOST_FIGURE,
    );
  });

  test("an English variant reads as English does", () => {
    expect(
      formatHostLastSeen(
        secondsBefore(300),
        { ...dashboardTranslator("en"), language: "en-GB" },
        NOW,
      ),
    ).toBe("5m ago");
  });
});

describe("CPU / Memory, in the reader's language", () => {
  test("memory: in English as toFixed wrote it, in German and Persian their way", () => {
    expect(formatHostListBytes(32 * GIB, dashboardTranslator("en"))).toBe(
      "32.0\u00A0GB",
    );
    expect(
      formatHostListBytes(512 * 1024 ** 2, dashboardTranslator("en")),
    ).toBe("512\u00A0MB");
    expect(formatHostListBytes(32 * GIB, dashboardTranslator("de"))).toBe(
      "32,0\u00A0GB",
    );
    expect(formatHostListBytes(32 * GIB, dashboardTranslator("fa"))).toBe(
      "۳۲٫۰\u00A0GB",
    );
    expect(formatHostListBytes(32 * GIB, dashboardTranslator("ar"))).toBe(
      "32.0\u00A0GB",
    );
  });

  test("plain bytes are whole, and no memory is the dash", () => {
    const english: Translator = dashboardTranslator("en");

    for (const bytes of [1, 5, 9, 42, 512, 999]) {
      expect(formatHostListBytes(bytes, english)).toBe(`${bytes}\u00A0B`);
    }

    expect(formatHostListBytes(0, english)).toBe(NO_HOST_FIGURE);
    expect(formatHostListBytes(-1, english)).toBe(NO_HOST_FIGURE);
    expect(formatHostListBytes(undefined, english)).toBe(NO_HOST_FIGURE);
  });

  test("in English, word for word as it always read", () => {
    const english: Translator = dashboardTranslator("en");

    expect(formatHostCpuMemory(8, 32 * GIB, english)).toBe("8c / 32.0\u00A0GB");
    expect(formatHostCpuMemory(1, 512 * 1024 ** 2, english)).toBe(
      "1c / 512\u00A0MB",
    );
    expect(formatHostCpuMemory(undefined, 64 * GIB, english)).toBe(
      "— / 64.0\u00A0GB",
    );
    expect(formatHostCpuMemory(16, 0, english)).toBe("16c / —");
    expect(formatHostCpuMemory(0, 0, english)).toBe("—");
    expect(formatHostCpuMemory(undefined, undefined, english)).toBe("—");
  });

  test("in German: the cores in their plural form, the memory in German figures", () => {
    const de: Translator = dashboardTranslator("de");

    expect(formatHostCpuMemory(8, 32 * GIB, de)).toBe("8 Kerne / 32,0\u00A0GB");
    expect(formatHostCpuMemory(1, 32 * GIB, de)).toBe("1 Kern / 32,0\u00A0GB");
  });

  test("in Persian and Arabic", () => {
    expect(formatHostCpuMemory(8, 32 * GIB, dashboardTranslator("fa"))).toBe(
      "۸ هسته / ۳۲٫۰\u00A0GB",
    );
    expect(formatHostCpuMemory(8, 32 * GIB, dashboardTranslator("ar"))).toBe(
      "8 من الأنوية / 32.0\u00A0GB",
    );
    expect(formatHostCpuMemory(1, 32 * GIB, dashboardTranslator("ar"))).toBe(
      "1 نواة / 32.0\u00A0GB",
    );
  });

  test("no language but English writes a bare c after the count", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      for (const cores of [1, 2, 8, 21]) {
        const written: string = formatHostCpuMemory(
          cores,
          32 * GIB,
          dashboardTranslator(language),
        );

        expect({ language, written, bare: BARE_CORES.test(written) }).toEqual({
          language,
          written,
          bare: false,
        });
      }
    }
  });

  test("its sentence is worded in every Dashboard language", () => {
    for (const key of [
      "{{count}}c / {{memory}}",
      "{{count}}c / {{memory}}_one",
      "{{running}} running / {{stopped}} stopped",
      "CPU / Mem",
      "Last Seen",
    ]) {
      for (const language of DASHBOARD_LANGUAGES) {
        expect({
          key,
          language,
          worded: isWordedInDashboardLocale(key, language),
        }).toEqual({ key, language, worded: true });
      }
    }

    // Negative control: a key no locale words.
    expect(isWordedInDashboardLocale("{{count}}x / {{memory}}", "de")).toBe(
      false,
    );
  });
});

describe("a container host's tile, and a container's figures", () => {
  test("running and stopped, in English as it always read, and the reader's way", () => {
    expect(formatHostContainerCounts(3, 1, dashboardTranslator("en"))).toBe(
      "3 running / 1 stopped",
    );
    expect(formatHostContainerCounts(3, 1, dashboardTranslator("de"))).toBe(
      "3 laufend / 1 gestoppt",
    );
    expect(formatHostContainerCounts(1234, 0, dashboardTranslator("de"))).toBe(
      "1.234 laufend / 0 gestoppt",
    );
    expect(formatHostContainerCounts(3, 1, dashboardTranslator("fa"))).toBe(
      "۳ در حال اجرا / ۱ متوقف",
    );
  });

  test.each([
    ["Docker", formatDockerContainerBytes, formatDockerContainerCpu],
    ["Podman", formatPodmanContainerBytes, formatPodmanContainerCpu],
  ])(
    "the %s container list's memory and CPU, in the reader's figures",
    (
      _kind: string,
      formatBytes: (bytes: number, translator?: Translator) => string,
      formatCpu: (percent: number | null, translator?: Translator) => string,
    ) => {
      expect(formatBytes(1.25 * GIB, dashboardTranslator("en"))).toBe(
        "1.25\u00A0GiB",
      );
      expect(formatBytes(1.25 * GIB)).toBe("1.25\u00A0GiB");
      expect(formatBytes(1.25 * GIB, dashboardTranslator("de"))).toBe(
        "1,25\u00A0GiB",
      );
      expect(formatBytes(1.25 * GIB, dashboardTranslator("fa"))).toBe(
        "۱٫۲۵\u00A0GiB",
      );
      expect(formatBytes(512, dashboardTranslator("fa"))).toBe("۵۱۲\u00A0B");
      expect(formatCpu(12.5, dashboardTranslator("en"))).toBe("12.5%");
      expect(formatCpu(12.5, dashboardTranslator("de"))).toBe(`12,5${NBSP}%`);
      expect(formatCpu(12.5, dashboardTranslator("fa"))).toBe("۱۲٫۵٪");
      expect(formatCpu(null, dashboardTranslator("de"))).toBe("—");
      expect(formatCpu(Number.NaN, dashboardTranslator("de"))).toBe("—");
    },
  );
});

type WidgetElement = FunctionComponent<
  DashboardBaseComponentProps & { component: DashboardBaseComponent }
>;

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
      // A list never writes back through this.
    },
    totalCurrentDashboardWidthInPx: 1280,
    dashboardCanvasTopInPx: 0,
    dashboardCanvasLeftInPx: 0,
    dashboardCanvasWidthInPx: 1280,
    dashboardCanvasHeightInPx: 800,
    dashboardComponentHeightInPx: 320,
    dashboardComponentWidthInPx: 320,
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
      widthInDashboardUnits: 4,
      heightInDashboardUnits: 4,
      minWidthInDashboardUnits: 4,
      minHeightInDashboardUnits: 3,
      arguments: { title: "Fleet", ...widgetArguments },
    } as unknown as DashboardBaseComponent,
  };
}

const HOST_WITH_CORES: string = "ip-10-0-12-34.eu-west-1.compute.internal";
const HOST_WITHOUT_CORES: string = "ip-10-0-12-35.eu-west-1.compute.internal";

// Two hosts: one that reported its cores and memory, one only its memory.
function hostsAre(): void {
  const seenAt: Date = new Date(Date.now() - (5 * 60 + 10) * 1000);

  listMock.mockResolvedValue({
    data: [
      {
        _id: ObjectID.generate().toString(),
        name: HOST_WITH_CORES,
        otelCollectorStatus: "connected",
        osType: "linux",
        osVersion: "6.8.0-124-generic",
        cpuCores: 16,
        totalMemoryBytes: 64 * GIB,
        lastSeenAt: seenAt,
        containersRunning: 3,
        containersStopped: 1,
      },
      {
        _id: ObjectID.generate().toString(),
        name: HOST_WITHOUT_CORES,
        otelCollectorStatus: "connected",
        osType: "linux",
        totalMemoryBytes: 64 * GIB,
        lastSeenAt: seenAt,
        containersRunning: 0,
        containersStopped: 2,
      },
    ],
    count: 2,
  });
}

async function drawList(
  element: WidgetElement,
  type: DashboardComponentType,
  viewMode: "list" | "honeycomb" = "list",
): Promise<RenderResult> {
  const Element: WidgetElement = element;
  const result: RenderResult = render(
    <Element {...propsOf(type, { viewMode: viewMode })} />,
  );

  await waitFor(() => {
    expect(
      viewMode === "list"
        ? result.container.querySelectorAll("tbody tr").length
        : result.container.querySelectorAll("div.select-none").length,
    ).toBe(2);
  });

  return result;
}

function rowOf(container: HTMLElement, name: string): Array<HTMLElement> {
  const row: HTMLElement | undefined = Array.from(
    container.querySelectorAll<HTMLElement>("tbody tr"),
  ).find((candidate: HTMLElement): boolean => {
    return (candidate.textContent || "").includes(name);
  });

  expect(row).toBeDefined();

  return Array.from((row as HTMLElement).querySelectorAll<HTMLElement>("td"));
}

// The Host list's row: Host, Status, OS, CPU / Mem, Last Seen.
function cpuMemoryCell(container: HTMLElement, name: string): HTMLElement {
  return rowOf(container, name)[3] as HTMLElement;
}

function lastSeenCell(container: HTMLElement, name: string): HTMLElement {
  return rowOf(container, name)[4] as HTMLElement;
}

function hoverTile(container: HTMLElement, index: number): HTMLElement {
  fireEvent.mouseEnter(container.querySelectorAll("div.select-none")[index]!);

  return document.querySelector("div.fixed.z-50") as HTMLElement;
}

describe("the Host list widget, drawn", () => {
  test("on an English board its cells read as they always did", async () => {
    hostsAre();

    const { container } = await drawList(
      DashboardHostListComponentElement as unknown as WidgetElement,
      DashboardComponentType.HostList,
    );

    expect(cpuMemoryCell(container, HOST_WITH_CORES).textContent).toBe(
      "16c / 64.0\u00A0GB",
    );
    expect(cpuMemoryCell(container, HOST_WITHOUT_CORES).textContent).toBe(
      "— / 64.0\u00A0GB",
    );
    expect(lastSeenCell(container, HOST_WITH_CORES).textContent).toBe("5m ago");
    // Its instant, one hover away, as before.
    expect(lastSeenCell(container, HOST_WITH_CORES).title).not.toBe("");
  });

  test.each([
    ["de", "16 Kerne / 64,0\u00A0GB", "vor 5\u00A0Min."],
    ["fa", "۱۶ هسته / ۶۴٫۰\u00A0GB", "۵\u00A0دقیقه پیش"],
    ["ar", "16 من الأنوية / 64.0\u00A0GB", "قبل 5\u00A0دقائق"],
  ])(
    "on a %s board: %s, %s",
    async (language: string, cpuMemory: string, lastSeen: string) => {
      await inLanguage(language);
      hostsAre();

      const { container } = await drawList(
        DashboardHostListComponentElement as unknown as WidgetElement,
        DashboardComponentType.HostList,
      );

      expect(cpuMemoryCell(container, HOST_WITH_CORES).textContent).toBe(
        cpuMemory,
      );
      expect(lastSeenCell(container, HOST_WITH_CORES).textContent).toBe(
        lastSeen,
      );
      expect(container.textContent).not.toMatch(/\bago\b/);
      expect(container.textContent).not.toMatch(BARE_CORES);
    },
  );

  /*
   * On a board read from the right, a cell that reads left to right is
   * isolated, so "— / 64.0 GB" too long for its column is cut at its own
   * end; a cell in the board's own words reads the board's way.
   */
  test.each(["ar", "fa"])(
    "on a %s board the CPU / Memory cell reads the way its words do, cut at its own end",
    async (language: string) => {
      await inLanguage(language);
      hostsAre();

      const { container } = await drawList(
        DashboardHostListComponentElement as unknown as WidgetElement,
        DashboardComponentType.HostList,
      );

      const leftToRight: HTMLElement = cpuMemoryCell(
        container,
        HOST_WITHOUT_CORES,
      );

      expect(leftToRight).toHaveAttribute("dir", "ltr");
      expect(leftToRight).toHaveClass("truncate");
      expect(leftToRight.className).toMatch(/text-end/);

      const inTheBoardsWords: HTMLElement = cpuMemoryCell(
        container,
        HOST_WITH_CORES,
      );

      expect(inTheBoardsWords).not.toHaveAttribute("dir");
      expect(inTheBoardsWords).toHaveClass("truncate");
    },
  );

  test.each(["en", "de"])(
    "on a %s board the CPU / Memory cell is drawn as it was: no dir of its own",
    async (language: string) => {
      await inLanguage(language);
      hostsAre();

      const { container } = await drawList(
        DashboardHostListComponentElement as unknown as WidgetElement,
        DashboardComponentType.HostList,
      );

      for (const name of [HOST_WITH_CORES, HOST_WITHOUT_CORES]) {
        expect(cpuMemoryCell(container, name)).not.toHaveAttribute("dir");
        expect(cpuMemoryCell(container, name)).toHaveClass("truncate");
      }
    },
  );

  test.each([
    ["en", "16c / 64.0 GB", "5m ago"],
    ["de", "16 Kerne / 64,0 GB", "vor 5 Min."],
    ["fa", "۱۶ هسته / ۶۴٫۰ GB", "۵ دقیقه پیش"],
  ])(
    "its honeycomb tile's tooltip on a %s board",
    async (language: string, cpuMemory: string, lastSeen: string) => {
      await inLanguage(language);
      hostsAre();

      const { container } = await drawList(
        DashboardHostListComponentElement as unknown as WidgetElement,
        DashboardComponentType.HostList,
        "honeycomb",
      );
      const tooltip: HTMLElement = hoverTile(container, 0);

      expect(tooltip).toHaveTextContent(cpuMemory);
      expect(tooltip).toHaveTextContent(lastSeen);
    },
  );

  test("the list follows the reader when they change language", async () => {
    hostsAre();

    const { container } = await drawList(
      DashboardHostListComponentElement as unknown as WidgetElement,
      DashboardComponentType.HostList,
    );

    expect(lastSeenCell(container, HOST_WITH_CORES).textContent).toBe("5m ago");

    await inLanguage("de");

    expect(lastSeenCell(container, HOST_WITH_CORES).textContent).toBe(
      "vor 5\u00A0Min.",
    );
    expect(cpuMemoryCell(container, HOST_WITH_CORES).textContent).toBe(
      "16 Kerne / 64,0\u00A0GB",
    );
  });
});

describe("the Docker and Podman host lists' tiles", () => {
  test.each([
    [
      "Docker",
      DashboardDockerHostListComponentElement,
      DashboardComponentType.DockerHostList,
    ],
    [
      "Podman",
      DashboardPodmanHostListComponentElement,
      DashboardComponentType.PodmanHostList,
    ],
  ])(
    "the %s host list's tile counts its containers in the reader's words",
    async (_kind: string, element: unknown, type: DashboardComponentType) => {
      hostsAre();

      const english: RenderResult = await drawList(
        element as WidgetElement,
        type,
        "honeycomb",
      );

      expect(hoverTile(english.container, 0)).toHaveTextContent(
        "3 running / 1 stopped",
      );
      cleanup();

      await inLanguage("de");
      hostsAre();

      const german: RenderResult = await drawList(
        element as WidgetElement,
        type,
        "honeycomb",
      );
      const tooltip: HTMLElement = hoverTile(german.container, 0);

      expect(tooltip).toHaveTextContent("3 laufend / 1 gestoppt");
      expect(tooltip).not.toHaveTextContent("running");
    },
  );
});

describe("the Docker and Podman container lists' CPU and memory cells", () => {
  test.each([
    [
      "Docker",
      DashboardDockerContainerListComponentElement,
      DashboardComponentType.DockerContainerList,
    ],
    [
      "Podman",
      DashboardPodmanContainerListComponentElement,
      DashboardComponentType.PodmanContainerList,
    ],
  ])(
    "the %s container list writes them in the reader's figures",
    async (_kind: string, element: unknown, type: DashboardComponentType) => {
      await inLanguage("de");
      listMock.mockResolvedValue({
        data: ["checkout-api", "search-api"].map((name: string) => {
          return {
            _id: ObjectID.generate().toString(),
            name: name,
            imageName: "registry.example.com/shop/checkout:1.4.2",
            state: "running",
            latestCpuPercent: 12.5,
            latestMemoryBytes: 1.25 * GIB,
          };
        }),
        count: 2,
      });

      const { container } = await drawList(element as WidgetElement, type);
      const cells: Array<string> = Array.from(
        container.querySelectorAll("tbody td"),
      ).map((cell: Element): string => {
        return cell.textContent || "";
      });

      expect(cells).toContain(`12,5${NBSP}%`);
      expect(cells).toContain("1,25\u00A0GiB");
      expect(cells).not.toContain("12.5%");
    },
  );
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

  test.each([
    "DashboardHostListComponent.tsx",
    "DashboardDockerHostListComponent.tsx",
    "DashboardPodmanHostListComponent.tsx",
    "DashboardDockerContainerListComponent.tsx",
    "DashboardPodmanContainerListComponent.tsx",
  ])("%s writes no English shorthand of its own", (file: string) => {
    const code: string = withoutComments(
      fs.readFileSync(path.join(COMPONENTS_DIR, file), "utf8"),
    );

    expect(code).not.toMatch(/\}[smhd] ago`/);
    expect(code).not.toMatch(/\}c` :/);
    expect(code).not.toMatch(/\} running \//);
    expect(code).not.toMatch(/toFixed\(1\)\}%/);
  });
});
