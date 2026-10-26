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
  screen,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * A manual monitor's Criteria page (#4964's line: "reachable only by URL").
 *
 * A manual monitor has no criteria - someone sets its status - so its menu
 * lists no Criteria page: an entry that only opened "there is nothing here"
 * would be one more row to read on every visit. The address still answers -
 * an old bookmark, a link someone shared - and says why there is nothing,
 * with one way on: Go to Overview, where the status is set from the ⋯ menu.
 * A monitor with criteria keeps its Criteria page and menu entry.
 */

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
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      count: (): Promise<number> => {
        return Promise.resolve(0);
      },
      getList: (): Promise<unknown> => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
      },
    },
  };
});

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/Probe", () => {
  return {
    __esModule: true,
    default: {
      getAllProbes: (): Promise<Array<unknown>> => {
        return Promise.resolve([]);
      },
    },
  };
});

// The criteria card of a monitor that has criteria; it has its own suites.
jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: { cardProps?: { title?: string } }): ReactElement => {
      return (
        <div data-testid="criteria-card">
          <h2>{props.cardProps?.title}</h2>
        </div>
      );
    },
  };
});

import MonitorCriteriaPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/View/Criteria";
import MonitorSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/View/SideMenu";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Route from "../../../Types/API/Route";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import { goTo, PROJECT_ID, renderMenu, titlesInMenu } from "./SideMenuHarness";

const MONITOR_ID: string = "8d8d8d8d-0000-4000-8000-0000000000c1";
const MONITOR_PATH: string = `/dashboard/${PROJECT_ID}/monitors/${MONITOR_ID}`;
const CRITERIA_PATH: string = `${MONITOR_PATH}/criteria`;

const PAGE_PROPS: PageComponentProps = {
  pageRoute: RouteMap[PageMap.MONITOR_VIEW_CRITERIA] as Route,
  currentProject: null,
  hasPaymentMethod: true,
} as unknown as PageComponentProps;

let monitorType: MonitorType = MonitorType.Manual;

beforeEach(() => {
  monitorType = MonitorType.Manual;
  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    const monitor: Monitor = new Monitor();
    monitor._id = MONITOR_ID;
    monitor.monitorType = monitorType;
    return monitor;
  });
  goTo(CRITERIA_PATH);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderPage(): Promise<void> {
  render(<MonitorCriteriaPage {...PAGE_PROPS} />);

  await act(async () => {
    for (let i: number = 0; i < 20; i++) {
      await Promise.resolve();
    }
  });
}

describe("a manual monitor's Criteria address", () => {
  test("says there are no criteria, and where the status is set", async () => {
    await renderPage();

    expect(
      screen.getByRole("heading", { name: "No Criteria for Manual Monitors" }),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("monitoring-criteria-empty-state-description"),
    ).toHaveTextContent(
      "A manual monitor has no criteria: you set its status yourself, from the ⋯ menu on its overview.",
    );
    expect(screen.queryByTestId("criteria-card")).toBeNull();
  });

  test("is no dead end: Go to Overview opens the monitor's overview", async () => {
    const navigate: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      Navigation,
      "navigate",
    ).mockImplementation((): void => {});

    await renderPage();

    const button: HTMLElement = screen.getByRole("button", {
      name: "Go to Overview",
    });

    expect(
      screen.getByTestId("monitoring-criteria-empty-state-footer"),
    ).toContainElement(button);
    expect(button).toHaveAttribute(
      "data-testid",
      "manual-monitor-criteria-go-to-overview",
    );

    fireEvent.click(button);

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(String(navigate.mock.calls[0]![0])).toBe(MONITOR_PATH);
  });

  test("a monitor with criteria draws its criteria card, with no way out offered", async () => {
    monitorType = MonitorType.Website;

    await renderPage();

    expect(screen.getByTestId("criteria-card")).toHaveTextContent(
      "Monitoring Criteria",
    );
    expect(screen.queryByRole("button", { name: "Go to Overview" })).toBeNull();
  });
});

describe("the monitor's menu", () => {
  async function menuTitles(type: MonitorType): Promise<Array<string>> {
    goTo(MONITOR_PATH);
    await renderMenu(
      <MonitorSideMenu modelId={new ObjectID(MONITOR_ID)} monitorType={type} />,
    );
    const titles: Array<string> = titlesInMenu();
    cleanup();
    return titles;
  }

  test("lists no Criteria page for a manual monitor, which has none", async () => {
    expect(await menuTitles(MonitorType.Manual)).not.toContain("Criteria");
  });

  test("lists Criteria for a monitor that has criteria", async () => {
    expect(await menuTitles(MonitorType.Website)).toContain("Criteria");
  });
});
