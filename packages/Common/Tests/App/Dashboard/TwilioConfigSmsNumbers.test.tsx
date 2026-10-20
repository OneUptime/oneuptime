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
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import {
  getByTextOutsideFoldedHeaders,
  hasSetChip,
  listedNames,
} from "../../UI/Components/FoldedSection/FoldedSectionQueries";

/*
 * A PROJECT'S TWILIO CONFIG CAN SEND SMS FROM NUMBERS OF THEIR OWN, on the
 * Twilio Config card of Project Settings > Notifications > Notification
 * Settings: the real component, through the real ModelFormModal, ModelForm
 * and BasicForm. Only the network and the table around the dialog are
 * stand-ins.
 *
 * A Twilio number can make calls and send SMS, or only one of the two, and
 * in Singapore calls need a national number and SMS a mobile one. So:
 *
 *   - the Twilio step asks for what most configs need - the account, its
 *     token, the primary number and the default switch - and folds the
 *     numbers few need under More fields: the SMS phone number, the
 *     secondary numbers and the SMS secondary numbers;
 *   - the primary number says that SMS go out from it too unless an SMS
 *     number is set, and the SMS number says when to set one;
 *   - a Singapore config - a national primary number and a mobile SMS
 *     number - is saved with both;
 *   - a list of numbers holding something that is not one is refused under
 *     its field, by the server's rule, and nothing is saved;
 *   - the table shows a config's primary number as before, and beside it
 *     its SMS number, each saying what it sends, when SMS have their own.
 */

jest.setTimeout(60000);

const CONFIG_ID: string = "1e000000-0000-4000-8000-000000000001";

const SG_NATIONAL: string = "+6561234567";
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
        return "isProjectDefault" in data.query ? 1 : configCount;
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
import TwilioConfigNumbersCopy, {
  getTwilioConfigNumberLines,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CallSMS/TwilioConfigNumbersCopy";
import TwilioConfigPhoneNumbers from "../../../../App/FeatureSet/Dashboard/src/Components/CallSMS/TwilioConfigPhoneNumbers";
import ProjectCallSMSConfig from "../../../Models/DatabaseModels/ProjectCallSMSConfig";
import Phone from "../../../Types/Phone";
import Column from "../../../UI/Components/ModelTable/Column";
import Filter from "../../../UI/Components/ModelFilter/Filter";

const SMS_NUMBER: string = "Twilio SMS Phone Number";
const SECONDARY_NUMBERS: string = "Twilio Secondary Phone Numbers";
const SMS_SECONDARY_NUMBERS: string = "Twilio SMS Secondary Phone Numbers";

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

/*
 * An optional field is labelled "<Title> (Optional)": found by its title,
 * which no other field's label holds.
 */
async function type(label: string, value: string): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.change(
      within(dialog()).getByLabelText(label, { exact: false }),
      {
        target: { value },
      },
    );
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

async function walkToTwilioStep(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.change(
      within(dialog()).getByPlaceholderText("Company Twilio Account"),
      { target: { value: "Singapore" } },
    );
  });
  await clickFooter();

  await waitFor(() => {
    expect(
      within(dialog()).getByRole("switch", { name: "Set as Project Default" }),
    ).toBeVisible();
  });
}

async function fillAccount(primary: string): Promise<void> {
  await type("Twilio Account SID", "AC00000000000000000000000000000001");
  await type("Twilio Auth Token", "00000000000000000000000000000001");
  await type("Twilio Primary Phone Number", primary);
}

function moreFieldsHeader(): HTMLElement {
  return within(dialog()).getByRole("button", { name: /More fields/ });
}

async function openMoreFields(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(moreFieldsHeader());
  });
  await settle();
}

