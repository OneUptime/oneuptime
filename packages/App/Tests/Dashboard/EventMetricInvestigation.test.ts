import { describe, expect, test } from "@jest/globals";
import ChartEventKind from "Common/UI/Components/Charts/Types/ChartEventKind";
import { ResolvedStateList } from "Common/Utils/ResolvedState";
import { StateListType } from "Common/Utils/StateOrder";
import {
  ALERT_STARTED_COLOR,
  EVENT_MOMENT_COLORS,
  EventMetricSubject,
  EventMetricWords,
  EventMoment,
  EventMomentRole,
  EventMomentState,
  getEventMetricWords,
  getEventMomentColor,
  getEventMomentLabel,
  getEventMoments,
} from "../../FeatureSet/Dashboard/src/Utils/EventMetricInvestigation";

/*
 * What an incident's, alert's or episode's metric investigation marks on
 * its charts (issue #5954): the moments of the event, and the words it
 * speaks of the event with. The time ranges it offers around the event are
 * every event card's own: EventTimePresets.test.ts.
 */

const MINUTE_MS: number = 60 * 1000;

const STARTED_AT: Date = new Date("2026-11-05T05:44:00.000Z");

function at(iso: string): Date {
  return new Date(iso);
}

// With no place in the list (order), each state counts as its flags alone say.
const STATES: Array<EventMomentState> = [
  { _id: "identified", name: "Identified" },
  { _id: "acknowledged", name: "Acknowledged", isAcknowledgedState: true },
  { _id: "monitoring", name: "  Monitoring  " },
  { _id: "resolved", name: "Resolved", isResolvedState: true },
];

function rolesOf(moments: Array<EventMoment>): Array<string> {
  return moments.map((moment: EventMoment): string => {
    return `${moment.role}:${moment.stateName}@${moment.date.toISOString()}`;
  });
}

describe("the moments of an event", () => {
  test("its start, and every change of state after the one it opened in", () => {
    const moments: Array<EventMoment> = getEventMoments({
      startedAt: STARTED_AT,
      timeline: [
        { stateId: "identified", startsAt: at("2026-11-05T05:44:00.000Z") },
        { stateId: "acknowledged", startsAt: at("2026-11-05T05:50:00.000Z") },
        { stateId: "monitoring", startsAt: at("2026-11-05T06:30:00.000Z") },
        { stateId: "resolved", startsAt: at("2026-11-05T07:02:00.000Z") },
      ],
      states: STATES,
      stateList: StateListType.IncidentState,
    });

    expect(rolesOf(moments)).toEqual([
      "started:@2026-11-05T05:44:00.000Z",
      "acknowledged:Acknowledged@2026-11-05T05:50:00.000Z",
      "state-changed:Monitoring@2026-11-05T06:30:00.000Z",
      "resolved:Resolved@2026-11-05T07:02:00.000Z",
    ]);
  });

  test("a timeline in any order reads in time order, and a reopen is a change too", () => {
    const moments: Array<EventMoment> = getEventMoments({
      startedAt: STARTED_AT,
      timeline: [
        { stateId: "identified", startsAt: at("2026-11-05T08:00:00.000Z") },
        { stateId: "resolved", startsAt: at("2026-11-05T07:02:00.000Z") },
        { stateId: "identified", startsAt: at("2026-11-05T05:44:00.000Z") },
      ],
      states: STATES,
      stateList: StateListType.IncidentState,
    });

    expect(rolesOf(moments)).toEqual([
      "started:@2026-11-05T05:44:00.000Z",
      "resolved:Resolved@2026-11-05T07:02:00.000Z",
      "state-changed:Identified@2026-11-05T08:00:00.000Z",
    ]);
  });

  test("when impact started earlier than the start, that is marked too", () => {
    const moments: Array<EventMoment> = getEventMoments({
      startedAt: STARTED_AT,
      impactStartedAt: at("2026-11-05T05:20:00.000Z"),
      timeline: [],
      states: STATES,
      stateList: StateListType.IncidentState,
    });

    expect(rolesOf(moments)).toEqual([
      "impact-started:@2026-11-05T05:20:00.000Z",
      "started:@2026-11-05T05:44:00.000Z",
    ]);
  });

  test("an impact start at or after the start says nothing new", () => {
    for (const impactStartedAt of [
      STARTED_AT,
      new Date(STARTED_AT.getTime() + MINUTE_MS),
    ]) {
      expect(
        rolesOf(
          getEventMoments({
            startedAt: STARTED_AT,
            impactStartedAt,
            timeline: [],
            states: STATES,
            stateList: StateListType.IncidentState,
          }),
        ),
      ).toEqual(["started:@2026-11-05T05:44:00.000Z"]);
    }
  });

  test("with no start, a recorded impact start is still marked", () => {
    expect(
      rolesOf(
        getEventMoments({
          impactStartedAt: at("2026-11-05T05:20:00.000Z"),
          timeline: [],
          states: [],
          stateList: StateListType.IncidentState,
        }),
      ),
    ).toEqual(["impact-started:@2026-11-05T05:20:00.000Z"]);
  });

  test("a state no longer known is a change with no name; undated entries are skipped", () => {
    const moments: Array<EventMoment> = getEventMoments({
      startedAt: STARTED_AT,
      timeline: [
        { stateId: "identified", startsAt: at("2026-11-05T05:44:00.000Z") },
        { stateId: "deleted-state", startsAt: at("2026-11-05T06:00:00.000Z") },
        { stateId: "acknowledged" },
        { startsAt: at("2026-11-05T06:10:00.000Z") },
        { stateId: "resolved", startsAt: new Date("nonsense") },
      ],
      states: STATES,
      stateList: StateListType.IncidentState,
    });

    expect(rolesOf(moments)).toEqual([
      "started:@2026-11-05T05:44:00.000Z",
      "state-changed:@2026-11-05T06:00:00.000Z",
      "state-changed:@2026-11-05T06:10:00.000Z",
    ]);
  });

  test("nothing known is nothing marked", () => {
    expect(
      getEventMoments({
        timeline: [],
        states: [],
        stateList: StateListType.IncidentState,
      }),
    ).toEqual([]);
  });
});

