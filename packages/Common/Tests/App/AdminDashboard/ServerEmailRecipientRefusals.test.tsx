import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import fs from "fs";
import path from "path";
import React from "react";
import ServerEmailRecipientRefusals, {
  getEmailRecipientRefusals,
  SERVER_EMAIL_RECIPIENT_REFUSALS_COPY,
} from "../../../../App/FeatureSet/AdminDashboard/src/Components/ServerSetup/ServerEmailRecipientRefusals";
import { SERVER_SENDING_ALERT_COPY } from "../../../UI/Components/ServerSending/ServerSendingTopAlert";
import {
  ServerChannelStatus,
  ServerSendingChannel,
  ServerSendingRecipientRefusal,
  ServerSendingState,
} from "../../../Types/ServerSending/ServerSendingStatus";
import ServerSetupChecklistUtil, {
  ServerSetupCheckId,
  ServerSetupChecklistAnswer,
  ServerSetupStatus,
} from "../../../Types/ServerSetup/ServerSetupChecklist";
import { getTemplatePlaceholders } from "../../../Types/Translator";
import {
  ADMIN_DASHBOARD_LANGUAGES,
  DASHBOARD_LANGUAGES,
} from "../../Helpers/TranslatedLanguages";

/*
 * ADDRESSES THE MAIL SERVICE REFUSED, WHILE EMAIL WORKS (#9217).
 *
 * One unverified address in an Amazon SES sandbox raised "Email is
 * failing" for every admin. Such a refusal is now listed in Settings >
 * Emails, under the test card - who, when and what the mail service said -
 * and never draws the banner. Its words, and the banner's new ones, are in
 * every language each app is read in.
 */

const REFUSAL: ServerSendingRecipientRefusal = {
  recipient: "new.user@customer.example.com",
  reason:
    "554 Message rejected: Email address is not verified. The following identities failed the check in region AP-SOUTHEAST-1: new.user@customer.example.com",
  at: "2026-11-16T09:18:00.000Z",
};

// The checklist as the browser parses it, with email's status on its check.
function checklist(
  refusals: Array<ServerSendingRecipientRefusal> | undefined,
): ServerSetupChecklistAnswer | null {
  const email: ServerChannelStatus = {
    channel: ServerSendingChannel.Email,
    state: ServerSendingState.Working,
    hasWorked: true,
    lastWorkedAt: "2026-11-16T09:00:00.000Z",
    failingSince: null,
    lastFailure: null,
    setUpProblem: null,
  };

  if (refusals) {
    email.recipientRefusals = refusals;
  }

  return ServerSetupChecklistUtil.parseAnswer(
    JSON.parse(
      JSON.stringify({
        checks: [
          {
            id: ServerSetupCheckId.Email,
            status: ServerSetupStatus.Done,
            time: email.lastWorkedAt,
            sentThrough: "smtp.example.com",
            reason: null,
            channels: [{ ...email, sentThrough: "smtp.example.com" }],
          },
        ],
        openRequired: [],
        isHiddenForReader: false,
      }),
    ),
  );
}

afterEach(() => {
  cleanup();
});

describe("the refusals Settings > Emails lists", () => {
  test("each address, when it was last refused, and what the mail service said", () => {
    render(<ServerEmailRecipientRefusals refusals={[REFUSAL]} />);

    const list: HTMLElement = screen.getByTestId(
      "server-email-recipient-refusals",
    );

    expect(list).toHaveTextContent(SERVER_EMAIL_RECIPIENT_REFUSALS_COPY.title);
    expect(list).toHaveTextContent("Other emails went out");

    const rows: Array<HTMLElement> = within(list).getAllByTestId(
      "server-email-recipient-refusal",
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toHaveTextContent("new.user@customer.example.com");
    expect(rows[0]).toHaveTextContent("Last refused");
    expect(rows[0]).toHaveTextContent("2026");
    expect(rows[0]).toHaveTextContent("Email address is not verified");
  });

  test("draws nothing with no refusals", () => {
    render(<ServerEmailRecipientRefusals refusals={[]} />);

    expect(screen.queryByTestId("server-email-recipient-refusals")).toBeNull();
  });

  test("reads them from the checklist's email check, as the browser parses it", () => {
    expect(getEmailRecipientRefusals(checklist([REFUSAL]))).toEqual([REFUSAL]);
    expect(getEmailRecipientRefusals(checklist(undefined))).toEqual([]);
    expect(getEmailRecipientRefusals(null)).toEqual([]);
    expect(
      getEmailRecipientRefusals({
        checks: [],
        openRequired: [],
        isHiddenForReader: false,
      }),
    ).toEqual([]);
  });
});

describe("in every language", () => {
  type Locale = Record<string, unknown>;

  const readLocale: (app: string, locale: string) => Locale = (
    app: string,
    locale: string,
  ): Locale => {
    return JSON.parse(
      fs.readFileSync(
        path.join(
          __dirname,
          `../../../../App/FeatureSet/${app}/src/Locales/${locale}.json`,
        ),
        "utf8",
      ),
    ) as Locale;
  };

  const BANNER_WORDS: Array<string> = [
    SERVER_SENDING_ALERT_COPY.emailFailingDescription,
    SERVER_SENDING_ALERT_COPY.emailFailingWithReasonDescription,
    SERVER_SENDING_ALERT_COPY.seeEmailLogs,
  ];

  const REFUSAL_WORDS: Array<string> = [
    SERVER_EMAIL_RECIPIENT_REFUSALS_COPY.title,
    SERVER_EMAIL_RECIPIENT_REFUSALS_COPY.description,
    SERVER_EMAIL_RECIPIENT_REFUSALS_COPY.lastRefused,
  ];

  const cases: Array<[string, string, string]> = [];

  for (const locale of DASHBOARD_LANGUAGES) {
    for (const words of BANNER_WORDS) {
      cases.push(["Dashboard", locale, words]);
    }
  }

  for (const locale of ADMIN_DASHBOARD_LANGUAGES) {
    for (const words of [...BANNER_WORDS, ...REFUSAL_WORDS]) {
      cases.push(["AdminDashboard", locale, words]);
    }
  }

  test.each(cases)(
    "%s %s: %s",
    (app: string, locale: string, words: string) => {
      const english: Locale = readLocale(app, "en");
      const translated: Locale = readLocale(app, locale);

      expect(english[words]).toBe(words);

      const value: unknown = translated[words];

      expect(typeof value).toBe("string");
      expect(value).not.toBe(words);
      expect(getTemplatePlaceholders(value as string).sort()).toEqual(
        getTemplatePlaceholders(words).sort(),
      );
    },
  );
});
