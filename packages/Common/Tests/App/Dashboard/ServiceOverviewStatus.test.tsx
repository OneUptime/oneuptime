/**
 * @timezone UTC
 */
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { flush } from "./TimeRangeZoomPageHarness";

/*
 * Issue #6270: a service's Overview worked its status out in the page -
 * "Connected" for 30 minutes after its last telemetry, then
 * "Disconnected", in amber, with no hover text - so a staging service or
 * an internal API nobody had called for half an hour read as if its link
 * to OneUptime were broken. Its hero now says Receiving data (green), No
 * recent data (grey) or Waiting for data (grey), with what each means on
 * hover, from ServiceTelemetryStatus; "Last seen" still says when data
 * last arrived.
 *
 * The page is rendered for real, with its data sources and its heavy
 * neighbours (charts, the activity, security and placement cards)
 * replaced, at a fixed clock.
 */

const NOW: Date = new Date("2026-11-08T12:00:00.000Z");
const MINUTE: number = 60 * 1000;

const getItemMock: MockFunction = getJestMockFunction();

jest.mock("react-i18next", () => {
  return {
    useTranslation: (): unknown => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      getList: (): Promise<unknown> => {
        return Promise.resolve({ data: [], count: 0 });
      },
      count: (): Promise<number> => {
        return Promise.resolve(0);
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (): Promise<unknown> => {
        return Promise.resolve({ data: {} });
      },
      getFriendlyMessage: (error: unknown): string => {
        return String((error as Error)?.message || error);
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

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("dddddddd-0000-4000-8000-000000000004");
      },
      navigate: (): void => {},
      isOnThisPage: (): boolean => {
        return false;
      },
    },
  };
});

// The span, log and runtime numbers are not the subject: nothing arrives.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/telemetryMetrics",
  () => {
    const format: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/telemetryFormat",
    ) as Record<string, unknown>;
    return {
      __esModule: true,
      ...format,
      fetchSpanMetrics: (): Promise<unknown> => {
        return new Promise<unknown>(() => {});
      },
      fetchLogAndExceptionSignals: (): Promise<unknown> => {
        return new Promise<unknown>(() => {});
      },
      fetchMetricSeries: (): Promise<unknown> => {
        return Promise.resolve([]);
      },
    };
  },
);

jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return React.createElement("div", { "data-testid": "line-chart" });
    },
  };
});