/*
 * A change is marked as what the state it moved into counts as, by the rule
 * every page reads (Common/Utils/ResolvedState, AcknowledgedState): a state
 * the project placed after Resolved ("Closed") counts as resolved, and one
 * placed after Acknowledged, short of Resolved ("Investigating"), as
 * acknowledged - flagged or not. Read by the flags alone, both were marked
 * as a plain change of state.
 */
describe("a change into a state the project placed after a built-in one", () => {
  const PLACED_STATES: Array<EventMomentState> = [
    { _id: "identified", name: "Identified", order: 1 },
    {
      _id: "acknowledged",
      name: "Acknowledged",
      order: 2,
      isAcknowledgedState: true,
    },
    { _id: "investigating", name: "Investigating", order: 3 },
    { _id: "resolved", name: "Resolved", order: 4, isResolvedState: true },
    { _id: "closed", name: "Closed", order: 5 },
  ];

  test.each([
    [StateListType.IncidentState],
    [StateListType.AlertState],
  ] as Array<[ResolvedStateList]>)(
    "in a project's %s list: after Resolved is a resolve, after Acknowledged an acknowledgement",
    (stateList: ResolvedStateList) => {
      const moments: Array<EventMoment> = getEventMoments({
        startedAt: STARTED_AT,
        timeline: [
          { stateId: "identified", startsAt: at("2026-11-05T05:44:00.000Z") },
          {
            stateId: "acknowledged",
            startsAt: at("2026-11-05T05:50:00.000Z"),
          },
          {
            stateId: "investigating",
            startsAt: at("2026-11-05T06:30:00.000Z"),
          },
          { stateId: "resolved", startsAt: at("2026-11-05T07:02:00.000Z") },
          { stateId: "closed", startsAt: at("2026-11-05T09:00:00.000Z") },
        ],
        states: PLACED_STATES,
        stateList: stateList,
      });

      expect(rolesOf(moments)).toEqual([
        "started:@2026-11-05T05:44:00.000Z",
        "acknowledged:Acknowledged@2026-11-05T05:50:00.000Z",
        "acknowledged:Investigating@2026-11-05T06:30:00.000Z",
        "resolved:Resolved@2026-11-05T07:02:00.000Z",
        "resolved:Closed@2026-11-05T09:00:00.000Z",
      ]);
    },
  );

  test("a move straight into a state placed after Resolved is a resolve", () => {
    expect(
      rolesOf(
        getEventMoments({
          startedAt: STARTED_AT,
          timeline: [
            { stateId: "identified", startsAt: STARTED_AT },
            { stateId: "closed", startsAt: at("2026-11-05T07:02:00.000Z") },
          ],
          states: PLACED_STATES,
          stateList: StateListType.IncidentState,
        }),
      ),
    ).toEqual([
      "started:@2026-11-05T05:44:00.000Z",
      "resolved:Closed@2026-11-05T07:02:00.000Z",
    ]);
  });

  test("a move straight into a state placed after Acknowledged, short of Resolved, is an acknowledgement", () => {
    expect(
      rolesOf(
        getEventMoments({
          startedAt: STARTED_AT,
          timeline: [
            { stateId: "identified", startsAt: STARTED_AT },
            {
              stateId: "investigating",
              startsAt: at("2026-11-05T06:30:00.000Z"),
            },
          ],
          states: PLACED_STATES,
          stateList: StateListType.AlertState,
        }),
      ),
    ).toEqual([
      "started:@2026-11-05T05:44:00.000Z",
      "acknowledged:Investigating@2026-11-05T06:30:00.000Z",
    ]);
  });

  test("a state the project placed above Acknowledged is still a change of state", () => {
    expect(
      rolesOf(
        getEventMoments({
          startedAt: STARTED_AT,
          timeline: [
            { stateId: "identified", startsAt: STARTED_AT },
            { stateId: "triaged", startsAt: at("2026-11-05T05:47:00.000Z") },
            {
              stateId: "acknowledged",
              startsAt: at("2026-11-05T05:50:00.000Z"),
            },
          ],
          states: [
            { _id: "identified", name: "Identified", order: 1 },
            { _id: "triaged", name: "Triaged", order: 2 },
            {
              _id: "acknowledged",
              name: "Acknowledged",
              order: 3,
              isAcknowledgedState: true,
            },
            {
              _id: "resolved",
              name: "Resolved",
              order: 4,
              isResolvedState: true,
            },
          ],
          stateList: StateListType.IncidentState,
        }),
      ),
    ).toEqual([
      "started:@2026-11-05T05:44:00.000Z",
      "state-changed:Triaged@2026-11-05T05:47:00.000Z",
      "acknowledged:Acknowledged@2026-11-05T05:50:00.000Z",
    ]);
  });
});

