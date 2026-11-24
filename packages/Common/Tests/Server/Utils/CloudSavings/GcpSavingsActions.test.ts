import { describe, expect, test } from "@jest/globals";
import { generateKeyPairSync } from "crypto";
import { CloudConnectionSettings } from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import {
  GCP_COMPUTE_SCOPE,
  applyGcpSavingsAction,
  undoGcpSavingsAction,
} from "../../../../Server/Utils/CloudSavings/Cloud/GcpSavingsActions";
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
  readGcpSavingsTarget,
} from "../../../../Types/Cloud/CloudSavingsAction";
import { CloudConnectionAuthMethod } from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import {
  CLOUD_SAVINGS_ACTION_TAG_KEY,
  GCP_SAVINGS_ACTIONS_CLEAN_UP_PERMISSIONS,
  GCP_SAVINGS_ACTIONS_RESIZE_PERMISSIONS,
} from "../../../../Types/CloudConnection/CloudSavingsActionsAccess";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  FakeGcpDisk,
  FakeGcpSavings,
  createFakeGcpSavings,
} from "./FakeGcpSavings";

/*
 * Acting on savings in Google Cloud (#11010), against a fake Compute
 * Engine that answers as its v1 API does: an instance is stopped and
 * started again; an unattached disk - a zone's or a Region's - is deleted
 * only once its final snapshot is READY, and made again from it; an idle
 * address is released only while nothing uses it; an image is deleted;
 * an instance is resized by a stop, its machine type set and a start once
 * the type has changed. Each reads first and writes only what is not so
 * already, with a token of Compute Engine's scope. A refusal names the
 * permission the service account lacks - the one Google names - and the
 * setting that grants it; a project the connection does not read is never
 * written.
 */

const PROJECT: string = "shop-dev-123";
const OTHER_PROJECT: string = "shop-prod-456";
const ZONE: string = "us-central1-a";
const REGION: string = "europe-west1";
const ACTION_ID: string = "6a1f0c2e-8d1b-4e51-9a0b-3c4d5e6f7a8b";
const FINAL_SNAPSHOT: string = "oneuptime-final-data-old-6a1f0c2e";
const CONNECTION: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const KEY: string = JSON.stringify({
  type: "service_account",
  project_id: PROJECT,
  client_email: `oneuptime-read-only@${PROJECT}.iam.gserviceaccount.com`,
  private_key: privateKey,
  token_uri: "https://oauth2.googleapis.com/token",
});

const INSTANCE: string = `//compute.googleapis.com/projects/${PROJECT}/zones/${ZONE}/instances/web-1`;
const DISK: string = `//compute.googleapis.com/projects/${PROJECT}/zones/${ZONE}/disks/data-old`;
const REGIONAL_DISK: string = `//compute.googleapis.com/projects/${PROJECT}/regions/${REGION}/disks/data-old`;
const ADDRESS: string = `//compute.googleapis.com/projects/${PROJECT}/regions/${REGION}/addresses/old-lb`;
const GLOBAL_ADDRESS: string = `//compute.googleapis.com/projects/${PROJECT}/global/addresses/old-global`;
const IMAGE: string = `//compute.googleapis.com/projects/${PROJECT}/global/images/base-2023`;

function settings(config: JSONObject = {}): CloudConnectionSettings {
  return {
    provider: CloudProvider.GCP,
    projectId: "11111111-1111-4111-8111-111111111111",
    config: {
      authMethod: CloudConnectionAuthMethod.GcpServiceAccountKey,
      ...config,
    },
    secrets: { serviceAccountJson: KEY },
  };
}

function context(
  fake: FakeGcpSavings,
  config: JSONObject = {},
): CloudSavingsStepContext {
  return {
    settings: settings(config),
    connectionId: CONNECTION,
    transport: fake.transport,
    sleep: async (): Promise<void> => {},
  };
}

function target(resourceId: string): CloudSavingsTarget {
  const read: CloudSavingsTarget | null = readGcpSavingsTarget(resourceId);

  if (!read) {
    throw new Error(`Not a target: ${resourceId}`);
  }

  return read;
}

function run(data: {
  kind: CloudSavingsActionKind;
  resourceId: string;
  to?: string;
  finalSnapshot?: boolean;
  progress?: CloudSavingsProgress;
}): CloudSavingsRun {
  return {
    actionId: ACTION_ID,
    kind: data.kind,
    target: target(data.resourceId),
    to: data.to,
    finalSnapshot: data.finalSnapshot,
    progress: data.progress || {},
  };
}

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

async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  return await promise.then(
    (): unknown => {
      return undefined;
    },
    (error: unknown): unknown => {
      return error;
    },
  );
}

const ZONAL_DISK: FakeGcpDisk = {
  project: PROJECT,
  zone: ZONE,
  name: "data-old",
  type: "pd-balanced",
  sizeGb: 200,
  labels: { team: "search" },
};

