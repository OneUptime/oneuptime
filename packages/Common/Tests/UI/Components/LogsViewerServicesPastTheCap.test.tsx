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
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

configure({ asyncUtilTimeout: 20000 });
jest.setTimeout(120000);

/*
 * THE LOGS EXPLORER'S SERVICES, HOSTS AND CLUSTERS, PAST THE PROJECT'S
 * FIRST 10,000 (#11072).
 *
 * The explorer read the project's first 10,000 services by name - and its
 * first 10,000 hosts, Docker and Podman hosts and Kubernetes clusters -
 * before it showed anything, and named its rows, facets and chips from
 * them: a log of a service past them read as its id, the page waited on
 * five list reads, and when one failed said only that it could not load.
 * The services the logs on screen name are read by their ids now, as they
 * land; hosts and clusters are named by the entity name resolver; a typed
 * `service:` name is searched for on the server. ModelAPI answers from a
 * project faked whole (CappedListServer): more services than the cap, and
 * the ones the logs name sorting after them.
 */

const getListMock: MockFunction = getJestMockFunction();
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

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyErrorMessage: (error: Error) => {
        return error.message;
      },
      getFriendlyMessage: (error: Error) => {
        return error.message;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        const ObjectIDActual: any = (
          jest.requireActual("../../../Types/ObjectID") as any
        ).default;
        return new ObjectIDActual("9e1b6b0e-0000-4000-8000-000000000001");
      },
    },
  };
});

import CappedListServer, {
  CappedListCall,
  namesSortingFirst,
} from "../../App/Dashboard/CappedListServer";
import LogsViewer from "../../../UI/Components/LogsViewer/LogsViewer";
import Log from "../../../Models/AnalyticsModels/Log";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import Host from "../../../Models/DatabaseModels/Host";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import PodmanHost from "../../../Models/DatabaseModels/PodmanHost";
import Service from "../../../Models/DatabaseModels/Service";
import Includes from "../../../Types/BaseDatabase/Includes";
import Search from "../../../Types/BaseDatabase/Search";
import Query from "../../../Types/BaseDatabase/Query";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import LogSeverity from "../../../Types/Log/LogSeverity";
import ObjectID from "../../../Types/ObjectID";
import TelemetryEntityNameResolver from "../../../UI/Utils/Telemetry/TelemetryEntityNames";

const LATE_SERVICE_ID: string = "a1000000-0000-4000-8000-0000000000aa";
const FACET_SERVICE_ID: string = "a1000000-0000-4000-8000-0000000000ab";
const LATE_HOST_ID: string = "b2000000-0000-4000-8000-0000000000bb";
const LATE_CLUSTER_ID: string = "c3000000-0000-4000-8000-0000000000cc";

let server: CappedListServer;
// A read of these models fails, while listed.
let failingModels: Set<unknown>;
// The reads of these models wait for ever, while listed.
let pendingModels: Set<unknown>;

const makeLog: (id: string, primaryEntityId: string, body: string) => Log = (
  id: string,
  primaryEntityId: string,
  body: string,
): Log => {
  const log: Log = new Log();
  log.setColumnValue("_id", id);
  log.primaryEntityId = new ObjectID(primaryEntityId);
  log.body = body;
  log.time = new Date("2026-11-24T10:15:00.000Z");
  log.severityText = LogSeverity.Information;
  return log;
};

const idsIn: (value: unknown) => Array<string> = (
  value: unknown,
): Array<string> => {
  return value instanceof Includes
    ? value.values.map((entry: unknown): string => {
        return String(entry).toLowerCase();
      })
    : [];
};

const serviceReads: () => Array<CappedListCall> = (): Array<CappedListCall> => {
  return server.callsFor(Service);
};