jest.mock(
  "../../../UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (): null => {
      return null;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/AutoRefreshControl",
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
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/useAutoRefresh",
  () => {
    return {
      __esModule: true,
      default: (): unknown => {
        return {
          autoRefreshInterval: "off",
          setAutoRefreshInterval: (): void => {},
        };
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceActivity/ResourceActivityCards",
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
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityConnections/ResourceSecurityCard",
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
  "../../../../App/FeatureSet/Dashboard/src/Components/OpenStack/Part/OpenStackPlacementOfHost",
  () => {
    return {
      __esModule: true,
      OpenStackPlacementOfService: (): null => {
        return null;
      },
    };
  },
);

import ServiceView from "../../../../App/FeatureSet/Dashboard/src/Pages/Service/View/Index";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import {
  SERVICE_NO_RECENT_DATA_DESCRIPTION,
  SERVICE_RECEIVING_DATA_DESCRIPTION,
  SERVICE_WAITING_FOR_DATA_DESCRIPTION,
} from "../../../Types/Service/ServiceTelemetryStatus";

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

async function mount(lastSeenAt: unknown): Promise<void> {
  getItemMock.mockImplementation((): Promise<unknown> => {
    return Promise.resolve({
      name: "checkout-api",
      telemetrySdkLanguage: "nodejs",
      lastSeenAt: lastSeenAt,
    });
  });

  render(
    <MemoryRouter>
      <ServiceView {...PAGE_PROPS} />
    </MemoryRouter>,
  );
  await flush();
}

function pill(): HTMLElement {
  return screen.getByTestId("resource-overview-status");
}

// The hero: the element holding the service's name.
function hero(): HTMLElement {
  return screen.getByRole("heading", { level: 1, name: "checkout-api" })
    .parentElement!.parentElement as HTMLElement;
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  window.localStorage.clear();
  getItemMock.mockReset();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

interface HeroCase {
  // When its telemetry last arrived, as the API hands it over.
  lastSeenAt: unknown;
  label: string;
  background: string;
  hover: string;
  // The line under the name.
  seen: string;
}

const STATES: Array<[string, HeroCase]> = [
  [
    "telemetry a minute ago",
    {
      lastSeenAt: new Date(NOW.getTime() - MINUTE),
      label: "Receiving data",
      background: "bg-emerald-50",
      hover: SERVICE_RECEIVING_DATA_DESCRIPTION,
      seen: "Last seen a minute ago",
    },
  ],
  [
    "telemetry a minute ago, as the API's ISO string",
    {
      lastSeenAt: new Date(NOW.getTime() - MINUTE).toISOString(),
      label: "Receiving data",
      background: "bg-emerald-50",
      hover: SERVICE_RECEIVING_DATA_DESCRIPTION,
      seen: "Last seen a minute ago",
    },
  ],
  [
    "telemetry exactly 30 minutes ago",
    {
      lastSeenAt: new Date(NOW.getTime() - 30 * MINUTE),
      label: "Receiving data",
      background: "bg-emerald-50",
      hover: SERVICE_RECEIVING_DATA_DESCRIPTION,
      seen: "Last seen 30 minutes ago",
    },
  ],
  [
    "telemetry 30 minutes and a millisecond ago",
    {
      lastSeenAt: new Date(NOW.getTime() - 30 * MINUTE - 1),
      label: "No recent data",
      background: "bg-gray-50",
      hover: SERVICE_NO_RECENT_DATA_DESCRIPTION,
      seen: "Last seen 30 minutes ago",
    },
  ],
  [
    "telemetry 3 hours ago",
    {
      lastSeenAt: new Date(NOW.getTime() - 3 * 60 * MINUTE),
      label: "No recent data",
      background: "bg-gray-50",
      hover: SERVICE_NO_RECENT_DATA_DESCRIPTION,
      seen: "Last seen 3 hours ago",
    },
  ],
  [
    "no telemetry yet",
    {
      lastSeenAt: undefined,
      label: "Waiting for data",
      background: "bg-gray-50",
      hover: SERVICE_WAITING_FOR_DATA_DESCRIPTION,
      seen: "Never seen",
    },
  ],
  [
    "a last-seen time that is not a date",
    {
      lastSeenAt: "not-a-date",
      label: "Waiting for data",
      background: "bg-gray-50",
      hover: SERVICE_WAITING_FOR_DATA_DESCRIPTION,
      seen: "Never seen",
    },
  ],
];

describe("a service's Overview hero says whether its data arrives", () => {
  test.each(STATES)(
    "with %s",
    async (_state: string, expected: HeroCase) => {
      await mount(expected.lastSeenAt);

      const element: HTMLElement = pill();

      expect(element).toHaveTextContent(new RegExp(`^${expected.label}$`));
      expect(element).toHaveClass(expected.background);
      // Never amber or red: neither quiet state is a fault on its own.
      expect(element.className).not.toMatch(/amber|red/);
      expect(element).toHaveAttribute("title", expected.hover);
      expect(within(hero()).getByText(expected.seen)).toBeInTheDocument();
    },
  );

  test.each(STATES)(
    "and nothing on it says Connected or Disconnected, with %s",
    async (_state: string, expected: HeroCase) => {
      await mount(expected.lastSeenAt);

      expect(pill()).toBeInTheDocument();
      expect(document.body.textContent).not.toMatch(/disconnected/i);
      expect(pill().textContent).not.toMatch(/connected/i);
      expect(pill().getAttribute("title") || "").not.toMatch(/disconnect/i);
      expect(document.body.textContent).not.toMatch(/Invalid date/i);
    },
  );

  test("a quiet service's hover says it may only be idle, and what to check when it should be busy", async () => {
    await mount(new Date(NOW.getTime() - 3 * 60 * MINUTE));

    const hover: string = pill().getAttribute("title") || "";

    expect(hover).toContain("Nothing has arrived in the last 30 minutes.");
    expect(hover).toContain("quiet when nobody calls it");
    expect(hover).toContain("If it should be busy, check that it is running");
    expect(hover).toContain("service.name");
  });

  test("a service whose last data is ahead of the reader's clock is receiving", async () => {
    await mount(new Date(NOW.getTime() + 2 * MINUTE));

    expect(pill()).toHaveTextContent(/^Receiving data$/);
    expect(pill()).toHaveClass("bg-emerald-50");
  });
});
