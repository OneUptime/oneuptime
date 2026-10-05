import Alert from "../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../../Models/DatabaseModels/Label";
import MutableMetric from "../../../Models/AnalyticsModels/MutableMetric";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import AlertService from "../../../Server/Services/AlertService";
import AlertSeverityService from "../../../Server/Services/AlertSeverityService";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import IncidentSlaService from "../../../Server/Services/IncidentSlaService";
import LabelService from "../../../Server/Services/LabelService";
import MutableMetricService from "../../../Server/Services/MutableMetricService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import TelemetryUtil from "../../../Server/Utils/Telemetry/Telemetry";
import URL from "../../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import IncidentMetricType from "../../../Types/Incident/IncidentMetricType";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A severity change does four things on an incident - an "Incident updated"
 * feed entry naming the new severity, a recalculation of the SLA deadlines,
 * a refresh of the reminder schedule and a SeverityChange metric point - and
 * two on an alert: the feed entry and the reminder refresh.
 *
 * They used to follow the relation name alone (incidentSeverity /
 * alertSeverity), which is how the dashboard's forms send it, without looking
 * at the severity the record held. So a severity changed through the ID
 * column - the API, Terraform, workflows, the AI tools - did none of them,
 * while every dashboard save of a card that shows the severity did all of
 * them again, unchanged: a feed line, a new SLA computation, a reminder
 * refresh and one more "severity change" in the metrics.
 *
 * Now the service reads the severity each record holds before the write,
 * once, and the side effects run exactly when the update writes a different
 * one, under either name. These tests run the real onBeforeUpdate and hand
 * what it carries forward to the real onUpdateSuccess; only the database and
 * the side effects' own services are stubbed.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-5e7e-4aaa-8bbb-000000000001",
);
const USER_ID: ObjectID = new ObjectID("0193c0de-5e7e-4aaa-8bbb-000000000002");
const RECORD_ID: string = "0193c0de-5e7e-4aaa-8bbb-0000000000a1";
const SECOND_RECORD_ID: string = "0193c0de-5e7e-4aaa-8bbb-0000000000a2";

const MINOR: string = "0193c0de-5e7e-4aaa-8bbb-0000000000b1";
const CRITICAL: string = "0193c0de-5e7e-4aaa-8bbb-0000000000b2";
const LABEL_ID: string = "0193c0de-5e7e-4aaa-8bbb-0000000000c1";

const SEVERITY_NAMES: Record<string, string> = {
  [MINOR]: "Minor Incident",
  [CRITICAL]: "Critical Incident",
};

type OnBeforeUpdate = (
  updateBy: UpdateBy<never>,
) => Promise<OnUpdate<never>>;
type OnUpdateSuccess = (
  onUpdate: OnUpdate<never>,
  updatedItemIds: Array<ObjectID>,
) => Promise<OnUpdate<never>>;

interface Hooks {
  onBeforeUpdate: OnBeforeUpdate;
  onUpdateSuccess: OnUpdateSuccess;
}

// Someone who may edit incidents and alerts, as the API sees them.
function editor(): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: [Permission.ProjectAdmin].map(
          (permission: Permission): UserPermission => {
            return {
              _type: "UserPermission",
              permission: permission,
              labelIds: [],
              isBlockPermission: false,
            };
          },
        ),
      },
    },
  };
}

function severityLookupId(call: Array<unknown>): string {
  return String(
    (call[0] as { query: { _id: unknown } }).query._id,
  ).toLowerCase();
}

