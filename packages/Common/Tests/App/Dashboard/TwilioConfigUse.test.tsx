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
  RenderResult,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement } from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import { JSONObject } from "../../../Types/JSON";
import Permission from "../../../Types/Permission";
import { FormType, ModelField } from "../../../UI/Components/Forms/ModelForm";
import ModelFormModal from "../../../UI/Components/ModelFormModal/ModelFormModal";
import { ComponentProps as ModelTableProps } from "../../../UI/Components/ModelTable/ModelTable";
import ActionButtonSchema from "../../../UI/Components/ActionButton/ActionButtonSchema";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  getByTextOutsideFoldedHeaders,
  listedNames,
} from "../../UI/Components/FoldedSection/FoldedSectionQueries";

/*
 * A TWILIO CONFIG'S FORM ASKS WHAT THE ACCOUNT IS USED FOR FIRST, THEN ONLY
 * FOR THE NUMBERS THAT TAKES - on the Twilio Config card of Project
 * Settings > Notifications > Notification Settings: the real component,
 * through the real ModelFormModal, ModelForm and BasicForm. Only the network
 * and the table around the dialog are stand-ins.
 *
 * A customer's account sent only SMS, yet the form made them type in a
 * number to make calls from, while the number their SMS went out from was
 * an optional field under More fields. So:
 *
 *   - the Basic step asks "Use This Account For": Calls and SMS (what most
 *     accounts are, picked to start with), SMS only or Calls only, each
 *     saying in one line what it means for the rest;
 *   - SMS only asks for the SMS numbers, open and required, and nothing to
 *     make calls from; nothing is folded;
 *   - Calls only asks for the number calls go out from, and folds only the
 *     secondary numbers; nothing for SMS;
 *   - Calls and SMS is the form as it was;
 *   - each saves what it is used for with its numbers, and refuses itself
 *     without them;
 *   - the default switch says what goes through the default for each
 *     answer;
 *   - an SMS-only config's row offers Send Test SMS alone, a calls-only
 *     config's Send Test Call alone, and its Phone Numbers cell shows the
 *     numbers it sends from, each marked with what it sends.
 */

jest.setTimeout(60000);

const CONFIG_ID: string = "1f000000-0000-4000-8000-000000000001";

const US: string = "+14155550100";
const SG_MOBILE: string = "+6581234567";
const UK: string = "+447700900123";

let configCount: number;
let stored: JSONObject;
let capturedModels: Array<Record<string, unknown>>;
let tableProps: Array<Record<string, unknown>>;

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: <TBaseModel extends BaseModel>(
      props: ModelTableProps<TBaseModel>,
    ): ReactElement => {
      tableProps.push(props as unknown as Record<string, unknown>);

      const [open, setOpen] = React.useState<"create" | "edit" | null>(null);

      React.useEffect(() => {
        props.onFetchSuccess?.([], configCount);
      }, [props.refreshToggle]);

      const isCreate: boolean = open === "create";
      const singularName: string = new props.modelType().singularName || "";
      const ObjectIDClass: any = (
        jest.requireActual("../../../Types/ObjectID") as any
      ).default;

      return (
        <div>
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
        return "isProjectDefault" in data.query
          ? Math.min(configCount, 1)
          : configCount;
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
      updateById: async (): Promise<unknown> => {
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
        const ObjectIDClass: any = (
          jest.requireActual("../../../Types/ObjectID") as any
        ).default;
        return new ObjectIDClass("99999999-9999-4999-8999-999999999999");
      },
    },
  };
});

