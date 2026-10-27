import Alert from "../../../Models/DatabaseModels/Alert";
import CephCluster from "../../../Models/DatabaseModels/CephCluster";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import DockerSwarmCluster from "../../../Models/DatabaseModels/DockerSwarmCluster";
import Host from "../../../Models/DatabaseModels/Host";
import Incident from "../../../Models/DatabaseModels/Incident";
import IoTFleet from "../../../Models/DatabaseModels/IoTFleet";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import PodmanHost from "../../../Models/DatabaseModels/PodmanHost";
import ProxmoxCluster from "../../../Models/DatabaseModels/ProxmoxCluster";
import ServerlessFunction from "../../../Models/DatabaseModels/ServerlessFunction";
import Service from "../../../Models/DatabaseModels/Service";
import StorageArray from "../../../Models/DatabaseModels/StorageArray";
import VMwareVCenter from "../../../Models/DatabaseModels/VMwareVCenter";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AIChatPageContextType, {
  AIChatPageContext,
} from "../../../Types/AI/AIChatPageContext";
import {
  AIResourceSubresourceKind,
  AIResourceType,
} from "../../../Types/AI/AIResourceContext";
import {
  AI_AFFECTED_RESOURCE_KINDS,
  AI_RESOURCE_TYPES_NOT_LINKABLE,
  AiAffectedResourceArgument,
  AiAffectedResourceKind,
  AiAffectedResourceKindInfo,
  getAiAffectedResourceKindInfo,
  getPageAffectedResource,
  isAiAffectedResourceKind,
  MAX_AI_AFFECTED_RESOURCES,
  readAiAffectedResourceArgument,
  readAiAffectedResourceKind,
} from "../../../Types/AI/AiAffectedResources";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import AiResourceType, {
  ALL_AI_RESOURCE_TYPES,
  isCloudAiResourceType,
} from "../../../Types/ResourceAiAgent/AiResourceType";
import { describe, expect, test } from "@jest/globals";

/*
 * What OneUptime AI links an incident or alert to (#5293): declared from a
 * host's page, an incident Ask AI created was linked to nothing, so its
 * investigation never reached the host and auto-remediation had nothing to
 * fix. These tests hold the vocabulary every linking tool shares: each kind
 * goes in a real list of both models, the kinds a fix acts on are exactly
 * the ones with an AI agent, every resource page Ask AI opens on is either
 * linkable or says why not, and the tool argument and the page are read
 * defensively, since both come from outside the server's own code.
 */

const HOST_ID: string = "11111111-1111-4111-8111-111111111111";
const CLUSTER_ID: string = "22222222-2222-4222-8222-222222222222";
const SERVICE_ID: string = "33333333-3333-4333-8333-333333333333";

// The model each kind's list holds.
const KIND_MODELS: Record<AiAffectedResourceKind, { new (): BaseModel }> = {
  [AiAffectedResourceKind.Host]: Host,
  [AiAffectedResourceKind.DockerHost]: DockerHost,
  [AiAffectedResourceKind.PodmanHost]: PodmanHost,
  [AiAffectedResourceKind.KubernetesCluster]: KubernetesCluster,
  [AiAffectedResourceKind.DockerSwarmCluster]: DockerSwarmCluster,
  [AiAffectedResourceKind.ProxmoxCluster]: ProxmoxCluster,
  [AiAffectedResourceKind.VMwareVCenter]: VMwareVCenter,
  [AiAffectedResourceKind.CephCluster]: CephCluster,
  [AiAffectedResourceKind.StorageArray]: StorageArray,
  [AiAffectedResourceKind.IoTFleet]: IoTFleet,
  [AiAffectedResourceKind.DatabaseServer]: DatabaseServer,
  [AiAffectedResourceKind.CloudResource]: CloudResource,
  [AiAffectedResourceKind.Service]: Service,
};

// The model of each resource page Ask AI opens on that cannot be linked.
const NOT_LINKABLE_MODELS: Partial<
  Record<AIResourceType, { new (): BaseModel }>
