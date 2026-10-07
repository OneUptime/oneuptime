import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Log from "../../../../Models/AnalyticsModels/Log";
import Span from "../../../../Models/AnalyticsModels/Span";
import Metric from "../../../../Models/AnalyticsModels/Metric";
import AuditLog from "../../../../Models/AnalyticsModels/AuditLog";
import { AnalyticsBaseModelType } from "../../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import AnalyticsModelPermission from "../../../../Server/Types/AnalyticsDatabase/ModelPermission";
import AnalyticsQuery from "../../../../Server/Types/AnalyticsDatabase/Query";
import DatabaseRequestType from "../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import OwnerTableRegistry from "../../../../Server/Types/Database/Permissions/OwnerTableRegistry";
import TelemetryReadScopeUtil, {
  TelemetryReadScope,
} from "../../../../Server/Utils/Telemetry/TelemetryReadScope";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../../../Types/BaseDatabase/Includes";
import IncludesNone from "../../../../Types/BaseDatabase/IncludesNone";
import PermissionScope from "../../../../Types/Database/AccessControl/PermissionScope";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../Types/Permission";
import { MockFunction } from "../../../MockType";

/*
 * WHOSE TELEMETRY A CALLER READS: the one scope the model reads, the
 * /telemetry/* routes and the AI tools all apply
 * (AnalyticsDatabase/ModelPermission.getReadScope). These run the real
 * owner table registry and permission rules; only the Postgres lookups
 * behind the registry's services are answered here.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const USER_ID: ObjectID = ObjectID.generate();
const TEAM_ID: ObjectID = ObjectID.generate();

const OWNED_SERVICE_ID: ObjectID = ObjectID.generate();
const TEAM_OWNED_HOST_ID: ObjectID = ObjectID.generate();
const LABELLED_SERVICE_ID: ObjectID = ObjectID.generate();
const LABELLED_CLUSTER_ID: ObjectID = ObjectID.generate();
const BLOCKED_SERVICE_ID: ObjectID = ObjectID.generate();
const RUM_APPLICATION_ID: ObjectID = ObjectID.generate();

const GRANTED_LABEL_ID: ObjectID = ObjectID.generate();
const BLOCKED_LABEL_ID: ObjectID = ObjectID.generate();

interface LookupMocks {
  user: MockFunction;
  team: MockFunction;
  model: MockFunction;
}

interface LookupRequest {
  query: Record<string, unknown>;
}

const lookupMocks: Map<string, LookupMocks> = new Map();

// Which resources of a registry type carry which label.
const labelCarriers: Map<string, Map<string, Array<ObjectID>>> = new Map();

function lookups(name: string): LookupMocks {
  const result: LookupMocks | undefined = lookupMocks.get(name);
  if (!result) {
    throw new Error(`No telemetry-owning registry entry named ${name}`);
  }
  return result;
}

function fkColumnOf(name: string): string {
  return OwnerTableRegistry.get(name)!.fkColumn;
}

function carryLabel(
  name: string,
  labelId: ObjectID,
  ids: Array<ObjectID>,
): void {
  lookups(name);
  const carriers: Map<string, Array<ObjectID>> = labelCarriers.get(name) ||
  new Map();
  carriers.set(labelId.toString(), ids);
  labelCarriers.set(name, carriers);
}

function ownedByUser(name: string, ids: Array<ObjectID>): void {
  lookups(name).user.mockResolvedValue(
    ids.map((id: ObjectID) => {
      return { [fkColumnOf(name)]: id };
    }),
  );
}

function ownedByTeam(name: string, ids: Array<ObjectID>): void {
  lookups(name).team.mockResolvedValue(
    ids.map((id: ObjectID) => {
      return { [fkColumnOf(name)]: id };
    }),
  );
}

function row(
  permission: Permission,
  data: {
    scope?: PermissionScope;
    labelIds?: Array<ObjectID>;
    isBlockPermission?: boolean;
  } = {},
): UserPermission {
  return {
    _type: "UserPermission",
    permission: permission,
    scope: data.scope,
    labelIds: data.labelIds || [],
    isBlockPermission: data.isBlockPermission || false,
  };
}

function propsFor(
  permissions: Array<UserPermission>,
): DatabaseCommonInteractionProps {
  return {
    tenantId: PROJECT_ID,
    userId: USER_ID,
    userTeamIds: [TEAM_ID],
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: permissions,
      },
    },
  };
}

async function scopeOf(
  props: DatabaseCommonInteractionProps,
  modelType: AnalyticsBaseModelType = Log,
): Promise<TelemetryReadScope> {
  return await AnalyticsModelPermission.getReadScope(
    modelType,
    props,
    DatabaseRequestType.Read,
  );
}

function sorted(ids: ReadonlyArray<string> | null): Array<string> | null {
  return ids ? [...ids].sort() : null;
}

function idsOf(...ids: Array<ObjectID>): Array<string> {
  return ids
    .map((id: ObjectID) => {
      return id.toString();
    })
    .sort();
}

function lookupCallCount(): number {
  let count: number = 0;
  for (const mocks of lookupMocks.values()) {
    count +=
      mocks.user.mock.calls.length +
      mocks.team.mock.calls.length +
      mocks.model.mock.calls.length;
  }
  return count;
}

beforeEach(() => {
  lookupMocks.clear();
  labelCarriers.clear();

  for (const [name, entry] of OwnerTableRegistry.entries()) {
    if (!entry.canOwnTelemetry || !entry.modelService) {
      continue;
    }

    lookupMocks.set(name, {
      user: jest
        .spyOn(entry.ownerUserService, "findBy")
        .mockResolvedValue([]) as unknown as MockFunction,
      team: jest
        .spyOn(entry.ownerTeamService, "findBy")
        .mockResolvedValue([]) as unknown as MockFunction,
      model: jest
        .spyOn(entry.modelService, "findBy")
        .mockImplementation((async (request: LookupRequest) => {
          const labelIds: Array<ObjectID> =
            (request.query["labels"] as Array<ObjectID>) || [];
          const carriers: Map<string, Array<ObjectID>> = labelCarriers.get(
            name,
          ) || new Map();
          const found: Set<string> = new Set<string>();
          for (const labelId of labelIds) {
            for (const id of carriers.get(labelId.toString()) || []) {
              found.add(id.toString());
            }
          }
          return Array.from(found).map((id: string) => {
            return { _id: id };
          });
        }) as never) as unknown as MockFunction,
    });
  }
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Whose telemetry a caller reads", () => {
  test("root and master admins read every resource, and nothing is looked up", async () => {
    expect(await scopeOf({ isRoot: true })).toEqual({
      readableIds: null,
      blockedIds: [],
    });
    expect(
      await scopeOf({
        ...propsFor([]),
        isMasterAdmin: true,
      }),
    ).toEqual({ readableIds: null, blockedIds: [] });
    expect(lookupCallCount()).toBe(0);
  });

  test("a grant that reaches the whole project reads every resource", async () => {
    for (const grant of [
      row(Permission.ProjectMember, { scope: PermissionScope.All }),
      // A row with no labels and no scope (stored before scopes) reaches the whole project.
      row(Permission.ProjectMember),
      row(Permission.ReadTelemetryServiceLog, {
        scope: PermissionScope.Labels,
      }),
    ]) {
      const scope: TelemetryReadScope = await scopeOf(propsFor([grant]));
      expect(scope).toEqual({ readableIds: null, blockedIds: [] });
      expect(TelemetryReadScopeUtil.isProjectWide(scope)).toBe(true);
    }
    expect(lookupCallCount()).toBe(0);
  });

  test("a role that cannot be scoped reads every resource whatever scope its row carries", async () => {
    for (const permission of [
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
    ]) {
      expect(
        await scopeOf(
          propsFor([row(permission, { scope: PermissionScope.Owned })]),
        ),
      ).toEqual({ readableIds: null, blockedIds: [] });
    }
    expect(lookupCallCount()).toBe(0);
  });

  test("a label grant reads exactly the resources carrying its labels, of every telemetry-owning type", async () => {
    carryLabel("Service", GRANTED_LABEL_ID, [LABELLED_SERVICE_ID]);
    carryLabel("KubernetesCluster", GRANTED_LABEL_ID, [LABELLED_CLUSTER_ID]);
    carryLabel("Service", BLOCKED_LABEL_ID, [BLOCKED_SERVICE_ID]);

    const scope: TelemetryReadScope = await scopeOf(
      propsFor([
        row(Permission.ReadTelemetryServiceLog, {
          scope: PermissionScope.Labels,
          labelIds: [GRANTED_LABEL_ID],
        }),
      ]),
    );

    expect(sorted(scope.readableIds)).toEqual(
      idsOf(LABELLED_SERVICE_ID, LABELLED_CLUSTER_ID),
    );
    expect(scope.blockedIds).toEqual([]);
    // The project's unattributed bucket carries no labels: a label grant does not read it.
    expect(scope.readableIds).not.toContain(PROJECT_ID.toString());
    // Owners are not looked up for a label grant.
    expect(lookups("Service").user).not.toHaveBeenCalled();
    expect(lookups("Service").team).not.toHaveBeenCalled();
    // Each lookup stays inside the caller's project.
    for (const call of lookups("Service").model.mock.calls) {
      expect(String((call[0] as LookupRequest).query["projectId"])).toBe(
        PROJECT_ID.toString(),
      );
    }
  });

  test("an Owned grant reads what the caller or one of their teams owns, and the project's unattributed bucket", async () => {
    ownedByUser("Service", [OWNED_SERVICE_ID]);
    ownedByTeam("Host", [TEAM_OWNED_HOST_ID]);

    const scope: TelemetryReadScope = await scopeOf(
      propsFor([
        row(Permission.ProjectMember, { scope: PermissionScope.Owned }),
      ]),
    );

    expect(sorted(scope.readableIds)).toEqual(
      idsOf(OWNED_SERVICE_ID, TEAM_OWNED_HOST_ID, PROJECT_ID),
    );
    expect(scope.blockedIds).toEqual([]);
  });

  test("an Owned grant and a label grant read the union of both", async () => {
    ownedByUser("Service", [OWNED_SERVICE_ID]);
    carryLabel("Service", GRANTED_LABEL_ID, [LABELLED_SERVICE_ID]);

    const scope: TelemetryReadScope = await scopeOf(
      propsFor([
        row(Permission.ProjectMember, { scope: PermissionScope.Owned }),
        row(Permission.ReadTelemetryServiceLog, {
          scope: PermissionScope.Labels,
          labelIds: [GRANTED_LABEL_ID],
        }),
      ]),
    );

    expect(sorted(scope.readableIds)).toEqual(
      idsOf(OWNED_SERVICE_ID, LABELLED_SERVICE_ID, PROJECT_ID),
    );
  });

  test("a scoped grant that reaches no resource reads nothing, never every resource", async () => {
    // An Owned grant that owns nothing still reads the unattributed bucket, and only that.
    const owned: TelemetryReadScope = await scopeOf(
      propsFor([
        row(Permission.ProjectMember, { scope: PermissionScope.Owned }),
      ]),
      Span,
    );
    expect(owned.readableIds).toEqual([PROJECT_ID.toString()]);

    // A label grant whose labels no resource carries reads nothing at all.
    const labelled: TelemetryReadScope = await scopeOf(
      propsFor([
        row(Permission.ReadTelemetryServiceLog, {
          scope: PermissionScope.Labels,
          labelIds: [GRANTED_LABEL_ID],
        }),
      ]),
      Log,
    );
    expect(labelled.readableIds).toEqual([]);
    // ...which an aggregation request receives as a list matching no row, never as "no filter".
    expect(TelemetryReadScopeUtil.toServiceFilter(labelled).serviceIds).toEqual(
      [new ObjectID(TelemetryReadScopeUtil.NO_RESOURCE_ID)],
    );
  });

  test("a caller holding nothing the model accepts reads no resource at all", async () => {
    const scope: TelemetryReadScope = await scopeOf(
      propsFor([
        row(Permission.ReadProjectIncident, { scope: PermissionScope.All }),
      ]),
    );

    expect(scope).toEqual({ readableIds: [], blockedIds: [] });
    expect(TelemetryReadScopeUtil.toServiceFilter(scope).serviceIds).toEqual([
      new ObjectID(TelemetryReadScopeUtil.NO_RESOURCE_ID),
    ]);
  });

  test("Read All Operational Resources reads telemetry as far as its own row reaches", async () => {
    carryLabel("Service", GRANTED_LABEL_ID, [LABELLED_SERVICE_ID]);

    expect(
      await scopeOf(
        propsFor([
          row(Permission.ReadAllOperationalResources, {
            scope: PermissionScope.All,
          }),
        ]),
      ),
    ).toEqual({ readableIds: null, blockedIds: [] });

    const labelled: TelemetryReadScope = await scopeOf(
      propsFor([
        row(Permission.ReadAllOperationalResources, {
          scope: PermissionScope.Labels,
          labelIds: [GRANTED_LABEL_ID],
        }),
      ]),
    );
    expect(sorted(labelled.readableIds)).toEqual(idsOf(LABELLED_SERVICE_ID));
  });

  test("a block with no labels on the wildcard takes the wildcard away, not the model's own grants", async () => {
    const wildcardBlock: UserPermission = row(
      Permission.ReadAllOperationalResources,
      { isBlockPermission: true },
    );

    expect(
      await scopeOf(
        propsFor([
          row(Permission.ReadAllOperationalResources, {
            scope: PermissionScope.All,
          }),
          wildcardBlock,
        ]),
      ),
    ).toEqual({ readableIds: [], blockedIds: [] });

    expect(
      await scopeOf(
        propsFor([
          row(Permission.ProjectMember, { scope: PermissionScope.All }),
          wildcardBlock,
        ]),
      ),
    ).toEqual({ readableIds: null, blockedIds: [] });
  });
});

describe("Blocks on telemetry reads", () => {
  test("a block with no labels refuses the read outright, before anything is looked up", async () => {
    ownedByUser("Service", [OWNED_SERVICE_ID]);

    await expect(
      scopeOf(
        propsFor([
          row(Permission.ProjectMember, { scope: PermissionScope.All }),
          row(Permission.ReadTelemetryServiceLog, { isBlockPermission: true }),
        ]),
      ),
    ).rejects.toThrow(NotAuthorizedException);

    await expect(
      scopeOf(
        propsFor([
          row(Permission.ProjectMember, { scope: PermissionScope.All }),
          row(Permission.ReadTelemetryServiceLog, { isBlockPermission: true }),
        ]),
      ),
    ).rejects.toThrow(
      "You are not authorized to read Log because ReadTelemetryServiceLog is in your team's permission block list.",
    );

    expect(lookupCallCount()).toBe(0);
  });

  test("a block with labels takes the resources carrying them away from a project-wide grant", async () => {
    carryLabel("Service", BLOCKED_LABEL_ID, [BLOCKED_SERVICE_ID]);

    const scope: TelemetryReadScope = await scopeOf(
      propsFor([
        row(Permission.ProjectMember, { scope: PermissionScope.All }),
        row(Permission.ReadTelemetryServiceLog, {
          labelIds: [BLOCKED_LABEL_ID],
          isBlockPermission: true,
        }),
      ]),
    );

    expect(scope).toEqual({
      readableIds: null,
      blockedIds: [BLOCKED_SERVICE_ID.toString()],
    });
    expect(TelemetryReadScopeUtil.isProjectWide(scope)).toBe(false);
    expect(TelemetryReadScopeUtil.isReadable(scope, BLOCKED_SERVICE_ID)).toBe(
      false,
    );
    expect(TelemetryReadScopeUtil.isReadable(scope, OWNED_SERVICE_ID)).toBe(
      true,
    );
  });

  test("a block with labels takes resources away from what an Owned or label grant reads", async () => {
    ownedByUser("Service", [OWNED_SERVICE_ID, BLOCKED_SERVICE_ID]);
    carryLabel("Service", GRANTED_LABEL_ID, [
      LABELLED_SERVICE_ID,
      BLOCKED_SERVICE_ID,
    ]);
    carryLabel("Service", BLOCKED_LABEL_ID, [BLOCKED_SERVICE_ID]);

    const scope: TelemetryReadScope = await scopeOf(
      propsFor([
        row(Permission.ProjectMember, { scope: PermissionScope.Owned }),
        row(Permission.ReadTelemetryServiceLog, {
          scope: PermissionScope.Labels,
          labelIds: [GRANTED_LABEL_ID],
        }),
        row(Permission.ProjectMember, {
          labelIds: [BLOCKED_LABEL_ID],
          isBlockPermission: true,
        }),
      ]),
    );

    expect(sorted(scope.readableIds)).toEqual(
      idsOf(OWNED_SERVICE_ID, LABELLED_SERVICE_ID, PROJECT_ID),
    );
    expect(scope.blockedIds).toEqual([BLOCKED_SERVICE_ID.toString()]);
  });

  test("a block with labels on a permission the model does not accept takes nothing away", async () => {
    carryLabel("Service", BLOCKED_LABEL_ID, [BLOCKED_SERVICE_ID]);

    const scope: TelemetryReadScope = await scopeOf(
      propsFor([
        row(Permission.ProjectMember, { scope: PermissionScope.All }),
        row(Permission.ReadProjectIncident, {
          labelIds: [BLOCKED_LABEL_ID],
          isBlockPermission: true,
        }),
      ]),
    );

    expect(scope).toEqual({ readableIds: null, blockedIds: [] });
  });

  test("a caller whose only row is a block with labels reads nothing", async () => {
    carryLabel("Service", BLOCKED_LABEL_ID, [BLOCKED_SERVICE_ID]);

    const scope: TelemetryReadScope = await scopeOf(
      propsFor([
        row(Permission.ReadTelemetryServiceLog, {
          labelIds: [BLOCKED_LABEL_ID],
          isBlockPermission: true,
        }),
      ]),
    );

    expect(scope.readableIds).toEqual([]);
    expect(TelemetryReadScopeUtil.isReadable(scope, OWNED_SERVICE_ID)).toBe(
      false,
    );
  });
});

describe("Working the scope out", () => {
  test("is done once per request and shared by every telemetry model", async () => {
    ownedByUser("Service", [OWNED_SERVICE_ID]);
    carryLabel("Service", BLOCKED_LABEL_ID, [BLOCKED_SERVICE_ID]);

    const props: DatabaseCommonInteractionProps = propsFor([
      row(Permission.ProjectMember, { scope: PermissionScope.Owned }),
      row(Permission.ProjectMember, {
        labelIds: [BLOCKED_LABEL_ID],
        isBlockPermission: true,
      }),
    ]);

    for (const modelType of [
      Log,
      Span,
      Metric,
    ] as Array<AnalyticsBaseModelType>) {
      const scope: TelemetryReadScope = await scopeOf(props, modelType);
      expect(scope.readableIds).toContain(OWNED_SERVICE_ID.toString());
      expect(scope.blockedIds).toEqual([BLOCKED_SERVICE_ID.toString()]);
    }

    expect(lookups("Service").user).toHaveBeenCalledTimes(1);
    expect(lookups("Service").model).toHaveBeenCalledTimes(1);

    // A new request looks again.
    await scopeOf({ ...props }, Log);
    expect(lookups("Service").user).toHaveBeenCalledTimes(2);
  });

  test("a read limited to some resource types looks up only those", async () => {
    ownedByUser("RumApplication", [RUM_APPLICATION_ID]);
    ownedByUser("Service", [OWNED_SERVICE_ID]);

    const scope: TelemetryReadScope =
      await AnalyticsModelPermission.getReadScopeForPermissions({
        props: propsFor([
          row(Permission.ReadRumSessionReplay, {
            scope: PermissionScope.Owned,
          }),
        ]),
        permissions: [Permission.ReadRumSessionReplay],
        resourceTypes: ["RumApplication"],
        recordName: "session replays",
      });

    expect(scope.readableIds).toEqual([RUM_APPLICATION_ID.toString()]);
    expect(lookups("RumApplication").user).toHaveBeenCalledTimes(1);
    expect(lookups("Service").user).not.toHaveBeenCalled();
    expect(lookups("Host").team).not.toHaveBeenCalled();
  });

  test("a route's own list refuses by name when a block with no labels is on it", async () => {
    await expect(
      AnalyticsModelPermission.getReadScopeForPermissions({
        props: propsFor([
          row(Permission.ReadRumSessionReplay, {
            scope: PermissionScope.All,
          }),
          row(Permission.ReadRumSessionReplay, { isBlockPermission: true }),
        ]),
        permissions: [Permission.ReadRumSessionReplay],
        resourceTypes: ["RumApplication"],
        recordName: "session replays",
      }),
    ).rejects.toThrow(/not authorized to read session replays/);
  });

  test("a model whose rows name no resource is left to the table check", async () => {
    expect(
      await scopeOf(
        propsFor([
          row(Permission.ProjectMember, { scope: PermissionScope.Owned }),
        ]),
        AuditLog,
      ),
    ).toEqual({ readableIds: null, blockedIds: [] });
    expect(lookupCallCount()).toBe(0);
  });
});

describe("Model reads apply the scope", () => {
  async function readQuery(
    props: DatabaseCommonInteractionProps,
    query: AnalyticsQuery<Log> = {},
  ): Promise<AnalyticsQuery<Log>> {
    return (
      await AnalyticsModelPermission.checkReadPermission(
        Log,
        query,
        null,
        props,
      )
    ).query;
  }

  function blockedReader(): DatabaseCommonInteractionProps {
    return propsFor([
      row(Permission.ProjectMember, { scope: PermissionScope.All }),
      row(Permission.ReadTelemetryServiceLog, {
        labelIds: [BLOCKED_LABEL_ID],
        isBlockPermission: true,
      }),
    ]);
  }

  test("a project-wide read with nothing blocked is left as it is", async () => {
    const query: AnalyticsQuery<Log> = await readQuery(
      propsFor([row(Permission.ProjectMember, { scope: PermissionScope.All })]),
    );

    expect(query.primaryEntityId).toBeUndefined();
    expect(query.projectId).toEqual(PROJECT_ID);
  });

  test("a block with labels leaves the blocked resources out of a project-wide read", async () => {
    carryLabel("Service", BLOCKED_LABEL_ID, [BLOCKED_SERVICE_ID]);

    const query: AnalyticsQuery<Log> = await readQuery(blockedReader());

    expect(query.primaryEntityId).toBeInstanceOf(IncludesNone);
    expect((query.primaryEntityId as IncludesNone).values).toEqual([
      BLOCKED_SERVICE_ID.toString(),
    ]);
  });

  test("a read naming a blocked resource matches nothing", async () => {
    carryLabel("Service", BLOCKED_LABEL_ID, [BLOCKED_SERVICE_ID]);

    const query: AnalyticsQuery<Log> = await readQuery(blockedReader(), {
      primaryEntityId: BLOCKED_SERVICE_ID,
    });

    expect(query.primaryEntityId).toBeInstanceOf(Includes);
    expect((query.primaryEntityId as Includes).values).toEqual([
      TelemetryReadScopeUtil.NO_RESOURCE_ID,
    ]);
  });

  test("a read naming resources keeps the ones the caller may read", async () => {
    carryLabel("Service", BLOCKED_LABEL_ID, [BLOCKED_SERVICE_ID]);

    const query: AnalyticsQuery<Log> = await readQuery(blockedReader(), {
      primaryEntityId: new Includes([BLOCKED_SERVICE_ID, OWNED_SERVICE_ID]),
    });

    expect((query.primaryEntityId as Includes).values).toEqual([
      OWNED_SERVICE_ID.toString(),
    ]);
  });

  test("a caller's other filter on the resource column stays beside the scope", async () => {
    carryLabel("Service", BLOCKED_LABEL_ID, [BLOCKED_SERVICE_ID]);

    const excluded: IncludesNone = new IncludesNone([OWNED_SERVICE_ID]);
    const query: AnalyticsQuery<Log> = await readQuery(blockedReader(), {
      primaryEntityId: excluded as never,
    });

    expect(Array.isArray(query.primaryEntityId)).toBe(true);
    const operators: Array<IncludesNone> =
      query.primaryEntityId as unknown as Array<IncludesNone>;
    expect(operators[0]).toBe(excluded);
    expect(operators[1]!.values).toEqual([BLOCKED_SERVICE_ID.toString()]);
  });

  test("deletes reach only the telemetry of resources the caller may delete", async () => {
    carryLabel("Service", BLOCKED_LABEL_ID, [BLOCKED_SERVICE_ID]);

    const query: AnalyticsQuery<Log> =
      await AnalyticsModelPermission.checkDeletePermission(
        Log,
        {},
        propsFor([
          row(Permission.ProjectOwner, { scope: PermissionScope.All }),
          row(Permission.ProjectOwner, {
            labelIds: [BLOCKED_LABEL_ID],
            isBlockPermission: true,
          }),
        ]),
      );

    expect(query.primaryEntityId).toBeInstanceOf(IncludesNone);
    expect((query.primaryEntityId as IncludesNone).values).toEqual([
      BLOCKED_SERVICE_ID.toString(),
    ]);
  });
});

describe("Looking resources up", () => {
  test("a read over some kinds of resource and a read over all of them share what either looked up", async () => {
    ownedByUser("Service", [OWNED_SERVICE_ID]);

    const props: DatabaseCommonInteractionProps = propsFor([
      row(Permission.ProjectMember, { scope: PermissionScope.Owned }),
    ]);

    const servicesOnly: TelemetryReadScope =
      await AnalyticsModelPermission.getReadScopeForPermissions({
        props: props,
        permissions: [Permission.ProjectMember],
        resourceTypes: ["Service"],
        recordName: "metric types",
      });
    const everyKind: TelemetryReadScope = await scopeOf(props, Log);

    expect(servicesOnly.readableIds).toEqual([OWNED_SERVICE_ID.toString()]);
    expect(everyKind.readableIds).toContain(OWNED_SERVICE_ID.toString());
    // Services were looked up once, for both reads.
    expect(lookups("Service").user).toHaveBeenCalledTimes(1);
    expect(lookups("Host").user).toHaveBeenCalledTimes(1);
  });

  test("reads running at the same time share one lookup", async () => {
    ownedByUser("Service", [OWNED_SERVICE_ID]);

    const props: DatabaseCommonInteractionProps = propsFor([
      row(Permission.ProjectMember, { scope: PermissionScope.Owned }),
    ]);

    await Promise.all([scopeOf(props, Log), scopeOf(props, Span)]);

    expect(lookups("Service").user).toHaveBeenCalledTimes(1);
  });

  test("a long list is read to its end: a block with labels takes every resource carrying them away", async () => {
    const pageSize: number = 10000;
    const lastBlocked: ObjectID = ObjectID.generate();

    lookups("Service").model.mockImplementation((async (request: {
      skip: number;
    }) => {
      // A full first page, then the one resource left over.
      if (request.skip === 0) {
        return Array.from({ length: pageSize }, () => {
          return { _id: ObjectID.generate().toString() };
        });
      }
      return [{ _id: lastBlocked.toString() }];
    }) as never);

    const scope: TelemetryReadScope = await scopeOf(
      propsFor([
        row(Permission.ProjectMember, { scope: PermissionScope.All }),
        row(Permission.ProjectMember, {
          labelIds: [BLOCKED_LABEL_ID],
          isBlockPermission: true,
        }),
      ]),
    );

    expect(scope.blockedIds).toHaveLength(pageSize + 1);
    expect(scope.blockedIds).toContain(lastBlocked.toString());
    expect(TelemetryReadScopeUtil.isReadable(scope, lastBlocked)).toBe(false);
    expect(lookups("Service").model).toHaveBeenCalledTimes(2);
  });

  test("a long list of owned resources is read to its end too", async () => {
    const pageSize: number = 10000;
    const lastOwned: ObjectID = ObjectID.generate();
    const fkColumn: string = fkColumnOf("Service");

    lookups("Service").user.mockImplementation((async (request: {
      skip: number;
    }) => {
      if (request.skip === 0) {
        return Array.from({ length: pageSize }, () => {
          return { [fkColumn]: ObjectID.generate() };
        });
      }
      return [{ [fkColumn]: lastOwned }];
    }) as never);

    const scope: TelemetryReadScope = await scopeOf(
      propsFor([
        row(Permission.ProjectMember, { scope: PermissionScope.Owned }),
      ]),
    );

    expect(TelemetryReadScopeUtil.isReadable(scope, lastOwned)).toBe(true);
  });
});

/*
 * The same rule for one resource, decided from the resource's labels and -
 * only when an Owned grant has to be weighed - its owners, without looking
 * every readable resource up (a session replay's application, on every page
 * of a playback).
 */
