import { describe, expect, test } from "@jest/globals";
import {
  buildNotificationSms,
  fitNotificationSmsForSending,
  NOTIFICATION_SMS_SENDER,
  NOTIFICATION_SMS_TURN_OFF,
} from "../../../Utils/Sms/NotificationSms";
import {
  countSmsSegments,
  isGsm7Text,
  SmsEncoding,
} from "../../../Utils/Sms/SmsSegments";
import ProductBrandingUtil, {
  ONEUPTIME_PRODUCT_NAME,
} from "../../../Types/Branding/ProductBranding";

/*
 * THE TEXT MESSAGES A TEAM MEMBER CHOSE TO GET (Utils/Sms/NotificationSms).
 *
 * "OneUptime: <what happened> Turn off in User Settings > Notification
 * Settings." - in place of "This is a message from OneUptime. ... To
 * unsubscribe from this notification go to User Settings in OneUptime
 * Dashboard.", whose 116 characters made every one of them two parts. As it
 * goes out, the text is written in GSM-7's characters (links as they are),
 * and the turn-off sentence is left out when that is what makes it fit in
 * one part.
 */

const OLD_BOILERPLATE_LENGTH: number =
  "This is a message from OneUptime. ".length +
  " To unsubscribe from this notification go to User Settings in OneUptime Dashboard."
    .length;

describe("buildNotificationSms", () => {
  test("says who sends it first and where to turn it off last", () => {
    expect(NOTIFICATION_SMS_SENDER).toBe(ONEUPTIME_PRODUCT_NAME);
    expect(NOTIFICATION_SMS_TURN_OFF).toBe(
      "Turn off in User Settings > Notification Settings.",
    );
    expect(
      buildNotificationSms(
        "Incident INC-42 (Checkout API is down) is now Acknowledged.",
      ),
    ).toBe(
      "OneUptime: Incident INC-42 (Checkout API is down) is now Acknowledged. Turn off in User Settings > Notification Settings.",
    );
  });

  test("trims the sentence it is given", () => {
    expect(buildNotificationSms("  You are now on call for Payments.\n")).toBe(
      "OneUptime: You are now on call for Payments. Turn off in User Settings > Notification Settings.",
    );
  });

  test("its words take 62 places around the news, where the old ones took 116", () => {
    const words: number = buildNotificationSms("x").length - "x".length;

    expect(OLD_BOILERPLATE_LENGTH).toBe(116);
    expect(words).toBe(62);
  });

  test("so a typical one fits in one part", () => {
    const text: string = buildNotificationSms(
      "Incident INC-21033 (Checkout API is offline) state changed from Identified to Acknowledged.",
    );

    expect(countSmsSegments(text)).toEqual({
      encoding: SmsEncoding.Gsm7,
      length: text.length,
      segments: 1,
    });
  });
});

describe("fitNotificationSmsForSending", () => {
  test("a text that fits is sent as written", () => {
    const text: string = buildNotificationSms("You are now on call for Payments.");

    expect(fitNotificationSmsForSending(text)).toBe(text);
  });

  test("writes the text in GSM-7's characters, its links as they are", () => {
    const text: string = buildNotificationSms(
      "SLO \u{201C}Checkout\u{201D} \u{2013} 99.9%: https://oneuptime.com/dashboard/\u{00E9}",
    );
    const sent: string = fitNotificationSmsForSending(text);

    expect(sent).toBe(
      'OneUptime: SLO "Checkout" - 99.9%: https://oneuptime.com/dashboard/\u{00E9} Turn off in User Settings > Notification Settings.',
    );
  });

  test("leaves the turn-off sentence out when that makes it one part", () => {
    // 106 characters of news: 169 with the words, 118 without the sentence.
    const news: string = `Incident INC-42 (${"x".repeat(70)}) is now Acknowledged.`;
    const text: string = buildNotificationSms(news);

    expect(countSmsSegments(text).segments).toBe(2);
    expect(fitNotificationSmsForSending(text)).toBe(`OneUptime: ${news}`);
    expect(
      countSmsSegments(fitNotificationSmsForSending(text)).segments,
    ).toBe(1);
  });

  test("keeps it when even without it the text takes two parts", () => {
    const text: string = buildNotificationSms(`${"y".repeat(200)}.`);

    expect(fitNotificationSmsForSending(text)).toBe(text);
  });

  test("keeps a text that does not end with it as it is", () => {
    const text: string = `SLO breached: ${"z".repeat(200)}`;

    expect(fitNotificationSmsForSending(text)).toBe(text);
  });

  test("measures the text as the send path renames it", () => {
    const renamed: (text: string) => string = (text: string): string => {
      return ProductBrandingUtil.replaceProductName(
        text,
        "Acme Corporation Monitoring Platform",
      );
    };
    // 150 characters as written: one part. 177 renamed: two.
    const text: string = buildNotificationSms(`${"w".repeat(85)}.`);

    expect(countSmsSegments(text).segments).toBe(1);
    expect(fitNotificationSmsForSending(text)).toBe(text);
    expect(fitNotificationSmsForSending(text, renamed)).toBe(
      `OneUptime: ${"w".repeat(85)}.`,
    );
  });

  test("a sentence in another script is kept as written, in UCS-2", () => {
    const text: string = buildNotificationSms(
      "\u{0421}\u{0435}\u{0440}\u{0432}\u{0438}\u{0441}.",
    );
    const sent: string = fitNotificationSmsForSending(text);

    expect(sent).toContain("\u{0421}\u{0435}\u{0440}\u{0432}\u{0438}\u{0441}.");
    expect(isGsm7Text(sent)).toBe(false);
  });
});
