/** @timezone UTC */
import "@testing-library/jest-dom";
import {
  afterEach,
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
  RenderResult,
  screen,
} from "@testing-library/react";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import {
  MemoryRouter,
  Route as PageRoute,
  Routes,
  useNavigate,
  useOutletContext,
  useParams,
} from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The monitor view layout: it reads the monitor's type to build the side
 * menu, hosts ModelPage for the "Monitor - {name}" header, and hands the page
 * below an outlet context for refreshing that header.
 *
 * Three things went wrong here before, and these tests guard all three:
 *
 *  - the type was read once, on mount, so following a link from one monitor
 *    to another kept the first monitor's side menu;
 *  - a monitor without a type showed a loader forever, and a failed read had
 *    no way to try again;
 *  - the page below could edit the monitor's name and labels, but the header
 *    kept showing the old ones until a full reload.
 *
 * The real Layout, ModelPage, Page and router run against a fake ModelAPI.
 * Only the side menu (its links need the whole route map) and the breadcrumb
 * helpers are replaced.
 */

const MONITOR_A: string = "11111111-1111-4111-8111-111111111111";
const MONITOR_B: string = "22222222-2222-4222-8222-222222222222";

const getItemMock: MockFunction = getJestMockFunction();

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

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

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/View/SideMenu",
  () => {
    return {
      __esModule: true,
      default: (props: {
        monitorType: string;
        modelId: { toString: () => string };
      }): ReactElement => {
        return (
          <nav data-testid="monitor-side-menu">
            {`${props.monitorType} menu for ${props.modelId.toString()}`}
          </nav>
        );
      },
    };
  },
);

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs", () => {
  return {
    __esModule: true,
    getMonitorBreadcrumbs: (): undefined => {
      return undefined;
    },
  };
});

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap", () => {
  return {
    __esModule: true,
    default: {},
    RouteUtil: {
      getRoutes: (): Array<{ path: string }> => {
        return [];
      },
    },
  };
});

import MonitorViewLayout from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/View/Layout";
import MonitorViewOutletContext from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/View/MonitorViewOutletContext";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Dictionary from "../../../Types/Dictionary";
import ExceptionMessages from "../../../Types/Exception/ExceptionMessages";
import { JSONObject } from "../../../Types/JSON";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";

const NO_TYPE_MESSAGE: string =
  "This monitor has no monitor type, so its pages cannot be shown.";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = (): void => {};
  let reject: (reason: unknown) => void = (): void => {};

  const promise: Promise<T> = new Promise<T>(
    (
      promiseResolve: (value: T) => void,
      promiseReject: (reason: unknown) => void,
    ) => {
      resolve = promiseResolve;
      reject = promiseReject;
    },
  );

  return { promise: promise, resolve: resolve, reject: reject };
}

/*
 * The fake server's monitors. A test changes a row to stand for an edit made
 * elsewhere, and the next read sees it.
 */
interface FakeMonitor {
  name: string;
  monitorType: MonitorType | null;
}

let fakeMonitors: Dictionary<FakeMonitor> = {};

type ReadOverride = (id: string) => Promise<Monitor | null>;

/*
 * Per-kind hooks for a test that needs a read to be slow, fail or come back
 * empty. Each one is used for the next read of its kind and then cleared.
 */
const typeReadOverrides: Array<ReadOverride> = [];
const headerReadOverrides: Array<ReadOverride> = [];

// The ids each kind of read asked for, in order.
const typeReads: Array<string> = [];
const headerReads: Array<string> = [];

function buildMonitor(id: string): Monitor | null {
  const row: FakeMonitor | undefined = fakeMonitors[id];

  if (!row) {
    return null;
  }

  const monitor: Monitor = new Monitor();
  monitor.id = new ObjectID(id);
  monitor.name = row.name;

  if (row.monitorType) {
    monitor.monitorType = row.monitorType;
  }

  return monitor;
}

interface GetItemArgs {
  id: ObjectID;
  select: JSONObject;
}

