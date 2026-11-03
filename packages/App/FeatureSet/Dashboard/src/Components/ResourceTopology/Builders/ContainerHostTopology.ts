import { JSONObject } from "Common/Types/JSON";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import PageMap from "../../../Utils/PageMap";
import {
  ResourceTopologyFact,
  ResourceTopologyGraph,
  ResourceTopologyHealth,
  ResourceTopologyNodeInput,
  ResourceTopologyRelation,
  ResourceTopologyText,
  ResourceTopologyTruncation,
  buildResourceTopologyGraph,
} from "../ResourceTopologyModel";
import {
  OpenIssueRecord,
  attachOpenIssues,
  readSeriesLabel,
  sameName,
} from "../ResourceTopologyIssues";
import {
  formatTopologyBytes,
  formatTopologyPercent,
  isRecent,
  toFiniteNumber,
} from "../ResourceTopologyFormat";
import {
  formatStatusWord,
  healthOfStatusWord,
} from "../ResourceTopologyStatusWords";
import {
  ContainerHostAssessment,
  ContainerHostContainer,
  assessContainer as assessContainerByRules,
  getContainerHostLatestReadingAt,
} from "../../ContainerHost/ContainerHostHealth";
import {
  ResourceAttentionSeverity,
  ResourceAttentionText,
} from "../../ResourcePart/ResourceAttention";

/*
 * A Docker or Podman host's topology: the host, its Compose projects (read
 * from the labels Compose puts on what it creates), and in each the
 * containers, networks and volumes it made; containers outside any project
 * sit on the host itself, with the host's images, networks and volumes. A
 * container is linked to the image it runs ("Uses image"), so a focused
 * image shows every container built from it — and an image no container
 * uses reads as off, a candidate for cleaning up rather than a problem.
 *
 * A container's health is the host's own rules (ContainerHostHealth), as
 * its Overview, Containers list and page read it: a container that ran for
 * 10 minutes or more and stopped reporting while the host's other
 * containers report needs attention, and a job that finished is off. A
 * state the agent reported other than running (restarting, dead, exited,
 * paused) reads as that state: restarting needs attention, dead is
 * critical, exited or paused is off.
 */

export const CONTAINER_HOST_ROOT_ID: string = "host";

export const CONTAINER_HOST_METRIC_STALE_MS: number = 15 * 60 * 1000;

/* The labels Compose (and podman-compose) put on what they create. */
export const COMPOSE_PROJECT_LABELS: ReadonlyArray<string> = [
  "com.docker.compose.project",
  "io.podman.compose.project",
];
export const COMPOSE_SERVICE_LABELS: ReadonlyArray<string> = [
  "com.docker.compose.service",
  "io.podman.compose.service",
];

export type ContainerHostProduct = "docker" | "podman";

/* The shape of a DockerResource or PodmanResource row the map reads. */
export interface ContainerHostResourceRow {
  _id?: string | undefined;
  id?: { toString: () => string } | null | undefined;
  kind?: string | undefined;
  name?: string | undefined;
  containerId?: string | undefined;
  imageName?: string | undefined;
  state?: string | undefined;
  labels?: JSONObject | undefined;
  latestCpuPercent?: number | undefined;
  latestMemoryBytes?: number | undefined;
  metricsUpdatedAt?: Date | undefined;
  lastSeenAt?: Date | undefined;
  // When the container's current run started.
  resourceCreationTimestamp?: Date | undefined;
}

export interface ContainerHostTopologyInput {
  product: ContainerHostProduct;
  host: {
    id: string;
    name: string;
    lastSeenAt?: Date | null | undefined;
  };
  rows: Array<ContainerHostResourceRow>;
  issues?: Array<OpenIssueRecord> | undefined;
  now: Date;
  truncations?: Array<ResourceTopologyTruncation> | undefined;
}

function text(value: string): ResourceTopologyText {
  return { text: value };
}

function readLabel(
  labels: JSONObject | undefined,
  keys: ReadonlyArray<string>,
): string {
  for (const key of keys) {
    const value: unknown = labels?.[key];

    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }

  return "";
}

function rowId(row: ContainerHostResourceRow): string {
  return (row._id || row.id?.toString() || "").toString();
}

/* "nginx:1.25" and "docker.io/library/nginx:1.25" are one image. */
export function normalizeImageName(name: string | undefined): string {
  let value: string = (name || "").trim().toLowerCase();

  for (const prefix of ["docker.io/library/", "docker.io/"]) {
    if (value.startsWith(prefix)) {
      value = value.substring(prefix.length);
    }
  }

  if (value && !value.includes("@") && !value.split("/").pop()!.includes(":")) {
    value = `${value}:latest`;
  }

  return value;
}

interface Assessment {
  health: ResourceTopologyHealth;
  status?: ResourceTopologyText | undefined;
  reasons?: Array<ResourceTopologyText> | undefined;
  facts: Array<ResourceTopologyFact>;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) {
    return null;
  }
  const date: Date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

