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

/*
 * Follow-up of #4980: a resource's Overview ended with a Details card that
 * listed every fact the page knows how to show, "—" for each one the
 * resource never reported, and an "Explore telemetry" card of links that
 * repeated the side menu beside it. A new service's Overview read ten
 * Details rows of which two said something, then a second card, "Service
 * Details", that repeated its name.
 *
 * Rendered for real: the shared ResourceOverview with rows some of which
 * are empty, and the Service Overview page over a fake read of the service.
 */

const getItemMock: MockFunction = getJestMockFunction();
const fetchSpanMetricsMock: MockFunction = getJestMockFunction();
const fetchSignalsMock: MockFunction = getJestMockFunction();
const fetchMetricSeriesMock: MockFunction = getJestMockFunction();

const SERVICE_ID: string = "dddddddd-0000-4000-8000-000000000004";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
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
      getFriendlyMessage: (): string => {
        return "failed";
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
        return new ObjectIDType("aaaaaaaa-0000-4000-8000-000000000001");
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
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/telemetryMetrics",
  () => {
    const format: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/telemetryFormat",
    ) as Record<string, unknown>;
    return {
      __esModule: true,
      ...format,
      fetchSpanMetrics: (...args: Array<unknown>): unknown => {
        return fetchSpanMetricsMock(...args);
      },
      fetchLogAndExceptionSignals: (...args: Array<unknown>): unknown => {
        return fetchSignalsMock(...args);
      },
      fetchMetricSeries: (...args: Array<unknown>): unknown => {
        return fetchMetricSeriesMock(...args);
      },
    };
  },
);

// recharts draws nothing in jsdom.
jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return <div data-testid="line-chart" />;
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
      default: () => {
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

/*
 * The page draws no CardModelDetail any more; were it to again, this marker
 * would say so.
 */
jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: { cardProps?: { title?: string } }) => {
      return (
        <div data-testid="card-model-detail">{props.cardProps?.title}</div>
      );
    },
  };
});

