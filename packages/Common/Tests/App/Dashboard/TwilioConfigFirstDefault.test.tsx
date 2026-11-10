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
import fs from "fs";
import path from "path";
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
 * card on Project Settings > Notifications > Notification Settings, on the real component,
 * through the real ModelFormModal, ModelForm and BasicForm. Only the
 * network and the table around the dialog are stand-ins.
 *
 *   - The create form of the project's first config starts "Set as Project
 *     Default" on and says why, so saving it untouched sends what it shows:
 *     the default. Any later config starts it off, where its column does,
 *     and so does the form while the project's configs are not known.
 *   - The card says which config the SMS and calls to people in the project
 *     go through: the project default, the first config added, or - when
 *     the project has configs but none is the default - none of them. A
 *     project has a default for SMS and one for calls (#6574), so the card
 *     also says when a config could send SMS, or calls, that no config is
 *     the default for.
 *   - Every row that is not the default for everything it sends has "Set as
 *     Project Default" in its menu, named for what it would take: "... for
 *     SMS" on a config for SMS only, "... for Calls" on one for calls only.
 *     A default has "Stop Using as Project Default", which asks first.
 *   - The Project Default column says what each config is the default for.
 *   - The Edit form has no default switch: it would send it back as it read
 *     it, and a default for calls alone would take the SMS on every save.
 *
 * The server side, and why an explicit false is kept, is pinned in
 * Server/Services/ProjectCallSMSConfigFirstDefault.test.ts, and the rule
 * for SMS and calls in Server/Services/ProjectCallSMSConfigDefaultPerKind.
 */

jest.setTimeout(60000);

const CONFIG_ID: string = "1d000000-0000-4000-8000-000000000001";
const OTHER_CONFIG_ID: string = "1d000000-0000-4000-8000-000000000002";

let configCount: number;
let defaultCount: number;
/*
 * What each of the project's configs sends and is the default for, as the
 * card reads them, when a test says; else configCount configs for calls
 * and SMS, the first defaultCount of them the default for both.
 */
let listedConfigs: Array<JSONObject> | undefined;
let listFails: boolean;
// Lists asked for while this is set never answer, as a slow network.
let listHangs: boolean;
let listReads: Array<Record<string, unknown>>;
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
      getItem: async (data: {
        modelType: { new (): Record<string, unknown> };
      }): Promise<unknown> => {
        const item: Record<string, unknown> = new data.modelType();
        Object.assign(item, { _id: CONFIG_ID, ...stored });
        return item;
      },
      getList: async (data: {
        query: Record<string, unknown>;
        select: Record<string, unknown>;
        limit: number;
        skip: number;
      }): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        listReads.push({
          query: data.query,
          select: data.select,
          limit: data.limit,
          skip: data.skip,
        });

        if (listHangs) {
          return await new Promise<never>(() => {});
        }

        if (listFails) {
          throw new Error("Could not list the Twilio configs.");
        }

        const configs: Array<JSONObject> = projectConfigs();

        return {
          data: configs,
          count: configs.length,
          skip: 0,
          limit: data.limit,
        };
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
import TwilioConfigDefaultCopy, {
  TwilioConfigDefaultRow,
  TwilioConfigDefaultState,
  getProjectDefaultPillText,
  getSetDefaultTitle,
  getStopDefaultConfirmDescription,
  getTwilioConfigCardDescription,
  getTwilioConfigDefaultState,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CallSMS/TwilioConfigDefaultCopy";
import { TwilioConfigUse } from "../../../Types/CallAndSMS/TwilioConfigUse";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import Column from "../../../UI/Components/ModelTable/Column";
import ProjectCallSMSConfig from "../../../Models/DatabaseModels/ProjectCallSMSConfig";
import IconProp from "../../../Types/Icon/IconProp";
import ActionButtonSchema, {
  ActionButtonPlacement,
  RowActionConfirmation,
} from "../../../UI/Components/ActionButton/ActionButtonSchema";

const SWITCH_TITLE: string = "Set as Project Default";
const SMS_TITLE: string = "Set as Project Default for SMS";
const CALLS_TITLE: string = "Set as Project Default for Calls";
const STOP_TITLE: string = "Stop Using as Project Default";

// What a config is the default for, as the tests write it.
type DefaultFor = "" | "sms" | "calls" | "sms+calls";

// A config as the card and the table read it.
function listed(use: TwilioConfigUse, defaultFor: DefaultFor): JSONObject {
  return {
    usedFor: use,
    isProjectDefault: defaultFor !== "",
    isProjectDefaultForSms: defaultFor.includes("sms"),
    isProjectDefaultForCalls: defaultFor.includes("calls"),
  };
}

// What getList answers the card with (see listedConfigs).
function projectConfigs(): Array<JSONObject> {
  if (listedConfigs) {
    return listedConfigs;
  }

  const configs: Array<JSONObject> = [];

  for (let index: number = 0; index < configCount; index++) {
    configs.push(
      listed(
        TwilioConfigUse.CallsAndSms,
        index < defaultCount ? "sms+calls" : "",
      ),
    );
  }

  return configs;
}

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
      within(dialog()).getByPlaceholderText("Company Twilio Account"),
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

function actionTitled(title: string): ActionButtonSchema<ProjectCallSMSConfig> {
  const actions: Array<ActionButtonSchema<ProjectCallSMSConfig>> =
    lastTableProps()["actionButtons"] as Array<
      ActionButtonSchema<ProjectCallSMSConfig>
    >;

  const action: ActionButtonSchema<ProjectCallSMSConfig> | undefined =
    actions.find((button: ActionButtonSchema<ProjectCallSMSConfig>) => {
      return button.title === title;
    });

  expect(action).toBeDefined();

  return action!;
}

function setDefaultAction(): ActionButtonSchema<ProjectCallSMSConfig> {
  return actionTitled(SWITCH_TITLE);
}

/*
 * The titles of the default actions a row's ⋯ menu shows: the set action
 * that names what the config would take, and Stop on a default.
 */
function defaultActionsOn(config: ProjectCallSMSConfig): Array<string> {
  return [SWITCH_TITLE, SMS_TITLE, CALLS_TITLE, STOP_TITLE].filter(
    (title: string): boolean => {
      return Boolean(actionTitled(title).isVisible!(config));
    },
  );
}

/*
 * A row as the table lists it: what it is used for - calls and SMS unless
 * a test says - and what it is the default for: everything it sends while
 * it is a default, unless a test says.
 */
function row(
  id: string,
  isProjectDefault: boolean,
  use: TwilioConfigUse = TwilioConfigUse.CallsAndSms,
  defaultFor?: DefaultFor,
): ProjectCallSMSConfig {
  const sends: DefaultFor =
    use === TwilioConfigUse.SmsOnly
      ? "sms"
      : use === TwilioConfigUse.CallsOnly
        ? "calls"
        : "sms+calls";
  const holds: DefaultFor =
    defaultFor !== undefined ? defaultFor : isProjectDefault ? sends : "";

  const config: ProjectCallSMSConfig = new ProjectCallSMSConfig();
  config._id = id;
  config.name = isProjectDefault ? "Production Twilio" : "Status page Twilio";
  config.usedFor = use;
  config.isProjectDefault = isProjectDefault;
  config.isProjectDefaultForSms = holds.includes("sms");
  config.isProjectDefaultForCalls = holds.includes("calls");
  return config;
}

// The Project Default column, and what it draws for a row.
function projectDefaultColumn(): Column<ProjectCallSMSConfig> {
  const column: Column<ProjectCallSMSConfig> | undefined = (
    lastTableProps()["columns"] as Array<Column<ProjectCallSMSConfig>>
  ).find((candidate: Column<ProjectCallSMSConfig>): boolean => {
    return candidate.title === "Project Default";
  });

  expect(column).toBeDefined();

  return column!;
}

function projectDefaultCell(config: ProjectCallSMSConfig): string {
  const cell: ReturnType<typeof render> = render(
    projectDefaultColumn().getElement!(config) as ReactElement,
  );
  const text: string = cell.container.textContent || "";
  cell.unmount();
  return text;
}

beforeEach(() => {
  configCount = 0;
  defaultCount = 0;
  listedConfigs = undefined;
  listFails = false;
  listHangs = false;
  listReads = [];
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

  test("before the configs are read, and when reading them fails, it only says the rule", async () => {
    listHangs = true;

    await renderCard();

    expect(cardDescription()).toBe(TwilioConfigDefaultCopy.cardDescription);

    cleanup();
    listHangs = false;
    listFails = true;

    await renderCard();

    expect(cardDescription()).toBe(TwilioConfigDefaultCopy.cardDescription);
  });

  test("reads every config of the project: what each sends and is the default for, and nothing else", async () => {
    await renderCard();

    expect(listReads).toEqual([
      {
        query: {},
        select: {
          _id: true,
          usedFor: true,
          isProjectDefault: true,
          isProjectDefaultForSms: true,
          isProjectDefaultForCalls: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      },
    ]);
  });

  /*
   * The customer's project (#6574) once this shipped: its config for SMS
   * only was the default, and its config for calls only could not be the
   * default beside it. Now it can, and the card says what is missing.
   */
  test("a config makes calls, but none is the default for them: says so, and how to change that", async () => {
    listedConfigs = [
      listed(TwilioConfigUse.SmsOnly, "sms"),
      listed(TwilioConfigUse.CallsOnly, ""),
    ];

    await renderCard();

    expect(cardDescription()).toBe(
      TwilioConfigDefaultCopy.noCallsDefaultCardDescription,
    );
    expect(cardDescription()).toContain(SWITCH_TITLE);
  });

  test("a config sends SMS, but none is the default for them: says so, and how to change that", async () => {
    listedConfigs = [
      listed(TwilioConfigUse.CallsAndSms, ""),
      listed(TwilioConfigUse.CallsOnly, "calls"),
    ];

    await renderCard();

    expect(cardDescription()).toBe(
      TwilioConfigDefaultCopy.noSmsDefaultCardDescription,
    );
    expect(cardDescription()).toContain(SWITCH_TITLE);
  });

  test("the customer's project, with a default for SMS and one for calls: nothing is missing", async () => {
    listedConfigs = [
      listed(TwilioConfigUse.SmsOnly, "sms"),
      listed(TwilioConfigUse.CallsOnly, "calls"),
    ];

    await renderCard();

    expect(cardDescription()).toBe(TwilioConfigDefaultCopy.cardDescription);
  });

  test("no config makes calls: the default for SMS is all a project can have, and nothing is missing", async () => {
    listedConfigs = [
      listed(TwilioConfigUse.SmsOnly, "sms"),
      listed(TwilioConfigUse.SmsOnly, ""),
    ];

    await renderCard();

    expect(cardDescription()).toBe(TwilioConfigDefaultCopy.cardDescription);
  });
});

describe("what the card and the rows say, config by config", () => {
  test.each([
    ["no config", [], TwilioConfigDefaultState.NoConfigs],
    [
      "a default for SMS and calls",
      [listed(TwilioConfigUse.CallsAndSms, "sms+calls")],
      TwilioConfigDefaultState.HasDefault,
    ],
    [
      "configs, none a default",
      [
        listed(TwilioConfigUse.CallsAndSms, ""),
        listed(TwilioConfigUse.SmsOnly, ""),
      ],
      TwilioConfigDefaultState.NoDefault,
    ],
    [
      "a default for SMS beside a config for calls",
      [
        listed(TwilioConfigUse.SmsOnly, "sms"),
        listed(TwilioConfigUse.CallsOnly, ""),
      ],
      TwilioConfigDefaultState.NoCallsDefault,
    ],
    [
      "a default for calls beside a config for SMS",
      [
        listed(TwilioConfigUse.CallsOnly, "calls"),
        listed(TwilioConfigUse.SmsOnly, ""),
      ],
      TwilioConfigDefaultState.NoSmsDefault,
    ],
    [
      "a default for calls and no config for SMS",
      [listed(TwilioConfigUse.CallsOnly, "calls")],
      TwilioConfigDefaultState.HasDefault,
    ],
    [
      "a default for each",
      [
        listed(TwilioConfigUse.CallsOnly, "calls"),
        listed(TwilioConfigUse.SmsOnly, "sms"),
      ],
      TwilioConfigDefaultState.HasDefault,
    ],
    [
      "a config saved before the choice, the default: calls and SMS",
      [
        {
          isProjectDefault: true,
          isProjectDefaultForSms: true,
          isProjectDefaultForCalls: true,
        },
      ],
      TwilioConfigDefaultState.HasDefault,
    ],
  ])(
    "%s",
    (
      _label: string,
      configs: Array<TwilioConfigDefaultRow>,
      state: TwilioConfigDefaultState,
    ) => {
      expect(getTwilioConfigDefaultState(configs)).toBe(state);
    },
  );

  test("each state has its own sentence on the card", () => {
    expect(
      [
        TwilioConfigDefaultState.Unknown,
        TwilioConfigDefaultState.NoConfigs,
        TwilioConfigDefaultState.HasDefault,
        TwilioConfigDefaultState.NoDefault,
        TwilioConfigDefaultState.NoSmsDefault,
        TwilioConfigDefaultState.NoCallsDefault,
      ].map(getTwilioConfigCardDescription),
    ).toEqual([
      TwilioConfigDefaultCopy.cardDescription,
      TwilioConfigDefaultCopy.firstConfigCardDescription,
      TwilioConfigDefaultCopy.cardDescription,
      TwilioConfigDefaultCopy.noDefaultCardDescription,
      TwilioConfigDefaultCopy.noSmsDefaultCardDescription,
      TwilioConfigDefaultCopy.noCallsDefaultCardDescription,
    ]);
  });

  test.each([
    [TwilioConfigUse.CallsAndSms, "sms+calls", "Default", undefined],
    [TwilioConfigUse.CallsAndSms, "sms", "Default for SMS", CALLS_TITLE],
    [TwilioConfigUse.CallsAndSms, "calls", "Default for calls", SMS_TITLE],
    [TwilioConfigUse.CallsAndSms, "", undefined, SWITCH_TITLE],
    [TwilioConfigUse.SmsOnly, "sms", "Default for SMS", undefined],
    [TwilioConfigUse.SmsOnly, "", undefined, SMS_TITLE],
    [TwilioConfigUse.CallsOnly, "calls", "Default for calls", undefined],
    [TwilioConfigUse.CallsOnly, "", undefined, CALLS_TITLE],
  ])(
    "used for %s, the default for '%s': the pill and the menu's set action it has",
    (
      use: TwilioConfigUse,
      defaultFor: string,
      pill: string | undefined,
      setTitle: string | undefined,
    ) => {
      const config: JSONObject = listed(use, defaultFor as DefaultFor);

      expect(getProjectDefaultPillText(config)).toBe(pill);
      expect(getSetDefaultTitle(config)).toBe(setTitle);
    },
  );

  test("Stop Using as Project Default names what stops going through the config", () => {
    expect(
      getStopDefaultConfirmDescription(
        listed(TwilioConfigUse.CallsAndSms, "sms+calls"),
      ),
    ).toBe(TwilioConfigDefaultCopy.stopDefaultConfirmDescription);
    expect(
      getStopDefaultConfirmDescription(listed(TwilioConfigUse.SmsOnly, "sms")),
    ).toBe(TwilioConfigDefaultCopy.stopSmsDefaultConfirmDescription);
    expect(
      getStopDefaultConfirmDescription(
        listed(TwilioConfigUse.CallsAndSms, "calls"),
      ),
    ).toBe(TwilioConfigDefaultCopy.stopCallsDefaultConfirmDescription);
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

  test("while the configs cannot be read, the form claims nothing: the switch starts off", async () => {
    listFails = true;

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

  test("a row on screen ends the first-config form at once, before the card's read answers again", async () => {
    configCount = 0;

    await renderCard();

    expect(lastTableProps()["createInitialValues"]).toEqual({
      isProjectDefault: true,
    });

    // The first config was just added: the table lists it, the card's read lags.
    configCount = 1;
    listHangs = true;

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
  /*
   * The form would send the switch back as it read it, and a write of
   * isProjectDefault: true makes a config the default for everything it
   * sends: a config for calls and SMS that is the default for calls alone,
   * beside a default for SMS only, would take the SMS on every save of a
   * new name. The row's ⋯ menu changes the default instead.
   */
  test("has no default switch, and a save says nothing of the default", async () => {
    listedConfigs = [
      listed(TwilioConfigUse.CallsAndSms, "calls"),
      listed(TwilioConfigUse.SmsOnly, "sms"),
    ];
    stored = {
      name: "Production Twilio",
      usedFor: TwilioConfigUse.CallsAndSms,
      twilioAccountSID: "AC00000000000000000000000000000001",
      twilioAuthToken: "00000000000000000000000000000001",
      twilioPrimaryPhoneNumber: "+15551234567",
      isProjectDefault: true,
      isProjectDefaultForSms: false,
      isProjectDefaultForCalls: true,
    };

    await renderCard();
    await openForm("edit");

    await act(async (): Promise<void> => {
      fireEvent.click(within(dialog()).getByText("Twilio Config"));
    });
    await settle();

    // On the Twilio step, with the account read back - and no switch.
    expect(within(dialog()).getByLabelText("Twilio Account SID")).toHaveValue(
      "AC00000000000000000000000000000001",
    );
    expect(
      within(dialog()).queryByRole("switch", { name: SWITCH_TITLE }),
    ).toBeNull();
    expect(
      within(dialog()).queryByText(
        TwilioConfigDefaultCopy.defaultSwitchDescription,
      ),
    ).toBeNull();

    await clickFooter();

    const model: Record<string, unknown> = await saved();

    expect(model["name"]).toBe("Production Twilio");
    expect(model["isProjectDefault"]).toBeUndefined();
    expect(model["isProjectDefaultForSms"]).toBeUndefined();
    expect(model["isProjectDefaultForCalls"]).toBeUndefined();
  });

  test("the create form keeps the switch: it is where a new config says whether it is the default", async () => {
    await renderCard();

    const switches: Array<ModelField<ProjectCallSMSConfig>> = (
      lastTableProps()["formFields"] as Array<ModelField<ProjectCallSMSConfig>>
    ).filter((field: ModelField<ProjectCallSMSConfig>): boolean => {
      return Boolean(field.field && "isProjectDefault" in field.field);
    });

    // One for each answer to what the account is used for.
    expect(switches).toHaveLength(3);

    for (const field of switches) {
      expect(field.doNotShowWhenEditing).toBe(true);
      expect(field.doNotShowWhenCreating).toBeFalsy();
    }
  });
});

describe("Set as Project Default on a row", () => {
  test("is in the row's menu on every config but the default", async () => {
    configCount = 2;
    defaultCount = 1;

    await renderCard();

    for (const title of [SWITCH_TITLE, SMS_TITLE, CALLS_TITLE]) {
      const action: ActionButtonSchema<ProjectCallSMSConfig> =
        actionTitled(title);

      expect(action.placement).toBe(ActionButtonPlacement.MoreMenu);
      expect(action.icon).toBe(IconProp.Check);
      expect(action.disabled).toBe(false);
    }

    expect(defaultActionsOn(row(OTHER_CONFIG_ID, false))).toEqual([
      SWITCH_TITLE,
    ]);
    expect(defaultActionsOn(row(CONFIG_ID, true))).toEqual([STOP_TITLE]);
  });

  /*
   * One "Set as Project Default" a row, named for what the config would
   * take: the customer's config for calls only says it takes the calls -
   * the default for SMS keeps the SMS.
   */
  test("names what the config would take: the SMS, the calls, or both", async () => {
    await renderCard();

    expect(
      defaultActionsOn(row(OTHER_CONFIG_ID, false, TwilioConfigUse.SmsOnly)),
    ).toEqual([SMS_TITLE]);
    expect(
      defaultActionsOn(row(OTHER_CONFIG_ID, false, TwilioConfigUse.CallsOnly)),
    ).toEqual([CALLS_TITLE]);
    expect(
      defaultActionsOn(
        row(OTHER_CONFIG_ID, false, TwilioConfigUse.CallsAndSms),
      ),
    ).toEqual([SWITCH_TITLE]);
    // The default for calls alone, beside a default for SMS only.
    expect(
      defaultActionsOn(
        row(CONFIG_ID, true, TwilioConfigUse.CallsAndSms, "calls"),
      ),
    ).toEqual([SMS_TITLE, STOP_TITLE]);
    expect(
      defaultActionsOn(
        row(CONFIG_ID, true, TwilioConfigUse.CallsAndSms, "sms"),
      ),
    ).toEqual([CALLS_TITLE, STOP_TITLE]);
    // The default for everything it sends: nothing to take.
    expect(
      defaultActionsOn(row(CONFIG_ID, true, TwilioConfigUse.SmsOnly)),
    ).toEqual([STOP_TITLE]);
    expect(
      defaultActionsOn(row(CONFIG_ID, true, TwilioConfigUse.CallsOnly)),
    ).toEqual([STOP_TITLE]);
  });

  test("the customer's config for calls only is made the default with the same one write", async () => {
    listedConfigs = [
      listed(TwilioConfigUse.SmsOnly, "sms"),
      listed(TwilioConfigUse.CallsOnly, ""),
    ];

    await renderCard();

    expect(cardDescription()).toBe(
      TwilioConfigDefaultCopy.noCallsDefaultCardDescription,
    );

    const onComplete: MockFunction = getJestMockFunction();
    const onError: MockFunction = getJestMockFunction();

    // The server makes it the default for calls; the SMS default keeps the SMS.
    listedConfigs = [
      listed(TwilioConfigUse.SmsOnly, "sms"),
      listed(TwilioConfigUse.CallsOnly, "calls"),
    ];

    await act(async (): Promise<void> => {
      // Typed as returning nothing; the table's own action is async.
      await Promise.resolve(
        actionTitled(CALLS_TITLE).onClick(
          row(OTHER_CONFIG_ID, false, TwilioConfigUse.CallsOnly),
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
    expect(cardDescription()).toBe(TwilioConfigDefaultCopy.cardDescription);
  });

  test("leaves the test buttons as the row's own", async () => {
    await renderCard();

    const actions: Array<ActionButtonSchema<ProjectCallSMSConfig>> =
      lastTableProps()["actionButtons"] as Array<
        ActionButtonSchema<ProjectCallSMSConfig>
      >;

    expect(
      actions.map(
        (button: ActionButtonSchema<ProjectCallSMSConfig>): string => {
          return button.title;
        },
      ),
    ).toEqual([
      "Send Test SMS",
      "Send Test Call",
      SWITCH_TITLE,
      SMS_TITLE,
      CALLS_TITLE,
      STOP_TITLE,
    ]);

    // Every default action waits in the ⋯ menu.
    for (const button of actions.slice(2)) {
      expect(button.placement).toBe(ActionButtonPlacement.MoreMenu);
    }
  });

  test("makes that config the default, then lists and reads again", async () => {
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

    for (const title of [SWITCH_TITLE, SMS_TITLE, CALLS_TITLE, STOP_TITLE]) {
      const action: ActionButtonSchema<ProjectCallSMSConfig> =
        actionTitled(title);

      expect(action.disabled).toBe(true);
      expect(action.tooltip).toContain("You do not have permission to update");
    }

    expect(defaultActionsOn(row(OTHER_CONFIG_ID, false))).toEqual([
      SWITCH_TITLE,
    ]);
    expect(defaultActionsOn(row(CONFIG_ID, true))).toEqual([STOP_TITLE]);
  });

  test("is not offered while the permissions are still loading", async () => {
    permissions = [];
    configCount = 2;

    await renderCard();

    expect(defaultActionsOn(row(OTHER_CONFIG_ID, false))).toEqual([]);
    expect(
      defaultActionsOn(row(OTHER_CONFIG_ID, false, TwilioConfigUse.SmsOnly)),
    ).toEqual([]);
    expect(defaultActionsOn(row(CONFIG_ID, true))).toEqual([]);
  });
});

describe("Stop Using as Project Default on a row", () => {
  test("asks first, naming the config and what stops going through it", async () => {
    await renderCard();

    const action: ActionButtonSchema<ProjectCallSMSConfig> =
      actionTitled(STOP_TITLE);

    expect(action.icon).toBe(IconProp.Close);

    const both: RowActionConfirmation | undefined = action.getConfirmation!(
      row(CONFIG_ID, true),
    );

    expect(both).toEqual({
      title: "Stop using Production Twilio as the project default?",
      description: TwilioConfigDefaultCopy.stopDefaultConfirmDescription,
      submitButtonText: "Stop Using as Default",
    });
    expect(
      action.getConfirmation!(row(CONFIG_ID, true, TwilioConfigUse.SmsOnly))
        ?.description,
    ).toBe(TwilioConfigDefaultCopy.stopSmsDefaultConfirmDescription);
    expect(
      action.getConfirmation!(
        row(CONFIG_ID, true, TwilioConfigUse.CallsAndSms, "calls"),
      )?.description,
    ).toBe(TwilioConfigDefaultCopy.stopCallsDefaultConfirmDescription);
  });

  test("stops it being the default, then lists and reads again", async () => {
    configCount = 2;
    defaultCount = 1;

    await renderCard();

    expect(cardDescription()).toBe(TwilioConfigDefaultCopy.cardDescription);

    const reportsBefore: number = fetchReports;
    const onComplete: MockFunction = getJestMockFunction();
    const onError: MockFunction = getJestMockFunction();

    // No other config is a default to take the SMS and calls.
    defaultCount = 0;

    await act(async (): Promise<void> => {
      // Typed as returning nothing; the table's own action is async.
      await Promise.resolve(
        actionTitled(STOP_TITLE).onClick(
          row(CONFIG_ID, true),
          onComplete as unknown as () => void,
          onError as unknown as (error: Error) => void,
        ),
      );
    });
    await settle();

    expect(updates).toEqual([
      {
        id: CONFIG_ID,
        data: { isProjectDefault: false },
        modelName: "ProjectCallSMSConfig",
      },
    ]);
    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(fetchReports).toBe(reportsBefore + 1);
    expect(cardDescription()).toBe(
      TwilioConfigDefaultCopy.noDefaultCardDescription,
    );
  });

  test("a refusal is shown in the dialog, and nothing is listed again", async () => {
    updateFails = true;

    await renderCard();

    const reportsBefore: number = fetchReports;
    const onComplete: MockFunction = getJestMockFunction();
    const onError: MockFunction = getJestMockFunction();

    await act(async (): Promise<void> => {
      await Promise.resolve(
        actionTitled(STOP_TITLE).onClick(
          row(CONFIG_ID, true),
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
});

describe("the Project Default column", () => {
  test("says what each config is the default for", async () => {
    await renderCard();

    expect(projectDefaultCell(row(CONFIG_ID, true))).toBe("Default");
    expect(
      projectDefaultCell(row(CONFIG_ID, true, TwilioConfigUse.SmsOnly)),
    ).toBe("Default for SMS");
    expect(
      projectDefaultCell(row(CONFIG_ID, true, TwilioConfigUse.CallsOnly)),
    ).toBe("Default for calls");
    expect(
      projectDefaultCell(
        row(CONFIG_ID, true, TwilioConfigUse.CallsAndSms, "calls"),
      ),
    ).toBe("Default for calls");
    expect(projectDefaultCell(row(OTHER_CONFIG_ID, false))).toBe("-");
  });

  test("exports what the row says", async () => {
    await renderCard();

    const column: Column<ProjectCallSMSConfig> = projectDefaultColumn();

    expect(column.getExportValue!(row(CONFIG_ID, true))).toBe("Default");
    expect(
      column.getExportValue!(row(CONFIG_ID, true, TwilioConfigUse.SmsOnly)),
    ).toBe("Default for SMS");
    expect(column.getExportValue!(row(OTHER_CONFIG_ID, false))).toBe("");
  });
});

/*
 * The words a default for SMS and one for calls add (#6574): Dashboard
 * keys, translated in every language the Dashboard is translated into -
 * Arabic, partly translated, keeps its sibling Twilio strings in English
 * (Locales/ARABIC.md) - with the Stop question's {{config}} in each, and
 * the card quoting the row action as the language's menu names it.
 */
describe("the strings a default for SMS and one for calls add", () => {
  const LOCALES_DIR: string = path.join(
    __dirname,
    "../../../../App/FeatureSet/Dashboard/src/Locales",
  );

  const KEYS: Array<string> = [
    TwilioConfigDefaultCopy.noSmsDefaultCardDescription,
    TwilioConfigDefaultCopy.noCallsDefaultCardDescription,
    TwilioConfigDefaultCopy.setSmsDefaultTitle,
    TwilioConfigDefaultCopy.setCallsDefaultTitle,
    TwilioConfigDefaultCopy.smsDefaultPillText,
    TwilioConfigDefaultCopy.callsDefaultPillText,
    TwilioConfigDefaultCopy.stopDefaultConfirmTitle,
    TwilioConfigDefaultCopy.stopDefaultConfirmDescription,
    TwilioConfigDefaultCopy.stopSmsDefaultConfirmDescription,
    TwilioConfigDefaultCopy.stopCallsDefaultConfirmDescription,
    TwilioConfigDefaultCopy.defaultSwitchDescription,
    TwilioConfigDefaultCopy.smsOnlyDefaultSwitchDescription,
    TwilioConfigDefaultCopy.callsOnlyDefaultSwitchDescription,
    // The Dashboard's already: the Runners' own default actions use them.
    TwilioConfigDefaultCopy.setDefaultTitle,
    TwilioConfigDefaultCopy.defaultPillText,
    TwilioConfigDefaultCopy.stopDefaultTitle,
    TwilioConfigDefaultCopy.stopDefaultConfirmButton,
  ];

  function readLocale(language: string): Record<string, string> {
    return JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
    ) as Record<string, string>;
  }

  test("are Dashboard keys, and none says one config is the project default any more", () => {
    const english: Record<string, string> = readLocale("en");

    for (const key of KEYS) {
      expect({ key, inEnglish: english[key] }).toEqual({ key, inEnglish: key });
    }

    expect(
      Object.keys(english).filter((key: string): boolean => {
        return key.startsWith("One config is the project default");
      }),
    ).toEqual([]);
  });

  test.each([
    "de",
    "fr",
    "es",
    "it",
    "pt",
    "nl",
    "da",
    "no",
    "sv",
    "ru",
    "ja",
    "ko",
    "zh-CN",
    "zh-TW",
    "hi",
    "fa",
  ])("are translated in %s", (language: string) => {
    const words: Record<string, string> = readLocale(language);

    for (const key of KEYS) {
      expect({
        language,
        key,
        translated: Boolean(words[key]) && words[key] !== key,
      }).toEqual({ language, key, translated: true });
    }

    expect(words[TwilioConfigDefaultCopy.stopDefaultConfirmTitle]).toContain(
      "{{config}}",
    );

    for (const sentence of [
      TwilioConfigDefaultCopy.noSmsDefaultCardDescription,
      TwilioConfigDefaultCopy.noCallsDefaultCardDescription,
    ]) {
      expect(words[sentence]).toContain(
        words[TwilioConfigDefaultCopy.setDefaultTitle],
      );
    }
  });
});
