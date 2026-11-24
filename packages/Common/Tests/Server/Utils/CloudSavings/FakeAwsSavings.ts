import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../Server/Utils/DataSource/HttpFetch";
import { CloudConnectorTransport } from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import BadDataException from "../../../../Types/Exception/BadDataException";

/*
 * EC2 AND RDS IN A TEST, for acting on savings (#11010): the Query
 * protocol AWS's SDKs send (a form-encoded POST naming its Action, signed
 * with SigV4), answered in the XML each service answers with, and every
 * error in the shape each service writes it - EC2's <Response><Errors>,
 * RDS's <ErrorResponse> - with AWS's own codes and statuses, so the
 * client's reading of them is tested against the real thing. The shapes
 * are the ones AWS's API references document (EC2 API version
 * 2016-11-15, RDS API version 2014-10-31).
 *
 * Resources move as they do in AWS: a stopped instance goes through
 * "stopping" and a started one through "pending", for as many reads as a
 * test says; a snapshot is "pending" until it completes; a volume is
 * changed once every six hours at most. A call the credential may not
 * make (allowedActions) is refused as AWS refuses it: EC2 with
 * UnauthorizedOperation, RDS with AccessDenied, both 403.
 */

export interface FakeInstance {
  id: string;
  type: string;
  state: "pending" | "running" | "stopping" | "stopped" | "terminated";
  // Reads an instance stays "stopping" or "pending" for (1 when absent).
  transitionReads?: number | undefined;
  // Types ModifyInstanceAttribute refuses with InvalidParameterValue.
  refusedTypes?: Array<string> | undefined;
}

export interface FakeVolume {
  id: string;
  type: string;
  size: number;
  iops?: number | undefined;
  throughput?: number | undefined;
  zone: string;
  state: "available" | "in-use" | "creating";
  attachedTo?: string | undefined;
  tags?: Record<string, string> | undefined;
  encrypted?: boolean | undefined;
  // When it was last changed (ModifyVolume): EBS changes a volume once every six hours.
  lastModifiedAt?: Date | undefined;
}

export interface FakeSnapshot {
  id: string;
  volumeId: string;
  state: "pending" | "completed" | "error";
  // Reads a new snapshot stays pending for (1 when absent).
  pendingReads?: number | undefined;
  usedByImage?: string | undefined;
  tags?: Record<string, string> | undefined;
}

export interface FakeAddress {
  allocationId: string;
  publicIp: string;
  associationId?: string | undefined;
  instanceId?: string | undefined;
}

export interface FakeDatabase {
  id: string;
  instanceClass: string;
  status: "available" | "stopping" | "stopped" | "starting" | "modifying";
  // Refuse a stop as an Aurora cluster member is refused.
  isClusterMember?: boolean | undefined;
  transitionReads?: number | undefined;
}

export interface FakeAwsSavingsCall {
  service: "ec2" | "rds";
  region: string;
  action: string;
  params: Record<string, string>;
}

export interface FakeAwsSavings {
  transport: CloudConnectorTransport;
  instances: Map<string, FakeInstance>;
  volumes: Map<string, FakeVolume>;
  snapshots: Map<string, FakeSnapshot>;
  addresses: Map<string, FakeAddress>;
  databases: Map<string, FakeDatabase>;
  calls: Array<FakeAwsSavingsCall>;
  // The calls that change something: every action that is not a Describe.
  writes: () => Array<string>;
}

// The reads EC2 and RDS answer, which change nothing.
function isRead(action: string): boolean {
  return action.startsWith("Describe");
}

function xmlEscape(value: string): string {
  return value
    .split("&")
    .join("&amp;")
    .split("<")
    .join("&lt;")
    .split(">")
    .join("&gt;");
}

function ec2Error(
  status: number,
  code: string,
  message: string,
): DataSourceHttpResponse {
  const bodyText: string = `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Errors><Error><Code>${code}</Code><Message>${xmlEscape(
    message,
  )}</Message></Error></Errors><RequestID>ea966190-f9aa-478e-9ede-example</RequestID></Response>`;

  return { statusCode: status, bodyText, bodyJson: undefined, headers: {} };
}

