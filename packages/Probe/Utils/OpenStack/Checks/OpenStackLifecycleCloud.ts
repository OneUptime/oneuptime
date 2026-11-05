import {
  ClassifiedOpenStackError,
  OpenStackApiError,
  classifyOpenStackError,
  readErrorMessage,
} from "../OpenStackCollectionErrors";
import { CINDER_MICROVERSION } from "../Collectors/VolumeCollector";
import { OpenStackHttpResponse, OpenStackTransport } from "../OpenStackHttp";
import { OpenStackKeystoneSession, OpenStackToken } from "../OpenStackKeystone";
import OpenStackServiceClient, {
  OpenStackClock,
  OpenStackJsonAnswer,
  OpenStackListAnswer,
} from "../OpenStackServiceClient";
import { getOpenStackTraceHeaders } from "Common/Server/Utils/OpenStack/OpenStackTraceSigning";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import {
  OpenStackCheckFault,
  OpenStackCheckFaultSource,
  OpenStackCheckResourceKind,
} from "Common/Types/OpenStack/OpenStackCheck";
import { OpenStackServiceType } from "Common/Types/OpenStack/OpenStackResourceKind";
import {
  OpenStackCheckNamePart,
  ParsedOpenStackCheckName,
  parseOpenStackCheckName,
} from "Common/Utils/OpenStack/OpenStackCheckName";
import { readOpenStackTraceId } from "Common/Utils/OpenStack/OpenStackTraces";

/*
 * THE ONLY CODE THAT WRITES TO A CUSTOMER'S CLOUD.
 *
 * Everything the lifecycle check creates or deletes goes through this class, so what it may do is
 * what is written here and nothing else:
 *
 *   - each write asks the guard first, with whichever token is about to be used. The guard is
 *     asked before each write and not only before the run, because a token can be renewed part way
 *     through, and nothing here may outlive a refusal;
 *   - a delete takes an OpenStackOwnedResource, which only two things make: this class, of what
 *     it just created, or OpenStackOwnedResource.fromRow, of a row whose name passes
 *     parseOpenStackCheckName for this check and which names no other project. So nothing that
 *     merely looks like the check's can reach a delete, whatever anyone downstream does with it;
 *   - each URL is a service's catalog URL and a fixed path. An id from an answer goes through
 *     encodeURIComponent, so a hostile one is a name that does not exist and never a path;
 *   - no request names another project, and none asks for all_tenants.
 */

// Why the check will not go on: the guard said no. Never a fault of the cloud's.
export class OpenStackCheckRefusedError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "OpenStackCheckRefusedError";
  }
}

// What a step met: who said it, and what they said.
export class OpenStackCheckFaultError extends Error {
  public readonly fault: OpenStackCheckFault;

  public constructor(fault: OpenStackCheckFault) {
    super(fault.message);
    this.name = "OpenStackCheckFaultError";
    this.fault = fault;
  }
}

// Long enough for a sentence and short enough for a page: a traceback is not a fault.
const MAX_FAULT_LENGTH: number = 1000;

export function boundFaultMessage(message: string): string {
  const trimmed: string = message.trim();

  return trimmed.length > MAX_FAULT_LENGTH
    ? `${trimmed.substring(0, MAX_FAULT_LENGTH - 1)}…`
    : trimmed;
}

const NAME_PART_OF_KIND: Readonly<
  Record<OpenStackCheckResourceKind, OpenStackCheckNamePart>
> = {
  server: "server",
  volume: "volume",
  floating_ip: "fip",
  security_group: "sg",
};

function text(value: JSONValue | undefined): string {
  return typeof value === "string" ? value : "";
}

/*
 * When a row says it was made, in milliseconds, or null. Cinder and Neutron write their times
 * differently, and Cinder's has no zone: "2026-11-04T12:33:57.000000" is UTC, and Date.parse would
 * read it as this machine's local time.
 */
export function readOpenStackCreatedAt(
  value: JSONValue | undefined,
): number | null {
  const created: string = text(value).trim();

  if (!created) {
    return null;
  }

  const timeAt: number = created.indexOf("T");
  const clock: string = timeAt >= 0 ? created.substring(timeAt) : "";
  const hasZone: boolean =
    clock.endsWith("Z") || clock.includes("+") || clock.includes("-");
  const time: number = Date.parse(hasZone ? created : `${created}Z`);

  return Number.isNaN(time) ? null : time;
}

