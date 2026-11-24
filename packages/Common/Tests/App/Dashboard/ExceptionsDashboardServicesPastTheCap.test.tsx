/** @timezone UTC */

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

configure({ asyncUtilTimeout: 10000 });
jest.setTimeout(60000);

/*
 * EXCEPTIONS > INSIGHTS: THE SERVICES ITS ROWS NAME, PAST THE PROJECT'S
 * FIRST 10,000 (#10921).
 *
 * An exception's source is a polymorphic id, and the page named its most
 * frequent bugs, its affected services and its recently active exceptions
 * from the project's first 10,000 services by name: a service past them
 * read as "Unknown" - its colour lost - wherever it was the source. The
 * services the rows name are read by their ids as the page loads now, in
 * pages, never the project's whole list. ModelAPI answers from a project
 * faked whole (CappedListServer); the summary route is stood in for.
 */

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionAIDigest",
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
import ExceptionsDashboard from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionsDashboard";
import Service from "../../../Models/DatabaseModels/Service";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Includes from "../../../Types/BaseDatabase/Includes";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import API from "../../../UI/Utils/API/API";
import ProjectUtil from "../../../UI/Utils/Project";
import { getJestSpyOn } from "../../Spy";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const EARLY_ID: string = "a1000000-0000-4000-8000-000000000001";
const LATE_ID: string = "a1000000-0000-4000-8000-0000000000aa";
const OTHER_LATE_ID: string = "a1000000-0000-4000-8000-0000000000ab";
const DELETED_ID: string = "a1000000-0000-4000-8000-0000000000dd";
const HOST_ID: string = "b1000000-0000-4000-8000-0000000000aa";

let server: CappedListServer;

function exception(data: {
  id: string;
  message: string;
  entityId: string;
  entityType: ServiceType;
  occurrences: number;
}): JSONObject {
  return {
    _id: data.id,
    message: data.message,
    exceptionType: "Error",
    primaryEntityId: data.entityId,
    primaryEntityType: data.entityType,
    occuranceCount: data.occurrences,
    firstSeenAt: "2026-11-23T10:00:00.000Z",
    lastSeenAt: "2026-11-24T10:00:00.000Z",
  };
}

beforeEach(() => {
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
    { _id: EARLY_ID, name: "AA early api", serviceColor: "#6366f1" },
    { _id: LATE_ID, name: "WB kiosk payments", serviceColor: "#22c55e" },
    { _id: OTHER_LATE_ID, name: "WB kiosk login", serviceColor: "#f59e0b" },
  ]);
  server.install();

  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );

  getJestSpyOn(API, "post").mockImplementation((async (): Promise<
    HTTPResponse<JSONObject>
  > => {
    return new HTTPResponse<JSONObject>(
      200,
      {
        unresolvedCount: 5,
        resolvedCount: 1,
        archivedCount: 0,
        topExceptions: [
          exception({
            id: "e1000000-0000-4000-8000-000000000001",
            message: "Card declined at the kiosk",
            entityId: LATE_ID,
            entityType: ServiceType.OpenTelemetry,
            occurrences: 40,
          }),
          exception({
            id: "e1000000-0000-4000-8000-000000000002",
            message: "Session expired too soon",
            entityId: DELETED_ID,
            entityType: ServiceType.OpenTelemetry,
            occurrences: 12,
          }),
        ],
        recentExceptions: [
          exception({
            id: "e1000000-0000-4000-8000-000000000003",
            message: "Login throttled",
            entityId: OTHER_LATE_ID,
            entityType: ServiceType.OpenTelemetry,
            occurrences: 3,
          }),
          exception({
            id: "e1000000-0000-4000-8000-000000000004",
            message: "Disk almost full",
            entityId: HOST_ID,
            entityType: ServiceType.Host,
            occurrences: 1,
          }),
        ],
        serviceSummaries: [
          {
            primaryEntityId: LATE_ID,
            primaryEntityType: ServiceType.OpenTelemetry,
            unresolvedCount: 3,
            totalOccurrences: 40,
          },
          {
            primaryEntityId: EARLY_ID,
            primaryEntityType: ServiceType.OpenTelemetry,
            unresolvedCount: 1,
            totalOccurrences: 4,
          },
          {
            primaryEntityId: PROJECT_ID,
            primaryEntityType: ServiceType.Unknown,
            unresolvedCount: 1,
            totalOccurrences: 2,
          },
        ],
      },
      {},
    );
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderPage(): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <ExceptionsDashboard />
      </MemoryRouter>,
    );
  });
}

function serviceReads(): Array<CappedListCall> {
  return server.callsFor(Service);
}

describe("Exceptions Insights: the services its rows name", () => {
  test("a service past the project's first 10,000 names its bugs, its affected-services row and its recent exceptions", async () => {
    await renderPage();

    await waitFor(() => {
      expect(screen.getAllByText("WB kiosk payments").length).toBe(2);
    });
    expect(screen.getByText("WB kiosk login")).toBeInTheDocument();
    expect(screen.getByText("AA early api")).toBeInTheDocument();
    // The telemetry that named no service, and a host's, as before.
    expect(screen.getByText("Unknown Service")).toBeInTheDocument();
    expect(screen.getByText("Host telemetry")).toBeInTheDocument();
  });

  test("the services are read by the ids the rows name, once, never the project's first 10,000 by name", async () => {
    await renderPage();

    await waitFor(() => {
      expect(screen.getAllByText("WB kiosk payments").length).toBe(2);
    });

    expect(serviceReads()).toHaveLength(1);
    expect(serviceReads()[0]!.query["_id"]).toBeInstanceOf(Includes);
    expect(serviceReads()[0]!.limit).toBeLessThan(LIMIT_PER_PROJECT);

    const asked: Array<string> = (
      serviceReads()[0]!.query["_id"] as Includes
    ).values.map((value: unknown): string => {
      return String(value).toLowerCase();
    });

    // The project's own id is never read: it is the Unknown Service.
    expect(asked.sort()).toEqual(
      [LATE_ID, DELETED_ID, OTHER_LATE_ID, HOST_ID, EARLY_ID].sort(),
    );
    expect(asked).not.toContain(PROJECT_ID);
  });

  test("a service deleted since is not named as another: its bug reads its type's fallback", async () => {
    await renderPage();

    await waitFor(() => {
      expect(screen.getByText("Session expired too soon")).toBeInTheDocument();
    });

    const row: HTMLElement = screen
      .getByText("Session expired too soon")
      .closest("li") as HTMLElement;

    expect(row).not.toHaveTextContent("WB kiosk");
  });

  test("a read that fails leaves the page drawn, its rows by their fallback", async () => {
    jest.spyOn(server, "list").mockImplementation((() => {
      throw new Error("The server is unavailable.");
    }) as never);

    await renderPage();

    await waitFor(() => {
      expect(
        screen.getByText("Card declined at the kiosk"),
      ).toBeInTheDocument();
    });
    expect(screen.queryByText("WB kiosk payments")).toBeNull();
  });
});
