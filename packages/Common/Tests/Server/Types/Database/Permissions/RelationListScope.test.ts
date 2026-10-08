import { RecordIdsFinder } from "../../../../../Server/Types/Database/Permissions/CreatePermission";
import ModelPermission from "../../../../../Server/Types/Database/Permissions/Index";
import RelationListPermission, {
  CheckedRelationList,
} from "../../../../../Server/Types/Database/Permissions/RelationListPermission";
import Query from "../../../../../Server/Types/Database/Query";
import ReadPermission from "../../../../../Server/Types/Database/Permissions/ReadPermission";
import {
  ProjectScopedReferenceException,
  UnreadableParentException,
  UnreadableReferenceException,
} from "../../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import Alert from "../../../../../Models/DatabaseModels/Alert";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import IncidentTemplate from "../../../../../Models/DatabaseModels/IncidentTemplate";
import KubernetesResource from "../../../../../Models/DatabaseModels/KubernetesResource";
import Label from "../../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import OnCallDutyPolicy from "../../../../../Models/DatabaseModels/OnCallDutyPolicy";
import ScheduledMaintenance from "../../../../../Models/DatabaseModels/ScheduledMaintenance";
import StatusPage from "../../../../../Models/DatabaseModels/StatusPage";
import StatusPageAnnouncement from "../../../../../Models/DatabaseModels/StatusPageAnnouncement";
import StatusPageResource from "../../../../../Models/DatabaseModels/StatusPageResource";
import StatusPageSubscriber from "../../../../../Models/DatabaseModels/StatusPageSubscriber";
import Team from "../../../../../Models/DatabaseModels/Team";
import User from "../../../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../../Types/Permission";
import UserType from "../../../../../Types/UserType";
import { ON_HIGHEST_PLAN } from "../../../TestingUtils/RequestPlan";
import { withLabelJoinTables } from "../../../TestingUtils/LabelJoinTables";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../../../Server/Utils/Logger");

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * THE RECORDS A WRITE LISTS ARE RECORDS ITS CALLER MAY READ
 * (RelationListPermission).
 *
 * The monitors an incident affects, the status pages a maintenance event is
 * shown on, the on-call policies an alert pages: a create or an update
 * names only records its caller may read, by the read rule of the listed
 * model's own table, and a record they may not read is answered like one
 * that does not exist. Only the records a write adds are asked about. A
 * caller who holds no read of the listed model at all is held to the
 * project and their blocks with labels.
 */

const projectId: ObjectID = new ObjectID(
  "0193c0de-dddd-4aaa-8bbb-000000000001",
);
const productionLabelId: ObjectID = new ObjectID(
  "0193c0de-dddd-4aaa-8bbb-0000000000a1",
);

const MONITOR_A: string = "0193c0de-dddd-4aaa-8bbb-00000000a001";
const MONITOR_B: string = "0193c0de-dddd-4aaa-8bbb-00000000a002";
const PAGE_A: string = "0193c0de-dddd-4aaa-8bbb-00000000d001";
const PAGE_B: string = "0193c0de-dddd-4aaa-8bbb-00000000d002";
const POLICY_A: string = "0193c0de-dddd-4aaa-8bbb-00000000f001";

const row: (
  permission: Permission,
  data?: {
    labelIds?: Array<ObjectID>;
    isBlock?: boolean;
    scope?: PermissionScope;
  },
) => UserPermission = (
  permission: Permission,
  data?: {
    labelIds?: Array<ObjectID>;
    isBlock?: boolean;
    scope?: PermissionScope;
  },
): UserPermission => {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: data?.labelIds || [],
    isBlockPermission: Boolean(data?.isBlock),
    scope:
      data?.scope ||
      (data?.labelIds && data.labelIds.length > 0 && !data.isBlock
        ? PermissionScope.Labels
        : PermissionScope.All),
  };
};

