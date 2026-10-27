import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
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
 * ADMIN DASHBOARD > SETTINGS > CALL AND SMS: THE "SMS AND CALL PROVIDER"
 * CARD, on the real card, CardModelDetail, ModelFormModal and form, in the
 * Admin Dashboard's own English - only the network, the page chrome and the
 * side menu are stand-ins.
 *
 * What carries the server's SMS and calls is asked first, as two plain
 * answers: Twilio (what every installation sent through) or your own
 * gateway. Only the gateway asks for anything more - its URL, required, and
 * its signing secret, folded under More fields since the server makes it.
 * The card shows the gateway's URL and secret only while the server sends
 * through it. Send Test asks the server to try the gateway as saved and
 * shows what it answered, delivered or not.
 */

jest.setTimeout(60000);

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

import CallAndSmsGatewayCard, {
  CALL_AND_SMS_GATEWAY_CARD_TEST_ID,
  CALL_AND_SMS_GATEWAY_TEST_PATH,
} from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/CallSMS/CallAndSmsGatewayCard";
import CallSmsSettings from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/CallSMS/Index";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { FormType } from "../../../UI/Components/Forms/ModelForm";
import { APP_API_URL } from "../../../UI/Config";
import API from "../../../UI/Utils/API/API";
import UserUtil from "../../../UI/Utils/User";

const WAIT_FOR_TIMEOUT: number = 20000;

const GATEWAY_URL: string = "https://sms-gateway.internal.example.com/hook";
const SECRET: string = "4".repeat(64);
const URL_PLACEHOLDER: string = "https://sms-gateway.example.com/oneuptime";

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

const ENGLISH: Locale = JSON.parse(
  fs.readFileSync(path.join(LOCALES_DIR, "en.json"), "utf8"),
) as Locale;

// What the server holds for the instance.
let stored: Record<string, unknown> = {};
let post: jest.SpyInstance;

interface ItemCall {
  modelType: { new (): BaseModel };
  id: ObjectID;
  select: Record<string, unknown>;
}

async function answerGetItem(options: unknown): Promise<unknown> {
  const call: ItemCall = options as ItemCall;
  const item: BaseModel = new call.modelType();

  (item as unknown as Record<string, unknown>)["_id"] = call.id.toString();
  Object.assign(item, stored);

  return item;
}

interface SaveCall {
  model: BaseModel;
  modelType: { new (): BaseModel };
  formType: FormType;
}

function savedValues(): Record<string, unknown> {
  expect(mockCreateOrUpdate).toHaveBeenCalledTimes(1);

  const call: SaveCall = mockCreateOrUpdate.mock.calls[0]![0] as SaveCall;

  expect(call.formType).toBe(FormType.Update);
  expect(call.modelType).toBe(GlobalConfig);

  return call.model as unknown as Record<string, unknown>;
}

async function settle(): Promise<void> {
  for (let index: number = 0; index < 20; index++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderElement(element: ReactElement): Promise<void> {
  const instance: i18n = createInstance();

  await instance.init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: ENGLISH } },
    interpolation: { escapeValue: false },
  });

  render(<I18nextProvider i18n={instance}>{element}</I18nextProvider>);

  await settle();
}

async function card(): Promise<HTMLElement> {
  await waitFor(
    () => {
      expect(
        within(screen.getByTestId(CALL_AND_SMS_GATEWAY_CARD_TEST_ID)).getByText(
          "SMS and Call Provider",
        ),
      ).toBeVisible();
    },
    { timeout: WAIT_FOR_TIMEOUT },
  );

  return screen.getByTestId(CALL_AND_SMS_GATEWAY_CARD_TEST_ID);
}

// The value the card shows for what carries the server's SMS and calls.
async function waitForProvider(text: string): Promise<void> {
  const element: HTMLElement = await card();

  await waitFor(
    () => {
      expect(within(element).getByText(text)).toBeVisible();
    },
    { timeout: WAIT_FOR_TIMEOUT },
  );
}

