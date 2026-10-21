/** @timezone America/New_York */

import { jest } from "@jest/globals";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Topology service-call drawer's one-bucket-per-slot cases (sdn-3, see
 * EdgeHistoryBucketsCases) on the America/New_York wall clock, a zone behind
 * UTC (UTC-4 in September): the viewer's days start hours after the UTC days.
 */

const apiPostMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  return {
    ...(jest.requireActual(
      "../../../UI/Components/Charts/Line/LineChart",
    ) as Record<string, unknown>),
    __esModule: true,
    default: (jest.requireActual("./ChartZoomStandIn") as { default: unknown })
      .default,
  };
});

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string): string => {
          return value;
        },
        translateValue: (value: React.ReactNode): React.ReactNode => {
          return value;
        },
      };
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
        return new ObjectIDType("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>): unknown => {
        return apiPostMock(...args);
      },
      getFriendlyMessage: (error: Error): string => {
        return error.message;
      },
    },
  };
});

import describeEdgeHistoryBuckets from "./EdgeHistoryBucketsCases";

describeEdgeHistoryBuckets("America/New_York", -240, apiPostMock);