const everywhere: (permission: Permission) => UserPermission = (
  permission: Permission,
): UserPermission => {
  return row(permission);
};

const onProduction: (permission: Permission) => UserPermission = (
  permission: Permission,
): UserPermission => {
  return row(permission, { labelIds: [productionLabelId] });
};

const member: (
  rows: Array<UserPermission>,
) => DatabaseCommonInteractionProps = (
  rows: Array<UserPermission>,
): DatabaseCommonInteractionProps => {
  return {
    userId: ObjectID.generate(),
    userType: UserType.User,
    tenantId: projectId,
    userTeamIds: [ObjectID.generate()],
    ...ON_HIGHEST_PLAN,
    userGlobalAccessPermission: {
      _type: "UserGlobalAccessPermission",
      projectIds: [projectId],
      globalPermissions: [Permission.Public, Permission.User],
    },
    userTenantAccessPermission: {
      [projectId.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: projectId,
        permissions: rows,
      },
    },
  };
};

const apiKey: (
  rows: Array<UserPermission>,
) => DatabaseCommonInteractionProps = (
  rows: Array<UserPermission>,
): DatabaseCommonInteractionProps => {
  return {
    userType: UserType.API,
    tenantId: projectId,
    ...ON_HIGHEST_PLAN,
    userTenantAccessPermission: {
      [projectId.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: projectId,
        permissions: rows,
      },
    },
  };
};

interface LookupCall {
  modelType: { new (): BaseModel };
  ids: Array<string>;
  query: Query<BaseModel>;
  props: DatabaseCommonInteractionProps;
}

interface Lookups {
  readable: RecordIdsFinder;
  inProject: RecordIdsFinder;
  readCalls: Array<LookupCall>;
  projectCalls: Array<LookupCall>;
}

const lookupsFinding: (
  readableIds: Array<string>,
  inProjectIds?: Array<string>,
) => Lookups = (
  readableIds: Array<string>,
  inProjectIds: Array<string> = readableIds,
): Lookups => {
  const lookups: Lookups = {
    readCalls: [],
    projectCalls: [],
    readable: async (data: LookupCall): Promise<Array<string>> => {
      lookups.readCalls.push(data);
      return data.ids.filter((id: string): boolean => {
        return readableIds.includes(id.toLowerCase());
      });
    },
    inProject: async (data: LookupCall): Promise<Array<string>> => {
      lookups.projectCalls.push(data);
      return data.ids.filter((id: string): boolean => {
        return inProjectIds.includes(id.toLowerCase());
      });
    },
  };

  return lookups;
};

const check: (data: {
  modelType: { new (): BaseModel };
  data: Record<string, unknown>;
  props: DatabaseCommonInteractionProps;
  lookups: Lookups;
  heldIdsByColumn?: Record<string, Array<Array<string>>>;
  referencesCheckedInProject?: boolean;
}) => Promise<void> = async (data: {
  modelType: { new (): BaseModel };
  data: Record<string, unknown>;
  props: DatabaseCommonInteractionProps;
  lookups: Lookups;
  heldIdsByColumn?: Record<string, Array<Array<string>>>;
  referencesCheckedInProject?: boolean;
}): Promise<void> => {
  await ModelPermission.checkNamedListsPermission({
    modelType: data.modelType,
    data: data.data,
    props: data.props,
    heldIdsByColumn: data.heldIdsByColumn,
    findReadableIds: data.lookups.readable,
    findIdsInProject: data.lookups.inProject,
    referencesCheckedInProject: data.referencesCheckedInProject ?? true,
  });
};

const refusalOf: (promise: Promise<unknown>) => Promise<unknown> = async (
  promise: Promise<unknown>,
): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  return undefined;
};

const ids: (values: Array<string>) => Array<Record<string, string>> = (
  values: Array<string>,
): Array<Record<string, string>> => {
  return values.map((id: string): Record<string, string> => {
    return { _id: id };
  });
};

