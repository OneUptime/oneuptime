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
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { FormType, ModelField } from "../../../UI/Components/Forms/ModelForm";
import ModelFormModal from "../../../UI/Components/ModelFormModal/ModelFormModal";
import { ComponentProps as ModelTableProps } from "../../../UI/Components/ModelTable/ModelTable";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Metrics > Settings > Pipeline Rules, and the metric and trace Recording
 * Rules pages: their create and edit forms drawn for real - each page's own
 * fields in the ModelFormModal, ModelForm and BasicForm its table opens,
 * with only the table around them, the network and the permissions stubbed.
 *
 * "Metric pipeline rules and recording rules lose their Basic Info steps;
 * All/Any appears only with two filters."
 *
 *   - A pipeline rule walks Match (the name and the filters), then Action.
 *     Match Condition shows only once there are two filters to combine,
 *     and the description, the one service the rule is for and Enabled wait
 *     folded under More fields, at defaults that make the rule work.
 *   - A recording rule is one page: the name with the output metric line
 *     made from it, the definition, and the description and Enabled folded.
 *   - Both recording rule lists sort by name, and nothing makes up an order
 *     for a new rule.
 */

configure({ asyncUtilTimeout: 15000 });

const NEW_ID: string = "55555555-5555-4555-8555-555555555555";
const RULE_ID: string = "66666666-6666-4666-8666-666666666666";
const CHECKOUT_SERVICE_ID: string = "77777777-7777-4777-8777-777777777777";
const BILLING_SERVICE_ID: string = "88888888-8888-4888-8888-888888888888";

interface MockTable {
  mode: "create" | "edit";
  // What the page handed its table, last time it drew it.
  lastProps: ModelTableProps<BaseModel> | null;
}

const mockTable: MockTable = { mode: "create", lastProps: null };

const createOrUpdateMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: <TBaseModel extends BaseModel>(
      props: ModelTableProps<TBaseModel>,
    ): ReactElement => {
      mockTable.lastProps = props as unknown as ModelTableProps<BaseModel>;

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
          onBeforeCreate={props.onBeforeCreate}
          onSuccess={() => {}}
          formProps={{
            id: `create-${props.modelType.name}-form`,
            name: `create-${props.modelType.name}-form`,
            modelType: props.modelType,
            fields: fields.filter((field: ModelField<TBaseModel>): boolean => {
              return !field.doNotShowWhenCreating;
            }),
            steps: props.formSteps || [],
            summary: props.formSummary,
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
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
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
      getCurrentProjectId: (): unknown => {
        const ObjectIDClass: any = jest.requireActual(
          "../../../Types/ObjectID",
        ) as any;
        return new ObjectIDClass.default(
          "11111111-1111-4111-8111-111111111111",
        );
      },
    },
  };
});

import MetricPipelineRulesPage, {
  PIPELINE_RULE_DEFAULTS_SUMMARY,
  getPipelineRuleAdvancedSummary,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Metrics/Settings/PipelineRules";
import MetricRecordingRulesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Metrics/Settings/RecordingRules";
import TraceRecordingRulesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Traces/Settings/RecordingRules";
import {
  RECORDING_RULE_DEFAULTS_SUMMARY,
  getRecordingRuleAdvancedSummary,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/RecordingRule/RecordingRuleForm";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import MetricPipelineRule from "../../../Models/DatabaseModels/MetricPipelineRule";
import MetricRecordingRule from "../../../Models/DatabaseModels/MetricRecordingRule";
import Service from "../../../Models/DatabaseModels/Service";
import TraceRecordingRule from "../../../Models/DatabaseModels/TraceRecordingRule";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import MetricPipelineRuleFilterCondition, {
  MetricPipelineRuleFilterCheckOn,
  MetricPipelineRuleFilterConditionType,
} from "../../../Types/Metrics/MetricPipelineRuleFilterCondition";
import MetricPipelineRuleType from "../../../Types/Metrics/MetricPipelineRuleType";
import TraceAggregationType from "../../../Types/Trace/TraceAggregationType";
import TraceRecordingRuleDefinition from "../../../Types/Trace/TraceRecordingRuleDefinition";
import {
  listedNames,
  setChips,
} from "../../UI/Components/FoldedSection/FoldedSectionQueries";

type Page = FunctionComponent<PageComponentProps>;

function dialog(): HTMLElement {
  return screen.getByTestId("modal");
}

// BasicForm opens a stepped form's first step in an effect: let it run.
async function settle(milliseconds: number = 0): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, milliseconds);
    });
  });
}

