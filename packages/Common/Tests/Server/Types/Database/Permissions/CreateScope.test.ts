import CreateScopeException from "../../../../../Server/Types/Database/Permissions/CreateScopeException";
import CreateScopePermission, {
  LabelNamesFinder,
  RecordLabelsFinder,
} from "../../../../../Server/Types/Database/Permissions/CreateScopePermission";
import ModelPermission from "../../../../../Server/Types/Database/Permissions/Index";
import OwnedScopePermission from "../../../../../Server/Types/Database/Permissions/OwnedScopePermission";
import BaseModel from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Host from "../../../../../Models/DatabaseModels/Host";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import IncidentInternalNote from "../../../../../Models/DatabaseModels/IncidentInternalNote";
import IncidentSeverity from "../../../../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../../Models/DatabaseModels/Monitor";
import MonitorOwnerUser from "../../../../../Models/DatabaseModels/MonitorOwnerUser";
import StatusPage from "../../../../../Models/DatabaseModels/StatusPage";
import StatusPageAnnouncement from "../../../../../Models/DatabaseModels/StatusPageAnnouncement";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../../../Types/Database/AccessControl/PermissionScope";
import NotAuthorizedException from "../../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../../Types/Permission";
import UserType from "../../../../../Types/UserType";
import { ON_HIGHEST_PLAN } from "../../../TestingUtils/RequestPlan";
import { getJestSpyOn } from "../../../../Spy";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../../../Server/Utils/Logger");

/*
 * A CREATE MAKES ONLY A RECORD THE CALLER'S CREATE PERMISSION REACHES
 * (CreateScopePermission).
 *
 * A permission limited to labels makes a record carrying one of them - by
 * its own labels, or by the labelled records it names - unless another
 * permission to create it reaches the whole project. One limited to owned
 * records makes a record its creator will own: one with owners of its own
 * (the creator becomes one), or one owned through a parent they own. A
 * block with labels refuses a record carrying one.
 */

const projectId: ObjectID = new ObjectID(
  "0193c0de-eeee-4aaa-8bbb-000000000001",
);
const PRODUCTION: string = "0193c0de-eeee-4aaa-8bbb-0000000000a1";
const STAGING: string = "0193c0de-eeee-4aaa-8bbb-0000000000a2";

const INCIDENT_ID: string = "0193c0de-eeee-4aaa-8bbb-00000000c001";
const MONITOR_ID: string = "0193c0de-eeee-4aaa-8bbb-00000000b001";
const PAGE_A: string = "0193c0de-eeee-4aaa-8bbb-00000000d001";
const PAGE_B: string = "0193c0de-eeee-4aaa-8bbb-00000000d002";

const row: (
  permission: Permission,
  data?: {
    labelIds?: Array<string>;
    isBlock?: boolean;
    scope?: PermissionScope;
  },
) => UserPermission = (
  permission: Permission,
  data?: {
    labelIds?: Array<string>;
    isBlock?: boolean;
    scope?: PermissionScope;
  },
): UserPermission => {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: (data?.labelIds || []).map((id: string): ObjectID => {
      return new ObjectID(id);
    }),
    isBlockPermission: Boolean(data?.isBlock),
    scope:
      data?.scope ||
      (data?.labelIds && data.labelIds.length > 0 && !data.isBlock
        ? PermissionScope.Labels
        : PermissionScope.All),
  };
};

const on: (
  permission: Permission,
  labelIds: Array<string>,
) => UserPermission = (
  permission: Permission,
  labelIds: Array<string>,
): UserPermission => {
  return row(permission, { labelIds: labelIds });
};

const everywhere: (permission: Permission) => UserPermission = (
  permission: Permission,
): UserPermission => {
  return row(permission);
};