// A declarer whose read of monitors is limited to a label.
const LABELLED_DECLARER: Array<UserPermission> = [
  everywhere(Permission.CreateProjectIncident),
  everywhere(Permission.EditProjectIncident),
  everywhere(Permission.ReadProjectIncident),
  onProduction(Permission.ReadProjectMonitor),
];

const columnsOf: (modelType: { new (): BaseModel }) => Array<string> = (
  modelType: { new (): BaseModel },
): Array<string> => {
  return RelationListPermission.getCheckedLists(modelType).map(
    (list: CheckedRelationList): string => {
      return list.column;
    },
  );
};

describe("the lists held to the caller's read", () => {
  test("an incident's lists of records read one by one, not its labels", () => {
    const columns: Array<string> = columnsOf(Incident);

    for (const column of [
      "monitors",
      "statusPages",
      "onCallDutyPolicies",
      "services",
      "hosts",
      "kubernetesClusters",
      "kubernetesResources",
      "serviceLevelObjectives",
    ]) {
      expect(columns).toContain(column);
    }

    expect(columns).not.toContain("labels");
  });

  test("a maintenance event's monitors and status pages, an alert's on-call policies, a template's lists", () => {
    expect(columnsOf(ScheduledMaintenance)).toEqual(
      expect.arrayContaining(["monitors", "statusPages"]),
    );
    expect(columnsOf(Alert)).toEqual(
      expect.arrayContaining(["onCallDutyPolicies", "services"]),
    );
    expect(columnsOf(IncidentTemplate)).toEqual(
      expect.arrayContaining(["monitors", "statusPages", "onCallDutyPolicies"]),
    );
  });

  test("an announcement's monitors, but not its status pages: the parent rule holds those", () => {
    const columns: Array<string> = columnsOf(StatusPageAnnouncement);

    expect(columns).toContain("monitors");
    expect(columns).not.toContain("statusPages");
  });

  test("the records read one by one, and the ones read as a whole table", () => {
    for (const modelType of [
      Monitor,
      StatusPage,
      OnCallDutyPolicy,
      // Read through its status page.
      StatusPageResource,
      // Carries the labels of the cluster it names.
      KubernetesResource,
      Incident,
    ]) {
      expect([
        modelType.name,
        RelationListPermission.isReadPerRecord(modelType),
      ]).toEqual([modelType.name, true]);
    }

    for (const modelType of [Label, Team, User]) {
      expect([
        modelType.name,
        RelationListPermission.isReadPerRecord(modelType),
      ]).toEqual([modelType.name, false]);
    }
  });

  test("a list of a subscriber's resources, read through their status page", () => {
    expect(columnsOf(StatusPageSubscriber)).toEqual(["statusPageResources"]);
  });
});