import CustomCallSMSTable from "../../../../App/FeatureSet/Dashboard/src/Components/CallSMS/CallSMSConfigTable";
import TwilioConfigUseCopy, {
  getFormTwilioConfigUse,
  getTwilioConfigUseOptions,
  getTwilioConfigUseTitle,
  isFormUsedFor,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CallSMS/TwilioConfigUseCopy";
import TwilioConfigNumbersCopy, {
  getTwilioConfigNumberLines,
  getTwilioConfigNumbersForExport,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CallSMS/TwilioConfigNumbersCopy";
import TwilioConfigDefaultCopy, {
  getDefaultSwitchDescription,
  TwilioConfigDefaultState,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CallSMS/TwilioConfigDefaultCopy";
import TwilioConfigPhoneNumbers from "../../../../App/FeatureSet/Dashboard/src/Components/CallSMS/TwilioConfigPhoneNumbers";
import ProjectCallSMSConfig from "../../../Models/DatabaseModels/ProjectCallSMSConfig";
import {
  TWILIO_CONFIG_USES,
  TwilioConfigUse,
} from "../../../Types/CallAndSMS/TwilioConfigUse";
import Phone from "../../../Types/Phone";
import Filter from "../../../UI/Components/ModelFilter/Filter";
import Column from "../../../UI/Components/ModelTable/Column";

const PRIMARY: string = "Twilio Primary Phone Number";
const SMS_NUMBERS: string = "Twilio SMS Phone Numbers";
const SECONDARY: string = "Twilio Secondary Phone Numbers";

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

function readLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

function dialog(): HTMLElement {
  return screen.getByTestId("modal");
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

function radio(answer: string): HTMLInputElement {
  return within(dialog()).getByRole("radio", {
    name: answer,
  }) as HTMLInputElement;
}

async function pick(answer: string): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(radio(answer));
  });
  await settle();
}

async function type(label: string, value: string): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.change(within(dialog()).getByLabelText(label, { exact: false }), {
      target: { value },
    });
  });
}

async function clickFooter(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(
      within(dialog()).queryByTestId("modal-footer-next-button") ||
        within(dialog()).getByTestId("modal-footer-submit-button"),
    );
  });
  await settle();
}

// Names the config and answers the question, then walks to the Twilio step.
async function walkToTwilioStep(answer?: string): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.change(
      within(dialog()).getByPlaceholderText("Company Twilio Account"),
      { target: { value: "Singapore SMS" } },
    );
  });

  if (answer) {
    await pick(answer);
  }

  await clickFooter();

  await waitFor(() => {
    expect(
      within(dialog()).getByRole("switch", { name: "Set as Project Default" }),
    ).toBeVisible();
  });
}

async function fillAccount(): Promise<void> {
  await type("Twilio Account SID", "AC00000000000000000000000000000001");
  await type("Twilio Auth Token", "00000000000000000000000000000001");
}

function moreFieldsHeader(): HTMLElement | null {
  return within(dialog()).queryByRole("button", { name: /More fields/ });
}

function label(text: string): HTMLElement {
  return getByTextOutsideFoldedHeaders(dialog(), text);
}

function hasLabel(text: string): boolean {
  return within(dialog())
    .queryAllByText(text)
    .some((element: HTMLElement): boolean => {
      return !element.closest("[data-testid='folded-section-header']");
    });
}

function lastTableProps(): Record<string, unknown> {
  return tableProps[tableProps.length - 1]!;
}

function textOf(value: unknown): string {
  return value === undefined || value === null ? "" : String(value);
}

beforeEach(() => {
  configCount = 1;
  stored = {};
  capturedModels = [];
  tableProps = [];
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the Basic step asks what the account is used for", () => {
  test("with three answers, each saying in one line what it means, Calls and SMS picked to start with", async () => {
    await renderCard();
    await openForm("create");

    expect(label(TwilioConfigUseCopy.fieldTitle)).toBeVisible();

    for (const option of getTwilioConfigUseOptions()) {
      const input: HTMLInputElement = radio(option.title);

      expect(input).toBeVisible();
      // The line under the answer describes it.
      expect(
        document.getElementById(input.getAttribute("aria-describedby") || ""),
      ).toHaveTextContent(option.description);
    }

    expect(radio("Calls and SMS").checked).toBe(true);
    expect(radio("SMS only").checked).toBe(false);
    expect(radio("Calls only").checked).toBe(false);
  });

  test("the answers say what each means for what the account does not send", () => {
    expect(
      getTwilioConfigUseOptions().map(
        (option: { title: string; description: string }) => {
          return [option.title, option.description];
        },
      ),
    ).toEqual([
      ["Calls and SMS", "Calls and SMS go out from this account."],
      ["SMS only", "Calls go through OneUptime's own Twilio account instead."],
      ["Calls only", "SMS go through OneUptime's own Twilio account instead."],
    ]);
    expect(TwilioConfigUseCopy.fieldTitle).toBe("Use This Account For");
  });

  test("comes before any number: the Twilio step has none of the answers", async () => {
    await renderCard();
    await openForm("create");
    await walkToTwilioStep();

    expect(within(dialog()).queryByRole("radio", { name: "SMS only" })).toBe(
      null,
    );
  });
});

