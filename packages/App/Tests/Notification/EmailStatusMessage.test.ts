import { describe, expect, test } from "@jest/globals";
import { getMaxLengthFromTableColumnType } from "Common/Types/Database/ColumnLength";
import TableColumnType from "Common/Types/Database/TableColumnType";
import EmailLog from "Common/Models/DatabaseModels/EmailLog";
import UserOnCallLogTimeline from "Common/Models/DatabaseModels/UserOnCallLogTimeline";
import { TableColumnMetadata } from "Common/Types/Database/TableColumn";
import {
  EMAIL_DELIVERY_NOT_TRACKED,
  EMAIL_DELIVERY_NOT_TRACKED_IN_SHORT,
  EMAIL_SENT_STATUS_MESSAGE,
  MAX_EMAIL_STATUS_MESSAGE_LENGTH,
  clipText,
  getSentWithoutImagesStatusMessage,
  toEmailStatusMessage,
} from "../../FeatureSet/Notification/Utils/EmailStatusMessage";

/*
 * What an email's Email Log row and on-call timeline entry say of it
 * (EmailStatusMessage). Both columns hold a few hundred characters, and the
 * database layer refuses a longer status message rather than cut it: the
 * row is not written, and an email that went is reported as failed. A mail
 * service's answer can be any length, so every message MailService writes is
 * held to the columns. MailServiceImagesRefused sends emails whose service
 * answers at length.
 */

describe("the columns a status message is written to", () => {
  test.each([
    ["the Email Log", new EmailLog()],
    ["the on-call timeline", new UserOnCallLogTimeline()],
  ])(
    "%s holds MAX_EMAIL_STATUS_MESSAGE_LENGTH characters",
    (_name: string, model: EmailLog | UserOnCallLogTimeline) => {
      const column: TableColumnMetadata =
        model.getTableColumnMetadata("statusMessage");

      expect(column.type).toBe(TableColumnType.LongText);
      expect(getMaxLengthFromTableColumnType(column.type)).toBe(
        MAX_EMAIL_STATUS_MESSAGE_LENGTH,
      );
    },
  );
});

describe("clipText", () => {
  test("a text that fits is left as it is, to the last character", () => {
    expect(clipText("Short.", 10)).toBe("Short.");
    expect(clipText("x".repeat(10), 10)).toBe("x".repeat(10));
    expect(clipText("", 10)).toBe("");
  });

  test("a longer text is cut to end with an ellipsis, as long as the limit allows", () => {
    const clipped: string = clipText("abcdefghijkl", 10);

    expect(clipped).toBe("abcdefghi…");
    expect(clipped).toHaveLength(10);
  });

  test("the cut drops the space it falls after", () => {
    expect(clipText("one two three four", 9)).toBe("one two…");
  });

  test("never between the two halves of a character outside the BMP", () => {
    // Each 😀 is two UTF-16 code units: a cut at 9 would split the fifth.
    const text: string = "😀".repeat(6);
    const clipped: string = clipText(text, 10);

    expect(clipped).toBe(`${"😀".repeat(4)}…`);
    expect(clipped.length).toBeLessThanOrEqual(10);
    expect(
      Array.from(clipped).every((character: string): boolean => {
        return character === "😀" || character === "…";
      }),
    ).toBe(true);
  });

  test("a limit too small for the ellipsis leaves nothing", () => {
    expect(clipText("abc", 0)).toBe("");
    expect(clipText("abc", 1)).toBe("…");
  });

  test("reads 400,000 characters in one pass", () => {
    const text: string = "a ".repeat(200000);
    const clipped: string = clipText(text, MAX_EMAIL_STATUS_MESSAGE_LENGTH);

    expect(clipped.length).toBeLessThanOrEqual(MAX_EMAIL_STATUS_MESSAGE_LENGTH);
    expect(clipped.endsWith("a…")).toBe(true);
  });
});

describe("toEmailStatusMessage", () => {
  test("what fits its column is written as it is", () => {
    expect(toEmailStatusMessage(EMAIL_SENT_STATUS_MESSAGE)).toBe(
      EMAIL_SENT_STATUS_MESSAGE,
    );
  });

  test("a longer answer keeps its start, in as many characters as the column holds", () => {
    const refusal: string = `SendGrid did not accept the email (HTTP 400 Bad Request). SendGrid said: ${"A reason. ".repeat(80)}`;
    const statusMessage: string = toEmailStatusMessage(refusal);

    expect(statusMessage.length).toBeLessThanOrEqual(
      MAX_EMAIL_STATUS_MESSAGE_LENGTH,
    );
    expect(statusMessage.length).toBeGreaterThan(
      MAX_EMAIL_STATUS_MESSAGE_LENGTH - 5,
    );
    expect(statusMessage.endsWith("…")).toBe(true);
    expect(refusal.startsWith(statusMessage.slice(0, -1))).toBe(true);
  });
});