beforeEach(() => {
  // Every severity, label and state named here is the project's own.
  stubProjectDirectory({});

  jest
    .spyOn(CustomFieldMappingService, "applyMappingsToUpdate")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(CustomFieldMappingService, "restampAfterMultiRowUpdate")
    .mockReturnValue(undefined as never);

  jest.spyOn(LabelService, "findBy").mockImplementation((async (): Promise<
    Array<Label>
  > => {
    const label: Label = new Label();
    label._id = LABEL_ID;
    label.name = "checkout";
    return [label];
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("an incident update runs the severity side effects exactly when the severity changes", () => {
  // What each stored incident holds before the write, by id.
  let storedSeverities: Record<string, string | null> = {};

  let incidentReads: MockFunction;
  let severityLookup: MockFunction;
  let recalculate: MockFunction;
  let refreshReminders: MockFunction;
  let feed: MockFunction;
  let metrics: MockFunction;

  beforeEach(() => {
    storedSeverities = { [RECORD_ID]: MINOR };

    incidentReads = getJestMockFunction();
    incidentReads.mockImplementation(
      async (): Promise<Array<Incident>> => {
        return Object.entries(storedSeverities).map(
          ([id, severityId]: [string, string | null]): Incident => {
            const incident: Incident = new Incident();
            incident._id = id;
            incident.projectId = PROJECT_ID;
            if (severityId) {
              incident.incidentSeverityId = new ObjectID(severityId);
            }
            return incident;
          },
        );
      },
    );
    jest
      .spyOn(IncidentService, "findBy")
      .mockImplementation(incidentReads as never);

    jest.spyOn(IncidentService, "findOneById").mockImplementation((async (
      findOneById: { id: ObjectID },
    ): Promise<Incident> => {
      const incident: Incident = new Incident();
      incident._id = findOneById.id.toString();
      incident.projectId = PROJECT_ID;
      incident.incidentNumber = 42;
      incident.incidentNumberWithPrefix = "INC-42";
      return incident;
    }) as never);

    jest
      .spyOn(IncidentService, "getIncidentLinkInDashboard")
      .mockResolvedValue(URL.fromString("https://oneuptime.test/i") as never);

    severityLookup = getJestMockFunction();
    severityLookup.mockImplementation(
      async (findOneBy: {
        query: { _id: unknown };
      }): Promise<IncidentSeverity> => {
        const id: string = String(findOneBy.query._id).toLowerCase();
        const severity: IncidentSeverity = new IncidentSeverity();
        severity._id = id;
        severity.name = SEVERITY_NAMES[id] || "Unknown";
        return severity;
      },
    );
    jest
      .spyOn(IncidentSeverityService, "findOneBy")
      .mockImplementation(severityLookup as never);

    recalculate = getJestMockFunction();
    recalculate.mockResolvedValue(undefined as never);
    jest
      .spyOn(IncidentSlaService, "recalculateDeadlines")
      .mockImplementation(recalculate as never);

    refreshReminders = getJestMockFunction();
    refreshReminders.mockResolvedValue(undefined as never);
    jest
      .spyOn(IncidentService, "refreshReminderSchedule")
      .mockImplementation(refreshReminders as never);

    jest
      .spyOn(IncidentService, "getIncidentMetricContext")
      .mockResolvedValue({ baseMetricAttributes: {} } as never);
    jest
      .spyOn(
        IncidentService as unknown as {
          getMetricRetentionDays: () => Promise<number>;
        },
        "getMetricRetentionDays",
      )
      .mockResolvedValue(30 as never);

    metrics = getJestMockFunction();
    metrics.mockResolvedValue(undefined as never);
    jest
      .spyOn(MutableMetricService, "createMutableMetrics")
      .mockImplementation(metrics as never);
    jest
      .spyOn(TelemetryUtil, "indexMetricNameServiceNameMap")
      .mockResolvedValue(undefined as never);

    feed = getJestMockFunction();
    feed.mockResolvedValue(undefined as never);
    jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockImplementation(feed as never);
  });

  async function runUpdate(
    data: Record<string, unknown>,
    options: {
      query?: Record<string, unknown>;
      updatedIds?: Array<string>;
    } = {},
  ): Promise<OnUpdate<never>> {
    const hooks: Hooks = IncidentService as unknown as Hooks;

    const onUpdate: OnUpdate<never> = await hooks.onBeforeUpdate({
      query: (options.query || { _id: RECORD_ID }) as never,
      data: data as never,
      props: editor(),
      limit: 1,
      skip: 0,
    });

    return await hooks.onUpdateSuccess(
      onUpdate,
      (options.updatedIds || [RECORD_ID]).map((id: string): ObjectID => {
        return new ObjectID(id);
      }),
    );
  }

  function severityChangeMetrics(): Array<MutableMetric> {
    return metrics.mock.calls
      .flatMap((call: Array<unknown>): Array<MutableMetric> => {
        return (call[0] as { metrics: Array<MutableMetric> }).metrics;
      })
      .filter((metric: MutableMetric): boolean => {
        return metric.name === IncidentMetricType.SeverityChange;
      });
  }

  function feedMarkdown(): Array<string> {
    return feed.mock.calls.map((call: Array<unknown>): string => {
      return (call[0] as { feedInfoInMarkdown: string }).feedInfoInMarkdown;
    });
  }

  function expectEverySideEffectOnce(newSeverityId: string): void {
    expect(feed).toHaveBeenCalledTimes(1);
    expect(feedMarkdown()[0]).toContain("Incident Severity");
    expect(feedMarkdown()[0]).toContain(SEVERITY_NAMES[newSeverityId]!);

    expect(recalculate).toHaveBeenCalledTimes(1);
    expect(
      String(
        (recalculate.mock.calls[0]![0] as { incidentId: ObjectID }).incidentId,
      ),
    ).toBe(RECORD_ID);

    expect(refreshReminders).toHaveBeenCalledTimes(1);

    expect(severityChangeMetrics()).toHaveLength(1);
    expect(
      severityChangeMetrics()[0]!.attributes?.["newIncidentSeverityId"],
    ).toBe(newSeverityId);
  }

  function expectNoSeveritySideEffect(): void {
    expect(severityLookup).not.toHaveBeenCalled();
    expect(recalculate).not.toHaveBeenCalled();
    expect(refreshReminders).not.toHaveBeenCalled();
    expect(severityChangeMetrics()).toHaveLength(0);

    for (const markdown of feedMarkdown()) {
      expect(markdown).not.toContain("Incident Severity");
    }
  }

  test.each([
    [
      "the ID column, as the API, Terraform, workflows and AI write it",
      { incidentSeverityId: new ObjectID(CRITICAL) },
    ],
    [
      "the ID column as a bare id string",
      { incidentSeverityId: CRITICAL },
    ],
    [
      "the relation, as the dashboard's forms send it",
      { incidentSeverity: { _id: CRITICAL } },
    ],
    [
      "both names, holding the same id",
      {
        incidentSeverityId: new ObjectID(CRITICAL),
        incidentSeverity: { _id: CRITICAL },
      },
    ],
  ] as Array<[string, Record<string, unknown>]>)(
    "a new severity written under %s runs every side effect once",
    async (_label: string, data: Record<string, unknown>) => {
      await runUpdate(data);

      expectEverySideEffectOnce(CRITICAL);
    },
  );

  test.each([
    ["the ID column", { incidentSeverityId: new ObjectID(MINOR) }],
    ["the ID column as a bare id string", { incidentSeverityId: MINOR }],
    ["the ID column in another case", { incidentSeverityId: MINOR.toUpperCase() }],
    ["the relation", { incidentSeverity: { _id: MINOR } }],
    [
      "both names",
      {
        incidentSeverityId: new ObjectID(MINOR),
        incidentSeverity: { _id: MINOR },
      },
    ],
  ] as Array<[string, Record<string, unknown>]>)(
    "the severity the incident holds, re-sent under %s, runs none of them",
    async (_label: string, data: Record<string, unknown>) => {
      await runUpdate(data);

      expectNoSeveritySideEffect();
      // Nothing else changed, so there is no feed entry at all.
      expect(feed).not.toHaveBeenCalled();
    },
  );

  test("the dashboard's Incident Details card saving a new title with the severity unchanged records the title alone", async () => {
    await runUpdate({
      title: "Checkout errors in EU",
      incidentSeverity: { _id: MINOR },
      labels: [{ _id: LABEL_ID }],
    });

    expect(severityLookup).not.toHaveBeenCalled();
    expect(recalculate).not.toHaveBeenCalled();
    expect(severityChangeMetrics()).toHaveLength(0);

    expect(feed).toHaveBeenCalledTimes(1);
    expect(feedMarkdown()[0]).toContain("Checkout errors in EU");
    expect(feedMarkdown()[0]).not.toContain("Incident Severity");

    // The labels re-match the reminder rule, as they always did: once.
    expect(refreshReminders).toHaveBeenCalledTimes(1);
  });

  test("an update that writes no severity reads none and runs none of them", async () => {
    await runUpdate({ title: "Renamed" });

    expectNoSeveritySideEffect();

    // Nothing read the incidents' severities before the write.
    for (const call of incidentReads.mock.calls) {
      const select: Record<string, unknown> =
        (call[0] as { select?: Record<string, unknown> }).select || {};

      expect(select["incidentSeverityId"]).toBeUndefined();
    }
  });

  test("the stored severity is read once, before the write, with only the columns needed", async () => {
    await runUpdate({ incidentSeverityId: new ObjectID(CRITICAL) });

    const severityReads: Array<Array<unknown>> =
      incidentReads.mock.calls.filter((call: Array<unknown>): boolean => {
        const select: Record<string, unknown> =
          (call[0] as { select?: Record<string, unknown> }).select || {};

        return select["incidentSeverityId"] === true;
      });

    expect(severityReads).toHaveLength(1);
    expect(
      (severityReads[0]![0] as { select: Record<string, unknown> }).select,
    ).toEqual({ _id: true, incidentSeverityId: true });
    // Within the update's own query, and the caller's project.
    expect(
      (severityReads[0]![0] as { query: Record<string, unknown> }).query,
    ).toEqual(expect.objectContaining({ projectId: PROJECT_ID }));
  });

  test("an incident whose severity was not read before the write counts as changed, so a real change is never missed", async () => {
    // The write found a second incident the read before it did not.
    await runUpdate(
      { incidentSeverityId: new ObjectID(MINOR) },
      { updatedIds: [RECORD_ID, SECOND_RECORD_ID] },
    );

    expect(recalculate).toHaveBeenCalledTimes(1);
    expect(
      String(
        (recalculate.mock.calls[0]![0] as { incidentId: ObjectID }).incidentId,
      ),
    ).toBe(SECOND_RECORD_ID);
    expect(severityChangeMetrics()).toHaveLength(1);
  });

  test("one update over two incidents runs them only for the one whose severity it changes", async () => {
    storedSeverities = { [RECORD_ID]: MINOR, [SECOND_RECORD_ID]: CRITICAL };

    await runUpdate(
      { incidentSeverityId: new ObjectID(CRITICAL) },
      {
        query: { projectId: PROJECT_ID },
        updatedIds: [RECORD_ID, SECOND_RECORD_ID],
      },
    );

    expect(recalculate).toHaveBeenCalledTimes(1);
    expect(
      String(
        (recalculate.mock.calls[0]![0] as { incidentId: ObjectID }).incidentId,
      ),
    ).toBe(RECORD_ID);
    expect(refreshReminders).toHaveBeenCalledTimes(1);
    expect(severityChangeMetrics()).toHaveLength(1);
    expect(feed).toHaveBeenCalledTimes(1);
  });

  test("an incident that held no severity gets one: that is a change", async () => {
    storedSeverities = { [RECORD_ID]: null };

    await runUpdate({ incidentSeverityId: new ObjectID(CRITICAL) });

    expectEverySideEffectOnce(CRITICAL);
  });

  test("a combined update - severity, title, labels, reminders switch and the notify flag - does each thing once", async () => {
    await runUpdate({
      title: "Checkout errors in EU",
      incidentSeverityId: new ObjectID(CRITICAL),
      labels: [{ _id: LABEL_ID }],
      enableReminders: true,
      shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
    });

    // One feed entry that names the title, the labels and the new severity.
    expect(feed).toHaveBeenCalledTimes(1);
    expect(feedMarkdown()[0]).toContain("Checkout errors in EU");
    expect(feedMarkdown()[0]).toContain("checkout");
    expect(feedMarkdown()[0]).toContain(SEVERITY_NAMES[CRITICAL]!);

    expect(recalculate).toHaveBeenCalledTimes(1);
    // Severity, labels and the switch all re-match reminders: one refresh.
    expect(refreshReminders).toHaveBeenCalledTimes(1);
    expect(severityChangeMetrics()).toHaveLength(1);
  });

  test("the notify flag beside a severity change queues no 'created' message", async () => {
    const onUpdate: OnUpdate<never> = await runUpdate({
      incidentSeverityId: new ObjectID(CRITICAL),
      shouldStatusPageSubscribersBeNotifiedOnIncidentCreated: true,
    });

    const data: Record<string, unknown> = onUpdate.updateBy
      .data as unknown as Record<string, unknown>;

    expect(data["subscriberNotificationStatusOnIncidentCreated"]).not.toBe(
      StatusPageSubscriberNotificationStatus.Pending,
    );
    expect(data["statusPagesNotifiedOnCreation"]).toBeUndefined();
  });

  test("two names that disagree are refused before anything is read or done", async () => {
    await expect(
      runUpdate({
        incidentSeverityId: new ObjectID(CRITICAL),
        incidentSeverity: { _id: MINOR },
      }),
    ).rejects.toThrow(BadDataException);

    expect(recalculate).not.toHaveBeenCalled();
    expect(feed).not.toHaveBeenCalled();
  });
});

describe("an alert update runs the severity side effects exactly when the severity changes", () => {
  let storedSeverities: Record<string, string | null> = {};

  let alertReads: MockFunction;
  let severityLookup: MockFunction;
  let refreshReminders: MockFunction;
  let feed: MockFunction;

  beforeEach(() => {
    storedSeverities = { [RECORD_ID]: MINOR };

    alertReads = getJestMockFunction();
    alertReads.mockImplementation(async (): Promise<Array<Alert>> => {
      return Object.entries(storedSeverities).map(
        ([id, severityId]: [string, string | null]): Alert => {
          const alert: Alert = new Alert();
          alert._id = id;
          alert.projectId = PROJECT_ID;
          if (severityId) {
            alert.alertSeverityId = new ObjectID(severityId);
          }
          return alert;
        },
      );
    });
    jest.spyOn(AlertService, "findBy").mockImplementation(alertReads as never);

    jest.spyOn(AlertService, "findOneById").mockImplementation((async (
      findOneById: { id: ObjectID },
    ): Promise<Alert> => {
      const alert: Alert = new Alert();
      alert._id = findOneById.id.toString();
      alert.projectId = PROJECT_ID;
      alert.alertNumber = 7;
      alert.alertNumberWithPrefix = "ALT-7";
      return alert;
    }) as never);

    jest
      .spyOn(AlertService, "getAlertLinkInDashboard")
      .mockResolvedValue(URL.fromString("https://oneuptime.test/a") as never);

    severityLookup = getJestMockFunction();
    severityLookup.mockImplementation(
      async (findOneBy: {
        query: { _id: unknown };
      }): Promise<AlertSeverity> => {
        const id: string = String(findOneBy.query._id).toLowerCase();
        const severity: AlertSeverity = new AlertSeverity();
        severity._id = id;
        severity.name = SEVERITY_NAMES[id] || "Unknown";
        return severity;
      },
    );
    jest
      .spyOn(AlertSeverityService, "findOneBy")
      .mockImplementation(severityLookup as never);

    refreshReminders = getJestMockFunction();
    refreshReminders.mockResolvedValue(undefined as never);
    jest
      .spyOn(AlertService, "refreshReminderSchedule")
      .mockImplementation(refreshReminders as never);

    feed = getJestMockFunction();
    feed.mockResolvedValue(undefined as never);
    jest
      .spyOn(AlertFeedService, "createAlertFeedItem")
      .mockImplementation(feed as never);
  });

  async function runUpdate(
    data: Record<string, unknown>,
    options: {
      query?: Record<string, unknown>;
      updatedIds?: Array<string>;
    } = {},
  ): Promise<void> {
    const hooks: Hooks = AlertService as unknown as Hooks;

    const onUpdate: OnUpdate<never> = await hooks.onBeforeUpdate({
      query: (options.query || { _id: RECORD_ID }) as never,
      data: data as never,
      props: editor(),
      limit: 1,
      skip: 0,
    });

    await hooks.onUpdateSuccess(
      onUpdate,
      (options.updatedIds || [RECORD_ID]).map((id: string): ObjectID => {
        return new ObjectID(id);
      }),
    );
  }

  function feedMarkdown(): Array<string> {
    return feed.mock.calls.map((call: Array<unknown>): string => {
      return (call[0] as { feedInfoInMarkdown: string }).feedInfoInMarkdown;
    });
  }

  test.each([
    ["the ID column", { alertSeverityId: new ObjectID(CRITICAL) }],
    ["the relation", { alertSeverity: { _id: CRITICAL } }],
    [
      "both names",
      {
        alertSeverityId: new ObjectID(CRITICAL),
        alertSeverity: { _id: CRITICAL },
      },
    ],
  ] as Array<[string, Record<string, unknown>]>)(
    "a new severity written under %s is recorded in the feed and re-matches reminders, once",
    async (_label: string, data: Record<string, unknown>) => {
      await runUpdate(data);

      expect(feed).toHaveBeenCalledTimes(1);
      expect(feedMarkdown()[0]).toContain("Alert Severity");
      expect(feedMarkdown()[0]).toContain(SEVERITY_NAMES[CRITICAL]!);
      expect(severityLookupId(severityLookup.mock.calls[0]!)).toBe(CRITICAL);
      expect(refreshReminders).toHaveBeenCalledTimes(1);
    },
  );

  test.each([
    ["the ID column", { alertSeverityId: new ObjectID(MINOR) }],
    ["the relation", { alertSeverity: { _id: MINOR } }],
    [
      "both names",
      {
        alertSeverityId: new ObjectID(MINOR),
        alertSeverity: { _id: MINOR },
      },
    ],
  ] as Array<[string, Record<string, unknown>]>)(
    "the severity the alert holds, re-sent under %s, does nothing",
    async (_label: string, data: Record<string, unknown>) => {
      await runUpdate(data);

      expect(feed).not.toHaveBeenCalled();
      expect(severityLookup).not.toHaveBeenCalled();
      expect(refreshReminders).not.toHaveBeenCalled();
    },
  );

  test("a new title with the severity unchanged records the title alone", async () => {
    await runUpdate({ title: "Disk full", alertSeverity: { _id: MINOR } });

    expect(feed).toHaveBeenCalledTimes(1);
    expect(feedMarkdown()[0]).toContain("Disk full");
    expect(feedMarkdown()[0]).not.toContain("Alert Severity");
    expect(refreshReminders).not.toHaveBeenCalled();
  });

  test("a combined update - severity, labels and the reminders switch - refreshes reminders once", async () => {
    await runUpdate({
      alertSeverityId: new ObjectID(CRITICAL),
      labels: [{ _id: LABEL_ID }],
      enableReminders: true,
    });

    expect(feed).toHaveBeenCalledTimes(1);
    expect(feedMarkdown()[0]).toContain(SEVERITY_NAMES[CRITICAL]!);
    expect(refreshReminders).toHaveBeenCalledTimes(1);
  });

  test("one update over two alerts records the change only on the one whose severity it changes", async () => {
    storedSeverities = { [RECORD_ID]: MINOR, [SECOND_RECORD_ID]: CRITICAL };

    await runUpdate(
      { alertSeverityId: new ObjectID(CRITICAL) },
      {
        query: { projectId: PROJECT_ID },
        updatedIds: [RECORD_ID, SECOND_RECORD_ID],
      },
    );

    expect(feed).toHaveBeenCalledTimes(1);
    expect(
      String((feed.mock.calls[0]![0] as { alertId: ObjectID }).alertId),
    ).toBe(RECORD_ID);
    expect(refreshReminders).toHaveBeenCalledTimes(1);
  });

  test("the stored severity is read once, with only the columns needed, and only when a severity is written", async () => {
    await runUpdate({ title: "Renamed" });

    expect(
      alertReads.mock.calls.filter((call: Array<unknown>): boolean => {
        return (
          ((call[0] as { select?: Record<string, unknown> }).select || {})[
            "alertSeverityId"
          ] === true
        );
      }),
    ).toHaveLength(0);

    await runUpdate({ alertSeverityId: new ObjectID(CRITICAL) });

    const severityReads: Array<Array<unknown>> = alertReads.mock.calls.filter(
      (call: Array<unknown>): boolean => {
        return (
          ((call[0] as { select?: Record<string, unknown> }).select || {})[
            "alertSeverityId"
          ] === true
        );
      },
    );

    expect(severityReads).toHaveLength(1);
    expect(
      (severityReads[0]![0] as { select: Record<string, unknown> }).select,
    ).toEqual({ _id: true, alertSeverityId: true });
  });
});
