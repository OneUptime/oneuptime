import { describe, expect, test } from "@jest/globals";
import * as Link from "../../FeatureSet/Dashboard/src/Components/Logs/LogLineLink";
import * as Address from "../../FeatureSet/Dashboard/src/Components/Logs/OpenedLogLineAddress";

/*
 * Copy Link on a log line's details (#9794): the address it copies opens
 * that very line - its id and when it was written, as the Logs page reads
 * them (useOpenedLogLine) - with the list it was copied from under it: the
 * explorer's chips over the window it showed, pinned, so the list is the
 * same whenever the link is opened. A list embedded in another page puts
 * the line's service in place of its page's scope. The address carries the
 * line and its list, and nothing that lets anyone read it: whoever opens it
 * reads with their own permissions.
 */

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const LOGS_PAGE: string = `https://oneuptime.example.com/dashboard/${PROJECT_ID}/logs`;
const LOG_ID: string = "0192f1a0-0000-7000-8000-000000000001";
const SERVICE_ID: string = "22222222-2222-4222-8222-222222222222";
const WRITTEN: Date = new Date("2026-10-27T06:45:12.345Z");
const WINDOW: { start: Date; end: Date } = {
  start: new Date("2026-10-27T06:00:00.000Z"),
  end: new Date("2026-10-27T07:00:00.000Z"),
};

function line(
  overrides: Partial<Link.LogLineLinkLine> = {},
): Link.LogLineLinkLine {
  return {
    id: LOG_ID,
    time: WRITTEN,
    primaryEntityId: SERVICE_ID,
    ...overrides,
  };
}

function list(
  overrides: Partial<Link.LogLineLinkList> = {},
): Link.LogLineLinkList {
  return {
    facetFilters: new Map<string, Set<string>>([
      ["severityText", new Set<string>(["Error", "Warning"])],
    ]),
    window: WINDOW,
    isLogsPage: true,
    ...overrides,
  };
}

function link(
  data: {
    line?: Link.LogLineLinkLine;
    list?: Link.LogLineLinkList;
    logsPageUrl?: string;
  } = {},
): URL {
  return new URL(
    Link.buildLogLineLink({
      logsPageUrl: data.logsPageUrl || LOGS_PAGE,
      line: data.line || line(),
      list: data.list || list(),
    })!,
  );
}

describe("the address Copy Link copies", () => {
  test("opens exactly that line: the Logs page reads its id and when it was written", () => {
    const copied: URL = link();

    expect(copied.origin).toBe("https://oneuptime.example.com");
    expect(copied.pathname).toBe(`/dashboard/${PROJECT_ID}/logs`);
    expect(Address.readOpenedLogLineAddress(copied.search)).toEqual({
      logId: LOG_ID,
      logTime: WRITTEN,
    });
  });

  test("is looked for where it was written, so the line is found", () => {
    const address: Address.OpenedLogLineAddress =
      Address.readOpenedLogLineAddress(link().search)!;
    const lookIn: { start: Date; end: Date } = Address.getOpenedLogLineWindow({
      address,
      now: new Date("2030-01-01T00:00:00.000Z"),
    });

    expect(lookIn.start.getTime()).toBeLessThanOrEqual(WRITTEN.getTime());
    expect(lookIn.end.getTime()).toBeGreaterThanOrEqual(WRITTEN.getTime());
  });

  test("keeps the explorer's chips for the list under the line, as the explorer writes them", () => {
    expect(JSON.parse(link().searchParams.get("filters")!)).toEqual([
      ["severityText", ["Error", "Warning"]],
    ]);
  });

  test("pins the window the list showed, so the list is the same whenever the link is opened", () => {
    const copied: URL = link();

    expect(copied.searchParams.get("range")).toBe("Custom");
    expect(new Date(copied.searchParams.get("start")!)).toEqual(WINDOW.start);
    expect(new Date(copied.searchParams.get("end")!)).toEqual(WINDOW.end);
  });

  test("a list embedded in another page puts the line's own service under it, in place of the page's scope", () => {
    expect(
      JSON.parse(
        link({ list: list({ isLogsPage: false }) }).searchParams.get(
          "filters",
        )!,
      ),
    ).toEqual([
      ["severityText", ["Error", "Warning"]],
      ["primaryEntityId", [SERVICE_ID]],
    ]);

    // A service the reader picked already: kept as picked, never twice.
    const picked: Map<string, Set<string>> = new Map([
      [
        "primaryEntityId",
        new Set<string>(["33333333-3333-4333-8333-333333333333"]),
      ],
    ]);

    expect(
      JSON.parse(
        link({
          list: list({ isLogsPage: false, facetFilters: picked }),
        }).searchParams.get("filters")!,
      ),
    ).toEqual([["primaryEntityId", ["33333333-3333-4333-8333-333333333333"]]]);

    // The Logs page's own list: its chips are all of its scope.
    expect(
      JSON.parse(link().searchParams.get("filters")!).some(
        (tuple: [string, Array<string>]): boolean => {
          return tuple[0] === "primaryEntityId";
        },
      ),
    ).toBe(false);
  });

  test("carries the line and its list, and nothing else: no key, no token, nothing of the page's own address", () => {
    const copied: URL = link({
      logsPageUrl: `${LOGS_PAGE}?savedView=abc&page=3&accessToken=secret-token#row-9`,
    });

    expect(Array.from(copied.searchParams.keys()).sort()).toEqual([
      "end",
      "filters",
      "log",
      "logTime",
      "range",
      "start",
    ]);
    expect(copied.toString()).not.toContain("secret-token");
    expect(copied.toString()).not.toContain("savedView");
    expect(copied.hash).toBe("");
    expect(copied.username).toBe("");
    expect(copied.password).toBe("");
  });

  test("a list with no chips and no window still opens the line, over the explorer's own window", () => {
    const copied: URL = link({
      list: list({ facetFilters: new Map(), window: null }),
    });

    expect(Array.from(copied.searchParams.keys()).sort()).toEqual([
      "log",
      "logTime",
    ]);
  });

  test("a chip's value of any kind comes back as it was", () => {
    const value: string = '/api/w?a=1&b="two" 50%#x';
    const copied: URL = link({
      list: list({
        facetFilters: new Map([
          ["attributes.http.target", new Set<string>([value])],
        ]),
      }),
    });

    expect(JSON.parse(copied.searchParams.get("filters")!)).toEqual([
      ["attributes.http.target", [value]],
    ]);
    // The line is still read from the same address.
    expect(Address.readOpenedLogLineAddress(copied.search)!.logId).toBe(LOG_ID);
  });

  test("a line with no time still opens, by when its time-ordered id says it came in", () => {
    const copied: URL = link({ line: line({ time: null }) });

    expect(copied.searchParams.has("logTime")).toBe(false);
    expect(Address.readOpenedLogLineAddress(copied.search)).toEqual({
      logId: LOG_ID,
      logTime: null,
    });
  });

  test("a line it cannot name has no link: no id, or one the Logs page would not open", () => {
    for (const id of ["", "  ", "not-an-id", "'; DROP TABLE Log"]) {
      expect(
        Link.buildLogLineLink({
          logsPageUrl: LOGS_PAGE,
          line: line({ id }),
          list: list(),
        }),
      ).toBeNull();
    }

    expect(
      Link.buildLogLineLink({
        logsPageUrl: "not a url",
        line: line(),
        list: list(),
      }),
    ).toBeNull();
  });
});
