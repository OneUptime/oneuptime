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
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import React, { FunctionComponent, ReactElement } from "react";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { FormType, ModelField } from "../../../UI/Components/Forms/ModelForm";
import ModelFormModal from "../../../UI/Components/ModelFormModal/ModelFormModal";
import { ComponentProps as ModelTableProps } from "../../../UI/Components/ModelTable/ModelTable";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The settings forms that used to ask for a key, drawn for real: each
 * page's own fields in the same ModelFormModal, ModelForm and BasicForm its
 * table opens, with only the network, the permissions and the table around
 * them stubbed.
 *
 * The maintainer, on the Create New Incident Measurement form: "we have
 * this thing called a key, but it should be automatically generated based
 * on the name. If a human wants to edit it, they can edit it as well, but
 * please don't require an input from a human."
 *
 *   - Incident, alert and scheduled maintenance measurements: the Key is a
 *     line under the Name that follows it, with Edit; the create goes
 *     through without one and leaves the key out for the server to make,
 *     or sends the key someone typed. The Edit form has no key at all: it
 *     never changes.
 *   - Metric and trace recording rules: the Output Metric Name is made from
 *     the rule's name the same way on Create - one page, the name and the
 *     definition - and stays an ordinary field on Edit, where a rule's
 *     output can still be renamed.
 */

configure({ asyncUtilTimeout: 15000 });

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const RECORD_ID: string = "33333333-3333-4333-8333-333333333333";

interface MockTable {
  mode: "create" | "edit";
}

const mockTable: MockTable = { mode: "create" };

const createOrUpdateMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: ModelTableProps<BaseModel>): ReactElement => {
      const fields: Array<ModelField<BaseModel>> = props.formFields || [];
      const isCreate: boolean = mockTable.mode === "create";

      return (
        <ModelFormModal<BaseModel>
          title={isCreate ? "Create" : "Edit"}
          modelType={props.modelType}
          submitButtonText={isCreate ? "Create" : "Save Changes"}
          onClose={() => {}}
          {...(isCreate ? {} : { modelIdToEdit: new ObjectID(RECORD_ID) })}
          formProps={{
            id: "generated-key-form",
            name: "generated-key-form",
            modelType: props.modelType,
            // What the real table hands each form.
            fields: fields.filter((field: ModelField<BaseModel>): boolean => {
              return isCreate
                ? !field.doNotShowWhenCreating
                : !field.doNotShowWhenEditing;
            }),
            steps: props.formSteps || [],
            formType: isCreate ? FormType.Create : FormType.Update,
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
        return [Permission.ProjectOwner];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return true;
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

import IncidentMeasurementsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentMeasurements";
import AlertMeasurementsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/Settings/AlertMeasurements";
import ScheduledMaintenanceMeasurementsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceMeasurements";
import MetricRecordingRulesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Metrics/Settings/RecordingRules";
import TraceRecordingRulesPage from "../../../../App/FeatureSet/Dashboard/src/Pages/Traces/Settings/RecordingRules";
import IncidentMeasurement from "../../../Models/DatabaseModels/IncidentMeasurement";
import AlertMeasurement from "../../../Models/DatabaseModels/AlertMeasurement";
import ScheduledMaintenanceMeasurement from "../../../Models/DatabaseModels/ScheduledMaintenanceMeasurement";
import MetricRecordingRule from "../../../Models/DatabaseModels/MetricRecordingRule";
import TraceRecordingRule from "../../../Models/DatabaseModels/TraceRecordingRule";
import Route from "../../../Types/API/Route";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";

type Page = FunctionComponent<PageComponentProps>;

async function renderPage(
  page: Page,
  mode: MockTable["mode"],
): Promise<UserEvent> {
  mockTable.mode = mode;
  const PageComponent: Page = page;

  await act(async (): Promise<void> => {
    render(
      <PageComponent
        pageRoute={new Route("/dashboard/project/settings")}
        currentProject={null}
        hasPaymentMethod={true}
      />,
    );
  });

  return userEvent.setup({ delay: null });
}

function form(): HTMLElement {
  return screen.getByRole("dialog");
}

function savedModel(): Record<string, unknown> {
  return (createOrUpdateMock.mock.calls[0]?.[0] as { model: BaseModel })
    .model as unknown as Record<string, unknown>;
}

// react-select opens on a click; its options are portalled to the body.
async function pickOption(
  user: UserEvent,
  combobox: HTMLElement,
  optionText: string,
): Promise<void> {
  await user.click(combobox);
  const options: Array<HTMLElement> = await screen.findAllByText(optionText, {
    exact: true,
  });
  await user.click(options[options.length - 1]!);
}

async function clickNext(user: UserEvent): Promise<void> {
  await user.click(within(form()).getByRole("button", { name: "Next" }));
}

beforeEach(() => {
  createOrUpdateMock.mockReset().mockImplementation(((data: {
    model: BaseModel;
  }): Promise<unknown> => {
    return Promise.resolve({ data: data.model });
  }) as never);
  getItemMock.mockReset();
  getListMock.mockReset().mockImplementation((() => {
    return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
  }) as never);
});

afterEach(() => {
  cleanup();
});

interface MeasurementPage {
  label: string;
  page: Page;
  existing: () => BaseModel;
  name: string;
  key: string;
  // Where it ends, as "Ends when" lists it; it starts where most do.
  endMoment: string;
}

const MEASUREMENT_PAGES: Array<MeasurementPage> = [
  {
    label: "Incident measurements",
    page: IncidentMeasurementsPage,
    existing: (): BaseModel => {
      return new IncidentMeasurement();
    },
    name: "Time to Detect",
    key: "time-to-detect",
    endMoment: "The incident is acknowledged",
  },
  {
    label: "Alert measurements",
    page: AlertMeasurementsPage,
    existing: (): BaseModel => {
      return new AlertMeasurement();
    },
    name: "Time to Acknowledge",
    key: "time-to-acknowledge",
    endMoment: "The alert is acknowledged",
  },
  {
    label: "Scheduled maintenance measurements",
    page: ScheduledMaintenanceMeasurementsPage,
    existing: (): BaseModel => {
      return new ScheduledMaintenanceMeasurement();
    },
    name: "Start Delay",
    key: "start-delay",
    endMoment: "The maintenance starts",
  },
];

describe.each(MEASUREMENT_PAGES)("$label", (entry: MeasurementPage) => {
  // Goes on to Start and End, picks where it ends, and creates.
  async function finishCreate(user: UserEvent): Promise<void> {
    await clickNext(user);
    await pickOption(
      user,
      await within(form()).findByRole("combobox", { name: "Ends when" }),
      entry.endMoment,
    );
    await user.click(
      await within(form()).findByRole("button", { name: "Create" }),
    );

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });
  }

  test("Create asks for a name and shows the key it makes - no key to type", async () => {
    const user: UserEvent = await renderPage(entry.page, "create");

    const name: HTMLElement = await within(form()).findByRole("textbox", {
      name: /^Name/,
    });

    await user.type(name, entry.name);

    expect(
      within(form()).getByTestId("generated-key-field-value"),
    ).toHaveTextContent(entry.key);
    expect(
      within(form()).getByRole("button", { name: "Edit Key" }),
    ).toBeVisible();
    expect(within(form()).queryByRole("textbox", { name: /^Key/ })).toBeNull();
  });

  test("Create goes through without a key, and leaves it out for the server to make", async () => {
    const user: UserEvent = await renderPage(entry.page, "create");

    await user.type(
      await within(form()).findByRole("textbox", { name: /^Name/ }),
      entry.name,
    );

    await finishCreate(user);

    const model: Record<string, unknown> = savedModel();

    expect(model["name"]).toBe(entry.name);
    expect(model["key"] || undefined).toBeUndefined();
  });

  test("Create sends the key someone typed after Edit", async () => {
    const user: UserEvent = await renderPage(entry.page, "create");

    await user.type(
      await within(form()).findByRole("textbox", { name: /^Name/ }),
      entry.name,
    );
    await user.click(within(form()).getByRole("button", { name: "Edit Key" }));

    const keyBox: HTMLElement = within(form()).getByRole("textbox", {
      name: "Key",
    });
    await user.clear(keyBox);
    await user.type(keyBox, "my-key");

    await finishCreate(user);

    expect(savedModel()["key"]).toBe("my-key");
  });

  test("Create will not go on with a typed key the server would refuse", async () => {
    const user: UserEvent = await renderPage(entry.page, "create");

    await user.type(
      await within(form()).findByRole("textbox", { name: /^Name/ }),
      entry.name,
    );
    await user.click(within(form()).getByRole("button", { name: "Edit Key" }));

    const keyBox: HTMLElement = within(form()).getByRole("textbox", {
      name: "Key",
    });
    await user.clear(keyBox);
    await user.type(keyBox, "Not A Key");
    await clickNext(user);

    expect(
      await within(form()).findByText(
        "Use lowercase letters (a-z), numbers and hyphens, starting with a letter or a number, at most 50 characters.",
      ),
    ).toBeVisible();
    // Still on the first step.
    expect(within(form()).getByRole("textbox", { name: "Key" })).toBeVisible();
    expect(
      within(form()).queryByRole("combobox", { name: "Starts when" }),
    ).toBeNull();
  });

  test("Edit has no key: it never changes", async () => {
    getItemMock.mockImplementation((() => {
      return Promise.resolve(
        Object.assign(entry.existing(), {
          _id: RECORD_ID,
          name: entry.name,
          key: entry.key,
          description: "",
        }),
      );
    }) as never);

    await renderPage(entry.page, "edit");

    expect(
      await within(form()).findByRole("textbox", { name: /^Name/ }),
    ).toHaveValue(entry.name);
    expect(within(form()).queryByTestId("generated-key-field")).toBeNull();
    expect(within(form()).queryByRole("textbox", { name: /^Key/ })).toBeNull();
  });
});

interface RecordingRulePage {
  label: string;
  page: Page;
  existing: () => BaseModel;
  // What the definition needs before it can be saved, if anything.
  completeDefinition: (user: UserEvent) => Promise<void>;
}

const RECORDING_RULE_PAGES: Array<RecordingRulePage> = [
  {
    label: "Metric recording rules",
    page: MetricRecordingRulesPage,
    existing: (): BaseModel => {
      return new MetricRecordingRule();
    },
    // Source A's metric: the only thing an empty definition lacks.
    completeDefinition: async (user: UserEvent): Promise<void> => {
      await user.type(
        within(form()).getByPlaceholderText("e.g. http.server.errors"),
        "http.server.errors",
      );
    },
  },
  {
    label: "Trace recording rules",
    page: TraceRecordingRulesPage,
    existing: (): BaseModel => {
      return new TraceRecordingRule();
    },
    // An empty trace definition counts every span: complete as it is.
    completeDefinition: async (): Promise<void> => {},
  },
];

describe.each(RECORDING_RULE_PAGES)("$label", (entry: RecordingRulePage) => {
  test("Create makes the output metric name from the rule's name", async () => {
    const user: UserEvent = await renderPage(entry.page, "create");

    await user.type(
      await within(form()).findByRole("textbox", { name: /^Name/ }),
      "HTTP 5xx error rate",
    );

    expect(
      within(form()).getByTestId("generated-key-field-value"),
    ).toHaveTextContent("http_5xx_error_rate");
    expect(
      within(form()).queryByRole("textbox", { name: /^Output Metric Name/ }),
    ).toBeNull();
  });

  /*
   * One page: the name, the line made from it and the definition, so the
   * rule is created from where its name was typed - and the output metric
   * name is left out for the server to make.
   */
  test("Create goes through from the one page without an output metric name", async () => {
    const user: UserEvent = await renderPage(entry.page, "create");

    await user.type(
      await within(form()).findByRole("textbox", { name: /^Name/ }),
      "HTTP 5xx error rate",
    );
    await entry.completeDefinition(user);

    expect(within(form()).queryByRole("button", { name: "Next" })).toBeNull();
    await user.click(within(form()).getByRole("button", { name: "Create" }));

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const model: Record<string, unknown> = savedModel();

    expect(model["name"]).toBe("HTTP 5xx error rate");
    expect(model["outputMetricName"] || undefined).toBeUndefined();
  });

  test("Edit keeps the output metric name an ordinary field, holding its name", async () => {
    getItemMock.mockImplementation((() => {
      return Promise.resolve(
        Object.assign(entry.existing(), {
          _id: RECORD_ID,
          name: "HTTP 5xx error rate",
          outputMetricName: "http.server.error_rate",
          isEnabled: true,
        }),
      );
    }) as never);

    await renderPage(entry.page, "edit");

    expect(
      await within(form()).findByRole("textbox", {
        name: /^Output Metric Name/,
      }),
    ).toHaveValue("http.server.error_rate");
    expect(within(form()).queryByTestId("generated-key-field")).toBeNull();
  });
});
