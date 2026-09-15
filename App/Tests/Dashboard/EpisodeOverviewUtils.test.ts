import { describe, expect, test } from "@jest/globals";
import { Black } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Alert from "Common/Models/DatabaseModels/Alert";
import { AlertEpisodeFeedEventType } from "Common/Models/DatabaseModels/AlertEpisodeFeed";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import Incident from "Common/Models/DatabaseModels/Incident";
import { IncidentEpisodeFeedEventType } from "Common/Models/DatabaseModels/IncidentEpisodeFeed";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import {
  EpisodeTiming,
  EpisodeTimingState,
  getEpisodeTiming,
  getLatestTimelineStateId,
} from "../../FeatureSet/Dashboard/src/Components/EpisodeView/EpisodeTiming";
import {
  ALERT_EPISODE_FEED_ICONS,
  INCIDENT_EPISODE_FEED_ICONS,
  getAlertEpisodeFeedIcon,
  getIncidentEpisodeFeedIcon,
} from "../../FeatureSet/Dashboard/src/Components/EpisodeView/EpisodeFeedIcons";
import {
  ALERT_EPISODE_MEMBER_SELECT,
  EPISODE_MEMBERS_PREVIEW_LIMIT,
  EpisodeMemberRow,
  INCIDENT_EPISODE_MEMBER_SELECT,
  getAlertEpisodeMemberRow,
  getIncidentEpisodeMemberRow,
} from "../../FeatureSet/Dashboard/src/Components/EpisodeView/EpisodeMembers";

/*
 * Pure logic behind the incident episode and alert episode overviews: the
 * headline timings (shared by the header and the stat bar so they can never
 * disagree), the feed icon tables and the member-row mapping used by the
 * "Incidents / Alerts in this episode" card.
 */

const CREATED: EpisodeTimingState = {
  id: "created",
  name: "Created",
};

const ACKNOWLEDGED: EpisodeTimingState = {
  id: "acknowledged",
  name: "Acknowledged",
  isAcknowledgedState: true,
};

const RESOLVED: EpisodeTimingState = {
  id: "resolved",
  name: "Resolved",
  isResolvedState: true,
};

const STATES: Array<EpisodeTimingState> = [CREATED, ACKNOWLEDGED, RESOLVED];

const START: Date = new Date("2026-09-14T18:00:00.000Z");

type AtFunction = (minutes: number) => Date;

const at: AtFunction = (minutes: number): Date => {
  return new Date(START.getTime() + minutes * 60 * 1000);
};