describe("Owners of one resource", () => {
  test("are read from the registry's owner tables for that resource", async () => {
    const otherUser: ObjectID = ObjectID.generate();

    lookups("RumApplication").user.mockImplementation((async (request: {
      query: Record<string, unknown>;
      select: Record<string, boolean>;
    }) => {
      expect(String(request.query[fkColumnOf("RumApplication")])).toBe(
        RUM_APPLICATION_ID.toString(),
      );
      expect(request.select).toEqual({ userId: true });
      return [{ userId: USER_ID }, { userId: otherUser }];
    }) as never);
    lookups("RumApplication").team.mockImplementation((async () => {
      return [{ teamId: TEAM_ID }];
    }) as never);

    expect(
      await AnalyticsModelPermission.findOwnersOfResource({
        resourceType: "RumApplication",
        resourceId: RUM_APPLICATION_ID,
        tenantId: PROJECT_ID,
      }),
    ).toEqual({
      userIds: [USER_ID.toString(), otherUser.toString()],
      teamIds: [TEAM_ID.toString()],
    });
  });

  test("a kind of resource the registry does not know has no owners", async () => {
    expect(
      await AnalyticsModelPermission.findOwnersOfResource({
        resourceType: "NotAResource",
        resourceId: RUM_APPLICATION_ID,
      }),
    ).toEqual({ userIds: [], teamIds: [] });
    expect(lookupCallCount()).toBe(0);
  });
});