// A container's inventory row as the host's rules read it.
export function toContainerHostContainer(
  row: ContainerHostResourceRow,
): ContainerHostContainer {
  return {
    name: row.name || "",
    containerId: row.containerId || null,
    image: row.imageName || null,
    cpuPercent: null,
    memoryBytes: null,
    memoryPercent: null,
    networkRxBytes: null,
    networkTxBytes: null,
    restarts: null,
    startedAt: toDate(row.resourceCreationTimestamp),
    lastReadingAt: toDate(row.metricsUpdatedAt) || toDate(row.lastSeenAt),
    labels: row.labels || null,
  };
}

function fromRules(assessment: ContainerHostAssessment): {
  health: ResourceTopologyHealth;
  status: ResourceTopologyText;
  reasons: Array<ResourceTopologyText>;
} {
  return {
    health:
      assessment.severity === ResourceAttentionSeverity.Critical
        ? "critical"
        : assessment.severity === ResourceAttentionSeverity.Warning
          ? "warning"
          : assessment.state === "not-reporting"
            ? "off"
            : "healthy",
    status: text(assessment.status.label),
    // A count-dependent reason reads its general form, with its count.
    reasons: assessment.reasons.map(
      (reason: ResourceAttentionText): ResourceTopologyText => {
        if (reason.plural) {
          return {
            text: reason.text,
            values: {
              ...(reason.values || {}),
              count: String(reason.plural.count),
            },
          };
        }
        return reason.values
          ? { text: reason.text, values: reason.values }
          : text(reason.text);
      },
    ),
  };
}

function assessContainer(
  row: ContainerHostResourceRow,
  now: Date,
  hostLatestReadingAt: Date | null,
): Assessment {
  const fresh: boolean = isRecent(
    row.metricsUpdatedAt,
    now,
    CONTAINER_HOST_METRIC_STALE_MS,
  );
  const facts: Array<ResourceTopologyFact> = [];
  const reported: string = (row.state || "").trim().toLowerCase();
  const isRunningOrUnknown: boolean = !reported || reported === "running";
  const rules: ContainerHostAssessment | null = isRunningOrUnknown
    ? assessContainerByRules(toContainerHostContainer(row), hostLatestReadingAt)
    : null;
  const isReporting: boolean =
    fresh &&
    (!rules || rules.state === "running" || rules.state === "restart-loop");

  if (isReporting) {
    const cpu: number | null = toFiniteNumber(row.latestCpuPercent);
    const memory: number | null = toFiniteNumber(row.latestMemoryBytes);

    if (cpu !== null) {
      facts.push({
        label: translationKey("CPU"),
        value: formatTopologyPercent(cpu),
      });
    }

    if (memory !== null) {
      facts.push({
        label: translationKey("Memory"),
        value: formatTopologyBytes(memory),
      });
    }
  }

  // A state the agent reported other than running: that state.
  if (!isRunningOrUnknown) {
    const fromState: ResourceTopologyHealth | null = healthOfStatusWord(
      row.state,
    );

    if (fromState) {
      return {
        health: fromState,
        status: { text: formatStatusWord(row.state) },
        facts: facts,
      };
    }
  }

  if (rules && (fresh || rules.state !== "running")) {
    return { ...fromRules(rules), facts: facts };
  }

  return {
    health: "unknown",
    status: text(translationKey("No data yet")),
    facts: facts,
  };
}

