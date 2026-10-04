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
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { JSONObject } from "../../../Types/JSON";
import Permission from "../../../Types/Permission";
import { FormType, ModelField } from "../../../UI/Components/Forms/ModelForm";
import ModelFormModal from "../../../UI/Components/ModelFormModal/ModelFormModal";
import { ComponentProps as ModelTableProps } from "../../../UI/Components/ModelTable/ModelTable";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A PROJECT'S FIRST TWILIO CONFIG BECOMES ITS DEFAULT: the Twilio Config
 * card on Project Settings > Notification Settings, on the real component,
 * through the real ModelFormModal, ModelForm and BasicForm. Only the
 * network and the table around the dialog are stand-ins.
 *
 *   - The create form of the project's first config starts "Set as Project
 *     Default" on and says why, so saving it untouched sends what it shows:
 *     the default. Any later config starts it off, where its column does,
 *     and so does the form while the project's configs are not known.
 *   - The card says which config the SMS and calls to people in the project
 *     go through: the project default, the first config added, or - when
 *     the project has configs but none is the default - none of them.
 *   - Every row but the default's has "Set as Project Default" in its menu.
 *
 * The server side, and why an explicit false is kept, is pinned in
 * Server/Services/ProjectCallSMSConfigFirstDefault.test.ts.
 */

jest.setTimeout(60000);

const CONFIG_ID: string = "1d000000-0000-4000-8000-000000000001";
const OTHER_CONFIG_ID: string = "1d000000-0000-4000-8000-000000000002";

let configCount: number;
let defaultCount: number;
let countsFail: boolean;
// Counts asked while this is set never answer, as a slow network.
let countsHang: boolean;
let countQueries: Array<Record<string, unknown>>;
let stored: JSONObject;
let capturedModels: Array<Record<string, unknown>>;
let updates: Array<{ id: string; data: JSONObject; modelName: string }>;
let updateFails: boolean;
let permissions: Array<Permission>;
let tableProps: Array<Record<string, unknown>>;
let fetchReports: number;

/*
 * The table is not under test. It reports a fetch as ModelTable does - on
 * mount and whenever refreshToggle changes - with what the project has, and
 * opens the create (or an edit) dialog from its own props when asked.
 */
jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: <TBaseModel extends BaseModel>(
      props: ModelTableProps<TBaseModel>,
    ): ReactElement => {
      tableProps.push(props as unknown as Record<string, unknown>);

      const [open, setOpen] = React.useState<"create" | "edit" | null>(null);

      React.useEffect(() => {
        fetchReports += 1;
        props.onFetchSuccess?.([], configCount);
      }, [props.refreshToggle]);

      const isCreate: boolean = open === "create";
      const singularName: string = new props.modelType().singularName || "";
      const ObjectIDClass: any = (
        jest.requireActual("../../../Types/ObjectID") as any
      ).default;

      return (
        <div>
          <p data-testid="card-description">
            {String(props.cardProps?.description || "")}
          </p>
          <button
            type="button"
            onClick={() => {
              setOpen("create");
            }}
          >
            Open create form
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen("edit");
            }}
          >
            Open edit form
          </button>
          {open ? (
            <ModelFormModal<TBaseModel>
              title={`${isCreate ? "Create New" : "Edit"} ${singularName}`}
              name={`${props.name} > ${isCreate ? "Create New" : "Edit"} ${singularName}`}
              modelType={props.modelType}
              initialValues={isCreate ? props.createInitialValues : undefined}
              onBeforeCreate={props.onBeforeCreate}
              submitButtonText={
                isCreate ? `Create ${singularName}` : "Save Changes"
              }
              onClose={() => {
                setOpen(null);
              }}
              onSuccess={() => {
                setOpen(null);
              }}
              modelIdToEdit={
                isCreate ? undefined : new ObjectIDClass(CONFIG_ID)
              }
              formProps={{
                id: `create-${props.modelType.name}-from`,
                name: `create-${props.modelType.name}-from`,
                modelType: props.modelType,
                fields: (props.formFields || []).filter(
                  (field: ModelField<TBaseModel>): boolean => {
                    return isCreate
                      ? !field.doNotShowWhenCreating
                      : !field.doNotShowWhenEditing;
                  },
                ),
                steps: props.formSteps || [],
                formType: isCreate ? FormType.Create : FormType.Update,
              }}
            />
          ) : (
            <></>
          )}
        </div>
      );
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: async (data: {
        query: Record<string, unknown>;
      }): Promise<number> => {
        countQueries.push(data.query);

        if (countsHang) {
          return await new Promise<number>(() => {});
        }

        if (countsFail) {
          throw new Error("Could not count the Twilio configs.");
        }

        return "isProjectDefault" in data.query ? defaultCount : configCount;
      },
      getItem: async (data: {
        modelType: { new (): Record<string, unknown> };
      }): Promise<unknown> => {
        const item: Record<string, unknown> = new data.modelType();
        Object.assign(item, { _id: CONFIG_ID, ...stored });
        return item;
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
        return { tenantid: "99999999-9999-4999-8999-999999999999" };
      },
      createOrUpdate: async (data: {
        model: Record<string, unknown>;
      }): Promise<{ data: Record<string, unknown> }> => {
        capturedModels.push(data.model);
        return { data: data.model };
      },
      updateById: async (data: {
        modelType: { name: string };
        id: { toString: () => string };
        data: JSONObject;
      }): Promise<unknown> => {
        if (updateFails) {
          throw new Error("You do not have permission to do this.");
        }

        updates.push({
          id: data.id.toString(),
          data: data.data,
          modelName: data.modelType.name,
        });
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<Permission> => {
        return permissions;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<Permission> } => {
        return { globalPermissions: permissions };
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
        const ObjectIDClass: any = (
          jest.requireActual("../../../Types/ObjectID") as any
        ).default;
        return new ObjectIDClass("99999999-9999-4999-8999-999999999999");
      },
    },
  };
});

import CustomCallSMSTable from "../../../../App/FeatureSet/Dashboard/src/Components/CallSMS/CallSMSConfigTable";
import TwilioConfigDefaultCopy from "../../../../App/FeatureSet/Dashboard/src/Components/CallSMS/TwilioConfigDefaultCopy";
import ProjectCallSMSConfig from "../../../Models/DatabaseModels/ProjectCallSMSConfig";
import IconProp from "../../../Types/Icon/IconProp";
import ActionButtonSchema, {
  ActionButtonPlacement,
} from "../../../UI/Components/ActionButton/ActionButtonSchema";

const SWITCH_TITLE: string = "Set as Project Default";

function dialog(): HTMLElement {
  return screen.getByTestId("modal");
}

function cardDescription(): string {
  return screen.getByTestId("card-description").textContent || "";
}

async function settle(): Promise<void> {
  for (let index: number = 0; index < 10; index++) {
    await act(async (): Promise<void> => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    });
  }
}

// Draws the card, and waits for its first fetch and counts to be read.
async function renderCard(): Promise<void> {
  render(
    <MemoryRouter>
      <CustomCallSMSTable />
    </MemoryRouter>,
  );

  await settle();
}

async function openForm(kind: "create" | "edit"): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(
      screen.getByRole("button", {
        name: kind === "create" ? "Open create form" : "Open edit form",
      }),
    );
  });

  await waitFor(() => {
    expect(
      within(dialog()).queryByRole("navigation", { name: "Progress" }),
    ).not.toBeNull();
  });

  await settle();
}

async function type(label: string, value: string): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.change(within(dialog()).getByLabelText(label), {
      target: { value },
    });
  });
}

/*
 * The footer's one way on: a plain Next on every step but the last, the
 * dialog's action on the last step only.
 */
async function clickFooter(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(
      within(dialog()).queryByTestId("modal-footer-next-button") ||
        within(dialog()).getByTestId("modal-footer-submit-button"),
    );
  });
  await settle();
}

// Fills in the Basic step and walks on to Twilio Config, where the switch is.
async function walkToTwilioStep(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.change(
      within(dialog()).getByPlaceholderText("Company CallSMS Server"),
      { target: { value: "Production Twilio" } },
    );
  });
  await clickFooter();

  await waitFor(() => {
    expect(
      within(dialog()).getByRole("switch", { name: SWITCH_TITLE }),
    ).toBeVisible();
  });
}

