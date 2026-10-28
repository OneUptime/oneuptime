/** @timezone UTC */

import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * Metrics > Insights: the services reporting metrics, a card each
 * (Components/Metrics/MetricsDashboard). #5256 made a row of them end on one
 * line and was checked in code only; drawn in a browser at every width
 * (packages/E2E/MetricsAi/MetricsInsights.spec.ts), a long metric name ran
 * past its card and the page scrolled sideways, a long service name pushed
 * its row's counts down by a line or two, and each card was a link with
 * another link inside it. This holds the card's markup: one link, three
 * rows shared with the cards beside it, a name of two lines at most with
 * its whole name under the pointer, and names that wrap inside their chips
 * after their own dots. The browser suite measures them.
 */

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const CHECKOUT_ID: string = "52310000-0000-4000-8000-0000000000a1";
const WORKER_ID: string = "52310000-0000-4000-8000-0000000000a2";
const NOTIFICATIONS_ID: string = "52310000-0000-4000-8000-0000000000a7";

const LONG_SERVICE: string = "storefront-checkout-service-eu-west-1-production";
const LONG_METRIC: string =
  "com.acme.storefront.checkout.payment_authorization.gateway_round_trip_milliseconds";

const CHECKOUT_METRICS: Array<string> = [
  "http.server.request.duration",
  "http.server.active_requests",
  "db.client.connections.usage",
  LONG_METRIC,
  "process.cpu.time",
  "process.memory.usage",
  "checkout.orders.placed",
  "checkout.cart.value",
];

const WORKER_METRICS: Array<string> = [
  "messaging.process.duration",
  "worker.jobs.completed",
  "process.memory.usage",
];

const NOTIFICATIONS_METRICS: Array<string> = ["notifications.sent"];

// Sent with no service.name: the server tags them with the project's id.
const UNATTRIBUTED_METRICS: Array<string> = [
  "otelcol_exporter_sent_metric_points",
];

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        const ObjectIDModule: { default: new (id: string) => unknown } =
          jest.requireActual("../../../Types/ObjectID") as {
            default: new (id: string) => unknown;
          };
        return new ObjectIDModule.default(
          "11111111-1111-4111-8111-111111111111",
        );
      },
    },
  };
});

