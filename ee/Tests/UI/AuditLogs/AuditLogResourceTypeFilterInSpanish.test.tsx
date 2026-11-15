import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
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
  within,
} from "@testing-library/react";
import i18next from "i18next";
import * as React from "react";
import { initReactI18next } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { readDashboardLocale } from "Common/Tests/Helpers/DashboardLocales";

/*
 * ---------------------------------------------------------------------------
 * The audit log's Resource Type filter, in Spanish, in the real table
 * (#7580).
 * ---------------------------------------------------------------------------
 *
 * Every entry about an On-Call Schedule is stored as "On-Call Policy
 * Schedule", the name the model keeps for the API. The Resource Type
 * filter was free text on that value: "On-Call Schedule", as the rows call
 * it, found nothing. It now offers the types the entries are about, by the
 * rows' words in the reader's language, and asks for the stored name.
 *
 * The real audit log table (ee/Dashboard/AuditLogs/AuditLogsTable) over a
 * fake audit log API, which answers as the server does: a list read with
 * each type by both of its names (AuditLogService's rewrite, the real
 * one), and the filter's grouped read with one row per stored type. In
 * Spanish:
 *
 *   - a link filtered to the schedule's stored name reads, in its chip and
 *     in the menu's picked value, "Programación de guardia", and its rows
 *     are the schedule's, whichever name they are stored under;
 *   - the menu offers each stored type once, in Spanish, in Spanish order;
 *   - typing the name shown, its Spanish, or the old name in the menu's
 *     search finds the schedule, and picking it asks for the stored name.
 */

configure({ asyncUtilTimeout: 15000 });

jest.setTimeout(120000);

jest.mock("Common/UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      // A project owner: may read the audit log.
      getAllPermissions: (): Array<unknown> => {
        return ["ProjectOwner"];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: ["Public", "User", "CurrentUser"] };
      },
    },
  };
});

jest.mock("Common/UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): { toString: () => string } => {
        return {
          toString: () => {
            return "75800000-0000-4000-8000-000000000301";
          },
        };
      },
      getName: (): string => {
        return "Test User";
      },
      getEmail: (): string => {
        return "test@example.com";
      },
    },
  };
});

import AuditLogsTable from "../../../Dashboard/AuditLogs/AuditLogsTable";
import AuditLog from "Common/Models/AnalyticsModels/AuditLog";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Project from "Common/Models/DatabaseModels/Project";
import Includes from "Common/Types/BaseDatabase/Includes";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import Query from "Common/Types/BaseDatabase/Query";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/UI/Utils/API/API";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import TableFilterUrlState from "Common/UI/Utils/TableFilterUrlState";
import { withAuditLogResourceTypeSpellings } from "Common/Utils/AuditLog/AuditLogResourceTypes";

const SPANISH: Record<string, string> = readDashboardLocale("es");

const PROJECT_ID: string = "75800000-0000-4000-8000-000000000300";

const TABLE_ID: string = "audit-logs-table";

// A Spanish word of the Dashboard's.
function spanish(english: string): string {
  const word: string | undefined = SPANISH[english];

  if (!word) {
    throw new Error(`Spanish has no word for "${english}"`);
  }

  return word;
}

function entry(data: {
  id: string;
  resourceType: string;
  resourceName: string;
}): AuditLog {
  const auditLog: AuditLog = new AuditLog();
  auditLog._id = data.id;
  auditLog.projectId = new ObjectID(PROJECT_ID);
  auditLog.createdAt = new Date("2026-11-14T09:00:00.000Z");
  auditLog.action = "Update";
  auditLog.resourceType = data.resourceType;
  auditLog.resourceName = data.resourceName;
  auditLog.resourceId = ObjectID.generate();
  auditLog.userType = "User";
  auditLog.userName = "Grace Hopper";
  auditLog.userEmail = "grace@acme.test";
  auditLog.changes = [];
  return auditLog;
}

