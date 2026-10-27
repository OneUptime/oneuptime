import { beforeAll, describe, expect, test } from "@jest/globals";
import Route from "Common/Types/API/Route";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  SecurityCaseExposureEvidenceKind,
  SecurityCaseImpactJson,
  SecurityCaseImpactRecordJson,
  SecurityCaseImpactSource,
  SecurityCaseInternetExposure,
  SecurityCaseStoryItemJson,
  SecurityCaseStoryItemKind,
  SecurityCaseStoryJson,
  SecurityCaseStoryMilestone,
  SecurityCaseStorySource,
} from "Common/Types/SecurityCase/SecurityCaseContext";
import {
  SecurityConnectionCertainty,
  SecurityConnectionKind,
} from "Common/Types/SecurityCase/SecurityConnection";

/*
 * A case's Story and Impact as the Dashboard reads them: every answer read
 * defensively (a field the server left out, or got wrong, reads as nothing
 * rather than breaking the page), each item's links to the trace, the
 * exception, the events and the case's own pages, the day headings, and the
 * facts the Impact card leads with.
 */

type Model =
  typeof import("../../FeatureSet/Dashboard/src/Components/SecurityCase/Context/SecurityCaseContextModel");

let model: Model;

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const CASE_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const EXCEPTION_ID: string = "33333333-3333-4333-8333-333333333333";
const INCIDENT_ID: string = "44444444-4444-4444-8444-444444444444";
const ALERT_ID: string = "55555555-5555-4555-8555-555555555555";
const SERVICE_ID: string = "66666666-6666-4666-8666-666666666666";
const STATUS_PAGE_ID: string = "77777777-7777-4777-8777-777777777777";
const BASE: string = `/dashboard/${PROJECT_ID}`;
const TIME: string = "2026-10-27T06:00:00.000Z";

beforeAll(async () => {
  (globalThis as Record<string, unknown>)["window"] = {
    location: {
      pathname: `${BASE}/security-events/cases`,
      search: "",
      hash: "",
    },
    history: {
      state: null,
      replaceState: (): void => {
        // no-op; these tests never navigate.
      },
    },
  };

  for (const storageName of ["sessionStorage", "localStorage"]) {
    Object.defineProperty(globalThis, storageName, {
      value: {
        getItem: (): null => {
          return null;
        },
        setItem: (): void => {
          // no-op
        },
        removeItem: (): void => {
          // no-op
        },
      },
      configurable: true,
      writable: true,
    });
  }

  model = await import(
    "../../FeatureSet/Dashboard/src/Components/SecurityCase/Context/SecurityCaseContextModel"
  );
});

function open(route: Route | null | undefined): {
  path: string;
  query: Record<string, string>;
} {
  expect(route).toBeTruthy();

  const url: globalThis.URL = new globalThis.URL(
    route!.toString(),
    "https://oneuptime.example",
  );
  const query: Record<string, string> = {};

  url.searchParams.forEach((value: string, key: string) => {
    query[key] = value;
  });

  return { path: url.pathname, query };
}

function item(
  overrides: Partial<SecurityCaseStoryItemJson> = {},
): SecurityCaseStoryItemJson {
  return {
    key: "events:1",
    kind: SecurityCaseStoryItemKind.Events,
    time: TIME,
    title: "SQL injection attempt: GET /x → 500",
    links: {},
    ...overrides,
  };
}

function record(
  overrides: Partial<SecurityCaseImpactRecordJson> = {},
): SecurityCaseImpactRecordJson {
  return {
    kind: SecurityConnectionKind.Service,
    id: SERVICE_ID,
    name: "checkout",
    certainty: SecurityConnectionCertainty.Exact,
    calls: null,
    calledBy: null,
    runsOn: null,
    monitors: null,
    owners: null,
    lastChange: null,
    ...overrides,
  };
}

