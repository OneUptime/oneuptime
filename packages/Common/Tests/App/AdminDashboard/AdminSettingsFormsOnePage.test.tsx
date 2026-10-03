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
 *   - Settings > Global LLM Providers: Basic Info, then Provider Settings,
 *     with Additional Parameters and (where projects are billed for AI) the
 *     cost per million tokens folded at its end - no Advanced step and no
 *     Cost step - and a free provider's Edit form not calling its 0 cost
 *     "Configured".
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
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ObjectID from "../../../Types/ObjectID";
import { FormType, ModelField } from "../../../UI/Components/Forms/ModelForm";
import { FormStep } from "../../../UI/Components/Forms/Types/FormStep";
import ModelFormModal from "../../../UI/Components/ModelFormModal/ModelFormModal";
import UserUtil from "../../../UI/Utils/User";

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

// The open label of a field: its title, then " (Optional)" when it is.
function label(dialog: HTMLElement, title: string): HTMLElement {
  return within(dialog).getByText(title);
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
    expect(label(dialog, "Primary Twilio Phone Number")).toBeVisible();

    // Folded: the header shows, the field does not, until it is opened.
    const header: HTMLElement = advancedHeader(dialog, "Advanced");

    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(label(dialog, "Secondary Twilio Phone Numbers")).not.toBeVisible();
    // Nothing set in it, so nothing to call out.
    expect(within(header).queryByText("Configured")).toBeNull();

    fireEvent.click(header);

    expect(label(dialog, "Secondary Twilio Phone Numbers")).toBeVisible();
    // Optional now: an installation with one number has nothing to add.
    expect(label(dialog, "Secondary Twilio Phone Numbers")).toHaveTextContent(
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

  test("says Advanced is configured when extra numbers are saved, in the reader's language", async () => {
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
      text(GERMAN, "Advanced"),
    );

    expect(text(GERMAN, "Advanced")).toBe("Erweitert");
    expect(text(GERMAN, "Configured")).toBe("Konfiguriert");
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(within(header).getByText("Konfiguriert")).toBeVisible();
    expect(
      label(dialog, text(GERMAN, "Secondary Twilio Phone Numbers")),
    ).not.toBeVisible();
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

    const header: HTMLElement = advancedHeader(dialog, "Advanced");

    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(within(header).queryByText("Configured")).toBeNull();

    for (const title of FOLDED) {
      expect(label(dialog, title)).not.toBeVisible();
    }

    fireEvent.click(header);

    for (const title of FOLDED) {
      expect(label(dialog, title)).toBeVisible();
      expect(label(dialog, title)).toHaveTextContent("(Optional)");
    }
  });

  test("says Advanced is configured once the webhook is set up", async () => {
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

    expect(
      within(advancedHeader(dialog, "Advanced")).getByText("Configured"),
    ).toBeVisible();
  });

  test("the setup guide says the webhook settings are under Advanced", async () => {
    await renderWithLocale(<WhatsAppSettings />);

    const guide: string = screen.getByTestId("setup-guide").textContent || "";

    expect(guide).toContain(
      "Paste the access token and phone number ID into the **Meta WhatsApp Settings** card above, then save. The Business Account ID, App ID and App Secret from the next steps go under **Advanced** in the same form.",
    );
    expect(guide).toContain(
      "open **Settings → WhatsApp → Meta WhatsApp Settings**, expand **Advanced** and enter a strong value in **Webhook Verify Token**",
    );
    expect(guide).toContain("Save the **App Secret** under **Advanced**");
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

  test("walks Basic Info, then Provider Settings - no Advanced step and no Cost step", async () => {
    billingEnabledForTest = true;

    const dialog: HTMLElement = await openDialog(FormType.Create);

    await waitFor(
      () => {
        expect(
          within(dialog).getByRole("navigation", { name: "Progress" }),
        ).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    const titles: Array<string> = stepTitles(dialog);

    expect(titles).toHaveLength(2);
    expect(titles[0]).toContain("Basic Info");
    expect(titles[1]).toContain("Provider Settings");
    expect(titles.join(" ")).not.toMatch(/Advanced|Cost/);
  });

  test("names its two steps in the reader's language", async () => {
    const dialog: HTMLElement = await openDialog(FormType.Create, "de");

    await waitFor(
      () => {
        expect(
          within(dialog).getByRole("navigation", { name: "Progress" }),
        ).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    const titles: Array<string> = stepTitles(dialog);

    expect(titles).toHaveLength(2);
    expect(titles[0]).toContain(
      text(GERMAN, "pages.settings.llmProviders.stepBasicInfo"),
    );
    expect(titles[1]).toContain(
      text(GERMAN, "pages.settings.llmProviders.stepProviderSettings"),
    );
  });

  test("folds Additional Parameters and the cost at the end of Provider Settings, and creates a free global provider", async () => {
    billingEnabledForTest = true;

    const dialog: HTMLElement = await openDialog(FormType.Create);

    await waitFor(
      () => {
        expect(label(dialog, "Name")).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
    await settle();

    fireEvent.change(within(dialog).getByPlaceholderText("My OpenAI GPT-4"), {
      target: { value: "Shared GPT" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Next" }));
    await settle();

    await waitFor(
      () => {
        expect(label(dialog, "LLM Provider")).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    expect(label(dialog, "API Key")).toBeVisible();
    expect(label(dialog, "Model Name")).toBeVisible();
    expect(label(dialog, "Base URL")).toBeVisible();

    const header: HTMLElement = advancedHeader(dialog, "Advanced");

    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(label(dialog, "Additional Parameters")).not.toBeVisible();
    expect(
      label(dialog, "Cost Per Million Tokens (USD Cents)"),
    ).not.toBeVisible();
    // A free provider, the default, is nothing to call out.
    expect(within(header).queryByText("Configured")).toBeNull();

    fireEvent.click(header);

    expect(label(dialog, "Additional Parameters")).toBeVisible();
    expect(label(dialog, "Cost Per Million Tokens (USD Cents)")).toBeVisible();

    const pickProvider: HTMLElement = within(dialog).getAllByRole("button", {
      name: /^Pick /,
    })[0]!;

    fireEvent.click(pickProvider);
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
    expect(saved["isGlobalLlm"]).toBe(true);
    expect(Number(saved["costPerMillionTokensInUSDCents"] || 0)).toBe(0);
  });

  test("has no cost to fold where projects are not billed for AI", async () => {
    billingEnabledForTest = false;

    const dialog: HTMLElement = await openDialog(FormType.Create);

    await waitFor(
      () => {
        expect(label(dialog, "Name")).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
    await settle();

    expect(stepTitles(dialog)).toHaveLength(2);

    fireEvent.change(within(dialog).getByPlaceholderText("My OpenAI GPT-4"), {
      target: { value: "Local Llama" },
    });
    fireEvent.click(within(dialog).getByRole("button", { name: "Next" }));
    await settle();

    await waitFor(
      () => {
        expect(label(dialog, "LLM Provider")).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    fireEvent.click(advancedHeader(dialog, "Advanced"));

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

      await waitFor(
        () => {
          expect(label(dialog, "Name")).toBeVisible();
        },
        { timeout: WAIT_FOR_TIMEOUT },
      );
      await settle();

      // Saves from any step: the folded section is on the second.
      fireEvent.click(within(dialog).getByTestId("modal-footer-next-button"));
      await settle();

      await waitFor(
        () => {
          expect(label(dialog, "LLM Provider")).toBeVisible();
        },
        { timeout: WAIT_FOR_TIMEOUT },
      );

      const header: HTMLElement = advancedHeader(dialog, "Advanced");

      expect(header).toHaveAttribute("aria-expanded", "false");

      if (configured) {
        expect(within(header).getByText("Configured")).toBeVisible();
      } else {
        expect(within(header).queryByText("Configured")).toBeNull();
      }
    },
  );
});
