import StatusPageSummaryUtil, {
  StatusPageSummary,
} from "../../../Types/StatusPage/StatusPageSummary";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * The summary a status page answers on /status-page-api/summary/<page>, as
 * plain JSON, and where a monitor asks for it. The server writes it with
 * toJSON; another OneUptime's External Status Page monitor reads it with
 * fromJSON, from a server it does not control - so fromJSON takes nothing on
 * trust, and getSummaryUrl only ever builds an address on the page's own
 * host.
 */

const PAGE_ID: string = "5e000000-0000-4000-8000-0000000000a1";

function fullSummary(): StatusPageSummary {
  return {
    overallStatus: {
      name: "Degraded",
      color: "#f59e0b",
      isOperational: false,
    },
    resources: [
      {
        id: "res-api",
        name: "Checkout API",
        groupName: "Core",
        currentStatus: {
          name: "Degraded",
          color: "#f59e0b",
          isOperational: false,
        },
        isUnderMaintenance: false,
      },
      {
        id: "res-db",
        name: "Database",
        groupName: "Core / Data",
        currentStatus: null,
        isUnderMaintenance: true,
      },
    ],
    activeIncidents: [
      {
        id: "inc-1",
        title: "Slow checkouts",
        declaredAt: "2026-10-23T10:00:00.000Z",
        state: "Investigating",
        severity: "SEV-2",
        affectedResourceIds: ["res-api"],
      },
    ],
    ongoingScheduledMaintenance: [
      {
        id: "sm-1",
        title: "Database upgrade",
        startsAt: "2026-10-23T09:00:00.000Z",
        endsAt: "2026-10-23T11:00:00.000Z",
        state: "Ongoing",
        affectedResourceIds: ["res-db"],
      },
    ],
    upcomingScheduledMaintenance: [
      {
        id: "sm-2",
        title: "Network work",
        startsAt: "2026-10-30T02:00:00.000Z",
        endsAt: null,
        state: "Scheduled",
        affectedResourceIds: [],
      },
    ],
  };
}

