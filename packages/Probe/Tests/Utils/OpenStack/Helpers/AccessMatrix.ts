import fs from "fs";
import path from "path";
import { JSONObject } from "Common/Types/JSON";
import {
  OpenStackHttpRequest,
  OpenStackHttpResponse,
} from "../../../../Utils/OpenStack/OpenStackHttp";
import {
  FIXTURES_ROOT,
  RecordedScene,
  jsonAnswer,
  recordedJson,
} from "./RecordedCloud";

/*
 * What each way of giving a monitoring credential access really read on a real cloud.
 * Tests/Ops/openstack-e2e/access-matrix.sh asked every read as each credential and wrote
 * down its status, how many rows came back, and whether that was all an admin saw.
 *
 * The answers here replay that. A refusal is the status it was. A list that saw everything
 * is the recording's. A list that saw less only has its count on record, not its rows, so
 * it is made from the recording's: the rows anyone may see, then this credential's own
 * project's, then any others, moved to its project, up to that count.
 */

export type AccessMatrixFile =
  | "matrix-default-policy"
  | "matrix"
  | "matrix-access-rules";

export interface AccessMatrixCell {
  status: number;
  count: number | null;
  seesAll: boolean;
}

export interface AccessMatrixRead {
  service: string;
  read: string;
  path: string;
  results: Record<string, AccessMatrixCell>;
}

export function loadAccessMatrix(
  release: string,
  file: AccessMatrixFile,
): Array<AccessMatrixRead> {
  return (
    JSON.parse(
      fs.readFileSync(
        path.join(FIXTURES_ROOT, release, "access", `${file}.json`),
        "utf8",
      ),
    ) as { reads: Array<AccessMatrixRead> }
  ).reads;
}

// Where a catalog of the recording's kind puts each, against what the matrix calls it.
const SERVICE_PREFIXES: ReadonlyArray<{
  prefix: string;
  service: string;
  // What the matrix's path starts after: Keystone's and Neutron's have their version.
  strip: string;
}> = [
  { prefix: "/identity/", service: "identity", strip: "/identity" },
  { prefix: "/compute/v2.1/", service: "compute", strip: "/compute/v2.1" },
  { prefix: "/placement/", service: "placement", strip: "/placement" },
  { prefix: "/networking/", service: "network", strip: "/networking" },
  { prefix: "/volume/v3/", service: "block-storage", strip: "/volume/v3" },
  { prefix: "/image/", service: "image", strip: "/image" },
];

// A list's recording, by what the matrix calls the read.
const NARROWED_LISTS: Readonly<
  Record<string, { file: string; key: string; projectField?: string }>
> = {
  "volumes, all projects": {
    file: "cinder-volumes",
    key: "volumes",
    projectField: "os-vol-tenant-attr:tenant_id",
  },
  "snapshots, all projects": {
    file: "cinder-snapshots",
    key: "snapshots",
    projectField: "os-extended-snapshot-attributes:project_id",
  },
  "backups, all projects": {
    file: "cinder-backups",
    key: "backups",
    projectField: "os-backup-project-attr:project_id",
  },
  agents: { file: "neutron-agents", key: "agents" },
  networks: { file: "neutron-networks", key: "networks" },
  subnets: { file: "neutron-subnets", key: "subnets" },
  routers: { file: "neutron-routers", key: "routers" },
  "floating IPs": { file: "neutron-floatingips", key: "floatingips" },
  "IP availabilities": {
    file: "neutron-ip-availabilities",
    key: "network_ip_availabilities",
  },
  "security groups": {
    file: "neutron-security-groups",
    key: "security_groups",
  },
  ports: { file: "neutron-ports-limited", key: "ports" },
};

function isAnyones(row: JSONObject): boolean {
  return row["shared"] === true || row["router:external"] === true;
}

function narrowedRows(data: {
  rows: Array<JSONObject>;
  count: number;
  ownProjectId: string;
  projectField: string;
}): Array<JSONObject> {
  const isOwn: (row: JSONObject) => boolean = (row: JSONObject): boolean => {
    return row[data.projectField] === data.ownProjectId;
  };

  const inOrder: Array<JSONObject> = [
    ...data.rows.filter(isAnyones),
    ...data.rows.filter((row: JSONObject): boolean => {
      return !isAnyones(row) && isOwn(row);
    }),
    ...data.rows.filter((row: JSONObject): boolean => {
      return !isAnyones(row) && !isOwn(row);
    }),
  ];

  return inOrder.slice(0, data.count).map((row: JSONObject): JSONObject => {
    return isAnyones(row)
      ? row
      : {
          ...row,
          [data.projectField]: data.ownProjectId,
          ...(data.projectField === "project_id"
            ? { tenant_id: data.ownProjectId }
            : {}),
        };
  });
}

