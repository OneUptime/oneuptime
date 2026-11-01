import { writeDefaultSubscriberSms } from "../../../Utils/Sms/SubscriberSms";
import { SmsEncoding, countSmsSegments } from "../../../Utils/Sms/SmsSegments";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import { describe, expect, test } from "@jest/globals";

/*
 * THE TEXT MESSAGES A STATUS PAGE'S SUBSCRIBERS GET, AS ONEUPTIME WRITES THEM
 * (Utils/Sms/SubscriberSms). One curly apostrophe, en dash or emoji in a
 * title or a page's name made every subscriber's text UCS-2 - 70 characters
 * a part instead of 160 - so each cost two or three parts. Pinned: the
 * look-alikes, the links exactly as written, other scripts kept.
 */

const DETAILS: string =
  "https://status.acme.example/incidents/5ab1ead0-0000-4000-8000-000000000001";
const UNSUBSCRIBE: string =
  "https://status.acme.example/unsubscribe/5ab1ead0-0000-4000-8000-000000000002-0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0";

const incidentSms: (title: string, page?: string) => string = (
  title: string,
  page?: string,
): string => {
  return `Incident ${title} (Critical) on ${page || "Acme Status"}. Impact: Checkout API. Details: ${DETAILS}. Unsub: ${UNSUBSCRIBE}`;
};

describe("writeDefaultSubscriberSms", () => {
  test("a text in GSM-7 already is sent exactly as it is", () => {
    const text: string = incidentSms("Checkout requests failing");

    expect(writeDefaultSubscriberSms(text)).toBe(text);
  });

  test("curly quotes, dashes and an emoji in a title become plain look-alikes", () => {
    expect(
      writeDefaultSubscriberSms(incidentSms("Checkout’s “EU” API – down 🔥")),
    ).toBe(incidentSms(`Checkout's "EU" API - down`));
  });

  test("so the text goes out in GSM-7, in three parts where it took five", () => {
    const before: string = incidentSms("Checkout’s API – down");
    const after: string = writeDefaultSubscriberSms(before);

    expect(countSmsSegments(before).encoding).toBe(SmsEncoding.Ucs2);
    expect(countSmsSegments(before).segments).toBe(5);
    expect(countSmsSegments(after).encoding).toBe(SmsEncoding.Gsm7);
    expect(countSmsSegments(after).segments).toBe(3);
  });

  test("a status page's name is written the same way", () => {
    expect(
      writeDefaultSubscriberSms(incidentSms("API down", "Acme’s Status")),
    ).toBe(incidentSms("API down", "Acme's Status"));
  });

  test("the links - the details link and the unsubscribe token link - go out exactly as written", () => {
    const written: string = writeDefaultSubscriberSms(
      incidentSms("Checkout’s API – down"),
    );

    expect(written).toContain(`Details: ${DETAILS}.`);
    expect(written.endsWith(`Unsub: ${UNSUBSCRIBE}`)).toBe(true);
  });

  test("a link with characters a look-alike would change is never touched", () => {
    const link: string = "https://status.acme.example/incidents/caf%C3%A9–1";
    const written: string = writeDefaultSubscriberSms(
      `Incident – x. Details: ${link}`,
    );

    expect(written).toBe(`Incident - x. Details: ${link}`);
  });

  test("letters of other scripts are kept as written", () => {
    expect(writeDefaultSubscriberSms(incidentSms("Сбой оплаты"))).toBe(
      incidentSms("Сбой оплаты"),
    );
    expect(writeDefaultSubscriberSms(incidentSms("決済の障害"))).toBe(
      incidentSms("決済の障害"),
    );
  });

  test("no double space is left where a character was left out, or where a value was empty", () => {
    expect(writeDefaultSubscriberSms(incidentSms("API 🔥 down"))).toBe(
      incidentSms("API down"),
    );
    expect(writeDefaultSubscriberSms(incidentSms(""))).toBe(
      `Incident (Critical) on Acme Status. Impact: Checkout API. Details: ${DETAILS}. Unsub: ${UNSUBSCRIBE}`,
    );
  });

  test("an empty text stays empty", () => {
    expect(writeDefaultSubscriberSms("")).toBe("");
  });

  /*
   * A subscriber written to in Chinese, Japanese or Persian gets a text in
   * UCS-2 whatever its punctuation, and a look-alike costs the same there:
   * "事件：Acme" stays as written instead of "事件:Acme".
   */
  test("a text in another script keeps its own punctuation, in as many parts", () => {
    const chinese: string = `\u{4E8B}\u{4EF6}\u{FF1A}Acme Status \u{4E0A}\u{7684} Checkout\u{FF08}\u{91CD}\u{5927}\u{4E8B}\u{4EF6}\u{FF09}\u{3002}\u{8BE6}\u{60C5}\u{FF1A} ${DETAILS} \u{3002}\u{9000}\u{8BA2}\u{FF1A} ${UNSUBSCRIBE}`;
    const written: string = writeDefaultSubscriberSms(chinese);

    expect(written).toBe(chinese);
    expect(countSmsSegments(written).encoding).toBe(SmsEncoding.Ucs2);
    expect(countSmsSegments(written).segments).toBe(
      countSmsSegments(chinese.replace(/\u{FF1A}/gu, ":")).segments,
    );
  });

  test("an emoji is still left out of it", () => {
    expect(
      writeDefaultSubscriberSms(
        `\u{4E8B}\u{4EF6}\u{FF1A}\u{652F}\u{4ED8}\u{1F525}\u{3002} ${DETAILS}`,
      ),
    ).toBe(`\u{4E8B}\u{4EF6}\u{FF1A}\u{652F}\u{4ED8}\u{3002} ${DETAILS}`);
  });

  test("a Persian text keeps the isolates around an English title, so its bracket stays at its end", () => {
    const persian: string = `\u{062D}\u{0627}\u{062F}\u{062B}\u{0647} \u{2068}Checkout (EU)\u{2069} \u{062F}\u{0631} \u{2068}Acme Status\u{2069}. ${DETAILS}`;

    expect(writeDefaultSubscriberSms(persian)).toBe(persian);
  });

  test("a text whose words are Latin is written with look-alikes, whatever its link holds", () => {
    expect(
      writeDefaultSubscriberSms(
        `Incident \u{201C}EU\u{201D} \u{2013} down. Details: ${DETAILS}`,
      ),
    ).toBe(`Incident "EU" - down. Details: ${DETAILS}`);
  });

  test("400,000 characters of another script, emoji and spaces take well under two seconds", () => {
    const worst: string = "\u{4E8B}\u{FF1A}\u{1F525} ".repeat(100000);
    const written: FastestRun<string> = fastestRun({
      run: (): string => {
        return writeDefaultSubscriberSms(worst);
      },
      limitInMs: 2000,
    });

    expect(written.result.startsWith("\u{4E8B}\u{FF1A} \u{4E8B}")).toBe(true);
    expect(written.inMs).toBeLessThan(2000);
  });

  test("400,000 characters of look-alikes, emoji and spaces take well under two seconds", () => {
    const worst: string = "\u{2019}\u{1F525}\u{2013} ".repeat(100000);
    // The fastest of up to three attempts: one timing on a busy runner is noisy.
    const written: FastestRun<string> = fastestRun({
      run: (): string => {
        return writeDefaultSubscriberSms(worst);
      },
      limitInMs: 2000,
    });

    expect(written.result.startsWith("'- '- ")).toBe(true);
    expect(written.inMs).toBeLessThan(2000);
  });
});
