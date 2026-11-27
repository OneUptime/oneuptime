import { CloudConnectorTransport } from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../Server/Utils/DataSource/HttpFetch";
import Dictionary from "../../../../Types/Dictionary";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";

/*
 * AZURE RESOURCE MANAGER IN A TEST, for acting on savings (#11010): Entra
 * ID's client-credentials sign-in, then the VM, managed disk, snapshot and
 * public IP calls the savings actions make, answered with the JSON ARM
 * answers with (Compute 2024-03-01, Disks 2023-04-02, Network 2023-09-01)
 * and every failure in ARM's own shape - {"error": {"code", "message"}} -
 * with its status: 403 AuthorizationFailed naming the action refused, 404
 * ResourceNotFound, 409 ScopeLocked for a lock, 409 OperationNotAllowed
 * for what Azure will not do, 400 for a public IP still in use. A DELETE
 * of what is not there answers 204, as ARM does.
 *
 * Resources move as they do in Azure: a VM goes through "deallocating" and
 * "starting" for as many reads as a test says, a snapshot is "Creating"
 * until it has succeeded. ARM ids are matched without case, as ARM matches
 * them. A request with no api-version is refused, as ARM refuses it.
 */

export const FAKE_AZURE_TENANT: string = "b3c1b5fc-828c-45fa-a1e1-10d74f6d6e9c";
export const FAKE_AZURE_CLIENT: string = "00001111-aaaa-2222-bbbb-3333cccc4444";
export const FAKE_AZURE_TOKEN: string = "arm-access-token";

export type FakeAzurePowerState =
  | "running"
  | "starting"
  | "stopping"
  | "stopped"
  | "deallocating"
  | "deallocated";

export interface FakeAzureVm {
  id: string;
  vmSize: string;
  powerState: FakeAzurePowerState;
  location?: string | undefined;
  // Reads a VM stays "deallocating", "stopping" or "starting" for (1 when absent).
  transitionReads?: number | undefined;
  // Sizes a resize is refused with OperationNotAllowed, as one not offered where the VM runs.
  refusedSizes?: Array<string> | undefined;
}

export interface FakeAzureDisk {
  id: string;
  location: string;
  skuName: string;
  zones?: Array<string> | undefined;
  tags?: Record<string, string> | undefined;
  diskSizeGB: number;
  diskState: "Unattached" | "Attached" | "Reserved" | "ActiveSAS";
  managedBy?: string | undefined;
  // What it was made from, when made by a PUT.
  sourceResourceId?: string | undefined;
}

export interface FakeAzureSnapshot {
  id: string;
  location: string;
  sourceResourceId: string;
  provisioningState: "Creating" | "Succeeded" | "Failed";
  tags?: Record<string, string> | undefined;
  incremental?: boolean | undefined;
  skuName?: string | undefined;
  diskSizeGB?: number | undefined;
}

export interface FakeAzurePublicIp {
  id: string;
  ipAddress: string;
  ipConfigurationId?: string | undefined;
  natGatewayId?: string | undefined;
}

export interface FakeAzureCall {
  method: string;
  // The id the request named, as written.
  path: string;
  apiVersion: string;
  // The RBAC action Azure checks for it.
  action: string;
  body?: JSONObject | undefined;
}

export interface FakeAzureSavings {
  transport: CloudConnectorTransport;
  vms: Map<string, FakeAzureVm>;
  disks: Map<string, FakeAzureDisk>;
  snapshots: Map<string, FakeAzureSnapshot>;
  publicIps: Map<string, FakeAzurePublicIp>;
  calls: Array<FakeAzureCall>;
  // The calls that change something, by the action Azure checks: every one but a read.
  writes: () => Array<string>;
  // How many times the app signed in.
  signIns: () => number;
}

const API_VERSIONS: Record<string, string> = {
  virtualmachines: "2024-03-01",
  disks: "2023-04-02",
  snapshots: "2023-04-02",
  publicipaddresses: "2023-09-01",
};

function answer(
  status: number,
  body: JSONObject | null,
  headers: Dictionary<string> = {},
): DataSourceHttpResponse {
  const bodyText: string = body === null ? "" : JSON.stringify(body);

  return {
    statusCode: status,
    bodyText,
    bodyJson: body === null ? undefined : body,
    headers,
  };
}

function armError(
  status: number,
  code: string,
  message: string,
): DataSourceHttpResponse {
  return answer(status, { error: { code, message } });
}

// The name at the end of an ARM id.
function nameOf(id: string): string {
  return id.slice(id.lastIndexOf("/") + 1);
}

