import { beforeEach, describe, expect, test } from "@jest/globals";
import Dictionary from "Common/Types/Dictionary";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import EntityRelationshipType from "Common/Types/Telemetry/EntityRelationshipType";
import EntitySource from "Common/Types/Telemetry/EntitySource";
import EntityType from "Common/Types/Telemetry/EntityType";
import {
  TOPOLOGY_API_FORMAT_VERSION,
  TopologyApiPath,
  TopologyInfrastructureNodeJSON,
  TopologyInfrastructureResponseJSON,
  TopologyServiceMapResponseJSON,
  TopologyTruncationJSON,
} from "Common/Types/Topology/TopologyApi";

/*
 * TopologyApi is where the Topology API's wire JSON becomes what the maps
 * draw. Every decision the server made in SQL — which container a resource
 * nests in, which services it hosts, which range start activity is judged
 * against — reaches the browser only through these decoders, so a decoder
 * that drops or re-points a row silently redraws the map.
 *
 * The module reaches the network through Common/UI/Utils/API/API and
 * Common/UI/Utils/ModelAPI/ModelAPI, both of which load Common/UI/Config,
 * which reads `window` at import time. Mocking the three keeps this suite
 * browser-free and doubles as the seam the transport tests drive (same
 * pattern as NetworkSummaryApi.test.ts).
 */
jest.mock("Common/UI/Config", () => {
  const { default: MockURL } = jest.requireActual("Common/Types/API/URL") as {
    default: { fromString: (value: string) => unknown };
  };
  return {
    __esModule: true,
    APP_API_URL: MockURL.fromString("http://localhost/api"),
  };
});

jest.mock("Common/UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: jest.fn(),
    },
  };
});

jest.mock("Common/UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: jest.fn(),
    },
  };
});

import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import {
  TOPOLOGY_BUSY_MESSAGE,
  TOPOLOGY_OUTDATED_MESSAGE,
  TopologyOutdatedError,
  TopologyRequestOptions,
  decodeInfrastructureResponse,
  decodeServiceMapResponse,
  decodeTopologyEnvelope,
  fetchInfrastructureData,
  fetchServiceMapData,
  isTopologyBusyError,
} from "../../FeatureSet/Dashboard/src/Components/Topology/TopologyApi";
import {
  InfrastructureData,
  ServiceMapData,
  TopologyEntity,
  TopologyRelationship,
  TopologyTruncation,
} from "../../FeatureSet/Dashboard/src/Components/Topology/TopologyData";
import { isEntityActive } from "../../FeatureSet/Dashboard/src/Components/Topology/TopologyActivity";
import computeInfraParenting from "../../FeatureSet/Dashboard/src/Components/Topology/InfrastructureNesting";

const postMock: jest.Mock = API.post as unknown as jest.Mock;
const getCommonHeadersMock: jest.Mock =
  ModelAPI.getCommonHeaders as unknown as jest.Mock;

const TENANT_HEADERS: Dictionary<string> = {
  tenantid: "3f1b6b0e-0000-4000-8000-0000000000aa",
};

/* What the server echoes: the requested start, floored to the minute. */
const ECHOED_RANGE_START: string = "2026-09-20T10:15:00.000Z";
const GENERATED_AT: string = "2026-09-21T10:15:42.000Z";

const MINUTE_MS: number = 60 * 1000;
const RANGE_START_MS: number = new Date(ECHOED_RANGE_START).getTime();

interface PostOptions {
  url: URL;
  data: JSONObject;
  headers: Dictionary<string>;
  options: { signal?: AbortSignal };
}

function lastPostOptions(): PostOptions {
  const calls: Array<Array<unknown>> = postMock.mock.calls as Array<
    Array<unknown>
  >;
  return calls[calls.length - 1]![0] as PostOptions;
}

/*
 * A well-formed 200, put through the real HTTPResponse constructor (which
 * runs JSONFunctions.deserialize over the body) so the decoders see exactly
 * the object shape they see in the browser.
 */
function respondWith(
  body: TopologyServiceMapResponseJSON | TopologyInfrastructureResponseJSON,
): void {
  postMock.mockResolvedValue(
    new HTTPResponse<JSONObject>(200, body as unknown as JSONObject, {}),
  );
}

function serviceMapPayload(
  overrides: Partial<TopologyServiceMapResponseJSON> = {},
): TopologyServiceMapResponseJSON {
  return {
    formatVersion: TOPOLOGY_API_FORMAT_VERSION,
    rangeStart: ECHOED_RANGE_START,
    generatedAt: GENERATED_AT,
    entities: [],
    dependencies: [],
    runsOn: [],
    entityTruncation: null,
    dependencyTruncation: null,
    ...overrides,
  };
}

function infrastructurePayload(
  overrides: Partial<TopologyInfrastructureResponseJSON> = {},
): TopologyInfrastructureResponseJSON {
  return {
    formatVersion: TOPOLOGY_API_FORMAT_VERSION,
    rangeStart: ECHOED_RANGE_START,
    generatedAt: GENERATED_AT,
    nodes: [],
    services: [],
    placements: [],
    dependencies: [],
    dependencyTruncation: null,
    collections: [],
    totals: { resources: 0, activeResources: 0 },
    truncation: null,
    ...overrides,
  };
}

function node(
  key: string,
  type: string,
  extra: Partial<TopologyInfrastructureNodeJSON> = {},
): TopologyInfrastructureNodeJSON {
  return {
    key,
    type,
    name: key,
    source: EntitySource.Discovered,
    lastSeenAt: RANGE_START_MS + MINUTE_MS,
    ...extra,
  };
}

function relationshipTriples(
  relationships: Array<TopologyRelationship>,
): Array<string> {
  return relationships.map((relationship: TopologyRelationship): string => {
    return `${relationship.fromEntityKey} -${relationship.relationshipType}-> ${relationship.toEntityKey}`;
  });
}

function entityByKey(
  entities: Array<TopologyEntity>,
  key: string,
): TopologyEntity | undefined {
  return entities.find((entity: TopologyEntity): boolean => {
    return entity.entityKey === key;
  });
}

