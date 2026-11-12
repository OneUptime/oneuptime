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
  getVerificationCodeChannel,
  VerificationCodeChannel,
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