/*
 * Something this check made, and so may delete. Nothing else can be handed to a delete: see the
 * top of this file.
 */
export class OpenStackOwnedResource {
  public readonly kind: OpenStackCheckResourceKind;
  public readonly id: string;
  public readonly name: string;
  public readonly runId: string;
  public readonly ageInMs: number;
  public readonly row: JSONObject;

  private constructor(data: {
    kind: OpenStackCheckResourceKind;
    id: string;
    name: string;
    runId: string;
    ageInMs: number;
    row: JSONObject;
  }) {
    this.kind = data.kind;
    this.id = data.id;
    this.name = data.name;
    this.runId = data.runId;
    this.ageInMs = data.ageInMs;
    this.row = data.row;
  }

  // What a run just created. Its name was written by buildOpenStackCheckName moments ago.
  public static fromCreate(data: {
    kind: OpenStackCheckResourceKind;
    id: string;
    name: string;
    runId: string;
    row?: JSONObject | undefined;
  }): OpenStackOwnedResource {
    return new OpenStackOwnedResource({
      kind: data.kind,
      id: data.id,
      name: data.name,
      runId: data.runId,
      ageInMs: 0,
      row: data.row || {},
    });
  }

  /*
   * A row of a list, if it is this check's, or null. A floating IP has no name, so what names it
   * is its description.
   *
   * Its age is the younger of what its name says and what the service says, so a resource someone
   * named to look old is still as young as it is, and a probe whose clock jumped forward cannot
   * delete a run that is still going.
   *
   * A row that names another project is not this check's, whatever it is called. One that names
   * none is the list's own, because the token is scoped to one project and nothing here asks for
   * more: Cinder only tells an admin whose a volume is.
   */
  public static fromRow(data: {
    kind: OpenStackCheckResourceKind;
    row: JSONObject;
    checkKey: string;
    projectId: string;
    now: number;
  }): OpenStackOwnedResource | null {
    const { row } = data;
    const name: string = text(
      data.kind === "floating_ip" ? row["description"] : row["name"],
    );
    const parsed: ParsedOpenStackCheckName | null =
      parseOpenStackCheckName(name);

    if (
      !parsed ||
      parsed.checkKey !== data.checkKey ||
      parsed.part !== NAME_PART_OF_KIND[data.kind]
    ) {
      return null;
    }

    const id: string = text(row["id"]);

    if (!id) {
      return null;
    }

    for (const key of [
      "tenant_id",
      "project_id",
      "os-vol-tenant-attr:tenant_id",
    ]) {
      const owner: string = text(row[key]);

      if (owner && owner !== data.projectId) {
        return null;
      }
    }

    const createdAt: number | null = readOpenStackCreatedAt(
      row["created"] ?? row["created_at"],
    );
    const madeAt: number = Math.max(parsed.startedAt, createdAt ?? 0);

    return new OpenStackOwnedResource({
      kind: data.kind,
      id: id,
      name: name,
      runId: parsed.runId,
      ageInMs: data.now - madeAt,
      row: row,
    });
  }
}

export interface OpenStackLifecycleEndpoints {
  identity: string;
  compute: string;
  network: string;
  volume: string | null;
  image: string | null;
}

export interface OpenStackLifecycleWrite {
  method: "POST" | "DELETE";
  url: string;
}

const WRITE_TIMEOUT_IN_MS: number = 60_000;
const READ_TIMEOUT_IN_MS: number = 30_000;

// Renewed this long before it ends: a boot's next write should not meet an expired token.
const TOKEN_RENEWAL_MARGIN_IN_MS: number = 2 * 60_000;

export default class OpenStackLifecycleCloud {
  public readonly regionName: string;
  // Each write, in order: what a test holds to the letter, and what a person can be told.
  public readonly writes: Array<OpenStackLifecycleWrite> = [];

