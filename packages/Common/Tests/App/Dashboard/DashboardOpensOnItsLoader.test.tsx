import "@testing-library/jest-dom";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
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
import React, { act } from "react";

/*
 * A dashboard inside OneUptime opens on its loader, as a public dashboard
 * does, and its board comes in with its widgets. DashboardView started not
 * loading: its first frame drew the toolbar with no name and the empty
 * board - "No widgets yet" and, for an editor, Add Widget - until its read
 * began a moment later (the first screencast frame of 14.0.95's gate
 * trace). The board's own first draw, each widget at its size, is held by
 * DashboardBoardFirstDraw.
 *
 * The real DashboardViewer and toolbar against a fake dashboard API, as
 * DashboardBlankCanvasAddWidget drives them, with the canvas stubbed: the
 * stub records every board it is handed.
 */

jest.setTimeout(120000);

const DASHBOARD_ID: string = "44444444-4444-4444-8444-444444444444";

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return [];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: [] };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

const getItemMock: jest.Mock<any> = jest.fn() as jest.Mock<any>;

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      updateById: (): Promise<void> => {
        return Promise.resolve();
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyErrorMessage: (err: Error): string => {
        return err.message;
      },
      getFriendlyMessage: (err: Error): string => {
        return err.message;
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        loadAllMetricsTypes: () => {
          return Promise.resolve({ metricTypes: [], telemetryAttributes: [] });
        },
        getTelemetryAttributes: () => {
          return Promise.resolve([]);
        },
        getTelemetryAttributeValues: () => {
          return Promise.resolve([]);
        },
      },
    };
  },
);

// Every board the canvas was handed: its widgets and the page's width.
const boardsDrawn: Array<{ widgets: number; pageWidth: number }> = [];

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/Index",
  () => {
    const reactModule: typeof React = jest.requireActual(
      "react",
    ) as typeof React;

    return {
      __esModule: true,
      default: (props: {
        dashboardViewConfig: { components: Array<unknown> };
        currentTotalDashboardWidthInPx: number;
      }) => {
        boardsDrawn.push({
          widgets: props.dashboardViewConfig.components.length,
          pageWidth: props.currentTotalDashboardWidthInPx,
        });

        return reactModule.createElement("div", {
          "data-testid": "canvas-stub",
          "data-widget-count": String(
            props.dashboardViewConfig.components.length,
          ),
        });
      },
    };
  },
);

import DashboardViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/DashboardView";
import ObjectID from "../../../Types/ObjectID";
import { ObjectType } from "../../../Types/JSON";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";

// The dashboard's page, as wide as the window beside the side menu.
const PAGE_WIDTH: number = 876;

const ORIGINAL_OFFSET_WIDTH: PropertyDescriptor | undefined =
  Object.getOwnPropertyDescriptor(HTMLElement.prototype, "offsetWidth");

beforeAll(() => {
  // The dashboard's page (DashboardView's own box) is PAGE_WIDTH across.
  Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
    configurable: true,
    get(this: HTMLElement): number {
      return this.classList.contains("min-h-screen") ? PAGE_WIDTH : 0;
    },
  });
});

afterAll(() => {
  if (ORIGINAL_OFFSET_WIDTH) {
    Object.defineProperty(
      HTMLElement.prototype,
      "offsetWidth",
      ORIGINAL_OFFSET_WIDTH,
    );
  }
});

function widget(id: string): Record<string, unknown> {
  return {
    _type: ObjectType.DashboardComponent,
    componentId: new ObjectID(id),
    componentType: DashboardComponentType.Text,
    topInDashboardUnits: 0,
    leftInDashboardUnits: 0,
    widthInDashboardUnits: 6,
    heightInDashboardUnits: 1,
    minWidthInDashboardUnits: 1,
    minHeightInDashboardUnits: 1,
    arguments: {},
  };
}

function dashboardWith(widgets: number): Record<string, unknown> {
  return {
    dashboardViewConfig: {
      _type: ObjectType.DashboardViewConfig,
      heightInDashboardUnits: 1,
      components: Array.from(
        { length: widgets },
        (_: unknown, index: number) => {
          return widget(`55555555-5555-4555-8555-55555555555${index}`);
        },
      ),
    },
    name: "Operations wall",
    description: "",
    pageTitle: null,
    pageDescription: null,
  };
}

