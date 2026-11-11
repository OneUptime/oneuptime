/**
 * @timezone UTC
 */
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
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  drawLine,
  getDrawnText,
  isDrawnAsWritten,
} from "../../Helpers/BidiLayout";

/*
 * THE IOT FLEET OVERVIEW'S DEVICES-ONLINE CHIP IN PERSIAN - from the
 * Dashboard's shipped locale files, the page rendered for real with only
 * the network replaced.
 *
 * The chip beside the fleet's name ("2/3 devices online") was English on a
 * Persian page, and its online count went into the sentence as a plain
 * number while the total, the sentence's {{count}}, is written the reader's
 * way: it read "2/۳". Every other count chip - Proxmox, VMware, Ceph,
 * Docker Swarm, Kubernetes - writes both counts in the reader's digits. The
 * chip now reads "۲/۳ دستگاه آنلاین", drawn from the right with the pair as
 * written.
 */

const FLEET_ID: string = "0193c0de-7777-4aaa-8bbb-000000000007";
const NOW: Date = new Date("2026-09-24T12:00:00.000Z");
const MINUTE: number = 60 * 1000;

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const modelGetItemMock: MockFunction = getJestMockFunction();
const modelGetListMock: MockFunction = getJestMockFunction();
const analyticsAggregateMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return modelGetItemMock(...args);
      },
      getList: (...args: Array<unknown>): unknown => {
        return modelGetListMock(...args);
      },
      count: (): Promise<number> => {
        return Promise.resolve(1);
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: (...args: Array<unknown>): unknown => {
        return analyticsAggregateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("0193c0de-7777-4aaa-8bbb-000000000007");
      },
      getLastParamAsString: (): string => {
        return "dev-b";
      },
      navigate: (): void => {},
      isOnThisPage: (): boolean => {
        return false;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

jest.mock(
  "../../../UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="time-range-picker" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/AutoRefreshControl",
  () => {
    return {
      __esModule: true,
      default: (props: { timeRangePicker?: React.ReactNode }) => {
        return <div>{props.timeRangePicker}</div>;
      },
    };
  },
);

import IoTFleetOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/IoT/View/Index";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * MINUTE);
}

const FLEET: Record<string, unknown> = {
  _id: FLEET_ID,
  name: "field-sensors",
  description: "Soil sensors on the north farm",
  otelCollectorStatus: "connected",
  lastSeenAt: minutesAgo(1),
  agentVersion: "0.9.1",
  // The fleet's own counts from its latest data - the chip's fallback.
  deviceCount: 10,
  onlineDeviceCount: 9,
};

type Row = Record<string, unknown>;

function heartbeat(deviceId: string, minutes: number, value: number): Row {
  return {
    timestamp: minutesAgo(minutes),
    value: value,
    attributes: { "device.id": deviceId },
  };
}

// dev-a is down now; dev-b and dev-c are up: 2 of 3 devices online.
const UP_SERIES: Array<Row> = [
  heartbeat("dev-a", 5, 0),
  heartbeat("dev-b", 5, 1),
  heartbeat("dev-c", 5, 1),
];

let upSeries: Array<Row> = UP_SERIES;

const LATIN_DIGIT: RegExp = /[0-9]/;

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "fa",
    fallbackLng: "en",
    resources: {
      fa: { translation: readLocale("fa") },
      en: { translation: readLocale("en") },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  await i18next.changeLanguage("fa");
  upSeries = UP_SERIES;
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  for (const mock of [
    modelGetItemMock,
    modelGetListMock,
    analyticsAggregateMock,
  ]) {
    mock.mockReset();
  }
  modelGetItemMock.mockImplementation(async () => {
    return FLEET;
  });
  modelGetListMock.mockImplementation(async () => {
    return { data: [], count: 0, skip: 0, limit: 100 };
  });
  analyticsAggregateMock.mockImplementation(async (args: unknown) => {
    const name: string = (args as { aggregateBy: { query: { name: string } } })
      .aggregateBy.query.name;
    return { data: name === "iot_device_up" ? upSeries : [] };
  });
  try {
    window.localStorage.clear();
  } catch {
    // Storage may be unavailable; the page renders without it.
  }
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

async function flush(): Promise<void> {
  for (let i: number = 0; i < 8; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderOverview(): Promise<void> {
  render(<IoTFleetOverview {...PAGE_PROPS} />);
  await screen.findByText("field-sensors");
  await flush();
}

// The chip's sentence as a page read from the right draws it, left to right.
function drawnFromTheRight(text: string): string {
  return getDrawnText(drawLine(text, "rtl"));
}

describe("the IoT fleet overview's devices-online chip in Persian", () => {
  test("reads in Persian, both counts in Persian digits: ۲/۳ دستگاه آنلاین", async () => {
    await renderOverview();

    const chip: HTMLElement = screen.getByText("۲/۳ دستگاه آنلاین");
    const text: string = chip.textContent || "";

    expect(chip).toBeVisible();
    expect(LATIN_DIGIT.test(text)).toBe(false);
    expect(isDrawnAsWritten(drawLine(text, "rtl"), 0, 3)).toBe(true);
    expect(drawnFromTheRight(text)).toBe("نیالنآ هاگتسد ۲/۳");

    // Never the English sentence, nor a Latin online count beside a Persian total.
    expect(screen.queryByText(/devices online/)).not.toBeInTheDocument();
    expect(screen.queryByText(/2\/۳/)).not.toBeInTheDocument();
  });

  test("with no heartbeats in the range, the fleet's own counts: ۹/۱۰", async () => {
    upSeries = [];
    await renderOverview();

    expect(screen.getByText("۹/۱۰ دستگاه آنلاین")).toBeVisible();
    expect(screen.queryByText(/9\/۱۰/)).not.toBeInTheDocument();
  });

  test("a fleet of one device reads the one form, in Persian too", async () => {
    upSeries = [heartbeat("dev-b", 5, 1)];
    await renderOverview();

    expect(screen.getByText("۱/۱ دستگاه آنلاین")).toBeVisible();
  });
});

describe("the same chip in English, unchanged", () => {
  test("2/3 devices online", async () => {
    await i18next.changeLanguage("en");
    await renderOverview();

    expect(screen.getByText("2/3 devices online")).toBeVisible();
  });

  test("1/1 device online", async () => {
    await i18next.changeLanguage("en");
    upSeries = [heartbeat("dev-b", 5, 1)];
    await renderOverview();

    expect(screen.getByText("1/1 device online")).toBeVisible();
  });
});