  private readonly transport: OpenStackTransport;
  private readonly clock: OpenStackClock;
  private readonly session: OpenStackKeystoneSession;
  private readonly endpoints: OpenStackLifecycleEndpoints;
  private readonly userAgent: string;
  private readonly getRefusal: (token: OpenStackToken) => string | null;
  private readonly osProfilerKey: string | undefined;
  private readonly randomUuid: () => string;
  private readonly clients: Map<string, OpenStackServiceClient> = new Map();
  private readonly hardStopAt: number;

  private traceBaseId: string | null = null;

  public constructor(data: {
    regionName: string;
    transport: OpenStackTransport;
    clock: OpenStackClock;
    session: OpenStackKeystoneSession;
    endpoints: OpenStackLifecycleEndpoints;
    userAgent: string;
    getRefusal: (token: OpenStackToken) => string | null;
    osProfilerKey?: string | undefined;
    randomUuid: () => string;
    hardStopAt: number;
  }) {
    this.regionName = data.regionName;
    this.transport = data.transport;
    this.clock = data.clock;
    this.session = data.session;
    this.endpoints = data.endpoints;
    this.userAgent = data.userAgent;
    this.getRefusal = data.getRefusal;
    this.osProfilerKey = data.osProfilerKey;
    this.randomUuid = data.randomUuid;
    this.hardStopAt = data.hardStopAt;
  }

  public hasVolumeService(): boolean {
    return this.endpoints.volume !== null;
  }

  public getRequestCount(): number {
    let reads: number = 0;

    for (const client of this.clients.values()) {
      reads += client.requestCount;
    }

    return reads + this.writes.length;
  }

  /*
   * From here on this step's writes are signed, into one trace, until the next call, so that a slow
   * boot has a trace holding the boot and nothing else. Only its writes: a signed request does more
   * work in every service it crosses, and a wait of minutes is dozens of polls saying nothing the
   * boot's own trace does not. Returns the id a trace is stored under, or null with no key.
   */
  public beginTrace(): string | null {
    if (!this.osProfilerKey) {
      this.traceBaseId = null;
      return null;
    }

    this.traceBaseId = this.randomUuid();

    return readOpenStackTraceId(this.traceBaseId);
  }

  public endTrace(): void {
    this.traceBaseId = null;
  }

  /*
   * ------------------------------------------------------------------
   * Reads
   * ------------------------------------------------------------------
   */

  private clientOf(service: OpenStackServiceType): OpenStackServiceClient {
    let client: OpenStackServiceClient | undefined = this.clients.get(service);

    if (!client) {
      client = new OpenStackServiceClient({
        service: service,
        regionName: this.regionName,
        baseUrl: this.baseUrlOf(service),
        transport: this.transport,
        clock: this.clock,
        deadlineAt: this.hardStopAt,
        session: this.session,
        userAgent: this.userAgent,
        requestTimeoutInMs: READ_TIMEOUT_IN_MS,
        headers:
          service === OpenStackServiceType.Volume
            ? { "OpenStack-API-Version": `volume ${CINDER_MICROVERSION}` }
            : {},
      });

      this.clients.set(service, client);
    }

    return client;
  }

  private baseUrlOf(service: OpenStackServiceType): string {
    switch (service) {
      case OpenStackServiceType.Identity:
        return this.endpoints.identity;
      case OpenStackServiceType.Compute:
        return this.endpoints.compute;
      case OpenStackServiceType.Network:
        return this.endpoints.network;
      case OpenStackServiceType.Volume:
        return this.endpoints.volume || "";
      case OpenStackServiceType.Image:
        return this.endpoints.image || "";
      default:
        return "";
    }
  }

  private async listOf(data: {
    service: OpenStackServiceType;
    read: string;
    path: string;
    key: string;
    paging: "links" | "next";
    query?: Record<string, string> | undefined;
  }): Promise<Array<JSONObject>> {
    try {
      const answer: OpenStackListAnswer = await this.clientOf(
        data.service,
      ).list({
        read: data.read,
        path: data.path,
        key: data.key,
        paging: data.paging,
        query: data.query,
      });

      return answer.items;
    } catch (error) {
      // Said in the words of whoever was asked, whichever step it was asked for.
      throw toCheckFaultError(error, {
        url: this.baseUrlOf(data.service),
        source: sourceOf(data.service),
      });
    }
  }

