import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { FindOperator } from "typeorm";
import AIInsight from "../../../../Models/DatabaseModels/AIInsight";
import Alert from "../../../../Models/DatabaseModels/Alert";
import ApiKeyPermission from "../../../../Models/DatabaseModels/ApiKeyPermission";
import { DatabaseBaseModelType } from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Host from "../../../../Models/DatabaseModels/Host";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import SecurityCaseFeed from "../../../../Models/DatabaseModels/SecurityCaseFeed";
import Service from "../../../../Models/DatabaseModels/Service";
import TeamPermission from "../../../../Models/DatabaseModels/TeamPermission";
import AIInsightService from "../../../../Server/Services/AIInsightService";
import AlertService from "../../../../Server/Services/AlertService";
import ApiKeyPermissionService from "../../../../Server/Services/ApiKeyPermissionService";
import HostService from "../../../../Server/Services/HostService";
import IncidentService from "../../../../Server/Services/IncidentService";
import SecurityCaseService from "../../../../Server/Services/SecurityCaseService";
import ServiceService from "../../../../Server/Services/ServiceService";
import TeamPermissionService from "../../../../Server/Services/TeamPermissionService";
import DatabaseRequestType from "../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import LinkedAffectedResources, {
  LinkedAffectedResource,
  LinkedAffectedResourceType,
} from "../../../../Server/Utils/AffectedResources/LinkedAffectedResources";
import ReadAudiencePermission from "../../../../Server/Types/Database/Permissions/ReadAudiencePermission";
import TablePermission from "../../../../Server/Types/Database/Permissions/TablePermission";
import DataAlertLineageReader from "../../../../Server/Utils/DataObservability/DataAlertLineage";
import ReadAudienceReader, {
  ReadAudienceSubject,
  ReadNarrowingRow,
} from "../../../../Server/Utils/ReadAudience/ReadAudienceReader";
import PermissionScope from "../../../../Types/Database/AccessControl/PermissionScope";
import ReadAudience from "../../../../Types/BaseDatabase/ReadAudience";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import {
  ProjectKeyRow,
  ProjectMembership,
  ProjectPermissionReads,
  ProjectTeamRow,
  stubProjectPermissionRows,
} from "../../../Helpers/ProjectPermissionRows";
import {
  readAudienceOf,
  readAudienceProps,
} from "../../../Helpers/ReadAudienceFixtures";

