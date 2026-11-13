import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
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
  within,
} from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Phone from "../../../Types/Phone";
import IncomingCallPolicyPhoneNumber from "../../../Models/DatabaseModels/IncomingCallPolicyPhoneNumber";
import PhoneNumberPurchase from "../../../../App/FeatureSet/Dashboard/src/Components/CallSMS/PhoneNumberPurchase";

/*
 * ISSUE #6605: AN INCOMING CALL POLICY'S NUMBERS READ 447700900123+ ON A
 * PERSIAN OR ARABIC PAGE.
 *
 * The policy's Phone Numbers card, the numbers of the Twilio account it
 * offers, and the dialogs that reserve, attach and release a number all
 * printed the number as it is. On a page laid out right to left a number -
 * digits after a "+", with no letter to say which way they read - took the
 * page's way, and its "+" went after its digits. Now a number drawn on the
 * page is an isolate that reads left to right (PhoneNumberText: bdi
 * dir="ltr"), and one in a sentence, which can only be text, is set apart
 * by the marks that say so (LRI ... PDI: phoneNumberInLine). An English
 * page reads exactly as it did.
 *
 * The real PhoneNumberPurchase, in the reader's language (the Dashboard's
 * own locale files); only the network is a stand-in.
 */

jest.setTimeout(60000);

const LRI: string = String.fromCharCode(0x2066);
const PDI: string = String.fromCharCode(0x2069);

const PROJECT_ID: string = "66050000-0000-4000-8000-0000000000a1";
const POLICY_ID: string = "66050000-0000-4000-8000-0000000000b1";
const CONFIG_ID: string = "66050000-0000-4000-8000-0000000000c1";
const ATTACHED_ID: string = "66050000-0000-4000-8000-0000000000d1";

const UK: string = "+447700900123";
const US: string = "+14155550100";
const US_FRIENDLY: string = "(415) 555-0100";

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

const instances: Record<string, i18n> = {};
const locales: Record<string, Record<string, string>> = {};

beforeAll(async () => {
  for (const language of ["en", "fa", "ar"]) {
    locales[language] = readLocale(language);

    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: readLocale("en") },
        [language]: { translation: locales[language]! },
      },
      interpolation: { escapeValue: false },
    });

    instances[language] = instance;
  }
});

let deleteSpy: ReturnType<typeof jest.spyOn>;
let postSpy: ReturnType<typeof jest.spyOn>;
let ownedNumbers: Array<JSONObject>;

beforeEach(() => {
  ownedNumbers = [];
  jest.spyOn(ModelAPI, "getCommonHeaders").mockReturnValue({});
  deleteSpy = jest
    .spyOn(API, "delete")
    .mockResolvedValue(new HTTPResponse(200, {}, {}) as never);
  postSpy = jest
    .spyOn(API, "post")
    .mockImplementation(
      async (data: { url: { toString: () => string } }): Promise<never> => {
        if (data.url.toString().includes("/phone-number/list-owned")) {
          return new HTTPResponse(
            200,
            { ownedNumbers: ownedNumbers },
            {},
          ) as never;
        }

        return new HTTPResponse(200, {}, {}) as never;
      },
    );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  document.documentElement.removeAttribute("dir");
});

// The words of a key in a language, as the page shows them.
function wordsFor(language: string, key: string): string {
  return locales[language]![key] || key;
}

// A sentence of the locale with its number in it, as the page says it.
function sentenceWith(
  language: string,
  template: string,
  phoneNumber: string,
): string {
  return wordsFor(language, template).replace("{{phoneNumber}}", phoneNumber);
}

function attachedNumber(
  phone: string | undefined,
): IncomingCallPolicyPhoneNumber {
  const number: IncomingCallPolicyPhoneNumber =
    new IncomingCallPolicyPhoneNumber();

  number._id = ATTACHED_ID;
  if (phone) {
    number.phoneNumber = new Phone(phone);
  }
  number.countryCode = "GB";

  return number;
}

async function settle(): Promise<void> {
  for (let index: number = 0; index < 8; index++) {
    await act(async (): Promise<void> => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    });
  }
}

async function renderCard(
  language: string,
  phoneNumbers: Array<IncomingCallPolicyPhoneNumber>,
): Promise<void> {
  if (language !== "en") {
    document.documentElement.setAttribute("dir", "rtl");
  }

  render(
    <I18nextProvider i18n={instances[language]!}>
      <MemoryRouter>
        <PhoneNumberPurchase
          projectId={new ObjectID(PROJECT_ID)}
          incomingCallPolicyId={new ObjectID(POLICY_ID)}
          projectCallSMSConfigId={new ObjectID(CONFIG_ID)}
          phoneNumbers={phoneNumbers}
          hideCard={true}
        />
      </MemoryRouter>
    </I18nextProvider>,
  );

  await settle();
}