beforeEach(() => {
  TelemetryEntityNameResolver.clearCache();
  failingModels = new Set<unknown>();
  pendingModels = new Set<unknown>();

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
    { _id: LATE_SERVICE_ID, name: "wbkiosk-payments", serviceColor: "#22c55e" },
    { _id: FACET_SERVICE_ID, name: "wbkiosk-login", serviceColor: "#f59e0b" },
  ]);
  server.add(
    Host,
    namesSortingFirst(LIMIT_PER_PROJECT + 50).map(
      (name: string): Record<string, unknown> => {
        return {
          _id: ObjectID.generate().toString(),
          name: name,
          hostIdentifier: name,
        };
      },
    ),
  );
  server.add(Host, [
    { _id: LATE_HOST_ID, name: "wbkiosk-db-7", hostIdentifier: "ip-10-0-7-7" },
  ]);
  server.add(KubernetesCluster, [
    {
      _id: LATE_CLUSTER_ID,
      name: "wbkiosk-prod-eu",
      clusterIdentifier: "prod-eu",
    },
  ]);

  getListMock.mockReset();
  getListMock.mockImplementation(async (...args: Array<any>) => {
    const options: any = args[0];

    if (pendingModels.has(options.modelType)) {
      return new Promise(() => {});
    }

    if (failingModels.has(options.modelType)) {
      throw new Error("The services could not be read.");
    }

    return server.list(options);
  });

  postMock.mockReset();
  postMock.mockImplementation(() => {
    return Promise.resolve({ data: {} });
  });
});

afterEach(() => {
  cleanup();
});

const waitForTable: () => Promise<void> = async (): Promise<void> => {
  await waitFor(() => {
    expect(document.querySelector("table")).not.toBeNull();
  });
};

describe("Logs explorer: services, hosts and clusters past the project's first 10,000", () => {
  test("a log of a service past the 10,000th is named in its row, read by its id", async () => {
    render(
      <LogsViewer
        logs={[makeLog("log-1", LATE_SERVICE_ID, "payment taken")]}
        isLoading={false}
        filterData={{}}
        onFilterChanged={jest.fn()}
      />,
    );

    await waitForTable();

    expect(await screen.findByTitle("wbkiosk-payments")).toBeInTheDocument();
    expect(
      serviceReads().some((call: CappedListCall): boolean => {
        return idsIn(call.query["_id"]).includes(LATE_SERVICE_ID);
      }),
    ).toBe(true);
  });

  test("the Service facet's values past the 10,000th are named, read by their ids", async () => {
    render(
      <LogsViewer
        logs={[]}
        isLoading={false}
        filterData={{}}
        onFilterChanged={jest.fn()}
        facetData={{
          primaryEntityId: [{ value: FACET_SERVICE_ID, count: 9 }],
        }}
      />,
    );

    expect(await screen.findByText("wbkiosk-login")).toBeInTheDocument();
  });

  test("a host and a cluster past the 10,000th are named in the sidebar by their ids", async () => {
    render(
      <LogsViewer
        logs={[]}
        isLoading={false}
        filterData={{}}
        onFilterChanged={jest.fn()}
        facetData={{
          hostId: [{ value: LATE_HOST_ID, count: 3 }],
          kubernetesClusterId: [{ value: LATE_CLUSTER_ID, count: 2 }],
        }}
      />,
    );

    expect(await screen.findByText("wbkiosk-db-7")).toBeInTheDocument();
    expect(await screen.findByText("wbkiosk-prod-eu")).toBeInTheDocument();
  });

  test("a Service chip past the 10,000th is named, read by its id", async () => {
    render(
      <LogsViewer
        logs={[]}
        isLoading={false}
        filterData={{}}
        onFilterChanged={jest.fn()}
        activeFilters={[
          {
            facetKey: "primaryEntityId",
            value: LATE_SERVICE_ID,
            displayKey: "Service",
            displayValue: LATE_SERVICE_ID,
          },
        ]}
        onRemoveFilter={jest.fn()}
      />,
    );

    expect(
      await screen.findByTitle("Remove Service: wbkiosk-payments"),
    ).toBeInTheDocument();
    expect(screen.queryByText(LATE_SERVICE_ID)).not.toBeInTheDocument();
  });

  test("a locked scope chip past the 10,000th is named, read by its id", async () => {
    render(
      <LogsViewer
        logs={[]}
        isLoading={false}
        filterData={{}}
        onFilterChanged={jest.fn()}
        baseActiveFilters={[
          {
            facetKey: "primaryEntityId",
            value: LATE_SERVICE_ID,
            displayKey: "Service",
            displayValue: LATE_SERVICE_ID,
            readOnly: true,
          },
        ]}
      />,
    );

    expect(
      await screen.findByTitle("Service: wbkiosk-payments (applied filter)"),
    ).toBeInTheDocument();
  });

  test("each service is read once by id; the project's services, hosts and clusters never whole", async () => {
    render(
      <LogsViewer
        logs={[
          makeLog("log-1", LATE_SERVICE_ID, "payment taken"),
          makeLog("log-2", LATE_SERVICE_ID, "payment refunded"),
          makeLog("log-3", LATE_HOST_ID, "disk full"),
        ]}
        isLoading={false}
        filterData={{}}
        onFilterChanged={jest.fn()}
        facetData={{
          primaryEntityId: [
            { value: LATE_SERVICE_ID, count: 2 },
            { value: FACET_SERVICE_ID, count: 1 },
          ],
          hostId: [{ value: LATE_HOST_ID, count: 1 }],
        }}
      />,
    );

    await waitForTable();
    expect(await screen.findByTitle("Host: wbkiosk-db-7")).toBeInTheDocument();
    expect(screen.getAllByTitle("wbkiosk-payments").length).toBe(2);

    const asked: Array<string> = serviceReads()
      .filter((call: CappedListCall): boolean => {
        // The viewer's own reads: by id alone, not the resolver's.
        return call.query["projectId"] === undefined;
      })
      .flatMap((call: CappedListCall): Array<string> => {
        return idsIn(call.query["_id"]);
      });

    expect(
      asked.filter((id: string): boolean => {
        return id === LATE_SERVICE_ID;
      }),
    ).toHaveLength(1);

    for (const call of server.calls) {
      if (
        [Service, Host, DockerHost, PodmanHost, KubernetesCluster].includes(
          call.modelType as never,
        )
      ) {
        expect(call.query["_id"]).toBeInstanceOf(Includes);
        expect(call.limit).toBeLessThan(LIMIT_PER_PROJECT);
      }
    }
  });

  test("the logs show at once: nothing waits on a read of the project's resources", async () => {
    pendingModels = new Set<unknown>([Service, Host]);

    render(
      <LogsViewer
        logs={[makeLog("log-1", LATE_SERVICE_ID, "payment taken")]}
        isLoading={false}
        filterData={{}}
        onFilterChanged={jest.fn()}
      />,
    );

    await waitForTable();
    expect(screen.getByText("payment taken")).toBeInTheDocument();
  });
});

