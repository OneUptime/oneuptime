import AnalyticsModels from "../../../../Models/AnalyticsModels/Index";
import AnalyticsBaseModel from "../../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import KubernetesCostAllocation from "../../../../Models/AnalyticsModels/KubernetesCostAllocation";
import MonitorLog from "../../../../Models/AnalyticsModels/MonitorLog";
import NetworkFlow from "../../../../Models/AnalyticsModels/NetworkFlow";
import SloHistory from "../../../../Models/AnalyticsModels/SloHistory";
import KubernetesCluster from "../../../../Models/DatabaseModels/KubernetesCluster";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import ServiceLevelObjective from "../../../../Models/DatabaseModels/ServiceLevelObjective";
import ModelPermission from "../../../../Server/Types/AnalyticsDatabase/ModelPermission";
import DatabaseRequestType from "../../../../Server/Types/BaseDatabase/DatabaseRequestType";
import OwnerTableRegistry, {
  OwnerTablePair,
} from "../../../../Server/Types/Database/Permissions/OwnerTableRegistry";
import { TelemetryReadScope } from "../../../../Server/Utils/Telemetry/TelemetryReadScope";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../../Types/Database/AccessControl/PermissionScope";
import { OwnedThroughMetadata } from "../../../../Types/Database/AccessControl/OwnedThrough";
import ObjectID from "../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../Types/Permission";
import { MockFunction } from "../../../MockType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * AN ANALYTICS ROW THAT NAMES ONE KIND OF RECORD IS READ THROUGH THAT
 * RECORD: a monitor's log through its monitor, an SLO's history through
 * its SLO, a network flow through its device, a cluster's cost allocation
 * through its cluster. A caller whose grants are limited to owned records
 * or to labels reads the rows of the records those reach - of that kind
 * only, whatever other kinds of resource they own - and a block with labels
 * takes away the rows of the records carrying them.
 *
 * Only the lookups behind the owner tables and the records' own services
 * are stubbed; the registry and the permission rules are the real ones.
 */

interface ParentCase {
  modelType: { new (): AnalyticsBaseModel };
  parentModel: { new (): unknown; name: string };
  fkColumn: string;
}

const PARENT_CASES: Array<ParentCase> = [
  { modelType: MonitorLog, parentModel: Monitor, fkColumn: "monitorId" },
  {
    modelType: SloHistory,
    parentModel: ServiceLevelObjective,
    fkColumn: "sloId",
  },
  {
    modelType: NetworkFlow,
    parentModel: NetworkDevice,
    fkColumn: "networkDeviceId",
  },
  {
    modelType: KubernetesCostAllocation,
    parentModel: KubernetesCluster,
    fkColumn: "kubernetesClusterId",
  },
];

/*
 * Analytics tables members may read whose rows name no single record they
 * are about, read across the project on purpose: the audit trail of the
 * project's settings and the threat intelligence its feeds bring in. Every
 * other table members may read names the record its rows are about
 * (@OwnedThrough). Shrink-only.
 */
const PROJECT_WIDE_ANALYTICS_MODELS: ReadonlyArray<string> = [
  "AuditLog",
  "ThreatIntelIndicator",
];

const PROJECT_ID: ObjectID = ObjectID.generate();
const USER_ID: ObjectID = ObjectID.generate();
const TEAM_ID: ObjectID = ObjectID.generate();
const OWNED_ID: ObjectID = ObjectID.generate();
const TEAM_OWNED_ID: ObjectID = ObjectID.generate();
const LABELLED_ID: ObjectID = ObjectID.generate();
const LABEL_ID: ObjectID = ObjectID.generate();

interface Lookups {
  user: MockFunction;
  team: MockFunction;
  model: MockFunction | null;
}

const lookupsByKind: Map<string, Lookups> = new Map();

const row: (
  permission: Permission,
  data?: {
    scope?: PermissionScope;
    labelIds?: Array<ObjectID>;
    isBlock?: boolean;
  },
) => UserPermission = (
  permission: Permission,
  data?: {
    scope?: PermissionScope;
    labelIds?: Array<ObjectID>;
    isBlock?: boolean;
  },
): UserPermission => {
  return {
    _type: "UserPermission",
    permission: permission,
    labelIds: data?.labelIds || [],
    isBlockPermission: Boolean(data?.isBlock),
    ...(data?.scope ? { scope: data.scope } : {}),
  };
};

const member: (
  permissions: Array<UserPermission>,
) => DatabaseCommonInteractionProps = (
  permissions: Array<UserPermission>,
): DatabaseCommonInteractionProps => {
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
};

const lookupsOf: (kind: string) => Lookups = (kind: string): Lookups => {
  const lookups: Lookups | undefined = lookupsByKind.get(kind);

  if (!lookups) {
    throw new Error(`No owner tables for ${kind}`);
  }

  return lookups;
};

