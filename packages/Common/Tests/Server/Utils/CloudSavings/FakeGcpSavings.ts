import jwt from "jsonwebtoken";
import { CloudConnectorTransport } from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../Server/Utils/DataSource/HttpFetch";
import Dictionary from "../../../../Types/Dictionary";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";

/*
 * COMPUTE ENGINE IN A TEST, for acting on savings (#11010): Google's OAuth
 * token endpoint, taking a service account's signed JWT, then the
 * instance, disk, snapshot, address and image calls of Compute Engine's
 * v1 API, answered with the JSON it answers with - a write answered with
 * the compute#operation Google runs on its own - and every failure in
 * Google's own shape, {"error": {"code", "message", "errors": [{"reason"}]}}:
 * 403 "Required '<permission>' permission for '<resource>'", 404
 * notFound, 400 resourceInUseByAnotherResource and resourceNotReady, 409
 * alreadyExists.
 *
 * Resources move as they do in Compute Engine: a stopped instance goes
 * through STOPPING to TERMINATED, a started one through STAGING to
 * RUNNING, and a new snapshot is CREATING, each for as many reads as a
 * test says. A call the service account may not make (allowedPermissions)
 * is refused naming the first permission it lacks.
 */

export type FakeGcpInstanceStatus =
  | "PROVISIONING"
  | "STAGING"
  | "RUNNING"
  | "STOPPING"
  | "TERMINATED"
  | "SUSPENDED"
  | "REPAIRING";

export interface FakeGcpInstance {
  project: string;
  zone: string;
  name: string;
  status: FakeGcpInstanceStatus;
  machineType: string;
  // Reads an instance stays STOPPING or STAGING for (1 when absent).
  transitionReads?: number | undefined;
  // Machine types setMachineType refuses, as ones the zone does not offer.
  refusedTypes?: Array<string> | undefined;
}

export interface FakeGcpDisk {
  project: string;
  // A zone's disk, or a Region's.
  zone?: string | undefined;
  region?: string | undefined;
  name: string;
  type: string;
  sizeGb: number;
  users?: Array<string> | undefined;
  labels?: Record<string, string> | undefined;
  status?: "READY" | "CREATING" | "RESTORING" | "DELETING" | undefined;
  replicaZones?: Array<string> | undefined;
  sourceSnapshot?: string | undefined;
}

export interface FakeGcpSnapshot {
  project: string;
  name: string;
  sourceDisk: string;
  status: "CREATING" | "READY" | "FAILED";
  labels?: Record<string, string> | undefined;
}

export interface FakeGcpAddress {
  project: string;
  // A Region's address, or a global one when absent.
  region?: string | undefined;
  name: string;
  address: string;
  status: "RESERVED" | "IN_USE";
  users?: Array<string> | undefined;
}

export interface FakeGcpImage {
  project: string;
  name: string;
}

export interface FakeGcpCall {
  method: string;
  // The path under /compute/v1/.
  path: string;
  // The permissions Compute Engine checks for it.
  permissions: Array<string>;
  body?: JSONObject | undefined;
}

export interface FakeGcpSavings {
  transport: CloudConnectorTransport;
  instances: Map<string, FakeGcpInstance>;
  disks: Map<string, FakeGcpDisk>;
  snapshots: Map<string, FakeGcpSnapshot>;
  addresses: Map<string, FakeGcpAddress>;
  images: Map<string, FakeGcpImage>;
  calls: Array<FakeGcpCall>;
  // The scope each sign-in asked for.
  scopes: Array<string>;
  // The calls that change something, by the first permission each needs: every one but a read.
  writes: () => Array<string>;
}

export const FAKE_GCP_TOKEN: string = "ya29.compute-token";

const API_ROOT: string = "/compute/v1/";

function answer(status: number, body: JSONObject): DataSourceHttpResponse {
  return {
    statusCode: status,
    bodyText: JSON.stringify(body),
    bodyJson: body,
    headers: {},
  };
}

function googleError(
  status: number,
  reason: string,
  message: string,
): DataSourceHttpResponse {
  return answer(status, {
    error: {
      code: status,
      message,
      errors: [{ message, domain: "global", reason }],
    },
  });
}

// The key a resource is kept by: its path under the project, as Compute Engine names it.
export function instanceKey(instance: FakeGcpInstance): string {
  return `projects/${instance.project}/zones/${instance.zone}/instances/${instance.name}`;
}

