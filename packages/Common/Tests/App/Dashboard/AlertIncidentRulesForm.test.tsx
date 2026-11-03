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

/*
 * ALERTS → RULES → INCIDENT RULES, DRAWN FOR REAL: the page's own fields in
 * the ModelFormModal, ModelForm and BasicForm its table opens, with only
 * the table around them, the network and the permissions stubbed.
 *
 * A rule asks what it matches (the conditions builder, on "All alerts"),
 * then what it declares: the incident's severity - none picked is the
 * alert's own - and how long the alert must stay unresolved first, with its
 * name filled in from the severity, and the status page switch and the
 * description folded under More fields. Enabled is on the Edit form only.
 */

configure({ asyncUtilTimeout: 15000 });

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const RULE_ID: string = "66666666-6666-4666-8666-666666666666";
const NEW_ID: string = "55555555-5555-4555-8555-555555555555";

const SEV1: string = "0000000d-0000-4000-8000-000000000001";

interface MockTable {
  mode: "create" | "edit";
  // What the page handed its table: read by the table cases.
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
      // The project's incident severities: the severity picker reads them.
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

        if (request.modelType.name === "IncidentSeverity") {
          const SeverityModel: Loaded = (
            jest.requireActual(
              "../../../Models/DatabaseModels/IncidentSeverity",
            ) as { default: Loaded }
          ).default;

          rows = [
            ["0000000d-0000-4000-8000-000000000001", "SEV1"],
            ["0000000d-0000-4000-8000-000000000002", "SEV2"],
          ].map(([id, name]: Array<string>): unknown => {
            return Object.assign(new SeverityModel(), { _id: id, name: name });
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
import AlertIncidentRule from "../../../Models/DatabaseModels/AlertIncidentRule";
import { listedNames } from "../../UI/Components/FoldedSection/FoldedSectionQueries";
import RuleSettingsPageProps from "../../../../App/FeatureSet/Dashboard/src/Pages/RuleSettingsPageProps";
import AlertIncidentRules from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/Settings/AlertIncidentRules";

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
  mode: MockTable["mode"] = "create",
): Promise<UserEvent> {
  mockTable.mode = mode;

  const Page: RulePage = AlertIncidentRules as RulePage;

  await act(async (): Promise<void> => {
    render(
      <Page
        pageRoute={
          new Route(`/dashboard/${PROJECT_ID}/alerts/settings/incident-rules`)
        }
        currentProject={null}
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

// A number box, found by its field title ("(Optional)" may follow it).
function waitBox(): HTMLInputElement {
  return within(dialog()).getByRole("spinbutton", {
    name: new RegExp(`^${escapeRegExp("Declare After (Minutes)")}`),
  }) as HTMLInputElement;
}

function severityPicker(): HTMLElement {
  return within(dialog()).getByRole("combobox", { name: /Incident Severity/ });
}

// What ModelForm handed the API: the model, read by its columns.
function sentModel(): JSONObject {
  return (createOrUpdateMock.mock.calls[0]?.[0] as { model: unknown })
    .model as JSONObject;
}

function idOf(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  const record: Record<string, unknown> = (value || {}) as Record<
    string,
    unknown
  >;

  return String(record["_id"] || record["id"] || record["value"] || "");
}

beforeEach(() => {
  window.history.replaceState(
    {},
    "",
    `/dashboard/${PROJECT_ID}/alerts/settings/incident-rules`,
  );
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

describe("Alerts > Rules > Incident Rules", () => {
  test("is a list put in order by dragging, of the alert incident rules", async () => {
    await renderPage();

    const props: ModelTableProps<BaseModel> = mockTable.props!;

    expect(props.modelType).toBe(AlertIncidentRule);
    expect(props.enableDragAndDrop).toBe(true);
    expect(props.dragDropIndexField).toBe("order");
    expect(props.sortBy).toBe("order");
    expect(props.rowSwitch).toEqual({ column: "isEnabled" });
  });

  test("opens on what the rule matches, starting on every alert, then asks about the incident", async () => {
    await renderPage();

    expect(stepTitles()).toEqual([
      expect.stringContaining("Match"),
      expect.stringContaining("Incident"),
    ]);

    const appliesTo: HTMLElement = within(dialog()).getByRole("radiogroup", {
      name: /Applies to/,
    });
    expect(
      within(appliesTo).getByRole("radio", { name: "All alerts" }),
    ).toBeChecked();
    expect(
      within(dialog()).queryByRole("textbox", { name: "Name" }),
    ).toBeNull();
    expect(
      within(dialog()).queryByTestId("modal-footer-submit-button"),
    ).toBeNull();
  });

  test("asks for the severity and the wait, names the rule, and folds the rest", async () => {
    await renderPage();
    await next();

    expect(severityPicker()).toBeVisible();
    // What no severity means, said where none is picked.
    expect(severityPicker()).toHaveAttribute(
      "placeholder",
      "Same as the alert's severity",
    );
    expect(waitBox()).toHaveValue(0);
    expect(nameBox()).toHaveValue("Declare incidents");

    // A new rule starts on: Enabled is on the Edit form only.
    expect(
      within(dialog()).queryByRole("switch", { name: /Enabled/ }),
    ).toBeNull();

    expect(moreFields()).toHaveAttribute("aria-expanded", "false");
    expect(listedNames(moreFields())).toEqual([
      "Show on Status Pages",
      "Description",
    ]);
  });

  test("names the rule after the severity picked", async () => {
    const user: UserEvent = await renderPage();
    await next();

    await user.click(severityPicker());
    await user.click(await screen.findByRole("option", { name: "SEV1" }));

    await waitFor(() => {
      expect(nameBox()).toHaveValue("Declare SEV1 incidents");
    });
  });

  test("never writes over a name somebody typed", async () => {
    const user: UserEvent = await renderPage();
    await next();

    fireEvent.change(nameBox(), { target: { value: "Database outages" } });

    await user.click(severityPicker());
    await user.click(await screen.findByRole("option", { name: "SEV1" }));

    await settle();
    expect(nameBox()).toHaveValue("Database outages");
  });

  test("creates the rule with its severity, its wait and the name filled in", async () => {
    const user: UserEvent = await renderPage();
    await next();

    await user.click(severityPicker());
    await user.click(await screen.findByRole("option", { name: "SEV1" }));
    await waitFor(() => {
      expect(nameBox()).toHaveValue("Declare SEV1 incidents");
    });

    fireEvent.change(waitBox(), { target: { value: "15" } });
    await settle();
    await submit();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const model: JSONObject = sentModel();

    expect(model["name"]).toBe("Declare SEV1 incidents");
    expect(Number(model["declareAfterInMinutes"])).toBe(15);
    expect(idOf(model["incidentSeverity"] || model["incidentSeverityId"])).toBe(
      SEV1,
    );
    // A rule for every new alert: no condition stored.
    expect((model["criteria"] as { filters?: Array<unknown> }).filters).toEqual(
      [],
    );
  });

  test("creates a rule that declares right away, at the alert's own severity, when nothing more is picked", async () => {
    await renderPage();
    await next();
    await submit();

    await waitFor(() => {
      expect(createOrUpdateMock).toHaveBeenCalledTimes(1);
    });

    const model: JSONObject = sentModel();

    expect(model["name"]).toBe("Declare incidents");
    expect(Number(model["declareAfterInMinutes"] || 0)).toBe(0);
    expect(
      model["incidentSeverity"] || model["incidentSeverityId"],
    ).toBeFalsy();
  });
});

describe("editing an alert incident rule", () => {
  test("adds the Enabled switch, and keeps its name, severity and wait", async () => {
    getItemMock.mockImplementation((() => {
      return Promise.resolve(
        Object.assign(new AlertIncidentRule(), {
          _id: RULE_ID,
          name: "Database outages",
          description: "",
          isEnabled: true,
          declareAfterInMinutes: 30,
          showIncidentOnStatusPage: false,
        }),
      );
    }) as never);

    await renderPage("edit");
    await next();

    expect(
      await within(dialog()).findByRole("switch", { name: /Enabled/ }),
    ).toBeVisible();
    await waitFor(() => {
      expect(nameBox()).toHaveValue("Database outages");
    });
    expect(waitBox()).toHaveValue(30);
    // A switch set off is named, with its value, on the folded line.
    expect(listedNames(moreFields())).toEqual([
      "Show on Status Pages: Off",
      "Description",
    ]);
  });
});
