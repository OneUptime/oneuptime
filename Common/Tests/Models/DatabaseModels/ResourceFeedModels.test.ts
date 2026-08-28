import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "../../../Types/Permission";
import CephClusterFeed, {
  CephClusterFeedEventType,
} from "../../../Models/DatabaseModels/CephClusterFeed";
import CloudResourceFeed, {
  CloudResourceFeedEventType,
} from "../../../Models/DatabaseModels/CloudResourceFeed";
import DockerHostFeed, {
  DockerHostFeedEventType,
} from "../../../Models/DatabaseModels/DockerHostFeed";
import DockerSwarmClusterFeed, {
  DockerSwarmClusterFeedEventType,
} from "../../../Models/DatabaseModels/DockerSwarmClusterFeed";
import HostFeed, {
  HostFeedEventType,
} from "../../../Models/DatabaseModels/HostFeed";
import KubernetesClusterFeed, {
  KubernetesClusterFeedEventType,
} from "../../../Models/DatabaseModels/KubernetesClusterFeed";
import PodmanHostFeed, {
  PodmanHostFeedEventType,
} from "../../../Models/DatabaseModels/PodmanHostFeed";
import ProxmoxClusterFeed, {
  ProxmoxClusterFeedEventType,
} from "../../../Models/DatabaseModels/ProxmoxClusterFeed";
import ServiceFeed, {
  ServiceFeedEventType,
} from "../../../Models/DatabaseModels/ServiceFeed";
import { describe, expect, test } from "@jest/globals";

/*
 * Nine infrastructure and catalog resources gained an activity feed at once -
 * Kubernetes clusters, Docker and Podman hosts, Docker Swarm / Proxmox / Ceph
 * clusters, servers, cloud resources and catalog services. They were generated
 * from one template, which is exactly why they need a sweep rather than nine
 * hand-written assertions: a template applied nine times fails in the same
 * place nine times, and a tenth resource added later by hand will not match it
 * at all.
 *
 * The properties pinned here are the ones that are invisible until they are
 * wrong in production:
 *
 *   - registration in Models/Index.ts, without which the table is never created
 *   - a UNIQUE CRUD route, because a duplicate silently shadows another model
 *   - tenant scoping, so one project cannot read another's history
 *   - read access that follows the parent resource, so a feed cannot leak the
 *     existence of a resource the caller may not see
 *   - an append-only access shape: nothing may update or delete a feed row
 */

type ModelType = { new (): BaseModel };

interface FeedModelSpec {
  name: string;
  modelType: ModelType;
  /** Relation property the read check follows (CanAccessIfCanReadOn). */
  relationProperty: string;
  /** Foreign key column back to the resource. */
  foreignKeyColumn: string;
  /** Column holding the event type. */
  eventTypeColumn: string;
  crudApiPath: string;
  eventTypeEnum: Record<string, string>;
  /** Members every one of these enums must carry, resource-specific ones aside. */
  sharedEventTypes: Array<string>;
  resourceEventTypes: Array<string>;
}

