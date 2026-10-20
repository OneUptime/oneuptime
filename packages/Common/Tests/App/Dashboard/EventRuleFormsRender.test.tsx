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
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import React, { FunctionComponent, ReactElement } from "react";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { FormType, ModelField } from "../../../UI/Components/Forms/ModelForm";
import ModelFormModal from "../../../UI/Components/ModelFormModal/ModelFormModal";
import { ComponentProps as ModelTableProps } from "../../../UI/Components/ModelTable/ModelTable";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import getJestMockFunction, { MockFunction } from "../../MockType";
import escapeRegExp from "../../../Utils/RegExpEscape";
import OneUptimeDate from "../../../Types/Date";
import OnCallRuleWhenToPage from "../../../Types/OnCallDutyPolicy/OnCallRuleWhenToPage";
import RestrictionTimes, {
  RestrictionType,
} from "../../../Types/OnCallDutyPolicy/RestrictionTimes";

/*
 * The on-call, privacy, SLA and reminder rule forms of Incidents, Alerts
 * (each with an episode tab for on-call and privacy) and Scheduled
 * Maintenance: twelve forms, drawn for real - the pages' own fields in the
 * ModelFormModal, ModelForm and BasicForm their tables open, with only the
 * table around them, the network and the permissions stubbed.
 *
 * They used to open on "Basic Info" ("Rule Info" on a reminder rule): a
 * name and a description before anyone had said what the rule was for,
 * while the label, owner and grouping rules beside them start with what the
 * rule matches. Now each walks:
 *
 *   - Match: the conditions builder, on "All incidents";
 *   - what the rule does - the policies it pages, its targets, how often
 *     and until when it reminds - with its name filled in from that and
 *     following it until somebody types their own (a privacy rule, which
 *     only makes what it matches private, is named for that), the
 *     description folded under More fields, and Enabled on the Edit form
 *     only.
 *
 * A reminder rule's "Stop Reminders When" is two plain answers where a
 * dropdown was, and a maintenance reminder rule's two settings - a dropdown
 * and a switch whose help explained two modes - are one choice of three
 * answers, written into the same two columns.
 */

configure({ asyncUtilTimeout: 15000 });

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const RULE_ID: string = "66666666-6666-4666-8666-666666666666";
const NEW_ID: string = "55555555-5555-4555-8555-555555555555";

const PLATFORM_ON_CALL: string = "0000000c-0000-4000-8000-000000000001";

interface MockTable {
  mode: "create" | "edit";
}

const mockTable: MockTable = { mode: "create" };

const createOrUpdateMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: <TBaseModel extends BaseModel>(
      props: ModelTableProps<TBaseModel>,
    ): ReactElement => {
      const singularName: string =
        props.singularName || new props.modelType().singularName || "";
      const fields: Array<ModelField<TBaseModel>> = props.formFields || [];

      if (mockTable.mode === "edit") {
        // What the real table opens from a row's Edit.
        return (
          <ModelFormModal<TBaseModel>
            title={`Edit ${singularName}`}
            modelType={props.modelType}
            modalWidth={props.createEditModalWidth}
            submitButtonText="Save Changes"
            onClose={() => {}}
            onSuccess={() => {}}
            onBeforeUpdate={props.onBeforeUpdate}
            modelIdToEdit={new ObjectID(RULE_ID)}
            formProps={{
              id: `edit-${props.modelType.name}-form`,
              name: `edit-${props.modelType.name}-form`,
              modelType: props.modelType,
              fields: fields.filter(
                (field: ModelField<TBaseModel>): boolean => {
                  return !field.doNotShowWhenEditing;
                },
              ),
              steps: props.formSteps || [],
              formType: FormType.Update,
              allowAnyStepNavigation: true,
            }}
          />
        );
      }

      // What the real table opens from its Create button.
      return (
        <ModelFormModal<TBaseModel>
          title={`Create New ${singularName}`}
          modelType={props.modelType}
          modalWidth={props.createEditModalWidth}
          initialValues={props.createInitialValues}
          submitButtonText={`Create ${singularName}`}
          onClose={() => {}}
          onSuccess={() => {}}
          onBeforeCreate={props.onBeforeCreate}
          formProps={{
            id: `create-${props.modelType.name}-form`,
            name: `create-${props.modelType.name}-form`,
            modelType: props.modelType,
            fields: fields.filter((field: ModelField<TBaseModel>): boolean => {
              return !field.doNotShowWhenCreating;
            }),
            steps: props.formSteps || [],
            formType: FormType.Create,
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
      count: async (): Promise<number> => {
        return 0;
      },
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      // The project's on-call policies: the on-call rules' picker reads them.
      getList: async (request: {
        modelType: { name: string };
        query?: Record<string, unknown>;
      }): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        type Loaded = { new (): Record<string, unknown> };

        let rows: Array<unknown> = [];

        if (request.modelType.name === "OnCallDutyPolicy") {
          const PolicyModel: Loaded = (
            jest.requireActual(
              "../../../Models/DatabaseModels/OnCallDutyPolicy",
            ) as { default: Loaded }
          ).default;

          rows = [
            ["0000000c-0000-4000-8000-000000000001", "Platform on-call"],
            ["0000000c-0000-4000-8000-000000000002", "Database on-call"],
          ].map(([id, name]: Array<string>): unknown => {
            return Object.assign(new PolicyModel(), { _id: id, name: name });
          });
        }

        return { data: rows, count: rows.length, skip: 0, limit: 50 };
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

import Route from "../../../Types/API/Route";
import IncidentOnCallRule from "../../../Models/DatabaseModels/IncidentOnCallRule";
import ScheduledMaintenanceReminderRule from "../../../Models/DatabaseModels/ScheduledMaintenanceReminderRule";
import IncidentReminderRule from "../../../Models/DatabaseModels/IncidentReminderRule";
import IncidentSlaRule from "../../../Models/DatabaseModels/IncidentSlaRule";
import ReminderStopState from "../../../Types/Reminder/ReminderStopState";
import ScheduledMaintenanceReminderStopState from "../../../Types/Reminder/ScheduledMaintenanceReminderStopState";
import { listedNames } from "../../UI/Components/FoldedSection/FoldedSectionQueries";
import RuleSettingsPageProps from "../../../../App/FeatureSet/Dashboard/src/Pages/RuleSettingsPageProps";
import IncidentOnCallRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentOnCallRules";
import AlertOnCallRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/Settings/AlertOnCallRules";
import IncidentPrivacyRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentPrivacyRules";
import AlertPrivacyRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/Settings/AlertPrivacyRules";
import IncidentSlaRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentSlaRules";
import IncidentReminderRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentReminderRules";
import AlertReminderRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/Settings/AlertReminderRules";
import ScheduledMaintenanceReminderRules from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceReminderRules";

type RulePage = FunctionComponent<RuleSettingsPageProps>;

function dialog(): HTMLElement {
  return screen.getByTestId("modal");
}

// BasicForm opens a stepped form's first step in an effect: let it run.
async function settle(): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  });
}

async function renderPage(
  Page: RulePage,
  mode: MockTable["mode"] = "create",
): Promise<UserEvent> {
  mockTable.mode = mode;

  await act(async (): Promise<void> => {
    render(
      <Page
        pageRoute={new Route(`/dashboard/${PROJECT_ID}/settings/rules`)}
        currentProject={null}
        hasPaymentMethod={true}
      />,
    );
  });

  await settle();

  return userEvent.setup({ delay: null });
}

// Opens a page's tab - the episode rules of incidents and alerts.
async function openTab(name: string): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(screen.getByRole("tab", { name: name }));
  });
  await settle();
}

