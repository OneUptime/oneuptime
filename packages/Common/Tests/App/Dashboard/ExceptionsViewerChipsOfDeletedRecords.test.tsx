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
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

configure({ asyncUtilTimeout: 10000 });
jest.setTimeout(60000);

/*
 * A LINK'S OR A SAVED VIEW'S CHIP, IN THE EXCEPTIONS EXPLORER, NAMING A
 * SERVICE THAT IS GONE (#11213).
 *
 * The explorer names a chip's service by its id: the facet's names, then
 * the entity name resolver. A link holding a service deleted since - or one
 * the reader may no longer see - was named by neither, and its chip read as
 * the raw id. Once every read has answered without it, the chip is marked
 * gone (the chip row draws it "No longer available"), and one naming an
 * archived service is marked archived; the list still filters by both ids,
 * as the link said. ModelAPI answers the services from a project faked
 * whole (CappedListServer): more than the old cap, the chips' after them.
 */

type CapturedViewerProps = {
  activeFilters: Array<{
    facetKey: string;
    value: string;
    displayValue: string;
    isNotFound?: boolean | undefined;
    isArchived?: boolean | undefined;
  }>;
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

import CappedListServer, { namesSortingFirst } from "./CappedListServer";
import ExceptionsViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionsViewer";
import Host from "../../../Models/DatabaseModels/Host";
import Service from "../../../Models/DatabaseModels/Service";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import Includes from "../../../Types/BaseDatabase/Includes";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";
import TelemetryEntityNameResolver from "../../../UI/Utils/Telemetry/TelemetryEntityNames";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const LATE_ID: string = "a1000000-0000-4000-8000-0000000000aa";
const ARCHIVED_ID: string = "a1000000-0000-4000-8000-0000000000a2";
const DELETED_ID: string = "dead0000-0000-4000-8000-00000000dead";

type ListArgs = {
  modelType: { new (): unknown };
  query: Record<string, unknown>;
};

let server: CappedListServer;
// The reads of these models fail, while listed.
let failingModels: Set<unknown>;

const chipOf: (
  value: string,
) => CapturedViewerProps["activeFilters"][number] | undefined = (
  value: string,
): CapturedViewerProps["activeFilters"][number] | undefined => {
  return (capturedViewerProps?.activeFilters || []).find(
    (chip: { value: string; facetKey: string }): boolean => {
      return chip.value === value && chip.facetKey === "primaryEntityId";
    },
  );
};

const exceptionListQueries: () => Array<Record<string, unknown>> = (): Array<
  Record<string, unknown>
> => {
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
};

beforeEach(() => {
  capturedViewerProps = null;
  failingModels = new Set<unknown>();
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
    {
      _id: ARCHIVED_ID,
      name: "wbkiosk-legacy",
      serviceColor: "#64748b",
      isArchived: true,
    },
  ]);

  getListMock.mockReset();
  getListMock.mockImplementation(async (...args: Array<any>) => {
    const options: ListArgs = args[0] as ListArgs;

    if (failingModels.has(options.modelType)) {
      throw new Error("These could not be read.");
    }

    if (options.modelType === TelemetryException) {
      return { data: [], count: 0 };
    }

    return server.list(options as never);
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

// The explorer opened from a link, or a saved view, holding these services.
async function renderWithServices(ids: Array<string>): Promise<void> {
  window.history.pushState(
    {},
    "",
    `/?filters=${encodeURIComponent(
      JSON.stringify(
        ids.map((id: string): [string, string] => {
          return ["primaryEntityId", id];
        }),
      ),
    )}`,
  );

  await act(async (): Promise<void> => {
    render(
      <MemoryRouter>
        <ExceptionsViewer />
      </MemoryRouter>,
    );
  });
}

describe("Exceptions explorer: a link's chip naming a service that is gone", () => {
  test("is marked gone once every read answered without it - and the list still filters by it", async () => {
    await renderWithServices([DELETED_ID]);

    await waitFor(() => {
      expect(chipOf(DELETED_ID)?.isNotFound).toBe(true);
    });

    // Its id, as the link said: what the chip still filters by.
    expect(chipOf(DELETED_ID)?.value).toBe(DELETED_ID);

    await waitFor(() => {
      expect(exceptionListQueries().length).toBeGreaterThan(0);
    });

    const filtered: unknown =
      exceptionListQueries()[exceptionListQueries().length - 1]![
        "primaryEntityId"
      ];
    const ids: Array<string> =
      filtered instanceof Includes
        ? filtered.values.map((value: unknown): string => {
            return String(value).toLowerCase();
          })
        : [String(filtered).toLowerCase()];

    expect(ids).toContain(DELETED_ID);
  });

  test("beside it, a service past the 10,000th is named and an archived one marked so", async () => {
    await renderWithServices([DELETED_ID, LATE_ID, ARCHIVED_ID]);

    await waitFor(() => {
      expect(chipOf(DELETED_ID)?.isNotFound).toBe(true);
      expect(chipOf(LATE_ID)?.displayValue).toBe("wbkiosk-payments");
      expect(chipOf(ARCHIVED_ID)?.isArchived).toBe(true);
    });

    expect(chipOf(LATE_ID)?.isNotFound).toBeUndefined();
    expect(chipOf(ARCHIVED_ID)?.displayValue).toBe("wbkiosk-legacy");
  });

  test("a table that failed to answer leaves it unmarked: it may be there", async () => {
    failingModels.add(Host);

    await renderWithServices([DELETED_ID]);

    await waitFor(() => {
      expect(
        getListMock.mock.calls.some((call: Array<unknown>): boolean => {
          return (call[0] as ListArgs).modelType === Host;
        }),
      ).toBe(true);
    });

    await act(async (): Promise<void> => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 50);
      });
    });

    expect(chipOf(DELETED_ID)?.isNotFound).toBeUndefined();
    expect(chipOf(DELETED_ID)?.displayValue).toBe(DELETED_ID);
  });
});
