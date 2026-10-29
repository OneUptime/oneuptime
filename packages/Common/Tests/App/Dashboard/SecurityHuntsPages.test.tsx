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
import { goTo } from "./SideMenuHarness";

/*
 * SECURITY EVENTS > EVENTS > HUNTS, a hunt's page, the Events toolbar's
 * Hunts list, Add to Case, and a kept event on a case's Evidence page.
 *
 * The list: the project's hunts by name, each with its search, how often it
 * runs and who it tells, and what its last run found - in red when it
 * could not run; below lg the two short columns fold under the name. A
 * hunt's page: its header over the Events explorer searching what it
 * keeps; a change to the search there is saved or discarded from the
 * header; Show them opens the last find's window; Edit and Delete Hunt.
 * The toolbar's Hunts list opens a hunt and saves the page's search as one,
 * locked, saying why, with nothing to save. Add to Case keeps the ticked
 * events on the case picked, in one request.
 *
 * The tables and dialogs are ModelTable and ModelFormModal calls, so their
 * props are pinned; the Events explorer under a hunt's page is a stand-in
 * that reports its search as the real one does.
 */

configure({ asyncUtilTimeout: 10000 });
jest.setTimeout(60000);

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

type Column = {
  field: Record<string, unknown>;
  title: string;
  hideBelowLargeScreen?: boolean | undefined;
  hideTitleOnMobile?: boolean | undefined;
  getElement?: ((item: unknown) => React.ReactElement) | undefined;
  getExportValue?: ((item: unknown) => string) | undefined;
};

type CapturedTable = {
  id: string;
  singularName?: string;
  pluralName?: string;
  query: Record<string, unknown>;
  isDeleteable: boolean;
  isEditable?: boolean;
  isCreateable: boolean;
  isViewable?: boolean;
  bulkActions?: { buttons: Array<unknown> };
  sortBy?: string;
  sortOrder?: unknown;
  cardProps?: { title?: string; description?: string };
  emptyState?: {
    title?: string;
    description?: string;
    icon?: unknown;
    actions?: Array<{ title: string; onClick: () => void }>;
  };
  formSteps?: Array<{ id: string }>;
  formFields?: Array<{ field: Record<string, unknown> }>;
  createInitialValues?: Record<string, unknown>;
  filters: Array<{ field: Record<string, unknown>; title: string }>;
  searchableFields?: Array<string>;
  selectMoreFields?: Record<string, unknown>;
  getItemName?: (item: unknown) => string;
  onCreateSuccess?: (item: unknown) => Promise<unknown>;
  columns: Array<Column>;
};

const tables: Record<string, CapturedTable> = {};

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTable) => {
      tables[props.id] = props;
      return React.createElement("div", { "data-testid": props.id });
    },
  };
});

type CapturedFormModal = {
  name?: string;
  title: string;
  modelIdToEdit?: { toString: () => string };
  submitButtonText?: string;
  description?: React.ReactElement | string;
  onClose?: () => void;
  onSuccess?: (item: unknown) => void;
  onBeforeCreate?: (item: unknown) => Promise<unknown>;
  formProps: {
    formType: unknown;
    steps?: Array<{ id: string }>;
    fields: Array<{ field: Record<string, unknown> }>;
    initialValues?: Record<string, unknown>;
  };
};

const formModals: Array<CapturedFormModal> = [];

jest.mock("../../../UI/Components/ModelFormModal/ModelFormModal", () => {
  return {
    __esModule: true,
    default: (props: CapturedFormModal) => {
      formModals.push(props);
      return React.createElement(
        "div",
        { "data-testid": `form-modal-${props.name || ""}` },
        typeof props.description === "string" ? null : props.description,
      );
    },
  };
});

type ViewerProps = {
  hunt?: {
    id: { toString: () => string };
    searchQuery: string;
    filters: Record<string, Array<string>>;
  };
  onSearchStateChange?: (state: unknown) => void;
};

let viewerMounts: number = 0;

// The Events explorer under a hunt's page, reporting its search as the real one does.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsViewer",
  () => {
    return {
      __esModule: true,
      default: (props: ViewerProps) => {
        const ReactInMock: typeof React = jest.requireActual("react");

        ReactInMock.useEffect(() => {
          viewerMounts++;
          props.onSearchStateChange?.({
            search: props.hunt?.searchQuery || "",
            filters: new Map(
              Object.entries(props.hunt?.filters || {}).map(
                ([key, values]: [string, Array<string>]) => {
                  return [key, new Set(values)];
                },
              ),
            ),
            timeRange: { range: "Past 1 Week" },
          });
        }, []);

        return ReactInMock.createElement(
          "button",
          {
            type: "button",
            "data-testid": "viewer-change-search",
            onClick: () => {
              props.onSearchStateChange?.({
                search: "processname:pwsh.exe",
                filters: new Map(),
                timeRange: { range: "Past 1 Week" },
              });
            },
          },
          `viewer of ${props.hunt?.id.toString() || "events"}`,
        );
      },
    };
  },
);

import SecurityHuntsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/Hunts";
import SecurityHuntViewPage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/HuntView";
import HuntsMenu from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Hunts/HuntsMenu";
import useAddEventsToCase, {
  AddEventsToCaseActions,
  getAddToCaseGate,
  getCaseEvidenceRoute,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Hunts/useAddEventsToCase";
import {
  HUNTS_EMPTY_DESCRIPTION,
  HUNTS_EMPTY_TITLE,
  HUNTS_MENU_EMPTY,
  HUNTS_MENU_NOT_LOADED,
  HUNTS_TABLE_DESCRIPTION,
  HUNTS_TEST_IDS,
  HUNT_NOT_FOUND,
  SAVE_AS_HUNT_NOTHING_TO_SAVE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Hunts/HuntsCopy";
import {
  HUNT_FORM_STEPS,
  HUNT_TELL_FIELD_KEY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Hunts/HuntFormFields";
import SecurityCaseApi from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseApi";
import SecurityCaseEvidenceCell from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/Evidence/SecurityCaseEvidenceCell";
import SecurityEvent from "../../../Models/AnalyticsModels/SecurityEvent";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import SecurityCaseEvidence from "../../../Models/DatabaseModels/SecurityCaseEvidence";
import SecurityHunt from "../../../Models/DatabaseModels/SecurityHunt";
import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";
import Route from "../../../Types/API/Route";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import Email from "../../../Types/Email";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import SecurityCaseEvidenceKind from "../../../Types/SecurityCase/SecurityCaseEvidenceKind";
import { buildSecurityCaseEventSnapshot } from "../../../Types/SecurityCase/SecurityCaseEventEvidence";
import {
  SECURITY_HUNT_RUN_ERRORS,
  SecurityHuntSchedule,
} from "../../../Types/SecurityEvent/SecurityHunt";
import TimeRange from "../../../Types/Time/TimeRange";
import { BulkActionOnClickProps } from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import { FormType } from "../../../UI/Components/Forms/ModelForm";
import {
  TableCellContext,
  TableFoldedColumnsContext,
} from "../../../UI/Components/Table/TableCellContext";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate, { ModelAction } from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import UserUtil from "../../../UI/Utils/User";
import { visibleText } from "../../Helpers/HtmlText";

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const HUNT_ID: string = "3b000000-0000-4000-8000-000000000001";
const OTHER_HUNT_ID: string = "3b000000-0000-4000-8000-000000000002";
const MAYA: string = "80000000-0000-4000-8000-000000000001";
const HOUR: number = 60 * 60 * 1000;

function person(id: string, name: string): User {
  const user: User = new User();
  user._id = id;
  user.name = new Name(name);
  user.email = new Email("maya@acme-commerce.example");
  return user;
}

function socTeam(): Team {
  const team: Team = new Team();
  team._id = "81000000-0000-4000-8000-000000000001";
  team.name = "SOC Tier 2";
  return team;
}

function hunt(values: Partial<Record<string, unknown>> = {}): SecurityHunt {
  const item: SecurityHunt = new SecurityHunt();
  item._id = HUNT_ID;
  item.name = "Encoded PowerShell";
  item.description = "PowerShell started with an encoded command.";
  item.searchQuery = "processname:powershell.exe commandline:-enc";
  item.filters = {};
  item.timeRange = TimeRange.PAST_ONE_WEEK;
  item.schedule = SecurityHuntSchedule.EveryDay;
  item.notifyUsers = [person(MAYA, "Maya Chen")];
  item.notifyTeams = [socTeam()];
  item.nextRunAt = new Date(Date.now() + 3 * HOUR + 60 * 1000);
  item.lastRunAt = new Date(Date.now() - 2 * HOUR);
  item.lastFoundAt = new Date(Date.now() - 2 * HOUR);
  item.lastFoundSinceAt = new Date(Date.now() - 26 * HOUR);
  item.lastFoundEventCount = 3;
  Object.assign(item, values);
  return item;
}

let stored: SecurityHunt | null;
let readFails: boolean;
let listed: Array<SecurityHunt>;
let listFails: boolean;
let listReads: Array<Record<string, unknown>>;
let navigated: Array<string>;
let queryStrings: Array<Record<string, unknown>>;
let allowed: Record<string, boolean>;

function table(id: string): CapturedTable {
  expect(tables[id]).toBeDefined();
  return tables[id]!;
}

function columnTitled(title: string): Column {
  const column: Column | undefined = table(HUNTS_TEST_IDS.table).columns.find(
    (candidate: Column): boolean => {
      return candidate.title === title;
    },
  );

  expect(column).toBeDefined();
  return column!;
}

function drawCell(
  title: string,
  item: SecurityHunt,
  options: { isFolded?: boolean } = {},
): HTMLElement {
  const { container } = render(
    <MemoryRouter>
      <TableCellContext.Provider value={true}>
        <TableFoldedColumnsContext.Provider value={Boolean(options.isFolded)}>
          {columnTitled(title).getElement!(item)}
        </TableFoldedColumnsContext.Provider>
      </TableCellContext.Provider>
    </MemoryRouter>,
  );

  return container;
}

// One run of text: an inline sentence, its parts written one after another.
function flat(element: HTMLElement): string {
  return (element.textContent || "").replace(/\s+/g, " ").trim();
}

// What a reader sees of a block of lines: each element apart from the next.
function seen(element: HTMLElement): string {
  return visibleText(element.innerHTML);
}

beforeEach(() => {
  for (const key of Object.keys(tables)) {
    delete tables[key];
  }

  formModals.length = 0;
  viewerMounts = 0;
  stored = hunt();
  readFails = false;
  listed = [
    hunt({ _id: OTHER_HUNT_ID, name: "Admin sign-ins outside the office" }),
    hunt(),
    hunt({
      _id: "3b000000-0000-4000-8000-000000000003",
      name: "Threat intel matches",
      schedule: SecurityHuntSchedule.NotScheduled,
    }),
  ];
  listFails = false;
  listReads = [];
  navigated = [];
  queryStrings = [];
  allowed = {};

  goTo(`/dashboard/${PROJECT_ID}/security-events/hunts/${HUNT_ID}`);

  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID(HUNT_ID));
  jest.spyOn(UserUtil, "getUserId").mockReturnValue(new ObjectID(MAYA));
  jest.spyOn(Navigation, "navigate").mockImplementation(((
    to: Route | { toString: () => string },
  ): void => {
    navigated.push(to.toString());
  }) as never);
  jest.spyOn(Navigation, "setQueryString").mockImplementation(((
    values: Record<string, unknown>,
  ): void => {
    queryStrings.push(values);
  }) as never);
  jest.spyOn(PermissionGate, "check").mockImplementation(((
    model: BaseModel,
    action: ModelAction,
  ) => {
    const key: string = `${model.constructor.name}:${action}`;

    return allowed[key] === false
      ? { isAllowed: false, disabledReason: `Your role cannot ${key}.` }
      : { isAllowed: true };
  }) as never);

  jest.spyOn(ModelAPI, "getItem").mockImplementation((async () => {
    if (readFails) {
      throw new Error("The server is unavailable.");
    }

    return stored;
  }) as never);
  jest.spyOn(ModelAPI, "getList").mockImplementation((async (
    options: Record<string, unknown>,
  ) => {
    listReads.push(options);

    if (listFails) {
      throw new Error("The server is unavailable.");
    }

    return { data: listed, count: listed.length, skip: 0, limit: 200 };
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Security Events > Hunts", () => {
  async function renderList(): Promise<void> {
    await act(async () => {
      render(
        <MemoryRouter>
          <SecurityHuntsPage
            pageRoute={new Route("/dashboard/security-events/hunts")}
            currentProject={null}
            hasPaymentMethod={true}
          />
        </MemoryRouter>,
      );
    });
  }

  test("is the project's hunts by name, under their own words", async () => {
    await renderList();

    expect(table(HUNTS_TEST_IDS.table)).toMatchObject({
      singularName: "Hunt",
      pluralName: "Hunts",
      query: { projectId: new ObjectID(PROJECT_ID) },
      sortBy: "name",
      sortOrder: SortOrder.Ascending,
      isCreateable: true,
      isEditable: true,
      isViewable: true,
      isDeleteable: true,
      cardProps: { title: "Hunts", description: HUNTS_TABLE_DESCRIPTION },
      emptyState: {
        title: HUNTS_EMPTY_TITLE,
        description: HUNTS_EMPTY_DESCRIPTION,
        icon: IconProp.ViewfinderCircle,
      },
      searchableFields: ["name", "description", "searchQuery"],
    });
    expect(
      table(HUNTS_TEST_IDS.table).columns.map((column: Column) => {
        return column.title;
      }),
    ).toEqual(["Hunt", "Schedule", "Last Found"]);
    expect(table(HUNTS_TEST_IDS.table).getItemName!(hunt())).toBe(
      "Encoded PowerShell",
    );
    // Who it tells is read with it, to name them on the row.
    expect(table(HUNTS_TEST_IDS.table).selectMoreFields).toMatchObject({
      notifyUsers: { _id: true, name: true, email: true },
      notifyTeams: { _id: true, name: true },
      lastRunError: true,
      lastFoundEventCount: true,
    });
  });

  test("an empty list sends the team to Events, where hunts are saved from", async () => {
    await renderList();

    const [searchEvents] = table(HUNTS_TEST_IDS.table).emptyState!.actions!;

    expect(searchEvents!.title).toBe("Search Events");
    searchEvents!.onClick();
    expect(navigated[0]!.endsWith("/security-events")).toBe(true);
  });

  test("Create Hunt asks what it searches for, then whether it runs on a schedule, starting not scheduled", async () => {
    await renderList();

    expect(table(HUNTS_TEST_IDS.table).formSteps).toBe(HUNT_FORM_STEPS);
    expect(table(HUNTS_TEST_IDS.table).createInitialValues).toEqual({
      schedule: SecurityHuntSchedule.NotScheduled,
      timeRange: TimeRange.PAST_ONE_WEEK,
      notifyUsers: [MAYA],
    });

    // A new hunt opens on its search.
    await table(HUNTS_TEST_IDS.table).onCreateSuccess!(hunt());
    expect(navigated[0]!.endsWith(`/security-events/hunts/${HUNT_ID}`)).toBe(
      true,
    );
  });

  test("a row says its search, how often it runs and who it tells, and what it last found", async () => {
    await renderList();

    const name: HTMLElement = drawCell(
      "Hunt",
      hunt({ filters: { severityName: ["High"] } }),
    );

    expect(seen(name)).toBe(
      "Encoded PowerShell processname:powershell.exe commandline:-enc + 1 filter PowerShell started with an encoded command.",
    );
    // The search as written, in the mono type, left to right on any page.
    expect(
      within(name).getByText("processname:powershell.exe commandline:-enc"),
    ).toHaveAttribute("dir", "ltr");
    cleanup();

    const schedule: HTMLElement = drawCell("Schedule", hunt());

    expect(within(schedule).getByText("Every Day")).toBeInTheDocument();
    expect(flat(schedule)).toContain("Tells Maya Chen, SOC Tier 2");
    expect(flat(schedule)).toContain("Next run in 3 hours");
    cleanup();
    expect(seen(drawCell("Last Found", hunt()))).toBe("3 events 2 hours ago");
  });

  test("a hunt whose last run failed says so in red, and why", async () => {
    await renderList();

    const cell: HTMLElement = drawCell(
      "Last Found",
      hunt({ lastRunError: SECURITY_HUNT_RUN_ERRORS.timedOut.message }),
    );

    expect(
      within(cell).getByTestId(HUNTS_TEST_IDS.lastFoundCell),
    ).toHaveAttribute("data-state", "failed");
    expect(seen(cell)).toBe(
      `Couldn't run ${SECURITY_HUNT_RUN_ERRORS.timedOut.message}`,
    );
    expect(within(cell).getByText("Couldn't run")).toHaveClass("text-red-700");
  });

  test("a hunt opened by hand says nothing about runs", async () => {
    await renderList();

    const notScheduled: SecurityHunt = hunt({
      schedule: SecurityHuntSchedule.NotScheduled,
      lastFoundAt: null,
      lastFoundEventCount: null,
    });

    expect(flat(drawCell("Schedule", notScheduled))).toBe("Not Scheduled");
    cleanup();
    expect(flat(drawCell("Last Found", notScheduled))).toBe("-");
  });

  test("below lg, how often it runs and what it last found fold under the name", async () => {
    await renderList();

    expect(columnTitled("Hunt").hideTitleOnMobile).toBe(true);
    expect(columnTitled("Schedule").hideBelowLargeScreen).toBe(true);
    expect(columnTitled("Last Found").hideBelowLargeScreen).toBe(true);

    const wide: HTMLElement = drawCell("Hunt", hunt());
    expect(within(wide).queryByTestId(HUNTS_TEST_IDS.nameFacts)).toBeNull();
    cleanup();

    const folded: HTMLElement = drawCell(
      "Hunt",
      hunt({ lastRunError: SECURITY_HUNT_RUN_ERRORS.searchFailed.message }),
      { isFolded: true },
    );
    const facts: HTMLElement = within(folded).getByTestId(
      HUNTS_TEST_IDS.nameFacts,
    );

    expect(seen(facts)).toBe("Every Day · Couldn't run");
    expect(facts).toHaveAttribute("data-state", "failed");
    cleanup();

    expect(
      seen(
        within(drawCell("Hunt", hunt(), { isFolded: true })).getByTestId(
          HUNTS_TEST_IDS.nameFacts,
        ),
      ),
    ).toBe("Every Day · 3 events · 2 hours ago");
  });
});

describe("a hunt's page", () => {
  async function renderHunt(): Promise<void> {
    await act(async () => {
      render(
        <MemoryRouter>
          <SecurityHuntViewPage
            pageRoute={new Route(`/dashboard/security-events/hunts/${HUNT_ID}`)}
            currentProject={null}
            hasPaymentMethod={true}
          />
        </MemoryRouter>,
      );
    });
    await screen.findByTestId(HUNTS_TEST_IDS.header);
  }

  test("is the hunt - what it is, how often it runs, who it tells, what it last found - over its search", async () => {
    await renderHunt();

    const header: HTMLElement = screen.getByTestId(HUNTS_TEST_IDS.header);

    expect(within(header).getByTestId("security-hunt-title")).toHaveTextContent(
      "Encoded PowerShell",
    );
    expect(flat(header)).toContain("Hunt");
    expect(flat(header)).toContain("Every Day");
    expect(flat(header)).toContain("Runs every day");
    expect(flat(header)).toContain("Tells Maya Chen, SOC Tier 2");
    expect(flat(header)).toContain("Next run in 3 hours");
    expect(seen(within(header).getByTestId(HUNTS_TEST_IDS.lastFound))).toBe(
      "Last found 3 events 2 hours ago Show them",
    );
    // Its search is the explorer's search bar's, not said twice.
    expect(within(header).queryByTestId(HUNTS_TEST_IDS.searchLine)).toBeNull();
    expect(screen.getByTestId("viewer-change-search")).toHaveTextContent(
      `viewer of ${HUNT_ID}`,
    );
    // Nothing changed yet: Edit, and no Save Changes.
    expect(screen.queryByTestId(HUNTS_TEST_IDS.saveChanges)).toBeNull();
    expect(screen.getByTestId(HUNTS_TEST_IDS.edit)).toBeInTheDocument();
  });

  test("Show them opens the explorer on the window the last find read", async () => {
    await renderHunt();

    const mounts: number = viewerMounts;

    fireEvent.click(screen.getByTestId(HUNTS_TEST_IDS.showThem));

    expect(queryStrings).toHaveLength(1);
    expect(queryStrings[0]).toMatchObject({
      search: null,
      filters: null,
      page: null,
      range: TimeRange.CUSTOM,
      start: stored!.lastFoundSinceAt!.toISOString(),
      end: stored!.lastFoundAt!.toISOString(),
    });
    // The explorer starts afresh on it.
    await waitFor(() => {
      expect(viewerMounts).toBe(mounts + 1);
    });
  });

  test("a changed search is the hunt's to save or discard, from its header", async () => {
    const update: ReturnType<typeof jest.spyOn> = jest
      .spyOn(ModelAPI, "updateById")
      .mockResolvedValue({} as never);

    await renderHunt();

    fireEvent.click(screen.getByTestId("viewer-change-search"));

    expect(await screen.findByTestId(HUNTS_TEST_IDS.changed)).toHaveTextContent(
      "You changed this hunt's search.",
    );
    expect(
      screen.getByTestId(HUNTS_TEST_IDS.discardChanges),
    ).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId(HUNTS_TEST_IDS.saveChanges));
    });

    expect(update).toHaveBeenCalledWith({
      modelType: SecurityHunt,
      id: new ObjectID(HUNT_ID),
      data: { searchQuery: "processname:pwsh.exe", filters: {} },
    });
  });

  test("Discard Changes starts the explorer again from the hunt as it is kept", async () => {
    await renderHunt();

    fireEvent.click(screen.getByTestId("viewer-change-search"));
    fireEvent.click(await screen.findByTestId(HUNTS_TEST_IDS.discardChanges));

    expect(queryStrings[0]).toEqual({
      search: null,
      filters: null,
      page: null,
    });
    await waitFor(() => {
      expect(screen.queryByTestId(HUNTS_TEST_IDS.changed)).toBeNull();
    });
  });

  test("Save Changes is locked, saying why, for a role that may not edit hunts", async () => {
    allowed["SecurityHunt:update"] = false;
    allowed[`SecurityHunt:${ModelAction.Update}`] = false;

    await renderHunt();

    fireEvent.click(screen.getByTestId("viewer-change-search"));

    expect(
      await screen.findByTestId(HUNTS_TEST_IDS.saveChanges),
    ).toBeDisabled();
    expect(screen.getByTestId(HUNTS_TEST_IDS.edit)).toBeDisabled();
  });

  test("Edit opens the hunt's two steps, on the hunt", async () => {
    await renderHunt();

    fireEvent.click(screen.getByTestId(HUNTS_TEST_IDS.edit));

    const edit: CapturedFormModal = formModals[formModals.length - 1]!;

    expect(edit.title).toBe("Edit Hunt");
    expect(edit.modelIdToEdit!.toString()).toBe(HUNT_ID);
    expect(edit.formProps.formType).toBe(FormType.Update);
    expect(edit.formProps.steps).toBe(HUNT_FORM_STEPS);
    expect(
      edit.formProps.fields.map((field: { field: Record<string, unknown> }) => {
        return Object.keys(field.field)[0];
      }),
    ).toContain(HUNT_TELL_FIELD_KEY);
  });

  test("Delete Hunt asks first, then goes back to the list", async () => {
    const remove: ReturnType<typeof jest.spyOn> = jest
      .spyOn(ModelAPI, "deleteItem")
      .mockResolvedValue(undefined as never);

    await renderHunt();

    fireEvent.click(screen.getByTestId(HUNTS_TEST_IDS.more));
    fireEvent.click(await screen.findByTestId(HUNTS_TEST_IDS.delete));

    const dialog: HTMLElement = await screen.findByRole("dialog");

    expect(dialog).toHaveTextContent(
      "Delete the hunt Encoded PowerShell? Its search and schedule are deleted. Events it found and kept on cases stay on them.",
    );

    await act(async () => {
      fireEvent.click(
        within(dialog).getByRole("button", { name: "Delete Hunt" }),
      );
    });

    expect(remove).toHaveBeenCalledWith({
      modelType: SecurityHunt,
      id: new ObjectID(HUNT_ID),
    });
    expect(
      navigated[navigated.length - 1]!.endsWith("/security-events/hunts"),
    ).toBe(true);
  });

  test("a hunt whose last run failed says why, in red, as an alert", async () => {
    stored = hunt({
      lastRunError: SECURITY_HUNT_RUN_ERRORS.schedulerCannotRead.message,
    });

    await renderHunt();

    const line: HTMLElement = screen.getByTestId(HUNTS_TEST_IDS.lastFound);

    expect(line).toHaveAttribute("role", "alert");
    expect(line).toHaveTextContent(
      `Its last run could not be made: ${SECURITY_HUNT_RUN_ERRORS.schedulerCannotRead.message}`,
    );
  });

  test("a hunt that is not there says so; one that could not be read offers to try again", async () => {
    stored = null;

    await act(async () => {
      render(
        <MemoryRouter>
          <SecurityHuntViewPage
            pageRoute={new Route(`/dashboard/security-events/hunts/${HUNT_ID}`)}
            currentProject={null}
            hasPaymentMethod={true}
          />
        </MemoryRouter>,
      );
    });

    expect(await screen.findByText(HUNT_NOT_FOUND)).toBeInTheDocument();
    cleanup();

    readFails = true;

    await act(async () => {
      render(
        <MemoryRouter>
          <SecurityHuntViewPage
            pageRoute={new Route(`/dashboard/security-events/hunts/${HUNT_ID}`)}
            currentProject={null}
            hasPaymentMethod={true}
          />
        </MemoryRouter>,
      );
    });

    expect(
      await screen.findByText("The server is unavailable."),
    ).toBeInTheDocument();
  });
});

describe("the Events toolbar's Hunts list", () => {
  async function renderMenu(
    state: { search: string; filters: Map<string, Set<string>> },
    currentHuntId?: string,
  ): Promise<void> {
    await act(async () => {
      render(
        <MemoryRouter>
          <HuntsMenu
            state={{ ...state, timeRange: { range: TimeRange.PAST_ONE_DAY } }}
            currentHuntId={currentHuntId}
          />
        </MemoryRouter>,
      );
    });
  }

  function trigger(): HTMLElement {
    return within(screen.getByTestId(HUNTS_TEST_IDS.huntsMenu)).getAllByRole(
      "button",
    )[0]!;
  }

  async function openPanel(): Promise<HTMLElement> {
    await act(async () => {
      fireEvent.click(trigger());
    });
    return screen.getByRole("dialog");
  }

  test("lists the project's hunts by name, with each schedule, read when it draws and again as it opens", async () => {
    await renderMenu({ search: "", filters: new Map() });

    expect(trigger()).toHaveTextContent(/^Hunts3$/);
    expect(listReads[0]).toMatchObject({
      modelType: SecurityHunt,
      query: { projectId: new ObjectID(PROJECT_ID) },
      limit: 200,
      select: { _id: true, name: true, schedule: true },
      sort: { name: SortOrder.Ascending },
    });

    const panel: HTMLElement = await openPanel();

    expect(listReads).toHaveLength(2);
    expect(
      within(panel).getByRole("button", { name: "Encoded PowerShell" }),
    ).toHaveTextContent("Encoded PowerShellEvery Day");
    expect(
      within(panel).getByRole("button", { name: "Threat intel matches" }),
    ).toHaveTextContent(/^Threat intel matches$/);
  });

  test("opens a hunt on its page", async () => {
    await renderMenu({ search: "", filters: new Map() });

    fireEvent.click(
      within(await openPanel()).getByRole("button", {
        name: "Admin sign-ins outside the office",
      }),
    );

    expect(
      navigated[0]!.endsWith(`/security-events/hunts/${OTHER_HUNT_ID}`),
    ).toBe(true);
  });

  test("on a hunt's page: says Hunts, ticks the hunt open, and choosing it again stays", async () => {
    await renderMenu({ search: "", filters: new Map() }, HUNT_ID);

    expect(trigger()).toHaveTextContent(/^Hunts3$/);

    const panel: HTMLElement = await openPanel();
    const current: HTMLElement = within(panel).getByRole("button", {
      name: "Encoded PowerShell",
    });

    expect(current).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(current);
    expect(navigated).toEqual([]);
  });

  test("Save as Hunt is locked, saying why, with nothing on screen to save", async () => {
    await renderMenu({ search: "  ", filters: new Map() });

    const panel: HTMLElement = await openPanel();

    expect(
      within(panel).getByRole("button", { name: "+ Save as Hunt" }),
    ).toBeDisabled();
    expect(
      within(panel).getByText(SAVE_AS_HUNT_NOTHING_TO_SAVE),
    ).toBeInTheDocument();
  });

  test("Save as Hunt is locked, saying why, for a role that may not save hunts", async () => {
    allowed[`SecurityHunt:${ModelAction.Create}`] = false;

    await renderMenu({ search: "user:root", filters: new Map() });

    const panel: HTMLElement = await openPanel();

    expect(
      within(panel).getByRole("button", { name: "+ Save as Hunt" }),
    ).toBeDisabled();
    expect(
      within(panel).getByText(
        `Your role cannot SecurityHunt:${ModelAction.Create}.`,
      ),
    ).toBeInTheDocument();
  });

  test("Save as Hunt keeps the search on screen, its chips and its window, and opens the new hunt", async () => {
    await renderMenu({
      search: "  user:svc-backup  ",
      filters: new Map([["!statusName", new Set(["Success"])]]),
    });

    const panel: HTMLElement = await openPanel();

    await act(async () => {
      fireEvent.click(
        within(panel).getByRole("button", { name: "+ Save as Hunt" }),
      );
    });

    const save: CapturedFormModal = formModals[formModals.length - 1]!;

    expect(save.title).toBe("Save as Hunt");
    expect(save.submitButtonText).toBe("Save Hunt");
    expect(save.formProps.formType).toBe(FormType.Create);
    expect(save.formProps.initialValues).toEqual({
      schedule: SecurityHuntSchedule.NotScheduled,
      timeRange: TimeRange.PAST_ONE_DAY,
      notifyUsers: [MAYA],
    });
    // What it saves, said over its fields.
    expect(seen(screen.getByTestId(HUNTS_TEST_IDS.saveSummary))).toBe(
      "Saves this search user:svc-backup + 1 filter Past 1 Day",
    );

    const created: SecurityHunt = (await save.onBeforeCreate!(
      new SecurityHunt(),
    )) as SecurityHunt;

    expect(created.projectId!.toString()).toBe(PROJECT_ID);
    expect(created.searchQuery).toBe("user:svc-backup");
    expect(created.filters).toEqual({ "!statusName": ["Success"] });
    expect(created.timeRange).toBe(TimeRange.PAST_ONE_DAY);

    created._id = HUNT_ID;
    act(() => {
      save.onSuccess!(created);
    });
    expect(navigated[0]!.endsWith(`/security-events/hunts/${HUNT_ID}`)).toBe(
      true,
    );
  });

  test("says when there are no hunts yet, and when they could not be read - and reads them again as it opens", async () => {
    listed = [];
    await renderMenu({ search: "", filters: new Map() });
    expect(
      within(await openPanel()).getByText(HUNTS_MENU_EMPTY),
    ).toBeInTheDocument();
    cleanup();

    listFails = true;
    await renderMenu({ search: "", filters: new Map() });
    expect(
      within(await openPanel()).getByText(HUNTS_MENU_NOT_LOADED),
    ).toBeInTheDocument();

    // Closed, and opened again once it can be read.
    listFails = false;
    listed = [hunt()];
    await act(async () => {
      fireEvent.click(trigger());
    });
    await act(async () => {
      fireEvent.click(trigger());
    });
    expect(
      await within(screen.getByRole("dialog")).findByRole("button", {
        name: "Encoded PowerShell",
      }),
    ).toBeInTheDocument();
  });

  test("is left out for a role that may not read hunts", async () => {
    allowed[`SecurityHunt:${ModelAction.Read}`] = false;

    await renderMenu({ search: "user:root", filters: new Map() });

    expect(screen.queryByTestId(HUNTS_TEST_IDS.huntsMenu)).toBeNull();
    expect(listReads).toEqual([]);
  });
});

describe("Add to Case", () => {
  let actions: AddEventsToCaseActions | null = null;

  const Harness: React.FunctionComponent<{ huntId?: ObjectID }> = (props: {
    huntId?: ObjectID;
  }): React.ReactElement => {
    actions = useAddEventsToCase({ huntId: props.huntId });
    return actions.modals;
  };

  function event(uid: string, time: string): SecurityEvent & JSONObject {
    const row: SecurityEvent = new SecurityEvent();
    row.eventUid = uid;
    row.time = new Date(time);
    return row as SecurityEvent & JSONObject;
  }

  test("takes a role that adds evidence to cases, then one that reads cases, the first refusal said", () => {
    expect(getAddToCaseGate()).toEqual({ isAllowed: true });

    allowed[`SecurityCase:${ModelAction.Read}`] = false;
    expect(getAddToCaseGate().disabledReason).toBe(
      `Your role cannot SecurityCase:${ModelAction.Read}.`,
    );

    allowed[`SecurityCaseEvidence:${ModelAction.Create}`] = false;
    expect(getAddToCaseGate().disabledReason).toBe(
      `Your role cannot SecurityCaseEvidence:${ModelAction.Create}.`,
    );
  });

  test("is one action up to a page of events, and a locked twin past it, saying why", () => {
    render(
      <MemoryRouter>
        <Harness />
      </MemoryRouter>,
    );

    const [working, locked] = actions!.bulkActions;
    const page: Array<SecurityEvent & JSONObject> = Array.from(
      { length: 100 },
      (_: unknown, index: number) => {
        return event(`evt-${index}`, "2026-10-28T22:42:00.000Z");
      },
    );
    const tooMany: Array<SecurityEvent & JSONObject> = [
      ...page,
      event("evt-100", "2026-10-28T22:42:00.000Z"),
    ];

    expect(working!.title).toBe("Add to Case");
    expect(working!.isVisible!(page)).toBe(true);
    expect(working!.isVisible!(tooMany)).toBe(false);
    expect(locked!.isVisible!(tooMany)).toBe(true);
    expect(locked!.disabled).toBe(true);
    expect(locked!.tooltip).toBe("Select 100 or fewer to add them to a case.");
  });

  test("locked for a role that may not, with its reason, and nothing else", () => {
    allowed[`SecurityCaseEvidence:${ModelAction.Create}`] = false;

    render(
      <MemoryRouter>
        <Harness />
      </MemoryRouter>,
    );

    expect(actions!.bulkActions).toHaveLength(1);
    expect(actions!.bulkActions[0]!.disabled).toBe(true);
    expect(actions!.bulkActions[0]!.tooltip).toBe(
      `Your role cannot SecurityCaseEvidence:${ModelAction.Create}.`,
    );
  });

  test("keeps the ticked events on the case picked, in one request naming the hunt, and says what happened to each", async () => {
    jest.spyOn(ModelAPI, "getList").mockResolvedValue({
      data: [],
      count: 0,
      skip: 0,
      limit: 20,
    } as never);
    const addEvents: ReturnType<typeof jest.spyOn> = jest
      .spyOn(SecurityCaseApi, "addEventsToCase")
      .mockResolvedValue({
        added: ["evt-1"],
        alreadyOnCase: ["evt-2"],
        notFound: ["evt-3"],
      } as never);

    const progress: Array<Record<string, unknown>> = [];
    const items: Array<SecurityEvent & JSONObject> = [
      event("evt-1", "2026-10-28T22:42:00.000Z"),
      event("evt-2", "2026-10-28T23:00:00.000Z"),
      event("evt-3", "2026-10-28T23:05:00.000Z"),
    ];
    const clickProps: BulkActionOnClickProps<SecurityEvent & JSONObject> = {
      items,
      onBulkActionStart: (): void => {},
      onBulkActionEnd: (): void => {},
      onProgressInfo: ((info: Record<string, unknown>): void => {
        progress.push(info);
      }) as never,
    };

    const huntId: ObjectID = new ObjectID(HUNT_ID);
    const { rerender } = render(
      <MemoryRouter>
        <Harness huntId={huntId} />
      </MemoryRouter>,
    );

    await act(async () => {
      await actions!.bulkActions[0]!.onClick(clickProps as never);
    });
    rerender(
      <MemoryRouter>
        <Harness huntId={huntId} />
      </MemoryRouter>,
    );

    // The dialog asks which case: CASE-138, picked.
    const dialog: HTMLElement = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Add to a Case");

    const picked: {
      onPick?: (picked: { id: string; number: string }) => void;
    } = {};
    // The dialog's pick, as the list's choice and its Add button make it.
    const modalElement: React.ReactElement = actions!
      .modals as React.ReactElement<{
      onPick: (picked: { id: string; number: string }) => void;
    }>;
    picked.onPick = (
      modalElement.props as {
        onPick: (value: { id: string; number: string }) => void;
      }
    ).onPick;

    await act(async () => {
      picked.onPick!({
        id: "20000000-0000-4000-8000-000000000138",
        number: "CASE-138",
      });
    });

    await waitFor(() => {
      expect(addEvents).toHaveBeenCalledTimes(1);
    });
    expect(addEvents).toHaveBeenCalledWith({
      caseId: new ObjectID("20000000-0000-4000-8000-000000000138"),
      events: [
        { eventUid: "evt-1", time: new Date("2026-10-28T22:42:00.000Z") },
        { eventUid: "evt-2", time: new Date("2026-10-28T23:00:00.000Z") },
        { eventUid: "evt-3", time: new Date("2026-10-28T23:05:00.000Z") },
      ],
      huntId,
    });

    await waitFor(() => {
      const last: Record<string, unknown> = progress[progress.length - 1]!;
      expect((last["successItems"] as Array<unknown>).length).toBe(1);
    });

    const last: Record<string, unknown> = progress[progress.length - 1]!;

    expect((last["unchanged"] as Array<{ reason: string }>)[0]!.reason).toBe(
      "Already kept on this case.",
    );
    expect(
      (last["failed"] as Array<{ failedMessage: string }>)[0]!.failedMessage,
    ).toBe(
      "This event was not found. It may be past its retention, or one you cannot read.",
    );

    // The result's last line opens the case's Evidence page.
    const details: React.ReactElement | undefined =
      actions!.bulkActions[0]!.resultDetails!();
    const { container } = render(<MemoryRouter>{details}</MemoryRouter>);

    expect(flat(container)).toBe("Open CASE-138");
    expect(
      getCaseEvidenceRoute("20000000-0000-4000-8000-000000000138")
        .toString()
        .endsWith("/cases/20000000-0000-4000-8000-000000000138/evidence"),
    ).toBe(true);
  });
});

describe("a kept event on a case's Evidence page", () => {
  test("is a bookmark with what it was, and the hunt that found it, linked", () => {
    const item: SecurityCaseEvidence = new SecurityCaseEvidence();
    item.kind = SecurityCaseEvidenceKind.Event;
    item.name = "Encoded PowerShell downloaded a script on web-03";
    item.eventSnapshot = buildSecurityCaseEventSnapshot({
      event: {
        time: "2026-10-28T22:42:00.000Z",
        eventUid: "evt-0002",
        severityName: "High",
        className: "Process Activity",
        vendorName: "Microsoft",
        productName: "Defender for Endpoint",
      },
      hunt: { id: HUNT_ID, name: "Encoded PowerShell" },
    }) as unknown as JSONObject;

    const { container } = render(
      <MemoryRouter>
        <SecurityCaseEvidenceCell item={item} />
      </MemoryRouter>,
    );

    expect(
      flat(within(container).getByTestId(HUNTS_TEST_IDS.eventEvidenceMeta)),
    ).toContain("High · Process Activity · Microsoft Defender for Endpoint");

    const found: HTMLElement = within(container).getByTestId(
      HUNTS_TEST_IDS.eventEvidenceHunt,
    );

    expect(flat(found)).toBe("Found by the hunt Encoded PowerShell");
    expect(
      within(found).getByRole("link", { name: "Encoded PowerShell" }),
    ).toHaveAttribute(
      "href",
      expect.stringContaining(`/security-events/hunts/${HUNT_ID}`),
    );
  });

  test("a hunt kept without an id it can open is named, not linked", () => {
    const item: SecurityCaseEvidence = new SecurityCaseEvidence();
    item.kind = SecurityCaseEvidenceKind.Event;
    item.name = "Some event";
    item.eventSnapshot = buildSecurityCaseEventSnapshot({
      event: { eventUid: "evt-9", time: "2026-10-28T22:42:00.000Z" },
      hunt: { id: "not-an-id", name: "Old hunt" },
    }) as unknown as JSONObject;

    const { container } = render(
      <MemoryRouter>
        <SecurityCaseEvidenceCell item={item} />
      </MemoryRouter>,
    );

    expect(within(container).queryByRole("link")).toBeNull();
    expect(
      flat(within(container).getByTestId(HUNTS_TEST_IDS.eventEvidenceHunt)),
    ).toBe("Found by the hunt Old hunt");
  });
});