const owned: (permission: Permission) => UserPermission = (
  permission: Permission,
): UserPermission => {
  return row(permission, { scope: PermissionScope.Owned });
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

// The labels of the records a new record names, and what was asked.
interface Lookups {
  findRecordLabels: RecordLabelsFinder;
  findLabelNames: LabelNamesFinder;
  labelCalls: Array<{ modelType: { new (): BaseModel }; ids: Array<string> }>;
  nameCalls: Array<Array<string>>;
}

const lookupsWith: (
  labelsByRecord?: Record<string, Array<string>>,
) => Lookups = (labelsByRecord: Record<string, Array<string>> = {}): Lookups => {
  const lookups: Lookups = {
    labelCalls: [],
    nameCalls: [],
    findRecordLabels: async (data: {
      modelType: { new (): BaseModel };
      ids: Array<string>;
    }): Promise<Record<string, Array<string>>> => {
      lookups.labelCalls.push({ modelType: data.modelType, ids: data.ids });
      const labels: Record<string, Array<string>> = {};

      for (const id of data.ids) {
        if (labelsByRecord[id]) {
          labels[id] = labelsByRecord[id]!;
        }
      }

      return labels;
    },
    findLabelNames: async (data: {
      labelIds: Array<string>;
    }): Promise<Array<string>> => {
      lookups.nameCalls.push(data.labelIds);
      return data.labelIds.map((labelId: string): string => {
        return labelId === PRODUCTION
          ? "Production"
          : labelId === STAGING
            ? "Staging"
            : labelId;
      });
    },
  };

  return lookups;
};

const check: <TBaseModel extends BaseModel>(data: {
  modelType: { new (): TBaseModel };
  data: TBaseModel;
  props: DatabaseCommonInteractionProps;
  lookups?: Lookups;
}) => Promise<void> = async <TBaseModel extends BaseModel>(data: {
  modelType: { new (): TBaseModel };
  data: TBaseModel;
  props: DatabaseCommonInteractionProps;
  lookups?: Lookups;
}): Promise<void> => {
  const lookups: Lookups = data.lookups || lookupsWith();

  await ModelPermission.checkCreateScopePermission({
    modelType: data.modelType,
    data: data.data,
    props: data.props,
    findRecordLabels: lookups.findRecordLabels,
    findLabelNames: lookups.findLabelNames,
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

const monitorWith: (labelIds: Array<string>) => Monitor = (
  labelIds: Array<string>,
): Monitor => {
  const monitor: Monitor = new Monitor();
  monitor.name = "Checkout API";
  monitor.labels = labelIds.map((labelId: string): Label => {
    const label: Label = new Label();
    label._id = labelId;
    return label;
  });
  return monitor;
};

const noteOn: (incidentId: string | null) => IncidentInternalNote = (
  incidentId: string | null,
): IncidentInternalNote => {
  const note: IncidentInternalNote = new IncidentInternalNote();
  note.note = "Rolled back";

  if (incidentId) {
    note.incidentId = new ObjectID(incidentId);
  }

  return note;
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a create permission limited to labels", () => {
  test.each([
    ["a team member", member([on(Permission.CreateProjectMonitor, [PRODUCTION])])],
    ["an API key", apiKey([on(Permission.CreateProjectMonitor, [PRODUCTION])])],
  ])(
    "%s creates a record carrying one of its labels, and no other",
    async (_name: string, props: DatabaseCommonInteractionProps) => {
      await expect(
        check({
          modelType: Monitor,
          data: monitorWith([PRODUCTION]),
          props: props,
        }),
      ).resolves.toBeUndefined();

      // Carrying another label beside it is still carrying one of them.
      await expect(
        check({
          modelType: Monitor,
          data: monitorWith([STAGING, PRODUCTION]),
          props: props,
        }),
      ).resolves.toBeUndefined();

      for (const labels of [[], [STAGING]]) {
        const lookups: Lookups = lookupsWith();

        const refusal: unknown = await refusalOf(
          check({
            modelType: Monitor,
            data: monitorWith(labels),
            props: props,
            lookups: lookups,
          }),
        );

        expect(refusal).toBeInstanceOf(CreateScopeException);
        expect(refusal).toBeInstanceOf(NotAuthorizedException);
        expect((refusal as Error).message).toBe(
          "Your access lets you create Monitors only with one of these labels: Production. Add one of them and try again.",
        );
        // The labels the permission allows, named.
        expect(lookups.nameCalls).toEqual([[PRODUCTION]]);
      }
    },
  );

  test("the labels of every permission limited to labels are allowed", async () => {
    const props: DatabaseCommonInteractionProps = member([
      on(Permission.CreateProjectMonitor, [PRODUCTION]),
      on(Permission.MonitorMember, [STAGING]),
    ]);

    for (const labels of [[PRODUCTION], [STAGING]]) {
      await expect(
        check({ modelType: Monitor, data: monitorWith(labels), props: props }),
      ).resolves.toBeUndefined();
    }

    const refusal: unknown = await refusalOf(
      check({ modelType: Monitor, data: monitorWith([]), props: props }),
    );

    expect((refusal as Error).message).toBe(
      "Your access lets you create Monitors only with one of these labels: Production, Staging. Add one of them and try again.",
    );
  });

  test("one permission over the whole project lets every record through", async () => {
    for (const rows of [
      [
        on(Permission.CreateProjectMonitor, [PRODUCTION]),
        everywhere(Permission.MonitorMember),
      ],
      [everywhere(Permission.ProjectAdmin)],
      [everywhere(Permission.CreateProjectMonitor)],
      // A role that cannot be scoped reaches the whole project.
      [owned(Permission.ProjectOwner)],
    ]) {
      const lookups: Lookups = lookupsWith();

      await expect(
        check({
          modelType: Monitor,
          data: monitorWith([]),
          props: member(rows),
          lookups: lookups,
        }),
      ).resolves.toBeUndefined();

      expect(lookups.labelCalls).toEqual([]);
      expect(lookups.nameCalls).toEqual([]);
    }
  });

  test("the operational resources' wildcard limited to labels limits a create the same way", async () => {
    const props: DatabaseCommonInteractionProps = member([
      on(Permission.CreateAllOperationalResources, [PRODUCTION]),
    ]);

    await expect(
      check({ modelType: Monitor, data: monitorWith([PRODUCTION]), props }),
    ).resolves.toBeUndefined();

    await expect(
      check({ modelType: Monitor, data: monitorWith([]), props }),
    ).rejects.toThrow(CreateScopeException);
  });

  describe("on a record that carries the labels of what it names", () => {
    const NOTE_WRITER: Array<UserPermission> = [
      on(Permission.CreateIncidentInternalNote, [PRODUCTION]),
    ];

    test("a note on an incident carrying the label", async () => {
      const lookups: Lookups = lookupsWith({ [INCIDENT_ID]: [PRODUCTION] });

      await expect(
        check({
          modelType: IncidentInternalNote,
          data: noteOn(INCIDENT_ID),
          props: member(NOTE_WRITER),
          lookups: lookups,
        }),
      ).resolves.toBeUndefined();

      // The incident's labels, read by OneUptime.
      expect(lookups.labelCalls).toEqual([
        { modelType: Incident, ids: [INCIDENT_ID] },
      ]);
    });

    test("a note on an incident without it is refused, naming the labels", async () => {
      const lookups: Lookups = lookupsWith({ [INCIDENT_ID]: [STAGING] });

      const refusal: unknown = await refusalOf(
        check({
          modelType: IncidentInternalNote,
          data: noteOn(INCIDENT_ID),
          props: member(NOTE_WRITER),
          lookups: lookups,
        }),
      );

      expect(refusal).toBeInstanceOf(CreateScopeException);
      expect((refusal as Error).message).toBe(
        "Your access lets you create Incident Internal Notes only for records with one of these labels: Production.",
      );
    });

    test("an announcement through the status pages it is shown on, any one of them", async () => {
      const lookups: Lookups = lookupsWith({
        [PAGE_A]: [STAGING],
        [PAGE_B]: [PRODUCTION],
      });

      const announcement: StatusPageAnnouncement = new StatusPageAnnouncement();
      announcement.title = "Maintenance";
      (announcement as unknown as Record<string, unknown>)["statusPages"] = [
        { _id: PAGE_A },
        { _id: PAGE_B },
      ];

      await expect(
        check({
          modelType: StatusPageAnnouncement,
          data: announcement,
          props: member([
            on(Permission.CreateStatusPageAnnouncement, [PRODUCTION]),
          ]),
          lookups: lookups,
        }),
      ).resolves.toBeUndefined();

      expect(lookups.labelCalls).toEqual([
        { modelType: StatusPage, ids: [PAGE_A, PAGE_B] },
      ]);
    });

    test("an owner row of a monitor, through the monitor it names", async () => {
      const lookups: Lookups = lookupsWith({ [MONITOR_ID]: [STAGING] });
      const owner: MonitorOwnerUser = new MonitorOwnerUser();
      owner.monitorId = new ObjectID(MONITOR_ID);
      owner.userId = ObjectID.generate();

      await expect(
        check({
          modelType: MonitorOwnerUser,
          data: owner,
          props: member([on(Permission.CreateMonitorOwnerUser, [PRODUCTION])]),
          lookups: lookups,
        }),
      ).rejects.toThrow(CreateScopeException);
    });

    test("a record that names no labelled record is about none of them, as a read takes it", async () => {
      const lookups: Lookups = lookupsWith();

      const severity: IncidentSeverity = new IncidentSeverity();
      severity.name = "Critical";

      await expect(
        check({
          modelType: IncidentSeverity,
          data: severity,
          props: member([
            on(Permission.CreateIncidentSeverity, [PRODUCTION]),
          ]),
          lookups: lookups,
        }),
      ).resolves.toBeUndefined();

      expect(lookups.labelCalls).toEqual([]);
    });

    test("a record that names one that does not exist names one carrying none", async () => {
      const refusal: unknown = await refusalOf(
        check({
          modelType: IncidentInternalNote,
          data: noteOn(INCIDENT_ID),
          props: member(NOTE_WRITER),
          lookups: lookupsWith({}),
        }),
      );

      expect(refusal).toBeInstanceOf(CreateScopeException);
    });
  });
});

describe("a block with labels on creating", () => {
  test("refuses a record carrying a blocked label, naming it", async () => {
    const props: DatabaseCommonInteractionProps = member([
      everywhere(Permission.CreateProjectMonitor),
      row(Permission.CreateProjectMonitor, {
        isBlock: true,
        labelIds: [STAGING],
      }),
    ]);

    await expect(
      check({ modelType: Monitor, data: monitorWith([PRODUCTION]), props }),
    ).resolves.toBeUndefined();

    const refusal: unknown = await refusalOf(
      check({
        modelType: Monitor,
        data: monitorWith([PRODUCTION, STAGING]),
        props,
      }),
    );

    expect(refusal).toBeInstanceOf(CreateScopeException);
    expect((refusal as Error).message).toBe(
      `You are not authorized to create this Monitor because ${Permission.CreateProjectMonitor} is in your team's permission block list for the label "Staging".`,
    );
  });

  test("refuses a record naming a record carrying a blocked label", async () => {
    const refusal: unknown = await refusalOf(
      check({
        modelType: IncidentInternalNote,
        data: noteOn(INCIDENT_ID),
        props: member([
          everywhere(Permission.CreateIncidentInternalNote),
          row(Permission.CreateIncidentInternalNote, {
            isBlock: true,
            labelIds: [STAGING],
          }),
        ]),
        lookups: lookupsWith({ [INCIDENT_ID]: [STAGING] }),
      }),
    );

    expect(refusal).toBeInstanceOf(CreateScopeException);
  });
});

describe("a create permission limited to owned records", () => {
  test("a person creates a record with owners of its own: they become its owner", async () => {
    for (const modelType of [Monitor, Host]) {
      await expect(
        check({
          modelType: modelType as { new (): BaseModel },
          data: new modelType(),
          props: member([
            owned(
              modelType === Monitor
                ? Permission.CreateProjectMonitor
                : Permission.CreateHost,
            ),
          ]),
        }),
      ).resolves.toBeUndefined();
    }
  });

  test("an API key, which owns nothing, does not", async () => {
    const refusal: unknown = await refusalOf(
      check({
        modelType: Monitor,
        data: monitorWith([]),
        props: apiKey([owned(Permission.CreateProjectMonitor)]),
      }),
    );

    expect(refusal).toBeInstanceOf(CreateScopeException);
    expect((refusal as Error).message).toBe(
      "Your access lets you create only the Monitors you own, and only a person can own one.",
    );
  });

  test("a record owned through a parent goes only on a parent the caller or their teams own", async () => {
    const ownedIds: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      OwnedScopePermission,
      "getOwnedIds",
    ).mockResolvedValue([new ObjectID(INCIDENT_ID)] as never);

    const props: DatabaseCommonInteractionProps = member([
      owned(Permission.CreateIncidentInternalNote),
    ]);

    await expect(
      check({
        modelType: IncidentInternalNote,
        data: noteOn(INCIDENT_ID),
        props: props,
      }),
    ).resolves.toBeUndefined();

    expect(ownedIds).toHaveBeenCalledWith(IncidentInternalNote, props);

    const refusal: unknown = await refusalOf(
      check({
        modelType: IncidentInternalNote,
        data: noteOn("0193c0de-eeee-4aaa-8bbb-00000000c009"),
        props: props,
      }),
    );

    expect(refusal).toBeInstanceOf(CreateScopeException);
    expect((refusal as Error).message).toBe(
      "Your access lets you create Incident Internal Notes only for the Incidents you or your teams own.",
    );

    // And none at all, on no parent.
    await expect(
      check({
        modelType: IncidentInternalNote,
        data: noteOn(null),
        props: props,
      }),
    ).rejects.toThrow(CreateScopeException);
  });

  test("a permission limited to labels beside it is the one that decides, as on a read", async () => {
    const props: DatabaseCommonInteractionProps = apiKey([
      owned(Permission.CreateProjectMonitor),
      on(Permission.MonitorMember, [PRODUCTION]),
    ]);

    await expect(
      check({ modelType: Monitor, data: monitorWith([PRODUCTION]), props }),
    ).resolves.toBeUndefined();

    await expect(
      check({ modelType: Monitor, data: monitorWith([]), props }),
    ).rejects.toThrow(
      "Your access lets you create Monitors only with one of these labels: Production.",
    );
  });

  test("on a model the Owned scope does not narrow, it narrows no create either", async () => {
    await expect(
      check({
        modelType: IncidentSeverity,
        data: new IncidentSeverity(),
        props: apiKey([owned(Permission.CreateIncidentSeverity)]),
      }),
    ).resolves.toBeUndefined();
  });
});

describe("what is asked", () => {
  test("OneUptime's own creates are not asked", async () => {
    for (const props of [
      { isRoot: true },
      { isRoot: true, tenantId: projectId },
      { isMasterAdmin: true },
    ] as Array<DatabaseCommonInteractionProps>) {
      await expect(
        check({ modelType: Monitor, data: monitorWith([]), props }),
      ).resolves.toBeUndefined();
    }
  });

  test("the scope a caller's create permissions give, read as the record rule reads them", () => {
    expect(
      CreateScopePermission.getCreateScope(
        Monitor,
        member([on(Permission.CreateProjectMonitor, [PRODUCTION])]),
      ),
    ).toMatchObject({
      isProjectWide: false,
      grantedLabelIds: [PRODUCTION],
      isOwnedOnly: false,
    });

    expect(
      CreateScopePermission.getCreateScope(
        Monitor,
        member([owned(Permission.CreateProjectMonitor)]),
      ),
    ).toMatchObject({
      isProjectWide: false,
      grantedLabelIds: [],
      isOwnedOnly: true,
    });

    expect(
      CreateScopePermission.getCreateScope(
        Monitor,
        member([everywhere(Permission.MonitorAdmin)]),
      ),
    ).toMatchObject({
      isProjectWide: true,
      grantedLabelIds: [],
      isOwnedOnly: false,
      labelledBlocks: [],
    });

    // A block on another permission takes nothing away from this create.
    expect(
      CreateScopePermission.getCreateScope(
        Monitor,
        member([
          everywhere(Permission.MonitorAdmin),
          row(Permission.ReadProjectMonitor, {
            isBlock: true,
            labelIds: [STAGING],
          }),
        ]),
      ).labelledBlocks,
    ).toEqual([]);
  });

  test("the labels a record carries: its own, or none named", async () => {
    await expect(
      CreateScopePermission.getRecordLabelIds({
        modelType: Monitor,
        data: monitorWith([PRODUCTION.toUpperCase()]),
        props: member([]),
        findRecordLabels: lookupsWith().findRecordLabels,
      }),
    ).resolves.toEqual(new Set<string>([PRODUCTION]));

    await expect(
      CreateScopePermission.getRecordLabelIds({
        modelType: IncidentSeverity,
        data: new IncidentSeverity(),
        props: member([]),
        findRecordLabels: lookupsWith().findRecordLabels,
      }),
    ).resolves.toBeNull();
  });
});