// A read the test answers when it chooses.
function heldRead(): {
  answer: (dashboard: Record<string, unknown>) => Promise<void>;
  fail: (error: Error) => Promise<void>;
} {
  let resolveRead: (value: unknown) => void = () => {};
  let rejectRead: (error: Error) => void = () => {};

  getItemMock.mockImplementation(() => {
    return new Promise(
      (resolve: (value: unknown) => void, reject: (error: Error) => void) => {
        resolveRead = resolve;
        rejectRead = reject;
      },
    );
  });

  return {
    answer: async (dashboard: Record<string, unknown>): Promise<void> => {
      await act(async () => {
        resolveRead(dashboard);
      });
    },
    fail: async (error: Error): Promise<void> => {
      await act(async () => {
        rejectRead(error);
      });
    },
  };
}

beforeEach(() => {
  boardsDrawn.splice(0, boardsDrawn.length);
  window.history.replaceState({}, "", `/dashboard/${DASHBOARD_ID}`);
});

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

describe("a dashboard opens on its loader", () => {
  test("while its board is read, the loader alone: no empty board, no toolbar", async () => {
    const read: ReturnType<typeof heldRead> = heldRead();

    render(<DashboardViewer dashboardId={new ObjectID(DASHBOARD_ID)} />);

    // Its first frame, before any effect has run, is the loader.
    expect(screen.getByTestId("bar-loader")).toBeInTheDocument();
    expect(screen.queryByTestId("canvas-stub")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("More dashboard options"),
    ).not.toBeInTheDocument();
    expect(boardsDrawn).toEqual([]);

    await read.answer(dashboardWith(2));

    await waitFor(() => {
      expect(screen.getByTestId("canvas-stub")).toBeInTheDocument();
    });

    // The first board it was ever handed held the dashboard's widgets.
    expect(boardsDrawn[0]!.widgets).toBe(2);
    expect(
      boardsDrawn.every((board: { widgets: number }) => {
        return board.widgets === 2;
      }),
    ).toBe(true);
    expect(screen.queryByTestId("bar-loader")).not.toBeInTheDocument();
    expect(screen.getByLabelText("More dashboard options")).toBeInTheDocument();
  });

  test("a dashboard with no widgets opens on its loader too, then its empty board", async () => {
    const read: ReturnType<typeof heldRead> = heldRead();

    render(<DashboardViewer dashboardId={new ObjectID(DASHBOARD_ID)} />);

    expect(screen.getByTestId("bar-loader")).toBeInTheDocument();
    expect(boardsDrawn).toEqual([]);

    await read.answer(dashboardWith(0));

    await waitFor(() => {
      expect(screen.getByTestId("canvas-stub")).toHaveAttribute(
        "data-widget-count",
        "0",
      );
    });
  });

  test("a read that fails says so, and no empty board was drawn first", async () => {
    const read: ReturnType<typeof heldRead> = heldRead();

    render(<DashboardViewer dashboardId={new ObjectID(DASHBOARD_ID)} />);
    await read.fail(new Error("The dashboard could not be read."));

    await waitFor(() => {
      expect(
        screen.getByText("The dashboard could not be read."),
      ).toBeInTheDocument();
    });
    expect(boardsDrawn).toEqual([]);
  });

  test("the board is handed the page's width, measured once the board is drawn", async () => {
    const read: ReturnType<typeof heldRead> = heldRead();

    render(<DashboardViewer dashboardId={new ObjectID(DASHBOARD_ID)} />);
    await read.answer(dashboardWith(1));

    await waitFor(() => {
      expect(boardsDrawn[boardsDrawn.length - 1]!.pageWidth).toBe(PAGE_WIDTH);
    });
  });

  test("a playlist's turn opens on its loader as well", async () => {
    const read: ReturnType<typeof heldRead> = heldRead();

    render(
      <DashboardViewer
        dashboardId={new ObjectID(DASHBOARD_ID)}
        isPlayback={true}
      />,
    );

    expect(screen.getByTestId("bar-loader")).toBeInTheDocument();
    expect(boardsDrawn).toEqual([]);

    await read.answer(dashboardWith(3));

    await waitFor(() => {
      expect(screen.getByTestId("canvas-stub")).toBeInTheDocument();
    });
    expect(boardsDrawn[0]!.widgets).toBe(3);
  });
});
