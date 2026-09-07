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
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import InventoryItem from "../../../Models/DatabaseModels/InventoryItem";
import InventoryItemRelationship from "../../../Models/DatabaseModels/InventoryItemRelationship";
import GreaterThanOrEqual from "../../../Types/BaseDatabase/GreaterThanOrEqual";
import InBetween from "../../../Types/BaseDatabase/InBetween";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import ObjectID from "../../../Types/ObjectID";
import RangeStartAndEndDateTime from "../../../Types/Time/RangeStartAndEndDateTime";
import TimeRange from "../../../Types/Time/TimeRange";
import useTopologyData from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/UseTopologyData";

const getListMock: MockFunction = getJestMockFunction();
const getProjectIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return getProjectIdMock();
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (error: unknown): string => {
        return error instanceof Error
          ? error.message
          : "Unable to load topology";
      },
    },
  };
});

const PROJECT_ID: ObjectID = new ObjectID(
  "dde060c6-fe0d-49ce-b44c-4035a13bc1db",
);
const FIRST_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(
    new Date("2026-09-01T09:15:00.000Z"),
    new Date("2026-09-01T10:15:00.000Z"),
  ),
};
const SECOND_RANGE: RangeStartAndEndDateTime = {
  range: TimeRange.CUSTOM,
  startAndEndDate: new InBetween<Date>(
    new Date("2026-09-02T09:15:00.000Z"),
    new Date("2026-09-02T10:15:00.000Z"),
  ),
};

type TopologyListResult = ListResult<InventoryItem | InventoryItemRelationship>;

interface DeferredResult {
  promise: Promise<TopologyListResult>;
  resolve: (result: TopologyListResult) => void;
  reject: (error: Error) => void;
}

function deferred(): DeferredResult {
  let resolve!: (result: TopologyListResult) => void;
  let reject!: (error: Error) => void;
  const promise: Promise<TopologyListResult> = new Promise(
    (
      resolvePromise: (result: TopologyListResult) => void,
      rejectPromise: (error: Error) => void,
    ): void => {
      resolve = resolvePromise;
      reject = rejectPromise;
    },
  );
  return { promise, resolve, reject };
}

function result(name?: string, count?: number): TopologyListResult {
  const data: Array<InventoryItem> = [];
  if (name) {
    const entity: InventoryItem = new InventoryItem();
    entity.entityKey = name;
    entity.displayName = name;
    data.push(entity);
  }
  return { data, count: count ?? data.length, skip: 0, limit: 1000 };
}

function Probe(props: { range: RangeStartAndEndDateTime }): React.ReactElement {
  const data: ReturnType<typeof useTopologyData> = useTopologyData(props.range);
  return (
    <div>
      <span data-testid="loading">{String(data.isLoading)}</span>
      <span data-testid="error">{data.error}</span>
      <span data-testid="entities">
        {data.entities
          .map((entity: InventoryItem) => {
            return entity.displayName;
          })
          .join(",")}
      </span>
      <span data-testid="relationships">{data.relationships.length}</span>
      <span data-testid="truncated">{String(data.isTruncated)}</span>
      <span data-testid="updated">
        {data.lastUpdatedAt?.toISOString() || ""}
      </span>
      <button type="button" onClick={data.reload}>
        Reload topology
      </button>
    </div>
  );
}