async function fillTwilioStep(): Promise<void> {
  await type("Twilio Account SID", "AC00000000000000000000000000000001");
  await type("Twilio Auth Token", "00000000000000000000000000000001");
  await type("Twilio Primary Phone Number", "+15551234567");
}

function defaultSwitch(): HTMLElement {
  return within(dialog()).getByRole("switch", { name: SWITCH_TITLE });
}

async function saved(): Promise<Record<string, unknown>> {
  await waitFor(() => {
    expect(capturedModels).toHaveLength(1);
  });

  return capturedModels[0]!;
}

function lastTableProps(): Record<string, unknown> {
  return tableProps[tableProps.length - 1]!;
}

function setDefaultAction(): ActionButtonSchema<ProjectCallSMSConfig> {
  const actions: Array<ActionButtonSchema<ProjectCallSMSConfig>> =
    lastTableProps()["actionButtons"] as Array<
      ActionButtonSchema<ProjectCallSMSConfig>
    >;

  const action: ActionButtonSchema<ProjectCallSMSConfig> | undefined =
    actions.find((button: ActionButtonSchema<ProjectCallSMSConfig>) => {
      return button.title === SWITCH_TITLE;
    });

  expect(action).toBeDefined();

  return action!;
}

function row(id: string, isProjectDefault: boolean): ProjectCallSMSConfig {
  const config: ProjectCallSMSConfig = new ProjectCallSMSConfig();
  config._id = id;
  config.name = isProjectDefault ? "Production Twilio" : "Status page Twilio";
  config.isProjectDefault = isProjectDefault;
  return config;
}

