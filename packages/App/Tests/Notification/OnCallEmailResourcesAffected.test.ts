import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Project from "Common/Models/DatabaseModels/Project";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import AlertService from "Common/Server/Services/AlertService";
import IncidentService from "Common/Server/Services/IncidentService";
import UserNotificationRuleService from "Common/Server/Services/UserNotificationRuleService";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import URL from "Common/Types/API/URL";
import Email from "Common/Types/Email";
import EmailMessage from "Common/Types/Email/EmailMessage";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import type { SpyInstance } from "jest-mock";

/*
 * The "Resources Affected" row of the on-call page email.
 *
 * It printed the alert's monitor and nothing else, so an SLO burn-rate alert
 * - which has no monitor, and whose Affected Resources card names the SLO -
 * paged the responder with "Resources Affected: No resources identified".
 * The row now lists everything the card lists, held to the alert's own
 * project, and a grouped monitor's alert still names the pod rather than
 * the monitor, as the alert owner emails do.
 *
 * The builders are real; only the database reads and link lookups are
 * stubbed, and the relation reads are answered the way the database would
 * answer them.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-ffff-4aaa-8bbb-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-ffff-4aaa-8bbb-000000000009",
);
const RECORD_ID: ObjectID = new ObjectID(
  "0193c0de-ffff-4aaa-8bbb-000000000002",
);
const LOG_TIMELINE_ID: ObjectID = new ObjectID(
  "0193c0de-ffff-4aaa-8bbb-000000000003",
);
const RESPONDER: Email = new Email("responder@acme.test");

function related(
  id: string,
  name: string,
  projectId: ObjectID = PROJECT_ID,
): JSONObject {
  return { _id: id, name, projectId: projectId as unknown as JSONObject };
}

type FindAllByArgs = {
  select: JSONObject;
  query: JSONObject;
  props: JSONObject;
};

type FindAllBySpy = SpyInstance<typeof AlertService.findAllBy>;

// One row for the record, carrying only the relation that was selected.
function answerRelationReads(
  service: typeof AlertService | typeof IncidentService,
  relations: JSONObject,
): FindAllBySpy {
  return jest
    .spyOn(service as typeof AlertService, "findAllBy")
    .mockImplementation((async (
      findAllBy: FindAllByArgs,
    ): Promise<Array<JSONObject>> => {
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

function project(): Project {
  const acme: Project = new Project();
  acme.name = "Acme";
  return acme;
}

function alert(seriesLabels?: JSONObject): Alert {
  const model: Alert = new Alert(RECORD_ID);
  model.projectId = PROJECT_ID;
  model.project = project();
  model.title = "Checkout availability is burning its error budget";
  model.alertNumber = 12;

  const state: AlertState = new AlertState();
  state.name = "Firing";
  model.currentAlertState = state;

  const severity: AlertSeverity = new AlertSeverity();
  severity.name = "High";
  model.alertSeverity = severity;

  if (seriesLabels) {
    model.seriesLabels = seriesLabels;
  }

  return model;
}

function incident(): Incident {
  const model: Incident = new Incident(RECORD_ID);
  model.projectId = PROJECT_ID;
  model.project = project();
  model.title = "Checkout is down";
  model.incidentNumber = 7;

  const state: IncidentState = new IncidentState();
  state.name = "Identified";
  model.currentIncidentState = state;

  const severity: IncidentSeverity = new IncidentSeverity();
  severity.name = "Major";
  model.incidentSeverity = severity;

  return model;
}

async function alertResourcesAffected(
  relations: JSONObject,
  seriesLabels?: JSONObject,
): Promise<string> {
  answerRelationReads(AlertService, relations);

  const message: EmailMessage =
    await UserNotificationRuleService.generateEmailTemplateForAlertCreated(
      RESPONDER,
      alert(seriesLabels),
      LOG_TIMELINE_ID,
    );

  return message.vars["resourcesAffected"] as string;
}

beforeEach(() => {
  const link: URL = URL.fromString("https://oneuptime.test/dashboard/r1");

  jest
    .spyOn(DatabaseConfig, "getHost")
    .mockResolvedValue(new Hostname("oneuptime.test"));
  jest
    .spyOn(DatabaseConfig, "getHttpProtocol")
    .mockResolvedValue(Protocol.HTTPS);
  jest.spyOn(AlertService, "getAlertLinkInDashboard").mockResolvedValue(link);
  jest
    .spyOn(IncidentService, "getIncidentLinkInDashboard")
    .mockResolvedValue(link);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the alert on-call email's Resources Affected row", () => {
  test("an SLO burn-rate alert names its SLO, not 'No resources identified'", async () => {
    expect(
      await alertResourcesAffected({
        monitor: null,
        serviceLevelObjectives: [
          related(
            "0193c0de-ffff-4aaa-8bbb-0000000000c1",
            "Checkout availability",
          ),
        ],
      }),
    ).toBe("Checkout availability");
  });

  test("names the monitor, then the hosts, clusters and services it is attached to", async () => {
    expect(
      await alertResourcesAffected({
        monitor: related(
          "0193c0de-ffff-4aaa-8bbb-0000000000a1",
          "checkout-web",
        ),
        hosts: [related("0193c0de-ffff-4aaa-8bbb-0000000000b1", "web-01")],
        kubernetesClusters: [
          related("0193c0de-ffff-4aaa-8bbb-0000000000d1", "prod-eu"),
        ],
        services: [related("0193c0de-ffff-4aaa-8bbb-0000000000e1", "checkout")],
      }),
    ).toBe("checkout-web, web-01, prod-eu, checkout");
  });

  test("a grouped monitor's alert names the pod in the monitor's place", async () => {
    const resourcesAffected: string = await alertResourcesAffected(
      {
        monitor: related(
          "0193c0de-ffff-4aaa-8bbb-0000000000a1",
          "Pod CPU Saturating Container Limit",
        ),
        kubernetesClusters: [
          related("0193c0de-ffff-4aaa-8bbb-0000000000d1", "prod-eu"),
        ],
      },
      {
        "resource.k8s.namespace.name": "shop",
        "resource.k8s.pod.name": "checkout-7d9f-2xk",
      },
    );

    expect(resourcesAffected).toBe(
      "Pod: checkout-7d9f-2xk | Namespace: shop, prod-eu",
    );
    expect(resourcesAffected).not.toContain("Pod CPU Saturating");
  });

  test("another project's resource, linked before the write guard, is not named", async () => {
    const resourcesAffected: string = await alertResourcesAffected({
      hosts: [
        related(
          "0193c0de-ffff-4aaa-8bbb-0000000000b9",
          "db-of-another-project",
          OTHER_PROJECT_ID,
        ),
      ],
    });

    expect(resourcesAffected).toBe("No resources identified");
  });

  test("reads every relation as root, inside the alert's project", async () => {
    const reads: FindAllBySpy = answerRelationReads(AlertService, {});

    await UserNotificationRuleService.generateEmailTemplateForAlertCreated(
      RESPONDER,
      alert(),
      LOG_TIMELINE_ID,
    );

    expect(reads).toHaveBeenCalled();

    for (const call of reads.mock.calls) {
      const args: FindAllByArgs = call[0] as unknown as FindAllByArgs;

      expect(args.props).toEqual({ isRoot: true });
      expect(args.query["projectId"]).toBe(PROJECT_ID);
    }
  });

  test("with nothing linked it still says so", async () => {
    expect(await alertResourcesAffected({ monitor: null })).toBe(
      "No resources identified",
    );
  });
});

describe("the incident on-call email's Resources Affected row", () => {
  test("names monitors and every other resource the incident is linked to", async () => {
    answerRelationReads(IncidentService, {
      monitors: [
        related("0193c0de-ffff-4aaa-8bbb-0000000000a1", "checkout-web"),
      ],
      databaseServers: [
        related("0193c0de-ffff-4aaa-8bbb-0000000000d2", "orders-db"),
      ],
      serviceLevelObjectives: [
        related(
          "0193c0de-ffff-4aaa-8bbb-0000000000c1",
          "Checkout availability",
        ),
      ],
    });

    const message: EmailMessage =
      await UserNotificationRuleService.generateEmailTemplateForIncidentCreated(
        RESPONDER,
        incident(),
        LOG_TIMELINE_ID,
      );

    expect(message.vars["resourcesAffected"]).toBe(
      "checkout-web, orders-db, Checkout availability",
    );
  });
});
