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
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import AlertAISettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/Settings/AlertAISettings";
import IncidentAISettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentAISettings";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Project from "../../../Models/DatabaseModels/Project";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { ADVANCED_FORM_SECTION_TITLE } from "../../../UI/Components/Forms/Utils/AdvancedFormSection";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import User from "../../../UI/Utils/User";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

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

/*
 * Incidents → Settings → AI and Alerts → Settings → AI, rendered for real
 * with the model API and the permission snapshot stubbed.
 *
 * What these pin is what a project sees before anyone has set a limit:
 * nothing limits AI. Every row used to name a built-in default — "Default
 * (top two severity tiers)", "Default (30 minutes)", "Default (3)", "Default
 * (25)" — and every one of those quietly held AI back. Now an empty limit
 * reads as no limit, the folded Advanced section says so before anyone
 * opens it, each card's form says so, and saving a form without touching a
 * limit writes none.
 *
 * The limits are folded under Advanced, in three cards that each edit on
 * one page: which signals are investigated (minimum severity, cooldown),
 * investigation limits (how many at once, how long), and daily limits
 * (tokens, fix pull requests). They used to be the Investigation and
 * Limits steps of a three-step wizard, with the switches.
 */

const WAIT_TIMEOUT: number = 20000;

const BASE_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectOwner,
];

interface LimitColumns {
  minimumSeverity: string;
  cooldown: string;
  maxConcurrent: string;
  timeLimit: string;
  tokenLimit: string;
  fixTaskLimit: string;
}

interface SettingsPageCase {
  name: string;
  path: string;
  kind: "alert" | "incident";
  render: (props: PageComponentProps) => React.ReactElement;
  enabledColumn: string;
  columns: LimitColumns;
  titles: {
    maxConcurrent: string;
    tokenLimit: string;
    fixTaskLimit: string;
    timeLimit: string;
  };
  cards: {
    which: string;
  };
}

const PAGES: Array<SettingsPageCase> = [
  {
    name: "Alerts",
    path: `/dashboard/${PROJECT_ID}/alerts/settings/ai`,
    kind: "alert",
    render: (props: PageComponentProps): React.ReactElement => {
      return <AlertAISettings {...props} />;
    },
    enabledColumn: "enableAutomaticAlertInvestigation",
    columns: {
      minimumSeverity: "alertInvestigationMinimumSeverity",
      cooldown: "alertInvestigationDedupeWindowMinutes",
      maxConcurrent: "alertAiMaxConcurrentInvestigations",
      timeLimit: "alertAiInvestigationTimeLimitInMinutes",
      tokenLimit: "alertAiDailyAutonomousTokenLimit",
      fixTaskLimit: "alertAiDailyFixTaskLimit",
    },
    titles: {
      maxConcurrent: "Max Concurrent Alert Investigations",
      tokenLimit: "Daily Alert AI Token Limit",
      fixTaskLimit: "Daily Alert AI Fix Task Limit",
      timeLimit: "Alert Investigation Time Limit (Minutes)",
    },
    cards: {
      which: "Which alerts are investigated",
    },
  },
  {
    name: "Incidents",
    path: `/dashboard/${PROJECT_ID}/incidents/settings/ai`,
    kind: "incident",
    render: (props: PageComponentProps): React.ReactElement => {
      return <IncidentAISettings {...props} />;
    },
    enabledColumn: "enableAutomaticIncidentInvestigation",
    columns: {
      minimumSeverity: "incidentInvestigationMinimumSeverity",
      cooldown: "incidentInvestigationDedupeWindowMinutes",
      maxConcurrent: "incidentAiMaxConcurrentInvestigations",
      timeLimit: "incidentAiInvestigationTimeLimitInMinutes",
      tokenLimit: "incidentAiDailyAutonomousTokenLimit",
      fixTaskLimit: "incidentAiDailyFixTaskLimit",
    },
    titles: {
      maxConcurrent: "Max Concurrent Incident Investigations",
      tokenLimit: "Daily Incident AI Token Limit",
      fixTaskLimit: "Daily Incident AI Fix Task Limit",
      timeLimit: "Incident Investigation Time Limit (Minutes)",
    },
    cards: {
      which: "Which incidents are investigated",
    },
  },
];

const SEVERITY_TITLE: string = "Minimum Severity To Investigate";
const COOLDOWN_TITLE: string = "Re-investigation Cooldown (Minutes)";
const INVESTIGATION_LIMITS: string = "Investigation limits";
const DAILY_LIMITS: string = "Daily limits";