function rdsError(
  status: number,
  code: string,
  message: string,
): DataSourceHttpResponse {
  const bodyText: string = `<ErrorResponse xmlns="http://rds.amazonaws.com/doc/2014-10-31/"><Error><Type>Sender</Type><Code>${code}</Code><Message>${xmlEscape(
    message,
  )}</Message></Error><RequestId>5e5e2a2e-0d47-4b9e-example</RequestId></ErrorResponse>`;

  return { statusCode: status, bodyText, bodyJson: undefined, headers: {} };
}

function ok(bodyText: string): DataSourceHttpResponse {
  return { statusCode: 200, bodyText, bodyJson: undefined, headers: {} };
}

function ec2Answer(action: string, inner: string): DataSourceHttpResponse {
  return ok(
    `<?xml version="1.0" encoding="UTF-8"?>\n<${action}Response xmlns="http://ec2.amazonaws.com/doc/2016-11-15/"><requestId>59dbff89-35bd-4eac-99ed-example</requestId>${inner}</${action}Response>`,
  );
}

function rdsAnswer(action: string, inner: string): DataSourceHttpResponse {
  return ok(
    `<${action}Response xmlns="http://rds.amazonaws.com/doc/2014-10-31/"><${action}Result>${inner}</${action}Result><ResponseMetadata><RequestId>abc-example</RequestId></ResponseMetadata></${action}Response>`,
  );
}

function tagSet(tags: Record<string, string> | undefined): string {
  return `<tagSet>${Object.entries(tags || {})
    .map(([key, value]: [string, string]): string => {
      return `<item><key>${xmlEscape(key)}</key><value>${xmlEscape(
        value,
      )}</value></item>`;
    })
    .join("")}</tagSet>`;
}

// The tags a TagSpecification of a create carried.
function readTagSpecification(
  params: Record<string, string>,
): Record<string, string> {
  const tags: Record<string, string> = {};

  for (let index: number = 1; index <= 50; index++) {
    const key: string | undefined =
      params[`TagSpecification.1.Tag.${index}.Key`];

    if (key === undefined) {
      break;
    }

    tags[key] = params[`TagSpecification.1.Tag.${index}.Value`] || "";
  }

  return tags;
}

