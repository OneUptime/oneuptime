import DatabaseConfig from "../../../Server/DatabaseConfig";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import AlertService from "../../../Server/Services/AlertService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../Server/Services/IncidentService";
import ProductAnalytics from "../../../Server/Utils/ProductAnalytics";
import AlertWorkspaceMessages from "../../../Server/Utils/Workspace/WorkspaceMessages/Alert";
import IncidentWorkspaceMessages from "../../../Server/Utils/Workspace/WorkspaceMessages/Incident";
import Alert from "../../../Models/DatabaseModels/Alert";
import Incident from "../../../Models/DatabaseModels/Incident";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * An incident or alert's "created" feed item lists what it affects under
 * "🌎 Resources Affected". It used to list monitors only, and a burn-rate
 * incident carries no monitors on purpose (resolving one would rewrite
 * monitor status history) - so the item for exactly the incidents an SLO
 * declares named nothing, and the feed had no way back to the SLO. It now
 * lists the SLOs the record is linked to, after its monitors.
 *
 * The same markdown is posted to Slack and Teams, and the feed renders it
 * without safe mode, so a hostile SLO name is checked end to end here too.
 *
 * The feed builders read those relations themselves, one per query, through
 * LinkedAffectedResources; the fixtures below answer each of those reads the
 * way the database would. Every other relation the section now lists is
 * covered in LinkedAffectedResourcesCreatedFeed.test.ts.
 */

const DASHBOARD: string = "https://oneuptime.example/dashboard";
const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-bbbb-4aaa-8bbb-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-bbbb-4aaa-8bbb-000000000009",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "0193c0de-bbbb-4aaa-8bbb-000000000002",
);
const ALERT_ID: ObjectID = new ObjectID("0193c0de-bbbb-4aaa-8bbb-000000000003");
const MONITOR_ID: string = "0193c0de-bbbb-4aaa-8bbb-0000000000a1";
const SLO_ID: string = "0193c0de-bbbb-4aaa-8bbb-0000000000c1";
const OTHER_SLO_ID: string = "0193c0de-bbbb-4aaa-8bbb-0000000000c2";

const RESOURCES_AFFECTED_HEADER: string = "🌎 **Resources Affected**:\n";

type CreateIncidentFeedAsyncFunction = (incident: Incident) => Promise<void>;
type CreateAlertFeedAsyncFunction = (alertId: ObjectID) => Promise<void>;
type OnCreateSuccessFunction = (
  onCreate: JSONObject,
  createdItem: Incident,
) => Promise<Incident>;

/*
 * Answers the feed builder's per-relation reads from `record`: one row
 * carrying only the relation that was selected, as the database would.
 */
function answerRelationReads(
  service: { findAllBy: unknown },
  record: Incident | Alert,
): jest.SpyInstance {
  return jest
    .spyOn(service as typeof IncidentService, "findAllBy")
    .mockImplementation((async (findAllBy: {
      select: JSONObject;
    }): Promise<Array<JSONObject>> => {
      const row: JSONObject = {
        _id: record._id!,
        projectId: record.projectId as unknown as JSONObject,
      };

      for (const column of Object.keys(findAllBy.select)) {
        if (column !== "_id" && column !== "projectId") {
          row[column] = (record as unknown as JSONObject)[column]!;
        }
      }

      return [row];
    }) as never);
}

let incidentRelationReads: jest.SpyInstance | undefined;

// The feed writers are private; they are reached the way the create hooks reach them.
function createIncidentFeed(incident: Incident): Promise<void> {
  incidentRelationReads = answerRelationReads(IncidentService, incident);

  return (
    IncidentService as unknown as {
      createIncidentFeedAsync: CreateIncidentFeedAsyncFunction;
    }
  ).createIncidentFeedAsync(incident);
}

