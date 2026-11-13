import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render } from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React from "react";
import { I18nextProvider } from "react-i18next";
import NotificationMethodView from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/NotificationMethod";
import UserNotificationRule from "../../../Models/DatabaseModels/UserNotificationRule";
import UserSMS from "../../../Models/DatabaseModels/UserSMS";
import UserCall from "../../../Models/DatabaseModels/UserCall";
import UserWhatsApp from "../../../Models/DatabaseModels/UserWhatsApp";
import UserEmail from "../../../Models/DatabaseModels/UserEmail";
import UserPush from "../../../Models/DatabaseModels/UserPush";
import Email from "../../../Types/Email";
import Phone from "../../../Types/Phone";
import { LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME } from "../../../UI/Utils/LineDirection";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * Issue #6605: the method a rule or an on-call log line notified -
 * "SMS: +447700900123" - is drawn on a Persian or Arabic page too. The
 * number of an SMS, call or WhatsApp method is an isolate that reads left
 * to right (PhoneNumberText).
 *
 * Issue #7178: and the line is a sentence of the reader's language. The
 * method's name is a phrase of its own - "Phone call", never the shared
 * "Call", which is a function call (调用) in Chinese; "Push notification",
 * never the shared "Push", which is a payment (الدفع) in Arabic - and the
 * colon is the language's ("Appel téléphonique : ...", "电话：..."). So
 * the line reads the page's way: from the right on a Persian page, the
 * name first, the number still reading left to right inside it, and an
 * address an isolate of its own. Read from the Dashboard's locale files.
 */

const UK: string = "+447700900123";
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

const LANGUAGES: Array<string> = ["en", "fa", "ar", "fr", "zh-CN"];

function readLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

const instances: Record<string, i18n> = {};
const locales: Record<string, Record<string, string>> = {};