async function openEditDialog(): Promise<HTMLElement> {
  const element: HTMLElement = await card();

  await waitFor(
    () => {
      expect(
        within(element).getByRole("button", { name: "Edit Provider" }),
      ).toBeEnabled();
    },
    { timeout: WAIT_FOR_TIMEOUT },
  );

  await act(async () => {
    fireEvent.click(
      within(element).getByRole("button", { name: "Edit Provider" }),
    );
  });

  await waitFor(
    () => {
      expect(screen.getByTestId("modal")).toBeInTheDocument();
    },
    { timeout: WAIT_FOR_TIMEOUT },
  );

  const dialog: HTMLElement = screen.getByTestId("modal");

  await waitFor(
    () => {
      expect(
        within(dialog).getByRole("radio", { name: "Twilio" }),
      ).toBeVisible();
    },
    { timeout: WAIT_FOR_TIMEOUT },
  );
  await settle();

  return dialog;
}

async function choose(dialog: HTMLElement, answer: string): Promise<void> {
  await act(async () => {
    fireEvent.click(within(dialog).getByRole("radio", { name: answer }));
  });
  await settle();
}

async function save(dialog: HTMLElement): Promise<void> {
  await act(async () => {
    fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));
  });
  await settle();
}

async function sendTest(): Promise<HTMLElement> {
  const element: HTMLElement = await card();

  await act(async () => {
    fireEvent.click(within(element).getByRole("button", { name: "Send Test" }));
  });

  await waitFor(
    () => {
      expect(
        screen.getByText("Send test: SMS and call gateway"),
      ).toBeInTheDocument();
    },
    { timeout: WAIT_FOR_TIMEOUT },
  );
  await settle();

  return screen.getByTestId("modal");
}

function answer(data: JSONObject): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, data, {});
}