/*
 * WHO READS AN INCIDENT'S OR AN ALERT'S REPORT (#9576) - and a fix's, a
 * security case's triage, an AI insight's triage (#9612) - worked out once
 * per run: what narrows somebody's reads in the project - the permissions a
 * team, a custom role on a team or an API key holds scoped to Owned, or
 * limited to or blocked from some labels - what the subject names itself,
 * and the telemetry-owning resources set apart. A project whose roles
 * narrow nobody looks no resource up.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const ALERT_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const MONITOR_ID: string = "44444444-4444-4444-8444-44444444444A";
const HOST_ID: string = "55555555-5555-4555-8555-555555555555";
const SERVICE_ID: string = "66666666-6666-4666-8666-666666666666";
const SET_APART_SERVICE: string = "77777777-7777-4777-8777-777777777777";
const TABLE_ID: string = "88888888-8888-4888-8888-888888888888";

interface PermissionRows {
  ownedTeam: Array<TeamPermission>;
  labelledTeam: Array<TeamPermission>;
  labelledKey: Array<ApiKeyPermission>;
}

let rows: PermissionRows;
let teamQueries: Array<Record<string, unknown>>;

function teamRow(
  permission: Permission,
  isBlock: boolean = false,
): TeamPermission {
  const row: TeamPermission = new TeamPermission();
  row.permission = permission;
  row.isBlockPermission = isBlock;
  return row;
}

function keyRow(permission: Permission): ApiKeyPermission {
  const row: ApiKeyPermission = new ApiKeyPermission();
  row.permission = permission;
  return row;
}

function linked(
  type: LinkedAffectedResourceType,
  id: string,
): LinkedAffectedResource {
  return { type, id, name: "named" };
}

beforeEach(() => {
  rows = { ownedTeam: [], labelledTeam: [], labelledKey: [] };
  teamQueries = [];

  jest
    .spyOn(TeamPermissionService, "findAllBy")
    .mockImplementation((async (findAllBy: {
      query: Record<string, unknown>;
    }): Promise<Array<TeamPermission>> => {
      teamQueries.push(findAllBy.query);

      return findAllBy.query["scope"] === PermissionScope.Owned
        ? rows.ownedTeam
        : rows.labelledTeam;
    }) as never);
  jest
    .spyOn(ApiKeyPermissionService, "findAllBy")
    .mockImplementation((async (): Promise<Array<ApiKeyPermission>> => {
      return rows.labelledKey;
    }) as never);
  jest
    .spyOn(LinkedAffectedResources, "readForIncident")
    .mockResolvedValue([
      linked(LinkedAffectedResourceType.Monitor, MONITOR_ID),
      linked(LinkedAffectedResourceType.Host, HOST_ID),
      linked(LinkedAffectedResourceType.Service, SERVICE_ID),
    ]);
  jest
    .spyOn(LinkedAffectedResources, "readForAlert")
    .mockResolvedValue([
      linked(LinkedAffectedResourceType.Monitor, MONITOR_ID),
    ]);
  jest.spyOn(DataAlertLineageReader, "readNamed").mockResolvedValue({
    dataAssetIds: [TABLE_ID],
    dataPipelineIds: [],
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what narrows somebody's reads in the project", () => {
  test("a project with no scoped permission narrows nobody", async () => {
    expect(
      await ReadAudienceReader.readNarrowingPermissions(PROJECT_ID),
    ).toEqual({ ownedOnlyPermissions: [], labelledPermissions: [] });
  });

  test("a permission held scoped to Owned, each once - a block scoped to Owned narrows nothing by owner", async () => {
    rows.ownedTeam = [
      teamRow(Permission.ReadProjectMonitor),
      teamRow(Permission.ReadProjectMonitor),
      teamRow(Permission.ProjectMember, true),
    ];

    expect(
      (await ReadAudienceReader.readNarrowingPermissions(PROJECT_ID))
        .ownedOnlyPermissions,
    ).toEqual([Permission.ReadProjectMonitor]);
  });

  test("a permission limited to or blocked from labels, a team's or an API key's", async () => {
    rows.labelledTeam = [
      teamRow(Permission.ReadService),
      teamRow(Permission.ProjectMember, true),
    ];
    rows.labelledKey = [keyRow(Permission.ReadService)];

    expect(
      (await ReadAudienceReader.readNarrowingPermissions(PROJECT_ID))
        .labelledPermissions,
    ).toEqual([Permission.ProjectMember, Permission.ReadService].sort());
  });

  test("only the project's own rows are read: those scoped to Owned, and those with a label", async () => {
    await ReadAudienceReader.readNarrowingPermissions(PROJECT_ID);

    expect(teamQueries).toHaveLength(2);

    for (const query of teamQueries) {
      expect(query["projectId"]).toBe(PROJECT_ID);
    }

    const labelled: Record<string, unknown> | undefined = teamQueries.find(
      (query: Record<string, unknown>): boolean => {
        return query["_id"] !== undefined;
      },
    );

    expect(
      (labelled!["_id"] as FindOperator<unknown>).getSql!(
        '"TeamPermission"."_id"',
      ),
    ).toBe(
      '("TeamPermission"."_id" IN (SELECT "TeamPermissionLabel"."teamPermissionId" FROM "TeamPermissionLabel" WHERE "TeamPermissionLabel"."teamPermissionId" IS NOT NULL))',
    );
  });
});

describe("what the subject names itself", () => {
  test("an incident: itself and what its Affected Resources list, by kind, lower case", async () => {
    expect(
      await ReadAudienceReader.readNamed({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
      }),
    ).toEqual({
      Host: [HOST_ID],
      Incident: [INCIDENT_ID.toString()],
      Monitor: [MONITOR_ID.toLowerCase()],
      Service: [SERVICE_ID],
    });
    expect(LinkedAffectedResources.readForIncident).toHaveBeenCalledWith({
      service: IncidentService,
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
    });
  });

  test("an alert: itself, its Affected Resources, and a data alert's table or pipeline", async () => {
    expect(
      await ReadAudienceReader.readNamed({
        projectId: PROJECT_ID,
        alertId: ALERT_ID,
      }),
    ).toEqual({
      Alert: [ALERT_ID.toString()],
      DataAsset: [TABLE_ID],
      Monitor: [MONITOR_ID.toLowerCase()],
    });
    expect(LinkedAffectedResources.readForAlert).toHaveBeenCalledWith({
      service: AlertService,
      projectId: PROJECT_ID,
      alertId: ALERT_ID,
    });
  });
});

describe("the audience of a subject", () => {
  test("a project whose roles narrow nobody: nothing is looked up for its telemetry", async () => {
    const findServices: ReturnType<typeof jest.spyOn> = jest.spyOn(
      ServiceService,
      "findAllBy",
    );

    const audience: ReadAudience = await ReadAudienceReader.forSubject({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
    });

    expect(audience).toEqual(
      readAudienceOf({
        projectId: PROJECT_ID,
        named: {
          Host: [HOST_ID],
          Incident: [INCIDENT_ID.toString()],
          Monitor: [MONITOR_ID.toLowerCase()],
          Service: [SERVICE_ID],
        },
      }),
    );
    expect(findServices).not.toHaveBeenCalled();
  });

  test("services narrowed by labels: the ones set apart are left out of its telemetry, the subject's own never", async () => {
    rows.labelledTeam = [teamRow(Permission.ReadService)];
    const reads: Array<{ query: Record<string, unknown> }> = [];

    jest
      .spyOn(ServiceService, "findAllBy")
      .mockImplementation((async (findAllBy: {
        query: Record<string, unknown>;
      }): Promise<Array<Service>> => {
        reads.push(findAllBy);
        return [new Service(new ObjectID(SET_APART_SERVICE))];
      }) as never);
    const findHosts: ReturnType<typeof jest.spyOn> = jest.spyOn(
      HostService,
      "findAllBy",
    );

    const audience: ReadAudience = await ReadAudienceReader.forSubject({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
    });

    expect(audience.telemetryBlockedIds).toEqual([SET_APART_SERVICE]);
    // Hosts are read whole: nobody reads them only by owner or label.
    expect(findHosts).not.toHaveBeenCalled();

    const sql: string = (reads[0]!.query["_id"] as FindOperator<unknown>)
      .getSql!('"Service"."_id"');

    // Of the project, set apart by a label, and not the incident's own service.
    expect(sql).toContain('"Service"."projectId" IN (:...');
    expect(sql).toContain('NOT IN (SELECT "ServiceLabel"."serviceId"');
    expect(sql).toContain('"Service"."_id" IN (:...');
  });

  test("a decision that reads no telemetry looks none of it up", async () => {
    rows.labelledTeam = [teamRow(Permission.ReadService)];
    const findServices: ReturnType<typeof jest.spyOn> = jest.spyOn(
      ServiceService,
      "findAllBy",
    );

    const audience: ReadAudience = await ReadAudienceReader.forSubject(
      { projectId: PROJECT_ID, alertId: ALERT_ID },
      { withTelemetry: false },
    );

    expect(audience.labelledPermissions).toEqual([Permission.ReadService]);
    expect(audience.telemetryBlockedIds).toEqual([]);
    expect(findServices).not.toHaveBeenCalled();
  });
});

describe("which of some records the audience reads", () => {
  test("a kind it reads whole: every id, and nothing read", async () => {
    const findHosts: ReturnType<typeof jest.spyOn> = jest.spyOn(
      HostService,
      "findBy",
    );

    expect([
      ...(await ReadAudienceReader.readReadableIds({
        service: HostService as never,
        ids: [HOST_ID.toUpperCase()],
        audience: readAudienceOf({ projectId: PROJECT_ID }),
      })),
    ]).toEqual([HOST_ID]);
    expect(findHosts).not.toHaveBeenCalled();
  });

  test("a kind somebody is narrowed on: read for the audience, so only those it reads come back", async () => {
    const audience: ReadAudience = readAudienceOf({
      projectId: PROJECT_ID,
      labelledPermissions: [Permission.ProjectMember],
    });
    const reads: Array<{ props: unknown }> = [];

    jest.spyOn(HostService, "findBy").mockImplementation((async (findBy: {
      props: unknown;
    }): Promise<Array<Host>> => {
      reads.push(findBy);
      return [new Host(new ObjectID(HOST_ID))];
    }) as never);

    const readable: Set<string> = await ReadAudienceReader.readReadableIds({
      service: HostService as never,
      ids: [HOST_ID, SET_APART_SERVICE],
      audience,
    });

    expect([...readable]).toEqual([HOST_ID]);
    expect(reads[0]!.props).toEqual(readAudienceProps(audience));
  });

  test("no ids: nothing read", async () => {
    expect(
      (
        await ReadAudienceReader.readReadableIds({
          service: HostService as never,
          ids: [],
          audience: readAudienceOf({
            projectId: PROJECT_ID,
            labelledPermissions: [Permission.ProjectMember],
          }),
        })
      ).size,
    ).toBe(0);
  });
});

/*
 * A SECURITY CASE'S TRIAGE AND AN AI INSIGHT'S (#9612) are read by everyone
 * who may see the case or the insight, so they are subjects too: a case
 * names itself and the incident it declared - unless that incident is
 * private, which its owners alone read, whoever may see the case - and an
 * insight names itself and the service it is about.
 */