function stepTitles(): Array<string> {
  const progress: HTMLElement = within(dialog()).getByRole("navigation", {
    name: "Progress",
  });

  return within(progress)
    .getAllByRole("listitem")
    .map((item: HTMLElement): string => {
      return (item.textContent || "").trim();
    });
}

async function next(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(within(dialog()).getByTestId("modal-footer-next-button"));
  });
  await settle();
}

async function submit(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(within(dialog()).getByTestId("modal-footer-submit-button"));
  });
}

function nameBox(): HTMLInputElement {
  return within(dialog()).getByRole("textbox", {
    name: "Name",
  }) as HTMLInputElement;
}

function moreFields(): HTMLElement {
  return within(dialog()).getByRole("button", { name: "More fields" });
}

// What ModelForm handed the API: the model, read by its columns.
function sentModel(): JSONObject {
  return (createOrUpdateMock.mock.calls[0]?.[0] as { model: unknown })
    .model as JSONObject;
}

function ids(value: unknown): Array<string> {
  return (Array.isArray(value) ? value : []).map((entry: unknown): string => {
    if (typeof entry === "string") {
      return entry;
    }

    const record: Record<string, unknown> = entry as Record<string, unknown>;

    return String(record["_id"] || record["id"] || record["value"] || "");
  });
}

async function pickPolicy(user: UserEvent, name: string): Promise<void> {
  await user.click(
    within(dialog()).getByRole("combobox", { name: /On-Call Duty Policies/ }),
  );
  await user.click(await screen.findByRole("option", { name: name }));
}

// A number box, found by its field title ("(Optional)" may follow it).
function numberBox(title: string): HTMLInputElement {
  return within(dialog()).getByRole("spinbutton", {
    name: new RegExp(`^${escapeRegExp(title)}`),
  }) as HTMLInputElement;
}

// The step's Match question: "Applies to", starting on all records.
function expectOpensOnMatch(allLabel: string): void {
  expect(stepTitles()[0]).toContain("Match");
  expect(within(dialog()).queryByText("Basic Info")).toBeNull();
  expect(within(dialog()).queryByText("Rule Info")).toBeNull();

  const appliesTo: HTMLElement = within(dialog()).getByRole("radiogroup", {
    name: /Applies to/,
  });
  expect(
    within(appliesTo).getByRole("radio", { name: allLabel }),
  ).toBeChecked();

  // Nothing about the rule's name, nor its action, on the first step.
  expect(within(dialog()).queryByRole("textbox", { name: "Name" })).toBeNull();
  // Next is plain; the rule is created from the last step only.
  expect(
    within(dialog()).queryByTestId("modal-footer-submit-button"),
  ).toBeNull();
}

