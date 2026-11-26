import { describe, expect, test } from "@jest/globals";
import { CloudConnectionSettings } from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import {
  applyAzureSavingsAction,
  undoAzureSavingsAction,
} from "../../../../Server/Utils/CloudSavings/Cloud/AzureSavingsActions";
import {
  CloudSavingsProgress,
  CloudSavingsRun,
  CloudSavingsStepContext,
  CloudSavingsStepOutcome,
} from "../../../../Server/Utils/CloudSavings/CloudSavingsCloudTypes";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../Server/Utils/DataSource/HttpFetch";
import LlmProviderError from "../../../../Server/Utils/LlmObservability/LlmProviderError";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import {
  CloudSavingsActionKind,
  CloudSavingsTarget,
  readAzureSavingsTarget,
} from "../../../../Types/Cloud/CloudSavingsAction";
import { CloudConnectionAuthMethod } from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import {
  AZURE_SAVINGS_ACTIONS_CLEAN_UP_ACTIONS,
  AZURE_SAVINGS_ACTIONS_RESIZE_ACTIONS,
  CLOUD_SAVINGS_ACTION_TAG_KEY,
} from "../../../../Types/CloudConnection/CloudSavingsActionsAccess";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  FAKE_AZURE_CLIENT,
  FAKE_AZURE_TENANT,
  FakeAzureDisk,
  FakeAzureSavings,
  createFakeAzureSavings,
} from "./FakeAzureSavings";

/*
 * Acting on savings in Azure (#11010), against a fake Resource Manager
 * that answers as ARM does: a VM is deallocated - the stop Azure stops
 * billing for - and started again; an unattached disk is deleted only once
 * its final snapshot has succeeded, and made again from it; an idle public
 * IP is released only while nothing holds it; a VM is resized with a PATCH
 * of its size alone, and sized back. Each reads first and writes only
 * what is not so already. A refusal names the permission the role lacks
 * and the setting that grants it; a lock says so; a subscription the
 * connection does not read is never written.
 */

const SUB: string = "d0cfe6b2-9ac0-4464-9919-dccaee2e48c0";
const SUB_OTHER: string = "7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b";
const RG: string = "rg-web";
const ACTION_ID: string = "6a1f0c2e-8d1b-4e51-9a0b-3c4d5e6f7a8b";
const CONNECTION: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const VM_ID: string = `/subscriptions/${SUB}/resourceGroups/${RG}/providers/Microsoft.Compute/virtualMachines/web-01`;
const DISK_ID: string = `/subscriptions/${SUB}/resourceGroups/${RG}/providers/Microsoft.Compute/disks/old-data`;
const SNAPSHOT_ID: string = `/subscriptions/${SUB}/resourceGroups/${RG}/providers/Microsoft.Compute/snapshots/nightly-2024`;
const PUBLIC_IP_ID: string = `/subscriptions/${SUB}/resourceGroups/${RG}/providers/Microsoft.Network/publicIPAddresses/old-ip`;
// The final snapshot of old-data, named for the disk and the action.
const FINAL_SNAPSHOT_ID: string = `/subscriptions/${SUB}/resourceGroups/${RG}/providers/Microsoft.Compute/snapshots/oneuptime-final-old-data-6a1f0c2e`;

function settings(config: JSONObject = {}): CloudConnectionSettings {
  return {
    provider: CloudProvider.Azure,
    projectId: "11111111-1111-4111-8111-111111111111",
    config: {
      authMethod: CloudConnectionAuthMethod.AzureClientSecret,
      tenantId: FAKE_AZURE_TENANT,
      clientId: FAKE_AZURE_CLIENT,
      cloud: "public",
      subscriptionIds: SUB,
      ...config,
    },
    secrets: { clientSecret: "client-secret~value" },
  };
}

function context(
  fake: FakeAzureSavings,
  config: JSONObject = {},
): CloudSavingsStepContext {
  return {
    settings: settings(config),
    connectionId: CONNECTION,
    transport: fake.transport,
    sleep: async (): Promise<void> => {},
  };
}

function target(armId: string): CloudSavingsTarget {
  const read: CloudSavingsTarget | null = readAzureSavingsTarget(armId);

  if (!read) {
    throw new Error(`Not a target: ${armId}`);
  }

  return read;
}