describe("reading a story", () => {
  test("keeps what the server said, and drops what no item can be drawn from", () => {
    const story: SecurityCaseStoryJson = model.parseSecurityCaseStory({
      windowStart: TIME,
      windowEnd: "2026-10-27T07:00:00.000Z",
      items: [
        {
          key: "events:1",
          kind: "Events",
          time: TIME,
          endTime: "2026-10-27T06:45:00.000Z",
          title: "probe",
          count: 96,
          requestOutcome: "Reached Database",
          className: "HTTP Activity",
          outcomes: { Rejected: 95, "Reached Database": 1, junk: "x" },
          links: {
            traceId: "trace-1",
            spanId: "span-1",
            observable: "203.0.113.7",
            resource: { kind: "Service", id: SERVICE_ID, name: "checkout" },
            unknownLink: "dropped",
          },
        },
        { key: "milestone", kind: "Milestone", time: TIME, milestone: "Closed" },
        { key: "bad-kind", kind: "Nonsense", time: TIME },
        { key: "no-time", kind: "Note" },
        "not an item",
        { key: "bad-milestone", kind: "Milestone", time: TIME, milestone: "Gone" },
      ],
      truncatedSources: ["Events", "Nonsense"],
      unreadableSources: ["Exceptions"],
      failedSources: "not a list",
    } as unknown as JSONObject);

    expect(story.windowStart).toBe(TIME);
    expect(story.items).toHaveLength(3);
    expect(story.items[0]).toEqual({
      key: "events:1",
      kind: SecurityCaseStoryItemKind.Events,
      time: TIME,
      endTime: "2026-10-27T06:45:00.000Z",
      title: "probe",
      count: 96,
      requestOutcome: "Reached Database",
      className: "HTTP Activity",
      outcomes: { Rejected: 95, "Reached Database": 1 },
      links: {
        traceId: "trace-1",
        spanId: "span-1",
        observable: "203.0.113.7",
        resource: {
          kind: SecurityConnectionKind.Service,
          id: SERVICE_ID,
          name: "checkout",
        },
      },
    });
    expect(story.items[1]!.milestone).toBe(SecurityCaseStoryMilestone.Closed);
    expect(story.items[2]!.milestone).toBeUndefined();
    expect(story.truncatedSources).toEqual([SecurityCaseStorySource.Events]);
    expect(story.unreadableSources).toEqual([
      SecurityCaseStorySource.Exceptions,
    ]);
    expect(story.failedSources).toEqual([]);
  });

  test("an empty answer is an empty story", () => {
    expect(model.parseSecurityCaseStory({})).toEqual({
      windowStart: "",
      windowEnd: "",
      items: [],
      truncatedSources: [],
      unreadableSources: [],
      failedSources: [],
    });
  });

  test("a record link of an unknown kind is left out", () => {
    expect(
      model.parseSecurityCaseStory({
        items: [
          {
            key: "c",
            kind: "Change",
            time: TIME,
            links: { resource: { kind: "Spaceship", id: "x", name: "n" } },
          },
        ],
      } as unknown as JSONObject).items[0]!.links,
    ).toEqual({});
  });
});