describe("StatusPageSummaryUtil.toJSON and fromJSON", () => {
  test("round-trips a summary exactly", () => {
    const summary: StatusPageSummary = fullSummary();

    expect(
      StatusPageSummaryUtil.fromJSON(StatusPageSummaryUtil.toJSON(summary)),
    ).toEqual(summary);
  });

  test("survives the wire: JSON text in, the same summary out", () => {
    const summary: StatusPageSummary = fullSummary();
    const wire: string = JSON.stringify(StatusPageSummaryUtil.toJSON(summary));

    expect(StatusPageSummaryUtil.fromJSON(JSON.parse(wire))).toEqual(summary);
  });

  test("writes plain JSON: no _type wrappers anywhere", () => {
    const wire: string = JSON.stringify(
      StatusPageSummaryUtil.toJSON(fullSummary()),
    );

    expect(wire).not.toContain("_type");
  });

  test("copies the id lists, so the written JSON shares nothing with the summary", () => {
    const summary: StatusPageSummary = fullSummary();
    const json: JSONObject = StatusPageSummaryUtil.toJSON(summary);

    (
      ((json["activeIncidents"] as Array<JSONObject>)[0] as JSONObject)[
        "affectedResourceIds"
      ] as Array<string>
    ).push("tampered");

    expect(summary.activeIncidents[0]!.affectedResourceIds).toEqual([
      "res-api",
    ]);
  });

  test.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "not a summary"],
    ["a number", 42],
    ["an array", []],
    ["an empty object", {}],
    [
      "an overview-like object without the lists",
      { overallStatus: null, statusPageResources: [] },
    ],
    [
      "resources that are not a list",
      {
        resources: {},
        activeIncidents: [],
        ongoingScheduledMaintenance: [],
      },
    ],
    [
      "no active incidents list",
      { resources: [], ongoingScheduledMaintenance: [] },
    ],
    ["no ongoing maintenance list", { resources: [], activeIncidents: [] }],
  ])("is not a summary: %s", (_name: string, value: unknown) => {
    expect(StatusPageSummaryUtil.fromJSON(value)).toBeNull();
  });

  test("an empty page is a summary with nothing in it", () => {
    expect(
      StatusPageSummaryUtil.fromJSON({
        overallStatus: null,
        resources: [],
        activeIncidents: [],
        ongoingScheduledMaintenance: [],
      }),
    ).toEqual({
      overallStatus: null,
      resources: [],
      activeIncidents: [],
      ongoingScheduledMaintenance: [],
      upcomingScheduledMaintenance: [],
    });
  });

  test("leaves out a resource without an id or a name, and a second one with the same id", () => {
    const summary: StatusPageSummary | null = StatusPageSummaryUtil.fromJSON({
      resources: [
        { id: "a", name: "First" },
        { name: "No id" },
        { id: "b" },
        { id: "c", name: "   " },
        { id: "a", name: "Same id again" },
        "not an object",
        null,
        ["an", "array"],
        { id: "d", name: "Last" },
      ],
      activeIncidents: [],
      ongoingScheduledMaintenance: [],
    });

    expect(
      summary!.resources.map((resource: { id: string; name: string }) => {
        return `${resource.id}:${resource.name}`;
      }),
    ).toEqual(["a:First", "d:Last"]);
  });

  test("reads a field of the wrong type as missing", () => {
    const summary: StatusPageSummary | null = StatusPageSummaryUtil.fromJSON({
      overallStatus: { name: 42, color: true, isOperational: "yes" },
      resources: [
        {
          id: "a",
          name: "  Padded name  ",
          groupName: 7,
          currentStatus: { name: "Operational", color: 1, isOperational: 1 },
          isUnderMaintenance: "true",
        },
      ],
      activeIncidents: [
        {
          id: "i",
          title: ["not", "text"],
          declaredAt: 123,
          state: {},
          severity: null,
          affectedResourceIds: "a",
        },
      ],
      ongoingScheduledMaintenance: [
        {
          id: "m",
          title: null,
          startsAt: false,
          endsAt: {},
          state: 5,
          affectedResourceIds: ["a", 7, "", "a", "  b  "],
        },
      ],
      upcomingScheduledMaintenance: "not a list",
    });

    expect(summary).toEqual({
      // A status needs a name.
      overallStatus: null,
      resources: [
        {
          id: "a",
          name: "Padded name",
          groupName: null,
          // Only true is operational, and only true is under maintenance.
          currentStatus: {
            name: "Operational",
            color: null,
            isOperational: false,
          },
          isUnderMaintenance: false,
        },
      ],
      activeIncidents: [
        {
          id: "i",
          title: "",
          declaredAt: null,
          state: null,
          severity: null,
          affectedResourceIds: [],
        },
      ],
      ongoingScheduledMaintenance: [
        {
          id: "m",
          title: "",
          startsAt: null,
          endsAt: null,
          state: null,
          // Text ids only, trimmed, each once.
          affectedResourceIds: ["a", "b"],
        },
      ],
      upcomingScheduledMaintenance: [],
    });
  });

  test("leaves out an incident or an event without an id", () => {
    const summary: StatusPageSummary | null = StatusPageSummaryUtil.fromJSON({
      resources: [],
      activeIncidents: [{ title: "No id" }, { id: "i", title: "Kept" }],
      ongoingScheduledMaintenance: [{ title: "No id" }, 3],
      upcomingScheduledMaintenance: [{ id: "u", title: "Kept too" }],
    });

    expect(
      summary!.activeIncidents.map((incident: { id: string }) => {
        return incident.id;
      }),
    ).toEqual(["i"]);
    expect(summary!.ongoingScheduledMaintenance).toEqual([]);
    expect(summary!.upcomingScheduledMaintenance).toHaveLength(1);
  });

  test("reads a hundred thousand affected ids in linear time", () => {
    const ids: Array<string> = [];

    for (let index: number = 0; index < 100000; index++) {
      ids.push(`id-${index % 50000}`);
    }

    const timed: FastestRun<StatusPageSummary | null> = fastestRun({
      run: (): StatusPageSummary | null => {
        return StatusPageSummaryUtil.fromJSON({
          resources: [],
          activeIncidents: [{ id: "i", affectedResourceIds: ids }],
          ongoingScheduledMaintenance: [],
        });
      },
      limitInMs: 2000,
    });
    const summary: StatusPageSummary | null = timed.result;

    expect(timed.inMs).toBeLessThan(2000);
    expect(summary!.activeIncidents[0]!.affectedResourceIds).toHaveLength(
      50000,
    );
  });
});

