import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import AwsServerIdentity from "../../../../Server/Utils/CloudConnection/Aws/AwsServerIdentity";
import { AssumedRoleCache } from "../../../../Server/Utils/CloudConnection/Aws/AwsSts";
import { CloudConnectionSettings } from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import {
  applyAwsSavingsAction,
  getGp3Performance,
  undoAwsSavingsAction,
} from "../../../../Server/Utils/CloudSavings/Cloud/AwsSavingsActions";
import {
  CloudSavingsProgress,
  CloudSavingsRun,
  CloudSavingsStepContext,
  CloudSavingsStepOutcome,
} from "../../../../Server/Utils/CloudSavings/CloudSavingsCloudTypes";
import LlmProviderError from "../../../../Server/Utils/LlmObservability/LlmProviderError";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import {
  CloudSavingsActionKind,
  CloudSavingsTarget,
  CloudSavingsTargetType,
} from "../../../../Types/Cloud/CloudSavingsAction";
import { CloudConnectionAuthMethod } from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import {
  AWS_SAVINGS_ACTIONS_CLEAN_UP_ACTIONS,
  CLOUD_SAVINGS_ACTION_TAG_KEY,
} from "../../../../Types/CloudConnection/CloudSavingsActionsAccess";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import {
  FakeAwsSavings,
  FakeSnapshot,
  FakeVolume,
  createFakeAwsSavings,
} from "./FakeAwsSavings";

/*
 * Acting on savings in AWS (#11010), against a fake EC2 and RDS that
 * answer as AWS's Query APIs do: each change reads first and writes only
 * what is not so already, waits where AWS is still at it (a stopping
 * instance, a pending snapshot), never deletes an attached volume or
 * releases an associated address, starts an instance again whose resize
 * AWS refused, and takes each change back the way it says it can. A
 * refusal names the call and the setting that grants it.
 */

const ACCOUNT: string = "123456789012";
const ACTION_ID: string = "6a1f0c2e-8d1b-4e51-9a0b-3c4d5e6f7a8b";
const CONNECTION: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const NOW: Date = new Date("2026-11-24T19:00:00Z");