async function renderPage(
  page: Page,
  mode: MockTable["mode"] = "create",
): Promise<UserEvent> {
  mockTable.mode = mode;
  const PageComponent: Page = page;

  const props: PageComponentProps = {
    pageRoute: new Route("/dashboard/:projectId/metrics/settings"),
  } as unknown as PageComponentProps;

  await act(async (): Promise<void> => {
    render(<PageComponent {...props} />);
  });

  await settle();

  return userEvent.setup({ delay: null });
}

// What ModelForm handed the API: the model, read by its columns.
function sentModel(): JSONObject {
  return (createOrUpdateMock.mock.calls[0]?.[0] as { model: unknown })
    .model as JSONObject;
}

async function pressNext(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(within(dialog()).getByTestId("modal-footer-next-button"));
  });
}

async function submit(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(within(dialog()).getByTestId("modal-footer-submit-button"));
  });
}

function moreFieldsHeader(): HTMLElement {
  return within(dialog()).getByRole("button", { name: "More fields" });
}

// The sentence the folded header says its defaults do with.
function moreFieldsSummary(): string | null {
  const summary: HTMLElement | null = within(dialog()).queryByTestId(
    "collapsible-section-summary",
  );

  return summary ? summary.textContent : null;
}

function filterConditionGroup(): HTMLElement | null {
  return within(dialog()).queryByRole("radiogroup", {
    name: "Match Condition",
  });
}

// A filter row's value box, in the order the rows are drawn.
function filterValueBoxes(): Array<HTMLElement> {
  return within(dialog()).queryAllByPlaceholderText("http.server.duration");
}

async function addFilter(value: string): Promise<void> {
  const before: number = filterValueBoxes().length;

  await act(async (): Promise<void> => {
    fireEvent.click(
      within(dialog()).getByRole("button", { name: "Add Filter" }),
    );
  });

  await waitFor(() => {
    expect(filterValueBoxes()).toHaveLength(before + 1);
  });

  fireEvent.change(filterValueBoxes()[before]!, { target: { value } });

  await waitFor(() => {
    expect(filterValueBoxes()[before]).toHaveValue(value);
  });
}

function services(): Array<Service> {
  return [
    { _id: CHECKOUT_SERVICE_ID, name: "checkout" },
    { _id: BILLING_SERVICE_ID, name: "billing" },
  ].map((row: { _id: string; name: string }): Service => {
    const service: Service = new Service();
    service._id = row._id;
    service.name = row.name;
    return service;
  });
}