function label(text: string): HTMLElement {
  return getByTextOutsideFoldedHeaders(dialog(), text);
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

describe("the Twilio step of a Twilio config's form", () => {
  test("asks for the account, its token, the primary number and the default switch, and folds the rest", async () => {
    await renderCard();
    await openForm("create");
    await walkToTwilioStep();

    expect(label("Twilio Account SID")).toBeVisible();
    expect(label("Twilio Auth Token")).toBeVisible();
    expect(label("Twilio Primary Phone Number")).toBeVisible();

    const header: HTMLElement = moreFieldsHeader();

    expect(header).toHaveAttribute("aria-expanded", "false");
    // Folded, the line names what is under it: the SMS number first.
    expect(listedNames(header)).toEqual([
      SMS_NUMBER,
      SECONDARY_NUMBERS,
      SMS_SECONDARY_NUMBERS,
    ]);
    expect(hasSetChip(header)).toBe(false);

    for (const folded of [SMS_NUMBER, SECONDARY_NUMBERS, SMS_SECONDARY_NUMBERS]) {
      expect(label(folded)).not.toBeVisible();
    }
  });

  test("the primary number says SMS go out from it too unless an SMS number is set", async () => {
    await renderCard();
    await openForm("create");
    await walkToTwilioStep();

    expect(
      within(dialog()).getByText(
        TwilioConfigNumbersCopy.primaryPhoneNumberDescription,
      ),
    ).toBeVisible();
  });

  test("More fields opens on the three numbers, each optional, each saying what it is for", async () => {
    await renderCard();
    await openForm("create");
    await walkToTwilioStep();
    await openMoreFields();

    expect(moreFieldsHeader()).toHaveAttribute("aria-expanded", "true");

    for (const folded of [SMS_NUMBER, SECONDARY_NUMBERS, SMS_SECONDARY_NUMBERS]) {
      expect(label(folded)).toBeVisible();
      expect(label(folded)).toHaveTextContent("(Optional)");
    }

    for (const help of [
      TwilioConfigNumbersCopy.smsPhoneNumberDescription,
      TwilioConfigNumbersCopy.secondaryPhoneNumbersDescription,
      TwilioConfigNumbersCopy.smsSecondaryPhoneNumbersDescription,
    ]) {
      expect(within(dialog()).getByText(help)).toBeVisible();
    }

    // The SMS number's help names the case it is for.
    expect(TwilioConfigNumbersCopy.smsPhoneNumberDescription).toContain(
      "Singapore",
    );
  });

  test("a Singapore config is saved with its national number for calls and its mobile number for SMS", async () => {
    await renderCard();
    await openForm("create");
    await walkToTwilioStep();
    await fillAccount(SG_NATIONAL);
    await openMoreFields();
    await type(SMS_NUMBER, SG_MOBILE);
    await clickFooter();

    await waitFor(() => {
      expect(capturedModels).toHaveLength(1);
    });

    const model: Record<string, unknown> = capturedModels[0]!;

    expect(textOf(model["twilioPrimaryPhoneNumber"])).toBe(SG_NATIONAL);
    expect(textOf(model["twilioSmsPhoneNumber"])).toBe(SG_MOBILE);
    expect(textOf(model["twilioSmsSecondaryPhoneNumbers"])).toBe("");
  });

  test("a config saved without SMS numbers sends none, as every config did", async () => {
    await renderCard();
    await openForm("create");
    await walkToTwilioStep();
    await fillAccount(SG_MOBILE);
    await clickFooter();

    await waitFor(() => {
      expect(capturedModels).toHaveLength(1);
    });

    expect(textOf(capturedModels[0]!["twilioSmsPhoneNumber"])).toBe("");
    expect(textOf(capturedModels[0]!["twilioSmsSecondaryPhoneNumbers"])).toBe(
      "",
    );
  });

  test.each([
    [SMS_SECONDARY_NUMBERS, "twilioSmsSecondaryPhoneNumbers"],
    [SECONDARY_NUMBERS, "twilioSecondaryPhoneNumbers"],
  ])(
    "a list in %s that holds something that is not a number is refused under it, naming it, and nothing is saved",
    async (field: string) => {
      await renderCard();
      await openForm("create");
      await walkToTwilioStep();
      await fillAccount(SG_NATIONAL);
      await openMoreFields();
      await type(field, `${UK}, +44 7700 900124`);
      await clickFooter();

      await waitFor(() => {
        expect(
          within(dialog()).getByText(
            '"+44 7700 900124" is not a phone number. Write each number with its country code and separate them with commas, like +6581234567, +447700900123.',
          ),
        ).toBeVisible();
      });
      expect(capturedModels).toHaveLength(0);
    },
  );

  test("a good list is saved as it was typed", async () => {
    await renderCard();
    await openForm("create");
    await walkToTwilioStep();
    await fillAccount(SG_NATIONAL);
    await openMoreFields();
    await type(SMS_NUMBER, SG_MOBILE);
    await type(SMS_SECONDARY_NUMBERS, `${UK}, ${SG_MOBILE}`);
    await clickFooter();

    await waitFor(() => {
      expect(capturedModels).toHaveLength(1);
    });

    expect(capturedModels[0]!["twilioSmsSecondaryPhoneNumbers"]).toBe(
      `${UK}, ${SG_MOBILE}`,
    );
  });

  test("editing a config with an SMS number shows it as set on the folded line", async () => {
    stored = {
      name: "Singapore",
      twilioAccountSID: "AC00000000000000000000000000000001",
      twilioAuthToken: "00000000000000000000000000000001",
      twilioPrimaryPhoneNumber: SG_NATIONAL,
      twilioSmsPhoneNumber: SG_MOBILE,
      isProjectDefault: true,
    };

    await renderCard();
    await openForm("edit");

    await act(async (): Promise<void> => {
      fireEvent.click(within(dialog()).getByText("Twilio Config"));
    });
    await settle();

    const header: HTMLElement = moreFieldsHeader();

    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(hasSetChip(header)).toBe(true);
    expect(header).toHaveTextContent(SMS_NUMBER);
  });
});

describe("the Twilio Config table", () => {
  test("reads each config's SMS number, and can filter by it", async () => {
    await renderCard();

    expect(lastTableProps()["selectMoreFields"]).toEqual({
      twilioSmsPhoneNumber: true,
    });

    const filters: Array<Filter<ProjectCallSMSConfig>> = lastTableProps()[
      "filters"
    ] as Array<Filter<ProjectCallSMSConfig>>;

    expect(
      filters.some((filter: Filter<ProjectCallSMSConfig>): boolean => {
        return (
          filter.title === SMS_NUMBER &&
          Object.keys(filter.field || {})[0] === "twilioSmsPhoneNumber"
        );
      }),
    ).toBe(true);
  });

  test("its Phone Numbers column draws a config's numbers with what each sends", async () => {
    await renderCard();

    const columns: Array<Column<ProjectCallSMSConfig>> = lastTableProps()[
      "columns"
    ] as Array<Column<ProjectCallSMSConfig>>;
    const numbersColumn: Column<ProjectCallSMSConfig> | undefined =
      columns.find((column: Column<ProjectCallSMSConfig>): boolean => {
        return column.title === "Phone Numbers";
      });

    expect(numbersColumn).toBeDefined();
    expect(Object.keys(numbersColumn!.field)).toEqual([
      "twilioPrimaryPhoneNumber",
    ]);

    const singapore: ProjectCallSMSConfig = new ProjectCallSMSConfig();
    singapore.twilioPrimaryPhoneNumber = new Phone(SG_NATIONAL);
    singapore.twilioSmsPhoneNumber = new Phone(SG_MOBILE);

    render(numbersColumn!.getElement!(singapore));

    const cell: HTMLElement = screen.getByTestId("twilio-config-phone-numbers");

    expect(cell).toHaveTextContent(SG_NATIONAL);
    expect(cell).toHaveTextContent(SG_MOBILE);
    expect(within(cell).getByText("Phone Calls")).toBeVisible();
    expect(within(cell).getByText("SMS")).toBeVisible();
  });
});

describe("a config's numbers in its row", () => {
  test("a config without an SMS number shows its primary number alone, as before", () => {
    render(
      <TwilioConfigPhoneNumbers
        config={{ twilioPrimaryPhoneNumber: new Phone(SG_MOBILE) }}
      />,
    );

    const cell: HTMLElement = screen.getByTestId("twilio-config-phone-numbers");

    expect(cell).toHaveTextContent(SG_MOBILE);
    expect(within(cell).queryByText("Phone Calls")).toBeNull();
    expect(within(cell).queryByText("SMS")).toBeNull();
  });

  test("one with an SMS number shows each, calls first, each saying what it sends", () => {
    expect(
      getTwilioConfigNumberLines({
        twilioPrimaryPhoneNumber: SG_NATIONAL,
        twilioSmsPhoneNumber: new Phone(SG_MOBILE),
      }),
    ).toEqual([
      { phoneNumber: SG_NATIONAL, label: "Phone Calls" },
      { phoneNumber: SG_MOBILE, label: "SMS" },
    ]);
  });

  test("one with no number yet shows a dash", () => {
    render(<TwilioConfigPhoneNumbers config={{}} />);

    expect(screen.getByText("-")).toBeVisible();
    expect(getTwilioConfigNumberLines({})).toEqual([]);
  });

  test("an SMS number alone, without a primary number, is still shown, as the SMS one", () => {
    expect(
      getTwilioConfigNumberLines({ twilioSmsPhoneNumber: SG_MOBILE }),
    ).toEqual([{ phoneNumber: SG_MOBILE, label: "SMS" }]);
  });

  test.each(["de", "ja", "fa"])(
    "says what each number sends in the reader's language (%s)",
    async (language: string) => {
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
          <TwilioConfigPhoneNumbers
            config={{
              twilioPrimaryPhoneNumber: SG_NATIONAL,
              twilioSmsPhoneNumber: SG_MOBILE,
            }}
          />
        </I18nextProvider>,
      );

      const words: Record<string, string> = readLocale(language);
      const cell: HTMLElement = screen.getByTestId(
        "twilio-config-phone-numbers",
      );

      expect(words["Phone Calls"]).toBeDefined();
      expect(words["Phone Calls"]).not.toBe("Phone Calls");
      expect(within(cell).getByText(words["Phone Calls"]!)).toBeVisible();
      expect(within(cell).getByText(words["SMS"]!)).toBeVisible();
    },
  );
});

