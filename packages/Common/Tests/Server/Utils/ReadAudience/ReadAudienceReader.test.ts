import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { FindOperator } from "typeorm";
import ApiKeyPermission from "../../../../Models/DatabaseModels/ApiKeyPermission";
import Host from "../../../../Models/DatabaseModels/Host";
import Service from "../../../../Models/DatabaseModels/Service";
import TeamPermission from "../../../../Models/DatabaseModels/TeamPermission";
import AlertService from "../../../../Server/Services/AlertService";
import ApiKeyPermissionService from "../../../../Server/Services/ApiKeyPermissionService";
import HostService from "../../../../Server/Services/HostService";
import IncidentService from "../../../../Server/Services/IncidentService";
import ServiceService from "../../../../Server/Services/ServiceService";
import TeamPermissionService from "../../../../Server/Services/TeamPermissionService";
import LinkedAffectedResources, {
  LinkedAffectedResource,
  LinkedAffectedResourceType,
} from "../../../../Server/Utils/AffectedResources/LinkedAffectedResources";
import DataAlertLineageReader from "../../../../Server/Utils/DataObservability/DataAlertLineage";
import ReadAudienceReader from "../../../../Server/Utils/ReadAudience/ReadAudienceReader";
import PermissionScope from "../../../../Types/Database/AccessControl/PermissionScope";
import ReadAudience from "../../../../Types/BaseDatabase/ReadAudience";
import ObjectID from "../../../../Types/ObjectID";
import Permission from "../../../../Types/Permission";
import {
  readAudienceOf,
  readAudienceProps,
} from "../../../Helpers/ReadAudienceFixtures";

/*
 * WHO READS AN INCIDENT'S OR AN ALERT'S REPORT (#9576), worked out once per
 * run: what narrows somebody's reads in the project - the permissions a
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
