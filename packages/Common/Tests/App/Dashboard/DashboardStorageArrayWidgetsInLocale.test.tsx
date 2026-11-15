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
  within,
} from "@testing-library/react";
import i18next from "i18next";
import React, { FunctionComponent } from "react";
import { initReactI18next } from "react-i18next";

/*
 * THE STORAGE ARRAY WIDGETS IN THE READER'S LANGUAGE (#7521, #7522).
 *
 * PR #7413 (#7091) worded the hardware list's types, modes and a drive's
 * size in the reader's language. Two things on the same widgets were left:
 *
 *   - #7521: the hardware list's Status column and a tile's Reported Status
 *     drew the array's word as it came ("Degraded", "Not Installed") in a
 *     Persian column; the volume list wrote Used / Provisioned, the
 *     latencies and the IOPS in Latin digits with a decimal point on every
 *     board ("3.5 TiB", "2.35 ms"), and the latency pair was drawn "µs /
 *     ۲٫۳۵ ms ۴۲۰" on a page read from the right;
 *   - #7522: both widgets headed their last column, and a tile's first
 *     row, with the bare "Array", which six languages word as a
 *     programming array: 配列, Matriz, Tableau, 배열, 数组, Matrise.
 *
 * Each widget is drawn here for real, over the Dashboard's shipped
 * locales, in English, German, Arabic and Persian, and in the six
 * languages whose array was a programming one.
 */

type ListRequest = { query: Record<string, unknown>; limit: number };
type ListResponse = { data: Array<Record<string, unknown>>; count: number };

const listMock: Mock<(request: ListRequest) => Promise<ListResponse>> =
  jest.fn<(request: ListRequest) => Promise<ListResponse>>();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
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
        return new ObjectIDType("44444444-4444-4444-8444-444444447521");
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
            return "/dashboard/storage-array";
          },
        };
      },
    },
  };
});

import DashboardStorageArrayHardwareListComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardStorageArrayHardwareListComponent";
import DashboardStorageArrayVolumeListComponentElement from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardStorageArrayVolumeListComponent";
import { HONEYCOMB_TILE_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardResourceHoneycomb";
import {
  getWidgetSortOptions,
  getWidgetSortSettingColumns,
  WidgetSortOption,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/WidgetSortOptions";
import { DashboardBaseComponentProps } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/DashboardBaseComponent";
import { setPublicDashboardContext } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Utils/PublicDashboardContext";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import { DashboardWidgetSortColumns } from "../../../Types/Dashboard/DashboardWidgetSort";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  FIRST_STRONG_ISOLATE,
  POP_DIRECTIONAL_ISOLATE,
} from "../../../Types/ReadingDirection";
import TimeRange from "../../../Types/Time/TimeRange";
import { getInlineSeparator } from "../../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

const COMPONENT_ID: ObjectID = new ObjectID(
  "c0000000-0000-4000-8000-000000007521",
);
const DASHBOARD_ID: string = "d0000000-0000-4000-8000-000000007521";
const ARRAY_ID: string = "a0000000-0000-4000-8000-000000007521";
const ARRAY_NAME: string = "flasharray-eu-west";

const DASHBOARD_VIEW_CONFIG: DashboardViewConfig = {
  _type: ObjectType.DashboardViewConfig,
  components: [],
  heightInDashboardUnits: 12,
};

const TIB: number = 1024 ** 4;

// A Latin digit: what a Persian figure never holds.
const LATIN_DIGIT: RegExp = /[0-9]/;

// The six languages whose bare "Array" was a programming array, and that word.
const PROGRAMMING_ARRAY: Record<string, string> = {
  ja: "配列",
  es: "Matriz",
  fr: "Tableau",
  ko: "배열",
  "zh-CN": "数组",
  no: "Matrise",
};

// What each language heads the column with: its word for a storage array.
const STORAGE_ARRAY_WORD: Record<string, string> = {
  en: "Array",
  de: "Array",
  ar: "المصفوفة",
  fa: "آرایه",
  ja: "アレイ",
  es: "Cabina",
  fr: "Baie",
  ko: "어레이",
  "zh-CN": "阵列",
  no: "Array",
};

const DRAWN_LANGUAGES: ReadonlyArray<string> = Object.keys(STORAGE_ARRAY_WORD);

type StorageWidgetElement = FunctionComponent<
  DashboardBaseComponentProps & { component: DashboardBaseComponent }
>;

const HARDWARE: StorageWidgetElement =
  DashboardStorageArrayHardwareListComponentElement as unknown as StorageWidgetElement;
const VOLUMES: StorageWidgetElement =
  DashboardStorageArrayVolumeListComponentElement as unknown as StorageWidgetElement;

function componentOf(
  type: DashboardComponentType,
  viewMode: "list" | "honeycomb",
): DashboardBaseComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentId: COMPONENT_ID,
    componentType: type,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 8,
    heightInDashboardUnits: 6,
    minWidthInDashboardUnits: 4,
    minHeightInDashboardUnits: 3,
    arguments: { viewMode: viewMode, title: "Storage" },
  } as unknown as DashboardBaseComponent;
}