// The project's audit log: the schedule's entries stored each way, and others.
const ENTRIES: Array<AuditLog> = [
  entry({
    id: "75800000-0000-4000-8000-000000000311",
    resourceType: "On-Call Policy Schedule",
    resourceName: "Primary rota",
  }),
  entry({
    id: "75800000-0000-4000-8000-000000000312",
    resourceType: "On-Call Policy Schedule",
    resourceName: "Weekend rota",
  }),
  entry({
    id: "75800000-0000-4000-8000-000000000313",
    resourceType: "On-Call Schedule",
    resourceName: "Night rota",
  }),
  entry({
    id: "75800000-0000-4000-8000-000000000314",
    resourceType: "User's On-Call Duty Escalation Rule",
    resourceName: "Ada Lovelace",
  }),
  entry({
    id: "75800000-0000-4000-8000-000000000315",
    resourceType: "Monitor",
    resourceName: "Checkout API",
  }),
  entry({
    id: "75800000-0000-4000-8000-000000000316",
    resourceType: "Telemetry Ingestion Key",
    resourceName: "Production collector",
  }),
];

const SCHEDULE_ROTAS: Array<string> = [
  "Primary rota",
  "Weekend rota",
  "Night rota",
];

// Whether an entry's stored type meets a query's condition, as ClickHouse reads it.
function meets(condition: unknown, type: string | undefined): boolean {
  if (condition === undefined) {
    return true;
  }

  if (condition instanceof Includes) {
    return (condition.values as Array<string>).includes(type || "");
  }

  return condition === type;
}

type ListOptions = {
  query: Query<AuditLog>;
  groupBy?: Record<string, boolean> | undefined;
  skip?: number;
  limit?: number;
};

// Every list the table read, by its query as sent.
let listQueries: Array<JSONObject> = [];
let groupedReads: number = 0;

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "es",
    fallbackLng: "en",
    resources: {
      es: { translation: SPANISH },
      en: { translation: readDashboardLocale("en") },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

beforeEach(() => {
  PermissionGate.clearPermissionPropsCache();
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();
  listQueries = [];
  groupedReads = 0;

  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));

  const project: Project = new Project();
  project._id = PROJECT_ID;
  project.enableAuditLogs = true;

  jest.spyOn(ModelAPI, "getItem").mockResolvedValue(project as never);
  jest.spyOn(ModelAPI, "getList").mockImplementation((async (options: {
    skip?: number;
    limit?: number;
  }): Promise<ListResult<BaseModel>> => {
    return {
      data: [],
      count: 0,
      skip: options.skip || 0,
      limit: options.limit || 10,
    } as ListResult<BaseModel>;
  }) as never);
  jest.spyOn(ModelAPI, "count").mockResolvedValue(0 as never);

  // The audit log API, answering as the server does.
  jest.spyOn(AnalyticsModelAPI, "getList").mockImplementation((async (
    options: ListOptions,
  ): Promise<ListResult<AuditLog>> => {
    if (options.groupBy?.["resourceType"]) {
      groupedReads++;

      const types: Array<string> = Array.from(
        new Set(
          ENTRIES.map((item: AuditLog): string => {
            return item.resourceType!;
          }),
        ),
      ).sort();

      return {
        data: types.map((type: string): AuditLog => {
          const row: AuditLog = new AuditLog();
          row.resourceType = type;
          return row;
        }),
        count: types.length,
        skip: 0,
        limit: options.limit || 10,
      } as ListResult<AuditLog>;
    }

    listQueries.push({ ...(options.query as JSONObject) });

    // AuditLogService's own rewrite: a type is read by both of its names.
    const query: Record<string, unknown> = withAuditLogResourceTypeSpellings(
      options.query,
    ) as Record<string, unknown>;

    const data: Array<AuditLog> = ENTRIES.filter((item: AuditLog): boolean => {
      return meets(query["resourceType"], item.resourceType);
    });

    return {
      data,
      count: data.length,
      skip: options.skip || 0,
      limit: options.limit || 10,
    } as ListResult<AuditLog>;
  }) as never);

  jest.spyOn(API, "fetch").mockResolvedValue({
    isSuccess: (): boolean => {
      return true;
    },
    data: { status: "valid", licenseValid: true },
  } as never);
  jest.spyOn(API, "get").mockResolvedValue({ data: {} } as never);
  jest.spyOn(API, "post").mockResolvedValue({ data: {} } as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function settle(): Promise<void> {
  for (let i: number = 0; i < 20; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

// The project's audit log, opened from a link that has already picked filters.
async function renderFiltered(filter: JSONObject): Promise<void> {
  const params: Record<string, string> = TableFilterUrlState.getLinkQueryParams(
    TABLE_ID,
    { filter },
  );
  const search: string = Object.keys(params)
    .map((name: string): string => {
      return `${name}=${params[name]}`;
    })
    .join("&");

  window.history.replaceState(
    null,
    "",
    `/dashboard/${PROJECT_ID}/settings/audit-logs?${search}`,
  );

  await act(async () => {
    render(
      <MemoryRouter>
        <AuditLogsTable
          title="Audit Logs"
          description="Every change made to the resources in this project, and every time its members sign in or out."
        />
      </MemoryRouter>,
    );
  });
  await settle();
}

// The chip over the list that starts with a filter's name.
function chipOf(field: string): string {
  const chip: HTMLElement | undefined = Array.from(
    document.querySelectorAll<HTMLElement>(".rounded-full"),
  ).find((element: HTMLElement): boolean => {
    return (element.textContent || "").startsWith(`${field} `);
  });

  if (!chip) {
    throw new Error(`No chip for ${field}`);
  }

  return chip.textContent || "";
}

async function openFilters(): Promise<void> {
  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: spanish("Edit Filters") }),
    );
  });
  await settle();
}