async function click(element: HTMLElement): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(element);
  });
  await settle();
}

function confirmDescription(): string {
  return screen.getByTestId("confirm-modal-description").textContent || "";
}

// Opens Add Phone Number > Use Existing Phone Number, with the account's numbers.
async function openOwnedNumbers(language: string): Promise<HTMLElement> {
  await click(
    screen.getByRole("button", {
      name: wordsFor(language, "Add Phone Number"),
    }),
  );
  await click(
    screen.getByText(wordsFor(language, "Use Existing Phone Number")),
  );

  return screen.getByTestId("modal");
}

describe.each(["fa", "ar"])("on a %s page", (language: string) => {
  test("an attached number is an isolate that reads left to right: +447700900123", async () => {
    await renderCard(language, [attachedNumber(UK)]);

    const value: HTMLElement = screen.getByTestId(
      "incoming-call-policy-phone-number-value",
    );

    expect(value.tagName).toBe("BDI");
    expect(value).toHaveAttribute("dir", "ltr");
    expect(value.textContent).toBe(UK);
    // Its line - the big green number under "Phone Number" - is the page's.
    expect(value.parentElement).not.toHaveAttribute("dir");
    expect(value.parentElement).toHaveClass("text-lg", "font-semibold");
  });

  test("an attached row with no number still says so, in the reader's words", async () => {
    await renderCard(language, [attachedNumber(undefined)]);

    expect(
      screen.queryByTestId("incoming-call-policy-phone-number-value"),
    ).toBeNull();
    expect(
      screen.getByText(wordsFor(language, "Unknown phone number")),
    ).toBeVisible();
  });

  test("Release asks about the number set apart, and says it went with the number set apart", async () => {
    await renderCard(language, [attachedNumber(UK)]);

    await click(
      within(screen.getByTestId("incoming-call-policy-phone-number")).getByRole(
        "button",
        { name: wordsFor(language, "Release Number") },
      ),
    );

    const template: string =
      "Are you sure you want to release {{phoneNumber}}? This action will return the number to Twilio and it may not be available to reserve again.";

    expect(confirmDescription()).toBe(
      sentenceWith(language, template, `${LRI}${UK}${PDI}`),
    );

    await click(screen.getByTestId("modal-footer-submit-button"));

    expect(deleteSpy).toHaveBeenCalledTimes(1);
    expect(confirmDescription()).toBe(
      sentenceWith(
        language,
        "{{phoneNumber}} has been released back to Twilio.",
        `${LRI}${UK}${PDI}`,
      ),
    );
  });

  test("the account's numbers: Twilio's name for each and the number read left to right", async () => {
    ownedNumbers = [
      {
        phoneNumberId: "PN0000000000000000000000000000001",
        phoneNumber: US,
        friendlyName: US_FRIENDLY,
      },
      {
        phoneNumberId: "PN0000000000000000000000000000002",
        phoneNumber: UK,
        // Renamed by its owner, in Persian.
        friendlyName: "خط پشتیبانی",
      },
    ];

    await renderCard(language, []);

    const modal: HTMLElement = await openOwnedNumbers(language);

    expect(
      postSpy.mock.calls.some((call: Array<unknown>): boolean => {
        return (call[0] as { url: { toString: () => string } }).url
          .toString()
          .includes("/phone-number/list-owned");
      }),
    ).toBe(true);
    expect(
      Array.from(modal.querySelectorAll("bdi")).map(
        (isolate: Element): string => {
          return `${isolate.getAttribute("dir")} ${isolate.textContent}`;
        },
      ),
    ).toEqual([
      `ltr ${US_FRIENDLY}`,
      `ltr ${US}`,
      "rtl خط پشتیبانی",
      `ltr ${UK}`,
    ]);
  });

  test.each([
    [
      "with no webhook",
      undefined,
      "Are you sure you want to use {{phoneNumber}} for this policy? The webhook will be configured automatically.",
    ],
    [
      "whose webhook points elsewhere",
      "https://handler.twilio.com/twiml/EH000",
      "Use {{phoneNumber}} for this policy? Its current webhook will be pointed at OneUptime.",
    ],
  ])(
    "attaching a number %s asks about it set apart, and says it is attached with it set apart",
    async (
      _name: string,
      voiceUrl: string | undefined,
      confirmTemplate: string,
    ) => {
      ownedNumbers = [
        {
          phoneNumberId: "PN0000000000000000000000000000001",
          phoneNumber: US,
          friendlyName: US_FRIENDLY,
          ...(voiceUrl ? { voiceUrl } : {}),
        },
      ];

      await renderCard(language, []);

      const modal: HTMLElement = await openOwnedNumbers(language);

      await click(
        within(modal).getByRole("button", {
          name: wordsFor(language, "Select"),
        }),
      );

      expect(confirmDescription()).toBe(
        sentenceWith(language, confirmTemplate, `${LRI}${US_FRIENDLY}${PDI}`),
      );

      await click(screen.getByTestId("modal-footer-submit-button"));

      expect(confirmDescription()).toBe(
        sentenceWith(
          language,
          "Phone number {{phoneNumber}} has been assigned and configured for this policy.",
          `${LRI}${US}${PDI}`,
        ),
      );
      // What went to the server is the number, with no mark in it.
      const assign: { data: JSONObject } | undefined = postSpy.mock.calls
        .map(
          (
            call: Array<unknown>,
          ): { url: { toString: () => string }; data: JSONObject } => {
            return call[0] as {
              url: { toString: () => string };
              data: JSONObject;
            };
          },
        )
        .find(
          (request: {
            url: { toString: () => string };
            data: JSONObject;
          }): boolean => {
            return request.url.toString().includes("/assign-existing");
          },
        );

      expect(assign?.data["phoneNumber"]).toBe(US);
    },
  );
});

