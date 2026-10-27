import EmailThreadHeaders, {
  MAX_MESSAGE_ID_LENGTH,
  MAX_REFERENCED_MESSAGE_IDS,
  ThreadIds,
} from "../../../Utils/Email/EmailThreadHeaders";
import Dictionary from "../../../Types/Dictionary";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { fastestRun } from "../../Helpers/FastestRun";
import { describe, expect, test } from "@jest/globals";

/*
 * What an email's headers say about it, as an Incoming Email monitor that
 * opens an incident for every email reads them: which email it is
 * (Message-ID), which emails it answers (In-Reply-To, References), and
 * whether a program sent it as an automatic reply.
 *
 * Every header here is written by whoever sent the email, so each reading is
 * also held to time in line with the header's length.
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

describe("EmailThreadHeaders.getHeader", () => {
  test("finds a header whatever the case of its name", () => {
    const headers: Dictionary<string> = { "Message-Id": "<a@example.com>" };

    expect(EmailThreadHeaders.getHeader(headers, "Message-ID")).toBe(
      "<a@example.com>",
    );
    expect(EmailThreadHeaders.getHeader(headers, "message-id")).toBe(
      "<a@example.com>",
    );
  });

  test("a name written with spaces around it is the same name", () => {
    expect(
      EmailThreadHeaders.getHeader({ " In-Reply-To ": "<a@b>" }, "In-Reply-To"),
    ).toBe("<a@b>");
  });

  test("of two names that differ only in case, the first wins", () => {
    expect(
      EmailThreadHeaders.getHeader(
        { "Message-ID": "<first@x>", "message-id": "<second@x>" },
        "Message-ID",
      ),
    ).toBe("<first@x>");
  });

  test("no headers, no such header, or a value that is not text: undefined", () => {
    expect(EmailThreadHeaders.getHeader(undefined, "Message-ID")).toBe(
      undefined,
    );
    expect(EmailThreadHeaders.getHeader(null, "Message-ID")).toBe(undefined);
    expect(EmailThreadHeaders.getHeader({}, "Message-ID")).toBe(undefined);
    expect(
      EmailThreadHeaders.getHeader(
        { "Message-ID": 42 as unknown as string },
        "Message-ID",
      ),
    ).toBe(undefined);
  });
});

describe("EmailThreadHeaders.getMessageId", () => {
  test("reads the id out of its angle brackets", () => {
    expect(
      EmailThreadHeaders.getMessageId({
        "Message-ID": "<CAJ8sB2x+Yz@mail.gmail.com>",
      }),
    ).toBe("CAJ8sB2x+Yz@mail.gmail.com");
  });

  test("keeps the id's case: two ids that differ in case are two emails", () => {
    expect(
      EmailThreadHeaders.getMessageId({ "Message-ID": "<AbC@Example.COM>" }),
    ).toBe("AbC@Example.COM");
  });

  test("reads a header folded onto the next line, as the parser joins it", () => {
    expect(
      EmailThreadHeaders.getMessageId({
        "Message-ID": " <BY5PR04MB1234.namprd04.prod.outlook.com>",
      }),
    ).toBe("BY5PR04MB1234.namprd04.prod.outlook.com");
  });

  test("an id written without brackets is taken when it is one word", () => {
    expect(
      EmailThreadHeaders.getMessageId({
        "Message-ID": "  12345@legacy.example ",
      }),
    ).toBe("12345@legacy.example");
  });

  test("of two bracketed ids the first counts, and a comment after it is ignored", () => {
    expect(
      EmailThreadHeaders.getMessageId({
        "Message-ID": "<one@x> (sent by a script) <two@x>",
      }),
    ).toBe("one@x");
  });

  test("no Message-ID, an empty one, or one that is not one word: null", () => {
    expect(EmailThreadHeaders.getMessageId(undefined)).toBe(null);
    expect(EmailThreadHeaders.getMessageId({})).toBe(null);
    expect(EmailThreadHeaders.getMessageId({ "Message-ID": "" })).toBe(null);
    expect(EmailThreadHeaders.getMessageId({ "Message-ID": "<>" })).toBe(null);
    expect(EmailThreadHeaders.getMessageId({ "Message-ID": "   " })).toBe(null);
    expect(
      EmailThreadHeaders.getMessageId({ "Message-ID": "two words@example" }),
    ).toBe(null);
  });

  test("an id longer than a header line, or holding a control character, is no id", () => {
    const tooLong: string = "a".repeat(MAX_MESSAGE_ID_LENGTH + 1);

    expect(
      EmailThreadHeaders.getMessageId({ "Message-ID": `<${tooLong}>` }),
    ).toBe(null);
    expect(
      EmailThreadHeaders.getMessageId({
        "Message-ID": `<${"a".repeat(MAX_MESSAGE_ID_LENGTH)}>`,
      }),
    ).toBe("a".repeat(MAX_MESSAGE_ID_LENGTH));
    expect(
      EmailThreadHeaders.getMessageId({ "Message-ID": "<a\u0000b@x>" }),
    ).toBe(null);
    expect(
      EmailThreadHeaders.getMessageId({ "Message-ID": "<a\u007fb@x>" }),
    ).toBe(null);
  });
});

describe("EmailThreadHeaders.readMessageIds", () => {
  test("reads every bracketed id in order, skipping the text between", () => {
    expect(
      EmailThreadHeaders.readMessageIds(
        "<a@x>\t<b@x> (comment) <c@x>",
        Number.MAX_SAFE_INTEGER,
      ),
    ).toEqual(["a@x", "b@x", "c@x"]);
  });

  test("a second opening bracket starts the id again", () => {
    expect(
      EmailThreadHeaders.readMessageIds("<a<b@x>", Number.MAX_SAFE_INTEGER),
    ).toEqual(["b@x"]);
  });

  test("a closing bracket with no opening one, and an id never closed, are nothing", () => {
    expect(
      EmailThreadHeaders.readMessageIds("a@x> <b@x", Number.MAX_SAFE_INTEGER),
    ).toEqual([]);
  });

  test("stops at its limit", () => {
    expect(EmailThreadHeaders.readMessageIds("<a><b><c>", 2)).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("EmailThreadHeaders.readThread", () => {
  // What the ring must hold: every id, then the first and the newest `keep`.
  function naive(value: string, keep: number): ThreadIds {
    const all: Array<string> = EmailThreadHeaders.readMessageIds(
      value,
      Number.MAX_SAFE_INTEGER,
    );

    return {
      first: all[0] || null,
      newest: keep > 0 ? all.slice(Math.max(0, all.length - keep)) : [],
    };
  }

  test("a short thread is kept whole, oldest first", () => {
    expect(EmailThreadHeaders.readThread("<a> <b> <c>", 10)).toEqual({
      first: "a",
      newest: ["a", "b", "c"],
    });
  });

  test("a long thread keeps its first email and its newest ones", () => {
    const ids: Array<string> = Array.from(
      { length: 250 },
      (_: unknown, index: number): string => {
        return `id-${index}@x`;
      },
    );

    const thread: ThreadIds = EmailThreadHeaders.readThread(
      ids
        .map((id: string): string => {
          return `<${id}>`;
        })
        .join(" "),
      100,
    );

    expect(thread.first).toBe("id-0@x");
    expect(thread.newest).toEqual(ids.slice(150));
  });

  test("keeps exactly what reading every id and taking the newest would, for any length", () => {
    const random: SeededRandom = seededRandom(5309);

    for (let round: number = 0; round < 300; round++) {
      const count: number = random(40);
      const keep: number = random(12);
      const value: string = Array.from(
        { length: count },
        (_: unknown, index: number): string => {
          return `<m${index}-${random(1000)}@x>`;
        },
      ).join(random(2) === 0 ? " " : "");

      expect({
        round,
        thread: EmailThreadHeaders.readThread(value, keep),
      }).toEqual({ round, thread: naive(value, keep) });
    }
  });

  test("an empty header has no thread", () => {
    expect(EmailThreadHeaders.readThread("", 100)).toEqual({
      first: null,
      newest: [],
    });
  });
});

describe("EmailThreadHeaders.getReferencedMessageIds", () => {
  test("a reply answers the email in In-Reply-To first, then its thread", () => {
    expect(
      EmailThreadHeaders.getReferencedMessageIds({
        "Message-ID": "<reply-2@x>",
        "In-Reply-To": "<reply-1@x>",
        References: "<root@x> <reply-1@x>",
      }),
    ).toEqual(["reply-1@x", "root@x"]);
  });

  test("lists the thread's first email, then its newest, newest first", () => {
    expect(
      EmailThreadHeaders.getReferencedMessageIds({
        References: "<root@x> <second@x> <third@x>",
      }),
    ).toEqual(["root@x", "third@x", "second@x"]);
  });

  test("never lists the email's own id, nor one id twice", () => {
    expect(
      EmailThreadHeaders.getReferencedMessageIds({
        "Message-ID": "<self@x>",
        "In-Reply-To": "<root@x>",
        References: "<root@x> <self@x> <root@x>",
      }),
    ).toEqual(["root@x"]);
  });

  test("an email that answers nothing lists nothing", () => {
    expect(
      EmailThreadHeaders.getReferencedMessageIds({ "Message-ID": "<new@x>" }),
    ).toEqual([]);
    expect(EmailThreadHeaders.getReferencedMessageIds(undefined)).toEqual([]);
  });

  test("a thread of thousands of emails lists at most the cap, keeping the email replied to and the first one", () => {
    const references: string = Array.from(
      { length: 5000 },
      (_: unknown, index: number): string => {
        return `<t${index}@x>`;
      },
    ).join(" ");

    const referenced: Array<string> =
      EmailThreadHeaders.getReferencedMessageIds({
        "In-Reply-To": "<t4999@x>",
        References: references,
      });

    expect(referenced).toHaveLength(MAX_REFERENCED_MESSAGE_IDS);
    expect(referenced[0]).toBe("t4999@x");
    expect(referenced[1]).toBe("t0@x");
    expect(referenced[2]).toBe("t4998@x");
    expect(new Set(referenced).size).toBe(referenced.length);
  });
});

describe("EmailThreadHeaders.isAutomaticReply", () => {
  test.each([
    ["Auto-Submitted", "auto-replied"],
    ["Auto-Submitted", "auto-replied; reason=vacation"],
    ["auto-submitted", "AUTO-REPLIED"],
    ["Auto-Submitted", " auto-notified "],
    ["X-Autoreply", "yes"],
    ["X-Autoreply", "true"],
    ["X-Autorespond", "Out of office"],
    ["X-Autorespond", ""],
    ["Precedence", "auto_reply"],
    ["precedence", " AUTO_REPLY "],
  ])("%s: %s is an automatic reply", (name: string, value: string) => {
    expect(EmailThreadHeaders.isAutomaticReply({ [name]: value })).toBe(true);
  });

  test.each([
    // What monitoring systems send their reports with: exactly a monitor's email.
    ["Auto-Submitted", "auto-generated"],
    ["Auto-Submitted", "no"],
    ["X-Autoreply", "no"],
    // Mailing lists and bulk mail are not replies; an address on a list keeps working.
    ["Precedence", "bulk"],
    ["Precedence", "list"],
    ["Precedence", "junk"],
    ["Subject", "Automatic reply: out of office"],
  ])("%s: %s is not", (name: string, value: string) => {
    expect(EmailThreadHeaders.isAutomaticReply({ [name]: value })).toBe(false);
  });

  test("an email with no headers is not", () => {
    expect(EmailThreadHeaders.isAutomaticReply(undefined)).toBe(false);
    expect(EmailThreadHeaders.isAutomaticReply({})).toBe(false);
  });
});

describe("Every reading takes time in line with the header's length", () => {
  const SIZE: number = 400000;

  const worstCases: Array<[string, string]> = [
    ["only opening brackets", "<".repeat(SIZE)],
    ["only closing brackets", ">".repeat(SIZE)],
    ["an id never closed", `<${"a".repeat(SIZE)}`],
    ["opening brackets and letters", "<a".repeat(SIZE / 2)],
    ["empty ids", "<>".repeat(SIZE / 2)],
    ["one-letter ids", "<a>".repeat(SIZE / 3)],
    ["one id the length of the header", `<${"a".repeat(SIZE)}>`],
    ["spaced ids", "< a >".repeat(SIZE / 5)],
  ];

  test.each(worstCases)("%s", (_name: string, value: string) => {
    const headers: Dictionary<string> = {
      "Message-ID": value,
      "In-Reply-To": value,
      References: value,
      "Auto-Submitted": value,
    };

    const elapsed: number = timed((): void => {
      EmailThreadHeaders.getMessageId(headers);
      EmailThreadHeaders.getReferencedMessageIds(headers);
      EmailThreadHeaders.isAutomaticReply(headers);
      EmailThreadHeaders.readThread(value, MAX_REFERENCED_MESSAGE_IDS);
    });

    expect(elapsed).toBeLessThan(LINEAR_TIME_BUDGET_IN_MS);
  });

  test("a References header of a hundred thousand ids keeps only the cap", () => {
    const value: string = "<a@x> ".repeat(100000);
    const thread: ThreadIds = EmailThreadHeaders.readThread(
      value,
      MAX_REFERENCED_MESSAGE_IDS,
    );

    expect(thread.newest).toHaveLength(MAX_REFERENCED_MESSAGE_IDS);
    expect(thread.first).toBe("a@x");
  });
});
