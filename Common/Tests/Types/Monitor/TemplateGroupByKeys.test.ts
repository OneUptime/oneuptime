import {
  DockerAlertTemplate,
  DockerAlertTemplateArgs,
  getAllDockerAlertTemplates,
} from "../../../Types/Monitor/DockerAlertTemplates";
import {
  HostAlertTemplate,
  HostAlertTemplateArgs,
  getAllHostAlertTemplates,
} from "../../../Types/Monitor/HostAlertTemplates";
import {
  PodmanAlertTemplate,
  PodmanAlertTemplateArgs,
  getAllPodmanAlertTemplates,
} from "../../../Types/Monitor/PodmanAlertTemplates";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import ObjectID from "../../../Types/ObjectID";

/*
 * Guard: a shipped template must never silently lose (or silently gain) its
 * per-series group-by.
 *
 * `MonitorStep.getGroupByAttributeKeys` is the single source of truth for "is
 * this monitor grouped?" — the telemetry worker uses it to build the
 * per-series breakdown and the criteria evaluator uses it to decide whether a
 * criteria fans out one alert/incident per series. An ungrouped template over
 * a fleet raises ONE alert for the whole fleet: the first container/mount to
 * breach opens an incident whose dedupe key carries no series, and every other
 * container/mount that breaches afterwards is silenced for as long as that
 * incident stays open. That is the exact bug this table exists to prevent from
 * coming back.
 *
 * The decision recorded per template:
 *
 *   - Docker / Podman: EVERY template groups by `resource.container.name`.
 *     Both agents stamp container identity as OTLP RESOURCE attributes, so
 *     ClickHouse stores them `resource.`-prefixed — the same key the worker
 *     uses for `containerFilters.containerName`
 *     (App/FeatureSet/Workers/Jobs/TelemetryMonitor/MonitorTelemetryMonitor.ts)
 *     and the same key the Docker/Podman dashboards query by
 *     (`CONTAINER_NAME_ATTR` in App/FeatureSet/Dashboard/src/Pages/{Docker,
 *     Podman}/View/Overview.tsx). NOTE this differs from Docker Swarm, whose
 *     docker_stats receiver keeps container identity in DATAPOINT labels
 *     (plain `container.name`).
 *
 *   - Host: a host monitor is already scoped to ONE host (the worker injects
 *     `resource.host.name` from hostIdentifier), so host-scalar metrics — CPU
 *     utilization, memory utilization, load average, process count — stay
 *     UNGROUPED: there is exactly one series per host and grouping buys
 *     nothing. Filesystem utilization is per-mountpoint, so it groups by the
 *     unprefixed `mountpoint` datapoint label the hostmetrics receiver sets
 *     (read the same way in App/FeatureSet/Dashboard/src/Pages/Host/View/
 *     Overview.tsx). Host templates for per-device disk I/O or network
 *     interfaces do not exist yet; when one is added it groups by `device`.
 *
 * Each table is exhaustive both ways — a new template with no row here fails
 * loudly, which forces the group-by decision to be made deliberately.
 */

interface GroupByExpectation {
  id: string;
  // The exact group-by keys, or [] for a deliberately ungrouped template.
  groupByAttributeKeys: Array<string>;
}

const CONTAINER_NAME_ATTRIBUTE: string = "resource.container.name";

const EXPECTED_DOCKER_GROUP_BY: Array<GroupByExpectation> = [
  { id: "docker-high-cpu", groupByAttributeKeys: [CONTAINER_NAME_ATTRIBUTE] },
  {
    id: "docker-high-memory",
    groupByAttributeKeys: [CONTAINER_NAME_ATTRIBUTE],
  },
  {
    id: "docker-restart-loop",
    groupByAttributeKeys: [CONTAINER_NAME_ATTRIBUTE],
  },
  {
    id: "docker-cpu-throttling",
    groupByAttributeKeys: [CONTAINER_NAME_ATTRIBUTE],
  },
  { id: "docker-high-pids", groupByAttributeKeys: [CONTAINER_NAME_ATTRIBUTE] },
  {
    id: "docker-container-down",
    groupByAttributeKeys: [CONTAINER_NAME_ATTRIBUTE],
  },
];

const EXPECTED_PODMAN_GROUP_BY: Array<GroupByExpectation> = [
  { id: "podman-high-cpu", groupByAttributeKeys: [CONTAINER_NAME_ATTRIBUTE] },
  {
    id: "podman-high-memory",
    groupByAttributeKeys: [CONTAINER_NAME_ATTRIBUTE],
  },
  {
    id: "podman-restart-loop",
    groupByAttributeKeys: [CONTAINER_NAME_ATTRIBUTE],
  },
  {
    id: "podman-cpu-throttling",
    groupByAttributeKeys: [CONTAINER_NAME_ATTRIBUTE],
  },
  { id: "podman-high-pids", groupByAttributeKeys: [CONTAINER_NAME_ATTRIBUTE] },
  {
    id: "podman-container-down",
    groupByAttributeKeys: [CONTAINER_NAME_ATTRIBUTE],
  },
];

const EXPECTED_HOST_GROUP_BY: Array<GroupByExpectation> = [
  // Host-scalar: one series per host, nothing to fan out over.
  { id: "host-high-cpu", groupByAttributeKeys: [] },
  { id: "host-high-memory", groupByAttributeKeys: [] },
  { id: "host-high-load-average", groupByAttributeKeys: [] },
  { id: "host-high-processes", groupByAttributeKeys: [] },
  // Per-entity within the host: one series (and one incident) per mount.
  { id: "host-high-filesystem", groupByAttributeKeys: ["mountpoint"] },
];

function buildDockerArgs(): DockerAlertTemplateArgs {
  return {
    hostIdentifier: "host-01",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Test Monitor",
  };
}