beforeEach(() => {
  postMock.mockReset();
  getCommonHeadersMock.mockReset();
  getCommonHeadersMock.mockReturnValue(TENANT_HEADERS);
});

describe("the response envelope", () => {
  test("reads the echoed range start and when the payload was generated", () => {
    const envelope: { rangeStart: Date; generatedAt: Date } =
      decodeTopologyEnvelope(serviceMapPayload());
    expect(envelope.rangeStart.toISOString()).toBe(ECHOED_RANGE_START);
    expect(envelope.generatedAt.toISOString()).toBe(GENERATED_AT);
  });

  test.each([
    ["a newer version", TOPOLOGY_API_FORMAT_VERSION + 1],
    ["an older version", TOPOLOGY_API_FORMAT_VERSION - 1],
  ])(
    "refuses a payload in %s and says the page needs a reload",
    (_label: string, formatVersion: number) => {
      const payload: TopologyServiceMapResponseJSON = serviceMapPayload({
        formatVersion,
      });
      let thrown: unknown = null;
      try {
        decodeServiceMapResponse(payload);
      } catch (error: unknown) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(TopologyOutdatedError);
      expect((thrown as TopologyOutdatedError).serverFormatVersion).toBe(
        formatVersion,
      );
      expect((thrown as Error).message).toBe(TOPOLOGY_OUTDATED_MESSAGE);
      expect(TOPOLOGY_OUTDATED_MESSAGE).toBe(
        "Topology was updated. Reload the page.",
      );
    },
  );

  test("a payload with no version at all is from another contract, not ours", () => {
    const payload: JSONObject = {
      rangeStart: ECHOED_RANGE_START,
      entities: [],
    };
    expect(() => {
      decodeServiceMapResponse(payload);
    }).toThrow(TopologyOutdatedError);
    expect(() => {
      decodeInfrastructureResponse(payload);
    }).toThrow(TopologyOutdatedError);
  });

  test("a version given as a string is not the same version", () => {
    expect(() => {
      decodeInfrastructureResponse({
        ...infrastructurePayload(),
        formatVersion: String(TOPOLOGY_API_FORMAT_VERSION),
      });
    }).toThrow(TopologyOutdatedError);
  });

  /*
   * Activity is judged against the echoed start. A map drawn without it
   * would count resources differently from the server's own totals, so a
   * payload without one fails loudly (but is not an "outdated" payload).
   */
  test.each([undefined, "", "not a date"])(
    "a missing or unreadable range start (%p) fails the load",
    (rangeStart: string | undefined) => {
      const payload: JSONObject = {
        ...serviceMapPayload(),
      } as unknown as JSONObject;
      if (rangeStart === undefined) {
        delete payload["rangeStart"];
      } else {
        payload["rangeStart"] = rangeStart;
      }
      let thrown: unknown = null;
      try {
        decodeServiceMapResponse(payload);
      } catch (error: unknown) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(Error);
      expect(thrown).not.toBeInstanceOf(TopologyOutdatedError);
    },
  );

  test.each([null, undefined, [], "text"])(
    "a body that is not an object (%p) fails the load",
    (body: unknown) => {
      expect(() => {
        decodeServiceMapResponse(body);
      }).toThrow(Error);
    },
  );

  test("a missing generatedAt falls back to the time of decoding", () => {
    const payload: JSONObject = {
      ...serviceMapPayload(),
    } as unknown as JSONObject;
    delete payload["generatedAt"];
    const before: number = Date.now();
    const data: ServiceMapData = decodeServiceMapResponse(payload);
    expect(data.loadedAt.getTime()).toBeGreaterThanOrEqual(before);
  });
});

