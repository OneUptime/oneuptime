import EmailReplyText from "../../../Utils/Email/EmailReplyText";
import { fastestRun } from "../../Helpers/FastestRun";
import { describe, expect, test } from "@jest/globals";

/*
 * What a reply to an email thread says, without the thread it quotes: the
 * text an Incoming Email monitor's reply note holds. Mail programs quote
 * the earlier emails below the reply - Gmail, Apple Mail and Thunderbird
 * with ">" lines under a line naming who wrote them, Outlook under a rule
 * and the quoted email's headers - so every note would otherwise say the
 * whole thread again.
 *
 * The text is written by whoever sent the email, so the reading is also
 * held to time in line with its length.
 */

// The longest a reading of 400,000 characters of its worst case may take.
const LINEAR_TIME_BUDGET_IN_MS: number = 2000;

/*
 * How long the work takes: the fastest of up to three attempts, counted as
 * it would have run on a usual runner when every attempt overran on a slow
 * one (Tests/Helpers/FastestRun).
 */
function timed(work: () => void): number {
  return fastestRun({ run: work, limitInMs: LINEAR_TIME_BUDGET_IN_MS }).inMs;
}

function lines(...text: Array<string>): string {
  return text.join("\n");
}

describe("EmailReplyText.getOwnText leaves out the thread a reply quotes", () => {
  test("Gmail: the quoted lines and the line naming their writer", () => {
    expect(
      EmailReplyText.getOwnText(
        lines(
          "Same here - floor 3 too.",
          "",
          "Thanks,",
          "Priya",
          "",
          "On Wed, Oct 15, 2026 at 9:02 AM Tom Becker <tom@acme.example> wrote:",
          "",
          "> The printer on floor 2 shows E-17.",
          "> Can someone take a look?",
          "",
        ),
      ),
    ).toBe(lines("Same here - floor 3 too.", "", "Thanks,", "Priya"));
  });

  test("Gmail wraps a long line naming the writer inside the address", () => {
    expect(
      EmailReplyText.getOwnText(
        lines(
          "Still down here.",
          "",
          "On Wed, Oct 15, 2026 at 9:02 AM Tom Becker from the Facilities Team <",
          "tom@acme.example> wrote:",
          "> The printer on floor 2 shows E-17.",
        ),
      ),
    ).toBe("Still down here.");
  });

  test("Apple Mail and Thunderbird: the same shape, with their own words", () => {
    expect(
      EmailReplyText.getOwnText(
        lines(
          "Fixed it.",
          "",
          "On Oct 15, 2026, at 9:02 AM, Tom Becker <tom@acme.example> wrote:",
          "",
          "> The printer on floor 2 shows E-17.",
        ),
      ),
    ).toBe("Fixed it.");

    expect(
      EmailReplyText.getOwnText(
        lines(
          "Fixed it.",
          "",
          "On 10/15/26 9:02 AM, Tom Becker wrote:",
          "> The printer on floor 2 shows E-17.",
        ),
      ),
    ).toBe("Fixed it.");
  });

  test("the iPhone's Mail: the line naming the writer is the quote's first line", () => {
    expect(
      EmailReplyText.getOwnText(
        lines(
          "Same here",
          "",
          "Sent from my iPhone",
          "",
          "> On Oct 15, 2026, at 9:02 AM, Tom Becker <tom@acme.example> wrote:",
          "> ",
          "> The printer on floor 2 shows E-17.",
        ),
      ),
    ).toBe(lines("Same here", "", "Sent from my iPhone"));
  });

  test("a mail program in another language names the writer its own way", () => {
    expect(
      EmailReplyText.getOwnText(
        lines(
          "Bei uns auch.",
          "",
          "Am 15.10.2026 um 09:02 schrieb Tom Becker <tom@acme.example>:",
          "> Der Drucker im 2. Stock zeigt E-17.",
        ),
      ),
    ).toBe("Bei uns auch.");

    expect(
      EmailReplyText.getOwnText(
        lines(
          "Pareil ici.",
          "",
          "Le mer. 15 oct. 2026 à 09:02, Tom Becker a écrit :",
          "> L'imprimante du 2e étage affiche E-17.",
        ),
      ),
    ).toBe("Pareil ici.");
  });

  test("a quote nested inside a quote goes with it", () => {
    expect(
      EmailReplyText.getOwnText(
        lines(
          "Third report.",
          "",
          "On Wed, Oct 15, 2026 at 9:30 AM Priya <priya@acme.example> wrote:",
          "> Same here.",
          ">",
          "> On Wed, Oct 15, 2026 at 9:02 AM Tom <tom@acme.example> wrote:",
          ">> The printer on floor 2 shows E-17.",
        ),
      ),
    ).toBe("Third report.");
  });

  test("Outlook: everything from its rule and the quoted email's headers on", () => {
    expect(
      EmailReplyText.getOwnText(
        lines(
          "Fixed on our side - the toner was the wrong type.",
          "",
          "Regards,",
          "Facilities",
          "",
          "________________________________",
          "From: Tom Becker <tom@acme.example>",
          "Sent: Wednesday, October 15, 2026 9:02 AM",
          "To: Office reports <reports@inbound.example>",
          "Subject: Printer on floor 2 shows E-17",
          "",
          "The printer on floor 2 shows error E-17.",
        ),
      ),
    ).toBe(
      lines(
        "Fixed on our side - the toner was the wrong type.",
        "",
        "Regards,",
        "Facilities",
      ),
    );
  });

  test("Outlook in another language: its rule, then a header of its own words", () => {
    expect(
      EmailReplyText.getOwnText(
        lines(
          "Erledigt.",
          "________________________________",
          "Von: Tom Becker <tom@acme.example>",
          "Gesendet: Mittwoch, 15. Oktober 2026 09:02",
          "",
          "Der Drucker zeigt E-17.",
        ),
      ),
    ).toBe("Erledigt.");
  });

  test("older Outlook: its Original Message line", () => {
    expect(
      EmailReplyText.getOwnText(
        lines(
          "On it.",
          "",
          "-----Original Message-----",
          "From: Tom Becker",
          "The printer on floor 2 shows E-17.",
        ),
      ),
    ).toBe("On it.");
  });

  test("Windows line endings are read as line breaks", () => {
    expect(
      EmailReplyText.getOwnText(
        "Same here.\r\n\r\nOn Wed, Oct 15, 2026 Tom <tom@acme.example> wrote:\r\n> E-17\r\n",
      ),
    ).toBe("Same here.");
  });
});

