import Alert from "../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import WorkspaceNotificationSummaryService, {
  Service as WorkspaceNotificationSummaryServiceClass,
} from "../../../Server/Services/WorkspaceNotificationSummaryService";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import NotificationRuleCondition, {
  ConditionType,
  NotificationRuleConditionCheckOn,
} from "../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import WorkspaceNotificationSummaryItem from "../../../Types/Workspace/NotificationSummary/WorkspaceNotificationSummaryItem";
import { describe, expect, test } from "@jest/globals";

/*
 * The block builders these helpers feed need a database; the helpers
 * themselves are pure, so reach them directly. They are private statics on
 * the class (and computeAvg is a private instance method on the singleton),
 * hence the cast — the point of these tests is the behaviour, which is what
 * every summary message rendered into Slack or Teams is built out of.
 */
type ValuesMap = {
  [key in NotificationRuleConditionCheckOn]: string | Array<string> | undefined;
};

type StaticHelpers = {
  formatDuration: (totalMinutes: number) => string;
  bold: (text: string) => string;
  link: (url: string, text: string) => string;
  has: (
    items: Array<WorkspaceNotificationSummaryItem>,
    item: WorkspaceNotificationSummaryItem,
  ) => boolean;
  matchesFilters: (data: {
    filters: Array<NotificationRuleCondition> | undefined;
    filterCondition: FilterCondition | undefined;
    values: ValuesMap;
  }) => boolean;
  buildIncidentValues: (incident: Incident) => ValuesMap;
  buildAlertValues: (alert: Alert) => ValuesMap;
};

const helpers: StaticHelpers =
  WorkspaceNotificationSummaryServiceClass as unknown as StaticHelpers;

interface TimelineDataLike {
  ackAt?: Date | undefined;
  resolvedAt?: Date | undefined;
  declaredAt?: Date | undefined;
}

type ComputeAvgAccess = {
  computeAvg: (
    tlMap: Map<string, TimelineDataLike>,
    kind: "ack" | "resolve",
  ) => { avg: number; count: number };
};

const instance: ComputeAvgAccess =
  WorkspaceNotificationSummaryService as unknown as ComputeAvgAccess;

function labelWithId(id: string): Label {
  const label: Label = new Label();
  label._id = id;
  return label;
}

function monitorWithId(id: string): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = id;
  return monitor;
}

describe("WorkspaceNotificationSummaryService.formatDuration", () => {
  /*
   * Durations come from computeAvg, which rounds to whole minutes, so these
   * are the only inputs the summary ever renders.
   */
  test.each([
    [0, "< 1m"],
    [1, "1m"],
    [7, "7m"],
    [59, "59m"],
    [60, "1h"],
    [61, "1h 1m"],
    [90, "1h 30m"],
    [599, "9h 59m"],
    [1439, "23h 59m"],
    [1440, "1d"],
    [1441, "1d 1m"],
    [1500, "1d 1h"],
    [1501, "1d 1h 1m"],
    [2880, "2d"],
    [10080, "7d"],
  ])("renders %i minutes as %s", (minutes: number, expected: string) => {
    expect(helpers.formatDuration(minutes)).toBe(expected);
  });

  // Anything under a minute collapses rather than rendering a bare "0m".
  test("collapses sub-minute durations", () => {
    expect(helpers.formatDuration(0.4)).toBe("< 1m");
    expect(helpers.formatDuration(0.99)).toBe("< 1m");
  });

  /*
   * A zero component is dropped, so an exact number of days never renders as
   * "1d 0h 0m" — but a duration that is ONLY zero minutes still has to render
   * something, which is why the minutes part is kept when nothing else was.
   */
  test("omits zero components but never renders an empty string", () => {
    expect(helpers.formatDuration(1440)).not.toContain("0h");
    expect(helpers.formatDuration(1440)).not.toContain("0m");
    expect(helpers.formatDuration(2)).toBe("2m");
  });
});

