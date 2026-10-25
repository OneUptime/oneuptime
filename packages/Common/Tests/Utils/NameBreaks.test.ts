import { describe, expect, test } from "@jest/globals";
import {
  NAME_BREAKS_FROM_LENGTH,
  splitAtNameBreaks,
} from "../../Utils/NameBreaks";

/*
 * Where a long name may break (Utils/NameBreaks): after a dot or a slash
 * inside it, before a letter or a placeholder - so a metric's name wraps
 * as "http.server.request." / "count" instead of "request.coun" / "t" -
 * and nowhere else; a short name stays whole. The parts always join back
 * to the text as written.
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

  test("a title that names a long metric and a short attribute: only inside the long one", () => {
    expect(
      breaks(
        "http.server.request.count in checkout records 12,000 different user.id values an hour",
      ),
    ).toEqual([
      "http.",
      "server.",
      "request.",
      "count in checkout records 12,000 different user.id values an hour",
    ]);
  });

  test("a long name pattern: before and after its placeholder", () => {
    expect(breaks("background.jobs.{id}.queue.duration")).toEqual([
      "background.",
      "jobs.",
      "{id}.",
      "queue.",
      "duration",
    ]);
  });

  test("a long path, after each slash inside it - not after the one that starts it", () => {
    expect(breaks("POST /api/v2/payments/{paymentId}/capture")).toEqual([
      "POST /api/",
      "v2/",
      "payments/",
      "{paymentId}/",
      "capture",
    ]);
  });

  test("letters of any script start a part", () => {
    expect(breaks("сервис.метрика.запросы.всего")).toEqual([
      "сервис.",
      "метрика.",
      "запросы.",
      "всего",
    ]);
  });
});

describe("what stays whole", () => {
  test("a name shorter than half a phone's line: it fits on a line of its own", () => {
    expect(NAME_BREAKS_FROM_LENGTH).toBe(20);
    expect(breaks("user.id")).toEqual(["user.id"]);
    expect(breaks("job.{id}.duration")).toEqual(["job.{id}.duration"]);
    expect(breaks("https://example.com")).toEqual(["https://example.com"]);
    // At the length, it may break.
    expect(breaks("http.server.duration")).toEqual([
      "http.",
      "server.",
      "duration",
    ]);
  });

  test("a number's decimal point, and a version's", () => {
    expect(breaks("from 0.012 to 4.8")).toEqual(["from 0.012 to 4.8"]);
    expect(breaks("release-2026.10.25.1-candidate-v2.5.1")).toEqual([
      "release-2026.10.25.1-candidate-v2.5.1",
    ]);
  });

  test("a full stop, a dot or slash that starts a word, and the text's last character", () => {
    expect(breaks("It ends here with a long name.")).toEqual([
      "It ends here with a long name.",
    ]);
    expect(breaks("a .hidden-configuration-file-name")).toEqual([
      "a .hidden-configuration-file-name",
    ]);
    expect(breaks("/root/a-long-directory-name")).toEqual([
      "/root/",
      "a-long-directory-name",
    ]);
    expect(breaks("http.server.request.count.")).toEqual([
      "http.",
      "server.",
      "request.",
      "count.",
    ]);
  });

  test("a run of separators, as in an address, stays together", () => {
    expect(breaks("https://grafana.example.com/d/checkout")).toEqual([
      "https://",
      "grafana.",
      "example.",
      "com/",
      "d/",
      "checkout",
    ]);
  });

  test("nothing, for nothing", () => {
    expect(splitAtNameBreaks("")).toEqual([]);
    expect(breaks("plain words only")).toEqual(["plain words only"]);
    expect(breaks("  spaced   out  ")).toEqual(["  spaced   out  "]);
  });
});

describe("text a service sent is read quickly, whatever it holds", () => {
  test.each([
    ["dots", "a.".repeat(200000)],
    ["slashes", "a/".repeat(200000)],
    ["dots and spaces", "a.a.a.a.a.a.a.a.a.a.a ".repeat(18000)],
  ])("%s", (_name: string, text: string) => {
    const started: number = Date.now();
    const parts: Array<string> = splitAtNameBreaks(text);

    expect(Date.now() - started).toBeLessThan(2000);
    expect(parts.join("")).toBe(text);
  });
});