describe("a create that lists records", () => {
  test.each([
    ["a team member", member(LABELLED_DECLARER)],
    ["an API key", apiKey(LABELLED_DECLARER)],
  ])(
    "%s whose read of monitors is limited to a label lists only monitors carrying it",
    async (_name: string, props: DatabaseCommonInteractionProps) => {
      const lookups: Lookups = lookupsFinding([MONITOR_A]);

      await expect(
        check({
          modelType: Incident,
          data: { monitors: ids([MONITOR_A]) },
          props: props,
          lookups: lookups,
        }),
      ).resolves.toBeUndefined();

      const refusal: unknown = await refusalOf(
        check({
          modelType: Incident,
          data: { monitors: ids([MONITOR_A, MONITOR_B]) },
          props: props,
          lookups: lookups,
        }),
      );

      // Answered like a missing record, in the words every reference check uses.
      expect(refusal).toBeInstanceOf(UnreadableReferenceException);
      expect(refusal).toBeInstanceOf(ProjectScopedReferenceException);
      expect(refusal).not.toBeInstanceOf(UnreadableParentException);
      expect((refusal as Error).message).toBe(
        `This incident references records that are not in this project: Monitors "${MONITOR_B}". Please pick values from this project and try again.`,
      );

      // Read as the caller, through the monitors' own read rule.
      expect(lookups.readCalls[1]?.modelType).toBe(Monitor);
      expect(lookups.readCalls[1]?.ids).toEqual([MONITOR_A, MONITOR_B]);
      expect(lookups.readCalls[1]?.props).toBe(props);
      expect(lookups.projectCalls).toEqual([]);
    },
  );

  test("every list's refused records are named at once", async () => {
    const refusal: unknown = await refusalOf(
      check({
        modelType: ScheduledMaintenance,
        data: {
          monitors: ids([MONITOR_B]),
          statusPages: ids([PAGE_A, PAGE_B]),
        },
        props: member([
          everywhere(Permission.CreateProjectScheduledMaintenance),
          everywhere(Permission.ReadProjectScheduledMaintenance),
          onProduction(Permission.ReadProjectMonitor),
          onProduction(Permission.ReadProjectStatusPage),
        ]),
        lookups: lookupsFinding([PAGE_A]),
      }),
    );

    expect((refusal as Error).message).toBe(
      `This scheduled maintenance event references records that are not in this project: Monitors "${MONITOR_B}", Status Pages "${PAGE_B}". Please pick values from this project and try again.`,
    );
  });

  test("a caller whose read of the listed model is narrowed by nothing is not looked up: the reference check answers", async () => {
    for (const rows of [
      [
        everywhere(Permission.CreateProjectIncident),
        everywhere(Permission.ReadProjectMonitor),
      ],
      [everywhere(Permission.ProjectMember)],
      [everywhere(Permission.ProjectAdmin)],
    ]) {
      const lookups: Lookups = lookupsFinding([]);

      await expect(
        check({
          modelType: Incident,
          data: { monitors: ids([MONITOR_A, MONITOR_B]) },
          props: member(rows),
          lookups: lookups,
        }),
      ).resolves.toBeUndefined();

      expect(lookups.readCalls).toEqual([]);
      expect(lookups.projectCalls).toEqual([]);
    }
  });

  test("with no reference check of the write's service, every listed record is looked up", async () => {
    const lookups: Lookups = lookupsFinding([MONITOR_A]);

    const refusal: unknown = await refusalOf(
      check({
        modelType: Incident,
        data: { monitors: ids([MONITOR_A, MONITOR_B]) },
        props: member([everywhere(Permission.ProjectAdmin)]),
        lookups: lookups,
        referencesCheckedInProject: false,
      }),
    );

    expect(refusal).toBeInstanceOf(UnreadableReferenceException);
    expect(lookups.readCalls[0]?.ids).toEqual([MONITOR_A, MONITOR_B]);
  });

  test("an incident responder who reads no monitors is held to the project, not to a read they do not have", async () => {
    const responder: Array<UserPermission> = [
      everywhere(Permission.IncidentMember),
    ];

    // The write's own reference check answers a monitor of another project.
    const checked: Lookups = lookupsFinding([]);

    await expect(
      check({
        modelType: Incident,
        data: { monitors: ids([MONITOR_A]) },
        props: member(responder),
        lookups: checked,
      }),
    ).resolves.toBeUndefined();

    expect(checked.readCalls).toEqual([]);
    expect(checked.projectCalls).toEqual([]);

    // Without one, OneUptime looks the monitors up in the project.
    const unchecked: Lookups = lookupsFinding([], [MONITOR_A]);

    const refusal: unknown = await refusalOf(
      check({
        modelType: Incident,
        data: { monitors: ids([MONITOR_A, MONITOR_B]) },
        props: member(responder),
        lookups: unchecked,
        referencesCheckedInProject: false,
      }),
    );

    expect((refusal as Error).message).toContain(`Monitors "${MONITOR_B}"`);
    expect(unchecked.readCalls).toEqual([]);
    expect(unchecked.projectCalls[0]?.ids).toEqual([MONITOR_A, MONITOR_B]);
  });

  test("a caller who reads no monitors but is blocked from some labels of them is held to the block", async () => {
    withLabelJoinTables();
    const addBlockedLabels: ReturnType<typeof jest.spyOn> = jest.spyOn(
      ReadPermission,
      "addBlockedLabelsToQuery",
    );

    const lookups: Lookups = lookupsFinding([], [MONITOR_A]);

    const refusal: unknown = await refusalOf(
      check({
        modelType: Incident,
        data: { monitors: ids([MONITOR_A, MONITOR_B]) },
        props: member([
          everywhere(Permission.IncidentMember),
          row(Permission.ReadProjectMonitor, {
            isBlock: true,
            labelIds: [productionLabelId],
          }),
        ]),
        lookups: lookups,
      }),
    );

    expect(refusal).toBeInstanceOf(UnreadableReferenceException);
    // Looked up by OneUptime, leaving out the blocked label's monitors.
    expect(lookups.readCalls).toEqual([]);
    expect(lookups.projectCalls[0]?.modelType).toBe(Monitor);
    expect(lookups.projectCalls[0]?.ids).toEqual([MONITOR_A, MONITOR_B]);
    // The query leaves out the monitors carrying the blocked label.
    expect(addBlockedLabels).toHaveBeenCalledWith(
      Monitor,
      expect.anything(),
      [productionLabelId],
    );
    expect(lookups.projectCalls[0]?.query).toBe(
      addBlockedLabels.mock.results[0]?.value,
    );
  });

  test("a block with no labels on reading monitors takes every monitor away", async () => {
    const lookups: Lookups = lookupsFinding([MONITOR_A, MONITOR_B]);

    const refusal: unknown = await refusalOf(
      check({
        modelType: Incident,
        data: { monitors: ids([MONITOR_A]) },
        props: member([
          everywhere(Permission.ProjectMember),
          row(Permission.ReadProjectMonitor, { isBlock: true }),
        ]),
        lookups: lookups,
      }),
    );

    expect(refusal).toBeInstanceOf(UnreadableReferenceException);
    expect((refusal as Error).message).toContain(`Monitors "${MONITOR_A}"`);
    expect(lookups.readCalls).toEqual([]);
  });

  test("a malformed id is refused unread", async () => {
    const lookups: Lookups = lookupsFinding([MONITOR_A]);

    const refusal: unknown = await refusalOf(
      check({
        modelType: Incident,
        data: { monitors: [{ _id: MONITOR_A }, { _id: "not-a-monitor" }] },
        props: member(LABELLED_DECLARER),
        lookups: lookups,
      }),
    );

    expect((refusal as Error).message).toContain(`Monitors "not-a-monitor"`);
    expect(lookups.readCalls[0]?.ids).toEqual([MONITOR_A]);
  });

  test("any shape of entry names its record once", async () => {
    const lookups: Lookups = lookupsFinding([MONITOR_A]);

    await expect(
      check({
        modelType: Incident,
        data: {
          monitors: [
            MONITOR_A,
            MONITOR_A.toUpperCase(),
            new ObjectID(MONITOR_A),
            { _id: MONITOR_A },
          ],
        },
        props: member(LABELLED_DECLARER),
        lookups: lookups,
      }),
    ).resolves.toBeUndefined();

    expect(lookups.readCalls[0]?.ids).toEqual([MONITOR_A]);
  });

  test("an empty list, or none, asks nothing", async () => {
    const lookups: Lookups = lookupsFinding([]);

    for (const data of [{ monitors: [] }, { monitors: null }, { title: "x" }]) {
      await expect(
        check({
          modelType: Incident,
          data: data,
          props: member(LABELLED_DECLARER),
          lookups: lookups,
        }),
      ).resolves.toBeUndefined();
    }

    expect(lookups.readCalls).toEqual([]);
  });

  test("OneUptime's own writes are not asked", async () => {
    for (const props of [
      { isRoot: true },
      { isRoot: true, tenantId: projectId },
      { isMasterAdmin: true },
    ] as Array<DatabaseCommonInteractionProps>) {
      const lookups: Lookups = lookupsFinding([]);

      await expect(
        check({
          modelType: Incident,
          data: { monitors: ids([MONITOR_B]) },
          props: props,
          lookups: lookups,
          referencesCheckedInProject: false,
        }),
      ).resolves.toBeUndefined();

      expect(lookups.readCalls).toEqual([]);
      expect(lookups.projectCalls).toEqual([]);
    }
  });

  test("an alert's on-call policies follow the policies' read", async () => {
    const lookups: Lookups = lookupsFinding([]);

    const refusal: unknown = await refusalOf(
      check({
        modelType: Alert,
        data: { onCallDutyPolicies: ids([POLICY_A]) },
        props: member([
          everywhere(Permission.CreateAlert),
          everywhere(Permission.ReadAlert),
          onProduction(Permission.ReadProjectOnCallDutyPolicy),
        ]),
        lookups: lookups,
      }),
    );

    expect((refusal as Error).message).toContain(
      `On-Call Duty Policies "${POLICY_A}"`,
    );
    expect(lookups.readCalls[0]?.modelType).toBe(OnCallDutyPolicy);
  });
});

