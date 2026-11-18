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
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import React, { ReactElement } from "react";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import URL from "../../../Types/API/URL";
import API from "../../../UI/Utils/API/API";
import { FormType } from "../../../UI/Components/Forms/ModelForm";
import ModelFormModal from "../../../UI/Components/ModelFormModal/ModelFormModal";
import { ComponentProps as ModelTableProps } from "../../../UI/Components/ModelTable/ModelTable";
import WorkspaceNotificationSummary from "../../../Models/DatabaseModels/WorkspaceNotificationSummary";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * #7118: A MICROSOFT TEAMS SUMMARY PICKS ITS TEAM FROM A LIST.
 *
 * Its Team Name was typed (placeholder "Engineering Team"), and a name
 * typed wrong was found out only from Send Test Now or the Notification
 * Logs. It is a Team picker on Basic Info now, of the connection's teams
 * (GET /microsoft-teams/teams, as a notification rule lists them), kept as
 * the team's id in the summary's teamName - which the server matches by id
 * as it matched a typed name, so nothing stored has to change:
 *
 *   - a connection with one team: no picker, the summary posts in that
 *     team, as before;
 *   - a summary saved with a typed name keeps it, shown as typed, until a
 *     team is picked - and the picker stays for the rest of the form;
 *   - teams that cannot be listed: the name is typed, as before.
 *
 * The production table builds the form; only the table around it is
 * replaced, by the create (or edit) modal the real table opens. Transport,
 * permissions and the project are stubbed; GET /microsoft-teams/teams
 * answers as each test says.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SUMMARY_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

const createOrUpdateMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();

// Which modal the stand-in table opens: the create one, or an edit one.
let modalMode: "create" | "edit" = "create";

/*
 * The stand-in table: the modal the test asks for, open; closed, a button
 * opens the create one. It tells the table when its modal closes, as
 * BaseModelTable does (onCreateEditModalClose).
 */
jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  const StandInTable: (
    props: ModelTableProps<WorkspaceNotificationSummary>,
  ) => ReactElement = (
    props: ModelTableProps<WorkspaceNotificationSummary>,
  ): ReactElement => {
    const [mode, setMode] = React.useState<"create" | "edit" | null>(modalMode);

    React.useEffect(() => {
      if (!mode) {
        props.onCreateEditModalClose?.();
      }
    }, [mode]);

    if (!mode) {
      return (
        <button
          type="button"
          onClick={() => {
            setMode("create");
          }}
        >
          New summary
        </button>
      );
    }

    return (
      <ModelFormModal<WorkspaceNotificationSummary>
        title={mode === "create" ? "Create Summary" : "Edit Summary"}
        name="Workspace Summaries > Summary"
        modelType={props.modelType}
        modalWidth={props.createEditModalWidth}
        initialValues={
          mode === "create" ? props.createInitialValues : undefined
        }
        modelIdToEdit={mode === "edit" ? SUMMARY_ID : undefined}
        submitButtonText={mode === "create" ? "Create Summary" : "Save Changes"}
        onClose={() => {
          setMode(null);
        }}
        onSuccess={() => {}}
        onBeforeCreate={
          mode === "create" ? props.onBeforeCreate : props.onBeforeEdit
        }
        formProps={{
          id: "workspace-summary-form",
          name: "workspace-summary-form",
          modelType: props.modelType,
          fields: props.formFields || [],
          steps: props.formSteps || [],
          formType: mode === "create" ? FormType.Create : FormType.Update,
        }}
      />
    );
  };

  return {
    __esModule: true,
    default: StandInTable,
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      getList: async (): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        return { data: [], count: 0, skip: 0, limit: 0 };
      },
      getCommonHeaders: (): JSONObject => {
        return {};
      },
      createOrUpdate: (...args: Array<unknown>): unknown => {
        return createOrUpdateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return [Permission.ProjectOwner, Permission.User, Permission.Public];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<Permission> } => {
        return {
          globalPermissions: [
            Permission.ProjectOwner,
            Permission.User,
            Permission.Public,
          ],
        };
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): ObjectID => {
        return PROJECT_ID;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

import WorkspaceSummaryTable from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/WorkspaceSummaryTable";
import WorkspaceNotificationSummaryType from "../../../Types/Workspace/NotificationSummary/WorkspaceNotificationSummaryType";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import OneUptimeDate from "../../../Types/Date";
import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import PositiveNumber from "../../../Types/PositiveNumber";
import Timezone from "../../../Types/Timezone";

import {
  MICROSOFT_TEAMS_TYPED_TEAM_OPTION,
  getKeptMicrosoftTeamsTeam,
  getMicrosoftTeamsTeamOptions,
  isMicrosoftTeamsTeamKeptAsTyped,
  isMicrosoftTeamsTeamPickerShown,
  readMicrosoftTeamsTeams,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/WorkspaceSummaryTeamsTeam";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

const NAME_PLACEHOLDER: string = "Weekly Incident Summary";

// "Now": Monday 5 Oct 2026, 12:00 UTC, the creator in Berlin.
const NOW: Date = OneUptimeDate.fromString("2026-10-05T12:00:00.000Z");
const CREATOR_TIMEZONE: string = "Europe/Berlin";

const ENGINEERING_ID: string = "11180000-0000-4000-8000-0000000000e1";
const SUPPORT_ID: string = "11180000-0000-4000-8000-0000000000e2";

// GET /microsoft-teams/teams: the connection's two teams.
const TWO_TEAMS: JSONObject = {
  teams: [
    { id: ENGINEERING_ID, name: "Engineering" },
    { id: SUPPORT_ID, name: "Support" },
  ],
};

const ONE_TEAM: JSONObject = {
  teams: [{ id: ENGINEERING_ID, name: "Engineering" }],
};

// What GET /microsoft-teams/teams answers; refused when undefined.
let teamsAnswer: JSONObject | undefined = undefined;

const apiGets: Array<string> = [];

function dialog(): HTMLElement {
  return screen.getByRole("dialog");
}

function progress(): HTMLElement {
  return within(dialog()).getByRole("navigation", { name: "Progress" });
}

function activeStep(): string {
  return progress().querySelector('[aria-current="step"]')?.textContent || "";
}

async function waitForStep(title: string): Promise<void> {
  await waitFor(() => {
    expect(activeStep()).toBe(title);
  });
}

async function settle(): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 50);
    });
  });
}