describe("getEpisodeTiming", () => {
  test("measures acknowledge and resolve from the episode start, not the first timeline entry", () => {
    const timing: EpisodeTiming = getEpisodeTiming({
      startedAt: START,
      states: STATES,
      timelines: [
        // Written 30 minutes after the episode was declared.
        { stateId: CREATED.id, startsAt: at(30) },
        { stateId: ACKNOWLEDGED.id, startsAt: at(42) },
        { stateId: RESOLVED.id, startsAt: at(125) },
      ],
    });

    expect(timing.timeToAcknowledge).toBe("42 minutes");
    expect(timing.timeToResolve).toBe("2 hours, 5 minutes");
    expect(timing.durationStartsAt).toBe(START);
    expect(timing.durationEndsAt).toEqual(at(125));
    expect(timing.isResolved).toBe(true);
  });

  test("uses the state names the project configured", () => {
    const timing: EpisodeTiming = getEpisodeTiming({
      startedAt: START,
      states: [
        { id: "a", name: "Triaged", isAcknowledgedState: true },
        { id: "r", name: "Fixed", isResolvedState: true },
      ],
      timelines: [],
    });

    expect(timing.acknowledgedStateName).toBe("Triaged");
    expect(timing.resolvedStateName).toBe("Fixed");
    expect(timing.timeToAcknowledge).toBe("Not yet triaged");
    expect(timing.timeToResolve).toBe("Not yet fixed");
  });

  test("falls back to generic names when no state is flagged", () => {
    const timing: EpisodeTiming = getEpisodeTiming({
      startedAt: START,
      states: [CREATED],
      timelines: [{ stateId: CREATED.id, startsAt: START }],
    });

    expect(timing.acknowledgedStateName).toBe("Acknowledged");
    expect(timing.resolvedStateName).toBe("Resolved");
    expect(timing.timeToAcknowledge).toBe("Not yet acknowledged");
    expect(timing.timeToResolve).toBe("Not yet resolved");
    expect(timing.durationEndsAt).toBeUndefined();
    expect(timing.isResolved).toBe(false);
  });

  test("an episode resolved without acknowledgement was acknowledged when it resolved", () => {
    const timing: EpisodeTiming = getEpisodeTiming({
      startedAt: START,
      states: STATES,
      timelines: [
        { stateId: CREATED.id, startsAt: START },
        { stateId: RESOLVED.id, startsAt: at(15) },
      ],
    });

    expect(timing.timeToAcknowledge).toBe("15 minutes");
    expect(timing.timeToResolve).toBe("15 minutes");
  });

  test("uses the FIRST acknowledge and resolve, so reopening does not rewrite them", () => {
    const timing: EpisodeTiming = getEpisodeTiming({
      startedAt: START,
      states: STATES,
      timelines: [
        { stateId: CREATED.id, startsAt: START },
        { stateId: ACKNOWLEDGED.id, startsAt: at(5) },
        { stateId: RESOLVED.id, startsAt: at(20) },
        { stateId: ACKNOWLEDGED.id, startsAt: at(90) },
        { stateId: RESOLVED.id, startsAt: at(180) },
      ],
    });

    expect(timing.timeToAcknowledge).toBe("5 minutes");
    expect(timing.timeToResolve).toBe("20 minutes");
    // The duration runs to the resolve that is current now.
    expect(timing.durationEndsAt).toEqual(at(180));
  });

  test("a reopened episode keeps its duration running", () => {
    const timing: EpisodeTiming = getEpisodeTiming({
      startedAt: START,
      resolvedAt: at(20),
      states: STATES,
      timelines: [
        { stateId: CREATED.id, startsAt: START },
        { stateId: RESOLVED.id, startsAt: at(20) },
        { stateId: ACKNOWLEDGED.id, startsAt: at(60) },
      ],
    });

    expect(timing.timeToResolve).toBe("20 minutes");
    expect(timing.durationEndsAt).toBeUndefined();
    expect(timing.isResolved).toBe(false);
  });

  test("sorts timelines that arrive out of order", () => {
    const timing: EpisodeTiming = getEpisodeTiming({
      startedAt: START,
      states: STATES,
      timelines: [
        { stateId: RESOLVED.id, startsAt: at(50) },
        { stateId: ACKNOWLEDGED.id, startsAt: at(10) },
        { stateId: CREATED.id, startsAt: START },
      ],
    });

    expect(timing.timeToAcknowledge).toBe("10 minutes");
    expect(timing.durationEndsAt).toEqual(at(50));
  });

  test("ignores timeline entries without a date", () => {
    const timing: EpisodeTiming = getEpisodeTiming({
      startedAt: START,
      states: STATES,
      timelines: [
        { stateId: ACKNOWLEDGED.id },
        { stateId: RESOLVED.id, startsAt: undefined },
      ],
    });

    expect(timing.timeToAcknowledge).toBe("Not yet acknowledged");
    expect(timing.timeToResolve).toBe("Not yet resolved");
    // No dated entry at all: fall back to the episode's resolvedAt (none).
    expect(timing.durationEndsAt).toBeUndefined();
  });

  test("never measures from now when the start is unknown", () => {
    const timing: EpisodeTiming = getEpisodeTiming({
      startedAt: undefined,
      states: STATES,
      timelines: [
        { stateId: ACKNOWLEDGED.id, startsAt: at(10) },
        { stateId: RESOLVED.id, startsAt: at(20) },
      ],
    });

    expect(timing.timeToAcknowledge).toBe("-");
    expect(timing.timeToResolve).toBe("-");
    expect(timing.durationStartsAt).toBeUndefined();
  });

  test("still says 'Not yet' without a start date", () => {
    const timing: EpisodeTiming = getEpisodeTiming({
      startedAt: undefined,
      states: STATES,
      timelines: [],
    });

    expect(timing.timeToAcknowledge).toBe("Not yet acknowledged");
    expect(timing.timeToResolve).toBe("Not yet resolved");
  });

  test("uses resolvedAt only when no timeline could be read", () => {
    const withoutTimeline: EpisodeTiming = getEpisodeTiming({
      startedAt: START,
      resolvedAt: at(33),
      states: STATES,
      timelines: [],
    });

    expect(withoutTimeline.durationEndsAt).toEqual(at(33));
    expect(withoutTimeline.isResolved).toBe(true);

    const withTimeline: EpisodeTiming = getEpisodeTiming({
      startedAt: START,
      resolvedAt: at(33),
      states: STATES,
      timelines: [{ stateId: ACKNOWLEDGED.id, startsAt: at(40) }],
    });

    expect(withTimeline.durationEndsAt).toBeUndefined();
  });

  test("less than a minute reads naturally", () => {
    const timing: EpisodeTiming = getEpisodeTiming({
      startedAt: START,
      states: STATES,
      timelines: [
        {
          stateId: ACKNOWLEDGED.id,
          startsAt: new Date(START.getTime() + 20 * 1000),
        },
      ],
    });

    expect(timing.timeToAcknowledge).toBe("less than a minute");
  });

  test("ignores states without an id", () => {
    const timing: EpisodeTiming = getEpisodeTiming({
      startedAt: START,
      states: [
        { id: "", name: "Ghost", isAcknowledgedState: true },
        ACKNOWLEDGED,
        RESOLVED,
      ],
      timelines: [{ stateId: ACKNOWLEDGED.id, startsAt: at(7) }],
    });

    expect(timing.acknowledgedStateName).toBe("Acknowledged");
    expect(timing.timeToAcknowledge).toBe("7 minutes");
  });

  test("does not mutate the timelines it was given", () => {
    const timelines: Array<{ stateId: string; startsAt: Date }> = [
      { stateId: RESOLVED.id, startsAt: at(50) },
      { stateId: CREATED.id, startsAt: START },
    ];

    getEpisodeTiming({ startedAt: START, states: STATES, timelines });

    expect(timelines[0]!.stateId).toBe(RESOLVED.id);
    expect(timelines[1]!.stateId).toBe(CREATED.id);
  });
});

