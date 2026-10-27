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
} from "@testing-library/react";
import * as React from "react";
import { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { PROJECT_ID, goTo, routeFor } from "./SideMenuHarness";

/*
 * The case queue's pages: Open Cases, Assigned to Me, Unassigned, Closed
 * Cases and All Cases, each a page of its own under Security Cases in the
 * side menu. They were views switched by buttons along the top of one
 * list; the maintainer asked for "different pages for these things".
 *
 * Each real page is rendered with its ModelTable captured, so what the page
 * asks the server for and how it draws its list are pinned: the query, the
 * sort, the columns and filters fitted to its question, whether it offers
 * Open Security Case, its bulk actions and its empty state. Then the
 * production ModelTable is drawn with those props, to see the list a person
 * sees: no view buttons, the empty state each page says, and Assigned to
 * Me's way forward to Unassigned.
 */

configure({ asyncUtilTimeout: 15000 });

jest.setTimeout(120000);

// The person signed in, whose cases Assigned to Me lists.
const ME: string = "80000000-0000-4000-8000-000000000001";

interface CapturedColumn {
  title: string;
  field: Record<string, unknown>;
  isHiddenByDefault?: boolean | undefined;
}

interface CapturedFilter {
  title: string;
  field: Record<string, unknown>;
  filterDropdownOptions?: Array<{ label: string; value: unknown }> | undefined;
}

interface CapturedEmptyStateAction {
  title: string;
  onClick: () => void;
  dataTestId?: string | undefined;
}

interface CapturedTable {
  id?: string | undefined;
  query: Record<string, unknown>;
  sortBy?: string | undefined;
  sortOrder?: string | undefined;
  columns: Array<CapturedColumn>;
  filters: Array<CapturedFilter>;
  isCreateable?: boolean | undefined;
  createVerb?: string | undefined;
  userPreferencesKey?: string | undefined;
  viewPageRoute?: { toString: () => string } | undefined;
  noItemsMessage?: unknown;
  topContent?: unknown;
  emptyState?:
    | {
        isAllClear?: boolean | undefined;
        actions?: Array<CapturedEmptyStateAction> | undefined;
      }
    | undefined;
  cardProps?:
    | { title?: unknown; description?: unknown; headerLayout?: unknown }
    | undefined;
  bulkActions?: { buttons: Array<unknown> } | undefined;
  [key: string]: unknown;
}

let capturedTables: Array<CapturedTable> = [];
// How often the page's table was mounted and taken down: a new page, a new table.
let tableMounts: number = 0;
let tableUnmounts: number = 0;

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      // A project owner: may open, change and delete cases.
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

jest.mock("../../../UI/Utils/User", () => {
  const ObjectIDType: typeof import("../../../Types/ObjectID").default = (
    jest.requireActual("../../../Types/ObjectID") as {
      default: typeof import("../../../Types/ObjectID").default;
    }
  ).default;

  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): unknown => {
        return new ObjectIDType("80000000-0000-4000-8000-000000000001");
      },
      getName: (): string => {
        return "Maya Chen";
      },
      getEmail: (): string => {
        return "maya@acme-commerce.example";
      },
    },
  };
});

// Captured, not drawn: each test draws the production table itself.
jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTable) => {
      capturedTables.push(props);
      React.useEffect(() => {
        tableMounts++;

        return () => {
          tableUnmounts++;
        };
      }, []);
      return <div data-testid="captured-model-table" />;
    },
  };
});

import SecurityCasesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/Cases";
import {
  SECURITY_CASE_QUEUE_VIEWS,
  SecurityCaseQueueView,
  SecurityCaseQueueViewKey,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseQueueViews";
import {
  OPEN_NEW_SECURITY_CASE,
  OPEN_SECURITY_CASE,
  SECURITY_CASE_ROW_DETECTIONS_TEST_ID,
  SECURITY_CASE_ROW_NUMBER_TEST_ID,
  SECURITY_CASE_ROW_SOURCE_LINE_TEST_ID,
  VIEW_UNASSIGNED_CASES,
  VIEW_UNASSIGNED_CASES_TEST_ID,
  getSecurityCasesTablePreferencesKey,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCasesTable";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import Team from "../../../Models/DatabaseModels/Team";
import Route from "../../../Types/API/Route";
import Includes from "../../../Types/BaseDatabase/Includes";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";
import SecurityCaseAiVerdict from "../../../Types/SecurityCase/SecurityCaseAiVerdict";
import SecurityCasePriority from "../../../Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "../../../Models/DatabaseModels/SecurityCaseStatus";
import SecurityCasePriorityLevel from "../../../Types/SecurityCase/SecurityCasePriorityLevel";
import SecurityCaseStage from "../../../Types/SecurityCase/SecurityCaseStage";
import {
  TEST_STATUS_IDS,
  buildDefaultTestPriorities,
  buildDefaultTestStatuses,
  buildTestStatus,
  testPriorityId,
  testStatusId,
} from "../../Helpers/SecurityCaseValues";
import { stubDashboardSecurityCaseValues } from "./SecurityCaseValuesStub";
import SecurityCaseVerdict from "../../../Types/SecurityCase/SecurityCaseVerdict";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ModelListCache from "../../../UI/Utils/ModelListCache";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";

type RealModelTableType = (props: Record<string, unknown>) => ReactElement;

const RealModelTable: RealModelTableType = (
  jest.requireActual("../../../UI/Components/ModelTable/ModelTable") as {
    default: RealModelTableType;
  }
).default;

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(`/dashboard/${PROJECT_ID}/security-events/cases`),
  currentProject: null,
  hasPaymentMethod: true,
} as unknown as PageComponentProps;

const CLOSED_CASE_ID: string = "20000000-0000-4000-8000-000000000135";

// A new project's priorities and statuses, which the lists are drawn with.
const PRIORITIES: Array<SecurityCasePriority> = buildDefaultTestPriorities();
const STATUSES: Array<SecurityCaseStatus> = buildDefaultTestStatuses();

// The project's statuses a case is open in, by id: what every open list asks for.
const OPEN_STATUS_IDS: Array<string> = [
  TEST_STATUS_IDS[SecurityCaseStage.New],
  TEST_STATUS_IDS[SecurityCaseStage.Acknowledged],
  TEST_STATUS_IDS[SecurityCaseStage.Contained],
];

function priorityOf(level: SecurityCasePriorityLevel): SecurityCasePriority {
  return PRIORITIES.find((priority: SecurityCasePriority): boolean => {
    return priority.id?.toString() === testPriorityId(level).toString();
  })!;
}

function statusOf(stage: SecurityCaseStage): SecurityCaseStatus {
  return STATUSES.find((status: SecurityCaseStatus): boolean => {
    return status.id?.toString() === testStatusId(stage).toString();
  })!;
}

// The rows the list is answered with, when a test gives it any.
let listedRows: Array<SecurityCase> = [];
let listRequests: Array<{ query: Record<string, unknown>; sort: unknown }> = [];

function viewOf(key: SecurityCaseQueueViewKey): SecurityCaseQueueView {
  const view: SecurityCaseQueueView | undefined =
    SECURITY_CASE_QUEUE_VIEWS.find(
      (candidate: SecurityCaseQueueView): boolean => {
        return candidate.key === key;
      },
    );

  if (!view) {
    throw new Error(`No case queue view ${key}.`);
  }

  return view;
}

async function capture(
  view: SecurityCaseQueueViewKey | undefined,
): Promise<CapturedTable> {
  capturedTables = [];

  await act(async () => {
    render(
      <MemoryRouter>
        <SecurityCasesPage {...PAGE_PROPS} view={view} />
      </MemoryRouter>,
    );
  });

  const table: CapturedTable | undefined =
    capturedTables[capturedTables.length - 1];

  if (!table) {
    throw new Error("The page rendered no table.");
  }

  cleanup();

  return table;
}

function titlesOf(items: Array<{ title: string }>): Array<string> {
  return items.map((item: { title: string }): string => {
    return item.title;
  });
}

function bulkTitles(table: CapturedTable): Array<string> {
  return (table.bulkActions?.buttons || [])
    .filter((button: unknown): boolean => {
      return typeof button === "object" && button !== null;
    })
    .map((button: unknown): string => {
      return (button as { title: string }).title;
    });
}

async function drawTable(table: CapturedTable): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <RealModelTable
          {...(table as unknown as Record<string, unknown>)}
          disableUrlState={true}
        />
      </MemoryRouter>,
    );
  });
}

function closedCase(): SecurityCase {
  const row: SecurityCase = new SecurityCase();
  row._id = CLOSED_CASE_ID;
  row.caseNumberWithPrefix = "CASE-135";
  row.title = "Repeated MFA push denials for a sales account";
  row.securityCasePriorityId = testPriorityId(SecurityCasePriorityLevel.Low);
  row.securityCasePriority = priorityOf(SecurityCasePriorityLevel.Low);
  row.securityCaseStatusId = testStatusId(SecurityCaseStage.Closed);
  row.securityCaseStatus = statusOf(SecurityCaseStage.Closed);
  row.verdict = SecurityCaseVerdict.BenignPositive;
  row.closedAt = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  row.lastDetectedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
  row.detectionCount = 2;
  row.entities = [];
  return row;
}

// An open case nobody has picked up, handed to a team or to nobody.
function unassignedCase(
  id: string,
  caseNumber: string,
  title: string,
  teamName: string | undefined,
): SecurityCase {
  const row: SecurityCase = new SecurityCase();
  row._id = id;
  row.caseNumberWithPrefix = caseNumber;
  row.title = title;
  row.securityCasePriorityId = testPriorityId(SecurityCasePriorityLevel.High);
  row.securityCasePriority = priorityOf(SecurityCasePriorityLevel.High);
  row.securityCaseStatusId = testStatusId(SecurityCaseStage.New);
  row.securityCaseStatus = statusOf(SecurityCaseStage.New);
  row.lastDetectedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);
  row.detectionCount = 1;
  row.entities = [];

  if (teamName) {
    const team: Team = new Team();
    team._id = "70000000-0000-4000-8000-000000000001";
    team.name = teamName;
    row.assignedToTeam = team;
  }

  return row;
}

function bodyRowTexts(): Array<string> {
  return Array.from(document.querySelectorAll("tbody tr")).map(
    (row: Element): string => {
      return row.textContent || "";
    },
  );
}

