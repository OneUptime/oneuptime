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
 * #6776: a Mattermost summary picks the team its channels are in, as a
 * notification rule does - the same optional Mattermost team picker on its
 * Basic Info step, shown when the project's bot is in two or more teams,
 * empty for the default team first, then the others. It is kept as the
 * team's id in the summary's teamName, which the summary hands Mattermost
 * as the team of its channels (WorkspaceNotificationSummaryService).
 *
 * A summary that picks a team the bot was taken out of keeps showing the
 * pick, said to be so, as a rule does (#6775).
 *
 * The production table builds the form; only the table around it is
 * replaced, by the create (or edit) modal the real table opens. Transport,
 * permissions and the project are stubbed; GET /mattermost/connected-teams
 * answers as each test says.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const SUMMARY_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

const ENGINEERING_ID: string = "e".repeat(26);
const SUPPORT_ID: string = "s".repeat(26);

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

const NAME_PLACEHOLDER: string = "Weekly Incident Summary";

// "Now": Monday 5 Oct 2026, 12:00 UTC, the creator in Berlin.
const NOW: Date = OneUptimeDate.fromString("2026-10-05T12:00:00.000Z");
const CREATOR_TIMEZONE: string = "Europe/Berlin";

const ENGINEERING: JSONObject = {
  id: ENGINEERING_ID,
  name: "engineering",
  displayName: "Engineering",
  isDefault: true,
};

const SUPPORT: JSONObject = {
  id: SUPPORT_ID,
  name: "support",
  displayName: "Support",
  isDefault: false,
};

// GET /mattermost/connected-teams: a bot in Engineering, the default, and Support.
const TWO_TEAMS: JSONObject = {
  teams: [ENGINEERING, SUPPORT],
  defaultTeamId: ENGINEERING_ID,
  isBotInDefaultTeam: true,
  botUsername: "oneuptime",
  removedTeams: [],
  areTeamsListed: true,
};

// The bot taken out of Support: Engineering is left, Support kept by its name.
const SUPPORT_LEFT: JSONObject = {
  teams: [ENGINEERING],
  defaultTeamId: ENGINEERING_ID,
  isBotInDefaultTeam: true,
  botUsername: "oneuptime",
  removedTeams: [{ id: SUPPORT_ID, name: "support", displayName: "Support" }],
  areTeamsListed: true,
};

// What GET /mattermost/connected-teams answers; refused when undefined.
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

async function renderForm(workspaceType: WorkspaceType): Promise<UserEvent> {
  await act(async (): Promise<void> => {
    render(
      <WorkspaceSummaryTable
        workspaceType={workspaceType}
        summaryType={WorkspaceNotificationSummaryType.Incident}
      />,
    );
  });

  await settle();

  return userEvent.setup({ delay: null });
}

// The create form, its Basic Info step on screen.
async function openCreateForm(
  workspaceType: WorkspaceType = WorkspaceType.Mattermost,
): Promise<UserEvent> {
  const user: UserEvent = await renderForm(workspaceType);

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

  const user: UserEvent = await renderForm(WorkspaceType.Mattermost);

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
  summary.channelNames = ["town-square"];
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

// The Mattermost team picker, or null when the form has none.
function teamPicker(): HTMLElement | null {
  return within(dialog()).queryByRole("combobox", {
    name: /^Mattermost team/,
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

async function clearTeam(): Promise<void> {
  const clear: Element | null = pickerControl().querySelector(
    ".ou-select__clear-indicator",
  );

  expect(clear).not.toBeNull();
  fireEvent.mouseDown(clear as Element, { button: 0 });
  await settle();
}

async function fillBasicInfo(): Promise<void> {
  fireEvent.change(screen.getByPlaceholderText(NAME_PLACEHOLDER), {
    target: { value: "Weekly incidents" },
  });
  fireEvent.change(
    screen.getByPlaceholderText("#incidents-summary, #engineering"),
    { target: { value: "town-square" } },
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

    if (route.endsWith("/mattermost/connected-teams") && teamsAnswer) {
      return new HTTPResponse<JSONObject>(200, teamsAnswer, {});
    }

    return new HTTPErrorResponse(500, { message: "Not answered" }, {});
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a Mattermost summary picks the team of its channels", () => {
  test("a bot in two teams: an optional Mattermost team on Basic Info, empty for the default team first, with the bot's teams", async () => {
    teamsAnswer = TWO_TEAMS;

    await openCreateForm();

    expect(
      apiGets.filter((route: string): boolean => {
        return route.endsWith("/mattermost/connected-teams");
      }),
    ).toHaveLength(1);
    expect(teamPicker()).not.toBeNull();
    expect(pickedTeam()).toBe("");
    expect(pickerPlaceholder()).toBe("Default team");
    expect(
      within(dialog()).getByText(
        "The team these channels are in. Leave it empty to look in the default team first, then in the others.",
      ),
    ).toBeVisible();
    expect(teamOptions()).toEqual(["Engineering", "Support"]);
  });

  test("picking a team keeps its id on the summary", async () => {
    teamsAnswer = TWO_TEAMS;

    const user: UserEvent = await openCreateForm();
    await fillBasicInfo();
    await pickTeam("Support");

    expect(pickedTeam()).toBe("Support");

    await save(user, "Create Summary");

    expect(savedModel().teamName).toBe(SUPPORT_ID);
    expect(savedModel().channelNames).toEqual(["town-square"]);
  });

  test("left empty: the summary names no team, and its channels are looked for as before", async () => {
    teamsAnswer = TWO_TEAMS;

    const user: UserEvent = await openCreateForm();
    await fillBasicInfo();
    await save(user, "Create Summary");

    expect(savedModel().teamName || undefined).toBeUndefined();
  });

  test("a saved summary opens on its team, by name", async () => {
    teamsAnswer = TWO_TEAMS;

    await openEditForm(savedSummary(SUPPORT_ID));

    expect(pickedTeam()).toBe("Support");
  });

  test("its team cleared: saved without one, so the default team is looked in first again", async () => {
    teamsAnswer = TWO_TEAMS;

    const user: UserEvent = await openEditForm(savedSummary(SUPPORT_ID));
    await clearTeam();

    expect(pickedTeam()).toBe("");

    await save(user, "Save Changes");

    expect(savedModel().teamName).toBeNull();
  });
});

describe("nothing to pick: no Mattermost team picker", () => {
  test("a bot in one team", async () => {
    teamsAnswer = {
      ...TWO_TEAMS,
      teams: [ENGINEERING],
    };

    await openCreateForm();

    expect(teamPicker()).toBeNull();
  });

  test("teams not read: as before", async () => {
    teamsAnswer = undefined;

    await openCreateForm();

    expect(
      apiGets.filter((route: string): boolean => {
        return route.endsWith("/mattermost/connected-teams");
      }),
    ).toHaveLength(1);
    expect(teamPicker()).toBeNull();
  });

  test("a Slack summary never asks for Mattermost's teams; a Microsoft Teams one keeps its Team Name", async () => {
    teamsAnswer = TWO_TEAMS;

    await openCreateForm(WorkspaceType.Slack);

    expect(teamPicker()).toBeNull();
    expect(within(dialog()).queryByText("Team Name")).toBeNull();

    cleanup();
    await openCreateForm(WorkspaceType.MicrosoftTeams);

    expect(teamPicker()).toBeNull();
    expect(within(dialog()).getByText("Team Name")).toBeVisible();
    expect(
      apiGets.filter((route: string): boolean => {
        return route.endsWith("/mattermost/connected-teams");
      }),
    ).toHaveLength(0);
  });
});

describe("a summary that picks a team the bot was taken out of", () => {
  test("still shows the pick, said to be so - with one team left - and offers the team the bot is in", async () => {
    teamsAnswer = SUPPORT_LEFT;

    await openEditForm(savedSummary(SUPPORT_ID));

    expect(pickedTeam()).toBe("Support (bot no longer a member)");
    expect(teamOptions()).toEqual([
      "Engineering",
      "Support (bot no longer a member)",
    ]);
  });

  test("changed to a team the bot is in: saved, the picker still there to change it again", async () => {
    teamsAnswer = SUPPORT_LEFT;

    const user: UserEvent = await openEditForm(savedSummary(SUPPORT_ID));
    await pickTeam("Engineering");

    expect(pickedTeam()).toBe("Engineering");
    expect(teamPicker()).not.toBeNull();

    await save(user, "Save Changes");

    expect(savedModel().teamName).toBe(ENGINEERING_ID);
  });

  test("Basic Info opened again from the next step - the pick kept, then changed to a team the bot is in: the picker still there, the old pick offered once", async () => {
    teamsAnswer = SUPPORT_LEFT;

    const user: UserEvent = await openEditForm(savedSummary(SUPPORT_ID));

    await toScheduleAndBack(user);

    expect(pickedTeam()).toBe("Support (bot no longer a member)");
    expect(teamOptions()).toEqual([
      "Engineering",
      "Support (bot no longer a member)",
    ]);

    await pickTeam("Engineering");
    await toScheduleAndBack(user);

    expect(pickedTeam()).toBe("Engineering");
    expect(teamOptions()).toEqual([
      "Engineering",
      "Support (bot no longer a member)",
    ]);
  });

  test("the form closed, the next one starts afresh: a new summary is not offered the team the last one picked", async () => {
    teamsAnswer = SUPPORT_LEFT;

    const user: UserEvent = await openEditForm(savedSummary(SUPPORT_ID));

    expect(pickedTeam()).toBe("Support (bot no longer a member)");

    await user.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    await settle();
    await user.click(screen.getByRole("button", { name: "New summary" }));
    await screen.findByPlaceholderText(
      NAME_PLACEHOLDER,
      {},
      { timeout: 10000 },
    );
    await settle();

    // The bot in one team, and nothing else picked: no picker, as before.
    expect(teamPicker()).toBeNull();
  });

  test("a new summary is not offered the teams the bot was taken out of", async () => {
    teamsAnswer = {
      ...SUPPORT_LEFT,
      teams: [
        ENGINEERING,
        { ...SUPPORT, id: "u".repeat(26), name: "ops", displayName: "Ops" },
      ],
    };

    await openCreateForm();

    expect(teamOptions()).toEqual(["Engineering", "Ops"]);
  });
});
