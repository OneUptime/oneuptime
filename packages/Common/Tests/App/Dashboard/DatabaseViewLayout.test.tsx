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
import * as React from "react";
import { MemoryRouter, Route as RouterRoute, Routes } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A database's view layout, around its Settings tab, against two things
 * the end-to-end run saw:
 *
 *   - after deleting 3a84ec60, /databases/3a84ec60… still rendered its
 *     tabs ("Database - undefined", forms and tables of nothing): the API
 *     answers a missing id with `{}`, an EMPTY model, never null;
 *   - after a rename in Settings the header kept "Database - PostgreSQL
 *     10.1.2.3:5432" until a reload.
 */

const MODEL_ID_STRING: string = "3a84ec60-1111-4aaa-8bbb-000000000001";

const getItemMock: MockFunction = getJestMockFunction();
const modelPageMock: MockFunction = getJestMockFunction();

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

jest.mock("../../../UI/Components/Page/ModelPage", () => {
  return {
    __esModule: true,
    default: (props: { refreshToken?: number; children?: React.ReactNode }) => {
      modelPageMock(props);
      return (
        <div data-testid="model-page" data-refresh={props.refreshToken ?? ""}>
          {props.children}
        </div>
      );
    },
  };
});

jest.mock("../../../UI/Components/ErrorMessage/ErrorMessage", () => {
  return {
    __esModule: true,
    default: (props: { message: string }) => {
      return <div data-testid="error-message">{props.message}</div>;
    },
  };
});

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs", () => {
  return {
    __esModule: true,
    getDatabaseBreadcrumbs: () => {
      return undefined;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Database/View/SideMenu",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <nav data-testid="side-menu" />;
      },
    };
  },
);

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: { onSaveSuccess?: (item: unknown) => void }) => {
      return (
        <button
          onClick={() => {
            props.onSaveSuccess?.({});
          }}
        >
          Save settings
        </button>
      );
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/TelemetryResourceRetentionSettings",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ArchiveResourceCard",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div />;
      },
    };
  },
);

jest.mock("../../../UI/Components/Alerts/Alert", () => {
  return {
    __esModule: true,
    AlertType: { INFO: "info" },
    default: () => {
      return <div />;
    },
  };
});

import DatabaseServerViewLayout from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/View/Layout";
import DatabaseServerSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/View/Settings";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/test/databases/test"),
  currentProject: null,
  hasPaymentMethod: true,
};

async function renderSettingsTab(): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[`/databases/${MODEL_ID_STRING}/settings`]}>
        <Routes>
          <RouterRoute
            path="/databases/:id"
            element={<DatabaseServerViewLayout {...PAGE_PROPS} />}
          >
            <RouterRoute
              path="settings"
              element={<DatabaseServerSettings {...PAGE_PROPS} />}
            />
          </RouterRoute>
        </Routes>
      </MemoryRouter>,
    );
  });
}

beforeEach(() => {
  getItemMock.mockReset();
  modelPageMock.mockReset();
  jest.spyOn(Navigation, "getRoutePath").mockReturnValue("");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the database view layout", () => {
  test("a deleted database (the API's `{}`) is 'Database not found.' on every tab", async () => {
    getItemMock.mockResolvedValue(new DatabaseServer());

    await renderSettingsTab();

    expect(await screen.findByTestId("error-message")).toHaveTextContent(
      "Database not found.",
    );
    expect(
      screen.queryByRole("button", { name: "Save settings" }),
    ).not.toBeInTheDocument();
  });

  test("a rename in Settings reads the page header again", async () => {
    const row: DatabaseServer = new DatabaseServer();
    row.id = new ObjectID(MODEL_ID_STRING);
    getItemMock.mockResolvedValue(row);

    await renderSettingsTab();

    const page: HTMLElement = screen.getByTestId("model-page");
    expect(page).toHaveAttribute("data-refresh", "0");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save settings" }));
    });

    expect(screen.getByTestId("model-page")).toHaveAttribute(
      "data-refresh",
      "1",
    );
    expect(screen.queryByTestId("error-message")).not.toBeInTheDocument();
  });

  test("a failed lookup is not 'not found': the tab stays and reports its own errors", async () => {
    getItemMock.mockRejectedValue(new Error("network"));

    await renderSettingsTab();

    expect(
      screen.getByRole("button", { name: "Save settings" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("error-message")).not.toBeInTheDocument();
  });
});
