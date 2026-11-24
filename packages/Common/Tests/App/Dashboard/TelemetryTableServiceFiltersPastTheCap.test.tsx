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

/*
 * Permissions and the signed-in user are stubbed to their permissive form,
 * as in BaseModelTablePickersPastTheCap: who may read what is not the
 * subject.
 */
jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: () => {
        return [];
      },
      getProjectPermissions: () => {
        return [];
      },
      getGlobalPermissions: () => {
        return [];
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: () => {
        return true;
      },
      getUserId: () => {
        return null;
      },
    },
  };
});

import CappedListServer, {
  CappedListCall,
  namesSortingFirst,
} from "./CappedListServer";
import TraceTable from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TraceTable";
import ProfileTable from "../../../../App/FeatureSet/Dashboard/src/Components/Profiles/ProfileTable";
import LlmCallsTable from "../../../../App/FeatureSet/Dashboard/src/Components/AI/LlmCallsTable";
import { LLM_CALLS_TABLE_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/AI/LlmCallsRoute";
import Profile from "../../../Models/AnalyticsModels/Profile";
import Span, { SpanStatus } from "../../../Models/AnalyticsModels/Span";
import Service from "../../../Models/DatabaseModels/Service";
import Includes from "../../../Types/BaseDatabase/Includes";
import Search from "../../../Types/BaseDatabase/Search";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import AnalyticsModelAPI from "../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import API from "../../../UI/Utils/API/API";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import ProjectUtil from "../../../UI/Utils/Project";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import TelemetryEntityNameResolver from "../../../UI/Utils/Telemetry/TelemetryEntityNames";
import { getJestSpyOn } from "../../Spy";

/*
 * THE TRACES, PROFILES AND AI CALLS TABLES' SERVICE FILTERS AND SERVICE
 * COLUMNS, PAST THE PROJECT'S FIRST 10,000 SERVICES (#10764).
 *
 * The tables read the project's first 10,000 services by name: their
 * Service filter offered only those (and "Unknown Service"), a filter
 * restored from a link that named a service past them showed nothing for
 * it - while still narrowing the list - and a row whose service sorted past
 * them read "Unknown". The filter searches the server now, through the
 * database's list route (the tables read their rows from ClickHouse), still
 * offering "Unknown Service"; what it holds is named by its ids; and the
 * rows name their services by a read of the services the page holds.
 * ModelAPI answers from a project faked whole (CappedListServer); the rows
 * come from AnalyticsModelAPI.
 */

configure({ asyncUtilTimeout: 10000 });
jest.setTimeout(60000);

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const EARLY_ID: string = "b1000000-0000-4000-8000-000000000001";
const LATE_ID: string = "b1000000-0000-4000-8000-0000000000aa";
const OTHER_LATE_ID: string = "b1000000-0000-4000-8000-0000000000ab";
const ARCHIVED_ID: string = "b1000000-0000-4000-8000-0000000000ac";
const DELETED_ID: string = "b1000000-0000-4000-8000-0000000000dd";

let server: CappedListServer;
let analyticsCalls: Array<{
  modelType: unknown;
  query: Record<string, unknown>;
}> = [];

interface TableCase {
  name: string;
  // The table's URL state key: its userPreferencesKey.
  urlStateKey: string;
  element: () => React.ReactElement;
  rowsModel: { new (): Span | Profile };
  rows: () => Array<Span | Profile>;
}

const span: (entityId: string, index: number) => Span = (
  entityId: string,
  index: number,
): Span => {
  const row: Span = new Span();
  // A ClickHouse row's id is an ObjectID, not a database row's string.
  row._id = ObjectID.generate();
  row.traceId = `trace-${entityId.slice(-4)}-${index}`;
  row.spanId = `span-${entityId.slice(-4)}-${index}`;
  row.name = `GET /${entityId.slice(-4)}`;
  row.primaryEntityId = new ObjectID(entityId);
  row.startTime = new Date("2026-11-24T10:00:00.000Z");
  row.statusCode = SpanStatus.Ok;
  return row;
};

const profile: (
  entityId: string,
  entityType: ServiceType,
  index: number,
) => Profile = (
  entityId: string,
  entityType: ServiceType,
  index: number,
): Profile => {
  const row: Profile = new Profile();
  row._id = ObjectID.generate();
  row.profileId = `profile-${entityId.slice(-4)}-${index}`;
  row.profileType = "cpu";
  row.primaryEntityId = new ObjectID(entityId);
  row.primaryEntityType = entityType;
  row.startTime = new Date("2026-11-24T10:00:00.000Z");
  row.sampleCount = 120;
  return row;
};

const CASES: Array<TableCase> = [
  {
    name: "Traces",
    urlStateKey: "trace-table",
    element: () => {
      return <TraceTable />;
    },
    rowsModel: Span,
    rows: () => {
      return [span(LATE_ID, 1), span(EARLY_ID, 2), span(PROJECT_ID, 3)];
    },
  },
  {
    name: "Profiles",
    urlStateKey: "profile-table",
    element: () => {
      return <ProfileTable />;
    },
    rowsModel: Profile,
    rows: () => {
      return [
        profile(LATE_ID, ServiceType.OpenTelemetry, 1),
        profile(EARLY_ID, ServiceType.OpenTelemetry, 2),
        profile(PROJECT_ID, ServiceType.Unknown, 3),
      ];
    },
  },
  // AI / LLM > Calls: the same spans, its own Service filter and column.
  {
    name: "AI calls",
    urlStateKey: LLM_CALLS_TABLE_ID,
    element: () => {
      return <LlmCallsTable />;
    },
    rowsModel: Span,
    rows: () => {
      return [span(LATE_ID, 1), span(EARLY_ID, 2), span(PROJECT_ID, 3)].map(
        (row: Span): Span => {
          row.isLlmSpan = true;
          row.llmRequestModel = "gpt-4o";
          return row;
        },
      );
    },
  },
];

beforeEach(() => {
  server = new CappedListServer();
  analyticsCalls = [];
  TelemetryEntityNameResolver.clearCache();

  server.add(
    Service,
    namesSortingFirst(LIMIT_PER_PROJECT + 50).map(
      (name: string): Record<string, unknown> => {
        return { _id: ObjectID.generate().toString(), name: name };
      },
    ),
  );
  server.add(Service, [
    { _id: EARLY_ID, name: "AA early service" },
    { _id: LATE_ID, name: "WB kiosk api" },
    { _id: OTHER_LATE_ID, name: "WB kiosk web" },
    { _id: ARCHIVED_ID, name: "WB kiosk legacy", isArchived: true },
  ]);
  server.install();

  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );

  /*
   * The AI calls list asks the AI setup check why it is empty, once a
   * filter leaves it so: unanswered here, it falls back to its own words.
   */
  getJestSpyOn(API, "post").mockResolvedValue(
    new HTTPErrorResponse(500, { error: "Not answered here." }, {}) as never,
  );

  window.history.replaceState(window.history.state, "", "/dashboard/traces");
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

// The table's rows, narrowed by its query's service as the server would.
function answerRows(testCase: TableCase): void {
  const rows: Array<Span | Profile> = testCase.rows();

  getJestSpyOn(AnalyticsModelAPI, "getList").mockImplementation(
    (async (options: {
      modelType: unknown;
      query: Record<string, unknown>;
    }): Promise<unknown> => {
      analyticsCalls.push({
        modelType: options.modelType,
        query: options.query,
      });

      const scope: unknown = options.query["primaryEntityId"];
      const shown: Array<Span | Profile> =
        scope instanceof Includes
          ? rows.filter((row: Span | Profile): boolean => {
              return scope.values
                .map((value: unknown): string => {
                  return String(value).toLowerCase();
                })
                .includes(String(row.primaryEntityId).toLowerCase());
            })
          : rows;

      return { data: shown, count: shown.length, skip: 0, limit: 10 };
    }) as never,
  );
}

async function renderTable(testCase: TableCase): Promise<void> {
  answerRows(testCase);

  await act(async () => {
    render(<MemoryRouter>{testCase.element()}</MemoryRouter>);
  });
}

function serviceReads(): Array<CappedListCall> {
  return server.callsFor(Service);
}

function idsOf(value: unknown): Array<string> {
  return value instanceof Includes
    ? value.values.map((entry: unknown): string => {
        return String(entry).toLowerCase();
      })
    : [];
}

// The service the table's last read of its rows narrowed by.
function lastRowScope(): Array<string> {
  return idsOf(
    analyticsCalls[analyticsCalls.length - 1]?.query["primaryEntityId"],
  );
}

// What the applied filters' chips say, joined.
function appliedChips(): string {
  return screen
    .queryAllByTestId("applied-filter-chip")
    .map((chip: HTMLElement): string => {
      return chip.textContent || "";
    })
    .join(" | ");
}

// The Service filter's picker, by its name (a held value hides its placeholder).
async function openFilterForm(): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole("button", { name: "More options" }));
  fireEvent.click(screen.getByRole("menuitem", { name: "Filter" }));

  return await screen.findByRole("combobox", { name: "Filter by Service" });
}

