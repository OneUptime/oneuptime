import AlertOwnerTeam from "../../../Models/DatabaseModels/AlertOwnerTeam";
import AlertOwnerUser from "../../../Models/DatabaseModels/AlertOwnerUser";
import AlertStateTimeline from "../../../Models/DatabaseModels/AlertStateTimeline";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Semaphore from "../../../Server/Infrastructure/Semaphore";
import AlertOwnerTeamService from "../../../Server/Services/AlertOwnerTeamService";
import AlertOwnerUserService from "../../../Server/Services/AlertOwnerUserService";
import AlertStateTimelineService from "../../../Server/Services/AlertStateTimelineService";
import AuditLogService from "../../../Server/Services/AuditLogService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import Query from "../../../Server/Types/Database/Query";
import PublishedImages from "../../../Server/Utils/File/PublishedImages";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserGlobalAccessPermission,
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

/*
 * WHETHER A CALLER MAY CREATE A RECORD, ASKED WITHOUT CREATING IT
 * (DatabaseService.checkCallerMayCreate): every permission check a create of
 * the record runs, on the record as it would be written, without the
 * service's hooks or the write. OneUptime asks it before a write it makes
 * for a person - the alerts an incident is declared from, acknowledged as
 * the declarer (AlertStateChangeAuthorization) - so the person needs exactly
 * what creating the record themselves would need.
 *
 * Below, the check and a real create through the same service are asked the
 * same question, caller after caller, with the database's answers held in
 * memory: the two agree, refusal for refusal, in the same words. The record
 * is the one acknowledging an alert creates: an alert state timeline row,
 * read through its alert, owned through it, labelled by it.
 */

type PermissionInput = {
  permission: Permission;
  isBlockPermission?: boolean;
  labelIds?: Array<ObjectID>;
  scope?: PermissionScope;
};

type Outcome = { allowed: true } | { refusedWith: string; message: string };

const PROJECT_ID: ObjectID = ObjectID.generate();
const USER_ID: ObjectID = ObjectID.generate();
const TEAM_ID: ObjectID = ObjectID.generate();
const STATE_ID: ObjectID = ObjectID.generate();

const TEAM_A: ObjectID = ObjectID.generate();
const TEAM_B: ObjectID = ObjectID.generate();

// The project's alerts: their labels, who owns them, and whether the caller's read reaches them.
type StoredAlert = {
  labels: Array<ObjectID>;
  ownedByTeam: boolean;
  // Whether a read of alerts as the caller finds it (their labels, owners, privacy).
  readable: boolean;
};

const ALERT_A: ObjectID = ObjectID.generate();
const ALERT_B: ObjectID = ObjectID.generate();
const ALERT_OWNED: ObjectID = ObjectID.generate();
const ALERT_UNLABELLED: ObjectID = ObjectID.generate();

function key(id: ObjectID | string): string {
  return id.toString().toLowerCase();
}

// A service of the table with no hooks of its own: create() runs the checks and the write alone.
class PlainTimelineService extends DatabaseService<AlertStateTimeline> {
  public constructor() {
    super(AlertStateTimeline);
  }
}

function propsWith(
  permissions: Array<PermissionInput>,
  options?: { asApiKey?: boolean | undefined },
): DatabaseCommonInteractionProps {
  const rows: Array<UserPermission> = permissions.map(
    (input: PermissionInput): UserPermission => {
      const hasLabels: boolean = (input.labelIds || []).length > 0;

      return {
        _type: "UserPermission",
        permission: input.permission,
        isBlockPermission: input.isBlockPermission || false,
        labelIds: input.labelIds || [],
        scope:
          input.scope ||
          (hasLabels && !input.isBlockPermission
            ? PermissionScope.Labels
            : PermissionScope.All),
      };
    },
  );

  const tenant: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: rows,
  };

  const global: UserGlobalAccessPermission = {
    _type: "UserGlobalAccessPermission",
    globalPermissions: [
      Permission.Public,
      Permission.User,
      Permission.CurrentUser,
    ],
    projectIds: [PROJECT_ID],
  };

  const props: DatabaseCommonInteractionProps = {
    tenantId: PROJECT_ID,
    userTeamIds: [TEAM_ID],
    userGlobalAccessPermission: global,
    userTenantAccessPermission: { [PROJECT_ID.toString()]: tenant },
  };

  if (options?.asApiKey) {
    props.userType = UserType.API;
  } else {
    props.userId = USER_ID;
    props.userType = UserType.User;
  }

  return props;
}