describe("what a security case names itself", () => {
  const CASE_ID: ObjectID = new ObjectID(
    "99999999-9999-4999-8999-999999999999",
  );
  let caseReads: Array<{ query: Record<string, unknown>; props: unknown }>;
  let incidentReads: Array<{ query: Record<string, unknown>; props: unknown }>;

  function readsCase(declaredIncidentId: ObjectID | undefined): void {
    jest
      .spyOn(SecurityCaseService, "findOneBy")
      .mockImplementation((async (findOneBy: {
        query: Record<string, unknown>;
        props: unknown;
      }): Promise<SecurityCase> => {
        caseReads.push(findOneBy);
        const row: SecurityCase = new SecurityCase(CASE_ID);
        if (declaredIncidentId) {
          row.incidentId = declaredIncidentId;
        }
        return row;
      }) as never);
  }

  function readsIncident(isPrivate: boolean): void {
    jest
      .spyOn(IncidentService, "findOneBy")
      .mockImplementation((async (findOneBy: {
        query: Record<string, unknown>;
        props: unknown;
      }): Promise<Incident> => {
        incidentReads.push(findOneBy);
        const row: Incident = new Incident(INCIDENT_ID);
        row.isPrivate = isPrivate;
        return row;
      }) as never);
  }

  beforeEach(() => {
    caseReads = [];
    incidentReads = [];
  });

  test("the case, and the incident it declared: its header and timeline name it to every reader", async () => {
    readsCase(INCIDENT_ID);
    readsIncident(false);

    expect(
      await ReadAudienceReader.readNamed({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
      }),
    ).toEqual({
      Incident: [INCIDENT_ID.toString()],
      SecurityCase: [CASE_ID.toString()],
    });
    // The case's own project only, and nothing linked is read for a case.
    expect(caseReads[0]!.query).toEqual({
      _id: CASE_ID,
      projectId: PROJECT_ID,
    });
    expect(incidentReads[0]!.query).toEqual({
      _id: INCIDENT_ID,
      projectId: PROJECT_ID,
    });
    expect(LinkedAffectedResources.readForIncident).not.toHaveBeenCalled();
  });

  test("a private declared incident is never named: its owners alone read it, whoever may see the case", async () => {
    readsCase(INCIDENT_ID);
    readsIncident(true);

    expect(
      await ReadAudienceReader.readNamed({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
      }),
    ).toEqual({ SecurityCase: [CASE_ID.toString()] });
  });

  test("a case that declared no incident names itself alone, and reads no incident", async () => {
    readsCase(undefined);
    readsIncident(false);

    expect(
      await ReadAudienceReader.readNamed({
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
      }),
    ).toEqual({ SecurityCase: [CASE_ID.toString()] });
    expect(incidentReads).toHaveLength(0);
  });

  test("its readers' audience: narrowed as any subject's, the declared incident kept though some role reads incidents only by label", async () => {
    rows.labelledTeam = [teamRow(Permission.ProjectMember)];
    readsCase(INCIDENT_ID);
    readsIncident(false);

    const audience: ReadAudience = await ReadAudienceReader.forSubject(
      { projectId: PROJECT_ID, securityCaseId: CASE_ID },
      { withTelemetry: false },
    );

    expect(audience.labelledPermissions).toEqual([Permission.ProjectMember]);
    expect(ReadAudiencePermission.isNarrowedByLabels(Incident, audience)).toBe(
      true,
    );
    expect(
      ReadAudiencePermission.isNamed(Incident, INCIDENT_ID, audience),
    ).toBe(true);
  });

  /*
   * A case has no labels of its own, so the label rule weighs it by the
   * records it names - the incident it declared among them - and a case
   * naming a private incident nobody named is left out of a read for an
   * audience. The case a triage is about is named, so it reads itself
   * whatever incident it declared.
   */
  test("the case reads itself for its triage, though the incident it declared is private and not named", async () => {
    rows.labelledTeam = [teamRow(Permission.ProjectMember)];
    readsCase(INCIDENT_ID);
    readsIncident(true);

    const audience: ReadAudience = await ReadAudienceReader.forSubject(
      { projectId: PROJECT_ID, securityCaseId: CASE_ID },
      { withTelemetry: false },
    );
    const kept: FindOperator<unknown> | null =
      ReadAudiencePermission.getKeptCondition(SecurityCase, audience, {
        followReferences: true,
      }) as FindOperator<unknown> | null;

    // A case is weighed by the incident it names...
    expect(kept).not.toBeNull();
    // ...and the case the triage is about is kept by its id, whatever it names.
    expect(kept!.getSql!('"SecurityCase"."_id"')).toContain(
      '"SecurityCase"."_id" IN (:...',
    );
    expect(
      JSON.stringify(Object.values(kept!.objectLiteralParameters || {})),
    ).toContain(CASE_ID.toString());
  });
});