> = {
  [AIResourceType.ServerlessFunction]: ServerlessFunction,
  [AIResourceType.NetworkDevice]: NetworkDevice,
};

// Every list of a model that holds records of `modelType`.
function listsOf(
  record: BaseModel,
  modelType: { new (): BaseModel },
): Array<string> {
  return record.getTableColumns().columns.filter((column: string): boolean => {
    const metadata: TableColumnMetadata = record.getTableColumnMetadata(column);

    return (
      metadata?.type === TableColumnType.EntityArray &&
      metadata.modelType === modelType
    );
  });
}

function resourcePage(
  resourceType: AIResourceType,
  entityId: string = HOST_ID,
): AIChatPageContext {
  return { type: AIChatPageContextType.Resource, resourceType, entityId };
}

describe("the kinds OneUptime AI links", () => {
  test.each(
    AI_AFFECTED_RESOURCE_KINDS.map(
      (
        info: AiAffectedResourceKindInfo,
      ): [string, AiAffectedResourceKindInfo] => {
        return [info.kind, info];
      },
    ),
  )(
    "%s goes in a list of the same name on both incidents and alerts",
    (_kind: string, info: AiAffectedResourceKindInfo) => {
      for (const record of [new Incident(), new Alert()]) {
        const metadata: TableColumnMetadata = record.getTableColumnMetadata(
          info.relation,
        );

        expect(metadata).toBeDefined();
        expect(metadata.type).toBe(TableColumnType.EntityArray);
        expect(metadata.modelType).toBe(KIND_MODELS[info.kind]);
      }
    },
  );

  test("each kind has its own list, its own noun, and is listed once", () => {
    const kinds: Array<string> = AI_AFFECTED_RESOURCE_KINDS.map(
      (info: AiAffectedResourceKindInfo): string => {
        return info.kind;
      },
    );
    const relations: Array<string> = AI_AFFECTED_RESOURCE_KINDS.map(
      (info: AiAffectedResourceKindInfo): string => {
        return info.relation;
      },
    );

    expect(new Set(kinds).size).toBe(kinds.length);
    expect(new Set(relations).size).toBe(relations.length);
    expect(kinds.sort()).toEqual(Object.values(AiAffectedResourceKind).sort());

    for (const info of AI_AFFECTED_RESOURCE_KINDS) {
      expect(info.noun.trim().length).toBeGreaterThan(0);
      // A noun goes mid-sentence: "host", "Kubernetes cluster".
      expect(info.noun).not.toMatch(/\.$/);
    }
  });

  test("a fix acts on exactly the Kubernetes clusters and the resources with an AI agent", () => {
    const fixed: Array<string> = AI_AFFECTED_RESOURCE_KINDS.filter(
      (info: AiAffectedResourceKindInfo): boolean => {
        return info.isFixedByOneUptimeAi;
      },
    )
      .map((info: AiAffectedResourceKindInfo): string => {
        return info.kind;
      })
      .sort();

    // A cloud account is fixed through the cloud resources linked to it.
    expect(fixed).toEqual(
      [
        AiAffectedResourceKind.KubernetesCluster as string,
        AiAffectedResourceKind.CloudResource as string,
        ...ALL_AI_RESOURCE_TYPES.filter((type: AiResourceType): boolean => {
          return !isCloudAiResourceType(type);
        }).map((type: string): string => {
          return type;
        }),
      ].sort(),
    );
  });

  test("monitors are never linked: a monitor on a declared incident stops its own checks", () => {
    for (const info of AI_AFFECTED_RESOURCE_KINDS) {
      expect(info.relation).not.toBe("monitors");
    }

    expect(readAiAffectedResourceKind("Monitor")).toBeUndefined();
  });

  test("every resource page Ask AI opens on is either linkable or says why not, never both", () => {
    for (const type of Object.values(AIResourceType)) {
      const isLinkable: boolean = isAiAffectedResourceKind(type);
      const reason: string | undefined = AI_RESOURCE_TYPES_NOT_LINKABLE[type];

      expect({ type, decided: isLinkable !== Boolean(reason) }).toEqual({
        type,
        decided: true,
      });

      if (reason) {
        expect(reason.length).toBeGreaterThan(20);
      }
    }
  });

  /*
   * A kind said to be unlinkable because incidents have no list of it must
   * stay true: the day an incident and an alert get the list (a cloud
   * resource's, say), this fails until the kind moves up into
   * AI_AFFECTED_RESOURCE_KINDS - and Ask AI on that kind's page links what
   * it declares, as on every other resource's page.
   */
  test.each(Object.entries(NOT_LINKABLE_MODELS))(
    "%s has no list on incidents or alerts yet",
    (_type: string, modelType: { new (): BaseModel } | undefined) => {
      expect(modelType).toBeDefined();
      expect(listsOf(new Incident(), modelType!)).toEqual([]);
      expect(listsOf(new Alert(), modelType!)).toEqual([]);
    },
  );

  test("the unlinkable types are exactly the resource pages without a list", () => {
    expect(Object.keys(AI_RESOURCE_TYPES_NOT_LINKABLE).sort()).toEqual(
      Object.keys(NOT_LINKABLE_MODELS).sort(),
    );
  });

  test("getAiAffectedResourceKindInfo knows every kind, and refuses anything else", () => {
    for (const kind of Object.values(AiAffectedResourceKind)) {
      expect(getAiAffectedResourceKindInfo(kind).kind).toBe(kind);
    }

    expect(() => {
      return getAiAffectedResourceKindInfo("Monitor" as AiAffectedResourceKind);
    }).toThrow("Unknown kind of affected resource");
  });
});