describe("EmailReplyText.getOwnText keeps what the sender wrote", () => {
  test("a reply that quotes nothing is kept whole, trimmed", () => {
    expect(
      EmailReplyText.getOwnText("\n  Still broken.\nError 41 again.  \n\n"),
    ).toBe("Still broken.\nError 41 again.");
  });

  test("answers written between the quoted lines are kept, quotes and all", () => {
    const body: string = lines(
      "On Wed, Oct 15, 2026 at 9:02 AM Tom <tom@acme.example> wrote:",
      "> Which floor?",
      "Floor 3.",
      "> Since when?",
      "Since 9am.",
    );

    expect(EmailReplyText.getOwnText(body)).toBe(body);
  });

  test("a reply that is all quote is kept whole: never shown empty", () => {
    const body: string = lines(
      "On Wed, Oct 15, 2026 at 9:02 AM Tom <tom@acme.example> wrote:",
      "> The printer on floor 2 shows E-17.",
    );

    expect(EmailReplyText.getOwnText(body)).toBe(body);
  });

  test("a quote no line names the writer of may be the sender's own, and stays", () => {
    const body: string = lines("This is what I see:", "> E-17 on the display");

    expect(EmailReplyText.getOwnText(body)).toBe(body);
    expect(
      EmailReplyText.getOwnText(lines("Same here.", "", "> E-17", "> again")),
    ).toBe(lines("Same here.", "", "> E-17", "> again"));
  });

  test("a line of underscores of the sender's own is kept, when no header follows", () => {
    const body: string = lines(
      "Fixed.",
      "____________________",
      "Priya Shah",
      "Facilities",
    );

    expect(EmailReplyText.getOwnText(body)).toBe(body);
  });

  test("a forwarded email is kept: it is what the reply brings", () => {
    const body: string = lines(
      "See the vendor's answer below.",
      "",
      "---------- Forwarded message ---------",
      "From: Vendor Support <support@vendor.example>",
      "Date: Wed, Oct 15, 2026 at 10:00 AM",
      "",
      "Replace the toner cartridge with model T-4.",
    );

    expect(EmailReplyText.getOwnText(body)).toBe(body);
  });

  test("nothing at all reads as nothing", () => {
    expect(EmailReplyText.getOwnText("")).toBe("");
    expect(EmailReplyText.getOwnText("  \n \n")).toBe("");
    expect(EmailReplyText.getOwnText(null)).toBe("");
    expect(EmailReplyText.getOwnText(undefined)).toBe("");
  });
});

describe("EmailReplyText.getOwnText takes time in line with the text", () => {
  test.each([
    ["a quote of 100,000 lines", "> quoted\n".repeat(100000)],
    ["one line of 400,000 underscores", "_".repeat(400000)],
    ["100,000 rules with no header after them", "__________\n".repeat(40000)],
    ["a line of 400,000 colons", ":".repeat(400000)],
    [
      "100,000 lines naming a writer, each above a quote",
      "On 1 a@b wrote:\n> x\n".repeat(25000),
    ],
    ["400,000 line breaks", "\n".repeat(400000)],
  ])("%s", (_name: string, body: string) => {
    expect(
      timed(() => {
        EmailReplyText.getOwnText(body);
      }),
    ).toBeLessThan(LINEAR_TIME_BUDGET_IN_MS);
  });
});