describe("WorkspaceNotificationSummaryService markdown helpers", () => {
  /*
   * WorkspacePayloadMarkdown goes through SlackifyMarkdown, which expects
   * standard markdown: **bold** (not *bold*) and [text](url) (not <url|text>).
   * Getting these wrong renders literal asterisks in the channel.
   */
  test("bold uses double asterisks", () => {
    expect(helpers.bold("Incidents")).toBe("**Incidents**");
  });

  test("link uses markdown link syntax, not Slack's own", () => {
    expect(helpers.link("https://example.com/incident/1", "Disk full")).toBe(
      "[Disk full](https://example.com/incident/1)",
    );
  });
});

describe("WorkspaceNotificationSummaryService.has", () => {
  test("reports an item that was explicitly selected", () => {
    expect(
      helpers.has(
        [
          WorkspaceNotificationSummaryItem.TotalCount,
          WorkspaceNotificationSummaryItem.ListWithLinks,
        ],
        WorkspaceNotificationSummaryItem.ListWithLinks,
      ),
    ).toBe(true);
  });

  test("reports an item that was not selected", () => {
    expect(
      helpers.has(
        [WorkspaceNotificationSummaryItem.TotalCount],
        WorkspaceNotificationSummaryItem.WhoResolved,
      ),
    ).toBe(false);
  });

  // "All" is a wildcard, so every individual item has to read as selected.
  test("treats All as selecting everything", () => {
    for (const item of Object.values(WorkspaceNotificationSummaryItem)) {
      expect(helpers.has([WorkspaceNotificationSummaryItem.All], item)).toBe(
        true,
      );
    }
  });

  test("an empty selection selects nothing", () => {
    expect(helpers.has([], WorkspaceNotificationSummaryItem.TotalCount)).toBe(
      false,
    );
  });
});

describe("WorkspaceNotificationSummaryService.buildIncidentValues", () => {
  function fullIncident(): Incident {
    const incident: Incident = new Incident();
    incident.title = "Checkout latency";
    incident.description = "p99 above SLO";

    const severity: IncidentSeverity = new IncidentSeverity();
    severity._id = "11111111-1111-4111-8111-111111111111";
    incident.incidentSeverity = severity;

    const state: IncidentState = new IncidentState();
    state._id = "22222222-2222-4222-8222-222222222222";
    incident.currentIncidentState = state;

    incident.labels = [
      labelWithId("33333333-3333-4333-8333-333333333333"),
      labelWithId("44444444-4444-4444-8444-444444444444"),
    ];
    incident.monitors = [monitorWithId("55555555-5555-4555-8555-555555555555")];

    return incident;
  }

  test("maps every incident field onto its check-on key", () => {
    const values: ValuesMap = helpers.buildIncidentValues(fullIncident());

    expect(values[NotificationRuleConditionCheckOn.IncidentTitle]).toBe(
      "Checkout latency",
    );
    expect(values[NotificationRuleConditionCheckOn.IncidentDescription]).toBe(
      "p99 above SLO",
    );
    expect(values[NotificationRuleConditionCheckOn.IncidentSeverity]).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(values[NotificationRuleConditionCheckOn.IncidentState]).toBe(
      "22222222-2222-4222-8222-222222222222",
    );
    expect(values[NotificationRuleConditionCheckOn.IncidentLabels]).toEqual([
      "33333333-3333-4333-8333-333333333333",
      "44444444-4444-4444-8444-444444444444",
    ]);
    expect(values[NotificationRuleConditionCheckOn.Monitors]).toEqual([
      "55555555-5555-4555-8555-555555555555",
    ]);
  });

  /*
   * A bare incident must still produce a complete map: filters read these
   * keys unconditionally, and a missing key is not the same as an empty one.
   */
  test("fills absent scalars with empty strings and absent lists with empty arrays", () => {
    const values: ValuesMap = helpers.buildIncidentValues(new Incident());

    expect(values[NotificationRuleConditionCheckOn.IncidentTitle]).toBe("");
    expect(values[NotificationRuleConditionCheckOn.IncidentDescription]).toBe(
      "",
    );
    expect(values[NotificationRuleConditionCheckOn.IncidentSeverity]).toBe("");
    expect(values[NotificationRuleConditionCheckOn.IncidentState]).toBe("");
    expect(values[NotificationRuleConditionCheckOn.IncidentLabels]).toEqual([]);
    expect(values[NotificationRuleConditionCheckOn.Monitors]).toEqual([]);
  });

  // Alert-side keys must stay undefined so an alert filter cannot match an incident.
  test("leaves alert-only keys undefined", () => {
    const values: ValuesMap = helpers.buildIncidentValues(fullIncident());

    expect(values[NotificationRuleConditionCheckOn.AlertTitle]).toBeUndefined();
    expect(
      values[NotificationRuleConditionCheckOn.AlertSeverity],
    ).toBeUndefined();
    expect(
      values[NotificationRuleConditionCheckOn.AlertLabels],
    ).toBeUndefined();
  });

  test("carries a key for every check-on the filter UI can produce", () => {
    const values: ValuesMap = helpers.buildIncidentValues(fullIncident());

    for (const checkOn of Object.values(NotificationRuleConditionCheckOn)) {
      expect(Object.prototype.hasOwnProperty.call(values, checkOn)).toBe(true);
    }
  });
});