describe("readAiAffectedResourceKind - a kind as a model spells it", () => {
  test.each([
    ["Host", AiAffectedResourceKind.Host],
    ["host", AiAffectedResourceKind.Host],
    ["HOST", AiAffectedResourceKind.Host],
    ["kubernetesCluster", AiAffectedResourceKind.KubernetesCluster],
    ["kubernetes_cluster", AiAffectedResourceKind.KubernetesCluster],
    ["Kubernetes Cluster", AiAffectedResourceKind.KubernetesCluster],
    ["docker-host", AiAffectedResourceKind.DockerHost],
    ["VMwareVCenter", AiAffectedResourceKind.VMwareVCenter],
    ["Service", AiAffectedResourceKind.Service],
    ["TelemetryService", AiAffectedResourceKind.Service],
    ["telemetry service", AiAffectedResourceKind.Service],
    ["DatabaseServer", AiAffectedResourceKind.DatabaseServer],
    ["CloudResource", AiAffectedResourceKind.CloudResource],
    ["cloud_resource", AiAffectedResourceKind.CloudResource],
  ])("reads %j", (value: string, kind: AiAffectedResourceKind) => {
    expect(readAiAffectedResourceKind(value)).toBe(kind);
  });

  test.each([
    ["Monitor"],
    ["CloudResources"],
    ["ServerlessFunction"],
    ["NetworkDevice"],
    ["Hosts"],
    [""],
    ["   "],
  ])("refuses %j", (value: string) => {
    expect(readAiAffectedResourceKind(value)).toBeUndefined();
  });

  test.each([[undefined], [null], [42], [{ kind: "Host" }], [["Host"]]])(
    "refuses a value that is not text (%j)",
    (value: unknown) => {
      expect(readAiAffectedResourceKind(value)).toBeUndefined();
    },
  );
});