describe("reading an impact", () => {
  test("keeps the records, their facts and what is not known", () => {
    const impact: SecurityCaseImpactJson = model.parseSecurityCaseImpact({
      windowStart: TIME,
      windowEnd: TIME,
      firstDetectedAt: TIME,
      records: [
        {
          kind: "Service",
          id: SERVICE_ID,
          name: "checkout",
          certainty: "Possible",
          inventoryItemId: "item-1",
          calls: [
            { key: "service:payments", name: "payments", type: "Service", callCount: 4, errorCount: 0 },
            { name: "no key" },
          ],
          calledBy: null,
          runsOn: "not a list",
          monitors: { count: 2, items: [{ id: "m-1", title: "API", stateName: "Online" }, { title: "no id" }] },
          owners: { teams: [{ id: "t-1", name: "Payments" }], users: [{ name: "no id" }] },
          lastChange: {
            id: "c-1",
            time: TIME,
            title: "deploy",
            eventType: "deployment",
            version: "v2",
            isBeforeFirstDetection: true,
          },
        },
        { kind: "Spaceship", id: "x" },
        { kind: "Host" },
      ],
      hasMoreRecords: true,
      statusPages: [
        { id: STATUS_PAGE_ID, name: "Acme Status", monitorIds: ["m-1", 7] },
        { name: "no id" },
      ],
      flowPeers: [
        { caseAddress: "203.0.113.7", peerAddress: "10.0.3.17", direction: "in", bytes: 100, packets: 2, lastSeen: TIME },
        { caseAddress: "203.0.113.7" },
      ],
      internet: {
        exposure: "Yes",
        evidence: [
          { kind: "PublicRequestReachedApp", address: "203.0.113.7", time: TIME, requestOutcome: "Errored" },
          { kind: "Guess", address: "1.2.3.4" },
        ],
      },
      unreadableSources: ["Owners", "Nope"],
      failedSources: [],
    } as unknown as JSONObject);

    expect(impact.records).toHaveLength(1);
    expect(impact.records[0]).toEqual({
      kind: SecurityConnectionKind.Service,
      id: SERVICE_ID,
      name: "checkout",
      certainty: SecurityConnectionCertainty.Possible,
      inventoryItemId: "item-1",
      calls: [
        {
          key: "service:payments",
          name: "payments",
          type: "Service",
          callCount: 4,
          errorCount: 0,
        },
      ],
      calledBy: null,
      runsOn: null,
      monitors: {
        count: 2,
        items: [{ id: "m-1", title: "API", stateName: "Online" }],
      },
      owners: { teams: [{ id: "t-1", name: "Payments" }], users: [] },
      lastChange: {
        id: "c-1",
        time: TIME,
        title: "deploy",
        eventType: "deployment",
        version: "v2",
        isBeforeFirstDetection: true,
      },
    });
    expect(impact.hasMoreRecords).toBe(true);
    expect(impact.statusPages).toEqual([
      { id: STATUS_PAGE_ID, name: "Acme Status", monitorIds: ["m-1"] },
    ]);
    expect(impact.flowPeers).toEqual([
      {
        caseAddress: "203.0.113.7",
        peerAddress: "10.0.3.17",
        direction: "in",
        bytes: 100,
        packets: 2,
        lastSeen: TIME,
      },
    ]);
    expect(impact.internet).toEqual({
      exposure: SecurityCaseInternetExposure.Yes,
      evidence: [
        {
          kind: SecurityCaseExposureEvidenceKind.PublicRequestReachedApp,
          address: "203.0.113.7",
          time: TIME,
          requestOutcome: "Errored",
        },
      ],
    });
    expect(impact.unreadableSources).toEqual([SecurityCaseImpactSource.Owners]);
  });

  test("facts the server could not read stay not known, never empty", () => {
    const impact: SecurityCaseImpactJson = model.parseSecurityCaseImpact({
      records: [{ kind: "Host", id: "h-1", name: "web-1" }],
      statusPages: null,
      flowPeers: null,
    } as unknown as JSONObject);

    expect(impact.records[0]).toMatchObject({
      calls: null,
      calledBy: null,
      runsOn: null,
      monitors: null,
      owners: null,
      lastChange: null,
      certainty: SecurityConnectionCertainty.Exact,
    });
    expect(impact.statusPages).toBeNull();
    expect(impact.flowPeers).toBeNull();
    expect(impact.internet).toEqual({
      exposure: SecurityCaseInternetExposure.Unknown,
      evidence: [],
    });
  });
});