describe("WorkspaceNotificationSummaryService.buildAlertValues", () => {
  test("maps every alert field onto its check-on key", () => {
    const alert: Alert = new Alert();
    alert.title = "Queue depth";
    alert.description = "backlog growing";

    const severity: AlertSeverity = new AlertSeverity();
    severity._id = "66666666-6666-4666-8666-666666666666";
    alert.alertSeverity = severity;

    const state: AlertState = new AlertState();
    state._id = "77777777-7777-4777-8777-777777777777";
    alert.currentAlertState = state;

    alert.labels = [labelWithId("88888888-8888-4888-8888-888888888888")];

    const values: ValuesMap = helpers.buildAlertValues(alert);

    expect(values[NotificationRuleConditionCheckOn.AlertTitle]).toBe(
      "Queue depth",
    );
    expect(values[NotificationRuleConditionCheckOn.AlertDescription]).toBe(
      "backlog growing",
    );
    expect(values[NotificationRuleConditionCheckOn.AlertSeverity]).toBe(
      "66666666-6666-4666-8666-666666666666",
    );
    expect(values[NotificationRuleConditionCheckOn.AlertState]).toBe(
      "77777777-7777-4777-8777-777777777777",
    );
    expect(values[NotificationRuleConditionCheckOn.AlertLabels]).toEqual([
      "88888888-8888-4888-8888-888888888888",
    ]);
  });

  test("leaves incident-only keys undefined", () => {
    const values: ValuesMap = helpers.buildAlertValues(new Alert());

    expect(
      values[NotificationRuleConditionCheckOn.IncidentTitle],
    ).toBeUndefined();
    expect(
      values[NotificationRuleConditionCheckOn.IncidentSeverity],
    ).toBeUndefined();
  });
});

