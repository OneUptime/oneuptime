import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import * as React from "react";

/*
 * The Active Incidents and Active Alerts pages, and the badges that count
 * them in the side menus, list the records still open by the one rule
 * (Common/Utils/ResolvedState): in a state above the project's resolved
 * state. A state of the project's own placed after Resolved - "Closed",
 * without the resolved flag - is over: its records leave the Active list and
 * the badge, as they leave the reminders, the status pages and the counts
 * everywhere else. Reading the flag alone kept them on both.
 *
 * The project's states are served by a stub of ModelAPI.getList; the badge's
 * count and the table's query are what is checked.
 */

interface CountCall {
  table: string;
  query: Record<string, unknown>;
}

const mockCounts: Array<CountCall> = [];
const mockTableQueries: Array<Record<string, unknown>> = [];

// Identified, Acknowledged, Resolved (flagged) and Closed after it.
const mockStateIds: Record<string, string> = {
  identified: "7d1b2c3d-0000-4000-8000-0000000000a1",
  acknowledged: "7d1b2c3d-0000-4000-8000-0000000000a2",
  resolved: "7d1b2c3d-0000-4000-8000-0000000000a3",
  closed: "7d1b2c3d-0000-4000-8000-0000000000a4",
};

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  function mockStates(modelType: new () => unknown): Array<unknown> {
    const rows: Array<[string, number, string | null]> = [
      [mockStateIds["identified"]!, 1, "isCreatedState"],
      [mockStateIds["acknowledged"]!, 2, "isAcknowledgedState"],
      [mockStateIds["resolved"]!, 3, "isResolvedState"],
      [mockStateIds["closed"]!, 4, null],
    ];

    return rows.map((row: [string, number, string | null]): unknown => {
      const state: Record<string, unknown> = new modelType() as Record<
        string,
        unknown
      >;
      state["_id"] = row[0];
      state["order"] = row[1];
      state["isCreatedState"] = row[2] === "isCreatedState";
      state["isAcknowledgedState"] = row[2] === "isAcknowledgedState";
      state["isResolvedState"] = row[2] === "isResolvedState";
      return state;
    });
  }

  return {
    __esModule: true,
    default: {
      count: (request: {
        modelType: new () => { tableName?: string };
        query: Record<string, unknown>;
      }): Promise<number> => {
        mockCounts.push({
          table: new request.modelType().tableName || "",
          query: request.query,
        });
        return Promise.resolve(0);
      },
      getList: (request: {
        modelType: new () => { tableName?: string };
      }): Promise<unknown> => {
        const table: string = new request.modelType().tableName || "";
        const data: Array<unknown> =
          table === "IncidentState" || table === "AlertState"
            ? mockStates(request.modelType as unknown as new () => unknown)
            : [];
        return Promise.resolve({
          data: data,
          count: data.length,
          skip: 0,
          limit: data.length,
        });
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentsTable",
  () => {
    return {
      __esModule: true,
      default: (props: { query: Record<string, unknown> }): null => {
        mockTableQueries.push(props.query);
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Alert/AlertsTable",
  () => {
    return {
      __esModule: true,
      default: (props: { query: Record<string, unknown> }): null => {
        mockTableQueries.push(props.query);
        return null;
      },
    };
  },
);

import IncidentsSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/SideMenu";
import AlertsSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/SideMenu";
import ActiveIncidentsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Unresolved";
import ActiveAlertsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/Unresolved";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import Includes from "../../../Types/BaseDatabase/Includes";
import Route from "../../../Types/API/Route";
import ModelListCache from "../../../UI/Utils/ModelListCache";
import { DESKTOP_WIDTH, PROJECT_ID, goTo, setViewportWidth } from "./SideMenuHarness";

const OPEN_STATE_IDS: Array<string> = [
  mockStateIds["identified"]!,
  mockStateIds["acknowledged"]!,
];

const pageProps: PageComponentProps = {
  pageRoute: new Route("/active"),
  currentProject: null,
  hasPaymentMethod: false,
};

function idsIn(filter: unknown): Array<string> {
  expect(filter).toBeInstanceOf(Includes);
  return (filter as Includes).values.map((value: unknown): string => {
    return String(value).toLowerCase();
  });
}

beforeEach(() => {
  mockCounts.length = 0;
  mockTableQueries.length = 0;
  ModelListCache.invalidateAll();
  setViewportWidth(DESKTOP_WIDTH);
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe.each([
  {
    name: "incidents",
    path: "incidents",
    menu: IncidentsSideMenu,
    page: ActiveIncidentsPage,
    table: "Incident",
    column: "currentIncidentStateId",
  },
  {
    name: "alerts",
    path: "alerts",
    menu: AlertsSideMenu,
    page: ActiveAlertsPage,
    table: "Alert",
    column: "currentAlertStateId",
  },
])(
  "Active $name",
  (kind: {
    name: string;
    path: string;
    menu: React.FunctionComponent<Record<string, unknown>>;
    page: React.FunctionComponent<PageComponentProps>;
    table: string;
    column: string;
  }) => {
    beforeEach(() => {
      goTo(`/dashboard/${PROJECT_ID}/${kind.path}`);
    });

    test("the menu badge counts the records in a state above the resolved one - not Closed, after it", async () => {
      const Menu: React.FunctionComponent<Record<string, unknown>> = kind.menu;

      await act(async () => {
        render(<Menu />);
      });

      await waitFor(() => {
        expect(
          mockCounts.some((call: CountCall): boolean => {
            return call.table === kind.table && kind.column in call.query;
          }),
        ).toBe(true);
      });

      const badge: CountCall = mockCounts.find((call: CountCall): boolean => {
        return call.table === kind.table && kind.column in call.query;
      })!;

      expect(idsIn(badge.query[kind.column]).sort()).toEqual(
        [...OPEN_STATE_IDS].sort(),
      );
      expect(idsIn(badge.query[kind.column])).not.toContain(
        mockStateIds["closed"],
      );
      // Not the flag alone, which kept Closed on the badge.
      expect(JSON.stringify(badge.query)).not.toContain("isResolvedState");
    });

    test("the Active page lists the records in a state above the resolved one", async () => {
      const Page: React.FunctionComponent<PageComponentProps> = kind.page;

      await act(async () => {
        render(<Page {...pageProps} />);
      });

      await waitFor(() => {
        expect(mockTableQueries.length).toBeGreaterThan(0);
      });

      const query: Record<string, unknown> =
        mockTableQueries[mockTableQueries.length - 1]!;

      expect(idsIn(query[kind.column]).sort()).toEqual(
        [...OPEN_STATE_IDS].sort(),
      );
      expect(JSON.stringify(query)).not.toContain("isResolvedState");
    });
  },
);