export function createFakeAwsSavings(
  data: {
    instances?: Array<FakeInstance> | undefined;
    volumes?: Array<FakeVolume> | undefined;
    snapshots?: Array<FakeSnapshot> | undefined;
    addresses?: Array<FakeAddress> | undefined;
    databases?: Array<FakeDatabase> | undefined;
    // "ec2:StopInstances"... - every action when absent.
    allowedActions?: Array<string> | undefined;
    now?: (() => Date) | undefined;
  } = {},
): FakeAwsSavings {
  const instances: Map<string, FakeInstance> = new Map(
    (data.instances || []).map((instance: FakeInstance) => {
      return [instance.id, { ...instance }];
    }),
  );
  const volumes: Map<string, FakeVolume> = new Map(
    (data.volumes || []).map((volume: FakeVolume) => {
      return [volume.id, { ...volume }];
    }),
  );
  const snapshots: Map<string, FakeSnapshot> = new Map(
    (data.snapshots || []).map((snapshot: FakeSnapshot) => {
      return [snapshot.id, { ...snapshot }];
    }),
  );
  const addresses: Map<string, FakeAddress> = new Map(
    (data.addresses || []).map((address: FakeAddress) => {
      return [address.allocationId, { ...address }];
    }),
  );
  const databases: Map<string, FakeDatabase> = new Map(
    (data.databases || []).map((database: FakeDatabase) => {
      return [database.id, { ...database }];
    }),
  );
  const calls: Array<FakeAwsSavingsCall> = [];
  // Reads left before a resource in transition settles.
  const settling: Map<string, number> = new Map();
  const clientTokens: Map<string, string> = new Map();
  let nextId: number = 1;
  const now: () => Date =
    data.now ||
    ((): Date => {
      return new Date("2026-11-24T19:00:00Z");
    });

  // A resource that starts out moving settles after its transitionReads.
  for (const instance of instances.values()) {
    if (instance.state === "stopping" || instance.state === "pending") {
      settling.set(instance.id, instance.transitionReads || 1);
    }
  }

  for (const database of databases.values()) {
    if (database.status === "stopping" || database.status === "starting") {
      settling.set(database.id, database.transitionReads || 1);
    }
  }

  function newId(prefix: string): string {
    return `${prefix}-0${String(nextId++).padStart(16, "0")}`;
  }

  function settle(id: string): boolean {
    const left: number = settling.get(id) || 0;

    if (left <= 1) {
      settling.delete(id);
      return true;
    }

    settling.set(id, left - 1);
    return false;
  }

  function describeInstance(instance: FakeInstance): string {
    if (instance.state === "stopping" && settle(instance.id)) {
      instance.state = "stopped";
    } else if (instance.state === "pending" && settle(instance.id)) {
      instance.state = "running";
    }

    const codes: Record<string, number> = {
      pending: 0,
      running: 16,
      "shutting-down": 32,
      terminated: 48,
      stopping: 64,
      stopped: 80,
    };

    return `<item><instanceId>${instance.id}</instanceId><instanceType>${instance.type}</instanceType><instanceState><code>${codes[instance.state]}</code><name>${instance.state}</name></instanceState><blockDeviceMapping><item><deviceName>/dev/xvda</deviceName></item></blockDeviceMapping></item>`;
  }

  function ec2(
    action: string,
    params: Record<string, string>,
  ): DataSourceHttpResponse {
    switch (action) {
      case "DescribeInstances": {
        const instance: FakeInstance | undefined = instances.get(
          params["InstanceId.1"] || "",
        );

        if (!instance) {
          return ec2Error(
            400,
            "InvalidInstanceID.NotFound",
            `The instance ID '${params["InstanceId.1"]}' does not exist`,
          );
        }

        return ec2Answer(
          action,
          `<reservationSet><item><reservationId>r-1234567890abcdef0</reservationId><instancesSet>${describeInstance(
            instance,
          )}</instancesSet></item></reservationSet>`,
        );
      }
      case "StopInstances":
      case "StartInstances": {
        const instance: FakeInstance | undefined = instances.get(
          params["InstanceId.1"] || "",
        );

        if (!instance) {
          return ec2Error(
            400,
            "InvalidInstanceID.NotFound",
            `The instance ID '${params["InstanceId.1"]}' does not exist`,
          );
        }

        const previous: string = instance.state;

        if (action === "StartInstances" && instance.state === "stopping") {
          return ec2Error(
            400,
            "IncorrectInstanceState",
            `The instance '${instance.id}' is not in a state from which it can be started.`,
          );
        }

        if (action === "StopInstances" && instance.state === "running") {
          instance.state = "stopping";
          settling.set(instance.id, instance.transitionReads || 1);
        }

        if (action === "StartInstances" && instance.state === "stopped") {
          instance.state = "pending";
          settling.set(instance.id, instance.transitionReads || 1);
        }

        return ec2Answer(
          action,
          `<instancesSet><item><instanceId>${instance.id}</instanceId><currentState><name>${instance.state}</name></currentState><previousState><name>${previous}</name></previousState></item></instancesSet>`,
        );
      }
      case "ModifyInstanceAttribute": {
        const instance: FakeInstance | undefined = instances.get(
          params["InstanceId"] || "",
        );

        if (!instance) {
          return ec2Error(
            400,
            "InvalidInstanceID.NotFound",
            `The instance ID '${params["InstanceId"]}' does not exist`,
          );
        }

        if (instance.state !== "stopped") {
          return ec2Error(
            400,
            "IncorrectInstanceState",
            `The instance '${instance.id}' is not in the 'stopped' state.`,
          );
        }

        const type: string = params["InstanceType.Value"] || "";

        if ((instance.refusedTypes || []).includes(type)) {
          return ec2Error(
            400,
            "InvalidParameterValue",
            `The requested instance type '${type}' is not supported by the instance's AMI.`,
          );
        }

        instance.type = type;
        return ec2Answer(action, "<return>true</return>");
      }
      case "DescribeVolumes": {
        const volume: FakeVolume | undefined = volumes.get(
          params["VolumeId.1"] || "",
        );

        if (!volume) {
          return ec2Error(
            400,
            "InvalidVolume.NotFound",
            `The volume '${params["VolumeId.1"]}' does not exist.`,
          );
        }

        return ec2Answer(
          action,
          `<volumeSet><item><volumeId>${volume.id}</volumeId><size>${volume.size}</size><snapshotId/><availabilityZone>${volume.zone}</availabilityZone><status>${volume.state}</status><createTime>2025-01-10T10:00:00.000Z</createTime><attachmentSet>${
            volume.attachedTo
              ? `<item><volumeId>${volume.id}</volumeId><instanceId>${volume.attachedTo}</instanceId><device>/dev/sdf</device><status>attached</status></item>`
              : ""
          }</attachmentSet>${tagSet(volume.tags)}<volumeType>${volume.type}</volumeType>${
            volume.iops ? `<iops>${volume.iops}</iops>` : ""
          }${
            volume.throughput
              ? `<throughput>${volume.throughput}</throughput>`
              : ""
          }<encrypted>${volume.encrypted ? "true" : "false"}</encrypted><multiAttachEnabled>false</multiAttachEnabled></item></volumeSet>`,
        );
      }
      case "ModifyVolume": {
        const volume: FakeVolume | undefined = volumes.get(
          params["VolumeId"] || "",
        );

        if (!volume) {
          return ec2Error(
            400,
            "InvalidVolume.NotFound",
            `The volume '${params["VolumeId"]}' does not exist.`,
          );
        }

        if (
          volume.lastModifiedAt &&
          now().getTime() - volume.lastModifiedAt.getTime() < 6 * 60 * 60 * 1000
        ) {
          return ec2Error(
            400,
            "VolumeModificationRateExceeded",
            "You've reached the maximum modification rate per volume limit. Wait at least 6 hours between modifications per EBS volume.",
          );
        }

        const from: string = volume.type;
        volume.type = params["VolumeType"] || volume.type;
        volume.iops = params["Iops"] ? Number(params["Iops"]) : volume.iops;
        volume.throughput = params["Throughput"]
          ? Number(params["Throughput"])
          : volume.throughput;
        volume.lastModifiedAt = now();

        return ec2Answer(
          action,
          `<volumeModification><volumeId>${volume.id}</volumeId><modificationState>modifying</modificationState><targetVolumeType>${volume.type}</targetVolumeType><originalVolumeType>${from}</originalVolumeType></volumeModification>`,
        );
      }
      case "CreateSnapshot": {
        const volume: FakeVolume | undefined = volumes.get(
          params["VolumeId"] || "",
        );

        if (!volume) {
          return ec2Error(
            400,
            "InvalidVolume.NotFound",
            `The volume '${params["VolumeId"]}' does not exist.`,
          );
        }

        const id: string = newId("snap");
        snapshots.set(id, {
          id,
          volumeId: volume.id,
          state: "pending",
          tags: readTagSpecification(params),
        });
        // Read pending at least once, as a new snapshot is.
        settling.set(id, 2);

        return ec2Answer(
          action,
          `<snapshotId>${id}</snapshotId><volumeId>${volume.id}</volumeId><status>pending</status><startTime>2026-11-24T19:00:00.000Z</startTime><progress/><ownerId>123456789012</ownerId><volumeSize>${volume.size}</volumeSize>`,
        );
      }
      case "DescribeSnapshots": {
        const snapshot: FakeSnapshot | undefined = snapshots.get(
          params["SnapshotId.1"] || "",
        );

        if (!snapshot) {
          return ec2Error(
            400,
            "InvalidSnapshot.NotFound",
            `The snapshot '${params["SnapshotId.1"]}' does not exist.`,
          );
        }

        if (snapshot.state === "pending" && settle(snapshot.id)) {
          snapshot.state = "completed";
        }

        return ec2Answer(
          action,
          `<snapshotSet><item><snapshotId>${snapshot.id}</snapshotId><volumeId>${snapshot.volumeId}</volumeId><status>${snapshot.state}</status><progress>${
            snapshot.state === "completed" ? "100%" : "40%"
          }</progress>${tagSet(snapshot.tags)}</item></snapshotSet>`,
        );
      }
      case "DeleteVolume": {
        const volume: FakeVolume | undefined = volumes.get(
          params["VolumeId"] || "",
        );

        if (!volume) {
          return ec2Error(
            400,
            "InvalidVolume.NotFound",
            `The volume '${params["VolumeId"]}' does not exist.`,
          );
        }

        if (volume.state === "in-use") {
          return ec2Error(
            400,
            "VolumeInUse",
            `Volume ${volume.id} is currently attached to ${volume.attachedTo}`,
          );
        }

        volumes.delete(volume.id);
        return ec2Answer(action, "<return>true</return>");
      }
      case "CreateVolume": {
        const token: string = params["ClientToken"] || "";

        if (token && clientTokens.has(token)) {
          return ec2Answer(
            action,
            `<volumeId>${clientTokens.get(token)}</volumeId><status>creating</status>`,
          );
        }

        const snapshot: FakeSnapshot | undefined = snapshots.get(
          params["SnapshotId"] || "",
        );

        if (!snapshot || snapshot.state !== "completed") {
          return ec2Error(
            400,
            "InvalidSnapshot.NotFound",
            `The snapshot '${params["SnapshotId"]}' does not exist.`,
          );
        }

        const id: string = newId("vol");
        volumes.set(id, {
          id,
          type: params["VolumeType"] || "gp2",
          size: 100,
          iops: params["Iops"] ? Number(params["Iops"]) : undefined,
          throughput: params["Throughput"]
            ? Number(params["Throughput"])
            : undefined,
          zone: params["AvailabilityZone"] || "",
          state: "creating",
          tags: readTagSpecification(params),
        });

        if (token) {
          clientTokens.set(token, id);
        }

        return ec2Answer(
          action,
          `<volumeId>${id}</volumeId><size>100</size><snapshotId>${snapshot.id}</snapshotId><availabilityZone>${params["AvailabilityZone"]}</availabilityZone><status>creating</status><volumeType>${params["VolumeType"]}</volumeType>`,
        );
      }
      case "DeleteSnapshot": {
        const snapshot: FakeSnapshot | undefined = snapshots.get(
          params["SnapshotId"] || "",
        );

        if (!snapshot) {
          return ec2Error(
            400,
            "InvalidSnapshot.NotFound",
            `The snapshot '${params["SnapshotId"]}' does not exist.`,
          );
        }

        if (snapshot.usedByImage) {
          return ec2Error(
            400,
            "InvalidSnapshot.InUse",
            `The snapshot ${snapshot.id} is currently in use by ${snapshot.usedByImage}`,
          );
        }

        snapshots.delete(snapshot.id);
        return ec2Answer(action, "<return>true</return>");
      }
      case "DescribeAddresses": {
        const address: FakeAddress | undefined = addresses.get(
          params["AllocationId.1"] || "",
        );

        if (!address) {
          return ec2Error(
            400,
            "InvalidAllocationID.NotFound",
            `The allocation ID '${params["AllocationId.1"]}' does not exist`,
          );
        }

        return ec2Answer(
          action,
          `<addressesSet><item><publicIp>${address.publicIp}</publicIp><allocationId>${address.allocationId}</allocationId><domain>vpc</domain>${
            address.associationId
              ? `<associationId>${address.associationId}</associationId><instanceId>${address.instanceId || ""}</instanceId>`
              : ""
          }</item></addressesSet>`,
        );
      }
      case "ReleaseAddress": {
        const address: FakeAddress | undefined = addresses.get(
          params["AllocationId"] || "",
        );

        if (!address) {
          return ec2Error(
            400,
            "InvalidAllocationID.NotFound",
            `The allocation ID '${params["AllocationId"]}' does not exist`,
          );
        }

        if (address.associationId) {
          return ec2Error(
            400,
            "InvalidIPAddress.InUse",
            `Address ${address.publicIp} is in use.`,
          );
        }

        addresses.delete(address.allocationId);
        return ec2Answer(action, "<return>true</return>");
      }
      default:
        return ec2Error(
          400,
          "InvalidAction",
          `The action ${action} is not valid for this web service.`,
        );
    }
  }

  function rds(
    action: string,
    params: Record<string, string>,
  ): DataSourceHttpResponse {
    const database: FakeDatabase | undefined = databases.get(
      params["DBInstanceIdentifier"] || "",
    );

    if (!database) {
      return rdsError(
        404,
        "DBInstanceNotFound",
        `DBInstance ${params["DBInstanceIdentifier"]} not found.`,
      );
    }

    const instance: () => string = (): string => {
      return `<DBInstance><DBInstanceIdentifier>${database.id}</DBInstanceIdentifier><DBInstanceClass>${database.instanceClass}</DBInstanceClass><Engine>postgres</Engine><DBInstanceStatus>${database.status}</DBInstanceStatus><PendingModifiedValues><DBInstanceClass>db.x2g.16xlarge</DBInstanceClass></PendingModifiedValues></DBInstance>`;
    };

    switch (action) {
      case "DescribeDBInstances":
        if (database.status === "stopping" && settle(database.id)) {
          database.status = "stopped";
        } else if (database.status === "starting" && settle(database.id)) {
          database.status = "available";
        }

        return rdsAnswer(action, `<DBInstances>${instance()}</DBInstances>`);
      case "StopDBInstance":
        if (database.isClusterMember) {
          return rdsError(
            400,
            "InvalidParameterCombination",
            "aurora-postgresql DB instances are not eligible for stopping and starting.",
          );
        }

        if (database.status !== "available") {
          return rdsError(
            400,
            "InvalidDBInstanceState",
            `Instance ${database.id} is not in available state.`,
          );
        }

        database.status = "stopping";
        settling.set(database.id, database.transitionReads || 1);
        return rdsAnswer(action, instance());
      case "StartDBInstance":
        if (database.status !== "stopped") {
          return rdsError(
            400,
            "InvalidDBInstanceState",
            `Instance ${database.id} is not stopped, it is ${database.status}.`,
          );
        }

        database.status = "starting";
        settling.set(database.id, database.transitionReads || 1);
        return rdsAnswer(action, instance());
      case "ModifyDBInstance":
        database.instanceClass =
          params["DBInstanceClass"] || database.instanceClass;
        database.status = "modifying";
        return rdsAnswer(action, instance());
      default:
        return rdsError(400, "InvalidAction", `Unknown action ${action}.`);
    }
  }

  const transport: CloudConnectorTransport = async (
    request: DataSourceHttpRequest,
  ): Promise<DataSourceHttpResponse> => {
    const url: URL = new URL(request.url);
    const [service, region] = url.host.split(".");
    const params: Record<string, string> = {};

    for (const [key, value] of new URLSearchParams(
      typeof request.body === "string" ? request.body : "",
    )) {
      params[key] = value;
    }

    const action: string = params["Action"] || "";
    const authorization: string = String(
      Object.entries(request.headers || {}).find(
        ([name]: [string, unknown]): boolean => {
          return name.toLowerCase() === "authorization";
        },
      )?.[1] || "",
    );

    if (
      (service !== "ec2" && service !== "rds") ||
      request.method !== "POST" ||
      !authorization.startsWith("AWS4-HMAC-SHA256")
    ) {
      throw new BadDataException(
        `Data source responded with HTTP 404: no fake route for ${url.host}`,
      );
    }

    calls.push({ service, region: region || "", action, params });

    let response: DataSourceHttpResponse;

    if (
      data.allowedActions &&
      !data.allowedActions.includes(`${service}:${action}`)
    ) {
      response =
        service === "ec2"
          ? ec2Error(
              403,
              "UnauthorizedOperation",
              `You are not authorized to perform this operation. User: arn:aws:sts::123456789012:assumed-role/OneUptimeReadOnly/oneuptime is not authorized to perform: ec2:${action} because no identity-based policy allows the ec2:${action} action.`,
            )
          : rdsError(
              403,
              "AccessDenied",
              `User: arn:aws:sts::123456789012:assumed-role/OneUptimeReadOnly/oneuptime is not authorized to perform: rds:${action} because no identity-based policy allows the rds:${action} action`,
            );
    } else {
      response = service === "ec2" ? ec2(action, params) : rds(action, params);
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
    volumes,
    snapshots,
    addresses,
    databases,
    calls,
    writes: (): Array<string> => {
      return calls
        .filter((call: FakeAwsSavingsCall): boolean => {
          return !isRead(call.action);
        })
        .map((call: FakeAwsSavingsCall): string => {
          return `${call.service}:${call.action}`;
        });
    },
  };
}