describe("decodeServiceMapResponse", () => {
  test("decodes services, callees, dependencies and runs-on counts", () => {
    const data: ServiceMapData = decodeServiceMapResponse(
      serviceMapPayload({
        entities: [
          {
            key: "svc-checkout",
            type: EntityType.Service,
            name: "checkout",
            source: EntitySource.Discovered,
            lastSeenAt: RANGE_START_MS + 5 * MINUTE_MS,
            descriptiveAttributes: { "telemetry.sdk.language": "nodejs" },
            identifyingAttributes: { "db.system.name": "postgresql" },
          },
          {
            key: "db-orders",
            type: EntityType.Database,
            name: null,
            source: EntitySource.Inventory,
            lastSeenAt: null,
          },
        ],
        dependencies: [
          {
            from: "svc-checkout",
            to: "db-orders",
            callCount: 120,
            errorCount: 3,
            avgDurationMs: 12.5,
          },
        ],
        runsOn: [
          {
            service: "svc-checkout",
            type: EntityType.KubernetesPod,
            active: 3,
            total: 5,
          },
          {
            service: "svc-checkout",
            type: EntityType.Host,
            active: 1,
            total: 1,
          },
          {
            service: "svc-payments",
            type: EntityType.KubernetesPod,
            active: 0,
            total: 2,
          },
        ],
      }),
    );

    expect(data.rangeStart.toISOString()).toBe(ECHOED_RANGE_START);
    expect(data.loadedAt.toISOString()).toBe(GENERATED_AT);
    expect(data.entities).toEqual([
      {
        entityKey: "svc-checkout",
        entityType: EntityType.Service,
        displayName: "checkout",
        source: EntitySource.Discovered,
        lastSeenAt: new Date(RANGE_START_MS + 5 * MINUTE_MS),
        descriptiveAttributes: { "telemetry.sdk.language": "nodejs" },
        identifyingAttributes: { "db.system.name": "postgresql" },
      },
      {
        entityKey: "db-orders",
        entityType: EntityType.Database,
        source: EntitySource.Inventory,
      },
    ]);
    /* name: null and lastSeenAt: null are absent, not null or "". */
    expect(data.entities[1]).not.toHaveProperty("displayName");
    expect(data.entities[1]).not.toHaveProperty("lastSeenAt");
    expect(data.entities[0]!.lastSeenAt).toBeInstanceOf(Date);

    expect(data.relationships).toEqual([
      {
        fromEntityKey: "svc-checkout",
        toEntityKey: "db-orders",
        relationshipType: EntityRelationshipType.DependsOn,
        callCount: 120,
        errorCount: 3,
        avgDurationMs: 12.5,
      },
    ]);

    expect(Array.from(data.runsOnCounts.keys())).toEqual([
      "svc-checkout",
      "svc-payments",
    ]);
    expect(data.runsOnCounts.get("svc-checkout")).toEqual([
      { entityType: EntityType.KubernetesPod, active: 3, total: 5 },
      { entityType: EntityType.Host, active: 1, total: 1 },
    ]);
    expect(data.runsOnCounts.get("svc-payments")).toEqual([
      { entityType: EntityType.KubernetesPod, active: 0, total: 2 },
    ]);
    expect(data.truncations).toEqual([]);
  });

  /*
   * The Service Map averages parallel edges in arrival order; the server
   * sends them in the order the old list API did, so reordering here would
   * change the averages in the last decimal places.
   */
  test("keeps dependency order exactly, duplicates included", () => {
    const data: ServiceMapData = decodeServiceMapResponse(
      serviceMapPayload({
        dependencies: [
          { from: "b", to: "c", callCount: 1, errorCount: 0, avgDurationMs: 1 },
          { from: "a", to: "c", callCount: 2, errorCount: 0, avgDurationMs: 2 },
          { from: "b", to: "c", callCount: 3, errorCount: 0, avgDurationMs: 3 },
          { from: "a", to: "b", callCount: 4, errorCount: 0, avgDurationMs: 4 },
        ],
      }),
    );
    expect(
      data.relationships.map((relationship: TopologyRelationship): string => {
        return `${relationship.fromEntityKey}>${relationship.toEntityKey}:${relationship.callCount}`;
      }),
    ).toEqual(["b>c:1", "a>c:2", "b>c:3", "a>b:4"]);
  });

  test("null traffic figures are absent, and zero stays zero", () => {
    const data: ServiceMapData = decodeServiceMapResponse(
      serviceMapPayload({
        dependencies: [
          {
            from: "a",
            to: "b",
            callCount: null,
            errorCount: 0,
            avgDurationMs: null,
          },
        ],
      }),
    );
    expect(data.relationships[0]).toEqual({
      fromEntityKey: "a",
      toEntityKey: "b",
      relationshipType: EntityRelationshipType.DependsOn,
      errorCount: 0,
    });
    expect(data.relationships[0]).not.toHaveProperty("callCount");
    expect(data.relationships[0]).not.toHaveProperty("avgDurationMs");
  });

  test("counts that arrive as numeric strings become numbers", () => {
    const payload: JSONObject = serviceMapPayload() as unknown as JSONObject;
    payload["dependencies"] = [
      {
        from: "a",
        to: "b",
        callCount: "42",
        errorCount: "not a number",
        avgDurationMs: "3.5",
      },
    ];
    payload["runsOn"] = [
      { service: "a", type: EntityType.KubernetesPod, active: "2", total: "7" },
    ];
    payload["entityTruncation"] = { shown: "10", total: "12" };
    const data: ServiceMapData = decodeServiceMapResponse(payload);
    expect(data.relationships[0]!.callCount).toBe(42);
    expect(data.relationships[0]).not.toHaveProperty("errorCount");
    expect(data.relationships[0]!.avgDurationMs).toBe(3.5);
    expect(data.runsOnCounts.get("a")).toEqual([
      { entityType: EntityType.KubernetesPod, active: 2, total: 7 },
    ]);
    expect(data.truncations).toEqual([
      { kind: "resources", shown: 10, total: 12 },
    ]);
  });

  /*
   * The Service Map's attribute reader wants a non-blank string and falls
   * through to the next key otherwise; a number or an object here would be
   * rendered as a technology label.
   */
  test("attribute bags keep only string values, and an empty bag is absent", () => {
    const payload: JSONObject = serviceMapPayload() as unknown as JSONObject;
    payload["entities"] = [
      {
        key: "svc",
        type: EntityType.Service,
        name: "svc",
        source: EntitySource.Discovered,
        lastSeenAt: RANGE_START_MS,
        descriptiveAttributes: {
          "telemetry.sdk.language": "go",
          "db.system.name": 5,
          "messaging.system": { nested: "kafka" },
        },
        identifyingAttributes: { "network.protocol.name": null },
      },
      {
        key: "svc-2",
        type: EntityType.Service,
        name: "svc-2",
        source: EntitySource.Discovered,
        lastSeenAt: RANGE_START_MS,
        descriptiveAttributes: "not a bag",
      },
    ];
    const data: ServiceMapData = decodeServiceMapResponse(payload);
    expect(data.entities[0]!.descriptiveAttributes).toEqual({
      "telemetry.sdk.language": "go",
    });
    expect(data.entities[0]).not.toHaveProperty("identifyingAttributes");
    expect(data.entities[1]).not.toHaveProperty("descriptiveAttributes");
  });

  test("malformed rows are skipped instead of failing the map", () => {
    const payload: JSONObject = serviceMapPayload() as unknown as JSONObject;
    payload["entities"] = [
      { type: EntityType.Service, name: "no key" },
      "not an object",
      null,
      { key: "svc", type: EntityType.Service, name: "svc", source: "" },
    ];
    payload["dependencies"] = [
      { from: "", to: "b" },
      { from: "a" },
      { from: "a", to: "b" },
    ];
    payload["runsOn"] = [
      { service: "", type: EntityType.Host, active: 1, total: 1 },
      { service: "a", active: 1, total: 1 },
    ];
    const data: ServiceMapData = decodeServiceMapResponse(payload);
    expect(
      data.entities.map((entity: TopologyEntity): string | undefined => {
        return entity.entityKey;
      }),
    ).toEqual(["svc"]);
    expect(relationshipTriples(data.relationships)).toEqual([
      "a -depends-on-> b",
    ]);
    expect(data.runsOnCounts.size).toBe(0);
  });

  test("missing arrays read as an empty map", () => {
    const data: ServiceMapData = decodeServiceMapResponse({
      formatVersion: TOPOLOGY_API_FORMAT_VERSION,
      rangeStart: ECHOED_RANGE_START,
    });
    expect(data.entities).toEqual([]);
    expect(data.relationships).toEqual([]);
    expect(data.runsOnCounts.size).toBe(0);
    expect(data.truncations).toEqual([]);
  });

  /*
   * The two caps limit different things: the entity cap hides whole
   * services and callees, the dependency cap hides connections between
   * them. The banner words each one for what it is, so the decoder keeps
   * both, each with its kind — folding them into one "resources" figure
   * would call 200,000 connection rows "resources".
   */
  type CapCase = [
    string,
    TopologyTruncationJSON | null,
    TopologyTruncationJSON | null,
    Array<TopologyTruncation>,
  ];
  const CAP_CASES: Array<CapCase> = [
    [
      "the entity cap",
      { shown: 50000, total: 61234 },
      null,
      [{ kind: "resources", shown: 50000, total: 61234 }],
    ],
    [
      "the dependency cap",
      null,
      { shown: 200000, total: 250001 },
      [{ kind: "connections", shown: 200000, total: 250001 }],
    ],
    [
      "both caps (resources first, and neither is lost)",
      { shown: 50000, total: 50001 },
      { shown: 200000, total: 200002 },
      [
        { kind: "resources", shown: 50000, total: 50001 },
        { kind: "connections", shown: 200000, total: 200002 },
      ],
    ],
    ["no cap", null, null, []],
  ];

  test.each(CAP_CASES)(
    "reports %s with its kind",
    (
      _label: string,
      entityTruncation: TopologyTruncationJSON | null,
      dependencyTruncation: TopologyTruncationJSON | null,
      expected: Array<TopologyTruncation>,
    ) => {
      const data: ServiceMapData = decodeServiceMapResponse(
        serviceMapPayload({ entityTruncation, dependencyTruncation }),
      );
      expect(data.truncations).toEqual(expected);
    },
  );

  test("a truncation that is not an object is no truncation", () => {
    const payload: JSONObject = serviceMapPayload() as unknown as JSONObject;
    payload["entityTruncation"] = "lots";
    payload["dependencyTruncation"] = [200000, 250001];
    expect(decodeServiceMapResponse(payload).truncations).toEqual([]);
  });
});

