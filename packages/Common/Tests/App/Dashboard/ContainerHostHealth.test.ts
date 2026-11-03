import { describe, expect, test } from "@jest/globals";
import Route from "../../../Types/API/Route";
import IconProp from "../../../Types/Icon/IconProp";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import ObjectID from "../../../Types/ObjectID";
import {
  DockerAlertTemplate,
  getDockerAlertTemplateById,
} from "../../../Types/Monitor/DockerAlertTemplates";
import {
  PodmanAlertTemplate,
  getPodmanAlertTemplateById,
} from "../../../Types/Monitor/PodmanAlertTemplates";
import {
  CONTAINER_CPU_WARNING_PERCENT,
  CONTAINER_FORGOTTEN_AFTER_MINUTES,
  CONTAINER_KIND,
  CONTAINER_LONG_RUNNING_MS,
  CONTAINER_MEMORY_WARNING_PERCENT,
  CONTAINER_NOT_REPORTING_MS,
  CONTAINER_RESTART_LOOP_RESTARTS,
  CONTAINER_RESTART_WINDOW_MINUTES,
  CONTAINER_STATUS_NOT_REPORTING,
  CONTAINER_STATUS_RESTART_LOOP,
  CONTAINER_STATUS_RUNNING,
  CONTAINER_STATUS_STOPPED,
  ContainerHostAssessment,
  ContainerHostContainer,
  THIS_CONTAINER_LABEL,
  assessContainer,
  formatContainerReasonPercent,
  getContainerAttentionKey,
  getContainerComposeProject,
  getContainerComposeService,
  getContainerHostAttentionItems,
  getContainerHostHealth,
  getContainerHostLatestReadingAt,
  getContainerRestarts,
  isContainerIssueAbout,
  isContainerLongRunning,
  isContainerNotReporting,
  isContainerOneOff,
  readContainerLabel,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ContainerHost/ContainerHostHealth";
import {
  DOCKER_CONTAINER_HOST_RUNTIME,
  PODMAN_CONTAINER_HOST_RUNTIME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ContainerHost/ContainerHostRuntime";
import {
  ResourceAttentionItem,
  ResourceAttentionSeverity,
  ResourceAttentionText,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttention";

/*
 * What on a Docker or Podman host needs someone, and how bad it is: the one
 * set of rules the host's health pill and Needs attention card, its
 * Containers list, a container's page and the Topology read
 * (Components/ContainerHost/ContainerHostHealth), for both runtimes. Each
 * line is the one the host's own alert fires at, and a container the agent
 * stopped hearing from is told apart from a job that finished.
 */

const NOW: Date = new Date("2026-11-03T12:00:00.000Z");

const RUNTIME_WORD_PATTERN: RegExp = /docker|podman/i;

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60 * 1000);
}

function container(
  overrides: Partial<ContainerHostContainer> = {},
): ContainerHostContainer {
  return {
    name: "web-1",
    containerId:
      "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    image: "nginx:1.27",
    cpuPercent: 4,
    memoryBytes: 128 * 1024 * 1024,
    memoryPercent: 12,
    networkRxBytes: 1000,
    networkTxBytes: 2000,
    restarts: 0,
    startedAt: minutesAgo(3 * 60),
    lastReadingAt: NOW,
    labels: null,
    ...overrides,
  };
}

function assess(
  overrides: Partial<ContainerHostContainer> = {},
  hostLatest: Date | null = NOW,
): ContainerHostAssessment {
  return assessContainer(container(overrides), hostLatest);
}

function texts(reasons: Array<ResourceAttentionText>): Array<string> {
  return reasons.map((reason: ResourceAttentionText): string => {
    return reason.text;
  });
}

const TEMPLATE_ARGS: {
  hostIdentifier: string;
  onlineMonitorStatusId: ObjectID;
  offlineMonitorStatusId: ObjectID;
  defaultIncidentSeverityId: ObjectID;
  defaultAlertSeverityId: ObjectID;
  monitorName: string;
} = {
  hostIdentifier: "web-01",
  onlineMonitorStatusId: ObjectID.generate(),
  offlineMonitorStatusId: ObjectID.generate(),
  defaultIncidentSeverityId: ObjectID.generate(),
  defaultAlertSeverityId: ObjectID.generate(),
  monitorName: "Containers",
};

// A template's firing criteria: its first filter's value and its window.
function firingOf(template: DockerAlertTemplate | PodmanAlertTemplate): {
  value: number;
  rollingTime: RollingTime | undefined;
} {
  const step: MonitorStep = template.getMonitorStep(TEMPLATE_ARGS);
  const instances: Array<MonitorCriteriaInstance> =
    step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray;
  const monitor: { rollingTime?: RollingTime } | undefined = (step.data!
    .dockerMonitor || step.data!.podmanMonitor) as
    | { rollingTime?: RollingTime }
    | undefined;
  return {
    value: (instances[0]!.data!.filters[0] as { value: number }).value,
    rollingTime: monitor?.rollingTime,
  };
}

describe("the lines the pages colour at are the alerts' lines", () => {
  test.each([
    ["docker-high-memory", getDockerAlertTemplateById],
    ["podman-high-memory", getPodmanAlertTemplateById],
  ] as Array<
    [
      string,
      (id: string) => DockerAlertTemplate | PodmanAlertTemplate | undefined,
    ]
  >)(
    "memory needs a look past %s's line",
    (
      id: string,
      lookup: (
        id: string,
      ) => DockerAlertTemplate | PodmanAlertTemplate | undefined,
    ) => {
      expect(CONTAINER_MEMORY_WARNING_PERCENT).toBe(
        firingOf(lookup(id)!).value,
      );
    },
  );

  test.each([
    ["docker-high-cpu", getDockerAlertTemplateById],
    ["podman-high-cpu", getPodmanAlertTemplateById],
  ] as Array<
    [
      string,
      (id: string) => DockerAlertTemplate | PodmanAlertTemplate | undefined,
    ]
  >)(
    "CPU turns amber past %s's line",
    (
      id: string,
      lookup: (
        id: string,
      ) => DockerAlertTemplate | PodmanAlertTemplate | undefined,
    ) => {
      expect(CONTAINER_CPU_WARNING_PERCENT).toBe(firingOf(lookup(id)!).value);
    },
  );

  test.each([
    ["docker-restart-loop", getDockerAlertTemplateById],
    ["podman-restart-loop", getPodmanAlertTemplateById],
  ] as Array<
    [
      string,
      (id: string) => DockerAlertTemplate | PodmanAlertTemplate | undefined,
    ]
  >)(
    "a restart loop is %s's: more than 3 restarts in 15 minutes",
    (
      id: string,
      lookup: (
        id: string,
      ) => DockerAlertTemplate | PodmanAlertTemplate | undefined,
    ) => {
      const firing: { value: number; rollingTime: RollingTime | undefined } =
        firingOf(lookup(id)!);
      expect(CONTAINER_RESTART_LOOP_RESTARTS).toBe(firing.value);
      expect(firing.rollingTime).toBe(RollingTime.Past15Minutes);
      expect(CONTAINER_RESTART_WINDOW_MINUTES).toBe(15);
    },
  );

  test("the stops: 3 minutes without a reading, a service runs 10, OneUptime forgets after 15", () => {
    // Six readings of 30 seconds missed in a row.
    expect(CONTAINER_NOT_REPORTING_MS).toBe(3 * 60 * 1000);
    expect(CONTAINER_LONG_RUNNING_MS).toBe(10 * 60 * 1000);
    // DockerResourceService's stale threshold.
    expect(CONTAINER_FORGOTTEN_AFTER_MINUTES).toBe(15);
  });

  test("each runtime's container page lists its own container alerts, which exist", () => {
    for (const id of DOCKER_CONTAINER_HOST_RUNTIME.containerAlertTemplateIds) {
      expect({ id, found: Boolean(getDockerAlertTemplateById(id)) }).toEqual({
        id,
        found: true,
      });
    }
    for (const id of PODMAN_CONTAINER_HOST_RUNTIME.containerAlertTemplateIds) {
      expect({ id, found: Boolean(getPodmanAlertTemplateById(id)) }).toEqual({
        id,
        found: true,
      });
    }
    // The restart loop first: what a container's page most needs to watch.
    expect(DOCKER_CONTAINER_HOST_RUNTIME.containerAlertTemplateIds[0]).toBe(
      "docker-restart-loop",
    );
    expect(PODMAN_CONTAINER_HOST_RUNTIME.containerAlertTemplateIds[0]).toBe(
      "podman-restart-loop",
    );
    // The host's own alert is not a container's.
    expect(
      DOCKER_CONTAINER_HOST_RUNTIME.containerAlertTemplateIds,
    ).not.toContain("docker-host-stopped-reporting");
    expect(
      PODMAN_CONTAINER_HOST_RUNTIME.containerAlertTemplateIds,
    ).not.toContain("podman-host-stopped-reporting");
  });
});

describe("a running container", () => {
  test("that is fine reads Running, in green, with nothing to say", () => {
    const assessment: ContainerHostAssessment = assess();
    expect(assessment.state).toBe("running");
    expect(assessment.severity).toBeNull();
    expect(assessment.status.label).toBe(CONTAINER_STATUS_RUNNING);
    expect(assessment.status.tone).toBe("positive");
    expect(assessment.reasons).toEqual([]);
  });

  test("a busy CPU is never a problem by itself, even past 100%", () => {
    const assessment: ContainerHostAssessment = assess({ cpuPercent: 340 });
    expect(assessment.severity).toBeNull();
    expect(assessment.status.tone).toBe("positive");
  });

  test("memory past 85% needs a look, with the percent to one decimal", () => {
    const assessment: ContainerHostAssessment = assess({ memoryPercent: 85.4 });
    expect(assessment.state).toBe("running");
    expect(assessment.severity).toBe(ResourceAttentionSeverity.Warning);
    expect(assessment.status.label).toBe(CONTAINER_STATUS_RUNNING);
    expect(assessment.status.tone).toBe("warning");
    expect(assessment.reasons).toEqual([
      { text: "Memory {{percent}} used", values: { percent: "85.4%" } },
    ]);
  });

  test("memory at exactly 85% is the line, not past it", () => {
    expect(assess({ memoryPercent: 85 }).severity).toBeNull();
  });

  test("a restart or three in 15 minutes needs a look; it still reads Running", () => {
    for (const restarts of [1, 2, 3]) {
      const assessment: ContainerHostAssessment = assess({ restarts });
      expect(assessment.state).toBe("running");
      expect(assessment.severity).toBe(ResourceAttentionSeverity.Warning);
      expect(assessment.status.tone).toBe("warning");
      expect(assessment.reasons).toEqual([
        {
          text: "{{count}} restarts in 15 minutes",
          values: { count: String(restarts) },
          plural: { one: "{{count}} restart in 15 minutes", count: restarts },
        },
      ]);
    }
  });

  test("more than 3 restarts in 15 minutes is a restart loop, in red", () => {
    const assessment: ContainerHostAssessment = assess({ restarts: 4 });
    expect(assessment.state).toBe("restart-loop");
    expect(assessment.severity).toBe(ResourceAttentionSeverity.Critical);
    expect(assessment.status.label).toBe(CONTAINER_STATUS_RESTART_LOOP);
    expect(assessment.status.tone).toBe("danger");
    expect(assessment.status.description).toContain(
      "more than 3 times in the last 15 minutes",
    );
  });

  test("an agent that sends no restart count reads as no restarts, not a loop", () => {
    const assessment: ContainerHostAssessment = assess({ restarts: null });
    expect(assessment.severity).toBeNull();
    expect(getContainerRestarts(container({ restarts: null }))).toBe(0);
    // A fractional sum of increases rounds to whole restarts.
    expect(getContainerRestarts(container({ restarts: 2.6 }))).toBe(3);
    expect(getContainerRestarts(container({ restarts: -1 }))).toBe(0);
  });

  test("a restart loop and full memory: both said, the loop first", () => {
    const assessment: ContainerHostAssessment = assess({
      restarts: 6,
      memoryPercent: 97,
    });
    expect(assessment.severity).toBe(ResourceAttentionSeverity.Critical);
    expect(texts(assessment.reasons)).toEqual([
      "{{count}} restarts in 15 minutes",
      "Memory {{percent}} used",
    ]);
  });
});

describe("a container that stopped reporting", () => {
  test("after 3 minutes without a reading while the others report, it is not reporting", () => {
    expect(isContainerNotReporting(minutesAgo(3), NOW)).toBe(false);
    expect(isContainerNotReporting(minutesAgo(3.1), NOW)).toBe(true);
    expect(isContainerNotReporting(null, NOW)).toBe(true);
  });

  test("measured against the host's newest reading, not the clock: a quiet host flags none", () => {
    // The host's agent stopped an hour ago: every container is as old.
    expect(isContainerNotReporting(minutesAgo(61), minutesAgo(60))).toBe(false);
    expect(isContainerNotReporting(minutesAgo(61), null)).toBe(false);
    expect(
      assess({ lastReadingAt: minutesAgo(61) }, minutesAgo(60)).state,
    ).toBe("running");
  });

  test("a service that ran 10 minutes or more and stopped: Stopped reporting, amber", () => {
    const assessment: ContainerHostAssessment = assess({
      lastReadingAt: minutesAgo(6),
      startedAt: minutesAgo(6 + 10),
    });
    expect(assessment.state).toBe("stopped");
    expect(assessment.severity).toBe(ResourceAttentionSeverity.Warning);
    expect(assessment.status.label).toBe(CONTAINER_STATUS_STOPPED);
    expect(assessment.status.tone).toBe("warning");
    expect(assessment.reasons).toEqual([{ text: "Stopped reporting" }]);
  });

  test("a job that ran for less than 10 minutes and finished: Not reporting, grey, no problem", () => {
    const assessment: ContainerHostAssessment = assess({
      lastReadingAt: minutesAgo(6),
      startedAt: minutesAgo(8),
    });
    expect(assessment.state).toBe("not-reporting");
    expect(assessment.severity).toBeNull();
    expect(assessment.status.label).toBe(CONTAINER_STATUS_NOT_REPORTING);
    expect(assessment.status.tone).toBe("neutral");
    expect(assessment.status.description).toContain("A job or a one-off");
  });

  test("a Compose one-off (docker compose run) is never a stopped service, however long it ran", () => {
    const oneOff: ContainerHostContainer = container({
      lastReadingAt: minutesAgo(6),
      startedAt: minutesAgo(5 * 60),
      labels: { "com.docker.compose.oneoff": "True" },
    });
    expect(isContainerOneOff(oneOff)).toBe(true);
    expect(isContainerLongRunning(oneOff)).toBe(false);
    expect(assessContainer(oneOff, NOW).state).toBe("not-reporting");
    expect(
      isContainerOneOff(
        container({ labels: { "com.docker.compose.oneoff": "False" } }),
      ),
    ).toBe(false);
  });

  test("a container whose start is unknown is not guessed a service", () => {
    const assessment: ContainerHostAssessment = assess({
      lastReadingAt: minutesAgo(6),
      startedAt: null,
    });
    expect(assessment.state).toBe("not-reporting");
    expect(assessment.severity).toBeNull();
  });

  test("its last memory reading is not what it uses now: never flagged", () => {
    const assessment: ContainerHostAssessment = assess({
      lastReadingAt: minutesAgo(6),
      startedAt: minutesAgo(8),
      memoryPercent: 99,
    });
    expect(assessment.severity).toBeNull();
    expect(texts(assessment.reasons)).toEqual([]);
  });

  test("a job that restarted on its way out still needs a look, in amber", () => {
    const assessment: ContainerHostAssessment = assess({
      lastReadingAt: minutesAgo(6),
      startedAt: minutesAgo(8),
      restarts: 2,
    });
    expect(assessment.state).toBe("not-reporting");
    expect(assessment.severity).toBe(ResourceAttentionSeverity.Warning);
    expect(assessment.status.tone).toBe("warning");
  });

  test("a service that crash-looped and then stopped: the loop leads", () => {
    const assessment: ContainerHostAssessment = assess({
      lastReadingAt: minutesAgo(6),
      startedAt: minutesAgo(60),
      restarts: 5,
    });
    expect(assessment.state).toBe("restart-loop");
    expect(assessment.severity).toBe(ResourceAttentionSeverity.Critical);
    expect(texts(assessment.reasons)).toEqual([
      "{{count}} restarts in 15 minutes",
      "Stopped reporting",
    ]);
  });
});

describe("the host's Needs attention and health", () => {
  const route: (name: string) => Route = (name: string): Route => {
    return new Route(`/containers/${name}`);
  };

  const containers: Array<ContainerHostContainer> = [
    container({ name: "web-10" }),
    container({ name: "web-2", memoryPercent: 91 }),
    container({ name: "worker", restarts: 7 }),
    container({
      name: "billing",
      lastReadingAt: minutesAgo(5),
      startedAt: minutesAgo(120),
      image: "acme/billing:4",
    }),
    container({
      name: "migrate",
      lastReadingAt: minutesAgo(5),
      startedAt: minutesAgo(6),
    }),
  ];

  const items: Array<ResourceAttentionItem> = getContainerHostAttentionItems({
    containers: containers,
    getContainerRoute: route,
  });

  test("lists only what needs someone, the most urgent first, then by name", () => {
    expect(
      items.map((item: ResourceAttentionItem): string => {
        return item.name;
      }),
    ).toEqual(["worker", "billing", "web-2"]);
    expect(
      items.map((item: ResourceAttentionItem): ResourceAttentionSeverity => {
        return item.severity;
      }),
    ).toEqual([
      ResourceAttentionSeverity.Critical,
      ResourceAttentionSeverity.Warning,
      ResourceAttentionSeverity.Warning,
    ]);
  });

  test("each row is a container, with its image, its page and its own key", () => {
    const billing: ResourceAttentionItem = items[1]!;
    expect(billing.kind).toBe(CONTAINER_KIND);
    expect(billing.icon).toBe(IconProp.Cube);
    expect(billing.detail).toBe("acme/billing:4");
    expect(billing.route?.toString()).toBe("/containers/billing");
    expect(billing.key).toBe(getContainerAttentionKey("billing"));
    expect(getContainerAttentionKey("billing")).toBe("container:billing");
  });

  test("a container that went quiet says when it last reported; a running one does not", () => {
    expect(items[1]!.lastReportAt).toEqual(minutesAgo(5));
    expect(items[0]!.lastReportAt).toBeUndefined();
    expect(items[2]!.lastReportAt).toBeUndefined();
  });

  test("the host's newest reading is the newest of its containers'", () => {
    expect(getContainerHostLatestReadingAt(containers)).toEqual(NOW);
    expect(getContainerHostLatestReadingAt([])).toBeNull();
    expect(
      getContainerHostLatestReadingAt([
        { lastReadingAt: null },
        { lastReadingAt: minutesAgo(2) },
      ]),
    ).toEqual(minutesAgo(2));
  });

  test("a container's page hands in the host's newest reading, read with all its containers", () => {
    const billing: ContainerHostContainer = containers[3]!;
    // Alone, billing would be its own newest reading, and never quiet.
    expect(getContainerHostAttentionItems({ containers: [billing] })).toEqual(
      [],
    );
    expect(
      getContainerHostAttentionItems({
        containers: [billing],
        hostLatestReadingAt: NOW,
      }).map((item: ResourceAttentionItem): string => {
        return item.name;
      }),
    ).toEqual(["billing"]);
  });

  test("health: Unhealthy with a restart loop, Degraded with a warning, Healthy with none", () => {
    expect(getContainerHostHealth(items)).toBe("Unhealthy");
    expect(
      getContainerHostHealth(
        getContainerHostAttentionItems({
          containers: [container({ memoryPercent: 90 })],
        }),
      ),
    ).toBe("Degraded");
    expect(
      getContainerHostHealth(
        getContainerHostAttentionItems({ containers: [container()] }),
      ),
    ).toBe("Healthy");
    expect(getContainerHostHealth([])).toBe("Healthy");
  });

  test("a container's page names its own row 'This container'", () => {
    expect(THIS_CONTAINER_LABEL).toBe("This container");
  });
});

describe("the words", () => {
  test("never name a runtime, so one set serves Docker and Podman", () => {
    const words: Array<string> = [
      CONTAINER_KIND,
      THIS_CONTAINER_LABEL,
      CONTAINER_STATUS_RUNNING,
      CONTAINER_STATUS_RESTART_LOOP,
      CONTAINER_STATUS_STOPPED,
      CONTAINER_STATUS_NOT_REPORTING,
      ...texts(assess({ restarts: 9, memoryPercent: 99 }).reasons),
      assess({ restarts: 9 }).status.description || "",
      assess({ lastReadingAt: minutesAgo(6), startedAt: minutesAgo(60) }).status
        .description || "",
      assess({ lastReadingAt: minutesAgo(6), startedAt: minutesAgo(7) }).status
        .description || "",
    ];
    for (const word of words) {
      expect({ word, namesRuntime: RUNTIME_WORD_PATTERN.test(word) }).toEqual({
        word,
        namesRuntime: false,
      });
    }
  });

  test("a reason's percent keeps one decimal, never rounding 85.4 down to the line", () => {
    expect(formatContainerReasonPercent(85.44)).toBe("85.4%");
    expect(formatContainerReasonPercent(91)).toBe("91%");
    expect(formatContainerReasonPercent(99.96)).toBe("100%");
  });
});

describe("Compose labels", () => {
  test("Docker's and podman-compose's project and service labels both count", () => {
    expect(
      getContainerComposeProject(
        container({ labels: { "com.docker.compose.project": " shop " } }),
      ),
    ).toBe("shop");
    expect(
      getContainerComposeProject(
        container({ labels: { "io.podman.compose.project": "site" } }),
      ),
    ).toBe("site");
    expect(
      getContainerComposeService(
        container({ labels: { "com.docker.compose.service": "api" } }),
      ),
    ).toBe("api");
    expect(
      getContainerComposeService(
        container({ labels: { "io.podman.compose.service": "web" } }),
      ),
    ).toBe("web");
  });

  test("no labels, or labels that are not text, read as none", () => {
    expect(getContainerComposeProject(container())).toBe("");
    expect(
      readContainerLabel({ "com.docker.compose.project": 3 }, [
        "com.docker.compose.project",
      ]),
    ).toBe("");
    expect(readContainerLabel(null, ["com.docker.compose.project"])).toBe("");
  });
});

describe("open incidents and alerts about a container", () => {
  test("are the host's records whose series is the container, by name", () => {
    expect(
      isContainerIssueAbout(
        { seriesLabels: { "resource.container.name": "web-1" } },
        "web-1",
      ),
    ).toBe(true);
    expect(
      isContainerIssueAbout(
        { seriesLabels: { "container.name": "WEB-1 " } },
        "web-1",
      ),
    ).toBe(true);
    expect(
      isContainerIssueAbout(
        { seriesLabels: { "resource.container.name": "web-10" } },
        "web-1",
      ),
    ).toBe(false);
    expect(isContainerIssueAbout({ seriesLabels: null }, "web-1")).toBe(false);
    expect(isContainerIssueAbout({ seriesLabels: {} }, "")).toBe(false);
  });
});
