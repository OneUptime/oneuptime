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
import { act, cleanup, render } from "@testing-library/react";
import i18next from "i18next";
import * as React from "react";
import { initReactI18next } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "Common/Tests/MockType";
import {
  dashboardTranslator,
  readDashboardLocale,
} from "Common/Tests/Helpers/DashboardLocales";

/*
 * ---------------------------------------------------------------------------
 * The audit log's Resource Type filter finds a renamed record by the name
 * the product shows (#7580).
 * ---------------------------------------------------------------------------
 *
 * A renamed model keeps its old singular name for the API and the audit
 * log: every entry about an On-Call Schedule is stored as "On-Call Policy
 * Schedule". The filter was free text on that stored value, so a person
 * who typed "On-Call Schedule" - what the Resource column says - found
 * nothing, and "Escalation Rule User" matched no "User's On-Call Duty
 * Escalation Rule".
 *
 * The filter now offers the types the table's entries are about, read from
 * the audit log when it opens, each by the name the rows show it by, in the
 * reader's language, and asks for the entries as they are stored. The
 * server reads a type by both of its names (AuditLogService, pinned in
 * Common's AuditLogServiceResourceTypes.test.ts).
 *
 * AnalyticsModelTable is mocked to capture its props, as in
 * AuditLogActionInReadersLanguage.test.tsx; the Resource cell is drawn
 * from the captured column. AuditLogResourceTypeFilterInSpanish.test.tsx
 * opens the real table's menu and chip.
 */

const mockLicenseFetch: MockFunction = getJestMockFunction();

jest.mock("Common/UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      fetch: (...args: Array<unknown>): unknown => {
        return mockLicenseFetch(...args);
      },
      getFriendlyMessage: (): string => {
        return "";
      },
    },
  };
});

type CapturedFilter = {
  title: string;
  type: string;
  field?: Record<string, boolean>;
  filterEntityType?: unknown;
  filterDropdownField?: { label: string; value: string };
  filterDropdownOptions?: Array<DropdownOption>;
  fetchFilterDropdownOptions?: () => Promise<Array<DropdownOption>>;
};

type CapturedColumn = {
  title: string;
  getElement?: ((item: AuditLog) => React.ReactElement) | undefined;
};

type CapturedTableProps = {
  filters?: Array<CapturedFilter>;
  columns?: Array<CapturedColumn>;
};

let capturedTableProps: CapturedTableProps | null = null;
const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();

jest.mock("Common/UI/Components/ModelTable/AnalyticsModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTableProps): React.ReactElement => {
      capturedTableProps = props;
      const react: typeof React = jest.requireActual("react") as typeof React;

      return react.createElement("div", {
        "data-testid": "audit-logs-analytics-table",
      });
    },
  };
});

jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
    },
  };
});

jest.mock("Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
    },
  };
});

import AuditLogsTable, {
  ComponentProps,
  fetchResourceTypeFilterOptions,
} from "../../../Dashboard/AuditLogs/AuditLogsTable";
import AuditLog from "Common/Models/AnalyticsModels/AuditLog";
import DatabaseModels from "Common/Models/DatabaseModels/Index";
import DatabaseBaseModel, {
  DatabaseBaseModelType,
} from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Project from "Common/Models/DatabaseModels/Project";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { Translator } from "Common/Types/Translator";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import FieldType from "Common/UI/Components/Types/FieldType";
import ProjectUtil from "Common/UI/Utils/Project";
import { getResourceMeta } from "@oneuptime/dashboard/Components/AuditLogs/AuditLogsTableUtils";

const SPANISH: Record<string, string> = readDashboardLocale("es");

const PROJECT_ID: ObjectID = new ObjectID(
  "75800000-0000-4000-8000-000000000101",
);
const SCHEDULE_ID: ObjectID = new ObjectID(
  "75800000-0000-4000-8000-000000000102",
);

interface RenamedType {
  kept: string;
  screen: string;
}

// Every renamed model, read from the models.
const RENAMED: Array<RenamedType> = DatabaseModels.map(
  (modelType: DatabaseBaseModelType): DatabaseBaseModel => {
    return new modelType();
  },
)
  .filter((model: DatabaseBaseModel): boolean => {
    return Boolean(model.apiSingularName);
  })
  .map((model: DatabaseBaseModel): RenamedType => {
    return { kept: model.apiSingularName!, screen: model.singularName! };
  });

// A Spanish word of the Dashboard's.
function spanish(english: string): string {
  const word: string | undefined = SPANISH[english];

  if (!word) {
    throw new Error(`Spanish has no word for "${english}"`);
  }

  return word;
}