import ResourceOverview, {
  ResourceOverviewDetailRow,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ResourceOverview";
import ServiceView from "../../../../App/FeatureSet/Dashboard/src/Pages/Service/View/Index";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import { EDIT_IN_SETTINGS_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/EditInSettingsLink";
import Label from "../../../Models/DatabaseModels/Label";
import Route from "../../../Types/API/Route";
import Color from "../../../Types/Color";
import IconProp from "../../../Types/Icon/IconProp";
import TechStack from "../../../Types/Service/TechStack";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/services/overview"),
  currentProject: null,
  hasPaymentMethod: false,
};

function label(name: string): Label {
  const item: Label = new Label();
  item.name = name;
  item.color = new Color("#4f46e5");
  return item;
}

function renderOverview(
  rows: Array<ResourceOverviewDetailRow>,
  extra: {
    labels?: Array<Label>;
    settingsRoute?: Route;
    description?: string;
  } = {},
): void {
  render(
    <MemoryRouter>
      <ResourceOverview
        icon={IconProp.Database}
        title="orders-db"
        identifier="orders-db:5432"
        identifierLabel="endpoint"
        status="active"
        lastSeenAt={undefined}
        chips={[]}
        tiles={[]}
        detailRows={rows}
        labels={extra.labels}
        settingsRoute={extra.settingsRoute}
        description={extra.description}
      />
    </MemoryRouter>,
  );
}

// The Details card's rows, as label: value.
function detailRows(): Array<string> {
  return screen
    .queryAllByTestId("resource-overview-detail-row")
    .map((row: HTMLElement): string => {
      const term: string = row.querySelector("dt")?.textContent || "";
      const value: string = row.querySelector("dd")?.textContent || "";
      return `${term}: ${value}`;
    });
}

afterEach(() => {
  cleanup();
  jest.clearAllMocks();
});

describe("the Details card says only what the resource reported", () => {
  test("a row with no value is not drawn, and no row reads a dash", () => {
    renderOverview([
      { label: "Engine (db.system.name)", value: "postgresql" },
      { label: "Version", value: undefined },
      { label: "Endpoints", value: "" },
      { label: "Workload", value: "   " },
      { label: "Database ID", value: "6d1c4b2e" },
    ]);

    expect(detailRows()).toEqual([
      "Engine (db.system.name): postgresql",
      "Database ID: 6d1c4b2e",
    ]);
    expect(screen.queryByText("Version")).not.toBeInTheDocument();
    expect(screen.queryByText("Endpoints")).not.toBeInTheDocument();
    expect(screen.queryByText("—")).not.toBeInTheDocument();
  });

  test("a row's element is drawn in place of its value, and only when there is a value", () => {
    renderOverview([
      {
        label: "Agent version",
        value: "14.0.80",
        element: <span data-testid="agent-sign">14.0.80 (outdated)</span>,
      },
      {
        label: "Runs on",
        value: undefined,
        element: <span data-testid="runs-on-link">a cluster</span>,
      },
    ]);

    expect(screen.getByTestId("agent-sign")).toHaveTextContent(
      "14.0.80 (outdated)",
    );
    expect(screen.queryByTestId("runs-on-link")).not.toBeInTheDocument();
    expect(detailRows()).toEqual(["Agent version: 14.0.80 (outdated)"]);
  });

  test("the rows are a description list, in the page's order", () => {
    renderOverview([
      { label: "B", value: "2" },
      { label: "A", value: "1" },
    ]);

    const list: HTMLElement = screen.getByTestId("resource-overview-details");
    expect(list.tagName).toBe("DL");
    expect(detailRows()).toEqual(["B: 2", "A: 1"]);
  });

  test("nothing reported says so in one line, and draws no empty list", () => {
    renderOverview([
      { label: "Cloud Provider", value: undefined },
      { label: "Cloud Region", value: "" },
    ]);

    expect(screen.getByTestId("resource-overview-no-details")).toHaveTextContent(
      "No details reported yet.",
    );
    expect(
      screen.queryByTestId("resource-overview-details"),
    ).not.toBeInTheDocument();
  });

  test("there is never an Explore telemetry card", () => {
    renderOverview([{ label: "Database ID", value: "6d1c4b2e" }]);

    expect(screen.queryByText("Explore telemetry")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Drill into the raw signals for this resource."),
    ).not.toBeInTheDocument();
  });

  test("the labels have their card, and Edit in Settings is on the Details card", () => {
    renderOverview([{ label: "Database ID", value: "6d1c4b2e" }], {
      labels: [label("payments")],
      settingsRoute: new Route("/dashboard/p/databases/1/settings"),
      description: "The orders database.",
    });

    expect(screen.getByText("Labels")).toBeInTheDocument();
    expect(screen.getByText("payments")).toBeInTheDocument();
    expect(screen.getByTestId(EDIT_IN_SETTINGS_TEST_ID)).toBeInTheDocument();
    // The resource's description is the Details card's line.
    expect(screen.getByText("The orders database.")).toBeInTheDocument();
  });
});

describe("the Service Overview has one Details card", () => {
  beforeEach(() => {
    fetchSpanMetricsMock.mockImplementation(async () => {
      return {
        total: 10,
        errors: 0,
        errorRatePercent: 0,
        p95DurationMs: 12,
        countSeries: [],
        errorSeries: [],
        p95Series: [],
      };
    });
    fetchSignalsMock.mockImplementation(async () => {
      return {
        logs: {
          total: 0,
          errorCount: 0,
          countSeries: [],
          errorSeries: [],
          failed: false,
        },
        exceptions: {
          total: 0,
          unhandledCount: 0,
          unhandledSeries: [],
          handledSeries: [],
          failed: false,
        },
      };
    });
    fetchMetricSeriesMock.mockImplementation(async () => {
      return [];
    });
  });

  async function renderService(service: Record<string, unknown>): Promise<void> {
    getItemMock.mockImplementation(async () => {
      return { name: "checkout", ...service };
    });

    render(
      <MemoryRouter>
        <ServiceView {...PAGE_PROPS} />
      </MemoryRouter>,
    );

    await screen.findByTestId("resource-overview-details");
  }

  test("a new service: its ID and detected language, nothing empty, no second card", async () => {
    await renderService({ telemetrySdkLanguage: "nodejs" });

    expect(detailRows()).toEqual([
      `Service ID: ${SERVICE_ID}`,
      "Technology: Node.js",
    ]);
    expect(screen.queryByText("Cloud Provider")).not.toBeInTheDocument();
    expect(screen.queryByText("Service Namespace")).not.toBeInTheDocument();
    expect(screen.queryByTestId("card-model-detail")).not.toBeInTheDocument();
    expect(screen.queryByText("Service Details")).not.toBeInTheDocument();
    expect(screen.queryByText("Explore telemetry")).not.toBeInTheDocument();
    // One SDK language: the Technology row says it, no second row.
    expect(
      screen.queryByText("SDK Language (telemetry.sdk.language)"),
    ).not.toBeInTheDocument();
  });

  test("a reported service: every fact it reported, in order, and only those", async () => {
    await renderService({
      telemetrySdkLanguage: "python",
      runtimeName: "CPython",
      runtimeVersion: "3.12.4",
      serviceVersion: "2.7.0",
      deploymentEnvironment: "production",
      cloudProvider: "aws",
      cloudRegion: "eu-west-1",
    });

    expect(detailRows()).toEqual([
      `Service ID: ${SERVICE_ID}`,
      "Technology: Python",
      "Runtime: CPython 3.12.4",
      "Service Version: 2.7.0",
      "Deployment Environment: production",
      "Cloud Provider: aws",
      "Cloud Region: eu-west-1",
    ]);
  });

  test("a tech stack set in Settings is the Technology row", async () => {
    await renderService({
      telemetrySdkLanguage: "nodejs",
      techStack: [TechStack.React, TechStack.NodeJS],
    });

    const technology: HTMLElement | undefined = screen
      .queryAllByTestId("resource-overview-detail-row")
      .find((row: HTMLElement): boolean => {
        return row.querySelector("dt")?.textContent === "Technology";
      });

    expect(technology).toBeDefined();
    expect(
      within(technology as HTMLElement).getByText(TechStack.React),
    ).toBeInTheDocument();
  });

  test("its labels are the Labels card, and its settings one link on Details", async () => {
    await renderService({
      telemetrySdkLanguage: "go",
      labels: [label("checkout-team")],
    });

    expect(screen.getByText("checkout-team")).toBeInTheDocument();
    expect(screen.getAllByTestId(EDIT_IN_SETTINGS_TEST_ID)).toHaveLength(1);
  });

  test("the service is read with its labels, for the Labels card", async () => {
    await renderService({ telemetrySdkLanguage: "go" });

    const select: Record<string, unknown> = (
      getItemMock.mock.calls[0]?.[0] as { select: Record<string, unknown> }
    ).select;

    expect(select["labels"]).toEqual({ name: true, color: true });
    expect(select["techStack"]).toBe(true);
    expect(select["description"]).toBe(true);
  });
});