async function renderForm(): Promise<UserEvent> {
  await act(async (): Promise<void> => {
    render(
      <WorkspaceSummaryTable
        workspaceType={WorkspaceType.MicrosoftTeams}
        summaryType={WorkspaceNotificationSummaryType.Incident}
      />,
    );
  });

  await settle();

  return userEvent.setup({ delay: null });
}

// The create form, its Basic Info step on screen.
async function openCreateForm(): Promise<UserEvent> {
  const user: UserEvent = await renderForm();

  await screen.findByPlaceholderText(NAME_PLACEHOLDER, {}, { timeout: 10000 });
  await settle();

  return user;
}

// The edit form of the summary getItem answers, its Basic Info step on screen.
async function openEditForm(
  saved: WorkspaceNotificationSummary,
): Promise<UserEvent> {
  modalMode = "edit";
  getItemMock.mockResolvedValue(saved);

  const user: UserEvent = await renderForm();

  await within(dialog()).findByDisplayValue(
    "Weekly incidents",
    {},
    { timeout: 10000 },
  );
  await settle();

  return user;
}

function savedSummary(teamName?: string): WorkspaceNotificationSummary {
  const summary: WorkspaceNotificationSummary =
    new WorkspaceNotificationSummary();
  summary._id = SUMMARY_ID.toString();
  summary.name = "Weekly incidents";
  summary.channelNames = ["General"];
  summary.isEnabled = true;
  summary.numberOfDaysOfData = 7;
  const recurring: Recurring = new Recurring();
  recurring.intervalType = EventInterval.Week;
  recurring.intervalCount = new PositiveNumber(1);
  summary.recurringInterval = recurring;
  summary.timezone = CREATOR_TIMEZONE as Timezone;
  summary.filterCondition = FilterCondition.All;
  summary.filters = [];

  if (teamName) {
    summary.teamName = teamName;
  }

  return summary;
}

