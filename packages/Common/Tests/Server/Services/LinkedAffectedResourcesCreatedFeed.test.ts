import DatabaseConfig from "../../../Server/DatabaseConfig";
import AlertFeedService from "../../../Server/Services/AlertFeedService";
import AlertService from "../../../Server/Services/AlertService";
import IncidentFeedService from "../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../Server/Services/IncidentService";
import ScheduledMaintenanceFeedService from "../../../Server/Services/ScheduledMaintenanceFeedService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import AlertWorkspaceMessages from "../../../Server/Utils/Workspace/WorkspaceMessages/Alert";
import IncidentWorkspaceMessages from "../../../Server/Utils/Workspace/WorkspaceMessages/Incident";
import ScheduledMaintenanceWorkspaceMessages from "../../../Server/Utils/Workspace/WorkspaceMessages/ScheduledMaintenance";
import Alert from "../../../Models/DatabaseModels/Alert";
import Incident from "../../../Models/DatabaseModels/Incident";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import URL from "../../../Types/API/URL";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The "🌎 Resources Affected" section of an alert's, incident's or scheduled
 * maintenance event's feed items named monitors (and SLOs) only, while the
 * dashboard's Affected Resources cards beside it list hosts, clusters,
 * container hosts, databases, services and so on too. An incident attached
 * to a host and a Kubernetes cluster had no section at all. These pin the
 * section to the card: every relation, in the card's order, held to the
 * record's own project, with the monitor bullet unchanged.
 */

const DASHBOARD: string = "https://oneuptime.example/dashboard";
const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-eeee-4aaa-8bbb-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-eeee-4aaa-8bbb-000000000009",
);
const RECORD_ID: ObjectID = new ObjectID(
  "0193c0de-eeee-4aaa-8bbb-000000000002",
);

const MONITOR_ID: string = "0193c0de-eeee-4aaa-8bbb-0000000000a1";
const HOST_ID: string = "0193c0de-eeee-4aaa-8bbb-0000000000b1";
const FOREIGN_HOST_ID: string = "0193c0de-eeee-4aaa-8bbb-0000000000b9";
const CLUSTER_ID: string = "0193c0de-eeee-4aaa-8bbb-0000000000d1";
const DATABASE_ID: string = "0193c0de-eeee-4aaa-8bbb-0000000000d2";
const SERVICE_ID: string = "0193c0de-eeee-4aaa-8bbb-0000000000e1";
const SLO_ID: string = "0193c0de-eeee-4aaa-8bbb-0000000000c1";
const SITE_ID: string = "0193c0de-eeee-4aaa-8bbb-0000000000f1";

const HEADER: string = "🌎 **Resources Affected**:\n";

function link(route: string, id: string): string {
  return `${DASHBOARD}/${PROJECT_ID.toString()}/${route}/${id}`;
}

function related(
  id: string,
  name: string,
  projectId: ObjectID = PROJECT_ID,
): JSONObject {
  return { _id: id, name, projectId: projectId as unknown as JSONObject };
}

/*
 * Answers each per-relation read from `relations`, as the database would:
 * one row for the record, carrying only the relation that was selected.
 */
function answerRelationReads(
  service: { findAllBy: unknown },
  relations: JSONObject,
): jest.SpyInstance {
  return jest
    .spyOn(service as typeof IncidentService, "findAllBy")
    .mockImplementation((async (findAllBy: {
      select: JSONObject;
    }): Promise<Array<JSONObject>> => {
      const row: JSONObject = {
        _id: RECORD_ID.toString(),
        projectId: PROJECT_ID as unknown as JSONObject,
      };

      for (const column of Object.keys(findAllBy.select)) {
        if (column !== "_id" && column !== "projectId") {
          row[column] = relations[column] || null;
        }
      }

      return [row];
    }) as never);
}

// The bullets under the header, or null when there is no section.
function sectionLines(markdown: string, header: string): Array<string> | null {
  const start: number = markdown.indexOf(header);

  if (start === -1) {
    return null;
  }

  const lines: Array<string> = markdown
    .slice(start + header.length)
    .replace(/^\n+/, "")
    .split("\n");
  const end: number = lines.indexOf("");

  return end === -1 ? lines : lines.slice(0, end);
}

function postedMarkdown(spy: jest.SpyInstance): string {
  expect(spy).toHaveBeenCalledTimes(1);

  return (spy.mock.calls[0]![0] as { feedInfoInMarkdown: string })
    .feedInfoInMarkdown;
}