function propsOf(
  type: DashboardComponentType,
  viewMode: "list" | "honeycomb",
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
    dashboardComponentHeightInPx: 360,
    dashboardComponentWidthInPx: 720,
    dashboardViewConfig: DASHBOARD_VIEW_CONFIG,
    dashboardStartAndEndDate: { range: TimeRange.PAST_ONE_HOUR },
    metricTypes: [],
    refreshTick: 0,
    variables: [],
    dashboardId: DASHBOARD_ID,
    component: componentOf(type, viewMode),
  };
}

function hardwareRow(
  name: string,
  status: string | null,
  overrides: JSONObject = {},
): JSONObject {
  return {
    _id: ObjectID.generate().toString(),
    name: name,
    externalId: name,
    kind: "Drive",
    status: status,
    componentType: "SSD",
    capacityBytes: 3.5 * TIB,
    storageArrayId: ARRAY_ID,
    storageArray: { name: ARRAY_NAME },
    lastSeenAt: new Date("2026-11-12T10:00:00.000Z"),
    ...overrides,
  };
}

const VOLUME_NAME: string = "vg-prod/db-data-01";

function volumeRow(): JSONObject {
  return {
    _id: ObjectID.generate().toString(),
    name: VOLUME_NAME,
    externalId: VOLUME_NAME,
    kind: "Volume",
    groupName: "vg-prod",
    usedBytes: 3.5 * TIB,
    capacityBytes: 10 * TIB,
    readLatencyUsec: 420,
    writeLatencyUsec: 2345,
    readIops: 1234,
    writeIops: 300,
    storageArrayId: ARRAY_ID,
    storageArray: { name: ARRAY_NAME },
    lastSeenAt: new Date("2026-11-12T10:00:00.000Z"),
  };
}

const HARDWARE_ROWS: Array<JSONObject> = [
  hardwareRow("SH9.BAY3", "degraded"),
  hardwareRow("SH9.BAY4", "not_installed"),
  hardwareRow("CT0.FAN1", "flux_capacitor", {
    kind: "Hardware",
    componentType: "fan",
  }),
];

