import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import { FindOperator } from "typeorm";
import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertOwnerTeam from "../../../../Models/DatabaseModels/AlertOwnerTeam";
import AlertOwnerUser from "../../../../Models/DatabaseModels/AlertOwnerUser";
import AlertStateTimeline from "../../../../Models/DatabaseModels/AlertStateTimeline";
import DatabaseBaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AlertOwnerTeamService from "../../../../Server/Services/AlertOwnerTeamService";
import AlertOwnerUserService from "../../../../Server/Services/AlertOwnerUserService";
import AlertService from "../../../../Server/Services/AlertService";
import AlertStateTimelineService from "../../../../Server/Services/AlertStateTimelineService";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import CreateScopeException from "../../../../Server/Types/Database/Permissions/CreateScopeException";
import Query from "../../../../Server/Types/Database/Query";
import AlertStateChangeAuthorization from "../../../../Server/Utils/Alert/AlertStateChangeAuthorization";
import { UnreadableParentException } from "../../../../Server/Utils/Database/ProjectScopedReferenceRefusal";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../../Types/Database/AccessControl/PermissionScope";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserGlobalAccessPermission,
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import UserType from "../../../../Types/UserType";

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../../Server/Utils/Logger");

/*
 * AlertStateChangeAuthorization decides whether a caller may change the state
 * of a set of alerts that are then acknowledged for them as root (declaring an
 * incident with "acknowledge these alerts" ticked). Changing one alert's state
 * on its own page is one write as the caller - a new AlertStateTimeline row -
 * and the alert then takes the state from OneUptime itself. So the helper asks,
 * for every alert, exactly what creating that row as the caller asks
 * (AlertStateTimelineService.checkCallerMayCreate): the declare form needs what
 * acknowledging each alert on its own page needs, and no Edit Alert.
 *
 * Most tests below run the REAL permission layer (ModelPermission and
 * everything under it) against realistic interaction props. Only the reads the
 * layer makes of the database are answered here, the way the database would
 * answer them, and each test pins what was asked:
 *
 *   - the read of the alerts as the caller (DatabaseService
 *     .findReadableParentIds): answered with the alerts the caller's read of
 *     alerts reaches - every one unless a test says otherwise;
 *   - the labels the alerts carry and the labels' names (findRecordLabels,
 *     findLabelNames), read by OneUptime for a create permission limited to
 *     labels or a block with labels;
 *   - the alerts the caller or their teams own (AlertOwnerUserService,
 *     AlertOwnerTeamService), for a create permission limited to owned
 *     records.
 */

type PermissionInput = {
  permission: Permission;
  isBlockPermission?: boolean;
  labelIds?: Array<ObjectID>;
  scope?: PermissionScope;
};

type ParentLookup = {
  table: string;
  ids: Array<string>;
  query: Query<DatabaseBaseModel>;
  props: DatabaseCommonInteractionProps;
};

type RecordLookup = {
  table: string;
  ids: Array<string>;
};

type WriteSpies = {
  alertCreate: SpyInstance<typeof AlertService.create>;
  alertUpdateOneById: SpyInstance<typeof AlertService.updateOneById>;
  alertUpdateBy: SpyInstance<typeof AlertService.updateBy>;
  alertChangeState: SpyInstance<typeof AlertService.changeAlertState>;
  alertAcknowledge: SpyInstance<typeof AlertService.acknowledgeAlert>;
  timelineCreate: SpyInstance<typeof AlertStateTimelineService.create>;
};

type CheckCallerMayCreate =
  typeof AlertStateTimelineService.checkCallerMayCreate;

const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();
const acknowledgedStateId: ObjectID = ObjectID.generate();

const TEAM_A: ObjectID = ObjectID.generate();
const TEAM_B: ObjectID = ObjectID.generate();
const LABEL_NAMES: Record<string, string> = {
  [TEAM_A.toString().toLowerCase()]: "team-a",
  [TEAM_B.toString().toLowerCase()]: "team-b",
};