beforeEach(() => {
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
  jest
    .spyOn(
      ScheduledMaintenanceWorkspaceMessages,
      "getScheduledMaintenanceCreateMessageBlocks",
    )
    .mockResolvedValue([] as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("incident created feed item", () => {
  type CreateIncidentFeedAsyncFunction = (incident: Incident) => Promise<void>;

  let feedItem: jest.SpyInstance;

  beforeEach(() => {
    feedItem = jest
      .spyOn(IncidentFeedService, "createIncidentFeedItem")
      .mockResolvedValue(undefined as never);
  });

  async function createFeed(relations: JSONObject): Promise<string> {
    answerRelationReads(IncidentService, relations);

    const incident: Incident = new Incident();
    incident._id = RECORD_ID.toString();
    incident.projectId = PROJECT_ID;
    incident.incidentNumber = 3;
    incident.title = "Checkout is down";

    await (
      IncidentService as unknown as {
        createIncidentFeedAsync: CreateIncidentFeedAsyncFunction;
      }
    ).createIncidentFeedAsync(incident);

    return postedMarkdown(feedItem);
  }

  test("names every resource the Affected Resources card lists, in its order", async () => {
    const markdown: string = await createFeed({
      serviceLevelObjectives: [related(SLO_ID, "Checkout availability")],
      services: [related(SERVICE_ID, "checkout")],
      databaseServers: [related(DATABASE_ID, "orders")],
      kubernetesClusters: [related(CLUSTER_ID, "prod")],
      hosts: [related(HOST_ID, "web")],
      monitors: [related(MONITOR_ID, "checkout-web")],
    });

    expect(sectionLines(markdown, HEADER)).toEqual([
      `- [checkout-web](${link("monitors", MONITOR_ID)})`,
      `- [Host web](${link("host", HOST_ID)})`,
      `- [Kubernetes Cluster prod](${link("kubernetes", CLUSTER_ID)})`,
      `- [Database orders](${link("databases", DATABASE_ID)})`,
      `- [Service checkout](${link("service", SERVICE_ID)})`,
      `- [SLO Checkout availability](${link("slos", SLO_ID)})`,
    ]);
  });

  test("an incident on a host alone - no monitors - still has a section", async () => {
    const markdown: string = await createFeed({
      hosts: [related(HOST_ID, "web")],
    });

    expect(sectionLines(markdown, HEADER)).toEqual([
      `- [Host web](${link("host", HOST_ID)})`,
    ]);
  });

  test("another project's host, linked before the write guard, is not named", async () => {
    const markdown: string = await createFeed({
      hosts: [
        related(
          FOREIGN_HOST_ID,
          "payments-db-of-another-project",
          OTHER_PROJECT_ID,
        ),
        related(HOST_ID, "web"),
      ],
    });

    expect(sectionLines(markdown, HEADER)).toEqual([
      `- [Host web](${link("host", HOST_ID)})`,
    ]);
    expect(markdown).not.toContain("payments-db-of-another-project");
    expect(markdown).not.toContain(FOREIGN_HOST_ID);
  });

  test("a host name an agent reported cannot inject markdown", async () => {
    const markdown: string = await createFeed({
      hosts: [
        related(
          HOST_ID,
          "web](https://evil.example) ![p](https://t.example/p.gif)",
        ),
      ],
    });

    expect(markdown).not.toContain("](https://evil.example)");
    expect(markdown).not.toContain("![p](");
  });

  test("an incident linked to nothing has no section", async () => {
    expect(sectionLines(await createFeed({}), HEADER)).toBeNull();
  });
});

describe("alert created feed item", () => {
  type CreateAlertFeedAsyncFunction = (alertId: ObjectID) => Promise<void>;

  let feedItem: jest.SpyInstance;

  beforeEach(() => {
    feedItem = jest
      .spyOn(AlertFeedService, "createAlertFeedItem")
      .mockResolvedValue(undefined as never);
  });

  async function createFeed(relations: JSONObject): Promise<string> {
    answerRelationReads(AlertService, relations);

    const alert: Alert = new Alert();
    alert._id = RECORD_ID.toString();
    alert.projectId = PROJECT_ID;
    alert.alertNumber = 4;
    alert.title = "Checkout is slow";

    jest.spyOn(AlertService, "findOneById").mockResolvedValue(alert as never);

    await (
      AlertService as unknown as {
        createAlertFeedAsync: CreateAlertFeedAsyncFunction;
      }
    ).createAlertFeedAsync(RECORD_ID);

    return postedMarkdown(feedItem);
  }

  test("names the monitor first, then everything else the card lists", async () => {
    const markdown: string = await createFeed({
      monitor: related(MONITOR_ID, "checkout-web"),
      kubernetesClusters: [related(CLUSTER_ID, "prod")],
      services: [related(SERVICE_ID, "checkout")],
    });

    expect(sectionLines(markdown, HEADER)).toEqual([
      `- [checkout-web](${link("monitors", MONITOR_ID)})`,
      `- [Kubernetes Cluster prod](${link("kubernetes", CLUSTER_ID)})`,
      `- [Service checkout](${link("service", SERVICE_ID)})`,
    ]);
  });

  test("an SLO burn-rate alert on a service names both", async () => {
    const markdown: string = await createFeed({
      monitor: null,
      services: [related(SERVICE_ID, "checkout")],
      serviceLevelObjectives: [related(SLO_ID, "Checkout availability")],
    });

    expect(sectionLines(markdown, HEADER)).toEqual([
      `- [Service checkout](${link("service", SERVICE_ID)})`,
      `- [SLO Checkout availability](${link("slos", SLO_ID)})`,
    ]);
  });

  test("another project's monitor is not named", async () => {
    const markdown: string = await createFeed({
      monitor: related(MONITOR_ID, "someone-elses-monitor", OTHER_PROJECT_ID),
    });

    expect(sectionLines(markdown, HEADER)).toBeNull();
    expect(markdown).not.toContain("someone-elses-monitor");
  });
});

describe("scheduled maintenance feed items", () => {
  let feedItem: jest.SpyInstance;

  beforeEach(() => {
    feedItem = jest
      .spyOn(
        ScheduledMaintenanceFeedService,
        "createScheduledMaintenanceFeedItem",
      )
      .mockResolvedValue(undefined as never);
  });

  test("the created item names monitors and network sites", async () => {
    type CreateFeedFunction = (
      scheduledMaintenance: ScheduledMaintenance,
    ) => Promise<void>;

    answerRelationReads(ScheduledMaintenanceService, {
      networkSites: [related(SITE_ID, "London DC")],
      monitors: [related(MONITOR_ID, "checkout-web")],
    });

    const event: ScheduledMaintenance = new ScheduledMaintenance();
    event._id = RECORD_ID.toString();
    event.projectId = PROJECT_ID;
    event.scheduledMaintenanceNumber = 5;
    event.title = "Database upgrade";

    await (
      ScheduledMaintenanceService as unknown as {
        createScheduledMaintenanceFeedAsync: CreateFeedFunction;
      }
    ).createScheduledMaintenanceFeedAsync(event);

    expect(sectionLines(postedMarkdown(feedItem), HEADER)).toEqual([
      `- [checkout-web](${link("monitors", MONITOR_ID)})`,
      `- [Network Site London DC](${link("network-sites/view", SITE_ID)})`,
    ]);
  });

  describe("the updated item", () => {
    type OnUpdateSuccessFunction = (
      onUpdate: JSONObject,
      updatedItemIds: Array<ObjectID>,
    ) => Promise<JSONObject>;

    const UPDATED_HEADER: string = "**Resources Affected**:\n";

    async function update(data: JSONObject): Promise<void> {
      await (
        ScheduledMaintenanceService as unknown as {
          onUpdateSuccess: OnUpdateSuccessFunction;
        }
      ).onUpdateSuccess(
        {
          updateBy: {
            query: { _id: RECORD_ID.toString() },
            data: data,
            props: { tenantId: PROJECT_ID, userId: undefined },
          },
          carryForward: null,
        },
        [RECORD_ID],
      );
    }

    test("editing the hosts alone lists what the event now affects", async () => {
      const reads: jest.SpyInstance = answerRelationReads(
        ScheduledMaintenanceService,
        {
          monitors: [related(MONITOR_ID, "checkout-web")],
          hosts: [related(HOST_ID, "web")],
        },
      );

      await update({ hosts: [{ _id: HOST_ID }] });

      expect(sectionLines(postedMarkdown(feedItem), UPDATED_HEADER)).toEqual([
        `- [checkout-web](${link("monitors", MONITOR_ID)})`,
        `- [Host web](${link("host", HOST_ID)})`,
      ]);

      // Read back as root, inside the tenant's project.
      for (const call of reads.mock.calls) {
        const args: { query: JSONObject; props: JSONObject } = call[0];

        expect(args.query["projectId"]).toBe(PROJECT_ID);
        expect(args.props).toEqual({ isRoot: true });
      }
    });

    test("another project's monitor put in the payload is not named", async () => {
      answerRelationReads(ScheduledMaintenanceService, {
        monitors: [
          related(MONITOR_ID, "someone-elses-monitor", OTHER_PROJECT_ID),
        ],
      });

      await update({ monitors: [{ _id: MONITOR_ID }] });

      expect(feedItem).not.toHaveBeenCalled();
    });

    test("clearing the lists, as before, writes no section and reads nothing", async () => {
      const reads: jest.SpyInstance = answerRelationReads(
        ScheduledMaintenanceService,
        {},
      );

      await update({ monitors: [], hosts: [] });

      expect(reads).not.toHaveBeenCalled();
      expect(feedItem).not.toHaveBeenCalled();
    });
  });
});