describe("an account used for SMS only", () => {
  test("is asked for its SMS numbers, open and required, and nothing to make calls from", async () => {
    await renderCard();
    await openForm("create");
    await walkToTwilioStep("SMS only");

    expect(label(SMS_NUMBERS)).toBeVisible();
    expect(label(SMS_NUMBERS)).not.toHaveTextContent("(Optional)");
    expect(
      within(dialog()).getByText(
        TwilioConfigUseCopy.smsOnlyPhoneNumbersDescription,
      ),
    ).toBeVisible();
    expect(hasLabel(PRIMARY)).toBe(false);
    expect(hasLabel(SECONDARY)).toBe(false);
    // Nothing is folded: there is nothing more for it.
    expect(moreFieldsHeader()).toBeNull();
  });

  test("is saved used for SMS only, with its SMS numbers and no number to make calls from", async () => {
    await renderCard();
    await openForm("create");
    await walkToTwilioStep("SMS only");
    await fillAccount();
    await type(SMS_NUMBERS, `${SG_MOBILE}, ${UK}`);
    await clickFooter();

    await waitFor(() => {
      expect(capturedModels).toHaveLength(1);
    });

    const model: Record<string, unknown> = capturedModels[0]!;

    expect(model["usedFor"]).toBe(TwilioConfigUse.SmsOnly);
    expect(model["twilioSmsPhoneNumbers"]).toBe(`${SG_MOBILE}, ${UK}`);
    expect(textOf(model["twilioPrimaryPhoneNumber"])).toBe("");
  });

  test("without SMS numbers is refused under the field, and nothing is saved", async () => {
    await renderCard();
    await openForm("create");
    await walkToTwilioStep("SMS only");
    await fillAccount();
    await clickFooter();

    await waitFor(() => {
      expect(
        within(dialog()).getByText(`${SMS_NUMBERS} is required.`),
      ).toBeVisible();
    });
    expect(capturedModels).toHaveLength(0);
  });

  test("with a list that is not numbers is refused by the server's rule", async () => {
    await renderCard();
    await openForm("create");
    await walkToTwilioStep("SMS only");
    await fillAccount();
    await type(SMS_NUMBERS, `${SG_MOBILE}, mobile`);
    await clickFooter();

    await waitFor(() => {
      expect(
        within(dialog()).getByText(
          '"mobile" is not a phone number. Write each number with its country code and separate them with commas, like +14155550123, +447700900123.',
        ),
      ).toBeVisible();
    });
    expect(capturedModels).toHaveLength(0);
  });

  test("the default switch says the SMS go through it, for the first config and any other", async () => {
    configCount = 0;

    await renderCard();
    await openForm("create");
    await walkToTwilioStep("SMS only");

    expect(
      within(dialog()).getByText(
        TwilioConfigDefaultCopy.smsOnlyFirstConfigSwitchDescription,
      ),
    ).toBeVisible();
    expect(
      within(dialog()).getByRole("switch", { name: "Set as Project Default" }),
    ).toHaveAttribute("aria-checked", "true");
  });
});