describe("getPageAffectedResource - what an incident declared on a page is about", () => {
  test("a host's page is about the host (issue #5293)", () => {
    expect(getPageAffectedResource(resourcePage(AIResourceType.Host))).toEqual({
      kind: AiAffectedResourceKind.Host,
      id: HOST_ID,
    });
  });

  test.each(
    AI_AFFECTED_RESOURCE_KINDS.filter(
      (info: AiAffectedResourceKindInfo): boolean => {
        return info.kind !== AiAffectedResourceKind.Service;
      },
    ).map((info: AiAffectedResourceKindInfo) => {
      return [info.kind];
    }),
  )("every linkable resource's page is about it (%s)", (kind: string) => {
    expect(
      getPageAffectedResource(resourcePage(kind as AIResourceType, CLUSTER_ID)),
    ).toEqual({ kind, id: CLUSTER_ID });
  });

  test("a child page (a pod) is about its parent resource (the cluster)", () => {
    expect(
      getPageAffectedResource({
        type: AIChatPageContextType.Resource,
        resourceType: AIResourceType.KubernetesCluster,
        entityId: CLUSTER_ID,
        subresource: { kind: AIResourceSubresourceKind.Pod, key: "web-1" },
      }),
    ).toEqual({
      kind: AiAffectedResourceKind.KubernetesCluster,
      id: CLUSTER_ID,
    });
  });

  test("a telemetry service's page is about the service", () => {
    expect(
      getPageAffectedResource({
        type: AIChatPageContextType.TelemetryService,
        entityId: SERVICE_ID,
        entityTitle: "checkout",
      }),
    ).toEqual({ kind: AiAffectedResourceKind.Service, id: SERVICE_ID });
  });

  test("an ID is lower-cased, so the same resource is never linked twice", () => {
    expect(
      getPageAffectedResource(
        resourcePage(AIResourceType.Host, HOST_ID.toUpperCase()),
      ),
    ).toEqual({ kind: AiAffectedResourceKind.Host, id: HOST_ID });
  });

  test("a cloud resource's page is about the cloud resource: incidents and alerts hold them now", () => {
    expect(
      getPageAffectedResource(
        resourcePage(AIResourceType.CloudResource, CLUSTER_ID),
      ),
    ).toEqual({ kind: AiAffectedResourceKind.CloudResource, id: CLUSTER_ID });
    // Linked for its changes and its page, never fixed: no agent acts on a cloud.
    expect(
      getAiAffectedResourceKindInfo(AiAffectedResourceKind.CloudResource),
    ).toEqual({
      kind: AiAffectedResourceKind.CloudResource,
      relation: "cloudResources",
      noun: "cloud resource",
      isFixedByOneUptimeAi: false,
    });
  });

  test.each([
    [
      "a serverless function's page",
      resourcePage(AIResourceType.ServerlessFunction),
    ],
    ["a network device's page", resourcePage(AIResourceType.NetworkDevice)],
    [
      "a list of hosts",
      {
        type: AIChatPageContextType.ResourcesList,
        resourceType: AIResourceType.Host,
      },
    ],
    [
      "an incident's page",
      { type: AIChatPageContextType.Incident, entityId: HOST_ID },
    ],
    [
      "an alert's page",
      { type: AIChatPageContextType.Alert, entityId: HOST_ID },
    ],
    [
      "a monitor's page",
      { type: AIChatPageContextType.Monitor, entityId: HOST_ID },
    ],
    ["the logs explorer", { type: AIChatPageContextType.LogsExplorer }],
    [
      "a resource page whose ID is not a UUID",
      resourcePage(AIResourceType.Host, "overview"),
    ],
  ] as Array<[string, AIChatPageContext]>)(
    "%s is about no resource an incident can be linked to",
    (_page: string, context: AIChatPageContext) => {
      expect(getPageAffectedResource(context)).toBeNull();
    },
  );

  test("no page is about nothing", () => {
    expect(getPageAffectedResource(undefined)).toBeNull();
    expect(getPageAffectedResource(null)).toBeNull();
  });
});

