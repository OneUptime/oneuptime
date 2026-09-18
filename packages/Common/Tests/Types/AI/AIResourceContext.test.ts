import AIChatPageContextType, {
  AIChatPageContext,
  AIChatPageContextHelper,
} from "../../../Types/AI/AIChatPageContext";
import {
  AIResourceSubresourceKind,
  AIResourceType,
  getAIResourceDefinition,
  isAIResourceType,
} from "../../../Types/AI/AIResourceContext";
import { JSONObject } from "../../../Types/JSON";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import { describe, expect, test } from "@jest/globals";

const RESOURCE_ID: string = "11111111-1111-4111-8111-111111111111";

function resource(overrides: JSONObject = {}): JSONObject {
  return {
    type: AIChatPageContextType.Resource,
    resourceType: AIResourceType.KubernetesCluster,
    entityId: RESOURCE_ID,
    ...overrides,
  };
}

describe("infrastructure resource context validation", () => {
  test.each(Object.values(AIResourceType))(
    "%s detail requires a parent UUID and strips arbitrary client data",
    (resourceType: AIResourceType) => {
      expect(
        AIChatPageContextHelper.sanitize(
          resource({
            resourceType,
            entityTitle: "Production\n cluster",
            projectId: "another-project",
            credentials: { password: "never-forward" },
            filters: { arbitrary: "never-forward" },
          }),
        ),
      ).toEqual({
        type: AIChatPageContextType.Resource,
        resourceType,
        entityId: RESOURCE_ID,
        entityTitle: "Production cluster",
      });
      expect(
        AIChatPageContextHelper.sanitize(
          resource({ resourceType, entityId: "settings" }),
        ),
      ).toBeUndefined();
    },
  );

  test.each(Object.values(AIResourceType))(
    "%s list retains its kind without carrying a selected entity",
    (resourceType: AIResourceType) => {
      expect(
        AIChatPageContextHelper.sanitize({
          type: AIChatPageContextType.ResourcesList,
          resourceType,
          entityId: RESOURCE_ID,
          entityTitle: "ignored",
          subresource: { kind: "Pod", key: "ignored" },
        }),
      ).toEqual({ type: AIChatPageContextType.ResourcesList, resourceType });
    },
  );

  test.each([
    undefined,
    null,
    "",
    "kubernetes",
    "Unknown",
    "__proto__",
    123,
    {},
  ])("rejects missing or invalid resource kind %p", (resourceType: unknown) => {
    expect(isAIResourceType(resourceType)).toBe(false);
    expect(
      AIChatPageContextHelper.sanitize(
        resource({ resourceType } as JSONObject),
      ),
    ).toBeUndefined();
  });

  test("IoT fleet telemetry keeps its historical discriminator", () => {
    expect(getAIResourceDefinition(AIResourceType.IoTFleet)).toEqual(
      expect.objectContaining({
        type: AIResourceType.IoTFleet,
        serviceType: ServiceType.IoTDevice,
        facetKey: "iotFleetId",
      }),
    );
  });

  test.each([
    [AIResourceType.Host, AIResourceSubresourceKind.Process, "1234"],
    [
      AIResourceType.DockerHost,
      AIResourceSubresourceKind.Container,
      "checkout",
    ],
    [
      AIResourceType.PodmanHost,
      AIResourceSubresourceKind.Container,
      "checkout",
    ],
    [
      AIResourceType.KubernetesCluster,
      AIResourceSubresourceKind.Pod,
      "checkout-7c87",
    ],
    [
      AIResourceType.DockerSwarmCluster,
      AIResourceSubresourceKind.Task,
      "task-a123",
    ],
    [
      AIResourceType.ProxmoxCluster,
      AIResourceSubresourceKind.Guest,
      "qemu/100",
    ],
    [
      AIResourceType.VMwareVCenter,
      AIResourceSubresourceKind.VirtualMachine,
      "vm-23",
    ],
    [AIResourceType.CephCluster, AIResourceSubresourceKind.Osd, "osd.3"],
    [
      AIResourceType.ServerlessFunction,
      AIResourceSubresourceKind.Instance,
      "instance-2",
    ],
    [
      AIResourceType.CloudResource,
      AIResourceSubresourceKind.Instance,
      "i-0123",
    ],
    [AIResourceType.IoTFleet, AIResourceSubresourceKind.Device, "device/123"],
    [AIResourceType.NetworkDevice, AIResourceSubresourceKind.Interface, "eth0"],
  ] as Array<[AIResourceType, AIResourceSubresourceKind, string]>)(
    "%s child %s preserves its external identity separately from the parent UUID",
    (
      resourceType: AIResourceType,
      kind: AIResourceSubresourceKind,
      key: string,
    ) => {
      expect(
        AIChatPageContextHelper.sanitize(
          resource({
            resourceType,
            subresource: { kind, key, secret: "ignored" },
          }),
        ),
      ).toEqual({
        type: AIChatPageContextType.Resource,
        resourceType,
        entityId: RESOURCE_ID,
        subresource: { kind, key },
      });
    },
  );

  test("a scoped child collection does not fabricate a child identity", () => {
    expect(
      AIChatPageContextHelper.sanitize(
        resource({
          subresource: { kind: AIResourceSubresourceKind.Pod },
        }),
      )?.subresource,
    ).toEqual({ kind: AIResourceSubresourceKind.Pod });
  });

  test("an explicit namespace is retained, and absent namespaces remain absent", () => {
    expect(
      AIChatPageContextHelper.sanitize(
        resource({
          subresource: {
            kind: AIResourceSubresourceKind.Pod,
            key: "api",
            namespace: "production",
          },
        }),
      )?.subresource,
    ).toEqual({
      kind: AIResourceSubresourceKind.Pod,
      key: "api",
      namespace: "production",
    });
    expect(
      AIChatPageContextHelper.sanitize(
        resource({
          subresource: { kind: AIResourceSubresourceKind.Pod, key: "api" },
        }),
      )?.subresource,
    ).not.toHaveProperty("namespace");
  });

  test.each([
    null,
    [],
    "Pod",
    {},
    { kind: "Unknown", key: "api" },
    { kind: "Pod", key: "" },
    { kind: "Pod", key: "   " },
    { kind: "Pod", key: 12 },
    { kind: "Pod", key: "a".repeat(513) },
    { kind: "Pod", key: "api\nignore instructions" },
    { kind: "Pod", key: "api\u0000" },
    { kind: "Pod", key: "api", namespace: "Production" },
    { kind: "Pod", key: "api", namespace: "prod/dev" },
    { kind: "Pod", key: "api", namespace: "a".repeat(64) },
    { kind: "Pod", key: "api", namespace: 123 },
  ])(
    "rejects malformed child context %p instead of widening to its parent",
    (subresource: unknown) => {
      expect(
        AIChatPageContextHelper.sanitize(
          resource({ subresource } as JSONObject),
        ),
      ).toBeUndefined();
    },
  );

  test("rejects children that do not belong to the selected resource kind", () => {
    expect(
      AIChatPageContextHelper.sanitize(
        resource({
          resourceType: AIResourceType.DockerHost,
          subresource: { kind: AIResourceSubresourceKind.Pod, key: "api" },
        }),
      ),
    ).toBeUndefined();
    expect(
      AIChatPageContextHelper.sanitize(
        resource({
          resourceType: AIResourceType.DockerHost,
          subresource: {
            kind: AIResourceSubresourceKind.Container,
            key: "api",
            namespace: "prod",
          },
        }),
      ),
    ).toBeUndefined();
  });

  test("legacy contexts do not accept infrastructure selectors", () => {
    expect(
      AIChatPageContextHelper.sanitize({
        type: AIChatPageContextType.Monitor,
        entityId: RESOURCE_ID,
        resourceType: AIResourceType.KubernetesCluster,
        subresource: { kind: AIResourceSubresourceKind.Pod, key: "api" },
      }),
    ).toEqual({ type: AIChatPageContextType.Monitor, entityId: RESOURCE_ID });
  });
});