describe("a services read that fails", () => {
  test("is said above the list - the logs still show - and Try again reads them again", async () => {
    failingModels = new Set<unknown>([Service]);

    render(
      <LogsViewer
        logs={[makeLog("log-1", LATE_SERVICE_ID, "payment taken")]}
        isLoading={false}
        filterData={{}}
        onFilterChanged={jest.fn()}
      />,
    );

    await waitForTable();
    expect(
      await screen.findByText(/We couldn't load telemetry services\./),
    ).toBeInTheDocument();
    expect(screen.getByText("payment taken")).toBeInTheDocument();
    expect(
      screen.queryByText(/telemetry resource metadata/),
    ).not.toBeInTheDocument();

    failingModels = new Set<unknown>();
    fireEvent.click(screen.getByRole("button", { name: /try again|refresh/i }));

    expect(await screen.findByTitle("wbkiosk-payments")).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.queryByText(/We couldn't load telemetry services\./),
      ).not.toBeInTheDocument();
    });
  });
});

describe("a typed `service:` name", () => {
  const typeAndSubmit: (text: string) => void = (text: string): void => {
    const input: HTMLElement = screen.getAllByRole("textbox")[0]!;
    fireEvent.change(input, { target: { value: text } });
    fireEvent.keyDown(input, { key: "Enter" });
  };

  const renderSearchable: (
    onFilterChanged: MockFunction,
  ) => Promise<void> = async (onFilterChanged: MockFunction): Promise<void> => {
    render(
      <LogsViewer
        logs={[]}
        isLoading={false}
        filterData={{}}
        onFilterChanged={onFilterChanged as never}
        showFilters={true}
      />,
    );

    await waitForTable();
  };

  test("of a service past the 10,000th is searched on the server, and filters by its id", async () => {
    const onFilterChanged: MockFunction = getJestMockFunction();
    await renderSearchable(onFilterChanged);

    typeAndSubmit("service:wbkiosk-payments");

    await waitFor(() => {
      expect(onFilterChanged).toHaveBeenCalled();
    });
    const filter: Query<Log> = onFilterChanged.mock.calls[0]![0] as Query<Log>;
    expect(String(filter["primaryEntityId" as keyof Query<Log>])).toBe(
      LATE_SERVICE_ID,
    );

    const search: CappedListCall | undefined = serviceReads().find(
      (call: CappedListCall): boolean => {
        return call.query["name"] instanceof Search;
      },
    );
    expect((search!.query["name"] as Search<string>).value).toBe(
      "wbkiosk-payments",
    );
  });

  test("taken as a chip, as the Dashboard takes it, is searched on the server too, and the chip holds the id", async () => {
    const onFieldValueSelect: MockFunction = getJestMockFunction();

    render(
      <LogsViewer
        logs={[]}
        isLoading={false}
        filterData={{}}
        onFilterChanged={jest.fn()}
        showFilters={true}
        onFieldValueSelect={onFieldValueSelect as never}
      />,
    );
    await waitForTable();

    typeAndSubmit("service:wbkiosk-payments");

    await waitFor(() => {
      expect(onFieldValueSelect).toHaveBeenCalledWith(
        "service",
        LATE_SERVICE_ID,
      );
    });
    expect(onFieldValueSelect).toHaveBeenCalledTimes(1);
  });

  test("taken as a chip, a name no service has is kept as typed", async () => {
    const onFieldValueSelect: MockFunction = getJestMockFunction();

    render(
      <LogsViewer
        logs={[]}
        isLoading={false}
        filterData={{}}
        onFilterChanged={jest.fn()}
        showFilters={true}
        onFieldValueSelect={onFieldValueSelect as never}
      />,
    );
    await waitForTable();

    typeAndSubmit("service:no-such-service");

    await waitFor(() => {
      expect(onFieldValueSelect).toHaveBeenCalledWith(
        "service",
        "no-such-service",
      );
    });
  });

  test("in other letters' case still finds the service", async () => {
    const onFilterChanged: MockFunction = getJestMockFunction();
    await renderSearchable(onFilterChanged);

    typeAndSubmit("service:WBKIOSK-Payments");

    await waitFor(() => {
      expect(onFilterChanged).toHaveBeenCalled();
    });
    expect(
      String(
        (onFilterChanged.mock.calls[0]![0] as Record<string, unknown>)[
          "primaryEntityId"
        ],
      ),
    ).toBe(LATE_SERVICE_ID);
  });

  test("that only part of a name matches is not taken for that service", async () => {
    const onFilterChanged: MockFunction = getJestMockFunction();
    await renderSearchable(onFilterChanged);

    typeAndSubmit("service:wbkiosk");

    await waitFor(() => {
      expect(onFilterChanged).toHaveBeenCalled();
    });
    expect(
      (onFilterChanged.mock.calls[0]![0] as Record<string, unknown>)[
        "primaryEntityId"
      ],
    ).toBe("wbkiosk");
  });

  test("an id typed in needs no search", async () => {
    const onFilterChanged: MockFunction = getJestMockFunction();
    await renderSearchable(onFilterChanged);
    getListMock.mockClear();

    typeAndSubmit(`service:${LATE_SERVICE_ID}`);

    expect(onFilterChanged).toHaveBeenCalledTimes(1);
    expect(
      (onFilterChanged.mock.calls[0]![0] as Record<string, unknown>)[
        "primaryEntityId"
      ],
    ).toBe(LATE_SERVICE_ID);
    expect(
      getListMock.mock.calls.some((call: Array<unknown>): boolean => {
        return (
          (call[0] as { query: Record<string, unknown> }).query[
            "name"
          ] instanceof Search
        );
      }),
    ).toBe(false);
  });

  test("whose search fails is said, and the search is not applied", async () => {
    const onFilterChanged: MockFunction = getJestMockFunction();
    await renderSearchable(onFilterChanged);
    failingModels = new Set<unknown>([Service]);

    typeAndSubmit("service:wbkiosk-payments");

    expect(
      await screen.findByText(/We couldn't load telemetry services\./),
    ).toBeInTheDocument();
    expect(onFilterChanged).not.toHaveBeenCalled();

    // Try again searches again, and applies the search once it answers.
    failingModels = new Set<unknown>();
    fireEvent.click(screen.getByRole("button", { name: /try again|refresh/i }));

    await waitFor(() => {
      expect(onFilterChanged).toHaveBeenCalledTimes(1);
    });
    expect(
      String(
        (onFilterChanged.mock.calls[0]![0] as Record<string, unknown>)[
          "primaryEntityId"
        ],
      ),
    ).toBe(LATE_SERVICE_ID);
  });
});
