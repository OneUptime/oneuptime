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
import React, { ReactElement, ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * ADMIN DASHBOARD SETTINGS FORMS WITHOUT THE STEPS THEY DID NOT NEED, on the
 * real pages, cards and dialogs, in the Admin Dashboard's own languages:
 *
 *   - Settings > Call & SMS: one page - the account SID, the auth token and
 *     the number calls and SMS go out from - with the extra numbers for
 *     other countries folded under Advanced, and optional, as the server
 *     treats them (the form used to demand them);
 *   - Settings > WhatsApp: one page - the access token and the phone number
 *     ID - with the webhook's verify token, the app secret and the two IDs
 *     folded under Advanced, which says "Configured" when any is set; the
 *     setup guide on the page says where they went;
 *   - Settings > Global LLM Providers: the shared LLM provider form
 *     (LlmProviderFormFields) - Provider, a card each, then Connection, with
 *     the description, Additional Parameters and (where projects are billed
 *     for AI) the cost per million tokens folded at its end - no Advanced
 *     step and no Cost step - and a free provider's Edit form not calling
 *     its 0 cost "Configured".
 *
 * Only the network, the page chrome, the side menu, the dropdown and the
 * setup guide's markdown viewer are stand-ins; the Global LLM Providers
 * table hands its dialog's props to the real ModelFormModal, as the real
 * table does. The signed-in user is a master admin, as everyone in the admin
 * dashboard is.
 */

jest.setTimeout(60000);

let billingEnabledForTest: boolean = false;

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return billingEnabledForTest;
    },
  });

  return mocked;
});

// The cards read and save GlobalConfig through the shared model API.
const mockGetItem: MockFunction = getJestMockFunction();
const mockCreateOrUpdate: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return mockGetItem(...args);
      },
      createOrUpdate: (...args: Array<unknown>): unknown => {
        return mockCreateOrUpdate(...args);
      },
      getList: async (): Promise<unknown> => {
        return { data: [], count: 0, skip: 0, limit: 10 };
      },
      count: async (): Promise<number> => {
        return 0;
      },
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
    },
  };
});

// The Global LLM Providers page talks to the admin API.
const mockAdminGetItem: MockFunction = getJestMockFunction();
const mockAdminCreateOrUpdate: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Utils/ModelAPI",
  () => {
    return {
      __esModule: true,
      default: {
        getItem: (...args: Array<unknown>): unknown => {
          return mockAdminGetItem(...args);
        },
        createOrUpdate: (...args: Array<unknown>): unknown => {
          return mockAdminCreateOrUpdate(...args);
        },
        getList: async (): Promise<unknown> => {
          return { data: [], count: 0, skip: 0, limit: 10 };
        },
        count: async (): Promise<number> => {
          return 0;
        },
        getCommonHeaders: (): Record<string, string> => {
          return {};
        },
      },
    };
  },
);

type MockProps = Record<string, unknown>;

const mockTables: Array<MockProps> = [];

// The table is not under test: the dialog it opens is drawn from its props.
jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: MockProps): ReactElement => {
      mockTables.push(props);
      return <div data-testid={`model-table-${String(props["id"])}`} />;
    },
  };
});

interface MockPageProps {
  children?: ReactNode | undefined;
}

jest.mock("../../../UI/Components/Page/Page", () => {
  return {
    __esModule: true,
    default: (props: MockPageProps): ReactElement => {
      return <main data-testid="admin-page">{props.children}</main>;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/SideMenu",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

// The setup guide, as the markdown it is given.
jest.mock("../../../UI/Components/Markdown.tsx/LazyMarkdownViewer", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): ReactElement => {
      return <pre data-testid="setup-guide">{props.text}</pre>;
    },
  };
});

interface DropdownOptionStub {
  label: string;
  value: string;
}

// react-select stood in for: one button per option.
jest.mock("../../../UI/Components/Dropdown/Dropdown", () => {
  return {
    __esModule: true,
    DROPDOWN_MENU_Z_INDEX: 60,
    default: (props: {
      options: Array<DropdownOptionStub>;
      onChange?: ((value: string) => void) | undefined;
    }): ReactElement => {
      return (
        <div>
          {props.options.map((option: DropdownOptionStub) => {
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  props.onChange?.(option.value);
                }}
              >
                {`Pick ${option.label}`}
              </button>
            );
          })}
        </div>
      );
    },
  };
});

import CallSmsSettings from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/CallSMS/Index";
import WhatsAppSettings from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/WhatsApp/Index";
import LlmProviderSettings from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/LlmProviders/Index";
import AdminModelAPI from "../../../../App/FeatureSet/AdminDashboard/src/Utils/ModelAPI";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import LlmProvider from "../../../Models/DatabaseModels/LlmProvider";
import { PHONE_NUMBER_LIST_EXAMPLE } from "../../../Types/CallAndSMS/TwilioPhoneNumbers";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ObjectID from "../../../Types/ObjectID";
import { FormType, ModelField } from "../../../UI/Components/Forms/ModelForm";
import { FormStep } from "../../../UI/Components/Forms/Types/FormStep";
import ModelFormModal from "../../../UI/Components/ModelFormModal/ModelFormModal";
import UserUtil from "../../../UI/Utils/User";
import {
  getByTextOutsideFoldedHeaders,
  hasSetChip,
  listedNames,
  setChips,
} from "../../UI/Components/FoldedSection/FoldedSectionQueries";

const WAIT_FOR_TIMEOUT: number = 20000;

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "AdminDashboard",
  "src",
  "Locales",
);

type Locale = Record<string, unknown>;

function readLocale(locale: string): Locale {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Locale;
}

const ENGLISH: Locale = readLocale("en");
const GERMAN: Locale = readLocale("de");
const JAPANESE: Locale = readLocale("ja");