describe("an update that lists more records", () => {
  test("only the records a row it writes does not list yet are asked about", async () => {
    const lookups: Lookups = lookupsFinding([MONITOR_A]);

    // Lists B already, which the editor may not read: kept, unasked.
    await expect(
      check({
        modelType: Incident,
        data: { monitors: ids([MONITOR_A, MONITOR_B]) },
        props: member(LABELLED_DECLARER),
        lookups: lookups,
        heldIdsByColumn: { monitors: [[MONITOR_B]] },
      }),
    ).resolves.toBeUndefined();

    expect(lookups.readCalls[0]?.ids).toEqual([MONITOR_A]);

    // B added: refused.
    const refusal: unknown = await refusalOf(
      check({
        modelType: Incident,
        data: { monitors: ids([MONITOR_A, MONITOR_B]) },
        props: member(LABELLED_DECLARER),
        lookups: lookupsFinding([MONITOR_A]),
        heldIdsByColumn: { monitors: [[MONITOR_A]] },
      }),
    );

    expect((refusal as Error).message).toContain(`Monitors "${MONITOR_B}"`);
  });

  test("a record one of the rows does not list is asked about", async () => {
    const lookups: Lookups = lookupsFinding([MONITOR_A]);

    const refusal: unknown = await refusalOf(
      check({
        modelType: Incident,
        data: { monitors: ids([MONITOR_B]) },
        props: member(LABELLED_DECLARER),
        lookups: lookups,
        heldIdsByColumn: { monitors: [[MONITOR_B], []] },
      }),
    );

    expect(refusal).toBeInstanceOf(UnreadableReferenceException);
  });

  test("an update that writes no row adds nothing", async () => {
    const lookups: Lookups = lookupsFinding([]);

    await expect(
      check({
        modelType: Incident,
        data: { monitors: ids([MONITOR_B]) },
        props: member(LABELLED_DECLARER),
        lookups: lookups,
        heldIdsByColumn: { monitors: [] },
      }),
    ).resolves.toBeUndefined();

    expect(lookups.readCalls).toEqual([]);
  });

  test("taking records off a list asks nothing", async () => {
    const lookups: Lookups = lookupsFinding([]);

    await expect(
      check({
        modelType: Incident,
        data: { monitors: ids([MONITOR_A]) },
        props: member(LABELLED_DECLARER),
        lookups: lookups,
        heldIdsByColumn: { monitors: [[MONITOR_A, MONITOR_B]] },
      }),
    ).resolves.toBeUndefined();

    expect(lookups.readCalls).toEqual([]);
  });
});
