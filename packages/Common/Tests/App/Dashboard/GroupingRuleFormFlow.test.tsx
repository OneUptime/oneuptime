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
import React, { FunctionComponent } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import Permission, { UserPermission } from "../../../Types/Permission";

/*
 * The simplified grouping rule form, walked for real: the Incident and Alert
 * Grouping Rules pages hand their steps and fields to ModelTable, and these
 * tests open them in the real ModelFormModal / ModelForm / BasicForm, exactly
 * as ModelTable's create and edit dialogs do. Only the network, permissions
 * and the signed-in user are stubbed.
 *
 * What a person sees: two questions and Create for a new rule; Custom opens
 * the Group By switches; everything else - paging and owners, the episode
 * lifecycle, the details - is folded under More fields at the end of the
 * Grouping step, which names what it holds and adds no step; an existing
 * rule opens with that fold folded and a chip for each setting it uses, and
 * saving it untouched writes back exactly what it had.
 */

const getItemMock: MockFunction = getJestMockFunction();
const createOrUpdateMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();

// No rows: the dropdowns' and pickers' lists, unless a test serves some.
const listNothing: () => Promise<unknown> = (): Promise<unknown> => {
  return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
};

getListMock.mockImplementation(listNothing);

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      createOrUpdate: (...args: Array<unknown>): unknown => {
        return createOrUpdateMock(...args);
      },
      create: async (): Promise<{ data: unknown }> => {
        return { data: {} };
      },
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

const OWNER_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectOwner,
];

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return OWNER_PERMISSIONS;
      },
      getProjectPermissions: (): { permissions: Array<UserPermission> } => {
        return {
          permissions: OWNER_PERMISSIONS.map((permission: Permission) => {
            return {
              permission,
              labelIds: [],
              _type: "UserPermission",
            } as UserPermission;
          }),
        };
      },
      getGlobalPermissions: (): { globalPermissions: Array<Permission> } => {
        return { globalPermissions: OWNER_PERMISSIONS };
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

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/ProjectUser", () => {
  return {
    __esModule: true,
    default: {
      fetchProjectUsersAsDropdownOptions: async (): Promise<Array<unknown>> => {
        return [];
      },
    },
  };
});

interface CapturedTable {
  formFields: Array<ModelField<any>>;
  formSteps: Array<FormStep<any>>;
  createInitialValues: FormValues<any>;
  createEditModalWidth: ModalWidth;
}

let capturedTables: Array<CapturedTable> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: CapturedTable): null => {
      capturedTables.push(props);
      return null;
    },
  };
});

import IncidentGroupingRulesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentGroupingRules";
import AlertGroupingRulesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/Settings/AlertGroupingRules";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import IncidentGroupingRule from "../../../Models/DatabaseModels/IncidentGroupingRule";
import AlertGroupingRule from "../../../Models/DatabaseModels/AlertGroupingRule";
import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import Team from "../../../Models/DatabaseModels/Team";
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import Includes from "../../../Types/BaseDatabase/Includes";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import ModelFormModal from "../../../UI/Components/ModelFormModal/ModelFormModal";
import { FormType, ModelField } from "../../../UI/Components/Forms/ModelForm";
import { FormStep } from "../../../UI/Components/Forms/Types/FormStep";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import { ModalWidth } from "../../../UI/Components/Modal/Modal";
import {
  listedNames,
  setChips,
} from "../../UI/Components/FoldedSection/FoldedSectionQueries";

const WAIT_TIMEOUT: number = 20000;

const RULE_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const POLICY_ID: string = "22222222-2222-4222-8222-222222222222";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/project/incidents/settings/grouping-rules"),
  currentProject: null,
  hasPaymentMethod: false,
};

function captureTable(
  page: FunctionComponent<PageComponentProps>,
): CapturedTable {
  capturedTables = [];
  const Page: FunctionComponent<PageComponentProps> = page;
  render(<Page {...PAGE_PROPS} />);
  const table: CapturedTable | undefined =
    capturedTables[capturedTables.length - 1];
  cleanup();

  if (!table) {
    throw new Error("The page did not render its ModelTable.");
  }

  return table;
}

interface OpenFormOptions<TModel extends BaseModel> {
  page: FunctionComponent<PageComponentProps>;
  modelType: { new (): TModel };
  singularName: string;
  formType: FormType;
}

async function openForm<TModel extends BaseModel>(
  options: OpenFormOptions<TModel>,
): Promise<void> {
  const table: CapturedTable = captureTable(options.page);
  const isCreate: boolean = options.formType === FormType.Create;

  await act(async (): Promise<void> => {
    render(
      <ModelFormModal<TModel>
        title={
          isCreate
            ? `Create New ${options.singularName}`
            : `Edit ${options.singularName}`
        }
        modelType={options.modelType}
        modalWidth={table.createEditModalWidth}
        initialValues={isCreate ? table.createInitialValues : undefined}
        submitButtonText={
          isCreate ? `Create ${options.singularName}` : "Save Changes"
        }
        onClose={(): void => {
          // Not asserted on.
        }}
        onSuccess={(): void => {
          // Not asserted on.
        }}
        formProps={{
          name: "grouping-rule-form",
          modelType: options.modelType,
          id: "grouping-rule-form",
          fields: table.formFields.filter((field: ModelField<any>) => {
            return isCreate
              ? !field.doNotShowWhenCreating
              : !field.doNotShowWhenEditing;
          }),
          steps: table.formSteps,
          formType: options.formType,
        }}
        modelIdToEdit={isCreate ? undefined : RULE_ID}
      />,
    );
  });

  await waitFor(
    () => {
      expect(screen.getByTestId("grouping-mode-field")).toBeInTheDocument();
    },
    { timeout: WAIT_TIMEOUT },
  );
}

async function openIncidentCreateForm(): Promise<void> {
  await openForm<IncidentGroupingRule>({
    page: IncidentGroupingRulesPage,
    modelType: IncidentGroupingRule,
    singularName: "Incident Grouping Rule",
    formType: FormType.Create,
  });
}

function dialog(): HTMLElement {
  return screen.getByRole("dialog");
}

function stepTitles(): Array<string> {
  return within(within(dialog()).getByRole("navigation", { name: "Progress" }))
    .getAllByRole("listitem")
    .map((item: HTMLElement): string => {
      return (item.textContent || "").trim();
    });
}

function activeStep(): string {
  return (
    within(dialog())
      .getByRole("navigation", { name: "Progress" })
      .querySelector('[aria-current="step"]')?.textContent || ""
  ).trim();
}

function submitButton(): HTMLElement {
  return within(dialog()).getByTestId("modal-footer-submit-button");
}

async function clickSubmit(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(submitButton());
  });
}

// The form's action: on the last step only.
function querySubmitButton(): HTMLElement | null {
  return within(dialog()).queryByTestId("modal-footer-submit-button");
}

// The plain Next every step but the last shows instead.
function nextButton(): HTMLElement {
  return within(dialog()).getByTestId("modal-footer-next-button");
}

// Presses Next: it checks the step on screen, then walks on.
async function clickNext(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(nextButton());
  });
}