function createAlertFeed(alertId: ObjectID): Promise<void> {
  return (
    AlertService as unknown as {
      createAlertFeedAsync: CreateAlertFeedAsyncFunction;
    }
  ).createAlertFeedAsync(alertId);
}

function sloLink(sloId: string): string {
  return `${DASHBOARD}/${PROJECT_ID.toString()}/slos/${sloId}`;
}

function monitorLink(monitorId: string): string {
  return `${DASHBOARD}/${PROJECT_ID.toString()}/monitors/${monitorId}`;
}

function buildSlo(id: string, name: string): ServiceLevelObjective {
  const slo: ServiceLevelObjective = new ServiceLevelObjective();
  slo._id = id;
  slo.name = name;
  // The record's own project, as the feed's root read now selects it.
  slo.projectId = PROJECT_ID;
  return slo;
}

// An SLO linked before the write guard existed, belonging to another project.
function buildForeignSlo(id: string, name: string): ServiceLevelObjective {
  const slo: ServiceLevelObjective = buildSlo(id, name);
  slo.projectId = OTHER_PROJECT_ID;
  return slo;
}

function buildMonitor(id: string, name: string): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = id;
  monitor.name = name;
  // The relation reads select it; a monitor of no known project is not named.
  monitor.projectId = PROJECT_ID;
  return monitor;
}

function buildIncident(data: {
  monitors?: Array<Monitor> | undefined;
  serviceLevelObjectives?: Array<ServiceLevelObjective> | undefined;
}): Incident {
  const incident: Incident = new Incident();
  incident._id = INCIDENT_ID.toString();
  incident.projectId = PROJECT_ID;
  incident.incidentNumber = 7;
  incident.incidentNumberWithPrefix = "INC-7";
  incident.title = "Checkout availability is burning its error budget";
  incident.description = "Burn rate 14.4x over 1h.";

  if (data.monitors) {
    incident.monitors = data.monitors;
  }

  if (data.serviceLevelObjectives) {
    incident.serviceLevelObjectives = data.serviceLevelObjectives;
  }

  return incident;
}

function buildAlert(data: {
  monitor?: Monitor | undefined;
  serviceLevelObjectives?: Array<ServiceLevelObjective> | undefined;
}): Alert {
  const alert: Alert = new Alert();
  alert._id = ALERT_ID.toString();
  alert.projectId = PROJECT_ID;
  alert.alertNumber = 12;
  alert.alertNumberWithPrefix = "ALT-12";
  alert.title = "Checkout availability is burning its error budget";

  if (data.monitor) {
    alert.monitor = data.monitor;
  }

  if (data.serviceLevelObjectives) {
    alert.serviceLevelObjectives = data.serviceLevelObjectives;
  }

  return alert;
}

/*
 * The bullet lines under the header, or null when the item has no
 * "Resources Affected" section at all.
 */
function resourcesAffectedLines(markdown: string): Array<string> | null {
  const start: number = markdown.indexOf(RESOURCES_AFFECTED_HEADER);

  if (start === -1) {
    return null;
  }

  const rest: string = markdown.slice(start + RESOURCES_AFFECTED_HEADER.length);

  return rest.slice(0, rest.indexOf("\n\n")).split("\n");
}

let incidentFeedItem: jest.SpyInstance;
let alertFeedItem: jest.SpyInstance;

function postedMarkdown(spy: jest.SpyInstance): string {
  expect(spy).toHaveBeenCalledTimes(1);

  return (spy.mock.calls[0]![0] as { feedInfoInMarkdown: string })
    .feedInfoInMarkdown;
}

