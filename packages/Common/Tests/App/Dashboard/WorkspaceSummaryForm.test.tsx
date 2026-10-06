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
import { FormType } from "../../../UI/Components/Forms/ModelForm";
import ModelFormModal from "../../../UI/Components/ModelFormModal/ModelFormModal";
import { ComponentProps as ModelTableProps } from "../../../UI/Components/ModelTable/ModelTable";
import WorkspaceNotificationSummary from "../../../Models/DatabaseModels/WorkspaceNotificationSummary";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * A workspace summary's create form - the recurring incident summary posted
 * to Slack - walked in a browser-like DOM.
 *
 * How Often had no default: the form could not be created until a schedule
 * was made up, and the first summary then went out a whole interval after
 * the moment of saving. It now starts on every week, and leaving the first
 * summary's date empty means 09:00 at the start of the next week in the
 * creator's time zone - which the form says, under the date, before
 * anything is saved. The Filters step asks All or Any only once there are
 * two conditions, starts on All, and drops a condition row left empty.
 *
 * The production table builds the form; only the table around it is
 * replaced, by the create (or edit) modal the real table opens. Transport,
 * permissions and the project are stubbed. "Now" is Monday 5 Oct 2026,
 * 12:00 UTC - 14:00 in Berlin, the creator's time zone.
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