// "/subscriptions/s/resourceGroups/rg/providers/Microsoft.Compute/disks/d": its resource group.
function resourceGroupOf(id: string): string {
  const parts: Array<string> = id.split("/");
  const index: number = parts.findIndex((part: string): boolean => {
    return part.toLowerCase() === "resourcegroups";
  });

  return index >= 0 ? parts[index + 1] || "" : "";
}

export function createFakeAzureSavings(
  data: {
    vms?: Array<FakeAzureVm> | undefined;
    disks?: Array<FakeAzureDisk> | undefined;
    snapshots?: Array<FakeAzureSnapshot> | undefined;
    publicIps?: Array<FakeAzurePublicIp> | undefined;
    // RBAC actions the app may take ("Microsoft.Compute/disks/delete"): every one when absent.
    allowedActions?: Array<string> | undefined;
    // Resources a lock holds (CanNotDelete): no write or delete goes through.
    lockedIds?: Array<string> | undefined;
    // Reads a new snapshot stays "Creating" for (1 when absent).
    snapshotCreatingReads?: number | undefined;
  } = {},
): FakeAzureSavings {
  const byId: <T extends { id: string }>(
    items: Array<T> | undefined,
  ) => Map<string, T> = <T extends { id: string }>(
    items: Array<T> | undefined,
  ): Map<string, T> => {
    return new Map(
      (items || []).map((item: T): [string, T] => {
        return [item.id.toLowerCase(), { ...item }];
      }),
    );
  };
  const vms: Map<string, FakeAzureVm> = byId(data.vms);
  const disks: Map<string, FakeAzureDisk> = byId(data.disks);
  const snapshots: Map<string, FakeAzureSnapshot> = byId(data.snapshots);
  const publicIps: Map<string, FakeAzurePublicIp> = byId(data.publicIps);
  const locked: Set<string> = new Set(
    (data.lockedIds || []).map((id: string): string => {
      return id.toLowerCase();
    }),
  );
  const calls: Array<FakeAzureCall> = [];
  const settling: Map<string, number> = new Map();
  let signIns: number = 0;

  for (const vm of vms.values()) {
    if (["deallocating", "stopping", "starting"].includes(vm.powerState)) {
      settling.set(vm.id.toLowerCase(), vm.transitionReads || 1);
    }
  }

  for (const snapshot of snapshots.values()) {
    if (snapshot.provisioningState === "Creating") {
      settling.set(snapshot.id.toLowerCase(), data.snapshotCreatingReads || 1);
    }
  }

  // Whether a resource in transition has settled, on this read.
  function settle(key: string): boolean {
    const left: number = settling.get(key) || 0;

    if (left <= 1) {
      settling.delete(key);
      return true;
    }

    settling.set(key, left - 1);
    return false;
  }

  function notFound(type: string, id: string): DataSourceHttpResponse {
    return armError(
      404,
      "ResourceNotFound",
      `The Resource '${type}/${nameOf(id)}' under resource group '${resourceGroupOf(
        id,
      )}' was not found. For more details please go to https://aka.ms/ARMResourceNotFoundFix`,
    );
  }

  function vmJson(vm: FakeAzureVm, expand: boolean): JSONObject {
    const key: string = vm.id.toLowerCase();

    if (
      ["deallocating", "stopping", "starting"].includes(vm.powerState) &&
      expand &&
      settle(key)
    ) {
      vm.powerState =
        vm.powerState === "deallocating"
          ? "deallocated"
          : vm.powerState === "stopping"
            ? "stopped"
            : "running";
    }

    return {
      id: vm.id,
      name: nameOf(vm.id),
      type: "Microsoft.Compute/virtualMachines",
      location: vm.location || "westeurope",
      properties: {
        vmId: "0f0ba7cc-b2a1-4b8c-8d5c-example",
        hardwareProfile: { vmSize: vm.vmSize },
        provisioningState: "Succeeded",
        ...(expand
          ? {
              instanceView: {
                statuses: [
                  {
                    code: "ProvisioningState/succeeded",
                    level: "Info",
                    displayStatus: "Provisioning succeeded",
                  },
                  {
                    code: `PowerState/${vm.powerState}`,
                    level: "Info",
                    displayStatus: `VM ${vm.powerState}`,
                  },
                ],
              },
            }
          : {}),
      },
    };
  }

  function diskJson(disk: FakeAzureDisk): JSONObject {
    return {
      id: disk.id,
      name: nameOf(disk.id),
      type: "Microsoft.Compute/disks",
      location: disk.location,
      sku: { name: disk.skuName, tier: disk.skuName.split("_")[0] || "" },
      ...(disk.zones ? { zones: disk.zones } : {}),
      ...(disk.tags ? { tags: disk.tags } : {}),
      ...(disk.managedBy ? { managedBy: disk.managedBy } : {}),
      properties: {
        diskSizeGB: disk.diskSizeGB,
        diskState: disk.diskState,
        provisioningState: "Succeeded",
        creationData: disk.sourceResourceId
          ? { createOption: "Copy", sourceResourceId: disk.sourceResourceId }
          : { createOption: "Empty" },
      },
    };
  }

  // A snapshot as ARM answers it; a read moves one that is being made along.
  function snapshotJson(
    snapshot: FakeAzureSnapshot,
    isRead: boolean,
  ): JSONObject {
    const key: string = snapshot.id.toLowerCase();

    if (snapshot.provisioningState === "Creating" && isRead && settle(key)) {
      snapshot.provisioningState = "Succeeded";
    }

    return {
      id: snapshot.id,
      name: nameOf(snapshot.id),
      type: "Microsoft.Compute/snapshots",
      location: snapshot.location,
      sku: { name: snapshot.skuName || "Standard_LRS", tier: "Standard" },
      ...(snapshot.tags ? { tags: snapshot.tags } : {}),
      properties: {
        creationData: {
          createOption: "Copy",
          sourceResourceId: snapshot.sourceResourceId,
        },
        incremental: Boolean(snapshot.incremental),
        diskSizeGB: snapshot.diskSizeGB || 0,
        provisioningState: snapshot.provisioningState,
      },
    };
  }

  function publicIpJson(address: FakeAzurePublicIp): JSONObject {
    return {
      id: address.id,
      name: nameOf(address.id),
      type: "Microsoft.Network/publicIPAddresses",
      location: "westeurope",
      sku: { name: "Standard", tier: "Regional" },
      properties: {
        ipAddress: address.ipAddress,
        publicIPAllocationMethod: "Static",
        provisioningState: "Succeeded",
        ...(address.ipConfigurationId
          ? { ipConfiguration: { id: address.ipConfigurationId } }
          : {}),
        ...(address.natGatewayId
          ? { natGateway: { id: address.natGatewayId } }
          : {}),
      },
    };
  }

  // What a request is: the resource's collection and id, and the action Azure checks.
  function route(
    method: string,
    path: string,
  ): {
    collection: string;
    id: string;
    verb: string;
    action: string;
  } | null {
    const lower: string = path.toLowerCase();
    let id: string = path;
    let verb: string = "";

    for (const suffix of ["/deallocate", "/start"]) {
      if (method === "POST" && lower.endsWith(suffix)) {
        id = path.slice(0, path.length - suffix.length);
        verb = suffix.slice(1);
      }
    }

    const collections: Array<[string, string]> = [
      ["/providers/microsoft.compute/virtualmachines/", "virtualmachines"],
      ["/providers/microsoft.compute/disks/", "disks"],
      ["/providers/microsoft.compute/snapshots/", "snapshots"],
      ["/providers/microsoft.network/publicipaddresses/", "publicipaddresses"],
    ];
    const found: [string, string] | undefined = collections.find(
      (entry: [string, string]): boolean => {
        return id.toLowerCase().includes(entry[0]);
      },
    );

    if (!found) {
      return null;
    }

    const types: Record<string, string> = {
      virtualmachines: "Microsoft.Compute/virtualMachines",
      disks: "Microsoft.Compute/disks",
      snapshots: "Microsoft.Compute/snapshots",
      publicipaddresses: "Microsoft.Network/publicIPAddresses",
    };
    const type: string = types[found[1]]!;
    const action: string = verb
      ? `${type}/${verb}/action`
      : method === "GET"
        ? `${type}/read`
        : method === "DELETE"
          ? `${type}/delete`
          : `${type}/write`;

    return { collection: found[1], id, verb, action };
  }

  function arm(
    method: string,
    path: string,
    body: JSONObject,
    expand: boolean,
  ): DataSourceHttpResponse {
    const request: ReturnType<typeof route> = route(method, path);

    if (!request) {
      return armError(
        400,
        "InvalidResourceType",
        `The resource type could not be found in the namespace for path '${path}'.`,
      );
    }

    const key: string = request.id.toLowerCase();

    switch (request.collection) {
      case "virtualmachines": {
        const vm: FakeAzureVm | undefined = vms.get(key);

        if (!vm) {
          return notFound("Microsoft.Compute/virtualMachines", request.id);
        }

        if (method === "GET") {
          return answer(200, vmJson(vm, expand));
        }

        if (request.verb === "deallocate") {
          if (vm.powerState !== "deallocated") {
            vm.powerState = "deallocating";
            settling.set(key, vm.transitionReads || 1);
          }

          return answer(202, null, {
            "azure-asyncoperation": `https://management.azure.com/subscriptions/x/providers/Microsoft.Compute/locations/westeurope/operations/${key.length}`,
          });
        }

        if (request.verb === "start") {
          if (vm.powerState === "deallocating") {
            return armError(
              409,
              "OperationNotAllowed",
              `Operation 'start' is not allowed on VM '${nameOf(vm.id)}' since the VM is deallocating.`,
            );
          }

          if (vm.powerState === "deallocated" || vm.powerState === "stopped") {
            vm.powerState = "starting";
            settling.set(key, vm.transitionReads || 1);
          }

          return answer(202, null);
        }

        // PATCH: the one setting it names.
        const size: string = String(
          ((
            (body["properties"] as JSONObject | undefined)?.[
              "hardwareProfile"
            ] as JSONObject | undefined
          )?.["vmSize"] as string | undefined) || "",
        );

        if ((vm.refusedSizes || []).includes(size)) {
          return armError(
            409,
            "OperationNotAllowed",
            `The requested VM size ${size} is not available in the current region. The sizes available in the current region are: Standard_B2s,Standard_D2s_v5.`,
          );
        }

        if (size) {
          vm.vmSize = size;
        }

        return answer(200, vmJson(vm, false));
      }
      case "disks": {
        const disk: FakeAzureDisk | undefined = disks.get(key);

        if (method === "GET") {
          return disk
            ? answer(200, diskJson(disk))
            : notFound("Microsoft.Compute/disks", request.id);
        }

        if (method === "DELETE") {
          if (!disk) {
            return answer(204, null);
          }

          if (disk.managedBy) {
            return armError(
              409,
              "OperationNotAllowed",
              `Disk ${nameOf(disk.id)} is attached to VM ${disk.managedBy}.`,
            );
          }

          disks.delete(key);
          return answer(200, null);
        }

        // PUT: a disk made from a snapshot, as the undo of a delete makes one.
        const creation: JSONObject =
          ((body["properties"] as JSONObject | undefined)?.["creationData"] as
            | JSONObject
            | undefined) || {};
        const source: string = String(creation["sourceResourceId"] || "");
        const snapshot: FakeAzureSnapshot | undefined = snapshots.get(
          source.toLowerCase(),
        );

        if (disk) {
          return answer(200, diskJson(disk));
        }

        if (!snapshot || snapshot.provisioningState !== "Succeeded") {
          return notFound("Microsoft.Compute/snapshots", source || "none");
        }

        const made: FakeAzureDisk = {
          id: request.id,
          location: String(body["location"] || ""),
          skuName: String(
            (body["sku"] as JSONObject | undefined)?.["name"] || "Standard_LRS",
          ),
          zones: Array.isArray(body["zones"])
            ? (body["zones"] as Array<string>)
            : undefined,
          tags: (body["tags"] as Record<string, string> | undefined) || {},
          diskSizeGB: snapshot.diskSizeGB || 0,
          diskState: "Unattached",
          sourceResourceId: source,
        };

        disks.set(key, made);
        return answer(202, diskJson(made));
      }
      case "snapshots": {
        const snapshot: FakeAzureSnapshot | undefined = snapshots.get(key);

        if (method === "GET") {
          return snapshot
            ? answer(200, snapshotJson(snapshot, true))
            : notFound("Microsoft.Compute/snapshots", request.id);
        }

        if (method === "DELETE") {
          if (!snapshot) {
            return answer(204, null);
          }

          snapshots.delete(key);
          return answer(200, null);
        }

        // PUT: a snapshot of a disk - sent again, the one made.
        if (snapshot) {
          return answer(200, snapshotJson(snapshot, false));
        }

        const creation: JSONObject =
          ((body["properties"] as JSONObject | undefined)?.["creationData"] as
            | JSONObject
            | undefined) || {};
        const source: string = String(creation["sourceResourceId"] || "");
        const disk: FakeAzureDisk | undefined = disks.get(source.toLowerCase());

        if (!disk) {
          return notFound("Microsoft.Compute/disks", source || "none");
        }

        const made: FakeAzureSnapshot = {
          id: request.id,
          location: String(body["location"] || ""),
          sourceResourceId: source,
          provisioningState: "Creating",
          tags: (body["tags"] as Record<string, string> | undefined) || {},
          incremental: Boolean(
            (body["properties"] as JSONObject | undefined)?.["incremental"],
          ),
          skuName: String(
            (body["sku"] as JSONObject | undefined)?.["name"] || "",
          ),
          diskSizeGB: disk.diskSizeGB,
        };

        snapshots.set(key, made);
        // Read "Creating" at least once, as a new snapshot is.
        settling.set(key, (data.snapshotCreatingReads || 1) + 1);
        return answer(202, snapshotJson(made, false));
      }
      default: {
        const address: FakeAzurePublicIp | undefined = publicIps.get(key);

        if (method === "GET") {
          return address
            ? answer(200, publicIpJson(address))
            : notFound("Microsoft.Network/publicIPAddresses", request.id);
        }

        if (!address) {
          return answer(204, null);
        }

        if (address.ipConfigurationId) {
          return armError(
            400,
            "PublicIPAddressInUse",
            `Public IP address ${address.id} can not be deleted since it is still allocated to resource ${address.ipConfigurationId}. In order to delete the public IP, disassociate/detach the Public IP address from the resource.`,
          );
        }

        publicIps.delete(key);
        return answer(200, null);
      }
    }
  }

  const transport: CloudConnectorTransport = async (
    request: DataSourceHttpRequest,
  ): Promise<DataSourceHttpResponse> => {
    const url: URL = new URL(request.url);
    let response: DataSourceHttpResponse;

    if (
      url.host === "login.microsoftonline.com" &&
      url.pathname === `/${FAKE_AZURE_TENANT}/oauth2/v2.0/token` &&
      request.method === "POST"
    ) {
      const form: Dictionary<string> =
        (request.body as Dictionary<string> | undefined) || {};

      signIns++;
      response =
        form["client_id"] === FAKE_AZURE_CLIENT &&
        form["grant_type"] === "client_credentials"
          ? answer(200, {
              token_type: "Bearer",
              expires_in: 3599,
              access_token: FAKE_AZURE_TOKEN,
            })
          : answer(401, {
              error: "invalid_client",
              error_description:
                "AADSTS7000215: Invalid client secret provided.",
            });
    } else if (url.host !== "management.azure.com") {
      throw new BadDataException(
        `Data source responded with HTTP 404: no fake route for ${url.host}`,
      );
    } else if (
      request.headers?.["Authorization"] !== `Bearer ${FAKE_AZURE_TOKEN}`
    ) {
      response = armError(
        401,
        "AuthenticationFailed",
        "Authentication failed. The 'Authorization' header is missing.",
      );
    } else {
      const apiVersion: string = url.searchParams.get("api-version") || "";
      const body: JSONObject =
        typeof request.body === "string" && request.body
          ? (JSON.parse(request.body) as JSONObject)
          : {};
      const resolved: ReturnType<typeof route> = route(
        request.method,
        url.pathname,
      );

      calls.push({
        method: request.method,
        path: url.pathname,
        apiVersion,
        action: resolved?.action || "",
        ...(request.body ? { body } : {}),
      });

      if (!apiVersion) {
        response = armError(
          400,
          "MissingApiVersionParameter",
          "The api-version query parameter (?api-version=) is required for all requests.",
        );
      } else if (
        resolved &&
        API_VERSIONS[resolved.collection] &&
        API_VERSIONS[resolved.collection] !== apiVersion
      ) {
        response = armError(
          400,
          "NoRegisteredProviderFound",
          `No registered resource provider found for API version '${apiVersion}'.`,
        );
      } else if (
        resolved &&
        data.allowedActions &&
        !data.allowedActions.includes(resolved.action)
      ) {
        response = armError(
          403,
          "AuthorizationFailed",
          `The client '${FAKE_AZURE_CLIENT}' with object id '5a8d6a3b-1d8e-4f0c-9c1a-example' does not have authorization to perform action '${resolved.action}' over scope '${resolved.id}' or the scope is invalid. If access was recently granted, please refresh your credentials.`,
        );
      } else if (
        resolved &&
        request.method !== "GET" &&
        locked.has(resolved.id.toLowerCase())
      ) {
        response = armError(
          409,
          "ScopeLocked",
          `The scope '${resolved.id}' cannot perform ${
            request.method === "DELETE" ? "delete" : "write"
          } operation because following scope(s) are locked: '${resolved.id}'. Please remove the lock and try again.`,
        );
      } else {
        response = arm(
          request.method,
          url.pathname,
          body,
          url.searchParams.get("$expand") === "instanceView",
        );
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
    vms,
    disks,
    snapshots,
    publicIps,
    calls,
    writes: (): Array<string> => {
      return calls
        .filter((call: FakeAzureCall): boolean => {
          return call.method !== "GET";
        })
        .map((call: FakeAzureCall): string => {
          return call.action;
        });
    },
    signIns: (): number => {
      return signIns;
    },
  };
}
