import { RecordIdsFinder } from "../../../../../Server/Types/Database/Permissions/CreatePermission";
import ModelPermission from "../../../../../Server/Types/Database/Permissions/Index";
import ReadPermission from "../../../../../Server/Types/Database/Permissions/ReadPermission";
import RelationListPermission, {
  CheckedRelationList,
} from "../../../../../Server/Types/Database/Permissions/RelationListPermission";
import Query from "../../../../../Server/Types/Database/Query";
import {
  ProjectScopedReferenceException,
  UnreadableParentException,
  UnreadableReferenceException,
} from "../../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import AIAgent from "../../../../../Models/DatabaseModels/AIAgent";
import AIAgentTaskPullRequest from "../../../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import Alert from "../../../../../Models/DatabaseModels/Alert";
import AlertOwnerTeam from "../../../../../Models/DatabaseModels/AlertOwnerTeam";
import AlertOwnerUser from "../../../../../Models/DatabaseModels/AlertOwnerUser";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import IncidentOwnerTeam from "../../../../../Models/DatabaseModels/IncidentOwnerTeam";
import IncidentOwnerUser from "../../../../../Models/DatabaseModels/IncidentOwnerUser";
import IncidentTemplateOwnerTeam from "../../../../../Models/DatabaseModels/IncidentTemplateOwnerTeam";
import IncidentTemplateOwnerUser from "../../../../../Models/DatabaseModels/IncidentTemplateOwnerUser";
import IncomingCallPolicyEscalationRule from "../../../../../Models/DatabaseModels/IncomingCallPolicyEscalationRule";
import LlmCostBudget from "../../../../../Models/DatabaseModels/LlmCostBudget";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import MonitorGroupResource from "../../../../../Models/DatabaseModels/MonitorGroupResource";
import MonitorOwnerTeam from "../../../../../Models/DatabaseModels/MonitorOwnerTeam";
import MonitorOwnerUser from "../../../../../Models/DatabaseModels/MonitorOwnerUser";
import MonitorProbe from "../../../../../Models/DatabaseModels/MonitorProbe";
import NetworkDevice from "../../../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceLink from "../../../../../Models/DatabaseModels/NetworkDeviceLink";
import NetworkSiteLink from "../../../../../Models/DatabaseModels/NetworkSiteLink";
import OnCallDutyPolicy from "../../../../../Models/DatabaseModels/OnCallDutyPolicy";
import Probe from "../../../../../Models/DatabaseModels/Probe";
import ProxmoxCluster from "../../../../../Models/DatabaseModels/ProxmoxCluster";
import RumSessionPin from "../../../../../Models/DatabaseModels/RumSessionPin";
import RunbookExecution from "../../../../../Models/DatabaseModels/RunbookExecution";
import ScheduledMaintenanceOwnerTeam from "../../../../../Models/DatabaseModels/ScheduledMaintenanceOwnerTeam";
import ScheduledMaintenanceOwnerUser from "../../../../../Models/DatabaseModels/ScheduledMaintenanceOwnerUser";
import ScheduledMaintenanceTemplateOwnerTeam from "../../../../../Models/DatabaseModels/ScheduledMaintenanceTemplateOwnerTeam";
import ScheduledMaintenanceTemplateOwnerUser from "../../../../../Models/DatabaseModels/ScheduledMaintenanceTemplateOwnerUser";
import Service from "../../../../../Models/DatabaseModels/Service";
import StatusPageResource from "../../../../../Models/DatabaseModels/StatusPageResource";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../../../Types/Database/AccessControl/PermissionScope";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../../Types/Permission";
import UserType from "../../../../../Types/UserType";
import { withLabelJoinTables } from "../../../TestingUtils/LabelJoinTables";
import { ON_HIGHEST_PLAN } from "../../../TestingUtils/RequestPlan";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../../../Server/Utils/Logger");

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * THE ONE RECORD A WRITE NAMES IN A FIELD OF ITS OWN IS A RECORD ITS CALLER
 * MAY READ (RelationListPermission, as for the records a list names).
 *
 * An alert's monitor, a status page resource's monitor, a cost budget's
 * service, a run's incident: a create or an update names, under either of
 * the reference's two names, only a record its caller may read by the read
 * rule of the named model's own table, and one they may not read is
 * answered like one that does not exist. On an update, only a record the
 * row does not name yet is asked about. OneUptime's global probes and AI
 * agents, which every project may use, are answered by the service that
 * attaches them.
 */

