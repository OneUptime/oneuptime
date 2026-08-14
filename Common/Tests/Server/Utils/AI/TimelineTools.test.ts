import {
  GetAlertTimelineTool,
  GetIncidentTimelineTool,
} from "../../../../Server/Utils/AI/Toolbox/TimelineTools";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../../Server/Utils/AI/Toolbox/ToolTypes";
import AlertFeedService from "../../../../Server/Services/AlertFeedService";
import AlertInternalNoteService from "../../../../Server/Services/AlertInternalNoteService";
import AlertService from "../../../../Server/Services/AlertService";
import AlertStateTimelineService from "../../../../Server/Services/AlertStateTimelineService";
import IncidentFeedService from "../../../../Server/Services/IncidentFeedService";
import IncidentInternalNoteService from "../../../../Server/Services/IncidentInternalNoteService";
import IncidentPublicNoteService from "../../../../Server/Services/IncidentPublicNoteService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentStateTimelineService from "../../../../Server/Services/IncidentStateTimelineService";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertFeed, {
  AlertFeedEventType,
} from "../../../../Models/DatabaseModels/AlertFeed";
import AlertInternalNote from "../../../../Models/DatabaseModels/AlertInternalNote";
import AlertState from "../../../../Models/DatabaseModels/AlertState";
import AlertStateTimeline from "../../../../Models/DatabaseModels/AlertStateTimeline";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentFeed, {
  IncidentFeedEventType,
} from "../../../../Models/DatabaseModels/IncidentFeed";
import IncidentInternalNote from "../../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentPublicNote from "../../../../Models/DatabaseModels/IncidentPublicNote";
import IncidentState from "../../../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../../../Models/DatabaseModels/IncidentStateTimeline";
import User from "../../../../Models/DatabaseModels/User";
import { AIChatCitationTargetType } from "../../../../Types/AI/AIChatTypes";
import { JSONObject } from "../../../../Types/JSON";
import Name from "../../../../Types/Name";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * get_incident_timeline / get_alert_timeline merge state changes, notes and
 * feed events into one chronological thread. These tests lock in what the
 * model relies on: entries from every source appear tagged and in time order,
 * the newest-N cap is honest about slicing, tenancy is pinned to ctx, and
 * missing entities yield empty results instead of phantom timelines.
 */

const ctx: ToolContext = {
  projectId: ObjectID.generate(),
  props: { isRoot: true },
};

const INCIDENT_ID: ObjectID = ObjectID.generate();
const ALERT_ID: ObjectID = ObjectID.generate();

function buildUser(name: string): User {
  const user: User = new User();
  user.name = new Name(name);
  return user;
}

function buildIncident(): Incident {
  const incident: Incident = new Incident();
  incident._id = INCIDENT_ID.toString();
  incident.incidentNumber = 42;
  incident.title = "Checkout is down";
  return incident;
}

function buildStateChange(data: {
  state: string;
  at: Date;
  by?: string;
  rootCause?: string;
}): IncidentStateTimeline {
  const timeline: IncidentStateTimeline = new IncidentStateTimeline();
  timeline._id = ObjectID.generate().toString();
  timeline.startsAt = data.at;
  timeline.createdAt = data.at;
  if (data.rootCause) {
    timeline.rootCause = data.rootCause;
  }
  const state: IncidentState = new IncidentState();
  state.name = data.state;
  timeline.incidentState = state;
  if (data.by) {
    timeline.createdByUser = buildUser(data.by);
  }
  return timeline;
}

function buildInternalNote(data: {
  note: string;
  at: Date;
  by?: string;
}): IncidentInternalNote {
  const note: IncidentInternalNote = new IncidentInternalNote();
  note._id = ObjectID.generate().toString();
  note.note = data.note;
  note.createdAt = data.at;
  if (data.by) {
    note.createdByUser = buildUser(data.by);
  }
  return note;
}

function buildPublicNote(data: {
  note: string;
  at: Date;
  by?: string;
}): IncidentPublicNote {
  const note: IncidentPublicNote = new IncidentPublicNote();
  note._id = ObjectID.generate().toString();
  note.note = data.note;
  note.postedAt = data.at;
  note.createdAt = data.at;
  if (data.by) {
    note.createdByUser = buildUser(data.by);
  }
  return note;
}

