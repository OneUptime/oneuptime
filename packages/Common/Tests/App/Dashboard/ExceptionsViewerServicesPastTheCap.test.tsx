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
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

configure({ asyncUtilTimeout: 10000 });
jest.setTimeout(60000);

/*
 * THE EXCEPTIONS EXPLORER'S SERVICES, PAST THE PROJECT'S FIRST 10,000
 * (#10921).
 *
 * The explorer read the project's first 10,000 services by name - and its
 * first 10,000 hosts, Docker and Podman hosts and Kubernetes clusters - to
 * name its rows and its facets and to turn a typed `@service:` name into
 * the ids the telemetry holds. A service past them: its rows named no
 * service, and `@service:<its name>` matched nothing, so the list filtered
 * by "no such service" and came back empty.
 *
 * A typed name is searched for on the server now, and the rows' and the
 * facet's services are read by their ids. ModelAPI answers the services
 * from a project faked whole (CappedListServer); the exceptions are stood
 * in for.
 */

type CapturedViewerProps = {
  items: Array<unknown>;
  facetConfigs: Array<{
    key: string;
    valueColorMap?: Record<string, string> | undefined;
    valueDisplayMap?: Record<string, string> | undefined;
  }>;
  renderRow: (item: unknown) => React.ReactElement;
};

let capturedViewerProps: CapturedViewerProps | null = null;

jest.mock("../../../UI/Components/TelemetryViewer/TelemetryViewer", () => {
  return {
    __esModule: true,
    default: (props: CapturedViewerProps) => {
      capturedViewerProps = props;
      return null;
    },
  };
});

const getListMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();
const analyticsGetListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      count: () => {
        return Promise.resolve(0);
      },
      getCommonHeaders: () => {
        return {};
      },
      updateById: () => {
        return Promise.resolve();
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

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return analyticsGetListMock(...args);
      },
    },
  };
});

import CappedListServer, {
  CappedListCall,
  namesSortingFirst,
} from "./CappedListServer";
import ExceptionsViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionsViewer";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import Host from "../../../Models/DatabaseModels/Host";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import PodmanHost from "../../../Models/DatabaseModels/PodmanHost";
import Service from "../../../Models/DatabaseModels/Service";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import Includes from "../../../Types/BaseDatabase/Includes";
import Search from "../../../Types/BaseDatabase/Search";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import ProjectUtil from "../../../UI/Utils/Project";
import TelemetryEntityNameResolver from "../../../UI/Utils/Telemetry/TelemetryEntityNames";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const LATE_ID: string = "a1000000-0000-4000-8000-0000000000aa";
const OTHER_LATE_ID: string = "a1000000-0000-4000-8000-0000000000ab";

type ListArgs = {
  modelType: { new (): unknown };
  query: Record<string, unknown>;
  select?: Record<string, unknown>;
  limit: number;
};

let server: CappedListServer;
let exceptionRows: Array<TelemetryException>;

function exceptionOf(id: string, serviceId: string): TelemetryException {
  return Object.assign(new TelemetryException(), {
    _id: id,
    message: `Card declined (${id.slice(-2)})`,
    exceptionType: "Error",
    fingerprint: `fp-${id}`,
    primaryEntityId: new ObjectID(serviceId),
    primaryEntityType: ServiceType.OpenTelemetry,
    occuranceCount: 3,
    lastSeenAt: new Date("2026-11-24T10:00:00.000Z"),
    firstSeenAt: new Date("2026-11-23T10:00:00.000Z"),
  });
}

function exceptionListQueries(): Array<Record<string, unknown>> {
  return getListMock.mock.calls
    .map((call: Array<unknown>): ListArgs => {
      return call[0] as ListArgs;
    })
    .filter((args: ListArgs): boolean => {
      return args.modelType === TelemetryException;
    })
    .map((args: ListArgs): Record<string, unknown> => {
      return args.query;
    });
}

function idsIn(value: unknown): Array<string> {
  if (value instanceof Includes) {
    return value.values
      .map((entry: unknown): string => {
        return String(entry).toLowerCase();
      })
      .sort();
  }

  return value === undefined || value === null
    ? []
    : [String(value).toLowerCase()];
}

function serviceReads(): Array<CappedListCall> {
  return server.callsFor(Service);
}

beforeEach(() => {
  capturedViewerProps = null;
  TelemetryEntityNameResolver.clearCache();
  window.history.pushState({}, "", "/");

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

  exceptionRows = [];

  getListMock.mockReset();
  getListMock.mockImplementation(async (...args: Array<any>) => {
    const options: ListArgs = args[0] as ListArgs;

    if (options.modelType === Service) {
      return server.list(options as never);
    }

    if (options.modelType === TelemetryException) {
      return { data: exceptionRows, count: exceptionRows.length };
    }

    return { data: [], count: 0 };
  });
  postMock.mockReset();
  postMock.mockResolvedValue({ data: {} } as never);
  analyticsGetListMock.mockReset();
  analyticsGetListMock.mockResolvedValue({ data: [], count: 0 } as never);
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.history.pushState({}, "", "/");
});

