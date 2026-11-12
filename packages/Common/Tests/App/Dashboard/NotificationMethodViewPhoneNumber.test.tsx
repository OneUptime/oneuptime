import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render } from "@testing-library/react";
import { createInstance, i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import NotificationMethodView from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/NotificationMethod";
import UserNotificationRule from "../../../Models/DatabaseModels/UserNotificationRule";
import UserSMS from "../../../Models/DatabaseModels/UserSMS";
import UserCall from "../../../Models/DatabaseModels/UserCall";
import UserWhatsApp from "../../../Models/DatabaseModels/UserWhatsApp";
import UserEmail from "../../../Models/DatabaseModels/UserEmail";
import Email from "../../../Types/Email";
import Phone from "../../../Types/Phone";
import { LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME } from "../../../UI/Utils/LineDirection";

/*
 * Issue #6605: the method a rule or an on-call log line notified -
 * "SMS: +447700900123" - is drawn on a Persian or Arabic page too.
 *
 * The number of an SMS, call or WhatsApp method is an isolate that reads
 * left to right (PhoneNumberText). And the line itself reads the way its
 * words do: the method's name is the channel's own, in Latin letters, so
 * on a page read from the right the line reads left to right, aligned
 * where the page's lines end, as an email method's line under it does.
 * Left the page's way, the number set apart went before the name -
 * "+447700900123 :SMS" over "Email: jane@example.com" in one column.
 */

const UK: string = "+447700900123";

const instances: Record<string, i18n> = {};

beforeAll(async () => {
  for (const language of ["en", "fa", "ar"]) {
    const instance: i18n = createInstance();

    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: { en: { translation: {} }, [language]: { translation: {} } },
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
  if (language !== "en") {
    document.documentElement.setAttribute("dir", "rtl");
  }

  return render(
    <I18nextProvider i18n={instances[language]!}>
      <NotificationMethodView item={rule} modelType={UserNotificationRule} />
    </I18nextProvider>,
  ).container;
}

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
    "Call",
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
  email.email = new Email("jane@example.com");
  rule.userEmail = email;
};

describe("a notification method's line", () => {
  describe.each(["fa", "ar"])(
    "on a page read from the right (%s)",
    (language: string) => {
      test.each(PHONE_METHODS)(
        "%s: its number is an isolate that reads left to right, after the method's name, on a line that reads as its words do",
        (title: string, set: (rule: UserNotificationRule) => void) => {
          const container: HTMLElement = renderView(ruleWith(set), language);
          const line: HTMLElement = container.querySelector("p") as HTMLElement;
          const isolates: Array<Element> = Array.from(
            line.querySelectorAll("bdi"),
          );

          expect(line.textContent).toBe(`${title}: ${UK}`);
          expect(isolates).toHaveLength(1);
          expect(isolates[0]).toHaveAttribute("dir", "ltr");
          expect(isolates[0]!.textContent).toBe(UK);
          // The name first, then the number: "SMS: +447700900123".
          expect(line).toHaveAttribute("dir", "ltr");
          // Where the page's lines end: at the right, as the column's others.
          expect(line).toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
        },
      );

      test("an email method's line reads the same way, its address as it was", () => {
        const container: HTMLElement = renderView(
          ruleWith(withEmail),
          language,
        );
        const line: HTMLElement = container.querySelector("p") as HTMLElement;

        expect(line.textContent).toBe("Email: jane@example.com");
        expect(line.querySelector("bdi")).toBeNull();
        expect(line).toHaveAttribute("dir", "ltr");
        expect(line).toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
      });

      test("every line of one item reads the same way", () => {
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
            return `${line.getAttribute("dir")} ${line.className} ${line.textContent}`;
          }),
        ).toEqual([
          `ltr ${LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME} Email: jane@example.com`,
          `ltr ${LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME} SMS: ${UK}`,
        ]);
      });
    },
  );

  describe("on an English page", () => {
    test.each(PHONE_METHODS)(
      "%s: drawn as it always was, with no direction of its own",
      (title: string, set: (rule: UserNotificationRule) => void) => {
        const container: HTMLElement = renderView(ruleWith(set), "en");
        const line: HTMLElement = container.querySelector("p") as HTMLElement;

        expect(line.textContent).toBe(`${title}: ${UK}`);
        expect(line).not.toHaveAttribute("dir");
        expect(line).not.toHaveClass(LINE_ALIGNED_AS_THE_PAGE_CLASS_NAME);
        expect(line.querySelector("bdi")).toHaveAttribute("dir", "ltr");
      },
    );

    test("an email method's line too", () => {
      const container: HTMLElement = renderView(ruleWith(withEmail), "en");
      const line: HTMLElement = container.querySelector("p") as HTMLElement;

      expect(line.textContent).toBe("Email: jane@example.com");
      expect(line).not.toHaveAttribute("dir");
      expect(line.className).toBe("");
    });
  });

  test("a rule with no method draws no line", () => {
    const container: HTMLElement = renderView(new UserNotificationRule());

    expect(container.querySelectorAll("p")).toHaveLength(0);
  });
});
