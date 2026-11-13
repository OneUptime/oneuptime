import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
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
 * ADMIN DASHBOARD > SETTINGS > CALL AND SMS, WHEN ENVIRONMENT VARIABLES SET
 * THE SERVER'S TWILIO ACCOUNT (#7515) - on the real page, cards and Detail,
 * in the Admin Dashboard's own English; only the network, the page chrome
 * and the side menu are stand-ins.
 *
 * Once GLOBAL_TWILIO_ACCOUNT_SID is set, the page shows the account the
 * variables set in place of the saved one: each field with the variable
 * that sets it, whether there is an auth token (never the token), what is
 * wrong with them, and no Edit button - the server refuses the write.
 * Variables set without it are read by nothing: the saved account stays,
 * editable, under a warning that names them. A server that cannot say keeps
 * the page as it was.
 */

jest.setTimeout(60000);

const mockGetItem: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return mockGetItem(...args);
      },
      createOrUpdate: async (): Promise<unknown> => {
        return { data: {} };
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

import AdminI18n from "../../../../App/FeatureSet/AdminDashboard/src/Utils/i18n";
import CallSmsSettings from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/CallSMS/Index";
import {
  SERVER_TWILIO_ENVIRONMENT_CARD_TEST_ID,
  SERVER_TWILIO_ENVIRONMENT_LOADING_TEST_ID,
  SERVER_TWILIO_ENVIRONMENT_UNUSED_TEST_ID,
} from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/CallSMS/ServerTwilioEnvironmentCard";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPMethod from "../../../Types/API/HTTPMethod";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import URL from "../../../Types/API/URL";
import ServerTwilioEnvironment, {
  SERVER_TWILIO_ENVIRONMENT_ROUTE,
  ServerTwilioEnvironmentAnswer,
  ServerTwilioEnvironmentVariable,
} from "../../../Types/CallAndSMS/ServerTwilioEnvironment";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { APP_API_URL } from "../../../UI/Config";
import API from "../../../UI/Utils/API/API";
import UserUtil from "../../../UI/Utils/User";
import { withoutIsolates } from "../../../UI/Utils/CodeReadsAsWritten";
import {
  DrawnLine,
  drawLine,
  getDrawnText,
  isDrawnAsWritten,
} from "../../Helpers/BidiLayout";

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

const ENGLISH: Locale = JSON.parse(
  fs.readFileSync(path.join(LOCALES_DIR, "en.json"), "utf8"),
) as Locale;

const CALL_SMS: Record<string, string> = (
  (ENGLISH["pages"] as Locale)["settings"] as Locale
)["callSms"] as Record<string, string>;

// The saved account's Edit button, which the variables' account never has.
const EDIT_BUTTON: string = CALL_SMS["editButton"] as string;

const ENV_SID: string = "AC22222222222222222222222222222222";
const SAVED_SID: string = "AC11111111111111111111111111111111";
const TOKEN: string = "environment-auth-token-sentinel-7515";

// The Twilio account an admin saved, which the page reads for its own card.
const SAVED: Record<string, unknown> = {
  twilioAccountSID: SAVED_SID,
  twilioPrimaryPhoneNumber: "+15550001111",
};

// What GET /global-config/twilio-environment answers, per test.
let environmentAnswer: () => Promise<
  HTTPResponse<JSONObject> | HTTPErrorResponse
>;
let fetchSpy: jest.SpyInstance;

interface ItemCall {
  modelType: { new (): BaseModel };
  id: ObjectID;
  select: Record<string, unknown>;
}

async function answerGetItem(options: unknown): Promise<unknown> {
  const call: ItemCall = options as ItemCall;
  const item: BaseModel = new call.modelType();

  (item as unknown as Record<string, unknown>)["_id"] = call.id.toString();
  Object.assign(item, SAVED);

  return item;
}

// The answer the server gives for these variables, as it sends it.
function answerFor(
  values: Partial<Record<ServerTwilioEnvironmentVariable, string>>,
): () => Promise<HTTPResponse<JSONObject>> {
  const answer: ServerTwilioEnvironmentAnswer =
    ServerTwilioEnvironment.toAnswer(ServerTwilioEnvironment.read(values));

  return async (): Promise<HTTPResponse<JSONObject>> => {
    return new HTTPResponse<JSONObject>(
      200,
      JSON.parse(JSON.stringify(answer)) as JSONObject,
      {},
    );
  };
}

function environmentAccount(
  values: Partial<Record<ServerTwilioEnvironmentVariable, string>> = {},
): Partial<Record<ServerTwilioEnvironmentVariable, string>> {
  return {
    [ServerTwilioEnvironmentVariable.AccountSid]: ENV_SID,
    [ServerTwilioEnvironmentVariable.AuthToken]: TOKEN,
    [ServerTwilioEnvironmentVariable.PrimaryPhoneNumber]: "+14155550100",
    ...values,
  };
}

async function settle(): Promise<void> {
  for (let index: number = 0; index < 20; index++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderPage(): Promise<void> {
  const instance: i18n = createInstance();

  await instance.init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: ENGLISH } },
    interpolation: { escapeValue: false },
  });

  render(
    <I18nextProvider i18n={instance}>
      <CallSmsSettings />
    </I18nextProvider>,
  );

  await settle();
}

