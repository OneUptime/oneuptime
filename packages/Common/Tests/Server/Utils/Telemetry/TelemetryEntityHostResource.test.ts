import InventoryItem, {
  EntityAttributes,
  EntityExtractionResult,
  ExtractedEntity,
} from "../../../../Server/Utils/Telemetry/TelemetryEntity";
import EntityType from "../../../../Types/Telemetry/EntityType";
import { keyForHost } from "../../../../Utils/Telemetry/EntityKey";
import { describe, expect, test } from "@jest/globals";

/*
 * Which resources register a Host item in Inventory (issue #11257).
 *
 * Only a host's own telemetry does. A Docker or Podman agent's, a
 * container's or an application's resource names the host it runs on in
 * host.name without describing it: every Docker host was in Inventory
 * twice - its mirrored Docker host and a Host from its agent's host.name -
 * and every pod whose app exports OTLP straight to OneUptime was a Host
 * named after the pod. Such a resource's Host is link-only now: the key is
 * still stamped on the signal (the Host its machine's collector registered
 * keeps the app's logs and its Topology), but it never mints a registry row,
 * and the row the old heuristic minted is a retirement candidate.
 *
 * A RUM client's resource is the exception the device-naming guide
 * documents: each device a fleet names in host.name is a host item.
 */

const PROJECT: string = "proj-11257";

function extract(attributes: EntityAttributes): EntityExtractionResult {
  return InventoryItem.extractEntitiesWithRetirements({
    projectId: PROJECT,
    attributes,
  });
}

function hostOf(result: EntityExtractionResult): ExtractedEntity | undefined {
  return result.entities.find((entity: ExtractedEntity) => {
    return entity.entityType === EntityType.Host;
  });
}

// What the recordings hold (App/Tests/Telemetry/Fixtures/HostResourceRecordings).
const HOST_COLLECTOR: EntityAttributes = {
  "host.name": "db-01",
  "host.id": "4e1b9c7d-2a3f-4b5c-8d6e-9f0a1b2c3d4e",
  "os.type": "linux",
  "cloud.provider": "azure",
};

const DOCKER_AGENT: EntityAttributes = {
  "container.id":
    "8cb880203d291c1695939ecf20c30ed34826461b83b47283fba4f98233a4750e",
  "container.name": "hosts11257-docker-app",
  "container.runtime": "docker",
  "host.name": "web-shop-01",
  "os.type": "linux",
};

const POD_APP: EntityAttributes = {
  "host.name": "shop-worker-6748887dc-2wr95",
  "os.type": "linux",
  "process.runtime.name": "nodejs",
  "service.name": "shop-worker",
  "telemetry.sdk.language": "nodejs",
  "telemetry.sdk.name": "opentelemetry",
};

const KIOSK_APP: EntityAttributes = {
  "service.name": "kiosk-ordering",
  "telemetry.sdk.name": "opentelemetry",
  "telemetry.sdk.language": "java",
  "device.model.identifier": "Elo-i3-15",
  "device.manufacturer": "Elo Touch Solutions",
  "os.name": "Android",
  "os.type": "linux",
  "host.name": "store-0412-kiosk-02",
};

