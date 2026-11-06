/*
 * The Queue infrastructure module pulls in BullMQ (ESM-only msgpackr) at import time via the
 * services' queue imports, and nothing queue-related is under test here.
 */
jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    default: { addJob: jest.fn() },
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
    },
  };
});

/*
 * PasswordHash carries a TS5.9 diagnostic that fails any suite whose require graph reaches it,
 * and nothing password-related is under test, so it is replaced with a factory.
 */
jest.mock("Common/Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import { afterEach, describe, expect, jest, test } from "@jest/globals";
import OpenStackCloudService from "Common/Server/Services/OpenStackCloudService";
import { JSONArray } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import {
  OPENSTACK_CHECK_RESOURCE_ATTRIBUTE,
  OPENSTACK_CHECK_RESOURCE_VALUE,
} from "Common/Utils/OpenStack/OpenStackCheckMetrics";
import OtelIngestBaseService from "../../FeatureSet/Telemetry/Services/OtelIngestBaseService";

/*
 * What a probe checks from outside belongs to the cloud it names, and says nothing about whether
 * whatever collects that cloud is still reporting. A check's batch finds its cloud and writes
 * nothing to it, so an agent that stopped still reads as stopped, however well the cloud answers.
 */

interface Reachable {
  resolveDiscoveredResourceId: (data: unknown) => Promise<string | null>;
  discoverMatchedOpenStackCloud: (data: {
    projectId: ObjectID;
    attributes: JSONArray;
    cloudName: string;
  }) => Promise<ObjectID | null>;
}

const reachable: Reachable = OtelIngestBaseService as unknown as Reachable;

const CLOUD_ID: string = "71000000-0000-4000-8000-000000000001";

describe("a check's batch", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("finds its cloud, and does not say whatever collects the cloud is alive", async () => {
    jest
      .spyOn(reachable, "resolveDiscoveredResourceId")
      .mockResolvedValue(CLOUD_ID as never);

    const updateLastSeen: ReturnType<typeof jest.spyOn> = jest
      .spyOn(OpenStackCloudService, "updateLastSeen")
      .mockResolvedValue(undefined as never);

    const cloudId: ObjectID | null =
      await reachable.discoverMatchedOpenStackCloud({
        projectId: ObjectID.generate(),
        attributes: [
          {
            key: OPENSTACK_CHECK_RESOURCE_ATTRIBUTE,
            value: { stringValue: OPENSTACK_CHECK_RESOURCE_VALUE },
          },
        ] as unknown as JSONArray,
        cloudName: "Lab",
      });

    expect(cloudId?.toString()).toBe(CLOUD_ID);
    expect(updateLastSeen).not.toHaveBeenCalled();
  });

  test("a cloud it does not know is nobody's", async () => {
    jest
      .spyOn(reachable, "resolveDiscoveredResourceId")
      .mockResolvedValue(null as never);

    expect(
      await reachable.discoverMatchedOpenStackCloud({
        projectId: ObjectID.generate(),
        attributes: [
          {
            key: OPENSTACK_CHECK_RESOURCE_ATTRIBUTE,
            value: { stringValue: OPENSTACK_CHECK_RESOURCE_VALUE },
          },
        ] as unknown as JSONArray,
        cloudName: "Elsewhere",
      }),
    ).toBeNull();
  });
});