// The rows the audit log answers a grouped read with: one per stored type.
function storedTypes(types: Array<string>): {
  data: Array<AuditLog>;
  count: number;
} {
  return {
    data: types.map((type: string): AuditLog => {
      const row: AuditLog = new AuditLog();
      row.resourceType = type;
      return row;
    }),
    count: types.length,
  };
}

async function renderTable(props?: Partial<ComponentProps>): Promise<void> {
  render(
    <MemoryRouter>
      <AuditLogsTable
        title="Audit Logs"
        description="Every change made to the resources in this project, and every time its members sign in or out."
        {...(props || {})}
      />
    </MemoryRouter>,
  );
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  });
}

function resourceTypeFilter(): CapturedFilter {
  const filter: CapturedFilter | undefined = capturedTableProps?.filters?.find(
    (candidate: CapturedFilter): boolean => {
      return candidate.title === "Resource Type";
    },
  );

  expect(filter).toBeDefined();

  return filter!;
}

// The Resource column's cell for an entry, as the table drew its column.
function resourceCellOf(type: string): HTMLElement {
  const column: CapturedColumn | undefined = capturedTableProps?.columns?.find(
    (candidate: CapturedColumn): boolean => {
      return candidate.title === "Resource";
    },
  );

  expect(column?.getElement).toBeDefined();

  const entry: AuditLog = new AuditLog();
  entry.projectId = PROJECT_ID;
  entry.action = "Update";
  entry.resourceType = type;
  entry.resourceName = "Primary rota";
  entry.resourceId = SCHEDULE_ID;

  const { container } = render(
    <MemoryRouter>{column!.getElement!(entry)}</MemoryRouter>,
  );

  return container;
}

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