// The row acknowledging `alertId` creates.
function stateChange(
  alertId: ObjectID,
  extra?: (row: AlertStateTimeline) => void,
): AlertStateTimeline {
  const row: AlertStateTimeline = new AlertStateTimeline();
  row.projectId = PROJECT_ID;
  row.alertId = alertId;
  row.alertStateId = STATE_ID;
  extra?.(row);
  return row;
}

async function outcomeOf(promise: Promise<unknown>): Promise<Outcome> {
  try {
    await promise;
    return { allowed: true };
  } catch (error) {
    return {
      refusedWith: (error as Error).constructor.name,
      message: (error as Error).message,
    };
  }
}

describe("DatabaseService.checkCallerMayCreate", () => {
  let alerts: Map<string, StoredAlert>;
  let parentReads: Array<{
    table: string;
    ids: Array<string>;
    props: DatabaseCommonInteractionProps;
  }>;
  let service: PlainTimelineService;
  let saves: Array<AlertStateTimeline>;

  beforeEach(() => {
    alerts = new Map<string, StoredAlert>([
      [key(ALERT_A), { labels: [TEAM_A], ownedByTeam: false, readable: true }],
      [key(ALERT_B), { labels: [TEAM_B], ownedByTeam: false, readable: true }],
      [key(ALERT_OWNED), { labels: [], ownedByTeam: true, readable: true }],
      [
        key(ALERT_UNLABELLED),
        { labels: [], ownedByTeam: false, readable: true },
      ],
    ]);
    parentReads = [];
    saves = [];

    service = new PlainTimelineService();

    jest.spyOn(service, "getRepository").mockReturnValue({
      save: async (row: AlertStateTimeline): Promise<AlertStateTimeline> => {
        saves.push(row);
        row.id = ObjectID.generate();
        return row;
      },
    } as never);
    jest
      .spyOn(service, "onTriggerWorkflow")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(service, "onTriggerRealtime")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(PublishedImages, "afterCreate")
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(AuditLogService, "recordCreate")
      .mockResolvedValue(undefined as never);

    // A read of records as the caller: the alerts their read reaches, and any other record asked about.
    jest
      .spyOn(
        DatabaseService as unknown as {
          findReadableParentIds: (data: {
            parentModelType: { new (): DatabaseBaseModel };
            ids: Array<string>;
            query: Query<DatabaseBaseModel>;
            props: DatabaseCommonInteractionProps;
          }) => Promise<Array<string>>;
        },
        "findReadableParentIds",
      )
      .mockImplementation(
        async (data: {
          parentModelType: { new (): DatabaseBaseModel };
          ids: Array<string>;
          props: DatabaseCommonInteractionProps;
        }): Promise<Array<string>> => {
          const table: string = new data.parentModelType().tableName || "";

          parentReads.push({ table, ids: [...data.ids], props: data.props });

          if (table !== "Alert") {
            return [...data.ids];
          }

          return data.ids.filter((id: string): boolean => {
            return Boolean(alerts.get(key(id))?.readable);
          });
        },
      );

    // Records read by OneUptime in the project: the project's alerts, and any other record asked about.
    jest
      .spyOn(
        DatabaseService as unknown as {
          findIdsInProject: (data: {
            modelType: { new (): DatabaseBaseModel };
            ids: Array<string>;
          }) => Promise<Array<string>>;
        },
        "findIdsInProject",
      )
      .mockImplementation(
        async (data: {
          modelType: { new (): DatabaseBaseModel };
          ids: Array<string>;
        }): Promise<Array<string>> => {
          if (new data.modelType().tableName !== "Alert") {
            return [...data.ids];
          }

          return data.ids.filter((id: string): boolean => {
            return alerts.has(key(id));
          });
        },
      );

    jest
      .spyOn(
        DatabaseService as unknown as {
          findRecordLabels: (data: {
            ids: Array<string>;
          }) => Promise<Record<string, Array<string>>>;
        },
        "findRecordLabels",
      )
      .mockImplementation(
        async (data: {
          ids: Array<string>;
        }): Promise<Record<string, Array<string>>> => {
          const labels: Record<string, Array<string>> = {};

          for (const id of data.ids) {
            labels[key(id)] = (alerts.get(key(id))?.labels || []).map(key);
          }

          return labels;
        },
      );

    jest
      .spyOn(
        DatabaseService as unknown as {
          findLabelNames: (data: {
            labelIds: Array<string>;
          }) => Promise<Array<string>>;
        },
        "findLabelNames",
      )
      .mockImplementation(
        async (data: { labelIds: Array<string> }): Promise<Array<string>> => {
          return data.labelIds.map((labelId: string): string => {
            return key(labelId) === key(TEAM_A)
              ? "team-a"
              : key(labelId) === key(TEAM_B)
                ? "team-b"
                : labelId;
          });
        },
      );

    // Who owns which alert: the caller's team owns one.
    jest
      .spyOn(AlertOwnerUserService, "findBy")
      .mockResolvedValue([] as Array<AlertOwnerUser>);
    jest
      .spyOn(AlertOwnerTeamService, "findBy")
      .mockImplementation((async (): Promise<Array<AlertOwnerTeam>> => {
        return Array.from(alerts.entries())
          .filter(([, alert]: [string, StoredAlert]): boolean => {
            return alert.ownedByTeam;
          })
          .map(([alertId]: [string, StoredAlert]): AlertOwnerTeam => {
            const owner: AlertOwnerTeam = new AlertOwnerTeam();
            owner.alertId = new ObjectID(alertId);
            owner.teamId = TEAM_ID;
            return owner;
          });
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  type ParityCase = {
    name: string;
    permissions: Array<PermissionInput>;
    alertId: ObjectID;
    asApiKey?: boolean;
    readable?: boolean;
    row?: (row: AlertStateTimeline) => void;
    expected: "allowed" | string;
  };

  const CASES: Array<ParityCase> = [
    {
      name: "a viewer",
      permissions: [{ permission: Permission.Viewer }],
      alertId: ALERT_A,
      expected: "NotAuthorizedException",
    },
    {
      name: "Edit Alert without Create Alert State Timeline",
      permissions: [
        { permission: Permission.EditAlert },
        { permission: Permission.ReadAlert },
      ],
      alertId: ALERT_A,
      expected: "NotAuthorizedException",
    },
    {
      name: "Create Alert State Timeline and Read Alert, no Edit Alert",
      permissions: [
        { permission: Permission.CreateAlertStateTimeline },
        { permission: Permission.ReadAlert },
      ],
      alertId: ALERT_A,
      expected: "allowed",
    },
    {
      name: "an API key with Create Alert State Timeline and Read Alert",
      permissions: [
        { permission: Permission.CreateAlertStateTimeline },
        { permission: Permission.ReadAlert },
      ],
      alertId: ALERT_A,
      asApiKey: true,
      expected: "allowed",
    },
    {
      name: "a project member blocked from editing alerts",
      permissions: [
        { permission: Permission.ProjectMember },
        { permission: Permission.EditAlert, isBlockPermission: true },
      ],
      alertId: ALERT_A,
      expected: "allowed",
    },
    {
      name: "a project member blocked from creating alert state timelines",
      permissions: [
        { permission: Permission.ProjectMember },
        {
          permission: Permission.CreateAlertStateTimeline,
          isBlockPermission: true,
        },
      ],
      alertId: ALERT_A,
      expected: "NotAuthorizedException",
    },
    {
      name: "a caller whose read of alerts does not reach the alert",
      permissions: [
        { permission: Permission.CreateAlertStateTimeline },
        { permission: Permission.ReadAlert, labelIds: [TEAM_A] },
      ],
      alertId: ALERT_B,
      readable: false,
      expected: "UnreadableParentException",
    },
    {
      name: "a viewer who may create alert state timelines for label A, on an alert carrying B",
      permissions: [
        { permission: Permission.Viewer },
        { permission: Permission.CreateAlertStateTimeline, labelIds: [TEAM_A] },
      ],
      alertId: ALERT_B,
      expected: "CreateScopeException",
    },
    {
      name: "a viewer who may create alert state timelines for label A, on an alert carrying A",
      permissions: [
        { permission: Permission.Viewer },
        { permission: Permission.CreateAlertStateTimeline, labelIds: [TEAM_A] },
      ],
      alertId: ALERT_A,
      expected: "allowed",
    },
    {
      name: "a viewer who may create alert state timelines for label A, on an unlabelled alert",
      permissions: [
        { permission: Permission.Viewer },
        { permission: Permission.CreateAlertStateTimeline, labelIds: [TEAM_A] },
      ],
      alertId: ALERT_UNLABELLED,
      expected: "CreateScopeException",
    },
    {
      name: "a project member blocked from creating them for label B, on an alert carrying B",
      permissions: [
        { permission: Permission.ProjectMember },
        {
          permission: Permission.CreateAlertStateTimeline,
          isBlockPermission: true,
          labelIds: [TEAM_B],
        },
      ],
      alertId: ALERT_B,
      expected: "CreateScopeException",
    },
    {
      name: "a viewer who may create them for owned alerts, on one their team owns",
      permissions: [
        { permission: Permission.Viewer },
        {
          permission: Permission.CreateAlertStateTimeline,
          scope: PermissionScope.Owned,
        },
      ],
      alertId: ALERT_OWNED,
      expected: "allowed",
    },
    {
      name: "a viewer who may create them for owned alerts, on one nobody they know owns",
      permissions: [
        { permission: Permission.Viewer },
        {
          permission: Permission.CreateAlertStateTimeline,
          scope: PermissionScope.Owned,
        },
      ],
      alertId: ALERT_A,
      expected: "CreateScopeException",
    },
    {
      name: "an alert member limited to label A, for reading and creating, on an alert carrying A",
      permissions: [{ permission: Permission.AlertMember, labelIds: [TEAM_A] }],
      alertId: ALERT_A,
      expected: "allowed",
    },
    {
      name: "a project member on a private alert their read leaves out",
      permissions: [{ permission: Permission.ProjectMember }],
      alertId: ALERT_B,
      readable: false,
      expected: "UnreadableParentException",
    },
    {
      // A computed column is let through on create, by both.
      name: "a project member sending a column OneUptime computes (isOwnerNotified)",
      permissions: [{ permission: Permission.ProjectMember }],
      alertId: ALERT_A,
      row: (row: AlertStateTimeline): void => {
        row.isOwnerNotified = true;
      },
      expected: "allowed",
    },
  ];

  test.each(CASES)(
    "$name: the check and the create agree",
    async (data: ParityCase) => {
      if (data.readable === false) {
        alerts.get(key(data.alertId))!.readable = false;
      }

      const props: () => DatabaseCommonInteractionProps =
        (): DatabaseCommonInteractionProps => {
          return propsWith(data.permissions, { asApiKey: data.asApiKey });
        };

      const viaCheck: Outcome = await outcomeOf(
        service.checkCallerMayCreate({
          data: stateChange(data.alertId, data.row),
          props: props(),
        }),
      );

      // The check wrote nothing.
      expect(saves).toEqual([]);

      const viaCreate: Outcome = await outcomeOf(
        service.create({
          data: stateChange(data.alertId, data.row),
          props: props(),
        }),
      );

      expect(viaCheck).toEqual(viaCreate);

      if (data.expected === "allowed") {
        expect(viaCheck).toEqual({ allowed: true });
        expect(saves).toHaveLength(1);
      } else {
        expect(viaCheck).toMatchObject({ refusedWith: data.expected });
        expect(saves).toEqual([]);
      }
    },
  );

  test("a caller with no credentials is answered with the 401 a create gives, and nothing is read", async () => {
    const viaCheck: Outcome = await outcomeOf(
      service.checkCallerMayCreate({
        data: stateChange(ALERT_A),
        props: { tenantId: PROJECT_ID },
      }),
    );
    const viaCreate: Outcome = await outcomeOf(
      service.create({
        data: stateChange(ALERT_A),
        props: { tenantId: PROJECT_ID },
      }),
    );

    expect(viaCheck).toMatchObject({
      refusedWith: "NotAuthenticatedException",
    });
    expect(viaCheck).toEqual(viaCreate);
    expect(parentReads).toEqual([]);
  });

  test("root and a master admin pass without a read", async () => {
    await expect(
      service.checkCallerMayCreate({
        data: stateChange(ALERT_A),
        props: { isRoot: true },
      }),
    ).resolves.toBeUndefined();
    await expect(
      service.checkCallerMayCreate({
        data: stateChange(ALERT_A),
        props: { ...propsWith([]), isMasterAdmin: true },
      }),
    ).resolves.toBeUndefined();

    expect(parentReads).toEqual([]);
  });

  test("it runs none of the service's hooks", async () => {
    const hooks: Array<string> = [];

    for (const hook of [
      "onBeforeCreate",
      "onCreatePermitted",
      "onCreateSuccess",
      "onCreateError",
    ]) {
      jest
        .spyOn(service as never, hook as never)
        .mockImplementation((async (): Promise<never> => {
          hooks.push(hook);
          throw new Error(`${hook} must not run`);
        }) as never);
    }

    await expect(
      service.checkCallerMayCreate({
        data: stateChange(ALERT_A),
        props: propsWith([{ permission: Permission.ProjectMember }]),
      }),
    ).resolves.toBeUndefined();

    expect(hooks).toEqual([]);
    expect(saves).toEqual([]);
  });

  test("it leaves the caller's props as they were, and stamps the request's project on the record, as a create does", async () => {
    const props: DatabaseCommonInteractionProps = propsWith([
      { permission: Permission.ProjectMember },
    ]);
    const row: AlertStateTimeline = stateChange(ALERT_A);
    delete row.projectId;

    await service.checkCallerMayCreate({ data: row, props: props });

    expect(props.ignoreHooks).toBeUndefined();
    expect(key(row.projectId!)).toBe(key(PROJECT_ID));
  });

  describe("on a service whose hooks hold the records a create names to its project", () => {
    /*
     * AlertStateTimelineService checks every reference a create names in its
     * own hooks (ProjectReferencesService), so its create looks no parent up
     * for a caller whose read reaches every alert. The check runs no hook, so
     * it looks the alert up itself - and runs none of the timeline's own
     * work: no lock, no read of the timeline.
     */
    test("the alert is looked up, as the caller, even for a project member", async () => {
      const lock: ReturnType<typeof jest.spyOn> = jest.spyOn(Semaphore, "lock");
      const timelineReads: ReturnType<typeof jest.spyOn> = jest.spyOn(
        AlertStateTimelineService,
        "findOneBy",
      );

      await expect(
        AlertStateTimelineService.checkCallerMayCreate({
          data: stateChange(ALERT_A),
          props: propsWith([{ permission: Permission.ProjectMember }]),
        }),
      ).resolves.toBeUndefined();

      const alertReads: Array<{ ids: Array<string> }> = parentReads.filter(
        (read: { table: string }): boolean => {
          return read.table === "Alert";
        },
      );

      expect(alertReads).toHaveLength(1);
      expect(alertReads[0]!.ids.map(key)).toEqual([key(ALERT_A)]);
      expect(lock).not.toHaveBeenCalled();
      expect(timelineReads).not.toHaveBeenCalled();
    });

    test("an alert the project does not have is refused as if it did not exist", async () => {
      const elsewhere: ObjectID = ObjectID.generate();

      const outcome: Outcome = await outcomeOf(
        AlertStateTimelineService.checkCallerMayCreate({
          data: stateChange(elsewhere),
          props: propsWith([{ permission: Permission.ProjectMember }]),
        }),
      );

      expect(outcome).toMatchObject({
        refusedWith: "UnreadableParentException",
      });
      expect((outcome as { message: string }).message).toContain(
        elsewhere.toString(),
      );
    });
  });

  test("the hooks a create runs are handed what the check never is: an OnCreate", async () => {
    // The check's signature takes the record and the caller; nothing a hook could key a lock by.
    const asked: Parameters<typeof service.checkCallerMayCreate>[0] = {
      data: stateChange(ALERT_A),
      props: { isRoot: true },
    };

    const keys: Array<string> = Object.keys(asked).sort();

    expect(keys).toEqual(["data", "props"]);

    const createBy: CreateBy<AlertStateTimeline> = asked;
    const onCreate: OnCreate<AlertStateTimeline> = {
      createBy: createBy,
      carryForward: null,
    };

    expect(onCreate.createBy).toBe(asked);
  });
});
