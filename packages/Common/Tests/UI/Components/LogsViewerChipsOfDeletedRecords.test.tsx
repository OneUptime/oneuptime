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
 * A SAVED CHIP OF THE LOGS EXPLORER WHOSE RECORD IS GONE (#11213).
 *
 * The explorer names a chip's service from a read of the services on
 * screen by their ids, and anything else - a host, a cluster, a service
 * the read did not find - through the entity name resolver. A chip a link
 * or a saved view brought, naming a service deleted since, was found by
 * neither, and read as its raw id. Once every read has answered without
 * it, the chip reads "No longer available"; never while a read is in
 * flight, never after one failed. One naming an archived service reads
 * its name marked archived. Either is taken out as any chip is, by its id.
 * ModelAPI answers from a project faked whole (CappedListServer): more
 * services than the old cap, the chips' sorting after them.
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
        return new ObjectIDActual("9e1b6b0e-0000-4000-8000-000000000213");
      },
    },
  };
});

import CappedListServer, {
  namesSortingFirst,
} from "../../App/Dashboard/CappedListServer";
import LogsViewer from "../../../UI/Components/LogsViewer/LogsViewer";
import { ActiveFilter } from "../../../UI/Components/LogsViewer/types";
import { FILTER_CHIP_NOT_FOUND_TEST_ID } from "../../../UI/Components/TelemetryViewer/components/TelemetryActiveFilterChips";
import Host from "../../../Models/DatabaseModels/Host";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import Service from "../../../Models/DatabaseModels/Service";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import TelemetryEntityNameResolver from "../../../UI/Utils/Telemetry/TelemetryEntityNames";

const LATE_SERVICE_ID: string = "a1000000-0000-4000-8000-0000000000aa";
const ARCHIVED_SERVICE_ID: string = "a1000000-0000-4000-8000-0000000000a2";
const DELETED_SERVICE_ID: string = "dead0000-0000-4000-8000-00000000dead";
const DELETED_HOST_ID: string = "dead0000-0000-4000-8000-00000000d0d0";

let server: CappedListServer;
// A read of these models fails, while listed.
let failingModels: Set<unknown>;
// The reads of these models wait for ever, while listed.
let pendingModels: Set<unknown>;

const chip: (facetKey: string, value: string) => ActiveFilter = (
  facetKey: string,
  value: string,
): ActiveFilter => {
  // As a link or a saved view hands it over: the id, and nothing more.
  return {
    facetKey: facetKey,
    value: value,
    displayKey: facetKey === "hostId" ? "Host" : "Service",
    displayValue: value,
  };
};