// What the production table handed the stand-in: its columns, for the list.
let lastTableProps: ModelTableProps<WorkspaceNotificationSummary> | undefined =
  undefined;

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (
      props: ModelTableProps<WorkspaceNotificationSummary>,
    ): ReactElement => {
      lastTableProps = props;

      return (
        <ModelFormModal<WorkspaceNotificationSummary>
          title={modalMode === "create" ? "Create Summary" : "Edit Summary"}
          name="Workspace Summaries > Summary"
          modelType={props.modelType}
          modalWidth={props.createEditModalWidth}
          initialValues={
            modalMode === "create" ? props.createInitialValues : undefined
          }
          modelIdToEdit={modalMode === "edit" ? SUMMARY_ID : undefined}
          submitButtonText={
            modalMode === "create" ? "Create Summary" : "Save Changes"
          }
          onClose={() => {}}
          onSuccess={() => {}}
          onBeforeCreate={
            modalMode === "create" ? props.onBeforeCreate : props.onBeforeEdit
          }
          formProps={{
            id: "workspace-summary-form",
            name: "workspace-summary-form",
            modelType: props.modelType,
            fields: props.formFields || [],
            steps: props.formSteps || [],
            formType:
              modalMode === "create" ? FormType.Create : FormType.Update,
          }}
        />
      );
    },
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
import { WORKSPACE_SUMMARY_FIRST_SEND_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/WorkspaceSummaryFirstSendPreview";
import OneUptimeDate from "../../../Types/Date";
import EventInterval from "../../../Types/Events/EventInterval";
import Recurring from "../../../Types/Events/Recurring";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import PositiveNumber from "../../../Types/PositiveNumber";
import Timezone from "../../../Types/Timezone";
import {
  ConditionType,
  NotificationRuleConditionCheckOn,
} from "../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import WorkspaceNotificationSummaryType from "../../../Types/Workspace/NotificationSummary/WorkspaceNotificationSummaryType";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";

const NOW: Date = OneUptimeDate.fromString("2026-10-05T12:00:00.000Z");
const CREATOR_TIMEZONE: string = "Europe/Berlin";

const NAME_PLACEHOLDER: string = "Weekly Incident Summary";

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

async function next(user: UserEvent): Promise<void> {
  await user.click(
    await within(dialog()).findByRole("button", { name: "Next" }),
  );
  await settle();
}

async function renderForm(): Promise<UserEvent> {
  await act(async (): Promise<void> => {
    render(
      <WorkspaceSummaryTable
        workspaceType={WorkspaceType.Slack}
        summaryType={WorkspaceNotificationSummaryType.Incident}
      />,
    );
  });

  await settle();

  return userEvent.setup({ delay: null });
}

async function toSchedule(user: UserEvent): Promise<void> {
  fireEvent.change(
    await screen.findByPlaceholderText(
      NAME_PLACEHOLDER,
      {},
      { timeout: 10000 },
    ),
    { target: { value: "Weekly incidents for the team" } },
  );
  fireEvent.change(
    screen.getByPlaceholderText("#incidents-summary, #engineering"),
    { target: { value: "#incidents" } },
  );
  await settle();
  await next(user);
  await waitForStep("Schedule");
}

async function toFilters(user: UserEvent): Promise<void> {
  await toSchedule(user);
  await next(user);
  await waitForStep("Content");
  await next(user);
  await waitForStep("Filters");
}

// How Often's interval picker: the Schedule step's combobox that is not the Timezone one.
function intervalPicker(): HTMLElement {
  return within(dialog()).getByRole("combobox", {
    name: (name: string): boolean => {
      return !name.includes("Timezone");
    },
  });
}

// The Timezone field's picker.
function timezonePicker(): HTMLElement {
  return within(dialog()).getByRole("combobox", { name: /Timezone/ });
}

// What the Timezone field shows as picked.
function pickedTimezone(): string {
  return (
    timezonePicker()
      .closest(".ou-select__control")
      ?.querySelector(".ou-select__single-value")?.textContent || ""
  );
}

// Picks a time zone in the Timezone field, by typing its name.
async function pickTimezone(name: string): Promise<void> {
  fireEvent.change(timezonePicker(), { target: { value: name } });
  await settle();

  const option: HTMLElement = await screen.findByRole("option", {
    name: new RegExp(` ${name}$`),
  });
  fireEvent.mouseDown(option);
  fireEvent.click(option);
  await settle();
}

function firstSendText(): string {
  return within(dialog()).getByTestId(WORKSPACE_SUMMARY_FIRST_SEND_TEST_ID)
    .textContent as string;
}

function valueInputs(): Array<HTMLInputElement> {
  return within(dialog())
    .getAllByRole("textbox")
    .filter((input: HTMLElement): boolean => {
      // The condition rows' Value inputs, not react-select's own.
      return input.getAttribute("role") !== "combobox";
    }) as Array<HTMLInputElement>;
}

async function addCondition(user: UserEvent, value: string): Promise<void> {
  await user.click(
    within(dialog()).getByRole("button", { name: "Add Condition" }),
  );
  await settle();

  const inputs: Array<HTMLInputElement> = valueInputs();
  fireEvent.change(inputs[inputs.length - 1]!, { target: { value: value } });
  await settle();
}

type CreateCall = {
  model: WorkspaceNotificationSummary;
};

function createdSummary(): WorkspaceNotificationSummary {
  return (createOrUpdateMock.mock.calls[0]?.[0] as CreateCall).model;
}

beforeEach(() => {
  modalMode = "create";
  lastTableProps = undefined;
  createOrUpdateMock.mockReset().mockResolvedValue({ data: {} });
  getItemMock.mockReset().mockResolvedValue(null);
  getJestSpyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
  getJestSpyOn(OneUptimeDate, "getCurrentTimezone").mockReturnValue(
    CREATOR_TIMEZONE,
  );
  getJestSpyOn(OneUptimeDate, "getUserPrefers12HourFormat").mockReturnValue(
    false,
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("creating a workspace summary: the schedule", () => {
  test("walks Basic Info, Schedule, Content, then Filters", async () => {
    await renderForm();

    await screen.findByPlaceholderText(
      NAME_PLACEHOLDER,
      {},
      { timeout: 10000 },
    );

    expect(
      Array.from(progress().querySelectorAll("li")).map(
        (item: Element): string => {
          return item.textContent || "";
        },
      ),
    ).toEqual(["Basic Info", "Schedule", "Content", "Filters"]);
  });

  test("starts the summary switched on", async () => {
    await renderForm();

    await screen.findByPlaceholderText(
      NAME_PLACEHOLDER,
      {},
      { timeout: 10000 },
    );
    await settle();

    expect(
      within(dialog()).getByRole("switch", { name: /^Enabled/ }),
    ).toHaveAttribute("aria-checked", "true");
  });

  test("starts How Often on every week, covering the last 7 days, and goes on without a question", async () => {
    const user: UserEvent = await renderForm();

    await toSchedule(user);

    expect(within(dialog()).getByPlaceholderText("1")).toHaveValue(1);
    expect(within(dialog()).getByText("Week")).toBeVisible();
    expect(within(dialog()).getByPlaceholderText("7")).toHaveValue(7);
    expect(within(dialog()).queryAllByRole("alert")).toHaveLength(0);

    await next(user);
    await waitForStep("Content");
  });

  test("says when the first summary goes out while its date is left empty: next Monday at 09:00, the creator's time", async () => {
    const user: UserEvent = await renderForm();

    await toSchedule(user);

    expect(firstSendText()).toBe(
      "The first summary goes out Mon, Oct 12, 2026, 09:00 CEST.",
    );
  });

  test("moves the first summary with How Often: a daily summary starts tomorrow", async () => {
    const user: UserEvent = await renderForm();

    await toSchedule(user);

    fireEvent.keyDown(intervalPicker(), { key: "ArrowDown" });
    const day: HTMLElement = screen.getByRole("option", { name: "Day" });
    fireEvent.mouseDown(day);
    fireEvent.click(day);
    await settle();

    expect(firstSendText()).toBe(
      "The first summary goes out Tue, Oct 6, 2026, 09:00 CEST.",
    );
  });

  test("creates a summary sent every week, the first at 09:00 next Monday in the creator's time zone", async () => {
    const user: UserEvent = await renderForm();

    await toFilters(user);
    await user.click(
      await within(dialog()).findByRole("button", { name: "Create Summary" }),
    );

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const summary: WorkspaceNotificationSummary = createdSummary();
    const recurring: Recurring = Recurring.fromJSON(
      summary.recurringInterval as Recurring,
    );

    expect(recurring.intervalType).toBe(EventInterval.Week);
    expect(recurring.intervalCount.toNumber()).toBe(1);
    // 09:00 CEST is 07:00 UTC.
    expect(
      OneUptimeDate.fromString(
        summary.sendFirstReportAt as unknown as string,
      ).toISOString(),
    ).toBe("2026-10-12T07:00:00.000Z");
    // The server works the next send out from those (and keeps it in step).
    expect(summary.nextSendAt).toBeUndefined();
    expect(summary.filterCondition).toBe(FilterCondition.All);
    expect(summary.filters).toEqual([]);
    expect(summary.channelNames).toEqual(["#incidents"]);
    // On, as the column defaults to, so it goes out at all.
    expect(summary.isEnabled).toBe(true);
    // The last 7 days, as a weekly summary covers.
    expect(summary.numberOfDaysOfData).toBe(7);
  });
});

/*
 * A summary's schedule is read on its own time zone's clock, so it goes out
 * at the same time of day all year. The Schedule step shows the time zone,
 * starting on the creator's own (Berlin here), and the first-summary
 * sentence follows it.
 */
describe("creating a workspace summary: the time zone", () => {
  test("shows the Timezone on the Schedule step, after How Often, starting on the creator's own", async () => {
    const user: UserEvent = await renderForm();

    await toSchedule(user);

    expect(pickedTimezone()).toMatch(/ Europe\/Berlin$/);
    expect(
      intervalPicker().compareDocumentPosition(timezonePicker()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // It is answered already: the step goes on without a question.
    expect(within(dialog()).queryAllByRole("alert")).toHaveLength(0);
  });

  test("says what the time zone is for: the same time of day all year", async () => {
    const user: UserEvent = await renderForm();

    await toSchedule(user);

    expect(
      within(dialog()).getByText(
        "Summaries go out at the same time of day in this timezone all year, also after the clocks change.",
      ),
    ).toBeVisible();
    expect(
      within(dialog()).getByText(
        /Leave it empty to start at 09:00 in the summary's timezone, at the start of the next week, day or month\./,
      ),
    ).toBeVisible();
  });

  test("moves the first summary to 09:00 in the time zone picked", async () => {
    const user: UserEvent = await renderForm();

    await toSchedule(user);
    await pickTimezone("America/New_York");

    expect(pickedTimezone()).toMatch(/ America\/New_York$/);
    // It is 08:00 in New York: this Monday's 09:00 there is still ahead.
    expect(firstSendText()).toBe(
      "The first summary goes out Mon, Oct 5, 2026, 09:00 EDT.",
    );
  });

  test("creates the summary in the creator's time zone when it is left alone", async () => {
    const user: UserEvent = await renderForm();

    await toFilters(user);
    await user.click(
      await within(dialog()).findByRole("button", { name: "Create Summary" }),
    );

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    expect(createdSummary().timezone).toBe(CREATOR_TIMEZONE);
  });

  test("creates the summary in the time zone picked, the first at 09:00 there", async () => {
    const user: UserEvent = await renderForm();

    await toSchedule(user);
    await pickTimezone("America/New_York");
    await next(user);
    await waitForStep("Content");
    await next(user);
    await waitForStep("Filters");

    await user.click(
      await within(dialog()).findByRole("button", { name: "Create Summary" }),
    );

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const summary: WorkspaceNotificationSummary = createdSummary();

    expect(summary.timezone).toBe("America/New_York");
    // Mon 5 Oct, 09:00 EDT.
    expect(
      OneUptimeDate.fromString(
        summary.sendFirstReportAt as unknown as string,
      ).toISOString(),
    ).toBe("2026-10-05T13:00:00.000Z");
    expect(summary.nextSendAt).toBeUndefined();
  });
});

describe("creating a workspace summary: the filters", () => {
  test("ask no All or Any with no condition, or with one", async () => {
    const user: UserEvent = await renderForm();

    await toFilters(user);

    expect(within(dialog()).queryAllByRole("radio")).toHaveLength(0);

    await addCondition(user, "database");

    expect(within(dialog()).queryAllByRole("radio")).toHaveLength(0);
  });

  test("ask Match Condition, under the conditions and on All, once there are two", async () => {
    const user: UserEvent = await renderForm();

    await toFilters(user);
    await addCondition(user, "database");
    await addCondition(user, "postgres");

    const group: HTMLElement = await within(dialog()).findByRole("radiogroup", {
      name: /^Match Condition/,
    });

    expect(within(group).getByRole("radio", { name: "All" })).toBeChecked();
    expect(within(group).getByRole("radio", { name: "Any" })).not.toBeChecked();
    expect(
      within(dialog())
        .getByRole("button", { name: "Add Condition" })
        .compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("create the summary with the conditions and the match picked", async () => {
    const user: UserEvent = await renderForm();

    await toFilters(user);
    await addCondition(user, "database");
    await addCondition(user, "postgres");
    await user.click(
      await within(dialog()).findByRole("radio", { name: "Any" }),
    );
    await settle();

    await user.click(
      within(dialog()).getByRole("button", { name: "Create Summary" }),
    );

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const summary: WorkspaceNotificationSummary = createdSummary();

    expect(summary.filterCondition).toBe(FilterCondition.Any);
    expect(summary.filters).toEqual([
      {
        checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
        conditionType: ConditionType.EqualTo,
        value: "database",
      },
      {
        checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
        conditionType: ConditionType.EqualTo,
        value: "postgres",
      },
    ]);
  });

  test("create a summary with one condition with All, which they never asked", async () => {
    const user: UserEvent = await renderForm();

    await toFilters(user);
    await addCondition(user, "database");

    await user.click(
      within(dialog()).getByRole("button", { name: "Create Summary" }),
    );

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    expect(createdSummary().filterCondition).toBe(FilterCondition.All);
    expect(createdSummary().filters).toHaveLength(1);
  });

  test("drop a condition row left empty, without asking anything about it", async () => {
    const user: UserEvent = await renderForm();

    await toFilters(user);
    await addCondition(user, "database");
    await user.click(
      within(dialog()).getByRole("button", { name: "Add Condition" }),
    );
    await settle();

    await user.click(
      within(dialog()).getByRole("button", { name: "Create Summary" }),
    );

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    expect(createdSummary().filters).toEqual([
      expect.objectContaining({ value: "database" }),
    ]);
  });
});

describe("editing a workspace summary", () => {
  function savedSummary(): WorkspaceNotificationSummary {
    const summary: WorkspaceNotificationSummary =
      new WorkspaceNotificationSummary();
    summary._id = SUMMARY_ID.toString();
    summary.name = "Weekly incidents for the team";
    summary.channelNames = ["#incidents"];
    summary.isEnabled = true;
    const recurring: Recurring = new Recurring();
    recurring.intervalType = EventInterval.Day;
    recurring.intervalCount = new PositiveNumber(2);
    summary.recurringInterval = recurring;
    summary.numberOfDaysOfData = 7;
    summary.filterCondition = FilterCondition.Any;
    summary.filters = [
      {
        checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
        conditionType: ConditionType.Contains,
        value: "database",
      },
    ];
    return summary;
  }

  test("shows its own interval, and no first-summary sentence: its next send is in the list", async () => {
    modalMode = "edit";
    getItemMock.mockResolvedValue(savedSummary());

    const user: UserEvent = await renderForm();

    await within(dialog()).findByDisplayValue(
      "Weekly incidents for the team",
      {},
      { timeout: 10000 },
    );
    await user.click(within(progress()).getByText("Schedule"));
    await waitForStep("Schedule");

    expect(within(dialog()).getByPlaceholderText("1")).toHaveValue(2);
    expect(within(dialog()).getByText("Day")).toBeVisible();
    expect(
      within(dialog()).queryByTestId(WORKSPACE_SUMMARY_FIRST_SEND_TEST_ID),
    ).not.toBeInTheDocument();
  });

  test("with one condition saved as Any asks nothing and keeps Any", async () => {
    modalMode = "edit";
    getItemMock.mockResolvedValue(savedSummary());

    const user: UserEvent = await renderForm();

    await within(dialog()).findByDisplayValue(
      "Weekly incidents for the team",
      {},
      { timeout: 10000 },
    );
    await user.click(within(progress()).getByText("Filters"));
    await waitForStep("Filters");
    await settle();

    expect(within(dialog()).queryAllByRole("radio")).toHaveLength(0);

    await user.click(
      within(dialog()).getByRole("button", { name: "Save Changes" }),
    );

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    expect(createdSummary().filterCondition).toBe(FilterCondition.Any);
  });
  test("shows the time zone it is read in, not the one of whoever edits it", async () => {
    modalMode = "edit";
    const saved: WorkspaceNotificationSummary = savedSummary();
    saved.timezone =
      "America/New_York" as Timezone;
    getItemMock.mockResolvedValue(saved);

    const user: UserEvent = await renderForm();

    await within(dialog()).findByDisplayValue(
      "Weekly incidents for the team",
      {},
      { timeout: 10000 },
    );
    await user.click(within(progress()).getByText("Schedule"));
    await waitForStep("Schedule");

    expect(pickedTimezone()).toMatch(/ America\/New_York$/);
  });

  test("sends the time zone back as it was when only the name changes, so its schedule stays", async () => {
    modalMode = "edit";
    const saved: WorkspaceNotificationSummary = savedSummary();
    saved.timezone =
      "America/New_York" as Timezone;
    getItemMock.mockResolvedValue(saved);

    const user: UserEvent = await renderForm();

    const name: HTMLElement = await within(dialog()).findByDisplayValue(
      "Weekly incidents for the team",
      {},
      { timeout: 10000 },
    );
    fireEvent.change(name, { target: { value: "Renamed summary" } });
    await settle();

    // Save is on the last step.
    await user.click(within(progress()).getByText("Filters"));
    await waitForStep("Filters");
    await settle();

    await user.click(
      within(dialog()).getByRole("button", { name: "Save Changes" }),
    );

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    expect(createdSummary().timezone).toBe("America/New_York");
  });

  test("shows a summary saved under a legacy name in its zone's option", async () => {
    modalMode = "edit";
    const saved: WorkspaceNotificationSummary = savedSummary();
    saved.timezone = "US/Eastern" as Timezone;
    getItemMock.mockResolvedValue(saved);

    const user: UserEvent = await renderForm();

    await within(dialog()).findByDisplayValue(
      "Weekly incidents for the team",
      {},
      { timeout: 10000 },
    );
    await user.click(within(progress()).getByText("Schedule"));
    await waitForStep("Schedule");

    expect(pickedTimezone()).toMatch(/ America\/New_York$/);
  });
});

describe("the list of workspace summaries", () => {
  type Column = {
    field?: Record<string, boolean>;
    title?: string;
    noValueMessage?: string;
  };

  function columns(): Array<Column> {
    return (lastTableProps?.columns || []) as unknown as Array<Column>;
  }

  function timezoneColumn(): Column | undefined {
    return columns().find((column: Column): boolean => {
      return Boolean(column.field?.["timezone"]);
    });
  }

  test("says each summary's time zone, after how often it goes out", async () => {
    await renderForm();

    const titles: Array<string> = columns().map((column: Column): string => {
      return column.title || "";
    });

    expect(titles.indexOf("Timezone")).toBe(titles.indexOf("Frequency") + 1);
    expect(timezoneColumn()?.title).toBe("Timezone");
  });

  test("reads UTC for a summary with none, as it is read in UTC", async () => {
    await renderForm();

    expect(timezoneColumn()?.noValueMessage).toBe("UTC");
  });
});