describe("the strings the form adds", () => {
  test("are Dashboard keys, translated in every language", () => {
    const english: Record<string, string> = readLocale("en");

    for (const key of [
      SMS_NUMBER,
      SMS_SECONDARY_NUMBERS,
      TwilioConfigNumbersCopy.primaryPhoneNumberDescription,
      TwilioConfigNumbersCopy.smsPhoneNumberDescription,
      TwilioConfigNumbersCopy.secondaryPhoneNumbersDescription,
      TwilioConfigNumbersCopy.smsSecondaryPhoneNumbersDescription,
      TwilioConfigNumbersCopy.callsLabel,
      TwilioConfigNumbersCopy.smsLabel,
      "Phone Numbers",
    ]) {
      expect({ key, inEnglish: english[key] }).toEqual({
        key,
        inEnglish: key,
      });
    }

    for (const language of [
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
    ]) {
      const words: Record<string, string> = readLocale(language);

      for (const key of [
        SMS_NUMBER,
        SMS_SECONDARY_NUMBERS,
        TwilioConfigNumbersCopy.primaryPhoneNumberDescription,
        TwilioConfigNumbersCopy.smsPhoneNumberDescription,
        TwilioConfigNumbersCopy.smsSecondaryPhoneNumbersDescription,
      ]) {
        expect({
          language,
          key,
          translated: Boolean(words[key]) && words[key] !== key,
        }).toEqual({ language, key, translated: true });
      }

      // The SMS help keeps its example in every language.
      expect(
        words[TwilioConfigNumbersCopy.smsPhoneNumberDescription],
      ).toBeDefined();
    }
  });

  test("calls a number for calls Phone Calls, which the locales word as a telephone call, not a call of code", () => {
    expect(TwilioConfigNumbersCopy.callsLabel).toBe("Phone Calls");
    expect(readLocale("de")["Phone Calls"]).toBe("Telefonanrufe");
    expect(readLocale("zh-CN")["Phone Calls"]).not.toBe(
      readLocale("zh-CN")["Calls"],
    );
  });
});
