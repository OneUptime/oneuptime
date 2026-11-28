import { describe, expect, test } from "@jest/globals";
import {
  CODE_VOCABULARY,
  NAME_LIKE_ACRONYMS,
  NAME_LIKE_WORDS,
  TECHNOLOGY_NAMES,
  identifierParts,
  inflectionsOf,
  isCodeWord,
  isNameLike,
  isVocabularyWord,
} from "../../../Utils/DataSecurity/CodeWords";
import { FAMILY_NAMES, GIVEN_NAMES } from "./PeopleNames";

/*
 * THE WORDS CODE WRITES ITS LOG LINES WITH (#11098).
 *
 * A template read from one record keeps only the words of this vocabulary,
 * so the vocabulary must hold none of the words a record could put there of
 * a person: no name, as a template writes one, and no word about a person's
 * health, beliefs, family or body. And it must hold the words log lines,
 * messages and span names are made of, or the code agent loses what it
 * finds the line by.
 */

const START: { atSentenceStart: boolean } = { atSentenceStart: true };
const MIDDLE: { atSentenceStart: boolean } = { atSentenceStart: false };

// English's two-letter words that are also family names ("He", "Do"): no one is named by one alone.
function isTwoLetterWord(name: string): boolean {
  const lower: string = name.toLowerCase();

  return lower.length <= 2 && CODE_VOCABULARY.has(lower);
}

const PEOPLE: ReadonlyArray<string> = Array.from(
  new Set([...GIVEN_NAMES, ...FAMILY_NAMES]),
).filter((name: string): boolean => {
  return name.length > 0;
});

describe("no person's name is kept as a template writes one", () => {
  test("the list of names is long enough to mean something", () => {
    expect(PEOPLE.length).toBeGreaterThan(900);
  });

  test("capitalized, at a sentence's start or in its middle", () => {
    const kept: Array<string> = PEOPLE.filter((name: string): boolean => {
      return (
        !isTwoLetterWord(name) &&
        (isCodeWord(name, START) || isCodeWord(name, MIDDLE))
      );
    });

    expect(kept).toEqual([]);
  });

  test("in capitals, but for the acronyms code writes so (RAM, MAX, PING)", () => {
    const kept: Array<string> = PEOPLE.filter((name: string): boolean => {
      const capitals: string = name.toUpperCase();

      return (
        !isTwoLetterWord(name) &&
        !NAME_LIKE_ACRONYMS.has(name.toLowerCase()) &&
        (isCodeWord(capitals, START) || isCodeWord(capitals, MIDDLE))
      );
    });

    expect(kept).toEqual([]);
  });

  test("in lower case, only the vocabulary's words that are names too, each listed", () => {
    const kept: Array<string> = PEOPLE.map((name: string): string => {
      return name.toLowerCase();
    }).filter((lower: string): boolean => {
      return (
        !isTwoLetterWord(lower) &&
        isCodeWord(lower, MIDDLE) &&
        !isNameLike(lower)
      );
    });

    expect(kept).toEqual([]);
  });

  test("as an identifier of names alone, however they are joined", () => {
    for (const word of [
      "AdaLovelace",
      "ada_lovelace",
      "ada.lovelace",
      "ada-lovelace",
      "GraceHopper",
      "WillSmith",
      "bill_price",
      "Grant-Page",
      "MarkPrice",
    ]) {
      expect({ word, kept: isCodeWord(word, MIDDLE) }).toEqual({
        word,
        kept: false,
      });
    }
  });

  test("in another script, or with a letter beyond ASCII", () => {
    for (const word of [
      "José",
      "Łukasz",
      "Müller",
      "Ольга",
      "张伟",
      "محمد",
      "Αλέξης",
      "für",
    ]) {
      expect(isCodeWord(word, START)).toBe(false);
      expect(isCodeWord(word, MIDDLE)).toBe(false);
    }
  });

  test("every name-like word is one the vocabulary would keep, or it need not be listed", () => {
    const unneeded: Array<string> = Array.from(NAME_LIKE_WORDS).filter(
      (word: string): boolean => {
        return !isVocabularyWord(word);
      },
    );

    expect(unneeded).toEqual([]);
  });

  test("a name-like word is kept in lower case, and inside an identifier beside a word that is none", () => {
    expect(isCodeWord("will", MIDDLE)).toBe(true);
    expect(isCodeWord("page", MIDDLE)).toBe(true);
    expect(isCodeWord("Will", START)).toBe(false);
    expect(isCodeWord("Page", START)).toBe(false);
    expect(isCodeWord("WILL", START)).toBe(false);
    expect(isCodeWord("willRetry", MIDDLE)).toBe(true);
    expect(isCodeWord("getPrice", MIDDLE)).toBe(true);
    expect(isCodeWord("page_size", MIDDLE)).toBe(true);
    // Inflections of a name-like word are names too: "Wills", "Parker", "Banks".
    expect(isCodeWord("Wills", START)).toBe(false);
    expect(isCodeWord("Parker", START)).toBe(false);
    expect(isCodeWord("Banks", START)).toBe(false);
    expect(isCodeWord("banks", MIDDLE)).toBe(true);
  });

  test("an acronym that is also a name is kept in capitals only", () => {
    for (const acronym of NAME_LIKE_ACRONYMS) {
      expect(isCodeWord(acronym.toUpperCase(), MIDDLE)).toBe(true);
      expect(isCodeWord(acronym, MIDDLE)).toBe(true);
      expect(
        isCodeWord(acronym[0]!.toUpperCase() + acronym.slice(1), START),
      ).toBe(false);
    }
  });
});