function handleGetItem(args: GetItemArgs): Promise<Monitor | null> {
  const id: string = args.id.toString();

  // The layout reads only the type; ModelPage reads the name and labels.
  const isTypeRead: boolean = Boolean(args.select["monitorType"]);

  if (isTypeRead) {
    typeReads.push(id);
    const typeOverride: ReadOverride | undefined = typeReadOverrides.shift();
    return typeOverride ? typeOverride(id) : Promise.resolve(buildMonitor(id));
  }

  headerReads.push(id);
  const headerOverride: ReadOverride | undefined = headerReadOverrides.shift();
  return headerOverride
    ? headerOverride(id)
    : Promise.resolve(buildMonitor(id));
}

// Every mount of the routed page, with the id it was mounted for.
const pageMounts: Array<string> = [];

// Every outlet context the routed page was handed, render by render.
const outletContexts: Array<MonitorViewOutletContext | undefined> = [];

/*
 * Stands in for the overview. "Save details" does what its details card does
 * on a save: its own state changes and it asks for the header to be read
 * again. The state change makes the page render again after the layout has,
 * so a context rebuilt on every layout render would be caught.
 */
const MonitorPageProbe: FunctionComponent = (): ReactElement => {
  const { id } = useParams();
  const outlet: MonitorViewOutletContext | undefined = useOutletContext<
    MonitorViewOutletContext | undefined
  >();
  const [saveCount, setSaveCount] = useState<number>(0);

  outletContexts.push(outlet);

  useEffect(() => {
    pageMounts.push(id || "");
  }, []);

  return (
    <div data-testid="monitor-page">
      <span>{`Saved ${saveCount} times`}</span>
      <button
        type="button"
        onClick={() => {
          setSaveCount(saveCount + 1);
          outlet?.refreshHeader();
        }}
      >
        Save details
      </button>
    </div>
  );
};

const NavigationProbe: FunctionComponent = (): ReactElement => {
  const navigate: ReturnType<typeof useNavigate> = useNavigate();

  return (
    <button
      type="button"
      onClick={() => {
        navigate(`/monitors/${MONITOR_B}`);
      }}
    >
      Open monitor B
    </button>
  );
};

function renderLayout(): RenderResult {
  return render(
    <MemoryRouter initialEntries={[`/monitors/${MONITOR_A}`]}>
      <NavigationProbe />
      <Routes>
        <PageRoute path="/monitors/:id" element={<MonitorViewLayout />}>
          <PageRoute index element={<MonitorPageProbe />} />
        </PageRoute>
      </Routes>
    </MemoryRouter>,
  );
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let index: number = 0; index < 10; index++) {
      await Promise.resolve();
    }
  });
}

function heading(): HTMLElement {
  return screen.getByRole("heading", { level: 1 });
}

function openMonitorB(): void {
  act(() => {
    fireEvent.click(screen.getByText("Open monitor B"));
  });
}

