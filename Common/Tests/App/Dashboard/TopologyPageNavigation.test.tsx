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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import InventoryItem from "../../../Models/DatabaseModels/InventoryItem";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import EntityType from "../../../Types/Telemetry/EntityType";
import TopologyPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Topology/TopologyPage";

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return new ObjectID("dde060c6-fe0d-49ce-b44c-4035a13bc1db");
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (error: unknown): string => {
        return error instanceof Error
          ? error.message
          : "Unable to load topology";
      },
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

jest.mock("../../../UI/Components/Page/Page", () => {
  return {
    __esModule: true,
    default: (props: { children: React.ReactNode }): React.ReactElement => {
      return <main>{props.children}</main>;
    },
  };
});

jest.mock(
  "../../../UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return (
          <div data-testid="topology-time-picker">Connection time range</div>
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Topology/ServiceMapGraph",
  () => {
    return {
      __esModule: true,
      default: (props: {
        entities: Array<InventoryItem>;
      }): React.ReactElement => {
        return (
          <div data-testid="topology-services">
            Services:{" "}
            {props.entities
              .map((entity: InventoryItem): string => {
                return entity.displayName || "";
              })
              .join(",")}
          </div>
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Topology/InfrastructureGraph",
  () => {
    return {
      __esModule: true,
      default: (props: {
        entities: Array<InventoryItem>;
      }): React.ReactElement => {
        return (
          <div data-testid="topology-infrastructure">
            Infrastructure:{" "}
            {props.entities
              .map((entity: InventoryItem): string => {
                return entity.displayName || "";
              })
              .join(",")}
          </div>
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Topology/InfrastructureExplorer",
  () => {
    return {
      __esModule: true,
      default: (props: {
        entities: Array<InventoryItem>;
      }): React.ReactElement => {
        return (
          <div data-testid="topology-infrastructure">
            Infrastructure:{" "}
            {props.entities
              .map((entity: InventoryItem): string => {
                return entity.displayName || "";
              })
              .join(",")}
          </div>
        );
      },
    };
  },
  { virtual: true },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Topology/NetworkTopologyExplorer",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return <div data-testid="topology-network">Live network discovery</div>;
      },
    };
  },
);

function renderPage(): void {
  render(
    <MemoryRouter>
      <TopologyPage
        pageRoute={new Route("/topology/overview")}
        currentProject={null}
        hasPaymentMethod={true}
      />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getListMock.mockReset();
  getListMock.mockResolvedValue({ data: [], count: 0, skip: 0, limit: 1000 });
  window.history.replaceState({}, "", "/dashboard/project/topology/overview");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("topology map navigation and data isolation", () => {
  test("opens live Network while telemetry requests are still pending", async () => {
    getListMock.mockReturnValue(new Promise(() => {}));
    renderPage();
    fireEvent.click(await screen.findByRole("tab", { name: "Network" }));
    expect(screen.getByTestId("topology-network")).toBeVisible();
    expect(
      screen.queryByTestId("topology-time-picker"),
    ).not.toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get("tab")).toBe(
      "Network",
    );
  });

  test("telemetry failures stay inside their map tabs and can be retried", async () => {
    getListMock.mockRejectedValue(
      new Error("Telemetry is temporarily unavailable"),
    );
    renderPage();
    await screen.findByText("Telemetry is temporarily unavailable");
    fireEvent.click(screen.getByRole("tab", { name: "Network" }));
    expect(screen.getByTestId("topology-network")).toBeVisible();
    expect(
      screen.queryByText("Telemetry is temporarily unavailable"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Infrastructure" }));
    expect(
      screen.getByText("Telemetry is temporarily unavailable"),
    ).toBeVisible();
    getListMock.mockResolvedValue({ data: [], count: 0, skip: 0, limit: 1000 });
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByTestId("topology-infrastructure")).toBeVisible();
    expect(
      screen.queryByText("Telemetry is temporarily unavailable"),
    ).not.toBeInTheDocument();
  });

  test("Service Map and Infrastructure share the same loaded catalog without refetching on a tab change", async () => {
    const entity: InventoryItem = new InventoryItem();
    entity.entityKey = "checkout";
    entity.displayName = "Checkout API";
    entity.entityType = EntityType.Service;
    getListMock.mockResolvedValueOnce({
      data: [entity],
      count: 1,
      skip: 0,
      limit: 1000,
    });
    getListMock.mockResolvedValueOnce({
      data: [],
      count: 0,
      skip: 0,
      limit: 1000,
    });
    renderPage();
    expect(await screen.findByTestId("topology-services")).toHaveTextContent(
      "Checkout API",
    );
    fireEvent.click(screen.getByRole("tab", { name: "Infrastructure" }));
    expect(screen.getByTestId("topology-infrastructure")).toHaveTextContent(
      "Checkout API",
    );
    fireEvent.click(screen.getByRole("tab", { name: "Service Map" }));
    expect(screen.getByTestId("topology-services")).toHaveTextContent(
      "Checkout API",
    );
    expect(getListMock).toHaveBeenCalledTimes(2);
  });

  test.each(["Infrastructure", "Network"])(
    "restores a shared %s link on the first render",
    async (tab: string) => {
      window.history.replaceState({}, "", `?tab=${encodeURIComponent(tab)}`);
      renderPage();
      await waitFor(() => {
        expect(screen.getByRole("tab", { name: tab })).toHaveAttribute(
          "aria-selected",
          "true",
        );
      });
      if (tab === "Network") {
        expect(screen.getByTestId("topology-network")).toBeVisible();
        expect(
          screen.queryByTestId("topology-time-picker"),
        ).not.toBeInTheDocument();
      } else {
        expect(
          await screen.findByTestId("topology-infrastructure"),
        ).toBeVisible();
        expect(screen.getByTestId("topology-time-picker")).toBeVisible();
      }
    },
  );

  test("an invalid tab falls back to Service Map and preserves both maps' search state", async () => {
    window.history.replaceState(
      {},
      "",
      "?tab=Missing&search=checkout&infraSearch=worker",
    );
    renderPage();
    expect(await screen.findByTestId("topology-services")).toBeVisible();
    fireEvent.click(screen.getByRole("tab", { name: "Infrastructure" }));
    fireEvent.click(screen.getByRole("tab", { name: "Service Map" }));
    const query: URLSearchParams = new URLSearchParams(window.location.search);
    expect(query.has("tab")).toBe(false);
    expect(query.get("search")).toBe("checkout");
    expect(query.get("infraSearch")).toBe("worker");
  });

  test("keyboard navigation switches maps and updates the shareable tab", async () => {
    renderPage();
    await screen.findByTestId("topology-services");
    const serviceTab: HTMLElement = screen.getByRole("tab", {
      name: "Service Map",
    });
    serviceTab.focus();
    fireEvent.keyDown(serviceTab, { key: "ArrowRight" });
    await waitFor(() => {
      expect(
        screen.getByRole("tab", { name: "Infrastructure" }),
      ).toHaveAttribute("aria-selected", "true");
    });
    expect(new URLSearchParams(window.location.search).get("tab")).toBe(
      "Infrastructure",
    );
    expect(screen.getByRole("tab", { name: "Infrastructure" })).toHaveFocus();
  });
});
