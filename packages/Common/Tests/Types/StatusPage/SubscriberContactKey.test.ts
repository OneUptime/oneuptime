import URL from "../../../Types/API/URL";
import Email from "../../../Types/Email";
import Phone from "../../../Types/Phone";
import SubscriberContactKey from "../../../Types/StatusPage/SubscriberContactKey";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import NodeUrl from "url";

/*
 * ONE CONTACT, HOWEVER IT IS WRITTEN (SubscriberContactKey).
 *
 * A status page takes each contact once, and the limits on what is sent to
 * a contact count it once, so both read a contact as what it reaches, not as
 * it was typed: a phone number by its line, a webhook by the address it is
 * sent to. These pin which spellings are one contact - and, as much, which
 * are not: two people must never be taken for one.
 */

// +1 (415) 555-0100, typed every way the phone field takes it.
const ONE_LINE: Array<string> = [
  "+14155550100",
  "14155550100",
  "+(141)55550100",
  "(141)55550100",
  "+141-555-50100",
  "141-555-50100",
  "+141.555.50100",
  "141.555.50100",
  "+141 555 50100",
  "141 555 50100",
  "0014155550100",
  "(001)4155550100",
  "+0014155550100",
  "+(141)555-50100",
  "+(141) 555 50100",
  "(141)-555.50100",
  "141\t555\t50100",
  "+141\t555\t50100",
  " +14155550100 ",
];

describe("a phone number's line", () => {
  test.each(ONE_LINE)("%j is the line 14155550100", (spelling: string) => {
    expect(SubscriberContactKey.forPhone(spelling)).toBe("14155550100");
  });

  test("a Phone reads as the text it holds", () => {
    expect(SubscriberContactKey.forPhone(new Phone("+141-555-50100"))).toBe(
      "14155550100",
    );
  });

  test("every spelling the phone field takes is one line with every other", () => {
    for (const first of ONE_LINE) {
      for (const second of ONE_LINE) {
        expect([
          first,
          second,
          SubscriberContactKey.isSamePhone(first, second),
        ]).toEqual([first, second, true]);
      }
    }
  });

  test.each([
    ["one digit apart", "+14155550100", "+14155550101"],
    [
      "written with its country code and without: which country is not known",
      "+14155550100",
      "4155550100",
    ],
    [
      "another country's number with the same last digits",
      "+14155550100",
      "+4414155550100",
    ],
    [
      "a 00 in the middle is digits, not a prefix",
      "+14100550100",
      "+141550100",
    ],
  ])("%s: two lines", (_label: string, first: string, second: string) => {
    expect(SubscriberContactKey.isSamePhone(first, second)).toBe(false);
    expect(SubscriberContactKey.forPhone(first)).not.toBe(
      SubscriberContactKey.forPhone(second),
    );
  });

  test("only one leading 00 is read as +", () => {
    expect(SubscriberContactKey.forPhone("0000415555010")).toBe("00415555010");
  });

  test("nothing, or nothing with digits, is no line, and the same as nothing", () => {
    expect(SubscriberContactKey.isSamePhone(undefined, "+14155550100")).toBe(
      false,
    );
    expect(SubscriberContactKey.isSamePhone("+14155550100", null)).toBe(false);
    expect(SubscriberContactKey.isSamePhone("()", "--")).toBe(false);
    expect(SubscriberContactKey.forPhone("()-")).toBe("");
  });

  test("agrees with Phone.isSameNumber wherever no 00 is written", () => {
    for (const first of ONE_LINE.filter((spelling: string): boolean => {
      return !spelling.includes("00");
    })) {
      expect(Phone.isSameNumber(first, "+14155550100")).toBe(true);
      expect(SubscriberContactKey.isSamePhone(first, "+14155550100")).toBe(
        true,
      );
    }
  });
});

