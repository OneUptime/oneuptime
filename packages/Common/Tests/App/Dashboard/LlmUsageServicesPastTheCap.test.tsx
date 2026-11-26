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
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

configure({ asyncUtilTimeout: 10000 });
jest.setTimeout(60000);

/*
 * AI > USAGE: THE SERVICES ITS LEADERBOARD NAMES, PAST THE PROJECT'S FIRST
 * 10,000 (#10921).
 *
 * The Service dimension of the usage leaderboard, and the line that names
 * the services counted from their usage metrics, named each service from
 * the project's first 10,000 services by name: a service past them read
 * as its bare id, and so did one deleted since. They are read by the ids
 * the table on screen names now: a service past them is named, one deleted
 * since reads "No longer available" with its id in its title, and the
 * project's services are never read whole. ModelAPI answers from a project
 * faked whole (CappedListServer); the usage read is stood in for.
 */

const fetchUsageMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AI/LlmObservabilityReads",
  () => {
    return {
      __esModule: true,
      fetchLlmUsage: (...args: Array<unknown>) => {
        return fetchUsageMock(...args);
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AI/LlmUsageTotals",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

import CappedListServer, {
  CappedListCall,
  namesSortingFirst,
} from "./CappedListServer";
import LlmUsageBreakdown from "../../../../App/FeatureSet/Dashboard/src/Components/AI/LlmUsageBreakdown";
import Service from "../../../Models/DatabaseModels/Service";
import Includes from "../../../Types/BaseDatabase/Includes";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import {
  LlmUsageGroup,
  LlmUsageResponse,
  LlmUsageService,
  LlmUsageSource,
  emptyLlmUsageFigures,
  emptyLlmUsageResponse,
} from "../../../Types/Telemetry/LlmUsageApi";
import ProjectUtil from "../../../UI/Utils/Project";
import { getJestSpyOn } from "../../Spy";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const LATE_ID: string = "a1000000-0000-4000-8000-0000000000aa";
const OTHER_LATE_ID: string = "a1000000-0000-4000-8000-0000000000ab";
const DELETED_ID: string = "a1000000-0000-4000-8000-0000000000dd";

let server: CappedListServer;

function group(
  overrides: Partial<LlmUsageGroup> & { key: string },
): LlmUsageGroup {
  return { ...emptyLlmUsageFigures(), ...overrides };
}

function usageService(
  overrides: Partial<LlmUsageService> & { serviceId: string },
): LlmUsageService {
  return { ...emptyLlmUsageFigures(), ...overrides };
}

function serve(response: Partial<LlmUsageResponse>): void {
  fetchUsageMock.mockResolvedValue({
    ...emptyLlmUsageResponse(),
    ...response,
  } as never);
}

beforeEach(() => {
  fetchUsageMock.mockReset();

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
    { _id: LATE_ID, name: "WB kiosk assistant", serviceColor: "#22c55e" },
    { _id: OTHER_LATE_ID, name: "WB kiosk coder" },
  ]);
  server.install();

  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function renderedRows(): Array<Array<string>> {
  return screen
    .queryAllByTestId("llm-usage-row")
    .map((element: HTMLElement) => {
      return Array.from(element.querySelectorAll("td")).map(
        (cell: Element): string => {
          return (cell.textContent || "").trim();
        },
      );
    });
}

async function renderBreakdown(): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <LlmUsageBreakdown />
      </MemoryRouter>,
    );
  });
}

async function pickServices(): Promise<void> {
  await act(async () => {
    fireEvent.click(
      within(screen.getByRole("group", { name: "Usage dimension" })).getByRole(
        "button",
        { name: "Application / Service" },
      ),
    );
  });
}

function serviceReads(): Array<CappedListCall> {
  return server.callsFor(Service);
}

describe("AI usage: the services its leaderboard names", () => {
  test("a service past the project's first 10,000 is named in its row, read by its id", async () => {
    serve({
      totals: { ...emptyLlmUsageFigures(), costUsd: 9 },
      groups: [
        group({
          key: LATE_ID,
          calls: 3,
          costUsd: 6,
          costSource: LlmUsageSource.Calls,
        }),
        group({
          key: PROJECT_ID,
          calls: 1,
          costUsd: 1,
          costSource: LlmUsageSource.Calls,
        }),
        group({
          key: DELETED_ID,
          calls: 1,
          costUsd: 2,
          costSource: LlmUsageSource.Calls,
        }),
      ],
    });

    await renderBreakdown();
    await pickServices();

    await waitFor(() => {
      expect(renderedRows()[0]![1]).toBe("WB kiosk assistant");
    });
    expect(renderedRows()[1]![1]).toBe("Unknown Service");
    // Deleted since: said so, its id in its title - never a bare id.
    expect(renderedRows()[2]![1]).toBe("No longer available");
    expect(screen.getByTestId("llm-usage-service-not-found")).toHaveAttribute(
      "title",
      DELETED_ID,
    );

    // By the ids the rows name, never the project's first 10,000 by name.
    expect(serviceReads().length).toBeGreaterThan(0);

    for (const call of serviceReads()) {
      expect(call.query["_id"]).toBeInstanceOf(Includes);
      expect(call.limit).toBeLessThanOrEqual(500);
    }

    const asked: Array<string> = serviceReads().flatMap(
      (call: CappedListCall): Array<string> => {
        return (call.query["_id"] as Includes).values.map(
          (value: unknown): string => {
            return String(value).toLowerCase();
          },
        );
      },
    );

    // The project's own id is the Unknown Service: never read.
    expect(asked.sort()).toEqual([LATE_ID, DELETED_ID].sort());
  });

  test("the services counted from usage metrics are named past the 10,000th too", async () => {
    serve({
      services: [
        usageService({
          serviceId: OTHER_LATE_ID,
          costUsd: 52.25,
          costSource: LlmUsageSource.Metrics,
        }),
      ],
      groups: [group({ key: "ana@example.com", calls: 3, costUsd: 52.25 })],
    });

    await renderBreakdown();

    await waitFor(() => {
      expect(screen.getByTestId("llm-usage-metric-services")).toHaveTextContent(
        "Services counted from usage metrics: WB kiosk coder",
      );
    });
  });

  test("a read that fails leaves a row's id, which still says which service it was", async () => {
    jest.spyOn(server, "list").mockImplementation((() => {
      throw new Error("The server is unavailable.");
    }) as never);

    serve({
      totals: { ...emptyLlmUsageFigures(), costUsd: 6 },
      groups: [
        group({
          key: LATE_ID,
          calls: 3,
          costUsd: 6,
          costSource: LlmUsageSource.Calls,
        }),
      ],
    });

    await renderBreakdown();
    await pickServices();

    await waitFor(() => {
      expect(renderedRows()[0]![1]).toBe(LATE_ID);
    });
    expect(screen.queryByTestId("llm-usage-service-not-found")).toBeNull();
  });
});