describe("what every email that went says", () => {
  test("that it went, and that its delivery is not tracked", () => {
    expect(EMAIL_SENT_STATUS_MESSAGE).toBe(
      "Email sent successfully. This does not mean the email was delivered. We do not track email delivery. If the email was not delivered - it is likely due to the email address being invalid, user has blocked sending domain, or it could have landed in spam.",
    );
    expect(EMAIL_SENT_STATUS_MESSAGE.endsWith(EMAIL_DELIVERY_NOT_TRACKED)).toBe(
      true,
    );
  });

  test("in short, its first two sentences", () => {
    expect(EMAIL_DELIVERY_NOT_TRACKED_IN_SHORT).toBe(
      "This does not mean the email was delivered. We do not track email delivery.",
    );
    expect(
      EMAIL_DELIVERY_NOT_TRACKED.startsWith(
        `${EMAIL_DELIVERY_NOT_TRACKED_IN_SHORT} `,
      ),
    ).toBe(true);
  });
});

describe("getSentWithoutImagesStatusMessage", () => {
  test("the service's answer as one sentence, between that the email went and that its delivery is not tracked", () => {
    expect(getSentWithoutImagesStatusMessage("It said no")).toBe(
      `Email sent successfully without its images, which the mail service refused: It said no. ${EMAIL_DELIVERY_NOT_TRACKED}`,
    );
    expect(getSentWithoutImagesStatusMessage("It said no!")).toBe(
      `Email sent successfully without its images, which the mail service refused: It said no! ${EMAIL_DELIVERY_NOT_TRACKED}`,
    );
  });

  test("an answer with no words still makes a sentence", () => {
    expect(getSentWithoutImagesStatusMessage("   ")).toBe(
      `Email sent successfully without its images, which the mail service refused: it gave no reason. ${EMAIL_DELIVERY_NOT_TRACKED}`,
    );
  });

  test("the answer of issue #5308 fits whole", () => {
    const statusMessage: string = getSentWithoutImagesStatusMessage(
      "SendGrid did not accept the email (HTTP 400 Bad Request). SendGrid said: The content_id parameter is required if disposition = 'inline'. (attachments.0.content_id, attachments.1.content_id)",
    );

    expect(statusMessage).not.toContain("…");
    expect(statusMessage.length).toBeLessThanOrEqual(
      MAX_EMAIL_STATUS_MESSAGE_LENGTH,
    );
  });

  test("an answer too long to sit beside all that every sent email says sits whole beside its first two sentences", () => {
    const answer: string = `${"A reason SendGrid gave. ".repeat(12)}`.trim();
    const statusMessage: string = getSentWithoutImagesStatusMessage(answer);

    expect(
      `Email sent successfully without its images, which the mail service refused: ${answer} ${EMAIL_DELIVERY_NOT_TRACKED}`
        .length,
    ).toBeGreaterThan(MAX_EMAIL_STATUS_MESSAGE_LENGTH);
    expect(statusMessage).toBe(
      `Email sent successfully without its images, which the mail service refused: ${answer} ${EMAIL_DELIVERY_NOT_TRACKED_IN_SHORT}`,
    );
    expect(statusMessage.length).toBeLessThanOrEqual(
      MAX_EMAIL_STATUS_MESSAGE_LENGTH,
    );
  });

  test.each([1000, 400000])(
    "an answer of %s characters is cut to fit, and both ends of the message stay",
    (length: number) => {
      const statusMessage: string = getSentWithoutImagesStatusMessage(
        "x".repeat(length),
      );

      expect(statusMessage.length).toBeLessThanOrEqual(
        MAX_EMAIL_STATUS_MESSAGE_LENGTH,
      );
      expect(statusMessage.length).toBeGreaterThan(
        MAX_EMAIL_STATUS_MESSAGE_LENGTH - 5,
      );
      expect(
        statusMessage.startsWith(
          "Email sent successfully without its images, which the mail service refused: xxx",
        ),
      ).toBe(true);
      expect(
        statusMessage.endsWith(`x… ${EMAIL_DELIVERY_NOT_TRACKED_IN_SHORT}`),
      ).toBe(true);
    },
  );
});