async function environmentCard(): Promise<HTMLElement> {
  await waitFor(
    () => {
      expect(
        screen.getByTestId(SERVER_TWILIO_ENVIRONMENT_CARD_TEST_ID),
      ).toBeVisible();
    },
    { timeout: WAIT_FOR_TIMEOUT },
  );

  return screen.getByTestId(SERVER_TWILIO_ENVIRONMENT_CARD_TEST_ID);
}

// The value a Detail field shows, found by its title.
function fieldValue(card: HTMLElement, title: string): string {
  const label: HTMLElement = within(card).getByText(title);
  const field: HTMLElement | null = label.closest("[id]")
    ? (label.closest("[id]") as HTMLElement)
    : label.parentElement;

  return (field?.parentElement?.textContent || "").trim();
}

async function savedCardEditButton(): Promise<HTMLElement> {
  let button: HTMLElement | null = null;

  await waitFor(
    () => {
      button = screen.getByRole("button", { name: EDIT_BUTTON });
      expect(button).toBeVisible();
    },
    { timeout: WAIT_FOR_TIMEOUT },
  );

  return button as unknown as HTMLElement;
}

beforeEach(() => {
  mockGetItem.mockReset();
  mockGetItem.mockImplementation(answerGetItem);

  // Everyone in the admin dashboard is a master admin.
  getJestSpyOn(UserUtil, "isMasterAdmin").mockReturnValue(true);

  environmentAnswer = answerFor({});

  fetchSpy = getJestSpyOn(API, "fetch").mockImplementation(
    async (options: unknown): Promise<unknown> => {
      const url: string = String((options as { url: URL }).url);

      if (url.endsWith(SERVER_TWILIO_ENVIRONMENT_ROUTE)) {
        return environmentAnswer();
      }

      // Everything else the page asks - the setup checklist - is not answered.
      return new HTTPErrorResponse(500, { message: "Not in this test." }, {});
    },
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("set by environment variables", () => {
  test("asks the server once, with a GET to its route", async () => {
    environmentAnswer = answerFor(environmentAccount());

    await renderPage();
    await environmentCard();

    const calls: Array<unknown> = fetchSpy.mock.calls
      .map((call: Array<unknown>): unknown => {
        return call[0];
      })
      .filter((options: unknown): boolean => {
        return String((options as { url: URL }).url).endsWith(
          SERVER_TWILIO_ENVIRONMENT_ROUTE,
        );
      });

    expect(calls).toHaveLength(1);
    expect((calls[0] as { method: HTTPMethod }).method).toBe(HTTPMethod.GET);
    expect(String((calls[0] as { url: URL }).url)).toBe(
      URL.fromURL(APP_API_URL).toString().replace(/\/$/, "") +
        SERVER_TWILIO_ENVIRONMENT_ROUTE,
    );
  });

  test("shows the variables' account in place of the saved one, each field with its variable, and no Edit button", async () => {
    environmentAnswer = answerFor(
      environmentAccount({
        [ServerTwilioEnvironmentVariable.SmsPhoneNumbers]: "+6581234567",
      }),
    );

    await renderPage();

    const card: HTMLElement = await environmentCard();

    expect(within(card).getByText(CALL_SMS["cardTitle"]!)).toBeVisible();
    expect(
      within(card).getByText(CALL_SMS["environmentCardDescription"]!),
    ).toBeVisible();
    expect(within(card).getByText(ENV_SID)).toBeVisible();
    expect(within(card).getByText("Calls and SMS")).toBeVisible();
    expect(within(card).getByText(CALL_SMS["authTokenSet"]!)).toBeVisible();

    // Each field names the variable that sets it.
    for (const variable of [
      "GLOBAL_TWILIO_USED_FOR",
      "GLOBAL_TWILIO_ACCOUNT_SID",
      "GLOBAL_TWILIO_AUTH_TOKEN",
      "GLOBAL_TWILIO_PRIMARY_PHONE_NUMBER",
      "GLOBAL_TWILIO_SMS_PHONE_NUMBERS",
      "GLOBAL_TWILIO_SECONDARY_PHONE_NUMBERS",
    ]) {
      expect(within(card).getByText(variable)).toBeVisible();
    }

    // Nothing to edit here, and the saved account is not shown at all.
    expect(within(card).queryAllByRole("button")).toEqual([]);
    expect(screen.queryByRole("button", { name: EDIT_BUTTON })).toBeNull();
    expect(screen.queryByText(SAVED_SID)).toBeNull();
    expect(
      screen.queryByText(CALL_SMS["cardDescription"]!),
    ).not.toBeInTheDocument();
    // Never the token: the server does not send it, and nothing draws it.
    expect(document.body.textContent).not.toContain(TOKEN);
    // Nothing to warn about.
    expect(
      within(card).queryByText(CALL_SMS["environmentProblemsTitle"]!),
    ).toBeNull();
  });

  test("used for SMS only: the SMS numbers, and no numbers to make calls from", async () => {
    environmentAnswer = answerFor(
      environmentAccount({
        [ServerTwilioEnvironmentVariable.UsedFor]: "sms-only",
        [ServerTwilioEnvironmentVariable.PrimaryPhoneNumber]: "",
        [ServerTwilioEnvironmentVariable.SmsPhoneNumbers]: "+6581234567",
      }),
    );

    await renderPage();

    const card: HTMLElement = await environmentCard();

    expect(within(card).getByText("SMS only")).toBeVisible();
    expect(
      within(card).getByText("GLOBAL_TWILIO_SMS_PHONE_NUMBERS"),
    ).toBeVisible();
    expect(
      within(card).queryByText("GLOBAL_TWILIO_PRIMARY_PHONE_NUMBER"),
    ).toBeNull();
    expect(
      within(card).queryByText("GLOBAL_TWILIO_SECONDARY_PHONE_NUMBERS"),
    ).toBeNull();
  });

  test("with something wrong: that it sends nothing until it is fixed, and each problem, by the variable's name", async () => {
    environmentAnswer = answerFor(
      environmentAccount({
        [ServerTwilioEnvironmentVariable.AuthToken]: "",
        [ServerTwilioEnvironmentVariable.PrimaryPhoneNumber]: "call me",
      }),
    );

    await renderPage();

    const card: HTMLElement = await environmentCard();

    expect(
      within(card).getByText(CALL_SMS["environmentProblemsTitle"]!),
    ).toBeVisible();
    expect(
      within(card).getByText(
        "GLOBAL_TWILIO_AUTH_TOKEN is not set: Twilio refuses the account without its auth token.",
      ),
    ).toBeVisible();
    expect(
      within(card).getByText(
        'GLOBAL_TWILIO_PRIMARY_PHONE_NUMBER: "call me" is not a phone number. Write it with its country code, like +14155550100.',
      ),
    ).toBeVisible();
    expect(within(card).getByText(CALL_SMS["authTokenNotSet"]!)).toBeVisible();
    /*
     * English, by the variables' names: isolated, so in Persian or Arabic
     * each line still reads left to right, its full stop at its end (#7804).
     */
    for (const problem of [
      "GLOBAL_TWILIO_AUTH_TOKEN is not set: Twilio refuses the account without its auth token.",
      'GLOBAL_TWILIO_PRIMARY_PHONE_NUMBER: "call me" is not a phone number. Write it with its country code, like +14155550100.',
    ]) {
      expect(within(card).getByText(problem).tagName).toBe("BDI");
    }
    // Still no Edit button: the account is fixed where the variables are set.
    expect(screen.queryByRole("button", { name: EDIT_BUTTON })).toBeNull();
  });
});

describe("not set by environment variables", () => {
  test("the saved account and its Edit button, with nothing to warn about", async () => {
    environmentAnswer = answerFor({});

    await renderPage();

    expect(await savedCardEditButton()).toBeEnabled();
    expect(
      screen.queryByTestId(SERVER_TWILIO_ENVIRONMENT_CARD_TEST_ID),
    ).toBeNull();
    expect(
      screen.queryByTestId(SERVER_TWILIO_ENVIRONMENT_UNUSED_TEST_ID),
    ).toBeNull();
    expect(screen.getByText(CALL_SMS["cardDescription"]!)).toBeVisible();
  });

  test("variables set without the account SID: the saved account stays editable, under a warning that names them", async () => {
    environmentAnswer = answerFor({
      [ServerTwilioEnvironmentVariable.AuthToken]: TOKEN,
      [ServerTwilioEnvironmentVariable.PrimaryPhoneNumber]: "+14155550100",
    });

    await renderPage();

    expect(await savedCardEditButton()).toBeEnabled();

    const warning: HTMLElement = screen.getByTestId(
      SERVER_TWILIO_ENVIRONMENT_UNUSED_TEST_ID,
    );

    expect(
      within(warning).getByText(CALL_SMS["environmentUnusedTitle"]!),
    ).toBeVisible();
    const line: HTMLElement = within(warning).getByText(
      "GLOBAL_TWILIO_AUTH_TOKEN and GLOBAL_TWILIO_PRIMARY_PHONE_NUMBER are set, but GLOBAL_TWILIO_ACCOUNT_SID is not, so nothing reads them: the Twilio account saved in the Admin Dashboard is used. Set GLOBAL_TWILIO_ACCOUNT_SID too, or remove them.",
    );

    expect(line).toBeVisible();
    // The server's English line keeps its own direction in Persian or Arabic.
    expect(line.tagName).toBe("BDI");
    expect(document.body.textContent).not.toContain(TOKEN);
  });

  test.each([
    [
      "answers with an error",
      async (): Promise<HTTPErrorResponse> => {
        return new HTTPErrorResponse(500, { message: "Server error" }, {});
      },
    ],
    [
      "cannot be reached",
      async (): Promise<never> => {
        throw new Error("Network error");
      },
    ],
  ] as Array<[string, () => Promise<HTTPErrorResponse>]>)(
    "a server that %s: the page as it was, the saved account and its Edit button",
    async (_case: string, answer: () => Promise<HTTPErrorResponse>) => {
      environmentAnswer = answer;

      await renderPage();

      expect(await savedCardEditButton()).toBeEnabled();
      expect(
        screen.queryByTestId(SERVER_TWILIO_ENVIRONMENT_CARD_TEST_ID),
      ).toBeNull();
      expect(
        screen.queryByTestId(SERVER_TWILIO_ENVIRONMENT_UNUSED_TEST_ID),
      ).toBeNull();
    },
  );

  test("until the server says, neither account and no Edit button: the card's title over a loader", async () => {
    environmentAnswer = (): Promise<never> => {
      return new Promise<never>(() => {
        // Never answers.
      });
    };

    await renderPage();

    const loading: HTMLElement = screen.getByTestId(
      SERVER_TWILIO_ENVIRONMENT_LOADING_TEST_ID,
    );

    expect(within(loading).getByText(CALL_SMS["cardTitle"]!)).toBeVisible();
    expect(screen.queryByRole("button", { name: EDIT_BUTTON })).toBeNull();
    expect(
      screen.queryByTestId(SERVER_TWILIO_ENVIRONMENT_CARD_TEST_ID),
    ).toBeNull();
  });
});

describe("the field values", () => {
  test("the auth token reads Set or Not set, never a value", async () => {
    environmentAnswer = answerFor(environmentAccount());

    await renderPage();

    const card: HTMLElement = await environmentCard();

    expect(fieldValue(card, "Twilio Auth Token")).toContain(
      CALL_SMS["authTokenSet"],
    );
    expect(fieldValue(card, "Twilio Auth Token")).not.toContain(TOKEN);
  });

  /*
   * A value as written in its variable keeps its own direction in a
   * right-to-left page (#7804): Detail isolates the SID, a text value
   * (IsolatedText). A word for a value is the page's own, and reads in the
   * page's direction - a <bdi> would turn a translated phrase around.
   */
  test("the account SID as written is isolated; Used For and the token's Set are the page's words", async () => {
    environmentAnswer = answerFor(environmentAccount());

    await renderPage();

    const card: HTMLElement = await environmentCard();

    expect(within(card).getByText(ENV_SID).tagName).toBe("BDI");
    expect(within(card).getByText("Calls and SMS").tagName).not.toBe("BDI");
    expect(within(card).getByText(CALL_SMS["authTokenSet"]!).tagName).not.toBe(
      "BDI",
    );
  });
});

describe("in a right-to-left language", () => {
  /*
   * Between a Latin word and Persian or Arabic text, GLOBAL_TWILIO_'s last
   * underscore takes the line's direction: laid out as the locale file
   * words the description, it is drawn before the word, "_GLOBAL_TWILIO"
   * (#7804). The Admin Dashboard's i18next sets the code of an Arabic or
   * Persian sentence apart as it hands it to the page, and leaves those
   * marks out of what is copied (src/Utils/i18n.ts,
   * Common/UI/Utils/CodeReadsAsWritten). So the locale files put no mark
   * of their own after it: copying keeps such a mark, and the prefix
   * pasted into config.env would hold an invisible character
   * (CodeInRightToLeftSentences).
   */
  const PREFIX: string = "GLOBAL_TWILIO_";

  // The Admin Dashboard's i18next, in a language, as its language menu sets it.
  const readIn: (code: string) => Promise<void> = async (
    code: string,
  ): Promise<void> => {
    await act(async () => {
      await AdminI18n.changeLanguage(code);
    });

    expect(AdminI18n.resolvedLanguage).toBe(code);
  };

  // The card's description as a language's locale file words it.
  const descriptionIn: (language: string) => string = (
    language: string,
  ): string => {
    const locale: Locale = JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
    ) as Locale;

    return (
      ((locale["pages"] as Locale)["settings"] as Locale)["callSms"] as Record<
        string,
        string
      >
    )["environmentCardDescription"]!;
  };

  // What copying an element's text from the page puts on the clipboard.
  const copyFromPage: (element: HTMLElement) => string = (
    element: HTMLElement,
  ): string => {
    const range: Range = document.createRange();

    range.selectNodeContents(element);
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.addRange(range);

    const copied: Record<string, string> = {};
    const event: Event = new Event("copy", { bubbles: true, cancelable: true });

    Object.defineProperty(event, "clipboardData", {
      value: {
        setData: (type: string, data: string): void => {
          copied[type] = data;
        },
      },
    });
    element.dispatchEvent(event);

    // A copy no handler takes is the browser's: the selection as it is.
    return event.defaultPrevented
      ? (copied["text/plain"] as string)
      : (window.getSelection()?.toString() as string);
  };

  afterEach(async () => {
    window.getSelection()?.removeAllRanges();
    await readIn("en");
  });

  test.each(["fa", "ar"])(
    "%s: the card's description draws GLOBAL_TWILIO_ as it is written, and copies it as it is written",
    async (language: string) => {
      environmentAnswer = answerFor(environmentAccount());

      // The page through the Admin Dashboard's own i18next (src/Utils/i18n.ts).
      await readIn(language);
      render(
        <I18nextProvider i18n={AdminI18n}>
          <CallSmsSettings />
        </I18nextProvider>,
      );
      await settle();

      const card: HTMLElement = await environmentCard();
      const written: string = descriptionIn(language);

      expect(written.split(PREFIX).length - 1).toBe(1);

      // The description as the page shows it: the sentence, its code set apart.
      const description: HTMLElement = within(card).getByText(
        (content: string): boolean => {
          return withoutIsolates(content) === written;
        },
      );
      const shown: string = description.textContent as string;
      const line: DrawnLine = drawLine(shown, "rtl");
      const at: number = shown.indexOf(PREFIX);

      expect({
        drawn: getDrawnText(line),
        isDrawnAsWritten: isDrawnAsWritten(line, at, at + PREFIX.length),
      }).toEqual({ drawn: getDrawnText(line), isDrawnAsWritten: true });

      // Copied from the page: the prefix with nothing after it, in the locale file's sentence.
      const copied: string = copyFromPage(description);

      expect(
        copied.split(/\s+/u).filter((word: string): boolean => {
          return word.includes(PREFIX);
        }),
      ).toEqual([PREFIX]);
      expect(copied).toBe(written);

      // The negative control: as the locale file words it, the underscore is drawn first.
      expect(getDrawnText(drawLine(written, "rtl"))).toContain(
        "_GLOBAL_TWILIO",
      );
    },
  );

  // English reads from the left: GLOBAL_TWILIO_ is drawn as written as it is.
  test("English keeps no mark", () => {
    expect(CALL_SMS["environmentCardDescription"]).not.toContain(
      String.fromCharCode(0x200e),
    );
  });
});

/*
 * The variables are server settings, not a record: there is no ID or
 * creation time to put on a line under the fields, so Detail draws none, and
 * the card needs no switch to turn it off (#7775: showRecordLine={false} is
 * the custom fields card's alone, by RecordIdLineGuard).
 */
describe("not a record", () => {
  test("its fields, with no ID or Created line under them", async () => {
    environmentAnswer = answerFor(
      environmentAccount({
        [ServerTwilioEnvironmentVariable.SmsPhoneNumbers]: "+6581234567",
        [ServerTwilioEnvironmentVariable.SecondaryPhoneNumbers]: "+14155550101",
      }),
    );

    await renderPage();

    const card: HTMLElement = await environmentCard();

    // The fields are drawn, down to the last one...
    expect(
      within(card).getByText("GLOBAL_TWILIO_SECONDARY_PHONE_NUMBERS"),
    ).toBeVisible();
    // ...and nothing under them.
    expect(within(card).queryByTestId("detail-record-line")).toBeNull();
    expect(within(card).queryByTestId("detail-id-line")).toBeNull();
    expect(within(card).queryByTestId("detail-created-at")).toBeNull();
  });
});