// The Resource Type filter's menu input, in the open Filter dialog.
function resourceTypeInput(): {
  row: HTMLElement;
  input: HTMLInputElement;
} {
  const label: HTMLElement = screen.getByText(spanish("Resource Type"), {
    selector: "label",
  });
  const row: HTMLElement = label.parentElement!.parentElement as HTMLElement;
  const input: HTMLInputElement | null = row.querySelector<HTMLInputElement>(
    "input[role='combobox']",
  );

  if (!input) {
    throw new Error("The Resource Type filter has no menu");
  }

  return { row, input };
}

// What the menu offers, for what is typed into its search (nothing: all of it).
async function menuOptionsFor(typed: string): Promise<Array<string>> {
  const { input } = resourceTypeInput();

  await act(async () => {
    fireEvent.change(input, { target: { value: typed } });
  });
  await act(async () => {
    fireEvent.keyDown(input, { key: "ArrowDown", code: "ArrowDown" });
  });
  await settle();

  const menu: HTMLElement | null =
    document.querySelector<HTMLElement>(".ou-select__menu");

  if (!menu) {
    return [];
  }

  return within(menu)
    .queryAllByTestId("dropdown-option-label")
    .map((option: HTMLElement): string => {
      return option.textContent || "";
    });
}

async function closeMenu(): Promise<void> {
  const { input } = resourceTypeInput();

  await act(async () => {
    fireEvent.keyDown(input, { key: "Escape", code: "Escape" });
  });
  await settle();
}

// The rows' names the list shows.
function rowNames(): Array<string> {
  return ENTRIES.map((item: AuditLog): string => {
    return item.resourceName!;
  }).filter((name: string): boolean => {
    return screen.queryAllByText(name).length > 0;
  });
}

describe("the words the cases below lean on", () => {
  test("Spanish has words of its own for the filter and the types", () => {
    expect(spanish("Resource Type")).toBe("Tipo de recurso");
    expect(spanish("On-Call Schedule")).toBe("Programación de guardia");
    expect(spanish("Escalation Rule User")).toBe(
      "Usuario de la regla de escalado",
    );
    expect(spanish("Ingestion Key")).toBe("Clave de ingesta");
  });
});