describe("an account used for calls only", () => {
  test("is asked for the number calls go out from, with only the secondary numbers folded", async () => {
    await renderCard();
    await openForm("create");
    await walkToTwilioStep("Calls only");

    expect(label(PRIMARY)).toBeVisible();
    expect(label(PRIMARY)).not.toHaveTextContent("(Optional)");
    expect(
      within(dialog()).getByText(
        TwilioConfigUseCopy.callsOnlyPrimaryPhoneNumberDescription,
      ),
    ).toBeVisible();
    // The calls-and-SMS help, which talks of SMS, is not shown.
    expect(
      within(dialog()).queryByText(
        TwilioConfigNumbersCopy.primaryPhoneNumberDescription,
      ),
    ).toBeNull();
    expect(listedNames(moreFieldsHeader())).toEqual([SECONDARY]);
    expect(hasLabel(SMS_NUMBERS)).toBe(false);
  });

  test("is saved used for calls only, with its number", async () => {
    await renderCard();
    await openForm("create");
    await walkToTwilioStep("Calls only");
    await fillAccount();
    await type(PRIMARY, US);
    await clickFooter();

    await waitFor(() => {
      expect(capturedModels).toHaveLength(1);
    });

    expect(capturedModels[0]!["usedFor"]).toBe(TwilioConfigUse.CallsOnly);
    expect(textOf(capturedModels[0]!["twilioPrimaryPhoneNumber"])).toBe(US);
  });

  test("without its number is refused, and nothing is saved", async () => {
    await renderCard();
    await openForm("create");
    await walkToTwilioStep("Calls only");
    await fillAccount();
    await clickFooter();

    await waitFor(() => {
      expect(
        within(dialog()).getByText(`${PRIMARY} is required.`),
      ).toBeVisible();
    });
    expect(capturedModels).toHaveLength(0);
  });

  test("the default switch says the calls go through it", async () => {
    await renderCard();
    await openForm("create");
    await walkToTwilioStep("Calls only");

    expect(
      within(dialog()).getByText(
        TwilioConfigDefaultCopy.callsOnlyDefaultSwitchDescription,
      ),
    ).toBeVisible();
  });
});

describe("an account used for calls and SMS", () => {
  test("is the form as it was: the primary number, and the SMS and secondary numbers folded", async () => {
    await renderCard();
    await openForm("create");
    await walkToTwilioStep();

    expect(label(PRIMARY)).toBeVisible();
    expect(
      within(dialog()).getByText(
        TwilioConfigNumbersCopy.primaryPhoneNumberDescription,
      ),
    ).toBeVisible();
    expect(listedNames(moreFieldsHeader())).toEqual([SMS_NUMBERS, SECONDARY]);
    expect(
      within(dialog()).getByText(
        TwilioConfigDefaultCopy.defaultSwitchDescription,
      ),
    ).toBeVisible();
  });

  test("is saved used for calls and SMS", async () => {
    await renderCard();
    await openForm("create");
    await walkToTwilioStep();
    await fillAccount();
    await type(PRIMARY, US);
    await clickFooter();

    await waitFor(() => {
      expect(capturedModels).toHaveLength(1);
    });

    expect(capturedModels[0]!["usedFor"]).toBe(TwilioConfigUse.CallsAndSms);
  });

  test("a number typed for one answer is kept when another is picked and back", async () => {
    await renderCard();
    await openForm("create");
    await walkToTwilioStep("SMS only");
    await fillAccount();
    await type(SMS_NUMBERS, SG_MOBILE);

    // Back to the Basic step, through the step list.
    await act(async (): Promise<void> => {
      fireEvent.click(within(dialog()).getByText("Basic"));
    });
    await settle();
    await pick("Calls and SMS");
    await clickFooter();

    // Folded now, under More fields, with the number still in it.
    expect(listedNames(moreFieldsHeader())).toEqual([
      `${SMS_NUMBERS}: ${SG_MOBILE}`,
      SECONDARY,
    ]);
  });
});