describe("the words for each kind of page", () => {
  test.each([
    [
      EventMetricSubject.Incident,
      "Around this incident",
      "This incident",
      "Declared",
      "incident",
      ChartEventKind.Incident,
    ],
    [
      EventMetricSubject.Alert,
      "Around this alert",
      "This alert",
      "Created",
      "alert",
      ChartEventKind.Alert,
    ],
    [
      EventMetricSubject.IncidentEpisode,
      "Around this episode",
      "This episode",
      "Declared",
      "incident",
      ChartEventKind.Incident,
    ],
    [
      EventMetricSubject.AlertEpisode,
      "Around this episode",
      "This episode",
      "Created",
      "alert",
      ChartEventKind.Alert,
    ],
  ])(
    "%s",
    (
      subject: EventMetricSubject,
      presetsHeading: string,
      momentSubtitle: string,
      startedLabel: string,
      telemetryNoun: string,
      markerKind: ChartEventKind,
    ) => {
      const words: EventMetricWords = getEventMetricWords(subject);

      expect(words.presetsHeading).toBe(presetsHeading);
      expect(words.momentSubtitle).toBe(momentSubtitle);
      expect(words.startedLabel).toBe(startedLabel);
      expect(words.telemetryNoun).toBe(telemetryNoun);
      expect(words.markerKind).toBe(markerKind);
      expect(words.evaluatedSubtitle).toMatch(
        /^What the monitor evaluated when it opened this /,
      );
    },
  );

  test("an unknown kind of page reads as an incident's", () => {
    expect(getEventMetricWords("later" as EventMetricSubject)).toEqual(
      getEventMetricWords(EventMetricSubject.Incident),
    );
  });

  /*
   * What the metric card says it shows, on the Overview and the Root Cause
   * page alike (issue #6320): an episode's card is its first member's, and
   * says so, in the words its member's own card uses.
   */
  test.each([
    [
      EventMetricSubject.Incident,
      "Metrics related to this incident.",
      "Metrics related to this incident, scoped to the affected series ({{seriesSummary}}).",
    ],
    [
      EventMetricSubject.Alert,
      "Metrics for this alert.",
      "Metrics for this alert, scoped to the affected series ({{seriesSummary}}).",
    ],
    [
      EventMetricSubject.IncidentEpisode,
      "Metrics related to this episode's first incident.",
      "Metrics related to this episode's first incident, scoped to the affected series ({{seriesSummary}}).",
    ],
    [
      EventMetricSubject.AlertEpisode,
      "Metrics for this episode's first alert.",
      "Metrics for this episode's first alert, scoped to the affected series ({{seriesSummary}}).",
    ],
  ])(
    "%s's card says what it shows",
    (subject: EventMetricSubject, description: string, scoped: string) => {
      const words: EventMetricWords = getEventMetricWords(subject);

      expect(words.description).toBe(description);
      expect(words.scopedDescription).toBe(scoped);
      // The narrowed sentence is the plain one, narrowed.
      expect(words.scopedDescription.replace(/, scoped to .*$/, ".")).toBe(
        words.description,
      );
    },
  );

  test("an episode's card names its first member: the one its evaluated window speaks of too", () => {
    for (const subject of [
      EventMetricSubject.IncidentEpisode,
      EventMetricSubject.AlertEpisode,
    ]) {
      const words: EventMetricWords = getEventMetricWords(subject);
      const member: string = `this episode's first ${words.telemetryNoun}`;

      expect(words.description).toContain(member);
      expect(words.scopedDescription).toContain(member);
      expect(words.evaluatedSubtitle).toContain(member);
    }
  });
});