beforeEach(() => {
  capturedTables = [];
  listedRows = [];
  listRequests = [];
  goTo(`/dashboard/${PROJECT_ID}/security-events/cases`);
  window.localStorage.clear();
  // The project's priorities and statuses: a new project's.
  stubDashboardSecurityCaseValues({
    priorities: PRIORITIES,
    statuses: STATUSES,
  });

  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(
      async (options: {
        modelType: { new (): BaseModel };
        query: Record<string, unknown>;
        sort: unknown;
        skip?: number;
        limit?: number;
      }): Promise<ListResult<BaseModel>> => {
        const isCases: boolean = options.modelType === SecurityCase;

        if (isCases) {
          listRequests.push({ query: options.query, sort: options.sort });
        }

        const data: Array<BaseModel> = isCases ? listedRows : [];

        return {
          data,
          count: data.length,
          skip: options.skip || 0,
          limit: options.limit || 10,
        } as ListResult<BaseModel>;
      },
    );
  jest.spyOn(ModelAPI, "getItem").mockResolvedValue(null as never);
  jest.spyOn(ModelAPI, "count").mockResolvedValue(0 as never);
  jest.spyOn(API, "get").mockResolvedValue({ data: {} } as never);
  jest.spyOn(API, "post").mockResolvedValue({ data: {} } as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("each case page asks for its own cases", () => {
  test("Open Cases: every status of the project's that counts as open, by id", async () => {
    const table: CapturedTable = await capture("open");
    const status: Includes = table.query["securityCaseStatusId"] as Includes;

    expect(table.query["projectId"]).toEqual(new ObjectID(PROJECT_ID));
    expect(status).toBeInstanceOf(Includes);
    expect(status.values).toEqual(OPEN_STATUS_IDS);
    expect(table.query["assignedToUserId"]).toBeUndefined();
  });

  test("Open Cases: a status of the project's own before Closed is open; one after it is not", async () => {
    const statuses: Array<SecurityCaseStatus> = buildDefaultTestStatuses();
    statuses[3]!.order = 5; // Closed
    statuses.push(
      buildTestStatus({
        id: "c2000000-0000-4000-8000-0000000000a2",
        name: "Eradicating",
        order: 4,
      }),
      buildTestStatus({
        id: "c2000000-0000-4000-8000-0000000000a3",
        name: "Closed - Duplicate",
        order: 6,
      }),
    );
    stubDashboardSecurityCaseValues({ priorities: PRIORITIES, statuses });

    const open: CapturedTable = await capture("open");
    const closed: CapturedTable = await capture("closed");

    expect((open.query["securityCaseStatusId"] as Includes).values).toEqual([
      ...OPEN_STATUS_IDS,
      "c2000000-0000-4000-8000-0000000000a2",
    ]);
    expect((closed.query["securityCaseStatusId"] as Includes).values).toEqual([
      TEST_STATUS_IDS[SecurityCaseStage.Closed],
      "c2000000-0000-4000-8000-0000000000a3",
    ]);
  });

  test("Assigned to Me: the open cases of the person signed in", async () => {
    const table: CapturedTable = await capture("mine");

    expect(table.query["assignedToUserId"]).toEqual(new ObjectID(ME));
    expect((table.query["securityCaseStatusId"] as Includes).values).toEqual(
      OPEN_STATUS_IDS,
    );
  });

  test("Unassigned: the open cases with no person on them", async () => {
    const table: CapturedTable = await capture("unassigned");

    expect(table.query["assignedToUserId"]).toBeInstanceOf(IsNull);
    expect((table.query["securityCaseStatusId"] as Includes).values).toEqual(
      OPEN_STATUS_IDS,
    );
  });

  test("Closed Cases: the closed ones; All Cases: every case", async () => {
    const closed: CapturedTable = await capture("closed");
    const all: CapturedTable = await capture("all");

    expect(closed.query).toEqual({
      projectId: new ObjectID(PROJECT_ID),
      securityCaseStatusId: new Includes([
        TEST_STATUS_IDS[SecurityCaseStage.Closed],
      ]),
    });
    expect(all.query).toEqual({ projectId: new ObjectID(PROJECT_ID) });
  });

  test("a page without a view is Open Cases, the queue's old address", async () => {
    const table: CapturedTable = await capture(undefined);

    expect(table.cardProps?.title).toBe("Open Cases");
    expect((table.query["securityCaseStatusId"] as Includes).values).toEqual(
      OPEN_STATUS_IDS,
    );
  });
});

describe("each case page draws the list its question needs", () => {
  test.each(
    SECURITY_CASE_QUEUE_VIEWS.map(
      (view: SecurityCaseQueueView): [string, SecurityCaseQueueView] => {
        return [view.key, view];
      },
    ),
  )(
    "%s: its name and what it holds head the card",
    async (_key: string, queueView: SecurityCaseQueueView) => {
      const table: CapturedTable = await capture(queueView.key);

      expect(table.cardProps?.title).toBe(queueView.title);
      expect(table.cardProps?.description).toBe(queueView.description);
      expect(table.noItemsMessage).toBe(queueView.emptyMessage);
      // The views along the top of the list are gone: each is a page.
      expect(table.topContent).toBeUndefined();
      expect(table.id).toBe("security-cases-table");
      expect(table.userPreferencesKey).toBe(
        getSecurityCasesTablePreferencesKey(queueView.key),
      );
      // A row opens the case's own page, from every one of them.
      expect(table.viewPageRoute?.toString()).toBe(
        routeFor(PageMap.SECURITY_CASES),
      );
    },
  );

  test("the open lists sort by the latest detection; the closed one by when each closed", async () => {
    const sorts: Array<[string, unknown, unknown]> = [];

    for (const view of SECURITY_CASE_QUEUE_VIEWS) {
      const table: CapturedTable = await capture(view.key);
      sorts.push([view.key, table.sortBy, table.sortOrder]);
    }

    expect(sorts).toEqual([
      ["open", "lastDetectedAt", SortOrder.Descending],
      ["mine", "lastDetectedAt", SortOrder.Descending],
      ["unassigned", "lastDetectedAt", SortOrder.Descending],
      ["closed", "closedAt", SortOrder.Descending],
      ["all", "lastDetectedAt", SortOrder.Descending],
    ]);
  });

  test("columns: no Assignee on Assigned to Me or Unassigned, the verdict and when it closed on Closed Cases", async () => {
    const columns: Record<string, Array<string>> = {};
    const hidden: Record<string, Array<string>> = {};

    for (const view of SECURITY_CASE_QUEUE_VIEWS) {
      const table: CapturedTable = await capture(view.key);
      columns[view.key] = titlesOf(table.columns);
      hidden[view.key] = titlesOf(
        table.columns.filter((column: CapturedColumn): boolean => {
          return Boolean(column.isHiddenByDefault);
        }),
      );
    }

    expect(columns).toEqual({
      open: [
        "Case",
        "Priority",
        "Status",
        "Assignee",
        "Labels",
        "Last Detection",
      ],
      mine: ["Case", "Priority", "Status", "Labels", "Last Detection"],
      // Nobody is on these cases: the team one was handed to, if any.
      unassigned: [
        "Case",
        "Priority",
        "Status",
        "Team",
        "Labels",
        "Last Detection",
      ],
      closed: ["Case", "Priority", "Verdict", "Assignee", "Labels", "Closed"],
      all: [
        "Case",
        "Priority",
        "Status",
        "Verdict",
        "Assignee",
        "Labels",
        "Last Detection",
      ],
    });
    /*
     * The time each list is sorted by waits in Customize Columns: each
     * case's line under its title says it already.
     */
    expect(hidden).toEqual({
      open: ["Labels", "Last Detection"],
      mine: ["Labels", "Last Detection"],
      unassigned: ["Labels", "Last Detection"],
      closed: ["Labels", "Closed"],
      all: ["Verdict", "Labels", "Last Detection"],
    });
  });

  test("filters: an open list by where its cases stand and what OneUptime AI read it as, the closed one by verdict and when it closed", async () => {
    const filters: Record<string, Array<string>> = {};

    for (const view of SECURITY_CASE_QUEUE_VIEWS) {
      const table: CapturedTable = await capture(view.key);
      filters[view.key] = titlesOf(table.filters);
    }

    expect(filters).toEqual({
      open: ["Title", "Priority", "Status", "AI Verdict", "Labels", "Opened"],
      mine: ["Title", "Priority", "Status", "AI Verdict", "Labels", "Opened"],
      unassigned: [
        "Title",
        "Priority",
        "Status",
        "AI Verdict",
        "Labels",
        "Opened",
      ],
      closed: [
        "Title",
        "Priority",
        "Verdict",
        "AI Verdict",
        "Labels",
        "Opened",
        "Closed",
      ],
      all: [
        "Title",
        "Priority",
        "Status",
        "Verdict",
        "AI Verdict",
        "Labels",
        "Opened",
      ],
    });
  });

  test("with the project's AI off, no list offers the AI Verdict filter", async () => {
    jest
      .spyOn(ProjectUtil, "getCurrentProject")
      .mockReturnValue({ enableAi: false } as never);

    for (const view of SECURITY_CASE_QUEUE_VIEWS) {
      const table: CapturedTable = await capture(view.key);

      expect(titlesOf(table.filters)).not.toContain("AI Verdict");
    }
  });

  test("the AI Verdict filter offers the four reads, the worst first", async () => {
    const table: CapturedTable = await capture("open");
    const filter: CapturedFilter | undefined = table.filters.find(
      (candidate: CapturedFilter): boolean => {
        return candidate.title === "AI Verdict";
      },
    );

    expect(
      (filter?.filterDropdownOptions || []).map(
        (option: { value: unknown }): unknown => {
          return option.value;
        },
      ),
    ).toEqual([
      "Likely Malicious",
      "Likely Benign",
      "Likely False Positive",
      "Inconclusive",
    ]);
  });

  test("an open list's Status filter offers only the open statuses; All Cases offers Closed too", async () => {
    const statusOptions: (table: CapturedTable) => Array<unknown> = (
      table: CapturedTable,
    ): Array<unknown> => {
      const filter: CapturedFilter | undefined = table.filters.find(
        (candidate: CapturedFilter): boolean => {
          return candidate.title === "Status";
        },
      );

      return (filter?.filterDropdownOptions || []).map(
        (option: { value: unknown }): unknown => {
          return option.value;
        },
      );
    };

    expect(statusOptions(await capture("open"))).toEqual(OPEN_STATUS_IDS);
    expect(statusOptions(await capture("unassigned"))).toEqual(OPEN_STATUS_IDS);
    expect(statusOptions(await capture("all"))).toEqual([
      ...OPEN_STATUS_IDS,
      TEST_STATUS_IDS[SecurityCaseStage.Closed],
    ]);
  });

  test("the Priority and Status filters name the project's own, most urgent first", async () => {
    const priorities: Array<SecurityCasePriority> =
      buildDefaultTestPriorities();
    priorities[0]!.name = "Sev 1";
    stubDashboardSecurityCaseValues({ priorities, statuses: STATUSES });

    const table: CapturedTable = await capture("all");
    const labels: (title: string) => Array<string> = (
      title: string,
    ): Array<string> => {
      return (
        table.filters.find((candidate: CapturedFilter): boolean => {
          return candidate.title === title;
        })?.filterDropdownOptions || []
      ).map((option: { label: string }): string => {
        return option.label;
      });
    };

    expect(labels("Priority")).toEqual([
      "Sev 1",
      "High",
      "Medium",
      "Low",
      "Informational",
    ]);
    expect(labels("Status")).toEqual([
      "New",
      "Investigating",
      "Contained",
      "Closed",
    ]);
  });

  test("a list whose priorities and statuses cannot be read says why, and tries again", async () => {
    jest
      .spyOn(ModelListCache, "getList")
      .mockRejectedValue(new Error("The server is down.") as never);
    capturedTables = [];

    await act(async () => {
      render(
        <MemoryRouter>
          <SecurityCasesPage {...PAGE_PROPS} view="open" />
        </MemoryRouter>,
      );
    });

    // No list of every case in their place: no table at all.
    expect(capturedTables).toEqual([]);
    expect(await screen.findByText("The server is down.")).toBeVisible();

    // Back up: Refresh reads them again, and the list is drawn.
    stubDashboardSecurityCaseValues({
      priorities: PRIORITIES,
      statuses: STATUSES,
    });

    await act(async () => {
      fireEvent.click(screen.getByTestId("refresh-button"));
    });

    await waitFor(() => {
      expect(capturedTables.length).toBeGreaterThan(0);
    });
    expect(
      (
        capturedTables[capturedTables.length - 1]!.query[
          "securityCaseStatusId"
        ] as Includes
      ).values,
    ).toEqual(OPEN_STATUS_IDS);
  });

  test("Open Security Case on the lists a new case lands in: Open Cases and All Cases", async () => {
    const creatable: Record<string, boolean> = {};

    for (const view of SECURITY_CASE_QUEUE_VIEWS) {
      const table: CapturedTable = await capture(view.key);
      creatable[view.key] = Boolean(table.isCreateable);
      expect(table.createVerb).toBe("Open");
    }

    expect(creatable).toEqual({
      open: true,
      mine: false,
      unassigned: false,
      closed: false,
      all: true,
    });
  });

  test("bulk actions: Assign to Me where cases are taken on, Assign to Someone Else wherever they are worked, never on Closed Cases", async () => {
    // Every case here is yours: hand them on, move them along.
    expect(bulkTitles(await capture("mine"))).toEqual([
      "Assign to Someone Else",
      "Change Status",
      "Change Priority",
    ]);
    // Nobody works a closed case: reopen it, or set its priority.
    expect(bulkTitles(await capture("closed"))).toEqual([
      "Change Status",
      "Change Priority",
    ]);

    for (const key of ["open", "unassigned", "all"]) {
      expect(
        bulkTitles(await capture(key as SecurityCaseQueueViewKey)),
      ).toEqual([
        "Assign to Me",
        "Assign to Someone Else",
        "Change Status",
        "Change Priority",
      ]);
    }
  });

  test("every case page puts each case's moves in its row's ⋯, before the table's own Delete", async () => {
    for (const view of SECURITY_CASE_QUEUE_VIEWS) {
      const table: CapturedTable = await capture(view.key);
      const actions: Array<{ title: string; placement?: string }> = (table[
        "actionButtons"
      ] || []) as Array<{ title: string; placement?: string }>;

      expect(titlesOf(actions)).toEqual([
        "Assign to Me",
        "Assign to Someone Else",
        "Change Status",
        "Change Priority",
      ]);
      // In the ⋯ menu: the row's one button stays View.
      for (const action of actions) {
        expect(action.placement).toBe("MoreMenu");
      }
      expect(table["isDeleteable"]).toBe(true);
    }
  });

  test("an empty Open Cases or Unassigned is good news; Assigned to Me points at Unassigned", async () => {
    const goodNews: Record<string, boolean> = {};

    for (const view of SECURITY_CASE_QUEUE_VIEWS) {
      const table: CapturedTable = await capture(view.key);
      goodNews[view.key] = Boolean(table.emptyState?.isAllClear);
    }

    expect(goodNews).toEqual({
      open: true,
      mine: false,
      unassigned: true,
      closed: false,
      all: false,
    });

    const mine: CapturedTable = await capture("mine");
    const actions: Array<CapturedEmptyStateAction> =
      mine.emptyState?.actions || [];

    expect(titlesOf(actions)).toEqual([VIEW_UNASSIGNED_CASES]);
    expect(actions[0]?.dataTestId).toBe(VIEW_UNASSIGNED_CASES_TEST_ID);

    for (const key of ["open", "unassigned", "closed", "all"]) {
      const table: CapturedTable = await capture(
        key as SecurityCaseQueueViewKey,
      );
      expect(table.emptyState?.actions).toBeUndefined();
    }
  });

  test("Assigned to Me's way forward opens Unassigned", async () => {
    const navigate: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((): void => {
        // Recorded, not followed.
      });
    const mine: CapturedTable = await capture("mine");

    mine.emptyState?.actions?.[0]?.onClick();

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(String(navigate.mock.calls[0]?.[0])).toBe(
      routeFor(PageMap.SECURITY_CASES_UNASSIGNED),
    );
  });
});

describe("the list a person sees", () => {
  test("has no row of view buttons above it, on any page", async () => {
    for (const view of SECURITY_CASE_QUEUE_VIEWS) {
      const table: CapturedTable = await capture(view.key);

      await drawTable(table);
      await screen.findByTestId("table-empty-state");

      expect(
        document.querySelectorAll('[data-testid^="security-case-view-"]'),
      ).toHaveLength(0);
      expect(document.querySelectorAll("button[aria-pressed]")).toHaveLength(0);

      cleanup();
    }
  });

  test("an empty Open Cases says all is clear, with no button to open one", async () => {
    await drawTable(await capture("open"));

    const empty: HTMLElement = await screen.findByTestId("table-empty-state");

    expect(empty).toHaveAttribute("data-empty-state-kind", "all-clear");
    expect(screen.getByTestId("table-empty-state-title")).toHaveTextContent(
      "No open cases",
    );
    expect(
      screen.getByTestId("table-empty-state-description"),
    ).toHaveTextContent("New ones appear here as detections fire.");
    expect(screen.queryByTestId("empty-table-create-button")).toBeNull();
  });

  test("an empty Assigned to Me says so, and its one button opens Unassigned", async () => {
    const navigate: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Navigation, "navigate")
      .mockImplementation((): void => {
        // Recorded, not followed.
      });

    await drawTable(await capture("mine"));

    const empty: HTMLElement = await screen.findByTestId("table-empty-state");

    expect(empty).toHaveAttribute("data-empty-state-kind", "empty");
    expect(screen.getByTestId("table-empty-state-title")).toHaveTextContent(
      "No open cases are assigned to you",
    );
    expect(screen.queryByTestId("empty-table-create-button")).toBeNull();

    fireEvent.click(screen.getByTestId(VIEW_UNASSIGNED_CASES_TEST_ID));

    expect(String(navigate.mock.calls[0]?.[0])).toBe(
      routeFor(PageMap.SECURITY_CASES_UNASSIGNED),
    );
  });

  test("an empty All Cases offers to open a case", async () => {
    await drawTable(await capture("all"));

    await screen.findByTestId("table-empty-state");

    expect(screen.getByTestId("table-empty-state-title")).toHaveTextContent(
      "No cases yet",
    );
    expect(screen.getByTestId("empty-table-create-button")).toHaveTextContent(
      "Open Security Case",
    );
  });

  test("Unassigned names the team a case was handed to, and a dash for none, instead of Unassigned on every row", async () => {
    listedRows = [
      unassignedCase(
        "20000000-0000-4000-8000-000000000141",
        "CASE-141",
        "Known-bad domain resolved by build-runner-07",
        undefined,
      ),
      unassignedCase(
        "20000000-0000-4000-8000-000000000138",
        "CASE-138",
        "Defender XDR: suspicious PowerShell on web-03",
        "SOC Tier 2",
      ),
    ];

    await drawTable(await capture("unassigned"));

    await screen.findByText("Defender XDR: suspicious PowerShell on web-03");

    expect(screen.getByRole("columnheader", { name: /Team/ })).toBeVisible();
    expect(screen.queryByRole("columnheader", { name: /Assignee/ })).toBeNull();

    const rows: Array<string> = bodyRowTexts();

    expect(rows).toHaveLength(2);
    expect(
      rows.find((row: string): boolean => {
        return row.includes("CASE-138");
      }),
    ).toContain("SOC Tier 2");
    for (const row of rows) {
      expect(row).not.toContain("Unassigned");
    }

    // The case with no team: one quiet dash in its Team cell.
    const teamColumn: number = Array.from(
      document.querySelectorAll("thead th"),
    ).findIndex((header: Element): boolean => {
      return (header.textContent || "").includes("Team");
    });
    const noTeamRow: Element | undefined = Array.from(
      document.querySelectorAll("tbody tr"),
    ).find((row: Element): boolean => {
      return (row.textContent || "").includes("CASE-141");
    });

    expect(teamColumn).toBeGreaterThan(-1);
    expect(noTeamRow?.children[teamColumn]?.textContent?.trim()).toBe("-");
  });

  test("a case OneUptime AI has read shows the read beside its title, with the AI mark", async () => {
    const read: SecurityCase = unassignedCase(
      "20000000-0000-4000-8000-000000000151",
      "CASE-151",
      "Brute force against web-1 ended in a sign-in",
      undefined,
    );
    read.aiVerdict = SecurityCaseAiVerdict.LikelyMalicious;
    listedRows = [
      read,
      unassignedCase(
        "20000000-0000-4000-8000-000000000152",
        "CASE-152",
        "Port scan from a lab host",
        undefined,
      ),
    ];

    const table: CapturedTable = await capture("open");

    // The list asks for each case's read with the rest of the row.
    expect(
      (table as unknown as { selectMoreFields: Record<string, unknown> })
        .selectMoreFields,
    ).toMatchObject({ aiVerdict: true });

    await drawTable(table);
    await screen.findByText("Brute force against web-1 ended in a sign-in");

    const pills: Array<HTMLElement> = screen.getAllByTestId(
      "security-case-row-ai-verdict",
    );

    expect(pills).toHaveLength(1);
    expect(pills[0]).toHaveTextContent("Likely Malicious");
    expect(pills[0]!.closest("tr")).toHaveTextContent("CASE-151");
  });

  test("with the project's AI off, no row shows an AI read", async () => {
    jest
      .spyOn(ProjectUtil, "getCurrentProject")
      .mockReturnValue({ enableAi: false } as never);

    const read: SecurityCase = unassignedCase(
      "20000000-0000-4000-8000-000000000151",
      "CASE-151",
      "Brute force against web-1 ended in a sign-in",
      undefined,
    );
    read.aiVerdict = SecurityCaseAiVerdict.LikelyMalicious;
    listedRows = [read];

    await drawTable(await capture("open"));
    await screen.findByText("Brute force against web-1 ended in a sign-in");

    expect(screen.queryByTestId("security-case-row-ai-verdict")).toBeNull();
    expect(bodyRowTexts()[0]).not.toContain("Likely Malicious");
  });

  test("Open Cases names a case's team where nobody is on it, and says Unassigned where there is neither", async () => {
    listedRows = [
      unassignedCase(
        "20000000-0000-4000-8000-000000000141",
        "CASE-141",
        "Known-bad domain resolved by build-runner-07",
        undefined,
      ),
      unassignedCase(
        "20000000-0000-4000-8000-000000000138",
        "CASE-138",
        "Defender XDR: suspicious PowerShell on web-03",
        "SOC Tier 2",
      ),
    ];

    await drawTable(await capture("open"));

    await screen.findByText("Defender XDR: suspicious PowerShell on web-03");

    expect(
      screen.getByRole("columnheader", { name: /Assignee/ }),
    ).toBeVisible();
    expect(screen.queryByRole("columnheader", { name: /^Team/ })).toBeNull();

    const rows: Array<string> = bodyRowTexts();

    expect(
      rows.find((row: string): boolean => {
        return row.includes("CASE-138");
      }),
    ).toContain("SOC Tier 2");
    expect(
      rows.find((row: string): boolean => {
        return row.includes("CASE-141");
      }),
    ).toContain("Unassigned");
  });

  test("every case page heads its list with the toolbar header every table has, not a layout of its own", async () => {
    for (const view of SECURITY_CASE_QUEUE_VIEWS) {
      const table: CapturedTable = await capture(view.key);

      // No layout of its own: the table's toolbar header (BaseModelTable).
      expect(table.cardProps?.headerLayout).toBeUndefined();

      await drawTable(table);
      await screen.findByTestId("table-empty-state");

      const header: HTMLElement = screen.getByTestId("card-header");

      expect(header).toHaveAttribute("data-header-layout", "toolbar");
      expect(header).toHaveTextContent(view.title);

      cleanup();
    }
  });

  test("Closed Cases asks for the closed cases, latest closed first, and draws each by its verdict", async () => {
    listedRows = [closedCase()];

    await drawTable(await capture("closed"));

    await screen.findByText("Repeated MFA push denials for a sales account");

    expect(listRequests[0]?.query["securityCaseStatusId"]).toEqual(
      new Includes([TEST_STATUS_IDS[SecurityCaseStage.Closed]]),
    );
    // Its priority, as the project names it.
    expect(screen.getAllByText("Low").length).toBeGreaterThan(0);
    expect(listRequests[0]?.sort).toEqual({ closedAt: SortOrder.Descending });
    expect(screen.getAllByText("Benign Positive").length).toBeGreaterThan(0);
    expect(screen.getByRole("columnheader", { name: /Verdict/ })).toBeVisible();
    expect(screen.queryByRole("columnheader", { name: /Status/ })).toBeNull();
    /*
     * When it closed is in the case's own line, so no column of its own
     * until someone turns it on.
     */
    expect(screen.queryByRole("columnheader", { name: /Closed/ })).toBeNull();
    expect(
      screen.getByTestId(SECURITY_CASE_ROW_DETECTIONS_TEST_ID).textContent,
    ).toBe("2 detections, closed 2 days ago");
  });

  test("an open list's case says how many detections it holds and when the last fired", async () => {
    listedRows = [
      unassignedCase(
        "20000000-0000-4000-8000-000000000151",
        "CASE-151",
        "Brute force against web-1 ended in a sign-in",
        undefined,
      ),
    ];

    await drawTable(await capture("open"));
    await screen.findByText("Brute force against web-1 ended in a sign-in");

    const sentence: HTMLElement = screen.getByTestId(
      SECURITY_CASE_ROW_DETECTIONS_TEST_ID,
    );

    expect(sentence.textContent).toBe("1 detection, 2 hours ago");
    // The date and time itself, under the pointer.
    expect(sentence.getAttribute("title")).toBeTruthy();
    expect(sentence.getAttribute("title")).not.toContain("ago");
    // No Last Detection column saying it again.
    expect(
      screen.queryByRole("columnheader", { name: /Last Detection/ }),
    ).toBeNull();
  });

  test("several detections: the last one's time", async () => {
    const busy: SecurityCase = unassignedCase(
      "20000000-0000-4000-8000-000000000152",
      "CASE-152",
      "Impossible travel for a contractor",
      undefined,
    );
    busy.detectionCount = 4;
    listedRows = [busy];

    await drawTable(await capture("all"));
    await screen.findByText("Impossible travel for a contractor");

    expect(
      screen.getByTestId(SECURITY_CASE_ROW_DETECTIONS_TEST_ID).textContent,
    ).toBe("4 detections, the last 2 hours ago");
  });

  test("a case with nothing detected yet says only how many detections it holds", async () => {
    const byHand: SecurityCase = unassignedCase(
      "20000000-0000-4000-8000-000000000153",
      "CASE-153",
      "Opened by hand after a phishing report",
      undefined,
    );
    byHand.detectionCount = 0;
    delete (byHand as unknown as { lastDetectedAt?: Date }).lastDetectedAt;
    listedRows = [byHand];

    await drawTable(await capture("open"));
    await screen.findByText("Opened by hand after a phishing report");

    const sentence: HTMLElement = screen.getByTestId(
      SECURITY_CASE_ROW_DETECTIONS_TEST_ID,
    );

    expect(sentence.textContent).toBe("0 detections");
    expect(sentence).not.toHaveAttribute("title");
  });

  /*
   * Laid out as text: the line wraps between its words and the sentence
   * never jumps to a line of its own, leaving the "·" at the end of the one
   * above; the source and its icon stay together.
   */
  test("the line under the title is laid out as text, the source with its icon", async () => {
    listedRows = [closedCase()];

    await drawTable(await capture("closed"));
    await screen.findByText("Repeated MFA push denials for a sales account");

    const line: HTMLElement = screen.getByTestId(
      SECURITY_CASE_ROW_SOURCE_LINE_TEST_ID,
    );

    expect(line).not.toHaveClass("flex");
    expect(line).toHaveClass("text-xs", "leading-5");

    const source: HTMLElement = line.firstElementChild as HTMLElement;
    expect(source).toHaveClass("inline-flex", "items-center");
    expect(source.querySelector("svg")).not.toBeNull();
    // The dot after the source is in its box: never the start of a line.
    expect(source.lastElementChild).toHaveTextContent("·");
    expect(source.lastElementChild).toHaveAttribute("aria-hidden", "true");
    expect(line.lastElementChild).toBe(
      screen.getByTestId(SECURITY_CASE_ROW_DETECTIONS_TEST_ID),
    );
  });

  /*
   * A case's title is what a detection rule or a person wrote, in their
   * language: it is read the way it is written, set apart from the page
   * (IsolatedText). On a Persian page an English title ran into the number
   * before it, "CASE-142Password spray"; isolated, the number keeps the
   * start of the line and the title follows it.
   */
  test("each title is read the way it is written, after its number", async () => {
    listedRows = [
      unassignedCase(
        "20000000-0000-4000-8000-000000000154",
        "CASE-154",
        "Password spray against Okta from 203.0.113.47",
        undefined,
      ),
      unassignedCase(
        "20000000-0000-4000-8000-000000000155",
        "CASE-155",
        "ورود مشکوک به حساب مدیر",
        undefined,
      ),
    ];

    await drawTable(await capture("open"));

    const english: HTMLElement = await screen.findByText(
      "Password spray against Okta from 203.0.113.47",
    );
    const persian: HTMLElement = screen.getByText("ورود مشکوک به حساب مدیر");

    expect(english.tagName).toBe("BDI");
    expect(english).toHaveAttribute("dir", "ltr");
    expect(persian.tagName).toBe("BDI");
    expect(persian).toHaveAttribute("dir", "rtl");

    // Each number first, its title right after it, in the clamped line.
    const numbers: Array<HTMLElement> = screen.getAllByTestId(
      SECURITY_CASE_ROW_NUMBER_TEST_ID,
    );
    expect(
      numbers.map((number: HTMLElement): string => {
        return number.textContent || "";
      }),
    ).toEqual(["CASE-154", "CASE-155"]);
    expect(numbers[0]!.nextElementSibling).toBe(english);
    expect(numbers[1]!.nextElementSibling).toBe(persian);
    expect(english.parentElement).toHaveClass("line-clamp-2", "break-words");
  });

  /*
   * "Open" is not a verb the shared table words itself, so each word was
   * looked up alone: "Öffnen Sicherheitsfall" in German. The list names
   * its button and dialog in whole phrases.
   */
  test("Open Security Case and its dialog are named in whole phrases", async () => {
    const table: CapturedTable = await capture("open");
    const props: Record<string, unknown> = table as unknown as Record<
      string,
      unknown
    >;

    expect(OPEN_SECURITY_CASE).toBe("Open Security Case");
    expect(OPEN_NEW_SECURITY_CASE).toBe("Open New Security Case");
    expect(props["createVerb"]).toBe("Open");
    expect(props["createFormTitle"]).toBe(OPEN_NEW_SECURITY_CASE);
    expect(props["createFormSubmitButtonText"]).toBe(OPEN_SECURITY_CASE);
  });

  test("going from one case page to the next starts the list afresh: a new table, not the last one's", async () => {
    /*
     * Both pages are the same component at the same place in the layout,
     * so without a key React would keep the first page's table - its
     * columns, filters and page - for the second.
     */
    tableMounts = 0;
    tableUnmounts = 0;

    let rendered: ReturnType<typeof render> | null = null;

    // The list is drawn once the project's statuses are read.
    await act(async () => {
      rendered = render(
        <MemoryRouter>
          <SecurityCasesPage {...PAGE_PROPS} view="open" />
        </MemoryRouter>,
      );
    });

    const first: CapturedTable = capturedTables[capturedTables.length - 1]!;

    expect([tableMounts, tableUnmounts]).toEqual([1, 0]);

    rendered!.rerender(
      <MemoryRouter>
        <SecurityCasesPage {...PAGE_PROPS} view="closed" />
      </MemoryRouter>,
    );

    const second: CapturedTable = capturedTables[capturedTables.length - 1]!;

    expect(first.cardProps?.title).toBe("Open Cases");
    expect(second.cardProps?.title).toBe("Closed Cases");
    expect(second.query["securityCaseStatusId"]).toEqual(
      new Includes([TEST_STATUS_IDS[SecurityCaseStage.Closed]]),
    );

    await waitFor(() => {
      expect([tableMounts, tableUnmounts]).toEqual([2, 1]);
    });
    expect(screen.getAllByTestId("captured-model-table")).toHaveLength(1);
  });
});

describe("the queue's view of a page", () => {
  test("every case page is one of the queue's views, by its page", () => {
    expect(
      SECURITY_CASE_QUEUE_VIEWS.map((view: SecurityCaseQueueView): string => {
        return view.page;
      }),
    ).toEqual([
      PageMap.SECURITY_CASES,
      PageMap.SECURITY_CASES_ASSIGNED_TO_ME,
      PageMap.SECURITY_CASES_UNASSIGNED,
      PageMap.SECURITY_CASES_CLOSED,
      PageMap.SECURITY_CASES_ALL,
    ]);
    expect(viewOf("closed").title).toBe("Closed Cases");
  });
});