async function speak(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

function word(english: string, language: string): string {
  if (language === "en") {
    return english;
  }

  const words: string | undefined = readDashboardLocale(language)[english];

  expect({ language, english, worded: Boolean(words) }).toEqual({
    language,
    english,
    worded: true,
  });

  return words as string;
}

async function draw(
  element: StorageWidgetElement,
  type: DashboardComponentType,
  viewMode: "list" | "honeycomb",
): Promise<RenderResult> {
  const Element: StorageWidgetElement = element;
  const result: RenderResult = render(<Element {...propsOf(type, viewMode)} />);

  await waitFor(() => {
    expect(listMock).toHaveBeenCalled();
    expect(
      result.container.querySelectorAll(
        viewMode === "list"
          ? "tbody tr"
          : `[data-testid="${HONEYCOMB_TILE_TEST_ID}"]`,
      ).length,
    ).toBeGreaterThan(0);
  });

  return result;
}

function headers(container: HTMLElement): Array<string> {
  return Array.from(container.querySelectorAll("thead th")).map(
    (cell: Element): string => {
      return (cell.textContent || "").trim();
    },
  );
}

function rowOf(container: HTMLElement, name: string): HTMLElement {
  const row: HTMLElement | undefined = Array.from(
    container.querySelectorAll<HTMLElement>("tbody tr"),
  ).find((candidate: HTMLElement): boolean => {
    return (candidate.querySelector("td")?.textContent || "").trim() === name;
  });

  expect({ name, found: Boolean(row) }).toEqual({ name, found: true });

  return row as HTMLElement;
}

function cellsOf(row: HTMLElement): Array<string> {
  return Array.from(row.querySelectorAll("td")).map((cell: Element): string => {
    return cell.textContent || "";
  });
}

/*
 * The storage lists watch their width; jsdom has no ResizeObserver, and
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
  });
});

beforeEach(async () => {
  listMock.mockReset();
  listMock.mockImplementation(
    async (request: ListRequest): Promise<ListResponse> => {
      const rows: Array<JSONObject> =
        request.query["kind"] === "Volume" ? [volumeRow()] : HARDWARE_ROWS;

      return { data: rows, count: rows.length };
    },
  );
  window.localStorage.clear();
  setPublicDashboardContext(null);
  await speak("en");
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  setPublicDashboardContext(null);
});

afterAll(() => {
  (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    ORIGINAL_RESIZE_OBSERVER;
});

describe("#7522: the column a component's or a volume's array is in", () => {
  test.each(
    DRAWN_LANGUAGES.flatMap((language: string) => {
      return [
        ["hardware list", language],
        ["volume list", language],
      ];
    }),
  )(
    "the %s, in %s, heads it with the language's storage array",
    async (list: string, language: string) => {
      await speak(language);

      const result: RenderResult =
        list === "hardware list"
          ? await draw(
              HARDWARE,
              DashboardComponentType.StorageArrayHardwareList,
              "list",
            )
          : await draw(
              VOLUMES,
              DashboardComponentType.StorageArrayVolumeList,
              "list",
            );

      const columns: Array<string> = headers(result.container);
      const last: string = columns[columns.length - 1] as string;

      expect({ language, last }).toEqual({
        language,
        last: STORAGE_ARRAY_WORD[language],
      });

      // Never the programming array, nor the key's own words.
      if (PROGRAMMING_ARRAY[language]) {
        expect(headers(result.container)).not.toContain(
          PROGRAMMING_ARRAY[language],
        );
      }
      expect(result.container.textContent).not.toContain("storage array)");

      // The array's name is in its column, as written.
      expect(
        result.container.querySelector("tbody tr td:last-child")?.textContent,
      ).toBe(ARRAY_NAME);
    },
  );

  test("a hardware tile's first row names the array in the reader's word too", async () => {
    await speak("ja");

    const result: RenderResult = await draw(
      HARDWARE,
      DashboardComponentType.StorageArrayHardwareList,
      "honeycomb",
    );
    const tiles: Array<HTMLElement> = within(result.container).getAllByTestId(
      HONEYCOMB_TILE_TEST_ID,
    );

    fireEvent.mouseEnter(tiles[0]!);

    const tooltip: HTMLElement = await screen.findByRole("tooltip");

    expect(tooltip).toHaveTextContent("アレイ");
    expect(tooltip).toHaveTextContent(ARRAY_NAME);
    expect(tooltip.textContent).not.toContain("配列");
  });

  test("the Sort setting names the column as its header does", () => {
    for (const [type, language, expected] of [
      [DashboardComponentType.StorageArrayHardwareList, "en", "Array"],
      [DashboardComponentType.StorageArrayVolumeList, "en", "Array"],
      [DashboardComponentType.StorageArrayHardwareList, "ja", "アレイ"],
      [DashboardComponentType.StorageArrayVolumeList, "fr", "Baie"],
    ] as Array<[DashboardComponentType, string, string]>) {
      const columns: DashboardWidgetSortColumns | null =
        getWidgetSortSettingColumns(type, null);

      expect(columns).not.toBeNull();

      const labels: Array<string> = getWidgetSortOptions({
        columns: columns!.columns,
        builtInSort: columns!.builtInSort,
        savedSort: "",
        translator: dashboardTranslator(language),
      }).map((option: WidgetSortOption): string => {
        return option.label;
      });

      expect({
        type,
        language,
        named: labels.some((label: string): boolean => {
          return label.includes(expected);
        }),
      }).toEqual({ type, language, named: true });

      for (const label of labels) {
        expect(label).not.toContain("storage array)");
        if (PROGRAMMING_ARRAY[language]) {
          expect(label).not.toContain(PROGRAMMING_ARRAY[language]);
        }
      }
    }
  });
});

describe("#7521: a component's status in the reader's words", () => {
  test.each(
    DRAWN_LANGUAGES.map((language: string) => {
      return [language];
    }),
  )(
    "in %s: a status the pages know is the reader's word, one they do not is the array's",
    async (language: string) => {
      await speak(language);

      const result: RenderResult = await draw(
        HARDWARE,
        DashboardComponentType.StorageArrayHardwareList,
        "list",
      );

      // Component, Type, Status, Detail, Array.
      expect(cellsOf(rowOf(result.container, "SH9.BAY3"))[2]).toBe(
        word("Degraded", language),
      );
      expect(cellsOf(rowOf(result.container, "SH9.BAY4"))[2]).toBe(
        word("Not Installed", language),
      );
      expect(cellsOf(rowOf(result.container, "CT0.FAN1"))[2]).toBe(
        "Flux Capacitor",
      );
    },
  );

  test("a German and a Persian board say it in their words, never the array's English", async () => {
    await speak("de");
    let result: RenderResult = await draw(
      HARDWARE,
      DashboardComponentType.StorageArrayHardwareList,
      "list",
    );

    expect(cellsOf(rowOf(result.container, "SH9.BAY3"))[2]).toBe(
      "Beeinträchtigt",
    );
    expect(result.container.textContent).not.toContain("Degraded");
    cleanup();

    await speak("fa");
    result = await draw(
      HARDWARE,
      DashboardComponentType.StorageArrayHardwareList,
      "list",
    );

    expect(cellsOf(rowOf(result.container, "SH9.BAY3"))[2]).toBe("کاهش کارایی");
    expect(cellsOf(rowOf(result.container, "SH9.BAY4"))[2]).toBe("نصب‌نشده");
    // A drive's size beside it, in Persian digits as before.
    expect(cellsOf(rowOf(result.container, "SH9.BAY3"))[3]).toBe("۳٫۵ TiB");
  });

  test("a tile's Reported Status is the reader's word", async () => {
    await speak("de");

    const result: RenderResult = await draw(
      HARDWARE,
      DashboardComponentType.StorageArrayHardwareList,
      "honeycomb",
    );
    const tiles: Array<HTMLElement> = within(result.container).getAllByTestId(
      HONEYCOMB_TILE_TEST_ID,
    );
    const degraded: HTMLElement | undefined = tiles.find(
      (tile: HTMLElement): boolean => {
        return (tile.getAttribute("aria-label") || "").includes("SH9.BAY3");
      },
    );

    fireEvent.mouseEnter(degraded || tiles[0]!);

    const tooltip: HTMLElement = await screen.findByRole("tooltip");

    expect(tooltip).toHaveTextContent("Gemeldeter Status");
    expect(tooltip).toHaveTextContent("Beeinträchtigt");
    expect(tooltip.textContent).not.toContain("Degraded");
  });
});

describe("#7521: a volume's sizes, latencies and IOPS in the reader's digits", () => {
  const apart: (text: string) => string = (text: string): string => {
    return `${FIRST_STRONG_ISOLATE}${text}${POP_DIRECTIONAL_ISOLATE}`;
  };

  test.each([
    [
      "en",
      "3.5 TiB of 10.0 TiB",
      "420 µs / 2.35 ms",
      "1.5K",
      "Read 1.2K · Write 300",
    ],
    [
      "de",
      "3,5 TiB von 10,0 TiB",
      "420 µs / 2,35 ms",
      "1,5K",
      "Lesen 1,2K · Schreiben 300",
    ],
    [
      "ar",
      "3.5 TiB من 10.0 TiB",
      `${apart("420 µs")} / ${apart("2.35 ملي ث")}`,
      "1.5K",
      "القراءة 1.2K · الكتابة 300",
    ],
    [
      "fa",
      "۳٫۵ TiB از ۱۰٫۰ TiB",
      `${apart("۴۲۰ µs")} / ${apart("۲٫۳۵ میلی‌ثانیه")}`,
      "۱٫۵K",
      `خواندن ۱٫۲K${getInlineSeparator("fa")}نوشتن ۳۰۰`,
    ],
  ])(
    "in %s",
    async (
      language: string,
      space: string,
      latency: string,
      iops: string,
      iopsTitle: string,
    ) => {
      await speak(language);

      const result: RenderResult = await draw(
        VOLUMES,
        DashboardComponentType.StorageArrayVolumeList,
        "list",
      );
      const row: HTMLElement = rowOf(result.container, VOLUME_NAME);
      const cells: Array<string> = cellsOf(row);

      // Volume, Used / Provisioned, Latency (R / W), IOPS, Array.
      expect(cells[1]).toBe(space);
      expect(cells[2]).toBe(latency);
      expect(cells[3]).toBe(iops);
      expect(row.querySelectorAll("td")[3]).toHaveAttribute("title", iopsTitle);

      if (language === "fa") {
        for (const cell of cells.slice(1, 4)) {
          expect({ cell, latin: LATIN_DIGIT.test(cell) }).toEqual({
            cell,
            latin: false,
          });
        }
      }

      // Its headers in the reader's words.
      expect(headers(result.container).slice(1, 3)).toEqual([
        word("Used / Provisioned", language),
        word("Latency (R / W)", language),
      ]);
    },
  );

  test("a volume tile's details are in the reader's digits too", async () => {
    await speak("fa");

    const result: RenderResult = await draw(
      VOLUMES,
      DashboardComponentType.StorageArrayVolumeList,
      "honeycomb",
    );

    fireEvent.mouseEnter(
      within(result.container).getAllByTestId(HONEYCOMB_TILE_TEST_ID)[0]!,
    );

    const tooltip: HTMLElement = await screen.findByRole("tooltip");

    for (const figure of [
      "۳٫۵ TiB از ۱۰٫۰ TiB",
      "۴۲۰ µs",
      // The Dashboard's duration, in Persian's own unit (#7418).
      "۲٫۳۵ میلی‌ثانیه",
      "۱٫۲K",
      "۳۰۰",
    ]) {
      expect(tooltip).toHaveTextContent(figure);
    }
    expect(tooltip).toHaveTextContent(word("Array (storage array)", "fa"));
  });
});