function createDatabaseProps(
  permissions: Array<PermissionInput>,
  options?: {
    userTeamIds?: Array<ObjectID>;
    withoutUser?: boolean;
  },
): DatabaseCommonInteractionProps {
  const userPermissions: Array<UserPermission> = permissions.map(
    (permissionInput: PermissionInput): UserPermission => {
      const hasLabels: boolean = (permissionInput.labelIds || []).length > 0;

      return {
        _type: "UserPermission",
        permission: permissionInput.permission,
        isBlockPermission: permissionInput.isBlockPermission || false,
        labelIds: permissionInput.labelIds || [],
        scope:
          permissionInput.scope ||
          (hasLabels && !permissionInput.isBlockPermission
            ? PermissionScope.Labels
            : PermissionScope.All),
      };
    },
  );

  const tenantAccessPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId,
    permissions: userPermissions,
  };

  const globalAccessPermission: UserGlobalAccessPermission = {
    _type: "UserGlobalAccessPermission",
    globalPermissions: [
      Permission.Public,
      Permission.User,
      Permission.CurrentUser,
    ],
    projectIds: [projectId],
  };

  const props: DatabaseCommonInteractionProps = {
    tenantId: projectId,
    userTeamIds: options?.userTeamIds || [],
    userGlobalAccessPermission: globalAccessPermission,
    userTenantAccessPermission: {
      [projectId.toString()]: tenantAccessPermission,
    },
  };

  if (options?.withoutUser) {
    props.userType = UserType.API;
  } else {
    props.userId = userId;
    props.userType = UserType.User;
  }

  return props;
}

function toKey(id: ObjectID | string): string {
  return id.toString().toLowerCase();
}

function spyOnWrites(): WriteSpies {
  const unexpectedWrite: Error = new Error(
    "AlertStateChangeAuthorization must not write anything",
  );

  return {
    alertCreate: jest
      .spyOn(AlertService, "create")
      .mockRejectedValue(unexpectedWrite),
    alertUpdateOneById: jest
      .spyOn(AlertService, "updateOneById")
      .mockRejectedValue(unexpectedWrite),
    alertUpdateBy: jest
      .spyOn(AlertService, "updateBy")
      .mockRejectedValue(unexpectedWrite),
    alertChangeState: jest
      .spyOn(AlertService, "changeAlertState")
      .mockRejectedValue(unexpectedWrite),
    alertAcknowledge: jest
      .spyOn(AlertService, "acknowledgeAlert")
      .mockRejectedValue(unexpectedWrite),
    timelineCreate: jest
      .spyOn(AlertStateTimelineService, "create")
      .mockRejectedValue(unexpectedWrite),
  };
}

function expectNoWrites(writeSpies: WriteSpies): void {
  expect(writeSpies.alertCreate).not.toHaveBeenCalled();
  expect(writeSpies.alertUpdateOneById).not.toHaveBeenCalled();
  expect(writeSpies.alertUpdateBy).not.toHaveBeenCalled();
  expect(writeSpies.alertChangeState).not.toHaveBeenCalled();
  expect(writeSpies.alertAcknowledge).not.toHaveBeenCalled();
  expect(writeSpies.timelineCreate).not.toHaveBeenCalled();
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  throw new Error("Expected the check to refuse");
}

function check(data: {
  alertIds: Array<ObjectID>;
  props: DatabaseCommonInteractionProps;
}): Promise<void> {
  return AlertStateChangeAuthorization.assertCanChangeStateOfAlerts({
    projectId: projectId,
    alertIds: data.alertIds,
    alertStateId: acknowledgedStateId,
    props: data.props,
  });
}