beforeEach(() => {
  getListMock.mockReset();
  getProjectIdMock.mockReset();
  getProjectIdMock.mockReturnValue(PROJECT_ID);
  getListMock.mockResolvedValue(result());
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("topology inventory loading", () => {
  test("loads the complete current catalog with a full-precision connection recency bound", async () => {
    render(<Probe range={FIRST_RANGE} />);
    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("false");
    });
    expect(getListMock).toHaveBeenCalledTimes(2);
    const entityRequest: { query: Record<string, unknown> } =
      getListMock.mock.calls[0]![0];
    const relationshipRequest: { query: Record<string, unknown> } =
      getListMock.mock.calls[1]![0];
    expect(entityRequest.query["projectId"]).toEqual(PROJECT_ID);
    expect(entityRequest.query["isArchived"]).toBe(false);
    expect(entityRequest.query).not.toHaveProperty("lastSeenAt");
    expect(relationshipRequest.query["projectId"]).toEqual(PROJECT_ID);
    expect(relationshipRequest.query["lastSeenAt"]).toEqual(
      new GreaterThanOrEqual<Date>(FIRST_RANGE.startAndEndDate!.startValue),
    );
    expect(screen.getByTestId("updated").textContent).not.toBe("");
  });

  test("only publishes a snapshot after inventory and relationships both finish", async () => {
    const relationships: DeferredResult = deferred();
    getListMock.mockResolvedValueOnce(result("Checkout API"));
    getListMock.mockReturnValueOnce(relationships.promise);
    render(<Probe range={FIRST_RANGE} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByTestId("loading")).toHaveTextContent("true");
    expect(screen.getByTestId("entities")).toBeEmptyDOMElement();
    await act(async () => {
      relationships.resolve(result());
    });
    expect(screen.getByTestId("entities")).toHaveTextContent("Checkout API");
    expect(screen.getByTestId("loading")).toHaveTextContent("false");
  });

  test("an older range finishing last cannot replace the selected range", async () => {
    const oldEntities: DeferredResult = deferred();
    const oldRelationships: DeferredResult = deferred();
    getListMock.mockReturnValueOnce(oldEntities.promise);
    getListMock.mockReturnValueOnce(oldRelationships.promise);
    const view: ReturnType<typeof render> = render(
      <Probe range={FIRST_RANGE} />,
    );
    getListMock.mockResolvedValueOnce(result("Latest range"));
    getListMock.mockResolvedValueOnce(result());
    view.rerender(<Probe range={SECOND_RANGE} />);
    await waitFor(() => {
      expect(screen.getByTestId("entities")).toHaveTextContent("Latest range");
    });
    await act(async () => {
      oldEntities.resolve(result("Obsolete range", 100));
      oldRelationships.resolve(result());
    });
    expect(screen.getByTestId("entities")).toHaveTextContent("Latest range");
    expect(screen.getByTestId("truncated")).toHaveTextContent("false");
  });

  test("an obsolete failure cannot clear the current loading state or show an error", async () => {
    const oldEntities: DeferredResult = deferred();
    const latestEntities: DeferredResult = deferred();
    getListMock.mockReturnValueOnce(oldEntities.promise);
    getListMock.mockResolvedValueOnce(result());
    const view: ReturnType<typeof render> = render(
      <Probe range={FIRST_RANGE} />,
    );
    getListMock.mockReturnValueOnce(latestEntities.promise);
    getListMock.mockResolvedValueOnce(result());
    view.rerender(<Probe range={SECOND_RANGE} />);
    await act(async () => {
      oldEntities.reject(new Error("An old request failed"));
    });
    expect(screen.getByTestId("loading")).toHaveTextContent("true");
    expect(screen.getByTestId("error")).toBeEmptyDOMElement();
    await act(async () => {
      latestEntities.resolve(result("Current inventory"));
    });
    expect(screen.getByTestId("entities")).toHaveTextContent(
      "Current inventory",
    );
    expect(screen.getByTestId("error")).toBeEmptyDOMElement();
  });

  test.each(["inventory", "relationships"])(
    "reports a failed %s request without presenting a partial graph, then retries",
    async (failedRequest: string) => {
      if (failedRequest === "inventory") {
        getListMock.mockRejectedValueOnce(new Error("Please retry"));
        getListMock.mockResolvedValueOnce(result());
      } else {
        getListMock.mockResolvedValueOnce(result("Partial inventory"));
        getListMock.mockRejectedValueOnce(new Error("Please retry"));
      }
      render(<Probe range={FIRST_RANGE} />);
      await waitFor(() => {
        expect(screen.getByTestId("error")).toHaveTextContent("Please retry");
      });
      expect(screen.getByTestId("loading")).toHaveTextContent("false");
      expect(screen.getByTestId("entities")).toBeEmptyDOMElement();
      expect(screen.getByTestId("updated")).toBeEmptyDOMElement();
      getListMock.mockResolvedValueOnce(result("Recovered inventory"));
      getListMock.mockResolvedValueOnce(result());
      fireEvent.click(screen.getByRole("button", { name: "Reload topology" }));
      await waitFor(() => {
        expect(screen.getByTestId("entities")).toHaveTextContent(
          "Recovered inventory",
        );
      });
      expect(screen.getByTestId("error")).toBeEmptyDOMElement();
      expect(getListMock).toHaveBeenCalledTimes(4);
    },
  );

  test.each(["inventory", "relationships"])(
    "flags a truncated %s response and clears the warning after a complete reload",
    async (truncatedRequest: string) => {
      getListMock.mockResolvedValueOnce(
        result("API", truncatedRequest === "inventory" ? 2000 : 1),
      );
      getListMock.mockResolvedValueOnce(
        result(undefined, truncatedRequest === "relationships" ? 2000 : 0),
      );
      render(<Probe range={FIRST_RANGE} />);
      await waitFor(() => {
        expect(screen.getByTestId("truncated")).toHaveTextContent("true");
      });
      fireEvent.click(screen.getByRole("button", { name: "Reload topology" }));
      await waitFor(() => {
        expect(screen.getByTestId("loading")).toHaveTextContent("false");
      });
      expect(screen.getByTestId("truncated")).toHaveTextContent("false");
    },
  );

  test("changing projects refetches and ignores the previous project's response", async () => {
    const oldEntities: DeferredResult = deferred();
    getListMock.mockReturnValueOnce(oldEntities.promise);
    getListMock.mockResolvedValueOnce(result());
    const view: ReturnType<typeof render> = render(
      <Probe range={FIRST_RANGE} />,
    );
    const nextProject: ObjectID = new ObjectID(
      "22222222-2222-4222-8222-222222222222",
    );
    getProjectIdMock.mockReturnValue(nextProject);
    getListMock.mockResolvedValueOnce(result("Project two inventory"));
    getListMock.mockResolvedValueOnce(result());
    view.rerender(<Probe range={FIRST_RANGE} />);
    await waitFor(() => {
      expect(screen.getByTestId("entities")).toHaveTextContent(
        "Project two inventory",
      );
    });
    expect(getListMock.mock.calls[2]![0].query.projectId).toEqual(nextProject);
    await act(async () => {
      oldEntities.resolve(result("Project one inventory"));
    });
    expect(screen.getByTestId("entities")).toHaveTextContent(
      "Project two inventory",
    );
  });

  test("never sends an unscoped inventory request without a project", async () => {
    getProjectIdMock.mockReturnValue(null);
    render(<Probe range={FIRST_RANGE} />);
    await waitFor(() => {
      expect(screen.getByTestId("loading")).toHaveTextContent("false");
    });
    expect(getListMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("error")).toHaveTextContent("Select a project");
  });

  test("a retry supersedes a still-pending request for the same range", async () => {
    const firstAttempt: DeferredResult = deferred();
    getListMock.mockReturnValueOnce(firstAttempt.promise);
    getListMock.mockResolvedValueOnce(result());
    render(<Probe range={FIRST_RANGE} />);
    getListMock.mockResolvedValueOnce(result("Retry result"));
    getListMock.mockResolvedValueOnce(result());
    fireEvent.click(screen.getByRole("button", { name: "Reload topology" }));
    await waitFor(() => {
      expect(screen.getByTestId("entities")).toHaveTextContent("Retry result");
    });
    await act(async () => {
      firstAttempt.reject(new Error("Original attempt failed"));
    });
    expect(screen.getByTestId("entities")).toHaveTextContent("Retry result");
    expect(screen.getByTestId("error")).toBeEmptyDOMElement();
  });
});