export function buildContainerHostTopology(
  input: ContainerHostTopologyInput,
): ResourceTopologyGraph {
  const hostId: string = input.host.id;
  const reporting: boolean =
    isRecent(
      input.host.lastSeenAt,
      input.now,
      CONTAINER_HOST_METRIC_STALE_MS,
    ) ||
    input.rows.some((row: ContainerHostResourceRow): boolean => {
      return isRecent(
        row.metricsUpdatedAt,
        input.now,
        CONTAINER_HOST_METRIC_STALE_MS,
      );
    });
  const detailPage: PageMap =
    input.product === "docker"
      ? PageMap.DOCKER_HOST_VIEW_CONTAINER_DETAIL
      : PageMap.PODMAN_HOST_VIEW_CONTAINER_DETAIL;

  const nodes: Array<ResourceTopologyNodeInput> = [
    {
      id: CONTAINER_HOST_ROOT_ID,
      parentId: null,
      kind: input.product === "docker" ? "docker.host" : "podman.host",
      name: input.host.name || "Host",
      health: reporting
        ? "healthy"
        : input.host.lastSeenAt
          ? "warning"
          : "unknown",
      status: reporting
        ? text(translationKey("Reporting"))
        : input.host.lastSeenAt
          ? text(translationKey("Not reporting"))
          : text(translationKey("No data yet")),
      reasons:
        !reporting && input.host.lastSeenAt
          ? [
              text(
                translationKey(
                  "Nothing has arrived from this host's agent for more than 15 minutes.",
                ),
              ),
            ]
          : [],
      link: {
        page:
          input.product === "docker"
            ? PageMap.DOCKER_HOST_VIEW
            : PageMap.PODMAN_HOST_VIEW,
        modelId: hostId,
      },
    },
  ];

  const projects: Set<string> = new Set<string>();
  const projectOf: (row: ContainerHostResourceRow) => string = (
    row: ContainerHostResourceRow,
  ): string => {
    const project: string = readLabel(row.labels, COMPOSE_PROJECT_LABELS);

    if (!project) {
      return CONTAINER_HOST_ROOT_ID;
    }

    const id: string = `project:${project}`;

    if (!projects.has(project)) {
      projects.add(project);
      nodes.push({
        id: id,
        parentId: CONTAINER_HOST_ROOT_ID,
        kind: "container.project",
        name: project,
        health: "healthy",
      });
    }

    return id;
  };

  /*
   * What a container that stopped is measured against: the host's newest
   * reading of any container, not the clock.
   */
  const hostLatestReadingAt: Date | null = getContainerHostLatestReadingAt(
    input.rows
      .filter((row: ContainerHostResourceRow): boolean => {
        return row.kind === "Container";
      })
      .map((row: ContainerHostResourceRow): { lastReadingAt: Date | null } => {
        return {
          lastReadingAt: toDate(row.metricsUpdatedAt) || toDate(row.lastSeenAt),
        };
      }),
  );

  const containerIds: Map<string, string> = new Map<string, string>();
  const containerByName: Map<string, string> = new Map<string, string>();
  const imageUse: Map<string, Array<string>> = new Map<string, Array<string>>();
  const rowToNode: Map<string, string> = new Map<string, string>();

  for (const row of input.rows) {
    if (row.kind !== "Container" || !row.name) {
      continue;
    }

    const id: string = `container:${row.name}`;

    if (containerByName.has(row.name)) {
      continue;
    }

    const assessment: Assessment = assessContainer(
      row,
      input.now,
      hostLatestReadingAt,
    );
    const service: string = readLabel(row.labels, COMPOSE_SERVICE_LABELS);
    containerByName.set(row.name, id);

    if (row.containerId) {
      containerIds.set(row.containerId.substring(0, 12).toLowerCase(), id);
    }

    if (rowId(row)) {
      rowToNode.set(rowId(row), id);
    }

    const image: string = normalizeImageName(row.imageName);

    if (image) {
      imageUse.set(image, [...(imageUse.get(image) || []), id]);
    }

    nodes.push({
      id: id,
      parentId: projectOf(row),
      kind: "container.container",
      name: row.name,
      health: assessment.health,
      status: assessment.status,
      reasons: assessment.reasons,
      facts: assessment.facts,
      context: service || undefined,
      keywords: [row.imageName || "", row.containerId || "", service].filter(
        (keyword: string): boolean => {
          return keyword.length > 0;
        },
      ),
      link: { page: detailPage, modelId: hostId, subModelId: row.name },
    });
  }

  const relations: Array<ResourceTopologyRelation> = [];

  for (const row of input.rows) {
    if (!row.name) {
      continue;
    }

    if (row.kind === "Image") {
      const id: string = `image:${row.name}`;
      const users: Array<string> =
        imageUse.get(normalizeImageName(row.name)) || [];

      nodes.push({
        id: id,
        parentId: CONTAINER_HOST_ROOT_ID,
        kind: "container.image",
        name: row.name,
        health: users.length > 0 ? "healthy" : "off",
        status:
          users.length > 0
            ? text(translationKey("In use"))
            : text(translationKey("Not used by any container")),
      });

      for (const user of users) {
        relations.push({
          from: user,
          to: id,
          label: translationKey("Uses image"),
          inverseLabel: translationKey("Used by"),
        });
      }
    } else if (row.kind === "Network" || row.kind === "Volume") {
      nodes.push({
        id: `${row.kind === "Network" ? "network" : "volume"}:${row.name}`,
        parentId: projectOf(row),
        kind: row.kind === "Network" ? "container.network" : "container.volume",
        name: row.name,
        health: "healthy",
        status: row.state ? { text: row.state } : undefined,
      });
    }
  }

  /*
   * An open incident or alert is about the container it is linked to or
   * its labels name — or else the host.
   */
  const relation: string =
    input.product === "docker" ? "dockerResources" : "podmanResources";

  const locate: (record: OpenIssueRecord) => string | null = (
    record: OpenIssueRecord,
  ): string | null => {
    for (const id of record.relatedIds[relation] || []) {
      const nodeId: string | undefined = rowToNode.get(id);

      if (nodeId) {
        return nodeId;
      }
    }

    const name: string | null = readSeriesLabel(
      record.seriesLabels,
      "container.name",
    );

    if (name) {
      for (const [containerName, id] of containerByName) {
        if (sameName(containerName, name)) {
          return id;
        }
      }
    }

    const containerId: string | null = readSeriesLabel(
      record.seriesLabels,
      "container.id",
    );

    if (containerId) {
      return (
        containerIds.get(containerId.substring(0, 12).toLowerCase()) || null
      );
    }

    return null;
  };

  return buildResourceTopologyGraph({
    rootId: CONTAINER_HOST_ROOT_ID,
    nodes: nodes,
    relations: relations,
    issues: attachOpenIssues({
      records: input.issues || [],
      rootId: CONTAINER_HOST_ROOT_ID,
      locate: locate,
    }),
    truncations: input.truncations,
  });
}