  /*
   * One of the reads only an admin gets anything from: whether rows came back. Refused or empty is
   * no. No answer at all is not a no, so it throws, and with nothing to go on the run writes nothing.
   */
  public async readsRows(data: {
    service: OpenStackServiceType;
    read: string;
    path: string;
    key: string;
    query?: Record<string, string> | undefined;
  }): Promise<boolean> {
    try {
      const answer: OpenStackJsonAnswer = await this.clientOf(data.service).get(
        {
          read: data.read,
          path: data.path,
          query: data.query,
        },
      );
      const rows: JSONValue | undefined = answer.body[data.key];

      return Array.isArray(rows) && rows.length > 0;
    } catch (error) {
      if (
        error instanceof OpenStackApiError &&
        (error.kind === "refused" || error.kind === "absent")
      ) {
        return false;
      }

      throw toCheckFaultError(error, {
        url: this.baseUrlOf(data.service),
        source: sourceOf(data.service),
      });
    }
  }

  public listServers(): Promise<Array<JSONObject>> {
    return this.listOf({
      service: OpenStackServiceType.Compute,
      read: "servers",
      path: "/servers/detail",
      key: "servers",
      paging: "links",
    });
  }

  public listVolumes(): Promise<Array<JSONObject>> {
    return this.listOf({
      service: OpenStackServiceType.Volume,
      read: "volumes",
      path: "/volumes/detail",
      key: "volumes",
      paging: "links",
    });
  }

  public listFloatingIps(): Promise<Array<JSONObject>> {
    return this.listOf({
      service: OpenStackServiceType.Network,
      read: "floating IPs",
      path: "/floatingips",
      key: "floatingips",
      paging: "links",
    });
  }

  public listSecurityGroups(): Promise<Array<JSONObject>> {
    return this.listOf({
      service: OpenStackServiceType.Network,
      read: "security groups",
      path: "/security-groups",
      key: "security_groups",
      paging: "links",
    });
  }

  public listFlavors(): Promise<Array<JSONObject>> {
    return this.listOf({
      service: OpenStackServiceType.Compute,
      read: "flavors",
      path: "/flavors/detail",
      key: "flavors",
      paging: "links",
    });
  }

  public listImages(): Promise<Array<JSONObject>> {
    return this.listOf({
      service: OpenStackServiceType.Image,
      read: "images",
      path: "/images",
      key: "images",
      paging: "next",
      query: { status: "active" },
    });
  }

  public listNetworks(): Promise<Array<JSONObject>> {
    return this.listOf({
      service: OpenStackServiceType.Network,
      read: "networks",
      path: "/networks",
      key: "networks",
      paging: "links",
    });
  }

  public async getServer(id: string): Promise<JSONObject | null> {
    return await this.getOne({
      service: OpenStackServiceType.Compute,
      read: "the server",
      path: `/servers/${encodeURIComponent(id)}`,
      key: "server",
    });
  }

  public async getVolume(id: string): Promise<JSONObject | null> {
    return await this.getOne({
      service: OpenStackServiceType.Volume,
      read: "the volume",
      path: `/volumes/${encodeURIComponent(id)}`,
      key: "volume",
    });
  }

  public async getFloatingIp(id: string): Promise<JSONObject | null> {
    return await this.getOne({
      service: OpenStackServiceType.Network,
      read: "the floating IP",
      path: `/floatingips/${encodeURIComponent(id)}`,
      key: "floatingip",
    });
  }

  // A thing by its id, or null when it is gone.
  private async getOne(data: {
    service: OpenStackServiceType;
    read: string;
    path: string;
    key: string;
  }): Promise<JSONObject | null> {
    try {
      const answer: OpenStackJsonAnswer = await this.clientOf(data.service).get(
        { read: data.read, path: data.path },
      );

      const item: JSONValue | undefined = answer.body[data.key];

      if (!item || typeof item !== "object" || Array.isArray(item)) {
        throw new OpenStackCheckFaultError({
          source: sourceOf(data.service),
          message: `Asked for ${data.read}, and the answer did not hold it.`,
        });
      }

      return item as JSONObject;
    } catch (error) {
      if (error instanceof OpenStackApiError && error.kind === "absent") {
        return null;
      }

      throw error;
    }
  }

