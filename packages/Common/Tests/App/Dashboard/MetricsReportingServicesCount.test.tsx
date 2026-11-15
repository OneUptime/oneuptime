/** @timezone UTC */

import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";

/*
 * Metrics > Insights: "Reporting services", and under it how many of the
 * services in scope report - "2 of 3 services". With one service in scope
 * it read "1 of 1 services": the line was filled as a template, in its
 * plural only. It is a plural sentence now, as the Logs page's same line
 * is, so it reads "1 of 1 service" - and each language's own one form
 * (Dashboard/PluralOneFormsInLanguages, #7789).
 */

interface MockService {
  id: string;
  name: string;
  // Whether it sends metrics in the range.
  reports: boolean;
}

// The project's services, set by each test.
const mockScenario: { services: Array<MockService> } = { services: [] };

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
          default: new () => { _id?: string; name?: string };
        } = jest.requireActual(
          "../../../Models/DatabaseModels/Service",
        ) as never;

        if (options.modelType === ServiceModule.default) {
          const services: Array<unknown> = mockScenario.services.map(
            (entry: MockService): unknown => {
              const service: { _id?: string; name?: string } =
                new ServiceModule.default();
              service._id = entry.id;
              service.name = entry.name;
              return service;
            },
          );

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

        const points: Array<unknown> = mockScenario.services
          .filter((entry: MockService): boolean => {
            return entry.reports;
          })
          .map((entry: MockService): unknown => {
            const point: {
              name?: string;
              primaryEntityId?: unknown;
              time?: Date;
            } = new MetricModule.default();
            point.name = "http.server.request.duration";
            point.primaryEntityId = new ObjectIDModule.default(entry.id);
            point.time = new Date("2026-11-14T11:30:00.000Z");
            return point;
          });

        return { data: points, count: points.length };
      },
    },
  };
});

import MetricsDashboard from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricsDashboard";

const service: (index: number, reports: boolean) => MockService = (
  index: number,
  reports: boolean,
): MockService => {
  return {
    id: `52310000-0000-4000-8000-00000000000${index}`,
    name: `service-${index}`,
    reports: reports,
  };
};

afterEach(() => {
  cleanup();
  mockScenario.services = [];
});

async function renderInsights(): Promise<void> {
  render(
    <MemoryRouter>
      <MetricsDashboard />
    </MemoryRouter>,
  );

  await screen.findByTestId("metrics-service-cards");
}

describe("Metrics > Insights: how many of the services in scope report", () => {
  test("one service, reporting: 1 of 1 service", async () => {
    mockScenario.services = [service(1, true)];

    await renderInsights();

    expect(screen.getByText("1 of 1 service")).toBeInTheDocument();
    expect(screen.queryByText("1 of 1 services")).toBeNull();
  });

  test("one of two reporting: 1 of 2 services", async () => {
    mockScenario.services = [service(1, true), service(2, false)];

    await renderInsights();

    expect(screen.getByText("1 of 2 services")).toBeInTheDocument();
  });

  test("two of three reporting: 2 of 3 services", async () => {
    mockScenario.services = [
      service(1, true),
      service(2, true),
      service(3, false),
    ];

    await renderInsights();

    expect(screen.getByText("2 of 3 services")).toBeInTheDocument();
  });
});