describe("no word about a person is in the vocabulary", () => {
  test("their health, beliefs, family, body, sex, origin or crimes", () => {
    const kept: Array<string> = [
      "wife husband son daughter mother father brother sister baby pregnant",
      "pregnancy divorce divorced married widow boyfriend girlfriend partner's",
      "cancer diabetes hiv aids asthma depression anxiety autism dementia",
      "disease diagnosis diagnosed illness sick tumor therapy medication",
      "surgery disabled disability wheelchair blind deaf injury hospital",
      "patient doctor prescription allergy allergic religion religious",
      "christian muslim jewish hindu buddhist atheist catholic church mosque",
      "synagogue pray prayer gay lesbian bisexual transgender trans queer",
      "straight sexual sex sexuality race racial black white asian hispanic",
      "latino immigrant refugee citizenship arrested arrest prison convicted",
      "criminal crime felony lawsuit union unionized pregnant vote voted",
      "republican democrat conservative liberal communist salary salaries",
      "income debt bankrupt bankruptcy weight height naked nude",
      // What the inflections and prefixes could make of the vocabulary's words.
      "depressed depressing disorder disorders overweight underweight unwell",
      "disabilities",
    ]
      .join(" ")
      .split(" ")
      .filter((word: string): boolean => {
        return isVocabularyWord(word);
      });

    /*
     * Kept as the words of code they also are - SQL's UNION, a race
     * condition, a disabled feature, a row's height, a font's weight, a
     * ledger's debt - and a word alone says nothing of anyone.
     */
    expect(kept.sort()).toEqual([
      "debt",
      "disabled",
      "height",
      "race",
      "union",
      "weight",
    ]);
  });
});

describe("a word is read with its inflections, its prefixes and as an identifier's parts", () => {
  test("inflected: -s, -es, -ies, -ed, -ied, -ing, -er, -ers, -ly", () => {
    for (const word of [
      "retries",
      "retried",
      "retrying",
      "declined",
      "stopped",
      "stopping",
      "handlers",
      "handler",
      "matches",
      "caches",
      "processes",
      "workers",
      "successfully",
      "creating",
      "committed",
      "entries",
      "failed",
      "found",
    ]) {
      expect({ word, kept: isVocabularyWord(word) }).toEqual({
        word,
        kept: true,
      });
    }

    expect(inflectionsOf("retries")).toContain("retry");
    expect(inflectionsOf("stopped")).toContain("stop");
    expect(inflectionsOf("creating")).toContain("create");
  });

  test("never an inflection of English's small words or a short technology word", () => {
    // "Anders" is no "and", "Nils" no "nil", "Ted" no "t".
    expect(isVocabularyWord("anders")).toBe(false);
    expect(isVocabularyWord("nils")).toBe(false);
    expect(isVocabularyWord("ted")).toBe(false);
    expect(isVocabularyWord("devs")).toBe(false);
  });

  test('under a prefix, never "in", "im" or "co"', () => {
    for (const word of [
      "unmatched",
      "resend",
      "reconnecting",
      "nonexistent",
      "autoscaled",
      "preprocessed",
      "unsubscribed",
    ]) {
      expect({ word, kept: isVocabularyWord(word) }).toEqual({
        word,
        kept: true,
      });
    }

    // "Ingrid" is no "in" and a "grid".
    expect(isVocabularyWord("ingrid")).toBe(false);
  });

  test("an identifier, by its parts", () => {
    expect(identifierParts("processPayment")).toEqual(["process", "Payment"]);
    expect(identifierParts("XMLHttpRequest")).toEqual([
      "XML",
      "Http",
      "Request",
    ]);
    expect(identifierParts("user_id")).toEqual(["user", "id"]);
    expect(identifierParts("order.created")).toEqual(["order", "created"]);
    expect(identifierParts("sha256")).toEqual(["sha"]);
    expect(identifierParts("2024")).toEqual([]);

    for (const word of [
      "PaymentService",
      "processPayment",
      "XMLHttpRequest",
      "user_id",
      "order.created",
      "stripe.charges.create",
      "MAX_RETRIES",
      "userId",
      "getUserById",
    ]) {
      expect({ word, kept: isCodeWord(word, MIDDLE) }).toEqual({
        word,
        kept: true,
      });
    }
  });
});