  // The port Nova made for a server: what a floating IP is attached to.
  public async getPortOfServer(serverId: string): Promise<JSONObject | null> {
    const ports: Array<JSONObject> = await this.listOf({
      service: OpenStackServiceType.Network,
      read: "the server's port",
      path: "/ports",
      key: "ports",
      paging: "links",
      query: { device_id: serverId },
    });

    return ports[0] || null;
  }

  // What Cinder told this project about a volume, newest first. Empty on a Cinder too old to say.
  public async getVolumeMessages(volumeId: string): Promise<Array<string>> {
    const messages: Array<JSONObject> = await this.listOf({
      service: OpenStackServiceType.Volume,
      read: "what Cinder said about the volume",
      path: "/messages",
      key: "messages",
      paging: "links",
      query: { resource_uuid: volumeId },
    });

    return messages
      .sort((a: JSONObject, b: JSONObject): number => {
        return text(b["created_at"]).localeCompare(text(a["created_at"]));
      })
      .map((message: JSONObject): string => {
        return text(message["user_message"]);
      })
      .filter(Boolean);
  }

  // What Nova says became of its attempts to attach a volume to a server, newest first.
  public async getAttachActionMessage(
    serverId: string,
  ): Promise<string | null> {
    const actions: Array<JSONObject> = await this.listOf({
      service: OpenStackServiceType.Compute,
      read: "what Nova did to the server",
      path: `/servers/${encodeURIComponent(serverId)}/os-instance-actions`,
      key: "instanceActions",
      paging: "links",
    });

    const attach: JSONObject | undefined = actions.find(
      (action: JSONObject): boolean => {
        return (
          action["action"] === "attach_volume" && Boolean(action["message"])
        );
      },
    );

    return attach ? text(attach["message"]) : null;
  }

  /*
   * ------------------------------------------------------------------
   * Writes
   * ------------------------------------------------------------------
   */

  private async tokenForWrite(): Promise<OpenStackToken> {
    let token: OpenStackToken = this.session.getToken();

    if (
      token.expiresAt !== null &&
      token.expiresAt - this.clock.now() < TOKEN_RENEWAL_MARGIN_IN_MS
    ) {
      await this.session.renew(token.id);
      token = this.session.getToken();
    }

    const refusal: string | null = this.getRefusal(token);

    if (refusal) {
      throw new OpenStackCheckRefusedError(refusal);
    }

    return token;
  }

  private async write(data: {
    service: OpenStackServiceType;
    method: "POST" | "DELETE";
    path: string;
    body?: JSONObject | undefined;
    // What else counts as having worked: a thing already gone is what a delete was for.
    alsoFine?: ReadonlyArray<number> | undefined;
  }): Promise<OpenStackHttpResponse> {
    const token: OpenStackToken = await this.tokenForWrite();
    const url: string = `${this.baseUrlOf(data.service)}${data.path}`;

    this.writes.push({ method: data.method, url: url });

    let response: OpenStackHttpResponse;

    try {
      response = await this.transport({
        method: data.method,
        url: url,
        headers: {
          ...(this.clientOf(data.service).headers || {}),
          ...(data.body ? { "Content-Type": "application/json" } : {}),
          Accept: "application/json",
          "User-Agent": this.userAgent,
          "X-Auth-Token": token.id,
          ...(this.traceBaseId && this.osProfilerKey
            ? getOpenStackTraceHeaders({
                hmacKey: this.osProfilerKey,
                traceId: this.traceBaseId,
              })
            : {}),
        },
        body: data.body ? JSON.stringify(data.body) : undefined,
        timeoutInMs: Math.min(
          WRITE_TIMEOUT_IN_MS,
          Math.max(1000, this.hardStopAt - this.clock.now()),
        ),
      });
    } catch (error) {
      throw toCheckFaultError(error, {
        url: url,
        source: sourceOf(data.service),
      });
    }

    if (
      (response.status >= 200 && response.status < 300) ||
      data.alsoFine?.includes(response.status)
    ) {
      return response;
    }

    throw new OpenStackCheckFaultError({
      source: sourceOf(data.service),
      code: response.status,
      message: boundFaultMessage(
        readErrorMessage(response.body) || `HTTP ${response.status}`,
      ),
    });
  }

