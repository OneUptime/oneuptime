import AccessControlPermission, {
  ColumnKeptToLabels,
  RelatedColumnsKeptToLabels,
} from "../../../../../Server/Types/Database/Permissions/AccessControlPermission";
import Query from "../../../../../Server/Types/Database/Query";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import NetworkDevice from "../../../../../Models/DatabaseModels/NetworkDevice";
import Probe from "../../../../../Models/DatabaseModels/Probe";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import PermissionScope from "../../../../../Types/Database/AccessControl/PermissionScope";
import Dictionary from "../../../../../Types/Dictionary";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../../Types/Permission";
import UserType from "../../../../../Types/UserType";
import { ON_HIGHEST_PLAN } from "../../../TestingUtils/RequestPlan";
import { describe, expect, test } from "@jest/globals";

/*
 * A COLUMN READ ON SOME LABELS ONLY, WITHHELD PER RECORD ACROSS PROJECTS AND
 * THROUGH RELATIONS (#11438) - the rule, without a database:
 *
 *   - which columns a read across projects keeps to labels, project by
 *     project, with each project's own rows; the rows withheld by their own
 *     project's grant, and a row read without its project left without
 *     every such column;
 *   - which related columns a select through a relation keeps to labels -
 *     only those held to their own read there - and the related records
 *     withheld outside the grant;
 *   - an order by a column kept to labels in any of the projects a read
 *     crosses is refused.
 *
 * ReadsWithholdPerRecordPostgres shows the same through the services, on a
 * migrated Postgres.
 */

const FIRST: ObjectID = new ObjectID("11438000-0000-4000-8000-000000000001");
const SECOND: ObjectID = new ObjectID("11438000-0000-4000-8000-000000000002");
const MEMBER_ID: ObjectID = new ObjectID(
  "11438000-0000-4000-8000-000000000003",
);
const LABEL_X: ObjectID = new ObjectID("11438000-0000-4000-8000-0000000000a1");

const MONITOR_A: string = "11438000-0000-4000-8000-0000000000c1";
const MONITOR_B: string = "11438000-0000-4000-8000-0000000000c2";
const MONITOR_C: string = "11438000-0000-4000-8000-0000000000c3";
const PROBE_A: string = "11438000-0000-4000-8000-0000000000d1";
const PROBE_B: string = "11438000-0000-4000-8000-0000000000d2";

function row(
  permission: Permission,
  data: { scope: PermissionScope; labelIds?: Array<ObjectID> },
): UserPermission {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: data.labelIds || [],
    isBlockPermission: false,
    scope: data.scope,
  };
}

const CUSTOMER: Array<UserPermission> = [
  row(Permission.Viewer, { scope: PermissionScope.All }),
  row(Permission.ProjectMember, {
    scope: PermissionScope.Labels,
    labelIds: [LABEL_X],
  }),
];

const MEMBER_OVER_PROJECT: Array<UserPermission> = [
  row(Permission.ProjectMember, { scope: PermissionScope.All }),
];

// A read across both projects: the first project's rows, then the second's.
function acrossProjects(
  first: Array<UserPermission>,
  second: Array<UserPermission>,
): DatabaseCommonInteractionProps {
  return {
    userId: MEMBER_ID,
    userType: UserType.User,
    isMultiTenantRequest: true,
    userGlobalAccessPermission: {
      _type: "UserGlobalAccessPermission",
      projectIds: [FIRST, SECOND],
      globalPermissions: [Permission.Public, Permission.User],
    },
    userTenantAccessPermission: {
      [FIRST.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: FIRST,
        permissions: first,
      },
      [SECOND.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: SECOND,
        permissions: second,
      },
    },
    ...ON_HIGHEST_PLAN,
  } as DatabaseCommonInteractionProps;
}

function inProject(
  rows: Array<UserPermission>,
): DatabaseCommonInteractionProps {
  return {
    userId: MEMBER_ID,
    userType: UserType.User,
    tenantId: FIRST,
    userGlobalAccessPermission: {
      _type: "UserGlobalAccessPermission",
      projectIds: [FIRST],
      globalPermissions: [Permission.Public, Permission.User],
    },
    userTenantAccessPermission: {
      [FIRST.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: FIRST,
        permissions: rows,
      },
    },
    ...ON_HIGHEST_PLAN,
  } as DatabaseCommonInteractionProps;
}

const monitorIn: (id: string, projectId: ObjectID | null) => Monitor = (
  id: string,
  projectId: ObjectID | null,
): Monitor => {
  const monitor: Monitor = new Monitor();
  monitor._id = id;
  monitor.serverMonitorSecretKey = new ObjectID(id);

  if (projectId) {
    monitor.projectId = projectId;
  }

  return monitor;
};

