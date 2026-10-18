import { describe, expect, test } from "@jest/globals";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import { Service as StatusPageService } from "../../../Server/Services/StatusPageService";
import {
  DEFAULT_SUBSCRIBER_EMAIL_FOOTER_TEXT,
  getSubscriberEmailFooterText,
  isCustomSubscriberEmailFooterUsed,
} from "../../../Types/StatusPage/SubscriberEmailFooter";

/*
 * The line at the end of every email a status page sends its subscribers:
 * one rule, read by the senders (StatusPageService) and by the dashboard's
 * Email Footer card, so the card says what subscribers read.
 */

const page: (values: Partial<StatusPage>) => StatusPage = (
  values: Partial<StatusPage>,
): StatusPage => {
  return Object.assign(new StatusPage(), values);
};

describe("a status page's email footer", () => {
  test("is the page's own text only while its switch is on and the text is not empty", () => {
    expect(
      isCustomSubscriberEmailFooterUsed({
        enableCustomSubscriberEmailNotificationFooterText: true,
        subscriberEmailNotificationFooterText: "Questions? support@acme.com",
      }),
    ).toBe(true);

    for (const columns of [
      {},
      {
        enableCustomSubscriberEmailNotificationFooterText: false,
        subscriberEmailNotificationFooterText: "Questions? support@acme.com",
      },
      {
        enableCustomSubscriberEmailNotificationFooterText: true,
        subscriberEmailNotificationFooterText: "",
      },
      {
        enableCustomSubscriberEmailNotificationFooterText: true,
        subscriberEmailNotificationFooterText: null,
      },
      {
        enableCustomSubscriberEmailNotificationFooterText: null,
        subscriberEmailNotificationFooterText: "Questions?",
      },
    ]) {
      expect([columns, isCustomSubscriberEmailFooterUsed(columns)]).toEqual([
        columns,
        false,
      ]);
    }
  });

  test("reads the page's own text, or the default line", () => {
    expect(
      getSubscriberEmailFooterText({
        enableCustomSubscriberEmailNotificationFooterText: true,
        subscriberEmailNotificationFooterText: "Questions? support@acme.com",
      }),
    ).toBe("Questions? support@acme.com");
    expect(
      getSubscriberEmailFooterText({
        enableCustomSubscriberEmailNotificationFooterText: false,
        subscriberEmailNotificationFooterText: "Questions? support@acme.com",
      }),
    ).toBe(DEFAULT_SUBSCRIBER_EMAIL_FOOTER_TEXT);
    expect(getSubscriberEmailFooterText({})).toBe(
      DEFAULT_SUBSCRIBER_EMAIL_FOOTER_TEXT,
    );
  });

  test("the default line is the one the emails have always ended with", () => {
    expect(DEFAULT_SUBSCRIBER_EMAIL_FOOTER_TEXT).toBe(
      "This is an automated email sent to you because you are subscribed to this Status Page.",
    );
  });

  test("the senders ask the same rule", () => {
    expect(StatusPageService.getDefaultEmailFooterText()).toBe(
      DEFAULT_SUBSCRIBER_EMAIL_FOOTER_TEXT,
    );
    expect(
      StatusPageService.getSubscriberEmailFooterText(
        page({
          enableCustomSubscriberEmailNotificationFooterText: true,
          subscriberEmailNotificationFooterText: "Questions?",
        }),
      ),
    ).toBe("Questions?");
    // Your own text left empty sends the default line.
    expect(
      StatusPageService.getSubscriberEmailFooterText(
        page({
          enableCustomSubscriberEmailNotificationFooterText: true,
          subscriberEmailNotificationFooterText: "",
        }),
      ),
    ).toBe(DEFAULT_SUBSCRIBER_EMAIL_FOOTER_TEXT);
    expect(StatusPageService.getSubscriberEmailFooterText(page({}))).toBe(
      DEFAULT_SUBSCRIBER_EMAIL_FOOTER_TEXT,
    );
  });
});