// Walks on with Next to the last step, where the action is, and presses it.
async function walkOnAndSubmit(): Promise<void> {
  for (let step: number = 0; step < 8 && !querySubmitButton(); step++) {
    await clickNext();
  }

  await clickSubmit();
}

/*
 * An edit form's step list opens any step: the last one, where Save Changes
 * is, then Save Changes.
 */
async function saveFromTheLastStep(): Promise<void> {
  const titles: Array<string> = stepTitles();
  const last: string = titles[titles.length - 1] as string;

  if (activeStep() !== last) {
    expect(querySubmitButton()).not.toBeInTheDocument();

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(
          within(dialog()).getByRole("navigation", { name: "Progress" }),
        ).getByText(last),
      );
    });
    await waitFor(() => {
      expect(activeStep()).toBe(last);
    });
  }

  expect(submitButton()).toHaveTextContent("Save Changes");
  await clickSubmit();
}

// Walks on with the plain Next, to the step with this title.
async function goToStep(title: string): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(within(dialog()).getByRole("button", { name: "Next" }));
  });
  await waitFor(
    () => {
      expect(activeStep()).toBe(title);
    },
    { timeout: WAIT_TIMEOUT },
  );
}

function nameInput(): HTMLElement {
  return within(dialog()).getByPlaceholderText(
    "Group incidents from the same monitor",
  );
}

function minutesInput(testId: string): HTMLElement {
  return within(screen.getByTestId(testId)).getByRole("spinbutton");
}

function switchNamed(name: string): HTMLElement {
  return within(dialog()).getByRole("switch", { name });
}

// The rule's More fields: the fold at the end of the Grouping step.
function moreFieldsHeader(): HTMLElement {
  return within(dialog()).getByRole("button", { name: "More fields" });
}

function moreFieldsSection(): HTMLElement {
  return moreFieldsHeader().closest(
    '[data-testid="folded-section"]',
  ) as HTMLElement;
}

async function openMoreFields(): Promise<void> {
  if (moreFieldsHeader().getAttribute("aria-expanded") !== "true") {
    await act(async (): Promise<void> => {
      fireEvent.click(moreFieldsHeader());
    });
  }

  await waitFor(() => {
    expect(moreFieldsHeader()).toHaveAttribute("aria-expanded", "true");
  });
}

async function foldMoreFields(): Promise<void> {
  if (moreFieldsHeader().getAttribute("aria-expanded") !== "false") {
    await act(async (): Promise<void> => {
      fireEvent.click(moreFieldsHeader());
    });
  }

  await waitFor(() => {
    expect(moreFieldsHeader()).toHaveAttribute("aria-expanded", "false");
  });
}

/*
 * What the folded header lists, as read on screen: names, and the set ones
 * with what they are set to ("On-Call Duty Policies: 1").
 */
function foldedItems(): Array<string> {
  return listedNames(moreFieldsHeader());
}

// The chips: what the rule has set.
function foldedChips(): Array<string> {
  return setChips(moreFieldsHeader());
}

// "7 more": the unset names the header leaves out.
function foldedMore(): string | null {
  return (
    within(moreFieldsHeader()).queryByTestId("folded-section-more")
      ?.textContent || null
  );
}

/*
 * The sentence the folded header says under its names, when it says one:
 * that the rule still has an old default assignee to settle.
 */
function moreFieldsSummary(): string | null {
  return (
    within(moreFieldsSection()).queryByTestId("collapsible-section-summary")
      ?.textContent || null
  );
}

// The small headings inside the fold, in order.
function moreFieldsHeadings(): Array<string> {
  return within(moreFieldsSection())
    .queryAllByRole("heading", { level: 3 })
    .map((heading: HTMLElement): string => {
      return (heading.textContent || "").trim();
    });
}

async function pickMode(mode: string): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(screen.getByTestId(`card-select-option-${mode}`));
  });
}

function submitted(): Record<string, unknown> {
  return (createOrUpdateMock.mock.calls[0] as Array<{ model: BaseModel }>)[0]!
    .model as unknown as Record<string, unknown>;
}

function submittedMiscData(): Record<string, unknown> {
  return ((
    createOrUpdateMock.mock.calls[0] as Array<{
      miscDataProps: Record<string, unknown>;
    }>
  )[0]!.miscDataProps || {}) as Record<string, unknown>;
}

async function waitForSave(): Promise<void> {
  await waitFor(
    () => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    },
    { timeout: WAIT_TIMEOUT },
  );
}

const FORM_ONLY_KEYS: Array<string> = [
  "groupingMode",
  "timeWindowSetting",
  "reopenWindowSetting",
  "resolveDelaySetting",
  "inactivityTimeoutSetting",
];