describe("what a story item opens", () => {
  test("a run of events opens the request's trace at its span, and the events around it", () => {
    const links: Array<{ key: string; route: Route }> = model.getStoryItemLinks({
      item: item({
        endTime: "2026-10-27T06:45:00.000Z",
        links: {
          traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
          spanId: "00f067aa0ba902b7",
          observable: "203.0.113.7",
        },
      }),
      caseId: CASE_ID,
    });

    expect(
      links.map((link: { key: string }): string => {
        return link.key;
      }),
    ).toEqual(["trace", "events"]);
    expect(open(links[0]!.route)).toEqual({
      path: `${BASE}/traces/view/4bf92f3577b34da6a3ce929d0e0e4736`,
      query: { spanId: "00f067aa0ba902b7" },
    });

    const events: { path: string; query: Record<string, string> } = open(
      links[1]!.route,
    );

    expect(events.path).toBe(`${BASE}/security-events`);
    expect(events.query["search"]).toBe("observable:203.0.113.7");
    // From a little before the run to a little after it.
    expect(JSON.stringify(events.query)).toContain("2026-10-27");
  });

  test("an exception opens its group, when the reader may read it", () => {
    const links: Array<{ key: string; route: Route }> = model.getStoryItemLinks({
      item: item({
        kind: SecurityCaseStoryItemKind.Exception,
        links: {
          exceptionId: EXCEPTION_ID,
          exceptionFingerprint: "fp",
          traceId: "trace-1",
        },
      }),
      caseId: CASE_ID,
    });

    expect(
      links.map((link: { key: string }): string => {
        return link.key;
      }),
    ).toEqual(["trace", "exception"]);
    expect(open(links[1]!.route).path).toBe(
      `${BASE}/exceptions/${EXCEPTION_ID}`,
    );
    expect(
      model.getStoryItemLinks({
        item: item({
          kind: SecurityCaseStoryItemKind.Exception,
          links: { exceptionFingerprint: "fp" },
        }),
        caseId: CASE_ID,
      }),
    ).toEqual([]);
  });

  test("a detection opens its events and the case's Detections; a playbook run the case's Playbooks", () => {
    const detection: Array<{ key: string; route: Route }> =
      model.getStoryItemLinks({
        item: item({
          kind: SecurityCaseStoryItemKind.Detection,
          links: { observable: "203.0.113.7", detectionId: "d-1" },
        }),
        caseId: CASE_ID,
      });

    expect(
      detection.map((link: { key: string }): string => {
        return link.key;
      }),
    ).toEqual(["events", "detections"]);
    expect(open(detection[1]!.route).path).toBe(
      `${BASE}/security-events/cases/${CASE_ID.toString()}/detections`,
    );

    const run: Array<{ key: string; route: Route }> = model.getStoryItemLinks({
      item: item({
        kind: SecurityCaseStoryItemKind.PlaybookRun,
        links: { playbookRunId: "r-1" },
      }),
      caseId: CASE_ID,
    });

    expect(open(run[0]!.route).path).toBe(
      `${BASE}/security-events/cases/${CASE_ID.toString()}/playbook-runs`,
    );
  });

  test("a note or a change opens nothing of its own", () => {
    expect(
      model.getStoryItemLinks({
        item: item({ kind: SecurityCaseStoryItemKind.Note }),
        caseId: CASE_ID,
      }),
    ).toEqual([]);
  });

  test("an incident's and an alert's titles open them; a change's record opens its page", () => {
    expect(
      open(
        model.getStoryItemTitleRoute(
          item({
            kind: SecurityCaseStoryItemKind.Incident,
            links: { incidentId: INCIDENT_ID },
          }),
        ),
      ).path,
    ).toBe(`${BASE}/incidents/${INCIDENT_ID}`);
    expect(
      open(
        model.getStoryItemTitleRoute(
          item({
            kind: SecurityCaseStoryItemKind.Alert,
            links: { alertId: ALERT_ID },
          }),
        ),
      ).path,
    ).toBe(`${BASE}/alerts/${ALERT_ID}`);
    expect(model.getStoryItemTitleRoute(item())).toBeNull();
    expect(
      open(
        model.getStoryItemRecordRoute(
          item({
            kind: SecurityCaseStoryItemKind.Change,
            links: {
              resource: {
                kind: SecurityConnectionKind.Service,
                id: SERVICE_ID,
                name: "checkout",
              },
            },
          }),
        ),
      ).path,
    ).toContain(SERVICE_ID);
    expect(model.getStoryItemRecordRoute(item())).toBeNull();
  });

  test("events that name nobody, or have no usable time, open no events", () => {
    expect(model.getStoryEventsRoute(item())).toBeNull();
    expect(
      model.getStoryEventsRoute(
        item({ time: "not a time", links: { observable: "x" } }),
      ),
    ).toBeNull();
  });
});