export function diskKey(disk: FakeGcpDisk): string {
  return disk.region
    ? `projects/${disk.project}/regions/${disk.region}/disks/${disk.name}`
    : `projects/${disk.project}/zones/${disk.zone}/disks/${disk.name}`;
}

export function snapshotKey(snapshot: FakeGcpSnapshot): string {
  return `projects/${snapshot.project}/global/snapshots/${snapshot.name}`;
}

export function addressKey(address: FakeGcpAddress): string {
  return address.region
    ? `projects/${address.project}/regions/${address.region}/addresses/${address.name}`
    : `projects/${address.project}/global/addresses/${address.name}`;
}

export function imageKey(image: FakeGcpImage): string {
  return `projects/${image.project}/global/images/${image.name}`;
}

const SELF_LINK_ROOT: string = "https://www.googleapis.com/compute/v1/";

export function createFakeGcpSavings(
  data: {
    instances?: Array<FakeGcpInstance> | undefined;
    disks?: Array<FakeGcpDisk> | undefined;
    snapshots?: Array<FakeGcpSnapshot> | undefined;
    addresses?: Array<FakeGcpAddress> | undefined;
    images?: Array<FakeGcpImage> | undefined;
    // IAM permissions the service account holds ("compute.disks.delete"): every one when absent.
    allowedPermissions?: Array<string> | undefined;
    // Answer every Compute Engine call as an API not turned on in the project.
    isApiDisabled?: boolean | undefined;
    // Reads a new snapshot stays CREATING for (1 when absent).
    snapshotCreatingReads?: number | undefined;
  } = {},
): FakeGcpSavings {
  const keyed: <T>(
    items: Array<T> | undefined,
    keyOf: (item: T) => string,
  ) => Map<string, T> = <T>(
    items: Array<T> | undefined,
    keyOf: (item: T) => string,
  ): Map<string, T> => {
    return new Map(
      (items || []).map((item: T): [string, T] => {
        return [keyOf(item), { ...item }];
      }),
    );
  };
  const instances: Map<string, FakeGcpInstance> = keyed(
    data.instances,
    instanceKey,
  );
  const disks: Map<string, FakeGcpDisk> = keyed(data.disks, diskKey);
  const snapshots: Map<string, FakeGcpSnapshot> = keyed(
    data.snapshots,
    snapshotKey,
  );
  const addresses: Map<string, FakeGcpAddress> = keyed(
    data.addresses,
    addressKey,
  );
  const images: Map<string, FakeGcpImage> = keyed(data.images, imageKey);
  const calls: Array<FakeGcpCall> = [];
  const scopes: Array<string> = [];
  const settling: Map<string, number> = new Map();
  let operations: number = 0;

  for (const [key, instance] of instances) {
    if (instance.status === "STOPPING" || instance.status === "STAGING") {
      settling.set(key, instance.transitionReads || 1);
    }
  }

  for (const [key, snapshot] of snapshots) {
    if (snapshot.status === "CREATING") {
      settling.set(key, data.snapshotCreatingReads || 1);
    }
  }

  function settle(key: string): boolean {
    const left: number = settling.get(key) || 0;

    if (left <= 1) {
      settling.delete(key);
      return true;
    }

    settling.set(key, left - 1);
    return false;
  }

  function notFound(path: string): DataSourceHttpResponse {
    return googleError(404, "notFound", `The resource '${path}' was not found`);
  }

  // A write Google accepted, and runs on its own.
  function operation(
    type: string,
    target: string,
    zone?: string,
  ): DataSourceHttpResponse {
    operations++;

    return answer(200, {
      kind: "compute#operation",
      id: String(4410394835736512000 + operations),
      name: `operation-1732474800000-${operations}`,
      operationType: type,
      targetLink: `${SELF_LINK_ROOT}${target}`,
      status: "RUNNING",
      progress: 0,
      insertTime: "2026-11-24T19:00:00.000-08:00",
      ...(zone ? { zone: `${SELF_LINK_ROOT}${zone}` } : {}),
    });
  }

  // What a request is, and the permissions Compute Engine checks for it, in the order it checks them.
  function permissionsOf(method: string, path: string): Array<string> {
    const parts: Array<string> = path.split("/");
    const scope: string = parts[2] || "";
    const collection: string =
      scope === "global" ? parts[3] || "" : parts[4] || "";
    const verb: string = scope === "global" ? parts[5] || "" : parts[6] || "";
    const isItem: boolean =
      scope === "global" ? parts.length >= 5 : parts.length >= 6;

    if (collection === "instances") {
      if (method === "GET") {
        return ["compute.instances.get"];
      }

      return [
        verb === "setMachineType"
          ? "compute.instances.setMachineType"
          : `compute.instances.${verb}`,
      ];
    }

    if (collection === "disks") {
      if (!isItem) {
        return ["compute.disks.create", "compute.snapshots.useReadOnly"];
      }

      if (verb === "createSnapshot") {
        return ["compute.disks.createSnapshot", "compute.snapshots.create"];
      }

      return [method === "GET" ? "compute.disks.get" : "compute.disks.delete"];
    }

    if (collection === "snapshots") {
      return ["compute.snapshots.get"];
    }

    if (collection === "addresses") {
      const family: string =
        scope === "global" ? "compute.globalAddresses" : "compute.addresses";
      return [`${family}.${method === "GET" ? "get" : "delete"}`];
    }

    if (collection === "images") {
      return [`compute.images.${method === "GET" ? "get" : "delete"}`];
    }

    return [];
  }

  function instanceJson(instance: FakeGcpInstance): JSONObject {
    const key: string = instanceKey(instance);

    if (instance.status === "STOPPING" && settle(key)) {
      instance.status = "TERMINATED";
    } else if (instance.status === "STAGING" && settle(key)) {
      instance.status = "RUNNING";
    }

    return {
      kind: "compute#instance",
      id: "4410394835736512345",
      name: instance.name,
      zone: `${SELF_LINK_ROOT}projects/${instance.project}/zones/${instance.zone}`,
      machineType: `${SELF_LINK_ROOT}projects/${instance.project}/zones/${instance.zone}/machineTypes/${instance.machineType}`,
      status: instance.status,
      selfLink: `${SELF_LINK_ROOT}${key}`,
    };
  }

  function diskJson(disk: FakeGcpDisk): JSONObject {
    const place: string = disk.region
      ? `regions/${disk.region}`
      : `zones/${disk.zone}`;

    return {
      kind: "compute#disk",
      id: "7720394835736512345",
      name: disk.name,
      // An int64, which Compute Engine's JSON writes as text.
      sizeGb: String(disk.sizeGb),
      type: `${SELF_LINK_ROOT}projects/${disk.project}/${place}/diskTypes/${disk.type}`,
      status: disk.status || "READY",
      ...(disk.users && disk.users.length > 0 ? { users: disk.users } : {}),
      ...(disk.labels ? { labels: disk.labels } : {}),
      ...(disk.replicaZones ? { replicaZones: disk.replicaZones } : {}),
      ...(disk.sourceSnapshot ? { sourceSnapshot: disk.sourceSnapshot } : {}),
      selfLink: `${SELF_LINK_ROOT}${diskKey(disk)}`,
    };
  }

  function compute(
    method: string,
    path: string,
    body: JSONObject,
  ): DataSourceHttpResponse {
    const parts: Array<string> = path.split("/");
    const project: string = parts[1] || "";

    // projects/{p}/zones/{z}/instances/{i}[/verb]
    if (parts[2] === "zones" && parts[4] === "instances") {
      const key: string = parts.slice(0, 6).join("/");
      const instance: FakeGcpInstance | undefined = instances.get(key);

      if (!instance) {
        return notFound(key);
      }

      const verb: string = parts[6] || "";

      if (method === "GET") {
        return answer(200, instanceJson(instance));
      }

      if (verb === "stop") {
        if (["RUNNING", "PROVISIONING", "STAGING"].includes(instance.status)) {
          instance.status = "STOPPING";
          settling.set(key, instance.transitionReads || 1);
        }

        return operation("stop", key, `projects/${project}/zones/${parts[3]}`);
      }

      if (verb === "start") {
        if (instance.status === "STOPPING") {
          return googleError(
            400,
            "resourceNotReady",
            `The resource '${key}' is not ready`,
          );
        }

        if (instance.status === "TERMINATED") {
          instance.status = "STAGING";
          settling.set(key, instance.transitionReads || 1);
        }

        return operation("start", key, `projects/${project}/zones/${parts[3]}`);
      }

      if (verb === "setMachineType") {
        const machineType: string = String(body["machineType"] || "");
        const type: string = machineType.slice(
          machineType.lastIndexOf("/") + 1,
        );

        if (instance.status !== "TERMINATED") {
          return googleError(
            400,
            "resourceNotReady",
            `The resource '${key}' is not ready`,
          );
        }

        if (
          machineType !== `zones/${instance.zone}/machineTypes/${type}` ||
          (instance.refusedTypes || []).includes(type)
        ) {
          return googleError(
            400,
            "invalid",
            `Invalid value for field 'resource.machineType': '${machineType}'. Machine type with name '${type}' does not exist in zone '${instance.zone}'.`,
          );
        }

        instance.machineType = type;
        return operation(
          "setMachineType",
          key,
          `projects/${project}/zones/${parts[3]}`,
        );
      }

      return googleError(400, "invalid", `Invalid action ${verb}.`);
    }

    // projects/{p}/(zones|regions)/{place}/disks[/{d}[/createSnapshot]]
    if (
      (parts[2] === "zones" || parts[2] === "regions") &&
      parts[4] === "disks"
    ) {
      if (parts.length === 5) {
        // disks.insert, from a snapshot.
        const name: string = String(body["name"] || "");
        const key: string = `${path}/${name}`;
        const source: string = String(body["sourceSnapshot"] || "");
        const snapshotName: string = source.slice(source.lastIndexOf("/") + 1);
        const snapshot: FakeGcpSnapshot | undefined = snapshots.get(
          `projects/${project}/global/snapshots/${snapshotName}`,
        );

        if (disks.has(key)) {
          return googleError(
            409,
            "alreadyExists",
            `The resource '${key}' already exists`,
          );
        }

        if (!snapshot || snapshot.status !== "READY") {
          return notFound(
            `projects/${project}/global/snapshots/${snapshotName}`,
          );
        }

        const type: string = String(body["type"] || "");

        disks.set(key, {
          project,
          ...(parts[2] === "zones" ? { zone: parts[3] } : { region: parts[3] }),
          name,
          type: type.slice(type.lastIndexOf("/") + 1) || "pd-standard",
          sizeGb: Number(body["sizeGb"]) || 10,
          labels: (body["labels"] as Record<string, string> | undefined) || {},
          replicaZones: Array.isArray(body["replicaZones"])
            ? (body["replicaZones"] as Array<string>)
            : undefined,
          sourceSnapshot: source,
          status: "READY",
        });

        return operation("insert", key);
      }

      const key: string = parts.slice(0, 6).join("/");
      const disk: FakeGcpDisk | undefined = disks.get(key);

      if (!disk) {
        return notFound(key);
      }

      if (method === "GET") {
        return answer(200, diskJson(disk));
      }

      if (parts[6] === "createSnapshot") {
        const name: string = String(body["name"] || "");
        const snapshotPath: string = `projects/${project}/global/snapshots/${name}`;

        if (snapshots.has(snapshotPath)) {
          return googleError(
            409,
            "alreadyExists",
            `The resource '${snapshotPath}' already exists`,
          );
        }

        snapshots.set(snapshotPath, {
          project,
          name,
          sourceDisk: key,
          status: "CREATING",
          labels: (body["labels"] as Record<string, string> | undefined) || {},
        });
        // Read CREATING at least once, as a new snapshot is.
        settling.set(snapshotPath, (data.snapshotCreatingReads || 1) + 1);

        return operation("createSnapshot", key);
      }

      // DELETE
      if (disk.users && disk.users.length > 0) {
        return googleError(
          400,
          "resourceInUseByAnotherResource",
          `The disk resource '${key}' is already being used by '${disk.users[0]}'`,
        );
      }

      disks.delete(key);
      return operation("delete", key);
    }

    // projects/{p}/global/snapshots/{s}
    if (parts[2] === "global" && parts[3] === "snapshots") {
      const key: string = parts.slice(0, 5).join("/");
      const snapshot: FakeGcpSnapshot | undefined = snapshots.get(key);

      if (!snapshot) {
        return notFound(key);
      }

      if (snapshot.status === "CREATING" && settle(key)) {
        snapshot.status = "READY";
      }

      return answer(200, {
        kind: "compute#snapshot",
        name: snapshot.name,
        status: snapshot.status,
        sourceDisk: `${SELF_LINK_ROOT}${snapshot.sourceDisk}`,
        storageBytes: "21474836480",
        ...(snapshot.labels ? { labels: snapshot.labels } : {}),
      });
    }

    // projects/{p}/regions/{r}/addresses/{a} or projects/{p}/global/addresses/{a}
    const isGlobalAddress: boolean =
      parts[2] === "global" && parts[3] === "addresses";

    if (
      isGlobalAddress ||
      (parts[2] === "regions" && parts[4] === "addresses")
    ) {
      const key: string = parts.slice(0, isGlobalAddress ? 5 : 6).join("/");
      const address: FakeGcpAddress | undefined = addresses.get(key);

      if (!address) {
        return notFound(key);
      }

      if (method === "GET") {
        return answer(200, {
          kind: "compute#address",
          name: address.name,
          address: address.address,
          status: address.status,
          ...(address.users ? { users: address.users } : {}),
        });
      }

      if (address.status === "IN_USE") {
        return googleError(
          400,
          "resourceInUseByAnotherResource",
          `The address resource '${key}' is already being used by '${(address.users || [])[0] || "a forwarding rule"}'`,
        );
      }

      addresses.delete(key);
      return operation("delete", key);
    }

    // projects/{p}/global/images/{i}
    if (parts[2] === "global" && parts[3] === "images") {
      const key: string = parts.slice(0, 5).join("/");
      const image: FakeGcpImage | undefined = images.get(key);

      if (!image) {
        return notFound(key);
      }

      if (method === "GET") {
        return answer(200, {
          kind: "compute#image",
          name: image.name,
          status: "READY",
        });
      }

      images.delete(key);
      return operation("delete", key);
    }

    return notFound(path);
  }

  const transport: CloudConnectorTransport = async (
    request: DataSourceHttpRequest,
  ): Promise<DataSourceHttpResponse> => {
    const url: URL = new URL(request.url);
    let response: DataSourceHttpResponse;

    if (
      url.host === "oauth2.googleapis.com" &&
      url.pathname === "/token" &&
      request.method === "POST"
    ) {
      const form: Dictionary<string> =
        (request.body as Dictionary<string> | undefined) || {};
      const claims: { scope?: string } | null = jwt.decode(
        String(form["assertion"] || ""),
      ) as { scope?: string } | null;

      scopes.push(claims?.scope || "");
      response = answer(200, {
        access_token: FAKE_GCP_TOKEN,
        expires_in: 3599,
        token_type: "Bearer",
      });
    } else if (
      url.host !== "compute.googleapis.com" ||
      !url.pathname.startsWith(API_ROOT)
    ) {
      throw new BadDataException(
        `Data source responded with HTTP 404: no fake route for ${url.host}${url.pathname}`,
      );
    } else if (
      request.headers?.["Authorization"] !== `Bearer ${FAKE_GCP_TOKEN}`
    ) {
      response = googleError(
        401,
        "authError",
        "Request had invalid authentication credentials. Expected OAuth 2 access token, login cookie or other valid authentication credential.",
      );
    } else {
      const path: string = decodeURIComponent(
        url.pathname.slice(API_ROOT.length),
      );
      const body: JSONObject =
        typeof request.body === "string" && request.body
          ? (JSON.parse(request.body) as JSONObject)
          : {};
      const permissions: Array<string> = permissionsOf(request.method, path);
      const missing: string | undefined = data.allowedPermissions
        ? permissions.find((permission: string): boolean => {
            return !data.allowedPermissions!.includes(permission);
          })
        : undefined;

      calls.push({
        method: request.method,
        path,
        permissions,
        ...(request.body ? { body } : {}),
      });

      if (data.isApiDisabled) {
        response = googleError(
          403,
          "accessNotConfigured",
          `Compute Engine API has not been used in project ${path.split("/")[1]} before or it is disabled. Enable it by visiting https://console.developers.google.com/apis/api/compute.googleapis.com/overview then retry.`,
        );
      } else if (missing) {
        const resource: string = path
          .split("/")
          .slice(0, path.split("/")[2] === "global" ? 5 : 6)
          .join("/");

        response = googleError(
          403,
          "forbidden",
          `Required '${missing}' permission for '${resource}'`,
        );
      } else {
        response = compute(request.method, path, body);
      }
    }

    if (response.statusCode >= 300 && !request.acceptAnyStatus) {
      throw new BadDataException(
        `Data source responded with HTTP ${response.statusCode}: ${response.bodyText.substring(0, 500)}`,
      );
    }

    return response;
  };

  return {
    transport,
    instances,
    disks,
    snapshots,
    addresses,
    images,
    calls,
    scopes,
    writes: (): Array<string> => {
      return calls
        .filter((call: FakeGcpCall): boolean => {
          return call.method !== "GET";
        })
        .map((call: FakeGcpCall): string => {
          return call.permissions[0] || "";
        });
    },
  };
}