// https://subscriber.example.net/hook, written every way its address can be.
const ONE_ADDRESS: Array<string> = [
  "https://subscriber.example.net/hook",
  "https://SUBSCRIBER.example.net/hook",
  "https://subscriber.EXAMPLE.NET/hook",
  "HTTPS://subscriber.example.net/hook",
  "https://subscriber.example.net:443/hook",
  "https://subscriber.example.net/hook#a",
  "https://subscriber.example.net/hook#",
  "https://subscriber.example.net/hook?",
  "https://user:secret@subscriber.example.net/hook",
  "https://subscriber.example.net/%68ook",
  "https://subscriber.example.net/h%6Fok",
  "https://subscriber.example.net/%68%6f%6f%6b",
  "https://subscriber.example.net/%68%6F%6F%6B",
  "https://subscriber.example.net/./hook",
  "https://subscriber.example.net/a/../hook",
  "  https://subscriber.example.net/hook  ",
];

describe("a webhook's address", () => {
  test.each(ONE_ADDRESS)(
    "%j is sent to https://subscriber.example.net/hook",
    (spelling: string) => {
      expect(SubscriberContactKey.forUrl(spelling)).toBe(
        "https://subscriber.example.net/hook",
      );
    },
  );

  test("a URL reads as the text it holds", () => {
    expect(
      SubscriberContactKey.forUrl(
        URL.fromString("https://SUBSCRIBER.example.net:443/hook"),
      ),
    ).toBe("https://subscriber.example.net/hook");
  });

  test.each([
    [
      "another path",
      "https://subscriber.example.net/hook",
      "https://subscriber.example.net/hooks",
    ],
    [
      "a path in other letters: paths tell case apart",
      "https://subscriber.example.net/hook",
      "https://subscriber.example.net/Hook",
    ],
    [
      "a trailing slash",
      "https://subscriber.example.net/hook",
      "https://subscriber.example.net/hook/",
    ],
    [
      "another query",
      "https://subscriber.example.net/hook?team=a",
      "https://subscriber.example.net/hook?team=b",
    ],
    [
      "a query and none",
      "https://subscriber.example.net/hook?team=a",
      "https://subscriber.example.net/hook",
    ],
    [
      "another scheme",
      "https://subscriber.example.net/hook",
      "http://subscriber.example.net/hook",
    ],
    [
      "another port",
      "https://subscriber.example.net/hook",
      "https://subscriber.example.net:8443/hook",
    ],
    [
      "another host",
      "https://subscriber.example.net/hook",
      "https://other.example.net/hook",
    ],
    [
      "a reserved character and its encoding: a slash in a segment is not a slash between two",
      "https://subscriber.example.net/a%2Fb",
      "https://subscriber.example.net/a/b",
    ],
  ])("%s: two addresses", (_label: string, first: string, second: string) => {
    expect(SubscriberContactKey.isSameUrl(first, second)).toBe(false);
  });

  test("the hex of a reserved character's encoding is one, in either case", () => {
    expect(
      SubscriberContactKey.forUrl("https://h.example.net/a%2fb?x=%3d"),
    ).toBe("https://h.example.net/a%2Fb?x=%3D");
    expect(
      SubscriberContactKey.isSameUrl(
        "https://h.example.net/a%2fb",
        "https://h.example.net/a%2Fb",
      ),
    ).toBe(true);
  });

  test("a Slack and a Microsoft Teams channel keep what tells one channel from another", () => {
    expect(
      SubscriberContactKey.forUrl(
        "https://HOOKS.slack.com:443/services/T0000/B0000/AbCdEf",
      ),
    ).toBe("https://hooks.slack.com/services/T0000/B0000/AbCdEf");
    expect(
      SubscriberContactKey.isSameUrl(
        "https://hooks.slack.com/services/T0000/B0000/AbCdEf",
        "https://hooks.slack.com/services/T0000/B0000/abcdef",
      ),
    ).toBe(false);
    expect(
      SubscriberContactKey.forUrl(
        "https://prod-1.westus.logic.azure.com/workflows/a/triggers/manual/paths/invoke?api-version=2016-06-01&sig=AbC",
      ),
    ).toBe(
      "https://prod-1.westus.logic.azure.com/workflows/a/triggers/manual/paths/invoke?api-version=2016-06-01&sig=AbC",
    );
  });

  test("an international host is its ASCII form", () => {
    expect(SubscriberContactKey.forUrl("https://bücher.example/hook")).toBe(
      "https://xn--bcher-kva.example/hook",
    );
  });

  test("text that is not an absolute URL is kept as written, trimmed and in lower case", () => {
    expect(SubscriberContactKey.forUrl("  Not A URL ")).toBe("not a url");
    expect(SubscriberContactKey.forUrl("hooks.example.net/in")).toBe(
      "hooks.example.net/in",
    );
  });

  test("nothing is no address", () => {
    expect(
      SubscriberContactKey.isSameUrl(undefined, "https://h.example.net/"),
    ).toBe(false);
    expect(SubscriberContactKey.isSameUrl("https://h.example.net/", null)).toBe(
      false,
    );
    expect(SubscriberContactKey.isSameUrl("", "")).toBe(false);
  });
});