describe("AlertStateChangeAuthorization.assertCanChangeStateOfAlerts", (): void => {
  let writeSpies: WriteSpies;

  // The database's answers, per test.
  let readableAlertIds: Set<string> | null;
  let labelsByAlertId: Map<string, Array<ObjectID>>;
  let ownedByUser: Array<ObjectID>;
  let ownedByTeam: Array<{ alertId: ObjectID; teamId: ObjectID }>;

  // What was asked of it.
  let parentLookups: Array<ParentLookup>;
  let labelLookups: Array<RecordLookup>;

  beforeEach((): void => {
    writeSpies = spyOnWrites();

    readableAlertIds = null;
    labelsByAlertId = new Map();
    ownedByUser = [];
    ownedByTeam = [];
    parentLookups = [];
    labelLookups = [];

    /*
     * The read of records as the caller - the alerts the state changes go
     * under, and any other record the row names that the caller's read is
     * held to: every record asked about is one the caller's read reaches,
     * but for the alerts a test leaves out.
     */
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
          query: Query<DatabaseBaseModel>;
          props: DatabaseCommonInteractionProps;
        }): Promise<Array<string>> => {
          const table: string = new data.parentModelType().tableName || "";

          parentLookups.push({
            table: table,
            ids: [...data.ids],
            query: data.query,
            props: data.props,
          });

          if (table !== "Alert" || !readableAlertIds) {
            return [...data.ids];
          }

          return data.ids.filter((id: string): boolean => {
            return readableAlertIds!.has(toKey(id));
          });
        },
      );

    // Records read by OneUptime in the project: every one asked about is the project's.
    jest
      .spyOn(
        DatabaseService as unknown as {
          findIdsInProject: (data: {
            ids: Array<string>;
          }) => Promise<Array<string>>;
        },
        "findIdsInProject",
      )
      .mockImplementation(
        async (data: { ids: Array<string> }): Promise<Array<string>> => {
          return [...data.ids];
        },
      );

    // The labels each alert carries, read by OneUptime.
    jest
      .spyOn(
        DatabaseService as unknown as {
          findRecordLabels: (data: {
            modelType: { new (): DatabaseBaseModel };
            ids: Array<string>;
          }) => Promise<Record<string, Array<string>>>;
        },
        "findRecordLabels",
      )
      .mockImplementation(
        async (data: {
          modelType: { new (): DatabaseBaseModel };
          ids: Array<string>;
        }): Promise<Record<string, Array<string>>> => {
          labelLookups.push({
            table: new data.modelType().tableName || "",
            ids: [...data.ids],
          });

          const labels: Record<string, Array<string>> = {};

          for (const id of data.ids) {
            labels[toKey(id)] = (labelsByAlertId.get(toKey(id)) || []).map(
              toKey,
            );
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
            return LABEL_NAMES[toKey(labelId)] || labelId;
          });
        },
      );

    // The alerts the caller, and each of their teams, own.
    jest
      .spyOn(AlertOwnerUserService, "findBy")
      .mockImplementation((async (): Promise<Array<AlertOwnerUser>> => {
        return ownedByUser.map((alertId: ObjectID): AlertOwnerUser => {
          const owner: AlertOwnerUser = new AlertOwnerUser();
          owner.alertId = alertId;
          owner.userId = userId;
          return owner;
        });
      }) as never);
    jest
      .spyOn(AlertOwnerTeamService, "findBy")
      .mockImplementation((async (): Promise<Array<AlertOwnerTeam>> => {
        return ownedByTeam.map(
          (owned: { alertId: ObjectID; teamId: ObjectID }): AlertOwnerTeam => {
            const owner: AlertOwnerTeam = new AlertOwnerTeam();
            owner.alertId = owned.alertId;
            owner.teamId = owned.teamId;
            return owner;
          },
        );
      }) as never);
  });

  afterEach((): void => {
    jest.restoreAllMocks();
  });

  function alertLookups(): Array<ParentLookup> {
    return parentLookups.filter((lookup: ParentLookup): boolean => {
      return lookup.table === "Alert";
    });
  }

  describe("it asks the alert state timeline's own create check, for each alert", (): void => {
    let checkSpy: SpyInstance<CheckCallerMayCreate>;

    beforeEach((): void => {
      checkSpy = jest
        .spyOn(AlertStateTimelineService, "checkCallerMayCreate")
        .mockResolvedValue(undefined);
    });

    test("once per alert, with the row that alert's change would be: the project, the alert and the state it moves to", async (): Promise<void> => {
      const props: DatabaseCommonInteractionProps = createDatabaseProps([
        { permission: Permission.AlertMember },
      ]);
      const first: ObjectID = ObjectID.generate();
      const second: ObjectID = ObjectID.generate();

      await expect(
        check({ alertIds: [first, second], props: props }),
      ).resolves.toBeUndefined();

      expect(checkSpy).toHaveBeenCalledTimes(2);

      for (const [index, alertId] of [first, second].entries()) {
        const asked: Parameters<CheckCallerMayCreate>[0] =
          checkSpy.mock.calls[index]![0];
        const row: AlertStateTimeline = asked.data;

        expect(row).toBeInstanceOf(AlertStateTimeline);
        expect(row.projectId).toBe(projectId);
        expect(row.alertId).toBe(alertId);
        expect(row.alertStateId).toBe(acknowledgedStateId);
        // Asked as the caller, with their own props.
        expect(asked.props).toBe(props);
      }

      // A row of its own for each alert: the check changes the row it is given.
      expect(checkSpy.mock.calls[0]![0].data).not.toBe(
        checkSpy.mock.calls[1]![0].data,
      );
      expectNoWrites(writeSpies);
    });

    test("each alert once, whatever the case of its id", async (): Promise<void> => {
      const alertId: ObjectID = ObjectID.generate();

      await check({
        alertIds: [
          alertId,
          new ObjectID(alertId.toString().toUpperCase()),
          alertId,
        ],
        props: createDatabaseProps([{ permission: Permission.AlertMember }]),
      });

      expect(checkSpy).toHaveBeenCalledTimes(1);
      expect(toKey(checkSpy.mock.calls[0]![0].data.alertId!)).toBe(
        toKey(alertId),
      );
    });

    test("stops at the first alert the caller may not change, and answers in the create check's own words", async (): Promise<void> => {
      const allowed: ObjectID = ObjectID.generate();
      const refused: ObjectID = ObjectID.generate();
      const notReached: ObjectID = ObjectID.generate();
      const refusal: CreateScopeException = new CreateScopeException(
        "Your access lets you create Alert State Timelines only for records with one of these labels: team-a.",
      );

      checkSpy.mockImplementation(
        async (data: Parameters<CheckCallerMayCreate>[0]): Promise<void> => {
          if (toKey(data.data.alertId!) === toKey(refused)) {
            throw refusal;
          }
        },
      );

      const error: unknown = await rejectionOf(
        check({
          alertIds: [allowed, refused, notReached],
          props: createDatabaseProps([{ permission: Permission.AlertMember }]),
        }),
      );

      expect(error).toBe(refusal);
      expect(checkSpy).toHaveBeenCalledTimes(2);
      expectNoWrites(writeSpies);
    });

    test("a root caller is let through without a check", async (): Promise<void> => {
      await expect(
        check({
          alertIds: [ObjectID.generate(), ObjectID.generate()],
          props: { isRoot: true },
        }),
      ).resolves.toBeUndefined();

      expect(checkSpy).not.toHaveBeenCalled();
      expectNoWrites(writeSpies);
    });

    test("no alerts is let through without a check, whoever the caller is", async (): Promise<void> => {
      await expect(
        check({
          alertIds: [],
          props: createDatabaseProps([{ permission: Permission.Viewer }]),
        }),
      ).resolves.toBeUndefined();

      expect(checkSpy).not.toHaveBeenCalled();
    });
  });

  describe("it takes the state timeline's create permission, and no Edit Alert", (): void => {
    test.each([
      { name: "Viewer", permissions: [Permission.Viewer] },
      { name: "AlertViewer", permissions: [Permission.AlertViewer] },
      {
        name: "ReadAlert with ReadAlertStateTimeline",
        permissions: [Permission.ReadAlert, Permission.ReadAlertStateTimeline],
      },
      {
        name: "EditAlert and ReadAlert, without CreateAlertStateTimeline",
        permissions: [Permission.EditAlert, Permission.ReadAlert],
      },
      {
        // AlertStateTimeline is not an operational resource: the wildcards do not reach it.
        name: "the operational-resource wildcards",
        permissions: [
          Permission.CreateAllOperationalResources,
          Permission.EditAllOperationalResources,
          Permission.ReadAlert,
        ],
      },
      {
        name: "IncidentMember, who may declare incidents from alerts",
        permissions: [Permission.IncidentMember],
      },
    ])(
      "$name is refused before any alert is read",
      async (data: { permissions: Array<Permission> }): Promise<void> => {
        const error: unknown = await rejectionOf(
          check({
            alertIds: [ObjectID.generate()],
            props: createDatabaseProps(
              data.permissions.map(
                (permission: Permission): PermissionInput => {
                  return { permission };
                },
              ),
            ),
          }),
        );

        expect(error).toBeInstanceOf(NotAuthorizedException);
        expect((error as Error).message).toContain(
          "Create Alert State Timeline",
        );
        expect(parentLookups).toEqual([]);
        expect(labelLookups).toEqual([]);
        expectNoWrites(writeSpies);
      },
    );

    test.each([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.ProjectMember,
      Permission.AlertAdmin,
      Permission.AlertMember,
    ])(
      "%s may change the alerts' states",
      async (permission: Permission): Promise<void> => {
        await expect(
          check({
            alertIds: [ObjectID.generate(), ObjectID.generate()],
            props: createDatabaseProps([{ permission }]),
          }),
        ).resolves.toBeUndefined();

        expectNoWrites(writeSpies);
      },
    );

    test("a custom role with Create Alert State Timeline and Read Alert, but no Edit Alert, may change the alerts' states", async (): Promise<void> => {
      const first: ObjectID = ObjectID.generate();
      const second: ObjectID = ObjectID.generate();

      await expect(
        check({
          alertIds: [first, second],
          props: createDatabaseProps([
            { permission: Permission.CreateAlertStateTimeline },
            { permission: Permission.ReadAlert },
          ]),
        }),
      ).resolves.toBeUndefined();

      // Each alert was read as the caller, and nothing was written.
      expect(
        alertLookups().map((lookup: ParentLookup): Array<string> => {
          return lookup.ids.map(toKey);
        }),
      ).toEqual([[toKey(first)], [toKey(second)]]);
      expectNoWrites(writeSpies);
    });

    test("a team's block on Edit Alert does not stop it: changing a state is not editing the alert", async (): Promise<void> => {
      await expect(
        check({
          alertIds: [ObjectID.generate()],
          props: createDatabaseProps([
            { permission: Permission.ProjectMember },
            { permission: Permission.EditAlert, isBlockPermission: true },
          ]),
        }),
      ).resolves.toBeUndefined();
    });

    test("a team's block on Create Alert State Timeline stops it, even for a Project Member, before any alert is read", async (): Promise<void> => {
      const error: unknown = await rejectionOf(
        check({
          alertIds: [ObjectID.generate()],
          props: createDatabaseProps([
            { permission: Permission.ProjectMember },
            {
              permission: Permission.CreateAlertStateTimeline,
              isBlockPermission: true,
            },
          ]),
        }),
      );

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect(parentLookups).toEqual([]);
      expectNoWrites(writeSpies);
    });

    test("a caller with no credentials keeps the 401, and nothing is read", async (): Promise<void> => {
      const error: unknown = await rejectionOf(
        check({
          alertIds: [ObjectID.generate()],
          props: { tenantId: projectId },
        }),
      );

      expect(error).toBeInstanceOf(NotAuthenticatedException);
      expect(parentLookups).toEqual([]);
      expectNoWrites(writeSpies);
    });

    test("an API key with Create Alert State Timeline and Read Alert may change the alerts' states", async (): Promise<void> => {
      await expect(
        check({
          alertIds: [ObjectID.generate()],
          props: createDatabaseProps(
            [
              { permission: Permission.CreateAlertStateTimeline },
              { permission: Permission.ReadAlert },
            ],
            { withoutUser: true },
          ),
        }),
      ).resolves.toBeUndefined();
    });

    test("a master admin, not root, is let through by every check, and nothing is read", async (): Promise<void> => {
      await expect(
        check({
          alertIds: [ObjectID.generate()],
          props: {
            ...createDatabaseProps([]),
            isMasterAdmin: true,
          },
        }),
      ).resolves.toBeUndefined();

      expect(parentLookups).toEqual([]);
      expectNoWrites(writeSpies);
    });
  });

  describe("each alert must be one the caller may read", (): void => {
    test("the alert is read as the caller, in the project, with every record looked up and no service hook to lean on", async (): Promise<void> => {
      const alertId: ObjectID = ObjectID.generate();
      const props: DatabaseCommonInteractionProps = createDatabaseProps([
        { permission: Permission.CreateAlertStateTimeline },
        { permission: Permission.ReadAlert },
      ]);

      await check({ alertIds: [alertId], props: props });

      const lookups: Array<ParentLookup> = alertLookups();

      expect(lookups).toHaveLength(1);
      expect(lookups[0]!.ids.map(toKey)).toEqual([toKey(alertId)]);
      expect(lookups[0]!.props.userId).toBe(userId);
      expect(lookups[0]!.props.tenantId).toBe(projectId);
      expect(lookups[0]!.props.isRoot).toBeFalsy();
      // No hook of the timeline service runs: the check looks the alert up itself.
      expect(lookups[0]!.props.ignoreHooks).toBe(true);
      // The caller's own props are left as they were.
      expect(props.ignoreHooks).toBeUndefined();
    });

    test("an alert the caller's read does not reach is refused as if it did not exist", async (): Promise<void> => {
      const readable: ObjectID = ObjectID.generate();
      const unreadable: ObjectID = ObjectID.generate();
      readableAlertIds = new Set([toKey(readable)]);

      const error: unknown = await rejectionOf(
        check({
          alertIds: [readable, unreadable],
          props: createDatabaseProps([
            { permission: Permission.CreateAlertStateTimeline },
            { permission: Permission.ReadAlert, labelIds: [TEAM_A] },
          ]),
        }),
      );

      expect(error).toBeInstanceOf(UnreadableParentException);
      expect(error).toBeInstanceOf(BadDataException);
      expect((error as Error).message).toContain(unreadable.toString());
      expect((error as Error).message).not.toContain(readable.toString());
      expectNoWrites(writeSpies);
    });

    test("a caller who sees only some private alerts reads them with the alert privacy rule", async (): Promise<void> => {
      await check({
        alertIds: [ObjectID.generate()],
        props: createDatabaseProps([
          { permission: Permission.CreateAlertStateTimeline },
          { permission: Permission.ReadAlert },
        ]),
      });

      const query: Record<string, unknown> = alertLookups()[0]!
        .query as unknown as Record<string, unknown>;

      expect(query["isPrivate"]).toBeInstanceOf(FindOperator);

      const operator: FindOperator<unknown> = query[
        "isPrivate"
      ] as FindOperator<unknown>;
      const sql: string = operator.getSql ? operator.getSql("COLUMN") : "";

      // A private alert passes only for its owners.
      expect(sql).toContain('"AlertOwnerUser"');
      expect(sql).toContain('"AlertOwnerTeam"');
      expect(Object.values(operator.objectLiteralParameters || {})).toEqual([
        userId.toString(),
      ]);
    });

    test("an API key, which owns nothing, reads no private alert", async (): Promise<void> => {
      await check({
        alertIds: [ObjectID.generate()],
        props: createDatabaseProps(
          [
            { permission: Permission.CreateAlertStateTimeline },
            { permission: Permission.ReadAlert },
          ],
          { withoutUser: true },
        ),
      });

      const operator: FindOperator<unknown> = (
        alertLookups()[0]!.query as unknown as Record<string, unknown>
      )["isPrivate"] as FindOperator<unknown>;

      expect(operator).toBeInstanceOf(FindOperator);
      expect(operator.getSql!("COLUMN")).toBe(
        "(COLUMN IS NULL OR COLUMN = FALSE)",
      );
    });

    test("a Project Owner, who sees every private alert, reads them without it", async (): Promise<void> => {
      await check({
        alertIds: [ObjectID.generate()],
        props: createDatabaseProps([{ permission: Permission.ProjectOwner }]),
      });

      const lookups: Array<ParentLookup> = alertLookups();

      expect(lookups).toHaveLength(1);
      expect(
        (lookups[0]!.query as unknown as Record<string, unknown>)["isPrivate"],
      ).toBeUndefined();
    });

    test("a private alert the caller does not own is refused, and one they own goes through", async (): Promise<void> => {
      const theirs: ObjectID = ObjectID.generate();
      const someoneElses: ObjectID = ObjectID.generate();
      // What the database answers to the read with the privacy rule.
      readableAlertIds = new Set([toKey(theirs)]);

      const props: DatabaseCommonInteractionProps = createDatabaseProps([
        { permission: Permission.AlertMember },
      ]);

      await expect(
        check({ alertIds: [theirs], props: props }),
      ).resolves.toBeUndefined();

      const error: unknown = await rejectionOf(
        check({ alertIds: [theirs, someoneElses], props: props }),
      );

      expect(error).toBeInstanceOf(UnreadableParentException);
    });

    test("an AlertMember limited to label A, for reading and creating, may change an alert carrying A, and not one carrying only B", async (): Promise<void> => {
      const alertA: ObjectID = ObjectID.generate();
      const alertB: ObjectID = ObjectID.generate();
      labelsByAlertId.set(toKey(alertA), [TEAM_A]);
      labelsByAlertId.set(toKey(alertB), [TEAM_B]);
      // A read limited to label A reaches only the alerts carrying it.
      readableAlertIds = new Set([toKey(alertA)]);

      const props: DatabaseCommonInteractionProps = createDatabaseProps([
        { permission: Permission.AlertMember, labelIds: [TEAM_A] },
      ]);

      await expect(
        check({ alertIds: [alertA], props: props }),
      ).resolves.toBeUndefined();

      const error: unknown = await rejectionOf(
        check({ alertIds: [alertB], props: props }),
      );

      expect(error).toBeInstanceOf(BadDataException);
      expectNoWrites(writeSpies);
    });
  });

  describe("what the caller's create permission reaches through each alert", (): void => {
    test("Viewer plus Create Alert State Timeline limited to label A: an alert carrying only label B is refused, naming the label", async (): Promise<void> => {
      const alertB: ObjectID = ObjectID.generate();
      labelsByAlertId.set(toKey(alertB), [TEAM_B]);

      const error: unknown = await rejectionOf(
        check({
          alertIds: [alertB],
          props: createDatabaseProps([
            { permission: Permission.Viewer },
            {
              permission: Permission.CreateAlertStateTimeline,
              labelIds: [TEAM_A],
            },
          ]),
        }),
      );

      expect(error).toBeInstanceOf(CreateScopeException);
      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect((error as Error).message).toBe(
        "Your access lets you create Alert State Timelines only for records with one of these labels: team-a.",
      );
      // The alert's labels, read by OneUptime.
      expect(labelLookups).toEqual([{ table: "Alert", ids: [toKey(alertB)] }]);
      expectNoWrites(writeSpies);
    });

    test("...and an alert carrying label A goes through", async (): Promise<void> => {
      const alertA: ObjectID = ObjectID.generate();
      labelsByAlertId.set(toKey(alertA), [TEAM_A, TEAM_B]);

      await expect(
        check({
          alertIds: [alertA],
          props: createDatabaseProps([
            { permission: Permission.Viewer },
            {
              permission: Permission.CreateAlertStateTimeline,
              labelIds: [TEAM_A],
            },
          ]),
        }),
      ).resolves.toBeUndefined();
    });

    test("an unlabelled alert is refused to a create permission limited to labels", async (): Promise<void> => {
      const unlabelled: ObjectID = ObjectID.generate();

      const error: unknown = await rejectionOf(
        check({
          alertIds: [unlabelled],
          props: createDatabaseProps([
            { permission: Permission.Viewer },
            {
              permission: Permission.CreateAlertStateTimeline,
              labelIds: [TEAM_A],
            },
          ]),
        }),
      );

      expect(error).toBeInstanceOf(CreateScopeException);
    });

    test("a block with label B on Create Alert State Timeline refuses an alert carrying B, even for a Project Member", async (): Promise<void> => {
      const alertB: ObjectID = ObjectID.generate();
      labelsByAlertId.set(toKey(alertB), [TEAM_B]);

      const error: unknown = await rejectionOf(
        check({
          alertIds: [alertB],
          props: createDatabaseProps([
            { permission: Permission.ProjectMember },
            {
              permission: Permission.CreateAlertStateTimeline,
              isBlockPermission: true,
              labelIds: [TEAM_B],
            },
          ]),
        }),
      );

      expect(error).toBeInstanceOf(CreateScopeException);
      expect((error as Error).message).toContain(
        'is in your team\'s permission block list for the label "team-b"',
      );
    });

    test("...and lets an alert without label B through", async (): Promise<void> => {
      const alertA: ObjectID = ObjectID.generate();
      labelsByAlertId.set(toKey(alertA), [TEAM_A]);

      await expect(
        check({
          alertIds: [alertA],
          props: createDatabaseProps([
            { permission: Permission.ProjectMember },
            {
              permission: Permission.CreateAlertStateTimeline,
              isBlockPermission: true,
              labelIds: [TEAM_B],
            },
          ]),
        }),
      ).resolves.toBeUndefined();
    });

    test("a block with label B on Edit Alert leaves an alert carrying B to be changed", async (): Promise<void> => {
      const alertB: ObjectID = ObjectID.generate();
      labelsByAlertId.set(toKey(alertB), [TEAM_B]);

      await expect(
        check({
          alertIds: [alertB],
          props: createDatabaseProps([
            { permission: Permission.ProjectMember },
            {
              permission: Permission.EditAlert,
              isBlockPermission: true,
              labelIds: [TEAM_B],
            },
          ]),
        }),
      ).resolves.toBeUndefined();
    });

    test("Create Alert State Timeline limited to owned records: an alert the caller's team owns goes through, one they do not own is refused", async (): Promise<void> => {
      const teamId: ObjectID = ObjectID.generate();
      const ownedByTheirTeam: ObjectID = ObjectID.generate();
      const ownedByThem: ObjectID = ObjectID.generate();
      const notTheirs: ObjectID = ObjectID.generate();
      ownedByTeam = [{ alertId: ownedByTheirTeam, teamId: teamId }];
      ownedByUser = [ownedByThem];

      const props: DatabaseCommonInteractionProps = createDatabaseProps(
        [
          { permission: Permission.Viewer },
          {
            permission: Permission.CreateAlertStateTimeline,
            scope: PermissionScope.Owned,
          },
        ],
        { userTeamIds: [teamId] },
      );

      await expect(
        check({ alertIds: [ownedByTheirTeam, ownedByThem], props: props }),
      ).resolves.toBeUndefined();

      const error: unknown = await rejectionOf(
        check({ alertIds: [notTheirs], props: props }),
      );

      expect(error).toBeInstanceOf(CreateScopeException);
      expect((error as Error).message).toBe(
        "Your access lets you create Alert State Timelines only for the Alerts you or your teams own.",
      );
      expectNoWrites(writeSpies);
    });
  });

  describe("it is the same rule acknowledging one alert on its own page follows", (): void => {
    /*
     * The row each alert's change would be is asked about through the very
     * check AlertStateTimelineService.create runs before it writes: the two
     * agree for every caller below.
     */
    test.each([
      {
        name: "a custom role with Create Alert State Timeline and Read Alert",
        permissions: [
          { permission: Permission.CreateAlertStateTimeline },
          { permission: Permission.ReadAlert },
        ],
        allowed: true,
      },
      {
        name: "EditAlert and ReadAlert alone",
        permissions: [
          { permission: Permission.EditAlert },
          { permission: Permission.ReadAlert },
        ],
        allowed: false,
      },
      {
        name: "a Project Member blocked from editing alerts",
        permissions: [
          { permission: Permission.ProjectMember },
          { permission: Permission.EditAlert, isBlockPermission: true },
        ],
        allowed: true,
      },
      {
        name: "a Project Member blocked from creating alert state timelines",
        permissions: [
          { permission: Permission.ProjectMember },
          {
            permission: Permission.CreateAlertStateTimeline,
            isBlockPermission: true,
          },
        ],
        allowed: false,
      },
    ])(
      "$name: declaring asks what the alert's own state timeline create asks",
      async (data: {
        permissions: Array<PermissionInput>;
        allowed: boolean;
      }): Promise<void> => {
        const checkSpy: SpyInstance<CheckCallerMayCreate> = jest.spyOn(
          AlertStateTimelineService,
          "checkCallerMayCreate",
        );

        const result: Promise<void> = check({
          alertIds: [ObjectID.generate()],
          props: createDatabaseProps(data.permissions),
        });

        if (data.allowed) {
          await expect(result).resolves.toBeUndefined();
        } else {
          await expect(result).rejects.toBeInstanceOf(NotAuthorizedException);
        }

        // Through the timeline service's own create check, not a check of its own.
        expect(checkSpy).toHaveBeenCalledTimes(1);
        expectNoWrites(writeSpies);
      },
    );

    test("the create check asked is AlertStateTimelineService's: the service whose create a person's acknowledge is", (): void => {
      expect(AlertStateTimelineService.modelType).toBe(AlertStateTimeline);
      expect(
        Object.getPrototypeOf(AlertStateTimelineService).checkCallerMayCreate,
      ).toBe(DatabaseService.prototype.checkCallerMayCreate);
    });

    test("Alert is the record a state timeline row is read through, so it is the parent each check reads", (): void => {
      expect(new AlertStateTimeline().canAccessIfCanReadOn).toBe("alert");
      expect(new Alert().tableName).toBe("Alert");
    });
  });
});