describe("what a moment is called, and its colour", () => {
  const incidentWords: EventMetricWords = getEventMetricWords(
    EventMetricSubject.Incident,
  );
  const alertWords: EventMetricWords = getEventMetricWords(
    EventMetricSubject.Alert,
  );

  function moment(role: EventMomentRole, stateName: string = ""): EventMoment {
    return { date: STARTED_AT, role, stateName };
  }

  test.each([
    [moment(EventMomentRole.Started), "Declared", false],
    [moment(EventMomentRole.ImpactStarted), "Impact started", false],
    [moment(EventMomentRole.Acknowledged, "Triaged"), "Triaged", true],
    [moment(EventMomentRole.Acknowledged), "Acknowledged", false],
    [moment(EventMomentRole.Resolved, "Fixed"), "Fixed", true],
    [moment(EventMomentRole.Resolved), "Resolved", false],
    [moment(EventMomentRole.StateChanged, "Monitoring"), "Monitoring", true],
    [moment(EventMomentRole.StateChanged), "State changed", false],
  ])(
    "%o is called %s",
    (value: EventMoment, text: string, isStateName: boolean) => {
      expect(getEventMomentLabel(value, incidentWords)).toEqual({
        text,
        isStateName,
      });
    },
  );

  test("an alert's start is called what its page calls it", () => {
    expect(
      getEventMomentLabel(moment(EventMomentRole.Started), alertWords).text,
    ).toBe("Created");
  });

  test("each kind of moment has its own colour, an alert's start its own too", () => {
    for (const role of Object.values(EventMomentRole)) {
      expect(getEventMomentColor(role, incidentWords)).toBe(
        EVENT_MOMENT_COLORS[role],
      );
    }

    expect(getEventMomentColor(EventMomentRole.Started, alertWords)).toBe(
      ALERT_STARTED_COLOR,
    );
    expect(getEventMomentColor(EventMomentRole.Resolved, alertWords)).toBe(
      EVENT_MOMENT_COLORS[EventMomentRole.Resolved],
    );
    expect(
      new Set(Object.values(EVENT_MOMENT_COLORS)).size +
        (Object.values(EVENT_MOMENT_COLORS).includes(ALERT_STARTED_COLOR)
          ? 0
          : 1),
    ).toBe(Object.values(EventMomentRole).length + 1);
  });
});