beforeEach(() => {
  fakeMonitors = {
    [MONITOR_A]: { name: "Checkout API", monitorType: MonitorType.API },
    [MONITOR_B]: { name: "Edge ping", monitorType: MonitorType.Ping },
  };
  typeReadOverrides.length = 0;
  headerReadOverrides.length = 0;
  typeReads.length = 0;
  headerReads.length = 0;
  pageMounts.length = 0;
  outletContexts.length = 0;

  getItemMock.mockReset();
  getItemMock.mockImplementation((...args: Array<unknown>) => {
    return handleGetItem(args[0] as GetItemArgs);
  });

  // Navigation's location is set by the app shell, which is not mounted here.
  jest.spyOn(Navigation, "getRoutePath").mockReturnValue("/monitors/:id");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Monitor view layout - the monitor's type", () => {
  test("reads only the type, then shows the side menu for it, the header and the page", async () => {
    renderLayout();

    // Before the type is known there is nothing correct to show.
    expect(screen.getByTestId("bar-loader")).toBeInTheDocument();
    expect(screen.queryByTestId("monitor-side-menu")).toBeNull();
    expect(screen.queryByTestId("monitor-page")).toBeNull();

    await flush();

    expect(getItemMock.mock.calls[0]![0]).toMatchObject({
      modelType: Monitor,
      select: { monitorType: true },
    });
    expect(
      Object.keys((getItemMock.mock.calls[0]![0] as GetItemArgs).select),
    ).toEqual(["monitorType"]);

    expect(screen.getByTestId("monitor-side-menu")).toHaveTextContent(
      `${MonitorType.API} menu for ${MONITOR_A}`,
    );
    expect(heading()).toHaveTextContent("Monitor - Checkout API");
    expect(screen.getByTestId("monitor-page")).toBeInTheDocument();
    expect(typeReads).toEqual([MONITOR_A]);
    expect(headerReads).toEqual([MONITOR_A]);
  });

  test("re-reads the type when the id changes", async () => {
    renderLayout();
    await flush();

    const typeOfB: Deferred<Monitor | null> = createDeferred<Monitor | null>();
    typeReadOverrides.push(() => {
      return typeOfB.promise;
    });

    openMonitorB();

    // At once, before B's type is back: nothing of monitor A is left.
    expect(screen.getByTestId("bar-loader")).toBeInTheDocument();
    expect(screen.queryByTestId("monitor-side-menu")).toBeNull();
    expect(screen.queryByText(/Checkout API/)).toBeNull();
    expect(screen.queryByTestId("monitor-page")).toBeNull();

    await flush();

    expect(typeReads).toEqual([MONITOR_A, MONITOR_B]);

    await act(async () => {
      typeOfB.resolve(buildMonitor(MONITOR_B));
    });
    await flush();

    expect(screen.getByTestId("monitor-side-menu")).toHaveTextContent(
      `${MonitorType.Ping} menu for ${MONITOR_B}`,
    );
    expect(heading()).toHaveTextContent("Monitor - Edge ping");
    expect(pageMounts).toEqual([MONITOR_A, MONITOR_B]);
  });

  test("a slow type read of the monitor the reader left cannot bring its side menu back", async () => {
    const typeOfA: Deferred<Monitor | null> = createDeferred<Monitor | null>();
    typeReadOverrides.push(() => {
      return typeOfA.promise;
    });

    renderLayout();
    await flush();

    openMonitorB();
    await flush();

    expect(screen.getByTestId("monitor-side-menu")).toHaveTextContent(
      `${MonitorType.Ping} menu for ${MONITOR_B}`,
    );

    await act(async () => {
      typeOfA.resolve(buildMonitor(MONITOR_A));
    });
    await flush();

    expect(screen.getByTestId("monitor-side-menu")).toHaveTextContent(
      `${MonitorType.Ping} menu for ${MONITOR_B}`,
    );
    expect(heading()).toHaveTextContent("Monitor - Edge ping");
    expect(headerReads).toEqual([MONITOR_B]);
  });

  test("a null type shows the error with retry", async () => {
    fakeMonitors[MONITOR_A] = { name: "Checkout API", monitorType: null };

    renderLayout();
    await flush();

    expect(screen.getByText(NO_TYPE_MESSAGE)).toBeInTheDocument();
    expect(screen.queryByTestId("bar-loader")).toBeNull();
    expect(screen.queryByTestId("monitor-side-menu")).toBeNull();
    expect(screen.queryByTestId("monitor-page")).toBeNull();

    // No header is read for a page that cannot be shown.
    expect(headerReads).toEqual([]);

    fakeMonitors[MONITOR_A] = {
      name: "Checkout API",
      monitorType: MonitorType.API,
    };

    fireEvent.click(screen.getByTestId("refresh-button"));

    // The retry shows the loader rather than the stale error.
    expect(screen.getByTestId("bar-loader")).toBeInTheDocument();
    expect(screen.queryByText(NO_TYPE_MESSAGE)).toBeNull();

    await flush();

    expect(typeReads).toEqual([MONITOR_A, MONITOR_A]);
    expect(screen.getByTestId("monitor-side-menu")).toHaveTextContent(
      `${MonitorType.API} menu for ${MONITOR_A}`,
    );
    expect(screen.getByTestId("monitor-page")).toBeInTheDocument();
  });

  test("a fetch error has retry", async () => {
    typeReadOverrides.push(() => {
      return Promise.reject(new Error("Service unavailable"));
    });

    renderLayout();
    await flush();

    expect(screen.getByText("Service unavailable")).toBeInTheDocument();
    expect(screen.queryByTestId("monitor-page")).toBeNull();

    fireEvent.click(screen.getByTestId("refresh-button"));
    await flush();

    expect(typeReads).toEqual([MONITOR_A, MONITOR_A]);
    expect(screen.queryByText("Service unavailable")).toBeNull();
    expect(heading()).toHaveTextContent("Monitor - Checkout API");
    expect(screen.getByTestId("monitor-page")).toBeInTheDocument();
  });

  test("a monitor that cannot be read says so, with retry", async () => {
    delete fakeMonitors[MONITOR_A];

    renderLayout();
    await flush();

    expect(
      screen.getByText(ExceptionMessages.MonitorNotFound),
    ).toBeInTheDocument();
    expect(screen.getByTestId("refresh-button")).toBeInTheDocument();
    expect(screen.queryByTestId("bar-loader")).toBeNull();
  });

  test("an error for one monitor does not stick to the next", async () => {
    typeReadOverrides.push(() => {
      return Promise.reject(new Error("Service unavailable"));
    });

    renderLayout();
    await flush();

    expect(screen.getByText("Service unavailable")).toBeInTheDocument();

    openMonitorB();
    await flush();

    expect(screen.queryByText("Service unavailable")).toBeNull();
    expect(screen.getByTestId("monitor-side-menu")).toHaveTextContent(
      `${MonitorType.Ping} menu for ${MONITOR_B}`,
    );
  });
});