function findRead(
  reads: ReadonlyArray<AccessMatrixRead>,
  pathname: string,
): AccessMatrixRead | undefined {
  for (const { prefix, service, strip } of SERVICE_PREFIXES) {
    if (!pathname.startsWith(prefix)) {
      continue;
    }

    const within: string = pathname.substring(strip.length);

    return reads.find((read: AccessMatrixRead): boolean => {
      return read.service === service && read.path.split("?")[0] === within;
    });
  }

  return undefined;
}

/*
 * An answer function for createRecordedCloud: refuses and narrows as this credential was
 * refused and narrowed, and leaves everything else to the recording.
 */
export function answerAsCredential(data: {
  scene: RecordedScene;
  reads: ReadonlyArray<AccessMatrixRead>;
  credential: string;
  ownProjectId: string;
}): (request: OpenStackHttpRequest) => OpenStackHttpResponse | undefined {
  const refusal: (status: number) => OpenStackHttpResponse = (
    status: number,
  ): OpenStackHttpResponse => {
    return jsonAnswer(status, {
      error: { code: status, message: `Refused with ${status}.` },
    });
  };

  return (request: OpenStackHttpRequest): OpenStackHttpResponse | undefined => {
    if (request.method !== "GET") {
      return undefined;
    }

    const url: globalThis.URL = new globalThis.URL(request.url);
    const { pathname } = url;

    // Not in the matrix: the rule guarding projects guards these two as well.
    if (
      pathname === "/identity/v3/users" ||
      pathname === "/identity/v3/groups"
    ) {
      const projects: AccessMatrixRead | undefined = findRead(
        data.reads,
        "/identity/v3/projects",
      );
      const status: number | undefined =
        projects?.results[data.credential]?.status;

      return status && status !== 200 ? refusal(status) : undefined;
    }

    const read: AccessMatrixRead | undefined = findRead(data.reads, pathname);
    const cell: AccessMatrixCell | undefined = read?.results[data.credential];

    if (!read || !cell) {
      return undefined;
    }

    /*
     * Without all_tenants, Nova's list is the credential's own project for anyone, and it
     * is what a probe falls back to. What was refused was only the asking for all of it.
     */
    if (
      read.read === "servers, all projects" &&
      !url.searchParams.has("all_tenants")
    ) {
      return jsonAnswer(200, {
        servers: (
          recordedJson(data.scene, "nova-servers")?.[
            "servers"
          ] as Array<JSONObject>
        ).filter((server: JSONObject): boolean => {
          return server["tenant_id"] === data.ownProjectId;
        }),
        servers_links: [],
      });
    }

    if (cell.status !== 200) {
      return refusal(cell.status);
    }

    if (cell.seesAll) {
      return undefined;
    }

    const list:
      | { file: string; key: string; projectField?: string }
      | undefined = NARROWED_LISTS[read.read];

    if (!list) {
      return undefined;
    }

    return jsonAnswer(200, {
      [list.key]: narrowedRows({
        rows: recordedJson(data.scene, list.file)?.[
          list.key
        ] as Array<JSONObject>,
        count: cell.count ?? 0,
        ownProjectId: data.ownProjectId,
        projectField: list.projectField || "project_id",
      }),
      [`${list.key}_links`]: [],
    });
  };
}

// Which project each credential's token was scoped to, from access-matrix.sh.
export function ownProjectOf(scene: RecordedScene, credential: string): string {
  const projects: Array<JSONObject> = recordedJson(
    scene,
    "keystone-projects",
  )?.["projects"] as Array<JSONObject>;

  const named: (name: string) => string = (name: string): string => {
    return projects.find((project: JSONObject): boolean => {
      return project["name"] === name;
    })?.["id"] as string;
  };

  switch (credential) {
    case "admin":
    case "monitoring-admin-get":
      return named("admin");
    case "reader":
    case "role-on-a-project":
      return named("ou-payments");
    // A project of its own, which holds nothing and was made after this was recorded.
    default:
      return "ou-monitoring-project";
  }
}
