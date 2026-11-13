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
  waitFor,
} from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React from "react";
import { I18nextProvider } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ISSUE #6605: THE VERIFICATION DIALOG NAMED A NUMBER 6590665484+ IN AN
 * ARABIC OR PERSIAN SENTENCE.
 *
 * "We sent a 6-digit code by SMS to {{destination}} at {{sentAt}}." - a
 * number in a sentence of a page read right to left took the sentence's
 * way, its "+" after its digits. The dialog now names a phone number (SMS,
 * call, WhatsApp, an incoming call number) set apart in an isolate that
 * reads left to right (LRI ... PDI: phoneNumberInLine), and an email
 * address as it is. An English dialog reads exactly as it did. In the
 * reader's language, from the Dashboard's own locale files.
 */

const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: unknown) => {
        return (
          (error as { message?: string } | undefined)?.message ||
          "Something went wrong"
        );
      },
    },
  };
});

import VerificationCodeModal, {
  VERIFICATION_CODE_INPUT_TEST_ID,
  VERIFICATION_CODE_STATUS_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/VerificationCodeModal";
import {
  CallNumberVerifiedBySmsCopy,
  getVerificationCodeChannel,
  VerificationCodeChannel,
  VerificationCodeChannelDefinition,
  VerificationCodeCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/VerificationCodeChannels";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";

const LRI: string = String.fromCharCode(0x2066);
const PDI: string = String.fromCharCode(0x2069);

const PROJECT_ID: string = "dddddddd-4444-4444-8444-444444444444";
const ITEM_ID: string = "11111111-7777-4777-8777-777777777777";
const NUMBER: string = "+6590665484";
const EMAIL: string = "jane@example.com";

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

interface Server {
  status: JSONObject;
  verify: JSONObject;
}

let server: Server;

function statusJSON(codeState: "active" | "expired" | "none"): JSONObject {
  const now: number = Date.now();
  const hasCode: boolean = codeState !== "none";

  return {
    isVerified: false,
    codeState: codeState,
    codeSentAt: hasCode ? new Date(now - 20000).toISOString() : null,
    codeExpiresAt: hasCode ? new Date(now + 880000).toISOString() : null,
    resendAvailableInSeconds: 0,
    cannotSendReason: null,
  };
}

beforeEach(() => {
  sessionStorage.setItem("current_project_id", PROJECT_ID);
  server = { status: statusJSON("active"), verify: {} };

  postMock.mockReset();
  postMock.mockImplementation(
    (request: any): Promise<HTTPResponse<JSONObject>> => {
      const url: string = request.url.toString();

      if (url.endsWith("/verification-status")) {
        return Promise.resolve(
          new HTTPResponse<JSONObject>(200, server.status, {}),
        );
      }

      if (url.endsWith("/verify")) {
        return Promise.resolve(
          new HTTPResponse<JSONObject>(200, server.verify, {}),
        );
      }

      return Promise.resolve(new HTTPResponse<JSONObject>(200, {}, {}));
    },
  );
});

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  document.documentElement.removeAttribute("dir");
});

async function open(
  language: string,
  channel: VerificationCodeChannel,
  destination: string,
): Promise<void> {
  if (language !== "en") {
    document.documentElement.setAttribute("dir", "rtl");
  }

  render(
    <I18nextProvider i18n={instances[language]!}>
      <VerificationCodeModal
        channel={channel}
        itemId={ITEM_ID}
        destination={destination}
        onClose={() => {}}
        onVerified={() => {}}
      />
    </I18nextProvider>,
  );

  await waitFor(() => {
    expect(
      screen.getByTestId(VERIFICATION_CODE_STATUS_TEST_ID),
    ).toBeInTheDocument();
  });

  await act(async (): Promise<void> => {
    await new Promise<void>((resolve: () => void): void => {
      setTimeout(resolve, 0);
    });
  });
}

function statusText(): string {
  return screen.getByTestId(VERIFICATION_CODE_STATUS_TEST_ID).textContent || "";
}

// The part of a locale's sentence before its value: what the dialog says first.
function sentenceStart(language: string, template: string): string {
  return (locales[language]![template] || template).split("{{")[0]!;
}

const PHONE_CHANNELS: Array<VerificationCodeChannel> = [
  VerificationCodeChannel.SMS,
  VerificationCodeChannel.Call,
  VerificationCodeChannel.WhatsApp,
  VerificationCodeChannel.IncomingCallNumber,
];