describe("editing a config", () => {
  test("of an account used for SMS only shows that answer, and its numbers on the Twilio step", async () => {
    stored = {
      name: "Singapore SMS",
      usedFor: TwilioConfigUse.SmsOnly,
      twilioAccountSID: "AC00000000000000000000000000000001",
      twilioAuthToken: "00000000000000000000000000000001",
      twilioSmsPhoneNumbers: SG_MOBILE,
      isProjectDefault: true,
    };

    await renderCard();
    await openForm("edit");

    expect(radio("SMS only").checked).toBe(true);

    await act(async (): Promise<void> => {
      fireEvent.click(within(dialog()).getByText("Twilio Config"));
    });
    await settle();

    expect(
      within(dialog()).getByLabelText(SMS_NUMBERS, { exact: false }),
    ).toHaveValue(SG_MOBILE);
    expect(hasLabel(PRIMARY)).toBe(false);
  });

  test("of an existing config used for calls and SMS, moved to SMS only, needs its SMS numbers", async () => {
    stored = {
      name: "Production",
      usedFor: TwilioConfigUse.CallsAndSms,
      twilioAccountSID: "AC00000000000000000000000000000001",
      twilioAuthToken: "00000000000000000000000000000001",
      twilioPrimaryPhoneNumber: US,
      isProjectDefault: true,
    };

    await renderCard();
    await openForm("edit");

    expect(radio("Calls and SMS").checked).toBe(true);

    await pick("SMS only");

    // Save from the last step: it checks every step, and opens the failing one.
    await act(async (): Promise<void> => {
      fireEvent.click(within(dialog()).getByText("Twilio Config"));
    });
    await settle();
    await clickFooter();

    await waitFor(() => {
      expect(
        within(dialog()).getByText(`${SMS_NUMBERS} is required.`),
      ).toBeVisible();
    });
    expect(capturedModels).toHaveLength(0);

    await type(SMS_NUMBERS, SG_MOBILE);
    await clickFooter();

    await waitFor(() => {
      expect(capturedModels).toHaveLength(1);
    });
    expect(capturedModels[0]!["usedFor"]).toBe(TwilioConfigUse.SmsOnly);
    expect(capturedModels[0]!["twilioSmsPhoneNumbers"]).toBe(SG_MOBILE);
  });

  test("of a config saved before the choice - nothing stored for it - reads as calls and SMS", async () => {
    stored = {
      name: "Production",
      twilioAccountSID: "AC00000000000000000000000000000001",
      twilioAuthToken: "00000000000000000000000000000001",
      twilioPrimaryPhoneNumber: US,
    };

    await renderCard();
    await openForm("edit");

    expect(radio("Calls and SMS").checked).toBe(true);
  });
});

describe("the Twilio Config table", () => {
  type Action = ActionButtonSchema<ProjectCallSMSConfig>;

  function actionTitled(title: string): Action {
    return (lastTableProps()["actionButtons"] as Array<Action>).find(
      (action: Action): boolean => {
        return action.title === title;
      },
    )!;
  }

  function configUsedFor(
    use: TwilioConfigUse | undefined,
  ): ProjectCallSMSConfig {
    const config: ProjectCallSMSConfig = new ProjectCallSMSConfig();

    if (use) {
      config.usedFor = use;
    }

    config.twilioPrimaryPhoneNumber = new Phone(US);
    config.twilioSmsPhoneNumbers = SG_MOBILE;
    return config;
  }

  test("offers on each row only the tests of what the config sends", async () => {
    await renderCard();

    const sms: Action = actionTitled("Send Test SMS");
    const call: Action = actionTitled("Send Test Call");

    expect(sms.isVisible!(configUsedFor(TwilioConfigUse.SmsOnly))).toBe(true);
    expect(call.isVisible!(configUsedFor(TwilioConfigUse.SmsOnly))).toBe(false);
    expect(sms.isVisible!(configUsedFor(TwilioConfigUse.CallsOnly))).toBe(
      false,
    );
    expect(call.isVisible!(configUsedFor(TwilioConfigUse.CallsOnly))).toBe(
      true,
    );

    for (const both of [TwilioConfigUse.CallsAndSms, undefined]) {
      expect(sms.isVisible!(configUsedFor(both))).toBe(true);
      expect(call.isVisible!(configUsedFor(both))).toBe(true);
    }
  });

  test("reads what each config is used for, and can filter by it", async () => {
    await renderCard();

    expect(
      (lastTableProps()["selectMoreFields"] as Record<string, unknown>)[
        "usedFor"
      ],
    ).toBe(true);

    const filter: Filter<ProjectCallSMSConfig> | undefined = (
      lastTableProps()["filters"] as Array<Filter<ProjectCallSMSConfig>>
    ).find((candidate: Filter<ProjectCallSMSConfig>): boolean => {
      return Object.keys(candidate.field || {})[0] === "usedFor";
    });

    expect(filter?.title).toBe("Used For");
    expect(
      (filter?.filterDropdownOptions || []).map(
        (option: { value: unknown; label: string }) => {
          return [option.value, option.label];
        },
      ),
    ).toEqual([
      [TwilioConfigUse.CallsAndSms, "Calls and SMS"],
      [TwilioConfigUse.SmsOnly, "SMS only"],
      [TwilioConfigUse.CallsOnly, "Calls only"],
    ]);
  });
});