/*
 * ISSUE #7177: THE CARD'S BUTTON WAS A SOFTWARE RELEASE IN ARABIC.
 *
 * The Phone Numbers card's button read the shared "Release", which Arabic
 * translates as a version of software (الإصدار) - a button that read
 * "Version" beside a phone number. It has a key of its own now, the one
 * its dialog's button already had: "Release Number" (تحرير الرقم).
 */
describe.each(["en", "fa", "ar"])(
  "the release button on a %s page",
  (language: string) => {
    test("reads Release Number in the reader's words, as the dialog's button does", async () => {
      await renderCard(language, [attachedNumber(UK)]);

      const card: HTMLElement = screen.getByTestId(
        "incoming-call-policy-phone-number",
      );
      const button: HTMLElement = within(card).getByRole("button", {
        name: wordsFor(language, "Release Number"),
      });

      expect(button).toBeVisible();
      // No button on the card reads the shared word.
      expect(
        within(card).queryByRole("button", {
          name: wordsFor(language, "Release"),
        }),
      ).toBeNull();

      await click(button);

      // The dialog asks with its own title and confirms with the same words.
      expect(
        screen.getByText(wordsFor(language, "Release Phone Number")),
      ).toBeVisible();
      expect(
        screen.getByTestId("modal-footer-submit-button"),
      ).toHaveTextContent(wordsFor(language, "Release Number"));
    });
  },
);

test("Arabic: the shared word is a software release, the button's own words are not", () => {
  expect(wordsFor("ar", "Release")).toBe("الإصدار");
  expect(wordsFor("ar", "Release Number")).not.toContain("الإصدار");
  expect(wordsFor("fa", "Release Number")).not.toBe("Release Number");
});

describe("on an English page", () => {
  test("the number is in its isolate, and every sentence reads as it always did, with no mark", async () => {
    await renderCard("en", [attachedNumber(UK)]);

    expect(
      screen.getByTestId("incoming-call-policy-phone-number-value"),
    ).toHaveAttribute("dir", "ltr");

    await click(screen.getByRole("button", { name: "Release Number" }));

    expect(confirmDescription()).toBe(
      `Are you sure you want to release ${UK}? This action will return the number to Twilio and it may not be available to reserve again.`,
    );

    await click(screen.getByTestId("modal-footer-submit-button"));

    expect(confirmDescription()).toBe(
      `${UK} has been released back to Twilio.`,
    );
  });

  test("attaching a number says it as Twilio names it, with no mark", async () => {
    ownedNumbers = [
      {
        phoneNumberId: "PN0000000000000000000000000000001",
        phoneNumber: US,
        friendlyName: US_FRIENDLY,
      },
    ];

    await renderCard("en", []);

    const modal: HTMLElement = await openOwnedNumbers("en");

    await click(within(modal).getByRole("button", { name: "Select" }));

    expect(confirmDescription()).toBe(
      `Are you sure you want to use ${US_FRIENDLY} for this policy? The webhook will be configured automatically.`,
    );

    await click(screen.getByTestId("modal-footer-submit-button"));

    expect(confirmDescription()).toBe(
      `Phone number ${US} has been assigned and configured for this policy.`,
    );
  });
});