beforeEach(() => {
  mockTable.lastProps = null;
  createOrUpdateMock.mockReset().mockImplementation(((data: {
    model: BaseModel;
  }): Promise<unknown> => {
    const saved: BaseModel = data.model;
    saved._id = NEW_ID;
    return Promise.resolve({ data: saved });
  }) as never);
  getItemMock.mockReset();
  getListMock.mockReset().mockImplementation((async (request: {
    modelType?: unknown;
    limit?: number;
  }): Promise<unknown> => {
    if (request.modelType === Service) {
      const rows: Array<Service> = services();
      return { data: rows, count: rows.length, skip: 0, limit: 10 };
    }

    return { data: [], count: 0, skip: 0, limit: 10 };
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.history.replaceState(window.history.state, "", "/");
});

const PIPELINE_RULE_SINGULAR: string = "Metric Pipeline Rule";

function metricNameFilter(value: string): MetricPipelineRuleFilterCondition {
  return {
    checkOn: MetricPipelineRuleFilterCheckOn.MetricName,
    conditionType: MetricPipelineRuleFilterConditionType.EqualTo,
    value,
  };
}

describe("Metrics > Settings > Pipeline Rules", () => {
  async function openCreateForm(): Promise<UserEvent> {
    const user: UserEvent = await renderPage(MetricPipelineRulesPage);

    expect(
      await screen.findByText(`Create New ${PIPELINE_RULE_SINGULAR}`),
    ).toBeInTheDocument();
    await within(dialog()).findByRole("navigation", { name: "Progress" });

    return user;
  }

  async function nameRule(name: string): Promise<void> {
    fireEvent.change(within(dialog()).getByRole("textbox", { name: "Name" }), {
      target: { value: name },
    });
  }

  async function pickRuleType(ruleType: MetricPipelineRuleType): Promise<void> {
    const card: HTMLElement = await within(dialog()).findByTestId(
      `card-select-option-${ruleType}`,
    );

    await act(async (): Promise<void> => {
      fireEvent.click(card);
    });
  }

  test("walks Match, then Action, with the old Basic Info step gone", async () => {
    await openCreateForm();

    const steps: HTMLElement = within(dialog()).getByRole("navigation", {
      name: "Progress",
    });

    expect(within(steps).getByText("Match")).toBeInTheDocument();
    expect(within(steps).getByText("Action")).toBeInTheDocument();
    expect(within(steps).queryByText("Basic Info")).toBeNull();
  });

  test("asks for the name and the filters on Match, the rest folded under More fields", async () => {
    await openCreateForm();

    expect(
      within(dialog()).getByRole("textbox", { name: "Name" }),
    ).toBeVisible();
    expect(
      within(dialog()).getByRole("button", { name: "Add Filter" }),
    ).toBeVisible();
    expect(
      within(dialog()).getByText(
        "If no filters are added, then this rule will apply to every metric data point.",
      ),
    ).toBeVisible();

    // Folded: listed by name, at defaults the rule works with.
    expect(moreFieldsHeader()).toHaveAttribute("aria-expanded", "false");
    expect(listedNames(dialog())).toEqual([
      "Description",
      "Only for one service",
      "Enabled",
    ]);
    expect(setChips(dialog())).toEqual([]);
    await waitFor(() => {
      expect(moreFieldsSummary()).toBe(PIPELINE_RULE_DEFAULTS_SUMMARY);
    });
    expect(within(dialog()).queryByRole("switch")).toBeNull();

    // The rule's action is the next step's question, created from there.
    expect(within(dialog()).queryByText("Rule Type")).toBeNull();
    expect(
      within(dialog()).queryByTestId("modal-footer-submit-button"),
    ).toBeNull();
    expect(
      within(dialog()).getByTestId("modal-footer-next-button"),
    ).toHaveTextContent("Next");
  });

  test("asks how to combine filters only once there are two of them", async () => {
    await openCreateForm();

    // None: nothing to combine.
    expect(filterConditionGroup()).toBeNull();
    expect(within(dialog()).queryByText("Match Condition")).toBeNull();

    // One: All and Any would match the same data points.
    await addFilter("http.server.duration");
    expect(filterConditionGroup()).toBeNull();

    // Two: now it is a choice, starting on All.
    await addFilter("http.client.duration");

    const group: HTMLElement = await waitFor((): HTMLElement => {
      const found: HTMLElement | null = filterConditionGroup();
      expect(found).not.toBeNull();
      return found!;
    });

    expect(within(group).getByRole("radio", { name: "All" })).toBeChecked();
    expect(within(group).getByRole("radio", { name: "Any" })).not.toBeChecked();

    // Under the filters it combines, not above them.
    const lastFilter: HTMLElement = filterValueBoxes()[1]!;
    expect(
      lastFilter.compareDocumentPosition(group) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // Back to one: gone again.
    await act(async (): Promise<void> => {
      fireEvent.click(
        within(dialog()).getAllByRole("button", { name: "Delete Filter" })[1]!,
      );
    });

    await waitFor(() => {
      expect(filterConditionGroup()).toBeNull();
    });
  });

  test("creates a rule from Action, on, for every service, combining with All", async () => {
    await openCreateForm();
    await nameRule("Drop debug metrics");
    await addFilter("debug.metric");

    await pressNext();
    await pickRuleType(MetricPipelineRuleType.Drop);

    expect(
      within(dialog()).getByTestId("modal-footer-submit-button"),
    ).toHaveTextContent(`Create ${PIPELINE_RULE_SINGULAR}`);

    await submit();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const model: JSONObject = sentModel();
    expect(model["name"]).toBe("Drop debug metrics");
    expect(model["ruleType"]).toBe(MetricPipelineRuleType.Drop);
    // Never asked with one filter: saved at the column's default.
    expect(model["filterCondition"]).toBe(FilterCondition.All);
    expect(model["isEnabled"]).toBe(true);
    expect(model["service"] || undefined).toBeUndefined();
    expect(
      (model["filters"] as unknown as Array<MetricPipelineRuleFilterCondition>)
        .length,
    ).toBe(1);
    const [filter] = model[
      "filters"
    ] as unknown as Array<MetricPipelineRuleFilterCondition>;
    expect({
      checkOn: filter?.checkOn,
      conditionType: filter?.conditionType,
      value: filter?.value,
    }).toEqual(metricNameFilter("debug.metric"));
  });

  test("creates a rule that matches any of its filters, once two ask for it", async () => {
    const user: UserEvent = await openCreateForm();
    await nameRule("Drop health checks");
    await addFilter("healthcheck.count");
    await addFilter("readiness.count");

    const group: HTMLElement = await waitFor((): HTMLElement => {
      const found: HTMLElement | null = filterConditionGroup();
      expect(found).not.toBeNull();
      return found!;
    });

    await user.click(within(group).getByRole("radio", { name: "Any" }));

    await pressNext();
    await pickRuleType(MetricPipelineRuleType.Drop);
    await submit();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const model: JSONObject = sentModel();
    expect(model["filterCondition"]).toBe(FilterCondition.Any);
    expect(
      (
        model["filters"] as unknown as Array<MetricPipelineRuleFilterCondition>
      ).map((filter: MetricPipelineRuleFilterCondition) => {
        return filter.value;
      }),
    ).toEqual(["healthcheck.count", "readiness.count"]);
  });

  /*
   * The filter rows were keyed by their place: removing the first of two
   * left it on screen, holding the removed filter, while the form held the
   * other one - and the next edit to that row overwrote the one kept.
   */
  test("REGRESSION: removing the first of two filters keeps the second, on screen and in the rule", async () => {
    await openCreateForm();
    await nameRule("Drop one metric");
    await addFilter("first.metric");
    await addFilter("second.metric");

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(dialog()).getAllByRole("button", { name: "Delete Filter" })[0]!,
      );
    });

    await waitFor(() => {
      expect(filterValueBoxes()).toHaveLength(1);
    });
    expect(filterValueBoxes()[0]).toHaveValue("second.metric");

    // An edit to the row that is left changes that filter.
    fireEvent.change(filterValueBoxes()[0]!, {
      target: { value: "second.metric.renamed" },
    });

    await pressNext();
    await pickRuleType(MetricPipelineRuleType.Drop);
    await submit();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    expect(
      (
        sentModel()[
          "filters"
        ] as unknown as Array<MetricPipelineRuleFilterCondition>
      ).map((filter: MetricPipelineRuleFilterCondition) => {
        return filter.value;
      }),
    ).toEqual(["second.metric.renamed"]);
  });

  /*
   * The filters editor sits on the first step now. It reported the filters
   * it was handed as soon as it was drawn, and BasicForm took a value
   * reported before it had filled in its defaults for the user's own edit
   * and filled in none: a rule created as the form opened was saved with no
   * Filter Condition, and switched off although its switch showed on. Both
   * ends are fixed - the editor reports only changes, and BasicForm fills
   * in the defaults of the fields still empty - and either alone passes.
   */
  test("REGRESSION: a rule created as the form opened is saved on, combining with All, matching everything", async () => {
    await openCreateForm();
    await nameRule("Drop everything for now");

    // The switch says on before anyone touches it...
    await act(async (): Promise<void> => {
      fireEvent.click(moreFieldsHeader());
    });
    expect(
      within(dialog()).getByRole("switch", { name: "Enabled" }),
    ).toBeChecked();

    await pressNext();
    await pickRuleType(MetricPipelineRuleType.Drop);
    await submit();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    // ...and so does the rule it saves.
    const model: JSONObject = sentModel();
    expect(model["isEnabled"]).toBe(true);
    expect(model["filterCondition"]).toBe(FilterCondition.All);
    // No filters: an empty list, which matches every data point.
    expect(model["filters"]).toEqual([]);
  });

  test("will not go on from Match without a name", async () => {
    await openCreateForm();

    await pressNext();

    expect(
      await within(dialog()).findByText(/Name is required/i),
    ).toBeInTheDocument();
    expect(within(dialog()).queryByText("Rule Type")).toBeNull();
  });

  test("scopes a rule to one service from More fields, and says so on the header", async () => {
    await openCreateForm();
    await nameRule("Drop checkout noise");

    await act(async (): Promise<void> => {
      fireEvent.click(moreFieldsHeader());
    });

    const picker: HTMLElement = await within(dialog()).findByRole("combobox", {
      name: /^Only for one service/,
    });
    expect(
      within(dialog()).getByText(
        "Leave empty for a rule that applies to every service. Rules for one service run before the project-wide ones.",
      ),
    ).toBeVisible();
    expect(
      within(dialog()).getByRole("switch", { name: "Enabled" }),
    ).toBeChecked();

    await act(async (): Promise<void> => {
      fireEvent.focus(picker);
    });
    await settle(30);

    const menu: HTMLElement = screen.getByTestId("entity-dropdown-menu");

    await act(async (): Promise<void> => {
      fireEvent.click(within(menu).getByRole("option", { name: "checkout" }));
    });

    // Folded again, the header names the service instead of the defaults.
    await act(async (): Promise<void> => {
      fireEvent.click(moreFieldsHeader());
    });

    await waitFor(() => {
      expect(setChips(dialog())).toEqual(["Only for one service: checkout"]);
    });
    expect(moreFieldsSummary()).toBeNull();

    await pressNext();
    await pickRuleType(MetricPipelineRuleType.Drop);
    await submit();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const service: BaseModel | undefined = sentModel()["service"] as
      | BaseModel
      | undefined;
    expect(service?._id?.toString()).toBe(CHECKOUT_SERVICE_ID);
  });

  test("stages a rule switched off from More fields", async () => {
    const user: UserEvent = await openCreateForm();
    await nameRule("Staged drop");

    await user.click(moreFieldsHeader());
    await user.click(within(dialog()).getByRole("switch", { name: "Enabled" }));
    await user.click(moreFieldsHeader());

    await waitFor(() => {
      expect(setChips(dialog())).toEqual(["Enabled: Off"]);
    });
    expect(moreFieldsSummary()).toBeNull();

    await pressNext();
    await pickRuleType(MetricPipelineRuleType.Drop);
    await submit();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });
    expect(sentModel()["isEnabled"]).toBe(false);
  });

  test("keeps the drag order of the list, which is the order rules run in", async () => {
    await openCreateForm();

    expect(mockTable.lastProps?.sortBy).toBe("sortOrder");
    expect(mockTable.lastProps?.enableDragAndDrop).toBe(true);
    expect(mockTable.lastProps?.dragDropIndexField).toBe("sortOrder");
  });

  describe("edited", () => {
    function storedRule(data: Record<string, unknown>): BaseModel {
      return Object.assign(new MetricPipelineRule(), {
        _id: RULE_ID,
        name: "Noisy metrics",
        ruleType: MetricPipelineRuleType.Drop,
        filterCondition: FilterCondition.All,
        filters: [metricNameFilter("noisy.metric")],
        isEnabled: true,
        ...data,
      });
    }

    async function openEditForm(rule: BaseModel): Promise<void> {
      getItemMock.mockImplementation((() => {
        return Promise.resolve(rule);
      }) as never);

      await renderPage(MetricPipelineRulesPage, "edit");

      await within(dialog()).findByDisplayValue("Noisy metrics");
      await settle();
    }

    test("opens on Match with the stored filters, and no Match Condition for one of them", async () => {
      await openEditForm(storedRule({}));

      await waitFor(() => {
        expect(filterValueBoxes()).toHaveLength(1);
      });
      expect(filterValueBoxes()[0]).toHaveValue("noisy.metric");
      expect(filterConditionGroup()).toBeNull();

      // At its defaults: folded, nothing set.
      expect(moreFieldsHeader()).toHaveAttribute("aria-expanded", "false");
      expect(setChips(dialog())).toEqual([]);
    });

    test("shows the stored Any for a rule with two filters", async () => {
      await openEditForm(
        storedRule({
          filterCondition: FilterCondition.Any,
          filters: [
            metricNameFilter("first.metric"),
            metricNameFilter("second.metric"),
          ],
        }),
      );

      const group: HTMLElement = await waitFor((): HTMLElement => {
        const found: HTMLElement | null = filterConditionGroup();
        expect(found).not.toBeNull();
        return found!;
      });

      expect(within(group).getByRole("radio", { name: "Any" })).toBeChecked();
    });

    test("says on the folded header that a stored rule is switched off", async () => {
      await openEditForm(storedRule({ isEnabled: false }));

      await waitFor(() => {
        expect(setChips(dialog())).toEqual(["Enabled: Off"]);
      });
      expect(moreFieldsSummary()).toBeNull();
    });

    test("names the service a stored rule is for, and saves the rule as it was", async () => {
      const checkout: Service = new Service();
      checkout._id = CHECKOUT_SERVICE_ID;
      checkout.name = "checkout";

      await openEditForm(
        storedRule({
          service: checkout,
          serviceId: new ObjectID(CHECKOUT_SERVICE_ID),
          filterCondition: FilterCondition.Any,
          filters: [
            metricNameFilter("first.metric"),
            metricNameFilter("second.metric"),
          ],
        }),
      );

      await waitFor(() => {
        expect(setChips(dialog())).toEqual(["Only for one service: checkout"]);
      });

      // To Action from the step list, and save without changing anything.
      const steps: HTMLElement = within(dialog()).getByRole("navigation", {
        name: "Progress",
      });
      const stepItems: Array<HTMLElement> =
        within(steps).getAllByRole("listitem");

      await act(async (): Promise<void> => {
        fireEvent.click(stepItems[stepItems.length - 1]!);
      });
      await within(dialog()).findByTestId(
        `card-select-option-${MetricPipelineRuleType.Drop}`,
      );
      await submit();

      await waitFor(() => {
        expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
      });

      const model: JSONObject = sentModel();
      expect(model["filterCondition"]).toBe(FilterCondition.Any);
      expect(
        (
          model[
            "filters"
          ] as unknown as Array<MetricPipelineRuleFilterCondition>
        ).map((filter: MetricPipelineRuleFilterCondition) => {
          return filter.value;
        }),
      ).toEqual(["first.metric", "second.metric"]);
      expect((model["service"] as BaseModel | undefined)?._id?.toString()).toBe(
        CHECKOUT_SERVICE_ID,
      );
      expect(model["isEnabled"]).toBe(true);
    });
  });
});

