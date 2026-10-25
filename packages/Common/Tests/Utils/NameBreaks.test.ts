import { describe, expect, test } from "@jest/globals";
import { splitAtNameBreaks } from "../../Utils/NameBreaks";

/*
 * Where a long name may break (Utils/NameBreaks): after a dot or a slash
 * inside a word, before a letter or a placeholder - so a metric's name wraps
 * as "http.server.request." / "count" instead of "request.coun" / "t" - and
 * nowhere else. The parts always join back to the text as written.
 */

function breaks(text: string): Array<string> {
  const parts: Array<string> = splitAtNameBreaks(text);

  // Nothing is added or lost: a copy reads as written.
  expect(parts.join("")).toBe(text);

  return parts;
}

describe("a long name breaks after its own separators", () => {
  test("a metric's name, after each dot", () => {
    expect(breaks("http.server.request.count")).toEqual([
      "http.",
      "server.",
      "request.",
      "count",
    ]);
  });

  test("a title that names a metric and an attribute: only inside the names", () => {
    expect(
      breaks(
        "http.server.request.count in checkout records 12,000 different user.id values an hour",
      ),
    ).toEqual([
      "http.",
      "server.",
      "request.",
      "count in checkout records 12,000 different user.",
      "id values an hour",
    ]);
  });

  test("a name pattern: before and after its placeholder", () => {
    expect(breaks("job.{id}.duration")).toEqual(["job.", "{id}.", "duration"]);
  });

  test("a path, after each slash inside it - not after the one that starts it", () => {
    expect(breaks("POST /api/v2/payments/{paymentId}/capture")).toEqual([
      "POST /api/",
      "v2/",
      "payments/",
      "{paymentId}/",
      "capture",
    ]);
  });

  test("letters of any script start a part", () => {
    expect(breaks("сервис.метрика")).toEqual(["сервис.", "метрика"]);
  });
});

describe("what stays whole", () => {
  test("a number's decimal point, and a version's", () => {
    expect(breaks("from 0.012 to 4.8")).toEqual(["from 0.012 to 4.8"]);
    expect(breaks("v2.5.1")).toEqual(["v2.5.1"]);
  });

  test("a full stop, a dot after a space, and the text's last character", () => {
    expect(breaks("It ends here.")).toEqual(["It ends here."]);
    expect(breaks("a .hidden file")).toEqual(["a .hidden file"]);
    expect(breaks("count.")).toEqual(["count."]);
    expect(breaks("/root")).toEqual(["/root"]);
  });

  test("a run of separators, as in an address, stays together", () => {
    expect(breaks("https://example.com")).toEqual([
      "https://",
      "example.",
      "com",
    ]);
  });

  test("nothing, for nothing", () => {
    expect(splitAtNameBreaks("")).toEqual([]);
    expect(breaks("plain words only")).toEqual(["plain words only"]);
  });
});

describe("text a service sent is read quickly, whatever it holds", () => {
  test.each([
    ["dots", "a.".repeat(200000)],
    ["slashes", "a/".repeat(200000)],
    ["dots and spaces", "a. ".repeat(140000)],
  ])("%s", (_name: string, text: string) => {
    const started: number = Date.now();
    const parts: Array<string> = splitAtNameBreaks(text);

    expect(Date.now() - started).toBeLessThan(2000);
    expect(parts.join("")).toBe(text);
  });
});