describe("what an AI insight names itself", () => {
  const INSIGHT_ID: ObjectID = new ObjectID(
    "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  );

  function readsInsight(
    serviceId: ObjectID | undefined,
  ): Array<{ query: Record<string, unknown> }> {
    const reads: Array<{ query: Record<string, unknown> }> = [];

    jest
      .spyOn(AIInsightService, "findOneBy")
      .mockImplementation((async (findOneBy: {
        query: Record<string, unknown>;
      }): Promise<AIInsight> => {
        reads.push(findOneBy);
        const row: AIInsight = new AIInsight(INSIGHT_ID);
        if (serviceId) {
          row.telemetryServiceId = serviceId;
        }
        return row;
      }) as never);

    return reads;
  }

  test("the insight and the service it is about: who may read the service reads the insight", async () => {
    const reads: Array<{ query: Record<string, unknown> }> = readsInsight(
      new ObjectID(SERVICE_ID),
    );

    expect(
      await ReadAudienceReader.readNamed({
        projectId: PROJECT_ID,
        aiInsightId: INSIGHT_ID,
      }),
    ).toEqual({
      AIInsight: [INSIGHT_ID.toString()],
      Service: [SERVICE_ID],
    });
    expect(reads[0]!.query).toEqual({
      _id: INSIGHT_ID,
      projectId: PROJECT_ID,
    });
  });

  test("an insight about no service names itself alone: it is read across the project", async () => {
    readsInsight(undefined);

    expect(
      await ReadAudienceReader.readNamed({
        projectId: PROJECT_ID,
        aiInsightId: INSIGHT_ID,
      }),
    ).toEqual({ AIInsight: [INSIGHT_ID.toString()] });
  });

  test("its service's telemetry stays in, though services are narrowed and others are set apart", async () => {
    readsInsight(new ObjectID(SERVICE_ID));
    rows.labelledTeam = [teamRow(Permission.ReadService)];
    const reads: Array<{ query: Record<string, unknown> }> = [];

    jest
      .spyOn(ServiceService, "findAllBy")
      .mockImplementation((async (findAllBy: {
        query: Record<string, unknown>;
      }): Promise<Array<Service>> => {
        reads.push(findAllBy);
        return [new Service(new ObjectID(SET_APART_SERVICE))];
      }) as never);

    const audience: ReadAudience = await ReadAudienceReader.forSubject({
      projectId: PROJECT_ID,
      aiInsightId: INSIGHT_ID,
    });

    expect(audience.telemetryBlockedIds).toEqual([SET_APART_SERVICE]);
    expect(ReadAudiencePermission.isNamed(Service, SERVICE_ID, audience)).toBe(
      true,
    );

    const sql: string = (reads[0]!.query["_id"] as FindOperator<unknown>)
      .getSql!('"Service"."_id"');

    // The insight's own service is the named exception to what is set apart.
    expect(sql).toContain('"Service"."_id" IN (:...');
  });
});

describe("what a run about the subject acts on", () => {
  test("named beside what the subject names itself, lower case and each once", async () => {
    const CLUSTER_ID: string = "BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB";

    expect(
      await ReadAudienceReader.readNamed({
        projectId: PROJECT_ID,
        incidentId: INCIDENT_ID,
        targets: {
          KubernetesCluster: [CLUSTER_ID, CLUSTER_ID.toLowerCase()],
          Host: [new ObjectID(HOST_ID)],
          Runner: [],
        },
      }),
    ).toEqual({
      Host: [HOST_ID],
      Incident: [INCIDENT_ID.toString()],
      KubernetesCluster: [CLUSTER_ID.toLowerCase()],
      Monitor: [MONITOR_ID.toLowerCase()],
      Service: [SERVICE_ID],
    });
  });

  test("a target is named before the telemetry set apart is looked up, so its telemetry stays in", async () => {
    rows.labelledTeam = [teamRow(Permission.ReadService)];
    const reads: Array<{ query: Record<string, unknown> }> = [];

    jest
      .spyOn(ServiceService, "findAllBy")
      .mockImplementation((async (findAllBy: {
        query: Record<string, unknown>;
      }): Promise<Array<Service>> => {
        reads.push(findAllBy);
        return [];
      }) as never);

    const audience: ReadAudience = await ReadAudienceReader.forSubject({
      projectId: PROJECT_ID,
      incidentId: INCIDENT_ID,
      targets: { Service: [SET_APART_SERVICE] },
    });

    expect(
      ReadAudiencePermission.isNamed(Service, SET_APART_SERVICE, audience),
    ).toBe(true);
    // The look-up of what is set apart keeps the named ones out of it.
    expect(reads).toHaveLength(1);
    expect(
      (reads[0]!.query["_id"] as FindOperator<unknown>).getSql!(
        '"Service"."_id"',
      ),
    ).toContain('"Service"."_id" IN (:...');
  });
});

/*
 * A SECURITY CASE'S TRIAGE IS POSTED ON THE CASE AND ITS TIMELINE ALONE
 * (#9632), so only the narrowing that reaches somebody who may read the case
 * counts for it: a row of a team none of whose members may read cases, or of
 * an API key that may not, narrows none of its readers. A row counts when the
 * key, the team itself, or a member of the team through any team of theirs
 * holds a permission that reads the case, its timeline or the audit log -
 * whatever that permission's scope or labels, an invitation not yet accepted
 * included. Every other subject counts every row, as before.
 *
 * The project's rows are answered by their own queries (ProjectPermissionRows).
 * The issue's project: Owners and a Security team that reads cases, and a
 * Developers team that holds Project Member scoped to Owned, none of whose
 * members may read cases.
 */
describe("a run posted only where its subject is read counts only the narrowing that reaches its readers (#9632)", () => {
  const CASE_ID: ObjectID = new ObjectID(
    "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  );
  const INSIGHT_ID: ObjectID = new ObjectID(
    "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  );
  const OWNERS: string = "a0000000-0000-4000-8000-000000000001";
  const SECURITY: string = "a0000000-0000-4000-8000-000000000002";
  const DEVELOPERS: string = "a0000000-0000-4000-8000-000000000003";
  const OWNER: string = "b0000000-0000-4000-8000-000000000001";
  const ANALYST: string = "b0000000-0000-4000-8000-000000000002";
  const DEVELOPER: string = "b0000000-0000-4000-8000-000000000003";
  const OTHER_DEVELOPER: string = "b0000000-0000-4000-8000-000000000004";
  const SIEM_KEY: string = "c0000000-0000-4000-8000-000000000001";
  const DEPLOY_KEY: string = "c0000000-0000-4000-8000-000000000002";
  const LABEL: string = "e0000000-0000-4000-8000-000000000001";

  const OWNERS_ROWS: Array<ProjectTeamRow> = [
    { teamId: OWNERS, permission: Permission.ProjectOwner },
    { teamId: SECURITY, permission: Permission.SecurityViewer },
  ];
  const DEVELOPERS_OWNED: ProjectTeamRow = {
    teamId: DEVELOPERS,
    permission: Permission.ProjectMember,
    scope: PermissionScope.Owned,
  };
  const MEMBERS: Array<ProjectMembership> = [
    { teamId: OWNERS, userId: OWNER },
    { teamId: SECURITY, userId: ANALYST },
    { teamId: DEVELOPERS, userId: DEVELOPER },
    { teamId: DEVELOPERS, userId: OTHER_DEVELOPER },
  ];

  // The issue's project, with what a test adds to it.
  function theProject(extra?: {
    teamRows?: Array<ProjectTeamRow> | undefined;
    keyRows?: Array<ProjectKeyRow> | undefined;
    // In place of the project's own memberships, when given.
    members?: Array<ProjectMembership> | undefined;
    // The Developers' own rows, in place of Project Member scoped to Owned.
    developersRows?: Array<ProjectTeamRow> | undefined;
  }): ProjectPermissionReads {
    return stubProjectPermissionRows({
      projectId: PROJECT_ID,
      teamRows: [
        ...OWNERS_ROWS,
        ...(extra?.developersRows || [DEVELOPERS_OWNED]),
        ...(extra?.teamRows || []),
      ],
      keyRows: extra?.keyRows || [],
      members: [...MEMBERS, ...(extra?.members || [])],
    });
  }

  async function caseTriageReaders(): Promise<ReadAudience> {
    return await ReadAudienceReader.forSubject(
      { projectId: PROJECT_ID, securityCaseId: CASE_ID },
      { postsOnlyWhereTheSubjectIsRead: true },
    );
  }

  beforeEach(() => {
    // A case that declared no incident, and an insight about no service.
    jest
      .spyOn(SecurityCaseService, "findOneBy")
      .mockResolvedValue(new SecurityCase(CASE_ID) as never);
    jest
      .spyOn(AIInsightService, "findOneBy")
      .mockResolvedValue(new AIInsight(INSIGHT_ID) as never);
    jest
      .spyOn(ReadAudienceReader, "readTelemetryBlockedIds")
      .mockResolvedValue([] as never);
  });

  describe("who reads where a case's triage is posted", () => {
    test("whoever may read the case or its timeline - each list read with its product's levels - and nobody else: the audit log shows the case's values to them alone (#10642)", () => {
      const readers: Array<string> | null =
        ReadAudienceReader.getSubjectReadingPermissions({
          projectId: PROJECT_ID,
          securityCaseId: CASE_ID,
        });
      const expected: Set<string> = new Set<string>();

      for (const modelType of [SecurityCase, SecurityCaseFeed]) {
        for (const permission of TablePermission.getTablePermission(
          modelType as DatabaseBaseModelType,
          DatabaseRequestType.Read,
        )) {
          expected.add(String(permission));
        }
      }

      expect(readers).toEqual(Array.from(expected).sort());
      expect(readers).toEqual(
        expect.arrayContaining([
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.SecurityAdmin,
          Permission.SecurityMember,
          Permission.SecurityViewer,
          Permission.ReadSecurityCase,
          Permission.ReadSecurityCaseFeed,
        ]),
      );
      // The project-wide roles a narrowed team holds read no case.
      expect(readers).not.toContain(Permission.ProjectMember);
      expect(readers).not.toContain(Permission.Viewer);
      /*
       * Nor do the audit log's own readers: it shows them that the case
       * changed, never the report (AuditLogReadAccess).
       */
      expect(readers).not.toContain(Permission.SettingsAdmin);
      expect(readers).not.toContain(Permission.ReadAuditLog);
    });

    test("only a case's readers are known: an incident's, an alert's and an insight's, and a case's with an incident beside it, are not", () => {
      const subjects: Array<ReadAudienceSubject> = [
        { projectId: PROJECT_ID, incidentId: INCIDENT_ID },
        { projectId: PROJECT_ID, alertId: ALERT_ID },
        { projectId: PROJECT_ID, aiInsightId: INSIGHT_ID },
        {
          projectId: PROJECT_ID,
          securityCaseId: CASE_ID,
          incidentId: INCIDENT_ID,
        },
      ];

      for (const subject of subjects) {
        expect(ReadAudienceReader.getSubjectReadingPermissions(subject)).toBe(
          null,
        );
      }
    });

    test("an investigation's and an insight triage's readers include the role the issue's team is narrowed on: Project Member reads incidents, alerts and insights, and Viewer incidents and alerts", () => {
      for (const modelType of [Incident, Alert, AIInsight]) {
        expect(
          TablePermission.getTablePermission(
            modelType as DatabaseBaseModelType,
            DatabaseRequestType.Read,
          ),
        ).toContain(Permission.ProjectMember);
      }

      for (const modelType of [Incident, Alert]) {
        expect(
          TablePermission.getTablePermission(
            modelType as DatabaseBaseModelType,
            DatabaseRequestType.Read,
          ),
        ).toContain(Permission.Viewer);
      }
    });
  });

  describe("the issue's case", () => {
    test("a Developers team with Project Member scoped to Owned, none of whose members may read security cases, narrows nothing for a case's triage", async () => {
      theProject();

      const audience: ReadAudience = await caseTriageReaders();

      expect(audience.ownedOnlyPermissions).toEqual([]);
      expect(audience.labelledPermissions).toEqual([]);
      expect(ReadAudiencePermission.narrowsNobody(audience)).toBe(true);

      // Hosts, services and monitors are read whole: none is left out.
      for (const modelType of [Host, Service, Monitor]) {
        expect(
          ReadAudiencePermission.isNarrowedByOwners(modelType, audience),
        ).toBe(false);
        expect(
          ReadAudiencePermission.getConditions(modelType, audience),
        ).toEqual([]);
      }
    });

    test("the same project still narrows an incident's and an alert's investigation, an insight's triage, and a case's run that does not say it posts only on the case", async () => {
      theProject();

      const audiences: Array<ReadAudience> = [
        await ReadAudienceReader.forSubject({
          projectId: PROJECT_ID,
          incidentId: INCIDENT_ID,
        }),
        await ReadAudienceReader.forSubject({
          projectId: PROJECT_ID,
          alertId: ALERT_ID,
        }),
        await ReadAudienceReader.forSubject({
          projectId: PROJECT_ID,
          aiInsightId: INSIGHT_ID,
        }),
        await ReadAudienceReader.forSubject({
          projectId: PROJECT_ID,
          securityCaseId: CASE_ID,
        }),
      ];

      for (const audience of audiences) {
        expect(audience.ownedOnlyPermissions).toEqual([
          Permission.ProjectMember,
        ]);
        expect(ReadAudiencePermission.isNarrowedByOwners(Host, audience)).toBe(
          true,
        );
      }
    });

    test("a subject whose readers are not known counts every row even when its run says it posts only on it: a team that reads no incident still narrows an investigation, whose channels it may sit in", async () => {
      const CONTRACTORS: string = "a0000000-0000-4000-8000-000000000009";
      const CONTRACTOR: string = "b0000000-0000-4000-8000-000000000009";
      const reads: ProjectPermissionReads = theProject({
        developersRows: [],
        teamRows: [
          {
            teamId: CONTRACTORS,
            permission: Permission.ReadHost,
            scope: PermissionScope.Owned,
          },
        ],
        members: [{ teamId: CONTRACTORS, userId: CONTRACTOR }],
      });

      const subjects: Array<ReadAudienceSubject> = [
        { projectId: PROJECT_ID, incidentId: INCIDENT_ID },
        { projectId: PROJECT_ID, alertId: ALERT_ID },
        { projectId: PROJECT_ID, aiInsightId: INSIGHT_ID },
      ];

      for (const subject of subjects) {
        const audience: ReadAudience = await ReadAudienceReader.forSubject(
          subject,
          { postsOnlyWhereTheSubjectIsRead: true },
        );

        expect(audience.ownedOnlyPermissions).toEqual([Permission.ReadHost]);
      }

      // Nobody was looked up for them.
      expect(reads.teamMember).toEqual([]);
    });
  });

  describe("a team's narrowing counts when somebody it reaches may read the case", () => {
    test("a member who may read cases through another team keeps the team narrowing: every kind Project Member reads by owner is narrowed again", async () => {
      theProject({ members: [{ teamId: SECURITY, userId: DEVELOPER }] });

      const audience: ReadAudience = await caseTriageReaders();

      expect(audience.ownedOnlyPermissions).toEqual([Permission.ProjectMember]);

      for (const modelType of [Host, Service, Monitor]) {
        expect(
          ReadAudiencePermission.isNarrowedByOwners(modelType, audience),
        ).toBe(true);
      }
    });

    test("an invitation to a team that reads cases, not yet accepted, counts: the member reads the triage the moment they accept", async () => {
      const reads: ProjectPermissionReads = theProject({
        members: [
          {
            teamId: SECURITY,
            userId: DEVELOPER,
            hasAcceptedInvitation: false,
          },
        ],
      });

      expect((await caseTriageReaders()).ownedOnlyPermissions).toEqual([
        Permission.ProjectMember,
      ]);
      // Nobody is looked up by whether they accepted.
      expect(
        reads.teamMember.filter((query: Record<string, unknown>): boolean => {
          return query["hasAcceptedInvitation"] !== undefined;
        }),
      ).toEqual([]);
    });

    test("an invitation to the narrowed team, not yet accepted, counts as well: they are narrowed once they accept", async () => {
      theProject({
        members: [
          {
            teamId: DEVELOPERS,
            userId: ANALYST,
            hasAcceptedInvitation: false,
          },
        ],
      });

      expect((await caseTriageReaders()).ownedOnlyPermissions).toEqual([
        Permission.ProjectMember,
      ]);
    });

    test("a narrowed team that itself reads cases keeps narrowing, members or not: whoever joins it reads the triage", async () => {
      const EMPTY_TEAM: string = "a0000000-0000-4000-8000-000000000008";

      theProject({
        teamRows: [
          {
            teamId: EMPTY_TEAM,
            permission: Permission.ReadHost,
            scope: PermissionScope.Owned,
          },
          { teamId: EMPTY_TEAM, permission: Permission.ReadSecurityCase },
        ],
      });

      // The Developers still narrow nothing; the team that reads cases does.
      expect((await caseTriageReaders()).ownedOnlyPermissions).toEqual([
        Permission.ReadHost,
      ]);
    });

    test("a narrowed team with no members that reads no case narrows nobody", async () => {
      theProject({
        teamRows: [
          {
            teamId: "a0000000-0000-4000-8000-000000000007",
            permission: Permission.ReadHost,
            scope: PermissionScope.Owned,
          },
        ],
      });

      expect((await caseTriageReaders()).ownedOnlyPermissions).toEqual([]);
    });

    test("a case permission limited to some labels still reads some cases: the team's narrowing counts, and so does that permission's", async () => {
      theProject({
        teamRows: [
          {
            teamId: DEVELOPERS,
            permission: Permission.ReadSecurityCase,
            labelIds: [LABEL],
          },
        ],
      });

      const audience: ReadAudience = await caseTriageReaders();

      expect(audience.ownedOnlyPermissions).toEqual([Permission.ProjectMember]);
      expect(audience.labelledPermissions).toEqual([
        Permission.ReadSecurityCase,
      ]);
    });

    test("a case permission held scoped to Owned still reads the cases they own: the team's narrowing counts", async () => {
      theProject({
        teamRows: [
          {
            teamId: DEVELOPERS,
            permission: Permission.SecurityViewer,
            scope: PermissionScope.Owned,
          },
        ],
      });

      expect((await caseTriageReaders()).ownedOnlyPermissions).toEqual([
        Permission.ProjectMember,
        Permission.SecurityViewer,
      ]);
    });

    test("a block grants nothing: a team whose only case permission is a block reads no case through it, and narrows nothing", async () => {
      theProject({
        teamRows: [
          {
            teamId: DEVELOPERS,
            permission: Permission.SecurityViewer,
            isBlock: true,
          },
        ],
      });

      expect((await caseTriageReaders()).ownedOnlyPermissions).toEqual([]);
    });

    test("a team that reads the case's timeline reads the triage there: its narrowing counts", async () => {
      theProject({
        teamRows: [
          { teamId: DEVELOPERS, permission: Permission.ReadSecurityCaseFeed },
        ],
      });

      expect((await caseTriageReaders()).ownedOnlyPermissions).toEqual([
        Permission.ProjectMember,
      ]);
    });

    test.each([Permission.ReadAuditLog, Permission.SettingsAdmin])(
      "a team that reads only the audit log (%s) reads that the case changed, never the triage (#10642): its narrowing does not count",
      async (permission: Permission) => {
        theProject({ teamRows: [{ teamId: DEVELOPERS, permission }] });

        expect((await caseTriageReaders()).ownedOnlyPermissions).toEqual([]);
      },
    );
  });

  describe("rows limited to labels and blocked from labels", () => {
    test.each([
      { isBlock: false, what: "limited to" },
      { isBlock: true, what: "blocked from" },
    ])(
      "a team $what some labels narrows nothing while none of its members may read cases, and narrows again once one may",
      async (row: { isBlock: boolean; what: string }) => {
        const developersRows: Array<ProjectTeamRow> = [
          {
            teamId: DEVELOPERS,
            permission: Permission.ProjectMember,
            labelIds: [LABEL],
            isBlock: row.isBlock,
          },
        ];

        theProject({ developersRows });
        const before: ReadAudience = await caseTriageReaders();

        expect(before.labelledPermissions).toEqual([]);
        expect(ReadAudiencePermission.isNarrowedByLabels(Host, before)).toBe(
          false,
        );

        theProject({
          developersRows,
          members: [{ teamId: SECURITY, userId: OTHER_DEVELOPER }],
        });
        const after: ReadAudience = await caseTriageReaders();

        expect(after.labelledPermissions).toEqual([Permission.ProjectMember]);
        expect(ReadAudiencePermission.isNarrowedByLabels(Host, after)).toBe(
          true,
        );
      },
    );

    test("a block scoped to Owned narrows nobody by owners, whoever reads cases", async () => {
      theProject({
        developersRows: [{ ...DEVELOPERS_OWNED, isBlock: true }],
        members: [{ teamId: SECURITY, userId: DEVELOPER }],
      });

      expect((await caseTriageReaders()).ownedOnlyPermissions).toEqual([]);
    });
  });

  describe("an API key's narrowing counts when the key may read the case", () => {
    test("a key that may read cases keeps its labels narrowing; a key that may not narrows nothing", async () => {
      theProject({
        developersRows: [],
        keyRows: [
          { apiKeyId: SIEM_KEY, permission: Permission.ReadSecurityCase },
          {
            apiKeyId: SIEM_KEY,
            permission: Permission.ReadHost,
            labelIds: [LABEL],
          },
          {
            apiKeyId: DEPLOY_KEY,
            permission: Permission.ReadService,
            labelIds: [LABEL],
          },
        ],
      });

      const audience: ReadAudience = await caseTriageReaders();

      expect(audience.labelledPermissions).toEqual([Permission.ReadHost]);
      expect(ReadAudiencePermission.isNarrowedByLabels(Host, audience)).toBe(
        true,
      );
      expect(ReadAudiencePermission.isNarrowedByLabels(Service, audience)).toBe(
        false,
      );
    });

    test("a key blocked from cases reads none: its narrowing does not count", async () => {
      theProject({
        developersRows: [],
        keyRows: [
          {
            apiKeyId: DEPLOY_KEY,
            permission: Permission.ReadSecurityCase,
            isBlock: true,
          },
          {
            apiKeyId: DEPLOY_KEY,
            permission: Permission.ReadService,
            labelIds: [LABEL],
          },
        ],
      });

      expect((await caseTriageReaders()).labelledPermissions).toEqual([]);
    });

    test("a key that reads only the audit log is shown no value of the triage's change there (#10642): its narrowing does not count", async () => {
      theProject({
        developersRows: [],
        keyRows: [
          { apiKeyId: DEPLOY_KEY, permission: Permission.ReadAuditLog },
          {
            apiKeyId: DEPLOY_KEY,
            permission: Permission.ReadService,
            labelIds: [LABEL],
          },
        ],
      });

      expect((await caseTriageReaders()).labelledPermissions).toEqual([]);
    });

    test("a key that reads the case and the audit log reads the triage: its narrowing counts", async () => {
      theProject({
        developersRows: [],
        keyRows: [
          { apiKeyId: DEPLOY_KEY, permission: Permission.ReadAuditLog },
          { apiKeyId: DEPLOY_KEY, permission: Permission.ReadSecurityCase },
          {
            apiKeyId: DEPLOY_KEY,
            permission: Permission.ReadService,
            labelIds: [LABEL],
          },
        ],
      });

      expect((await caseTriageReaders()).labelledPermissions).toEqual([
        Permission.ReadService,
      ]);
    });

    test("a key's own rows decide, never a team's: nobody on a team is looked up for it", async () => {
      const reads: ProjectPermissionReads = theProject({
        developersRows: [],
        keyRows: [
          {
            apiKeyId: DEPLOY_KEY,
            permission: Permission.ReadService,
            labelIds: [LABEL],
          },
        ],
      });

      expect((await caseTriageReaders()).labelledPermissions).toEqual([]);
      expect(reads.teamMember).toEqual([]);
    });
  });

  describe("the product-level roles (#10475)", () => {
    test("a product's level held only by owner narrows its product's kinds only where it reaches somebody who may read cases", async () => {
      const developersRows: Array<ProjectTeamRow> = [
        {
          teamId: DEVELOPERS,
          permission: Permission.HostViewer,
          scope: PermissionScope.Owned,
        },
      ];

      theProject({ developersRows });
      expect((await caseTriageReaders()).ownedOnlyPermissions).toEqual([]);

      theProject({
        developersRows,
        members: [{ teamId: SECURITY, userId: DEVELOPER }],
      });
      const audience: ReadAudience = await caseTriageReaders();

      expect(audience.ownedOnlyPermissions).toEqual([Permission.HostViewer]);
      expect(ReadAudiencePermission.isNarrowedByOwners(Host, audience)).toBe(
        true,
      );
    });

    test("a level that reads where the triage is posted makes whoever holds it a reader: the lists are each model's own, levels included", async () => {
      const getTablePermission: typeof TablePermission.getTablePermission =
        TablePermission.getTablePermission.bind(TablePermission);

      // As if a product's level read cases.
      jest
        .spyOn(TablePermission, "getTablePermission")
        .mockImplementation(
          (
            modelType: DatabaseBaseModelType,
            type: DatabaseRequestType,
          ): Array<Permission> => {
            const permissions: Array<Permission> = getTablePermission(
              modelType,
              type,
            );

            return modelType === (SecurityCase as DatabaseBaseModelType) &&
              type === DatabaseRequestType.Read
              ? [...permissions, Permission.CloudViewer]
              : permissions;
          },
        );

      theProject({
        teamRows: [{ teamId: DEVELOPERS, permission: Permission.CloudViewer }],
      });

      expect(
        ReadAudienceReader.getSubjectReadingPermissions({
          projectId: PROJECT_ID,
          securityCaseId: CASE_ID,
        }),
      ).toContain(Permission.CloudViewer);
      expect((await caseTriageReaders()).ownedOnlyPermissions).toEqual([
        Permission.ProjectMember,
      ]);
    });
  });

  describe("a doubt keeps the narrowing", () => {
    const UNTOLD_ROW: ReadNarrowingRow = {
      permission: Permission.ProjectMember,
      isOwnedOnly: true,
    };

    test("a row whose team or key cannot be told counts, and nobody is looked up for it", async () => {
      const reads: ProjectPermissionReads = theProject();

      expect(
        await ReadAudienceReader.readRowsReachingReaders({
          projectId: PROJECT_ID,
          rows: [UNTOLD_ROW],
          readingPermissions: [Permission.SecurityViewer],
        }),
      ).toEqual([UNTOLD_ROW]);
      expect(reads.teamPermission).toEqual([]);
      expect(reads.teamMember).toEqual([]);
    });

    test("no permission said to read the run keeps every row", async () => {
      const row: ReadNarrowingRow = { ...UNTOLD_ROW, teamId: DEVELOPERS };

      theProject();

      expect(
        await ReadAudienceReader.readRowsReachingReaders({
          projectId: PROJECT_ID,
          rows: [row],
          readingPermissions: [],
        }),
      ).toEqual([row]);
    });

    test.each([
      Permission.ProjectUser,
      Permission.CurrentUser,
      Permission.Public,
    ])(
      "a permission everybody holds (%s) among the reading ones makes every row count, and nobody is looked up",
      async (permission: Permission) => {
        const row: ReadNarrowingRow = { ...UNTOLD_ROW, teamId: DEVELOPERS };
        const reads: ProjectPermissionReads = theProject();

        expect(
          await ReadAudienceReader.readRowsReachingReaders({
            projectId: PROJECT_ID,
            rows: [row],
            readingPermissions: [Permission.SecurityViewer, permission],
          }),
        ).toEqual([row]);
        expect(reads.teamMember).toEqual([]);
      },
    );
  });

  describe("what it costs, and when it is read", () => {
    test("a project whose roles narrow nobody looks nobody up", async () => {
      const reads: ProjectPermissionReads = theProject({
        developersRows: [],
      });

      const audience: ReadAudience = await caseTriageReaders();

      expect(ReadAudiencePermission.narrowsNobody(audience)).toBe(true);
      // The two reads of the narrowing rows, and nothing else.
      expect(reads.teamPermission).toHaveLength(2);
      expect(reads.teamMember).toEqual([]);
    });

    test("every read is of the project's own rows: three of the rows that narrow, and at most four to tell whom they reach", async () => {
      const reads: ProjectPermissionReads = theProject({
        keyRows: [
          {
            apiKeyId: DEPLOY_KEY,
            permission: Permission.ReadService,
            labelIds: [LABEL],
          },
        ],
      });

      await caseTriageReaders();

      const all: Array<Record<string, unknown>> = [
        ...reads.teamPermission,
        ...reads.apiKeyPermission,
        ...reads.teamMember,
      ];

      for (const query of all) {
        expect(query["projectId"]).toBe(PROJECT_ID);
      }

      /*
       * The rows that narrow (two of teams, one of keys); then the teams'
       * rows that read the case, the key's, who is on the teams that
       * narrow, and which of them is on a team that reads the case.
       */
      expect(all).toHaveLength(3 + 4);
    });

    test("who may read the case is read as the triage starts: a developer who joins the Security team later narrows the next triage, not one written before", async () => {
      theProject();
      const first: ReadAudience = await caseTriageReaders();

      theProject({ members: [{ teamId: SECURITY, userId: DEVELOPER }] });
      const next: ReadAudience = await caseTriageReaders();

      expect(first.ownedOnlyPermissions).toEqual([]);
      expect(next.ownedOnlyPermissions).toEqual([Permission.ProjectMember]);
    });

    test("the members of a narrowing team are looked up on the teams that read cases only", async () => {
      const reads: ProjectPermissionReads = theProject();

      await caseTriageReaders();

      const memberships: Record<string, unknown> | undefined =
        reads.teamMember.find((query: Record<string, unknown>): boolean => {
          return query["userId"] !== undefined;
        });

      expect(memberships).toBeDefined();
      expect(
        Object.values(
          (memberships!["teamId"] as FindOperator<unknown>)
            .objectLiteralParameters || {},
        )[0],
      ).toEqual([OWNERS, SECURITY]);
    });
  });
});