describe.each(["ar", "fa"])("on a %s page", (language: string) => {
  test.each(PHONE_CHANNELS)(
    "a %s code's sentence names the number set apart, reading left to right",
    async (channel: VerificationCodeChannel) => {
      await open(language, channel, NUMBER);

      const text: string = statusText();
      const template: string =
        getVerificationCodeChannel(channel).codeSentSentence;

      expect(text.startsWith(sentenceStart(language, template))).toBe(true);
      expect(text).toContain(`${LRI}${NUMBER}${PDI}`);
      // Set apart once, and the number whole inside it.
      expect(text.split(LRI)).toHaveLength(2);
    },
  );

  test.each([
    ["expired", "codeExpiredSentence"],
    ["none", "noCodeSentence"],
  ] as Array<["expired" | "none", "codeExpiredSentence" | "noCodeSentence"]>)(
    "with the code %s, the sentence names the number set apart",
    async (
      codeState: "expired" | "none",
      sentence: "codeExpiredSentence" | "noCodeSentence",
    ) => {
      server.status = statusJSON(codeState);

      await open(language, VerificationCodeChannel.SMS, NUMBER);

      const template: string = getVerificationCodeChannel(
        VerificationCodeChannel.SMS,
      )[sentence];

      // The sentence, then what to do next.
      expect(
        statusText().startsWith(
          (locales[language]![template] || template).replace(
            "{{destination}}",
            `${LRI}${NUMBER}${PDI}`,
          ),
        ),
      ).toBe(true);
      expect(statusText().split(LRI)).toHaveLength(2);
    },
  );

  test("a number found verified already is named set apart", async () => {
    server.status = { ...statusJSON("none"), isVerified: true };

    await open(language, VerificationCodeChannel.Call, NUMBER);

    const template: string = VerificationCodeCopy.alreadyVerified;

    expect(statusText()).toBe(
      (locales[language]![template] || template).replace(
        "{{destination}}",
        `${LRI}${NUMBER}${PDI}`,
      ),
    );
  });

  test("a number verified for calls too is named set apart", async () => {
    server.verify = { alsoVerifiedForCalls: 1 };

    await open(language, VerificationCodeChannel.SMS, NUMBER);

    await act(async (): Promise<void> => {
      fireEvent.change(screen.getByTestId(VERIFICATION_CODE_INPUT_TEST_ID), {
        target: { value: "424242" },
      });
    });
    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });

    const template: string = VerificationCodeCopy.alsoVerifiedForCalls;

    await waitFor(() => {
      expect(statusText()).toBe(
        (locales[language]![template] || template).replace(
          "{{destination}}",
          `${LRI}${NUMBER}${PDI}`,
        ),
      );
    });
  });

  test("an email address is named as it is: no mark", async () => {
    await open(language, VerificationCodeChannel.Email, EMAIL);

    const text: string = statusText();

    expect(text).toContain(EMAIL);
    expect(text).not.toContain(LRI);
    expect(text).not.toContain(`${EMAIL}${PDI}`);
  });
});

describe("on an English page", () => {
  test.each(PHONE_CHANNELS)(
    "a %s code's sentence names the number as it always did, with no mark",
    async (channel: VerificationCodeChannel) => {
      await open("en", channel, NUMBER);

      const text: string = statusText();

      expect(text).toContain(` ${NUMBER} `);
      expect(text).not.toContain(LRI);
      expect(text).not.toContain(PDI);
    },
  );

  test("a number found verified already reads as before", async () => {
    server.status = { ...statusJSON("none"), isVerified: true };

    await open("en", VerificationCodeChannel.Call, NUMBER);

    expect(statusText()).toBe(`${NUMBER} is verified.`);
  });
});

/*
 * ISSUE #7181: THE PERSIAN DIALOG READ IN ENGLISH.
 *
 * The dialog set a number apart on a Persian page (#6605) inside sentences
 * that were still English: fa.json kept them as the English ("We sent a
 * 6-digit code by SMS to ..."). A Persian reader now reads the dialog in
 * Persian - its title, its sentence, the field, the hint, the line that
 * sends another code and its buttons - with the number still set apart. A
 * brand keeps its own name (WhatsApp), and a clock's AM or PM is the
 * clock's.
 */

// Latin words: what an English sentence left in a Persian one is made of.
const LATIN_WORD: RegExp = /[A-Za-z]{2,}/g;
const KEPT_AS_WRITTEN: ReadonlyArray<string> = ["AM", "PM", "WhatsApp"];

function latinWords(text: string): Array<string> {
  return (text.match(LATIN_WORD) || []).filter((word: string): boolean => {
    return !KEPT_AS_WRITTEN.includes(word);
  });
}

// Everything the open dialog says: its header, its body and its buttons.
function dialogText(): string {
  return screen.getByTestId("modal").textContent || "";
}

// Every key the dialog can read, whichever channel it verifies.
function dialogKeys(): Array<string> {
  const keys: Set<string> = new Set<string>();

  for (const channel of Object.values(VerificationCodeChannel)) {
    const definition: VerificationCodeChannelDefinition =
      getVerificationCodeChannel(channel);

    for (const text of [
      definition.title,
      definition.codeSentSentence,
      definition.codeExpiredSentence,
      definition.noCodeSentence,
      definition.sendCodeNextStep,
      definition.sendCodeButtonText,
      definition.sendingCodeButtonText,
      definition.notArrivedHint,
    ]) {
      keys.add(text);
    }
  }

  for (const value of Object.values(VerificationCodeCopy)) {
    if (typeof value === "string") {
      keys.add(value);
    }
  }

  // The wait before another code: a plural, its "other" form and its "one".
  keys.add(VerificationCodeCopy.cooldown.other);
  keys.add(`${VerificationCodeCopy.cooldown.other}_one`);

  keys.add(CallNumberVerifiedBySmsCopy.title);
  keys.add(CallNumberVerifiedBySmsCopy.description);

  return Array.from(keys);
}