describe("creating a grouping rule", () => {
  beforeEach(() => {
    cleanup();
    getItemMock.mockReset();
    createOrUpdateMock.mockReset();
    createOrUpdateMock.mockResolvedValue({ data: {} });
  });

  afterEach(() => {
    cleanup();
  });

  test("is two questions and Create, starting from a rule that already works", async () => {
    await openIncidentCreateForm();

    expect(stepTitles()).toEqual(["Grouping", "Which Incidents"]);
    expect(activeStep()).toBe("Grouping");

    expect(screen.getByTestId("card-select-option-monitor")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(
      switchNamed("Only group incidents that arrive close together"),
    ).toHaveAttribute("aria-checked", "true");
    expect(minutesInput("time-window-setting")).toHaveValue(30);
    expect(nameInput()).toHaveValue("Group incidents from the same monitor");
    expect(switchNamed("Enabled")).toHaveAttribute("aria-checked", "true");
    /*
     * Everything else is folded under More fields, which names what it
     * holds - the first four, and how many more - and has nothing set.
     */
    expect(moreFieldsHeader()).toHaveAttribute("aria-expanded", "false");
    expect(foldedItems()).toEqual([
      "On-Call Duty Policies",
      "Episode Owners",
      "Episode Role Assignments",
      "Reopen recently resolved episodes",
    ]);
    expect(foldedMore()).toBe("7 more");
    expect(foldedChips()).toEqual([]);
    // No switch that adds steps any more, and nothing to settle.
    expect(
      within(dialog()).queryByText("Show advanced settings"),
    ).not.toBeInTheDocument();
    expect(moreFieldsSummary()).toBeNull();
    // The action is on the last step only: a plain Next here.
    expect(querySubmitButton()).not.toBeInTheDocument();
    expect(nextButton()).toHaveTextContent("Next");

    await goToStep("Which Incidents");
    expect(submitButton()).toHaveTextContent("Create Incident Grouping Rule");
    // No conditions: the rule applies to every new incident.
    expect(screen.getByTestId("rule-criteria-empty")).toBeInTheDocument();

    await clickSubmit();
    await waitForSave();

    expect(submitted()).toEqual(
      expect.objectContaining({
        name: "Group incidents from the same monitor",
        isEnabled: true,
        groupByMonitor: true,
        groupBySeverity: false,
        groupByIncidentTitle: false,
        groupByIncidentLabels: false,
        groupByMonitorLabels: false,
        enableTimeWindow: true,
        timeWindowMinutes: 30,
      }),
    );
  });

  test("regression: the rule it creates is enabled", async () => {
    await openIncidentCreateForm();

    await goToStep("Which Incidents");
    await clickSubmit();
    await waitForSave();

    expect(submitted()["isEnabled"]).toBe(true);
  });

  test("sends none of its form-only controls, and leaves the rule's place to the server", async () => {
    await openIncidentCreateForm();

    await goToStep("Which Incidents");
    await clickSubmit();
    await waitForSave();

    for (const key of FORM_ONLY_KEYS) {
      expect(submitted()[key]).toBeUndefined();
      expect(submittedMiscData()).not.toHaveProperty(key);
    }

    expect(submitted()["priority"]).toBeUndefined();
  });

  test("picking Everything Together renames the rule and tightens its window", async () => {
    await openIncidentCreateForm();

    await pickMode("everything");

    await waitFor(() => {
      expect(nameInput()).toHaveValue("Group incidents that happen together");
    });
    expect(minutesInput("time-window-setting")).toHaveValue(10);

    await goToStep("Which Incidents");
    await clickSubmit();
    await waitForSave();

    expect(submitted()).toEqual(
      expect.objectContaining({
        name: "Group incidents that happen together",
        groupByMonitor: false,
        groupBySeverity: false,
        groupByIncidentTitle: false,
        groupByIncidentLabels: false,
        groupByMonitorLabels: false,
        enableTimeWindow: true,
        timeWindowMinutes: 10,
      }),
    );
  });

  test("a name somebody typed survives picking another answer", async () => {
    await openIncidentCreateForm();

    fireEvent.change(nameInput(), { target: { value: "Payments storms" } });
    await pickMode("severity");

    await waitFor(() => {
      expect(screen.getByTestId("card-select-option-severity")).toHaveAttribute(
        "aria-checked",
        "true",
      );
    });
    expect(nameInput()).toHaveValue("Payments storms");

    await goToStep("Which Incidents");
    await clickSubmit();
    await waitForSave();

    expect(submitted()["name"]).toBe("Payments storms");
    expect(submitted()["groupBySeverity"]).toBe(true);
    expect(submitted()["groupByMonitor"]).toBe(false);
  });

  test("Custom opens the Group By switches, starting from the answer before it", async () => {
    await openIncidentCreateForm();

    await pickMode("custom");

    await waitFor(() => {
      expect(stepTitles()).toEqual(["Grouping", "Group By", "Which Incidents"]);
    });

    await goToStep("Group By");

    const monitor: HTMLElement = within(dialog()).getByRole("checkbox", {
      name: "Group By Monitor",
    });
    const severity: HTMLElement = within(dialog()).getByRole("checkbox", {
      name: "Group By Incident Severity",
    });

    expect(monitor).toBeChecked();
    expect(severity).not.toBeChecked();

    await act(async (): Promise<void> => {
      fireEvent.click(severity);
    });

    await goToStep("Which Incidents");
    await clickSubmit();
    await waitForSave();

    expect(submitted()).toEqual(
      expect.objectContaining({
        groupByMonitor: true,
        groupBySeverity: true,
        groupByIncidentTitle: false,
        groupByIncidentLabels: false,
        groupByMonitorLabels: false,
      }),
    );
  });

  test("leaving Custom for a named answer puts the Group By step away again", async () => {
    await openIncidentCreateForm();

    await pickMode("custom");
    await waitFor(() => {
      expect(stepTitles()).toContain("Group By");
    });

    await pickMode("title");
    await waitFor(() => {
      expect(stepTitles()).toEqual(["Grouping", "Which Incidents"]);
    });
  });

  test("switching the time window off keeps grouping until the episode is resolved", async () => {
    await openIncidentCreateForm();

    await act(async (): Promise<void> => {
      fireEvent.click(
        switchNamed("Only group incidents that arrive close together"),
      );
    });

    expect(
      screen.queryByTestId("time-window-setting-minutes-row"),
    ).not.toBeInTheDocument();

    await goToStep("Which Incidents");
    await clickSubmit();
    await waitForSave();

    expect(submitted()["enableTimeWindow"]).toBe(false);
    // Kept, so switching it back on later starts where it was.
    expect(submitted()["timeWindowMinutes"]).toBe(30);
  });

  test("a time window with no usable minutes stops the form on the Grouping step", async () => {
    await openIncidentCreateForm();

    fireEvent.change(minutesInput("time-window-setting"), {
      target: { value: "" },
    });

    await clickNext();

    await waitFor(() => {
      expect(screen.getByTestId("time-window-setting-error")).toHaveTextContent(
        "Enter a whole number of minutes between 1 and 525600.",
      );
    });
    expect(activeStep()).toBe("Grouping");
    expect(createOrUpdateMock).not.toHaveBeenCalled();

    fireEvent.change(minutesInput("time-window-setting"), {
      target: { value: "15" },
    });

    await goToStep("Which Incidents");
    await clickSubmit();
    await waitForSave();

    expect(submitted()["timeWindowMinutes"]).toBe(15);
  });

  test("a rule needs a name", async () => {
    await openIncidentCreateForm();

    fireEvent.change(nameInput(), { target: { value: "" } });
    await clickNext();

    await waitFor(() => {
      expect(
        within(dialog()).getByText("Name is required."),
      ).toBeInTheDocument();
    });
    expect(activeStep()).toBe("Grouping");
  });

  test("More fields holds paging, owners, the episode lifecycle and the details, and opening it adds no step", async () => {
    await openIncidentCreateForm();

    await openMoreFields();

    // Still two questions: Create is one Next away.
    expect(stepTitles()).toEqual(["Grouping", "Which Incidents"]);
    expect(activeStep()).toBe("Grouping");
    // Open, the header lists nothing: the fields say it themselves.
    expect(foldedItems()).toEqual([]);

    // Three small headings: who is paged and owns, lifecycle, the details.
    expect(moreFieldsHeadings()).toEqual([
      "On-Call & Ownership",
      "Episode Lifecycle",
      "Details",
    ]);

    expect(
      within(dialog()).getByRole("button", { name: "Add owner" }),
    ).toBeVisible();
    for (const name of [
      "Reopen recently resolved episodes",
      "Wait before resolving an episode",
      "Resolve quiet episodes",
      "Show Episodes on Status Page",
    ]) {
      expect(switchNamed(name)).toHaveAttribute("aria-checked", "false");
    }
    expect(
      within(dialog()).getByPlaceholderText(
        "Groups all critical incidents from production services",
      ),
    ).toBeVisible();

    await act(async (): Promise<void> => {
      fireEvent.click(switchNamed("Reopen recently resolved episodes"));
    });
    expect(minutesInput("reopen-window-setting")).toHaveValue(30);

    await act(async (): Promise<void> => {
      fireEvent.click(switchNamed("Resolve quiet episodes"));
    });
    fireEvent.change(minutesInput("inactivity-timeout-setting"), {
      target: { value: "240" },
    });

    // Folded again, the header says what is now set, in plain words.
    await foldMoreFields();
    expect(foldedChips()).toEqual([
      "Reopen recently resolved episodes: 30 minutes",
      "Resolve quiet episodes: 4 hours",
    ]);
    expect(stepTitles()).toEqual(["Grouping", "Which Incidents"]);

    await goToStep("Which Incidents");
    expect(submitButton()).toHaveTextContent("Create Incident Grouping Rule");

    await clickSubmit();
    await waitForSave();

    expect(submitted()).toEqual(
      expect.objectContaining({
        enableReopenWindow: true,
        reopenWindowMinutes: 30,
        enableInactivityTimeout: true,
        inactivityTimeoutMinutes: 240,
      }),
    );
    expect(submitted()["enableResolveDelay"]).not.toBe(true);
  });

  test("a setting switched back off loses its chip, and is saved off", async () => {
    await openIncidentCreateForm();

    await openMoreFields();
    await act(async (): Promise<void> => {
      fireEvent.click(switchNamed("Wait before resolving an episode"));
    });
    expect(minutesInput("resolve-delay-setting")).toHaveValue(5);

    await foldMoreFields();
    expect(foldedChips()).toEqual([
      "Wait before resolving an episode: 5 minutes",
    ]);

    await openMoreFields();
    await act(async (): Promise<void> => {
      fireEvent.click(switchNamed("Wait before resolving an episode"));
    });
    await foldMoreFields();
    expect(foldedChips()).toEqual([]);

    await goToStep("Which Incidents");
    await clickSubmit();
    await waitForSave();

    expect(submitted()["enableResolveDelay"]).toBe(false);
    // Kept, so switching it back on later starts where it was.
    expect(submitted()["resolveDelayMinutes"]).toBe(5);
  });

  test("a lifecycle setting with no usable minutes opens the fold and stops the form on Grouping", async () => {
    await openIncidentCreateForm();

    await openMoreFields();
    await act(async (): Promise<void> => {
      fireEvent.click(switchNamed("Wait before resolving an episode"));
    });
    fireEvent.change(minutesInput("resolve-delay-setting"), {
      target: { value: "" },
    });

    // Folded, with minutes that are not a number yet: a chip, no minutes.
    await foldMoreFields();
    expect(foldedChips()).toEqual(["Wait before resolving an episode"]);

    await clickNext();

    await waitFor(() => {
      expect(moreFieldsHeader()).toHaveAttribute("aria-expanded", "true");
    });
    await waitFor(() => {
      expect(
        screen.getByTestId("resolve-delay-setting-error"),
      ).toHaveTextContent(
        "Enter a whole number of minutes between 1 and 525600.",
      );
    });
    expect(activeStep()).toBe("Grouping");
    expect(createOrUpdateMock).not.toHaveBeenCalled();

    fireEvent.change(minutesInput("resolve-delay-setting"), {
      target: { value: "15" },
    });

    await goToStep("Which Incidents");
    await clickSubmit();
    await waitForSave();

    expect(submitted()).toEqual(
      expect.objectContaining({
        enableResolveDelay: true,
        resolveDelayMinutes: 15,
      }),
    );
  });

  test("left folded, More fields saves no lifecycle setting, owner or policy", async () => {
    await openIncidentCreateForm();

    await goToStep("Which Incidents");
    await clickSubmit();
    await waitForSave();

    expect(submitted()["enableReopenWindow"]).not.toBe(true);
    expect(submitted()["enableResolveDelay"]).not.toBe(true);
    expect(submitted()["enableInactivityTimeout"]).not.toBe(true);
    expect(submitted()["showEpisodeOnStatusPage"]).not.toBe(true);

    for (const list of [
      "onCallDutyPolicies",
      "episodeOwnerUsers",
      "episodeOwnerTeams",
      "episodeLabels",
    ]) {
      expect(
        ((submitted()[list] as Array<unknown> | undefined) || []).length,
      ).toBe(0);
    }
  });

  test("the alert form asks about alerts and saves the alert switches", async () => {
    await openForm<AlertGroupingRule>({
      page: AlertGroupingRulesPage,
      modelType: AlertGroupingRule,
      singularName: "Alert Grouping Rule",
      formType: FormType.Create,
    });

    expect(stepTitles()).toEqual(["Grouping", "Which Alerts"]);
    expect(
      within(dialog()).getByPlaceholderText(
        "Group alerts from the same monitor",
      ),
    ).toHaveValue("Group alerts from the same monitor");

    // The same fold, without status pages or episode roles.
    expect(moreFieldsHeader()).toHaveAttribute("aria-expanded", "false");
    expect(foldedItems()).toEqual([
      "On-Call Duty Policies",
      "Episode Owners",
      "Reopen recently resolved episodes",
      "Wait before resolving an episode",
    ]);
    expect(foldedMore()).toBe("5 more");

    await openMoreFields();
    expect(moreFieldsHeadings()).toEqual([
      "On-Call & Ownership",
      "Episode Lifecycle",
      "Details",
    ]);
    expect(
      within(dialog()).queryByText("Show Episodes on Status Page"),
    ).not.toBeInTheDocument();
    expect(
      within(dialog()).queryByText("Episode Role Assignments"),
    ).not.toBeInTheDocument();
    expect(
      within(dialog()).getByPlaceholderText(
        "Groups all critical alerts from production services",
      ),
    ).toBeVisible();
    await foldMoreFields();

    await pickMode("title");
    await waitFor(() => {
      expect(
        within(dialog()).getByPlaceholderText(
          "Group alerts from the same monitor",
        ),
      ).toHaveValue("Group repeats of the same alert");
    });

    await goToStep("Which Alerts");
    await clickSubmit();
    await waitForSave();

    expect(submitted()).toEqual(
      expect.objectContaining({
        name: "Group repeats of the same alert",
        isEnabled: true,
        groupByAlertTitle: true,
        groupByMonitor: false,
        timeWindowMinutes: 60,
      }),
    );
    expect(submitted()["groupByIncidentTitle"]).toBeUndefined();
  });
});

describe("editing an existing grouping rule", () => {
  beforeEach(() => {
    cleanup();
    getItemMock.mockReset();
    createOrUpdateMock.mockReset();
    createOrUpdateMock.mockResolvedValue({ data: {} });
  });

  afterEach(() => {
    cleanup();
  });

  function existingRule(
    values: Partial<Record<keyof IncidentGroupingRule, unknown>>,
  ): IncidentGroupingRule {
    const rule: IncidentGroupingRule = new IncidentGroupingRule();
    rule.id = RULE_ID;
    rule.name = "Payments storms";
    rule.isEnabled = true;
    rule.groupByMonitor = false;
    rule.groupBySeverity = false;
    rule.groupByIncidentTitle = false;
    rule.groupByIncidentLabels = false;
    rule.groupByMonitorLabels = false;
    rule.enableTimeWindow = false;
    rule.timeWindowMinutes = 60;
    rule.enableReopenWindow = false;
    rule.reopenWindowMinutes = 0;
    rule.enableResolveDelay = false;
    rule.resolveDelayMinutes = 0;
    rule.enableInactivityTimeout = false;
    rule.inactivityTimeoutMinutes = 60;
    Object.assign(rule, values);
    return rule;
  }

  async function openIncidentEditForm(
    rule: IncidentGroupingRule,
  ): Promise<void> {
    getItemMock.mockResolvedValue(rule);

    await openForm<IncidentGroupingRule>({
      page: IncidentGroupingRulesPage,
      modelType: IncidentGroupingRule,
      singularName: "Incident Grouping Rule",
      formType: FormType.Update,
    });

    await waitFor(
      () => {
        expect(nameInput()).toHaveValue("Payments storms");
      },
      { timeout: WAIT_TIMEOUT },
    );
  }

  test("a simple rule opens on its answer, one step from Save Changes", async () => {
    await openIncidentEditForm(
      existingRule({
        groupByIncidentTitle: true,
        enableTimeWindow: true,
        timeWindowMinutes: 60,
      }),
    );

    expect(screen.getByTestId("card-select-option-title")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(stepTitles()).toEqual(["Grouping", "Which Incidents"]);
    expect(minutesInput("time-window-setting")).toHaveValue(60);
    // Nothing beyond grouping: More fields is folded, with no chip.
    expect(moreFieldsHeader()).toHaveAttribute("aria-expanded", "false");
    expect(foldedChips()).toEqual([]);
    // Save Changes is on Which Incidents, the last step: Next here.
    expect(querySubmitButton()).not.toBeInTheDocument();
    expect(nextButton()).toHaveTextContent("Next");
  });

  test("a custom mix with lifecycle and paging opens with More fields folded, a chip for each", async () => {
    const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
    policy._id = POLICY_ID;

    await openIncidentEditForm(
      existingRule({
        groupByMonitor: true,
        groupBySeverity: true,
        enableReopenWindow: true,
        reopenWindowMinutes: 45,
        onCallDutyPolicies: [policy],
      }),
    );

    expect(screen.getByTestId("card-select-option-custom")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(stepTitles()).toEqual(["Grouping", "Group By", "Which Incidents"]);
    expect(
      switchNamed("Only group incidents that arrive close together"),
    ).toHaveAttribute("aria-checked", "false");

    /*
     * Folded on an edit form too, and nothing the rule does is hidden: each
     * setting it uses is a chip that says what it is set to, and every set
     * one is listed whatever the order.
     */
    await waitFor(() => {
      expect(foldedChips()).toEqual([
        "On-Call Duty Policies: 1",
        "Reopen recently resolved episodes: 45 minutes",
      ]);
    });
    expect(moreFieldsHeader()).toHaveAttribute("aria-expanded", "false");
    expect(foldedItems()).toEqual([
      "On-Call Duty Policies: 1",
      "Episode Owners",
      "Episode Role Assignments",
      "Reopen recently resolved episodes: 45 minutes",
      "Wait before resolving an episode",
      "Resolve quiet episodes",
    ]);
    expect(foldedMore()).toBe("5 more");

    // Opened, the settings are there as the rule has them.
    await openMoreFields();
    expect(switchNamed("Reopen recently resolved episodes")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(minutesInput("reopen-window-setting")).toHaveValue(45);
  });

  test("every setting a rule uses is named on the folded header", async () => {
    const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
    policy._id = POLICY_ID;

    await openIncidentEditForm(
      existingRule({
        groupByMonitor: true,
        enableReopenWindow: true,
        reopenWindowMinutes: 1440,
        enableResolveDelay: true,
        resolveDelayMinutes: 1,
        enableInactivityTimeout: true,
        inactivityTimeoutMinutes: 120,
        description: "Production payments",
        episodeTitleTemplate: "{{monitorName}} storm",
        episodeDescriptionTemplate: "Started by {{incidentTitle}}",
        showEpisodeOnStatusPage: true,
        onCallDutyPolicies: [policy],
        episodeMemberRoleAssignments: [
          {
            userId: "0000000e-0000-4000-8000-000000000001",
            incidentRoleId: "0000000f-0000-4000-8000-000000000001",
          },
        ],
      }),
    );

    await waitFor(() => {
      expect(foldedChips()).toEqual([
        "On-Call Duty Policies: 1",
        "Episode Role Assignments: 1",
        "Reopen recently resolved episodes: 1 day",
        "Wait before resolving an episode: 1 minute",
        "Resolve quiet episodes: 2 hours",
        "Description",
        "Episode Title Template: {{monitorName}} storm",
        "Episode Description Template",
        "Show Episodes on Status Page: On",
      ]);
    });
    // The two left unset are named too: nothing is counted away.
    expect(foldedItems()).toEqual([
      "On-Call Duty Policies: 1",
      "Episode Owners",
      "Episode Role Assignments: 1",
      "Reopen recently resolved episodes: 1 day",
      "Wait before resolving an episode: 1 minute",
      "Resolve quiet episodes: 2 hours",
      "Description",
      "Episode Title Template: {{monitorName}} storm",
      "Episode Description Template",
      "Show Episodes on Status Page: On",
      "Episode Labels",
    ]);
    expect(foldedMore()).toBeNull();
    expect(moreFieldsHeader()).toHaveAttribute("aria-expanded", "false");
  });

  test("saving an existing rule untouched writes back exactly what it had", async () => {
    const policy: OnCallDutyPolicy = new OnCallDutyPolicy();
    policy._id = POLICY_ID;

    await openIncidentEditForm(
      existingRule({
        isEnabled: false,
        groupByMonitor: true,
        groupBySeverity: true,
        groupByMonitorLabels: true,
        enableTimeWindow: false,
        timeWindowMinutes: 45,
        enableReopenWindow: true,
        reopenWindowMinutes: 15,
        enableResolveDelay: true,
        resolveDelayMinutes: 5,
        enableInactivityTimeout: false,
        inactivityTimeoutMinutes: 90,
        description: "Production payments",
        episodeTitleTemplate: "{{monitorName}} storm",
        showEpisodeOnStatusPage: true,
        onCallDutyPolicies: [policy],
      }),
    );

    await saveFromTheLastStep();
    await waitForSave();

    expect(submitted()).toEqual(
      expect.objectContaining({
        _id: RULE_ID.toString(),
        name: "Payments storms",
        isEnabled: false,
        groupByMonitor: true,
        groupBySeverity: true,
        groupByIncidentTitle: false,
        groupByIncidentLabels: false,
        groupByMonitorLabels: true,
        enableTimeWindow: false,
        timeWindowMinutes: 45,
        enableReopenWindow: true,
        reopenWindowMinutes: 15,
        enableResolveDelay: true,
        resolveDelayMinutes: 5,
        enableInactivityTimeout: false,
        inactivityTimeoutMinutes: 90,
        description: "Production payments",
        episodeTitleTemplate: "{{monitorName}} storm",
        showEpisodeOnStatusPage: true,
      }),
    );

    const policies: Array<{ _id?: string }> = submitted()[
      "onCallDutyPolicies"
    ] as Array<{ _id?: string }>;
    expect(
      policies.map((item: { _id?: string }) => {
        return item._id;
      }),
    ).toEqual([POLICY_ID]);

    for (const key of FORM_ONLY_KEYS) {
      expect(submitted()[key]).toBeUndefined();
    }
  });

  test("regression: a disabled rule stays disabled - Enabled defaults on for new rules only", async () => {
    await openIncidentEditForm(existingRule({ isEnabled: false }));

    expect(switchNamed("Enabled")).toHaveAttribute("aria-checked", "false");

    await saveFromTheLastStep();
    await waitForSave();

    expect(submitted()["isEnabled"]).toBe(false);
  });

  test("changing the answer of an existing rule rewrites its switches, and only then", async () => {
    await openIncidentEditForm(
      existingRule({
        groupByMonitor: true,
        enableTimeWindow: true,
        timeWindowMinutes: 30,
      }),
    );

    await pickMode("severity");
    await saveFromTheLastStep();
    await waitForSave();

    expect(submitted()).toEqual(
      expect.objectContaining({
        // Somebody's own name stays theirs.
        name: "Payments storms",
        groupByMonitor: false,
        groupBySeverity: true,
        // Monitor's half hour moves with the answer only when untouched.
        timeWindowMinutes: 30,
      }),
    );
  });

  test("a setting under More fields can be turned on for a rule that had none", async () => {
    await openIncidentEditForm(existingRule({ groupByMonitor: true }));

    expect(foldedChips()).toEqual([]);
    await openMoreFields();

    await act(async (): Promise<void> => {
      fireEvent.click(switchNamed("Wait before resolving an episode"));
    });
    expect(minutesInput("resolve-delay-setting")).toHaveValue(5);

    await saveFromTheLastStep();
    await waitForSave();

    expect(submitted()).toEqual(
      expect.objectContaining({
        enableResolveDelay: true,
        resolveDelayMinutes: 5,
        groupByMonitor: true,
      }),
    );
  });

  test("a rule saved by the old form with switches on and no minutes opens as the engines read it, and saves untouched", async () => {
    /*
     * The old form saved 0 when a switch was ticked and its minutes left
     * empty. The engines group such a time window within their fallback
     * hour, and do nothing for a reopen window, resolve delay or inactivity
     * timeout of 0 - so that is what the form shows, and it saves the rule
     * back exactly as it was rather than refusing it.
     */
    await openIncidentEditForm(
      existingRule({
        groupByMonitor: true,
        enableTimeWindow: true,
        timeWindowMinutes: 0,
        enableReopenWindow: true,
        reopenWindowMinutes: 0,
        enableResolveDelay: true,
        resolveDelayMinutes: 0,
        enableInactivityTimeout: true,
        inactivityTimeoutMinutes: 0,
      }),
    );

    expect(
      switchNamed("Only group incidents that arrive close together"),
    ).toHaveAttribute("aria-checked", "true");
    expect(minutesInput("time-window-setting")).toHaveValue(60);
    // The engines act on none of the three: no chip says they are on.
    expect(foldedChips()).toEqual([]);

    await openMoreFields();

    for (const name of [
      "Reopen recently resolved episodes",
      "Wait before resolving an episode",
      "Resolve quiet episodes",
    ]) {
      expect(switchNamed(name)).toHaveAttribute("aria-checked", "false");
    }

    await saveFromTheLastStep();
    await waitForSave();

    expect(submitted()).toEqual(
      expect.objectContaining({
        enableTimeWindow: true,
        timeWindowMinutes: 0,
        enableReopenWindow: true,
        reopenWindowMinutes: 0,
        enableResolveDelay: true,
        resolveDelayMinutes: 0,
        enableInactivityTimeout: true,
        inactivityTimeoutMinutes: 0,
      }),
    );
  });

  test("turning on a lifecycle setting that was saved with 0 minutes starts it from its default", async () => {
    await openIncidentEditForm(
      existingRule({
        groupByMonitor: true,
        enableReopenWindow: true,
        reopenWindowMinutes: 0,
      }),
    );

    expect(foldedChips()).toEqual([]);
    await openMoreFields();

    await act(async (): Promise<void> => {
      fireEvent.click(switchNamed("Reopen recently resolved episodes"));
    });
    expect(minutesInput("reopen-window-setting")).toHaveValue(30);

    await saveFromTheLastStep();
    await waitForSave();

    expect(submitted()).toEqual(
      expect.objectContaining({
        enableReopenWindow: true,
        reopenWindowMinutes: 30,
      }),
    );
  });
});

/*
 * Who owns the episodes a rule opens. More fields asks, under On-Call &
 * Ownership, with one people picker - Episode Owners - saved to the rule's
 * episodeOwnerUsers and episodeOwnerTeams, which the engines make owners of
 * every episode the rule opens. It replaced "Default Assign To Team" and "Default Assign To
 * User", which filled an assignee no page ever showed. A rule saved with
 * that pair gets a line under the owners that names it, with Add as owners
 * and Remove; either one clears the pair when the rule is saved.
 *
 * A small directory answers the picker's and the line's lookups the way
 * the API filters them: two people and two teams in the project.
 */
describe("who owns the episodes a grouping rule opens", () => {
  const PROJECT_ID: string = "33333333-3333-4333-8333-333333333333";
  const ADA: string = "0000000e-0000-4000-8000-000000000001";
  const BOB: string = "0000000e-0000-4000-8000-000000000002";
  const GONE_USER: string = "0000000e-0000-4000-8000-0000000000ff";
  const PLATFORM: string = "0000000b-0000-4000-8000-000000000001";
  const DATABASE: string = "0000000b-0000-4000-8000-000000000002";
  const GONE_TEAM: string = "0000000b-0000-4000-8000-0000000000ff";

  function directoryUser(id: string, name: string, email: string): User {
    const user: User = new User();
    user._id = id;
    user.name = new Name(name);
    user.email = new Email(email);
    return user;
  }

  function directoryTeam(id: string, name: string): Team {
    const team: Team = new Team();
    team._id = id;
    team.name = name;
    return team;
  }

  const USERS: Array<User> = [
    directoryUser(ADA, "Ada Lovelace", "ada@example.com"),
    directoryUser(BOB, "Bob Stone", "bob@example.com"),
  ];

  const TEAMS: Array<Team> = [
    directoryTeam(DATABASE, "Database"),
    directoryTeam(PLATFORM, "Platform"),
  ];

  function serveDirectory(request: any): Promise<unknown> {
    const query: any = request.query || {};
    let rows: Array<unknown> = [];

    if (request.modelType === TeamMember) {
      rows = USERS.filter((user: User): boolean => {
        return (
          !(query.userId instanceof Includes) ||
          (query.userId.values as Array<string>).includes(user._id as string)
        );
      }).map((user: User): TeamMember => {
        const member: TeamMember = new TeamMember();
        member.user = user;
        return member;
      });
    }

    if (request.modelType === Team) {
      rows = TEAMS.filter((team: Team): boolean => {
        return (
          !(query._id instanceof Includes) ||
          (query._id.values as Array<string>).includes(team._id as string)
        );
      });
    }

    return Promise.resolve({
      data: rows,
      count: rows.length,
      skip: 0,
      limit: rows.length,
    });
  }

  beforeEach(() => {
    cleanup();
    getItemMock.mockReset();
    createOrUpdateMock.mockReset();
    createOrUpdateMock.mockResolvedValue({ data: {} });
    getListMock.mockImplementation(serveDirectory);
    window.history.replaceState(
      {},
      "",
      `/dashboard/${PROJECT_ID}/incidents/settings/grouping-rules`,
    );
  });

  afterEach(() => {
    cleanup();
    getListMock.mockImplementation(listNothing);
    window.history.replaceState({}, "", "/");
  });

  function readText(element: HTMLElement): string {
    const copy: HTMLElement = element.cloneNode(true) as HTMLElement;

    copy.querySelectorAll('[aria-hidden="true"]').forEach((hidden: Element) => {
      hidden.remove();
    });

    return copy.textContent || "";
  }

  function chipNamesIn(container: HTMLElement): Array<string> {
    return within(container)
      .queryAllByTestId("people-chip")
      .map((chip: HTMLElement): string => {
        return readText(chip);
      });
  }

  function ownersPicker(): HTMLElement {
    const button: HTMLElement = within(dialog()).getByRole("button", {
      name: "Add owner",
    });

    return button.closest('[role="group"]') as HTMLElement;
  }

  /*
   * Opens More fields on the Grouping step, as a person would, to the
   * On-Call & Ownership heading.
   */
  async function goToOnCallAndOwnership(): Promise<void> {
    expect(activeStep()).toBe("Grouping");
    await openMoreFields();
    expect(moreFieldsHeadings()[0]).toBe("On-Call & Ownership");
  }

  // Opens the picker's list, picks each name in turn, and closes it again.
  async function pickOwners(names: Array<string>): Promise<void> {
    await act(async (): Promise<void> => {
      fireEvent.click(
        within(dialog()).getByRole("button", { name: "Add owner" }),
      );
    });

    const list: HTMLElement = await screen.findByRole("dialog", {
      name: "Add owner",
    });

    await within(list).findAllByRole("option");

    for (const name of names) {
      const option: HTMLElement | undefined = within(list)
        .getAllByRole("option")
        .find((candidate: HTMLElement): boolean => {
          return readText(candidate).startsWith(name);
        });

      if (!option) {
        throw new Error(`No option named ${name}`);
      }

      await act(async (): Promise<void> => {
        fireEvent.click(option);
      });
    }

    await act(async (): Promise<void> => {
      fireEvent.mouseDown(document.body);
    });

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Add owner" }),
      ).not.toBeInTheDocument();
    });
  }

  function idsOf(value: unknown): Array<string> {
    return ((value as Array<{ _id?: string }>) || []).map(
      (item: { _id?: string }): string => {
        return item._id || "";
      },
    );
  }

  function existingRule(
    values: Partial<Record<keyof IncidentGroupingRule, unknown>>,
  ): IncidentGroupingRule {
    const rule: IncidentGroupingRule = new IncidentGroupingRule();
    rule.id = RULE_ID;
    rule.name = "Payments storms";
    rule.isEnabled = true;
    rule.groupByMonitor = true;
    rule.enableTimeWindow = true;
    rule.timeWindowMinutes = 30;
    Object.assign(rule, values);
    return rule;
  }

  async function openIncidentEditForm(
    rule: IncidentGroupingRule,
  ): Promise<void> {
    getItemMock.mockResolvedValue(rule);

    await openForm<IncidentGroupingRule>({
      page: IncidentGroupingRulesPage,
      modelType: IncidentGroupingRule,
      singularName: "Incident Grouping Rule",
      formType: FormType.Update,
    });

    await waitFor(
      () => {
        expect(nameInput()).toHaveValue("Payments storms");
      },
      { timeout: WAIT_TIMEOUT },
    );
  }

  test("a new rule's More fields ask for Episode Owners with one picker, and no default assignee", async () => {
    await openIncidentCreateForm();

    await goToOnCallAndOwnership();

    expect(
      within(dialog()).getByText(
        "Added as owners of every episode this rule opens, and notified like any other owner.",
      ),
    ).toBeInTheDocument();
    expect(ownersPicker()).toHaveAccessibleName(/Episode Owners/);
    expect(chipNamesIn(ownersPicker())).toEqual([]);

    for (const retired of [
      "Default Assign To Team",
      "Default Assign To User",
      "Default Assignees",
      "The team and user new episodes are assigned to by default. Both are optional.",
      "Select Team",
      "Select User",
    ]) {
      expect(within(dialog()).queryByText(retired)).not.toBeInTheDocument();
    }

    // A new rule has no old assignee to speak of.
    expect(
      screen.queryByTestId("legacy-default-assignee"),
    ).not.toBeInTheDocument();
  });

  test("owners picked on a new rule are saved as the rule's episode owners", async () => {
    await openIncidentCreateForm();

    await goToOnCallAndOwnership();
    await pickOwners(["Ada Lovelace", "Platform"]);

    expect(chipNamesIn(ownersPicker())).toEqual([
      "Ada Lovelace",
      "PlatformTeam",
    ]);

    // Folded, the header counts them.
    await foldMoreFields();
    expect(foldedChips()).toEqual(["Episode Owners: 2"]);

    await walkOnAndSubmit();
    await waitForSave();

    expect(idsOf(submitted()["episodeOwnerUsers"])).toEqual([ADA]);
    expect(idsOf(submitted()["episodeOwnerTeams"])).toEqual([PLATFORM]);
    // Columns of the rule, not misc data, and never the old pair.
    expect(submittedMiscData()).not.toHaveProperty("episodeOwnerUsers");
    expect(submittedMiscData()).not.toHaveProperty("episodeOwnerTeams");
    expect(submitted()["defaultAssignToUserId"]).toBeUndefined();
    expect(submitted()["defaultAssignToTeamId"]).toBeUndefined();
    expect(submittedMiscData()).not.toHaveProperty("episodeOwners");
    expect(submittedMiscData()).not.toHaveProperty("legacyDefaultAssignee");
  });

  test("a rule with episode owners opens with them showing, and saves them back untouched", async () => {
    await openIncidentEditForm(
      existingRule({
        episodeOwnerUsers: [USERS[1]!],
        episodeOwnerTeams: [TEAMS[0]!],
      }),
    );

    // Folded, the header says the rule has two owners - and nothing more.
    await waitFor(() => {
      expect(foldedChips()).toEqual(["Episode Owners: 2"]);
    });
    expect(moreFieldsSummary()).toBeNull();

    await goToOnCallAndOwnership();

    await waitFor(() => {
      expect(chipNamesIn(ownersPicker())).toEqual([
        "Bob Stone",
        "DatabaseTeam",
      ]);
    });
    expect(
      screen.queryByTestId("legacy-default-assignee"),
    ).not.toBeInTheDocument();

    await saveFromTheLastStep();
    await waitForSave();

    expect(idsOf(submitted()["episodeOwnerUsers"])).toEqual([BOB]);
    expect(idsOf(submitted()["episodeOwnerTeams"])).toEqual([DATABASE]);
  });

  test("a rule with an old default assignee names it under the owners, and saved untouched keeps it", async () => {
    await openIncidentEditForm(
      existingRule({
        defaultAssignToUserId: new ObjectID(BOB),
        defaultAssignToTeamId: new ObjectID(DATABASE),
      }),
    );

    /*
     * Nothing a rule does is hidden from the person editing it: folded, the
     * header names the old default assignee as a chip, and says under its
     * names where to settle it - the old form's last step, where Save
     * Changes was, used to put the line in front of whoever saved.
     */
    await waitFor(() => {
      expect(foldedChips()).toEqual(["Default assignee"]);
    });
    expect(moreFieldsSummary()).toBe(
      "This rule still has a default assignee set by an older version of this form. Open this section to add them as owners or remove it.",
    );
    expect(moreFieldsHeader()).toHaveAccessibleDescription(
      expect.stringContaining("Open this section to add them as owners"),
    );

    await goToOnCallAndOwnership();

    const line: HTMLElement = await screen.findByTestId(
      "legacy-default-assignee",
    );

    expect(line).toHaveAccessibleName("Default assignee");
    expect(line).toHaveAccessibleDescription(
      "Set by an older version of this form and not shown anywhere. Add them as owners to make them responsible for the episodes this rule opens.",
    );

    await waitFor(() => {
      expect(chipNamesIn(line)).toEqual(["Bob Stone", "DatabaseTeam"]);
    });

    // Under the owners picker, which is still empty.
    expect(
      ownersPicker().compareDocumentPosition(line) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(chipNamesIn(ownersPicker())).toEqual([]);

    expect(
      within(line).getByRole("button", { name: "Add as owners" }),
    ).toBeEnabled();
    expect(within(line).getByRole("button", { name: "Remove" })).toBeEnabled();

    await saveFromTheLastStep();
    await waitForSave();

    // Nobody decided anything: the rule keeps what it had.
    expect(String(submitted()["defaultAssignToUserId"])).toBe(BOB);
    expect(String(submitted()["defaultAssignToTeamId"])).toBe(DATABASE);
    expect(idsOf(submitted()["episodeOwnerUsers"])).toEqual([]);
  });

  test("Add as owners moves the old default assignee into Episode Owners, and saving clears the old pair", async () => {
    await openIncidentEditForm(
      existingRule({
        defaultAssignToUserId: new ObjectID(BOB),
        defaultAssignToTeamId: new ObjectID(DATABASE),
        episodeOwnerUsers: [USERS[0]!],
      }),
    );

    await goToOnCallAndOwnership();

    const line: HTMLElement = await screen.findByTestId(
      "legacy-default-assignee",
    );

    await waitFor(() => {
      expect(
        within(line).getByRole("button", { name: "Add as owners" }),
      ).toBeEnabled();
    });

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(line).getByRole("button", { name: "Add as owners" }),
      );
    });

    await waitFor(() => {
      expect(
        screen.queryByTestId("legacy-default-assignee"),
      ).not.toBeInTheDocument();
    });

    await waitFor(() => {
      expect(chipNamesIn(ownersPicker())).toEqual([
        "Ada Lovelace",
        "Bob Stone",
        "DatabaseTeam",
      ]);
    });

    // Settled: the header's chip for it is gone, the owners counted.
    await foldMoreFields();
    expect(foldedChips()).toEqual(["Episode Owners: 3"]);

    await saveFromTheLastStep();
    await waitForSave();

    expect(idsOf(submitted()["episodeOwnerUsers"])).toEqual([ADA, BOB]);
    expect(idsOf(submitted()["episodeOwnerTeams"])).toEqual([DATABASE]);
    expect(submitted()["defaultAssignToUserId"]).toBeNull();
    expect(submitted()["defaultAssignToTeamId"]).toBeNull();
  });

  test("Remove lets the old default assignee go without making anyone an owner", async () => {
    await openIncidentEditForm(
      existingRule({
        defaultAssignToTeamId: new ObjectID(PLATFORM),
      }),
    );

    await goToOnCallAndOwnership();

    const line: HTMLElement = await screen.findByTestId(
      "legacy-default-assignee",
    );

    await waitFor(() => {
      expect(chipNamesIn(line)).toEqual(["PlatformTeam"]);
    });

    await act(async (): Promise<void> => {
      fireEvent.click(within(line).getByRole("button", { name: "Remove" }));
    });

    await waitFor(() => {
      expect(
        screen.queryByTestId("legacy-default-assignee"),
      ).not.toBeInTheDocument();
    });
    expect(chipNamesIn(ownersPicker())).toEqual([]);

    // Settled: folded again, no chip for it and no sentence about it.
    await foldMoreFields();
    expect(foldedChips()).toEqual([]);
    expect(moreFieldsSummary()).toBeNull();

    await saveFromTheLastStep();
    await waitForSave();

    expect(submitted()["defaultAssignToTeamId"]).toBeNull();
    expect(submitted()["defaultAssignToUserId"]).toBeNull();
    expect(idsOf(submitted()["episodeOwnerTeams"])).toEqual([]);
  });

  test("someone who has left, or a deleted team, is named but cannot be made an owner", async () => {
    await openIncidentEditForm(
      existingRule({
        defaultAssignToUserId: new ObjectID(GONE_USER),
        defaultAssignToTeamId: new ObjectID(GONE_TEAM),
      }),
    );

    await goToOnCallAndOwnership();

    const line: HTMLElement = await screen.findByTestId(
      "legacy-default-assignee",
    );

    await waitFor(() => {
      expect(chipNamesIn(line)).toEqual(["Unknown user", "Deleted teamTeam"]);
    });

    expect(
      within(line).queryByRole("button", { name: "Add as owners" }),
    ).not.toBeInTheDocument();
    expect(within(line).getByRole("button", { name: "Remove" })).toBeEnabled();
  });

  test("Add as owners adds only the part of the old pair the project still has", async () => {
    await openIncidentEditForm(
      existingRule({
        defaultAssignToUserId: new ObjectID(GONE_USER),
        defaultAssignToTeamId: new ObjectID(PLATFORM),
      }),
    );

    await goToOnCallAndOwnership();

    const line: HTMLElement = await screen.findByTestId(
      "legacy-default-assignee",
    );

    await waitFor(() => {
      expect(
        within(line).getByRole("button", { name: "Add as owners" }),
      ).toBeEnabled();
    });

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(line).getByRole("button", { name: "Add as owners" }),
      );
    });

    await waitFor(() => {
      expect(chipNamesIn(ownersPicker())).toEqual(["PlatformTeam"]);
    });

    await saveFromTheLastStep();
    await waitForSave();

    expect(idsOf(submitted()["episodeOwnerTeams"])).toEqual([PLATFORM]);
    expect(idsOf(submitted()["episodeOwnerUsers"])).toEqual([]);
    expect(submitted()["defaultAssignToUserId"]).toBeNull();
    expect(submitted()["defaultAssignToTeamId"]).toBeNull();
  });

  test("the alert form asks for its episodes' owners the same way", async () => {
    await openForm<AlertGroupingRule>({
      page: AlertGroupingRulesPage,
      modelType: AlertGroupingRule,
      singularName: "Alert Grouping Rule",
      formType: FormType.Create,
    });

    await goToOnCallAndOwnership();
    await pickOwners(["Bob Stone", "Database"]);

    await walkOnAndSubmit();
    await waitForSave();

    expect(idsOf(submitted()["episodeOwnerUsers"])).toEqual([BOB]);
    expect(idsOf(submitted()["episodeOwnerTeams"])).toEqual([DATABASE]);
    expect(
      within(dialog()).queryByText("Default Assign To Team"),
    ).not.toBeInTheDocument();
  });
});
