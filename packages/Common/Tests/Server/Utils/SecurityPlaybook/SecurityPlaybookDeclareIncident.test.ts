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
import CreateScopeException from "../../../../Server/Types/Database/Permissions/CreateScopeException";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
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

/*
 * The case's Declare Incident button declares as OneUptime, for the person
 * who pressed it, so it first asks whether they could create that incident
 * themselves (DatabaseService.checkCallerMayCreate) - their incident create
 * permission with its labels, owners and blocks, and their read of every
 * record the incident is linked to. What that check decides for which
 * caller is pinned in SecurityCaseDeclareIncidentAPI.test.ts; here, that it
 * is asked, about what, and that a refusal declares nothing.
 */
describe("SecurityPlaybookActions.declareIncidentForCase, for a person", () => {
  const DECLARER_ID: ObjectID = new ObjectID(
    "6ba7b817-9dad-41d1-80b4-00c04fd43401",
  );
  const DECLARER: DatabaseCommonInteractionProps = {
    userId: DECLARER_ID,
    tenantId: PROJECT_ID,
  };

  let asked: Array<{ data: Incident; props: DatabaseCommonInteractionProps }>;
  let caseLinked: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    asked = [];
    caseLinked = jest.spyOn(SecurityCaseService, "updateColumnsByIdWithoutHooks");

    jest
      .spyOn(SecurityConnections, "readIncidentLinks")
      .mockResolvedValue([
        record(SecurityConnectionKind.Host, HOST_ID, "web-1"),
      ]);
    jest
      .spyOn(IncidentService, "checkCallerMayCreate")
      .mockImplementation(
        async (args: {
          data: Incident;
          props: DatabaseCommonInteractionProps;
        }) => {
          asked.push(args);
        },
      );
  });

  test("asks whether they could create the incident themselves, on the incident as it will be written, before creating it", async () => {
    await SecurityPlaybookActions.declareIncidentForCase({
      projectId: PROJECT_ID,
      securityCase: securityCase(),
      incidentSeverityId: SEVERITY_ID,
      userId: DECLARER_ID,
      declaredBy: DECLARER,
    });

    expect(asked).toHaveLength(1);
    expect(asked[0]!.props).toBe(DECLARER);

    const checked: Incident = asked[0]!.data;
    const written: Incident = created[0]!;

    // Its own copy: the check changes the record it is handed.
    expect(checked).not.toBe(written);
    expect(checked.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(checked.title).toBe(written.title);
    expect(checked.description).toBe(written.description);
    expect(checked.incidentSeverityId?.toString()).toBe(SEVERITY_ID.toString());
    expect(
      (checked.hosts || []).map((row: { id?: ObjectID | null }) => {
        return row.id?.toString();
      }),
    ).toEqual([HOST_ID]);

    // Who created it is stamped after the check, as on their own create.
    expect(checked.createdByUserId).toBeUndefined();
    expect(written.createdByUserId?.toString()).toBe(DECLARER_ID.toString());
  });

  test("a refusal declares nothing: no incident, no link on the case, no feed", async () => {
    (IncidentService.checkCallerMayCreate as unknown as jest.Mock).mockImplementation(
      async () => {
        throw new CreateScopeException(
          "Your access lets you create Incidents only with one of these labels: payments.",
        );
      },
    );

    await expect(
      SecurityPlaybookActions.declareIncidentForCase({
        projectId: PROJECT_ID,
        securityCase: securityCase(),
        incidentSeverityId: SEVERITY_ID,
        userId: DECLARER_ID,
        declaredBy: DECLARER,
      }),
    ).rejects.toThrow(
      "Your access lets you create Incidents only with one of these labels: payments.",
    );

    expect(created).toHaveLength(0);
    expect(caseLinked).not.toHaveBeenCalled();
    expect(SecurityCaseFeedService.createSecurityCaseFeedItem).not.toHaveBeenCalled();
    expect(incidentFeed).toHaveLength(0);
  });

  test("a playbook step declares as OneUptime: nothing is asked", async () => {
    await SecurityPlaybookActions.declareIncidentForCase({
      projectId: PROJECT_ID,
      securityCase: securityCase(),
      incidentSeverityId: SEVERITY_ID,
      playbookName: "Contain",
    });

    expect(asked).toHaveLength(0);
    expect(created).toHaveLength(1);
    expect(created[0]!.isCreatedAutomatically).toBe(true);
  });
});