describe("readAiAffectedResourceArgument - the tool argument, read defensively", () => {
  test("a call that leaves it out names nothing, so the tool decides", () => {
    expect(readAiAffectedResourceArgument(undefined)).toBeUndefined();
    expect(readAiAffectedResourceArgument(null)).toBeUndefined();
  });

  test("an empty list names nothing, deliberately", () => {
    expect(readAiAffectedResourceArgument([])).toEqual({
      refs: [],
      problems: [],
    });
  });

  test("reads each { resourceType, resourceId }, lower-casing the ID", () => {
    const argument: AiAffectedResourceArgument | undefined =
      readAiAffectedResourceArgument([
        { resourceType: "Host", resourceId: HOST_ID.toUpperCase() },
        { resourceType: "kubernetes cluster", resourceId: ` ${CLUSTER_ID} ` },
        { resourceType: "TelemetryService", resourceId: SERVICE_ID },
      ]);

    expect(argument).toEqual({
      refs: [
        { kind: AiAffectedResourceKind.Host, id: HOST_ID },
        { kind: AiAffectedResourceKind.KubernetesCluster, id: CLUSTER_ID },
        { kind: AiAffectedResourceKind.Service, id: SERVICE_ID },
      ],
      problems: [],
    });
  });

  test("keeps a resource named twice once", () => {
    expect(
      readAiAffectedResourceArgument([
        { resourceType: "Host", resourceId: HOST_ID },
        { resourceType: "host", resourceId: HOST_ID.toUpperCase() },
      ])?.refs,
    ).toEqual([{ kind: AiAffectedResourceKind.Host, id: HOST_ID }]);
  });

  test("the same ID of two kinds is two resources", () => {
    expect(
      readAiAffectedResourceArgument([
        { resourceType: "Host", resourceId: HOST_ID },
        { resourceType: "DockerHost", resourceId: HOST_ID },
      ])?.refs,
    ).toHaveLength(2);
  });

  test("leaves out what it cannot read, saying why, and keeps the rest", () => {
    const argument: AiAffectedResourceArgument | undefined =
      readAiAffectedResourceArgument([
        { resourceType: "Monitor", resourceId: HOST_ID },
        { resourceType: "Host", resourceId: "test01" },
        { resourceType: "Host" },
        "Host",
        null,
        ["Host", HOST_ID],
        { resourceType: "KubernetesCluster", resourceId: CLUSTER_ID },
      ]);

    expect(argument?.refs).toEqual([
      { kind: AiAffectedResourceKind.KubernetesCluster, id: CLUSTER_ID },
    ]);
    expect(argument?.problems).toHaveLength(6);
    // A kind it cannot link: named, with the kinds it can.
    expect(argument?.problems[0]).toContain('"Monitor" cannot be linked');
    expect(argument?.problems[0]).toContain("KubernetesCluster");
    // A name where the ID goes: what the ID must be.
    expect(argument?.problems[1]).toBe(
      "resourceId of a host must be its OneUptime ID (a UUID).",
    );
    expect(argument?.problems[3]).toBe(
      "An entry of affectedResources is not a { resourceType, resourceId } object.",
    );
  });

  test("a value that is not a list names nothing, and says what it must be", () => {
    expect(
      readAiAffectedResourceArgument({
        resourceType: "Host",
        resourceId: HOST_ID,
      }),
    ).toEqual({
      refs: [],
      problems: [
        "affectedResources must be a list of { resourceType, resourceId }.",
      ],
    });
    expect(readAiAffectedResourceArgument("Host")?.refs).toEqual([]);
  });

  test(`links at most ${MAX_AI_AFFECTED_RESOURCES} at once, and says how many were left out`, () => {
    const many: Array<{ resourceType: string; resourceId: string }> = [];

    for (
      let index: number = 0;
      index < MAX_AI_AFFECTED_RESOURCES + 3;
      index++
    ) {
      many.push({
        resourceType: "Host",
        resourceId: `11111111-1111-4111-8111-${index.toString().padStart(12, "0")}`,
      });
    }

    const argument: AiAffectedResourceArgument | undefined =
      readAiAffectedResourceArgument(many);

    expect(argument?.refs).toHaveLength(MAX_AI_AFFECTED_RESOURCES);
    expect(argument?.problems).toEqual([
      `Only ${MAX_AI_AFFECTED_RESOURCES} resources are linked at once; 3 more were left out.`,
    ]);
  });

  test("a resourceType of any length is quoted short in its problem", () => {
    const problem: string =
      readAiAffectedResourceArgument([
        { resourceType: "x".repeat(10_000), resourceId: HOST_ID },
      ])?.problems[0] || "";

    expect(problem.length).toBeLessThan(400);
  });
});