// A page's nested entry ("pages.settings.callSms.editButton"), or a flat one.
function text(locale: Locale, key: string): string {
  if (typeof locale[key] === "string") {
    return locale[key] as string;
  }

  let node: unknown = locale;

  for (const part of key.split(".")) {
    node = (node as Record<string, unknown>)[part];
  }

  if (typeof node !== "string") {
    throw new Error(`No locale entry ${key}`);
  }

  return node;
}

const LLM_ID: string = "dddddddd-0000-4000-8000-000000000004";

// What the server holds, by table name.
let stored: Record<string, Record<string, unknown>> = {};

interface ItemCall {
  modelType: { new (): BaseModel };
  id: ObjectID;
}

async function answerGetItem(options: unknown): Promise<unknown> {
  const call: ItemCall = options as ItemCall;
  const item: BaseModel = new call.modelType();
  const values: Record<string, unknown> = stored[item.tableName || ""] || {};

  (item as unknown as Record<string, unknown>)["_id"] = call.id.toString();
  Object.assign(item, values);

  return item;
}

interface SaveCall {
  model: BaseModel;
  modelType: { new (): BaseModel };
  formType: FormType;
}

// The model the form saved, as ModelForm hands it to the API.
function savedValues(mock: MockFunction): Record<string, unknown> {
  expect(mock).toHaveBeenCalledTimes(1);

  const call: SaveCall = mock.mock.calls[0]![0] as SaveCall;

  return call.model as unknown as Record<string, unknown>;
}

async function instanceFor(locale: string): Promise<i18n> {
  const instance: i18n = createInstance();

  await instance.init({
    lng: locale,
    fallbackLng: "en",
    resources: {
      en: { translation: ENGLISH },
      [locale]: { translation: readLocale(locale) },
    },
    interpolation: { escapeValue: false },
  });

  return instance;
}