describe("decodeInfrastructureResponse", () => {
  test("decodes resources, services, containment, placements and collections", () => {
    const data: InfrastructureData = decodeInfrastructureResponse(
      infrastructurePayload({
        nodes: [
          node("cluster-a", EntityType.KubernetesCluster),
          node("node-a", EntityType.KubernetesNode, {
            parent: 0,
            parentVia: EntityRelationshipType.PartOf,
          }),
          node("pod-1", EntityType.KubernetesPod, {
            name: null,
            parent: 1,
            parentVia: EntityRelationshipType.RunsOn,
          }),
        ],
        services: [
          { key: "svc-checkout", name: "checkout" },
          { key: "svc-unnamed", name: null },
        ],
        placements: [
          [0, 2],
          [1, 1],
        ],
        collections: [
          {
            type: EntityType.IoTDevice,
            total: 25000,
            active: 24000,
            lastSeenAt: RANGE_START_MS + 9 * MINUTE_MS,
            activeLastSeenAt: RANGE_START_MS + 9 * MINUTE_MS,
          },
          {
            type: EntityType.NetworkDevice,
            total: 1500,
            active: 0,
            lastSeenAt: RANGE_START_MS - 60 * MINUTE_MS,
            activeLastSeenAt: null,
          },
        ],
        totals: { resources: 26503, activeResources: 24003 },
      }),
    );

    expect(data.rangeStart.toISOString()).toBe(ECHOED_RANGE_START);
    expect(data.loadedAt.toISOString()).toBe(GENERATED_AT);

    /* Resources in server order, then every service. */
    expect(
      data.entities.map((entity: TopologyEntity): string => {
        return `${entity.entityType}:${entity.entityKey}`;
      }),
    ).toEqual([
      `${EntityType.KubernetesCluster}:cluster-a`,
      `${EntityType.KubernetesNode}:node-a`,
      `${EntityType.KubernetesPod}:pod-1`,
      `${EntityType.Service}:svc-checkout`,
      `${EntityType.Service}:svc-unnamed`,
    ]);
    expect(entityByKey(data.entities, "node-a")).toEqual({
      entityKey: "node-a",
      entityType: EntityType.KubernetesNode,
      displayName: "node-a",
      source: EntitySource.Discovered,
      lastSeenAt: new Date(RANGE_START_MS + MINUTE_MS),
    });
    expect(entityByKey(data.entities, "pod-1")).not.toHaveProperty(
      "displayName",
    );
    /* Services carry their name only. */
    expect(entityByKey(data.entities, "svc-checkout")).toEqual({
      entityKey: "svc-checkout",
      entityType: EntityType.Service,
      displayName: "checkout",
    });
    expect(entityByKey(data.entities, "svc-unnamed")).toEqual({
      entityKey: "svc-unnamed",
      entityType: EntityType.Service,
    });

    expect(relationshipTriples(data.relationships)).toEqual([
      "node-a -part-of-> cluster-a",
      "pod-1 -runs-on-> node-a",
      "svc-checkout -runs-on-> pod-1",
      "svc-unnamed -runs-on-> node-a",
    ]);

    expect(data.collections).toEqual([
      {
        entityType: EntityType.IoTDevice,
        total: 25000,
        active: 24000,
        lastSeenAt: new Date(RANGE_START_MS + 9 * MINUTE_MS),
        activeLastSeenAt: new Date(RANGE_START_MS + 9 * MINUTE_MS),
      },
      {
        entityType: EntityType.NetworkDevice,
        total: 1500,
        active: 0,
        lastSeenAt: new Date(RANGE_START_MS - 60 * MINUTE_MS),
        activeLastSeenAt: null,
      },
    ]);
    expect(data.totals).toEqual({ resources: 26503, activeResources: 24003 });
    expect(data.truncation).toBeNull();
  });

  test("an inactive best container also yields the best active one", () => {
    const data: InfrastructureData = decodeInfrastructureResponse(
      infrastructurePayload({
        nodes: [
          node("cluster-a", EntityType.KubernetesCluster),
          node("node-b", EntityType.KubernetesNode, {
            lastSeenAt: RANGE_START_MS - MINUTE_MS,
          }),
          node("pod-1", EntityType.KubernetesPod, {
            parent: 1,
            parentVia: EntityRelationshipType.RunsOn,
            activeParent: 0,
            activeParentVia: EntityRelationshipType.MemberOf,
          }),
        ],
      }),
    );
    expect(relationshipTriples(data.relationships)).toEqual([
      "pod-1 -runs-on-> node-b",
      "pod-1 -member-of-> cluster-a",
    ]);
  });

  test("activeParent -1 (no active container) adds nothing", () => {
    const data: InfrastructureData = decodeInfrastructureResponse(
      infrastructurePayload({
        nodes: [
          node("node-b", EntityType.KubernetesNode, {
            lastSeenAt: RANGE_START_MS - MINUTE_MS,
          }),
          node("pod-1", EntityType.KubernetesPod, {
            parent: 0,
            parentVia: EntityRelationshipType.RunsOn,
            activeParent: -1,
          }),
        ],
      }),
    );
    expect(relationshipTriples(data.relationships)).toEqual([
      "pod-1 -runs-on-> node-b",
    ]);
  });

  test("an active container repeating the best one is not drawn twice", () => {
    const data: InfrastructureData = decodeInfrastructureResponse(
      infrastructurePayload({
        nodes: [
          node("node-b", EntityType.KubernetesNode),
          node("pod-1", EntityType.KubernetesPod, {
            parent: 0,
            parentVia: EntityRelationshipType.RunsOn,
            activeParent: 0,
            activeParentVia: EntityRelationshipType.RunsOn,
          }),
          /* Same container, different relationship: both are kept. */
          node("pod-2", EntityType.KubernetesPod, {
            parent: 0,
            parentVia: EntityRelationshipType.PartOf,
            activeParent: 0,
            activeParentVia: EntityRelationshipType.RunsOn,
          }),
        ],
      }),
    );
    expect(relationshipTriples(data.relationships)).toEqual([
      "pod-1 -runs-on-> node-b",
      "pod-2 -part-of-> node-b",
      "pod-2 -runs-on-> node-b",
    ]);
  });

  test("container references that cannot be resolved are dropped", () => {
    const payload: JSONObject =
      infrastructurePayload() as unknown as JSONObject;
    payload["nodes"] = [
      { ...node("node-a", EntityType.KubernetesNode) },
      /* Points past the end of `nodes`. */
      {
        ...node("pod-1", EntityType.KubernetesPod),
        parent: 99,
        parentVia: "runs-on",
      },
      /* Points at itself. */
      {
        ...node("pod-2", EntityType.KubernetesPod),
        parent: 2,
        parentVia: "runs-on",
      },
      /* Not an integer index. */
      {
        ...node("pod-3", EntityType.KubernetesPod),
        parent: 0.5,
        parentVia: "runs-on",
      },
      /* No relationship type: the client model could not rank it. */
      { ...node("pod-4", EntityType.KubernetesPod), parent: 0 },
      /* A string index is not an index. */
      {
        ...node("pod-5", EntityType.KubernetesPod),
        parent: "0",
        parentVia: "runs-on",
      },
      /* The one good reference. */
      {
        ...node("pod-6", EntityType.KubernetesPod),
        parent: 0,
        parentVia: "runs-on",
      },
    ];
    const data: InfrastructureData = decodeInfrastructureResponse(payload);
    expect(relationshipTriples(data.relationships)).toEqual([
      "pod-6 -runs-on-> node-a",
    ]);
  });

  /*
   * Every index in the payload is a position in the server's arrays. A
   * malformed row must keep its slot, or every later reference would land on
   * the wrong resource.
   */
  test("a malformed row keeps its slot so later indexes still resolve", () => {
    const payload: JSONObject =
      infrastructurePayload() as unknown as JSONObject;
    payload["nodes"] = [
      { type: EntityType.KubernetesNode, name: "no key" },
      "garbage",
      { ...node("node-c", EntityType.KubernetesNode) },
      {
        ...node("pod-1", EntityType.KubernetesPod),
        parent: 2,
        parentVia: "runs-on",
      },
      /* Points at the malformed row: nothing to nest under. */
      {
        ...node("pod-2", EntityType.KubernetesPod),
        parent: 0,
        parentVia: "runs-on",
      },
    ];
    payload["services"] = [
      { name: "no key" },
      { key: "svc-a", name: "a" },
      null,
    ];
    payload["placements"] = [
      [1, 3],
      [0, 3],
      [2, 3],
      [1, 1],
      [1, 99],
      [1],
      "not a pair",
      [1, 2],
    ];
    const data: InfrastructureData = decodeInfrastructureResponse(payload);
    expect(
      data.entities.map((entity: TopologyEntity): string | undefined => {
        return entity.entityKey;
      }),
    ).toEqual(["node-c", "pod-1", "pod-2", "svc-a"]);
    expect(relationshipTriples(data.relationships)).toEqual([
      "pod-1 -runs-on-> node-c",
      "svc-a -runs-on-> pod-1",
      "svc-a -runs-on-> node-c",
    ]);
  });

  test("missing totals, collections and truncation read as empty", () => {
    const data: InfrastructureData = decodeInfrastructureResponse({
      formatVersion: TOPOLOGY_API_FORMAT_VERSION,
      rangeStart: ECHOED_RANGE_START,
      generatedAt: GENERATED_AT,
    });
    expect(data.entities).toEqual([]);
    expect(data.relationships).toEqual([]);
    expect(data.collections).toEqual([]);
    expect(data.totals).toEqual({ resources: 0, activeResources: 0 });
    expect(data.truncation).toBeNull();
    expect(data.dependencyTruncation).toBeNull();
  });

  /*
   * Issue #3972: the map draws traffic between resources from the calls
   * between the services on them, so the calls must survive decoding with
   * their traffic and land on the right services.
   */
  describe("calls between placed services", () => {
    function tracedPayload(
      dependencies: Array<unknown>,
    ): TopologyInfrastructureResponseJSON {
      return infrastructurePayload({
        nodes: [
          node("pod-backend", EntityType.KubernetesPod),
          node("pod-blob", EntityType.KubernetesPod),
        ],
        services: [
          { key: "svc-backend", name: "wb-ims-backend" },
          { key: "svc-blob", name: "wb-ims-blob" },
          { key: "svc-edh", name: "wb-ims-integration-edh" },
        ],
        placements: [
          [0, 0],
          [1, 1],
        ],
        dependencies:
          dependencies as TopologyInfrastructureResponseJSON["dependencies"],
      });
    }

    function calls(data: InfrastructureData): Array<TopologyRelationship> {
      return data.relationships.filter(
        (relationship: TopologyRelationship): boolean => {
          return (
            relationship.relationshipType === EntityRelationshipType.DependsOn
          );
        },
      );
    }

    test("service indexes become depends-on relationships with their traffic", () => {
      const data: InfrastructureData = decodeInfrastructureResponse(
        tracedPayload([
          {
            from: 0,
            to: 1,
            callCount: 1200,
            errorCount: 6,
            avgDurationMs: 45.5,
          },
          { from: 1, to: 2, callCount: 0, errorCount: 0, avgDurationMs: null },
        ]),
      );
      expect(calls(data)).toEqual([
        {
          fromEntityKey: "svc-backend",
          toEntityKey: "svc-blob",
          relationshipType: EntityRelationshipType.DependsOn,
          callCount: 1200,
          errorCount: 6,
          avgDurationMs: 45.5,
        },
        {
          fromEntityKey: "svc-blob",
          toEntityKey: "svc-edh",
          relationshipType: EntityRelationshipType.DependsOn,
          callCount: 0,
          errorCount: 0,
        },
      ]);
      /* The containment and placements are decoded exactly as before. */
      expect(relationshipTriples(data.relationships)).toEqual([
        "svc-backend -runs-on-> pod-backend",
        "svc-blob -runs-on-> pod-blob",
        "svc-backend -depends-on-> svc-blob",
        "svc-blob -depends-on-> svc-edh",
      ]);
    });

    test("traffic sent as numeric strings becomes numbers; garbage stays absent", () => {
      const data: InfrastructureData = decodeInfrastructureResponse(
        tracedPayload([
          {
            from: 0,
            to: 1,
            callCount: "1200",
            errorCount: "lots",
            avgDurationMs: "12.5",
          },
        ]),
      );
      expect(calls(data)).toEqual([
        {
          fromEntityKey: "svc-backend",
          toEntityKey: "svc-blob",
          relationshipType: EntityRelationshipType.DependsOn,
          callCount: 1200,
          avgDurationMs: 12.5,
        },
      ]);
    });

    test("a call whose ends cannot be resolved, or that calls itself, is skipped", () => {
      const data: InfrastructureData = decodeInfrastructureResponse(
        tracedPayload([
          { from: 0, to: 0, callCount: 5, errorCount: 0, avgDurationMs: 1 },
          { from: 0, to: 9, callCount: 5, errorCount: 0, avgDurationMs: 1 },
          { from: -1, to: 1, callCount: 5, errorCount: 0, avgDurationMs: 1 },
          { from: 0.5, to: 1, callCount: 5, errorCount: 0, avgDurationMs: 1 },
          { from: "0", to: 1, callCount: 5, errorCount: 0, avgDurationMs: 1 },
          { to: 1, callCount: 5 },
          "not a row",
          null,
          { from: 1, to: 0, callCount: 7, errorCount: 1, avgDurationMs: 2 },
        ]),
      );
      expect(relationshipTriples(calls(data))).toEqual([
        "svc-blob -depends-on-> svc-backend",
      ]);
    });

    test("a payload from a server without calls draws no traffic", () => {
      const payload: JSONObject = tracedPayload([]) as unknown as JSONObject;
      delete payload["dependencies"];
      delete payload["dependencyTruncation"];
      const data: InfrastructureData = decodeInfrastructureResponse(payload);
      expect(calls(data)).toEqual([]);
      expect(data.dependencyTruncation).toBeNull();
      /* Everything else still decodes. */
      expect(relationshipTriples(data.relationships)).toEqual([
        "svc-backend -runs-on-> pod-backend",
        "svc-blob -runs-on-> pod-blob",
      ]);
    });

    test("a hit call cap is reported as connections", () => {
      const data: InfrastructureData = decodeInfrastructureResponse(
        infrastructurePayload({
          dependencyTruncation: { shown: 200000, total: 250001 },
        }),
      );
      expect(data.dependencyTruncation).toEqual({
        kind: "connections",
        shown: 200000,
        total: 250001,
      });
      expect(data.truncation).toBeNull();
    });
  });

  test("a hit safety cap is reported with exact totals", () => {
    const data: InfrastructureData = decodeInfrastructureResponse(
      infrastructurePayload({
        truncation: { shown: 200000, total: 212345 },
        totals: { resources: 212345, activeResources: 180000 },
      }),
    );
    expect(data.truncation).toEqual({
      kind: "resources",
      shown: 200000,
      total: 212345,
    });
    expect(data.totals).toEqual({
      resources: 212345,
      activeResources: 180000,
    });
  });

  test("a collection without a type is skipped, and bad counts read as zero", () => {
    const payload: JSONObject =
      infrastructurePayload() as unknown as JSONObject;
    payload["collections"] = [
      { total: 5000, active: 10 },
      {
        type: EntityType.CloudResource,
        total: -4,
        active: "lots",
        lastSeenAt: "yesterday",
        activeLastSeenAt: null,
      },
    ];
    const data: InfrastructureData = decodeInfrastructureResponse(payload);
    expect(data.collections).toEqual([
      {
        entityType: EntityType.CloudResource,
        total: 0,
        active: 0,
        lastSeenAt: null,
        activeLastSeenAt: null,
      },
    ]);
  });
});