/*
 * What a config is used for is the one answer that decides what it sends,
 * so its row says it in a column of its own, beside the name, in the words
 * of the form's answers - not only through the icons of its numbers. The
 * Twilio Account SID, cut to half under the row's actions beside the side
 * menu, starts hidden: one switch away in Customize Columns.
 */
describe("the table's Used For column", () => {
  function columns(): Array<Column<ProjectCallSMSConfig>> {
    return lastTableProps()["columns"] as Array<Column<ProjectCallSMSConfig>>;
  }

  function columnOf(key: string): Column<ProjectCallSMSConfig> {
    return columns().find((column: Column<ProjectCallSMSConfig>): boolean => {
      return Object.keys(column.field || {})[0] === key;
    })!;
  }

  function configUsedFor(value: unknown): ProjectCallSMSConfig {
    const config: ProjectCallSMSConfig = new ProjectCallSMSConfig();

    if (value !== undefined) {
      (config as unknown as Record<string, unknown>)["usedFor"] = value;
    }

    config.twilioPrimaryPhoneNumber = new Phone(US);
    return config;
  }

  // The cell a config's row draws under Used For, as its text.
  function cellText(value: unknown): string {
    const cell: RenderResult = render(
      columnOf("usedFor").getElement!(configUsedFor(value)),
    );
    const text: string =
      screen.getByTestId("twilio-config-used-for").textContent || "";
    cell.unmount();
    return text;
  }

  test("comes right after the name, before the numbers and the default", async () => {
    await renderCard();

    expect(
      columns().map((column: Column<ProjectCallSMSConfig>): string => {
        return column.title;
      }),
    ).toEqual([
      "Name",
      "Used For",
      "Phone Numbers",
      "Project Default",
      "Twilio Account SID",
    ]);
    expect(columnOf("usedFor").isHiddenByDefault).toBeFalsy();
  });

  test("names each use as the form's answers do", async () => {
    await renderCard();

    expect(cellText(TwilioConfigUse.SmsOnly)).toBe("SMS only");
    expect(cellText(TwilioConfigUse.CallsOnly)).toBe("Calls only");
    expect(cellText(TwilioConfigUse.CallsAndSms)).toBe("Calls and SMS");

    // The answers' own titles, one for one.
    for (const option of getTwilioConfigUseOptions()) {
      expect(getTwilioConfigUseTitle(option.value)).toBe(option.title);
    }
  });

  test("reads a config saved before the choice, or holding no use, as calls and SMS", async () => {
    await renderCard();

    expect(cellText(undefined)).toBe("Calls and SMS");
    expect(cellText("nonsense")).toBe("Calls and SMS");
    expect(getTwilioConfigUseTitle(null)).toBe("Calls and SMS");
  });

  test("exports the use as the API and the Used For filter name it", async () => {
    await renderCard();

    const exportValue: (item: ProjectCallSMSConfig) => string =
      columnOf("usedFor").getExportValue!;

    expect(exportValue(configUsedFor(TwilioConfigUse.SmsOnly))).toBe(
      "SMS only",
    );
    expect(exportValue(configUsedFor(TwilioConfigUse.CallsOnly))).toBe(
      "Calls only",
    );
    expect(exportValue(configUsedFor(undefined))).toBe("Calls and SMS");
  });

  test.each([
    ["de", "Nur SMS", "Nur Anrufe"],
    ["ja", "SMS のみ", "通話のみ"],
  ])(
    "says it in the reader's language (%s)",
    async (language: string, smsOnly: string, callsOnly: string) => {
      const instance: i18n = createInstance();

      await instance.init({
        lng: language,
        fallbackLng: "en",
        resources: {
          en: { translation: readLocale("en") },
          [language]: { translation: readLocale(language) },
        },
        interpolation: { escapeValue: false },
      });

      render(
        <I18nextProvider i18n={instance}>
          <MemoryRouter>
            <CustomCallSMSTable />
          </MemoryRouter>
        </I18nextProvider>,
      );
      await settle();

      expect(readLocale(language)["SMS only"]).toBe(smsOnly);
      expect(readLocale(language)["Calls only"]).toBe(callsOnly);
      expect(cellText(TwilioConfigUse.SmsOnly)).toBe(smsOnly);
      expect(cellText(TwilioConfigUse.CallsOnly)).toBe(callsOnly);
    },
  );

  test("leaves the Twilio account SID one switch away: last, and hidden to start with", async () => {
    await renderCard();

    const sid: Column<ProjectCallSMSConfig> = columnOf("twilioAccountSID");

    expect(columns()[columns().length - 1]).toBe(sid);
    expect(sid.isHiddenByDefault).toBe(true);
    // Not pinned: Customize Columns can switch it on.
    expect(sid.isNotCustomizable).toBeFalsy();
    expect(lastTableProps()["userPreferencesKey"]).toBe("call-sms-table");
    expect(lastTableProps()["disableColumnCustomization"]).toBeFalsy();

    // Every other column is shown.
    expect(
      columns()
        .filter((column: Column<ProjectCallSMSConfig>): boolean => {
          return Boolean(column.isHiddenByDefault);
        })
        .map((column: Column<ProjectCallSMSConfig>): string => {
          return column.title;
        }),
    ).toEqual(["Twilio Account SID"]);
  });
});