// What each built-in default used to be shown as. None may come back.
const RETIRED_DEFAULT_WORDING: Array<RegExp> = [
  /Default \(/,
  /top two severity tiers/i,
  /default of (3|5|25|30)\b/i,
  /maximum 25/i,
];

let project: Project;
let createOrUpdateSpy: ReturnType<typeof jest.spyOn>;

function grant(permissions: Array<Permission>): void {
  jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
  jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue(permissions);
  jest.spyOn(PermissionUtil, "getGlobalPermissions").mockReturnValue(null);
  jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue({
    projectId: new ObjectID(PROJECT_ID),
    userId: ObjectID.generate(),
    permissions: permissions.map((permission: Permission) => {
      return {
        permission: permission,
        labelIds: [],
        _type: "UserPermission",
      };
    }),
    _type: "UserTenantAccessPermission",
  } as unknown as ReturnType<typeof PermissionUtil.getProjectPermissions>);
}

function openPage(page: SettingsPageCase): void {
  goTo(page.path);
  render(
    <MemoryRouter initialEntries={[page.path]}>
      {page.render({
        pageRoute: RouteMap[PageMap.HOME] as Route,
        currentProject: null,
        hasPaymentMethod: true,
      })}
    </MemoryRouter>,
  );
}

async function findText(text: string | RegExp): Promise<HTMLElement> {
  return await screen.findByText(text, {}, { timeout: WAIT_TIMEOUT });
}

function advancedHeader(): HTMLElement {
  return screen.getByRole("button", { name: ADVANCED_FORM_SECTION_TITLE });
}

function openAdvanced(): void {
  fireEvent.click(advancedHeader());
}

async function cardOf(title: string): Promise<HTMLElement> {
  return (await findText(title)).closest('[data-testid="card"]') as HTMLElement;
}

// A detail row's title, as ModelDetail renders it.
function detailTitle(title: string): HTMLElement {
  return screen.getByText(title, { selector: "label > span" });
}

// The value a detail row shows, by its title.
function detailValue(title: string): string {
  const row: HTMLElement | null =
    detailTitle(title).closest("div.space-y-1")?.parentElement || null;
  return (row?.textContent || "").replace(title, "").trim();
}

async function waitForDetailValue(
  title: string,
  expected: string,
): Promise<void> {
  await waitFor(
    () => {
      expect({ title, shown: detailValue(title) }).toEqual({
        title,
        shown: expected,
      });
    },
    { timeout: WAIT_TIMEOUT },
  );
}

// Open a card's one-page Edit form, once it has read the project.
async function openEditForm(cardTitle: string): Promise<HTMLElement> {
  const card: HTMLElement = await cardOf(cardTitle);
  fireEvent.click(within(card).getByText("Edit"));

  const dialog: HTMLElement = await screen.findByRole(
    "dialog",
    {},
    { timeout: WAIT_TIMEOUT },
  );

  await waitFor(
    () => {
      expect(dialog.querySelectorAll("input").length).toBeGreaterThan(0);
    },
    { timeout: WAIT_TIMEOUT },
  );

  return dialog;
}

function placeholdersIn(dialog: HTMLElement): Array<string> {
  return Array.from(dialog.querySelectorAll("input[placeholder]")).map(
    (input: Element): string => {
      return input.getAttribute("placeholder") || "";
    },
  );
}

function expectNoRetiredDefault(text: string): void {
  for (const wording of RETIRED_DEFAULT_WORDING) {
    expect({ wording: String(wording), shown: wording.test(text) }).toEqual({
      wording: String(wording),
      shown: false,
    });
  }
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  grant(BASE_PERMISSIONS);

  jest
    .spyOn(ModelAPI, "getItem")
    .mockImplementation(async (): Promise<Project> => {
      return project;
    });
  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(async (): Promise<ListResult<Project>> => {
      return { data: [], count: 0, skip: 0, limit: 10 };
    });
  jest
    .spyOn(ModelAPI, "count")
    .mockImplementation(async (): Promise<number> => {
      return 0;
    });
  createOrUpdateSpy = jest
    .spyOn(ModelAPI, "createOrUpdate")
    .mockImplementation(async (): Promise<never> => {
      return { data: {} } as never;
    });
  // The project has a provider to use (a global one), so no notice shows.
  jest.spyOn(API, "post").mockImplementation(async (): Promise<never> => {
    return new HTTPResponse<JSONObject>(
      200,
      {
        isAIEnabledForProject: true,
        defaultProviderId: "9d9d9d9d-0000-4000-8000-000000000001",
        providers: [],
      },
      {},
    ) as unknown as never;
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe.each(
  PAGES.map((page: SettingsPageCase): [string, SettingsPageCase] => {
    return [page.name, page];
  }),
)("%s → Settings → AI", (_name: string, page: SettingsPageCase) => {
  function projectWith(values: Record<string, unknown>): Project {
    return Object.assign(new Project(), {
      _id: PROJECT_ID,
      enableAi: true,
      [page.enabledColumn]: true,
      ...values,
    });
  }

  test("a project that set no limits reads as no limits on every row", async () => {
    project = projectWith({});
    openPage(page);
    openAdvanced();

    await waitForDetailValue(SEVERITY_TITLE, "Every severity");
    await waitForDetailValue(COOLDOWN_TITLE, "No cooldown");
    await waitForDetailValue(page.titles.maxConcurrent, "No limit");
    await waitForDetailValue(page.titles.timeLimit, "No time limit");
    await waitForDetailValue(page.titles.tokenLimit, "No limit");
    await waitForDetailValue(page.titles.fixTaskLimit, "No limit");
  });

  test("no row or description names a built-in default", async () => {
    project = projectWith({});
    openPage(page);
    openAdvanced();

    await waitForDetailValue(page.titles.fixTaskLimit, "No limit");

    expectNoRetiredDefault(document.body.textContent || "");
  });

  test("folded, Advanced says nothing is limited until a limit is set", async () => {
    project = projectWith({});
    openPage(page);

    expect(advancedHeader()).toHaveAttribute("aria-expanded", "false");

    await waitFor(
      () => {
        expect(
          screen.getByTestId("collapsible-section-summary"),
        ).toHaveTextContent(
          `Every ${page.kind} is investigated, whatever its severity, and nothing limits how much OneUptime AI does.`,
        );
      },
      { timeout: WAIT_TIMEOUT },
    );
  });

  test("with a provider to use, the page no longer says one is required", async () => {
    project = projectWith({});
    openPage(page);
    openAdvanced();

    await waitForDetailValue(page.titles.fixTaskLimit, "No limit");

    expect(document.body.textContent || "").not.toMatch(
      /Requires an LLM provider/,
    );
  });

  test("a limit the project set is shown as set", async () => {
    project = projectWith({
      [page.columns.cooldown]: 45,
      [page.columns.maxConcurrent]: 40,
      [page.columns.tokenLimit]: 500000,
      [page.columns.fixTaskLimit]: 12,
    });
    openPage(page);
    openAdvanced();

    await waitForDetailValue(COOLDOWN_TITLE, "45");
    await waitForDetailValue(page.titles.maxConcurrent, "40");
    await waitForDetailValue(page.titles.fixTaskLimit, "12");
    await waitFor(
      () => {
        expect(detailValue(page.titles.tokenLimit)).toMatch(/500,?000/);
      },
      { timeout: WAIT_TIMEOUT },
    );
  });

  test("each form offers no default and says an empty limit means none", async () => {
    project = projectWith({});
    openPage(page);
    openAdvanced();

    // What is investigated.
    let dialog: HTMLElement = await openEditForm(page.cards.which);

    await waitFor(
      () => {
        expect(placeholdersIn(dialog)).toContain("No cooldown");
      },
      { timeout: WAIT_TIMEOUT },
    );
    expect(dialog.textContent || "").toMatch(
      /Leave unset to investigate every (alert|incident), whatever its severity\./,
    );
    expect(dialog.textContent || "").toMatch(
      /Leave empty for no cooldown, so every (alert|incident) is investigated\./,
    );
    expectNoRetiredDefault(dialog.textContent || "");
    fireEvent.click(within(dialog).getByTestId("modal-footer-close-button"));

    // How many at once, and for how long.
    dialog = await openEditForm(INVESTIGATION_LIMITS);
    expect(placeholdersIn(dialog)).toEqual(["No limit", "No time limit"]);
    expect(dialog.textContent || "").toMatch(
      /Leave empty for no limit — every (alert|incident) investigation starts right away\./,
    );
    expectNoRetiredDefault(dialog.textContent || "");
    fireEvent.click(within(dialog).getByTestId("modal-footer-close-button"));

    // How much each day.
    dialog = await openEditForm(DAILY_LIMITS);
    expect(placeholdersIn(dialog)).toEqual(["No limit", "No limit"]);
    expect(dialog.textContent || "").toContain(
      "Leave empty for no limit, or set 0 to pause",
    );
    expectNoRetiredDefault(dialog.textContent || "");
  });

  /*
   * A form must not "helpfully" fill in a number. A limit that is saved is
   * a limit that holds, and a project that only opened a form never asked
   * for one.
   */
  test.each([
    ["the investigated", "which"],
    ["the investigation limits", INVESTIGATION_LIMITS],
    ["the daily limits", DAILY_LIMITS],
  ])(
    "saving %s form without touching a limit writes no limit",
    async (_card: string, cardTitle: string) => {
      project = projectWith({});
      openPage(page);
      openAdvanced();

      const dialog: HTMLElement = await openEditForm(
        cardTitle === "which" ? page.cards.which : cardTitle,
      );
      fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));

      await waitFor(
        () => {
          expect(createOrUpdateSpy).toHaveBeenCalledTimes(1);
        },
        { timeout: WAIT_TIMEOUT },
      );

      const posted: Record<string, unknown> = (
        createOrUpdateSpy.mock.calls[0]![0] as { model: Project }
      ).model as unknown as Record<string, unknown>;

      for (const column of Object.values(page.columns)) {
        expect({
          column,
          isANumber: typeof posted[column] === "number",
        }).toEqual({ column, isANumber: false });
      }

      /*
       * The switch is not part of any limit's form, so saving a limit can
       * never turn it off: it stays as the project has it.
       */
      expect(posted[page.enabledColumn]).toBeUndefined();
    },
  );
});