const projectId: ObjectID = new ObjectID(
  "0193c0de-eeee-4aaa-8bbb-000000000001",
);
const productionLabelId: ObjectID = new ObjectID(
  "0193c0de-eeee-4aaa-8bbb-0000000000a1",
);

const MONITOR_A: string = "0193c0de-eeee-4aaa-8bbb-00000000a001";
const MONITOR_B: string = "0193c0de-eeee-4aaa-8bbb-00000000a002";
const POLICY_A: string = "0193c0de-eeee-4aaa-8bbb-00000000f001";
const SERVICE_A: string = "0193c0de-eeee-4aaa-8bbb-00000000e001";
const PROBE_A: string = "0193c0de-eeee-4aaa-8bbb-00000000b001";
const PROBE_B: string = "0193c0de-eeee-4aaa-8bbb-00000000b002";
const GLOBAL_PROBE: string = "0193c0de-eeee-4aaa-8bbb-00000000b0ff";
const GLOBAL_AGENT: string = "0193c0de-eeee-4aaa-8bbb-00000000c0ff";

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

const blockedOnProduction: (permission: Permission) => UserPermission = (
  permission: Permission,
): UserPermission => {
  return row(permission, { labelIds: [productionLabelId], isBlock: true });
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
  shared: RecordIdsFinder;
  readCalls: Array<LookupCall>;
  projectCalls: Array<LookupCall>;
  sharedCalls: Array<LookupCall>;
}

const lookupsFinding: (data: {
  readable: Array<string>;
  inProject?: Array<string>;
  shared?: Array<string>;
}) => Lookups = (data: {
  readable: Array<string>;
  inProject?: Array<string>;
  shared?: Array<string>;
}): Lookups => {
  const finding: (
    found: Array<string>,
    calls: Array<LookupCall>,
  ) => RecordIdsFinder = (
    found: Array<string>,
    calls: Array<LookupCall>,
  ): RecordIdsFinder => {
    return async (call: LookupCall): Promise<Array<string>> => {
      calls.push(call);
      return call.ids.filter((id: string): boolean => {
        return found.includes(id.toLowerCase());
      });
    };
  };

  const readCalls: Array<LookupCall> = [];
  const projectCalls: Array<LookupCall> = [];
  const sharedCalls: Array<LookupCall> = [];

  return {
    readCalls: readCalls,
    projectCalls: projectCalls,
    sharedCalls: sharedCalls,
    readable: finding(data.readable, readCalls),
    inProject: finding(data.inProject || data.readable, projectCalls),
    shared: finding(data.shared || [], sharedCalls),
  };
};