describe("WorkspaceNotificationSummaryService.matchesFilters", () => {
  const incidentValues: ValuesMap = helpers.buildIncidentValues(
    (() => {
      const incident: Incident = new Incident();
      incident.title = "Checkout latency";

      const severity: IncidentSeverity = new IncidentSeverity();
      severity._id = "11111111-1111-4111-8111-111111111111";
      incident.incidentSeverity = severity;

      incident.labels = [labelWithId("33333333-3333-4333-8333-333333333333")];
      return incident;
    })(),
  );

  /*
   * An unfiltered summary includes everything. Defaulting the other way would
   * silently send an empty summary for every existing configuration.
   */
  test("includes everything when there are no filters", () => {
    expect(
      helpers.matchesFilters({
        filters: undefined,
        filterCondition: undefined,
        values: incidentValues,
      }),
    ).toBe(true);

    expect(
      helpers.matchesFilters({
        filters: [],
        filterCondition: FilterCondition.All,
        values: incidentValues,
      }),
    ).toBe(true);
  });

  test("matches on a single equality filter", () => {
    expect(
      helpers.matchesFilters({
        filters: [
          {
            checkOn: NotificationRuleConditionCheckOn.IncidentSeverity,
            conditionType: ConditionType.EqualTo,
            value: "11111111-1111-4111-8111-111111111111",
          },
        ],
        filterCondition: FilterCondition.All,
        values: incidentValues,
      }),
    ).toBe(true);
  });

  test("rejects an item a single equality filter does not match", () => {
    expect(
      helpers.matchesFilters({
        filters: [
          {
            checkOn: NotificationRuleConditionCheckOn.IncidentSeverity,
            conditionType: ConditionType.EqualTo,
            value: "99999999-9999-4999-8999-999999999999",
          },
        ],
        filterCondition: FilterCondition.All,
        values: incidentValues,
      }),
    ).toBe(false);
  });

  test("requires every filter under FilterCondition.All", () => {
    const filters: Array<NotificationRuleCondition> = [
      {
        checkOn: NotificationRuleConditionCheckOn.IncidentSeverity,
        conditionType: ConditionType.EqualTo,
        value: "11111111-1111-4111-8111-111111111111",
      },
      {
        checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
        conditionType: ConditionType.EqualTo,
        value: "Something else entirely",
      },
    ];

    expect(
      helpers.matchesFilters({
        filters,
        filterCondition: FilterCondition.All,
        values: incidentValues,
      }),
    ).toBe(false);
  });

  test("requires only one filter under FilterCondition.Any", () => {
    const filters: Array<NotificationRuleCondition> = [
      {
        checkOn: NotificationRuleConditionCheckOn.IncidentSeverity,
        conditionType: ConditionType.EqualTo,
        value: "11111111-1111-4111-8111-111111111111",
      },
      {
        checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
        conditionType: ConditionType.EqualTo,
        value: "Something else entirely",
      },
    ];

    expect(
      helpers.matchesFilters({
        filters,
        filterCondition: FilterCondition.Any,
        values: incidentValues,
      }),
    ).toBe(true);
  });

  /*
   * The summary stores filterCondition as optional; an absent one has to fall
   * back to Any rather than to undefined-driven behaviour.
   */
  test("defaults an absent filterCondition to Any", () => {
    const filters: Array<NotificationRuleCondition> = [
      {
        checkOn: NotificationRuleConditionCheckOn.IncidentSeverity,
        conditionType: ConditionType.EqualTo,
        value: "11111111-1111-4111-8111-111111111111",
      },
      {
        checkOn: NotificationRuleConditionCheckOn.IncidentTitle,
        conditionType: ConditionType.EqualTo,
        value: "Something else entirely",
      },
    ];

    expect(
      helpers.matchesFilters({
        filters,
        filterCondition: undefined,
        values: incidentValues,
      }),
    ).toBe(true);
  });

  test("matches a label filter against the incident's label ids", () => {
    expect(
      helpers.matchesFilters({
        filters: [
          {
            checkOn: NotificationRuleConditionCheckOn.IncidentLabels,
            conditionType: ConditionType.ContainsAny,
            value: ["33333333-3333-4333-8333-333333333333"],
          },
        ],
        filterCondition: FilterCondition.All,
        values: incidentValues,
      }),
    ).toBe(true);
  });
});