// The Team picker, or null when the form has none.
function teamPicker(): HTMLElement | null {
  return within(dialog()).queryByRole("combobox", {
    name: /^Team/,
  });
}

function pickerControl(): HTMLElement {
  const picker: HTMLElement | null = teamPicker();

  expect(picker).not.toBeNull();

  return picker!.closest(".ou-select__control") as HTMLElement;
}

// What the picker shows as picked; "" for none.
function pickedTeam(): string {
  return (
    pickerControl().querySelector(".ou-select__single-value")?.textContent || ""
  );
}

function pickerPlaceholder(): string {
  return (
    pickerControl().querySelector(".ou-select__placeholder")?.textContent || ""
  );
}

// The picker's options, opened.
function teamOptions(): Array<string> {
  fireEvent.keyDown(teamPicker()!, { key: "ArrowDown", code: "ArrowDown" });

  return screen.getAllByRole("option").map((option: HTMLElement): string => {
    return (option.textContent || "").trim();
  });
}

async function pickTeam(name: string): Promise<void> {
  fireEvent.keyDown(teamPicker()!, { key: "ArrowDown", code: "ArrowDown" });

  const option: HTMLElement = await screen.findByRole("option", { name: name });
  fireEvent.mouseDown(option);
  fireEvent.click(option);
  await settle();
}

async function fillBasicInfo(): Promise<void> {
  fireEvent.change(screen.getByPlaceholderText(NAME_PLACEHOLDER), {
    target: { value: "Weekly incidents" },
  });
  fireEvent.change(
    screen.getByPlaceholderText("#incidents-summary, #engineering"),
    { target: { value: "General" } },
  );
  await settle();
}

// Step by step to the last one, then its button: Create Summary, or Save Changes.
async function save(user: UserEvent, button: string): Promise<void> {
  for (const step of ["Schedule", "Content", "Filters"]) {
    await user.click(
      await within(dialog()).findByRole("button", { name: "Next" }),
    );
    await settle();
    await waitForStep(step);
  }

  await user.click(within(dialog()).getByRole("button", { name: button }));

  await waitFor(() => {
    expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
  });
}

// To the Schedule step, and back to Basic Info.
async function toScheduleAndBack(user: UserEvent): Promise<void> {
  await user.click(
    await within(dialog()).findByRole("button", { name: "Next" }),
  );
  await settle();
  await waitForStep("Schedule");

  await user.click(within(progress()).getByText("Basic Info"));
  await settle();
  await waitForStep("Basic Info");
}

type CreateCall = {
  model: WorkspaceNotificationSummary;
};

function savedModel(): WorkspaceNotificationSummary {
  return (createOrUpdateMock.mock.calls[0]?.[0] as CreateCall).model;
}

function teamListings(): number {
  return apiGets.filter((route: string): boolean => {
    return route.endsWith("/microsoft-teams/teams");
  }).length;
}