  private readBody(
    response: OpenStackHttpResponse,
    key: string,
    source: OpenStackCheckFaultSource,
  ): JSONObject {
    let parsed: unknown;

    try {
      parsed = JSON.parse(response.body);
    } catch {
      parsed = null;
    }

    const item: unknown =
      parsed && typeof parsed === "object"
        ? (parsed as JSONObject)[key]
        : undefined;

    if (!item || typeof item !== "object" || !(item as JSONObject)["id"]) {
      throw new OpenStackCheckFaultError({
        source: source,
        code: response.status,
        message: `It accepted the request, and its answer does not say what was made.`,
      });
    }

    return item as JSONObject;
  }

  public async createSecurityGroup(data: {
    name: string;
    runId: string;
  }): Promise<OpenStackOwnedResource> {
    const response: OpenStackHttpResponse = await this.write({
      service: OpenStackServiceType.Network,
      method: "POST",
      path: "/security-groups",
      body: {
        security_group: {
          name: data.name,
          description:
            "Made by OneUptime's lifecycle check, and deleted when the run ends. Lets a ping in.",
        },
      },
    });

    const row: JSONObject = this.readBody(
      response,
      "security_group",
      "neutron",
    );

    return OpenStackOwnedResource.fromCreate({
      kind: "security_group",
      id: text(row["id"]),
      name: data.name,
      runId: data.runId,
    });
  }

  public async allowPing(securityGroup: OpenStackOwnedResource): Promise<void> {
    await this.write({
      service: OpenStackServiceType.Network,
      method: "POST",
      path: "/security-group-rules",
      body: {
        security_group_rule: {
          security_group_id: securityGroup.id,
          direction: "ingress",
          ethertype: "IPv4",
          protocol: "icmp",
          remote_ip_prefix: "0.0.0.0/0",
        },
      },
    });
  }

  public async createServer(data: {
    name: string;
    runId: string;
    flavorId: string;
    imageId: string;
    networkId: string;
    securityGroup: OpenStackOwnedResource | null;
  }): Promise<OpenStackOwnedResource> {
    const response: OpenStackHttpResponse = await this.write({
      service: OpenStackServiceType.Compute,
      method: "POST",
      path: "/servers",
      body: {
        server: {
          name: data.name,
          flavorRef: data.flavorId,
          imageRef: data.imageId,
          networks: [{ uuid: data.networkId }],
          metadata: { "oneuptime-lifecycle-check": data.runId },
          ...(data.securityGroup
            ? { security_groups: [{ name: data.securityGroup.name }] }
            : {}),
        },
      },
    });

    const row: JSONObject = this.readBody(response, "server", "nova");

    return OpenStackOwnedResource.fromCreate({
      kind: "server",
      id: text(row["id"]),
      name: data.name,
      runId: data.runId,
    });
  }

  public async createFloatingIp(data: {
    name: string;
    runId: string;
    networkId: string;
    portId: string;
  }): Promise<{ resource: OpenStackOwnedResource; address: string }> {
    const response: OpenStackHttpResponse = await this.write({
      service: OpenStackServiceType.Network,
      method: "POST",
      path: "/floatingips",
      body: {
        floatingip: {
          floating_network_id: data.networkId,
          port_id: data.portId,
          // A floating IP has no name, so this is what says whose it is.
          description: data.name,
        },
      },
    });

    const row: JSONObject = this.readBody(response, "floatingip", "neutron");

    return {
      resource: OpenStackOwnedResource.fromCreate({
        kind: "floating_ip",
        id: text(row["id"]),
        name: data.name,
        runId: data.runId,
      }),
      address: text(row["floating_ip_address"]),
    };
  }