describe("the project's audit log, filtered to the On-Call Schedule", () => {
  test("REGRESSION: its chip, its menu and its rows read Programación de guardia, and it lists the schedule's entries stored either way", async () => {
    await renderFiltered({ resourceType: "On-Call Policy Schedule" });

    // Asked for as stored; the server reads both names.
    expect(listQueries[0]).toEqual({
      projectId: new ObjectID(PROJECT_ID),
      resourceType: "On-Call Policy Schedule",
    });
    expect(await screen.findByText("Night rota")).toBeInTheDocument();
    expect(rowNames()).toEqual(SCHEDULE_ROTAS);

    // Each row reads the type as the filter offers it.
    const table: HTMLElement = document.querySelector("table") as HTMLElement;

    expect(table).not.toBeNull();
    expect(within(table).getAllByText("Programación de guardia").length).toBe(
      3,
    );
    expect(screen.queryByText("On-Call Policy Schedule")).toBeNull();
    expect(screen.queryByText("On-Call Schedule")).toBeNull();

    // The chip: "Tipo de recurso es Programación de guardia".
    expect(chipOf(spanish("Resource Type"))).toBe(
      "Tipo de recurso es Programación de guardia",
    );
    expect(groupedReads).toBeGreaterThan(0);

    await openFilters();

    const { row } = resourceTypeInput();

    expect(
      within(row)
        .queryAllByTestId("dropdown-value-label")
        .map((value: HTMLElement): string => {
          return value.textContent || "";
        }),
    ).toEqual(["Programación de guardia"]);
  });

  test("the menu offers each stored type once, in Spanish, as Spanish orders them", async () => {
    await renderFiltered({ action: "Update" });
    await openFilters();

    const options: Array<string> = await menuOptionsFor("");

    expect(options).toEqual(
      [
        "Clave de ingesta",
        "Monitor",
        "Programación de guardia",
        "Usuario de la regla de escalado",
      ].sort((first: string, second: string): number => {
        return first.localeCompare(second, "es");
      }),
    );
    // Never the stored name nobody sees any more.
    expect(options).not.toContain("On-Call Policy Schedule");
    expect(options).not.toContain("User's On-Call Duty Escalation Rule");
  });
});

describe("searching the Resource Type menu", () => {
  test.each([
    ["the Spanish name", "guardia"],
    ["the name in English", "On-Call Schedule"],
    ["the name it had before", "On-Call Policy Schedule"],
  ])("by %s finds the schedule", async (_how: string, typed: string) => {
    await renderFiltered({ action: "Update" });
    await openFilters();

    expect(await menuOptionsFor(typed)).toContain("Programación de guardia");

    await closeMenu();
  });

  test("REGRESSION: picking the schedule by its shown name lists its entries, stored under either name", async () => {
    await renderFiltered({ action: "Update" });
    await openFilters();

    expect(await menuOptionsFor("guardia")).toEqual([
      "Programación de guardia",
    ]);

    const { input } = resourceTypeInput();

    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    });
    await settle();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: spanish("Apply Filters") }),
      );
    });
    await settle();

    expect(listQueries[listQueries.length - 1]).toEqual({
      projectId: new ObjectID(PROJECT_ID),
      action: "Update",
      resourceType: "On-Call Policy Schedule",
    });
    expect(await screen.findByText("Night rota")).toBeInTheDocument();
    expect(rowNames()).toEqual(SCHEDULE_ROTAS);
    expect(chipOf(spanish("Resource Type"))).toBe(
      "Tipo de recurso es Programación de guardia",
    );
  });

  test("Escalation Rule User is found by its Spanish name, and asks for the name it is stored under", async () => {
    await renderFiltered({ action: "Update" });
    await openFilters();

    expect(await menuOptionsFor("regla de escalado")).toEqual([
      "Usuario de la regla de escalado",
    ]);

    const { input } = resourceTypeInput();

    await act(async () => {
      fireEvent.keyDown(input, { key: "Enter", code: "Enter" });
    });
    await settle();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: spanish("Apply Filters") }),
      );
    });
    await settle();

    expect(listQueries[listQueries.length - 1]?.["resourceType"]).toBe(
      "User's On-Call Duty Escalation Rule",
    );
    expect(await screen.findByText("Ada Lovelace")).toBeInTheDocument();
    expect(rowNames()).toEqual(["Ada Lovelace"]);
  });
});