beforeAll(async () => {
  for (const language of LANGUAGES) {
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

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("dir");
});

function ruleWith(
  set: (rule: UserNotificationRule) => void,
): UserNotificationRule {
  const rule: UserNotificationRule = new UserNotificationRule();
  set(rule);
  return rule;
}

function renderView(
  rule: UserNotificationRule,
  language: string = "fa",
): HTMLElement {
  if (language === "fa" || language === "ar") {
    document.documentElement.setAttribute("dir", "rtl");
  }

  return render(
    <I18nextProvider i18n={instances[language]!}>
      <NotificationMethodView item={rule} modelType={UserNotificationRule} />
    </I18nextProvider>,
  ).container;
}

// A method's line as a language writes it: its own name, its own colon.
function lineIn(language: string, name: string, identifier: string): string {
  const words: Record<string, string> = locales[language]!;

  return (words["{{label}}: {{identifier}}"] || "{{label}}: {{identifier}}")
    .replace("{{label}}", words[name] || name)
    .replace("{{identifier}}", identifier);
}

// Each method reached at a phone number, with the key it is named by.
const PHONE_METHODS: Array<[string, (rule: UserNotificationRule) => void]> = [
  [
    "SMS",
    (rule: UserNotificationRule): void => {
      const sms: UserSMS = new UserSMS();
      sms.phone = new Phone(UK);
      rule.userSms = sms;
    },
  ],
  [
    "Phone call",
    (rule: UserNotificationRule): void => {
      const call: UserCall = new UserCall();
      call.phone = new Phone(UK);
      rule.userCall = call;
    },
  ],
  [
    "WhatsApp",
    (rule: UserNotificationRule): void => {
      const whatsApp: UserWhatsApp = new UserWhatsApp();
      whatsApp.phone = new Phone(UK);
      rule.userWhatsApp = whatsApp;
    },
  ],
];

const withEmail: (rule: UserNotificationRule) => void = (
  rule: UserNotificationRule,
): void => {
  const email: UserEmail = new UserEmail();
  email.email = new Email(EMAIL);
  rule.userEmail = email;
};

const withPush: (rule: UserNotificationRule) => void = (
  rule: UserNotificationRule,
): void => {
  const push: UserPush = new UserPush();
  push.deviceName = "Pixel 8";
  rule.userPush = push;
};

function firstLine(container: HTMLElement): HTMLElement {
  return container.querySelector("p") as HTMLElement;
}

describe("a notification method's line", () => {
  describe.each(["fa", "ar"])(
    "on a page read from the right (%s)",
    (language: string) => {
      test.each(PHONE_METHODS)(
        "%s: the method's name is the reader's, the number an isolate that reads left to right, the line the page's way",
        (name: string, set: (rule: UserNotificationRule) => void) => {
          const line: HTMLElement = firstLine(
            renderView(ruleWith(set), language),
          );
          const isolates: Array<Element> = Array.from(
            line.querySelectorAll("bdi"),
          );

          expect(withoutIsolateMarks(line.textContent || "")).toBe(
            lineIn(language, name, UK),
          );
          expect(isolates).toHaveLength(1);
          expect(isolates[0]).toHaveAttribute("dir", "ltr");
          expect(isolates[0]!.textContent).toBe(UK);
          /*
           * Words of the reader's language: the line reads as the page
           * does, from the right, the name first.
           */
          expect(line).not.toHaveAttribute("dir");
          expect(line).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
        },
      );

      test("the method's name is not left in English", () => {
        for (const [name] of PHONE_METHODS) {
          if (name === "WhatsApp") {
            // A product's name, kept as it is written.
            continue;
          }

          expect(locales[language]![name]).toBeDefined();
          expect(locales[language]![name]).not.toBe(name);
        }

        const line: HTMLElement = firstLine(
          renderView(ruleWith(PHONE_METHODS[1]![1]), language),
        );

        expect(line.textContent).not.toContain("Call");
        expect(line.textContent).toContain(locales[language]!["Phone call"]!);
      });

      test("an email method's line: its name the reader's, its address an isolate of its own", () => {
        const line: HTMLElement = firstLine(
          renderView(ruleWith(withEmail), language),
        );
        const isolates: Array<Element> = Array.from(
          line.querySelectorAll("bdi"),
        );

        expect(withoutIsolateMarks(line.textContent || "")).toBe(
          lineIn(language, "Email", EMAIL),
        );
        expect(isolates).toHaveLength(1);
        expect(isolates[0]).toHaveAttribute("dir", "ltr");
        expect(isolates[0]!.textContent).toBe(EMAIL);
        expect(line).not.toHaveAttribute("dir");
      });

      test("every line of one item reads the same way: the page's", () => {
        const container: HTMLElement = renderView(
          ruleWith((rule: UserNotificationRule): void => {
            PHONE_METHODS[0]![1](rule);
            withEmail(rule);
          }),
          language,
        );
        const lines: Array<HTMLElement> = Array.from(
          container.querySelectorAll("p"),
        );

        expect(
          lines.map((line: HTMLElement): string => {
            return `${line.getAttribute("dir")} ${line.className} ${withoutIsolateMarks(line.textContent || "")}`;
          }),
        ).toEqual([
          `null  ${lineIn(language, "Email", EMAIL)}`,
          `null  ${lineIn(language, "SMS", UK)}`,
        ]);
      });
    },
  );

  test("in Arabic, a push device's line names a notification, never a payment", () => {
    const line: HTMLElement = firstLine(renderView(ruleWith(withPush), "ar"));

    expect(withoutIsolateMarks(line.textContent || "")).toBe(
      lineIn("ar", "Push notification", "Pixel 8"),
    );
    // The shared "Push" is الدفع - a payment - in Arabic.
    expect(locales["ar"]!["Push"]).toBe("الدفع");
    expect(line.textContent).not.toContain("الدفع");
    expect(line.textContent).toContain(locales["ar"]!["Push notification"]!);
  });

  test("in Chinese, a call method's line names a phone call, never a function call, with the full-width colon", () => {
    const line: HTMLElement = firstLine(
      renderView(ruleWith(PHONE_METHODS[1]![1]), "zh-CN"),
    );

    // The shared "Call" is 调用 - a function call - in Chinese.
    expect(locales["zh-CN"]!["Call"]).toBe("调用");
    expect(line.textContent).not.toContain("调用");
    expect(withoutIsolateMarks(line.textContent || "")).toBe(
      `${locales["zh-CN"]!["Phone call"]}：${UK}`,
    );
  });

  test("in French, the colon is spaced as French spaces it", () => {
    const line: HTMLElement = firstLine(
      renderView(ruleWith(PHONE_METHODS[0]![1]), "fr"),
    );

    expect(withoutIsolateMarks(line.textContent || "")).toBe(
      `${locales["fr"]!["SMS"]} : ${UK}`,
    );
  });

  describe("on an English page", () => {
    test.each(PHONE_METHODS)(
      "%s: the method's name, then its number in its isolate, with no direction of its own",
      (name: string, set: (rule: UserNotificationRule) => void) => {
        const line: HTMLElement = firstLine(renderView(ruleWith(set), "en"));

        expect(line.textContent).toBe(`${name}: ${UK}`);
        expect(line).not.toHaveAttribute("dir");
        expect(line).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
        expect(line.querySelector("bdi")).toHaveAttribute("dir", "ltr");
      },
    );

    test("an email method's line too, its address in its isolate", () => {
      const line: HTMLElement = firstLine(
        renderView(ruleWith(withEmail), "en"),
      );

      expect(line.textContent).toBe(`Email: ${EMAIL}`);
      expect(line).not.toHaveAttribute("dir");
      expect(line.className).toBe("");
      expect(line.querySelector("bdi")).toHaveTextContent(EMAIL);
    });

    test("a push device's line names a push notification", () => {
      const line: HTMLElement = firstLine(renderView(ruleWith(withPush), "en"));

      expect(line.textContent).toBe("Push notification: Pixel 8");
    });
  });

  test("a rule with no method draws no line", () => {
    const container: HTMLElement = renderView(new UserNotificationRule());

    expect(container.querySelectorAll("p")).toHaveLength(0);
  });
});