describe("WorkspaceNotificationSummaryService.computeAvg", () => {
  const declaredAt: Date = new Date("2026-01-01T00:00:00.000Z");

  function timeline(
    entries: Array<[string, TimelineDataLike]>,
  ): Map<string, TimelineDataLike> {
    return new Map<string, TimelineDataLike>(entries);
  }

  test("averages the minutes between declaration and acknowledgement", () => {
    const result: { avg: number; count: number } = instance.computeAvg(
      timeline([
        ["a", { declaredAt, ackAt: new Date("2026-01-01T00:10:00.000Z") }],
        ["b", { declaredAt, ackAt: new Date("2026-01-01T00:20:00.000Z") }],
      ]),
      "ack",
    );

    expect(result).toEqual({ avg: 15, count: 2 });
  });

  test("averages the minutes between declaration and resolution", () => {
    const result: { avg: number; count: number } = instance.computeAvg(
      timeline([
        ["a", { declaredAt, resolvedAt: new Date("2026-01-01T01:00:00.000Z") }],
        ["b", { declaredAt, resolvedAt: new Date("2026-01-01T03:00:00.000Z") }],
      ]),
      "resolve",
    );

    expect(result).toEqual({ avg: 120, count: 2 });
  });

  /*
   * An incident resolved without ever being acknowledged still has a
   * time-to-acknowledge: resolving it acknowledged it. Ignoring these would
   * bias the average towards the slow-to-acknowledge incidents.
   */
  test("falls back to the resolve time when an item was never acknowledged", () => {
    const result: { avg: number; count: number } = instance.computeAvg(
      timeline([
        ["a", { declaredAt, resolvedAt: new Date("2026-01-01T00:30:00.000Z") }],
      ]),
      "ack",
    );

    expect(result).toEqual({ avg: 30, count: 1 });
  });

  test("prefers an explicit acknowledgement over the resolve time", () => {
    const result: { avg: number; count: number } = instance.computeAvg(
      timeline([
        [
          "a",
          {
            declaredAt,
            ackAt: new Date("2026-01-01T00:05:00.000Z"),
            resolvedAt: new Date("2026-01-01T02:00:00.000Z"),
          },
        ],
      ]),
      "ack",
    );

    expect(result).toEqual({ avg: 5, count: 1 });
  });

  /*
   * Only items that reached the state being measured count. An unresolved
   * incident must not be averaged in as a zero, and must not inflate `count`
   * — the count is what the summary reports the average was taken over.
   */
  test("skips items that never reached the measured state", () => {
    const result: { avg: number; count: number } = instance.computeAvg(
      timeline([
        [
          "resolved",
          { declaredAt, resolvedAt: new Date("2026-01-01T00:40:00.000Z") },
        ],
        ["stillOpen", { declaredAt }],
      ]),
      "resolve",
    );

    expect(result).toEqual({ avg: 40, count: 1 });
  });

  test("skips items with no declaration time", () => {
    const result: { avg: number; count: number } = instance.computeAvg(
      timeline([
        ["noDeclaredAt", { resolvedAt: new Date("2026-01-01T00:40:00.000Z") }],
      ]),
      "resolve",
    );

    expect(result).toEqual({ avg: 0, count: 0 });
  });

  // Zero items must not divide by zero.
  test("returns a zero average for an empty timeline", () => {
    expect(instance.computeAvg(timeline([]), "ack")).toEqual({
      avg: 0,
      count: 0,
    });
    expect(instance.computeAvg(timeline([]), "resolve")).toEqual({
      avg: 0,
      count: 0,
    });
  });

  test("rounds the average to whole minutes", () => {
    const result: { avg: number; count: number } = instance.computeAvg(
      timeline([
        ["a", { declaredAt, ackAt: new Date("2026-01-01T00:10:00.000Z") }],
        ["b", { declaredAt, ackAt: new Date("2026-01-01T00:11:00.000Z") }],
        ["c", { declaredAt, ackAt: new Date("2026-01-01T00:11:00.000Z") }],
      ]),
      "ack",
    );

    expect(Number.isInteger(result.avg)).toBe(true);
    expect(result).toEqual({ avg: 11, count: 3 });
  });
});