describe("how a word is written", () => {
  test("in lower case or capitals anywhere, capitalized where a sentence starts", () => {
    expect(isCodeWord("payment", MIDDLE)).toBe(true);
    expect(isCodeWord("PAYMENT", MIDDLE)).toBe(true);
    expect(isCodeWord("Payment", START)).toBe(true);
    // Capitalized mid-sentence is how a name is written.
    expect(isCodeWord("Payment", MIDDLE)).toBe(false);
  });

  test("a technology's name, however it is capitalized", () => {
    for (const word of [
      "Stripe",
      "Redis",
      "PostgreSQL",
      "GitHub",
      "iOS",
      "OneUptime",
      "Kafka",
    ]) {
      expect({ word, kept: isCodeWord(word, MIDDLE) }).toEqual({
        word,
        kept: true,
      });
    }

    for (const name of TECHNOLOGY_NAMES) {
      expect(CODE_VOCABULARY.has(name)).toBe(true);
    }
  });

  test("a single letter, and digits alone, name no one", () => {
    expect(isCodeWord("a", MIDDLE)).toBe(true);
    expect(isCodeWord("I", MIDDLE)).toBe(true);
    expect(isCodeWord("x", MIDDLE)).toBe(true);
    expect(isCodeWord("2", MIDDLE)).toBe(true);
  });

  test("what is no word at all is never kept", () => {
    expect(isCodeWord("", MIDDLE)).toBe(false);
    expect(isCodeWord("PLANTED-LOGLINE-ONE", START)).toBe(false);
    expect(isCodeWord("xq7zk", MIDDLE)).toBe(false);
  });
});

/*
 * A word written as a person's name - capitalized in a sentence's middle,
 * of any script - is no word of the code's, however many records hold it
 * (#11204: an aligned template keeps no word this does not): only a
 * technology's name is written so by code.
 */
describe("a word written as a person's name", () => {
  test("capitalized in a sentence's middle, of any script, is no code word", () => {
    for (const name of ["Grace", "José", "Łukasz", "O'Brien", "Mary-Jane"]) {
      expect([name, isCodeWord(name, MIDDLE)]).toEqual([name, false]);
    }
  });

  test("in capitals, as an identifier or a technology's name, written so by code, it is one", () => {
    for (const word of [
      "ERROR",
      "I",
      "PaymentService",
      "V2",
      "Stripe",
      "Redis",
      "payment",
    ]) {
      expect([word, isCodeWord(word, MIDDLE)]).toEqual([word, true]);
    }
  });

  test("a lower-case word no vocabulary holds - a username - is none either, wherever it stands", () => {
    for (const word of ["jdoe", "ottilie", "quarrington", "ada_lovelace"]) {
      expect([word, isCodeWord(word, MIDDLE), isCodeWord(word, START)]).toEqual(
        [word, false, false],
      );
    }
  });
});

describe("the words log lines are made of are kept", () => {
  /*
   * Lines as services write them, in each library's own words: each
   * template read once keeps every word of them (TelemetryLeakTemplate's
   * suite reads them through the template itself).
   */
  const LINES: ReadonlyArray<string> = [
    "Server listening on port",
    "Connection to database established",
    "Request completed successfully",
    "Job processPayment failed after attempts",
    "Cache miss for key session",
    "Webhook delivery to endpoint returned an error",
    "Order shipped to warehouse",
    "Retrying request with exponential backoff",
    "User signed in with OAuth",
    "Invalid JSON in request body",
    "Payment declined by the issuer",
    "Password reset email sent",
    "Subscription renewed",
    "Refund issued for the order",
    "Timeout while waiting for a response from upstream",
    "Deadlock detected, rolling back the transaction",
    "Unhandled exception in worker thread",
    "Message published to topic",
    "Consumer group rebalancing",
    "File uploaded to bucket",
    "Token expired, refreshing credentials",
    "Rate limit exceeded for tenant",
    "Health check passed",
    "Scheduled job started",
    "Failed to parse configuration file",
    "Calling Stripe to create a customer",
    "Connected to Redis",
    "ECONNREFUSED while connecting to PostgreSQL",
    "GET /api/users/{userId}/orders",
    "POST /signup",
    "chat completion",
    "SELECT orders",
  ];

  test.each(
    LINES.map((line: string): [string] => {
      return [line];
    }),
  )("%s", (line: string) => {
    const words: Array<string> = line.match(/[A-Za-z][A-Za-z_.'-]*/g) || [];
    const lost: Array<string> = words.filter(
      (word: string, index: number): boolean => {
        return !isCodeWord(word, index === 0 ? START : MIDDLE);
      },
    );

    expect(lost).toEqual([]);
  });
});
