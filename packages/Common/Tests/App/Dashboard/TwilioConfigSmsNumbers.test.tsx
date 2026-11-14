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
import ActionButtonSchema from "../../../UI/Components/ActionButton/ActionButtonSchema";
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
 * Singapore's national numbers are voice-only - SMS there need a mobile
 * number. So:
 *
 *   - the Twilio step asks for what most configs need - the account, its
 *     token, the primary number and the default switch - and folds the
 *     numbers few need under More fields: the SMS phone numbers and the
 *     secondary numbers;
 *   - the primary number says that SMS go out from it too unless SMS
 *     numbers are added, and the SMS numbers say when to add them and what
 *     they change - naming no country, as OneUptime is used worldwide - and
 *     show, while empty, an example list that is no one country's numbers;
 *   - a Singapore config - a national primary number and a mobile SMS
 *     number - is saved with both;
 *   - a list of numbers holding something that is not one is refused under
 *     its field, by the server's rule, and nothing is saved;
 *   - the table shows a config's primary number as before, and beside it
 *     its first SMS number, each saying what it sends, when SMS have their
 *     own - and how many more of each kind there are ("+2 more"), listed
 *     on hover; its columns put the numbers and the default before the
 *     34-character account SID, which is cut short to fit a laptop screen;
 *   - Send Test SMS and Send Test Call say what they are for, and the
 *     dialog after a test names the number it went out from.
 */

jest.setTimeout(60000);

const CONFIG_ID: string = "1e000000-0000-4000-8000-000000000001";