describe("laying a story out", () => {
  test("puts the items under a heading for each day, in the order they came", () => {
    const days: ReturnType<Model["groupStoryItemsByDay"]> =
      model.groupStoryItemsByDay(
        [
          item({ key: "a", time: "2026-10-26T23:50:00.000Z" }),
          item({ key: "b", time: "2026-10-26T23:59:00.000Z" }),
          item({ key: "c", time: "2026-10-27T00:10:00.000Z" }),
        ],
        (time: string): string => {
          return time.slice(0, 10);
        },
      );

    expect(
      days.map((day: { key: string; items: Array<{ key: string }> }) => {
        return [
          day.key,
          day.items.map((entry: { key: string }): string => {
            return entry.key;
          }),
        ];
      }),
    ).toEqual([
      ["2026-10-26", ["a", "b"]],
      ["2026-10-27", ["c"]],
    ]);
    expect(days[0]!.time).toBe("2026-10-26T23:50:00.000Z");
  });

  test("reads a day by the reader's own clock", () => {
    const date: Date = new Date(TIME);

    expect(model.getLocalDayKey(TIME)).toBe(
      `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`,
    );
    expect(model.getLocalDayKey("not a time")).toBe("");
  });

  test("colours an item by how far its requests got, then by what it is", () => {
    expect(model.getStoryItemTone(item({ requestOutcome: "Reached Database" }))).toBe("red");
    expect(model.getStoryItemTone(item({ requestOutcome: "Errored" }))).toBe("red");
    expect(model.getStoryItemTone(item({ requestOutcome: "Reached App" }))).toBe("amber");
    expect(model.getStoryItemTone(item({ requestOutcome: "Rejected" }))).toBe("gray");
    expect(
      model.getStoryItemTone(
        item({ kind: SecurityCaseStoryItemKind.Detection, severityName: "High" }),
      ),
    ).toBe("red");
    expect(
      model.getStoryItemTone(
        item({ kind: SecurityCaseStoryItemKind.Detection, severityName: "Low" }),
      ),
    ).toBe("amber");
    expect(
      model.getStoryItemTone(item({ kind: SecurityCaseStoryItemKind.Change })),
    ).toBe("indigo");
    expect(
      model.getStoryItemTone(
        item({
          kind: SecurityCaseStoryItemKind.Milestone,
          milestone: SecurityCaseStoryMilestone.Contained,
        }),
      ),
    ).toBe("green");
    expect(
      model.getStoryItemTone(item({ kind: SecurityCaseStoryItemKind.Note })),
    ).toBe("gray");
  });

  test("tallies a run's outcomes, the furthest-reaching first, and leaves out none", () => {
    expect(
      model.getStoryOutcomeTally(
        item({
          outcomes: {
            Rejected: 95,
            "": 3,
            "Reached Database": 1,
            "Reached App": 0,
          },
        }),
      ),
    ).toEqual([
      { outcome: "Reached Database", count: 1 },
      { outcome: "Rejected", count: 95 },
      { outcome: "", count: 3 },
    ]);
    expect(model.getStoryOutcomeTally(item())).toEqual([]);
  });
});

