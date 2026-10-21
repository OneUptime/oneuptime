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
import Route from "../../../Types/API/Route";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { FormType, ModelField } from "../../../UI/Components/Forms/ModelForm";
import ModelFormModal from "../../../UI/Components/ModelFormModal/ModelFormModal";
import { ComponentProps as ModelTableProps } from "../../../UI/Components/ModelTable/ModelTable";
import Column from "../../../UI/Components/ModelTable/Column";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Logs > Settings > Recording Rules: the page a log recording rule is made
 * on, drawn for real - its fields in the ModelFormModal, ModelForm and
 * BasicForm its table opens, the definition editor inside them - with only
 * the table around them, the network and the permissions stubbed.
 *
 * It is the metric and trace recording rule pages' sibling and asks the
 * same two questions on one page - the name (the output metric line made
 * from it) and the definition - with the description and Enabled folded.
 * The definition editor is the log rule's own: which logs, the aggregation
 * and its numeric attribute, up to five group-by attributes and the unit,
 * saying what the rule will write.
 */

configure({ asyncUtilTimeout: 15000 });

const NEW_ID: string = "55555555-5555-4555-8555-555555555555";
const RULE_ID: string = "66666666-6666-4666-8666-666666666666";
const CHECKOUT_SERVICE_ID: string = "77777777-7777-4777-8777-777777777777";

const LOG_ATTRIBUTE_KEYS: Array<string> = [
  "gw_name",
  "jitter",
  "latency",
  "log_component",
  "profile_name",
];

interface MockTable {
  mode: "create" | "edit";
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

import LogRecordingRulesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Logs/Settings/RecordingRules";
import { RECORDING_RULE_DEFAULTS_SUMMARY } from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/RecordingRule/RecordingRuleForm";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import LogRecordingRule from "../../../Models/DatabaseModels/LogRecordingRule";
import Service from "../../../Models/DatabaseModels/Service";
import AggregationType from "../../../Types/BaseDatabase/AggregationType";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import LogRecordingRuleDefinition, {
  LOG_RECORDING_RULE_MAX_GROUP_BY_ATTRIBUTES,
  LogRecordingRuleDefinitionUtil,
} from "../../../Types/Log/LogRecordingRuleDefinition";
import API from "../../../UI/Utils/API/API";
import {
  listedNames,
  setChips,
} from "../../UI/Components/FoldedSection/FoldedSectionQueries";

const SINGULAR_NAME: string = "Log Recording Rule";

function dialog(): HTMLElement {
  return screen.getByTestId("modal");
}

async function settle(milliseconds: number = 0): Promise<void> {
  await act(async (): Promise<void> => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, milliseconds);
    });
  });
}

async function renderPage(
  mode: MockTable["mode"] = "create",
): Promise<UserEvent> {
  mockTable.mode = mode;

  const props: PageComponentProps = {
    pageRoute: new Route("/dashboard/:projectId/logs/settings/recording-rules"),
  } as unknown as PageComponentProps;

  await act(async (): Promise<void> => {
    render(<LogRecordingRulesPage {...props} />);
  });

  await settle();

  return userEvent.setup({ delay: null });
}

async function openCreateForm(): Promise<UserEvent> {
  const user: UserEvent = await renderPage();

  expect(
    await screen.findByText(`Create New ${SINGULAR_NAME}`),
  ).toBeInTheDocument();
  await settle();

  return user;
}

function sentModel(): JSONObject {
  return (createOrUpdateMock.mock.calls[0]?.[0] as { model: unknown })
    .model as JSONObject;
}

function sentDefinition(): LogRecordingRuleDefinition {
  return sentModel()["definition"] as unknown as LogRecordingRuleDefinition;
}

async function submit(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(within(dialog()).getByTestId("modal-footer-submit-button"));
  });
}

function moreFieldsHeader(): HTMLElement {
  return within(dialog()).getByRole("button", { name: "More fields" });
}

function moreFieldsSummary(): string | null {
  const summary: HTMLElement | null = within(dialog()).queryByTestId(
    "collapsible-section-summary",
  );

  return summary ? summary.textContent : null;
}

function typeInto(element: HTMLElement, value: string): void {
  fireEvent.change(element, { target: { value } });
}

async function nameRule(name: string): Promise<void> {
  typeInto(within(dialog()).getByRole("textbox", { name: "Name" }), name);
}