beforeEach(() => {
  configCount = 0;
  defaultCount = 0;
  countsFail = false;
  countsHang = false;
  countQueries = [];
  stored = {};
  capturedModels = [];
  updates = [];
  updateFails = false;
  permissions = [Permission.ProjectOwner, Permission.User, Permission.Public];
  tableProps = [];
  fetchReports = 0;
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("what the Twilio Config card says", () => {
  test("a project with no config yet: the first one added becomes the project default", async () => {
    configCount = 0;

    await renderCard();

    expect(cardDescription()).toBe(
      TwilioConfigDefaultCopy.firstConfigCardDescription,
    );
  });

  test("a project with a default: SMS and calls go through the project default", async () => {
    configCount = 2;
    defaultCount = 1;

    await renderCard();

    expect(cardDescription()).toBe(TwilioConfigDefaultCopy.cardDescription);
  });

  test("a project with configs but no default: says they are not used, and how to change that", async () => {
    configCount = 2;
    defaultCount = 0;

    await renderCard();

    expect(cardDescription()).toBe(
      TwilioConfigDefaultCopy.noDefaultCardDescription,
    );
    expect(cardDescription()).toContain(SWITCH_TITLE);
  });

  test("before the configs are counted, and when counting fails, it only says the rule", async () => {
    countsHang = true;

    await renderCard();

    expect(cardDescription()).toBe(TwilioConfigDefaultCopy.cardDescription);

    cleanup();
    countsHang = false;
    countsFail = true;

    await renderCard();

    expect(cardDescription()).toBe(TwilioConfigDefaultCopy.cardDescription);
  });

  test("counts every config of the project, and the ones that are its default", async () => {
    await renderCard();

    expect(countQueries).toEqual([{}, { isProjectDefault: true }]);
  });
});

describe("creating the project's first Twilio config", () => {
  beforeEach(() => {
    configCount = 0;
    defaultCount = 0;
  });

  test("starts Set as Project Default on, and says why", async () => {
    await renderCard();
    await openForm("create");
    await walkToTwilioStep();

    expect(defaultSwitch()).toHaveAttribute("aria-checked", "true");
    expect(
      within(dialog()).getByText(
        TwilioConfigDefaultCopy.firstConfigSwitchDescription,
      ),
    ).toBeVisible();
    expect(
      within(dialog()).queryByText(
        TwilioConfigDefaultCopy.defaultSwitchDescription,
      ),
    ).toBeNull();
  });

  test("saved untouched, it is the project default: what the form showed", async () => {
    await renderCard();
    await openForm("create");
    await walkToTwilioStep();
    await fillTwilioStep();
    await clickFooter();

    const model: Record<string, unknown> = await saved();

    expect(model["name"]).toBe("Production Twilio");
    expect(model["twilioAccountSID"]).toBe(
      "AC00000000000000000000000000000001",
    );
    expect(model["isProjectDefault"]).toBe(true);
  });

  test("switched off, it is saved off: an account for status pages or incoming calls only", async () => {
    await renderCard();
    await openForm("create");
    await walkToTwilioStep();
    await fillTwilioStep();

    await act(async (): Promise<void> => {
      fireEvent.click(defaultSwitch());
    });

    expect(defaultSwitch()).toHaveAttribute("aria-checked", "false");

    await clickFooter();

    const model: Record<string, unknown> = await saved();

    expect(model["isProjectDefault"]).toBe(false);
  });
});

describe("creating a later Twilio config", () => {
  test.each([
    ["a project with a default", 1, 1],
    ["a project with configs but no default", 2, 0],
  ])(
    "%s: the switch starts off, where the column does, with its usual help",
    async (_label: string, configs: number, defaults: number) => {
      configCount = configs;
      defaultCount = defaults;

      await renderCard();
      await openForm("create");
      await walkToTwilioStep();

      expect(defaultSwitch()).toHaveAttribute("aria-checked", "false");
      expect(
        within(dialog()).getByText(
          TwilioConfigDefaultCopy.defaultSwitchDescription,
        ),
      ).toBeVisible();
      expect(
        within(dialog()).queryByText(
          TwilioConfigDefaultCopy.firstConfigSwitchDescription,
        ),
      ).toBeNull();
    },
  );

  test("saved untouched, it does not take the project's default", async () => {
    configCount = 1;
    defaultCount = 1;

    await renderCard();
    await openForm("create");
    await walkToTwilioStep();
    await fillTwilioStep();
    await clickFooter();

    const model: Record<string, unknown> = await saved();

    expect(model["isProjectDefault"]).toBe(false);
  });

  test("while the configs cannot be counted, the form claims nothing: the switch starts off", async () => {
    countsFail = true;

    await renderCard();
    await openForm("create");
    await walkToTwilioStep();

    expect(defaultSwitch()).toHaveAttribute("aria-checked", "false");
    expect(
      within(dialog()).getByText(
        TwilioConfigDefaultCopy.defaultSwitchDescription,
      ),
    ).toBeVisible();
  });

  test("a row on screen ends the first-config form at once, before the counts answer again", async () => {
    configCount = 0;

    await renderCard();

    expect(lastTableProps()["createInitialValues"]).toEqual({
      isProjectDefault: true,
    });

    // The first config was just added: the table lists it, the counts lag.
    configCount = 1;
    countsHang = true;

    await act(async (): Promise<void> => {
      (
        lastTableProps()["onFetchSuccess"] as (
          items: Array<ProjectCallSMSConfig>,
          totalCount: number,
        ) => void
      )([row(CONFIG_ID, true)], 1);
    });
    await settle();

    expect(lastTableProps()["createInitialValues"]).toBeUndefined();
    expect(cardDescription()).toBe(TwilioConfigDefaultCopy.cardDescription);
  });
});

describe("editing a Twilio config", () => {
  test("shows whether it is the default, with the switch's usual help", async () => {
    configCount = 1;
    defaultCount = 1;
    stored = {
      name: "Production Twilio",
      twilioAccountSID: "AC00000000000000000000000000000001",
      twilioAuthToken: "00000000000000000000000000000001",
      twilioPrimaryPhoneNumber: "+15551234567",
      isProjectDefault: true,
    };

    await renderCard();
    await openForm("edit");

    await act(async (): Promise<void> => {
      fireEvent.click(within(dialog()).getByText("Twilio Config"));
    });
    await settle();

    expect(defaultSwitch()).toHaveAttribute("aria-checked", "true");
    expect(
      within(dialog()).getByText(
        TwilioConfigDefaultCopy.defaultSwitchDescription,
      ),
    ).toBeVisible();
  });
});

describe("Set as Project Default on a row", () => {
  test("is in the row's menu on every config but the default", async () => {
    configCount = 2;
    defaultCount = 1;

    await renderCard();

    const action: ActionButtonSchema<ProjectCallSMSConfig> = setDefaultAction();

    expect(action.placement).toBe(ActionButtonPlacement.MoreMenu);
    expect(action.icon).toBe(IconProp.Check);
    expect(action.disabled).toBe(false);
    expect(action.isVisible!(row(OTHER_CONFIG_ID, false))).toBe(true);
    expect(action.isVisible!(row(CONFIG_ID, true))).toBe(false);
  });

  test("leaves the test buttons as the row's own", async () => {
    await renderCard();

    const titles: Array<string> = (
      lastTableProps()["actionButtons"] as Array<
        ActionButtonSchema<ProjectCallSMSConfig>
      >
    ).map((button: ActionButtonSchema<ProjectCallSMSConfig>): string => {
      return button.title;
    });

    expect(titles).toEqual(["Send Test SMS", "Send Test Call", SWITCH_TITLE]);
  });

  test("makes that config the default, then lists and counts again", async () => {
    configCount = 2;
    defaultCount = 0;

    await renderCard();

    expect(cardDescription()).toBe(
      TwilioConfigDefaultCopy.noDefaultCardDescription,
    );

    const reportsBefore: number = fetchReports;
    const onComplete: MockFunction = getJestMockFunction();
    const onError: MockFunction = getJestMockFunction();

    // The server takes the default from the config that had it.
    defaultCount = 1;

    await act(async (): Promise<void> => {
      // Typed as returning nothing; the table's own action is async.
      await Promise.resolve(
        setDefaultAction().onClick(
          row(OTHER_CONFIG_ID, false),
          onComplete as unknown as () => void,
          onError as unknown as (error: Error) => void,
        ),
      );
    });
    await settle();

    expect(updates).toEqual([
      {
        id: OTHER_CONFIG_ID,
        data: { isProjectDefault: true },
        modelName: "ProjectCallSMSConfig",
      },
    ]);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(fetchReports).toBe(reportsBefore + 1);
    expect(cardDescription()).toBe(TwilioConfigDefaultCopy.cardDescription);
  });

  test("a refusal is shown on the row, and nothing is listed again", async () => {
    configCount = 2;
    updateFails = true;

    await renderCard();

    const reportsBefore: number = fetchReports;
    const onComplete: MockFunction = getJestMockFunction();
    const onError: MockFunction = getJestMockFunction();

    await act(async (): Promise<void> => {
      // Typed as returning nothing; the table's own action is async.
      await Promise.resolve(
        setDefaultAction().onClick(
          row(OTHER_CONFIG_ID, false),
          onComplete as unknown as () => void,
          onError as unknown as (error: Error) => void,
        ),
      );
    });
    await settle();

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect((onError.mock.calls[0]![0] as Error).message).toBe(
      "You do not have permission to do this.",
    );
    expect(fetchReports).toBe(reportsBefore);
  });

  test("is locked, saying why, for someone who may read the configs but not change them", async () => {
    permissions = [
      Permission.ReadProjectCallSMSConfig,
      Permission.User,
      Permission.Public,
    ];
    configCount = 2;

    await renderCard();

    const action: ActionButtonSchema<ProjectCallSMSConfig> = setDefaultAction();

    expect(action.disabled).toBe(true);
    expect(action.tooltip).toContain("You do not have permission to update");
    expect(action.isVisible!(row(OTHER_CONFIG_ID, false))).toBe(true);
  });

  test("is not offered while the permissions are still loading", async () => {
    permissions = [];
    configCount = 2;

    await renderCard();

    expect(setDefaultAction().isVisible!(row(OTHER_CONFIG_ID, false))).toBe(
      false,
    );
  });
});