beforeEach(() => {
  stored = {};

  mockGetItem.mockReset();
  mockGetItem.mockImplementation(answerGetItem);
  mockCreateOrUpdate.mockReset();
  mockCreateOrUpdate.mockImplementation(
    async (request: unknown): Promise<unknown> => {
      return { data: (request as SaveCall).model };
    },
  );

  // Everyone in the admin dashboard is a master admin.
  getJestSpyOn(UserUtil, "isMasterAdmin").mockReturnValue(true);

  post = getJestSpyOn(API, "post").mockResolvedValue(
    answer({
      ok: true,
      responseStatusCode: 200,
      statusMessage: "Sent to the SMS and call gateway (HTTP 200).",
    }),
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the card", () => {
  test("says what it is for, and that projects with their own Twilio config keep it", async () => {
    await renderElement(<CallAndSmsGatewayCard />);

    const element: HTMLElement = await card();

    expect(
      within(element).getByText(
        "What OneUptime sends SMS and calls through: the Twilio account below, or your own gateway. Projects with a Twilio config of their own still send through it.",
      ),
    ).toBeVisible();
    expect(
      within(element).getByRole("button", { name: "Edit Provider" }),
    ).toBeVisible();
    expect(
      within(element).getByRole("button", { name: "Send Test" }),
    ).toBeVisible();
  });

  test("a server that has never chosen sends through Twilio, and shows no gateway", async () => {
    await renderElement(<CallAndSmsGatewayCard />);

    await waitForProvider("Twilio");

    const element: HTMLElement = await card();

    expect(
      within(element).getByText("Send SMS and Calls Through"),
    ).toBeVisible();
    expect(within(element).queryByText("Gateway URL")).toBeNull();
    expect(within(element).queryByText("Signing Secret")).toBeNull();
    expect(within(element).queryByText("Your own gateway")).toBeNull();
  });

  test("a server that sends through Twilio shows no gateway, though it keeps one for next time", async () => {
    stored = {
      callAndSmsProvider: "Twilio",
      callAndSmsGatewayUrl: GATEWAY_URL,
      callAndSmsGatewaySecret: SECRET,
    };

    await renderElement(<CallAndSmsGatewayCard />);

    await waitForProvider("Twilio");

    const element: HTMLElement = await card();

    expect(within(element).queryByText(GATEWAY_URL)).toBeNull();
    expect(within(element).queryByText("Gateway URL")).toBeNull();
  });

  test("a server that sends through its gateway shows the gateway's URL, and its secret hidden", async () => {
    stored = {
      callAndSmsProvider: "Gateway",
      callAndSmsGatewayUrl: GATEWAY_URL,
      callAndSmsGatewaySecret: SECRET,
    };

    await renderElement(<CallAndSmsGatewayCard />);

    await waitForProvider("Your own gateway");

    const element: HTMLElement = await card();

    expect(within(element).getByText("Gateway URL")).toBeVisible();
    expect(within(element).getByText(GATEWAY_URL)).toBeVisible();
    expect(within(element).getByText("Signing Secret")).toBeVisible();
    // The secret is not drawn as text until it is asked for.
    expect(within(element).queryByText(SECRET)).toBeNull();
  });

  test("reads the one settings row, with the columns it shows", async () => {
    await renderElement(<CallAndSmsGatewayCard />);

    await waitForProvider("Twilio");

    const call: ItemCall = mockGetItem.mock.calls[0]![0] as ItemCall;

    expect(call.modelType).toBe(GlobalConfig);
    expect(call.id.toString()).toBe(ObjectID.getZeroObjectID().toString());
    expect(call.select).toEqual(
      expect.objectContaining({
        callAndSmsProvider: true,
        callAndSmsGatewayUrl: true,
        callAndSmsGatewaySecret: true,
      }),
    );
  });

  test("is the first card on Settings > Call and SMS, above the Twilio account", async () => {
    await renderElement(<CallSmsSettings />);

    await waitForProvider("Twilio");

    const page: HTMLElement = screen.getByTestId("admin-page");
    const gatewayCard: HTMLElement = screen.getByTestId(
      CALL_AND_SMS_GATEWAY_CARD_TEST_ID,
    );
    const twilioTitle: string = (
      (ENGLISH["pages"] as Locale)["settings"] as Record<string, Locale>
    )["callSms"]!["cardTitle"] as string;

    await waitFor(
      () => {
        expect(within(page).getByText(twilioTitle)).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    const twilioCard: HTMLElement = within(page).getByText(twilioTitle);

    expect(page.firstElementChild).toBe(gatewayCard);
    expect(
      gatewayCard.compareDocumentPosition(twilioCard) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("Edit Provider", () => {
  test("asks what carries the server's SMS and calls first: two plain answers, Twilio picked where nothing is stored", async () => {
    await renderElement(<CallAndSmsGatewayCard />);

    const dialog: HTMLElement = await openEditDialog();

    expect(within(dialog).getByText("Edit Provider")).toBeVisible();
    expect(within(dialog).getAllByRole("radio")).toHaveLength(2);
    expect(within(dialog).getByRole("radio", { name: "Twilio" })).toBeChecked();
    expect(
      within(dialog).getByRole("radio", { name: "Your own gateway" }),
    ).not.toBeChecked();
    expect(
      within(dialog).getByText(
        "SMS and calls go out through the Twilio account below.",
      ),
    ).toBeVisible();
    expect(
      within(dialog).getByText(
        "OneUptime posts each SMS and call to a URL you run, which sends it through your own provider. Nothing goes through Twilio.",
      ),
    ).toBeVisible();
  });

  test("asks for no URL while Twilio is chosen", async () => {
    await renderElement(<CallAndSmsGatewayCard />);

    const dialog: HTMLElement = await openEditDialog();

    expect(within(dialog).queryByPlaceholderText(URL_PLACEHOLDER)).toBeNull();
    expect(within(dialog).queryByText("Gateway URL")).toBeNull();
    expect(within(dialog).queryByText(/More fields/)).toBeNull();
  });

  test("choosing your own gateway asks for its URL, and keeps the secret folded under More fields", async () => {
    await renderElement(<CallAndSmsGatewayCard />);

    const dialog: HTMLElement = await openEditDialog();

    await choose(dialog, "Your own gateway");

    expect(within(dialog).getByPlaceholderText(URL_PLACEHOLDER)).toBeVisible();
    expect(
      within(dialog).getByText(
        "OneUptime posts each SMS and call here as a signed JSON request. It can be on your private network.",
      ),
    ).toBeVisible();

    const header: HTMLElement = within(dialog).getByRole("button", {
      name: /More fields/,
    });

    expect(header).toHaveAttribute("aria-expanded", "false");

    await act(async () => {
      fireEvent.click(header);
    });
    await settle();

    expect(header).toHaveAttribute("aria-expanded", "true");
    expect(
      within(dialog).getByText(
        "Made for you when you save. Your gateway checks the X-OneUptime-Signature header of every request with it. Clear it and save to make a new one.",
      ),
    ).toBeVisible();
  });

  test("going back to Twilio hides the URL again", async () => {
    await renderElement(<CallAndSmsGatewayCard />);

    const dialog: HTMLElement = await openEditDialog();

    await choose(dialog, "Your own gateway");
    expect(within(dialog).getByPlaceholderText(URL_PLACEHOLDER)).toBeVisible();

    await choose(dialog, "Twilio");
    expect(within(dialog).queryByPlaceholderText(URL_PLACEHOLDER)).toBeNull();
  });

  test("the gateway's URL is required: nothing is saved without it", async () => {
    await renderElement(<CallAndSmsGatewayCard />);

    const dialog: HTMLElement = await openEditDialog();

    await choose(dialog, "Your own gateway");
    await save(dialog);

    expect(mockCreateOrUpdate).not.toHaveBeenCalled();
    expect(within(dialog).getByPlaceholderText(URL_PLACEHOLDER)).toBeVisible();
  });

  test("saves the gateway and its URL, and leaves the secret for the server to make", async () => {
    await renderElement(<CallAndSmsGatewayCard />);

    const dialog: HTMLElement = await openEditDialog();

    await choose(dialog, "Your own gateway");

    await act(async () => {
      fireEvent.change(within(dialog).getByPlaceholderText(URL_PLACEHOLDER), {
        target: { value: GATEWAY_URL },
      });
    });
    await settle();

    await save(dialog);

    await waitFor(
      () => {
        expect(mockCreateOrUpdate).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    const saved: Record<string, unknown> = savedValues();

    expect(saved["callAndSmsProvider"]).toBe("Gateway");
    expect(String(saved["callAndSmsGatewayUrl"])).toBe(GATEWAY_URL);
    expect(saved["callAndSmsGatewaySecret"] || null).toBeNull();
  });

  test("a server that sends through its gateway opens on it, with its URL filled in", async () => {
    stored = {
      callAndSmsProvider: "Gateway",
      callAndSmsGatewayUrl: GATEWAY_URL,
      callAndSmsGatewaySecret: SECRET,
    };

    await renderElement(<CallAndSmsGatewayCard />);

    const dialog: HTMLElement = await openEditDialog();

    expect(
      within(dialog).getByRole("radio", { name: "Your own gateway" }),
    ).toBeChecked();
    expect(within(dialog).getByPlaceholderText(URL_PLACEHOLDER)).toHaveValue(
      GATEWAY_URL,
    );
  });

  test("going back to Twilio saves Twilio", async () => {
    stored = {
      callAndSmsProvider: "Gateway",
      callAndSmsGatewayUrl: GATEWAY_URL,
      callAndSmsGatewaySecret: SECRET,
    };

    await renderElement(<CallAndSmsGatewayCard />);

    const dialog: HTMLElement = await openEditDialog();

    await choose(dialog, "Twilio");
    await save(dialog);

    await waitFor(
      () => {
        expect(mockCreateOrUpdate).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    expect(savedValues()["callAndSmsProvider"]).toBe("Twilio");
  });
});

describe("Send Test", () => {
  test("asks the server to try the gateway as saved, and shows what it answered", async () => {
    await renderElement(<CallAndSmsGatewayCard />);

    const dialog: HTMLElement = await sendTest();

    expect(post).toHaveBeenCalledTimes(1);

    const request: { url: URL; data: JSONObject } = post.mock.calls[0]![0] as {
      url: URL;
      data: JSONObject;
    };

    expect(CALL_AND_SMS_GATEWAY_TEST_PATH).toBe(
      "/global-config/call-and-sms-gateway/test",
    );
    expect(request.url.toString()).toBe(
      URL.fromString(APP_API_URL.toString())
        .addRoute(CALL_AND_SMS_GATEWAY_TEST_PATH)
        .toString(),
    );
    expect(request.url.toString()).toContain(
      "/global-config/call-and-sms-gateway/test",
    );
    expect(request.data).toEqual({});

    await waitFor(
      () => {
        expect(
          within(dialog).getByTestId("confirm-modal-description"),
        ).toHaveTextContent("Sent to the SMS and call gateway (HTTP 200).");
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
    expect(within(dialog).queryByTestId("modal-error")).toBeNull();
  });

  test("a test the gateway refused is shown as the error, in the server's words", async () => {
    post.mockResolvedValue(
      answer({
        ok: false,
        responseStatusCode: 401,
        statusMessage:
          "Not delivered: the SMS and call gateway answered HTTP 401.",
      }),
    );

    await renderElement(<CallAndSmsGatewayCard />);

    const dialog: HTMLElement = await sendTest();

    await waitFor(
      () => {
        expect(within(dialog).getByTestId("modal-error")).toHaveTextContent(
          "Not delivered: the SMS and call gateway answered HTTP 401.",
        );
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
    expect(
      within(dialog).queryByText(
        "Sent to the SMS and call gateway (HTTP 200).",
      ),
    ).toBeNull();
  });

  test("a server that sends through Twilio says so", async () => {
    post.mockResolvedValue(
      answer({
        ok: false,
        responseStatusCode: null,
        statusMessage:
          "Not sent: this server sends SMS and calls through Twilio. Choose your own gateway, add its Gateway URL and save, then send a test.",
      }),
    );

    await renderElement(<CallAndSmsGatewayCard />);

    const dialog: HTMLElement = await sendTest();

    await waitFor(
      () => {
        expect(
          within(dialog).getByText(
            "Not sent: this server sends SMS and calls through Twilio. Choose your own gateway, add its Gateway URL and save, then send a test.",
          ),
        ).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
  });

  test("a request the server refused is shown as its message", async () => {
    post.mockResolvedValue(
      new HTTPErrorResponse(
        403,
        {
          message: "Unauthorized: Only master admins can perform this action.",
        },
        {},
      ),
    );

    await renderElement(<CallAndSmsGatewayCard />);

    const dialog: HTMLElement = await sendTest();

    await waitFor(
      () => {
        expect(
          within(dialog).getByText(
            "Unauthorized: Only master admins can perform this action.",
          ),
        ).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
  });

  test("a request that could not be made is shown as an error", async () => {
    post.mockRejectedValue(new Error("Network Error"));

    await renderElement(<CallAndSmsGatewayCard />);

    const dialog: HTMLElement = await sendTest();

    await waitFor(
      () => {
        expect(within(dialog).getByText("Network Error")).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
  });

  test("Close closes it, and the next test starts afresh", async () => {
    await renderElement(<CallAndSmsGatewayCard />);

    const dialog: HTMLElement = await sendTest();

    await waitFor(
      () => {
        expect(
          within(dialog).getByTestId("confirm-modal-description"),
        ).toHaveTextContent("Sent to the SMS and call gateway (HTTP 200).");
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Close" }));
    });
    await settle();

    expect(screen.queryByText("Send test: SMS and call gateway")).toBeNull();

    post.mockResolvedValue(
      answer({
        ok: false,
        responseStatusCode: 500,
        statusMessage:
          "Not delivered: the SMS and call gateway answered HTTP 500 (tried 3 times).",
      }),
    );

    const again: HTMLElement = await sendTest();

    await waitFor(
      () => {
        expect(
          within(again).getByText(
            "Not delivered: the SMS and call gateway answered HTTP 500 (tried 3 times).",
          ),
        ).toBeVisible();
      },
      { timeout: WAIT_FOR_TIMEOUT },
    );
    expect(
      within(again).queryByText("Sent to the SMS and call gateway (HTTP 200)."),
    ).toBeNull();
    expect(post).toHaveBeenCalledTimes(2);
  });
});