async function chooseAggregation(label: string): Promise<void> {
  const select: HTMLElement = within(dialog()).getByRole("combobox", {
    name: "Aggregation",
  });

  await act(async (): Promise<void> => {
    fireEvent.keyDown(select, { key: "ArrowDown", code: "ArrowDown" });
  });

  const option: HTMLElement = await screen.findByRole("option", {
    name: new RegExp(`^${label}`),
  });

  await act(async (): Promise<void> => {
    fireEvent.click(option);
  });
}

async function addGroupBy(key: string): Promise<void> {
  const before: number = groupByInputs().length;

  await act(async (): Promise<void> => {
    fireEvent.click(
      within(dialog()).getByRole("button", { name: "Add Group By Attribute" }),
    );
  });

  await waitFor(() => {
    expect(groupByInputs()).toHaveLength(before + 1);
  });

  typeInto(groupByInputs()[before]!, key);
}

function groupByInputs(): Array<HTMLElement> {
  return within(dialog()).queryAllByRole("combobox", {
    name: /^Group by attribute \d+$/,
  });
}

function summaryLine(): string {
  return within(dialog()).getByTestId("log-recording-rule-summary")
    .textContent as string;
}

function services(): Array<Service> {
  const checkout: Service = new Service();
  checkout._id = CHECKOUT_SERVICE_ID;
  checkout.name = "checkout";
  return [checkout];
}