beforeEach(async () => {
  await i18next.changeLanguage("es");
  capturedTableProps = null;
  getItemMock.mockReset();
  getListMock.mockReset();

  const project: Project = new Project();
  project._id = PROJECT_ID.toString();
  project.enableAuditLogs = true;
  getItemMock.mockResolvedValue(project);
  getListMock.mockResolvedValue(
    storedTypes(
      RENAMED.map((renamed: RenamedType): string => {
        return renamed.kept;
      }),
    ),
  );
  mockLicenseFetch.mockReset();
  mockLicenseFetch.mockResolvedValue({
    isSuccess: (): boolean => {
      return true;
    },
    data: { status: "valid", licenseValid: true } as JSONObject,
  });
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the Resource Type filter", () => {
  test("REGRESSION: is a choice of the types the entries are about, no longer free text on the stored name", async () => {
    await renderTable();

    const filter: CapturedFilter = resourceTypeFilter();

    expect(filter.type).toBe(FieldType.Dropdown);
    expect(filter.field).toEqual({ resourceType: true });
    // Read from the audit log itself, as BaseModelTable reads a filter's records.
    expect(filter.filterEntityType).toBe(AuditLog);
    expect(filter.filterDropdownField).toEqual({
      label: "resourceType",
      value: "resourceType",
    });
    expect(typeof filter.fetchFilterDropdownOptions).toBe("function");
    expect(filter.filterDropdownOptions).toBeUndefined();
  });

  test("reads the project's stored types, one row each, when it opens", async () => {
    await renderTable();

    expect(getListMock).not.toHaveBeenCalled();

    await resourceTypeFilter().fetchFilterDropdownOptions!();

    expect(getListMock).toHaveBeenCalledTimes(1);
    expect(getListMock.mock.calls[0]![0]).toEqual({
      modelType: AuditLog,
      query: { projectId: PROJECT_ID },
      groupBy: { resourceType: true },
      select: { resourceType: true },
      sort: { resourceType: SortOrder.Ascending },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
    });
  });

  test("on a resource's own page, offers the types of its entries and of what belongs to it", async () => {
    await renderTable({ rootResourceId: SCHEDULE_ID });

    await resourceTypeFilter().fetchFilterDropdownOptions!();

    expect(
      (getListMock.mock.calls[0]![0] as { query: JSONObject }).query,
    ).toEqual({ projectId: PROJECT_ID, rootResourceId: SCHEDULE_ID });
  });

  test("REGRESSION: offers On-Call Schedule and Escalation Rule User, which find the entries stored under their kept names", async () => {
    getListMock.mockResolvedValue(
      storedTypes([
        "Monitor",
        "On-Call Policy Schedule",
        "User's On-Call Duty Escalation Rule",
      ]),
    );
    await renderTable();

    const options: Array<DropdownOption> =
      await resourceTypeFilter().fetchFilterDropdownOptions!();

    const schedule: DropdownOption | undefined = options.find(
      (option: DropdownOption): boolean => {
        return option.label === "On-Call Schedule";
      },
    );
    const escalationRuleUser: DropdownOption | undefined = options.find(
      (option: DropdownOption): boolean => {
        return option.label === "Escalation Rule User";
      },
    );

    expect(schedule?.value).toBe("On-Call Policy Schedule");
    expect(escalationRuleUser?.value).toBe(
      "User's On-Call Duty Escalation Rule",
    );
    // Never offered by the name nobody sees any more.
    expect(
      options.map((option: DropdownOption): string => {
        return option.label;
      }),
    ).not.toContain("On-Call Policy Schedule");
  });

  test("offers every renamed type once, by today's name, whichever name its entries are stored under", async () => {
    // Every kept name, and every name on screen too, as if both were stored.
    getListMock.mockResolvedValue(
      storedTypes(
        RENAMED.flatMap((renamed: RenamedType): Array<string> => {
          return [renamed.kept, renamed.screen];
        }),
      ),
    );
    await renderTable();

    const options: Array<DropdownOption> =
      await resourceTypeFilter().fetchFilterDropdownOptions!();

    expect(options).toHaveLength(RENAMED.length);

    for (const renamed of RENAMED) {
      expect(options).toContainEqual({
        label: renamed.screen,
        value: renamed.kept,
        aliases: [renamed.screen],
        isUserContent: false,
      });
    }
  });

  test("lists the types in the order a Spanish reader reads their names", async () => {
    await renderTable();

    const options: Array<DropdownOption> =
      await resourceTypeFilter().fetchFilterDropdownOptions!();

    const shown: Array<string> = options.map(
      (option: DropdownOption): string => {
        return spanish(option.label);
      },
    );

    expect(shown).toEqual(
      [...shown].sort((first: string, second: string): number => {
        return first.localeCompare(second, "es");
      }),
    );
  });

  test("a type with no entries is not offered, and an empty read offers nothing", async () => {
    getListMock.mockResolvedValue(storedTypes([]));
    await renderTable();

    expect(await resourceTypeFilter().fetchFilterDropdownOptions!()).toEqual(
      [],
    );
  });

  test("a failed read fails the filter's choices, for the table to say so", async () => {
    getListMock.mockRejectedValue(new Error("ClickHouse is down"));

    await expect(
      fetchResourceTypeFilterOptions({
        query: { projectId: PROJECT_ID },
        translator: dashboardTranslator("es"),
      }),
    ).rejects.toThrow("ClickHouse is down");
  });

  test("in German, orders the types as German reads them", async () => {
    getListMock.mockResolvedValue(
      storedTypes([
        "Telemetry Ingestion Key",
        "Scheduled Maintenance Event",
        "On-Call Policy Schedule",
      ]),
    );
    const german: Translator = dashboardTranslator("de");

    const options: Array<DropdownOption> = await fetchResourceTypeFilterOptions(
      { query: { projectId: PROJECT_ID }, translator: german },
    );

    const shown: Array<string> = options.map(
      (option: DropdownOption): string => {
        return german.translateText(option.label) || option.label;
      },
    );

    expect(shown).toEqual(
      [...shown].sort((first: string, second: string): number => {
        return first.localeCompare(second, "de");
      }),
    );
    expect(new Set(shown).size).toBe(3);
  });
});

describe("the Resource column, read in Spanish", () => {
  test.each(RENAMED)(
    "$screen reads in the words the filter offers it in, stored either way",
    async (renamed: RenamedType) => {
      await renderTable();

      const words: string = spanish(renamed.screen);

      for (const stored of [renamed.kept, renamed.screen]) {
        const cell: HTMLElement = resourceCellOf(stored);

        expect(cell).toHaveTextContent(words);
        // Never the name it is stored under.
        if (words !== renamed.kept) {
          expect(cell).not.toHaveTextContent(renamed.kept);
        }

        cleanup();
        await renderTable();
      }
    },
  );

  test("an On-Call Schedule's entry opens the schedule, stored under either name", async () => {
    await renderTable();

    const kept: HTMLElement = resourceCellOf("On-Call Policy Schedule");
    const keptHref: string | null =
      kept.querySelector("a")?.getAttribute("href") || null;

    expect(keptHref).toContain(SCHEDULE_ID.toString());
    cleanup();
    await renderTable();

    const screen: HTMLElement = resourceCellOf("On-Call Schedule");

    expect(screen.querySelector("a")?.getAttribute("href")).toBe(keptHref);
    expect(getResourceMeta("On-Call Schedule")).toBe(
      getResourceMeta("On-Call Policy Schedule"),
    );
  });

  test("a type never renamed reads as the filter offers it too", async () => {
    await renderTable();

    expect(resourceCellOf("Monitor")).toHaveTextContent(spanish("Monitor"));
  });
});
