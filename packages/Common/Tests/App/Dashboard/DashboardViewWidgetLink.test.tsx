import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import React from "react";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import DefaultDashboardSize from "../../../Types/Dashboard/DashboardSize";
import DashboardTextComponentUtil from "../../../Utils/Dashboard/Components/DashboardTextComponent";
import RememberedChoice from "../../../UI/Utils/RememberedChoice";
import Toast, { ToastOptions } from "../../../UI/Utils/Toast";
import {
  DASHBOARD_LINKED_WIDGET_MISSING,
  DASHBOARD_LINKED_WIDGET_MISSING_TEST_ID,
} from "../../../UI/Utils/DashboardWidgetLanding";
import type { SpyInstance } from "jest-mock";

/*
 * A DASHBOARD OPENED AT ONE OF ITS WIDGETS (#10084), on the dashboard's
 * page inside OneUptime: the real DashboardViewer against a fake dashboard
 * API, its canvas stubbed to publish what it is handed.
 *
 * Pinned here:
 *   - the link's ?widget= is handed to the board, as compared (lower case,
 *     trimmed), beside the link's range and variables - for a reader who
 *     may not edit the dashboard as much as for one who may;
 *   - a link that names none, or nothing an id could be, hands none;
 *   - the board's word that it has no such widget is said, once, in a
 *     note that goes by itself, in the reader's words;
 *   - a playlist's turn reads nothing from the address, which is the
 *     playlist's;
 *   - a dashboard that could not be read draws no board: nothing lands,
 *     nothing is said of the widget.
 */

jest.setTimeout(120000);

const DASHBOARD_ID: string = "44444444-4444-4444-8444-444444444445";
const WIDGET_ID: string = "6a1e0c00-0000-4000-8000-000000000002";
const DASHBOARD_PATH: string = `/dashboard/p/dashboards/${DASHBOARD_ID}`;

let permissions: Array<string> = ["ProjectAdmin"];

const getItemMock: jest.Mock<any, any> = jest.fn() as jest.Mock<any, any>;

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return permissions;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
      updateById: () => {
        return Promise.resolve();
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyErrorMessage: (err: Error) => {
        return err.message;
      },
      getFriendlyMessage: (err: Error) => {
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

// What the board's canvas is handed, and its word that it has no such widget.
let tellMissing: (() => void) | undefined;

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/Index",
  () => {
    const reactModule: typeof React = jest.requireActual(
      "react",
    ) as typeof React;
    return {
      __esModule: true,
      getDashboardWidgetBoxId: (id: string): string => {
        return `dashboard-component-${id}`;
      },
      default: (props: {
        landingWidgetId?: string | undefined;
        onLandingWidgetMissing?: (() => void) | undefined;
        isEditMode: boolean;
      }) => {
        tellMissing = props.onLandingWidgetMissing;

        return reactModule.createElement("div", {
          "data-testid": "canvas-stub",
          "data-landing-widget": props.landingWidgetId || "",
          "data-edit-mode": String(props.isEditMode),
        });
      },
    };
  },
);

import DashboardViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/DashboardView";

function seed(): void {
  const value: DashboardViewConfig = {
    _type: ObjectType.DashboardViewConfig,
    components: [DashboardTextComponentUtil.getDefaultComponent()],
    heightInDashboardUnits: DefaultDashboardSize.heightInDashboardUnits,
  };

  getItemMock.mockImplementation(() => {
    return Promise.resolve({
      dashboardViewConfig: JSON.parse(JSON.stringify(value)) as JSONObject,
      name: "Production overview",
    });
  });
}

function openAt(search: string): void {
  window.history.replaceState({}, "", `${DASHBOARD_PATH}${search}`);
}

const settle: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    for (let turn: number = 0; turn < 5; turn++) {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    }
  });
};

async function renderBoard(isPlayback: boolean = false): Promise<void> {
  render(
    <DashboardViewer
      dashboardId={new ObjectID(DASHBOARD_ID)}
      isPlayback={isPlayback}
    />,
  );

  await waitFor(() => {
    expect(screen.getByTestId("canvas-stub")).toBeInTheDocument();
  });
  await settle();
}

function landingWidget(): string | null {
  return screen.getByTestId("canvas-stub").getAttribute("data-landing-widget");
}

let infoSpy: SpyInstance<typeof Toast.info>;

beforeEach(() => {
  window.localStorage.clear();
  RememberedChoice.clearHeldForThisPage();
  permissions = ["ProjectAdmin"];
  tellMissing = undefined;
  getItemMock.mockReset();
  seed();
  openAt("");
  infoSpy = jest.spyOn(Toast, "info").mockImplementation((): string => {
    return "toast";
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.localStorage.clear();
  RememberedChoice.clearHeldForThisPage();
  openAt("");
});

describe("a link that names one of the dashboard's widgets", () => {
  test("hands the board its widget, as compared, beside the link's own range and variables", async () => {
    openAt(
      `?range=1d&widget=%20${WIDGET_ID.toUpperCase()}&var-service=checkout`,
    );

    await renderBoard();

    expect(landingWidget()).toBe(WIDGET_ID);
    // The board opens as it always does: in view mode.
    expect(screen.getByTestId("canvas-stub")).toHaveAttribute(
      "data-edit-mode",
      "false",
    );
    // The link is left as it came: a reload opens it at the widget again.
    expect(window.location.search).toContain(`widget=`);
  });

  test("for a reader who may not edit the dashboard as much as for one who may", async () => {
    permissions = ["ProjectMember"];
    openAt(`?widget=${WIDGET_ID}`);

    await renderBoard();

    expect(landingWidget()).toBe(WIDGET_ID);
  });

  test("a link that names none, or nothing an id could be, hands none", async () => {
    for (const search of ["", "?range=1d", "?widget=", "?widget=a%20b"]) {
      cleanup();
      openAt(search);
      await renderBoard();

      expect(landingWidget()).toBe("");
    }
  });

  test("a widget the board does not have is said once, in a note that goes by itself, and the board opens at its top", async () => {
    openAt(`?widget=${WIDGET_ID}`);

    await renderBoard();

    expect(tellMissing).toBeDefined();
    act(() => {
      tellMissing!();
    });

    expect(infoSpy).toHaveBeenCalledTimes(1);

    const [title, options] = infoSpy.mock.calls[0] as [string, ToastOptions];

    expect(title).toBe(DASHBOARD_LINKED_WIDGET_MISSING);
    expect(options).toEqual({
      dataTestId: DASHBOARD_LINKED_WIDGET_MISSING_TEST_ID,
    });
    // An info note: it goes by itself, no error that stays.
    expect(options.durationInMs).toBeUndefined();
  });
});

describe("where no widget is landed on", () => {
  test("a playlist's turn reads nothing from the address, which is the playlist's", async () => {
    openAt(`?widget=${WIDGET_ID}`);

    await renderBoard(true);

    expect(landingWidget()).toBe("");
  });

  test("a dashboard that could not be read draws no board: nothing lands, nothing is said of the widget", async () => {
    getItemMock.mockImplementation(() => {
      return Promise.reject(
        new Error("You do not have permission to read Dashboard."),
      );
    });
    openAt(`?widget=${WIDGET_ID}`);

    render(<DashboardViewer dashboardId={new ObjectID(DASHBOARD_ID)} />);
    await settle();

    expect(screen.queryByTestId("canvas-stub")).toBeNull();
    expect(
      await screen.findByText("You do not have permission to read Dashboard."),
    ).toBeInTheDocument();
    expect(infoSpy).not.toHaveBeenCalled();
  });
});
