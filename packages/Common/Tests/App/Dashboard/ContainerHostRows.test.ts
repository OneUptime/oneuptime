import { describe, expect, test } from "@jest/globals";
import {
  ContainerHostContainer,
  getContainerHostAttentionItems,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ContainerHost/ContainerHostHealth";
import {
  ContainerHostRow,
  getContainerCpuTone,
  getContainerHostRow,
  getContainerHostRows,
  getContainerMemoryTone,
  getContainerRestartsTone,
  getContainerStatusRank,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ContainerHost/ContainerHostRows";

/*
 * A Docker or Podman host's Containers list, row by row
 * (Components/ContainerHost/ContainerHostRows): each container's state by
 * the host's rules with why, its readings toned at its alerts' lines, its
 * restarts and when its run started - and a container that stopped has no
 * readings that say what it uses now.
 */

const NOW: Date = new Date("2026-11-03T12:00:00.000Z");

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60 * 1000);
}

function container(
  overrides: Partial<ContainerHostContainer> = {},
): ContainerHostContainer {
  return {
    name: "api",
    containerId: "abc",
    image: "acme/api:2",
    cpuPercent: 10,
    memoryBytes: 1024,
    memoryPercent: 20,
    networkRxBytes: 100,
    networkTxBytes: 200,
    restarts: 0,
    startedAt: minutesAgo(90),
    lastReadingAt: NOW,
    labels: {
      "com.docker.compose.project": "shop",
      "com.docker.compose.service": "api",
    },
    ...overrides,
  };
}

describe("a row's cells", () => {
  test("a running container: its readings, Compose names, restarts and start", () => {
    const row: ContainerHostRow = getContainerHostRow(container(), NOW);
    expect(row).toEqual(
      expect.objectContaining({
        containerName: "api",
        containerImage: "acme/api:2",
        composeProject: "shop",
        composeService: "api",
        cpuPercent: 10,
        memoryUsage: 1024,
        memoryPercent: 20,
        networkRx: 100,
        networkTx: 200,
        restarts: 0,
        startedAtMs: minutesAgo(90).getTime(),
        state: "running",
        cpuTone: undefined,
        memoryTone: undefined,
        restartsTone: undefined,
      }),
    );
    expect(row.status).toEqual({
      status: "Running",
      statusTone: "positive",
      statusText: { text: "Running" },
      statusReasons: [],
    });
  });

  test("a container that stopped reporting has no readings now and no current run", () => {
    const row: ContainerHostRow = getContainerHostRow(
      container({ lastReadingAt: minutesAgo(6), memoryPercent: 99 }),
      NOW,
    );
    expect(row.state).toBe("stopped");
    expect(row.cpuPercent).toBeNull();
    expect(row.memoryUsage).toBeNull();
    expect(row.memoryPercent).toBeNull();
    expect(row.networkRx).toBeNull();
    expect(row.networkTx).toBeNull();
    expect(row.startedAtMs).toBeNull();
    // Its full memory was minutes ago: never amber now.
    expect(row.memoryTone).toBeUndefined();
    expect(row.status.status).toBe("Stopped reporting");
    expect(row.status.statusTone).toBe("warning");
  });

  test("a restart loop keeps its readings: it runs between its crashes", () => {
    const row: ContainerHostRow = getContainerHostRow(
      container({ restarts: 5, cpuPercent: 95 }),
      NOW,
    );
    expect(row.state).toBe("restart-loop");
    expect(row.cpuPercent).toBe(95);
    expect(row.cpuTone).toBe("warning");
    expect(row.restartsTone).toBe("danger");
    expect(row.status.statusTone).toBe("danger");
    expect(row.status.statusReasons[0]?.text).toBe(
      "{{count}} restarts in 15 minutes",
    );
  });

  test("an agent without restart counts leaves the column missing, never 0", () => {
    expect(
      getContainerHostRow(container({ restarts: null }), NOW).restarts,
    ).toBeNull();
    expect(
      getContainerHostRow(container({ restarts: 2.4 }), NOW).restarts,
    ).toBe(2);
  });

  test("a container outside Compose has no project or service", () => {
    const row: ContainerHostRow = getContainerHostRow(
      container({ labels: null }),
      NOW,
    );
    expect(row.composeProject).toBe("");
    expect(row.composeService).toBe("");
  });
});

describe("tones at the alerts' lines", () => {
  test("CPU turns amber past 80%, never red", () => {
    expect(getContainerCpuTone(80)).toBeUndefined();
    expect(getContainerCpuTone(80.1)).toBe("warning");
    expect(getContainerCpuTone(400)).toBe("warning");
    expect(getContainerCpuTone(null)).toBeUndefined();
  });

  test("memory turns amber past 85%", () => {
    expect(getContainerMemoryTone(85)).toBeUndefined();
    expect(getContainerMemoryTone(85.1)).toBe("warning");
    expect(getContainerMemoryTone(null)).toBeUndefined();
  });

  test("restarts: amber from 1, red past 3", () => {
    expect(getContainerRestartsTone(0)).toBeUndefined();
    expect(getContainerRestartsTone(null)).toBeUndefined();
    expect(getContainerRestartsTone(1)).toBe("warning");
    expect(getContainerRestartsTone(3)).toBe("warning");
    expect(getContainerRestartsTone(4)).toBe("danger");
  });
});

describe("the Status column's order", () => {
  test("a restart loop, a stopped service, one that needs a look, fine, then a finished job", () => {
    const rows: Array<ContainerHostRow> = getContainerHostRows({
      containers: [
        container({ name: "fine" }),
        container({
          name: "job",
          lastReadingAt: minutesAgo(5),
          startedAt: minutesAgo(6),
        }),
        container({ name: "looping", restarts: 9 }),
        container({ name: "hungry", memoryPercent: 90 }),
        container({
          name: "stopped",
          lastReadingAt: minutesAgo(5),
          startedAt: minutesAgo(60),
        }),
      ],
      hostLatestReadingAt: NOW,
    });

    const ranked: Array<string> = [...rows]
      .sort((a: ContainerHostRow, b: ContainerHostRow): number => {
        return a.statusRank - b.statusRank;
      })
      .map((row: ContainerHostRow): string => {
        return row.containerName;
      });
    expect(ranked).toEqual(["looping", "stopped", "hungry", "fine", "job"]);
  });

  test("a job that restarted on its way out ranks with what needs a look", () => {
    expect(
      getContainerStatusRank({ state: "not-reporting", severity: null }),
    ).toBe(4);
    expect(
      getContainerStatusRank({
        state: "not-reporting",
        severity: getContainerHostAttentionItems({
          containers: [
            container({
              lastReadingAt: minutesAgo(5),
              startedAt: minutesAgo(6),
              restarts: 1,
            }),
          ],
          hostLatestReadingAt: NOW,
        })[0]!.severity,
      }),
    ).toBe(2);
  });

  test("the rows keep the readings' order", () => {
    expect(
      getContainerHostRows({
        containers: [container({ name: "a" }), container({ name: "b" })],
        hostLatestReadingAt: NOW,
      }).map((row: ContainerHostRow): string => {
        return row.containerName;
      }),
    ).toEqual(["a", "b"]);
  });
});
