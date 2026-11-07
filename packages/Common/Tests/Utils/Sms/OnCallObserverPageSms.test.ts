import { describe, expect, test } from "@jest/globals";
import {
  buildOnCallPageSms,
  ON_CALL_PAGE_SMS_ACTION,
  OnCallPageSms,
  OnCallPageSmsInput,
  OnCallPageSmsKind,
} from "../../../Utils/Sms/OnCallPageSms";
import {
  ON_CALL_OBSERVER_PAGE_SMS_ACTION,
  getOnCallObserverPageLead,
} from "../../../Types/OnCallDutyPolicy/OnCallObserverPage";

/*
 * AN OBSERVER'S TEXT MESSAGE (OnCallObserverPage, Utils/Sms/OnCallPageSms).
 *
 * It says it is for their information - "FYI (observer)" after the product,
 * or who paged them as an observer - and its link marks the page seen
 * ("Mark seen:") rather than acknowledging or escalating it. Fitted to one
 * part like every page's text, and never cut where it says so.
 */

const LINK: string = "https://oneuptime.com/l/XJlaZRsd";

const page: (overrides: Partial<OnCallPageSmsInput>) => OnCallPageSms = (
  overrides: Partial<OnCallPageSmsInput>,
): OnCallPageSms => {
  return buildOnCallPageSms({
    kind: OnCallPageSmsKind.Incident,
    productName: "OneUptime",
    severityName: "Critical Incident",
    number: "INC-42",
    projectName: "Acme",
    title: "Mesh network down",
    link: LINK,
    ...overrides,
  });
};

describe("an observer's text message", () => {
  test("says FYI (observer), and its link marks the page seen", () => {
    expect(page({ isObserverPage: true }).text).toBe(
      `OneUptime FYI (observer): Critical Incident INC-42 in Acme: Mesh network down. ${ON_CALL_OBSERVER_PAGE_SMS_ACTION} ${LINK}`,
    );
  });

  test("never offers to acknowledge or escalate", () => {
    const text: string = page({ isObserverPage: true }).text;

    expect(text).not.toContain(ON_CALL_PAGE_SMS_ACTION);
    expect(text).not.toContain("Ack");
    expect(text).not.toContain("escalate");
  });

  test("a person's page says who paged them as an observer, where the product's FYI would be", () => {
    expect(
      page({
        isObserverPage: true,
        lead: getOnCallObserverPageLead({
          pagedByName: "Alice Kim",
          teamName: "Oversight",
        }),
      }).text,
    ).toBe(
      `OneUptime: Alice Kim paged Oversight as observers about Critical Incident INC-42 in Acme: Mesh network down. ${ON_CALL_OBSERVER_PAGE_SMS_ACTION} ${LINK}`,
    );
  });

  test("a responder's page reads exactly as before", () => {
    expect(page({}).text).toBe(
      `OneUptime: Critical Incident INC-42 in Acme: Mesh network down. ${ON_CALL_PAGE_SMS_ACTION} ${LINK}`,
    );
    expect(page({ isObserverPage: false }).text).toBe(page({}).text);
  });

  test("fits one part, cutting the title before anything it must say", () => {
    const sms: OnCallPageSms = page({
      isObserverPage: true,
      title: "x".repeat(400),
    });

    expect(sms.sent.segments).toBe(1);
    expect(sms.isTitleCut).toBe(true);
    expect(sms.text.startsWith("OneUptime FYI (observer): ")).toBe(true);
    expect(
      sms.text.endsWith(`${ON_CALL_OBSERVER_PAGE_SMS_ACTION} ${LINK}`),
    ).toBe(true);
  });

  test.each([
    OnCallPageSmsKind.Alert,
    OnCallPageSmsKind.IncidentEpisode,
    OnCallPageSmsKind.AlertEpisode,
  ])("says the same for a page about a %s", (kind: OnCallPageSmsKind) => {
    const text: string = page({ kind: kind, isObserverPage: true }).text;

    expect(text.startsWith("OneUptime FYI (observer): ")).toBe(true);
    expect(text).toContain(ON_CALL_OBSERVER_PAGE_SMS_ACTION);
  });
});