describe("getLatestTimelineStateId", () => {
  test("returns the state of the latest dated entry in any order", () => {
    expect(
      getLatestTimelineStateId([
        { stateId: ACKNOWLEDGED.id, startsAt: at(10) },
        { stateId: RESOLVED.id, startsAt: at(30) },
        { stateId: CREATED.id, startsAt: START },
      ]),
    ).toBe(RESOLVED.id);
  });

  test("a later entry wins a tie", () => {
    expect(
      getLatestTimelineStateId([
        { stateId: ACKNOWLEDGED.id, startsAt: at(10) },
        { stateId: RESOLVED.id, startsAt: at(10) },
      ]),
    ).toBe(RESOLVED.id);
  });

  test("is undefined when nothing is dated", () => {
    expect(getLatestTimelineStateId([])).toBeUndefined();
    expect(
      getLatestTimelineStateId([{ stateId: CREATED.id, startsAt: undefined }]),
    ).toBeUndefined();
  });
});

describe("episode feed icons", () => {
  test.each(Object.values(IncidentEpisodeFeedEventType))(
    "incident episode %s has its own icon",
    (eventType: IncidentEpisodeFeedEventType) => {
      expect(INCIDENT_EPISODE_FEED_ICONS[eventType]).toBeDefined();
      expect(getIncidentEpisodeFeedIcon(eventType)).not.toBe(IconProp.Circle);
    },
  );

  test.each(Object.values(AlertEpisodeFeedEventType))(
    "alert episode %s has its own icon",
    (eventType: AlertEpisodeFeedEventType) => {
      expect(ALERT_EPISODE_FEED_ICONS[eventType]).toBeDefined();
      expect(getAlertEpisodeFeedIcon(eventType)).not.toBe(IconProp.Circle);
    },
  );

  test("the events that used to fall back to a circle are mapped", () => {
    expect(
      getIncidentEpisodeFeedIcon(IncidentEpisodeFeedEventType.PublicNote),
    ).toBe(IconProp.Announcement);
    expect(
      getIncidentEpisodeFeedIcon(IncidentEpisodeFeedEventType.RemediationNotes),
    ).toBe(IconProp.Wrench);
    expect(
      getIncidentEpisodeFeedIcon(
        IncidentEpisodeFeedEventType.SubscriberNotificationSent,
      ),
    ).toBe(IconProp.Notification);
    expect(
      getIncidentEpisodeFeedIcon(
        IncidentEpisodeFeedEventType.PrivacyRuleExecuted,
      ),
    ).toBe(IconProp.EyeSlash);
    expect(
      getAlertEpisodeFeedIcon(AlertEpisodeFeedEventType.PrivacyRuleExecuted),
    ).toBe(IconProp.EyeSlash);
  });

  test("keeps the icons the feeds already used", () => {
    expect(
      getIncidentEpisodeFeedIcon(IncidentEpisodeFeedEventType.EpisodeCreated),
    ).toBe(IconProp.Layers);
    expect(
      getIncidentEpisodeFeedIcon(
        IncidentEpisodeFeedEventType.EpisodeStateChanged,
      ),
    ).toBe(IconProp.ArrowCircleRight);
    expect(getAlertEpisodeFeedIcon(AlertEpisodeFeedEventType.AlertAdded)).toBe(
      IconProp.Alert,
    );
    expect(
      getAlertEpisodeFeedIcon(AlertEpisodeFeedEventType.SeverityChanged),
    ).toBe(IconProp.ExclaimationCircle);
  });

  test("an unknown or missing event type falls back to a circle", () => {
    expect(getIncidentEpisodeFeedIcon(undefined)).toBe(IconProp.Circle);
    expect(
      getAlertEpisodeFeedIcon("SomethingNew" as AlertEpisodeFeedEventType),
    ).toBe(IconProp.Circle);
  });
});