const FEED_MODELS: Array<FeedModelSpec> = [
  {
    name: "KubernetesClusterFeed",
    modelType: KubernetesClusterFeed,
    relationProperty: "kubernetesCluster",
    foreignKeyColumn: "kubernetesClusterId",
    eventTypeColumn: "kubernetesClusterFeedEventType",
    crudApiPath: "/kubernetes-cluster-feed",
    eventTypeEnum: KubernetesClusterFeedEventType,
    sharedEventTypes: [],
    resourceEventTypes: [
      "KubernetesClusterCreated",
      "KubernetesClusterUpdated",
      "KubernetesClusterArchived",
      "KubernetesClusterRestored",
    ],
  },
  {
    name: "DockerHostFeed",
    modelType: DockerHostFeed,
    relationProperty: "dockerHost",
    foreignKeyColumn: "dockerHostId",
    eventTypeColumn: "dockerHostFeedEventType",
    crudApiPath: "/docker-host-feed",
    eventTypeEnum: DockerHostFeedEventType,
    sharedEventTypes: [],
    resourceEventTypes: [
      "DockerHostCreated",
      "DockerHostUpdated",
      "DockerHostArchived",
      "DockerHostRestored",
    ],
  },
  {
    name: "DockerSwarmClusterFeed",
    modelType: DockerSwarmClusterFeed,
    relationProperty: "dockerSwarmCluster",
    foreignKeyColumn: "dockerSwarmClusterId",
    eventTypeColumn: "dockerSwarmClusterFeedEventType",
    crudApiPath: "/docker-swarm-cluster-feed",
    eventTypeEnum: DockerSwarmClusterFeedEventType,
    sharedEventTypes: [],
    resourceEventTypes: [
      "DockerSwarmClusterCreated",
      "DockerSwarmClusterUpdated",
      "DockerSwarmClusterArchived",
      "DockerSwarmClusterRestored",
    ],
  },
  {
    name: "CephClusterFeed",
    modelType: CephClusterFeed,
    relationProperty: "cephCluster",
    foreignKeyColumn: "cephClusterId",
    eventTypeColumn: "cephClusterFeedEventType",
    crudApiPath: "/ceph-cluster-feed",
    eventTypeEnum: CephClusterFeedEventType,
    sharedEventTypes: [],
    resourceEventTypes: [
      "CephClusterCreated",
      "CephClusterUpdated",
      "CephClusterArchived",
      "CephClusterRestored",
    ],
  },
  {
    name: "PodmanHostFeed",
    modelType: PodmanHostFeed,
    relationProperty: "podmanHost",
    foreignKeyColumn: "podmanHostId",
    eventTypeColumn: "podmanHostFeedEventType",
    crudApiPath: "/podman-host-feed",
    eventTypeEnum: PodmanHostFeedEventType,
    sharedEventTypes: [],
    resourceEventTypes: [
      "PodmanHostCreated",
      "PodmanHostUpdated",
      "PodmanHostArchived",
      "PodmanHostRestored",
    ],
  },
  {
    name: "ProxmoxClusterFeed",
    modelType: ProxmoxClusterFeed,
    relationProperty: "proxmoxCluster",
    foreignKeyColumn: "proxmoxClusterId",
    eventTypeColumn: "proxmoxClusterFeedEventType",
    crudApiPath: "/proxmox-cluster-feed",
    eventTypeEnum: ProxmoxClusterFeedEventType,
    sharedEventTypes: [],
    resourceEventTypes: [
      "ProxmoxClusterCreated",
      "ProxmoxClusterUpdated",
      "ProxmoxClusterArchived",
      "ProxmoxClusterRestored",
    ],
  },
  {
    name: "HostFeed",
    modelType: HostFeed,
    relationProperty: "host",
    foreignKeyColumn: "hostId",
    eventTypeColumn: "hostFeedEventType",
    crudApiPath: "/host-feed",
    eventTypeEnum: HostFeedEventType,
    sharedEventTypes: [],
    resourceEventTypes: [
      "HostCreated",
      "HostUpdated",
      "HostArchived",
      "HostRestored",
    ],
  },
  {
    name: "CloudResourceFeed",
    modelType: CloudResourceFeed,
    relationProperty: "cloudResource",
    foreignKeyColumn: "cloudResourceId",
    eventTypeColumn: "cloudResourceFeedEventType",
    crudApiPath: "/cloud-resource-feed",
    eventTypeEnum: CloudResourceFeedEventType,
    sharedEventTypes: [],
    resourceEventTypes: [
      "CloudResourceCreated",
      "CloudResourceUpdated",
      "CloudResourceArchived",
      "CloudResourceRestored",
    ],
  },
  {
    name: "ServiceFeed",
    modelType: ServiceFeed,
    relationProperty: "service",
    foreignKeyColumn: "serviceId",
    eventTypeColumn: "serviceFeedEventType",
    crudApiPath: "/service-feed",
    eventTypeEnum: ServiceFeedEventType,
    sharedEventTypes: [],
    resourceEventTypes: [
      "ServiceCreated",
      "ServiceUpdated",
      "ServiceArchived",
      "ServiceRestored",
    ],
  },
];

/** Owner and rule events every one of these feeds records. */
const SHARED_EVENT_TYPES: Array<string> = [
  "OwnerUserAdded",
  "OwnerUserRemoved",
  "OwnerTeamAdded",
  "OwnerTeamRemoved",
  "OwnerRuleExecuted",
  "LabelRuleExecuted",
];

const MODEL_TYPES: Array<ModelType> = AllModelTypes as Array<ModelType>;

const PERMISSION_PROPS: Array<PermissionProps> =
  PermissionHelper.getAllPermissionProps();

function permissionExists(permission: Permission): boolean {
  return PERMISSION_PROPS.some((props: PermissionProps) => {
    return props.permission === permission;
  });
}