describe("Deciding for one resource", () => {
  const RESOURCE_ID: string = ObjectID.generate().toString();

  async function decide(
    permissions: Array<UserPermission>,
    resource: {
      labelIds?: Array<ObjectID>;
      ownerUserIds?: Array<ObjectID>;
      ownerTeamIds?: Array<ObjectID>;
    } = {},
  ): Promise<{ readable: boolean; ownersAsked: number }> {
    let ownersAsked: number = 0;

    const readable: boolean =
      await AnalyticsModelPermission.isResourceReadableForPermissions({
        props: propsFor(permissions),
        permissions: [Permission.ReadRumSessionReplay],
        resourceTypes: ["RumApplication"],
        recordName: "session replays",
        resource: {
          id: RESOURCE_ID,
          labelIds: (resource.labelIds || []).map((id: ObjectID) => {
            return id.toString();
          }),
          getOwners: async () => {
            ownersAsked++;
            return {
              userIds: (resource.ownerUserIds || []).map((id: ObjectID) => {
                return id.toString();
              }),
              teamIds: (resource.ownerTeamIds || []).map((id: ObjectID) => {
                return id.toString();
              }),
            };
          },
        },
      });

    return { readable, ownersAsked };
  }

  function grant(
    data: { scope?: PermissionScope; labelIds?: Array<ObjectID> } = {},
  ): UserPermission {
    return row(Permission.ReadRumSessionReplay, data);
  }

  function block(labelIds: Array<ObjectID> = []): UserPermission {
    return row(Permission.ReadRumSessionReplay, {
      labelIds: labelIds,
      isBlockPermission: true,
    });
  }

  test("a grant over the whole project reads it, and its owners are not asked", async () => {
    expect(
      await decide([grant({ scope: PermissionScope.All })], {
        labelIds: [GRANTED_LABEL_ID],
      }),
    ).toEqual({ readable: true, ownersAsked: 0 });
  });

  test("a label grant reads it when it carries one of the labels, in any case", async () => {
    expect(
      await decide(
        [
          grant({
            scope: PermissionScope.Labels,
            labelIds: [GRANTED_LABEL_ID],
          }),
        ],
        {
          labelIds: [new ObjectID(GRANTED_LABEL_ID.toString().toUpperCase())],
        },
      ),
    ).toEqual({ readable: true, ownersAsked: 0 });

    expect(
      (
        await decide(
          [
            grant({
              scope: PermissionScope.Labels,
              labelIds: [GRANTED_LABEL_ID],
            }),
          ],
          { labelIds: [BLOCKED_LABEL_ID] },
        )
      ).readable,
    ).toBe(false);
  });

  test("an Owned grant reads it when the caller or one of their teams owns it", async () => {
    const owned: Array<UserPermission> = [
      grant({ scope: PermissionScope.Owned }),
    ];

    expect(await decide(owned, { ownerUserIds: [USER_ID] })).toEqual({
      readable: true,
      ownersAsked: 1,
    });
    expect((await decide(owned, { ownerTeamIds: [TEAM_ID] })).readable).toBe(
      true,
    );
    expect(
      (await decide(owned, { ownerUserIds: [ObjectID.generate()] })).readable,
    ).toBe(false);
  });

  test("a block with labels takes it away whatever else the caller holds", async () => {
    expect(
      await decide(
        [grant({ scope: PermissionScope.All }), block([BLOCKED_LABEL_ID])],
        { labelIds: [BLOCKED_LABEL_ID] },
      ),
    ).toEqual({ readable: false, ownersAsked: 0 });

    // A resource without those labels stays readable.
    expect(
      (
        await decide(
          [grant({ scope: PermissionScope.All }), block([BLOCKED_LABEL_ID])],
          { labelIds: [GRANTED_LABEL_ID] },
        )
      ).readable,
    ).toBe(true);
  });

  test("a caller with no grant does not read it", async () => {
    expect((await decide([])).readable).toBe(false);
  });

  test("a block with no labels refuses, as the scope does", async () => {
    await expect(
      decide([grant({ scope: PermissionScope.All }), block()]),
    ).rejects.toThrow(NotAuthorizedException);
  });

  test("nothing is looked up", async () => {
    await decide([grant({ scope: PermissionScope.Owned })], {
      ownerUserIds: [USER_ID],
    });

    expect(lookupCallCount()).toBe(0);
  });

  test("whether the caller reads every resource is known without a lookup", () => {
    function readsEvery(permissions: Array<UserPermission>): boolean {
      return AnalyticsModelPermission.readsEveryResourceForPermissions({
        props: propsFor(permissions),
        permissions: [Permission.ReadRumSessionReplay],
        recordName: "session replays",
      });
    }

    expect(readsEvery([grant({ scope: PermissionScope.All })])).toBe(true);
    expect(
      readsEvery([
        grant({ scope: PermissionScope.All }),
        block([BLOCKED_LABEL_ID]),
      ]),
    ).toBe(false);
    expect(
      readsEvery([
        grant({
          scope: PermissionScope.Labels,
          labelIds: [GRANTED_LABEL_ID],
        }),
      ]),
    ).toBe(false);
    expect(() => {
      return readsEvery([grant({ scope: PermissionScope.All }), block()]);
    }).toThrow(NotAuthorizedException);
    expect(lookupCallCount()).toBe(0);
  });
});