describe("episode member rows", () => {
  const MEMBER_ID: string = "55555555-5555-4555-8555-555555555555";

  test("maps an incident to a row with its prefix, state, severity and declared time", () => {
    const incident: Incident = new Incident();
    incident.id = new ObjectID(MEMBER_ID);
    incident.title = "Checkout API returning 500s";
    incident.incidentNumber = 42;
    incident.incidentNumberWithPrefix = "INC-42";
    incident.declaredAt = START;
    incident.createdAt = at(3);

    const state: IncidentState = new IncidentState();
    state.name = "Investigating";
    state.color = new Color("#f59e0b");
    incident.currentIncidentState = state;

    const severity: IncidentSeverity = new IncidentSeverity();
    severity.name = "Critical";
    severity.color = new Color("#ef4444");
    incident.incidentSeverity = severity;

    const row: EpisodeMemberRow = getIncidentEpisodeMemberRow(incident);

    expect(row.id).toBe(MEMBER_ID);
    expect(row.number).toBe("INC-42");
    expect(row.title).toBe("Checkout API returning 500s");
    expect(row.state?.name).toBe("Investigating");
    expect(row.state?.color.toString()).toBe("#f59e0b");
    expect(row.severity?.name).toBe("Critical");
    expect(row.occurredAt).toBe(START);
  });

  test("an incident without a prefix, declared time or relations still maps", () => {
    const incident: Incident = new Incident();
    incident.id = new ObjectID(MEMBER_ID);
    incident.incidentNumber = 7;
    incident.createdAt = at(3);

    const row: EpisodeMemberRow = getIncidentEpisodeMemberRow(incident);

    expect(row.number).toBe("#7");
    expect(row.title).toBe("Untitled incident");
    expect(row.state).toBeUndefined();
    expect(row.severity).toBeUndefined();
    expect(row.occurredAt).toEqual(at(3));
  });

  test("a state or severity that lost its name or color gets the details-card fallbacks", () => {
    const incident: Incident = new Incident();
    incident.id = new ObjectID(MEMBER_ID);
    incident.currentIncidentState = new IncidentState();
    incident.incidentSeverity = new IncidentSeverity();

    const row: EpisodeMemberRow = getIncidentEpisodeMemberRow(incident);

    expect(row.number).toBeUndefined();
    expect(row.state?.name).toBe("Unknown");
    expect(row.state?.color).toBe(Black);
    expect(row.severity?.name).toBe("Unknown");
    expect(row.severity?.color).toBe(Black);
  });

  test("maps an alert with its created time", () => {
    const alert: Alert = new Alert();
    alert.id = new ObjectID(MEMBER_ID);
    alert.title = "Disk almost full";
    alert.alertNumber = 3;
    alert.alertNumberWithPrefix = "ALT-3";
    alert.createdAt = at(12);

    const state: AlertState = new AlertState();
    state.name = "Acknowledged";
    state.color = new Color("#10b981");
    alert.currentAlertState = state;

    const severity: AlertSeverity = new AlertSeverity();
    severity.name = "Warning";
    severity.color = new Color("#eab308");
    alert.alertSeverity = severity;

    const row: EpisodeMemberRow = getAlertEpisodeMemberRow(alert);

    expect(row.id).toBe(MEMBER_ID);
    expect(row.number).toBe("ALT-3");
    expect(row.title).toBe("Disk almost full");
    expect(row.state?.name).toBe("Acknowledged");
    expect(row.severity?.name).toBe("Warning");
    expect(row.occurredAt).toEqual(at(12));
  });

  test("an untitled alert without a number still maps", () => {
    const alert: Alert = new Alert();
    alert.id = new ObjectID(MEMBER_ID);

    const row: EpisodeMemberRow = getAlertEpisodeMemberRow(alert);

    expect(row.number).toBeUndefined();
    expect(row.title).toBe("Untitled alert");
    expect(row.occurredAt).toBeUndefined();
  });

  test("the member selects ask for exactly what a row shows", () => {
    expect(Object.keys(INCIDENT_EPISODE_MEMBER_SELECT).sort()).toEqual(
      [
        "_id",
        "createdAt",
        "currentIncidentState",
        "declaredAt",
        "incidentNumber",
        "incidentNumberWithPrefix",
        "incidentSeverity",
        "title",
      ].sort(),
    );
    expect(Object.keys(ALERT_EPISODE_MEMBER_SELECT).sort()).toEqual(
      [
        "_id",
        "alertNumber",
        "alertNumberWithPrefix",
        "alertSeverity",
        "createdAt",
        "currentAlertState",
        "title",
      ].sort(),
    );
    expect(EPISODE_MEMBERS_PREVIEW_LIMIT).toBe(8);
  });
});