jest.mock("../../../UI/Utils/Telemetry/UseTelemetryEntityNames", () => {
  return {
    __esModule: true,
    default: () => {
      return new Map();
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: async (options: {
        modelType: { new (): { tableName?: string } };
      }) => {
        const ServiceModule: {
          default: new () => {
            _id?: string;
            name?: string;
            serviceColor?: unknown;
          };
        } = jest.requireActual(
          "../../../Models/DatabaseModels/Service",
        ) as never;

        if (options.modelType === ServiceModule.default) {
          const named: (id: string, name: string) => unknown = (
            id: string,
            name: string,
          ): unknown => {
            const service: { _id?: string; name?: string } =
              new ServiceModule.default();
            service._id = id;
            service.name = name;
            return service;
          };

          const services: Array<unknown> = [
            named(CHECKOUT_ID, LONG_SERVICE),
            named(NOTIFICATIONS_ID, "notifications"),
            named(WORKER_ID, "worker"),
          ];

          return { data: services, count: services.length };
        }

        return { data: [], count: 0 };
      },
      getItem: async () => {
        return null;
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: async () => {
        const MetricModule: {
          default: new () => {
            name?: string;
            primaryEntityId?: unknown;
            time?: Date;
          };
        } = jest.requireActual(
          "../../../Models/AnalyticsModels/Metric",
        ) as never;
        const ObjectIDModule: { default: new (id: string) => unknown } =
          jest.requireActual("../../../Types/ObjectID") as {
            default: new (id: string) => unknown;
          };

        const points: Array<unknown> = [];
        const add: (entityId: string, names: Array<string>) => void = (
          entityId: string,
          names: Array<string>,
        ): void => {
          for (const name of names) {
            const point: {
              name?: string;
              primaryEntityId?: unknown;
              time?: Date;
            } = new MetricModule.default();
            point.name = name;
            point.primaryEntityId = new ObjectIDModule.default(entityId);
            point.time = new Date("2026-10-24T11:30:00.000Z");
            points.push(point);
          }
        };

        add(CHECKOUT_ID, CHECKOUT_METRICS);
        add(WORKER_ID, WORKER_METRICS);
        add(NOTIFICATIONS_ID, NOTIFICATIONS_METRICS);
        add("11111111-1111-4111-8111-111111111111", UNATTRIBUTED_METRICS);

        return { data: points, count: points.length };
      },
    },
  };
});

import MetricsDashboard, {
  METRICS_NAME_CHIP_CLASS_NAME,
  METRICS_SERVICE_CARD_CLASS_NAME,
  METRICS_SERVICE_CARD_LINK_CLASS_NAME,
  METRICS_SERVICE_GRID_CLASS_NAME,
  METRICS_SERVICE_NAME_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricsDashboard";

afterEach(() => {
  cleanup();
});

async function renderCards(): Promise<Array<HTMLElement>> {
  render(
    <MemoryRouter>
      <MetricsDashboard />
    </MemoryRouter>,
  );

  await screen.findByTestId("metrics-service-cards");

  return screen.getAllByTestId("metrics-service-card");
}

function tokens(className: string): Array<string> {
  return className.split(" ");
}

function nameOf(card: HTMLElement): HTMLElement {
  return within(card).getByTestId("metrics-service-card-name");
}

describe("Metrics > Insights: a card for each service reporting metrics", () => {
  test("the busiest first, and the points no service sent last, as Unknown Service", async () => {
    const cards: Array<HTMLElement> = await renderCards();

    expect(
      cards.map((card: HTMLElement): string => {
        return nameOf(card).textContent || "";
      }),
    ).toEqual([LONG_SERVICE, "worker", "notifications", "Unknown Service"]);
  });

  test("each card is one link - to the service's metrics, or for the unattributed points to the viewer - with no link inside it", async () => {
    const cards: Array<HTMLElement> = await renderCards();

    for (const card of cards) {
      const link: HTMLAnchorElement | null = card.closest("a");

      expect(link).not.toBeNull();
      // The name used to be a link of its own, to the service's page.
      expect(link!.querySelectorAll("a")).toHaveLength(0);
      expect(card.querySelectorAll("a")).toHaveLength(0);
    }

    expect(cards[0]!.closest("a")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/service/${CHECKOUT_ID}/metrics`,
    );
    expect(cards[cards.length - 1]!.closest("a")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/metrics`,
    );
  });

  test("a card's three rows are the grid's rows, shared with the cards beside it", async () => {
    const cards: Array<HTMLElement> = await renderCards();
    const grid: HTMLElement = screen.getByTestId("metrics-service-cards");

    expect(grid).toHaveClass(...tokens(METRICS_SERVICE_GRID_CLASS_NAME));

    for (const card of cards) {
      const link: HTMLElement = card.closest("a")!;

      expect(link).toHaveClass(...tokens(METRICS_SERVICE_CARD_LINK_CLASS_NAME));
      expect(card).toHaveClass(...tokens(METRICS_SERVICE_CARD_CLASS_NAME));
      // The service, its figures, its names: three rows, in that order.
      expect(card.children).toHaveLength(3);
      expect(
        within(card.children[0] as HTMLElement).getByTestId(
          "metrics-service-card-name",
        ),
      ).toBeInTheDocument();
      expect(
        within(card.children[2] as HTMLElement).getAllByTestId(
          "metrics-service-card-metric",
        ).length,
      ).toBeGreaterThan(0);
    }

    for (const className of [
      METRICS_SERVICE_CARD_LINK_CLASS_NAME,
      METRICS_SERVICE_CARD_CLASS_NAME,
    ]) {
      expect(tokens(className)).toEqual(
        expect.arrayContaining([
          "row-span-3",
          "grid",
          "grid-rows-subgrid",
          // A column that may be narrower than the longest name in it.
          "grid-cols-1",
          "min-w-0",
        ]),
      );
    }

    // Side by side 12px apart, as the figures above; one above the other 16.
    expect(tokens(METRICS_SERVICE_GRID_CLASS_NAME)).toEqual(
      expect.arrayContaining(["gap-x-3", "gap-y-4"]),
    );
  });

  test("a service's name takes two lines at most, its whole name under the pointer", async () => {
    const cards: Array<HTMLElement> = await renderCards();
    const name: HTMLElement = nameOf(cards[0]!);

    expect(name).toHaveAttribute("title", LONG_SERVICE);
    expect(name).toHaveTextContent(LONG_SERVICE);
    expect(name).toHaveClass(...tokens(METRICS_SERVICE_NAME_CLASS_NAME));
    expect(tokens(METRICS_SERVICE_NAME_CLASS_NAME)).toEqual(
      expect.arrayContaining([
        "line-clamp-2",
        "min-w-0",
        "[overflow-wrap:anywhere]",
      ]),
    );
  });

  test("a metric's name wraps inside its chip, after its own dots, and reads as written", async () => {
    const cards: Array<HTMLElement> = await renderCards();
    const chip: HTMLElement | undefined = within(cards[0]!)
      .getAllByTestId("metrics-service-card-metric")
      .find((element: HTMLElement): boolean => {
        return element.textContent === LONG_METRIC;
      });

    expect(chip).toBeDefined();
    expect(chip!).toHaveClass(...tokens(METRICS_NAME_CHIP_CLASS_NAME));
    expect(tokens(METRICS_NAME_CHIP_CLASS_NAME)).toEqual(
      expect.arrayContaining(["max-w-full", "[overflow-wrap:anywhere]"]),
    );
    // A break after each of its dots that starts a word, and no character added.
    expect(chip!.querySelectorAll("wbr").length).toBe(
      LONG_METRIC.split(".").length - 1,
    );
    expect(chip!.textContent).toBe(LONG_METRIC);
    /*
     * The whole name is the chip's one flex item: Firefox makes each run of
     * text between two <wbr>s a flex item of its own, and stood a long
     * name's parts side by side with their letters stacked.
     */
    expect(chip!.children).toHaveLength(1);
    expect(chip!.children[0]!.tagName).toBe("SPAN");
    expect(chip!.children[0]!.textContent).toBe(LONG_METRIC);
    expect(chip!.children[0]!.querySelectorAll("wbr").length).toBe(
      LONG_METRIC.split(".").length - 1,
    );
  });

  test("six names at most, then how many more, in a grey that reads", async () => {
    const cards: Array<HTMLElement> = await renderCards();

    expect(
      within(cards[0]!).getAllByTestId("metrics-service-card-metric"),
    ).toHaveLength(6);

    const more: HTMLElement = within(cards[0]!).getByTestId(
      "metrics-service-card-more",
    );

    expect(more).toHaveTextContent("+2 more");
    // 4.6:1 on its grey, where grey-400 was 2.4:1.
    expect(more).toHaveClass("text-gray-500");
    expect(more).not.toHaveClass("text-gray-400");
    expect(
      within(cards[1]!).queryByTestId("metrics-service-card-more"),
    ).toBeNull();
  });

  test("the figures row says how many metrics, and of which kinds", async () => {
    const cards: Array<HTMLElement> = await renderCards();
    const figures: (card: HTMLElement) => HTMLElement = (
      card: HTMLElement,
    ): HTMLElement => {
      return card.children[1] as HTMLElement;
    };

    expect(figures(cards[0]!)).toHaveTextContent("8 metrics");
    expect(figures(cards[0]!)).toHaveTextContent("System");
    expect(figures(cards[0]!)).toHaveTextContent("App");
    // notifications.sent is an app's own metric: no System.
    expect(figures(cards[2]!)).toHaveTextContent("1 metric");
    expect(figures(cards[2]!)).not.toHaveTextContent("System");
    expect(figures(cards[2]!)).toHaveTextContent("App");
  });
});