beforeEach(() => {
  lookupsByKind.clear();

  for (const [kind, entry] of OwnerTableRegistry.entries()) {
    lookupsByKind.set(kind, {
      user: jest
        .spyOn(
          (entry as OwnerTablePair).ownerUserService as {
            findBy: () => Promise<unknown>;
          },
          "findBy",
        )
        .mockResolvedValue([] as never) as unknown as MockFunction,
      team: jest
        .spyOn(
          (entry as OwnerTablePair).ownerTeamService as {
            findBy: () => Promise<unknown>;
          },
          "findBy",
        )
        .mockResolvedValue([] as never) as unknown as MockFunction,
      model: entry.modelService
        ? (jest
            .spyOn(
              entry.modelService as { findBy: () => Promise<unknown> },
              "findBy",
            )
            .mockResolvedValue([] as never) as unknown as MockFunction)
        : null,
    });
  }
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(PARENT_CASES)(
  "$modelType.name is read through its $parentModel.name",
  ({ modelType, parentModel, fkColumn }: ParentCase) => {
    const kind: string = parentModel.name;

    const otherKinds: () => Array<Lookups> = (): Array<Lookups> => {
      return Array.from(lookupsByKind.entries())
        .filter(([name]: [string, Lookups]): boolean => {
          return name !== kind;
        })
        .map(([, lookups]: [string, Lookups]): Lookups => {
          return lookups;
        });
    };

    test("names its parent's key, and its parent alone", () => {
      const ownedThrough: OwnedThroughMetadata = (
        new modelType() as unknown as { ownedThrough: OwnedThroughMetadata }
      ).ownedThrough;

      expect(ownedThrough.fkColumn).toBe(fkColumn);
      expect(ownedThrough.parentModels).toEqual([parentModel]);
      expect(ownedThrough.onlyParentModels).toBe(true);
      expect(OwnerTableRegistry.get(kind)?.modelService).toBeDefined();
    });

    test("an owned-only grant reads the rows of the owned records of its parent's kind", async () => {
      const entry: OwnerTablePair = OwnerTableRegistry.get(kind)!;

      lookupsOf(kind).user.mockResolvedValue([
        { [entry.fkColumn]: OWNED_ID },
      ] as never);
      lookupsOf(kind).team.mockResolvedValue([
        { [entry.fkColumn]: TEAM_OWNED_ID },
      ] as never);

      const scope: TelemetryReadScope = await ModelPermission.getReadScope(
        modelType,
        member([
          row(Permission.ProjectMember, { scope: PermissionScope.Owned }),
        ]),
        DatabaseRequestType.Read,
      );

      expect(new Set(scope.readableIds)).toEqual(
        new Set([OWNED_ID.toString(), TEAM_OWNED_ID.toString()]),
      );

      // Nothing the caller owns of another kind is read for these rows.
      for (const lookups of otherKinds()) {
        expect(lookups.user).not.toHaveBeenCalled();
        expect(lookups.team).not.toHaveBeenCalled();
      }
    });

    test("a grant limited to labels reads the rows of its parent's records carrying them", async () => {
      lookupsOf(kind).model!.mockResolvedValue([
        { _id: LABELLED_ID.toString() },
      ] as never);

      const scope: TelemetryReadScope = await ModelPermission.getReadScope(
        modelType,
        member([
          row(Permission.ProjectMember, {
            scope: PermissionScope.Labels,
            labelIds: [LABEL_ID],
          }),
        ]),
        DatabaseRequestType.Read,
      );

      expect(scope.readableIds).toEqual([LABELLED_ID.toString()]);

      for (const lookups of otherKinds()) {
        if (lookups.model) {
          expect(lookups.model).not.toHaveBeenCalled();
        }
      }
    });

    test("a block with labels takes away the rows of its parent's records carrying them", async () => {
      lookupsOf(kind).model!.mockResolvedValue([
        { _id: LABELLED_ID.toString() },
      ] as never);

      const scope: TelemetryReadScope = await ModelPermission.getReadScope(
        modelType,
        member([
          row(Permission.ProjectMember),
          row(Permission.ProjectMember, {
            isBlock: true,
            labelIds: [LABEL_ID],
          }),
        ]),
        DatabaseRequestType.Read,
      );

      expect(scope.readableIds).toBeNull();
      expect(scope.blockedIds).toEqual([LABELLED_ID.toString()]);
    });

    test("an owned-only grant that owns nothing of its parent's kind reads no row", async () => {
      const scope: TelemetryReadScope = await ModelPermission.getReadScope(
        modelType,
        member([
          row(Permission.ProjectMember, { scope: PermissionScope.Owned }),
        ]),
        DatabaseRequestType.Read,
      );

      expect(scope.readableIds).toEqual([]);
    });

    test("a grant over the project reads every row", async () => {
      const scope: TelemetryReadScope = await ModelPermission.getReadScope(
        modelType,
        member([row(Permission.ProjectMember)]),
        DatabaseRequestType.Read,
      );

      expect(scope.readableIds).toBeNull();
      expect(scope.blockedIds).toEqual([]);
    });
  },
);

describe("analytics tables members may read", () => {
  test("name the record their rows are about, or are read across the project on purpose", () => {
    const unnamed: Array<string> = [];

    for (const modelType of AnalyticsModels) {
      const model: AnalyticsBaseModel = new modelType();
      const readPermissions: Array<Permission> =
        model.accessControl?.read || [];

      if (readPermissions.length === 0) {
        // Nobody but the server reads it.
        continue;
      }

      if (
        !(model as unknown as { ownedThrough?: OwnedThroughMetadata })
          .ownedThrough
      ) {
        unnamed.push(modelType.name);
      }
    }

    expect(unnamed.sort()).toEqual([...PROJECT_WIDE_ANALYTICS_MODELS].sort());
  });
});