describe("a read across projects: the columns kept to labels, project by project", () => {
  test("a project whose grant to read the key is limited to labels keeps it; one over the whole project does not", () => {
    const kept: Map<
      string,
      Array<ColumnKeptToLabels>
    > = AccessControlPermission.getColumnsKeptToLabelsByProject(
      Monitor,
      { name: true, serverMonitorSecretKey: true },
      acrossProjects(CUSTOMER, MEMBER_OVER_PROJECT),
    );

    expect(Array.from(kept.keys())).toEqual([FIRST.toString().toLowerCase()]);
    expect(
      kept
        .get(FIRST.toString().toLowerCase())!
        .map((column: ColumnKeptToLabels): string => {
          return column.column;
        }),
    ).toEqual(["serverMonitorSecretKey"]);
  });

  test("nothing for a read in one project, for root, or for a select of no such column", () => {
    expect(
      AccessControlPermission.getColumnsKeptToLabelsByProject(
        Monitor,
        { serverMonitorSecretKey: true },
        inProject(CUSTOMER),
      ).size,
    ).toBe(0);
    expect(
      AccessControlPermission.getColumnsKeptToLabelsByProject(
        Monitor,
        { serverMonitorSecretKey: true },
        { ...acrossProjects(CUSTOMER, CUSTOMER), isRoot: true },
      ).size,
    ).toBe(0);
    expect(
      AccessControlPermission.getColumnsKeptToLabelsByProject(
        Monitor,
        { name: true },
        acrossProjects(CUSTOMER, CUSTOMER),
      ).size,
    ).toBe(0);
  });

  test("each row is withheld by its own project's grant; a row read without its project, by every one", async () => {
    const rows: Array<Monitor> = [
      monitorIn(MONITOR_A, FIRST),
      monitorIn(MONITOR_B, SECOND),
      monitorIn(MONITOR_C, null),
    ];
    const asked: Array<string> = [];

    const props: DatabaseCommonInteractionProps = acrossProjects(
      CUSTOMER,
      MEMBER_OVER_PROJECT,
    );

    await AccessControlPermission.withholdColumnsKeptToLabelsByProject({
      modelType: Monitor,
      rows: rows,
      keptByProject: AccessControlPermission.getColumnsKeptToLabelsByProject(
        Monitor,
        { serverMonitorSecretKey: true },
        props,
      ),
      props: props,
      findIds: async (query: Query<Monitor>): Promise<Array<string>> => {
        asked.push(JSON.stringify(query));
        // The first project's grant reaches none of its rows here.
        return [];
      },
    });

    // The first project's row: its grant does not reach it.
    expect(rows[0]!.serverMonitorSecretKey).toBeUndefined();
    // The second project's: read over that whole project.
    expect(rows[1]!.serverMonitorSecretKey?.toString()).toBe(MONITOR_B);
    // No project: never more than the caller may read.
    expect(rows[2]!.serverMonitorSecretKey).toBeUndefined();
    // One lookup, of the first project's row alone.
    expect(asked.length).toBe(1);
    expect(asked[0]).toContain(MONITOR_A);
    expect(asked[0]).not.toContain(MONITOR_B);
  });

  test("a row its project's grant reaches keeps the column", async () => {
    const rows: Array<Monitor> = [monitorIn(MONITOR_A, FIRST)];
    const props: DatabaseCommonInteractionProps = acrossProjects(
      CUSTOMER,
      CUSTOMER,
    );

    await AccessControlPermission.withholdColumnsKeptToLabelsByProject({
      modelType: Monitor,
      rows: rows,
      keptByProject: AccessControlPermission.getColumnsKeptToLabelsByProject(
        Monitor,
        { serverMonitorSecretKey: true },
        props,
      ),
      props: props,
      findIds: async (): Promise<Array<string>> => {
        return [MONITOR_A];
      },
    });

    expect(rows[0]!.serverMonitorSecretKey?.toString()).toBe(MONITOR_A);
  });

  test("an order by such a column across projects is refused, saying why", () => {
    expect(() => {
      AccessControlPermission.checkSortOnColumnsKeptToLabels(
        Monitor,
        { serverMonitorSecretKey: SortOrder.Ascending },
        acrossProjects(MEMBER_OVER_PROJECT, CUSTOMER),
      );
    }).toThrow(NotAuthorizedException);

    expect(() => {
      AccessControlPermission.checkSortOnColumnsKeptToLabels(
        Monitor,
        { serverMonitorSecretKey: SortOrder.Ascending },
        acrossProjects(MEMBER_OVER_PROJECT, MEMBER_OVER_PROJECT),
      );
    }).not.toThrow();
  });
});

