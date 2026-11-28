import {
  NonHostTelemetryHostFacts,
  NonHostTelemetryRepair,
  NonHostTelemetryRepairVerdict,
  NonHostTelemetrySource,
  getNonHostTelemetryArchiveFeedMarkdown,
  getNonHostTelemetryRepair,
} from "../../../../Server/Utils/Host/NonHostTelemetryHostRepair";
import { describe, expect, test } from "@jest/globals";

/*
 * Which Hosts an earlier release registered from telemetry that is not a
 * host's own are archived by the upgrade (issue #11257), from each row's own
 * facts. A row a person or a machine vouches for is never archived.
 */

function verdictOf(
  facts: Partial<NonHostTelemetryHostFacts>,
): NonHostTelemetryRepairVerdict {
  return getNonHostTelemetryRepair({
    hasContainerHostOfSameName: false,
    ...facts,
  });
}

const ARCHIVE_AS = (
  source: NonHostTelemetrySource,
): NonHostTelemetryRepairVerdict => {
  return { repair: NonHostTelemetryRepair.Archive, source: source };
};

const KEEP: NonHostTelemetryRepairVerdict = {
  repair: NonHostTelemetryRepair.Keep,
};

describe("getNonHostTelemetryRepair", () => {
  test("a Docker host registered as a Host - the runtime its agent wrote - is archived", () => {
    expect(verdictOf({ containerRuntime: "docker" })).toEqual(
      ARCHIVE_AS(NonHostTelemetrySource.ContainerEngine),
    );
    expect(verdictOf({ containerRuntime: "podman" })).toEqual(
      ARCHIVE_AS(NonHostTelemetrySource.ContainerEngine),
    );
    expect(verdictOf({ dockerHostId: "6f1c0b7e" })).toEqual(
      ARCHIVE_AS(NonHostTelemetrySource.ContainerEngine),
    );
  });

  test("a Host with a Docker or Podman host of its name, and nothing else, is archived", () => {
    expect(verdictOf({ hasContainerHostOfSameName: true })).toEqual(
      ARCHIVE_AS(NonHostTelemetrySource.ContainerEngine),
    );
  });

  test("a Host registered from an app in a pod - its runtime is an application's - is archived", () => {
    expect(verdictOf({ runtimeName: "nodejs" })).toEqual(
      ARCHIVE_AS(NonHostTelemetrySource.Application),
    );
  });

  test("a Kubernetes node or pod registered as a Host is archived, host metrics or not", () => {
    expect(verdictOf({ kubernetesClusterId: "c1" })).toEqual(
      ARCHIVE_AS(NonHostTelemetrySource.Kubernetes),
    );
    expect(
      verdictOf({
        kubernetesClusterId: "c1",
        readingsUpdatedAt: new Date(),
        cpuCores: 8,
      }),
    ).toEqual(ARCHIVE_AS(NonHostTelemetrySource.Kubernetes));
  });

  test("a Host a person made, or whose collector OneUptime manages, is kept whatever else", () => {
    const wrong: Partial<NonHostTelemetryHostFacts> = {
      containerRuntime: "docker",
      kubernetesClusterId: "c1",
      runtimeName: "nodejs",
      hasContainerHostOfSameName: true,
    };

    expect(verdictOf({ ...wrong, createdByUserId: "u1" })).toEqual(KEEP);
    expect(verdictOf({ ...wrong, collectorInstanceUid: "uid-1" })).toEqual(
      KEEP,
    );
    expect(
      verdictOf({ ...wrong, collectorRegisteredAt: new Date() }),
    ).toEqual(KEEP);
  });

  test("a Host that reported host metrics is kept: it may be a real machine an app also named", () => {
    for (const metrics of [
      { readingsUpdatedAt: new Date() },
      { cpuCores: 4 },
      { totalMemoryBytes: 8 * 1024 * 1024 * 1024 },
      { processCount: 212 },
      { cpuCores: 0 },
    ] as Array<Partial<NonHostTelemetryHostFacts>>) {
      expect(
        verdictOf({
          ...metrics,
          containerRuntime: "docker",
          runtimeName: "nodejs",
          hasContainerHostOfSameName: true,
        }),
      ).toEqual(KEEP);
    }
  });

  test("a Host with nothing that says what it was is kept: an OS and logs make a host", () => {
    expect(verdictOf({})).toEqual(KEEP);
    expect(
      verdictOf({ containerRuntime: "  ", runtimeName: "", dockerHostId: null }),
    ).toEqual(KEEP);
  });
});

describe("getNonHostTelemetryArchiveFeedMarkdown", () => {
  test("each archived host's feed says why and how to bring it back", () => {
    for (const source of Object.values(NonHostTelemetrySource)) {
      const markdown: string = getNonHostTelemetryArchiveFeedMarkdown(source);

      expect(markdown).toContain("Archived by the upgrade");
      expect(markdown).toContain("Unarchive it to bring it back.");
    }

    expect(
      getNonHostTelemetryArchiveFeedMarkdown(
        NonHostTelemetrySource.ContainerEngine,
      ),
    ).toContain("Docker or Podman");
    expect(
      getNonHostTelemetryArchiveFeedMarkdown(NonHostTelemetrySource.Kubernetes),
    ).toContain("Kubernetes");
    expect(
      getNonHostTelemetryArchiveFeedMarkdown(
        NonHostTelemetrySource.Application,
      ),
    ).toContain("pod's name");
  });
});