describe("Monitor view layout - refreshing the header from the page", () => {
  test("the outlet context refreshHeader bumps ModelPage's refreshToken", async () => {
    renderLayout();
    await flush();

    expect(heading()).toHaveTextContent("Monitor - Checkout API");
    expect(headerReads).toEqual([MONITOR_A]);

    // The page renamed the monitor.
    fakeMonitors[MONITOR_A] = {
      name: "Checkout API (EU)",
      monitorType: MonitorType.API,
    };

    fireEvent.click(screen.getByText("Save details"));
    await flush();

    expect(headerReads).toEqual([MONITOR_A, MONITOR_A]);
    expect(heading()).toHaveTextContent("Monitor - Checkout API (EU)");

    // Only the header is read again, and the page is never remounted.
    expect(typeReads).toEqual([MONITOR_A]);
    expect(pageMounts).toEqual([MONITOR_A]);
    expect(screen.getByTestId("monitor-page")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Save details"));
    await flush();

    expect(headerReads).toEqual([MONITOR_A, MONITOR_A, MONITOR_A]);
  });

  test("the outlet context is one stable object across renders", async () => {
    renderLayout();
    await flush();

    fireEvent.click(screen.getByText("Save details"));
    await flush();

    expect(outletContexts.length).toBeGreaterThan(1);

    const first: MonitorViewOutletContext | undefined = outletContexts[0];

    expect(first).toBeDefined();
    expect(typeof first?.refreshHeader).toBe("function");

    for (const context of outletContexts) {
      expect(context).toBe(first);
    }
  });

  test("a failed header refresh keeps the page and the header on screen", async () => {
    renderLayout();
    await flush();

    headerReadOverrides.push(() => {
      return Promise.reject(new Error("Network blip"));
    });

    fireEvent.click(screen.getByText("Save details"));
    await flush();

    expect(headerReads).toEqual([MONITOR_A, MONITOR_A]);
    expect(screen.queryByText("Network blip")).toBeNull();
    expect(heading()).toHaveTextContent("Monitor - Checkout API");
    expect(screen.getByTestId("monitor-page")).toBeInTheDocument();
    expect(pageMounts).toEqual([MONITOR_A]);
  });
});
