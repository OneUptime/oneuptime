import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The cluster Insights page draws three sections. Two are metric-query
 * charts that caption every chart they draw; the third is the network
 * throughput chart, which has no title or caption of its own - so its
 * section title carries the (i). EmbeddedMetricCard is reduced to its title,
 * caption, children and the chart titles of its queries; the throughput
 * chart is stubbed. The section-title helper and the (i) are real.
 */

const mockEmbeddedCards: Array<{
  queryTitles: Array<string>;
  queryDescriptions: Array<string>;
}> = [];

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("0193c0de-9999-4aaa-8bbb-000000000009");
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: () => {
        return Promise.resolve({ clusterIdentifier: "production-us-east-1" });
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: () => {
        return "Could not load";
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: () => {
        return Promise.resolve({ data: [] });
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/EmbeddedMetricCard",
  () => {
    return {
      __esModule: true,
      default: (props: {
        title?: React.ReactNode;
        description?: React.ReactNode;
        children?: React.ReactNode;
        queryConfigs?: Array<{
          metricAliasData?: { title?: string; description?: string };
        }>;
      }) => {
        mockEmbeddedCards.push({
          queryTitles: (props.queryConfigs || []).map(
            (config: { metricAliasData?: { title?: string } }): string => {
              return config.metricAliasData?.title || "";
            },
          ),
          queryDescriptions: (props.queryConfigs || []).map(
            (config: {
              metricAliasData?: { description?: string };
            }): string => {
              return config.metricAliasData?.description || "";
            },
          ),
        });
        return (
          <section data-testid="embedded-metric-card">
            <h2>{props.title}</h2>
            <p>{props.description}</p>
            {props.children}
          </section>
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/KubernetesNetworkThroughputChart",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="network-throughput-chart" />;
      },
    };
  },
);

import KubernetesClusterInsights from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/View/Insights";
import { KUBERNETES_CLUSTER_METRIC_DESCRIPTIONS } from "../../../../App/FeatureSet/Dashboard/src/Components/MetricDescriptions/KubernetesClusterMetricDescriptions";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";

const PAGE_PROPS: PageComponentProps = {} as PageComponentProps;

const ABOUT: RegExp = /^About /;

beforeEach(() => {
  jest.useFakeTimers();
  mockEmbeddedCards.length = 0;
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

async function renderInsights(): Promise<void> {
  render(<KubernetesClusterInsights {...PAGE_PROPS} />);
  await screen.findByTestId("network-throughput-chart");
}

describe("cluster Insights page", () => {
  test("only the untitled network chart's section carries an (i)", async () => {
    await renderInsights();

    expect(
      screen
        .getAllByRole("button", { name: ABOUT })
        .map((button: HTMLElement): string => {
          return button.getAttribute("aria-label") || "";
        }),
    ).toEqual(["About Network"]);
  });

  test("the network (i) explains the throughput chart", async () => {
    await renderInsights();

    const info: HTMLElement = screen.getByRole("button", {
      name: "About Network",
    });

    fireEvent.mouseEnter(info);
    await act(async () => {
      jest.advanceTimersByTime(250);
    });

    const describedBy: string | null = info.getAttribute("aria-describedby");

    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)).toHaveTextContent(
      KUBERNETES_CLUSTER_METRIC_DESCRIPTIONS.networkThroughput,
    );
    expect(info.closest("h2")).toHaveTextContent("Network");
  });

  test("the sections without an (i) caption every chart they draw", async () => {
    await renderInsights();

    const withQueries: Array<{
      queryTitles: Array<string>;
      queryDescriptions: Array<string>;
    }> = mockEmbeddedCards.filter(
      (card: { queryTitles: Array<string> }): boolean => {
        return card.queryTitles.length > 0;
      },
    );

    expect(withQueries.length).toBeGreaterThanOrEqual(2);

    for (const card of withQueries) {
      for (const description of card.queryDescriptions) {
        expect(description.length).toBeGreaterThan(10);
      }
    }
  });
});