describe("a config's numbers in its row", () => {
  test("used for SMS only, show its SMS numbers alone, marked as SMS - not a number it keeps for calls", () => {
    expect(
      getTwilioConfigNumberLines({
        usedFor: TwilioConfigUse.SmsOnly,
        twilioPrimaryPhoneNumber: US,
        twilioSmsPhoneNumbers: `${SG_MOBILE}, ${UK}`,
      }),
    ).toEqual([
      { phoneNumber: SG_MOBILE, label: "SMS", otherPhoneNumbers: [UK] },
    ]);

    render(
      <TwilioConfigPhoneNumbers
        config={{
          usedFor: TwilioConfigUse.SmsOnly,
          twilioSmsPhoneNumbers: SG_MOBILE,
        }}
      />,
    );

    const cell: HTMLElement = screen.getByTestId("twilio-config-phone-numbers");

    expect(cell.textContent).toBe(SG_MOBILE);
    expect(within(cell).getByRole("img", { name: "SMS" })).toBeVisible();
    expect(within(cell).queryByRole("img", { name: "Phone Calls" })).toBeNull();
  });

  test("used for calls only, show its number marked for calls - not SMS numbers it keeps", () => {
    expect(
      getTwilioConfigNumberLines({
        usedFor: TwilioConfigUse.CallsOnly,
        twilioPrimaryPhoneNumber: new Phone(US),
        twilioSecondaryPhoneNumbers: UK,
        twilioSmsPhoneNumbers: SG_MOBILE,
      }),
    ).toEqual([
      { phoneNumber: US, label: "Phone Calls", otherPhoneNumbers: [UK] },
    ]);
  });

  test("used for calls and SMS, show as they always did", () => {
    for (const usedFor of [undefined, TwilioConfigUse.CallsAndSms]) {
      expect(
        getTwilioConfigNumberLines({
          usedFor: usedFor,
          twilioPrimaryPhoneNumber: US,
        }),
      ).toEqual([{ phoneNumber: US, label: null, otherPhoneNumbers: [] }]);
    }
  });

  test("are exported with what each sends", () => {
    expect(
      getTwilioConfigNumbersForExport({
        usedFor: TwilioConfigUse.SmsOnly,
        twilioSmsPhoneNumbers: `${SG_MOBILE},${UK}`,
      }),
    ).toBe(`SMS: ${SG_MOBILE}, ${UK}`);
    expect(
      getTwilioConfigNumbersForExport({
        usedFor: TwilioConfigUse.CallsOnly,
        twilioPrimaryPhoneNumber: US,
      }),
    ).toBe(`Phone Calls: ${US}`);
    // Nothing to send from: nothing shown.
    expect(
      getTwilioConfigNumberLines({ usedFor: TwilioConfigUse.SmsOnly }),
    ).toEqual([]);
  });
});