describe("the facts the Impact card leads with", () => {
  test("names every owner once, teams and people, and says when nobody could tell", () => {
    expect(
      model.getImpactOwners([
        record({
          owners: {
            teams: [{ id: "t-1", name: "Payments" }],
            users: [{ id: "u-1", name: "Kim" }],
          },
        }),
        record({
          id: "s-2",
          owners: { teams: [{ id: "t-1", name: "Payments" }], users: [] },
        }),
        record({ id: "s-3" }),
      ]),
    ).toEqual({
      teams: [{ id: "t-1", name: "Payments" }],
      users: [{ id: "u-1", name: "Kim" }],
      isKnown: true,
    });
    expect(model.getImpactOwners([record()]).isKnown).toBe(false);
  });

  test("leads with the latest change before the first detection, then the first after", () => {
    const before: SecurityCaseImpactRecordJson = record({
      id: "a",
      lastChange: {
        id: "1",
        time: "2026-10-27T05:00:00.000Z",
        title: "deploy a",
        eventType: "deployment",
        isBeforeFirstDetection: true,
      },
    });
    const laterBefore: SecurityCaseImpactRecordJson = record({
      id: "b",
      lastChange: {
        id: "2",
        time: "2026-10-27T05:30:00.000Z",
        title: "deploy b",
        eventType: "deployment",
        isBeforeFirstDetection: true,
      },
    });
    const after: SecurityCaseImpactRecordJson = record({
      id: "c",
      lastChange: {
        id: "3",
        time: "2026-10-27T06:10:00.000Z",
        title: "deploy c",
        eventType: "deployment",
        isBeforeFirstDetection: false,
      },
    });
    const laterAfter: SecurityCaseImpactRecordJson = record({
      id: "d",
      lastChange: {
        id: "4",
        time: "2026-10-27T06:20:00.000Z",
        title: "deploy d",
        eventType: "deployment",
        isBeforeFirstDetection: false,
      },
    });

    expect(
      model.getImpactLeadingChange([after, before, laterBefore])?.record.id,
    ).toBe("b");
    expect(model.getImpactLeadingChange([laterAfter, after])?.record.id).toBe(
      "c",
    );
    expect(model.getImpactLeadingChange([record()])).toBeNull();
  });

  test("finds the status pages a record's monitors are shown on, and opens them", () => {
    expect(
      model.getRecordStatusPages(
        record({ monitors: { count: 1, items: [{ id: "m-1", title: "API" }] } }),
        [
          { id: STATUS_PAGE_ID, name: "Acme", monitorIds: ["m-1"] },
          { id: "other", name: "Other", monitorIds: ["m-9"] },
        ],
      ),
    ).toEqual([{ id: STATUS_PAGE_ID, name: "Acme", monitorIds: ["m-1"] }]);
    expect(model.getRecordStatusPages(record(), null)).toEqual([]);
    expect(open(model.getStatusPageRoute(STATUS_PAGE_ID)).path).toBe(
      `${BASE}/status-pages/${STATUS_PAGE_ID}`,
    );
    expect(model.getStatusPageRoute("not-an-id")).toBeNull();
    expect(model.getExceptionRoute("not-an-id")).toBeNull();
  });

  test("lists the busiest network peers first, at most the bound", () => {
    expect(
      model
        .getTopFlowPeers(
          [
            { caseAddress: "a", peerAddress: "x", direction: "out", bytes: 10, packets: 1, lastSeen: null },
            { caseAddress: "a", peerAddress: "y", direction: "in", bytes: 900, packets: 1, lastSeen: null },
            { caseAddress: "a", peerAddress: "z", direction: "out", bytes: 50, packets: 1, lastSeen: null },
          ],
          2,
        )
        .map((peer: { peerAddress: string }): string => {
          return peer.peerAddress;
        }),
    ).toEqual(["y", "z"]);
    expect(model.getTopFlowPeers(null, 5)).toEqual([]);
  });
});
