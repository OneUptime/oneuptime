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
  configure,
  render,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

configure({ asyncUtilTimeout: 10000 });
jest.setTimeout(60000);

/*
 * THE METRICS EXPLORER'S `service:` TOKEN AND SERVICE FACET, PAST THE
 * PROJECT'S FIRST 10,000 SERVICES (#10921).
 *
 * The explorer read the project's first 10,000 services by name on every
 * open, to turn a typed `service:<name>` into the ids the metric list
 * filters by and to colour its Service facet: `service:<a name past them>`
 * matched nothing, and the list came back empty. A typed name is searched
 * for on the server now - only when one is typed - and the facet's services
 * are read by their ids. ModelAPI answers the services from a project faked
 * whole (CappedListServer); the metrics are stood in for.
 */

let viewerProps: any = null;

jest.mock("../../../UI/Components/TelemetryViewer/TelemetryViewer", () => {
  return {
    __esModule: true,
    default: (props: any) => {
      viewerProps = props;
      return null;
    },
  };
});

const getListMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();
const aggregateMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
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
      getList: (...args: Array<any>) => {
        return analyticsGetListMock(...args);
      },
      aggregate: (...args: Array<any>) => {
        return aggregateMock(...args);
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: unknown) => {
        return error instanceof Error ? error.message : "Something went wrong";
      },
      getFriendlyErrorMessage: (error: unknown) => {
        return error instanceof Error ? error.message : "Something went wrong";
      },
    },
  };
});

jest.mock("../../../UI/Utils/Telemetry/UseTelemetryEntityNames", () => {
  return {
    __esModule: true,
    default: () => {
      return {};
    },
  };
});

import CappedListServer, {
  CappedListCall,
  namesSortingFirst,
} from "./CappedListServer";
import MetricsViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricsViewer";
import Metric from "../../../Models/AnalyticsModels/Metric";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import Service from "../../../Models/DatabaseModels/Service";
import Includes from "../../../Types/BaseDatabase/Includes";
import IncludesNone from "../../../Types/BaseDatabase/IncludesNone";
import Search from "../../../Types/BaseDatabase/Search";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const LATE_ID: string = "a1000000-0000-4000-8000-0000000000aa";
const OTHER_LATE_ID: string = "a1000000-0000-4000-8000-0000000000ab";

type ListArgs = {
  modelType: unknown;
  query: Record<string, unknown>;
  limit: number;
};

let server: CappedListServer;
let facets: Record<string, unknown>;

function listQueries(): Array<Record<string, unknown>> {
  return getListMock.mock.calls
    .map((call: Array<unknown>): ListArgs => {
      return call[0] as ListArgs;
    })
    .filter((args: ListArgs): boolean => {
      return args.modelType === MetricType;
    })
    .map((args: ListArgs): Record<string, unknown> => {
      return args.query;
    });
}

function idsIn(value: unknown): Array<string> {
  if (value instanceof Includes || value instanceof IncludesNone) {
    return (value.values as Array<unknown>)
      .map((entry: unknown): string => {
        return String(entry).toLowerCase();
      })
      .sort();
  }

  return [];
}

function serviceReads(): Array<CappedListCall> {
  return server.callsFor(Service);
}

async function openAt(search: string): Promise<void> {
  window.history.replaceState({}, "", `/dashboard/project/metrics${search}`);

  await act(async () => {
    render(<MetricsViewer />);
  });
}