/*
 * The two properties the whole design leans on, checked end to end against
 * the client's own predicates rather than restated.
 */
describe("decoded rows feed the unchanged client model", () => {
  /*
   * The server's activity predicate: a non-discovered source is always
   * active; otherwise no lastSeenAt is active; otherwise lastSeenAt >= the
   * echoed range start. The decoded rows must give isEntityActive the same
   * answers when judged against the ECHOED start.
   */
  test("activity judged against the echoed range start matches the server's", () => {
    const data: InfrastructureData = decodeInfrastructureResponse(
      infrastructurePayload({
        nodes: [
          node("discovered-at-start", EntityType.Host, {
            lastSeenAt: RANGE_START_MS,
          }),
          node("discovered-just-before", EntityType.Host, {
            lastSeenAt: RANGE_START_MS - 1,
          }),
          node("discovered-never-seen", EntityType.Host, { lastSeenAt: null }),
          node("inventory-old", EntityType.Host, {
            source: EntitySource.Inventory,
            lastSeenAt: RANGE_START_MS - 30 * 24 * 60 * MINUTE_MS,
          }),
          node("manual-old", EntityType.Host, {
            source: "manual",
            lastSeenAt: RANGE_START_MS - 30 * 24 * 60 * MINUTE_MS,
          }),
          /* An empty source is not "non-discovered" (SQL: source <> ''). */
          node("blank-source-old", EntityType.Host, {
            source: "",
            lastSeenAt: RANGE_START_MS - MINUTE_MS,
          }),
        ],
      }),
    );
    const activity: Record<string, boolean> = {};
    for (const entity of data.entities) {
      activity[entity.entityKey!] = isEntityActive(entity, data.rangeStart);
    }
    expect(activity).toEqual({
      "discovered-at-start": true,
      "discovered-just-before": false,
      "discovered-never-seen": true,
      "inventory-old": true,
      "manual-old": true,
      "blank-source-old": false,
    });
  });

  /*
   * The server sends each resource's best container and, when that one is
   * inactive, its best active container. Feeding just those two rows to the
   * client's own parent selection must give the server's choice with
   * inactive resources shown, and the active fallback with them hidden.
   */
  test("the synthesized containment rebuilds the server's choice in both modes", () => {
    const data: InfrastructureData = decodeInfrastructureResponse(
      infrastructurePayload({
        nodes: [
          node("cluster-a", EntityType.KubernetesCluster),
          node("node-b", EntityType.KubernetesNode, {
            lastSeenAt: RANGE_START_MS - MINUTE_MS,
          }),
          node("pod-1", EntityType.KubernetesPod, {
            parent: 1,
            parentVia: EntityRelationshipType.RunsOn,
            activeParent: 0,
            activeParentVia: EntityRelationshipType.MemberOf,
          }),
        ],
      }),
    );
    const typeByKey: Map<string, string | undefined> = new Map<
      string,
      string | undefined
    >(
      data.entities.map(
        (entity: TopologyEntity): [string, string | undefined] => {
          return [entity.entityKey!, entity.entityType];
        },
      ),
    );
    const edges: Array<{
      fromEntityKey: string;
      toEntityKey: string;
      relationshipType: string;
    }> = data.relationships.map(
      (
        relationship: TopologyRelationship,
      ): {
        fromEntityKey: string;
        toEntityKey: string;
        relationshipType: string;
      } => {
        return {
          fromEntityKey: relationship.fromEntityKey!,
          toEntityKey: relationship.toEntityKey!,
          relationshipType: relationship.relationshipType!,
        };
      },
    );

    const withInactive: Map<string, string> = computeInfraParenting(
      edges,
      typeByKey,
    ).parentOf;
    expect(withInactive.get("pod-1")).toBe("node-b");

    const activeKeys: Set<string> = new Set<string>(
      data.entities
        .filter((entity: TopologyEntity): boolean => {
          return isEntityActive(entity, data.rangeStart);
        })
        .map((entity: TopologyEntity): string => {
          return entity.entityKey!;
        }),
    );
    const visibleEdges: typeof edges = edges.filter(
      (edge: (typeof edges)[number]): boolean => {
        return (
          activeKeys.has(edge.fromEntityKey) && activeKeys.has(edge.toEntityKey)
        );
      },
    );
    const withoutInactive: Map<string, string> = computeInfraParenting(
      visibleEdges,
      typeByKey,
    ).parentOf;
    expect(withoutInactive.get("pod-1")).toBe("cluster-a");
  });
});

