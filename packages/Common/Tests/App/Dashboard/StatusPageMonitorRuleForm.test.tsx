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
import React, { ReactElement } from "react";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { FormType, ModelField } from "../../../UI/Components/Forms/ModelForm";
import ModelFormModal from "../../../UI/Components/ModelFormModal/ModelFormModal";
import { ComponentProps as ModelTableProps } from "../../../UI/Components/ModelTable/ModelTable";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A status page's Monitor Rules (Status Pages -> a page -> Resources ->
 * Monitor Rules), drawn for real: the page's own fields in the
 * ModelFormModal, ModelForm and BasicForm its table opens, with only the
 * table around them, the network and the permissions stubbed.
 *
 * The form used to open on "Basic Info" - a name and a description, before
 * anyone had said what the rule was for - then the conditions, then the
 * group. Now it asks the way every other rule form does:
 *
 *   - Match: the conditions a monitor must meet (a status page rule needs at
 *     least one);
 *   - Group: where the monitors it matches go, then its name - filled in from
 *     that ("Add monitors to Website") and following it until somebody types
 *     their own - with how each monitor is shown and the description folded
 *     under More fields, and Enabled on the Edit form only.
 *
 * What is saved is the same columns as before.
 */

configure({ asyncUtilTimeout: 15000 });

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const STATUS_PAGE_ID: string = "3a000000-0000-4000-8000-0000000000a1";
const RULE_ID: string = "66666666-6666-4666-8666-666666666666";
const NEW_ID: string = "55555555-5555-4555-8555-555555555555";

const WEBSITE_GROUP_ID: string = "3b000000-0000-4000-8000-0000000000b1";
const REGIONS_GROUP_ID: string = "3b000000-0000-4000-8000-0000000000b2";
const EU_GROUP_ID: string = "3b000000-0000-4000-8000-0000000000b3";

interface MockTable {
  mode: "create" | "edit";
  // What the page hands its table, for the checks on the table itself.
  props: ModelTableProps<BaseModel> | null;
}

const mockTable: MockTable = { mode: "create", props: null };

const createOrUpdateMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: <TBaseModel extends BaseModel>(
      props: ModelTableProps<TBaseModel>,
    ): ReactElement => {
      mockTable.props = props as unknown as ModelTableProps<BaseModel>;

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
      // The status page's groups: the Group step's picker reads them.
      getList: async (request: {
        modelType: { name: string };
      }): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        type Loaded = { new (): Record<string, unknown> };

        let rows: Array<unknown> = [];

        if (request.modelType.name === "StatusPageGroup") {
          const GroupModel: Loaded = (
            jest.requireActual(
              "../../../Models/DatabaseModels/StatusPageGroup",
            ) as { default: Loaded }
          ).default;

          rows = [
            { _id: WEBSITE_GROUP_ID, name: "Website", order: 1 },
            { _id: REGIONS_GROUP_ID, name: "Regions", order: 2 },
            {
              _id: EU_GROUP_ID,
              name: "EU",
              order: 3,
              parentStatusPageGroupId: new ObjectID(REGIONS_GROUP_ID),
            },
          ].map((group: Record<string, unknown>): unknown => {
            return Object.assign(new GroupModel(), group);
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
import StatusPageMonitorRule from "../../../Models/DatabaseModels/StatusPageMonitorRule";
import StatusPageGroup from "../../../Models/DatabaseModels/StatusPageGroup";
import Project from "../../../Models/DatabaseModels/Project";
import ColumnLength from "../../../Types/Database/ColumnLength";
import { listedNames } from "../../UI/Components/FoldedSection/FoldedSectionQueries";
import StatusPageMonitorRulesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/View/MonitorRules";
import StatusPageMonitorRuleCopy, {
  STATUS_PAGE_MONITOR_RULE_NAMES,
  getStatusPageMonitorRuleName,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/StatusPageMonitorRuleForm";

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
  mode: MockTable["mode"] = "create",
): Promise<UserEvent> {
  mockTable.mode = mode;

  await act(async (): Promise<void> => {
    render(
      <StatusPageMonitorRulesPage
        pageRoute={
          new Route(
            `/dashboard/${PROJECT_ID}/status-pages/${STATUS_PAGE_ID}/monitor-rules`,
          )
        }
        currentProject={Object.assign(new Project(), { _id: PROJECT_ID })}
        hasPaymentMethod={true}
      />,
    );
  });

  await settle();
  await within(dialog()).findByRole("navigation", { name: "Progress" });

  return userEvent.setup({ delay: null });
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

function groupPicker(): HTMLElement {
  return within(dialog()).getByRole("combobox", { name: /Add Monitors To/ });
}

async function pickGroup(user: UserEvent, label: string): Promise<void> {
  await user.click(groupPicker());
  await user.click(await screen.findByRole("option", { name: label }));
}

// "Monitor name contains api": the one condition a status page rule needs.
async function addNameCondition(user: UserEvent): Promise<void> {
  await user.click(
    within(dialog()).getByRole("button", { name: "Add condition" }),
  );
  await user.click(
    within(dialog()).getByRole("combobox", {
      name: "Criteria for condition 1",
    }),
  );
  await user.click(
    within(await screen.findByRole("listbox")).getByText("Monitor Name", {
      exact: true,
    }),
  );
  await user.type(within(dialog()).getByTestId("rule-criteria-value-0"), "api");
}

// Through Match, onto Group, with a condition in place.
async function openGroupStep(): Promise<UserEvent> {
  const user: UserEvent = await renderPage();
  await addNameCondition(user);
  await next();
  await within(dialog()).findByRole("textbox", { name: "Name" });
  return user;
}

// What ModelForm handed the API: the model, read by its columns.
function sentModel(): JSONObject {
  return (createOrUpdateMock.mock.calls[0]?.[0] as { model: unknown })
    .model as JSONObject;
}

function idOf(value: unknown): string {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  const record: Record<string, unknown> = value as Record<string, unknown>;

  return String(record["_id"] || record["id"] || record["value"] || value);
}

beforeEach(() => {
  window.history.replaceState(
    {},
    "",
    `/dashboard/${PROJECT_ID}/status-pages/${STATUS_PAGE_ID}/monitor-rules`,
  );
  mockTable.props = null;
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

describe("a status page monitor rule's name", () => {
  test("is the group its monitors go into", () => {
    expect(getStatusPageMonitorRuleName(["Website"])).toBe(
      "Add monitors to Website",
    );
    // A nested group, named the way its picker names it.
    expect(getStatusPageMonitorRuleName(["Regions › EU"])).toBe(
      "Add monitors to Regions › EU",
    );
  });

  test("is the top of the page when no group is picked", () => {
    expect(getStatusPageMonitorRuleName([])).toBe(
      "Add monitors to the top of the page",
    );
    expect(getStatusPageMonitorRuleName(["   "])).toBe(
      "Add monitors to the top of the page",
    );
  });

  test("always fits the rule's Name column", () => {
    const name: string = getStatusPageMonitorRuleName(["G".repeat(500)]);

    expect(name.length).toBe(ColumnLength.ShortText);
    expect(name.startsWith("Add monitors to G")).toBe(true);
  });

  test("is worded once, as whole sentences a language can translate", () => {
    expect(STATUS_PAGE_MONITOR_RULE_NAMES).toEqual({
      toGroup: "Add monitors to {{group}}",
      toTopOfPage: "Add monitors to the top of the page",
    });
  });
});

describe("Status Pages > a page > Monitor Rules: the table", () => {
  test("names its rows Monitor Rule: Create Monitor Rule, not Create Status Page Monitor Rule", async () => {
    await renderPage();

    expect(mockTable.props?.singularName).toBe("Monitor Rule");
    expect(mockTable.props?.pluralName).toBe("Monitor Rules");
    expect(StatusPageMonitorRuleCopy.singularName).toBe("Monitor Rule");

    expect(
      within(dialog()).getByText("Create New Monitor Rule"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Status Page Monitor Rule/)).toBeNull();
  });

  test("leaves its empty list to the table's own words: No monitor rules yet", async () => {
    await renderPage();

    expect(mockTable.props?.noItemsMessage).toBeUndefined();
  });
});

describe("Create Monitor Rule", () => {
  test("opens on what the rule matches: no Basic Info, no name, no action yet", async () => {
    await renderPage();

    expect(stepTitles()).toEqual([
      expect.stringContaining("Match"),
      expect.stringContaining("Group"),
    ]);
    expect(within(dialog()).queryByText("Basic Info")).toBeNull();
    expect(within(dialog()).queryByText("Match Criteria")).toBeNull();

    // The conditions builder, waiting for the condition the rule needs.
    expect(
      within(dialog()).getByRole("button", { name: "Add condition" }),
    ).toBeVisible();
    expect(
      within(dialog()).queryByRole("textbox", { name: "Name" }),
    ).toBeNull();
    // Next is plain; the rule is created from the last step only.
    expect(
      within(dialog()).queryByTestId("modal-footer-submit-button"),
    ).toBeNull();
  });

  test("will not walk on without a condition", async () => {
    await renderPage();

    await next();

    expect(
      await within(dialog()).findByText("Add at least one condition."),
    ).toBeInTheDocument();
    expect(
      within(dialog()).queryByRole("textbox", { name: "Name" }),
    ).toBeNull();
  });

  test("then asks where the monitors go, with the name filled in for the top of the page and the rest folded", async () => {
    await openGroupStep();

    expect(groupPicker()).toBeVisible();
    expect(
      within(dialog()).getByText(
        "The group the monitors it matches go into. Leave it empty to put them at the top of the page.",
      ),
    ).toBeInTheDocument();
    expect(within(dialog()).getByText("Top of page")).toBeInTheDocument();

    expect(nameBox()).toHaveValue("Add monitors to the top of the page");
    expect(
      within(dialog()).getByText(
        "Named after where it adds monitors until you type a name of your own.",
      ),
    ).toBeInTheDocument();

    // How each monitor is shown, and the description, wait folded.
    expect(moreFields()).toHaveAttribute("aria-expanded", "false");
    expect(listedNames(moreFields())).toEqual([
      "Show Current Resource Status",
      "Show Uptime %",
      "Select Uptime Precision",
      "Show Status History Chart",
      "Description",
    ]);

    // A new rule starts on: the switch is on the Edit form only.
    expect(
      within(dialog()).queryByRole("switch", { name: /Enabled/ }),
    ).toBeNull();
    expect(
      within(dialog()).getByTestId("modal-footer-submit-button"),
    ).toHaveTextContent("Create Monitor Rule");
  });

  test("names the rule after the group picked, and follows the next pick", async () => {
    const user: UserEvent = await openGroupStep();

    await pickGroup(user, "Website");
    await waitFor(() => {
      expect(nameBox()).toHaveValue("Add monitors to Website");
    });

    // A nested group, by its path.
    await pickGroup(user, "Regions › EU");
    await waitFor(() => {
      expect(nameBox()).toHaveValue("Add monitors to Regions › EU");
    });
  });

  test("never writes over a name somebody typed", async () => {
    const user: UserEvent = await openGroupStep();

    fireEvent.change(nameBox(), { target: { value: "Production APIs" } });
    await pickGroup(user, "Website");

    await settle();
    expect(nameBox()).toHaveValue("Production APIs");
  });

  test("creates the rule into the same columns as before: its condition, its group, its name and the rule's display defaults", async () => {
    const user: UserEvent = await openGroupStep();

    await pickGroup(user, "Website");
    await waitFor(() => {
      expect(nameBox()).toHaveValue("Add monitors to Website");
    });
    await submit();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const model: JSONObject = sentModel();

    expect(model["name"]).toBe("Add monitors to Website");
    expect(idOf(model["statusPageGroup"])).toBe(WEBSITE_GROUP_ID);
    // The page it was created on.
    expect(idOf(model["statusPageId"])).toBe(STATUS_PAGE_ID);
    expect(idOf(model["projectId"])).toBe(PROJECT_ID);

    // The condition, as the builder stores it.
    expect(
      (model["criteria"] as { filters?: Array<JSONObject> }).filters,
    ).toEqual([
      expect.objectContaining({ field: "monitorNamePattern", value: "api" }),
    ]);

    // A rule's monitors show their uptime, unless told otherwise.
    expect(model["showCurrentStatus"]).toBe(true);
    expect(model["showUptimePercent"]).toBe(true);
    expect(model["showStatusHistoryChart"]).toBe(true);
    expect(model["description"]).toBeFalsy();
    // Enabled was never asked: the column's own default (on) applies.
    expect(model["isEnabled"]).toBeUndefined();
  });

  test("a rule with no group puts its monitors at the top of the page, and says so in its name", async () => {
    await openGroupStep();
    await submit();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const model: JSONObject = sentModel();

    expect(model["name"]).toBe("Add monitors to the top of the page");
    expect(idOf(model["statusPageGroup"])).toBe("");
  });
});

describe("editing a status page monitor rule", () => {
  test("shows Enabled beside its name on the Group step, and keeps the name it has", async () => {
    getItemMock.mockImplementation((() => {
      return Promise.resolve(
        Object.assign(new StatusPageMonitorRule(), {
          _id: RULE_ID,
          name: "Production APIs",
          description: "",
          isEnabled: true,
          statusPageGroup: Object.assign(new StatusPageGroup(), {
            _id: WEBSITE_GROUP_ID,
            name: "Website",
          }),
          criteria: {
            schemaVersion: 1,
            filterCondition: "All",
            filters: [
              {
                field: "monitorNamePattern",
                operator: "Contains",
                value: "api",
              },
            ],
          },
          showCurrentStatus: true,
          showUptimePercent: true,
          showStatusHistoryChart: true,
        }),
      );
    }) as never);

    const user: UserEvent = await renderPage("edit");

    // The step list opens Group in one click on an Edit form.
    await act(async (): Promise<void> => {
      const progress: HTMLElement = within(dialog()).getByRole("navigation", {
        name: "Progress",
      });
      const steps: Array<HTMLElement> =
        within(progress).getAllByRole("listitem");
      fireEvent.click(steps[steps.length - 1]!);
    });
    await settle();

    expect(
      await within(dialog()).findByRole("switch", { name: /Enabled/ }),
    ).toBeVisible();
    expect(
      within(dialog()).getByText(
        "Turning a rule off removes the monitors it added to this status page. Monitors you added by hand are left alone.",
      ),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(nameBox()).toHaveValue("Production APIs");
    });

    // A name somebody gave the rule is theirs: a pick leaves it alone.
    await pickGroup(user, "Regions › EU");
    await settle();
    expect(nameBox()).toHaveValue("Production APIs");
  });
});
