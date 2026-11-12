import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render } from "@testing-library/react";
import React from "react";
import NotificationMethodView from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/NotificationMethod";
import UserNotificationRule from "../../../Models/DatabaseModels/UserNotificationRule";
import UserSMS from "../../../Models/DatabaseModels/UserSMS";
import UserCall from "../../../Models/DatabaseModels/UserCall";
import UserWhatsApp from "../../../Models/DatabaseModels/UserWhatsApp";
import UserEmail from "../../../Models/DatabaseModels/UserEmail";
import Email from "../../../Types/Email";
import Phone from "../../../Types/Phone";

/*
 * Issue #6605: the method a rule or an on-call log line notified -
 * "SMS: +447700900123" - read "SMS: 447700900123+" on a Persian or Arabic
 * page: a number has no letter to say which way it reads, so it took the
 * page's way. The number of an SMS, call or WhatsApp method is now an
 * isolate that reads left to right (PhoneNumberText); an email address and
 * every other method's name are drawn as they were.
 */

const UK: string = "+447700900123";

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

function renderView(rule: UserNotificationRule): HTMLElement {
  document.documentElement.setAttribute("dir", "rtl");

  return render(
    <NotificationMethodView item={rule} modelType={UserNotificationRule} />,
  ).container;
}

describe("a notification method's line", () => {
  test.each([
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
  ])(
    "%s: its number is an isolate that reads left to right, after the method's name",
    (title: string, set: (rule: UserNotificationRule) => void) => {
      const container: HTMLElement = renderView(ruleWith(set));
      const line: HTMLElement = container.querySelector("p") as HTMLElement;
      const isolates: Array<Element> = Array.from(line.querySelectorAll("bdi"));

      expect(line.textContent).toBe(`${title}: ${UK}`);
      expect(isolates).toHaveLength(1);
      expect(isolates[0]).toHaveAttribute("dir", "ltr");
      expect(isolates[0]!.textContent).toBe(UK);
    },
  );

  test("an email address is drawn as it was", () => {
    const container: HTMLElement = renderView(
      ruleWith((rule: UserNotificationRule): void => {
        const email: UserEmail = new UserEmail();
        email.email = new Email("jane@example.com");
        rule.userEmail = email;
      }),
    );
    const line: HTMLElement = container.querySelector("p") as HTMLElement;

    expect(line.textContent).toBe("Email: jane@example.com");
    expect(line.querySelector("bdi")).toBeNull();
  });

  test("a rule with no method draws no line", () => {
    const container: HTMLElement = renderView(new UserNotificationRule());

    expect(container.querySelectorAll("p")).toHaveLength(0);
  });
});