interface RecordingRulePage {
  label: string;
  page: Page;
  singularName: string;
  existing: () => BaseModel;
  // What the definition needs before it can be saved, if anything.
  completeDefinition: () => Promise<void>;
}

const RECORDING_RULE_PAGES: Array<RecordingRulePage> = [
  {
    label: "Metrics > Settings > Recording Rules",
    page: MetricRecordingRulesPage,
    singularName: "Metric Recording Rule",
    existing: (): BaseModel => {
      return new MetricRecordingRule();
    },
    // Source A's metric: the only thing an empty definition lacks.
    completeDefinition: async (): Promise<void> => {
      fireEvent.change(
        within(dialog()).getByPlaceholderText("e.g. http.server.errors"),
        { target: { value: "http.server.errors" } },
      );
    },
  },
  {
    label: "Traces > Settings > Recording Rules",
    page: TraceRecordingRulesPage,
    singularName: "Trace Recording Rule",
    existing: (): BaseModel => {
      return new TraceRecordingRule();
    },
    // An empty trace definition counts every span: complete as it is.
    completeDefinition: async (): Promise<void> => {},
  },
];

describe.each(RECORDING_RULE_PAGES)("$label", (entry: RecordingRulePage) => {
  async function openCreateForm(): Promise<UserEvent> {
    const user: UserEvent = await renderPage(entry.page);

    expect(
      await screen.findByText(`Create New ${entry.singularName}`),
    ).toBeInTheDocument();
    await settle();

    return user;
  }

  test("is one page: the name, its output metric line and the definition", async () => {
    await openCreateForm();

    // No step list, no Next: the one button creates.
    expect(
      within(dialog()).queryByRole("navigation", { name: "Progress" }),
    ).toBeNull();
    expect(
      within(dialog()).queryByTestId("modal-footer-next-button"),
    ).toBeNull();
    expect(
      within(dialog()).getByTestId("modal-footer-submit-button"),
    ).toHaveTextContent(`Create ${entry.singularName}`);
    expect(within(dialog()).queryByText("Basic Info")).toBeNull();

    const name: HTMLElement = within(dialog()).getByRole("textbox", {
      name: "Name",
    });
    const outputMetricLine: HTMLElement = within(dialog()).getByTestId(
      "generated-key-field",
    );
    const definition: HTMLElement = within(dialog()).getByText("Definition");

    // The name, the line made from it right under it, then the definition.
    expect(
      name.compareDocumentPosition(outputMetricLine) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      outputMetricLine.compareDocumentPosition(definition) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(within(dialog()).getByText("Expression")).toBeVisible();
  });

  test("folds the description and Enabled under More fields, saying what the rule will do", async () => {
    await openCreateForm();

    expect(moreFieldsHeader()).toHaveAttribute("aria-expanded", "false");
    expect(listedNames(dialog())).toEqual(["Description", "Enabled"]);
    expect(setChips(dialog())).toEqual([]);
    await waitFor(() => {
      expect(moreFieldsSummary()).toBe(RECORDING_RULE_DEFAULTS_SUMMARY);
    });
    expect(within(dialog()).queryByRole("switch")).toBeNull();
  });

  test("creates a rule on, from the one page, leaving the output metric name and the order to the server", async () => {
    await openCreateForm();

    fireEvent.change(within(dialog()).getByRole("textbox", { name: "Name" }), {
      target: { value: "Checkout error rate" },
    });
    await entry.completeDefinition();

    await submit();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const model: JSONObject = sentModel();
    expect(model["name"]).toBe("Checkout error rate");
    expect(model["isEnabled"]).toBe(true);
    expect(model["outputMetricName"] || undefined).toBeUndefined();
    // No made-up evaluation order: the column's default is kept.
    expect(model["sortOrder"]).toBeUndefined();
    expect(model["definition"]).toBeTruthy();
  });

  test("stages a rule switched off, saying so on the folded header", async () => {
    const user: UserEvent = await openCreateForm();

    fireEvent.change(within(dialog()).getByRole("textbox", { name: "Name" }), {
      target: { value: "Paused rule" },
    });
    await entry.completeDefinition();

    await user.click(moreFieldsHeader());
    await user.click(within(dialog()).getByRole("switch", { name: "Enabled" }));
    await user.click(moreFieldsHeader());

    await waitFor(() => {
      expect(setChips(dialog())).toEqual(["Enabled: Off"]);
    });
    expect(moreFieldsSummary()).toBeNull();

    await submit();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });
    expect(sentModel()["isEnabled"]).toBe(false);
  });

  test("will not create a rule without a name", async () => {
    await openCreateForm();
    await entry.completeDefinition();

    await submit();

    expect(
      await within(dialog()).findByText(/Name is required/i),
    ).toBeInTheDocument();
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });

  /*
   * Every enabled rule is evaluated each minute on its own: the stored
   * sortOrder is read by nothing, so the list is in name order.
   */
  test("lists rules by name, with no drag order to keep", async () => {
    await openCreateForm();

    expect(mockTable.lastProps?.sortBy).toBe("name");
    expect(mockTable.lastProps?.sortOrder).toBe(SortOrder.Ascending);
    expect(mockTable.lastProps?.enableDragAndDrop).toBeFalsy();
    expect(mockTable.lastProps?.onBeforeCreate).toBeUndefined();
  });

  describe("edited", () => {
    test("keeps the output metric name an ordinary field under the name, and Enabled folded", async () => {
      getItemMock.mockImplementation((() => {
        return Promise.resolve(
          Object.assign(entry.existing(), {
            _id: RULE_ID,
            name: "Checkout error rate",
            outputMetricName: "checkout_error_rate",
            isEnabled: false,
          }),
        );
      }) as never);

      await renderPage(entry.page, "edit");

      const outputMetricName: HTMLElement = await within(dialog()).findByRole(
        "textbox",
        { name: /^Output Metric Name/ },
      );
      expect(outputMetricName).toHaveValue("checkout_error_rate");
      expect(
        within(dialog()).queryByRole("navigation", { name: "Progress" }),
      ).toBeNull();
      expect(
        within(dialog())
          .getByRole("textbox", { name: "Name" })
          .compareDocumentPosition(outputMetricName) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();

      await waitFor(() => {
        expect(setChips(dialog())).toEqual(["Enabled: Off"]);
      });
      expect(moreFieldsHeader()).toHaveAttribute("aria-expanded", "false");
    });
  });
});