describe("TopologyApi transport", () => {
  const RANGE_START: Date = new Date("2026-09-20T10:15:37.123Z");

  test.each([
    ["the service map", TopologyApiPath.ServiceMap],
    ["infrastructure", TopologyApiPath.Infrastructure],
  ])(
    "fetching %s posts the pinned range start with the tenant header and the abort signal",
    async (label: string, path: TopologyApiPath) => {
      respondWith(
        path === TopologyApiPath.ServiceMap
          ? serviceMapPayload()
          : infrastructurePayload(),
      );
      const controller: AbortController = new AbortController();
      if (label === "the service map") {
        await fetchServiceMapData(RANGE_START, { signal: controller.signal });
      } else {
        await fetchInfrastructureData(RANGE_START, {
          signal: controller.signal,
        });
      }
      expect(postMock).toHaveBeenCalledTimes(1);
      const options: PostOptions = lastPostOptions();
      expect(options.url.toString()).toBe(`http://localhost/api${path}`);
      /* Full precision: the server floors it and echoes what it used. */
      expect(options.data).toEqual({
        rangeStart: "2026-09-20T10:15:37.123Z",
      });
      expect(options.headers).toEqual(TENANT_HEADERS);
      expect(options.options.signal).toBe(controller.signal);
    },
  );

  /*
   * An explicit refresh asks the server to rebuild instead of answering from
   * its response cache. The flag is sent only when set: every ordinary load
   * keeps the exact body the cache is keyed for.
   */
  test.each([
    ["the service map", TopologyApiPath.ServiceMap],
    ["infrastructure", TopologyApiPath.Infrastructure],
  ])(
    "fetching %s sends fresh: true only when asked to",
    async (label: string, path: TopologyApiPath) => {
      respondWith(
        path === TopologyApiPath.ServiceMap
          ? serviceMapPayload()
          : infrastructurePayload(),
      );
      const fetchData: (
        options?: TopologyRequestOptions | undefined,
      ) => Promise<unknown> = (
        options?: TopologyRequestOptions | undefined,
      ): Promise<unknown> => {
        return label === "the service map"
          ? fetchServiceMapData(RANGE_START, options)
          : fetchInfrastructureData(RANGE_START, options);
      };

      const controller: AbortController = new AbortController();
      await fetchData({ fresh: true, signal: controller.signal });
      expect(lastPostOptions().url.toString()).toBe(
        `http://localhost/api${path}`,
      );
      expect(lastPostOptions().data).toEqual({
        rangeStart: "2026-09-20T10:15:37.123Z",
        fresh: true,
      });
      expect(lastPostOptions().options.signal).toBe(controller.signal);

      const ordinary: Array<TopologyRequestOptions | undefined> = [
        { fresh: false },
        {},
        undefined,
      ];
      for (const options of ordinary) {
        await fetchData(options);
        expect(lastPostOptions().data).toEqual({
          rangeStart: "2026-09-20T10:15:37.123Z",
        });
        expect(lastPostOptions().data).not.toHaveProperty("fresh");
      }
    },
  );

  test("the decoded data carries the server's echo, not the requested start", async () => {
    respondWith(serviceMapPayload());
    const data: ServiceMapData = await fetchServiceMapData(RANGE_START);
    expect(data.rangeStart.toISOString()).toBe(ECHOED_RANGE_START);
    expect(data.rangeStart.getTime()).not.toBe(RANGE_START.getTime());
  });

  /*
   * APP_API_URL is a shared module-level object and URL.addRoute mutates the
   * instance it is called on; a client that added the route to APP_API_URL
   * itself would ask for a doubled path the second time.
   */
  test("repeated calls keep asking for the same route", async () => {
    respondWith(infrastructurePayload());
    await fetchInfrastructureData(RANGE_START);
    await fetchInfrastructureData(RANGE_START);
    const routes: Array<string> = (
      postMock.mock.calls as Array<Array<unknown>>
    ).map((call: Array<unknown>): string => {
      return (call[0] as PostOptions).url.toString();
    });
    expect(routes).toEqual([
      "http://localhost/api/telemetry/topology/infrastructure",
      "http://localhost/api/telemetry/topology/infrastructure",
    ]);
  });

  /* A server without the route is older than this bundle. */
  test("a 404 means the server does not speak this contract", async () => {
    postMock.mockResolvedValue(
      new HTTPErrorResponse(404, { message: "Not found" }, {}),
    );
    await expect(fetchServiceMapData(RANGE_START)).rejects.toBeInstanceOf(
      TopologyOutdatedError,
    );
    await expect(fetchInfrastructureData(RANGE_START)).rejects.toBeInstanceOf(
      TopologyOutdatedError,
    );
  });

  test("a payload in another format version is refused", async () => {
    respondWith(
      serviceMapPayload({ formatVersion: TOPOLOGY_API_FORMAT_VERSION + 1 }),
    );
    await expect(fetchServiceMapData(RANGE_START)).rejects.toBeInstanceOf(
      TopologyOutdatedError,
    );
  });

  /*
   * Any other failure reaches the caller as the HTTPErrorResponse itself,
   * which API.getFriendlyMessage turns into the server's reason.
   */
  test.each([400, 402, 403, 500, 502])(
    "a %s rejects with the HTTPErrorResponse",
    async (statusCode: number) => {
      const error: HTTPErrorResponse = new HTTPErrorResponse(
        statusCode,
        { message: "Nope" },
        {},
      );
      postMock.mockResolvedValue(error);
      await expect(fetchInfrastructureData(RANGE_START)).rejects.toBe(error);
    },
  );

  /*
   * The server caps concurrent topology work and answers 429 when it is
   * full. That passes, unlike an outdated bundle: callers recognise it and
   * offer "Try again" with a friendly message.
   */
  test("a 429 rejects with the HTTPErrorResponse, recognised as busy rather than outdated", async () => {
    const busy: HTTPErrorResponse = new HTTPErrorResponse(
      429,
      { message: "Too many topology requests are running." },
      {},
    );
    postMock.mockResolvedValue(busy);
    let thrown: unknown = null;
    try {
      await fetchServiceMapData(RANGE_START);
    } catch (error: unknown) {
      thrown = error;
    }
    expect(thrown).toBe(busy);
    expect(thrown).not.toBeInstanceOf(TopologyOutdatedError);
    expect(isTopologyBusyError(thrown)).toBe(true);
    expect(TOPOLOGY_BUSY_MESSAGE).toBe(
      "The topology service is busy. Try again in a moment.",
    );
  });

  test.each([
    ["a 500", new HTTPErrorResponse(500, { message: "Nope" }, {})],
    ["a 503", new HTTPErrorResponse(503, { message: "Nope" }, {})],
    ["a 404", new HTTPErrorResponse(404, { message: "Nope" }, {})],
    ["an outdated bundle", new TopologyOutdatedError()],
    ["a plain error", new Error("429")],
    ["a status-shaped object", { statusCode: 429 }],
    ["nothing", null],
  ])("%s is not a busy server", (_label: string, error: unknown) => {
    expect(isTopologyBusyError(error)).toBe(false);
  });

  test("a transport failure (e.g. an aborted request) propagates", async () => {
    const failure: Error = new Error("Request Canceled.");
    postMock.mockRejectedValue(failure);
    await expect(fetchServiceMapData(RANGE_START)).rejects.toBe(failure);
  });
});
