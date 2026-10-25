import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Incident from "../../../../Models/DatabaseModels/Incident";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import IncidentFeedService from "../../../../Server/Services/IncidentFeedService";
import IncidentService from "../../../../Server/Services/IncidentService";
import SecurityCaseFeedService from "../../../../Server/Services/SecurityCaseFeedService";
import SecurityCaseService from "../../../../Server/Services/SecurityCaseService";
import logger from "../../../../Server/Utils/Logger";
import { SecurityConnectedRecord } from "../../../../Server/Utils/SecurityEvent/Connections/SecurityConnectedRecords";
import SecurityConnections from "../../../../Server/Utils/SecurityEvent/Connections/SecurityConnections";
import SecurityPlaybookActions from "../../../../Server/Utils/SecurityPlaybook/SecurityPlaybookActions";
import URL from "../../../../Types/API/URL";
import ObjectID from "../../../../Types/ObjectID";
import {
  SecurityConnectionCertainty,
  SecurityConnectionKind,
} from "../../../../Types/SecurityCase/SecurityConnection";

/*
 * An incident declared from a security case - by a playbook step or the
 * case's Declare Incident button - is about what the case names: it is
 * linked to the hosts, clusters and services the case is exactly connected
 * to, so it shows on their pages, their owners' rules apply and its
 * investigation reads them; its feed says so. When what the case names
 * cannot be read, the incident is still declared, about nothing in
 * particular.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "6ba7b811-9dad-41d1-80b4-00c04fd43401",
);
const CASE_ID: ObjectID = new ObjectID("6ba7b812-9dad-41d1-80b4-00c04fd43401");
const SEVERITY_ID: ObjectID = new ObjectID(
  "6ba7b813-9dad-41d1-80b4-00c04fd43401",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "6ba7b814-9dad-41d1-80b4-00c04fd43401",
);
const HOST_ID: string = "6ba7b815-9dad-41d1-80b4-00c04fd43401";
const CLUSTER_ID: string = "6ba7b816-9dad-41d1-80b4-00c04fd43401";

function record(
  kind: SecurityConnectionKind,
  id: string,
  name: string,
): SecurityConnectedRecord {
  return {
    kind,
    id,
    name,
    certainty: SecurityConnectionCertainty.Exact,
    matches: [],
  };
}

function securityCase(): SecurityCase {
  const model: SecurityCase = new SecurityCase();
  model._id = CASE_ID.toString();
  model.projectId = PROJECT_ID;
  model.caseNumberWithPrefix = "SEC-12";
  model.title = "Brute force on web-1";
  return model;
}

let created: Array<Incident>;
let incidentFeed: Array<string>;

beforeEach(() => {
  created = [];
  incidentFeed = [];

  jest
    .spyOn(SecurityCaseService, "getCaseLinkInDashboard")
    .mockResolvedValue(URL.fromString("https://oneuptime.example/c/12"));
  jest
    .spyOn(IncidentService, "getIncidentLinkInDashboard")
    .mockResolvedValue(URL.fromString("https://oneuptime.example/i/7"));
  jest
    .spyOn(IncidentService, "create")
    .mockImplementation(async (args: { data: Incident }) => {
      created.push(args.data);
      const incident: Incident = new Incident();
      incident._id = INCIDENT_ID.toString();
      incident.incidentNumberWithPrefix = "INC-7";
      return incident;
    });
  jest
    .spyOn(SecurityCaseService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(SecurityCaseFeedService, "createSecurityCaseFeedItem")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(IncidentFeedService, "createIncidentFeedItem")
    .mockImplementation(async (args: { feedInfoInMarkdown: string }) => {
      incidentFeed.push(args.feedInfoInMarkdown);
      return undefined as never;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SecurityPlaybookActions.declareIncidentForCase", () => {
  test("links the incident to the case's exact connections, and its feed names them", async () => {
    const readLinks: ReturnType<typeof jest.spyOn> = jest
      .spyOn(SecurityConnections, "readIncidentLinks")
      .mockResolvedValue([
        record(SecurityConnectionKind.Host, HOST_ID, "web-1"),
        record(SecurityConnectionKind.KubernetesCluster, CLUSTER_ID, "prod"),
      ]);

    const result: { incident: Incident; incidentNumber: string } =
      await SecurityPlaybookActions.declareIncidentForCase({
        projectId: PROJECT_ID,
        securityCase: securityCase(),
        incidentSeverityId: SEVERITY_ID,
      });

    expect(result.incidentNumber).toBe("INC-7");
    expect(readLinks).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      securityCaseId: CASE_ID,
    });

    const incident: Incident = created[0]!;

    expect(incident.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(
      (incident.hosts || []).map((row: { id?: ObjectID | null }) => {
        return row.id?.toString();
      }),
    ).toEqual([HOST_ID]);
    expect(incident.kubernetesClusters?.[0]?.id?.toString()).toBe(CLUSTER_ID);
    expect(incident.services).toBeUndefined();
    expect(incidentFeed).toEqual([
      "\u{1F6E1}\u{FE0F} Declared from security case [SEC-12](https://oneuptime.example/c/12). Resources affected, as the case names them: Host **web-1**, Kubernetes cluster **prod**.",
    ]);
  });

  test("a case naming nothing OneUptime knows declares an incident linked to nothing", async () => {
    jest.spyOn(SecurityConnections, "readIncidentLinks").mockResolvedValue([]);

    await SecurityPlaybookActions.declareIncidentForCase({
      projectId: PROJECT_ID,
      securityCase: securityCase(),
      incidentSeverityId: SEVERITY_ID,
    });

    expect(created[0]!.hosts).toBeUndefined();
    expect(created[0]!.kubernetesClusters).toBeUndefined();
    expect(incidentFeed).toEqual([
      "\u{1F6E1}\u{FE0F} Declared from security case [SEC-12](https://oneuptime.example/c/12).",
    ]);
  });

  test("when what the case names cannot be read, the incident is declared all the same", async () => {
    jest
      .spyOn(SecurityConnections, "readIncidentLinks")
      .mockRejectedValue(new Error("ClickHouse is not answering"));
    const logged: ReturnType<typeof jest.spyOn> = jest
      .spyOn(logger, "error")
      .mockImplementation(() => {
        return undefined as never;
      });

    const result: { incident: Incident; incidentNumber: string } =
      await SecurityPlaybookActions.declareIncidentForCase({
        projectId: PROJECT_ID,
        securityCase: securityCase(),
        incidentSeverityId: SEVERITY_ID,
      });

    expect(result.incidentNumber).toBe("INC-7");
    expect(created).toHaveLength(1);
    expect(created[0]!.hosts).toBeUndefined();
    expect(String(logged.mock.calls[0]![0])).toContain(
      "the incident is declared without them",
    );
  });
});