describe("Traces > Settings > Recording Rules, opened from Create metric", () => {
  test("creates the rule the analytics view prefilled, from the one page", async () => {
    const definition: TraceRecordingRuleDefinition = {
      sources: [
        {
          alias: "A",
          aggregationType: TraceAggregationType.ErrorCount,
          spanNameRegex: "^checkout",
        },
      ],
      expression: "A",
      groupByAttribute: "service.name",
    };

    window.history.replaceState(
      window.history.state,
      "",
      `/dashboard/traces/settings/recording-rules?prefill=${encodeURIComponent(
        JSON.stringify(definition),
      )}`,
    );

    await renderPage(TraceRecordingRulesPage);

    expect(
      await screen.findByText("Create New Trace Recording Rule"),
    ).toBeInTheDocument();
    expect(mockTable.lastProps?.showCreateForm).toBe(true);

    // The definition arrived filled in: the name is all that is asked.
    fireEvent.change(within(dialog()).getByRole("textbox", { name: "Name" }), {
      target: { value: "Checkout errors" },
    });

    await submit();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const model: JSONObject = sentModel();
    expect(model["name"]).toBe("Checkout errors");
    expect(model["definition"]).toMatchObject({
      expression: "A",
      groupByAttribute: "service.name",
      sources: [
        {
          alias: "A",
          aggregationType: TraceAggregationType.ErrorCount,
          spanNameRegex: "^checkout",
        },
      ],
    });
    expect(model["sortOrder"]).toBeUndefined();
  });
});