async function renderViewer(search?: string): Promise<void> {
  if (search) {
    window.history.pushState({}, "", `/?search=${encodeURIComponent(search)}`);
  }

  await act(async (): Promise<void> => {
    render(
      <MemoryRouter>
        <ExceptionsViewer />
      </MemoryRouter>,
    );
  });
}

describe("Exceptions explorer: services past the project's first 10,000", () => {
  test("a typed service name past the 10,000th is found on the server, and the list filters by its id", async () => {
    await renderViewer("service:wbkiosk-payments");

    await waitFor(() => {
      expect(exceptionListQueries().length).toBeGreaterThan(0);
    });

    // The list waited for the name's search: read once, with its id.
    for (const query of exceptionListQueries()) {
      expect(idsIn(query["primaryEntityId"])).toEqual([LATE_ID]);
    }

    const searched: CappedListCall | undefined = serviceReads().find(
      (call: CappedListCall): boolean => {
        return call.query["name"] instanceof Search;
      },
    );

    expect((searched!.query["name"] as Search<string>).toString()).toBe(
      "wbkiosk-payments",
    );
  });

  test("a fragment matching two services past the 10,000th filters by both", async () => {
    await renderViewer("service:wbkiosk");

    await waitFor(() => {
      expect(exceptionListQueries().length).toBeGreaterThan(0);
    });

    expect(idsIn(exceptionListQueries()[0]!["primaryEntityId"])).toEqual(
      [LATE_ID, OTHER_LATE_ID].sort(),
    );
  });

  test("a negated name leaves out the service past the 10,000th it names", async () => {
    await renderViewer("-service:wbkiosk-login");

    await waitFor(() => {
      expect(exceptionListQueries().length).toBeGreaterThan(0);
    });

    /*
     * A negation rides the instance scope - the exception instances read
     * with IncludesNone on the service column - as every other operator
     * does: the one it names, never the other.
     */
    await waitFor(() => {
      expect(analyticsGetListMock).toHaveBeenCalled();
    });

    const scopes: string = JSON.stringify(
      analyticsGetListMock.mock.calls.map((call: Array<unknown>): unknown => {
        return (call[0] as { query?: unknown }).query;
      }),
    );

    expect(scopes).toContain(OTHER_LATE_ID);
    expect(scopes).not.toContain(LATE_ID);
  });

  test("a row's service past the 10,000th is named and coloured, read by its id", async () => {
    exceptionRows = [
      exceptionOf("e1000000-0000-4000-8000-000000000001", LATE_ID),
    ];

    await renderViewer();

    await waitFor(() => {
      expect(capturedViewerProps?.items.length).toBe(1);
    });

    await waitFor(() => {
      expect(
        serviceReads().some((call: CappedListCall): boolean => {
          return idsIn(call.query["_id"]).includes(LATE_ID);
        }),
      ).toBe(true);
    });

    await waitFor(() => {
      render(
        <MemoryRouter>
          {capturedViewerProps!.renderRow(exceptionRows[0])}
        </MemoryRouter>,
      );
      expect(screen.getAllByText("wbkiosk-payments").length).toBeGreaterThan(0);
    });

    const serviceFacet: CapturedViewerProps["facetConfigs"][number] =
      capturedViewerProps!.facetConfigs.find((config: { key: string }) => {
        return config.key === "primaryEntityId";
      })!;

    expect(serviceFacet.valueDisplayMap?.[LATE_ID]).toBe("wbkiosk-payments");
    expect(serviceFacet.valueColorMap?.[LATE_ID]).toBe("#22c55e");
  });

  test("the project's services, hosts and clusters are never read whole", async () => {
    exceptionRows = [
      exceptionOf("e1000000-0000-4000-8000-000000000001", LATE_ID),
    ];

    await renderViewer("service:wbkiosk-payments");

    await waitFor(() => {
      expect(capturedViewerProps?.items.length).toBe(1);
    });

    const reads: Array<ListArgs> = getListMock.mock.calls
      .map((call: Array<unknown>): ListArgs => {
        return call[0] as ListArgs;
      })
      .filter((args: ListArgs): boolean => {
        return [
          Service,
          Host,
          DockerHost,
          PodmanHost,
          KubernetesCluster,
        ].includes(args.modelType as never);
      });

    expect(reads.length).toBeGreaterThan(0);

    for (const read of reads) {
      // By the ids the page holds, or by the name a token searched for.
      expect(
        read.query["_id"] instanceof Includes ||
          read.query["name"] instanceof Search,
      ).toBe(true);
    }
  });

  test("a search that fails filters by no service rather than every one", async () => {
    getListMock.mockImplementation(async (...args: Array<any>) => {
      const options: ListArgs = args[0] as ListArgs;

      if (options.modelType === Service) {
        throw new Error("The server is unavailable.");
      }

      return { data: [], count: 0 };
    });

    await renderViewer("service:wbkiosk-payments");

    await waitFor(() => {
      expect(exceptionListQueries().length).toBeGreaterThan(0);
    });

    // Never the unfiltered list: the token still narrows it, to nothing.
    expect(exceptionListQueries()[0]).toHaveProperty("primaryEntityId");
  });
});