beforeEach(() => {
  window.history.replaceState({}, "", `/dashboard/${PROJECT_ID}/settings`);
  createOrUpdateMock.mockReset().mockImplementation(((data: {
    model: BaseModel;
  }): Promise<unknown> => {
    const saved: BaseModel = data.model;
    saved._id = NEW_ID;
    return Promise.resolve({ data: saved });
  }) as never);
  getItemMock.mockReset();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

// ---- On-call rules -----------------------------------------------------------

interface OnCallCase {
  name: string;
  Page: RulePage;
  tab: string | null;
  allLabel: string;
}

const ON_CALL_CASES: Array<OnCallCase> = [
  {
    name: "Incidents > Rules > On-Call Rules",
    Page: IncidentOnCallRules as RulePage,
    tab: null,
    allLabel: "All incidents",
  },
  {
    name: "Incidents > Rules > On-Call Rules > Episode Rules",
    Page: IncidentOnCallRules as RulePage,
    tab: "Episode Rules",
    allLabel: "All incident episodes",
  },
  {
    name: "Alerts > Rules > On-Call Rules",
    Page: AlertOnCallRules as RulePage,
    tab: null,
    allLabel: "All alerts",
  },
  {
    name: "Alerts > Rules > On-Call Rules > Episode Rules",
    Page: AlertOnCallRules as RulePage,
    tab: "Episode Rules",
    allLabel: "All alert episodes",
  },
];

describe.each(ON_CALL_CASES)("$name", (page: OnCallCase) => {
  async function openForm(): Promise<UserEvent> {
    const user: UserEvent = await renderPage(page.Page);

    if (page.tab) {
      await openTab(page.tab);
    }

    await within(dialog()).findByRole("navigation", { name: "Progress" });
    return user;
  }

  test("opens on what the rule matches, then asks which policies it pages", async () => {
    await openForm();

    expect(stepTitles()).toEqual([
      expect.stringContaining("Match"),
      expect.stringContaining("On-Call Policies"),
    ]);
    expectOpensOnMatch(page.allLabel);

    await next();

    expect(
      within(dialog()).getByRole("combobox", { name: /On-Call Duty Policies/ }),
    ).toBeVisible();
    expect(nameBox()).toBeVisible();
    expect(nameBox()).toHaveValue("");
    // The description and when to page wait folded; a new rule starts on.
    expect(moreFields()).toHaveAttribute("aria-expanded", "false");
    expect(listedNames(moreFields())).toEqual(["Description", "When to Page"]);
    expect(
      within(dialog()).queryByRole("switch", { name: /Enabled/ }),
    ).toBeNull();
  });

  test("names the rule after the policies it pages, and follows the next pick", async () => {
    const user: UserEvent = await openForm();
    await next();

    await pickPolicy(user, "Platform on-call");
    await waitFor(() => {
      expect(nameBox()).toHaveValue("Page Platform on-call");
    });

    await pickPolicy(user, "Database on-call");
    await waitFor(() => {
      expect(nameBox()).toHaveValue("Page Platform on-call, Database on-call");
    });
  });

  test("never writes over a name somebody typed", async () => {
    const user: UserEvent = await openForm();
    await next();

    fireEvent.change(nameBox(), { target: { value: "Database team" } });
    await pickPolicy(user, "Database on-call");

    await settle();
    expect(nameBox()).toHaveValue("Database team");
  });

  test("creates the rule with its policies and the name filled in, nothing else asked", async () => {
    const user: UserEvent = await openForm();
    await next();

    await pickPolicy(user, "Platform on-call");
    await waitFor(() => {
      expect(nameBox()).toHaveValue("Page Platform on-call");
    });
    await submit();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const model: JSONObject = sentModel();
    expect(model["name"]).toBe("Page Platform on-call");
    expect(ids(model["onCallDutyPolicies"])).toEqual([PLATFORM_ON_CALL]);
    // A rule for every new record: no condition stored, as before.
    expect((model["criteria"] as { filters?: Array<unknown> }).filters).toEqual(
      [],
    );
    expect(model["description"]).toBeFalsy();
  });

  test("will not create a rule that pages nobody", async () => {
    await openForm();
    await next();

    fireEvent.change(nameBox(), { target: { value: "Pages nobody" } });
    await submit();

    expect(
      await within(dialog()).findByText("On-Call Duty Policies is required."),
    ).toBeInTheDocument();
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });
});

describe("editing an on-call rule", () => {
  test("adds the Enabled switch beside the policies, and keeps its name", async () => {
    getItemMock.mockImplementation((() => {
      return Promise.resolve(
        Object.assign(new IncidentOnCallRule(), {
          _id: RULE_ID,
          name: "Database team",
          description: "",
          isEnabled: true,
          onCallDutyPolicies: [],
        }),
      );
    }) as never);

    const user: UserEvent = await renderPage(
      IncidentOnCallRules as RulePage,
      "edit",
    );
    await within(dialog()).findByRole("navigation", { name: "Progress" });

    await next();

    expect(
      await within(dialog()).findByRole("switch", { name: /Enabled/ }),
    ).toBeVisible();
    await waitFor(() => {
      expect(nameBox()).toHaveValue("Database team");
    });

    // A name somebody gave the rule is theirs: a pick leaves it alone.
    await pickPolicy(user, "Database on-call");
    await settle();
    expect(nameBox()).toHaveValue("Database team");
  });
});

/*
 * WHEN AN ON-CALL RULE PAGES: under More fields, with the description. A
 * rule starts on Right away, as rules always have, and asks nothing more;
 * picking Only during working hours fills in Monday to Friday, 09:00 to
 * 17:00, in the reader's own time zone, and shows both to change - the
 * zone, and the hours in a schedule layer's own editor, with no "No
 * Restrictions" answer and the zone named under it.
 */
describe("when an on-call rule pages", () => {
  const ZONE: string = OneUptimeDate.getCurrentTimezone().toString();

  async function openOnCallStep(): Promise<UserEvent> {
    const user: UserEvent = await renderPage(AlertOnCallRules as RulePage);
    await within(dialog()).findByRole("navigation", { name: "Progress" });
    await next();
    return user;
  }

  async function openMoreFields(): Promise<void> {
    await act(async (): Promise<void> => {
      fireEvent.click(moreFields());
    });
    await settle();
  }

  function whenToPage(): HTMLElement {
    return within(dialog()).getByRole("radiogroup", { name: "When to Page" });
  }

  async function pickWorkingHours(user: UserEvent): Promise<void> {
    await user.click(
      within(whenToPage()).getByRole("radio", {
        name: /^Only during working hours/,
      }),
    );
    // Its hours editor settles on the weekly windows it was handed.
    await waitFor(() => {
      expect(
        within(dialog()).getByRole("radio", {
          name: "Specific Times of the Week",
        }),
      ).toBeChecked();
    });
  }

  test("starts on Right away, under More fields, and asks for no hours", async () => {
    await openOnCallStep();
    await openMoreFields();

    expect(
      within(whenToPage()).getByRole("radio", { name: /^Right away/ }),
    ).toBeChecked();
    expect(
      within(whenToPage()).getByText("Page as soon as this rule matches."),
    ).toBeVisible();
    expect(within(dialog()).queryByText("Working Hours")).toBeNull();
    expect(within(dialog()).queryByText("Timezone")).toBeNull();
  });

  test("picking Only during working hours shows the zone and Monday to Friday, 09:00 to 17:00", async () => {
    const user: UserEvent = await openOnCallStep();
    await openMoreFields();
    await pickWorkingHours(user);

    expect(within(dialog()).getByText("Timezone")).toBeVisible();
    // A window a weekday, each with its own Delete.
    expect(
      within(dialog()).getAllByRole("button", { name: "Delete" }),
    ).toHaveLength(5);
    expect(within(dialog()).queryByText("No Restrictions")).toBeNull();
    expect(
      within(dialog()).getByText(`These times are in ${ZONE}.`),
    ).toBeVisible();
    expect(
      within(dialog()).getByRole("button", { name: "Add Working Hours" }),
    ).toBeVisible();
  });

  test("creates the rule with when it pages, its zone and its hours", async () => {
    const user: UserEvent = await openOnCallStep();

    await pickPolicy(user, "Platform on-call");
    await waitFor(() => {
      expect(nameBox()).toHaveValue("Page Platform on-call");
    });
    await openMoreFields();
    await pickWorkingHours(user);
    await submit();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const model: JSONObject = sentModel();
    const hours: RestrictionTimes = RestrictionTimes.fromJSON(
      model["workingHours"] as RestrictionTimes,
    );

    expect(model["whenToPage"]).toBe(OnCallRuleWhenToPage.WorkingHours);
    expect(model["workingHoursTimezone"]).toBe(ZONE);
    expect(hours.restictionType).toBe(RestrictionType.Weekly);
    expect(hours.weeklyRestrictionTimes).toHaveLength(5);
  });

  test("a rule that pages right away is created as rules always were", async () => {
    const user: UserEvent = await openOnCallStep();

    await pickPolicy(user, "Platform on-call");
    await waitFor(() => {
      expect(nameBox()).toHaveValue("Page Platform on-call");
    });
    await submit();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const model: JSONObject = sentModel();

    expect(model["whenToPage"]).not.toBe(OnCallRuleWhenToPage.WorkingHours);
    expect(model["workingHours"]).toBeFalsy();
  });
});

// ---- Privacy rules -----------------------------------------------------------

interface PrivacyCase {
  name: string;
  Page: RulePage;
  tab: string | null;
  allLabel: string;
  ruleName: string;
  saysWhatItDoes: string;
}

const PRIVACY_CASES: Array<PrivacyCase> = [
  {
    name: "Incidents > Rules > Privacy Rules",
    Page: IncidentPrivacyRules as RulePage,
    tab: null,
    allLabel: "All incidents",
    ruleName: "Make incidents private",
    saysWhatItDoes:
      "Incidents this rule matches become private: only their owners, project admins and project owners can see them.",
  },
  {
    name: "Incidents > Rules > Privacy Rules > Episode Rules",
    Page: IncidentPrivacyRules as RulePage,
    tab: "Episode Rules",
    allLabel: "All incident episodes",
    ruleName: "Make incident episodes private",
    saysWhatItDoes:
      "Episodes this rule matches become private: only their owners, project admins and project owners can see them.",
  },
  {
    name: "Alerts > Rules > Privacy Rules",
    Page: AlertPrivacyRules as RulePage,
    tab: null,
    allLabel: "All alerts",
    ruleName: "Make alerts private",
    saysWhatItDoes:
      "Alerts this rule matches become private: only their owners, project admins and project owners can see them.",
  },
  {
    name: "Alerts > Rules > Privacy Rules > Episode Rules",
    Page: AlertPrivacyRules as RulePage,
    tab: "Episode Rules",
    allLabel: "All alert episodes",
    ruleName: "Make alert episodes private",
    saysWhatItDoes:
      "Episodes this rule matches become private: only their owners, project admins and project owners can see them.",
  },
];

describe.each(PRIVACY_CASES)("$name", (page: PrivacyCase) => {
  async function openForm(): Promise<void> {
    await renderPage(page.Page);

    if (page.tab) {
      await openTab(page.tab);
    }

    await within(dialog()).findByRole("navigation", { name: "Progress" });
  }

  test("opens on what the rule matches, then names it for what it does", async () => {
    await openForm();

    expect(stepTitles()).toEqual([
      expect.stringContaining("Match"),
      expect.stringContaining("Name"),
    ]);
    expectOpensOnMatch(page.allLabel);

    await next();

    expect(nameBox()).toHaveValue(page.ruleName);
    expect(within(dialog()).getByText(page.saysWhatItDoes)).toBeVisible();
    expect(listedNames(moreFields())).toEqual(["Description"]);
    expect(
      within(dialog()).queryByRole("switch", { name: /Enabled/ }),
    ).toBeNull();
  });

  test("creates a rule for every new record in two clicks, named for what it does", async () => {
    await openForm();
    await next();
    await submit();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const model: JSONObject = sentModel();
    expect(model["name"]).toBe(page.ruleName);
    expect((model["criteria"] as { filters?: Array<unknown> }).filters).toEqual(
      [],
    );
  });
});

// ---- SLA rules ----------------------------------------------------------------

describe("Incidents > Rules > SLA Rules", () => {
  async function openForm(): Promise<void> {
    await renderPage(IncidentSlaRules as RulePage);
    await within(dialog()).findByRole("navigation", { name: "Progress" });
  }

  test("opens on what the rule matches, then asks for its targets, the rest folded", async () => {
    await openForm();

    expect(stepTitles()).toEqual([
      expect.stringContaining("Match"),
      expect.stringContaining("Targets"),
    ]);
    expectOpensOnMatch("All incidents");

    await next();

    // A new rule starts with targets, and the name they make.
    expect(numberBox("Response Time (minutes)")).toBeVisible();
    expect(numberBox("Response Time (minutes)")).toHaveValue(15);
    expect(numberBox("Resolution Time (minutes)")).toHaveValue(240);
    expect(nameBox()).toHaveValue("Respond in 15 minutes, resolve in 4 hours");
    // No grey number that reads like a value once a box is emptied.
    expect(
      numberBox("Response Time (minutes)").getAttribute("placeholder") || "",
    ).toBe("");
    expect(
      numberBox("Resolution Time (minutes)").getAttribute("placeholder") || "",
    ).toBe("");

    // The At-Risk Threshold, the description and the note reminders fold.
    expect(moreFields()).toHaveAttribute("aria-expanded", "false");
    const folded: Array<string> = listedNames(moreFields());
    expect(folded.slice(0, 2)).toEqual([
      "At-Risk Threshold (%)",
      "Description",
    ]);
    expect(within(dialog()).queryByText("Note Reminders")).not.toBeVisible();
    expect(
      within(dialog()).queryByRole("switch", { name: /Enabled/ }),
    ).toBeNull();
  });

  test("names the rule after its targets, and follows them", async () => {
    await openForm();
    await next();

    fireEvent.change(numberBox("Resolution Time (minutes)"), {
      target: { value: "" },
    });
    await waitFor(() => {
      expect(nameBox()).toHaveValue("Respond in 15 minutes");
    });

    fireEvent.change(numberBox("Resolution Time (minutes)"), {
      target: { value: "60" },
    });
    await waitFor(() => {
      expect(nameBox()).toHaveValue("Respond in 15 minutes, resolve in 1 hour");
    });

    fireEvent.change(numberBox("Response Time (minutes)"), {
      target: { value: "" },
    });
    await waitFor(() => {
      expect(nameBox()).toHaveValue("Resolve in 1 hour");
    });
  });

  test("never writes over a name somebody typed", async () => {
    await openForm();
    await next();

    fireEvent.change(nameBox(), { target: { value: "Platinum customers" } });
    fireEvent.change(numberBox("Response Time (minutes)"), {
      target: { value: "5" },
    });

    await waitFor(() => {
      expect(numberBox("Response Time (minutes)")).toHaveValue(5);
    });
    expect(nameBox()).toHaveValue("Platinum customers");
  });

  test("creates the rule it shows, untouched: respond in 15 minutes, resolve in 4 hours", async () => {
    await openForm();
    await next();
    await submit();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const model: JSONObject = sentModel();
    expect(model["name"]).toBe("Respond in 15 minutes, resolve in 4 hours");
    expect(Number(model["responseTimeInMinutes"])).toBe(15);
    expect(Number(model["resolutionTimeInMinutes"])).toBe(240);
  });

  test("an emptied target is not tracked: nothing is stored for it", async () => {
    await openForm();
    await next();

    fireEvent.change(numberBox("Response Time (minutes)"), {
      target: { value: "" },
    });
    await waitFor(() => {
      expect(nameBox()).toHaveValue("Resolve in 4 hours");
    });
    await submit();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const model: JSONObject = sentModel();
    expect(model["name"]).toBe("Resolve in 4 hours");
    // None, not "": a number column cannot store an empty string.
    expect(model["responseTimeInMinutes"]).toBeNull();
    expect(Number(model["resolutionTimeInMinutes"])).toBe(240);
  });

  test("creates the rule with its targets and the name filled in", async () => {
    await openForm();
    await next();

    fireEvent.change(numberBox("Response Time (minutes)"), {
      target: { value: "30" },
    });
    fireEvent.change(numberBox("Resolution Time (minutes)"), {
      target: { value: "240" },
    });
    await waitFor(() => {
      expect(nameBox()).toHaveValue(
        "Respond in 30 minutes, resolve in 4 hours",
      );
    });
    await submit();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const model: JSONObject = sentModel();
    expect(model["name"]).toBe("Respond in 30 minutes, resolve in 4 hours");
    expect(Number(model["responseTimeInMinutes"])).toBe(30);
    expect(Number(model["resolutionTimeInMinutes"])).toBe(240);
  });
});

describe("editing an incident SLA rule", () => {
  test("shows the targets it stores, and never fills in one it left empty", async () => {
    getItemMock.mockImplementation((() => {
      return Promise.resolve(
        Object.assign(new IncidentSlaRule(), {
          _id: RULE_ID,
          name: "Respond in 30 minutes",
          isEnabled: true,
          responseTimeInMinutes: 30,
          atRiskThresholdInPercentage: 80,
        }),
      );
    }) as never);

    await renderPage(IncidentSlaRules as RulePage, "edit");
    await within(dialog()).findByRole("navigation", { name: "Progress" });
    await next();

    await waitFor(() => {
      expect(numberBox("Response Time (minutes)")).toHaveValue(30);
    });
    // The new rule's 4 hours are for a Create form only.
    expect(numberBox("Resolution Time (minutes)")).toHaveValue(null);
    expect(nameBox()).toHaveValue("Respond in 30 minutes");
  });

  test("an emptied target is saved as none, so the rule stops tracking it", async () => {
    getItemMock.mockImplementation((() => {
      return Promise.resolve(
        Object.assign(new IncidentSlaRule(), {
          _id: RULE_ID,
          name: "Customer SLA",
          isEnabled: true,
          responseTimeInMinutes: 30,
          resolutionTimeInMinutes: 240,
          atRiskThresholdInPercentage: 80,
        }),
      );
    }) as never);

    await renderPage(IncidentSlaRules as RulePage, "edit");
    await within(dialog()).findByRole("navigation", { name: "Progress" });
    await next();

    await waitFor(() => {
      expect(numberBox("Response Time (minutes)")).toHaveValue(30);
    });
    fireEvent.change(numberBox("Response Time (minutes)"), {
      target: { value: "" },
    });
    await submit();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const model: JSONObject = sentModel();
    expect(model["responseTimeInMinutes"]).toBeNull();
    expect(Number(model["resolutionTimeInMinutes"])).toBe(240);
    // A name somebody typed stays.
    expect(model["name"]).toBe("Customer SLA");
  });
});

// ---- Incident and alert reminder rules ----------------------------------------

interface ReminderCase {
  name: string;
  Page: RulePage;
  record: "incident" | "alert";
}

const REMINDER_CASES: Array<ReminderCase> = [
  {
    name: "Incidents > Rules > Reminder Rules",
    Page: IncidentReminderRules as RulePage,
    record: "incident",
  },
  {
    name: "Alerts > Rules > Reminder Rules",
    Page: AlertReminderRules as RulePage,
    record: "alert",
  },
];

describe.each(REMINDER_CASES)("$name", (page: ReminderCase) => {
  async function openForm(): Promise<void> {
    await renderPage(page.Page);
    await within(dialog()).findByRole("navigation", { name: "Progress" });
  }

  function stopAnswers(): HTMLElement {
    return within(dialog()).getByRole("radiogroup", {
      name: "Stop Reminders When",
    });
  }

  test("opens on what the rule matches, then how often and until when it reminds", async () => {
    await openForm();

    expect(stepTitles()).toEqual([
      expect.stringContaining("Match"),
      expect.stringContaining("Reminders"),
    ]);
    expectOpensOnMatch(`All ${page.record}s`);

    await next();

    // Every 30 minutes until resolved: a rule that works as it stands.
    expect(numberBox("Reminder Interval (minutes)")).toHaveValue(30);
    expect(
      within(stopAnswers()).getByRole("radio", { name: "Resolved" }),
    ).toBeChecked();
    expect(
      within(stopAnswers()).getByRole("radio", { name: "Acknowledged" }),
    ).not.toBeChecked();
    expect(nameBox()).toHaveValue("Remind every 30 minutes until resolved");
    expect(listedNames(moreFields())).toEqual(["Description"]);
  });

  test("says what each answer means, once: under the answer, not above both", async () => {
    await openForm();
    await next();

    expect(
      within(stopAnswers()).getByText(
        `Keep reminding until the ${page.record} is resolved.`,
      ),
    ).toBeVisible();
    expect(
      within(stopAnswers()).getByText(
        `Stop once someone acknowledges the ${page.record}.`,
      ),
    ).toBeVisible();
    // The column's sentence about both answers is not drawn over them.
    expect(within(dialog()).queryByText(/Select Acknowledged to stop/)).toBe(
      null,
    );
  });

  test("names the rule after how often and until when it reminds", async () => {
    const user: UserEvent = await openForm().then(() => {
      return userEvent.setup({ delay: null });
    });
    await next();

    await user.click(
      within(stopAnswers()).getByRole("radio", { name: "Acknowledged" }),
    );
    await waitFor(() => {
      expect(nameBox()).toHaveValue(
        "Remind every 30 minutes until acknowledged",
      );
    });

    fireEvent.change(numberBox("Reminder Interval (minutes)"), {
      target: { value: "60" },
    });
    await waitFor(() => {
      expect(nameBox()).toHaveValue("Remind every 1 hour until acknowledged");
    });

    fireEvent.change(nameBox(), { target: { value: "Nag the team" } });
    fireEvent.change(numberBox("Reminder Interval (minutes)"), {
      target: { value: "15" },
    });
    await settle();
    expect(nameBox()).toHaveValue("Nag the team");
  });

  test("creates the rule it shows: 30 minutes until resolved, untouched", async () => {
    await openForm();
    await next();
    await submit();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const model: JSONObject = sentModel();
    expect(Number(model["reminderIntervalInMinutes"])).toBe(30);
    expect(model["stopRemindersOnState"]).toBe(ReminderStopState.Resolved);
    expect(model["name"]).toBe("Remind every 30 minutes until resolved");
  });

  test("stores Acknowledged as the column always has", async () => {
    const user: UserEvent = await openForm().then(() => {
      return userEvent.setup({ delay: null });
    });
    await next();

    await user.click(
      within(stopAnswers()).getByRole("radio", { name: "Acknowledged" }),
    );
    await submit();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });
    expect(sentModel()["stopRemindersOnState"]).toBe(
      ReminderStopState.Acknowledged,
    );
  });
});