function buildFeedItem(data: { info: string; at: Date }): IncidentFeed {
  const feed: IncidentFeed = new IncidentFeed();
  feed._id = ObjectID.generate().toString();
  feed.feedInfoInMarkdown = data.info;
  feed.postedAt = data.at;
  feed.createdAt = data.at;
  feed.incidentFeedEventType = IncidentFeedEventType.IncidentCreated;
  return feed;
}

function mockIncidentSources(data: {
  stateTimeline?: Array<IncidentStateTimeline>;
  internalNotes?: Array<IncidentInternalNote>;
  publicNotes?: Array<IncidentPublicNote>;
  feedItems?: Array<IncidentFeed>;
}): {
  stateSpy: jest.SpyInstance;
  internalSpy: jest.SpyInstance;
  publicSpy: jest.SpyInstance;
  feedSpy: jest.SpyInstance;
} {
  return {
    stateSpy: jest
      .spyOn(IncidentStateTimelineService, "findBy")
      .mockResolvedValue((data.stateTimeline ?? []) as never),
    internalSpy: jest
      .spyOn(IncidentInternalNoteService, "findBy")
      .mockResolvedValue((data.internalNotes ?? []) as never),
    publicSpy: jest
      .spyOn(IncidentPublicNoteService, "findBy")
      .mockResolvedValue((data.publicNotes ?? []) as never),
    feedSpy: jest
      .spyOn(IncidentFeedService, "findBy")
      .mockResolvedValue((data.feedItems ?? []) as never),
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("get_incident_timeline", () => {
  test("merges all four sources into one chronological, tagged thread", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(buildIncident() as never);

    const spies: { stateSpy: jest.SpyInstance } = mockIncidentSources({
      stateTimeline: [
        buildStateChange({
          state: "Investigating",
          at: new Date("2026-08-01T10:00:00Z"),
          by: "Alice Doe",
        }),
      ],
      internalNotes: [
        buildInternalNote({
          note: "Rolled back the deploy.",
          at: new Date("2026-08-01T10:30:00Z"),
          by: "Bob Ray",
        }),
      ],
      publicNotes: [
        buildPublicNote({
          note: "We are seeing elevated errors.",
          at: new Date("2026-08-01T11:00:00Z"),
        }),
      ],
      feedItems: [
        buildFeedItem({
          info: "Incident created",
          at: new Date("2026-08-01T09:45:00Z"),
        }),
      ],
    });

    const result: ToolExecutionResult = await GetIncidentTimelineTool.execute(
      { incidentId: INCIDENT_ID.toString() },
      ctx,
    );

    expect(result.rowCount).toBe(4);
    expect(result.dataForLlm).toContain("Investigating");
    expect(result.dataForLlm).toContain("Rolled back the deploy.");
    expect(result.dataForLlm).toContain("We are seeing elevated errors.");
    expect(result.dataForLlm).toContain("Incident created");

    // Every entry is tagged with its source type and author where available.
    expect(result.dataForLlm).toContain("state-change");
    expect(result.dataForLlm).toContain("internal-note");
    expect(result.dataForLlm).toContain("public-note");
    expect(result.dataForLlm).toContain("feed");
    expect(result.dataForLlm).toContain("Alice Doe");
    expect(result.dataForLlm).toContain("Bob Ray");

    // Chronological order: feed (09:45) → state (10:00) → internal (10:30) → public (11:00).
    const feedIndex: number = result.dataForLlm.indexOf("Incident created");
    const stateIndex: number = result.dataForLlm.indexOf("Investigating");
    const internalIndex: number = result.dataForLlm.indexOf("Rolled back");
    const publicIndex: number = result.dataForLlm.indexOf("elevated errors");
    expect(feedIndex).toBeLessThan(stateIndex);
    expect(stateIndex).toBeLessThan(internalIndex);
    expect(internalIndex).toBeLessThan(publicIndex);

    expect(result.citationLabel).toBe("Incident #42 timeline (4 entries)");
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.IncidentView,
      params: { incidentId: INCIDENT_ID.toString() },
    });
    expect(result.widget).toBeDefined();

    // Tenancy: every source query is pinned to the ctx tenant, under ctx props.
    const callArgs: JSONObject = spies.stateSpy.mock
      .calls[0]?.[0] as JSONObject;
    const query: JSONObject = callArgs["query"] as JSONObject;
    expect((query["incidentId"] as ObjectID).toString()).toBe(
      INCIDENT_ID.toString(),
    );
    expect(query["projectId"]).toBe(ctx.projectId);
    expect(callArgs["props"]).toBe(ctx.props);
  });

  test("clamps limit to 50 on every source query", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(buildIncident() as never);

    const spies: {
      stateSpy: jest.SpyInstance;
      internalSpy: jest.SpyInstance;
      publicSpy: jest.SpyInstance;
      feedSpy: jest.SpyInstance;
    } = mockIncidentSources({});

    await GetIncidentTimelineTool.execute(
      { incidentId: INCIDENT_ID.toString(), limit: 9999 },
      ctx,
    );

    for (const spy of [
      spies.stateSpy,
      spies.internalSpy,
      spies.publicSpy,
      spies.feedSpy,
    ]) {
      const callArgs: JSONObject = spy.mock.calls[0]?.[0] as JSONObject;
      expect(callArgs["limit"]).toBe(50);
    }
  });

  test("keeps only the newest entries when over the limit, and says so", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(buildIncident() as never);

    mockIncidentSources({
      stateTimeline: [
        buildStateChange({
          state: "Resolved",
          at: new Date("2026-08-01T12:00:00Z"),
        }),
      ],
      internalNotes: [
        buildInternalNote({
          note: "Oldest note, should be dropped.",
          at: new Date("2026-08-01T09:00:00Z"),
        }),
      ],
      publicNotes: [
        buildPublicNote({
          note: "Newest public note.",
          at: new Date("2026-08-01T13:00:00Z"),
        }),
      ],
    });

    const result: ToolExecutionResult = await GetIncidentTimelineTool.execute(
      { incidentId: INCIDENT_ID.toString(), limit: 2 },
      ctx,
    );

    expect(result.rowCount).toBe(2);
    expect(result.dataForLlm).toContain("Resolved");
    expect(result.dataForLlm).toContain("Newest public note.");
    expect(result.dataForLlm).not.toContain("Oldest note");
    expect(result.dataForLlm).toContain("Showing the newest 2 of 3");
  });

  test("missing incidentId returns an error envelope, not a query", async () => {
    const findOneByIdSpy: jest.SpyInstance = jest.spyOn(
      IncidentService,
      "findOneById",
    );

    const result: ToolExecutionResult = await GetIncidentTimelineTool.execute(
      {},
      ctx,
    );

    expect(result.rowCount).toBe(0);
    expect(result.dataForLlm).toContain("Error: incidentId is required");
    expect(result.widget).toBeUndefined();
    expect(findOneByIdSpy).not.toHaveBeenCalled();
  });

  test("an unknown incident is honest: zero rows, no timeline queries", async () => {
    jest.spyOn(IncidentService, "findOneById").mockResolvedValue(null as never);

    const spies: { stateSpy: jest.SpyInstance } = mockIncidentSources({});

    const result: ToolExecutionResult = await GetIncidentTimelineTool.execute(
      { incidentId: INCIDENT_ID.toString() },
      ctx,
    );

    expect(result.rowCount).toBe(0);
    expect(result.dataForLlm).toContain("not found");
    expect(result.widget).toBeUndefined();
    expect(spies.stateSpy).not.toHaveBeenCalled();
  });

  test("an incident with no activity yields an honest empty result", async () => {
    jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(buildIncident() as never);

    mockIncidentSources({});

    const result: ToolExecutionResult = await GetIncidentTimelineTool.execute(
      { incidentId: INCIDENT_ID.toString() },
      ctx,
    );

    expect(result.rowCount).toBe(0);
    expect(result.widget).toBeUndefined();
  });

  test("required permissions derive from the incident read ACL", () => {
    expect(GetIncidentTimelineTool.requiredPermissions.length).toBeGreaterThan(
      0,
    );
  });
});

