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

/*
 * A Docker or Podman host's topology: the host, its Compose projects (read
 * from the labels Compose puts on what it creates), and in each the
 * containers, networks and volumes it made; containers outside any project
 * sit on the host itself, with the host's images, networks and volumes. A
 * container is linked to the image it runs ("Uses image"), so a focused
 * image shows every container built from it — and an image no container
 * uses reads as off, a candidate for cleaning up rather than a problem.
 *
 * A container's health is its state, as the host's own pages read it:
 * running is healthy, restarting needs attention, dead is critical, exited
 * or paused is off. A container whose state was never reported (seen only
 * through its metrics) is healthy while its metrics keep arriving.
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
  facts: Array<ResourceTopologyFact>;
}

function assessContainer(row: ContainerHostResourceRow, now: Date): Assessment {
  const fresh: boolean = isRecent(
    row.metricsUpdatedAt,
    now,
    CONTAINER_HOST_METRIC_STALE_MS,
  );
  const facts: Array<ResourceTopologyFact> = [];

  if (fresh) {
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

  if (fresh) {
    return {
      health: "healthy",
      status: text(translationKey("Running")),
      facts: facts,
    };
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

    const assessment: Assessment = assessContainer(row, input.now);
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