describe("what decides which fields show", () => {
  test("a form that has picked nothing is used for calls and SMS", () => {
    expect(getFormTwilioConfigUse({})).toBe(TwilioConfigUse.CallsAndSms);
    expect(getFormTwilioConfigUse({ usedFor: "nonsense" })).toBe(
      TwilioConfigUse.CallsAndSms,
    );
    expect(isFormUsedFor(TwilioConfigUse.CallsAndSms)({})).toBe(true);
  });

  test("each answer shows its own fields, and never two answers' at once", () => {
    for (const use of TWILIO_CONFIG_USES) {
      const shown: Array<TwilioConfigUse> = TWILIO_CONFIG_USES.filter(
        (candidate: TwilioConfigUse): boolean => {
          return isFormUsedFor(candidate)({ usedFor: use });
        },
      );

      expect(shown).toEqual([use]);
    }

    expect(
      isFormUsedFor(
        TwilioConfigUse.CallsAndSms,
        TwilioConfigUse.CallsOnly,
      )({
        usedFor: TwilioConfigUse.SmsOnly,
      }),
    ).toBe(false);
  });

  test("the default switch's help follows the answer and whether the config is the project's first", () => {
    expect(
      getDefaultSwitchDescription(
        TwilioConfigDefaultState.HasDefault,
        TwilioConfigUse.SmsOnly,
      ),
    ).toBe(
      "One config is the project default: the SMS to people in this project, such as on-call alerts, go through it. Status pages use the config picked on each page.",
    );
    expect(
      getDefaultSwitchDescription(
        TwilioConfigDefaultState.NoConfigs,
        TwilioConfigUse.CallsOnly,
      ),
    ).toBe(
      "This is the project's first Twilio config, so it starts as the project default: the calls to people in this project, such as on-call alerts and verification codes, will go through it. Turn this off if this account is only for incoming calls.",
    );
    // Without an answer, as before the choice.
    expect(
      getDefaultSwitchDescription(TwilioConfigDefaultState.HasDefault),
    ).toBe(TwilioConfigDefaultCopy.defaultSwitchDescription);
    expect(
      getDefaultSwitchDescription(TwilioConfigDefaultState.NoConfigs),
    ).toBe(TwilioConfigDefaultCopy.firstConfigSwitchDescription);
  });
});

describe("the strings the choice adds", () => {
  const KEYS: Array<string> = [
    TwilioConfigUseCopy.fieldTitle,
    TwilioConfigUseCopy.callsAndSmsTitle,
    TwilioConfigUseCopy.callsAndSmsDescription,
    TwilioConfigUseCopy.smsOnlyTitle,
    TwilioConfigUseCopy.smsOnlyDescription,
    TwilioConfigUseCopy.callsOnlyTitle,
    TwilioConfigUseCopy.callsOnlyDescription,
    TwilioConfigUseCopy.callsOnlyPrimaryPhoneNumberDescription,
    TwilioConfigUseCopy.smsOnlyPhoneNumbersDescription,
    TwilioConfigDefaultCopy.smsOnlyDefaultSwitchDescription,
    TwilioConfigDefaultCopy.smsOnlyFirstConfigSwitchDescription,
    TwilioConfigDefaultCopy.callsOnlyDefaultSwitchDescription,
    TwilioConfigDefaultCopy.callsOnlyFirstConfigSwitchDescription,
    "Used For",
  ];

  test("are Dashboard keys", () => {
    const english: Record<string, string> = readLocale("en");

    for (const key of KEYS) {
      expect({ key, inEnglish: english[key] }).toEqual({ key, inEnglish: key });
    }
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

    // The answers' words name no product but OneUptime's own account.
    expect(words[TwilioConfigUseCopy.smsOnlyDescription]).toContain(
      "OneUptime",
    );
  });
});

/*
 * The table waits folded under Notification Settings' More settings, whose
 * header says how many configs it lists: the table tells the page after
 * each load (NotificationSettingsOwnSenders holds the page).
 */
describe("what the table tells its page", () => {
  test.each([0, 1, 4])(
    "it says how many configs it lists: %i",
    async (listedCount: number) => {
      const counts: Array<number> = [];

      configCount = listedCount;

      render(
        <MemoryRouter>
          <CustomCallSMSTable
            onCountChange={(count: number) => {
              counts.push(count);
            }}
          />
        </MemoryRouter>,
      );

      await settle();

      expect(counts.length).toBeGreaterThan(0);
      expect(counts[counts.length - 1]).toBe(listedCount);
    },
  );
});