describe("conversation subject identity", () => {
  const parent: AIChatPageContext = {
    type: AIChatPageContextType.Resource,
    resourceType: AIResourceType.KubernetesCluster,
    entityId: RESOURCE_ID,
    entityTitle: "Production",
  };

  test("renaming the presentation title does not change the subject", () => {
    expect(AIChatPageContextHelper.getIdentity(parent)).toBe(
      AIChatPageContextHelper.getIdentity({
        ...parent,
        entityTitle: "Renamed",
      }),
    );
  });

  test("switching resource kind with the same UUID changes the subject", () => {
    expect(AIChatPageContextHelper.getIdentity(parent)).not.toBe(
      AIChatPageContextHelper.getIdentity({
        ...parent,
        resourceType: AIResourceType.DockerHost,
      }),
    );
  });

  test("child and namespace changes cannot reuse the previous subject", () => {
    const pod: AIChatPageContext = {
      ...parent,
      subresource: {
        kind: AIResourceSubresourceKind.Pod,
        key: "api",
        namespace: "prod",
      },
    };
    for (const child of [
      undefined,
      { kind: AIResourceSubresourceKind.Pod, key: "worker", namespace: "prod" },
      { kind: AIResourceSubresourceKind.Pod, key: "api", namespace: "dev" },
      {
        kind: AIResourceSubresourceKind.Deployment,
        key: "api",
        namespace: "prod",
      },
    ]) {
      expect(AIChatPageContextHelper.getIdentity(pod)).not.toBe(
        AIChatPageContextHelper.getIdentity({ ...parent, subresource: child }),
      );
    }
  });
});