describe.each(CASES)("the $name table", (testCase: TableCase) => {
  test("names a row's service past the 10,000th by a read of the page's services by id, never the first 10,000", async () => {
    await renderTable(testCase);

    expect(await screen.findByText("WB kiosk api")).toBeInTheDocument();
    expect(screen.getByText("AA early service")).toBeInTheDocument();
    // Telemetry that named no service: the stand-in, never read.
    expect(screen.getByText("Unknown Service")).toBeInTheDocument();

    for (const call of serviceReads()) {
      expect(call.limit).toBeLessThan(LIMIT_PER_PROJECT);
      expect(call.query["_id"]).toBeInstanceOf(Includes);
    }

    const byId: CappedListCall | undefined = serviceReads().find(
      (call: CappedListCall): boolean => {
        return idsOf(call.query["_id"]).includes(LATE_ID);
      },
    );

    expect(idsOf(byId!.query["_id"]).sort()).toEqual(
      [EARLY_ID, LATE_ID].sort(),
    );
    // The rows, and nothing else, from the analytics API.
    for (const call of analyticsCalls) {
      expect(call.modelType).toBe(testCase.rowsModel);
    }
  });

  test("a Service filter restored from a link names a service past the 10,000th by its id, one deleted as No longer available, Unknown Service by itself, and keeps all three applied", async () => {
    TableFilterUrlState.write(testCase.urlStateKey, "filter", {
      primaryEntityId: [LATE_ID, DELETED_ID, PROJECT_ID],
    });

    await renderTable(testCase);

    await waitFor(() => {
      expect(appliedChips()).toMatch(
        /Service is any of: WB kiosk api, No longer available, Unknown Service/,
      );
    });

    // Read by their ids: the one gone asked for, Unknown Service never.
    const held: CappedListCall | undefined = serviceReads().find(
      (call: CappedListCall): boolean => {
        return idsOf(call.query["_id"]).includes(DELETED_ID);
      },
    );

    expect(idsOf(held!.query["_id"]).sort()).toEqual(
      [DELETED_ID, LATE_ID].sort(),
    );
    expect(held!.select["isArchived"]).toBe(true);

    for (const call of serviceReads()) {
      expect(idsOf(call.query["_id"])).not.toContain(PROJECT_ID);
      expect(call.limit).toBeLessThan(LIMIT_PER_PROJECT);
    }

    // Applied as it was saved, the deleted service with it.
    expect(lastRowScope()).toEqual([LATE_ID, DELETED_ID, PROJECT_ID]);
    expect(TableFilterUrlState.read(testCase.urlStateKey, "filter")).toEqual({
      primaryEntityId: [LATE_ID, DELETED_ID, PROJECT_ID],
    });
  });

  test("its picker searches the server: a service past the 10,000th found, archived ones marked, Unknown Service offered, and the pick narrows the list", async () => {
    await renderTable(testCase);
    await screen.findByText("WB kiosk api");

    const picker: HTMLElement = await openFilterForm();

    // A list of values to pick from, with no operator to pick.
    expect(
      (picker.closest("div.grid") as HTMLElement).querySelector(
        '[id^="operator-selector-trigger-"]',
      ),
    ).toBeNull();

    await act(async () => {
      fireEvent.focus(picker);
    });

    // Unknown Service, the telemetry that named no service, first.
    expect((await screen.findAllByRole("option"))[0]!).toHaveTextContent(
      "Unknown Service",
    );

    await act(async () => {
      fireEvent.change(picker, { target: { value: "WB kiosk" } });
    });

    await waitFor(() => {
      expect(
        screen.queryAllByRole("option").map((option: HTMLElement): string => {
          return option.textContent || "";
        }),
      ).toEqual(["WB kiosk api", "WB kiosk legacyArchived", "WB kiosk web"]);
    });

    const searched: Array<CappedListCall> = serviceReads().filter(
      (call: CappedListCall): boolean => {
        return call.query["name"] instanceof Search;
      },
    );

    expect(
      (searched[searched.length - 1]!.query["name"] as Search<string>)
        .toString()
        .trim(),
    ).toBe("WB kiosk");

    for (const call of searched) {
      expect(call.limit).toBeLessThanOrEqual(50);
      // Archived services keep sending telemetry: offered, never left out.
      expect(call.query["isArchived"]).toBeUndefined();
    }

    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: /WB kiosk web/ }));
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });

    await waitFor(() => {
      expect(appliedChips()).toMatch(/Service is WB kiosk web/);
    });
    expect(lastRowScope()).toEqual([OTHER_LATE_ID]);
    expect(TableFilterUrlState.read(testCase.urlStateKey, "filter")).toEqual({
      primaryEntityId: [OTHER_LATE_ID],
    });
  });

  test("a deleted service the filter holds is taken out by hand, and the list widens with it", async () => {
    TableFilterUrlState.write(testCase.urlStateKey, "filter", {
      primaryEntityId: [LATE_ID, DELETED_ID],
    });

    await renderTable(testCase);

    await waitFor(() => {
      expect(appliedChips()).toMatch(
        /Service is any of: WB kiosk api, No longer available/,
      );
    });

    await openFilterForm();

    await waitFor(() => {
      expect(
        screen
          .getAllByTestId("entity-dropdown-chip-label")
          .map((chip: HTMLElement): string => {
            return chip.textContent || "";
          }),
      ).toEqual(["WB kiosk api", "No longer available"]);
    });

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Remove No longer available" }),
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });

    await waitFor(() => {
      expect(lastRowScope()).toEqual([LATE_ID]);
    });
    expect(appliedChips()).toMatch(/Service is WB kiosk api/);
  });

  test("an archived service the filter holds is named and marked Archived in its picker", async () => {
    TableFilterUrlState.write(testCase.urlStateKey, "filter", {
      primaryEntityId: [ARCHIVED_ID],
    });

    await renderTable(testCase);

    await waitFor(() => {
      expect(appliedChips()).toMatch(/Service is WB kiosk legacy/);
    });

    await openFilterForm();

    const chip: HTMLElement = await screen.findByTestId(
      "entity-dropdown-chip-label",
    );

    expect(chip).toHaveTextContent("WB kiosk legacy");
    expect(
      within(chip.parentElement as HTMLElement).getByTestId(
        "entity-dropdown-archived-tag",
      ),
    ).toBeInTheDocument();
  });
});