describe("the Inventory's Host resolver", () => {
  test("a host's own collector registers its Host", () => {
    const result: EntityExtractionResult = extract(HOST_COLLECTOR);
    const host: ExtractedEntity | undefined = hostOf(result);

    expect(host).toBeDefined();
    expect(host!.linkOnly).toBeUndefined();
    expect(host!.entityKey).toBe(keyForHost(PROJECT, "db-01"));
    expect(result.retiredEntities).toBeUndefined();
  });

  test("the Docker Agent's resource only names its machine: link-only, and its legacy Host retires", () => {
    const result: EntityExtractionResult = extract(DOCKER_AGENT);
    const host: ExtractedEntity | undefined = hostOf(result);

    expect(host!.linkOnly).toBe(true);
    // Still the machine's membership key on the signal.
    expect(host!.entityKey).toBe(keyForHost(PROJECT, "web-shop-01"));
    expect(result.retiredEntities).toEqual([
      {
        entityType: EntityType.Host,
        entityKey: keyForHost(PROJECT, "web-shop-01"),
        identifyingAttributes: { "host.name": "web-shop-01" },
      },
    ]);
  });

  test("the Podman Agent's too", () => {
    const result: EntityExtractionResult = extract({
      ...DOCKER_AGENT,
      "container.runtime": "podman",
    });

    expect(hostOf(result)!.linkOnly).toBe(true);
    expect(result.retiredEntities).toHaveLength(1);
  });

  test("an app in a pod that names its pod in host.name registers no Host, and its old one retires", () => {
    const result: EntityExtractionResult = extract(POD_APP);
    const host: ExtractedEntity | undefined = hostOf(result);

    expect(host!.linkOnly).toBe(true);
    expect(result.retiredEntities![0]!.entityKey).toBe(
      keyForHost(PROJECT, "shop-worker-6748887dc-2wr95"),
    );

    // The app's own entities are untouched.
    expect(
      result.entities.some((entity: ExtractedEntity) => {
        return entity.entityType === EntityType.Service && !entity.linkOnly;
      }),
    ).toBe(true);
  });

  test("an app that runs on a machine still names it, for that machine's Host to keep", () => {
    // Same key as the Host the machine's own collector registers.
    expect(
      hostOf(
        extract({
          "host.name": "db-01",
          "service.name": "billing",
          "telemetry.sdk.name": "opentelemetry",
          "telemetry.sdk.language": "go",
        }),
      )!.entityKey,
    ).toBe(hostOf(extract(HOST_COLLECTOR))!.entityKey);
  });

  test("telemetry from inside a container registers no Host", () => {
    const result: EntityExtractionResult = extract({
      ...HOST_COLLECTOR,
      "container.id": "f7c01bbfb854",
    });

    expect(hostOf(result)!.linkOnly).toBe(true);
    expect(result.retiredEntities).toHaveLength(1);
  });

  test("Kubernetes keeps no Host entity at all, and retires the legacy one, as before", () => {
    const result: EntityExtractionResult = extract({
      ...POD_APP,
      "k8s.pod.name": "shop-worker-6748887dc-2wr95",
    });

    expect(hostOf(result)).toBeUndefined();
    expect(result.retiredEntities).toHaveLength(1);
  });

  test("a mobile app that names its device in host.name keeps it as a host item, as the guide says", () => {
    const result: EntityExtractionResult = extract(KIOSK_APP);

    expect(hostOf(result)!.linkOnly).toBeUndefined();
    expect(result.retiredEntities).toBeUndefined();
  });

  test("a public key's stamped client is a RUM client too", () => {
    const result: EntityExtractionResult = extract({
      "service.name": "kiosk-ordering",
      "telemetry.sdk.name": "opentelemetry",
      "telemetry.sdk.language": "java",
      "oneuptime.rum.client.kind": "mobile",
      "host.name": "store-0412-kiosk-03",
    });

    expect(hostOf(result)!.linkOnly).toBeUndefined();
  });

  test("producer entity_refs stay authoritative and retire nothing", () => {
    const result: EntityExtractionResult =
      InventoryItem.extractEntitiesWithRetirements({
        projectId: PROJECT,
        attributes: DOCKER_AGENT,
        entityRefs: [{ type: "host", idKeys: ["host.name"] }],
      });

    expect(hostOf(result)!.linkOnly).toBeUndefined();
    expect(result.retiredEntities).toBeUndefined();
  });

  test("no host.name, no Host and nothing to retire", () => {
    const result: EntityExtractionResult = extract({
      "container.runtime": "docker",
      "container.id": "abc",
    });

    expect(hostOf(result)).toBeUndefined();
    expect(result.retiredEntities).toBeUndefined();
  });
});

describe("namesAHostItDoesNotDescribe", () => {
  test.each([
    ["a host's own collector", HOST_COLLECTOR, false],
    ["the Docker Agent", DOCKER_AGENT, true],
    ["an app in a pod", POD_APP, true],
    ["a mobile app naming its device", KIOSK_APP, false],
    [
      "a Kubernetes node",
      { "host.name": "n1", "k8s.node.name": "n1", "os.type": "linux" },
      true,
    ],
    [
      "a browser page",
      {
        "service.name": "storefront",
        "telemetry.sdk.language": "webjs",
        "browser.language": "en-US",
        "host.name": "kiosk-7",
      },
      false,
    ],
  ] as Array<[string, EntityAttributes, boolean]>)(
    "%s: %s",
    (_label: string, attributes: EntityAttributes, expected: boolean) => {
      expect(InventoryItem.namesAHostItDoesNotDescribe(attributes)).toBe(
        expected,
      );
    },
  );
});