describe("on a Persian page, the dialog reads in Persian (#7181)", () => {
  test("an SMS code: its title, its sentence, the field, the hint and the line that sends another", async () => {
    await open("fa", VerificationCodeChannel.SMS, NUMBER);

    /*
     * "At {{sentAt}} we sent a 6-digit code by SMS to {{destination}}." -
     * Persian says when first, and the number keeps its isolate.
     */
    const text: string = statusText();

    expect(text.startsWith("در ")).toBe(true);
    expect(text).toContain(
      `یک کد ۶ رقمی با پیامک به ${LRI}${NUMBER}${PDI} فرستادیم.`,
    );
    // "It works until {{expiresAt}}."
    expect(text.endsWith(" معتبر است.")).toBe(true);
    expect(text).not.toContain("We sent");

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "تأیید شماره تلفن",
    );
    expect(screen.getByText("کد تأیید")).toBeInTheDocument();
    expect(screen.getByText("دریافت نکردید؟")).toBeVisible();
    expect(
      screen.getByTestId("verification-code-send-button"),
    ).toHaveTextContent("ارسال کد جدید");
    expect(
      screen.getByText(/^رسیدن پیامک ممکن است یک دقیقه طول بکشد\. /),
    ).toBeVisible();
    expect(screen.getByTestId("modal-footer-submit-button")).toHaveTextContent(
      "تأیید",
    );

    expect(latinWords(dialogText())).toEqual([]);
  });

  test.each([...PHONE_CHANNELS, VerificationCodeChannel.Email])(
    "a %s dialog holds no English word",
    async (channel: VerificationCodeChannel) => {
      const isEmail: boolean = channel === VerificationCodeChannel.Email;

      await open("fa", channel, isEmail ? EMAIL : NUMBER);

      // The address is the reader's own, as written; nothing else is Latin.
      expect(latinWords(dialogText().split(EMAIL).join(""))).toEqual([]);
      expect(dialogText()).toContain(isEmail ? EMAIL : NUMBER);
    },
  );

  test.each([
    ["expired", "کدی که به NUMBER فرستادیم منقضی شده است."],
    ["none", "هیچ کدی در انتظار NUMBER نیست."],
  ] as Array<["expired" | "none", string]>)(
    "with the code %s, the sentence and what to do next are Persian",
    async (codeState: "expired" | "none", sentence: string) => {
      server.status = statusJSON(codeState);

      await open("fa", VerificationCodeChannel.SMS, NUMBER);

      // The sentence, then "Send a new code to verify this number."
      expect(statusText()).toBe(
        `${sentence.replace("NUMBER", `${LRI}${NUMBER}${PDI}`)} برای تأیید این شماره، کد جدیدی بفرستید.`,
      );
      expect(latinWords(dialogText())).toEqual([]);
    },
  );

  test("a number found verified already is named in a Persian sentence", async () => {
    server.status = { ...statusJSON("none"), isVerified: true };

    await open("fa", VerificationCodeChannel.Call, NUMBER);

    expect(statusText()).toBe(`${LRI}${NUMBER}${PDI} تأیید شد.`);
    // "Phone Number Verified"
    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "شماره تلفن تأیید شد",
    );
    expect(latinWords(dialogText())).toEqual([]);
  });

  test.each(["fa", "ar"])(
    "every word the dialog can say is worded in %s, none of it the English",
    (language: string) => {
      const keys: Array<string> = dialogKeys();

      // Every channel's words, the shared ones and the plural's two forms.
      expect(keys.length).toBeGreaterThan(30);

      const english: Record<string, string> = readLocale("en");
      const unworded: Array<string> = keys.filter((key: string): boolean => {
        const value: string | undefined = locales[language]![key];

        return (
          typeof value !== "string" || !value.trim() || value === english[key]
        );
      });

      expect(unworded).toEqual([]);
    },
  );

  test("not a word of English in the Persian: SMS is پیامک there, not SMS", () => {
    const withEnglish: Array<string> = dialogKeys().filter(
      (key: string): boolean => {
        return (
          latinWords(
            (locales["fa"]![key] || key).replace(/\{\{\s*\w+\s*\}\}/g, ""),
          ).length > 0
        );
      },
    );

    expect(withEnglish).toEqual([]);
  });

  test("Persian writes its own letters: no Arabic yeh or kaf in the dialog's words", () => {
    // ي and ك are Arabic's; Persian writes ی and ک (#7181 compared with ar).
    const arabicOnly: RegExp = new RegExp(
      `[${String.fromCharCode(0x064a)}${String.fromCharCode(0x0643)}]`,
    );

    expect(
      dialogKeys().filter((key: string): boolean => {
        return arabicOnly.test(locales["fa"]![key] || "");
      }),
    ).toEqual([]);
  });
});