beforeEach(() => {
  /*
   * A fresh URL per call: URL.addRoute mutates, so a shared instance would
   * hide a builder that forgot to copy it.
   */
  jest
    .spyOn(DatabaseConfig, "getDashboardUrl")
    .mockImplementation(async (): Promise<URL> => {
      return URL.fromString(DASHBOARD);
    });

  jest
    .spyOn(IncidentWorkspaceMessages, "getIncidentCreateMessageBlocks")
    .mockResolvedValue([] as never);
  jest
    .spyOn(AlertWorkspaceMessages, "getAlertCreateMessageBlocks")
    .mockResolvedValue([] as never);

  incidentFeedItem = jest
    .spyOn(IncidentFeedService, "createIncidentFeedItem")
    .mockResolvedValue(undefined as never);
  alertFeedItem = jest
    .spyOn(AlertFeedService, "createAlertFeedItem")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("incident created feed item", () => {
  test("a burn-rate incident with no monitors names its SLO under Resources Affected", async () => {
    await createIncidentFeed(
      buildIncident({
        serviceLevelObjectives: [buildSlo(SLO_ID, "Checkout availability")],
      }),
    );

    expect(resourcesAffectedLines(postedMarkdown(incidentFeedItem))).toEqual([
      `- [SLO Checkout availability](${sloLink(SLO_ID)})`,
    ]);
  });

  test("monitors come first, then SLOs, under a single header", async () => {
    await createIncidentFeed(
      buildIncident({
        monitors: [buildMonitor(MONITOR_ID, "checkout-web")],
        serviceLevelObjectives: [
          buildSlo(SLO_ID, "Checkout availability"),
          buildSlo(OTHER_SLO_ID, "Search latency p95"),
        ],
      }),
    );

    const markdown: string = postedMarkdown(incidentFeedItem);

    expect(markdown.split(RESOURCES_AFFECTED_HEADER)).toHaveLength(2);
    expect(resourcesAffectedLines(markdown)).toEqual([
      `- [checkout-web](${monitorLink(MONITOR_ID)})`,
      `- [SLO Checkout availability](${sloLink(SLO_ID)})`,
      `- [SLO Search latency p95](${sloLink(OTHER_SLO_ID)})`,
    ]);
  });

  test("a monitors-only incident reads exactly as before", async () => {
    await createIncidentFeed(
      buildIncident({ monitors: [buildMonitor(MONITOR_ID, "checkout-web")] }),
    );

    expect(resourcesAffectedLines(postedMarkdown(incidentFeedItem))).toEqual([
      `- [checkout-web](${monitorLink(MONITOR_ID)})`,
    ]);
  });

  test("an incident with neither monitors nor SLOs has no Resources Affected section", async () => {
    await createIncidentFeed(buildIncident({ serviceLevelObjectives: [] }));

    expect(resourcesAffectedLines(postedMarkdown(incidentFeedItem))).toBeNull();
  });

  test("an SLO that cannot be linked does not open an empty section", async () => {
    const unsaved: ServiceLevelObjective = new ServiceLevelObjective();
    unsaved.name = "Unsaved objective";

    await createIncidentFeed(
      buildIncident({ serviceLevelObjectives: [unsaved] }),
    );

    expect(resourcesAffectedLines(postedMarkdown(incidentFeedItem))).toBeNull();
  });

  test("a hostile SLO name is escaped and cannot re-point the link or add an image", async () => {
    await createIncidentFeed(
      buildIncident({
        serviceLevelObjectives: [
          buildSlo(
            SLO_ID,
            "Checkout](https://evil.example) ![pixel](https://tracker.example/p.gif)\n# owned",
          ),
        ],
      }),
    );

    const markdown: string = postedMarkdown(incidentFeedItem);
    const lines: Array<string> | null = resourcesAffectedLines(markdown);

    expect(markdown).not.toContain("](https://evil.example)");
    expect(markdown).not.toContain("![pixel](");
    expect(markdown).not.toContain("\n# owned");
    expect(lines).toEqual([
      `- [SLO Checkout\\]\\(https://evil.example\\) \\!\\[pixel\\]\\(https://tracker.example/p.gif\\) \\# owned](${sloLink(SLO_ID)})`,
    ]);
  });

  test("another project's SLO, linked before the write guard, is not named in this project's feed", async () => {
    await createIncidentFeed(
      buildIncident({
        serviceLevelObjectives: [
          buildForeignSlo(OTHER_SLO_ID, "Payments SLO of another project"),
          buildSlo(SLO_ID, "Checkout availability"),
        ],
      }),
    );

    const markdown: string = postedMarkdown(incidentFeedItem);

    expect(resourcesAffectedLines(markdown)).toEqual([
      `- [SLO Checkout availability](${sloLink(SLO_ID)})`,
    ]);
    expect(markdown).not.toContain("Payments SLO of another project");
    expect(markdown).not.toContain(OTHER_SLO_ID);
  });

  test("an incident linked only to another project's SLO has no Resources Affected section", async () => {
    await createIncidentFeed(
      buildIncident({
        serviceLevelObjectives: [
          buildForeignSlo(OTHER_SLO_ID, "Payments SLO of another project"),
        ],
      }),
    );

    expect(resourcesAffectedLines(postedMarkdown(incidentFeedItem))).toBeNull();
  });

  test("reads the incident's SLOs with their project, as root", async () => {
    await createIncidentFeed(buildIncident({}));

    const sloRead: JSONObject | undefined = incidentRelationReads!.mock.calls
      .map((call: Array<unknown>): JSONObject => {
        return call[0] as JSONObject;
      })
      .find((findAllBy: JSONObject): boolean => {
        return Boolean(
          (findAllBy["select"] as JSONObject)["serviceLevelObjectives"],
        );
      });

    /*
     * projectId too: the read runs as root, and the feed names only SLOs of
     * the record's own project.
     */
    expect(
      (sloRead!["select"] as JSONObject)["serviceLevelObjectives"],
    ).toEqual({ _id: true, name: true, projectId: true });
    expect(sloRead!["props"]).toEqual({ isRoot: true });
    expect((sloRead!["query"] as JSONObject)["projectId"]).toBe(PROJECT_ID);
  });

  test("onCreateSuccess leaves the relations to the feed builder's own reads", async () => {
    jest.spyOn(ProductAnalytics, "captureForUser").mockImplementation((() => {
      // no analytics in tests
    }) as never);

    /*
     * Stop right after the re-read: a missing row throws before any of the
     * hook's side effects run, and the select is what is under test.
     */
    const findOneById: jest.SpyInstance = jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(null as never);

    const createdItem: Incident = buildIncident({});

    await expect(
      (
        IncidentService as unknown as {
          onCreateSuccess: OnCreateSuccessFunction;
        }
      ).onCreateSuccess(
        {
          createBy: { data: createdItem, props: { isRoot: true } },
          carryForward: null,
        } as unknown as JSONObject,
        createdItem,
      ),
    ).rejects.toThrow("Incident not found");

    const select: JSONObject = (
      findOneById.mock.calls[0]![0] as { select: JSONObject }
    ).select;

    /*
     * Joining every many-to-many relation into this one read would return
     * the product of their sizes; LinkedAffectedResources reads them one at
     * a time instead.
     */
    expect(select["monitors"]).toBeUndefined();
    expect(select["serviceLevelObjectives"]).toBeUndefined();
    expect(select["projectId"]).toBe(true);
  });
});

describe("alert created feed item", () => {
  let alertRelationReads: jest.SpyInstance;

  function mockAlertRow(alert: Alert): jest.SpyInstance {
    alertRelationReads = answerRelationReads(AlertService, alert);

    return jest
      .spyOn(AlertService, "findOneById")
      .mockResolvedValue(alert as never);
  }

  test("reads the alert's SLOs alongside its monitor, with their project", async () => {
    mockAlertRow(buildAlert({}));

    await createAlertFeed(ALERT_ID);

    const selects: Array<JSONObject> = alertRelationReads.mock.calls.map(
      (call: Array<unknown>): JSONObject => {
        return (call[0] as { select: JSONObject }).select;
      },
    );

    /*
     * projectId too: the reads run as root, and the feed names only
     * resources of the record's own project.
     */
    expect(selects).toContainEqual({
      _id: true,
      projectId: true,
      serviceLevelObjectives: { _id: true, name: true, projectId: true },
    });
    expect(selects).toContainEqual({
      _id: true,
      projectId: true,
      monitor: { _id: true, name: true, projectId: true },
    });
  });

  test("a burn-rate alert with no monitor names its SLO under Resources Affected", async () => {
    mockAlertRow(
      buildAlert({
        serviceLevelObjectives: [buildSlo(SLO_ID, "Checkout availability")],
      }),
    );

    await createAlertFeed(ALERT_ID);

    expect(resourcesAffectedLines(postedMarkdown(alertFeedItem))).toEqual([
      `- [SLO Checkout availability](${sloLink(SLO_ID)})`,
    ]);
  });

  test("the monitor comes first, then SLOs, under a single header", async () => {
    mockAlertRow(
      buildAlert({
        monitor: buildMonitor(MONITOR_ID, "checkout-web"),
        serviceLevelObjectives: [buildSlo(SLO_ID, "Checkout availability")],
      }),
    );

    await createAlertFeed(ALERT_ID);

    const markdown: string = postedMarkdown(alertFeedItem);

    expect(markdown.split(RESOURCES_AFFECTED_HEADER)).toHaveLength(2);
    expect(resourcesAffectedLines(markdown)).toEqual([
      `- [checkout-web](${monitorLink(MONITOR_ID)})`,
      `- [SLO Checkout availability](${sloLink(SLO_ID)})`,
    ]);
  });

  test("a monitor-only alert reads exactly as before", async () => {
    mockAlertRow(
      buildAlert({ monitor: buildMonitor(MONITOR_ID, "checkout-web") }),
    );

    await createAlertFeed(ALERT_ID);

    expect(resourcesAffectedLines(postedMarkdown(alertFeedItem))).toEqual([
      `- [checkout-web](${monitorLink(MONITOR_ID)})`,
    ]);
  });

  test("an alert with neither monitor nor SLOs has no Resources Affected section", async () => {
    mockAlertRow(buildAlert({}));

    await createAlertFeed(ALERT_ID);

    expect(resourcesAffectedLines(postedMarkdown(alertFeedItem))).toBeNull();
  });

  test("another project's SLO, linked before the write guard, is not named in this project's alert feed", async () => {
    mockAlertRow(
      buildAlert({
        serviceLevelObjectives: [
          buildForeignSlo(OTHER_SLO_ID, "Payments SLO of another project"),
          buildSlo(SLO_ID, "Checkout availability"),
        ],
      }),
    );

    await createAlertFeed(ALERT_ID);

    const markdown: string = postedMarkdown(alertFeedItem);

    expect(resourcesAffectedLines(markdown)).toEqual([
      `- [SLO Checkout availability](${sloLink(SLO_ID)})`,
    ]);
    expect(markdown).not.toContain("Payments SLO of another project");
    expect(markdown).not.toContain(OTHER_SLO_ID);
  });

  test("a hostile SLO name is escaped in the alert feed too", async () => {
    mockAlertRow(
      buildAlert({
        serviceLevelObjectives: [
          buildSlo(SLO_ID, "x](https://evil.example) <img src=x>"),
        ],
      }),
    );

    await createAlertFeed(ALERT_ID);

    const markdown: string = postedMarkdown(alertFeedItem);

    expect(markdown).not.toContain("](https://evil.example)");
    // Escaped as `\<`, which renders as a literal `<` rather than raw HTML.
    expect(markdown).not.toMatch(/(^|[^\\])<img/);
    expect(resourcesAffectedLines(markdown)).toEqual([
      `- [SLO x\\]\\(https://evil.example\\) \\<img src=x\\>](${sloLink(SLO_ID)})`,
    ]);
  });
});