  public async createVolume(data: {
    name: string;
    runId: string;
    sizeInGiB: number;
    volumeType?: string | undefined;
  }): Promise<OpenStackOwnedResource> {
    const response: OpenStackHttpResponse = await this.write({
      service: OpenStackServiceType.Volume,
      method: "POST",
      path: "/volumes",
      body: {
        volume: {
          name: data.name,
          size: data.sizeInGiB,
          description: "Made by OneUptime's lifecycle check.",
          ...(data.volumeType ? { volume_type: data.volumeType } : {}),
        },
      },
    });

    const row: JSONObject = this.readBody(response, "volume", "cinder");

    return OpenStackOwnedResource.fromCreate({
      kind: "volume",
      id: text(row["id"]),
      name: data.name,
      runId: data.runId,
    });
  }

  public async attachVolume(data: {
    server: OpenStackOwnedResource;
    volume: OpenStackOwnedResource;
  }): Promise<void> {
    await this.write({
      service: OpenStackServiceType.Compute,
      method: "POST",
      path: `/servers/${encodeURIComponent(data.server.id)}/os-volume_attachments`,
      body: { volumeAttachment: { volumeId: data.volume.id } },
    });
  }

  public async detachVolume(data: {
    server: OpenStackOwnedResource;
    volume: OpenStackOwnedResource;
  }): Promise<void> {
    await this.write({
      service: OpenStackServiceType.Compute,
      method: "DELETE",
      path: `/servers/${encodeURIComponent(data.server.id)}/os-volume_attachments/${encodeURIComponent(data.volume.id)}`,
      alsoFine: [404],
    });
  }

  public async deleteVolume(volume: OpenStackOwnedResource): Promise<void> {
    await this.write({
      service: OpenStackServiceType.Volume,
      method: "DELETE",
      path: `/volumes/${encodeURIComponent(volume.id)}`,
      alsoFine: [404],
    });
  }

  public async deleteFloatingIp(
    floatingIp: OpenStackOwnedResource,
  ): Promise<void> {
    await this.write({
      service: OpenStackServiceType.Network,
      method: "DELETE",
      path: `/floatingips/${encodeURIComponent(floatingIp.id)}`,
      alsoFine: [404],
    });
  }

  public async deleteServer(server: OpenStackOwnedResource): Promise<void> {
    await this.write({
      service: OpenStackServiceType.Compute,
      method: "DELETE",
      path: `/servers/${encodeURIComponent(server.id)}`,
      alsoFine: [404],
    });
  }

  public async deleteSecurityGroup(
    securityGroup: OpenStackOwnedResource,
  ): Promise<void> {
    await this.write({
      service: OpenStackServiceType.Network,
      method: "DELETE",
      path: `/security-groups/${encodeURIComponent(securityGroup.id)}`,
      alsoFine: [404],
    });
  }
}

export function sourceOf(
  service: OpenStackServiceType,
): OpenStackCheckFaultSource {
  switch (service) {
    case OpenStackServiceType.Identity:
      return "keystone";
    case OpenStackServiceType.Compute:
      return "nova";
    case OpenStackServiceType.Network:
      return "neutron";
    case OpenStackServiceType.Volume:
      return "cinder";
    case OpenStackServiceType.Image:
      return "glance";
    default:
      return "probe";
  }
}

// Whatever went wrong, as a fault: who said it, and the sentence for it.
export function toCheckFaultError(
  error: unknown,
  context: { url: string; source: OpenStackCheckFaultSource },
): OpenStackCheckFaultError {
  if (error instanceof OpenStackCheckFaultError) {
    return error;
  }

  if (error instanceof OpenStackApiError) {
    return new OpenStackCheckFaultError({
      source: context.source,
      code: error.status,
      message: boundFaultMessage(error.message),
    });
  }

  let host: string = context.url;
  let port: number = 443;

  try {
    const url: globalThis.URL = new globalThis.URL(context.url);
    host = url.hostname;
    port = url.port ? Number.parseInt(url.port, 10) : 443;
  } catch {
    // The sentence says the URL as it is.
  }

  const classified: ClassifiedOpenStackError = classifyOpenStackError(error, {
    host: host,
    port: port,
  });

  return new OpenStackCheckFaultError({
    source: "probe",
    message: boundFaultMessage(classified.message),
  });
}