function buildPodmanArgs(): PodmanAlertTemplateArgs {
  return buildDockerArgs();
}

function buildHostArgs(): HostAlertTemplateArgs {
  return buildDockerArgs();
}

function idsOf(expectations: Array<GroupByExpectation>): Array<string> {
  return expectations
    .map((expectation: GroupByExpectation) => {
      return expectation.id;
    })
    .sort();
}

function expectationFor(
  expectations: Array<GroupByExpectation>,
  id: string,
): GroupByExpectation {
  const expectation: GroupByExpectation | undefined = expectations.find(
    (candidate: GroupByExpectation) => {
      return candidate.id === id;
    },
  );

  if (!expectation) {
    throw new Error(
      `No group-by expectation for template "${id}". Add a row to this table and decide, deliberately, whether the template is per-series.`,
    );
  }

  return expectation;
}

const DOCKER_TEMPLATES: Array<DockerAlertTemplate> =
  getAllDockerAlertTemplates();
const PODMAN_TEMPLATES: Array<PodmanAlertTemplate> =
  getAllPodmanAlertTemplates();
const HOST_TEMPLATES: Array<HostAlertTemplate> = getAllHostAlertTemplates();

describe("Alert template group-by keys", () => {
  describe("DockerAlertTemplates", () => {
    test("every template has a group-by expectation (exhaustive both ways)", () => {
      expect(
        DOCKER_TEMPLATES.map((template: DockerAlertTemplate) => {
          return template.id;
        }).sort(),
      ).toEqual(idsOf(EXPECTED_DOCKER_GROUP_BY));
    });

    test.each(
      DOCKER_TEMPLATES.map((template: DockerAlertTemplate) => {
        return [template.id, template];
      }),
    )(
      "%s groups by the expected attribute keys",
      (id: unknown, template: unknown) => {
        const step: MonitorStep = (
          template as DockerAlertTemplate
        ).getMonitorStep(buildDockerArgs());

        expect(MonitorStep.getGroupByAttributeKeys(step)).toEqual(
          expectationFor(EXPECTED_DOCKER_GROUP_BY, id as string)
            .groupByAttributeKeys,
        );
      },
    );
  });

  describe("PodmanAlertTemplates", () => {
    test("every template has a group-by expectation (exhaustive both ways)", () => {
      expect(
        PODMAN_TEMPLATES.map((template: PodmanAlertTemplate) => {
          return template.id;
        }).sort(),
      ).toEqual(idsOf(EXPECTED_PODMAN_GROUP_BY));
    });

    test.each(
      PODMAN_TEMPLATES.map((template: PodmanAlertTemplate) => {
        return [template.id, template];
      }),
    )(
      "%s groups by the expected attribute keys",
      (id: unknown, template: unknown) => {
        const step: MonitorStep = (
          template as PodmanAlertTemplate
        ).getMonitorStep(buildPodmanArgs());

        expect(MonitorStep.getGroupByAttributeKeys(step)).toEqual(
          expectationFor(EXPECTED_PODMAN_GROUP_BY, id as string)
            .groupByAttributeKeys,
        );
      },
    );
  });

  describe("HostAlertTemplates", () => {
    test("every template has a group-by expectation (exhaustive both ways)", () => {
      expect(
        HOST_TEMPLATES.map((template: HostAlertTemplate) => {
          return template.id;
        }).sort(),
      ).toEqual(idsOf(EXPECTED_HOST_GROUP_BY));
    });

    test.each(
      HOST_TEMPLATES.map((template: HostAlertTemplate) => {
        return [template.id, template];
      }),
    )(
      "%s groups by the expected attribute keys",
      (id: unknown, template: unknown) => {
        const step: MonitorStep = (
          template as HostAlertTemplate
        ).getMonitorStep(buildHostArgs());

        expect(MonitorStep.getGroupByAttributeKeys(step)).toEqual(
          expectationFor(EXPECTED_HOST_GROUP_BY, id as string)
            .groupByAttributeKeys,
        );
      },
    );
  });

  /*
   * The fleet templates are the whole point of the fix: a container monitor
   * covers every container on the host and a filesystem monitor covers every
   * mount, so both MUST be grouped. Asserted separately from the tables so a
   * bulk edit that blanks every expectation still fails.
   */
  test("every Docker and Podman template is grouped, and by a resource-prefixed key", () => {
    const containerTemplates: Array<DockerAlertTemplate | PodmanAlertTemplate> =
      [...DOCKER_TEMPLATES, ...PODMAN_TEMPLATES];

    expect(containerTemplates.length).toBeGreaterThan(0);

    for (const template of containerTemplates) {
      const step: MonitorStep = template.getMonitorStep(buildDockerArgs());
      const keys: Array<string> = MonitorStep.getGroupByAttributeKeys(step);

      expect(keys).toEqual([CONTAINER_NAME_ATTRIBUTE]);
      /*
       * Docker/Podman container identity is a RESOURCE attribute. Dropping the
       * prefix (the Docker Swarm spelling) would group every datapoint into a
       * single "" series and quietly restore the fleet-wide single alert.
       */
      expect(keys[0]!.startsWith("resource.")).toBe(true);
    }
  });

  test("the host filesystem template is grouped per mountpoint", () => {
    const filesystemTemplate: HostAlertTemplate | undefined =
      HOST_TEMPLATES.find((template: HostAlertTemplate) => {
        return template.id === "host-high-filesystem";
      });

    expect(filesystemTemplate).toBeDefined();

    const step: MonitorStep =
      filesystemTemplate!.getMonitorStep(buildHostArgs());

    expect(MonitorStep.getGroupByAttributeKeys(step)).toEqual(["mountpoint"]);
  });
});