const renderWithChips: (
  filters: Array<ActiveFilter>,
  onRemoveFilter?: (facetKey: string, value: string) => void,
) => void = (
  filters: Array<ActiveFilter>,
  onRemoveFilter?: (facetKey: string, value: string) => void,
): void => {
  render(
    <LogsViewer
      logs={[]}
      isLoading={false}
      filterData={{}}
      onFilterChanged={jest.fn()}
      activeFilters={filters}
      onRemoveFilter={onRemoveFilter || jest.fn()}
    />,
  );
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
    {
      _id: ARCHIVED_SERVICE_ID,
      name: "wbkiosk-legacy",
      serviceColor: "#64748b",
      isArchived: true,
    },
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

  getListMock.mockReset();
  getListMock.mockImplementation(async (...args: Array<any>) => {
    const options: any = args[0];

    if (pendingModels.has(options.modelType)) {
      return new Promise(() => {});
    }

    if (failingModels.has(options.modelType)) {
      throw new Error("These could not be read.");
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

describe("Logs explorer: a saved chip whose record is gone", () => {
  test("a Service chip naming a deleted service reads No longer available, never its id", async () => {
    renderWithChips([chip("primaryEntityId", DELETED_SERVICE_ID)]);

    expect(
      await screen.findByTestId(FILTER_CHIP_NOT_FOUND_TEST_ID),
    ).toHaveTextContent("No longer available");
    expect(
      screen.getByTitle("Remove Service: No longer available"),
    ).toBeInTheDocument();
    expect(screen.queryByText(DELETED_SERVICE_ID)).not.toBeInTheDocument();
  });

  test("it is said only once every table it was looked up in has answered", async () => {
    renderWithChips([chip("primaryEntityId", DELETED_SERVICE_ID)]);

    await screen.findByTestId(FILTER_CHIP_NOT_FOUND_TEST_ID);

    // The services read, and then every other table the resolver knows.
    const asked: Set<unknown> = new Set<unknown>(
      getListMock.mock.calls.map((call: Array<unknown>): unknown => {
        return (call[0] as { modelType: unknown }).modelType;
      }),
    );

    for (const modelType of [
      Service,
      RumApplication,
      Host,
      KubernetesCluster,
    ]) {
      expect(asked.has(modelType)).toBe(true);
    }
  });

  test("while its services read is in flight, the chip is never said to be gone", async () => {
    pendingModels.add(Service);

    renderWithChips([chip("primaryEntityId", DELETED_SERVICE_ID)]);

    // The chip is up, waiting, with what it came with.
    expect(
      await screen.findByTitle(`Remove Service: ${DELETED_SERVICE_ID}`),
    ).toBeInTheDocument();

    // However long the read takes.
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 50);
    });

    expect(
      screen.queryByTestId(FILTER_CHIP_NOT_FOUND_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("after a read failed, the chip is never said to be gone: the read is said, and the id kept", async () => {
    failingModels.add(Service);

    renderWithChips([chip("primaryEntityId", DELETED_SERVICE_ID)]);

    expect(
      await screen.findByText(/These could not be read\./),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(FILTER_CHIP_NOT_FOUND_TEST_ID),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTitle(`Remove Service: ${DELETED_SERVICE_ID}`),
    ).toBeInTheDocument();
  });

  test("a table the reader may not read leaves the chip unsettled: it may be there", async () => {
    // Every Service read answers; the hosts' does not.
    failingModels.add(Host);

    renderWithChips([chip("primaryEntityId", DELETED_SERVICE_ID)]);

    await waitFor(() => {
      expect(
        getListMock.mock.calls.some((call: Array<unknown>): boolean => {
          return (call[0] as { modelType: unknown }).modelType === Host;
        }),
      ).toBe(true);
    });

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 50);
    });

    expect(
      screen.queryByTestId(FILTER_CHIP_NOT_FOUND_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("it is taken out by its id, as it was saved", async () => {
    const onRemoveFilter: jest.Mock = jest.fn();

    renderWithChips(
      [chip("primaryEntityId", DELETED_SERVICE_ID)],
      onRemoveFilter as never,
    );

    fireEvent.click(
      await screen.findByTitle("Remove Service: No longer available"),
    );

    expect(onRemoveFilter).toHaveBeenCalledWith(
      "primaryEntityId",
      DELETED_SERVICE_ID,
    );
  });

  test("a Host chip naming a deleted host reads No longer available", async () => {
    renderWithChips([chip("hostId", DELETED_HOST_ID)]);

    expect(
      await screen.findByTitle("Remove Host: No longer available"),
    ).toBeInTheDocument();
    expect(screen.queryByText(DELETED_HOST_ID)).not.toBeInTheDocument();
  });

  test("a chip leaving out a deleted service reads No longer available too", async () => {
    renderWithChips([chip("!primaryEntityId", DELETED_SERVICE_ID)]);

    expect(
      await screen.findByTestId(FILTER_CHIP_NOT_FOUND_TEST_ID),
    ).toHaveTextContent("No longer available");
  });

  test("beside it, a chip naming a service past the 10,000th is named, and one archived is marked so", async () => {
    renderWithChips([
      chip("primaryEntityId", DELETED_SERVICE_ID),
      chip("primaryEntityId", LATE_SERVICE_ID),
      chip("primaryEntityId", ARCHIVED_SERVICE_ID),
    ]);

    expect(
      await screen.findByTitle("Remove Service: wbkiosk-payments"),
    ).toBeInTheDocument();
    expect(
      await screen.findByTitle("Remove Service: wbkiosk-legacy (archived)"),
    ).toBeInTheDocument();
    expect(
      await screen.findByTitle("Remove Service: No longer available"),
    ).toBeInTheDocument();
    expect(screen.getAllByTestId(FILTER_CHIP_NOT_FOUND_TEST_ID)).toHaveLength(
      1,
    );
  });
});