describe("StatusPageSummaryUtil.getSummaryUrl", () => {
  test.each([
    // A page on its own domain is asked for by that domain.
    [
      "https://status.example.com",
      "https://status.example.com/status-page-api/summary/status.example.com",
    ],
    [
      "https://status.example.com/",
      "https://status.example.com/status-page-api/summary/status.example.com",
    ],
    // Any page under it names it too.
    [
      "https://status.example.com/incidents",
      "https://status.example.com/status-page-api/summary/status.example.com",
    ],
    [
      "https://status.example.com/rss",
      "https://status.example.com/status-page-api/summary/status.example.com",
    ],
    [
      "https://status.example.com/scheduled-events/5e000000-0000-4000-8000-0000000000b2?x=1#top",
      "https://status.example.com/status-page-api/summary/status.example.com",
    ],
    // Domains are matched as written in lower case.
    [
      "https://STATUS.Example.COM",
      "https://status.example.com/status-page-api/summary/status.example.com",
    ],
    // The port stays on the host asked; the domain is the host's name alone.
    [
      "http://status.example.com:8080/",
      "http://status.example.com:8080/status-page-api/summary/status.example.com",
    ],
    // No scheme reads as https.
    [
      "status.example.com",
      "https://status.example.com/status-page-api/summary/status.example.com",
    ],
    [
      "  https://status.example.com  ",
      "https://status.example.com/status-page-api/summary/status.example.com",
    ],
    // A page under OneUptime is asked for by its id, on that host.
    [
      `https://oneuptime.com/status-page/${PAGE_ID}`,
      `https://oneuptime.com/status-page-api/summary/${PAGE_ID}`,
    ],
    [
      `https://oneuptime.com/status-page/${PAGE_ID}/incidents/5e000000-0000-4000-8000-0000000000c3`,
      `https://oneuptime.com/status-page-api/summary/${PAGE_ID}`,
    ],
    [
      `https://oneuptime.com/status-page/${PAGE_ID}/rss`,
      `https://oneuptime.com/status-page-api/summary/${PAGE_ID}`,
    ],
    [
      `https://oneuptime.example.org/status-page/${PAGE_ID.toUpperCase()}/`,
      `https://oneuptime.example.org/status-page-api/summary/${PAGE_ID}`,
    ],
    // Not an id: the host is the page.
    [
      "https://oneuptime.com/status-page/not-an-id",
      "https://oneuptime.com/status-page-api/summary/oneuptime.com",
    ],
    [
      `https://oneuptime.com/other/${PAGE_ID}`,
      "https://oneuptime.com/status-page-api/summary/oneuptime.com",
    ],
    // Credentials in the address are never sent on.
    [
      "https://user:secret@status.example.com",
      "https://status.example.com/status-page-api/summary/status.example.com",
    ],
  ])("%s -> %s", (statusPageUrl: string, expected: string) => {
    expect(StatusPageSummaryUtil.getSummaryUrl(statusPageUrl)).toBe(expected);
  });

  test.each([
    ["empty", ""],
    ["spaces", "   "],
    ["not an address", "http://"],
    ["another scheme", "ftp://status.example.com"],
    ["javascript", "javascript:alert(1)"],
    ["a file", "file:///etc/passwd"],
  ])("is null for %s", (_name: string, statusPageUrl: string) => {
    expect(StatusPageSummaryUtil.getSummaryUrl(statusPageUrl)).toBeNull();
  });

  test("never builds an address on another host than the page's", () => {
    for (const statusPageUrl of [
      "https://status.example.com/status-page/../../evil.example.net",
      "https://status.example.com/%2F%2Fevil.example.net",
      "https://status.example.com\\@evil.example.net",
      "https://status.example.com/status-page/@evil.example.net",
    ]) {
      const summaryUrl: string | null =
        StatusPageSummaryUtil.getSummaryUrl(statusPageUrl);

      expect({
        statusPageUrl,
        host: summaryUrl ? new URL(summaryUrl).host : null,
        origin: summaryUrl ? new URL(summaryUrl).origin : null,
      }).toEqual({
        statusPageUrl,
        host: new URL(statusPageUrl).host,
        origin: new URL(statusPageUrl).origin,
      });
    }
  });

  test("the route encodes what it is given", () => {
    expect(StatusPageSummaryUtil.getRoute("a/b?c")).toBe("/summary/a%2Fb%3Fc");
  });
});