describe("Resource activity feed models", () => {
  test("the inventory is not empty", () => {
    // Guards every test.each below against passing on an empty list.
    expect(FEED_MODELS.length).toBe(9);
  });

  test.each(FEED_MODELS)(
    "$name is registered in Models/Index.ts",
    (spec: FeedModelSpec) => {
      /*
       * Boot-time createTables() iterates that array. A model missing from it
       * type-checks, imports fine, and simply has no table in Postgres.
       */
      expect(MODEL_TYPES).toContain(spec.modelType);
    },
  );

  test("each feed claims its own CRUD route", () => {
    const paths: Array<string> = FEED_MODELS.map((spec: FeedModelSpec) => {
      const model: BaseModel = new spec.modelType();
      return model.getCrudApiPath()!.toString();
    });

    expect(paths.sort()).toEqual(
      FEED_MODELS.map((spec: FeedModelSpec) => {
        return spec.crudApiPath;
      }).sort(),
    );
    expect(new Set(paths).size).toBe(paths.length);
  });

  test("no feed route collides with an existing model's route", () => {
    const routeCounts: Map<string, number> = new Map<string, number>();

    for (const modelType of MODEL_TYPES) {
      const path: string | undefined = new modelType()
        .getCrudApiPath()
        ?.toString();

      if (!path) {
        continue;
      }

      routeCounts.set(path, (routeCounts.get(path) || 0) + 1);
    }

    for (const spec of FEED_MODELS) {
      expect(routeCounts.get(spec.crudApiPath)).toBe(1);
    }
  });

  test.each(FEED_MODELS)(
    "$name is scoped to a project and inherits read access from its resource",
    (spec: FeedModelSpec) => {
      const model: BaseModel = new spec.modelType();

      expect(model.getTenantColumn()).toBe("projectId");

      /*
       * Without this the feed is readable by anyone holding the feed
       * permission, including for resources they cannot see - which leaks
       * both the resource's existence and its owners.
       */
      expect(model.canAccessIfCanReadOn).toBe(spec.relationProperty);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const ownedThrough: any = (model as any).ownedThrough;
      expect(ownedThrough).toBeTruthy();
      expect(ownedThrough.fkColumn).toBe(spec.foreignKeyColumn);
      expect(ownedThrough.parentModels.length).toBe(1);
    },
  );

  test.each(FEED_MODELS)("$name is append only", (spec: FeedModelSpec) => {
    const model: BaseModel = new spec.modelType();

    /*
     * A feed that can be edited or deleted is not a record of what happened,
     * it is a record of what somebody last wanted it to say.
     */
    expect(model.getUpdatePermissions()).toEqual([]);
    expect(model.getDeletePermissions()).toEqual([]);
    expect(model.getCreatePermissions().length).toBeGreaterThan(0);
    expect(model.getReadPermissions().length).toBeGreaterThan(0);
  });

  test.each(FEED_MODELS)(
    "$name gates itself on its own granular permissions, which exist in the catalogue",
    (spec: FeedModelSpec) => {
      const model: BaseModel = new spec.modelType();
      const resourceName: string = spec.name.replace(/Feed$/, "");

      const createPermission: Permission =
        `Create${resourceName}Feed` as Permission;
      const readPermission: Permission =
        `Read${resourceName}Feed` as Permission;
      const editPermission: Permission =
        `Edit${resourceName}Feed` as Permission;

      expect(model.getCreatePermissions()).toContain(createPermission);
      expect(model.getReadPermissions()).toContain(readPermission);

      /*
       * A permission a model gates on but the catalogue does not list cannot
       * be granted to anybody, so the gate is closed forever.
       */
      expect(permissionExists(createPermission)).toBe(true);
      expect(permissionExists(readPermission)).toBe(true);
      expect(permissionExists(editPermission)).toBe(true);
    },
  );

  test.each(FEED_MODELS)(
    "$name records who acted and when, not just what happened",
    (spec: FeedModelSpec) => {
      const model: BaseModel = new spec.modelType();
      const columns: Array<string> = model.getTableColumns().columns;

      for (const column of [
        "projectId",
        spec.foreignKeyColumn,
        "feedInfoInMarkdown",
        "moreInformationInMarkdown",
        spec.eventTypeColumn,
        "displayColor",
        "userId",
        "postedAt",
      ]) {
        expect(columns).toContain(column);
      }
    },
  );

  test.each(FEED_MODELS)(
    "$name carries the owner and rule events plus its own lifecycle events",
    (spec: FeedModelSpec) => {
      const members: Array<string> = Object.values(spec.eventTypeEnum);

      for (const shared of SHARED_EVENT_TYPES) {
        expect(members).toContain(shared);
      }

      for (const own of spec.resourceEventTypes) {
        expect(members).toContain(own);
      }

      /*
       * Enum values are stored verbatim in a ShortText column, so a member
       * whose value drifts from its key silently orphans every row already
       * written under the old value.
       */
      for (const [key, value] of Object.entries(spec.eventTypeEnum)) {
        expect(value).toBe(key);
      }
    },
  );
});
