import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A PUBLIC DASHBOARD OPENED AT ONE OF ITS WIDGETS (#10084): the real public
 * DashboardViewPage against a fake public API, its canvas stubbed to
 * publish what it is handed. A visitor's link to one widget - copied from
 * the dashboard, sent in a chat - opens the board at it, as the dashboard
 * inside OneUptime does; and the password prompt hands the link on whole
 * (PublicDashboardPasswordAddress), so it opens there after the password.
 *
 * Pinned here:
 *   - the link's ?widget= is handed to the board, as compared, beside its
 *     own theme and variables;
 *   - a link that names none hands none;
 *   - the board's word that it has no such widget is said once, in a note
 *     that goes by itself;
 *   - a dashboard the public API does not answer for draws no board, and
 *     says nothing of a widget.
 */

const publicPostMock: MockFunction = getJestMockFunction();

jest.mock("../../../../App/FeatureSet/PublicDashboard/src/Utils/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return publicPostMock(...args);
      },
      getFriendlyErrorMessage: (err: Error) => {
        return err.message;
      },
    },
  };
});

let tellMissing: (() => void) | undefined;

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/Index",
  () => {
    const reactModule: typeof React = jest.requireActual(
      "react",
    ) as typeof React;
    return {
      __esModule: true,
      default: (props: {
        landingWidgetId?: string | undefined;
        onLandingWidgetMissing?: (() => void) | undefined;
      }) => {
        tellMissing = props.onLandingWidgetMissing;

        return reactModule.createElement("div", {
          "data-testid": "canvas-stub",
          "data-landing-widget": props.landingWidgetId || "",
        });
      },
    };
  },
);

import DashboardViewPage from "../../../../App/FeatureSet/PublicDashboard/src/Pages/DashboardView/DashboardViewPage";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import Toast, { ToastOptions } from "../../../UI/Utils/Toast";
import {
  DASHBOARD_LINKED_WIDGET_MISSING,
  DASHBOARD_LINKED_WIDGET_MISSING_TEST_ID,
} from "../../../UI/Utils/DashboardWidgetLanding";
import type { SpyInstance } from "jest-mock";

const DASHBOARD_ID: ObjectID = new ObjectID(
  "d5d5d5d5-2222-4222-8222-d5d5d5d5d5d6",
);
const WIDGET_ID: string = "d5d5d5d5-2222-4222-8222-0000000000a1";
const PREVIEW_PATH: string = `/public-dashboard/${DASHBOARD_ID.toString()}`;

function board(): DashboardViewConfig {
  return {
    _type: ObjectType.DashboardViewConfig,
    heightInDashboardUnits: 4,
    components: [
      {
        _type: ObjectType.DashboardComponent,
        componentId: new ObjectID(WIDGET_ID),
        componentType: DashboardComponentType.Text,
        topInDashboardUnits: 0,
        leftInDashboardUnits: 0,
        widthInDashboardUnits: 4,
        heightInDashboardUnits: 2,
        minWidthInDashboardUnits: 1,
        minHeightInDashboardUnits: 1,
        arguments: { text: "Checkout service" },
      },
    ],
  } as unknown as DashboardViewConfig;
}

function answer(isFound: boolean = true): void {
  publicPostMock.mockImplementation(() => {
    return Promise.resolve({
      isFailure: (): boolean => {
        return !isFound;
      },
      data: isFound
        ? {
            dashboardViewConfig: JSONFunctions.serialize(
              board() as unknown as JSONObject,
            ),
            name: "Status board",
          }
        : null,
    });
  });
}

async function renderPage(): Promise<void> {
  render(<DashboardViewPage dashboardId={DASHBOARD_ID} />);

  await waitFor(() => {
    expect(screen.getByTestId("canvas-stub")).toBeInTheDocument();
  });
}

function openAt(search: string): void {
  window.history.replaceState(null, "", `${PREVIEW_PATH}${search}`);
}

let infoSpy: SpyInstance<typeof Toast.info>;

beforeEach(() => {
  window.localStorage.clear();
  publicPostMock.mockReset();
  tellMissing = undefined;
  answer();
  openAt("");
  infoSpy = jest.spyOn(Toast, "info").mockImplementation((): string => {
    return "toast";
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("a public dashboard's link to one of its widgets", () => {
  test("hands the board its widget, as compared, beside the link's theme and variables", async () => {
    openAt(`?theme=dark&widget=${WIDGET_ID.toUpperCase()}&var-env=prod`);

    await renderPage();

    expect(
      screen.getByTestId("canvas-stub").getAttribute("data-landing-widget"),
    ).toBe(WIDGET_ID);
  });

  test("a link that names none hands none", async () => {
    openAt("?theme=dark");

    await renderPage();

    expect(
      screen.getByTestId("canvas-stub").getAttribute("data-landing-widget"),
    ).toBe("");
  });

  test("a widget the board no longer has is said once, in a note that goes by itself", async () => {
    openAt(`?widget=${WIDGET_ID}`);

    await renderPage();

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
  });

  test("a dashboard the public API does not answer for draws no board, and says nothing of a widget", async () => {
    answer(false);
    openAt(`?widget=${WIDGET_ID}`);

    render(<DashboardViewPage dashboardId={DASHBOARD_ID} />);

    expect(await screen.findByText("Dashboard not found")).toBeInTheDocument();
    expect(screen.queryByTestId("canvas-stub")).toBeNull();
    expect(infoSpy).not.toHaveBeenCalled();
  });
});
