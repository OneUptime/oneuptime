import {
  getRouteForCitationTarget,
  navigateToCitationTarget,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/CitationTargetNav";
import { AIChatCitationTargetType } from "../../../Types/AI/AIChatTypes";
import { AIResourceType } from "../../../Types/AI/AIResourceContext";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const RESOURCE_ID: string = "20000000-0000-4000-8000-000000000002";
const RESOURCE_ROUTES: Array<[AIResourceType, string]> = [
  [AIResourceType.Host, "host"],
  [AIResourceType.DockerHost, "docker"],
  [AIResourceType.PodmanHost, "podman"],
  [AIResourceType.KubernetesCluster, "kubernetes"],
  [AIResourceType.DockerSwarmCluster, "docker-swarm"],
  [AIResourceType.ProxmoxCluster, "proxmox"],
  [AIResourceType.VMwareVCenter, "vmware"],
  [AIResourceType.CephCluster, "ceph"],
  [AIResourceType.ServerlessFunction, "serverless"],
  [AIResourceType.CloudResource, "cloud"],
  [AIResourceType.IoTFleet, "iot"],
  [AIResourceType.NetworkDevice, "network-devices"],
];

describe("infrastructure evidence navigation", () => {
  beforeEach(() => {
    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(new ObjectID(PROJECT_ID));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test.each(RESOURCE_ROUTES)(
    "%s inventory citation opens the correct module",
    (resourceType: AIResourceType, path: string) => {
      const route: string | undefined = getRouteForCitationTarget({
        type: AIChatCitationTargetType.TelemetryResources,
        params: {
          resourceType,
          resourceId: "ignored-on-list",
          projectId: "ignored-foreign-project",
        },
      })?.toString();
      expect(route).toBe(`/dashboard/${PROJECT_ID}/${path}`);
    },
  );

  test.each(RESOURCE_ROUTES)(
    "%s measurement citation opens its selected parent",
    (resourceType: AIResourceType, path: string) => {
      const route: string | undefined = getRouteForCitationTarget({
        type: AIChatCitationTargetType.TelemetryResourceView,
        // Order must not determine which parameter is used as the resource ID.
        params: {
          resourceType,
          projectId: "ignored-foreign-project",
          resourceId: RESOURCE_ID,
        },
      })?.toString();
      expect(route).toBe(`/dashboard/${PROJECT_ID}/${path}/${RESOURCE_ID}`);
    },
  );

  test.each([
    undefined,
    "",
    "settings",
    "../another-resource",
    "javascript:alert(1)",
  ])(
    "an invalid detail identity %p cannot navigate",
    (resourceId: string | undefined) => {
      const navigate: ReturnType<typeof jest.spyOn> = jest.spyOn(
        Navigation,
        "navigate",
      );
      navigateToCitationTarget({
        type: AIChatCitationTargetType.TelemetryResourceView,
        params: {
          resourceType: AIResourceType.Host,
          ...(resourceId === undefined ? {} : { resourceId }),
        },
      });
      expect(navigate).not.toHaveBeenCalled();
    },
  );

  test.each([
    AIChatCitationTargetType.TelemetryResources,
    AIChatCitationTargetType.TelemetryResourceView,
  ])(
    "%s requires an allowlisted resource type",
    (type: AIChatCitationTargetType) => {
      expect(getRouteForCitationTarget({ type })).toBeUndefined();
      for (const resourceType of [
        "__proto__",
        "Unknown",
        "host",
        "https://example.com",
      ]) {
        expect(
          getRouteForCitationTarget({
            type,
            params: { resourceType, resourceId: RESOURCE_ID },
          }),
        ).toBeUndefined();
      }
    },
  );
});