describe("an email address", () => {
  test("is the address trimmed, in lower case: as Email stores it", () => {
    expect(SubscriberContactKey.forEmail(" Someone@Example.COM ")).toBe(
      "someone@example.com",
    );
    expect(
      SubscriberContactKey.forEmail(new Email("Someone@Example.COM")),
    ).toBe("someone@example.com");
  });

  test("a +tag is another address: a page may take both", () => {
    expect(SubscriberContactKey.forEmail("someone+a@example.com")).not.toBe(
      SubscriberContactKey.forEmail("someone@example.com"),
    );
  });
});

/*
 * Every pattern reads text from outside OneUptime - what a visitor typed -
 * so it must take time in line with the text, never with its square. Each
 * gets about 400,000 characters of its worst case.
 *
 * Timed with the URL parser the code runs with outside tests: Node's own,
 * or a browser's. Common's tests run in jsdom, whose URL is written in
 * JavaScript and parses these addresses some 250 times slower - about 400 ms
 * an address against Node's 1 or 2 - so on a busy machine the limit timed
 * jsdom's parser rather than these patterns (3.2 s on 2026-10-26).
 */
describe("on long text", () => {
  const LENGTH: number = 400000;
  const jsdomUrl: typeof globalThis.URL = globalThis.URL;

  beforeAll(() => {
    globalThis.URL = NodeUrl.URL as unknown as typeof globalThis.URL;
  });

  afterAll(() => {
    globalThis.URL = jsdomUrl;
  });

  test("the addresses are parsed by Node's own URL, not jsdom's", () => {
    expect(globalThis.URL).toBe(NodeUrl.URL);
    expect(globalThis.URL).not.toBe(jsdomUrl);
  });

  function within2Seconds(run: () => unknown): unknown {
    const startedAt: number = Date.now();
    const result: unknown = run();

    expect(Date.now() - startedAt).toBeLessThan(2000);

    return result;
  }

  test.each([
    ["digits", "1".repeat(LENGTH)],
    ["separators", "-".repeat(LENGTH)],
    ["digits and separators in turn", "1-".repeat(LENGTH / 2)],
    ["zeros", "0".repeat(LENGTH)],
  ])("a phone of %s", (_label: string, text: string) => {
    within2Seconds((): string => {
      return SubscriberContactKey.forPhone(text);
    });
  });

  test.each([
    ["percent signs", `https://h.example.net/${"%".repeat(LENGTH)}`],
    [
      "encodings one character short",
      `https://h.example.net/${"%6".repeat(LENGTH / 2)}`,
    ],
    [
      "encodings of letters",
      `https://h.example.net/${"%61".repeat(LENGTH / 3)}`,
    ],
    [
      "encodings of slashes",
      `https://h.example.net/?q=${"%2f".repeat(LENGTH / 3)}`,
    ],
    ["text that is no URL", "%".repeat(LENGTH)],
  ])("an address of %s", (_label: string, text: string) => {
    within2Seconds((): string => {
      return SubscriberContactKey.forUrl(text);
    });
  });
});