beforeEach(() => {
  modalMode = "create";
  teamsAnswer = undefined;
  apiGets.length = 0;
  createOrUpdateMock.mockReset().mockResolvedValue({ data: {} });
  getItemMock.mockReset().mockResolvedValue(null);
  getJestSpyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
  getJestSpyOn(OneUptimeDate, "getCurrentTimezone").mockReturnValue(
    CREATOR_TIMEZONE,
  );
  getJestSpyOn(OneUptimeDate, "getUserPrefers12HourFormat").mockReturnValue(
    false,
  );

  jest.spyOn(API, "get").mockImplementation((async (options: {
    url: URL;
  }): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> => {
    const route: string = new globalThis.URL(options.url.toString()).pathname;
    apiGets.push(route);

    if (route.endsWith("/microsoft-teams/teams") && teamsAnswer) {
      return new HTTPResponse<JSONObject>(200, teamsAnswer, {});
    }

    return new HTTPErrorResponse(500, { message: "Not answered" }, {});
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a Microsoft Teams summary picks its team from a list (#7118)", () => {
  test("a connection with two teams: an optional Team on Basic Info, listing the connection's teams by name", async () => {
    teamsAnswer = TWO_TEAMS;

    await openCreateForm();

    expect(teamListings()).toBe(1);
    expect(teamPicker()).not.toBeNull();
    expect(pickedTeam()).toBe("");
    expect(pickerPlaceholder()).toBe("Select a team");
    expect(
      within(dialog()).getByText("The team whose channels these are."),
    ).toBeVisible();
    expect(teamOptions()).toEqual(["Engineering", "Support"]);
    // No text box to type a name into any more.
    expect(
      within(dialog()).queryByPlaceholderText("Engineering Team"),
    ).toBeNull();
  });

  test("picking a team keeps its id on the summary, which the server matches as it matched a name", async () => {
    teamsAnswer = TWO_TEAMS;

    const user: UserEvent = await openCreateForm();
    await fillBasicInfo();
    await pickTeam("Support");

    expect(pickedTeam()).toBe("Support");

    await save(user, "Create Summary");

    expect(savedModel().teamName).toBe(SUPPORT_ID);
  });

  test("a saved summary opens on its team, by name", async () => {
    teamsAnswer = TWO_TEAMS;

    await openEditForm(savedSummary(SUPPORT_ID));

    expect(pickedTeam()).toBe("Support");
  });

  test("a connection with one team: nothing to pick, the summary posts in that team", async () => {
    teamsAnswer = ONE_TEAM;

    const user: UserEvent = await openCreateForm();

    expect(teamListings()).toBe(1);
    expect(teamPicker()).toBeNull();
    expect(within(dialog()).queryByText("Team Name")).toBeNull();

    await fillBasicInfo();
    await save(user, "Create Summary");

    expect(savedModel().teamName || undefined).toBeUndefined();
  });
});

describe("a summary saved with a typed team name", () => {
  test("REGRESSION: keeps the name as it was typed, shown and picked, until another team is picked", async () => {
    teamsAnswer = TWO_TEAMS;

    await openEditForm(savedSummary("Enginering"));

    expect(pickedTeam()).toBe("Enginering (typed name)");
    expect(teamOptions()).toEqual([
      "Engineering",
      "Support",
      "Enginering (typed name)",
    ]);
  });

  test("saved as it is, the typed name is kept: nothing stored has to change", async () => {
    teamsAnswer = TWO_TEAMS;

    const user: UserEvent = await openEditForm(savedSummary("Engineering"));
    await save(user, "Save Changes");

    expect(savedModel().teamName).toBe("Engineering");
  });

  test("with a connection of one team, the picker still shows it - and stays after the team is picked", async () => {
    teamsAnswer = ONE_TEAM;

    const user: UserEvent = await openEditForm(savedSummary("Engineering"));

    expect(pickedTeam()).toBe("Engineering (typed name)");

    await pickTeam("Engineering");

    expect(pickedTeam()).toBe("Engineering");
    expect(teamPicker()).not.toBeNull();

    await toScheduleAndBack(user);

    expect(pickedTeam()).toBe("Engineering");
    expect(teamOptions()).toEqual(["Engineering", "Engineering (typed name)"]);

    await save(user, "Save Changes");

    expect(savedModel().teamName).toBe(ENGINEERING_ID);
  });
});

describe("when the connection's teams cannot be listed", () => {
  test("the form asks for the team's name as text, as it did", async () => {
    teamsAnswer = undefined;

    const user: UserEvent = await openCreateForm();

    expect(teamListings()).toBe(1);
    expect(teamPicker()).toBeNull();
    expect(within(dialog()).getByText("Team Name")).toBeVisible();

    await fillBasicInfo();
    fireEvent.change(
      within(dialog()).getByPlaceholderText("Engineering Team"),
      {
        target: { value: "Engineering" },
      },
    );
    await settle();
    await save(user, "Create Summary");

    expect(savedModel().teamName).toBe("Engineering");
  });

  test("an answer that lists no teams in a shape it knows is no list either", () => {
    expect(readMicrosoftTeamsTeams({})).toBeUndefined();
    expect(readMicrosoftTeamsTeams(null)).toBeUndefined();
    expect(readMicrosoftTeamsTeams({ teams: "Engineering" })).toBeUndefined();
    expect(
      readMicrosoftTeamsTeams({
        teams: [
          { id: ENGINEERING_ID, name: "Engineering" },
          { id: ENGINEERING_ID, name: "Engineering again" },
          { name: "No id" },
          { id: SUPPORT_ID },
        ],
      }),
    ).toEqual([
      { id: ENGINEERING_ID, name: "Engineering" },
      { id: SUPPORT_ID, name: SUPPORT_ID },
    ]);
  });
});

describe("WorkspaceSummaryTeamsTeam", () => {
  const TEAMS: Array<{ id: string; name: string }> = [
    { id: ENGINEERING_ID, name: "Engineering" },
    { id: SUPPORT_ID, name: "Support" },
  ];

  test("a held id is no typed name; a name, or a team since removed, is", () => {
    expect(
      isMicrosoftTeamsTeamKeptAsTyped({ teams: TEAMS, value: SUPPORT_ID }),
    ).toBe(false);
    expect(
      isMicrosoftTeamsTeamKeptAsTyped({ teams: TEAMS, value: "Support" }),
    ).toBe(true);
    expect(isMicrosoftTeamsTeamKeptAsTyped({ teams: TEAMS, value: "" })).toBe(
      false,
    );
    expect(
      isMicrosoftTeamsTeamKeptAsTyped({ teams: TEAMS, value: undefined }),
    ).toBe(false);
  });

  test("a team kept once is kept while the form is open", () => {
    expect(
      getKeptMicrosoftTeamsTeam({
        teams: TEAMS,
        value: SUPPORT_ID,
        kept: "Support",
      }),
    ).toBe("Support");
    expect(
      getKeptMicrosoftTeamsTeam({
        teams: TEAMS,
        value: "Support",
        kept: undefined,
      }),
    ).toBe("Support");
    expect(
      getKeptMicrosoftTeamsTeam({
        teams: TEAMS,
        value: SUPPORT_ID,
        kept: undefined,
      }),
    ).toBeUndefined();
  });

  test("the picker shows for two teams, or a kept name; not for one team and nothing kept", () => {
    expect(
      isMicrosoftTeamsTeamPickerShown({
        teams: TEAMS,
        value: undefined,
        kept: undefined,
      }),
    ).toBe(true);
    expect(
      isMicrosoftTeamsTeamPickerShown({
        teams: [TEAMS[0]!],
        value: undefined,
        kept: undefined,
      }),
    ).toBe(false);
    expect(
      isMicrosoftTeamsTeamPickerShown({
        teams: [TEAMS[0]!],
        value: ENGINEERING_ID,
        kept: "Engineering",
      }),
    ).toBe(true);
    expect(
      isMicrosoftTeamsTeamPickerShown({
        teams: [],
        value: "Ops",
        kept: undefined,
      }),
    ).toBe(true);
  });

  test("team names read as written; a kept name is worded in the reader's language", () => {
    const words: Record<string, string> = readDashboardLocale("de");

    const options: ReturnType<typeof getMicrosoftTeamsTeamOptions> =
      getMicrosoftTeamsTeamOptions({
        teams: TEAMS,
        keptTeam: "Ops",
        translator: dashboardTranslator("de"),
      });

    expect(
      options.map((option: { value: unknown }) => {
        return option.value;
      }),
    ).toEqual([ENGINEERING_ID, SUPPORT_ID, "Ops"]);
    expect(
      options.every((option: { isUserContent?: boolean | undefined }) => {
        return option.isUserContent === true;
      }),
    ).toBe(true);
    expect(options[2]!.label).toBe(
      (words[MICROSOFT_TEAMS_TYPED_TEAM_OPTION] || "").replace(
        "{{team}}",
        "Ops",
      ),
    );
    expect(options[2]!.label).not.toContain("typed name");
  });

  test("every Dashboard language words a kept name's option, and keeps its placeholder", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const words: Record<string, string> = readDashboardLocale(language);
      const worded: string = words[MICROSOFT_TEAMS_TYPED_TEAM_OPTION] || "";

      expect({
        language,
        worded: worded !== "" && worded !== MICROSOFT_TEAMS_TYPED_TEAM_OPTION,
        placeholder: worded.includes("{{team}}"),
      }).toEqual({ language, worded: true, placeholder: true });
    }
  });
});