function settings(): CloudConnectionSettings {
  return {
    provider: CloudProvider.AWS,
    projectId: "11111111-1111-4111-8111-111111111111",
    config: {
      authMethod: CloudConnectionAuthMethod.AwsAccessKey,
      accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    },
    secrets: { secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" },
  };
}

function context(fake: FakeAwsSavings): CloudSavingsStepContext {
  return {
    settings: settings(),
    connectionId: CONNECTION,
    transport: fake.transport,
    now: (): Date => {
      return NOW;
    },
    sleep: async (): Promise<void> => {},
  };
}

function target(
  type: CloudSavingsTargetType,
  id: string,
  location: string = "eu-west-1",
): CloudSavingsTarget {
  return { provider: CloudProvider.AWS, type, id, location, account: ACCOUNT };
}

function run(data: {
  kind: CloudSavingsActionKind;
  target: CloudSavingsTarget;
  to?: string;
  finalSnapshot?: boolean;
  progress?: CloudSavingsProgress;
}): CloudSavingsRun {
  return {
    actionId: ACTION_ID,
    kind: data.kind,
    target: data.target,
    to: data.to,
    finalSnapshot: data.finalSnapshot,
    progress: data.progress || {},
  };
}

/*
 * Steps a change until it is done, as the runner does a minute apart:
 * every outcome along the way, the last one done.
 */
async function untilDone(
  step: (progress: CloudSavingsProgress) => Promise<CloudSavingsStepOutcome>,
): Promise<Array<CloudSavingsStepOutcome>> {
  const outcomes: Array<CloudSavingsStepOutcome> = [];
  let progress: CloudSavingsProgress = {};

  for (let tries: number = 0; tries < 20; tries++) {
    const outcome: CloudSavingsStepOutcome = await step(progress);
    outcomes.push(outcome);

    if (outcome.state === "done") {
      return outcomes;
    }

    progress = outcome.progress;
  }

  throw new Error("The change never finished.");
}

beforeEach(() => {
  delete process.env["CLOUD_CONNECT_AWS_ACCESS_KEY_ID"];
  delete process.env["CLOUD_CONNECT_AWS_SECRET_ACCESS_KEY"];
  AssumedRoleCache.clear();
  AwsServerIdentity.clearCache();
});

afterEach(() => {
  AssumedRoleCache.clear();
});

describe("stopping an idle instance, and starting it again", () => {
  test("stops a running instance in its own Region, signed for EC2", async () => {
    const fake: FakeAwsSavings = createFakeAwsSavings({
      instances: [
        { id: "i-0abc1234def567890", type: "m5.large", state: "running" },
      ],
    });
    const outcome: CloudSavingsStepOutcome = await applyAwsSavingsAction(
      context(fake),
      run({
        kind: CloudSavingsActionKind.StopInstance,
        target: target(CloudSavingsTargetType.Instance, "i-0abc1234def567890"),
      }),
    );

    expect(outcome).toMatchObject({ state: "done", changed: true });
    expect(outcome.summary).toContain("Stopped instance i-0abc1234def567890");
    expect(fake.writes()).toEqual(["ec2:StopInstances"]);
    expect(fake.calls[0]).toMatchObject({
      service: "ec2",
      region: "eu-west-1",
      action: "DescribeInstances",
    });
    expect(fake.instances.get("i-0abc1234def567890")?.state).toBe("stopping");
  });

  test("an instance already stopped is left alone and says so", async () => {
    const fake: FakeAwsSavings = createFakeAwsSavings({
      instances: [
        { id: "i-0abc1234def567890", type: "m5.large", state: "stopped" },
      ],
    });
    const outcome: CloudSavingsStepOutcome = await applyAwsSavingsAction(
      context(fake),
      run({
        kind: CloudSavingsActionKind.StopInstance,
        target: target(CloudSavingsTargetType.Instance, "i-0abc1234def567890"),
      }),
    );

    expect(outcome).toMatchObject({ state: "done", changed: false });
    expect(fake.writes()).toEqual([]);
  });

  test("a terminated or missing instance fails with why", async () => {
    const fake: FakeAwsSavings = createFakeAwsSavings({
      instances: [
        { id: "i-0abc1234def567890", type: "m5.large", state: "terminated" },
      ],
    });

    for (const id of ["i-0abc1234def567890", "i-0fff1234def567890"]) {
      await expect(
        applyAwsSavingsAction(
          context(fake),
          run({
            kind: CloudSavingsActionKind.StopInstance,
            target: target(CloudSavingsTargetType.Instance, id),
          }),
        ),
      ).rejects.toThrow(`Instance ${id} was not found`);
    }

    expect(fake.writes()).toEqual([]);
  });

  test("undo starts it again, waiting while it is still stopping", async () => {
    const fake: FakeAwsSavings = createFakeAwsSavings({
      instances: [
        {
          id: "i-0abc1234def567890",
          type: "m5.large",
          state: "stopping",
          transitionReads: 2,
        },
      ],
    });
    const outcomes: Array<CloudSavingsStepOutcome> = await untilDone(
      (progress: CloudSavingsProgress) => {
        return undoAwsSavingsAction(context(fake), {
          ...run({
            kind: CloudSavingsActionKind.StopInstance,
            target: target(
              CloudSavingsTargetType.Instance,
              "i-0abc1234def567890",
            ),
            progress,
          }),
          applied: {},
        });
      },
    );

    expect(outcomes[0]?.state).toBe("waiting");
    expect(outcomes[outcomes.length - 1]).toMatchObject({
      state: "done",
      changed: true,
    });
    expect(fake.writes()).toEqual(["ec2:StartInstances"]);
  });

  test("undo of an instance someone already started changes nothing", async () => {
    const fake: FakeAwsSavings = createFakeAwsSavings({
      instances: [
        { id: "i-0abc1234def567890", type: "m5.large", state: "running" },
      ],
    });
    const outcome: CloudSavingsStepOutcome = await undoAwsSavingsAction(
      context(fake),
      {
        ...run({
          kind: CloudSavingsActionKind.StopInstance,
          target: target(
            CloudSavingsTargetType.Instance,
            "i-0abc1234def567890",
          ),
        }),
        applied: {},
      },
    );

    expect(outcome.changed).toBe(false);
    expect(fake.writes()).toEqual([]);
  });
});

describe("stopping an idle RDS database", () => {
  test("stops an available database and says AWS starts it again after seven days", async () => {
    const fake: FakeAwsSavings = createFakeAwsSavings({
      databases: [
        { id: "reports", instanceClass: "db.r5.large", status: "available" },
      ],
    });
    const outcome: CloudSavingsStepOutcome = await applyAwsSavingsAction(
      context(fake),
      run({
        kind: CloudSavingsActionKind.StopDatabase,
        target: target(CloudSavingsTargetType.Database, "reports"),
      }),
    );

    expect(outcome.summary).toContain("seven days");
    expect(fake.writes()).toEqual(["rds:StopDBInstance"]);
  });

  test("an Aurora cluster member is refused in AWS's words, and nothing changes", async () => {
    const fake: FakeAwsSavings = createFakeAwsSavings({
      databases: [
        {
          id: "aurora-1",
          instanceClass: "db.r6g.large",
          status: "available",
          isClusterMember: true,
        },
      ],
    });

    await expect(
      applyAwsSavingsAction(
        context(fake),
        run({
          kind: CloudSavingsActionKind.StopDatabase,
          target: target(CloudSavingsTargetType.Database, "aurora-1"),
        }),
      ),
    ).rejects.toThrow(
      "AWS cannot stop database aurora-1 now: aurora-postgresql DB instances are not eligible",
    );
  });

  test("a database that is busy is not stopped", async () => {
    const fake: FakeAwsSavings = createFakeAwsSavings({
      databases: [
        { id: "reports", instanceClass: "db.r5.large", status: "modifying" },
      ],
    });

    await expect(
      applyAwsSavingsAction(
        context(fake),
        run({
          kind: CloudSavingsActionKind.StopDatabase,
          target: target(CloudSavingsTargetType.Database, "reports"),
        }),
      ),
    ).rejects.toThrow("Database reports is modifying");
    expect(fake.writes()).toEqual([]);
  });

  test("undo starts it again once it has stopped", async () => {
    const fake: FakeAwsSavings = createFakeAwsSavings({
      databases: [
        { id: "reports", instanceClass: "db.r5.large", status: "stopped" },
      ],
    });
    const outcome: CloudSavingsStepOutcome = await undoAwsSavingsAction(
      context(fake),
      {
        ...run({
          kind: CloudSavingsActionKind.StopDatabase,
          target: target(CloudSavingsTargetType.Database, "reports"),
        }),
        applied: {},
      },
    );

    expect(outcome.changed).toBe(true);
    expect(fake.writes()).toEqual(["rds:StartDBInstance"]);
  });
});

describe("changing a volume from gp2 to gp3", () => {
  test("keeps the IOPS and throughput gp2 gave it, so it is no slower", () => {
    expect(getGp3Performance(100)).toEqual({ iops: 3000, throughput: 125 });
    expect(getGp3Performance(2000)).toEqual({ iops: 6000, throughput: 250 });
    expect(getGp3Performance(16000)).toEqual({ iops: 16000, throughput: 250 });
  });

  test("changes a 2 TiB gp2 volume to gp3 at 6,000 IOPS and 250 MiB/s", async () => {
    const fake: FakeAwsSavings = createFakeAwsSavings({
      volumes: [
        {
          id: "vol-0123456789abcdef0",
          type: "gp2",
          size: 2000,
          iops: 6000,
          zone: "eu-west-1a",
          state: "in-use",
          attachedTo: "i-0abc1234def567890",
        },
      ],
    });
    const outcome: CloudSavingsStepOutcome = await applyAwsSavingsAction(
      context(fake),
      run({
        kind: CloudSavingsActionKind.ChangeVolumeType,
        target: target(CloudSavingsTargetType.Volume, "vol-0123456789abcdef0"),
        to: "gp3",
      }),
    );

    expect(outcome).toMatchObject({ state: "done", changed: true });
    expect(outcome.progress.previous).toBe("gp2");
    expect(
      fake.calls.find((call: FakeAwsSavings["calls"][number]): boolean => {
        return call.action === "ModifyVolume";
      })?.params,
    ).toMatchObject({
      VolumeId: "vol-0123456789abcdef0",
      VolumeType: "gp3",
      Iops: "6000",
      Throughput: "250",
    });
  });

  test("a volume already gp3 is left alone", async () => {
    const fake: FakeAwsSavings = createFakeAwsSavings({
      volumes: [
        {
          id: "vol-0123456789abcdef0",
          type: "gp3",
          size: 100,
          zone: "eu-west-1a",
          state: "available",
        },
      ],
    });
    const outcome: CloudSavingsStepOutcome = await applyAwsSavingsAction(
      context(fake),
      run({
        kind: CloudSavingsActionKind.ChangeVolumeType,
        target: target(CloudSavingsTargetType.Volume, "vol-0123456789abcdef0"),
        to: "gp3",
      }),
    );

    expect(outcome.changed).toBe(false);
    expect(fake.writes()).toEqual([]);
  });

  test("undo within six hours is refused as EBS refuses it, and says when to try", async () => {
    const fake: FakeAwsSavings = createFakeAwsSavings({
      volumes: [
        {
          id: "vol-0123456789abcdef0",
          type: "gp3",
          size: 100,
          zone: "eu-west-1a",
          state: "available",
          lastModifiedAt: new Date("2026-11-24T17:00:00Z"),
        },
      ],
    });

    await expect(
      undoAwsSavingsAction(context(fake), {
        ...run({
          kind: CloudSavingsActionKind.ChangeVolumeType,
          target: target(
            CloudSavingsTargetType.Volume,
            "vol-0123456789abcdef0",
          ),
          to: "gp3",
        }),
        applied: { previous: "gp2" },
      }),
    ).rejects.toThrow("once every six hours");
  });

  test("undo after six hours changes it back to gp2", async () => {
    const fake: FakeAwsSavings = createFakeAwsSavings({
      volumes: [
        {
          id: "vol-0123456789abcdef0",
          type: "gp3",
          size: 100,
          zone: "eu-west-1a",
          state: "available",
          lastModifiedAt: new Date("2026-11-24T08:00:00Z"),
        },
      ],
    });
    const outcome: CloudSavingsStepOutcome = await undoAwsSavingsAction(
      context(fake),
      {
        ...run({
          kind: CloudSavingsActionKind.ChangeVolumeType,
          target: target(
            CloudSavingsTargetType.Volume,
            "vol-0123456789abcdef0",
          ),
          to: "gp3",
        }),
        applied: { previous: "gp2" },
      },
    );

    expect(outcome.changed).toBe(true);
    expect(fake.volumes.get("vol-0123456789abcdef0")?.type).toBe("gp2");
  });
});

describe("deleting an unattached volume after a final snapshot", () => {
  const volume: FakeVolume = {
    id: "vol-0123456789abcdef0",
    type: "gp3",
    size: 500,
    iops: 4000,
    throughput: 250,
    zone: "eu-west-1b",
    state: "available",
    tags: { Name: "old-data", Team: "search", "aws:createdBy": "x" },
  };

  test("takes the snapshot, waits for it to complete, then deletes the volume", async () => {
    const fake: FakeAwsSavings = createFakeAwsSavings({ volumes: [volume] });
    const outcomes: Array<CloudSavingsStepOutcome> = await untilDone(
      (progress: CloudSavingsProgress) => {
        return applyAwsSavingsAction(
          context(fake),
          run({
            kind: CloudSavingsActionKind.DeleteVolume,
            target: target(CloudSavingsTargetType.Volume, volume.id),
            finalSnapshot: true,
            progress,
          }),
        );
      },
    );
    const last: CloudSavingsStepOutcome = outcomes[outcomes.length - 1]!;

    expect(outcomes[0]).toMatchObject({ state: "waiting" });
    expect(outcomes[0]?.summary).toContain("Taking a final snapshot");
    expect(last).toMatchObject({ state: "done", changed: true });
    expect(last.summary).toContain(last.progress.snapshotId!);
    expect(fake.writes()).toEqual(["ec2:CreateSnapshot", "ec2:DeleteVolume"]);
    expect(fake.volumes.has(volume.id)).toBe(false);

    // The snapshot is OneUptime's, by its tag, and named for the volume.
    const snapshot: FakeSnapshot = fake.snapshots.get(
      last.progress.snapshotId!,
    )!;
    expect(snapshot.tags?.[CLOUD_SAVINGS_ACTION_TAG_KEY]).toBe(ACTION_ID);
    expect(snapshot.tags?.["Name"]).toBe(
      "oneuptime-final-vol-0123456789abcdef0-6a1f0c2e",
    );

    // What the volume was is kept, to make it again - AWS's own tags left out.
    expect(last.progress.disk).toMatchObject({
      zone: "eu-west-1b",
      volumeType: "gp3",
      size: 500,
      iops: 4000,
      throughput: 250,
    });
    expect(JSON.stringify(last.progress.disk)).not.toContain("aws:createdBy");
  });

  test("never deletes the volume while its snapshot is pending", async () => {
    const fake: FakeAwsSavings = createFakeAwsSavings({ volumes: [volume] });
    let progress: CloudSavingsProgress = {};

    for (let index: number = 0; index < 2; index++) {
      const outcome: CloudSavingsStepOutcome = await applyAwsSavingsAction(
        context(fake),
        run({
          kind: CloudSavingsActionKind.DeleteVolume,
          target: target(CloudSavingsTargetType.Volume, volume.id),
          finalSnapshot: true,
          progress,
        }),
      );
      progress = outcome.progress;
    }

    // The fake's snapshot completes on its second read: the delete waited.
    expect(fake.volumes.has(volume.id)).toBe(true);
  });

  test("a snapshot that fails keeps the volume", async () => {
    const fake: FakeAwsSavings = createFakeAwsSavings({ volumes: [volume] });
    const first: CloudSavingsStepOutcome = await applyAwsSavingsAction(
      context(fake),
      run({
        kind: CloudSavingsActionKind.DeleteVolume,
        target: target(CloudSavingsTargetType.Volume, volume.id),
        finalSnapshot: true,
      }),
    );

    fake.snapshots.get(first.progress.snapshotId!)!.state = "error";

    await expect(
      applyAwsSavingsAction(
        context(fake),
        run({
          kind: CloudSavingsActionKind.DeleteVolume,
          target: target(CloudSavingsTargetType.Volume, volume.id),
          finalSnapshot: true,
          progress: first.progress,
        }),
      ),
    ).rejects.toThrow("the volume was not deleted");
    expect(fake.volumes.has(volume.id)).toBe(true);
  });

  test("a volume attached since the saving was read is never deleted, nor snapshotted", async () => {
    const fake: FakeAwsSavings = createFakeAwsSavings({
      volumes: [
        { ...volume, state: "in-use", attachedTo: "i-0abc1234def567890" },
      ],
    });

    await expect(
      applyAwsSavingsAction(
        context(fake),
        run({
          kind: CloudSavingsActionKind.DeleteVolume,
          target: target(CloudSavingsTargetType.Volume, volume.id),
          finalSnapshot: true,
        }),
      ),
    ).rejects.toThrow("attached to an instance now");
    expect(fake.writes()).toEqual([]);
  });

  test("with no final snapshot asked for, it is deleted at once", async () => {
    const fake: FakeAwsSavings = createFakeAwsSavings({ volumes: [volume] });
    const outcome: CloudSavingsStepOutcome = await applyAwsSavingsAction(
      context(fake),
      run({
        kind: CloudSavingsActionKind.DeleteVolume,
        target: target(CloudSavingsTargetType.Volume, volume.id),
        finalSnapshot: false,
      }),
    );

    expect(outcome.summary).toContain("No final snapshot was taken");
    expect(fake.writes()).toEqual(["ec2:DeleteVolume"]);
  });

  test("a volume already gone is not an error", async () => {
    const fake: FakeAwsSavings = createFakeAwsSavings();
    const outcome: CloudSavingsStepOutcome = await applyAwsSavingsAction(
      context(fake),
      run({
        kind: CloudSavingsActionKind.DeleteVolume,
        target: target(CloudSavingsTargetType.Volume, volume.id),
        finalSnapshot: true,
      }),
    );

    expect(outcome).toMatchObject({ state: "done", changed: false });
  });

  test("undo makes it again from the snapshot, in its zone, of its type, with its tags - once", async () => {
    const fake: FakeAwsSavings = createFakeAwsSavings({ volumes: [volume] });
    const applied: Array<CloudSavingsStepOutcome> = await untilDone(
      (progress: CloudSavingsProgress) => {
        return applyAwsSavingsAction(
          context(fake),
          run({
            kind: CloudSavingsActionKind.DeleteVolume,
            target: target(CloudSavingsTargetType.Volume, volume.id),
            finalSnapshot: true,
            progress,
          }),
        );
      },
    );
    const appliedProgress: CloudSavingsProgress =
      applied[applied.length - 1]!.progress;

    const undo: CloudSavingsStepOutcome = await undoAwsSavingsAction(
      context(fake),
      {
        ...run({
          kind: CloudSavingsActionKind.DeleteVolume,
          target: target(CloudSavingsTargetType.Volume, volume.id),
        }),
        applied: appliedProgress,
      },
    );

    expect(undo.changed).toBe(true);
    const restored: FakeVolume = fake.volumes.get(undo.progress.restoredId!)!;
    expect(restored).toMatchObject({
      zone: "eu-west-1b",
      type: "gp3",
      iops: 4000,
      throughput: 250,
    });
    expect(restored.tags).toMatchObject({
      Name: "old-data",
      Team: "search",
      [CLOUD_SAVINGS_ACTION_TAG_KEY]: ACTION_ID,
    });

    // The same undo sent again (its answer lost) makes no second volume.
    await undoAwsSavingsAction(context(fake), {
      ...run({
        kind: CloudSavingsActionKind.DeleteVolume,
        target: target(CloudSavingsTargetType.Volume, volume.id),
      }),
      applied: appliedProgress,
    });
    expect(
      Array.from(fake.volumes.values()).filter((each: FakeVolume) => {
        return each.tags?.[CLOUD_SAVINGS_ACTION_TAG_KEY] === ACTION_ID;
      }),
    ).toHaveLength(1);
  });

  test("a volume deleted with no snapshot cannot be undone, and says why", async () => {
    const fake: FakeAwsSavings = createFakeAwsSavings();

    await expect(
      undoAwsSavingsAction(context(fake), {
        ...run({
          kind: CloudSavingsActionKind.DeleteVolume,
          target: target(CloudSavingsTargetType.Volume, volume.id),
        }),
        applied: {},
      }),
    ).rejects.toThrow("No final snapshot was taken");
  });
});

describe("deleting a snapshot and releasing an address", () => {
  test("deletes an old snapshot", async () => {
    const fake: FakeAwsSavings = createFakeAwsSavings({
      snapshots: [
        { id: "snap-0fedcba9876543210", volumeId: "vol-1", state: "completed" },
      ],
    });
    const outcome: CloudSavingsStepOutcome = await applyAwsSavingsAction(
      context(fake),
      run({
        kind: CloudSavingsActionKind.DeleteSnapshot,
        target: target(
          CloudSavingsTargetType.Snapshot,
          "snap-0fedcba9876543210",
        ),
      }),
    );

    expect(outcome.changed).toBe(true);
    expect(fake.snapshots.size).toBe(0);
  });

  test("a snapshot an image uses is kept, in AWS's words", async () => {
    const fake: FakeAwsSavings = createFakeAwsSavings({
      snapshots: [
        {
          id: "snap-0fedcba9876543210",
          volumeId: "vol-1",
          state: "completed",
          usedByImage: "ami-0abcdef1234567890",
        },
      ],
    });

    await expect(
      applyAwsSavingsAction(
        context(fake),
        run({
          kind: CloudSavingsActionKind.DeleteSnapshot,
          target: target(
            CloudSavingsTargetType.Snapshot,
            "snap-0fedcba9876543210",
          ),
        }),
      ),
    ).rejects.toThrow("is used by an image (AMI), so it was kept");
  });

  test("releases an idle Elastic IP, and says it cannot be had again", async () => {
    const fake: FakeAwsSavings = createFakeAwsSavings({
      addresses: [
        {
          allocationId: "eipalloc-0a1b2c3d4e5f60718",
          publicIp: "203.0.113.25",
        },
      ],
    });
    const outcome: CloudSavingsStepOutcome = await applyAwsSavingsAction(
      context(fake),
      run({
        kind: CloudSavingsActionKind.ReleaseAddress,
        target: target(
          CloudSavingsTargetType.Address,
          "eipalloc-0a1b2c3d4e5f60718",
        ),
      }),
    );

    expect(outcome.summary).toContain("Released address 203.0.113.25");
    expect(outcome.summary).toContain("cannot be had again");
    expect(fake.addresses.size).toBe(0);
  });

  test("an address associated since the saving was read is never released", async () => {
    const fake: FakeAwsSavings = createFakeAwsSavings({
      addresses: [
        {
          allocationId: "eipalloc-0a1b2c3d4e5f60718",
          publicIp: "203.0.113.25",
          associationId: "eipassoc-0123456789abcdef0",
          instanceId: "i-0abc1234def567890",
        },
      ],
    });

    await expect(
      applyAwsSavingsAction(
        context(fake),
        run({
          kind: CloudSavingsActionKind.ReleaseAddress,
          target: target(
            CloudSavingsTargetType.Address,
            "eipalloc-0a1b2c3d4e5f60718",
          ),
        }),
      ),
    ).rejects.toThrow("is associated with i-0abc1234def567890 now");
    expect(fake.writes()).toEqual([]);
  });

  test("a released address cannot be undone", async () => {
    await expect(
      undoAwsSavingsAction(context(createFakeAwsSavings()), {
        ...run({
          kind: CloudSavingsActionKind.ReleaseAddress,
          target: target(
            CloudSavingsTargetType.Address,
            "eipalloc-0a1b2c3d4e5f60718",
          ),
        }),
        applied: {},
      }),
    ).rejects.toThrow("cannot be undone");
  });
});

describe("resizing an instance", () => {
  test("stops it, waits, resizes it and starts it again", async () => {
    const fake: FakeAwsSavings = createFakeAwsSavings({
      instances: [
        {
          id: "i-0abc1234def567890",
          type: "m5.2xlarge",
          state: "running",
          transitionReads: 2,
        },
      ],
    });
    const outcomes: Array<CloudSavingsStepOutcome> = await untilDone(
      (progress: CloudSavingsProgress) => {
        return applyAwsSavingsAction(
          context(fake),
          run({
            kind: CloudSavingsActionKind.ResizeInstance,
            target: target(
              CloudSavingsTargetType.Instance,
              "i-0abc1234def567890",
            ),
            to: "m5.xlarge",
            progress,
          }),
        );
      },
    );
    const last: CloudSavingsStepOutcome = outcomes[outcomes.length - 1]!;

    expect(
      outcomes.filter((outcome: CloudSavingsStepOutcome) => {
        return outcome.state === "waiting";
      }).length,
    ).toBeGreaterThan(0);
    expect(last.summary).toBe(
      "Resized instance i-0abc1234def567890 from m5.2xlarge to m5.xlarge, and started it again.",
    );
    expect(last.progress.previous).toBe("m5.2xlarge");
    expect(fake.writes()).toEqual([
      "ec2:StopInstances",
      "ec2:ModifyInstanceAttribute",
      "ec2:StartInstances",
    ]);
    expect(fake.instances.get("i-0abc1234def567890")?.type).toBe("m5.xlarge");
  });

  test("a stopped instance is resized and left stopped", async () => {
    const fake: FakeAwsSavings = createFakeAwsSavings({
      instances: [
        { id: "i-0abc1234def567890", type: "m5.2xlarge", state: "stopped" },
      ],
    });
    const outcome: CloudSavingsStepOutcome = await applyAwsSavingsAction(
      context(fake),
      run({
        kind: CloudSavingsActionKind.ResizeInstance,
        target: target(CloudSavingsTargetType.Instance, "i-0abc1234def567890"),
        to: "m5.xlarge",
      }),
    );

    expect(outcome.summary).toContain("is left stopped");
    expect(fake.writes()).toEqual(["ec2:ModifyInstanceAttribute"]);
  });

  test("a size AWS refuses starts the instance again before saying so", async () => {
    const fake: FakeAwsSavings = createFakeAwsSavings({
      instances: [
        {
          id: "i-0abc1234def567890",
          type: "m5.2xlarge",
          state: "running",
          refusedTypes: ["m5.xlarge"],
        },
      ],
    });
    let progress: CloudSavingsProgress = {};
    let failure: unknown = null;

    for (let tries: number = 0; tries < 6 && !failure; tries++) {
      try {
        progress = (
          await applyAwsSavingsAction(
            context(fake),
            run({
              kind: CloudSavingsActionKind.ResizeInstance,
              target: target(
                CloudSavingsTargetType.Instance,
                "i-0abc1234def567890",
              ),
              to: "m5.xlarge",
              progress,
            }),
          )
        ).progress;
      } catch (error) {
        failure = error;
      }
    }

    expect(failure).toBeInstanceOf(BadDataException);
    expect(String((failure as Error).message)).toContain(
      "AWS would not make instance i-0abc1234def567890 a m5.xlarge, so it was left a m5.2xlarge and started again",
    );
    expect(fake.writes()).toEqual([
      "ec2:StopInstances",
      "ec2:ModifyInstanceAttribute",
      "ec2:StartInstances",
    ]);
  });

  test("undo sizes it back, with steps of its own", async () => {
    const fake: FakeAwsSavings = createFakeAwsSavings({
      instances: [
        { id: "i-0abc1234def567890", type: "m5.xlarge", state: "running" },
      ],
    });
    const outcomes: Array<CloudSavingsStepOutcome> = await untilDone(
      (progress: CloudSavingsProgress) => {
        return undoAwsSavingsAction(context(fake), {
          ...run({
            kind: CloudSavingsActionKind.ResizeInstance,
            target: target(
              CloudSavingsTargetType.Instance,
              "i-0abc1234def567890",
            ),
            to: "m5.xlarge",
            progress,
          }),
          applied: { previous: "m5.2xlarge", step: "done" },
        });
      },
    );

    expect(outcomes[outcomes.length - 1]?.summary).toContain(
      "from m5.xlarge to m5.2xlarge",
    );
    expect(fake.instances.get("i-0abc1234def567890")?.type).toBe("m5.2xlarge");
  });
});

describe("resizing a database", () => {
  test("applies the class at once, and undo puts the old one back", async () => {
    const fake: FakeAwsSavings = createFakeAwsSavings({
      databases: [
        { id: "reports", instanceClass: "db.r5.2xlarge", status: "available" },
      ],
    });
    const outcome: CloudSavingsStepOutcome = await applyAwsSavingsAction(
      context(fake),
      run({
        kind: CloudSavingsActionKind.ResizeDatabase,
        target: target(CloudSavingsTargetType.Database, "reports"),
        to: "db.r5.xlarge",
      }),
    );

    expect(outcome.progress.previous).toBe("db.r5.2xlarge");
    expect(
      fake.calls.find((call: FakeAwsSavings["calls"][number]): boolean => {
        return call.action === "ModifyDBInstance";
      })?.params,
    ).toMatchObject({
      DBInstanceClass: "db.r5.xlarge",
      ApplyImmediately: "true",
    });

    fake.databases.get("reports")!.status = "available";

    const undo: CloudSavingsStepOutcome = await undoAwsSavingsAction(
      context(fake),
      {
        ...run({
          kind: CloudSavingsActionKind.ResizeDatabase,
          target: target(CloudSavingsTargetType.Database, "reports"),
          to: "db.r5.xlarge",
        }),
        applied: outcome.progress,
      },
    );

    expect(undo.changed).toBe(true);
    expect(fake.databases.get("reports")?.instanceClass).toBe("db.r5.2xlarge");
  });
});

describe("refusals", () => {
  test("a call the connection was not granted says which call, and which setting grants it", async () => {
    const fake: FakeAwsSavings = createFakeAwsSavings({
      instances: [
        { id: "i-0abc1234def567890", type: "m5.large", state: "running" },
      ],
      allowedActions: ["ec2:DescribeInstances"],
    });

    let failure: unknown = null;

    try {
      await applyAwsSavingsAction(
        context(fake),
        run({
          kind: CloudSavingsActionKind.StopInstance,
          target: target(
            CloudSavingsTargetType.Instance,
            "i-0abc1234def567890",
          ),
        }),
      );
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(LlmProviderError);
    expect((failure as LlmProviderError).kind).toBe(
      CloudConnectionFailureKind.Permission,
    );
    expect((failure as Error).message).toBe(
      "AWS refused ec2:StopInstances on instance i-0abc1234def567890: the access key may not call it. Set the connection's Savings actions to on, and run its setup command again.",
    );
    expect(fake.instances.get("i-0abc1234def567890")?.state).toBe("running");
  });

  test("a resize refused says to pick the choice that resizes", async () => {
    const fake: FakeAwsSavings = createFakeAwsSavings({
      databases: [
        { id: "reports", instanceClass: "db.r5.2xlarge", status: "available" },
      ],
      allowedActions: [...AWS_SAVINGS_ACTIONS_CLEAN_UP_ACTIONS].map(
        (action: string): string => {
          return action;
        },
      ),
    });

    await expect(
      applyAwsSavingsAction(
        context(fake),
        run({
          kind: CloudSavingsActionKind.ResizeDatabase,
          target: target(CloudSavingsTargetType.Database, "reports"),
          to: "db.r5.xlarge",
        }),
      ),
    ).rejects.toThrow('"Stop, start, clean up and resize"');
  });

  test("the clean-up grant is enough for every clean-up change", async () => {
    const fake: FakeAwsSavings = createFakeAwsSavings({
      instances: [
        { id: "i-0abc1234def567890", type: "m5.large", state: "running" },
      ],
      volumes: [
        {
          id: "vol-0123456789abcdef0",
          type: "gp2",
          size: 100,
          zone: "eu-west-1a",
          state: "available",
        },
      ],
      addresses: [
        {
          allocationId: "eipalloc-0a1b2c3d4e5f60718",
          publicIp: "203.0.113.25",
        },
      ],
      databases: [
        { id: "reports", instanceClass: "db.r5.large", status: "available" },
      ],
      allowedActions: [...AWS_SAVINGS_ACTIONS_CLEAN_UP_ACTIONS],
    });

    await applyAwsSavingsAction(
      context(fake),
      run({
        kind: CloudSavingsActionKind.StopInstance,
        target: target(CloudSavingsTargetType.Instance, "i-0abc1234def567890"),
      }),
    );
    await applyAwsSavingsAction(
      context(fake),
      run({
        kind: CloudSavingsActionKind.ChangeVolumeType,
        target: target(CloudSavingsTargetType.Volume, "vol-0123456789abcdef0"),
        to: "gp3",
      }),
    );
    await applyAwsSavingsAction(
      context(fake),
      run({
        kind: CloudSavingsActionKind.ReleaseAddress,
        target: target(
          CloudSavingsTargetType.Address,
          "eipalloc-0a1b2c3d4e5f60718",
        ),
      }),
    );
    await applyAwsSavingsAction(
      context(fake),
      run({
        kind: CloudSavingsActionKind.StopDatabase,
        target: target(CloudSavingsTargetType.Database, "reports"),
      }),
    );

    expect(fake.writes()).toEqual([
      "ec2:StopInstances",
      "ec2:ModifyVolume",
      "ec2:ReleaseAddress",
      "rds:StopDBInstance",
    ]);
  });

  test("a change of a kind AWS savings do not make is refused before anything is sent", async () => {
    const fake: FakeAwsSavings = createFakeAwsSavings();

    await expect(
      applyAwsSavingsAction(
        context(fake),
        run({
          kind: CloudSavingsActionKind.DeleteImage,
          target: target(CloudSavingsTargetType.Image, "ami-0abcdef1234567890"),
        }),
      ),
    ).rejects.toThrow("OneUptime does not make a change of this kind in AWS");
    expect(fake.calls).toEqual([]);
  });

  test("a resize with nothing to resize to is refused before anything is sent", async () => {
    const fake: FakeAwsSavings = createFakeAwsSavings();

    await expect(
      applyAwsSavingsAction(
        context(fake),
        run({
          kind: CloudSavingsActionKind.ResizeInstance,
          target: target(
            CloudSavingsTargetType.Instance,
            "i-0abc1234def567890",
          ),
        }),
      ),
    ).rejects.toThrow("which size to resize to");
    expect(fake.calls).toEqual([]);
  });
});