function run(data: {
  kind: CloudSavingsActionKind;
  armId: string;
  to?: string;
  finalSnapshot?: boolean;
  progress?: CloudSavingsProgress;
}): CloudSavingsRun {
  return {
    actionId: ACTION_ID,
    kind: data.kind,
    target: target(data.armId),
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

const DISK: FakeAzureDisk = {
  id: DISK_ID,
  location: "westeurope",
  skuName: "Premium_LRS",
  zones: ["2"],
  tags: { Team: "search", CostCenter: "1234" },
  diskSizeGB: 512,
  diskState: "Unattached",
};

describe("deallocating an idle VM, and starting it again", () => {
  test("deallocates a running VM, reading its power state from its instance view", async () => {
    const fake: FakeAzureSavings = createFakeAzureSavings({
      vms: [{ id: VM_ID, vmSize: "Standard_D4s_v5", powerState: "running" }],
    });
    const outcome: CloudSavingsStepOutcome = await applyAzureSavingsAction(
      context(fake),
      run({ kind: CloudSavingsActionKind.StopInstance, armId: VM_ID }),
    );

    expect(outcome).toMatchObject({ state: "done", changed: true });
    expect(outcome.summary).toBe(
      "Deallocated VM web-01, so Azure no longer bills its compute. Its disks are kept, and it can be started again.",
    );
    expect(fake.writes()).toEqual([
      "Microsoft.Compute/virtualMachines/deallocate/action",
    ]);
    expect(fake.calls[0]).toMatchObject({
      method: "GET",
      path: VM_ID,
      apiVersion: "2024-03-01",
    });
    expect(fake.calls[1]).toMatchObject({
      method: "POST",
      path: `${VM_ID}/deallocate`,
      apiVersion: "2024-03-01",
    });
  });

  test("a VM stopped from inside is still billed, so it is deallocated and says so", async () => {
    const fake: FakeAzureSavings = createFakeAzureSavings({
      vms: [{ id: VM_ID, vmSize: "Standard_D4s_v5", powerState: "stopped" }],
    });
    const outcome: CloudSavingsStepOutcome = await applyAzureSavingsAction(
      context(fake),
      run({ kind: CloudSavingsActionKind.StopInstance, armId: VM_ID }),
    );

    expect(outcome.summary).toContain(
      "it was stopped but still allocated, which Azure still bills",
    );
    expect(fake.writes()).toEqual([
      "Microsoft.Compute/virtualMachines/deallocate/action",
    ]);
  });

  test("a VM already deallocated, or deallocating, is left alone", async () => {
    for (const powerState of ["deallocated", "deallocating"] as const) {
      const fake: FakeAzureSavings = createFakeAzureSavings({
        vms: [{ id: VM_ID, vmSize: "Standard_D4s_v5", powerState }],
      });
      const outcome: CloudSavingsStepOutcome = await applyAzureSavingsAction(
        context(fake),
        run({ kind: CloudSavingsActionKind.StopInstance, armId: VM_ID }),
      );

      expect(outcome).toMatchObject({ state: "done", changed: false });
      expect(fake.writes()).toEqual([]);
    }
  });

  test("a VM that is gone fails with why, and nothing is written", async () => {
    const fake: FakeAzureSavings = createFakeAzureSavings();

    await expect(
      applyAzureSavingsAction(
        context(fake),
        run({ kind: CloudSavingsActionKind.StopInstance, armId: VM_ID }),
      ),
    ).rejects.toThrow("VM web-01 was not found");
    expect(fake.writes()).toEqual([]);
  });

  test("undo starts it again, waiting while it still deallocates", async () => {
    const fake: FakeAzureSavings = createFakeAzureSavings({
      vms: [
        {
          id: VM_ID,
          vmSize: "Standard_D4s_v5",
          powerState: "deallocating",
          transitionReads: 2,
        },
      ],
    });
    const outcomes: Array<CloudSavingsStepOutcome> = await untilDone(
      (progress: CloudSavingsProgress) => {
        return undoAzureSavingsAction(context(fake), {
          ...run({
            kind: CloudSavingsActionKind.StopInstance,
            armId: VM_ID,
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
      summary: "Started VM web-01 again.",
    });
    expect(fake.writes()).toEqual([
      "Microsoft.Compute/virtualMachines/start/action",
    ]);
  });

  test("undo of a VM someone already started changes nothing", async () => {
    const fake: FakeAzureSavings = createFakeAzureSavings({
      vms: [{ id: VM_ID, vmSize: "Standard_D4s_v5", powerState: "running" }],
    });
    const outcome: CloudSavingsStepOutcome = await undoAzureSavingsAction(
      context(fake),
      {
        ...run({ kind: CloudSavingsActionKind.StopInstance, armId: VM_ID }),
        applied: {},
      },
    );

    expect(outcome.changed).toBe(false);
    expect(fake.writes()).toEqual([]);
  });
});

describe("deleting an unattached disk after a final snapshot", () => {
  test("snapshots it, waits for the snapshot to succeed, then deletes the disk", async () => {
    const fake: FakeAzureSavings = createFakeAzureSavings({ disks: [DISK] });
    const outcomes: Array<CloudSavingsStepOutcome> = await untilDone(
      (progress: CloudSavingsProgress) => {
        return applyAzureSavingsAction(
          context(fake),
          run({
            kind: CloudSavingsActionKind.DeleteVolume,
            armId: DISK_ID,
            finalSnapshot: true,
            progress,
          }),
        );
      },
    );
    const last: CloudSavingsStepOutcome = outcomes[outcomes.length - 1]!;

    expect(outcomes[0]).toMatchObject({ state: "waiting" });
    expect(outcomes[0]?.summary).toBe(
      "Taking a final snapshot of disk old-data (oneuptime-final-old-data-6a1f0c2e) before deleting it.",
    );
    expect(last).toMatchObject({ state: "done", changed: true });
    expect(last.summary).toBe(
      "Deleted disk old-data, after a final snapshot (oneuptime-final-old-data-6a1f0c2e) it can be made again from.",
    );
    expect(fake.writes()).toEqual([
      "Microsoft.Compute/snapshots/write",
      "Microsoft.Compute/disks/delete",
    ]);
    expect(fake.disks.size).toBe(0);

    // The snapshot: a copy of the disk, in its location, incremental, on standard HDD, tagged as OneUptime's.
    const put: JSONObject = fake.calls.find(
      (call: FakeAzureSavings["calls"][number]): boolean => {
        return call.method === "PUT";
      },
    )!.body!;
    expect(put).toEqual({
      location: "westeurope",
      sku: { name: "Standard_LRS" },
      tags: { [CLOUD_SAVINGS_ACTION_TAG_KEY]: ACTION_ID },
      properties: {
        creationData: { createOption: "Copy", sourceResourceId: DISK_ID },
        incremental: true,
      },
    });
    expect(last.progress.snapshotId).toBe(FINAL_SNAPSHOT_ID);
    expect(fake.snapshots.get(FINAL_SNAPSHOT_ID.toLowerCase())).toBeTruthy();

    // What the disk was, to make it again.
    expect(last.progress.disk).toEqual({
      location: "westeurope",
      skuName: "Premium_LRS",
      zones: ["2"],
      tags: { Team: "search", CostCenter: "1234" },
      diskSizeGB: 512,
    });
  });

  test("never deletes the disk while its snapshot is still being made", async () => {
    const fake: FakeAzureSavings = createFakeAzureSavings({ disks: [DISK] });
    let progress: CloudSavingsProgress = {};

    for (let index: number = 0; index < 2; index++) {
      progress = (
        await applyAzureSavingsAction(
          context(fake),
          run({
            kind: CloudSavingsActionKind.DeleteVolume,
            armId: DISK_ID,
            finalSnapshot: true,
            progress,
          }),
        )
      ).progress;
    }

    expect(fake.disks.has(DISK_ID.toLowerCase())).toBe(true);
    expect(fake.writes()).toEqual(["Microsoft.Compute/snapshots/write"]);
  });

  test("a snapshot that fails keeps the disk", async () => {
    const fake: FakeAzureSavings = createFakeAzureSavings({ disks: [DISK] });
    const first: CloudSavingsStepOutcome = await applyAzureSavingsAction(
      context(fake),
      run({
        kind: CloudSavingsActionKind.DeleteVolume,
        armId: DISK_ID,
        finalSnapshot: true,
      }),
    );

    fake.snapshots.get(FINAL_SNAPSHOT_ID.toLowerCase())!.provisioningState =
      "Failed";

    await expect(
      applyAzureSavingsAction(
        context(fake),
        run({
          kind: CloudSavingsActionKind.DeleteVolume,
          armId: DISK_ID,
          finalSnapshot: true,
          progress: first.progress,
        }),
      ),
    ).rejects.toThrow(
      "The final snapshot of disk old-data failed, so the disk was not deleted.",
    );
    expect(fake.disks.has(DISK_ID.toLowerCase())).toBe(true);
  });

  test("a disk attached to a VM since the saving was read is never deleted, nor snapshotted", async () => {
    const fake: FakeAzureSavings = createFakeAzureSavings({
      disks: [{ ...DISK, diskState: "Attached", managedBy: VM_ID }],
    });

    await expect(
      applyAzureSavingsAction(
        context(fake),
        run({
          kind: CloudSavingsActionKind.DeleteVolume,
          armId: DISK_ID,
          finalSnapshot: true,
        }),
      ),
    ).rejects.toThrow(
      "Disk old-data is attached to web-01 now, so it was not deleted.",
    );
    expect(fake.writes()).toEqual([]);
  });

  test("a disk being exported is never deleted", async () => {
    const fake: FakeAzureSavings = createFakeAzureSavings({
      disks: [{ ...DISK, diskState: "ActiveSAS" }],
    });

    await expect(
      applyAzureSavingsAction(
        context(fake),
        run({ kind: CloudSavingsActionKind.DeleteVolume, armId: DISK_ID }),
      ),
    ).rejects.toThrow("Disk old-data is ActiveSAS now, so it was not deleted.");
    expect(fake.writes()).toEqual([]);
  });

  test("with no final snapshot asked for, it is deleted at once", async () => {
    const fake: FakeAzureSavings = createFakeAzureSavings({ disks: [DISK] });
    const outcome: CloudSavingsStepOutcome = await applyAzureSavingsAction(
      context(fake),
      run({
        kind: CloudSavingsActionKind.DeleteVolume,
        armId: DISK_ID,
        finalSnapshot: false,
      }),
    );

    expect(outcome.summary).toBe(
      "Deleted disk old-data. No final snapshot was taken.",
    );
    expect(fake.writes()).toEqual(["Microsoft.Compute/disks/delete"]);
    expect(
      fake.calls.find((call: FakeAzureSavings["calls"][number]): boolean => {
        return call.method === "DELETE";
      })?.apiVersion,
    ).toBe("2023-04-02");
  });

  test("a disk already gone is not an error", async () => {
    const fake: FakeAzureSavings = createFakeAzureSavings();
    const outcome: CloudSavingsStepOutcome = await applyAzureSavingsAction(
      context(fake),
      run({
        kind: CloudSavingsActionKind.DeleteVolume,
        armId: DISK_ID,
        finalSnapshot: true,
      }),
    );

    expect(outcome).toMatchObject({ state: "done", changed: false });
    expect(fake.writes()).toEqual([]);
  });

  test("a disk a lock holds is said to be locked, in Azure's words", async () => {
    const fake: FakeAzureSavings = createFakeAzureSavings({
      disks: [DISK],
      lockedIds: [DISK_ID],
    });
    const failure: unknown = await failureOf(
      applyAzureSavingsAction(
        context(fake),
        run({ kind: CloudSavingsActionKind.DeleteVolume, armId: DISK_ID }),
      ),
    );

    expect(failure).toBeInstanceOf(LlmProviderError);
    expect((failure as Error).message).toContain(
      "Azure would not change disk old-data now - a lock on it, or an operation in progress: The scope",
    );
    expect((failure as Error).message).toContain("are locked");
    expect(fake.disks.has(DISK_ID.toLowerCase())).toBe(true);
  });

  test("undo makes it again from its snapshot - its name, location, zone, SKU and tags - once", async () => {
    const fake: FakeAzureSavings = createFakeAzureSavings({ disks: [DISK] });
    const applied: Array<CloudSavingsStepOutcome> = await untilDone(
      (progress: CloudSavingsProgress) => {
        return applyAzureSavingsAction(
          context(fake),
          run({
            kind: CloudSavingsActionKind.DeleteVolume,
            armId: DISK_ID,
            finalSnapshot: true,
            progress,
          }),
        );
      },
    );
    const appliedProgress: CloudSavingsProgress =
      applied[applied.length - 1]!.progress;

    const undo: CloudSavingsStepOutcome = await undoAzureSavingsAction(
      context(fake),
      {
        ...run({ kind: CloudSavingsActionKind.DeleteVolume, armId: DISK_ID }),
        applied: appliedProgress,
      },
    );

    expect(undo).toMatchObject({ state: "done", changed: true });
    expect(undo.summary).toBe(
      "Made disk old-data again from its final snapshot oneuptime-final-old-data-6a1f0c2e, in westeurope. Attach it where it was used.",
    );
    expect(undo.progress.restoredId).toBe(DISK_ID);

    const restored: FakeAzureDisk = fake.disks.get(DISK_ID.toLowerCase())!;
    expect(restored).toMatchObject({
      location: "westeurope",
      skuName: "Premium_LRS",
      zones: ["2"],
      sourceResourceId: FINAL_SNAPSHOT_ID,
      tags: {
        Team: "search",
        CostCenter: "1234",
        [CLOUD_SAVINGS_ACTION_TAG_KEY]: ACTION_ID,
      },
    });

    // Sent again (its answer lost), the same PUT makes no second disk.
    await undoAzureSavingsAction(context(fake), {
      ...run({ kind: CloudSavingsActionKind.DeleteVolume, armId: DISK_ID }),
      applied: appliedProgress,
    });
    expect(fake.disks.size).toBe(1);

    // And an undo that knows it is done does nothing.
    const again: CloudSavingsStepOutcome = await undoAzureSavingsAction(
      context(fake),
      {
        ...run({
          kind: CloudSavingsActionKind.DeleteVolume,
          armId: DISK_ID,
          progress: undo.progress,
        }),
        applied: appliedProgress,
      },
    );
    expect(again.changed).toBe(false);
  });

  test("a disk deleted with no snapshot cannot be undone, and says why", async () => {
    await expect(
      undoAzureSavingsAction(context(createFakeAzureSavings()), {
        ...run({ kind: CloudSavingsActionKind.DeleteVolume, armId: DISK_ID }),
        applied: {},
      }),
    ).rejects.toThrow("No final snapshot was taken");
  });
});

describe("deleting a snapshot and releasing a public IP", () => {
  test("deletes an old snapshot", async () => {
    const fake: FakeAzureSavings = createFakeAzureSavings({
      snapshots: [
        {
          id: SNAPSHOT_ID,
          location: "westeurope",
          sourceResourceId: DISK_ID,
          provisioningState: "Succeeded",
        },
      ],
    });
    const outcome: CloudSavingsStepOutcome = await applyAzureSavingsAction(
      context(fake),
      run({ kind: CloudSavingsActionKind.DeleteSnapshot, armId: SNAPSHOT_ID }),
    );

    expect(outcome.summary).toBe("Deleted snapshot nightly-2024.");
    expect(fake.writes()).toEqual(["Microsoft.Compute/snapshots/delete"]);
    expect(fake.snapshots.size).toBe(0);
  });

  test("a snapshot already gone is not an error", async () => {
    const fake: FakeAzureSavings = createFakeAzureSavings();
    const outcome: CloudSavingsStepOutcome = await applyAzureSavingsAction(
      context(fake),
      run({ kind: CloudSavingsActionKind.DeleteSnapshot, armId: SNAPSHOT_ID }),
    );

    expect(outcome.changed).toBe(false);
    expect(fake.writes()).toEqual([]);
  });

  test("releases an idle public IP, and says its address cannot be had again", async () => {
    const fake: FakeAzureSavings = createFakeAzureSavings({
      publicIps: [{ id: PUBLIC_IP_ID, ipAddress: "20.50.1.8" }],
    });
    const outcome: CloudSavingsStepOutcome = await applyAzureSavingsAction(
      context(fake),
      run({ kind: CloudSavingsActionKind.ReleaseAddress, armId: PUBLIC_IP_ID }),
    );

    expect(outcome.summary).toBe(
      "Released public IP old-ip (20.50.1.8): its address goes back to Azure and cannot be had again.",
    );
    expect(fake.writes()).toEqual([
      "Microsoft.Network/publicIPAddresses/delete",
    ]);
    expect(fake.calls[0]?.apiVersion).toBe("2023-09-01");
  });

  test("a public IP a network interface holds is never released, and names what holds it", async () => {
    const fake: FakeAzureSavings = createFakeAzureSavings({
      publicIps: [
        {
          id: PUBLIC_IP_ID,
          ipAddress: "20.50.1.8",
          ipConfigurationId: `/subscriptions/${SUB}/resourceGroups/${RG}/providers/Microsoft.Network/networkInterfaces/web-nic/ipConfigurations/ipconfig1`,
        },
      ],
    });

    await expect(
      applyAzureSavingsAction(
        context(fake),
        run({
          kind: CloudSavingsActionKind.ReleaseAddress,
          armId: PUBLIC_IP_ID,
        }),
      ),
    ).rejects.toThrow(
      "Public IP old-ip (20.50.1.8) is associated with web-nic now, so it was not released.",
    );
    expect(fake.writes()).toEqual([]);
  });

  test("a public IP a NAT gateway holds is never released", async () => {
    const fake: FakeAzureSavings = createFakeAzureSavings({
      publicIps: [
        {
          id: PUBLIC_IP_ID,
          ipAddress: "20.50.1.8",
          natGatewayId: `/subscriptions/${SUB}/resourceGroups/${RG}/providers/Microsoft.Network/natGateways/egress`,
        },
      ],
    });

    await expect(
      applyAzureSavingsAction(
        context(fake),
        run({
          kind: CloudSavingsActionKind.ReleaseAddress,
          armId: PUBLIC_IP_ID,
        }),
      ),
    ).rejects.toThrow("is associated with egress now");
    expect(fake.writes()).toEqual([]);
  });

  test("neither can be undone, and each says why", async () => {
    for (const [kind, armId] of [
      [CloudSavingsActionKind.ReleaseAddress, PUBLIC_IP_ID],
      [CloudSavingsActionKind.DeleteSnapshot, SNAPSHOT_ID],
    ] as Array<[CloudSavingsActionKind, string]>) {
      const fake: FakeAzureSavings = createFakeAzureSavings();

      await expect(
        undoAzureSavingsAction(context(fake), {
          ...run({ kind, armId }),
          applied: {},
        }),
      ).rejects.toThrow("cannot be undone");
      expect(fake.calls).toEqual([]);
    }
  });
});

describe("resizing a VM", () => {
  test("PATCHes its size alone, and keeps the size it was", async () => {
    const fake: FakeAzureSavings = createFakeAzureSavings({
      vms: [{ id: VM_ID, vmSize: "Standard_D8s_v5", powerState: "running" }],
    });
    const outcome: CloudSavingsStepOutcome = await applyAzureSavingsAction(
      context(fake),
      run({
        kind: CloudSavingsActionKind.ResizeInstance,
        armId: VM_ID,
        to: "Standard_D4s_v5",
      }),
    );

    expect(outcome).toMatchObject({ state: "done", changed: true });
    expect(outcome.summary).toBe(
      "Resized VM web-01 from Standard_D8s_v5 to Standard_D4s_v5. Azure restarts it to do so.",
    );
    expect(outcome.progress.previous).toBe("Standard_D8s_v5");
    expect(fake.writes()).toEqual(["Microsoft.Compute/virtualMachines/write"]);
    expect(
      fake.calls.find((call: FakeAzureSavings["calls"][number]): boolean => {
        return call.method === "PATCH";
      })?.body,
    ).toEqual({
      properties: { hardwareProfile: { vmSize: "Standard_D4s_v5" } },
    });
    expect(fake.vms.get(VM_ID.toLowerCase())?.vmSize).toBe("Standard_D4s_v5");
  });

  test("a VM already that size is left alone", async () => {
    const fake: FakeAzureSavings = createFakeAzureSavings({
      vms: [{ id: VM_ID, vmSize: "Standard_D4s_v5", powerState: "running" }],
    });
    const outcome: CloudSavingsStepOutcome = await applyAzureSavingsAction(
      context(fake),
      run({
        kind: CloudSavingsActionKind.ResizeInstance,
        armId: VM_ID,
        to: "standard_d4s_v5",
      }),
    );

    expect(outcome.changed).toBe(false);
    expect(fake.writes()).toEqual([]);
  });

  test("a size Azure will not give where the VM runs is said in Azure's words, the VM left as it was", async () => {
    const fake: FakeAzureSavings = createFakeAzureSavings({
      vms: [
        {
          id: VM_ID,
          vmSize: "Standard_D8s_v5",
          powerState: "running",
          refusedSizes: ["Standard_E4s_v5"],
        },
      ],
    });
    const failure: unknown = await failureOf(
      applyAzureSavingsAction(
        context(fake),
        run({
          kind: CloudSavingsActionKind.ResizeInstance,
          armId: VM_ID,
          to: "Standard_E4s_v5",
        }),
      ),
    );

    expect(failure).toBeInstanceOf(BadDataException);
    expect((failure as Error).message).toBe(
      "Azure would not make VM web-01 a Standard_E4s_v5, so it was left a Standard_D8s_v5. The requested VM size Standard_E4s_v5 is not available in the current region. The sizes available in the current region are: Standard_B2s,Standard_D2s_v5.",
    );
    expect(fake.vms.get(VM_ID.toLowerCase())?.vmSize).toBe("Standard_D8s_v5");
  });

  test("undo sizes it back", async () => {
    const fake: FakeAzureSavings = createFakeAzureSavings({
      vms: [{ id: VM_ID, vmSize: "Standard_D4s_v5", powerState: "running" }],
    });
    const outcome: CloudSavingsStepOutcome = await undoAzureSavingsAction(
      context(fake),
      {
        ...run({
          kind: CloudSavingsActionKind.ResizeInstance,
          armId: VM_ID,
          to: "Standard_D4s_v5",
        }),
        applied: { previous: "Standard_D8s_v5", step: "done" },
      },
    );

    expect(outcome.summary).toBe(
      "Resized VM web-01 from Standard_D4s_v5 to Standard_D8s_v5. Azure restarts it to do so.",
    );
    expect(fake.vms.get(VM_ID.toLowerCase())?.vmSize).toBe("Standard_D8s_v5");
  });

  test("an undo that does not know the size it was says so before anything is sent", async () => {
    const fake: FakeAzureSavings = createFakeAzureSavings({
      vms: [{ id: VM_ID, vmSize: "Standard_D4s_v5", powerState: "running" }],
    });

    await expect(
      undoAzureSavingsAction(context(fake), {
        ...run({ kind: CloudSavingsActionKind.ResizeInstance, armId: VM_ID }),
        applied: {},
      }),
    ).rejects.toThrow("what the VM's size was");
    expect(fake.calls).toEqual([]);
  });

  test("a VM a lock holds is not resized, and the lock is what is said", async () => {
    const fake: FakeAzureSavings = createFakeAzureSavings({
      vms: [{ id: VM_ID, vmSize: "Standard_D8s_v5", powerState: "running" }],
      lockedIds: [VM_ID],
    });
    const failure: unknown = await failureOf(
      applyAzureSavingsAction(
        context(fake),
        run({
          kind: CloudSavingsActionKind.ResizeInstance,
          armId: VM_ID,
          to: "Standard_D4s_v5",
        }),
      ),
    );

    expect(failure).toBeInstanceOf(LlmProviderError);
    expect((failure as Error).message).toContain(
      "Azure would not change VM web-01 now - a lock on it, or an operation in progress",
    );
    expect(fake.vms.get(VM_ID.toLowerCase())?.vmSize).toBe("Standard_D8s_v5");
  });
});

describe("refusals", () => {
  test("a call the role was not granted names the permission, and the setting that grants it", async () => {
    const fake: FakeAzureSavings = createFakeAzureSavings({
      vms: [{ id: VM_ID, vmSize: "Standard_D4s_v5", powerState: "running" }],
      allowedActions: ["Microsoft.Compute/virtualMachines/read"],
    });
    const failure: unknown = await failureOf(
      applyAzureSavingsAction(
        context(fake),
        run({ kind: CloudSavingsActionKind.StopInstance, armId: VM_ID }),
      ),
    );

    expect(failure).toBeInstanceOf(LlmProviderError);
    expect((failure as LlmProviderError).kind).toBe(
      CloudConnectionFailureKind.Permission,
    );
    expect((failure as Error).message).toBe(
      "Azure refused Microsoft.Compute/virtualMachines/deallocate/action on VM web-01: the app may not do it. Set the connection's Savings actions to on, and run its setup command again.",
    );
    expect(fake.vms.get(VM_ID.toLowerCase())?.powerState).toBe("running");
  });

  test("a refused read is said too, and nothing is written", async () => {
    const fake: FakeAzureSavings = createFakeAzureSavings({
      disks: [DISK],
      allowedActions: [],
    });

    await expect(
      applyAzureSavingsAction(
        context(fake),
        run({ kind: CloudSavingsActionKind.DeleteVolume, armId: DISK_ID }),
      ),
    ).rejects.toThrow(
      "Azure refused Microsoft.Compute/disks/read on disk old-data",
    );
    expect(fake.writes()).toEqual([]);
  });

  test("a resize refused says to pick the choice that resizes", async () => {
    const fake: FakeAzureSavings = createFakeAzureSavings({
      vms: [{ id: VM_ID, vmSize: "Standard_D8s_v5", powerState: "running" }],
      allowedActions: [...AZURE_SAVINGS_ACTIONS_CLEAN_UP_ACTIONS],
    });

    await expect(
      applyAzureSavingsAction(
        context(fake),
        run({
          kind: CloudSavingsActionKind.ResizeInstance,
          armId: VM_ID,
          to: "Standard_D4s_v5",
        }),
      ),
    ).rejects.toThrow(
      'Azure refused Microsoft.Compute/virtualMachines/write on VM web-01: the app may not do it. Set the connection\'s Savings actions to "Stop, start, clean up and resize", and run its setup command again.',
    );
  });

  test("the clean-up grant is enough for every clean-up change and its undo; resize adds only the resize", async () => {
    const fake: FakeAzureSavings = createFakeAzureSavings({
      vms: [{ id: VM_ID, vmSize: "Standard_D8s_v5", powerState: "running" }],
      disks: [DISK],
      snapshots: [
        {
          id: SNAPSHOT_ID,
          location: "westeurope",
          sourceResourceId: DISK_ID,
          provisioningState: "Succeeded",
        },
      ],
      publicIps: [{ id: PUBLIC_IP_ID, ipAddress: "20.50.1.8" }],
      allowedActions: [...AZURE_SAVINGS_ACTIONS_CLEAN_UP_ACTIONS],
    });

    await applyAzureSavingsAction(
      context(fake),
      run({ kind: CloudSavingsActionKind.StopInstance, armId: VM_ID }),
    );
    await untilDone((progress: CloudSavingsProgress) => {
      return undoAzureSavingsAction(context(fake), {
        ...run({
          kind: CloudSavingsActionKind.StopInstance,
          armId: VM_ID,
          progress,
        }),
        applied: {},
      });
    });
    const deleted: Array<CloudSavingsStepOutcome> = await untilDone(
      (progress: CloudSavingsProgress) => {
        return applyAzureSavingsAction(
          context(fake),
          run({
            kind: CloudSavingsActionKind.DeleteVolume,
            armId: DISK_ID,
            finalSnapshot: true,
            progress,
          }),
        );
      },
    );
    await undoAzureSavingsAction(context(fake), {
      ...run({ kind: CloudSavingsActionKind.DeleteVolume, armId: DISK_ID }),
      applied: deleted[deleted.length - 1]!.progress,
    });
    await applyAzureSavingsAction(
      context(fake),
      run({ kind: CloudSavingsActionKind.DeleteSnapshot, armId: SNAPSHOT_ID }),
    );
    await applyAzureSavingsAction(
      context(fake),
      run({ kind: CloudSavingsActionKind.ReleaseAddress, armId: PUBLIC_IP_ID }),
    );

    expect(fake.writes()).toEqual([
      "Microsoft.Compute/virtualMachines/deallocate/action",
      "Microsoft.Compute/virtualMachines/start/action",
      "Microsoft.Compute/snapshots/write",
      "Microsoft.Compute/disks/delete",
      "Microsoft.Compute/disks/write",
      "Microsoft.Compute/snapshots/delete",
      "Microsoft.Network/publicIPAddresses/delete",
    ]);
    // Every call made, reads included, is one the grant holds.
    for (const call of fake.calls) {
      expect(AZURE_SAVINGS_ACTIONS_CLEAN_UP_ACTIONS).toContain(call.action);
    }

    expect(AZURE_SAVINGS_ACTIONS_RESIZE_ACTIONS).toEqual([
      "Microsoft.Compute/virtualMachines/write",
    ]);
  });

  test("a resource in a subscription the connection does not read is never touched, nor signed in for", async () => {
    const outside: string = VM_ID.split(SUB).join(SUB_OTHER);
    const fake: FakeAzureSavings = createFakeAzureSavings({
      vms: [{ id: outside, vmSize: "Standard_D4s_v5", powerState: "running" }],
    });

    await expect(
      applyAzureSavingsAction(
        context(fake),
        run({ kind: CloudSavingsActionKind.StopInstance, armId: outside }),
      ),
    ).rejects.toThrow(
      `VM web-01 is in subscription ${SUB_OTHER}, which this connection does not read.`,
    );
    expect(fake.calls).toEqual([]);
    expect(fake.signIns()).toBe(0);
  });

  test("a connection that names no subscriptions reads, and changes, any of the tenant's", async () => {
    const outside: string = VM_ID.split(SUB).join(SUB_OTHER);
    const fake: FakeAzureSavings = createFakeAzureSavings({
      vms: [{ id: outside, vmSize: "Standard_D4s_v5", powerState: "running" }],
    });
    const outcome: CloudSavingsStepOutcome = await applyAzureSavingsAction(
      context(fake, { subscriptionIds: "" }),
      run({ kind: CloudSavingsActionKind.StopInstance, armId: outside }),
    );

    expect(outcome.changed).toBe(true);
  });

  test("an expired client secret says to run the setup command again", async () => {
    const fake: FakeAzureSavings = createFakeAzureSavings({
      vms: [{ id: VM_ID, vmSize: "Standard_D4s_v5", powerState: "running" }],
    });
    const failure: unknown = await failureOf(
      applyAzureSavingsAction(
        {
          ...context(fake),
          transport: async (
            request: DataSourceHttpRequest,
          ): Promise<DataSourceHttpResponse> => {
            if (new URL(request.url).host === "login.microsoftonline.com") {
              throw new BadDataException(
                'Data source responded with HTTP 401: {"error":"invalid_client","error_description":"AADSTS7000222: The provided client secret keys for app are expired."}',
              );
            }

            return await fake.transport(request);
          },
        },
        run({ kind: CloudSavingsActionKind.StopInstance, armId: VM_ID }),
      ),
    );

    expect((failure as LlmProviderError).kind).toBe(
      CloudConnectionFailureKind.Authentication,
    );
    expect((failure as Error).message).toBe(
      "The app's client secret has expired. Run the setup command again and paste what it prints.",
    );
    expect(fake.writes()).toEqual([]);
  });

  test("a change of a kind Azure savings do not make is refused before anything is sent", async () => {
    for (const kind of [
      CloudSavingsActionKind.StopDatabase,
      CloudSavingsActionKind.ResizeDatabase,
      CloudSavingsActionKind.ChangeVolumeType,
      CloudSavingsActionKind.DeleteImage,
    ]) {
      const fake: FakeAzureSavings = createFakeAzureSavings();

      await expect(
        applyAzureSavingsAction(
          context(fake),
          run({ kind, armId: VM_ID, to: "x" }),
        ),
      ).rejects.toThrow(
        "OneUptime does not make a change of this kind in Azure",
      );
      expect(fake.calls).toEqual([]);
    }
  });

  test("a change made to the wrong kind of resource is refused before anything is sent", async () => {
    const fake: FakeAzureSavings = createFakeAzureSavings({ disks: [DISK] });

    await expect(
      applyAzureSavingsAction(
        context(fake),
        run({ kind: CloudSavingsActionKind.StopInstance, armId: DISK_ID }),
      ),
    ).rejects.toThrow(
      "OneUptime does not make a change of this kind to disk old-data: StopInstance.",
    );
    expect(fake.calls).toEqual([]);
  });

  test("a resize with nothing to resize to is refused before anything is sent", async () => {
    const fake: FakeAzureSavings = createFakeAzureSavings();

    await expect(
      applyAzureSavingsAction(
        context(fake),
        run({ kind: CloudSavingsActionKind.ResizeInstance, armId: VM_ID }),
      ),
    ).rejects.toThrow("which size to resize to");
    expect(fake.calls).toEqual([]);
  });

  test("a target with no ARM id is refused before anything is sent", async () => {
    const fake: FakeAzureSavings = createFakeAzureSavings();

    await expect(
      applyAzureSavingsAction(context(fake), {
        ...run({ kind: CloudSavingsActionKind.StopInstance, armId: VM_ID }),
        target: { ...target(VM_ID), armId: undefined },
      }),
    ).rejects.toThrow("is not an Azure resource OneUptime can change");
    expect(fake.calls).toEqual([]);
  });
});