const check: (data: {
  modelType: { new (): BaseModel };
  data: Record<string, unknown>;
  props: DatabaseCommonInteractionProps;
  lookups: Lookups;
  heldIdsByColumn?: Record<string, Array<Array<string>>>;
  referencesCheckedInProject?: boolean;
  withoutSharedFinder?: boolean;
}) => Promise<void> = async (data: {
  modelType: { new (): BaseModel };
  data: Record<string, unknown>;
  props: DatabaseCommonInteractionProps;
  lookups: Lookups;
  heldIdsByColumn?: Record<string, Array<Array<string>>>;
  referencesCheckedInProject?: boolean;
  withoutSharedFinder?: boolean;
}): Promise<void> => {
  await ModelPermission.checkNamedListsPermission({
    modelType: data.modelType,
    data: data.data,
    props: data.props,
    heldIdsByColumn: data.heldIdsByColumn,
    findReadableIds: data.lookups.readable,
    findIdsInProject: data.lookups.inProject,
    findSharedIds: data.withoutSharedFinder ? undefined : data.lookups.shared,
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

const referencesOf: (modelType: {
  new (): BaseModel;
}) => Array<string> = (modelType: { new (): BaseModel }): Array<string> => {
  return RelationListPermission.getCheckedReferences(modelType).map(
    (reference: CheckedRelationList): string => {
      return reference.column;
    },
  );
};

// A creator of alerts whose read of monitors is limited to a label.
const LABELLED_ALERT_CREATOR: Array<UserPermission> = [
  everywhere(Permission.CreateAlert),
  everywhere(Permission.EditAlert),
  everywhere(Permission.ReadAlert),
  onProduction(Permission.ReadProjectMonitor),
];

describe("the single references held to the caller's read", () => {
  test("an alert's monitor, read under both of its names", () => {
    const monitor: CheckedRelationList | undefined =
      RelationListPermission.getCheckedReferences(Alert).find(
        (reference: CheckedRelationList): boolean => {
          return reference.column === "monitor";
        },
      );

    expect(monitor).toEqual({
      column: "monitor",
      idColumn: "monitorId",
      listedModelType: Monitor,
      title: "Monitor",
    });
  });

  test("a status page resource's monitor, monitor group and group, but not its status page: the parent rule holds that", () => {
    const references: Array<string> = referencesOf(StatusPageResource);

    expect(references).toEqual(
      expect.arrayContaining(["monitor", "monitorGroup", "statusPageGroup"]),
    );
    expect(references).not.toContain("statusPage");
    // Written by nobody: not asked about.
    expect(references).not.toContain("statusPageMonitorRule");
  });

  test.each([
    [LlmCostBudget, "service"],
    [ProxmoxCluster, "cephCluster"],
    [IncomingCallPolicyEscalationRule, "incomingCallPolicy"],
    [IncomingCallPolicyEscalationRule, "onCallDutyPolicySchedule"],
    [RumSessionPin, "incident"],
    [RumSessionPin, "alert"],
    [RunbookExecution, "runbook"],
    [RunbookExecution, "incident"],
    [RunbookExecution, "alert"],
    [RunbookExecution, "scheduledMaintenance"],
    [MonitorGroupResource, "monitor"],
    [NetworkDevice, "monitor"],
    [NetworkSiteLink, "monitor"],
    [NetworkDeviceLink, "monitor"],
    [MonitorProbe, "probe"],
    [AIAgentTaskPullRequest, "aiAgent"],
  ])(
    "%p names its %s only as its caller may read it",
    (modelType: { new (): BaseModel }, column: string) => {
      expect(referencesOf(modelType)).toContain(column);
    },
  );

  test("records read as a whole table are left to the project check: severities, states, statuses, people", () => {
    const alert: Array<string> = referencesOf(Alert);

    expect(alert).not.toContain("alertSeverity");
    expect(alert).not.toContain("currentAlertState");
    expect(alert).not.toContain("monitorStatusWhenThisAlertWasCreated");
    expect(referencesOf(IncomingCallPolicyEscalationRule)).not.toContain(
      "user",
    );
  });

  test("the parent a model is read through is the parent rule's, not this one's", () => {
    expect(referencesOf(MonitorProbe)).not.toContain("monitor");
    expect(referencesOf(MonitorGroupResource)).not.toContain("monitorGroup");
  });

  test.each([
    [MonitorOwnerUser, "monitor"],
    [MonitorOwnerTeam, "monitor"],
    [IncidentOwnerUser, "incident"],
    [IncidentOwnerTeam, "incident"],
    [AlertOwnerUser, "alert"],
    [AlertOwnerTeam, "alert"],
    [ScheduledMaintenanceOwnerUser, "scheduledMaintenance"],
    [ScheduledMaintenanceOwnerTeam, "scheduledMaintenance"],
    [IncidentTemplateOwnerUser, "incidentTemplate"],
    [IncidentTemplateOwnerTeam, "incidentTemplate"],
    [ScheduledMaintenanceTemplateOwnerUser, "scheduledMaintenanceTemplate"],
    [ScheduledMaintenanceTemplateOwnerTeam, "scheduledMaintenanceTemplate"],
  ])(
    "the owners of a record, %p, are read through the %s they own",
    (modelType: { new (): BaseModel }, parent: string) => {
      expect(new modelType().canAccessIfCanReadOn).toBe(parent);
      // The parent rule asks about it: not a reference of this rule.
      expect(referencesOf(modelType)).not.toContain(parent);
    },
  );

  test("every checked list, then every checked single reference", () => {
    expect(RelationListPermission.getCheckedRelations(Alert)).toEqual([
      ...RelationListPermission.getCheckedLists(Alert),
      ...RelationListPermission.getCheckedReferences(Alert),
    ]);
  });

  test("the records every project may name: OneUptime's global probes and AI agents", () => {
    expect(RelationListPermission.getSharedRecordQuery(Probe)).toEqual({
      isGlobalProbe: true,
    });
    expect(RelationListPermission.getSharedRecordQuery(AIAgent)).toEqual({
      isGlobalAIAgent: true,
    });
    expect(RelationListPermission.getSharedRecordQuery(Monitor)).toBeNull();
    expect(RelationListPermission.getSharedRecordQuery(Service)).toBeNull();
  });
});

describe("what a write names in a field of its own", () => {
  test("is read under either name, once, as sent", () => {
    for (const data of [
      { monitorId: MONITOR_A },
      { monitor: { _id: MONITOR_A } },
      { monitorId: MONITOR_A, monitor: { _id: MONITOR_A.toUpperCase() } },
      { monitorId: new ObjectID(MONITOR_A) },
    ]) {
      expect(
        RelationListPermission.getNamedIds(Alert, data)["monitor"]?.map(
          (id: string): string => {
            return id.toLowerCase();
          },
        ),
      ).toEqual([MONITOR_A]);
    }
  });

  test("a clear names nothing, and a write that leaves it out does not name it", () => {
    expect(
      RelationListPermission.getNamedIds(Alert, { monitorId: null })["monitor"],
    ).toEqual([]);
    expect(
      RelationListPermission.getNamedIds(Alert, { monitor: null })["monitor"],
    ).toEqual([]);
    expect(
      RelationListPermission.getNamedIds(Alert, { title: "Disk full" })[
        "monitor"
      ],
    ).toBeUndefined();
  });

  test("two names that disagree are refused before anything is looked up", () => {
    for (const data of [
      { monitorId: MONITOR_A, monitor: { _id: MONITOR_B } },
      { monitorId: null, monitor: { _id: MONITOR_B } },
    ]) {
      expect(() => {
        return RelationListPermission.getNamedIds(Alert, data);
      }).toThrow(BadDataException);
    }
  });

  test("after a service's hooks, the record each name holds is named: a hook may have written one name beside the caller's other", () => {
    const named: (
      data: Record<string, unknown>,
    ) => Array<string> | undefined = (
      data: Record<string, unknown>,
    ): Array<string> | undefined => {
      return RelationListPermission.getNamedIds(Alert, data, true)[
        "monitor"
      ]?.map((id: string): string => {
        return id.toLowerCase();
      });
    };

    expect(
      named({
        monitorId: new ObjectID(MONITOR_B),
        monitor: { _id: MONITOR_A },
      }),
    ).toEqual([MONITOR_B, MONITOR_A]);

    // One record under both names is named once.
    expect(
      named({
        monitorId: MONITOR_A,
        monitor: { _id: MONITOR_A.toUpperCase() },
      }),
    ).toEqual([MONITOR_A]);

    // A name a hook cleared names nothing; the other still names its record.
    expect(named({ monitorId: null, monitor: { _id: MONITOR_B } })).toEqual([
      MONITOR_B,
    ]);
    expect(named({ monitorId: null })).toEqual([]);
    expect(named({ title: "Disk full" })).toBeUndefined();
  });

  test("the records a hook named besides what the caller sent", () => {
    expect(
      RelationListPermission.getIdsNotIn(
        {
          monitor: [MONITOR_B],
          monitors: [MONITOR_A, MONITOR_B.toUpperCase()],
          onCallDutyPolicies: [POLICY_A],
        },
        { monitor: [MONITOR_A], monitors: [MONITOR_A, MONITOR_B] },
      ),
    ).toEqual({ monitor: [MONITOR_B], onCallDutyPolicies: [POLICY_A] });

    expect(
      RelationListPermission.getIdsNotIn(
        { monitor: [MONITOR_A] },
        { monitor: [MONITOR_A.toUpperCase()] },
      ),
    ).toEqual({});
  });
});

describe("a create that names a record in a field of its own", () => {
  test.each([
    ["by its ID column", { monitorId: MONITOR_A }, { monitorId: MONITOR_B }],
    [
      "by its relation",
      { monitor: { _id: MONITOR_A } },
      { monitor: { _id: MONITOR_B } },
    ],
    [
      "by both, agreeing",
      { monitorId: MONITOR_A, monitor: { _id: MONITOR_A } },
      { monitorId: MONITOR_B, monitor: { _id: MONITOR_B.toUpperCase() } },
    ],
  ])(
    "%s: a read of monitors limited to a label names only a monitor carrying it",
    async (
      _name: string,
      readable: Record<string, unknown>,
      unreadable: Record<string, unknown>,
    ) => {
      const lookups: Lookups = lookupsFinding({ readable: [MONITOR_A] });
      const props: DatabaseCommonInteractionProps = member(
        LABELLED_ALERT_CREATOR,
      );

      await expect(
        check({
          modelType: Alert,
          data: { title: "Disk full", ...readable },
          props: props,
          lookups: lookups,
        }),
      ).resolves.toBeUndefined();

      const refusal: unknown = await refusalOf(
        check({
          modelType: Alert,
          data: { title: "Disk full", ...unreadable },
          props: props,
          lookups: lookups,
        }),
      );

      // Answered like a missing record, in the words every reference check uses.
      expect(refusal).toBeInstanceOf(UnreadableReferenceException);
      expect(refusal).toBeInstanceOf(ProjectScopedReferenceException);
      expect(refusal).not.toBeInstanceOf(UnreadableParentException);
      expect((refusal as Error).message).toBe(
        `This alert references records that are not in this project: Monitor "${MONITOR_B}". Please pick values from this project and try again.`,
      );

      // Looked up once per write, as the caller, by the monitors' own read rule.
      expect(lookups.readCalls).toHaveLength(2);
      expect(lookups.readCalls[1]?.modelType).toBe(Monitor);
      expect(lookups.readCalls[1]?.ids).toEqual([MONITOR_B]);
      expect(lookups.readCalls[1]?.props).toBe(props);
      expect(lookups.projectCalls).toEqual([]);
      expect(lookups.sharedCalls).toEqual([]);
    },
  );

  test("an API key's read is held the same way", async () => {
    const refusal: unknown = await refusalOf(
      check({
        modelType: Alert,
        data: { monitorId: MONITOR_B },
        props: apiKey(LABELLED_ALERT_CREATOR),
        lookups: lookupsFinding({ readable: [MONITOR_A] }),
      }),
    );

    expect(refusal).toBeInstanceOf(UnreadableReferenceException);
    expect((refusal as Error).message).toContain(`Monitor "${MONITOR_B}"`);
  });

  test("a read that reaches only the records the caller owns is asked as the caller", async () => {
    const lookups: Lookups = lookupsFinding({ readable: [MONITOR_A] });
    const props: DatabaseCommonInteractionProps = member([
      everywhere(Permission.CreateAlert),
      everywhere(Permission.ReadAlert),
      row(Permission.ReadProjectMonitor, { scope: PermissionScope.Owned }),
    ]);

    const refusal: unknown = await refusalOf(
      check({
        modelType: Alert,
        data: { monitorId: MONITOR_B },
        props: props,
        lookups: lookups,
      }),
    );

    expect(refusal).toBeInstanceOf(UnreadableReferenceException);
    expect(lookups.readCalls[0]?.modelType).toBe(Monitor);
    expect(lookups.readCalls[0]?.props).toBe(props);
  });

  test("the list and the single reference a write names are refused together, lists first", async () => {
    const refusal: unknown = await refusalOf(
      check({
        modelType: Alert,
        data: {
          monitorId: MONITOR_B,
          onCallDutyPolicies: [{ _id: POLICY_A }],
        },
        props: member([
          ...LABELLED_ALERT_CREATOR,
          onProduction(Permission.ReadProjectOnCallDutyPolicy),
        ]),
        lookups: lookupsFinding({ readable: [] }),
      }),
    );

    expect((refusal as Error).message).toBe(
      `This alert references records that are not in this project: On-Call Duty Policies "${POLICY_A}", Monitor "${MONITOR_B}". Please pick values from this project and try again.`,
    );
  });

  test("a caller whose read of the named model is narrowed by nothing is not looked up: the reference check answers", async () => {
    for (const rows of [
      [
        everywhere(Permission.CreateAlert),
        everywhere(Permission.ReadProjectMonitor),
      ],
      [everywhere(Permission.ProjectMember)],
      [everywhere(Permission.ProjectAdmin)],
    ]) {
      const lookups: Lookups = lookupsFinding({ readable: [] });

      await expect(
        check({
          modelType: Alert,
          data: { monitorId: MONITOR_B },
          props: member(rows),
          lookups: lookups,
        }),
      ).resolves.toBeUndefined();

      expect(lookups.readCalls).toEqual([]);
      expect(lookups.projectCalls).toEqual([]);
    }
  });

  test("with no reference check of the write's service, the named record is looked up", async () => {
    const lookups: Lookups = lookupsFinding({ readable: [MONITOR_A] });

    const refusal: unknown = await refusalOf(
      check({
        modelType: Alert,
        data: { monitorId: MONITOR_B },
        props: member([everywhere(Permission.ProjectAdmin)]),
        lookups: lookups,
        referencesCheckedInProject: false,
      }),
    );

    expect(refusal).toBeInstanceOf(UnreadableReferenceException);
    expect(lookups.readCalls[0]?.ids).toEqual([MONITOR_B]);
  });

  test("a caller who reads no monitors but is blocked from a label of them is held to the block", async () => {
    withLabelJoinTables();
    const addBlockedLabels: ReturnType<typeof jest.spyOn> = jest.spyOn(
      ReadPermission,
      "addBlockedLabelsToQuery",
    );

    const lookups: Lookups = lookupsFinding({
      readable: [],
      inProject: [MONITOR_A],
    });

    const refusal: unknown = await refusalOf(
      check({
        modelType: Alert,
        data: { monitorId: MONITOR_B },
        props: member([
          everywhere(Permission.CreateAlert),
          everywhere(Permission.ReadAlert),
          blockedOnProduction(Permission.ReadProjectMonitor),
        ]),
        lookups: lookups,
      }),
    );

    expect(refusal).toBeInstanceOf(UnreadableReferenceException);
    // Looked up by OneUptime in the project, leaving out the blocked label's monitors.
    expect(lookups.readCalls).toEqual([]);
    expect(lookups.projectCalls[0]?.modelType).toBe(Monitor);
    expect(lookups.projectCalls[0]?.ids).toEqual([MONITOR_B]);
    expect(addBlockedLabels).toHaveBeenCalledWith(Monitor, expect.anything(), [
      productionLabelId,
    ]);
    expect(lookups.projectCalls[0]?.query).toBe(
      addBlockedLabels.mock.results[0]?.value,
    );

    // The monitor outside the label is named.
    await expect(
      check({
        modelType: Alert,
        data: { monitorId: MONITOR_A },
        props: member([
          everywhere(Permission.CreateAlert),
          blockedOnProduction(Permission.ReadProjectMonitor),
        ]),
        lookups: lookups,
      }),
    ).resolves.toBeUndefined();
  });

  test("a block with no labels on reading monitors takes every monitor away", async () => {
    const lookups: Lookups = lookupsFinding({ readable: [MONITOR_A] });

    const refusal: unknown = await refusalOf(
      check({
        modelType: Alert,
        data: { monitor: { _id: MONITOR_A } },
        props: member([
          everywhere(Permission.ProjectMember),
          row(Permission.ReadProjectMonitor, { isBlock: true }),
        ]),
        lookups: lookups,
      }),
    );

    expect(refusal).toBeInstanceOf(UnreadableReferenceException);
    expect((refusal as Error).message).toContain(`Monitor "${MONITOR_A}"`);
    expect(lookups.readCalls).toEqual([]);
    expect(lookups.projectCalls).toEqual([]);
  });

  test("a malformed id is refused unread", async () => {
    const lookups: Lookups = lookupsFinding({ readable: [MONITOR_A] });

    const refusal: unknown = await refusalOf(
      check({
        modelType: Alert,
        data: { monitorId: "not-a-monitor" },
        props: member(LABELLED_ALERT_CREATOR),
        lookups: lookups,
      }),
    );

    expect((refusal as Error).message).toContain(`Monitor "not-a-monitor"`);
    expect(lookups.readCalls).toEqual([]);
  });

  test("a clear, or no reference at all, asks nothing", async () => {
    const lookups: Lookups = lookupsFinding({ readable: [] });

    for (const data of [
      { monitorId: null },
      { monitor: null },
      { title: "Disk full" },
    ]) {
      await expect(
        check({
          modelType: Alert,
          data: data,
          props: member(LABELLED_ALERT_CREATOR),
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
      const lookups: Lookups = lookupsFinding({ readable: [] });

      await expect(
        check({
          modelType: Alert,
          data: { monitorId: MONITOR_B },
          props: props,
          lookups: lookups,
          referencesCheckedInProject: false,
        }),
      ).resolves.toBeUndefined();

      expect(lookups.readCalls).toEqual([]);
      expect(lookups.projectCalls).toEqual([]);
    }
  });

  test("a cost budget's service follows the services' read", async () => {
    const lookups: Lookups = lookupsFinding({ readable: [] });

    const refusal: unknown = await refusalOf(
      check({
        modelType: LlmCostBudget,
        data: { serviceId: SERVICE_A },
        props: member([
          everywhere(Permission.CreateProjectLlmCostBudget),
          everywhere(Permission.ReadProjectLlmCostBudget),
          onProduction(Permission.ReadService),
        ]),
        lookups: lookups,
      }),
    );

    expect((refusal as Error).message).toBe(
      `This llm cost budget references records that are not in this project: Service "${SERVICE_A}". Please pick values from this project and try again.`,
    );
    expect(lookups.readCalls[0]?.modelType).toBe(Service);
  });

  test("a status page resource's monitor follows the monitors' read", async () => {
    const lookups: Lookups = lookupsFinding({ readable: [MONITOR_A] });

    const refusal: unknown = await refusalOf(
      check({
        modelType: StatusPageResource,
        data: { monitorId: MONITOR_B },
        props: member([
          everywhere(Permission.CreateStatusPageResource),
          everywhere(Permission.ReadStatusPageResource),
          onProduction(Permission.ReadProjectMonitor),
        ]),
        lookups: lookups,
      }),
    );

    expect((refusal as Error).message).toBe(
      `This status page resource references records that are not in this project: Monitor "${MONITOR_B}". Please pick values from this project and try again.`,
    );
  });

  test("a run's incident follows the incidents' read", async () => {
    const incidentId: string = "0193c0de-eeee-4aaa-8bbb-00000000d001";
    const lookups: Lookups = lookupsFinding({ readable: [] });

    const refusal: unknown = await refusalOf(
      check({
        modelType: RunbookExecution,
        data: { incidentId: incidentId },
        props: member([
          everywhere(Permission.CreateRunbookExecution),
          onProduction(Permission.ReadProjectIncident),
        ]),
        lookups: lookups,
      }),
    );

    expect(refusal).toBeInstanceOf(UnreadableReferenceException);
    expect((refusal as Error).message).toContain(`Incident "${incidentId}"`);
    expect(lookups.readCalls[0]?.modelType).toBe(Incident);
  });
});

describe("an update that points a record at another one", () => {
  test("the record each row it writes names already is not asked about again", async () => {
    const lookups: Lookups = lookupsFinding({ readable: [] });

    await expect(
      check({
        modelType: Alert,
        data: { monitorId: MONITOR_B },
        props: member(LABELLED_ALERT_CREATOR),
        lookups: lookups,
        heldIdsByColumn: { monitor: [[MONITOR_B.toUpperCase()]] },
      }),
    ).resolves.toBeUndefined();

    expect(lookups.readCalls).toEqual([]);
  });

  test("another record is asked about", async () => {
    const lookups: Lookups = lookupsFinding({ readable: [MONITOR_A] });

    const refusal: unknown = await refusalOf(
      check({
        modelType: Alert,
        data: { monitor: { _id: MONITOR_B } },
        props: member(LABELLED_ALERT_CREATOR),
        lookups: lookups,
        heldIdsByColumn: { monitor: [[MONITOR_A]] },
      }),
    );

    expect(refusal).toBeInstanceOf(UnreadableReferenceException);
    expect(lookups.readCalls[0]?.ids).toEqual([MONITOR_B]);
  });

  test("a record one of the rows does not name yet is asked about", async () => {
    const refusal: unknown = await refusalOf(
      check({
        modelType: Alert,
        data: { monitorId: MONITOR_B },
        props: member(LABELLED_ALERT_CREATOR),
        lookups: lookupsFinding({ readable: [MONITOR_A] }),
        heldIdsByColumn: { monitor: [[MONITOR_B], []] },
      }),
    );

    expect(refusal).toBeInstanceOf(UnreadableReferenceException);
  });

  test("an update that writes no row, or clears the reference, asks nothing", async () => {
    const lookups: Lookups = lookupsFinding({ readable: [] });

    await expect(
      check({
        modelType: Alert,
        data: { monitorId: MONITOR_B },
        props: member(LABELLED_ALERT_CREATOR),
        lookups: lookups,
        heldIdsByColumn: { monitor: [] },
      }),
    ).resolves.toBeUndefined();

    await expect(
      check({
        modelType: Alert,
        data: { monitorId: null },
        props: member(LABELLED_ALERT_CREATOR),
        lookups: lookups,
        heldIdsByColumn: { monitor: [[MONITOR_A]] },
      }),
    ).resolves.toBeUndefined();

    expect(lookups.readCalls).toEqual([]);
  });
});

describe("the records every project may name", () => {
  // A caller whose read of probes leaves some out: a block with a label.
  const PROBE_EDITOR: Array<UserPermission> = [
    everywhere(Permission.CreateMonitorProbe),
    everywhere(Permission.ReadMonitorProbe),
    everywhere(Permission.ReadProjectMonitor),
    blockedOnProduction(Permission.ReadProjectProbe),
  ];

  test("a global probe is named by a caller whose read of the project's probes leaves it out", async () => {
    const lookups: Lookups = lookupsFinding({
      readable: [PROBE_A],
      shared: [GLOBAL_PROBE],
    });

    await expect(
      check({
        modelType: MonitorProbe,
        data: { probeId: GLOBAL_PROBE },
        props: member(PROBE_EDITOR),
        lookups: lookups,
      }),
    ).resolves.toBeUndefined();

    // Found by the query that finds OneUptime's global probes alone.
    expect(lookups.sharedCalls).toHaveLength(1);
    expect(lookups.sharedCalls[0]?.modelType).toBe(Probe);
    expect(lookups.sharedCalls[0]?.ids).toEqual([GLOBAL_PROBE]);
    expect(lookups.sharedCalls[0]?.query).toMatchObject({
      isGlobalProbe: true,
    });

    // A probe of the project the caller may read is named as before.
    await expect(
      check({
        modelType: MonitorProbe,
        data: { probeId: PROBE_A },
        props: member(PROBE_EDITOR),
        lookups: lookups,
      }),
    ).resolves.toBeUndefined();

    // And one that is neither is refused.
    const refusal: unknown = await refusalOf(
      check({
        modelType: MonitorProbe,
        data: { probeId: PROBE_B },
        props: member(PROBE_EDITOR),
        lookups: lookups,
      }),
    );

    expect((refusal as Error).message).toBe(
      `This monitor probe references records that are not in this project: Probe "${PROBE_B}". Please pick values from this project and try again.`,
    );
  });

  test("without a way to find them, a global probe is answered like any other", async () => {
    const refusal: unknown = await refusalOf(
      check({
        modelType: MonitorProbe,
        data: { probeId: GLOBAL_PROBE },
        props: member(PROBE_EDITOR),
        lookups: lookupsFinding({
          readable: [PROBE_A],
          shared: [GLOBAL_PROBE],
        }),
        withoutSharedFinder: true,
      }),
    );

    expect(refusal).toBeInstanceOf(UnreadableReferenceException);
  });

  test("a block with no labels on reading probes takes the global ones away too", async () => {
    const lookups: Lookups = lookupsFinding({
      readable: [PROBE_A],
      shared: [GLOBAL_PROBE],
    });

    const refusal: unknown = await refusalOf(
      check({
        modelType: MonitorProbe,
        data: { probeId: GLOBAL_PROBE },
        props: member([
          everywhere(Permission.CreateMonitorProbe),
          row(Permission.ReadProjectProbe, { isBlock: true }),
        ]),
        lookups: lookups,
      }),
    );

    expect(refusal).toBeInstanceOf(UnreadableReferenceException);
    expect(lookups.sharedCalls).toEqual([]);
    expect(lookups.readCalls).toEqual([]);
  });

  test("a global AI agent is named by its own query", async () => {
    const lookups: Lookups = lookupsFinding({
      readable: [],
      shared: [GLOBAL_AGENT],
    });

    await expect(
      check({
        modelType: AIAgentTaskPullRequest,
        data: { aiAgentId: GLOBAL_AGENT },
        props: member([everywhere(Permission.ProjectAdmin)]),
        lookups: lookups,
        referencesCheckedInProject: false,
      }),
    ).resolves.toBeUndefined();

    expect(lookups.sharedCalls[0]?.modelType).toBe(AIAgent);
    expect(lookups.sharedCalls[0]?.query).toMatchObject({
      isGlobalAIAgent: true,
    });
  });

  test("a model with no shared records is never looked up for them", async () => {
    const lookups: Lookups = lookupsFinding({
      readable: [],
      shared: [MONITOR_B],
    });

    const refusal: unknown = await refusalOf(
      check({
        modelType: Alert,
        data: { monitorId: MONITOR_B },
        props: member(LABELLED_ALERT_CREATOR),
        lookups: lookups,
      }),
    );

    expect(refusal).toBeInstanceOf(UnreadableReferenceException);
    expect(lookups.sharedCalls).toEqual([]);
  });

  test("an on-call policy is not a shared record", () => {
    expect(
      RelationListPermission.getSharedRecordQuery(OnCallDutyPolicy),
    ).toBeNull();
  });
});
