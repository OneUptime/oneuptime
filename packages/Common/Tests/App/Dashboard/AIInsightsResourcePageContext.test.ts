import PageContextUtil, {
  DashboardPageContext,
  SuggestedQuestion,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/PageContext";
import ResourcePageContextUtil from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/ResourcePageContext";
import { encodeServiceNameForUrl } from "../../../../App/FeatureSet/Dashboard/src/Pages/Host/Utils/WindowsServices";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CephCluster from "../../../Models/DatabaseModels/CephCluster";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import DockerSwarmCluster from "../../../Models/DatabaseModels/DockerSwarmCluster";
import Host from "../../../Models/DatabaseModels/Host";
import IoTFleet from "../../../Models/DatabaseModels/IoTFleet";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import PodmanHost from "../../../Models/DatabaseModels/PodmanHost";
import ProxmoxCluster from "../../../Models/DatabaseModels/ProxmoxCluster";
import ServerlessFunction from "../../../Models/DatabaseModels/ServerlessFunction";
import VMwareVCenter from "../../../Models/DatabaseModels/VMwareVCenter";
import AIChatPageContextType, {
  AIChatPageContextHelper,
} from "../../../Types/AI/AIChatPageContext";
import {
  AIResourceDefinition,
  AIResourceSubresourceKind,
  AIResourceType,
  getAIResourceDefinition,
} from "../../../Types/AI/AIResourceContext";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const ENTITY_ID: string = "20000000-0000-4000-8000-000000000002";

interface ResourceCase {
  type: AIResourceType;
  path: string;
  modelType: { new (): BaseModel & { name?: string | undefined } };
  chip: string;
}

const RESOURCES: Array<ResourceCase> = [
  {
    type: AIResourceType.Host,
    path: "host",
    modelType: Host,
    chip: "This host",
  },
  {
    type: AIResourceType.DockerHost,
    path: "docker",
    modelType: DockerHost,
    chip: "This Docker host",
  },
  {
    type: AIResourceType.PodmanHost,
    path: "podman",
    modelType: PodmanHost,
    chip: "This Podman host",
  },
  {
    type: AIResourceType.KubernetesCluster,
    path: "kubernetes",
    modelType: KubernetesCluster,
    chip: "This Kubernetes cluster",
  },
  {
    type: AIResourceType.DockerSwarmCluster,
    path: "docker-swarm",
    modelType: DockerSwarmCluster,
    chip: "This Docker Swarm cluster",
  },
  {
    type: AIResourceType.ProxmoxCluster,
    path: "proxmox",
    modelType: ProxmoxCluster,
    chip: "This Proxmox cluster",
  },
  {
    type: AIResourceType.VMwareVCenter,
    path: "vmware",
    modelType: VMwareVCenter,
    chip: "This vCenter",
  },
  {
    type: AIResourceType.CephCluster,
    path: "ceph",
    modelType: CephCluster,
    chip: "This Ceph cluster",
  },
  {
    type: AIResourceType.ServerlessFunction,
    path: "serverless",
    modelType: ServerlessFunction,
    chip: "This serverless function",
  },
  {
    type: AIResourceType.CloudResource,
    path: "cloud",
    modelType: CloudResource,
    chip: "This cloud environment",
  },
  {
    type: AIResourceType.IoTFleet,
    path: "iot",
    modelType: IoTFleet,
    chip: "This IoT fleet",
  },
  {
    type: AIResourceType.NetworkDevice,
    path: "network-devices",
    modelType: NetworkDevice,
    chip: "This network device",
  },
  {
    type: AIResourceType.DatabaseServer,
    path: "databases",
    modelType: DatabaseServer,
    chip: "This database",
  },
];

interface ChildCase {
  type: AIResourceType;
  path: string;
  kind: AIResourceSubresourceKind;
  collection: string;
  key?: string | undefined;
}

const CHILDREN: Array<ChildCase> = [
  {
    type: AIResourceType.KubernetesCluster,
    path: "kubernetes",
    collection: "namespaces",
    kind: AIResourceSubresourceKind.Namespace,
    key: "payments",
  },
  {
    type: AIResourceType.KubernetesCluster,
    path: "kubernetes",
    collection: "pods",
    kind: AIResourceSubresourceKind.Pod,
    key: "checkout-648c8dc6cb-abc12",
  },
  {
    type: AIResourceType.KubernetesCluster,
    path: "kubernetes",
    collection: "deployments",
    kind: AIResourceSubresourceKind.Deployment,
    key: "checkout",
  },
  {
    type: AIResourceType.KubernetesCluster,
    path: "kubernetes",
    collection: "statefulsets",
    kind: AIResourceSubresourceKind.StatefulSet,
    key: "redis",
  },
  {
    type: AIResourceType.KubernetesCluster,
    path: "kubernetes",
    collection: "daemonsets",
    kind: AIResourceSubresourceKind.DaemonSet,
    key: "collector",
  },
  {
    type: AIResourceType.KubernetesCluster,
    path: "kubernetes",
    collection: "jobs",
    kind: AIResourceSubresourceKind.Job,
    key: "migration-123",
  },
  {
    type: AIResourceType.KubernetesCluster,
    path: "kubernetes",
    collection: "cronjobs",
    kind: AIResourceSubresourceKind.CronJob,
    key: "cleanup",
  },
  {
    type: AIResourceType.KubernetesCluster,
    path: "kubernetes",
    collection: "nodes",
    kind: AIResourceSubresourceKind.Node,
    key: "ip-10-0-1-2.internal",
  },
  {
    type: AIResourceType.KubernetesCluster,
    path: "kubernetes",
    collection: "containers",
    kind: AIResourceSubresourceKind.Container,
    key: "nginx",
  },
  {
    type: AIResourceType.KubernetesCluster,
    path: "kubernetes",
    collection: "pvcs",
    kind: AIResourceSubresourceKind.PersistentVolumeClaim,
    key: "redis-data",
  },
  {
    type: AIResourceType.KubernetesCluster,
    path: "kubernetes",
    collection: "pvs",
    kind: AIResourceSubresourceKind.PersistentVolume,
    key: "pv-01",
  },
  {
    type: AIResourceType.KubernetesCluster,
    path: "kubernetes",
    collection: "hpas",
    kind: AIResourceSubresourceKind.HorizontalPodAutoscaler,
    key: "checkout",
  },
  {
    type: AIResourceType.KubernetesCluster,
    path: "kubernetes",
    collection: "vpas",
    kind: AIResourceSubresourceKind.VerticalPodAutoscaler,
    key: "checkout",
  },
  {
    type: AIResourceType.DockerHost,
    path: "docker",
    collection: "containers",
    kind: AIResourceSubresourceKind.Container,
    key: "checkout-api-1",
  },
  {
    type: AIResourceType.PodmanHost,
    path: "podman",
    collection: "containers",
    kind: AIResourceSubresourceKind.Container,
    key: "checkout-api-1",
  },
  {
    type: AIResourceType.DockerSwarmCluster,
    path: "docker-swarm",
    collection: "nodes",
    kind: AIResourceSubresourceKind.Node,
    key: "node/abc123",
  },
  {
    type: AIResourceType.DockerSwarmCluster,
    path: "docker-swarm",
    collection: "services",
    kind: AIResourceSubresourceKind.Service,
    key: "service/abc123",
  },
  {
    type: AIResourceType.DockerSwarmCluster,
    path: "docker-swarm",
    collection: "tasks",
    kind: AIResourceSubresourceKind.Task,
    key: "task/abc123",
  },
  {
    type: AIResourceType.DockerSwarmCluster,
    path: "docker-swarm",
    collection: "stacks",
    kind: AIResourceSubresourceKind.Stack,
  },
  {
    type: AIResourceType.DockerSwarmCluster,
    path: "docker-swarm",
    collection: "networks",
    kind: AIResourceSubresourceKind.Network,
  },
  {
    type: AIResourceType.DockerSwarmCluster,
    path: "docker-swarm",
    collection: "secrets",
    kind: AIResourceSubresourceKind.Secret,
  },
  {
    type: AIResourceType.DockerSwarmCluster,
    path: "docker-swarm",
    collection: "configs",
    kind: AIResourceSubresourceKind.Config,
  },
  {
    type: AIResourceType.DockerSwarmCluster,
    path: "docker-swarm",
    collection: "volumes",
    kind: AIResourceSubresourceKind.Volume,
  },
  {
    type: AIResourceType.ProxmoxCluster,
    path: "proxmox",
    collection: "nodes",
    kind: AIResourceSubresourceKind.Node,
    key: "node/pve1",
  },
  {
    type: AIResourceType.ProxmoxCluster,
    path: "proxmox",
    collection: "guests",
    kind: AIResourceSubresourceKind.Guest,
    key: "qemu/100",
  },
  {
    type: AIResourceType.ProxmoxCluster,
    path: "proxmox",
    collection: "storage",
    kind: AIResourceSubresourceKind.Storage,
    key: "storage/pve1/local",
  },
  {
    type: AIResourceType.VMwareVCenter,
    path: "vmware",
    collection: "hosts",
    kind: AIResourceSubresourceKind.Host,
    key: "host/London/esx01.example.com",
  },
  {
    type: AIResourceType.VMwareVCenter,
    path: "vmware",
    collection: "virtual-machines",
    kind: AIResourceSubresourceKind.VirtualMachine,
    key: "vm/50233c80-f8ae-4985-b6e5-c4618d081f22",
  },
  {
    type: AIResourceType.VMwareVCenter,
    path: "vmware",
    collection: "datastores",
    kind: AIResourceSubresourceKind.Datastore,
    key: "datastore/London/VM Storage",
  },
  {
    type: AIResourceType.VMwareVCenter,
    path: "vmware",
    collection: "clusters",
    kind: AIResourceSubresourceKind.Cluster,
    key: "cluster/London/production",
  },
  {
    type: AIResourceType.CephCluster,
    path: "ceph",
    collection: "osds",
    kind: AIResourceSubresourceKind.Osd,
    key: "osd.3",
  },
  {
    type: AIResourceType.CephCluster,
    path: "ceph",
    collection: "pools",
    kind: AIResourceSubresourceKind.Pool,
    key: "1",
  },
  {
    type: AIResourceType.IoTFleet,
    path: "iot",
    collection: "devices",
    kind: AIResourceSubresourceKind.Device,
    key: "sensor/london #1",
  },
  {
    type: AIResourceType.IoTFleet,
    path: "iot",
    collection: "device-registry",
    kind: AIResourceSubresourceKind.Device,
  },
  {
    type: AIResourceType.Host,
    path: "host",
    collection: "processes",
    kind: AIResourceSubresourceKind.Process,
    key: "412",
  },
  {
    type: AIResourceType.Host,
    path: "host",
    collection: "services",
    kind: AIResourceSubresourceKind.WindowsService,
    key: "OneUptime~Agent",
  },
  {
    type: AIResourceType.Host,
    path: "host",
    collection: "systemd",
    kind: AIResourceSubresourceKind.SystemdUnit,
    key: "postgresql@16-main.service",
  },
  {
    type: AIResourceType.ServerlessFunction,
    path: "serverless",
    collection: "instances",
    kind: AIResourceSubresourceKind.Instance,
  },
  {
    type: AIResourceType.CloudResource,
    path: "cloud",
    collection: "instances",
    kind: AIResourceSubresourceKind.Instance,
  },
  {
    type: AIResourceType.NetworkDevice,
    path: "network-devices",
    collection: "interfaces",
    kind: AIResourceSubresourceKind.Interface,
  },
];

function navigateTo(path: string): DashboardPageContext | null {
  Navigation.setLocation({
    pathname: `/dashboard/${PROJECT_ID}/${path}`,
    search: "",
    hash: "",
    state: null,
    key: "infrastructure-ai-test",
  });
  return PageContextUtil.detectPageContext();
}

function requireContext(path: string): DashboardPageContext {
  const context: DashboardPageContext | null = navigateTo(path);
  if (!context) {
    throw new Error(`No context detected for ${path}`);
  }
  return context;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("AI Insights infrastructure routes", () => {
  test("covers every supported resource type", () => {
    expect(
      RESOURCES.map((resource: ResourceCase): AIResourceType => {
        return resource.type;
      }).sort(),
    ).toEqual(Object.values(AIResourceType).sort());
  });

  test.each(RESOURCES)(
    "detects the $type list without inventing a record id",
    (resource: ResourceCase) => {
      const definition: AIResourceDefinition = getAIResourceDefinition(
        resource.type,
      );
      for (const suffix of [
        "",
        "/",
        "/archived",
        "/documentation",
        "/settings/owner-rules",
        `/settings/owner-rules/${ENTITY_ID}`,
        "/not-a-uuid",
      ]) {
        expect(navigateTo(`${resource.path}${suffix}`)).toEqual({
          type: AIChatPageContextType.ResourcesList,
          resourceType: resource.type,
          noun: definition.pluralLabel,
          chipLabel: definition.pluralLabel,
          icon: definition.icon,
          isEntity: false,
        });
      }
    },
  );

  test.each(RESOURCES)(
    "keeps $type detail tabs attached to the parent UUID",
    (resource: ResourceCase) => {
      for (const suffix of ["", "/", "/metrics", "/logs", "/settings"]) {
        expect(
          navigateTo(`${resource.path}/${ENTITY_ID}${suffix}`),
        ).toMatchObject({
          type: AIChatPageContextType.Resource,
          resourceType: resource.type,
          entityId: ENTITY_ID,
          chipLabel: resource.chip,
          isEntity: true,
        });
        expect(
          PageContextUtil.detectPageContext()?.subresource,
        ).toBeUndefined();
      }
    },
  );

  test.each(CHILDREN)(
    "detects the $type $collection collection with its parent",
    (child: ChildCase) => {
      expect(
        navigateTo(`${child.path}/${ENTITY_ID}/${child.collection}`),
      ).toMatchObject({
        type: AIChatPageContextType.Resource,
        resourceType: child.type,
        entityId: ENTITY_ID,
        subresource: { kind: child.kind },
      });
      expect(
        PageContextUtil.detectPageContext()?.subresource?.key,
      ).toBeUndefined();
    },
  );

  test.each(
    CHILDREN.filter((child: ChildCase): boolean => {
      return Boolean(child.key);
    }),
  )(
    "preserves the external identity for $type $collection",
    (child: ChildCase) => {
      const routeKey: string =
        child.kind === AIResourceSubresourceKind.WindowsService
          ? encodeServiceNameForUrl(child.key!)
          : encodeURIComponent(child.key!);
      const context: DashboardPageContext = requireContext(
        `${child.path}/${ENTITY_ID}/${child.collection}/${routeKey}`,
      );
      expect(context).toMatchObject({
        type: AIChatPageContextType.Resource,
        resourceType: child.type,
        entityId: ENTITY_ID,
        subresource: { kind: child.kind, key: child.key },
      });
      expect(context.subresource?.namespace).toBeUndefined();
      expect(context.entityId).not.toBe(child.key);
    },
  );

  test("every tab of a database is the database itself - never a child identity", () => {
    for (const tab of [
      "endpoints",
      "traces",
      "owners",
      "recommendations",
      "documentation",
      "feed",
    ]) {
      expect(navigateTo(`databases/${ENTITY_ID}/${tab}`)).toMatchObject({
        type: AIChatPageContextType.Resource,
        resourceType: AIResourceType.DatabaseServer,
        entityId: ENTITY_ID,
        noun: "database",
        chipLabel: "This database",
        isEntity: true,
      });
      expect(PageContextUtil.detectPageContext()?.subresource).toBeUndefined();
    }
  });

  test("a database page's context survives sanitization for the server", () => {
    const context: DashboardPageContext = requireContext(
      `databases/${ENTITY_ID}/metrics`,
    );
    expect(
      AIChatPageContextHelper.sanitize(context as unknown as JSONObject),
    ).toEqual({
      type: AIChatPageContextType.Resource,
      resourceType: AIResourceType.DatabaseServer,
      entityId: ENTITY_ID,
    });
  });

  test("does not invent a namespace or confuse a Kubernetes pod name with a UUID", () => {
    const context: DashboardPageContext = requireContext(
      `kubernetes/${ENTITY_ID}/pods/api`,
    );
    expect(context.subresource).toEqual({
      kind: AIResourceSubresourceKind.Pod,
      key: "api",
    });
    expect(context.chipLabel).toBe("This pod");
    expect(context.entityId).toBe(ENTITY_ID);
  });

  test("decodes an external identifier only once", () => {
    expect(
      requireContext(`iot/${ENTITY_ID}/devices/sensor%252Ftest`).subresource
        ?.key,
    ).toBe("sensor%2Ftest");
  });

  test.each([
    "%E0%A4%A",
    "%00bad",
    "line%0Abreak",
    "bad%7Fname",
    "%20name%20",
    ".",
    "..",
    "x".repeat(513),
  ])(
    "drops invalid child identity %s while retaining the known parent",
    (key: string) => {
      const context: DashboardPageContext = requireContext(
        `docker/${ENTITY_ID}/containers/${key}`,
      );
      expect(context).toMatchObject({
        type: AIChatPageContextType.Resource,
        resourceType: AIResourceType.DockerHost,
        entityId: ENTITY_ID,
      });
      expect(context.subresource).toBeUndefined();
    },
  );

  test.each([
    "network-sites",
    `network-sites/view/${ENTITY_ID}`,
    "inventory/overview",
    `inventory/item/${ENTITY_ID}`,
    "topology/overview",
    "docker-other",
    "hostile",
    "podman-other",
    "kubernetes-other",
    "databases-other",
  ])("does not claim unsupported resource page %s", (path: string) => {
    expect(navigateTo(path)).toBeNull();
  });

  test("does not attach a child when its parent UUID is invalid", () => {
    expect(navigateTo("kubernetes/settings/pods/api")).toMatchObject({
      type: AIChatPageContextType.ResourcesList,
      resourceType: AIResourceType.KubernetesCluster,
    });
    expect(PageContextUtil.detectPageContext()?.subresource).toBeUndefined();
  });

  test("falls back safely when navigation state is unavailable", () => {
    jest.spyOn(Navigation, "isStartWith").mockImplementation((): boolean => {
      throw new Error("Navigation unavailable");
    });
    expect(PageContextUtil.detectPageContext()).toBeNull();
  });
});

describe("AI Insights infrastructure titles and links", () => {
  test.each(RESOURCES)(
    "resolves the $type name using its own model and UUID",
    async (resource: ResourceCase) => {
      const model: BaseModel & { name?: string | undefined } =
        new resource.modelType();
      model.name = "Production resource";
      const getItem: ReturnType<typeof jest.spyOn> = jest
        .spyOn(ModelAPI, "getItem")
        .mockResolvedValue(model);
      expect(
        await PageContextUtil.resolveEntityTitle(
          requireContext(`${resource.path}/${ENTITY_ID}`),
        ),
      ).toBe("Production resource");
      expect(getItem).toHaveBeenCalledWith({
        modelType: resource.modelType,
        id: new ObjectID(ENTITY_ID),
        select: { name: true },
      });
    },
  );

  test("includes both the parent name and child identity in the title", async () => {
    const cluster: KubernetesCluster = new KubernetesCluster();
    cluster.name = "Production";
    jest.spyOn(ModelAPI, "getItem").mockResolvedValue(cluster);
    expect(
      await PageContextUtil.resolveEntityTitle(
        requireContext(`kubernetes/${ENTITY_ID}/pods/api`),
      ),
    ).toBe("Production / pod: api");
  });

  test.each([null, new DockerHost()])(
    "uses the generic chip for a missing or unnamed resource",
    async (item: DockerHost | null) => {
      jest.spyOn(ModelAPI, "getItem").mockResolvedValue(item);
      expect(
        await PageContextUtil.resolveEntityTitle(
          requireContext(`docker/${ENTITY_ID}/containers/api`),
        ),
      ).toBeNull();
    },
  );

  test("uses the generic chip when the resource is inaccessible", async () => {
    jest.spyOn(ModelAPI, "getItem").mockRejectedValue(new Error("Forbidden"));
    expect(
      await PageContextUtil.resolveEntityTitle(
        requireContext(`podman/${ENTITY_ID}`),
      ),
    ).toBeNull();
  });

  test("does not fetch a title for a list or malformed identifier", async () => {
    const getItem: ReturnType<typeof jest.spyOn> = jest.spyOn(
      ModelAPI,
      "getItem",
    );
    const context: DashboardPageContext = requireContext("host");
    expect(await PageContextUtil.resolveEntityTitle(context)).toBeNull();
    expect(
      await PageContextUtil.resolveEntityTitle({
        ...context,
        type: AIChatPageContextType.Resource,
        entityId: "not-an-id",
      }),
    ).toBeNull();
    expect(getItem).not.toHaveBeenCalled();
  });

  test.each(RESOURCES)(
    "links $type citations to its list and detail in the active project",
    (resource: ResourceCase) => {
      jest
        .spyOn(ProjectUtil, "getCurrentProjectId")
        .mockReturnValue(new ObjectID(PROJECT_ID));
      expect(ResourcePageContextUtil.getRoute(resource.type)?.toString()).toBe(
        `/dashboard/${PROJECT_ID}/${resource.path}`,
      );
      expect(
        ResourcePageContextUtil.getRoute(resource.type, ENTITY_ID)?.toString(),
      ).toBe(`/dashboard/${PROJECT_ID}/${resource.path}/${ENTITY_ID}`);
      expect(
        ResourcePageContextUtil.getRoute(resource.type, "settings"),
      ).toBeUndefined();
    },
  );
});

describe("AI Insights infrastructure suggestions and payload", () => {
  test.each(RESOURCES)(
    "offers supported scoped suggestions for $type lists and details",
    (resource: ResourceCase) => {
      for (const path of [resource.path, `${resource.path}/${ENTITY_ID}`]) {
        const context: DashboardPageContext = requireContext(path);
        const suggestions: Array<SuggestedQuestion> =
          PageContextUtil.getSuggestions(context);
        expect(
          suggestions.map((suggestion: SuggestedQuestion): string => {
            return suggestion.title;
          }),
        ).toEqual([
          "Resource overview",
          "Connection health",
          "Metric trends",
          "Recent errors",
        ]);
        expect(suggestions[1]?.question).toContain("where available");
        expect(suggestions[2]?.question).toContain("last 24 hours");
        expect(suggestions[3]?.question).toContain(
          "log severity, trace errors and operation latency",
        );
        expect(suggestions[3]?.question).toContain("last 6 hours");
        expect(
          suggestions
            .map((suggestion: SuggestedQuestion): string => {
              return suggestion.question;
            })
            .join(" "),
        ).not.toMatch(
          /session replay|unique visitors|page views|restart|delete/i,
        );
      }
    },
  );

  test.each([
    `kubernetes/${ENTITY_ID}/pods/api`,
    `docker/${ENTITY_ID}/containers/api`,
    `proxmox/${ENTITY_ID}/guests/qemu%2F100`,
    `host/${ENTITY_ID}/processes/42`,
  ])(
    "distinguishes parent telemetry from child evidence on %s",
    (path: string) => {
      const suggestions: Array<SuggestedQuestion> =
        PageContextUtil.getSuggestions(requireContext(path));
      expect(
        suggestions.map((suggestion: SuggestedQuestion): string => {
          return suggestion.title;
        }),
      ).toEqual([
        "Understand this view",
        "Parent metric trends",
        "Parent resource errors",
      ]);
      expect(suggestions[0]?.question).toContain("Verify the child identity");
      expect(suggestions[0]?.question).toContain(
        "missing namespace or identity information",
      );
      expect(suggestions[1]?.question).toContain("parent-level findings");
      expect(suggestions[2]?.question).toContain(
        "do not assume a missing namespace",
      );
    },
  );

  test("serializes parent and child identities without presentation fields", () => {
    const context: DashboardPageContext = {
      ...requireContext(`vmware/${ENTITY_ID}/virtual-machines/vm%2F123`),
      entityTitle: "Production / VM 123",
    };
    const payload: JSONObject = PageContextUtil.toRequestPayload(context);
    expect(payload).toEqual({
      type: AIChatPageContextType.Resource,
      resourceType: AIResourceType.VMwareVCenter,
      entityId: ENTITY_ID,
      entityTitle: "Production / VM 123",
      subresource: {
        kind: AIResourceSubresourceKind.VirtualMachine,
        key: "vm/123",
      },
    });
    expect(AIChatPageContextHelper.sanitize(payload)).toEqual(payload);
    expect(payload["noun"]).toBeUndefined();
    expect(payload["chipLabel"]).toBeUndefined();
    expect(payload["icon"]).toBeUndefined();
    expect(payload["isEntity"]).toBeUndefined();
  });

  test("serializes scoped collections without inventing a child key", () => {
    const payload: JSONObject = PageContextUtil.toRequestPayload(
      requireContext(`kubernetes/${ENTITY_ID}/pods`),
    );
    expect(payload["subresource"]).toEqual({
      kind: AIResourceSubresourceKind.Pod,
    });
    expect(AIChatPageContextHelper.sanitize(payload)).toEqual(payload);
  });

  test("serializes resource lists without a parent UUID", () => {
    const payload: JSONObject = PageContextUtil.toRequestPayload(
      requireContext("ceph"),
    );
    expect(payload).toEqual({
      type: AIChatPageContextType.ResourcesList,
      resourceType: AIResourceType.CephCluster,
    });
    expect(AIChatPageContextHelper.sanitize(payload)).toEqual(payload);
  });
});