async function settle(): Promise<void> {
  for (let index: number = 0; index < 20; index++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderWithLocale(
  element: ReactElement,
  locale: string = "en",
): Promise<void> {
  const instance: i18n = await instanceFor(locale);

  render(<I18nextProvider i18n={instance}>{element}</I18nextProvider>);

  await settle();
}

async function openEditDialog(editButton: string): Promise<HTMLElement> {
  await waitFor(
    () => {
      expect(screen.getByRole("button", { name: editButton })).toBeVisible();
    },
    { timeout: WAIT_FOR_TIMEOUT },
  );

  fireEvent.click(screen.getByRole("button", { name: editButton }));

  await waitFor(
    () => {
      expect(screen.getByTestId("modal")).toBeInTheDocument();
    },
    { timeout: WAIT_FOR_TIMEOUT },
  );

  return screen.getByTestId("modal");
}

/*
 * The open label of a field: its title, then " (Optional)" when it is - not
 * the name a folded More fields header lists while it is folded.
 */
function label(dialog: HTMLElement, title: string): HTMLElement {
  return getByTextOutsideFoldedHeaders(dialog, title);
}

function advancedHeader(dialog: HTMLElement, title: string): HTMLElement {
  return within(dialog).getByRole("button", { name: title });
}

function expectNoSteps(dialog: HTMLElement): void {
  expect(
    within(dialog).queryByRole("navigation", { name: "Progress" }),
  ).toBeNull();
  expect(within(dialog).queryByTestId("modal-footer-next-button")).toBeNull();
}

beforeEach(() => {
  billingEnabledForTest = false;
  stored = {};
  mockTables.length = 0;

  mockGetItem.mockReset();
  mockGetItem.mockImplementation(answerGetItem);
  mockCreateOrUpdate.mockReset();
  mockCreateOrUpdate.mockImplementation(
    async (request: unknown): Promise<unknown> => {
      return { data: (request as SaveCall).model };
    },
  );
  mockAdminGetItem.mockReset();
  mockAdminGetItem.mockImplementation(answerGetItem);
  mockAdminCreateOrUpdate.mockReset();
  mockAdminCreateOrUpdate.mockImplementation(
    async (request: unknown): Promise<unknown> => {
      return { data: (request as SaveCall).model };
    },
  );

  // Everyone in the admin dashboard is a master admin.
  getJestSpyOn(UserUtil, "isMasterAdmin").mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("Settings > Call & SMS", () => {
  const editButton: string = text(ENGLISH, "pages.settings.callSms.editButton");

  beforeEach(() => {
    stored[new GlobalConfig().tableName || ""] = {
      twilioAccountSID: "AC0123456789",
      twilioAuthToken: "auth-token-value",
      twilioPrimaryPhoneNumber: "+15550000001",
    };
  });

  test("edits the account, its token and the number on one page, with the extra numbers folded", async () => {
    await renderWithLocale(<CallSmsSettings />);

    const dialog: HTMLElement = await openEditDialog(editButton);

    await waitFor(
      () => {
        expect(label(dialog, "Twilio Account SID")).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
    await settle();

    expectNoSteps(dialog);
    expect(label(dialog, "Twilio Auth Token")).toBeVisible();
    expect(label(dialog, "Twilio Primary Phone Number")).toBeVisible();

    // Folded: the header shows, the field does not, until it is opened.
    const header: HTMLElement = advancedHeader(dialog, "More fields");

    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(label(dialog, "Twilio Secondary Phone Numbers")).not.toBeVisible();
    // Nothing set in it, so nothing to call out.
    expect(setChips(header)).toEqual([]);

    fireEvent.click(header);

    expect(label(dialog, "Twilio Secondary Phone Numbers")).toBeVisible();
    // Optional now: an installation with one number has nothing to add.
    expect(label(dialog, "Twilio Secondary Phone Numbers")).toHaveTextContent(
      "(Optional)",
    );
    expect(label(dialog, "Twilio Account SID")).not.toHaveTextContent(
      "(Optional)",
    );

    expect(
      within(dialog).getByTestId("modal-footer-submit-button"),
    ).toHaveTextContent("Save Changes");
  });

  test("saves without extra numbers, which the form used to demand", async () => {
    await renderWithLocale(<CallSmsSettings />);

    const dialog: HTMLElement = await openEditDialog(editButton);

    await waitFor(
      () => {
        expect(label(dialog, "Twilio Account SID")).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
    await settle();

    fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));

    await waitFor(
      () => {
        expect(mockCreateOrUpdate).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    const request: SaveCall = mockCreateOrUpdate.mock.calls[0]![0] as SaveCall;

    expect(request.formType).toBe(FormType.Update);
    expect(request.modelType).toBe(GlobalConfig);

    const saved: Record<string, unknown> = savedValues(mockCreateOrUpdate);

    expect(saved["twilioAccountSID"]).toBe("AC0123456789");
    expect(saved["twilioAuthToken"]).toBe("auth-token-value");
    expect(saved["twilioSecondaryPhoneNumbers"] || "").toBe("");
  });

  test("shows the extra numbers as set when they are saved, in the reader's language", async () => {
    stored[new GlobalConfig().tableName || ""]!["twilioSecondaryPhoneNumbers"] =
      "+441234567890, +461234567890";

    await renderWithLocale(<CallSmsSettings />, "de");

    const dialog: HTMLElement = await openEditDialog(
      text(GERMAN, "pages.settings.callSms.editButton"),
    );

    await waitFor(
      () => {
        expect(label(dialog, text(GERMAN, "Twilio Account SID"))).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
    await settle();

    const header: HTMLElement = advancedHeader(
      dialog,
      text(GERMAN, "More fields"),
    );

    expect(text(GERMAN, "More fields")).toBe("Weitere Felder");
    expect(header).toHaveAttribute("aria-expanded", "false");
    /*
     * The folded header names the numbers in German, as a chip: they are
     * set. A one-line list shows what it holds beside its name, as the
     * Dashboard's Twilio Config form does.
     */
    expect(setChips(header)).toEqual([
      `${text(GERMAN, "Twilio Secondary Phone Numbers")}: +441234567890, +461234567890`,
    ]);
    expect(
      label(dialog, text(GERMAN, "Twilio Secondary Phone Numbers")),
    ).not.toBeVisible();
  });

  /*
   * The server's numbers for SMS, as a project's Twilio config has them: a
   * Twilio number can make calls and send SMS, or only one of the two, and
   * Singapore's national numbers are voice-only - SMS there need a mobile
   * number. Folded with the extra numbers, as few installations need them.
   * Their help names no country, and their empty field shows an example
   * that is no one country's numbers: OneUptime is used worldwide.
   */
  describe("numbers for SMS", () => {
    const SMS_NUMBERS: string = "Twilio SMS Phone Numbers";
    const SECONDARY: string = "Twilio Secondary Phone Numbers";
    const PRIMARY_HELP: string =
      "Calls go out from this number, and SMS too unless you add SMS phone numbers under More fields.";
    const SMS_HELP: string =
      "Numbers to send SMS from if yours can only make calls. Each SMS uses the one in the recipient's country, or the first.";
    const LIST_ERROR: string =
      "{{entry}} is not a phone number. Write each number with its country code and separate them with commas, like {{example}}.";

    async function openDialog(): Promise<HTMLElement> {
      const dialog: HTMLElement = await openEditDialog(editButton);

      await waitFor(
        () => {
          expect(label(dialog, "Twilio Account SID")).toBeVisible();
        },
        { timeout: WAIT_FOR_TIMEOUT },
      );
      await settle();

      return dialog;
    }

    async function fill(
      dialog: HTMLElement,
      title: string,
      value: string,
    ): Promise<void> {
      await act(async () => {
        fireEvent.change(
          within(dialog).getByLabelText(title, { exact: false }),
          { target: { value } },
        );
      });
    }

    test("are folded with the extra numbers, the SMS numbers first, each optional", async () => {
      await renderWithLocale(<CallSmsSettings />);

      const dialog: HTMLElement = await openDialog();
      const header: HTMLElement = advancedHeader(dialog, "More fields");

      expect(listedNames(header)).toEqual([SMS_NUMBERS, SECONDARY]);
      expect(label(dialog, SMS_NUMBERS)).not.toBeVisible();

      fireEvent.click(header);

      for (const title of [SMS_NUMBERS, SECONDARY]) {
        expect(label(dialog, title)).toBeVisible();
        expect(label(dialog, title)).toHaveTextContent("(Optional)");
      }

      // The primary number says what goes out from it, and where the rest is.
      expect(within(dialog).getByText(PRIMARY_HELP)).toBeVisible();
      // The SMS numbers say when they are needed, and what they change.
      expect(within(dialog).getByText(SMS_HELP)).toBeVisible();
      // Empty, they show the server's example list: no one country's numbers.
      expect(
        within(dialog).getByLabelText(SMS_NUMBERS, { exact: false }),
      ).toHaveAttribute("placeholder", PHONE_NUMBER_LIST_EXAMPLE);
      expect(PHONE_NUMBER_LIST_EXAMPLE).toBe("+14155550123, +447700900123");
    });

    /*
     * In the reader's language, the "(Optional)" after each title too: the
     * Admin Dashboard's locales had no entry for it, so these titles read
     * "Twilio SMS 電話番号 (Optional)" - the one English word in the form.
     * It is worded as the Dashboard's Japanese locale words it.
     */
    test("say they are optional, and when the SMS numbers are needed, in the reader's language", async () => {
      await renderWithLocale(<CallSmsSettings />, "ja");

      const dialog: HTMLElement = await openEditDialog(
        text(JAPANESE, "pages.settings.callSms.editButton"),
      );

      await waitFor(
        () => {
          expect(
            label(dialog, text(JAPANESE, "Twilio Account SID")),
          ).toBeVisible();
        },
        { timeout: WAIT_FOR_TIMEOUT },
      );
      await settle();

      fireEvent.click(advancedHeader(dialog, text(JAPANESE, "More fields")));

      expect(text(JAPANESE, "(Optional)")).toBe("（任意）");

      for (const title of [SMS_NUMBERS, SECONDARY]) {
        const drawn: HTMLElement = label(dialog, text(JAPANESE, title));

        expect(drawn).toBeVisible();
        expect(drawn).toHaveTextContent(text(JAPANESE, "(Optional)"));
        expect(drawn).not.toHaveTextContent("(Optional)");
      }

      // The help in Japanese: when the numbers are needed, no country named.
      expect(within(dialog).getByText(text(JAPANESE, SMS_HELP))).toBeVisible();
      expect(text(JAPANESE, SMS_HELP)).not.toContain("シンガポール");
      // The example list is numbers, the same in every language.
      expect(
        within(dialog).getByLabelText(text(JAPANESE, SMS_NUMBERS), {
          exact: false,
        }),
      ).toHaveAttribute("placeholder", PHONE_NUMBER_LIST_EXAMPLE);
    });

    test("a Singapore setup is saved: SMS from the mobile number, calls from the national one", async () => {
      stored[new GlobalConfig().tableName || ""]!["twilioPrimaryPhoneNumber"] =
        "+6561234567";

      await renderWithLocale(<CallSmsSettings />);

      const dialog: HTMLElement = await openDialog();

      fireEvent.click(advancedHeader(dialog, "More fields"));
      await fill(dialog, SMS_NUMBERS, "+6581234567");

      fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));

      await waitFor(
        () => {
          expect(mockCreateOrUpdate).toHaveBeenCalledTimes(1);
        },
        { timeout: WAIT_FOR_TIMEOUT },
      );

      const saved: Record<string, unknown> = savedValues(mockCreateOrUpdate);

      expect(String(saved["twilioPrimaryPhoneNumber"])).toBe("+6561234567");
      expect(String(saved["twilioSmsPhoneNumbers"])).toBe("+6581234567");
    });

    test("a list of SMS numbers that is not one is refused under the field, and nothing is saved", async () => {
      await renderWithLocale(<CallSmsSettings />);

      const dialog: HTMLElement = await openDialog();

      fireEvent.click(advancedHeader(dialog, "More fields"));
      await fill(dialog, SMS_NUMBERS, "+6581234567, mobile");

      fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));

      await waitFor(
        () => {
          expect(
            within(dialog).getByText(
              '"mobile" is not a phone number. Write each number with its country code and separate them with commas, like +14155550123, +447700900123.',
            ),
          ).toBeVisible();
        },
        { timeout: WAIT_FOR_TIMEOUT },
      );
      expect(mockCreateOrUpdate).not.toHaveBeenCalled();
    });

    test("the details say SMS go out from the same numbers as calls while no SMS numbers are listed", async () => {
      await renderWithLocale(<CallSmsSettings />);

      await waitFor(
        () => {
          expect(
            screen.getByText(
              text(ENGLISH, "pages.settings.callSms.smsSameAsCalls"),
            ),
          ).toBeVisible();
        },
        { timeout: WAIT_FOR_TIMEOUT },
      );
      expect(text(ENGLISH, "pages.settings.callSms.smsSameAsCalls")).toBe(
        "Same numbers as calls",
      );
      // Right below the primary number, as in the form.
      const page: string = document.body.textContent || "";
      const primaryAt: number = page.indexOf("Twilio Primary Phone Number");
      const smsAt: number = page.indexOf(SMS_NUMBERS);
      const secondaryAt: number = page.indexOf(SECONDARY);

      expect(primaryAt).toBeGreaterThan(-1);
      expect(smsAt).toBeGreaterThan(primaryAt);
      expect(secondaryAt).toBeGreaterThan(smsAt);
    });

    test("and show the SMS numbers once they are listed, in the reader's language", async () => {
      stored[new GlobalConfig().tableName || ""]!["twilioSmsPhoneNumbers"] =
        "+6581234567, +447700900123";

      await renderWithLocale(<CallSmsSettings />, "de");

      await waitFor(
        () => {
          expect(screen.getByText("+6581234567, +447700900123")).toBeVisible();
        },
        { timeout: WAIT_FOR_TIMEOUT },
      );
      expect(screen.getByText(text(GERMAN, SMS_NUMBERS))).toBeVisible();
      // The Dashboard's word for it, as for the primary and secondary numbers.
      expect(text(GERMAN, SMS_NUMBERS)).toBe("Twilio-SMS-Rufnummern");
      expect(
        screen.queryByText(
          text(GERMAN, "pages.settings.callSms.smsSameAsCalls"),
        ),
      ).toBeNull();
    });

    /*
     * The server's Twilio config and a project's are filled in the same
     * way, and the docs describe both with one table of what goes out from
     * which field: the Admin form names its numbers, helps with them and
     * gives their examples exactly as the Dashboard's Twilio Config form
     * does - "Twilio Primary Phone Number", not "Primary Twilio Phone
     * Number" beside "Twilio SMS Phone Numbers".
     */
    test("are named, explained and shown by example as on a project's Twilio config", () => {
      const admin: string = fs.readFileSync(
        path.join(
          __dirname,
          "..",
          "..",
          "..",
          "..",
          "App",
          "FeatureSet",
          "AdminDashboard",
          "src",
          "Pages",
          "Settings",
          "CallSMS",
          "Index.tsx",
        ),
        "utf8",
      );
      const dashboard: string = fs.readFileSync(
        path.join(
          __dirname,
          "..",
          "..",
          "..",
          "..",
          "App",
          "FeatureSet",
          "Dashboard",
          "src",
          "Components",
          "CallSMS",
          "CallSMSConfigTable.tsx",
        ),
        "utf8",
      );

      for (const title of [
        "Twilio Primary Phone Number",
        SMS_NUMBERS,
        SECONDARY,
      ]) {
        expect({ title, admin: admin.includes(`title: "${title}"`) }).toEqual({
          title,
          admin: true,
        });
        expect({
          title,
          dashboard: dashboard.includes(`title: "${title}"`),
        }).toEqual({ title, dashboard: true });
      }

      for (const retired of [
        "Primary Twilio Phone Number",
        "Secondary Twilio Phone Numbers",
        "If you have bought more phone numbers from Twilio for specific countries",
      ]) {
        expect({ retired, admin: admin.includes(retired) }).toEqual({
          retired,
          admin: false,
        });
        expect({ retired, inLocale: retired in ENGLISH }).toEqual({
          retired,
          inLocale: false,
        });
      }

      for (const placeholder of [
        '"+14155550100"',
        // The SMS numbers' example: the server's list, no one country's.
        "PHONE_NUMBER_LIST_EXAMPLE",
        '"+441234567890, +461234567890"',
      ]) {
        expect(admin).toContain(`placeholder: ${placeholder},`);
        expect(dashboard).toContain(`placeholder: ${placeholder},`);
      }

      // And the same help, naming no country.
      expect(admin).toContain(`"${SMS_HELP}"`);
      for (const source of [admin, dashboard]) {
        expect(source).not.toContain("Singapore");
        expect(source).not.toContain("+65");
      }

      // The Dashboard's help for the secondary numbers, and its words for them.
      expect(text(ENGLISH, SECONDARY)).toBe(SECONDARY);
      expect(
        text(
          GERMAN,
          "Numbers to use instead of the primary one when they match the recipient's country code.",
        ),
      ).toBe(
        "Nummern, die statt der Hauptnummer verwendet werden, wenn sie zur Landesvorwahl des Empfängers passen.",
      );
      expect(text(GERMAN, "Twilio Primary Phone Number")).toBe(
        "Twilio-Primärrufnummer",
      );
      expect(text(GERMAN, SECONDARY)).toBe("Twilio-Sekundärrufnummern");
    });

    test("the card says whose SMS and calls go through the server's account", async () => {
      expect(text(ENGLISH, "pages.settings.callSms.cardDescription")).toBe(
        "The Twilio account OneUptime sends SMS and calls through, unless a project uses a Twilio config of its own.",
      );

      await renderWithLocale(<CallSmsSettings />);

      await waitFor(
        () => {
          expect(
            screen.getByText(
              text(ENGLISH, "pages.settings.callSms.cardDescription"),
            ),
          ).toBeVisible();
        },
        { timeout: WAIT_FOR_TIMEOUT },
      );
      expect(document.body.textContent).not.toContain(
        "This will be used to make Call and send SMS.",
      );
    });

    test("every word they add is in the Admin Dashboard's locales, translated", () => {
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
        const words: Locale = readLocale(language);

        for (const key of [
          SMS_NUMBERS,
          PRIMARY_HELP,
          SMS_HELP,
          LIST_ERROR,
          "pages.settings.callSms.smsSameAsCalls",
          "pages.settings.callSms.cardDescription",
          "Twilio Primary Phone Number",
          SECONDARY,
          "Numbers to use instead of the primary one when they match the recipient's country code.",
        ]) {
          const english: string = text(ENGLISH, key);
          const translated: string = text(words, key);

          expect({ language, key, translated: translated !== english }).toEqual(
            { language, key, translated: true },
          );
        }
      }
    });
  });

  /*
   * What the server's account is used for, asked first, as a project's
   * Twilio config asks it: calls and SMS, SMS only or calls only - then
   * only the numbers that answer takes. An account used for one of the two
   * sends nothing of the other: only the Twilio configs projects add
   * themselves can, which each answer says.
   */
  describe("what the account is used for", () => {
    const USE: string = "Use This Account For";
    const SMS_NUMBERS: string = "Twilio SMS Phone Numbers";
    const SECONDARY: string = "Twilio Secondary Phone Numbers";
    const PRIMARY_HELP: string =
      "Calls go out from this number, and SMS too unless you add SMS phone numbers under More fields.";
    const ANSWERS: Array<[string, string]> = [
      ["Calls and SMS", "Calls and SMS go out from this account."],
      [
        "SMS only",
        "This account makes no calls. Projects can make them through a Twilio config of their own.",
      ],
      [
        "Calls only",
        "This account sends no SMS. Projects can send them through a Twilio config of their own.",
      ],
    ];

    async function openDialog(): Promise<HTMLElement> {
      const dialog: HTMLElement = await openEditDialog(editButton);

      await waitFor(
        () => {
          expect(label(dialog, "Twilio Account SID")).toBeVisible();
        },
        { timeout: WAIT_FOR_TIMEOUT },
      );
      await settle();

      return dialog;
    }

    function answer(dialog: HTMLElement, title: string): HTMLInputElement {
      return within(dialog).getByRole("radio", {
        name: title,
      }) as HTMLInputElement;
    }

    async function pick(dialog: HTMLElement, title: string): Promise<void> {
      await act(async () => {
        fireEvent.click(answer(dialog, title));
      });
      await settle();
    }

    function shows(dialog: HTMLElement, title: string): boolean {
      return within(dialog)
        .queryAllByText(title)
        .some((element: HTMLElement): boolean => {
          return !element.closest("[data-testid='folded-section-header']");
        });
    }

    test("is asked first, with three answers, Calls and SMS for an account saved before the choice", async () => {
      await renderWithLocale(<CallSmsSettings />);

      const dialog: HTMLElement = await openDialog();

      expect(label(dialog, USE)).toBeVisible();

      for (const [title, description] of ANSWERS) {
        const input: HTMLInputElement = answer(dialog, title);

        expect(input).toBeVisible();
        expect(
          document.getElementById(input.getAttribute("aria-describedby") || ""),
        ).toHaveTextContent(description);
      }

      // Nothing stored for it: calls and SMS, as every installation's account was.
      expect(answer(dialog, "Calls and SMS").checked).toBe(true);

      // Asked before the account itself.
      const page: string = dialog.textContent || "";

      expect(page.indexOf(USE)).toBeLessThan(
        page.indexOf("Twilio Account SID"),
      );
    });

    test("SMS only asks for SMS numbers, open and required, and no number to make calls from", async () => {
      await renderWithLocale(<CallSmsSettings />);

      const dialog: HTMLElement = await openDialog();

      await pick(dialog, "SMS only");

      expect(label(dialog, SMS_NUMBERS)).toBeVisible();
      expect(label(dialog, SMS_NUMBERS)).not.toHaveTextContent("(Optional)");
      expect(
        within(dialog).getByText(
          "Every SMS goes out from one of these: the one in the recipient's country, or else the first.",
        ),
      ).toBeVisible();
      expect(shows(dialog, "Twilio Primary Phone Number")).toBe(false);
      expect(
        within(dialog).queryByRole("button", { name: "More fields" }),
      ).toBe(null);
    });

    test("an account used for SMS only is saved with its SMS numbers", async () => {
      await renderWithLocale(<CallSmsSettings />);

      const dialog: HTMLElement = await openDialog();

      await pick(dialog, "SMS only");
      await act(async () => {
        fireEvent.change(
          within(dialog).getByLabelText(SMS_NUMBERS, { exact: false }),
          { target: { value: "+6581234567" } },
        );
      });

      fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));

      await waitFor(
        () => {
          expect(mockCreateOrUpdate).toHaveBeenCalledTimes(1);
        },
        { timeout: WAIT_FOR_TIMEOUT },
      );

      const saved: Record<string, unknown> = savedValues(mockCreateOrUpdate);

      expect(saved["twilioUsedFor"]).toBe("SMS only");
      expect(String(saved["twilioSmsPhoneNumbers"])).toBe("+6581234567");
    });

    test("an account used for SMS only without SMS numbers is refused, and nothing is saved", async () => {
      await renderWithLocale(<CallSmsSettings />);

      const dialog: HTMLElement = await openDialog();

      await pick(dialog, "SMS only");

      fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));

      await waitFor(
        () => {
          expect(
            within(dialog).getByText(`${SMS_NUMBERS} is required.`),
          ).toBeVisible();
        },
        { timeout: WAIT_FOR_TIMEOUT },
      );
      expect(mockCreateOrUpdate).not.toHaveBeenCalled();
    });

    test("Calls only asks for the number calls go out from, and folds only the extra numbers", async () => {
      await renderWithLocale(<CallSmsSettings />);

      const dialog: HTMLElement = await openDialog();

      await pick(dialog, "Calls only");

      expect(label(dialog, "Twilio Primary Phone Number")).toBeVisible();
      expect(
        within(dialog).getByText("Calls go out from this number."),
      ).toBeVisible();
      expect(within(dialog).queryByText(PRIMARY_HELP)).toBeNull();
      expect(listedNames(advancedHeader(dialog, "More fields"))).toEqual([
        SECONDARY,
      ]);
      expect(shows(dialog, SMS_NUMBERS)).toBe(false);
    });

    test("the details say what the account is used for, and show only the numbers it sends from", async () => {
      stored[new GlobalConfig().tableName || ""] = {
        twilioUsedFor: "SMS only",
        twilioAccountSID: "AC0123456789",
        twilioAuthToken: "auth-token-value",
        twilioSmsPhoneNumbers: "+6581234567",
      };

      await renderWithLocale(<CallSmsSettings />);

      await waitFor(
        () => {
          expect(screen.getByText("+6581234567")).toBeVisible();
        },
        { timeout: WAIT_FOR_TIMEOUT },
      );

      expect(screen.getByText("Used For")).toBeVisible();
      expect(screen.getByText("SMS only")).toBeVisible();
      expect(screen.queryByText("Twilio Primary Phone Number")).toBeNull();
      expect(screen.queryByText(SECONDARY)).toBeNull();
    });

    test("in the reader's language", async () => {
      stored[new GlobalConfig().tableName || ""] = {
        twilioUsedFor: "Calls only",
        twilioAccountSID: "AC0123456789",
        twilioAuthToken: "auth-token-value",
        twilioPrimaryPhoneNumber: "+15550000001",
      };

      await renderWithLocale(<CallSmsSettings />, "de");

      await waitFor(
        () => {
          expect(screen.getByText(text(GERMAN, "Calls only"))).toBeVisible();
        },
        { timeout: WAIT_FOR_TIMEOUT },
      );
      expect(text(GERMAN, "Calls only")).toBe("Nur Anrufe");
      expect(screen.getByText(text(GERMAN, "Used For"))).toBeVisible();
      // An account used for calls only sends no SMS: no SMS numbers shown.
      expect(screen.queryByText(text(GERMAN, SMS_NUMBERS))).toBeNull();
    });

    test("every word it adds is in the Admin Dashboard's locales, translated", () => {
      const keys: Array<string> = [
        USE,
        "Used For",
        "Calls go out from this number.",
        "Every SMS goes out from one of these: the one in the recipient's country, or else the first.",
        ...ANSWERS.flat(),
      ];

      for (const key of keys) {
        expect({ key, english: text(ENGLISH, key) }).toEqual({
          key,
          english: key,
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
        const words: Locale = readLocale(language);

        for (const key of keys) {
          expect({
            language,
            key,
            translated: text(words, key) !== key,
          }).toEqual({ language, key, translated: true });
        }
      }
    });
  });
});

describe("Settings > WhatsApp", () => {
  const editButton: string = text(
    ENGLISH,
    "pages.settings.whatsapp.metaEditButton",
  );

  const FOLDED: Array<string> = [
    "Webhook Verify Token",
    "App Secret",
    "Business Account ID",
    "App ID",
  ];

  test("edits the two values a message is sent with on one page, and folds the rest", async () => {
    await renderWithLocale(<WhatsAppSettings />);

    const dialog: HTMLElement = await openEditDialog(editButton);

    await waitFor(
      () => {
        expect(label(dialog, "Access Token")).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
    await settle();

    expectNoSteps(dialog);
    expect(label(dialog, "Phone Number ID")).toBeVisible();

    const header: HTMLElement = advancedHeader(dialog, "More fields");

    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(setChips(header)).toEqual([]);

    for (const title of FOLDED) {
      expect(label(dialog, title)).not.toBeVisible();
    }

    fireEvent.click(header);

    for (const title of FOLDED) {
      expect(label(dialog, title)).toBeVisible();
      expect(label(dialog, title)).toHaveTextContent("(Optional)");
    }
  });

  test("shows the webhook settings as set once the webhook is set up", async () => {
    stored[new GlobalConfig().tableName || ""] = {
      metaWhatsAppPhoneNumberId: "123456789012345",
      metaWhatsAppWebhookVerifyToken: "a-strong-verify-token",
    };

    await renderWithLocale(<WhatsAppSettings />);

    const dialog: HTMLElement = await openEditDialog(editButton);

    await waitFor(
      () => {
        expect(label(dialog, "Access Token")).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
    await settle();

    expect(hasSetChip(advancedHeader(dialog, "More fields"))).toBe(true);
  });

  test("the setup guide says the webhook settings are under More fields", async () => {
    await renderWithLocale(<WhatsAppSettings />);

    const guide: string = screen.getByTestId("setup-guide").textContent || "";

    expect(guide).toContain(
      "Paste the access token and phone number ID into the **Meta WhatsApp Settings** card above, then save. The Business Account ID, App ID and App Secret from the next steps go under **More fields** in the same form.",
    );
    expect(guide).toContain(
      "open **Settings → WhatsApp → Meta WhatsApp Settings**, expand **More fields** and enter a strong value in **Webhook Verify Token**",
    );
    expect(guide).toContain("Save the **App Secret** under **More fields**");
    // The fold is not called Advanced any more, here either.
    expect(guide).not.toContain("**Advanced**");
    // No step tells anyone to look for the verify token beside the token.
    expect(guide).not.toContain(
      "Paste the access token, phone number ID, and webhook verify token",
    );
  });
});

describe("Settings > Global LLM Providers", () => {
  function llmTable(): MockProps {
    const table: MockProps | undefined = [...mockTables]
      .reverse()
      .find((props: MockProps) => {
        return props["id"] === "llms-table";
      });

    if (!table) {
      throw new Error("The Global LLM Providers table was not rendered.");
    }

    return table;
  }

  /*
   * The page's table, as its Create or Edit dialog: what ModelTable hands
   * ModelFormModal (fields less the other form's own, the steps, the hook).
   */
  async function openDialog(
    formType: FormType,
    locale: string = "en",
  ): Promise<HTMLElement> {
    const page: ReturnType<typeof render> = render(
      <I18nextProvider i18n={await instanceFor(locale)}>
        <LlmProviderSettings />
      </I18nextProvider>,
    );
    const table: MockProps = llmTable();

    page.unmount();

    const isCreate: boolean = formType === FormType.Create;
    const fields: Array<ModelField<LlmProvider>> = (
      table["formFields"] as Array<ModelField<LlmProvider>>
    ).filter((field: ModelField<LlmProvider>): boolean => {
      return isCreate
        ? !field.doNotShowWhenCreating
        : !field.doNotShowWhenEditing;
    });

    await renderWithLocale(
      <ModelFormModal<LlmProvider>
        modelType={LlmProvider}
        modelAPI={table["modelAPI"] as typeof AdminModelAPI}
        title={isCreate ? "Create LLM Provider" : "Edit LLM Provider"}
        submitButtonText={isCreate ? "Create LLM Provider" : "Save Changes"}
        onBeforeCreate={
          table["onBeforeCreate"] as (item: LlmProvider) => Promise<LlmProvider>
        }
        modelIdToEdit={isCreate ? undefined : new ObjectID(LLM_ID)}
        formProps={{
          name: "llm-provider",
          id: "llm-provider-form",
          modelType: LlmProvider,
          fields: fields,
          steps: table["formSteps"] as Array<FormStep<LlmProvider>>,
          formType: formType,
        }}
      />,
      locale,
    );

    await waitFor(
      () => {
        expect(screen.getByTestId("modal")).toBeInTheDocument();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    return screen.getByTestId("modal");
  }

  function stepTitles(dialog: HTMLElement): Array<string> {
    const progress: HTMLElement = within(dialog).getByRole("navigation", {
      name: "Progress",
    });

    return within(progress)
      .getAllByRole("listitem")
      .map((item: HTMLElement): string => {
        return (item.textContent || "").trim();
      });
  }

  async function waitForSteps(dialog: HTMLElement): Promise<void> {
    await waitFor(
      () => {
        expect(
          within(dialog).getByRole("navigation", { name: "Progress" }),
        ).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
  }

  // Picks a provider's card, then goes on to Connection.
  async function pickProvider(
    dialog: HTMLElement,
    type: string,
  ): Promise<void> {
    await waitFor(
      () => {
        expect(
          within(dialog).getByTestId(`card-select-option-${type}`),
        ).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    fireEvent.click(within(dialog).getByTestId(`card-select-option-${type}`));
    await settle();
    fireEvent.click(within(dialog).getByRole("button", { name: "Next" }));
    await settle();

    await waitFor(
      () => {
        expect(label(dialog, "Name")).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
  }

  test("walks Provider, then Connection - no Advanced step and no Cost step", async () => {
    billingEnabledForTest = true;

    const dialog: HTMLElement = await openDialog(FormType.Create);

    await waitForSteps(dialog);

    const titles: Array<string> = stepTitles(dialog);

    expect(titles).toHaveLength(2);
    expect(titles[0]).toContain("Provider");
    expect(titles[1]).toContain("Connection");
    expect(titles.join(" ")).not.toMatch(/Advanced|Cost/);
  });

  test("names its two steps in the reader's language", async () => {
    const dialog: HTMLElement = await openDialog(FormType.Create, "de");

    await waitForSteps(dialog);

    const titles: Array<string> = stepTitles(dialog);

    expect(titles).toHaveLength(2);
    expect(titles[0]).toContain(text(GERMAN, "Provider"));
    expect(titles[1]).toContain(text(GERMAN, "Connection"));
    expect(text(GERMAN, "Connection")).not.toBe("Connection");
  });

  test("offers one card per provider, each saying what it is, in the reader's language", async () => {
    const dialog: HTMLElement = await openDialog(FormType.Create, "de");

    await waitFor(
      () => {
        expect(
          within(dialog).getByTestId("card-select-option-Ollama"),
        ).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    expect(
      within(dialog)
        .getAllByRole("radio")
        .map((card: HTMLElement) => {
          return card.getAttribute("data-testid");
        }),
    ).toEqual([
      "card-select-option-OpenAI",
      "card-select-option-Anthropic",
      "card-select-option-AzureOpenAI",
      "card-select-option-Groq",
      "card-select-option-Mistral",
      "card-select-option-Ollama",
      "card-select-option-OpenAICompatible",
    ]);
    expect(
      within(dialog).getByTestId("card-select-option-Ollama"),
    ).toHaveTextContent(
      text(GERMAN, "Open models you run yourself. No API key."),
    );
  });

  test("folds the description, Additional Parameters and the cost at the end of Connection, and creates a free global provider", async () => {
    billingEnabledForTest = true;

    const dialog: HTMLElement = await openDialog(FormType.Create);

    await pickProvider(dialog, "OpenAI");

    expect(label(dialog, "API Key")).toBeVisible();
    expect(label(dialog, "Base URL")).toBeVisible();
    expect(label(dialog, "Model Name")).toBeVisible();

    // Named after the provider until a name of one's own is typed.
    const name: HTMLInputElement = within(dialog).getByPlaceholderText(
      "e.g. Production OpenAI",
    ) as HTMLInputElement;

    expect(name.value).toBe("OpenAI");

    const header: HTMLElement = advancedHeader(dialog, "More fields");

    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(label(dialog, "Description")).not.toBeVisible();
    expect(label(dialog, "Additional Parameters")).not.toBeVisible();
    expect(
      label(dialog, "Cost Per Million Tokens (USD Cents)"),
    ).not.toBeVisible();
    // A free provider, the default, is nothing to call out.
    expect(setChips(header)).toEqual([]);
    // A global provider is never a project's default.
    expect(within(dialog).queryByText("Set as Default")).toBeNull();

    fireEvent.click(header);

    expect(label(dialog, "Description")).toBeVisible();
    expect(label(dialog, "Additional Parameters")).toBeVisible();
    expect(label(dialog, "Cost Per Million Tokens (USD Cents)")).toBeVisible();

    fireEvent.change(name, { target: { value: "Shared GPT" } });
    fireEvent.change(within(dialog).getByTestId("llm-provider-api-key"), {
      target: { value: "sk-shared" },
    });
    await settle();

    fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));

    await waitFor(
      () => {
        expect(mockAdminCreateOrUpdate).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    const saved: Record<string, unknown> = savedValues(mockAdminCreateOrUpdate);

    expect(saved["name"]).toBe("Shared GPT");
    expect(saved["llmType"]).toBe("OpenAI");
    expect(saved["apiKey"]).toBe("sk-shared");
    expect(saved["isGlobalLlm"]).toBe(true);
    expect(Number(saved["costPerMillionTokensInUSDCents"] || 0)).toBe(0);
  });

  test("has no cost to fold where projects are not billed for AI", async () => {
    billingEnabledForTest = false;

    const dialog: HTMLElement = await openDialog(FormType.Create);

    await waitForSteps(dialog);

    expect(stepTitles(dialog)).toHaveLength(2);

    await pickProvider(dialog, "Ollama");

    // Ollama reads no API key, so none is asked for.
    expect(within(dialog).queryByTestId("llm-provider-api-key")).toBeNull();

    fireEvent.click(advancedHeader(dialog, "More fields"));

    expect(label(dialog, "Additional Parameters")).toBeVisible();
    expect(
      within(dialog).queryByText("Cost Per Million Tokens (USD Cents)"),
    ).toBeNull();
  });

  test.each([
    [0, false],
    [150, true],
  ])(
    "on Edit, a provider costing %d cents per million tokens says Configured: %s",
    async (cost: number, configured: boolean) => {
      billingEnabledForTest = true;
      stored[new LlmProvider().tableName || ""] = {
        name: "Shared GPT",
        llmType: "OpenAI",
        isGlobalLlm: true,
        costPerMillionTokensInUSDCents: cost,
      };

      const dialog: HTMLElement = await openDialog(FormType.Update);

      await waitForSteps(dialog);
      await settle();

      // Saves from any step: the folded section is on the second.
      fireEvent.click(within(dialog).getByTestId("modal-footer-next-button"));
      await settle();

      await waitFor(
        () => {
          expect(label(dialog, "Name")).toBeVisible();
        },
        { timeout: WAIT_FOR_TIMEOUT },
      );

      const header: HTMLElement = advancedHeader(dialog, "More fields");

      expect(header).toHaveAttribute("aria-expanded", "false");

      if (configured) {
        expect(hasSetChip(header)).toBe(true);
      } else {
        expect(setChips(header)).toEqual([]);
      }
    },
  );
});