describe("what the folded More fields header says while left alone", () => {
  test("a pipeline rule: every service, on - until one of them is set", () => {
    expect(getPipelineRuleAdvancedSummary({})).toEqual([
      PIPELINE_RULE_DEFAULTS_SUMMARY,
    ]);
    expect(
      getPipelineRuleAdvancedSummary({ isEnabled: true, description: "  " }),
    ).toEqual([PIPELINE_RULE_DEFAULTS_SUMMARY]);
    expect(
      getPipelineRuleAdvancedSummary({ description: "Why it drops" }),
    ).toBeUndefined();
    expect(
      getPipelineRuleAdvancedSummary({ isEnabled: false }),
    ).toBeUndefined();
    expect(
      getPipelineRuleAdvancedSummary({
        service: CHECKOUT_SERVICE_ID,
      } as never),
    ).toBeUndefined();
    // A pick held as the option it was picked as.
    expect(
      getPipelineRuleAdvancedSummary({
        service: { label: "checkout", value: CHECKOUT_SERVICE_ID },
      } as never),
    ).toBeUndefined();
    expect(getPipelineRuleAdvancedSummary({ service: "" } as never)).toEqual([
      PIPELINE_RULE_DEFAULTS_SUMMARY,
    ]);
  });

  test("a recording rule: on, writing every minute - until one of them is set", () => {
    expect(getRecordingRuleAdvancedSummary({})).toEqual([
      RECORDING_RULE_DEFAULTS_SUMMARY,
    ]);
    expect(getRecordingRuleAdvancedSummary({ isEnabled: true })).toEqual([
      RECORDING_RULE_DEFAULTS_SUMMARY,
    ]);
    expect(
      getRecordingRuleAdvancedSummary({ description: "Error rate" }),
    ).toBeUndefined();
    expect(
      getRecordingRuleAdvancedSummary({ isEnabled: false }),
    ).toBeUndefined();
  });

  test("both summaries read right on Create and on Edit alike", () => {
    // Said of a save, so they hold for a rule being created or changed.
    expect(PIPELINE_RULE_DEFAULTS_SUMMARY).toContain("being saved");
    expect(RECORDING_RULE_DEFAULTS_SUMMARY).toContain("being saved");
    expect(PIPELINE_RULE_DEFAULTS_SUMMARY).not.toContain("created");
    expect(RECORDING_RULE_DEFAULTS_SUMMARY).not.toContain("created");
  });
});