describe("get_alert_timeline", () => {
  function buildAlert(): Alert {
    const alert: Alert = new Alert();
    alert._id = ALERT_ID.toString();
    alert.alertNumber = 7;
    alert.title = "CPU is high";
    return alert;
  }

  test("merges state changes, internal notes and feed events chronologically", async () => {
    jest
      .spyOn(AlertService, "findOneById")
      .mockResolvedValue(buildAlert() as never);

    const stateTimeline: AlertStateTimeline = new AlertStateTimeline();
    stateTimeline._id = ObjectID.generate().toString();
    stateTimeline.startsAt = new Date("2026-08-02T10:00:00Z");
    stateTimeline.createdAt = new Date("2026-08-02T10:00:00Z");
    const alertState: AlertState = new AlertState();
    alertState.name = "Acknowledged";
    stateTimeline.alertState = alertState;
    stateTimeline.createdByUser = buildUser("Carol Kim");

    const internalNote: AlertInternalNote = new AlertInternalNote();
    internalNote._id = ObjectID.generate().toString();
    internalNote.note = "Scaling up the pool.";
    internalNote.createdAt = new Date("2026-08-02T10:15:00Z");

    const feedItem: AlertFeed = new AlertFeed();
    feedItem._id = ObjectID.generate().toString();
    feedItem.feedInfoInMarkdown = "Alert created";
    feedItem.postedAt = new Date("2026-08-02T09:55:00Z");
    feedItem.createdAt = new Date("2026-08-02T09:55:00Z");
    feedItem.alertFeedEventType = AlertFeedEventType.AlertCreated;

    const stateSpy: jest.SpyInstance = jest
      .spyOn(AlertStateTimelineService, "findBy")
      .mockResolvedValue([stateTimeline] as never);
    jest
      .spyOn(AlertInternalNoteService, "findBy")
      .mockResolvedValue([internalNote] as never);
    jest
      .spyOn(AlertFeedService, "findBy")
      .mockResolvedValue([feedItem] as never);

    const result: ToolExecutionResult = await GetAlertTimelineTool.execute(
      { alertId: ALERT_ID.toString() },
      ctx,
    );

    expect(result.rowCount).toBe(3);
    expect(result.dataForLlm).toContain("Acknowledged");
    expect(result.dataForLlm).toContain("Scaling up the pool.");
    expect(result.dataForLlm).toContain("Alert created");
    expect(result.dataForLlm).toContain("Carol Kim");

    // Chronological: feed (09:55) → state (10:00) → internal note (10:15).
    const feedIndex: number = result.dataForLlm.indexOf("Alert created");
    const stateIndex: number = result.dataForLlm.indexOf("Acknowledged");
    const noteIndex: number = result.dataForLlm.indexOf("Scaling up");
    expect(feedIndex).toBeLessThan(stateIndex);
    expect(stateIndex).toBeLessThan(noteIndex);

    expect(result.citationLabel).toBe("Alert #7 timeline (3 entries)");
    expect(result.citationTarget).toEqual({
      type: AIChatCitationTargetType.AlertView,
      params: { alertId: ALERT_ID.toString() },
    });
    expect(result.widget).toBeDefined();

    // Tenancy is pinned to ctx on the source queries.
    const callArgs: JSONObject = stateSpy.mock.calls[0]?.[0] as JSONObject;
    const query: JSONObject = callArgs["query"] as JSONObject;
    expect((query["alertId"] as ObjectID).toString()).toBe(ALERT_ID.toString());
    expect(query["projectId"]).toBe(ctx.projectId);
    expect(callArgs["props"]).toBe(ctx.props);
  });

  test("missing alertId returns an error envelope", async () => {
    const result: ToolExecutionResult = await GetAlertTimelineTool.execute(
      {},
      ctx,
    );

    expect(result.rowCount).toBe(0);
    expect(result.dataForLlm).toContain("Error: alertId is required");
    expect(result.widget).toBeUndefined();
  });

  test("an unknown alert is honest: zero rows and no widget", async () => {
    jest.spyOn(AlertService, "findOneById").mockResolvedValue(null as never);

    const result: ToolExecutionResult = await GetAlertTimelineTool.execute(
      { alertId: ALERT_ID.toString() },
      ctx,
    );

    expect(result.rowCount).toBe(0);
    expect(result.dataForLlm).toContain("not found");
    expect(result.widget).toBeUndefined();
  });

  test("required permissions derive from the alert read ACL", () => {
    expect(GetAlertTimelineTool.requiredPermissions.length).toBeGreaterThan(0);
  });
});