describe("stopping an idle instance, and starting it again", () => {
  test("stops a running instance, signed in with Compute Engine's scope", async () => {
    const fake: FakeGcpSavings = createFakeGcpSavings({
      instances: [
        {
          project: PROJECT,
          zone: ZONE,
          name: "web-1",
          status: "RUNNING",
          machineType: "n2-standard-8",
        },
      ],
    });
    const outcome: CloudSavingsStepOutcome = await applyGcpSavingsAction(
      context(fake),
      run({ kind: CloudSavingsActionKind.StopInstance, resourceId: INSTANCE }),
    );

    expect(outcome).toMatchObject({ state: "done", changed: true });
    expect(outcome.summary).toBe(
      "Stopped instance web-1. Its disks are kept, and it can be started again.",
    );
    expect(fake.writes()).toEqual(["compute.instances.stop"]);
    expect(
      fake.calls.map((call: FakeGcpSavings["calls"][number]) => {
        return `${call.method} ${call.path}`;
      }),
    ).toEqual([
      `GET projects/${PROJECT}/zones/${ZONE}/instances/web-1`,
      `POST projects/${PROJECT}/zones/${ZONE}/instances/web-1/stop`,
    ]);
    expect(fake.scopes).toEqual([GCP_COMPUTE_SCOPE]);
    expect(GCP_COMPUTE_SCOPE).toBe("https://www.googleapis.com/auth/compute");
  });

  test("an instance already stopped, stopping or suspended is left alone", async () => {
    for (const status of ["TERMINATED", "STOPPING", "SUSPENDED"] as const) {
      const fake: FakeGcpSavings = createFakeGcpSavings({
        instances: [
          {
            project: PROJECT,
            zone: ZONE,
            name: "web-1",
            status,
            machineType: "n2-standard-8",
            transitionReads: 5,
          },
        ],
      });
      const outcome: CloudSavingsStepOutcome = await applyGcpSavingsAction(
        context(fake),
        run({
          kind: CloudSavingsActionKind.StopInstance,
          resourceId: INSTANCE,
        }),
      );

      expect(outcome).toMatchObject({ state: "done", changed: false });
      expect(fake.writes()).toEqual([]);
    }
  });

  test("an instance being repaired is not stopped", async () => {
    const fake: FakeGcpSavings = createFakeGcpSavings({
      instances: [
        {
          project: PROJECT,
          zone: ZONE,
          name: "web-1",
          status: "REPAIRING",
          machineType: "n2-standard-8",
        },
      ],
    });

    await expect(
      applyGcpSavingsAction(
        context(fake),
        run({
          kind: CloudSavingsActionKind.StopInstance,
          resourceId: INSTANCE,
        }),
      ),
    ).rejects.toThrow(
      "Instance web-1 is REPAIRING now, so it cannot be stopped.",
    );
    expect(fake.writes()).toEqual([]);
  });

  test("an instance that is gone fails with why", async () => {
    await expect(
      applyGcpSavingsAction(
        context(createFakeGcpSavings()),
        run({
          kind: CloudSavingsActionKind.StopInstance,
          resourceId: INSTANCE,
        }),
      ),
    ).rejects.toThrow(
      "Instance web-1 was not found: it may have been deleted.",
    );
  });

  test("undo starts it again, waiting while it is still stopping", async () => {
    const fake: FakeGcpSavings = createFakeGcpSavings({
      instances: [
        {
          project: PROJECT,
          zone: ZONE,
          name: "web-1",
          status: "STOPPING",
          machineType: "n2-standard-8",
          transitionReads: 2,
        },
      ],
    });
    const outcomes: Array<CloudSavingsStepOutcome> = await untilDone(
      (progress: CloudSavingsProgress) => {
        return undoGcpSavingsAction(context(fake), {
          ...run({
            kind: CloudSavingsActionKind.StopInstance,
            resourceId: INSTANCE,
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
      summary: "Started instance web-1 again.",
    });
    expect(fake.writes()).toEqual(["compute.instances.start"]);
  });

  test("undo of an instance already running changes nothing; a suspended one says to resume it", async () => {
    const running: FakeGcpSavings = createFakeGcpSavings({
      instances: [
        {
          project: PROJECT,
          zone: ZONE,
          name: "web-1",
          status: "RUNNING",
          machineType: "n2-standard-8",
        },
      ],
    });

    expect(
      (
        await undoGcpSavingsAction(context(running), {
          ...run({
            kind: CloudSavingsActionKind.StopInstance,
            resourceId: INSTANCE,
          }),
          applied: {},
        })
      ).changed,
    ).toBe(false);

    const suspended: FakeGcpSavings = createFakeGcpSavings({
      instances: [
        {
          project: PROJECT,
          zone: ZONE,
          name: "web-1",
          status: "SUSPENDED",
          machineType: "n2-standard-8",
        },
      ],
    });

    await expect(
      undoGcpSavingsAction(context(suspended), {
        ...run({
          kind: CloudSavingsActionKind.StopInstance,
          resourceId: INSTANCE,
        }),
        applied: {},
      }),
    ).rejects.toThrow("Resume or start it in the Google Cloud console.");
    expect(suspended.writes()).toEqual([]);
  });
});

describe("deleting an unattached disk after a final snapshot", () => {
  test("snapshots it, waits until the snapshot is READY, then deletes the disk", async () => {
    const fake: FakeGcpSavings = createFakeGcpSavings({ disks: [ZONAL_DISK] });
    const outcomes: Array<CloudSavingsStepOutcome> = await untilDone(
      (progress: CloudSavingsProgress) => {
        return applyGcpSavingsAction(
          context(fake),
          run({
            kind: CloudSavingsActionKind.DeleteVolume,
            resourceId: DISK,
            finalSnapshot: true,
            progress,
          }),
        );
      },
    );
    const last: CloudSavingsStepOutcome = outcomes[outcomes.length - 1]!;

    expect(outcomes[0]?.summary).toBe(
      `Taking a final snapshot of disk data-old (${FINAL_SNAPSHOT}) before deleting it.`,
    );
    expect(last).toMatchObject({ state: "done", changed: true });
    expect(last.summary).toBe(
      `Deleted disk data-old, after a final snapshot (${FINAL_SNAPSHOT}) it can be made again from.`,
    );
    expect(fake.writes()).toEqual([
      "compute.disks.createSnapshot",
      "compute.disks.delete",
    ]);
    expect(fake.disks.size).toBe(0);

    const snapshot: JSONObject = fake.calls.find(
      (call: FakeGcpSavings["calls"][number]): boolean => {
        return call.path.endsWith("/createSnapshot");
      },
    )!.body!;
    expect(snapshot["name"]).toBe(FINAL_SNAPSHOT);
    expect(snapshot["labels"]).toEqual({
      [CLOUD_SAVINGS_ACTION_TAG_KEY]: ACTION_ID,
    });
    expect(
      fake.snapshots.get(
        `projects/${PROJECT}/global/snapshots/${FINAL_SNAPSHOT}`,
      )?.status,
    ).toBe("READY");

    expect(last.progress.snapshotId).toBe(FINAL_SNAPSHOT);
    expect(last.progress.disk).toEqual({
      type: "pd-balanced",
      sizeGb: 200,
      labels: { team: "search" },
      replicaZones: [],
    });
  });

  test("never deletes the disk while its snapshot is CREATING", async () => {
    const fake: FakeGcpSavings = createFakeGcpSavings({ disks: [ZONAL_DISK] });
    let progress: CloudSavingsProgress = {};

    for (let index: number = 0; index < 2; index++) {
      progress = (
        await applyGcpSavingsAction(
          context(fake),
          run({
            kind: CloudSavingsActionKind.DeleteVolume,
            resourceId: DISK,
            finalSnapshot: true,
            progress,
          }),
        )
      ).progress;
    }

    expect(fake.disks.size).toBe(1);
    expect(fake.writes()).toEqual(["compute.disks.createSnapshot"]);
  });

  test("a snapshot that FAILED keeps the disk", async () => {
    const fake: FakeGcpSavings = createFakeGcpSavings({ disks: [ZONAL_DISK] });
    const first: CloudSavingsStepOutcome = await applyGcpSavingsAction(
      context(fake),
      run({
        kind: CloudSavingsActionKind.DeleteVolume,
        resourceId: DISK,
        finalSnapshot: true,
      }),
    );

    fake.snapshots.get(
      `projects/${PROJECT}/global/snapshots/${FINAL_SNAPSHOT}`,
    )!.status = "FAILED";

    await expect(
      applyGcpSavingsAction(
        context(fake),
        run({
          kind: CloudSavingsActionKind.DeleteVolume,
          resourceId: DISK,
          finalSnapshot: true,
          progress: first.progress,
        }),
      ),
    ).rejects.toThrow(
      "The final snapshot of disk data-old failed, so the disk was not deleted.",
    );
    expect(fake.disks.size).toBe(1);
  });

  test("a snapshot asked for before, its answer lost, is the one waited for", async () => {
    const fake: FakeGcpSavings = createFakeGcpSavings({
      disks: [ZONAL_DISK],
      snapshots: [
        {
          project: PROJECT,
          name: FINAL_SNAPSHOT,
          sourceDisk: `projects/${PROJECT}/zones/${ZONE}/disks/data-old`,
          status: "READY",
        },
      ],
    });
    const outcomes: Array<CloudSavingsStepOutcome> = await untilDone(
      (progress: CloudSavingsProgress) => {
        return applyGcpSavingsAction(
          context(fake),
          run({
            kind: CloudSavingsActionKind.DeleteVolume,
            resourceId: DISK,
            finalSnapshot: true,
            progress,
          }),
        );
      },
    );

    expect(outcomes[outcomes.length - 1]?.changed).toBe(true);
    expect(fake.snapshots.size).toBe(1);
    expect(fake.disks.size).toBe(0);
  });

  test("a disk an instance uses is never deleted, nor snapshotted", async () => {
    const fake: FakeGcpSavings = createFakeGcpSavings({
      disks: [
        {
          ...ZONAL_DISK,
          users: [
            `https://www.googleapis.com/compute/v1/projects/${PROJECT}/zones/${ZONE}/instances/web-1`,
          ],
        },
      ],
    });

    await expect(
      applyGcpSavingsAction(
        context(fake),
        run({
          kind: CloudSavingsActionKind.DeleteVolume,
          resourceId: DISK,
          finalSnapshot: true,
        }),
      ),
    ).rejects.toThrow(
      "Disk data-old is attached to web-1 now, so it was not deleted.",
    );
    expect(fake.writes()).toEqual([]);
  });

  test("a disk attached between its snapshot and its delete is kept, in Google's words", async () => {
    const fake: FakeGcpSavings = createFakeGcpSavings({ disks: [ZONAL_DISK] });
    let progress: CloudSavingsProgress = (
      await applyGcpSavingsAction(
        context(fake),
        run({
          kind: CloudSavingsActionKind.DeleteVolume,
          resourceId: DISK,
          finalSnapshot: true,
        }),
      )
    ).progress;

    fake.disks.get(`projects/${PROJECT}/zones/${ZONE}/disks/data-old`)!.users =
      [`projects/${PROJECT}/zones/${ZONE}/instances/batch-7`];

    let failure: unknown = null;

    for (let tries: number = 0; tries < 5 && !failure; tries++) {
      try {
        progress = (
          await applyGcpSavingsAction(
            context(fake),
            run({
              kind: CloudSavingsActionKind.DeleteVolume,
              resourceId: DISK,
              finalSnapshot: true,
              progress,
            }),
          )
        ).progress;
      } catch (error) {
        failure = error;
      }
    }

    expect(failure).toBeInstanceOf(BadDataException);
    expect((failure as Error).message).toBe(
      `Disk data-old was attached before it could be deleted, so it was kept: The disk resource 'projects/${PROJECT}/zones/${ZONE}/disks/data-old' is already being used by 'projects/${PROJECT}/zones/${ZONE}/instances/batch-7'`,
    );
    expect(fake.disks.size).toBe(1);
  });

  test("with no final snapshot asked for, it is deleted at once", async () => {
    const fake: FakeGcpSavings = createFakeGcpSavings({ disks: [ZONAL_DISK] });
    const outcome: CloudSavingsStepOutcome = await applyGcpSavingsAction(
      context(fake),
      run({
        kind: CloudSavingsActionKind.DeleteVolume,
        resourceId: DISK,
        finalSnapshot: false,
      }),
    );

    expect(outcome.summary).toBe(
      "Deleted disk data-old. No final snapshot was taken.",
    );
    expect(fake.writes()).toEqual(["compute.disks.delete"]);
  });

  test("a disk already gone is not an error", async () => {
    const fake: FakeGcpSavings = createFakeGcpSavings();
    const outcome: CloudSavingsStepOutcome = await applyGcpSavingsAction(
      context(fake),
      run({
        kind: CloudSavingsActionKind.DeleteVolume,
        resourceId: DISK,
        finalSnapshot: true,
      }),
    );

    expect(outcome).toMatchObject({ state: "done", changed: false });
    expect(fake.writes()).toEqual([]);
  });

  test("undo makes it again from its snapshot - its name, type, size and labels - once", async () => {
    const fake: FakeGcpSavings = createFakeGcpSavings({ disks: [ZONAL_DISK] });
    const applied: Array<CloudSavingsStepOutcome> = await untilDone(
      (progress: CloudSavingsProgress) => {
        return applyGcpSavingsAction(
          context(fake),
          run({
            kind: CloudSavingsActionKind.DeleteVolume,
            resourceId: DISK,
            finalSnapshot: true,
            progress,
          }),
        );
      },
    );
    const appliedProgress: CloudSavingsProgress =
      applied[applied.length - 1]!.progress;

    const undo: CloudSavingsStepOutcome = await undoGcpSavingsAction(
      context(fake),
      {
        ...run({ kind: CloudSavingsActionKind.DeleteVolume, resourceId: DISK }),
        applied: appliedProgress,
      },
    );

    expect(undo).toMatchObject({ state: "done", changed: true });
    expect(undo.summary).toBe(
      `Made disk data-old again from its final snapshot ${FINAL_SNAPSHOT}, in ${ZONE}. Attach it where it was used.`,
    );
    expect(
      fake.calls.find((call: FakeGcpSavings["calls"][number]): boolean => {
        return call.method === "POST" && call.path.endsWith("/disks");
      })?.body,
    ).toEqual({
      name: "data-old",
      sourceSnapshot: `global/snapshots/${FINAL_SNAPSHOT}`,
      type: `zones/${ZONE}/diskTypes/pd-balanced`,
      sizeGb: "200",
      labels: { team: "search", [CLOUD_SAVINGS_ACTION_TAG_KEY]: ACTION_ID },
    });
    expect(
      fake.disks.get(`projects/${PROJECT}/zones/${ZONE}/disks/data-old`),
    ).toMatchObject({ type: "pd-balanced", sizeGb: 200 });

    // Sent again, its answer lost: Google says it is there, and nothing more is made.
    const again: CloudSavingsStepOutcome = await undoGcpSavingsAction(
      context(fake),
      {
        ...run({ kind: CloudSavingsActionKind.DeleteVolume, resourceId: DISK }),
        applied: appliedProgress,
      },
    );
    expect(again.changed).toBe(false);
    expect(fake.disks.size).toBe(1);
  });

  test("a Region's disk is snapshotted, deleted and made again in its Region, with its replica zones", async () => {
    const fake: FakeGcpSavings = createFakeGcpSavings({
      disks: [
        {
          project: PROJECT,
          region: REGION,
          name: "data-old",
          type: "pd-ssd",
          sizeGb: 100,
          replicaZones: [
            `https://www.googleapis.com/compute/v1/projects/${PROJECT}/zones/${REGION}-b`,
            `https://www.googleapis.com/compute/v1/projects/${PROJECT}/zones/${REGION}-c`,
          ],
        },
      ],
    });
    const applied: Array<CloudSavingsStepOutcome> = await untilDone(
      (progress: CloudSavingsProgress) => {
        return applyGcpSavingsAction(
          context(fake),
          run({
            kind: CloudSavingsActionKind.DeleteVolume,
            resourceId: REGIONAL_DISK,
            finalSnapshot: true,
            progress,
          }),
        );
      },
    );

    expect(
      fake.calls.map((call: FakeGcpSavings["calls"][number]) => {
        return `${call.method} ${call.path}`;
      }),
    ).toContain(
      `POST projects/${PROJECT}/regions/${REGION}/disks/data-old/createSnapshot`,
    );

    await undoGcpSavingsAction(context(fake), {
      ...run({
        kind: CloudSavingsActionKind.DeleteVolume,
        resourceId: REGIONAL_DISK,
      }),
      applied: applied[applied.length - 1]!.progress,
    });

    const insert: JSONObject = fake.calls.find(
      (call: FakeGcpSavings["calls"][number]): boolean => {
        return (
          call.method === "POST" &&
          call.path === `projects/${PROJECT}/regions/${REGION}/disks`
        );
      },
    )!.body!;
    expect(insert["type"]).toBe(`regions/${REGION}/diskTypes/pd-ssd`);
    expect(insert["replicaZones"]).toHaveLength(2);
  });

  test("a disk deleted with no snapshot cannot be undone, and says why", async () => {
    await expect(
      undoGcpSavingsAction(context(createFakeGcpSavings()), {
        ...run({ kind: CloudSavingsActionKind.DeleteVolume, resourceId: DISK }),
        applied: {},
      }),
    ).rejects.toThrow("No final snapshot was taken");
  });
});

describe("releasing an address and deleting an image", () => {
  test("releases a Region's idle address, and says it cannot be had again", async () => {
    const fake: FakeGcpSavings = createFakeGcpSavings({
      addresses: [
        {
          project: PROJECT,
          region: REGION,
          name: "old-lb",
          address: "34.76.1.9",
          status: "RESERVED",
        },
      ],
    });
    const outcome: CloudSavingsStepOutcome = await applyGcpSavingsAction(
      context(fake),
      run({ kind: CloudSavingsActionKind.ReleaseAddress, resourceId: ADDRESS }),
    );

    expect(outcome.summary).toBe(
      "Released address old-lb (34.76.1.9): it goes back to Google Cloud and cannot be had again.",
    );
    expect(fake.writes()).toEqual(["compute.addresses.delete"]);
  });

  test("a global address is released with the global address permissions", async () => {
    const fake: FakeGcpSavings = createFakeGcpSavings({
      addresses: [
        {
          project: PROJECT,
          name: "old-global",
          address: "34.120.1.1",
          status: "RESERVED",
        },
      ],
    });

    await applyGcpSavingsAction(
      context(fake),
      run({
        kind: CloudSavingsActionKind.ReleaseAddress,
        resourceId: GLOBAL_ADDRESS,
      }),
    );

    expect(
      fake.calls.map((call: FakeGcpSavings["calls"][number]) => {
        return call.permissions[0];
      }),
    ).toEqual([
      "compute.globalAddresses.get",
      "compute.globalAddresses.delete",
    ]);
  });

  test("an address in use is never released, and names what uses it", async () => {
    const fake: FakeGcpSavings = createFakeGcpSavings({
      addresses: [
        {
          project: PROJECT,
          region: REGION,
          name: "old-lb",
          address: "34.76.1.9",
          status: "IN_USE",
          users: [
            `https://www.googleapis.com/compute/v1/projects/${PROJECT}/regions/${REGION}/forwardingRules/web-fr`,
          ],
        },
      ],
    });

    await expect(
      applyGcpSavingsAction(
        context(fake),
        run({
          kind: CloudSavingsActionKind.ReleaseAddress,
          resourceId: ADDRESS,
        }),
      ),
    ).rejects.toThrow(
      "Address old-lb (34.76.1.9) is used by web-fr now, so it was not released.",
    );
    expect(fake.writes()).toEqual([]);
  });

  test("deletes an old image; one already gone is not an error", async () => {
    const fake: FakeGcpSavings = createFakeGcpSavings({
      images: [{ project: PROJECT, name: "base-2023" }],
    });

    expect(
      (
        await applyGcpSavingsAction(
          context(fake),
          run({ kind: CloudSavingsActionKind.DeleteImage, resourceId: IMAGE }),
        )
      ).summary,
    ).toBe("Deleted image base-2023.");
    expect(fake.writes()).toEqual(["compute.images.delete"]);

    expect(
      (
        await applyGcpSavingsAction(
          context(fake),
          run({ kind: CloudSavingsActionKind.DeleteImage, resourceId: IMAGE }),
        )
      ).changed,
    ).toBe(false);
  });

  test("neither can be undone, and each says why", async () => {
    for (const [kind, resourceId] of [
      [CloudSavingsActionKind.ReleaseAddress, ADDRESS],
      [CloudSavingsActionKind.DeleteImage, IMAGE],
    ] as Array<[CloudSavingsActionKind, string]>) {
      const fake: FakeGcpSavings = createFakeGcpSavings();

      await expect(
        undoGcpSavingsAction(context(fake), {
          ...run({ kind, resourceId }),
          applied: {},
        }),
      ).rejects.toThrow("cannot be undone");
      expect(fake.calls).toEqual([]);
    }
  });
});

describe("resizing an instance", () => {
  test("stops it, waits until TERMINATED, sets its machine type, and starts it once the type has changed", async () => {
    const fake: FakeGcpSavings = createFakeGcpSavings({
      instances: [
        {
          project: PROJECT,
          zone: ZONE,
          name: "web-1",
          status: "RUNNING",
          machineType: "n2-standard-8",
          transitionReads: 2,
        },
      ],
    });
    const outcomes: Array<CloudSavingsStepOutcome> = await untilDone(
      (progress: CloudSavingsProgress) => {
        return applyGcpSavingsAction(
          context(fake),
          run({
            kind: CloudSavingsActionKind.ResizeInstance,
            resourceId: INSTANCE,
            to: "n2-standard-4",
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
      "Resized instance web-1 from n2-standard-8 to n2-standard-4, and started it again.",
    );
    expect(last.progress.previous).toBe("n2-standard-8");
    expect(fake.writes()).toEqual([
      "compute.instances.stop",
      "compute.instances.setMachineType",
      "compute.instances.start",
    ]);
    expect(
      fake.calls.find((call: FakeGcpSavings["calls"][number]): boolean => {
        return call.path.endsWith("/setMachineType");
      })?.body,
    ).toEqual({ machineType: `zones/${ZONE}/machineTypes/n2-standard-4` });
  });

  test("a stopped instance is resized and left stopped", async () => {
    const fake: FakeGcpSavings = createFakeGcpSavings({
      instances: [
        {
          project: PROJECT,
          zone: ZONE,
          name: "web-1",
          status: "TERMINATED",
          machineType: "n2-standard-8",
        },
      ],
    });
    const outcome: CloudSavingsStepOutcome = await applyGcpSavingsAction(
      context(fake),
      run({
        kind: CloudSavingsActionKind.ResizeInstance,
        resourceId: INSTANCE,
        to: "n2-standard-4",
      }),
    );

    expect(outcome.summary).toBe(
      "Resized instance web-1 from n2-standard-8 to n2-standard-4. It was stopped, and is left stopped.",
    );
    expect(fake.writes()).toEqual(["compute.instances.setMachineType"]);
  });

  test("an instance already that type is left alone", async () => {
    const fake: FakeGcpSavings = createFakeGcpSavings({
      instances: [
        {
          project: PROJECT,
          zone: ZONE,
          name: "web-1",
          status: "RUNNING",
          machineType: "n2-standard-4",
        },
      ],
    });
    const outcome: CloudSavingsStepOutcome = await applyGcpSavingsAction(
      context(fake),
      run({
        kind: CloudSavingsActionKind.ResizeInstance,
        resourceId: INSTANCE,
        to: "n2-standard-4",
      }),
    );

    expect(outcome.changed).toBe(false);
    expect(fake.writes()).toEqual([]);
  });

  test("a machine type Google refuses starts the instance again before saying so, in Google's words", async () => {
    const fake: FakeGcpSavings = createFakeGcpSavings({
      instances: [
        {
          project: PROJECT,
          zone: ZONE,
          name: "web-1",
          status: "RUNNING",
          machineType: "n2-standard-8",
          refusedTypes: ["n9-tiny-1"],
        },
      ],
    });
    let progress: CloudSavingsProgress = {};
    let failure: unknown = null;

    for (let tries: number = 0; tries < 6 && !failure; tries++) {
      try {
        progress = (
          await applyGcpSavingsAction(
            context(fake),
            run({
              kind: CloudSavingsActionKind.ResizeInstance,
              resourceId: INSTANCE,
              to: "n9-tiny-1",
              progress,
            }),
          )
        ).progress;
      } catch (error) {
        failure = error;
      }
    }

    expect(failure).toBeInstanceOf(BadDataException);
    expect((failure as Error).message).toBe(
      `Google Cloud would not make instance web-1 a n9-tiny-1, so it was left a n2-standard-8 and started again: Invalid value for field 'resource.machineType': 'zones/${ZONE}/machineTypes/n9-tiny-1'. Machine type with name 'n9-tiny-1' does not exist in zone '${ZONE}'.`,
    );
    expect(fake.writes()).toEqual([
      "compute.instances.stop",
      "compute.instances.setMachineType",
      "compute.instances.start",
    ]);
  });

  test("undo sizes it back, with steps of its own", async () => {
    const fake: FakeGcpSavings = createFakeGcpSavings({
      instances: [
        {
          project: PROJECT,
          zone: ZONE,
          name: "web-1",
          status: "RUNNING",
          machineType: "n2-standard-4",
        },
      ],
    });
    const outcomes: Array<CloudSavingsStepOutcome> = await untilDone(
      (progress: CloudSavingsProgress) => {
        return undoGcpSavingsAction(context(fake), {
          ...run({
            kind: CloudSavingsActionKind.ResizeInstance,
            resourceId: INSTANCE,
            to: "n2-standard-4",
            progress,
          }),
          applied: { previous: "n2-standard-8", step: "done" },
        });
      },
    );

    expect(outcomes[outcomes.length - 1]?.summary).toBe(
      "Resized instance web-1 from n2-standard-4 to n2-standard-8, and started it again.",
    );
    expect(
      fake.instances.get(`projects/${PROJECT}/zones/${ZONE}/instances/web-1`)
        ?.machineType,
    ).toBe("n2-standard-8");
  });
});

describe("refusals", () => {
  test("a call the service account may not make names the permission, and the setting that grants it", async () => {
    const fake: FakeGcpSavings = createFakeGcpSavings({
      instances: [
        {
          project: PROJECT,
          zone: ZONE,
          name: "web-1",
          status: "RUNNING",
          machineType: "n2-standard-8",
        },
      ],
      allowedPermissions: ["compute.instances.get"],
    });
    const failure: unknown = await failureOf(
      applyGcpSavingsAction(
        context(fake),
        run({
          kind: CloudSavingsActionKind.StopInstance,
          resourceId: INSTANCE,
        }),
      ),
    );

    expect(failure).toBeInstanceOf(LlmProviderError);
    expect((failure as LlmProviderError).kind).toBe(
      CloudConnectionFailureKind.Permission,
    );
    expect((failure as Error).message).toBe(
      "Google Cloud refused compute.instances.stop on instance web-1: the service account may not do it. Set the connection's Savings actions to on, and run its setup command again.",
    );
    expect(
      fake.instances.get(`projects/${PROJECT}/zones/${ZONE}/instances/web-1`)
        ?.status,
    ).toBe("RUNNING");
  });

  test("a call that needs two permissions names the one Google said is missing", async () => {
    const fake: FakeGcpSavings = createFakeGcpSavings({
      disks: [ZONAL_DISK],
      allowedPermissions: GCP_SAVINGS_ACTIONS_CLEAN_UP_PERMISSIONS.filter(
        (permission: string): boolean => {
          return permission !== "compute.snapshots.create";
        },
      ),
    });

    await expect(
      applyGcpSavingsAction(
        context(fake),
        run({
          kind: CloudSavingsActionKind.DeleteVolume,
          resourceId: DISK,
          finalSnapshot: true,
        }),
      ),
    ).rejects.toThrow(
      "Google Cloud refused compute.snapshots.create on disk data-old",
    );
    expect(fake.disks.size).toBe(1);
  });

  test("a resize refused says to pick the choice that resizes, and the instance is started again", async () => {
    const fake: FakeGcpSavings = createFakeGcpSavings({
      instances: [
        {
          project: PROJECT,
          zone: ZONE,
          name: "web-1",
          status: "RUNNING",
          machineType: "n2-standard-8",
        },
      ],
      allowedPermissions: [...GCP_SAVINGS_ACTIONS_CLEAN_UP_PERMISSIONS],
    });
    let progress: CloudSavingsProgress = {};
    let failure: unknown = null;

    for (let tries: number = 0; tries < 6 && !failure; tries++) {
      try {
        progress = (
          await applyGcpSavingsAction(
            context(fake),
            run({
              kind: CloudSavingsActionKind.ResizeInstance,
              resourceId: INSTANCE,
              to: "n2-standard-4",
              progress,
            }),
          )
        ).progress;
      } catch (error) {
        failure = error;
      }
    }

    expect((failure as Error).message).toBe(
      'Google Cloud refused compute.instances.setMachineType on instance web-1: the service account may not do it. Set the connection\'s Savings actions to "Stop, start, clean up and resize", and run its setup command again.',
    );
    expect(fake.writes()).toEqual([
      "compute.instances.stop",
      "compute.instances.setMachineType",
      "compute.instances.start",
    ]);
  });

  test("Compute Engine turned off in the project says the command that turns it on", async () => {
    const fake: FakeGcpSavings = createFakeGcpSavings({ isApiDisabled: true });
    const failure: unknown = await failureOf(
      applyGcpSavingsAction(
        context(fake),
        run({
          kind: CloudSavingsActionKind.StopInstance,
          resourceId: INSTANCE,
        }),
      ),
    );

    expect((failure as LlmProviderError).kind).toBe(
      CloudConnectionFailureKind.Settings,
    );
    expect((failure as Error).message).toContain(
      "gcloud services enable compute.googleapis.com",
    );
  });

  test("the clean-up grant is enough for every clean-up change and its undo; resize adds only the resize", async () => {
    const fake: FakeGcpSavings = createFakeGcpSavings({
      instances: [
        {
          project: PROJECT,
          zone: ZONE,
          name: "web-1",
          status: "RUNNING",
          machineType: "n2-standard-8",
        },
      ],
      disks: [ZONAL_DISK],
      addresses: [
        {
          project: PROJECT,
          region: REGION,
          name: "old-lb",
          address: "34.76.1.9",
          status: "RESERVED",
        },
        {
          project: PROJECT,
          name: "old-global",
          address: "34.120.1.1",
          status: "RESERVED",
        },
      ],
      images: [{ project: PROJECT, name: "base-2023" }],
      allowedPermissions: [...GCP_SAVINGS_ACTIONS_CLEAN_UP_PERMISSIONS],
    });

    await applyGcpSavingsAction(
      context(fake),
      run({ kind: CloudSavingsActionKind.StopInstance, resourceId: INSTANCE }),
    );
    await untilDone((progress: CloudSavingsProgress) => {
      return undoGcpSavingsAction(context(fake), {
        ...run({
          kind: CloudSavingsActionKind.StopInstance,
          resourceId: INSTANCE,
          progress,
        }),
        applied: {},
      });
    });
    const deleted: Array<CloudSavingsStepOutcome> = await untilDone(
      (progress: CloudSavingsProgress) => {
        return applyGcpSavingsAction(
          context(fake),
          run({
            kind: CloudSavingsActionKind.DeleteVolume,
            resourceId: DISK,
            finalSnapshot: true,
            progress,
          }),
        );
      },
    );
    await undoGcpSavingsAction(context(fake), {
      ...run({ kind: CloudSavingsActionKind.DeleteVolume, resourceId: DISK }),
      applied: deleted[deleted.length - 1]!.progress,
    });
    await applyGcpSavingsAction(
      context(fake),
      run({ kind: CloudSavingsActionKind.ReleaseAddress, resourceId: ADDRESS }),
    );
    await applyGcpSavingsAction(
      context(fake),
      run({
        kind: CloudSavingsActionKind.ReleaseAddress,
        resourceId: GLOBAL_ADDRESS,
      }),
    );
    await applyGcpSavingsAction(
      context(fake),
      run({ kind: CloudSavingsActionKind.DeleteImage, resourceId: IMAGE }),
    );

    expect(fake.writes()).toEqual([
      "compute.instances.stop",
      "compute.instances.start",
      "compute.disks.createSnapshot",
      "compute.disks.delete",
      "compute.disks.create",
      "compute.addresses.delete",
      "compute.globalAddresses.delete",
      "compute.images.delete",
    ]);
    // Every permission every call needed, reads included, is one the grant holds.
    for (const call of fake.calls) {
      for (const permission of call.permissions) {
        expect(GCP_SAVINGS_ACTIONS_CLEAN_UP_PERMISSIONS).toContain(permission);
      }
    }

    expect(GCP_SAVINGS_ACTIONS_RESIZE_PERMISSIONS).toEqual([
      "compute.instances.setMachineType",
    ]);
  });

  test("a resource in a project the connection does not name is never touched, nor signed in for", async () => {
    const outside: string = INSTANCE.split(PROJECT).join(OTHER_PROJECT);
    const fake: FakeGcpSavings = createFakeGcpSavings({
      instances: [
        {
          project: OTHER_PROJECT,
          zone: ZONE,
          name: "web-1",
          status: "RUNNING",
          machineType: "n2-standard-8",
        },
      ],
    });

    await expect(
      applyGcpSavingsAction(
        context(fake),
        run({ kind: CloudSavingsActionKind.StopInstance, resourceId: outside }),
      ),
    ).rejects.toThrow(
      `Instance web-1 is in project ${OTHER_PROJECT}, which this connection does not read.`,
    );
    expect(fake.calls).toEqual([]);
    expect(fake.scopes).toEqual([]);

    // Named in the connection's projects, it is.
    const outcome: CloudSavingsStepOutcome = await applyGcpSavingsAction(
      context(fake, { projectIds: `${PROJECT}, ${OTHER_PROJECT}` }),
      run({ kind: CloudSavingsActionKind.StopInstance, resourceId: outside }),
    );
    expect(outcome.changed).toBe(true);
  });

  test("an organization's connection that names no projects reaches any of them", async () => {
    const outside: string = INSTANCE.split(PROJECT).join(OTHER_PROJECT);
    const fake: FakeGcpSavings = createFakeGcpSavings({
      instances: [
        {
          project: OTHER_PROJECT,
          zone: ZONE,
          name: "web-1",
          status: "RUNNING",
          machineType: "n2-standard-8",
        },
      ],
    });
    const outcome: CloudSavingsStepOutcome = await applyGcpSavingsAction(
      context(fake, { readScope: "organization" }),
      run({ kind: CloudSavingsActionKind.StopInstance, resourceId: outside }),
    );

    expect(outcome.changed).toBe(true);
  });

  test("a change of a kind Google Cloud savings do not make is refused before anything is sent", async () => {
    for (const kind of [
      CloudSavingsActionKind.StopDatabase,
      CloudSavingsActionKind.ResizeDatabase,
      CloudSavingsActionKind.ChangeVolumeType,
      CloudSavingsActionKind.DeleteSnapshot,
    ]) {
      const fake: FakeGcpSavings = createFakeGcpSavings();

      await expect(
        applyGcpSavingsAction(
          context(fake),
          run({ kind, resourceId: INSTANCE, to: "x" }),
        ),
      ).rejects.toThrow(
        "OneUptime does not make a change of this kind in Google Cloud",
      );
      expect(fake.calls).toEqual([]);
    }
  });

  test("a change made to the wrong kind of resource is refused before anything is sent", async () => {
    const fake: FakeGcpSavings = createFakeGcpSavings({ disks: [ZONAL_DISK] });

    await expect(
      applyGcpSavingsAction(
        context(fake),
        run({ kind: CloudSavingsActionKind.StopInstance, resourceId: DISK }),
      ),
    ).rejects.toThrow(
      "OneUptime does not make a change of this kind to disk data-old: StopInstance.",
    );
    expect(fake.calls).toEqual([]);
  });

  test("a resize with nothing to resize to is refused before anything is sent", async () => {
    const fake: FakeGcpSavings = createFakeGcpSavings();

    await expect(
      applyGcpSavingsAction(
        context(fake),
        run({
          kind: CloudSavingsActionKind.ResizeInstance,
          resourceId: INSTANCE,
        }),
      ),
    ).rejects.toThrow("which machine type to resize to");
    expect(fake.calls).toEqual([]);
  });
});