const SG_NATIONAL: string = "+6561234567";
const SG_MOBILE: string = "+6581234567";
const UK: string = "+447700900123";
const US_NUMBER: string = "+14155550100";

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

      // The one row the stub draws the actions of: the stored config.
      const rowItem: TBaseModel = new props.modelType();
      Object.assign(rowItem, { _id: CONFIG_ID, ...stored });

      return (
        <div>
          {(props.actionButtons || []).map(
            (
              action: ActionButtonSchema<TBaseModel>,
              index: number,
            ): ReactElement => {
              return (
                <button
                  key={index}
                  type="button"
                  onClick={() => {
                    action.onClick(
                      rowItem,
                      () => {},
                      () => {},
                    );
                  }}
                >
                  {`Row action: ${action.title}`}
                </button>
              );
            },
          )}
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
      getItem: async (data: {
        modelType: { new (): Record<string, unknown> };
      }): Promise<unknown> => {
        const item: Record<string, unknown> = new data.modelType();
        Object.assign(item, { _id: CONFIG_ID, ...stored });
        return item;
      },
      /*
       * The project's configs, as the card reads them: configCount configs
       * for calls and SMS, the first the project default for both.
       */
      getList: async (): Promise<{
        data: Array<unknown>;
        count: number;
        skip: number;
        limit: number;
      }> => {
        const data: Array<JSONObject> = Array.from(
          { length: configCount },
          (_unused: unknown, index: number): JSONObject => {
            return {
              usedFor: "Calls and SMS",
              isProjectDefault: index === 0,
              isProjectDefaultForSms: index === 0,
              isProjectDefaultForCalls: index === 0,
            };
          },
        );

        return { data, count: data.length, skip: 0, limit: data.length };
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

import CustomCallSMSTable, {
  TWILIO_ACCOUNT_SID_CELL_WIDTH_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CallSMS/CallSMSConfigTable";
import TwilioConfigNumbersCopy, {
  getTwilioConfigNumberLines,
  getTwilioConfigNumbersForExport,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CallSMS/TwilioConfigNumbersCopy";
import TwilioTestSendCopy, {
  getTestSendFromPhoneNumber,
  getTestSentMessage,
  TwilioTestSendKind,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CallSMS/TwilioTestSendCopy";
import TwilioConfigDefaultCopy from "../../../../App/FeatureSet/Dashboard/src/Components/CallSMS/TwilioConfigDefaultCopy";
import API from "../../../UI/Utils/API/API";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import {
  PHONE_NUMBER_LIST_EXAMPLE,
  TEST_SEND_FROM_PHONE_NUMBER_FIELD,
} from "../../../Types/CallAndSMS/TwilioPhoneNumbers";
import TwilioConfigPhoneNumbers, {
  TWILIO_CONFIG_NUMBER_LINE_CLASS_NAME,
  TWILIO_CONFIG_NUMBER_LINE_WITH_ICON_CLASS_NAME,
  TWILIO_CONFIG_NUMBER_WITH_ICON_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CallSMS/TwilioConfigPhoneNumbers";
import ProjectCallSMSConfig from "../../../Models/DatabaseModels/ProjectCallSMSConfig";
import Phone from "../../../Types/Phone";
import Column from "../../../UI/Components/ModelTable/Column";
import Filter from "../../../UI/Components/ModelFilter/Filter";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

const SMS_NUMBERS: string = "Twilio SMS Phone Numbers";
const SECONDARY_NUMBERS: string = "Twilio Secondary Phone Numbers";

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
    // Folded, the line names what is under it: the SMS numbers first.
    expect(listedNames(header)).toEqual([SMS_NUMBERS, SECONDARY_NUMBERS]);
    expect(hasSetChip(header)).toBe(false);

    for (const folded of [SMS_NUMBERS, SECONDARY_NUMBERS]) {
      expect(label(folded)).not.toBeVisible();
    }
  });

  test("the primary number says SMS go out from it too unless SMS numbers are added", async () => {
    await renderCard();
    await openForm("create");
    await walkToTwilioStep();

    expect(
      within(dialog()).getByText(
        TwilioConfigNumbersCopy.primaryPhoneNumberDescription,
      ),
    ).toBeVisible();
  });

  test("More fields opens on the two lists of numbers, each optional, each saying what it is for", async () => {
    await renderCard();
    await openForm("create");
    await walkToTwilioStep();
    await openMoreFields();

    expect(moreFieldsHeader()).toHaveAttribute("aria-expanded", "true");

    for (const folded of [SMS_NUMBERS, SECONDARY_NUMBERS]) {
      expect(label(folded)).toBeVisible();
      expect(label(folded)).toHaveTextContent("(Optional)");
    }

    for (const help of [
      TwilioConfigNumbersCopy.smsPhoneNumbersDescription,
      TwilioConfigNumbersCopy.secondaryPhoneNumbersDescription,
    ]) {
      expect(within(dialog()).getByText(help)).toBeVisible();
    }

    /*
     * The SMS numbers' help names the case they are for, and what they
     * change - naming no country: OneUptime is used worldwide.
     */
    expect(TwilioConfigNumbersCopy.smsPhoneNumbersDescription).toBe(
      "Numbers to send SMS from if yours can only make calls. Each SMS uses the one in the recipient's country, or the first.",
    );
  });

  test("an empty list of SMS numbers shows the server's example list, no one country's numbers", async () => {
    await renderCard();
    await openForm("create");
    await walkToTwilioStep();
    await openMoreFields();

    const field: HTMLElement = within(dialog()).getByLabelText(SMS_NUMBERS, {
      exact: false,
    });

    expect(field).toHaveAttribute("placeholder", PHONE_NUMBER_LIST_EXAMPLE);
    expect(field.getAttribute("placeholder")).toBe(
      "+14155550123, +447700900123",
    );
    // The primary number keeps its own example.
    expect(
      within(dialog()).getByLabelText("Twilio Primary Phone Number", {
        exact: false,
      }),
    ).toHaveAttribute("placeholder", "+14155550100");
  });

  test("a Singapore config is saved with its national number for calls and its mobile number for SMS", async () => {
    await renderCard();
    await openForm("create");
    await walkToTwilioStep();
    await fillAccount(SG_NATIONAL);
    await openMoreFields();
    await type(SMS_NUMBERS, SG_MOBILE);
    await clickFooter();

    await waitFor(() => {
      expect(capturedModels).toHaveLength(1);
    });

    const model: Record<string, unknown> = capturedModels[0]!;

    expect(textOf(model["twilioPrimaryPhoneNumber"])).toBe(SG_NATIONAL);
    expect(textOf(model["twilioSmsPhoneNumbers"])).toBe(SG_MOBILE);
    expect(textOf(model["twilioSecondaryPhoneNumbers"])).toBe("");
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

    expect(textOf(capturedModels[0]!["twilioSmsPhoneNumbers"])).toBe("");
  });

  test.each([
    [SMS_NUMBERS, "twilioSmsPhoneNumbers"],
    [SECONDARY_NUMBERS, "twilioSecondaryPhoneNumbers"],
  ])(
    "a list in %s that holds something that is not a number is refused under it, naming it, and nothing is saved",
    async (field: string) => {
      await renderCard();
      await openForm("create");
      await walkToTwilioStep();
      await fillAccount(SG_NATIONAL);
      await openMoreFields();
      // Cut short: since 9f3019bf4b a number grouped with spaces is one.
      await type(field, `${UK}, +44 7700`);
      await clickFooter();

      await waitFor(() => {
        expect(
          within(dialog()).getByText(
            '"+44 7700" is not a phone number. Write each number with its country code and separate them with commas, like +14155550123, +447700900123.',
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
    await type(SMS_NUMBERS, `${SG_MOBILE}, ${UK}`);
    await clickFooter();

    await waitFor(() => {
      expect(capturedModels).toHaveLength(1);
    });

    expect(capturedModels[0]!["twilioSmsPhoneNumbers"]).toBe(
      `${SG_MOBILE}, ${UK}`,
    );
  });

  test("editing a config with SMS numbers shows them as set on the folded line", async () => {
    stored = {
      name: "Singapore",
      twilioAccountSID: "AC00000000000000000000000000000001",
      twilioAuthToken: "00000000000000000000000000000001",
      twilioPrimaryPhoneNumber: SG_NATIONAL,
      twilioSmsPhoneNumbers: SG_MOBILE,
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
    expect(header).toHaveTextContent(SMS_NUMBERS);
  });
});

describe("the Twilio Config table", () => {
  test("reads each config's SMS numbers, and can filter by them", async () => {
    await renderCard();

    /*
     * The SMS numbers, and the secondary ones the cell counts - and what
     * the config is used for, which says which of them it sends from, and
     * what it is the project default for, which its Project Default cell
     * and its ⋯ menu say.
     */
    expect(lastTableProps()["selectMoreFields"]).toEqual({
      usedFor: true,
      twilioSmsPhoneNumbers: true,
      twilioSecondaryPhoneNumbers: true,
      isProjectDefaultForSms: true,
      isProjectDefaultForCalls: true,
    });

    const filters: Array<Filter<ProjectCallSMSConfig>> = lastTableProps()[
      "filters"
    ] as Array<Filter<ProjectCallSMSConfig>>;

    expect(
      filters.some((filter: Filter<ProjectCallSMSConfig>): boolean => {
        return (
          filter.title === SMS_NUMBERS &&
          Object.keys(filter.field || {})[0] === "twilioSmsPhoneNumbers"
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
    singapore.twilioSmsPhoneNumbers = `${SG_MOBILE}, ${UK}`;

    render(numbersColumn!.getElement!(singapore));

    const cell: HTMLElement = screen.getByTestId("twilio-config-phone-numbers");

    expect(cell).toHaveTextContent(SG_NATIONAL);
    expect(cell).toHaveTextContent(SG_MOBILE);
    // The rest of the list is in the config's Edit dialog.
    expect(cell).not.toHaveTextContent(UK);
    // Each number is marked with what it sends: an icon, named.
    expect(
      within(cell).getByRole("img", { name: "Phone Calls" }),
    ).toBeVisible();
    expect(within(cell).getByRole("img", { name: "SMS" })).toBeVisible();
  });
});

describe("a config's numbers in its row", () => {
  test("a config without SMS numbers shows its primary number alone, as before", () => {
    render(
      <TwilioConfigPhoneNumbers
        config={{ twilioPrimaryPhoneNumber: new Phone(SG_MOBILE) }}
      />,
    );

    const cell: HTMLElement = screen.getByTestId("twilio-config-phone-numbers");

    expect(cell).toHaveTextContent(SG_MOBILE);
    expect(cell.textContent).toBe(SG_MOBILE);
    expect(within(cell).queryByRole("img")).toBeNull();
    expect(within(cell).queryByTitle("Phone Calls")).toBeNull();
  });

  /*
   * Icons rather than words keep the column as narrow as one number, so
   * the table's Project Default column stays in view beside it - the
   * handset and the message icon the row's Send Test Call and Send Test
   * SMS use, each named for screen readers and on hover.
   */
  test("marks the call number with the handset and the SMS number with the message icon, named on hover", () => {
    render(
      <TwilioConfigPhoneNumbers
        config={{
          twilioPrimaryPhoneNumber: new Phone(SG_NATIONAL),
          twilioSmsPhoneNumbers: `${SG_MOBILE}, ${UK}`,
        }}
      />,
    );

    const cell: HTMLElement = screen.getByTestId("twilio-config-phone-numbers");
    const calls: HTMLElement = within(cell).getByTitle("Phone Calls");
    const sms: HTMLElement = within(cell).getByTitle("SMS");

    expect(calls).toHaveTextContent(SG_NATIONAL);
    expect(sms).toHaveTextContent(SG_MOBILE);
    // Calls first, then SMS.
    expect(
      calls.compareDocumentPosition(sms) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      within(calls).getByRole("img", { name: "Phone Calls" }),
    ).toBeVisible();
    expect(within(sms).getByRole("img", { name: "SMS" })).toBeVisible();
    /*
     * No words beside the numbers but the count of the SMS numbers after
     * the first: the names are the icons'.
     */
    expect(cell.textContent).toBe(`${SG_NATIONAL}${SG_MOBILE}+1 more`);
    expect(within(sms).getByText("+1 more")).toHaveAttribute("title", UK);
  });

  /*
   * In German the Twilio Config table ran 51px past its card at 1280px
   * beside the side menu. A number is never cut short - "+14155..." says
   * nothing about which number it is - so where the column is narrow, the
   * "+1 more" goes onto a line of its own under the number instead, and
   * the column needs no more than one number's width.
   */
  test("a number is never cut short: its icon and it stay together, whole, and its count wraps under it where the column is narrow", () => {
    render(
      <TwilioConfigPhoneNumbers
        config={{
          twilioPrimaryPhoneNumber: new Phone(SG_NATIONAL),
          twilioSmsPhoneNumbers: `${SG_MOBILE}, ${UK}`,
        }}
      />,
    );

    const cell: HTMLElement = screen.getByTestId("twilio-config-phone-numbers");

    // Not one of the table's values cut short to make it fit.
    expect(cell).not.toHaveAttribute("data-table-shrinks");

    const sms: HTMLElement = within(cell).getByTitle("SMS");
    const number: HTMLElement = within(sms).getByText(SG_MOBILE);

    expect(number).toHaveClass("whitespace-nowrap");
    expect(number).not.toHaveClass("truncate");
    expect(number).not.toHaveClass("min-w-0");

    // The line wraps between the number and its count, never inside them.
    expect(sms.className).toBe(TWILIO_CONFIG_NUMBER_LINE_WITH_ICON_CLASS_NAME);
    expect(TWILIO_CONFIG_NUMBER_LINE_CLASS_NAME.split(" ")).toEqual([
      "flex",
      "flex-wrap",
      "items-center",
      "gap-x-1.5",
    ]);
    expect(within(sms).getByText("+1 more")).toHaveClass("whitespace-nowrap");

    /*
     * The icon and the number are one piece that does not wrap, hung to
     * the left of the line by the icon's 16px and its 6px gap, so a count
     * on a line of its own starts under the number.
     */
    const iconAndNumber: HTMLElement = number.parentElement as HTMLElement;
    expect(iconAndNumber.className).toBe(
      TWILIO_CONFIG_NUMBER_WITH_ICON_CLASS_NAME,
    );
    expect(
      within(iconAndNumber).getByRole("img", { name: "SMS" }),
    ).toBeInTheDocument();
    expect(TWILIO_CONFIG_NUMBER_WITH_ICON_CLASS_NAME).toContain(
      "whitespace-nowrap",
    );
    expect(TWILIO_CONFIG_NUMBER_WITH_ICON_CLASS_NAME).toContain("-ml-[22px]");
    expect(TWILIO_CONFIG_NUMBER_LINE_WITH_ICON_CLASS_NAME).toContain(
      "pl-[22px]",
    );
    // 22px: the icon's 16 and the gap's 6 (gap-1.5).
    expect(TWILIO_CONFIG_NUMBER_WITH_ICON_CLASS_NAME).toContain("gap-1.5");
    expect(
      within(sms).getByRole("img", { name: "SMS" }).querySelector("svg"),
    ).toHaveClass("h-4", "w-4", "flex-none");
  });

  test("a line with no icon - every number sends both - wraps the same, with nothing hung", () => {
    render(
      <TwilioConfigPhoneNumbers
        config={{
          twilioPrimaryPhoneNumber: new Phone(SG_NATIONAL),
        }}
      />,
    );

    const cell: HTMLElement = screen.getByTestId("twilio-config-phone-numbers");
    const line: HTMLElement = cell.firstElementChild as HTMLElement;

    expect(line.className).toBe(TWILIO_CONFIG_NUMBER_LINE_CLASS_NAME);
    expect(within(line).queryByRole("img")).toBeNull();
  });

  test("one with SMS numbers shows its primary and its first SMS number, calls first, each saying what it sends", () => {
    expect(
      getTwilioConfigNumberLines({
        twilioPrimaryPhoneNumber: new Phone(SG_NATIONAL),
        twilioSmsPhoneNumbers: ` ${SG_MOBILE} ;${UK}`,
      }),
    ).toEqual([
      { phoneNumber: SG_NATIONAL, label: "Phone Calls", otherPhoneNumbers: [] },
      { phoneNumber: SG_MOBILE, label: "SMS", otherPhoneNumbers: [UK] },
    ]);
  });

  test("an emptied list of SMS numbers is none: the primary number alone", () => {
    for (const emptied of ["", " , ", null, undefined]) {
      expect(
        getTwilioConfigNumberLines({
          twilioPrimaryPhoneNumber: SG_NATIONAL,
          twilioSmsPhoneNumbers: emptied,
        }),
      ).toEqual([
        { phoneNumber: SG_NATIONAL, label: null, otherPhoneNumbers: [] },
      ]);
    }
  });

  test("one with no number yet shows a dash", () => {
    render(<TwilioConfigPhoneNumbers config={{}} />);

    expect(screen.getByText("-")).toBeVisible();
    expect(getTwilioConfigNumberLines({})).toEqual([]);
  });

  test("an SMS number alone, without a primary number, is still shown, as the SMS one", () => {
    expect(
      getTwilioConfigNumberLines({ twilioSmsPhoneNumbers: SG_MOBILE }),
    ).toEqual([
      { phoneNumber: SG_MOBILE, label: "SMS", otherPhoneNumbers: [] },
    ]);
  });

  /*
   * The rest of each kind's numbers are in the config's Edit dialog: the
   * row counts them after the number it shows, and lists them on hover.
   */
  test("counts a config's secondary numbers after its primary one, whatever the SMS numbers", () => {
    expect(
      getTwilioConfigNumberLines({
        twilioPrimaryPhoneNumber: new Phone(SG_NATIONAL),
        twilioSecondaryPhoneNumbers: `${UK}; +4915112345678`,
      }),
    ).toEqual([
      {
        phoneNumber: SG_NATIONAL,
        label: null,
        otherPhoneNumbers: [UK, "+4915112345678"],
      },
    ]);
    expect(
      getTwilioConfigNumberLines({
        twilioPrimaryPhoneNumber: new Phone(SG_NATIONAL),
        twilioSecondaryPhoneNumbers: UK,
        twilioSmsPhoneNumbers: `${SG_MOBILE}, +6590001111, +447700900124`,
      }),
    ).toEqual([
      {
        phoneNumber: SG_NATIONAL,
        label: "Phone Calls",
        otherPhoneNumbers: [UK],
      },
      {
        phoneNumber: SG_MOBILE,
        label: "SMS",
        otherPhoneNumbers: ["+6590001111", "+447700900124"],
      },
    ]);
  });

  test("says how many more numbers each line has, and lists them on hover", () => {
    render(
      <TwilioConfigPhoneNumbers
        config={{
          twilioPrimaryPhoneNumber: new Phone(SG_NATIONAL),
          twilioSecondaryPhoneNumbers: UK,
          twilioSmsPhoneNumbers: `${SG_MOBILE}, +6590001111, +447700900124`,
        }}
      />,
    );

    const cell: HTMLElement = screen.getByTestId("twilio-config-phone-numbers");
    const counts: Array<HTMLElement> = within(cell).getAllByTestId(
      "twilio-config-more-phone-numbers",
    );

    expect(
      counts.map((count: HTMLElement): string => {
        return count.textContent || "";
      }),
    ).toEqual(["+1 more", "+2 more"]);
    expect(counts[0]).toHaveAttribute("title", UK);
    expect(counts[1]).toHaveAttribute("title", "+6590001111, +447700900124");
    // Each count is on the line of its kind.
    expect(within(cell).getByTitle("Phone Calls")).toContainElement(counts[0]!);
    expect(within(cell).getByTitle("SMS")).toContainElement(counts[1]!);
  });

  test("a config with one number of each kind shows no count", () => {
    render(
      <TwilioConfigPhoneNumbers
        config={{
          twilioPrimaryPhoneNumber: new Phone(SG_NATIONAL),
          twilioSmsPhoneNumbers: SG_MOBILE,
        }}
      />,
    );

    expect(screen.queryByTestId("twilio-config-more-phone-numbers")).toBeNull();
  });

  test("its export lists every number the config sends from, each kind named when SMS have their own", () => {
    expect(
      getTwilioConfigNumbersForExport({
        twilioPrimaryPhoneNumber: new Phone(US_NUMBER),
        twilioSecondaryPhoneNumbers: UK,
      }),
    ).toBe(`${US_NUMBER}, ${UK}`);
    expect(
      getTwilioConfigNumbersForExport({
        twilioPrimaryPhoneNumber: new Phone(SG_NATIONAL),
        twilioSecondaryPhoneNumbers: UK,
        twilioSmsPhoneNumbers: `${SG_MOBILE}, +447700900124`,
      }),
    ).toBe(
      `Phone Calls: ${SG_NATIONAL}, ${UK}; SMS: ${SG_MOBILE}, +447700900124`,
    );
    expect(getTwilioConfigNumbersForExport({})).toBe("");
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
              twilioSmsPhoneNumbers: SG_MOBILE,
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
      expect(
        within(cell).getByRole("img", { name: words["Phone Calls"]! }),
      ).toBeVisible();
      expect(within(cell).getByTitle(words["Phone Calls"]!)).toHaveTextContent(
        SG_NATIONAL,
      );
      expect(
        within(cell).getByRole("img", { name: words["SMS"]! }),
      ).toBeVisible();
    },
  );

  test.each([
    ["de", "+2 weitere"],
    ["ja", "ほか 2 件"],
  ])(
    "counts the other numbers in the reader's language (%s)",
    async (language: string, twoMore: string) => {
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
              twilioSmsPhoneNumbers: `${SG_MOBILE}, +6590001111, ${UK}`,
            }}
          />
        </I18nextProvider>,
      );

      expect(readLocale(language)["+{{count}} more"]).toBe(
        twoMore.replace("2", "{{count}}"),
      );
      expect(
        screen.getByTestId("twilio-config-more-phone-numbers"),
      ).toHaveTextContent(twoMore);
    },
  );
});

describe("the Twilio Config table's columns", () => {
  function columns(): Array<Column<ProjectCallSMSConfig>> {
    return lastTableProps()["columns"] as Array<Column<ProjectCallSMSConfig>>;
  }

  /*
   * A SID is 34 characters, the widest value in a row. Drawn whole in the
   * second column it made the table wider than its card beside the side
   * menu at 1280px, and the Project Default column ran under the row's
   * actions. What a config is used for (calls and SMS, SMS only or calls
   * only) now has the column beside the name, and the account starts
   * hidden: last, and one switch away in Customize Columns.
   */
  test("show the name, what it is used for, the numbers and the default, with the account last and hidden", async () => {
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

  test("cut the account SID short below 1536px, and show it whole from there", async () => {
    await renderCard();

    const sid: Column<ProjectCallSMSConfig> | undefined = columns().find(
      (column: Column<ProjectCallSMSConfig>): boolean => {
        return column.title === "Twilio Account SID";
      },
    );

    expect(sid?.contentClassName).toBe(
      TWILIO_ACCOUNT_SID_CELL_WIDTH_CLASS_NAME,
    );
    expect(TWILIO_ACCOUNT_SID_CELL_WIDTH_CLASS_NAME).toBe(
      "max-w-[10rem] 2xl:max-w-[17rem]",
    );
  });

  test("export every number of a config under Phone Numbers", async () => {
    await renderCard();

    const numbersColumn: Column<ProjectCallSMSConfig> | undefined =
      columns().find((column: Column<ProjectCallSMSConfig>): boolean => {
        return column.title === "Phone Numbers";
      });

    const config: ProjectCallSMSConfig = new ProjectCallSMSConfig();
    config.twilioPrimaryPhoneNumber = new Phone(SG_NATIONAL);
    config.twilioSmsPhoneNumbers = `${SG_MOBILE}, ${UK}`;

    expect(numbersColumn?.getExportValue?.(config)).toBe(
      `Phone Calls: ${SG_NATIONAL}; SMS: ${SG_MOBILE}, ${UK}`,
    );
  });
});

describe("Send Test SMS and Send Test Call", () => {
  let postSpy: ReturnType<typeof jest.spyOn>;

  function answerWith(answer: unknown): void {
    postSpy = jest.spyOn(API, "post").mockResolvedValue(answer as never);
  }

  async function runTest(action: string, phone: string): Promise<void> {
    await renderCard();

    await act(async (): Promise<void> => {
      fireEvent.click(
        screen.getByRole("button", { name: `Row action: ${action}` }),
      );
    });
    await settle();

    await act(async (): Promise<void> => {
      fireEvent.change(within(dialog()).getByLabelText("Phone Number"), {
        target: { value: phone },
      });
    });

    await act(async (): Promise<void> => {
      fireEvent.click(
        within(dialog()).getByTestId("modal-footer-submit-button"),
      );
    });
    await settle();
  }

  test("each dialog says what the test is for, and asks only for the phone", async () => {
    await renderCard();

    for (const [action, description] of [
      ["Send Test SMS", TwilioTestSendCopy.smsDescription],
      ["Send Test Call", TwilioTestSendCopy.callDescription],
    ] as Array<[string, string]>) {
      await act(async (): Promise<void> => {
        fireEvent.click(
          screen.getByRole("button", { name: `Row action: ${action}` }),
        );
      });
      await settle();

      expect(
        within(dialog()).getByTestId("modal-description"),
      ).toHaveTextContent(description);
      // The phone, and nothing said under it: the dialog says it all.
      expect(within(dialog()).getByLabelText("Phone Number")).toBeVisible();
      expect(within(dialog()).queryByText(/test (sms|call) to\./i)).toBeNull();

      await act(async (): Promise<void> => {
        fireEvent.click(
          within(dialog()).getByRole("button", { name: "Cancel" }),
        );
      });
      await settle();
    }

    expect(TwilioTestSendCopy.smsDescription).toBe(
      "Send a test SMS to check this Twilio config.",
    );
    expect(TwilioTestSendCopy.callDescription).toBe(
      "Make a test call to check this Twilio config.",
    );
  });

  test("after a test SMS, the dialog names the number it went out from", async () => {
    stored = {
      twilioPrimaryPhoneNumber: SG_NATIONAL,
      twilioSmsPhoneNumbers: SG_MOBILE,
    };
    answerWith(
      new HTTPResponse(
        200,
        { [TEST_SEND_FROM_PHONE_NUMBER_FIELD]: SG_MOBILE },
        {},
      ),
    );

    await runTest("Send Test SMS", "+6598765432");

    const request: { url: { toString: () => string }; data: JSONObject } =
      postSpy.mock.calls[0]![0] as {
        url: { toString: () => string };
        data: JSONObject;
      };

    expect(request.url.toString()).toContain("/sms/test");
    expect(request.data["toPhone"]).toBe("+6598765432");
    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Test SMS Sent",
    );
    expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
      `Twilio accepted the test SMS from ${SG_MOBILE}. It should arrive within a few minutes.`,
    );
  });

  test("after a test call, the dialog names the number it calls from", async () => {
    answerWith(
      new HTTPResponse(
        200,
        { [TEST_SEND_FROM_PHONE_NUMBER_FIELD]: SG_NATIONAL },
        {},
      ),
    );

    await runTest("Send Test Call", "+6598765432");

    expect(
      (
        postSpy.mock.calls[0]![0] as { url: { toString: () => string } }
      ).url.toString(),
    ).toContain("/call/test");
    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Test Call Placed",
    );
    expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
      `Twilio is calling from ${SG_NATIONAL}. Your phone should ring within a minute.`,
    );
    // Never the words a test email says: a call has no spam folder.
    expect(document.body.textContent).not.toContain("spam");
  });

  test("an answer that names no number still says the test went out", async () => {
    answerWith(new HTTPResponse(200, {}, {}));

    await runTest("Send Test SMS", "+6598765432");

    expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
      TwilioTestSendCopy.smsSent,
    );
  });

  test("a refused test stays in its dialog, saying why, and no success is shown", async () => {
    answerWith(
      new HTTPErrorResponse(
        400,
        { error: "SMS not sent: SMS is off in this project." },
        {},
      ),
    );

    await runTest("Send Test SMS", "+6598765432");

    expect(
      within(dialog()).getByText("SMS not sent: SMS is off in this project."),
    ).toBeVisible();
    expect(screen.queryByTestId("confirm-modal-description")).toBeNull();
  });

  test("says what went out in the reader's language", async () => {
    const german: Record<string, string> = readLocale("de");

    expect(german[TwilioTestSendCopy.smsSentFrom]).toBe(
      "Twilio hat die Test-SMS von {{phoneNumber}} angenommen. Sie sollte innerhalb weniger Minuten ankommen.",
    );
    expect(german[TwilioTestSendCopy.callPlacedTitle]).toBe(
      "Testanruf gestartet",
    );
  });

  test("reads the number from the answer, and only a number", () => {
    expect(
      getTestSendFromPhoneNumber({
        [TEST_SEND_FROM_PHONE_NUMBER_FIELD]: ` ${SG_MOBILE} `,
      }),
    ).toBe(SG_MOBILE);
    for (const unread of [
      null,
      undefined,
      "x",
      [],
      {},
      { fromPhoneNumber: 6581234567 },
    ]) {
      expect(getTestSendFromPhoneNumber(unread)).toBe("");
    }
    expect(
      getTestSentMessage({
        kind: TwilioTestSendKind.Call,
        fromPhoneNumber: "",
      }),
    ).toEqual({ template: TwilioTestSendCopy.callPlaced, phoneNumber: "" });
    expect(
      getTestSentMessage({
        kind: TwilioTestSendKind.SMS,
        fromPhoneNumber: SG_MOBILE,
      }),
    ).toEqual({
      template: TwilioTestSendCopy.smsSentFrom,
      phoneNumber: SG_MOBILE,
    });
  });
});

/*
 * ISSUE #6605: ON A PERSIAN OR ARABIC PAGE THE TWILIO CONFIG TABLE'S
 * NUMBERS READ 447700900123+.
 *
 * A number is a run of digits after a "+", with no letter to say which way
 * it reads: on a page laid out right to left it took the page's way and
 * its "+" went to the end. Each number is now an isolate that reads left
 * to right (PhoneNumberText: bdi dir="ltr" - what a browser draws as
 * +447700900123 on an rtl page, where a plain span drew 447700900123+), the
 * icon still at the line's start beside it; the numbers "+2 more" lists on
 * hover - a native tooltip, which can only be text - are each set apart
 * in a left-to-right isolate (LRI ... PDI) and separated by the Arabic
 * comma; and the dialog after a test names its number the same way.
 */
describe("a config's numbers on a page read right to left", () => {
  const LRI: string = String.fromCharCode(0x2066);
  const PDI: string = String.fromCharCode(0x2069);
  const languages: Record<string, i18n> = {};

  async function instanceFor(language: string): Promise<i18n> {
    if (!languages[language]) {
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

      languages[language] = instance;
    }

    return languages[language]!;
  }

  async function renderNumbers(
    language: string,
    config: Record<string, unknown>,
  ): Promise<HTMLElement> {
    const instance: i18n = await instanceFor(language);

    render(
      <I18nextProvider i18n={instance}>
        <TwilioConfigPhoneNumbers config={config} />
      </I18nextProvider>,
    );

    return screen.getByTestId("twilio-config-phone-numbers");
  }

  function withoutMarks(text: string): string {
    return text.split(LRI).join("").split(PDI).join("");
  }

  beforeEach(() => {
    document.documentElement.setAttribute("dir", "rtl");
  });

  afterEach(() => {
    document.documentElement.removeAttribute("dir");
  });

  test.each(["fa", "ar"])(
    "in %s each number is an isolate that reads left to right, its + in front",
    async (language: string) => {
      const cell: HTMLElement = await renderNumbers(language, {
        twilioPrimaryPhoneNumber: new Phone(UK),
        twilioSmsPhoneNumbers: `${SG_MOBILE}, ${US_NUMBER}`,
      });
      const numbers: Array<HTMLElement> = within(cell).getAllByTestId(
        "twilio-config-phone-number",
      );

      expect(
        numbers.map((number: HTMLElement): string => {
          return `${number.tagName} ${number.getAttribute("dir")} ${number.textContent}`;
        }),
      ).toEqual([`BDI ltr ${UK}`, `BDI ltr ${SG_MOBILE}`]);
      // Still a number that is never cut short, in the gray it always was.
      for (const number of numbers) {
        expect(number).toHaveClass("whitespace-nowrap", "text-gray-900");
      }
    },
  );

  test.each(["fa", "ar"])(
    "in %s the icon still comes first on its line - the right edge of the page - and the number beside it",
    async (language: string) => {
      const words: Record<string, string> = readLocale(language);
      const cell: HTMLElement = await renderNumbers(language, {
        twilioPrimaryPhoneNumber: new Phone(SG_NATIONAL),
        twilioSmsPhoneNumbers: SG_MOBILE,
      });

      for (const [kind, number] of [
        ["Phone Calls", SG_NATIONAL],
        ["SMS", SG_MOBILE],
      ] as Array<[string, string]>) {
        const line: HTMLElement = within(cell).getByTitle(words[kind]!);
        const icon: HTMLElement = within(line).getByRole("img", {
          name: words[kind]!,
        });
        const value: HTMLElement = within(line).getByTestId(
          "twilio-config-phone-number",
        );

        expect(value).toHaveTextContent(number);
        expect(value).toHaveAttribute("dir", "ltr");
        expect(
          icon.compareDocumentPosition(value) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ).toBeTruthy();
        // The line itself is the page's: only the number reads its own way.
        expect(line).not.toHaveAttribute("dir");
      }
    },
  );

  test.each(["fa", "ar"])(
    "in %s the numbers +2 more lists on hover each read left to right, separated by the Arabic comma",
    async (language: string) => {
      await renderNumbers(language, {
        twilioPrimaryPhoneNumber: new Phone(SG_NATIONAL),
        twilioSmsPhoneNumbers: `${SG_MOBILE}, +6590001111, ${UK}`,
      });

      const count: HTMLElement = screen.getByTestId(
        "twilio-config-more-phone-numbers",
      );
      const title: string = count.getAttribute("title") || "";

      expect(title).toBe(`${LRI}+6590001111${PDI}، ${LRI}${UK}${PDI}`);
      // What it says is the two numbers, nothing more.
      expect(withoutMarks(title)).toBe(`+6590001111، ${UK}`);
    },
  );

  test("on an English page the hover lists the numbers as it always did, with no mark", async () => {
    document.documentElement.removeAttribute("dir");

    await renderNumbers("en", {
      twilioPrimaryPhoneNumber: new Phone(SG_NATIONAL),
      twilioSmsPhoneNumbers: `${SG_MOBILE}, +6590001111, ${UK}`,
    });

    const title: string =
      screen
        .getByTestId("twilio-config-more-phone-numbers")
        .getAttribute("title") || "";

    expect(title).toBe(`+6590001111, ${UK}`);
    expect(title).toBe(withoutMarks(title));
    // Each number itself is in its isolate on every page.
    expect(
      screen
        .getAllByTestId("twilio-config-phone-number")
        .map((number: HTMLElement): string => {
          return `${number.getAttribute("dir")} ${number.textContent}`;
        }),
    ).toEqual([`ltr ${SG_NATIONAL}`, `ltr ${SG_MOBILE}`]);
  });

  test.each([
    ["fa", "Send Test SMS", TwilioTestSendCopy.smsSentFrom, SG_MOBILE],
    ["ar", "Send Test Call", TwilioTestSendCopy.callPlacedFrom, SG_NATIONAL],
  ])(
    "in %s the dialog after %s names its number set apart, reading left to right",
    async (
      language: string,
      action: string,
      template: string,
      fromNumber: string,
    ) => {
      const words: Record<string, string> = readLocale(language);

      stored = {
        twilioPrimaryPhoneNumber: SG_NATIONAL,
        twilioSmsPhoneNumbers: SG_MOBILE,
      };
      jest
        .spyOn(API, "post")
        .mockResolvedValue(
          new HTTPResponse(
            200,
            { [TEST_SEND_FROM_PHONE_NUMBER_FIELD]: fromNumber },
            {},
          ) as never,
        );

      render(
        <I18nextProvider i18n={await instanceFor(language)}>
          <MemoryRouter>
            <CustomCallSMSTable />
          </MemoryRouter>
        </I18nextProvider>,
      );
      await settle();

      await act(async (): Promise<void> => {
        fireEvent.click(
          screen.getByRole("button", { name: `Row action: ${action}` }),
        );
      });
      await settle();

      await act(async (): Promise<void> => {
        fireEvent.change(
          within(dialog()).getByLabelText(words["Phone Number"]!),
          { target: { value: "+6598765432" } },
        );
      });

      await act(async (): Promise<void> => {
        fireEvent.click(
          within(dialog()).getByTestId("modal-footer-submit-button"),
        );
      });
      await settle();

      const description: string =
        screen.getByTestId("confirm-modal-description").textContent || "";

      expect(words[template]).toContain("{{phoneNumber}}");
      expect(description).toBe(
        words[template]!.replace(
          "{{phoneNumber}}",
          `${LRI}${fromNumber}${PDI}`,
        ),
      );
      expect(description).toContain(`${LRI}${fromNumber}${PDI}`);
    },
  );

  /*
   * ISSUE #7180: A LIST'S EXAMPLE PUT EACH "+" AFTER ITS DIGITS.
   *
   * A list of numbers is typed as text - a phone's dial pad has no comma -
   * so its field took the page's direction, and on a Persian or Arabic page
   * the example "+14155550123, +447700900123" drew each "+" after the
   * digits. The SMS numbers and the extra numbers read left to right now,
   * as the primary number's Phone field does: the field, the box around it,
   * and so the example in it. Their titles are the page's, in its way.
   */
  test.each(["fa", "ar"])(
    "in %s the form's lists of numbers read left to right, each example with them",
    async (language: string) => {
      const words: Record<string, string> = readLocale(language);

      render(
        <I18nextProvider i18n={await instanceFor(language)}>
          <MemoryRouter>
            <CustomCallSMSTable />
          </MemoryRouter>
        </I18nextProvider>,
      );
      await settle();

      // The stand-in table's own button opens the real form.
      await act(async (): Promise<void> => {
        fireEvent.click(
          screen.getByRole("button", { name: "Open create form" }),
        );
      });

      // The config's name, then on to the Twilio step.
      await waitFor(() => {
        expect(
          within(dialog()).getByPlaceholderText(
            words["Company Twilio Account"]!,
          ),
        ).toBeVisible();
      });
      await settle();
      await act(async (): Promise<void> => {
        fireEvent.change(
          within(dialog()).getByPlaceholderText(
            words["Company Twilio Account"]!,
          ),
          { target: { value: "Singapore" } },
        );
      });
      await clickFooter();

      await waitFor(() => {
        expect(
          within(dialog()).getByRole("switch", {
            name: words["Set as Project Default"]!,
          }),
        ).toBeVisible();
      });

      await act(async (): Promise<void> => {
        fireEvent.click(
          within(dialog()).getByRole("button", {
            name: new RegExp(words["More fields"]!),
          }),
        );
      });
      await settle();

      for (const [title, example] of [
        [SMS_NUMBERS, PHONE_NUMBER_LIST_EXAMPLE],
        [SECONDARY_NUMBERS, "+441234567890, +461234567890"],
      ] as Array<[string, string]>) {
        const field: HTMLElement = within(dialog()).getByLabelText(
          words[title]!,
          { exact: false },
        );

        expect(words[title]).not.toBe(title);
        expect([title, field.getAttribute("dir")]).toEqual([title, "ltr"]);
        expect([title, field.parentElement?.getAttribute("dir")]).toEqual([
          title,
          "ltr",
        ]);
        expect(field).toHaveAttribute("placeholder", example);
        // Typed as text, commas between the numbers: no dial pad.
        expect(field).toHaveAttribute("type", "text");
        expect(field).not.toHaveAttribute("inputmode", "tel");
        // Its title is a sentence of the page, with no direction of its own.
        expect(
          getByTextOutsideFoldedHeaders(dialog(), words[title]!).closest(
            '[dir="ltr"]',
          ),
        ).toBeNull();
      }

      // As the primary number's field always has.
      expect(
        within(dialog()).getByLabelText(words["Twilio Primary Phone Number"]!, {
          exact: false,
        }),
      ).toHaveAttribute("dir", "ltr");
    },
  );

  /*
   * An account used for SMS only asks for its SMS numbers open on the
   * Twilio step - the one list it needs, and no number to make calls from.
   * That list is a field of its own (one for each answer to what the
   * account is for), and it reads left to right too, its example with it.
   */
  test.each(["fa", "ar"])(
    "in %s an account used for SMS only asks for its numbers in a box that reads left to right",
    async (language: string) => {
      const words: Record<string, string> = readLocale(language);

      render(
        <I18nextProvider i18n={await instanceFor(language)}>
          <MemoryRouter>
            <CustomCallSMSTable />
          </MemoryRouter>
        </I18nextProvider>,
      );
      await settle();

      await act(async (): Promise<void> => {
        fireEvent.click(
          screen.getByRole("button", { name: "Open create form" }),
        );
      });

      await waitFor(() => {
        expect(
          within(dialog()).getByPlaceholderText(
            words["Company Twilio Account"]!,
          ),
        ).toBeVisible();
      });
      await settle();
      await act(async (): Promise<void> => {
        fireEvent.change(
          within(dialog()).getByPlaceholderText(
            words["Company Twilio Account"]!,
          ),
          { target: { value: "Singapore SMS" } },
        );
      });

      // What the account is for: SMS only, as the page words it.
      expect(words["SMS only"]).toBeTruthy();
      expect(words["SMS only"]).not.toBe("SMS only");
      await act(async (): Promise<void> => {
        fireEvent.click(
          within(dialog()).getByRole("radio", { name: words["SMS only"]! }),
        );
      });
      await settle();
      await clickFooter();

      await waitFor(() => {
        expect(
          within(dialog()).getByLabelText(words[SMS_NUMBERS]!, {
            exact: false,
          }),
        ).toBeVisible();
      });

      const field: HTMLElement = within(dialog()).getByLabelText(
        words[SMS_NUMBERS]!,
        { exact: false },
      );

      expect(field).toHaveAttribute("dir", "ltr");
      expect(field.parentElement).toHaveAttribute("dir", "ltr");
      expect(field).toHaveAttribute("placeholder", PHONE_NUMBER_LIST_EXAMPLE);
      // Typed as text, commas between the numbers: no dial pad.
      expect(field).toHaveAttribute("type", "text");
      expect(field).not.toHaveAttribute("inputmode", "tel");
      // No number to make calls from is asked for.
      expect(
        within(dialog()).queryByLabelText(
          words["Twilio Primary Phone Number"]!,
          { exact: false },
        ),
      ).toBeNull();
    },
  );

  test("in English the dialog says the number as it always did, with no mark", async () => {
    document.documentElement.removeAttribute("dir");
    jest
      .spyOn(API, "post")
      .mockResolvedValue(
        new HTTPResponse(
          200,
          { [TEST_SEND_FROM_PHONE_NUMBER_FIELD]: SG_MOBILE },
          {},
        ) as never,
      );

    render(
      <I18nextProvider i18n={await instanceFor("en")}>
        <MemoryRouter>
          <CustomCallSMSTable />
        </MemoryRouter>
      </I18nextProvider>,
    );
    await settle();

    await act(async (): Promise<void> => {
      fireEvent.click(
        screen.getByRole("button", { name: "Row action: Send Test SMS" }),
      );
    });
    await settle();
    await act(async (): Promise<void> => {
      fireEvent.change(within(dialog()).getByLabelText("Phone Number"), {
        target: { value: "+6598765432" },
      });
    });
    await act(async (): Promise<void> => {
      fireEvent.click(
        within(dialog()).getByTestId("modal-footer-submit-button"),
      );
    });
    await settle();

    expect(screen.getByTestId("confirm-modal-description").textContent).toBe(
      `Twilio accepted the test SMS from ${SG_MOBILE}. It should arrive within a few minutes.`,
    );
  });
});

describe("the strings the form adds", () => {
  test("are Dashboard keys, translated in every language", () => {
    const english: Record<string, string> = readLocale("en");

    for (const key of [
      SMS_NUMBERS,
      TwilioConfigNumbersCopy.primaryPhoneNumberDescription,
      TwilioConfigNumbersCopy.smsPhoneNumbersDescription,
      TwilioConfigNumbersCopy.secondaryPhoneNumbersDescription,
      TwilioConfigNumbersCopy.callsLabel,
      TwilioConfigNumbersCopy.smsLabel,
      "Phone Numbers",
    ]) {
      expect({ key, inEnglish: english[key] }).toEqual({
        key,
        inEnglish: key,
      });
    }

    for (const language of [...DASHBOARD_LANGUAGES]) {
      const words: Record<string, string> = readLocale(language);

      for (const key of [
        SMS_NUMBERS,
        TwilioConfigNumbersCopy.primaryPhoneNumberDescription,
        TwilioConfigNumbersCopy.smsPhoneNumbersDescription,
        TwilioConfigDefaultCopy.defaultSwitchDescription,
        TwilioTestSendCopy.smsDescription,
        TwilioTestSendCopy.callDescription,
        TwilioTestSendCopy.smsSentTitle,
        TwilioTestSendCopy.callPlacedTitle,
        TwilioTestSendCopy.smsSentFrom,
        TwilioTestSendCopy.smsSent,
        TwilioTestSendCopy.callPlacedFrom,
        TwilioTestSendCopy.callPlaced,
      ]) {
        expect({
          language,
          key,
          translated: Boolean(words[key]) && words[key] !== key,
        }).toEqual({ language, key, translated: true });
      }
    }
  });

  test("the strings the review adds are Dashboard keys, with their placeholders in every language", () => {
    const english: Record<string, string> = readLocale("en");

    for (const key of [
      TwilioConfigDefaultCopy.defaultSwitchDescription,
      ...Object.values(TwilioTestSendCopy),
    ]) {
      expect({ key, inEnglish: english[key] }).toEqual({ key, inEnglish: key });
    }

    for (const language of ["de", "ja", "fa", "zh-CN"]) {
      const words: Record<string, string> = readLocale(language);

      for (const key of [
        TwilioTestSendCopy.smsSentFrom,
        TwilioTestSendCopy.callPlacedFrom,
      ]) {
        expect(words[key]).toContain("{{phoneNumber}}");
      }
    }

    // The switch's help says the rule in two sentences, not five lines.
    expect(TwilioConfigDefaultCopy.defaultSwitchDescription).toBe(
      "The SMS and calls to people in this project, such as on-call alerts, will go through this config. Status pages use the config picked on each page.",
    );
  });

  test("leave none of the keys of the earlier two-field design behind", () => {
    for (const language of ["en", "de", "ja", "fa"]) {
      const words: Record<string, string> = readLocale(language);

      for (const retired of [
        "Twilio SMS Phone Number",
        "Twilio SMS Secondary Phone Numbers",
        "Calls go out from this number, and SMS too unless you set an SMS phone number under More fields.",
      ]) {
        expect({ language, retired, kept: retired in words }).toEqual({
          language,
          retired,
          kept: false,
        });
      }
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