describe("a select through a relation of a column held to its own read", () => {
  const READ_DEVICES_AND_LABELLED_PROBES: Array<UserPermission> = [
    row(Permission.ReadNetworkDevice, { scope: PermissionScope.All }),
    row(Permission.ReadProjectProbe, {
      scope: PermissionScope.Labels,
      labelIds: [LABEL_X],
    }),
  ];

  test("a probe's trap report, read on some labels only, is kept to them; its name - the relation's - is not", () => {
    const kept: Array<RelatedColumnsKeptToLabels> =
      AccessControlPermission.getRelatedColumnsKeptToLabels(
        NetworkDevice,
        {
          name: true,
          probe: { _id: true, name: true, snmpTrapReceiver: true },
        },
        inProject(READ_DEVICES_AND_LABELLED_PROBES),
      );

    expect(kept.length).toBe(1);
    expect(kept[0]!.relation).toBe("probe");
    expect(kept[0]!.relatedModelType).toBe(Probe);
    expect(
      kept[0]!.kept.map((column: ColumnKeptToLabels): string => {
        return column.column;
      }),
    ).toEqual(["snmpTrapReceiver"]);
  });

  test("read over the whole project: nothing kept", () => {
    expect(
      AccessControlPermission.getRelatedColumnsKeptToLabels(
        NetworkDevice,
        { probe: { snmpTrapReceiver: true } },
        inProject([
          row(Permission.ReadNetworkDevice, { scope: PermissionScope.All }),
          row(Permission.ReadProjectProbe, { scope: PermissionScope.All }),
        ]),
      ),
    ).toEqual([]);
  });

  test("nothing for root, for a read across projects (weighed project by project), or a select of no relation", () => {
    expect(
      AccessControlPermission.getRelatedColumnsKeptToLabels(
        NetworkDevice,
        { probe: { snmpTrapReceiver: true } },
        { isRoot: true },
      ),
    ).toEqual([]);
    expect(
      AccessControlPermission.getRelatedColumnsKeptToLabels(
        NetworkDevice,
        { name: true },
        inProject(READ_DEVICES_AND_LABELLED_PROBES),
      ),
    ).toEqual([]);

    const props: DatabaseCommonInteractionProps = acrossProjects(
      READ_DEVICES_AND_LABELLED_PROBES,
      [
        row(Permission.ReadNetworkDevice, { scope: PermissionScope.All }),
        row(Permission.ReadProjectProbe, { scope: PermissionScope.All }),
      ],
    );

    expect(
      AccessControlPermission.getRelatedColumnsKeptToLabels(
        NetworkDevice,
        { probe: { snmpTrapReceiver: true } },
        props,
      ),
    ).toEqual([]);
    expect(
      Array.from(
        AccessControlPermission.getRelatedColumnsKeptToLabelsByProject(
          NetworkDevice,
          { probe: { snmpTrapReceiver: true } },
          props,
        ).keys(),
      ),
    ).toEqual([FIRST.toString().toLowerCase()]);
  });

  test("the related records the grant does not reach are read without the column; those it reaches keep it", async () => {
    const device: (
      id: string,
      probeId: string | null,
    ) => Dictionary<unknown> = (
      id: string,
      probeId: string | null,
    ): Dictionary<unknown> => {
      return {
        _id: id,
        probe: probeId
          ? { _id: probeId, name: probeId, snmpTrapReceiver: { port: 162 } }
          : null,
      };
    };

    const rows: Array<Dictionary<unknown>> = [
      device(MONITOR_A, PROBE_A),
      device(MONITOR_B, PROBE_B),
      device(MONITOR_C, null),
    ];
    const asked: Array<string> = [];
    const props: DatabaseCommonInteractionProps = inProject(
      READ_DEVICES_AND_LABELLED_PROBES,
    );

    await AccessControlPermission.withholdRelatedColumnsKeptToLabels({
      modelType: NetworkDevice,
      rows: rows as unknown as Array<NetworkDevice>,
      kept: AccessControlPermission.getRelatedColumnsKeptToLabels(
        NetworkDevice,
        { probe: { snmpTrapReceiver: true } },
        props,
      ),
      props: props,
      findRelatedIds: async (
        relatedModelType: { new (): BaseModel },
        query: Query<BaseModel>,
      ): Promise<Array<string>> => {
        expect(relatedModelType).toBe(Probe);
        asked.push(JSON.stringify(query));
        return [PROBE_B];
      },
    });

    expect(
      (rows[0]!["probe"] as Dictionary<unknown>)["snmpTrapReceiver"],
    ).toBeUndefined();
    expect((rows[0]!["probe"] as Dictionary<unknown>)["name"]).toBe(PROBE_A);
    expect(
      (rows[1]!["probe"] as Dictionary<unknown>)["snmpTrapReceiver"],
    ).toEqual({
      port: 162,
    });
    expect(rows[2]!["probe"]).toBeNull();

    // One lookup, of both probes at once.
    expect(asked.length).toBe(1);
    expect(asked[0]).toContain(PROBE_A);
    expect(asked[0]).toContain(PROBE_B);
  });

  test("a related record read without its id is left without the column", async () => {
    const rows: Array<Dictionary<unknown>> = [
      { _id: MONITOR_A, probe: { name: "x", snmpTrapReceiver: { port: 162 } } },
    ];
    const props: DatabaseCommonInteractionProps = inProject(
      READ_DEVICES_AND_LABELLED_PROBES,
    );

    await AccessControlPermission.withholdRelatedColumnsKeptToLabels({
      modelType: NetworkDevice,
      rows: rows as unknown as Array<NetworkDevice>,
      kept: AccessControlPermission.getRelatedColumnsKeptToLabels(
        NetworkDevice,
        { probe: { snmpTrapReceiver: true } },
        props,
      ),
      props: props,
      findRelatedIds: async (): Promise<Array<string>> => {
        return [];
      },
    });

    expect(
      (rows[0]!["probe"] as Dictionary<unknown>)["snmpTrapReceiver"],
    ).toBeUndefined();
  });
});
