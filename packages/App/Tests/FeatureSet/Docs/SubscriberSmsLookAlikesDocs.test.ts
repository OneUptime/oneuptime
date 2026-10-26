import { writeDefaultSubscriberSms } from "Common/Utils/Sms/SubscriberSms";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Subscribers & Announcements, under "Email footer, custom SMTP and Twilio",
 * says how a status page's default text messages are written: in GSM-7's
 * characters, curly quotes and dashes as their plain look-alikes, an emoji
 * left out, links exactly as written - and that a custom SMS template goes
 * out as written. Held here to the code that writes them
 * (Common/Utils/Sms/SubscriberSms), and its place to every translation.
 */

const PACKAGES_DIRECTORY: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIRECTORY: string = path.join(
  PACKAGES_DIRECTORY,
  "App/FeatureSet/Docs/Content",
);

const PARAGRAPH: string =
  "The default text messages are written in the characters a text message carries most cheaply: curly quotes, dashes and the like go out as their plain look-alikes and an emoji is left out, so one character in a title never makes a text cost two or three parts. Links go out exactly as written. A custom SMS template goes out as you wrote it, with the values it places.";

const LANGUAGES: Array<string> = fs
  .readdirSync(CONTENT_DIRECTORY)
  .filter((entry: string): boolean => {
    return fs.existsSync(
      path.join(CONTENT_DIRECTORY, entry, "status-pages/subscribers.md"),
    );
  })
  .sort();

function lines(language: string): Array<string> {
  return fs
    .readFileSync(
      path.join(CONTENT_DIRECTORY, language, "status-pages/subscribers.md"),
      "utf8",
    )
    .split("\n");
}

describe("Subscribers & Announcements: how the default text messages are written", () => {
  test("every language has the page", () => {
    expect(LANGUAGES).toHaveLength(17);
    expect(LANGUAGES).toContain("en");
  });

  test("English says it right after custom SMTP, before Announcements", () => {
    const english: Array<string> = lines("en");
    const at: number = english.indexOf(PARAGRAPH);

    expect(at).toBeGreaterThan(0);
    expect(english[at - 2]).toContain("Custom SMTP is worth doing early");
    expect(english[at + 2]).toBe("## Announcements");
  });

  test("every translation says it on the same line, a paragraph of its own", () => {
    const at: number = lines("en").indexOf(PARAGRAPH);

    for (const language of LANGUAGES) {
      const translated: Array<string> = lines(language);

      expect({
        language,
        before: translated[at - 1],
        paragraph: (translated[at] || "").length > 40,
        after: translated[at + 1],
      }).toEqual({ language, before: "", paragraph: true, after: "" });
      expect(translated[at + 2]?.startsWith("## ")).toBe(true);
    }
  });

  test("what it says is what the code does", () => {
    const link: string =
      "https://status.acme.example/unsubscribe/5ab1ead0-0000-4000-8000-000000000002-0f1e2d";

    // Curly quotes and dashes as their plain look-alikes, an emoji left out.
    expect(
      writeDefaultSubscriberSms(
        `Incident Checkout’s “EU” API – down 🔥 on Acme. Unsub: ${link}`,
      ),
    ).toBe(`Incident Checkout's "EU" API - down on Acme. Unsub: ${link}`);
    // Links exactly as written.
    expect(writeDefaultSubscriberSms(`Unsub: ${link}–x`)).toBe(
      `Unsub: ${link}–x`,
    );
  });
});