let apiPost: ReturnType<typeof jest.spyOn>;

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
  }): Promise<unknown> => {
    if (request.modelType === Service) {
      const rows: Array<Service> = services();
      return { data: rows, count: rows.length, skip: 0, limit: 10 };
    }

    return { data: [], count: 0, skip: 0, limit: 10 };
  }) as never);

  // The log attribute keys the key fields suggest.
  apiPost = jest.spyOn(API, "post").mockImplementation((async () => {
    return { data: { attributes: LOG_ATTRIBUTE_KEYS } };
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Logs > Settings > Recording Rules", () => {
  test("is one page: the name, its output metric line and the definition", async () => {
    await openCreateForm();

    expect(
      within(dialog()).queryByRole("navigation", { name: "Progress" }),
    ).toBeNull();
    expect(
      within(dialog()).queryByTestId("modal-footer-next-button"),
    ).toBeNull();
    expect(
      within(dialog()).getByTestId("modal-footer-submit-button"),
    ).toHaveTextContent(`Create ${SINGULAR_NAME}`);

    const name: HTMLElement = within(dialog()).getByRole("textbox", {
      name: "Name",
    });
    const outputMetricLine: HTMLElement = within(dialog()).getByTestId(
      "generated-key-field",
    );
    const definition: HTMLElement = within(dialog()).getByText("Definition");

    expect(
      name.compareDocumentPosition(outputMetricLine) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      outputMetricLine.compareDocumentPosition(definition) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // The definition editor's sections, in reading order.
    for (const heading of [
      "Which Logs",
      "Group By (Optional)",
      "Unit (Optional)",
    ]) {
      expect(within(dialog()).getByText(heading)).toBeVisible();
    }
    expect(
      within(dialog()).getByRole("combobox", { name: "Aggregation" }),
    ).toBeVisible();
  });

  test("starts from a count of every log, and says so", async () => {
    await openCreateForm();

    expect(summaryLine()).toBe("Writes every minute: count");
    // Count needs no numeric attribute, so none is asked for.
    expect(
      within(dialog()).queryByRole("combobox", { name: "Numeric Attribute" }),
    ).toBeNull();
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

  test("creates a count rule on, leaving the output metric name and the defaults to the server", async () => {
    await openCreateForm();
    await nameRule("Error logs");

    await submit();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const model: JSONObject = sentModel();
    expect(model["name"]).toBe("Error logs");
    expect(model["isEnabled"]).toBe(true);
    expect(model["outputMetricName"] || undefined).toBeUndefined();
    expect(model["computedUntil"]).toBeUndefined();
    expect(sentDefinition()).toEqual(
      LogRecordingRuleDefinitionUtil.getEmptyDefinition(),
    );
  });

  test("builds the SD-WAN latency rule: filter, average of latency, two group-by keys, unit", async () => {
    await openCreateForm();
    await nameRule("SD-WAN gateway latency");

    typeInto(
      within(dialog()).getByRole("textbox", { name: "Body Contains" }),
      'log_type="SD-WAN"',
    );

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(dialog()).getByRole("button", { name: "Add Attribute Filter" }),
      );
    });
    typeInto(
      await within(dialog()).findByRole("combobox", {
        name: "Attribute filter 1 key",
      }),
      "log_component",
    );
    typeInto(
      within(dialog()).getByRole("textbox", {
        name: "Attribute filter 1 value",
      }),
      "SLA",
    );

    await chooseAggregation("Average");

    typeInto(
      await within(dialog()).findByRole("combobox", {
        name: "Numeric Attribute",
      }),
      "latency",
    );

    await addGroupBy("gw_name");
    await addGroupBy("profile_name");

    typeInto(within(dialog()).getByRole("textbox", { name: "Unit" }), "ms");

    await waitFor(() => {
      expect(summaryLine()).toBe(
        "Writes every minute: avg(latency) by gw_name, profile_name",
      );
    });

    await submit();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    expect(sentModel()["name"]).toBe("SD-WAN gateway latency");
    expect(sentDefinition()).toEqual({
      filter: {
        telemetryServiceIds: [],
        severityTexts: [],
        body: 'log_type="SD-WAN"',
        attributeFilters: [{ key: "log_component", value: "SLA" }],
      },
      aggregationType: AggregationType.Avg,
      valueAttribute: "latency",
      groupByAttributes: ["gw_name", "profile_name"],
      unit: "ms",
    });
    expect(
      LogRecordingRuleDefinitionUtil.getValidationError(sentDefinition()),
    ).toBeNull();
  });

  test("will not create an average without the attribute it averages", async () => {
    await openCreateForm();
    await nameRule("Latency");
    await chooseAggregation("Average");

    await submit();

    expect(
      await within(dialog()).findByText(
        "Choose the numeric attribute to aggregate (e.g. latency).",
      ),
    ).toBeInTheDocument();
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });

  test("will not create a rule with a half-typed attribute filter", async () => {
    await openCreateForm();
    await nameRule("Half a filter");

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(dialog()).getByRole("button", { name: "Add Attribute Filter" }),
      );
    });
    typeInto(
      await within(dialog()).findByRole("combobox", {
        name: "Attribute filter 1 key",
      }),
      "env",
    );

    await submit();

    expect(
      await within(dialog()).findByText(
        "Each attribute filter needs both a key and a value (or remove the row).",
      ),
    ).toBeInTheDocument();
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });

  test("will not create a rule without a name", async () => {
    await openCreateForm();

    await submit();

    expect(
      await within(dialog()).findByText(/Name is required/i),
    ).toBeInTheDocument();
    expect(createOrUpdateMock).not.toHaveBeenCalled();
  });

  test(`offers at most ${LOG_RECORDING_RULE_MAX_GROUP_BY_ATTRIBUTES} group-by attributes, and removes one on request`, async () => {
    await openCreateForm();

    for (
      let index: number = 0;
      index < LOG_RECORDING_RULE_MAX_GROUP_BY_ATTRIBUTES;
      index++
    ) {
      await addGroupBy(`key_${index}`);
    }

    expect(groupByInputs()).toHaveLength(
      LOG_RECORDING_RULE_MAX_GROUP_BY_ATTRIBUTES,
    );
    expect(
      within(dialog()).queryByRole("button", {
        name: "Add Group By Attribute",
      }),
    ).toBeNull();

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(dialog()).getByRole("button", {
          name: "Remove group by attribute 2",
        }),
      );
    });

    await waitFor(() => {
      expect(groupByInputs()).toHaveLength(
        LOG_RECORDING_RULE_MAX_GROUP_BY_ATTRIBUTES - 1,
      );
    });
    expect(
      groupByInputs().map((input: HTMLElement) => {
        return (input as HTMLInputElement).value;
      }),
    ).toEqual(["key_0", "key_2", "key_3", "key_4"]);
    expect(
      within(dialog()).getByRole("button", { name: "Add Group By Attribute" }),
    ).toBeVisible();
  });

  test("suggests the attribute keys the project's logs carry", async () => {
    await openCreateForm();
    await chooseAggregation("Average");

    expect(apiPost).toHaveBeenCalled();
    expect(
      String((apiPost.mock.calls[0]![0] as { url: unknown }).url),
    ).toContain("/telemetry/logs/get-attributes");

    const valueAttribute: HTMLElement = await within(dialog()).findByRole(
      "combobox",
      { name: "Numeric Attribute" },
    );

    await act(async (): Promise<void> => {
      fireEvent.focus(valueAttribute);
    });
    typeInto(valueAttribute, "lat");

    const suggestion: HTMLElement = await screen.findByRole("option", {
      name: "latency",
    });

    await act(async (): Promise<void> => {
      fireEvent.click(suggestion);
    });

    await waitFor(() => {
      expect(valueAttribute).toHaveValue("latency");
    });
  });

  test("lists the project's services to limit the rule to", async () => {
    await openCreateForm();

    expect(
      getListMock.mock.calls.some((call: Array<unknown>): boolean => {
        return (call[0] as { modelType?: unknown }).modelType === Service;
      }),
    ).toBe(true);

    await act(async (): Promise<void> => {
      fireEvent.keyDown(
        within(dialog()).getByRole("combobox", { name: "Telemetry Services" }),
        { key: "ArrowDown", code: "ArrowDown" },
      );
    });

    await act(async (): Promise<void> => {
      fireEvent.click(await screen.findByRole("option", { name: "checkout" }));
    });

    await nameRule("Checkout logs");
    await submit();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });
    expect(sentDefinition().filter.telemetryServiceIds).toEqual([
      CHECKOUT_SERVICE_ID,
    ]);
  });

  test("still opens when the attribute keys cannot be fetched", async () => {
    apiPost.mockImplementation((async () => {
      throw new Error("offline");
    }) as never);

    await openCreateForm();
    await chooseAggregation("Sum");

    expect(
      await within(dialog()).findByRole("combobox", {
        name: "Numeric Attribute",
      }),
    ).toBeVisible();
  });

  test("lists rules by name, with no drag order to keep", async () => {
    await openCreateForm();

    expect(mockTable.lastProps?.sortBy).toBe("name");
    expect(mockTable.lastProps?.sortOrder).toBe(SortOrder.Ascending);
    expect(mockTable.lastProps?.enableDragAndDrop).toBeFalsy();
    expect(mockTable.lastProps?.onBeforeCreate).toBeUndefined();
  });

  test("the list says what each rule computes and how far it has written", async () => {
    await openCreateForm();

    const columns: Array<Column<BaseModel>> = (mockTable.lastProps?.columns ||
      []) as Array<Column<BaseModel>>;
    const titles: Array<string> = columns.map((column: Column<BaseModel>) => {
      return column.title || "";
    });

    expect(titles).toEqual([
      "Name",
      "Output Metric",
      "Computes",
      "Computed Until",
      "Enabled",
    ]);

    const computes: Column<BaseModel> = columns[2]!;
    const rule: LogRecordingRule = new LogRecordingRule();
    rule.definition = {
      filter: {},
      aggregationType: AggregationType.P95,
      valueAttribute: "latency",
      groupByAttributes: ["gw_name"],
    };

    const { container } = render(computes.getElement!(rule) as ReactElement);
    expect(container.textContent).toBe("p95(latency) by gw_name");
  });

  describe("edited", () => {
    test("opens the stored definition in the editor, with the output metric name an ordinary field", async () => {
      getItemMock.mockImplementation((() => {
        return Promise.resolve(
          Object.assign(new LogRecordingRule(), {
            _id: RULE_ID,
            name: "SD-WAN gateway latency",
            outputMetricName: "sdwan.gateway.latency.ms",
            isEnabled: false,
            definition: {
              filter: {
                attributeFilters: [{ key: "log_component", value: "SLA" }],
              },
              aggregationType: AggregationType.Avg,
              valueAttribute: "latency",
              groupByAttributes: ["gw_name"],
              unit: "ms",
            },
          }),
        );
      }) as never);

      await renderPage("edit");

      const outputMetricName: HTMLElement = await within(dialog()).findByRole(
        "textbox",
        { name: /^Output Metric Name/ },
      );
      expect(outputMetricName).toHaveValue("sdwan.gateway.latency.ms");

      await waitFor(() => {
        expect(summaryLine()).toBe(
          "Writes every minute: avg(latency) by gw_name",
        );
      });
      expect(
        within(dialog()).getByRole("combobox", { name: "Numeric Attribute" }),
      ).toHaveValue("latency");
      expect(groupByInputs()[0]).toHaveValue("gw_name");
      expect(
        within(dialog()).getByRole("textbox", {
          name: "Attribute filter 1 value",
        }),
      ).toHaveValue("SLA");
      expect(
        within(dialog()).getByRole("textbox", { name: "Unit" }),
      ).toHaveValue("ms");

      await waitFor(() => {
        expect(setChips(dialog())).toEqual(["Enabled: Off"]);
      });
    });
  });
});