describe("editing an incident reminder rule", () => {
  test("shows its stored answer, and the Enabled switch, on the Reminders step", async () => {
    getItemMock.mockImplementation((() => {
      return Promise.resolve(
        Object.assign(new IncidentReminderRule(), {
          _id: RULE_ID,
          name: "Critical Incident Reminders",
          isEnabled: true,
          reminderIntervalInMinutes: 15,
          stopRemindersOnState: ReminderStopState.Acknowledged,
        }),
      );
    }) as never);

    await renderPage(IncidentReminderRules as RulePage, "edit");
    await within(dialog()).findByRole("navigation", { name: "Progress" });
    await next();

    await waitFor(() => {
      expect(
        within(dialog()).getByRole("radio", { name: "Acknowledged" }),
      ).toBeChecked();
    });
    expect(nameBox()).toHaveValue("Critical Incident Reminders");
    expect(
      within(dialog()).getByRole("switch", { name: /Enabled/ }),
    ).toBeVisible();
  });
});

// ---- Scheduled maintenance reminder rules -------------------------------------

describe("Scheduled Maintenance > Rules > Reminder Rules", () => {
  async function openForm(): Promise<UserEvent> {
    const user: UserEvent = await renderPage(
      ScheduledMaintenanceReminderRules as RulePage,
    );
    await within(dialog()).findByRole("navigation", { name: "Progress" });
    return user;
  }

  function answers(): HTMLElement {
    return within(dialog()).getByTestId("maintenance-reminder-timing-options");
  }

  test("asks when to remind as one choice of three answers, in progress first", async () => {
    await openForm();

    expect(stepTitles()).toEqual([
      expect.stringContaining("Match"),
      expect.stringContaining("Reminders"),
    ]);
    expectOpensOnMatch("All scheduled maintenance events");

    await next();

    const radios: Array<HTMLElement> = within(answers()).getAllByRole("radio");
    expect(
      radios.map((radio: HTMLElement): string => {
        return radio.getAttribute("aria-describedby")
          ? ((radio as HTMLInputElement).labels?.[0]?.textContent || "").trim()
          : "";
      }),
    ).toEqual([
      "While it is in progress",
      "Before it starts",
      "Before it starts and while it is in progress",
    ]);
    expect(radios[0]).toBeChecked();
    expect(
      within(answers()).getByText("From when the event starts until it ends."),
    ).toBeVisible();

    // The old dropdown and switch are gone; their sentences with them.
    expect(within(dialog()).queryByText("Stop Reminders When")).toBeNull();
    expect(
      within(dialog()).queryByText("Remind While Event is Scheduled"),
    ).toBeNull();
    expect(within(dialog()).queryByText(/When disabled, reminders/)).toBeNull();
    expect(
      within(dialog()).queryByTestId("maintenance-reminder-never-reminds"),
    ).toBeNull();

    expect(numberBox("Reminder Interval (minutes)")).toHaveValue(30);
    expect(nameBox()).toHaveValue(
      "Remind every 30 minutes while it is in progress",
    );
  });

  test("creates an untouched rule as the columns' defaults always did", async () => {
    await openForm();
    await next();
    await submit();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const model: JSONObject = sentModel();
    expect(model["remindWhileScheduled"]).toBe(false);
    expect([
      undefined,
      ScheduledMaintenanceReminderStopState.Completed,
    ]).toContain(model["stopRemindersOnState"]);
    expect(model["name"]).toBe(
      "Remind every 30 minutes while it is in progress",
    );
    // The choice itself is never sent: only the two columns it writes.
    expect(model["reminderTiming"]).toBeUndefined();
  });

  test.each([
    [
      "Before it starts",
      true,
      ScheduledMaintenanceReminderStopState.Ongoing,
      "Remind every 30 minutes before it starts",
    ],
    [
      "Before it starts and while it is in progress",
      true,
      ScheduledMaintenanceReminderStopState.Completed,
      "Remind every 30 minutes before and during the event",
    ],
  ] as Array<[string, boolean, string, string]>)(
    "'%s' writes the two columns it means, and names the rule",
    async (
      answer: string,
      remindWhileScheduled: boolean,
      stopState: string,
      ruleName: string,
    ) => {
      const user: UserEvent = await openForm();
      await next();

      await user.click(within(answers()).getByRole("radio", { name: answer }));
      await waitFor(() => {
        expect(nameBox()).toHaveValue(ruleName);
      });
      await submit();

      await waitFor(() => {
        expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
      });

      const model: JSONObject = sentModel();
      expect(model["remindWhileScheduled"]).toBe(remindWhileScheduled);
      expect(model["stopRemindersOnState"]).toBe(stopState);
      expect(model["name"]).toBe(ruleName);
    },
  );

  test("going back to 'While it is in progress' writes the defaults again", async () => {
    const user: UserEvent = await openForm();
    await next();

    await user.click(
      within(answers()).getByRole("radio", { name: "Before it starts" }),
    );
    await user.click(
      within(answers()).getByRole("radio", { name: "While it is in progress" }),
    );
    await waitFor(() => {
      expect(nameBox()).toHaveValue(
        "Remind every 30 minutes while it is in progress",
      );
    });
    await submit();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const model: JSONObject = sentModel();
    expect(model["remindWhileScheduled"]).toBe(false);
    expect(model["stopRemindersOnState"]).toBe(
      ScheduledMaintenanceReminderStopState.Completed,
    );
  });

  test.each([
    [
      "before and during",
      true,
      ScheduledMaintenanceReminderStopState.Completed,
      "Before it starts and while it is in progress",
    ],
    [
      "before it starts",
      true,
      ScheduledMaintenanceReminderStopState.Ongoing,
      "Before it starts",
    ],
    [
      "while in progress",
      false,
      ScheduledMaintenanceReminderStopState.Completed,
      "While it is in progress",
    ],
  ] as Array<[string, boolean, string, string]>)(
    "an Edit form of a rule stored %s shows that answer",
    async (
      _name: string,
      remindWhileScheduled: boolean,
      stopState: string,
      answer: string,
    ) => {
      getItemMock.mockImplementation((() => {
        return Promise.resolve(
          Object.assign(new ScheduledMaintenanceReminderRule(), {
            _id: RULE_ID,
            name: "Maintenance Event Reminders",
            isEnabled: true,
            reminderIntervalInMinutes: 30,
            remindWhileScheduled: remindWhileScheduled,
            stopRemindersOnState: stopState,
          }),
        );
      }) as never);

      await renderPage(ScheduledMaintenanceReminderRules as RulePage, "edit");
      await within(dialog()).findByRole("navigation", { name: "Progress" });
      await next();

      await waitFor(() => {
        expect(
          within(answers()).getByRole("radio", { name: answer }),
        ).toBeChecked();
      });
      // A name somebody gave the rule stays.
      expect(nameBox()).toHaveValue("Maintenance Event Reminders");
    },
  );

  test("an Edit form of a rule that never reminds says so, with no answer picked", async () => {
    getItemMock.mockImplementation((() => {
      return Promise.resolve(
        Object.assign(new ScheduledMaintenanceReminderRule(), {
          _id: RULE_ID,
          name: "Broken reminders",
          isEnabled: true,
          reminderIntervalInMinutes: 30,
          remindWhileScheduled: false,
          stopRemindersOnState: ScheduledMaintenanceReminderStopState.Ongoing,
        }),
      );
    }) as never);

    const user: UserEvent = await renderPage(
      ScheduledMaintenanceReminderRules as RulePage,
      "edit",
    );
    await within(dialog()).findByRole("navigation", { name: "Progress" });
    await next();

    const note: HTMLElement = await within(dialog()).findByTestId(
      "maintenance-reminder-never-reminds",
    );
    expect(note).toHaveTextContent(
      "This rule never sends a reminder: it waits for the event to start and stops when it starts. Pick when to remind.",
    );
    /*
     * The product's warning beside a field - an amber box with its icon, a
     * note to assistive technology - not one more line of grey help.
     */
    expect(note).toHaveAttribute("role", "note");
    expect(note).toHaveClass("bg-amber-50", "border-amber-200");
    expect(note.querySelector("svg")).not.toBeNull();
    for (const radio of within(answers()).getAllByRole("radio")) {
      expect(radio).not.toBeChecked();
    }

    // Picking an answer clears the note.
    await user.click(
      within(answers()).getByRole("radio", { name: "Before it starts" }),
    );
    await waitFor(() => {
      expect(
        within(dialog()).queryByTestId("maintenance-reminder-never-reminds"),
      ).toBeNull();
    });
  });
});

describe("the Enabled switch on every edit form", () => {
  test("sits on the last step of a maintenance reminder rule, not the first", async () => {
    getItemMock.mockImplementation((() => {
      return Promise.resolve(
        Object.assign(new ScheduledMaintenanceReminderRule(), {
          _id: RULE_ID,
          name: "Maintenance Event Reminders",
          isEnabled: false,
          reminderIntervalInMinutes: 30,
          remindWhileScheduled: false,
          stopRemindersOnState: ScheduledMaintenanceReminderStopState.Completed,
        }),
      );
    }) as never);

    await renderPage(ScheduledMaintenanceReminderRules as RulePage, "edit");
    await within(dialog()).findByRole("navigation", { name: "Progress" });

    expect(
      within(dialog()).queryByRole("switch", { name: /Enabled/ }),
    ).toBeNull();

    await next();

    expect(
      await within(dialog()).findByRole("switch", { name: /Enabled/ }),
    ).toBeVisible();
  });
});