beforeEach(() => {
  viewerProps = null;
  window.history.replaceState({}, "", "/");
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);

  server = new CappedListServer();
  server.add(
    Service,
    namesSortingFirst(LIMIT_PER_PROJECT + 50).map(
      (name: string): Record<string, unknown> => {
        return { _id: ObjectID.generate().toString(), name: name };
      },
    ),
  );
  server.add(Service, [
    { _id: LATE_ID, name: "wbkiosk-payments", serviceColor: "#22c55e" },
    { _id: OTHER_LATE_ID, name: "wbkiosk-login", serviceColor: "#f59e0b" },
  ]);

  facets = {};

  getListMock.mockReset();
  getListMock.mockImplementation(async (args: unknown) => {
    const options: ListArgs = args as ListArgs;

    if (options.modelType === Service) {
      return server.list(options as never);
    }

    if (options.modelType === MetricType) {
      const metricType: MetricType = new MetricType();
      metricType.name = "http.server.duration";
      return { data: [metricType], count: 1 };
    }

    return { data: [], count: 0 };
  });
  analyticsGetListMock.mockReset();
  analyticsGetListMock.mockImplementation(async () => {
    const metric: Metric = new Metric();
    metric.name = "http.server.duration";
    return { data: [metric], count: 1 };
  });
  aggregateMock.mockReset();
  aggregateMock.mockResolvedValue({ data: [] } as never);
  postMock.mockReset();
  postMock.mockImplementation(async (args: unknown) => {
    const url: string = String((args as { url: unknown }).url);

    if (url.endsWith("/telemetry/metrics/facets")) {
      return { data: { facets: facets } };
    }

    return { data: { attributes: [] } };
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.history.replaceState({}, "", "/");
});

describe("Metrics explorer: services past the project's first 10,000", () => {
  test("service:<a name past the 10,000th> is searched for, and the list filters by its id", async () => {
    await openAt(`?search=${encodeURIComponent("service:wbkiosk-payments")}`);

    await waitFor(() => {
      expect(listQueries().length).toBeGreaterThan(0);
    });

    // Read once, with the token's service: never "no such service".
    expect(listQueries()).toHaveLength(1);
    expect(idsIn(listQueries()[0]!["services"])).toEqual([LATE_ID]);
    expect(listQueries()[0]!["name"]).not.toBe("__no_match__");

    const searched: CappedListCall | undefined = serviceReads().find(
      (call: CappedListCall): boolean => {
        return call.query["name"] instanceof Search;
      },
    );

    expect((searched!.query["name"] as Search<string>).toString()).toBe(
      "wbkiosk-payments",
    );
  });

  test("a fragment keeps every service it matches past the 10,000th", async () => {
    await openAt(`?search=${encodeURIComponent("service:wbkiosk")}`);

    await waitFor(() => {
      expect(listQueries().length).toBeGreaterThan(0);
    });

    expect(idsIn(listQueries()[0]!["services"])).toEqual(
      [LATE_ID, OTHER_LATE_ID].sort(),
    );
  });

  test("-service:<name> leaves out the metrics the service past the 10,000th reports", async () => {
    await openAt(`?search=${encodeURIComponent("-service:wbkiosk-login")}`);

    await waitFor(() => {
      expect(listQueries().length).toBeGreaterThan(0);
    });

    const services: unknown = listQueries()[0]!["services"];

    expect(services).toBeInstanceOf(IncludesNone);
    expect(idsIn(services)).toEqual([OTHER_LATE_ID]);
  });

  test("a name no service has reads the list for nothing", async () => {
    await openAt(`?search=${encodeURIComponent("service:no-such-service")}`);

    await waitFor(() => {
      expect(listQueries().length).toBeGreaterThan(0);
    });

    expect(listQueries()[0]!["name"]).toBe("__no_match__");
  });

  test("with no token, no services are searched for; the facet's are read by their ids, named and coloured", async () => {
    facets = {
      primaryEntityId: [
        { value: LATE_ID, count: 3, displayName: "wbkiosk-payments" },
      ],
    };

    await openAt("");

    await waitFor(() => {
      const serviceFacet: any = viewerProps?.facetConfigs?.find(
        (config: { key: string }) => {
          return config.key === "primaryEntityId";
        },
      );

      expect(serviceFacet?.valueColorMap?.[LATE_ID]).toBe("#22c55e");
    });

    for (const call of serviceReads()) {
      expect(call.query["_id"]).toBeInstanceOf(Includes);
      expect(call.query["name"]).toBeUndefined();
    }
  });
});
