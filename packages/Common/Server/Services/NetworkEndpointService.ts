import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/NetworkEndpoint";
import ColumnLength from "../../Types/Database/ColumnLength";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import ObjectID from "../../Types/ObjectID";
import EndpointAttachmentUtil, {
  EndpointAttachment,
  EndpointExistingRowSnapshot,
  EndpointIncomingObservation,
  EndpointIpBinding,
  EndpointUpsertContext,
  EndpointUpsertDecision,
} from "../../Utils/Monitor/EndpointAttachmentUtil";
import OuiLookupUtil from "../Utils/Monitor/OuiLookupUtil";
import QueryHelper from "../Types/Database/QueryHelper";
import logger from "../Utils/Logger";

/*
 * Rows written per statement. Endpoint rows are narrow (12 params each),
 * so 500 keeps a chunk well under Postgres' parameter ceiling while
 * turning a 4096-MAC switch into 9 round trips instead of 4096.
 */
const UPSERT_BATCH_SIZE: number = 500;

/*
 * Hard ceiling on how many MACs one device walk may write. This is the
 * findBy limit too — reading more than we can look up would silently
 * treat known endpoints as new. A switch under a MAC-flood attack (or a
 * misconfigured trunk dumping a whole campus into one FDB) is capped
 * here and logged rather than allowed to monopolise the ingest thread.
 */
const MAX_ENDPOINTS_PER_WALK: number = LIMIT_MAX;

/*
 * MACs one statement of a controller's client list looks up. A read can
 * carry a whole organization's clients, so it is cut into pieces no bigger
 * than this rather than capped the way one switch's walk is.
 */
const CONTROLLER_CLIENT_CHUNK_SIZE: number = 5000;

/*
 * Column order used by the INSERT in upsertDiscoveredEndpoints. Keep
 * this and the generated parameter tuples in perfect sync.
 */
const INSERT_COLUMNS: Array<string> = [
  "projectId",
  "macAddress",
  "ipAddress",
  "vendor",
  "attachedNetworkDeviceId",
  "attachedInterfaceIndex",
  "attachedPortName",
  "vlanId",
  "siteId",
  "firstSeenAt",
  "lastSeenAt",
  "version",
  "hostname",
  "attachmentSource",
];

/*
 * What a network controller says about one client: the device it is on, by
 * the OneUptime device that controller device is, and what it calls it.
 */
export interface EndpointControllerClient {
  macAddress: string;
  ipAddress?: string | undefined;
  hostname?: string | undefined;
  // What the controller says made it, for a MAC whose OUI the registry lacks.
  vendor?: string | undefined;
  portName?: string | undefined;
  vlanId?: number | undefined;
  seenAt: Date;
  deviceId: ObjectID;
  deviceSiteId?: ObjectID | undefined;
}

// One row to write, and the device and site it is attached to.
interface EndpointWrite {
  mac: string;
  decision: EndpointUpsertDecision;
  deviceId: ObjectID;
  deviceSiteId?: ObjectID | undefined;
  vendor?: string | undefined;
}

/*
 * ShortText columns are 100 chars. Truncating BEFORE the decision is
 * made (rather than at write time) matters twice over: one over-long
 * value can never fail the whole chunk it rides in, and the
 * unchanged-since-last-poll comparison compares what we would store
 * against what is stored, not against the untruncated observation.
 */
function truncateShortText(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  return value.length > ColumnLength.ShortText
    ? value.substring(0, ColumnLength.ShortText)
    : value;
}

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Applies one device walk's endpoint observations to the per-project
   * endpoint inventory. Precedence between switch-FDB attachments and
   * router-ARP sightings lives in EndpointAttachmentUtil.decideUpsert (pure,
   * exhaustively tested); this method only batches the reads and applies
   * the decisions:
   *
   *  - one findBy for every observed MAC, then ONE INSERT per 500 new
   *    MACs and ONE UPDATE per 500 changed MACs — this runs inline on
   *    the probe-ingest request path, so per-MAC round trips are not an
   *    option at restaurant-chain scale (thousands of sites x thousands
   *    of L2 endpoints),
   *  - endpoints that have not moved since the last poll produce no
   *    write at all (see ENDPOINT_LAST_SEEN_REFRESH_MS), so a stable
   *    switch costs one SELECT and nothing else,
   *  - vendor is stamped from the MAC OUI on create only (user-correctable),
   *  - siteId follows the attaching device's site whenever an attachment is
   *    (re)written and the caller knows the site,
   *  - firstSeenAt is set on create, lastSeenAt on every touch that writes.
   */
  public async upsertDiscoveredEndpoints(data: {
    projectId: ObjectID;
    deviceId: ObjectID;
    deviceSiteId?: ObjectID | undefined;
    attachments: Array<EndpointAttachment>;
    ipBindings: Array<EndpointIpBinding>;
    now: Date;
  }): Promise<void> {
    // Merge both observation kinds per MAC — an L3 switch yields both.
    const incomingByMac: Map<string, EndpointIncomingObservation> = new Map();

    for (const attachment of data.attachments) {
      incomingByMac.set(attachment.macAddress, {
        macAddress: attachment.macAddress,
        deviceId: data.deviceId.toString(),
        attachment: {
          interfaceIndex: attachment.attachedInterfaceIndex,
          portName: truncateShortText(attachment.attachedPortName),
          vlanId: attachment.vlanId,
        },
      });
    }

    for (const binding of data.ipBindings) {
      const existing: EndpointIncomingObservation | undefined =
        incomingByMac.get(binding.macAddress);
      const ipAddress: string | undefined = truncateShortText(
        binding.ipAddress,
      );
      if (!ipAddress) {
        continue;
      }
      if (existing) {
        existing.ipBinding = {
          ipAddress: ipAddress,
          routerInterfaceIndex: binding.routerInterfaceIndex,
        };
      } else {
        incomingByMac.set(binding.macAddress, {
          macAddress: binding.macAddress,
          deviceId: data.deviceId.toString(),
          ipBinding: {
            ipAddress: ipAddress,
            routerInterfaceIndex: binding.routerInterfaceIndex,
          },
        });
      }
    }

    /*
     * Deterministic order, capped so a pathological FDB dump (or a MAC
     * flood attack on a customer switch) cannot write unbounded rows or
     * exceed the findBy limit.
     */
    const allMacs: Array<string> = Array.from(incomingByMac.keys()).sort();
    const macs: Array<string> = allMacs.slice(0, MAX_ENDPOINTS_PER_WALK);

    if (macs.length === 0) {
      return;
    }

    if (allMacs.length > macs.length) {
      logger.warn(
        `NetworkEndpointService: device ${data.deviceId.toString()} reported ${allMacs.length} endpoint MACs; capping this walk at ${MAX_ENDPOINTS_PER_WALK}.`,
      );
    }

    const existingByMac: Map<string, Model> = await this.findExistingByMac(
      data.projectId,
      macs,
    );

    const context: EndpointUpsertContext = {
      now: data.now,
      siteId: data.deviceSiteId?.toString(),
    };

    const creates: Array<EndpointWrite> = [];
    const updates: Array<EndpointWrite> = [];

    for (const mac of macs) {
      const incoming: EndpointIncomingObservation = incomingByMac.get(mac)!;
      const existing: Model | undefined = existingByMac.get(mac);

      const decision: EndpointUpsertDecision =
        EndpointAttachmentUtil.decideUpsert(
          existing ? this.toSnapshot(existing) : null,
          incoming,
          context,
        );
      const write: EndpointWrite = {
        mac,
        decision,
        deviceId: data.deviceId,
        deviceSiteId: data.deviceSiteId,
      };

      if (decision.action === "create") {
        creates.push(write);
      } else if (decision.action === "update") {
        updates.push(write);
      }
    }

    await this.bulkInsertEndpoints({
      projectId: data.projectId,
      now: data.now,
      rows: creates,
    });

    await this.bulkUpdateEndpoints({
      projectId: data.projectId,
      now: data.now,
      rows: updates,
    });
  }

  /*
   * Applies what a network controller's client list says about its clients:
   * the same inventory and the same two statements as a walk, for a list
   * that spans every switch of a read - so each row carries its own device
   * and site, and the rows are cut into chunks rather than capped. The rule
   * between a controller and a walk is EndpointAttachmentUtil.decideUpsert's.
   * Returns the rows it wrote.
   */
  public async upsertControllerClients(data: {
    projectId: ObjectID;
    // A NetworkControllerProvider.
    source: string;
    clients: Array<EndpointControllerClient>;
    now: Date;
  }): Promise<number> {
    const clientByMac: Map<string, EndpointControllerClient> = new Map();

    for (const client of data.clients) {
      if (!clientByMac.has(client.macAddress)) {
        clientByMac.set(client.macAddress, client);
      }
    }

    const macs: Array<string> = Array.from(clientByMac.keys()).sort();
    let written: number = 0;

    for (
      let offset: number = 0;
      offset < macs.length;
      offset += CONTROLLER_CLIENT_CHUNK_SIZE
    ) {
      const chunk: Array<string> = macs.slice(
        offset,
        offset + CONTROLLER_CLIENT_CHUNK_SIZE,
      );
      const existingByMac: Map<string, Model> = await this.findExistingByMac(
        data.projectId,
        chunk,
      );

      const creates: Array<EndpointWrite> = [];
      const updates: Array<EndpointWrite> = [];

      for (const mac of chunk) {
        const client: EndpointControllerClient = clientByMac.get(mac)!;
        const existing: Model | undefined = existingByMac.get(mac);
        const ipAddress: string | undefined = truncateShortText(
          client.ipAddress,
        );

        const decision: EndpointUpsertDecision =
          EndpointAttachmentUtil.decideUpsert(
            existing ? this.toSnapshot(existing) : null,
            {
              macAddress: mac,
              deviceId: client.deviceId.toString(),
              attachment: {
                portName: truncateShortText(client.portName),
                vlanId: client.vlanId,
              },
              ipBinding: ipAddress ? { ipAddress: ipAddress } : undefined,
              controller: {
                source: data.source,
                hostname: truncateShortText(client.hostname),
                seenAt: client.seenAt,
              },
            },
            { now: data.now, siteId: client.deviceSiteId?.toString() },
          );
        const write: EndpointWrite = {
          mac,
          decision,
          deviceId: client.deviceId,
          deviceSiteId: client.deviceSiteId,
          vendor: truncateShortText(client.vendor),
        };

        if (decision.action === "create") {
          creates.push(write);
        } else if (decision.action === "update") {
          updates.push(write);
        }
      }

      await this.bulkInsertEndpoints({
        projectId: data.projectId,
        now: data.now,
        rows: creates,
      });

      await this.bulkUpdateEndpoints({
        projectId: data.projectId,
        now: data.now,
        rows: updates,
      });

      written += creates.length + updates.length;
    }

    return written;
  }

  // The live rows of these MACs, in one read.
  private async findExistingByMac(
    projectId: ObjectID,
    macs: Array<string>,
  ): Promise<Map<string, Model>> {
    const existingRows: Array<Model> = await this.findBy({
      query: {
        projectId: projectId,
        macAddress: QueryHelper.any(macs),
      },
      select: {
        _id: true,
        macAddress: true,
        attachedNetworkDeviceId: true,
        attachedInterfaceIndex: true,
        attachedPortName: true,
        vlanId: true,
        ipAddress: true,
        siteId: true,
        hostname: true,
        attachmentSource: true,
        firstSeenAt: true,
        lastSeenAt: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const existingByMac: Map<string, Model> = new Map();
    for (const row of existingRows) {
      if (row.macAddress) {
        existingByMac.set(row.macAddress, row);
      }
    }

    return existingByMac;
  }

  private toSnapshot(existing: Model): EndpointExistingRowSnapshot {
    return {
      attachedNetworkDeviceId: existing.attachedNetworkDeviceId?.toString(),
      attachedInterfaceIndex: existing.attachedInterfaceIndex,
      attachedPortName: existing.attachedPortName,
      vlanId: existing.vlanId,
      ipAddress: existing.ipAddress,
      siteId: existing.siteId?.toString(),
      hostname: existing.hostname,
      attachmentSource: existing.attachmentSource,
      firstSeenAt: existing.firstSeenAt,
      lastSeenAt: existing.lastSeenAt,
    };
  }

  /*
   * New MACs. Every create-path decision has setAttachment === true (a
   * row with no stored attachment can never be "attached elsewhere"), so
   * the conflict branch can write the attachment unconditionally.
   *
   * ON CONFLICT names the partial unique index on
   * (projectId, macAddress) WHERE "deletedAt" IS NULL — the predicate is
   * required for index inference, and it is what keeps a soft-deleted
   * row from colliding with a rediscovered MAC. The DO UPDATE branch
   * only fires when a concurrent walk created the row between our findBy
   * and this INSERT; it then applies the same semantics the UPDATE path
   * would have, so the observation is never silently dropped.
   *
   * `vendor` is deliberately absent from DO UPDATE SET: it is stamped
   * from the OUI on create and is user-correctable thereafter.
   */
  private async bulkInsertEndpoints(data: {
    projectId: ObjectID;
    now: Date;
    rows: Array<EndpointWrite>;
  }): Promise<void> {
    if (data.rows.length === 0) {
      return;
    }

    for (let i: number = 0; i < data.rows.length; i += UPSERT_BATCH_SIZE) {
      const chunk: Array<EndpointWrite> = data.rows.slice(
        i,
        i + UPSERT_BATCH_SIZE,
      );

      const valueFragments: Array<string> = [];
      const params: Array<unknown> = [];
      let paramIndex: number = 1;

      for (const row of chunk) {
        const placeholders: Array<string> = [];
        for (let c: number = 0; c < INSERT_COLUMNS.length; c++) {
          placeholders.push(`$${paramIndex++}`);
        }
        valueFragments.push(`(${placeholders.join(", ")})`);

        const seenAt: Date = row.decision.lastSeenAt ?? data.now;

        params.push(
          data.projectId.toString(),
          row.mac,
          row.decision.setIpAddress && row.decision.ipAddress
            ? row.decision.ipAddress
            : null,
          truncateShortText(OuiLookupUtil.lookupVendor(row.mac)) ??
            row.vendor ??
            null,
          row.deviceId.toString(),
          row.decision.attachedInterfaceIndex ?? null,
          row.decision.attachedPortName ?? null,
          row.decision.vlanId ?? null,
          row.deviceSiteId?.toString() ?? null,
          seenAt,
          seenAt,
          0, // version (BaseModel @VersionColumn)
          row.decision.hostname ?? null,
          row.decision.attachmentSource ?? null,
        );
      }

      const sql: string = `
        INSERT INTO "NetworkEndpoint" (
          "projectId", "macAddress", "ipAddress", "vendor",
          "attachedNetworkDeviceId", "attachedInterfaceIndex",
          "attachedPortName", "vlanId", "siteId",
          "firstSeenAt", "lastSeenAt", "version",
          "hostname", "attachmentSource"
        )
        VALUES ${valueFragments.join(", ")}
        ON CONFLICT ("projectId", "macAddress") WHERE "deletedAt" IS NULL
        DO UPDATE SET
          "attachedNetworkDeviceId" = EXCLUDED."attachedNetworkDeviceId",
          "attachedInterfaceIndex" = COALESCE(EXCLUDED."attachedInterfaceIndex", "NetworkEndpoint"."attachedInterfaceIndex"),
          "attachedPortName" = COALESCE(EXCLUDED."attachedPortName", "NetworkEndpoint"."attachedPortName"),
          "vlanId" = COALESCE(EXCLUDED."vlanId", "NetworkEndpoint"."vlanId"),
          "siteId" = COALESCE(EXCLUDED."siteId", "NetworkEndpoint"."siteId"),
          "ipAddress" = COALESCE(EXCLUDED."ipAddress", "NetworkEndpoint"."ipAddress"),
          "firstSeenAt" = COALESCE("NetworkEndpoint"."firstSeenAt", EXCLUDED."firstSeenAt"),
          "lastSeenAt" = EXCLUDED."lastSeenAt",
          "hostname" = COALESCE(EXCLUDED."hostname", "NetworkEndpoint"."hostname"),
          "attachmentSource" = EXCLUDED."attachmentSource",
          "updatedAt" = now()
      `;

      await this.getRepository().manager.query(sql, params);
    }
  }

  /*
   * Known MACs whose observation actually changed something. One
   * UPDATE ... FROM (VALUES ...) per chunk, joined on the same
   * (projectId, macAddress) key the unique index covers, with
   * "deletedAt" IS NULL so a soft-deleted row is never resurrected.
   *
   * Per-row conditionality rides in the VALUES tuple: `setAttachment`
   * gates the whole attachment group, and NULL means "the walk did not
   * report one" — COALESCE keeps whatever is stored, which is the
   * "undefined never clears a stored value" rule from decideUpsert.
   *
   * Two columns differ, and a controller's source is why. attachmentSource
   * is written as it stands, so a walk that writes to a row takes it over.
   * And a controller names a port by its label: when it moved a client, the
   * ifIndex a walk left behind is the old port's, so it has to clear.
   */
  private async bulkUpdateEndpoints(data: {
    projectId: ObjectID;
    now: Date;
    rows: Array<EndpointWrite>;
  }): Promise<void> {
    if (data.rows.length === 0) {
      return;
    }

    for (let i: number = 0; i < data.rows.length; i += UPSERT_BATCH_SIZE) {
      const chunk: Array<EndpointWrite> = data.rows.slice(
        i,
        i + UPSERT_BATCH_SIZE,
      );

      const valueFragments: Array<string> = [];
      const params: Array<unknown> = [data.projectId.toString()];
      let paramIndex: number = 2;

      for (const row of chunk) {
        valueFragments.push(
          `($${paramIndex++}::character varying, $${paramIndex++}::boolean, $${paramIndex++}::uuid, $${paramIndex++}::integer, $${paramIndex++}::character varying, $${paramIndex++}::integer, $${paramIndex++}::uuid, $${paramIndex++}::character varying, $${paramIndex++}::timestamptz, $${paramIndex++}::character varying, $${paramIndex++}::character varying)`,
        );

        params.push(
          row.mac,
          row.decision.setAttachment,
          row.decision.setAttachment ? row.deviceId.toString() : null,
          row.decision.setAttachment
            ? row.decision.attachedInterfaceIndex ?? null
            : null,
          row.decision.setAttachment
            ? row.decision.attachedPortName ?? null
            : null,
          row.decision.setAttachment ? row.decision.vlanId ?? null : null,
          row.decision.setAttachment
            ? row.deviceSiteId?.toString() ?? null
            : null,
          row.decision.setIpAddress && row.decision.ipAddress
            ? row.decision.ipAddress
            : null,
          row.decision.lastSeenAt ?? data.now,
          row.decision.hostname ?? null,
          row.decision.attachmentSource ?? null,
        );
      }

      const sql: string = `
        UPDATE "NetworkEndpoint" AS e
        SET
          "attachedNetworkDeviceId" = CASE WHEN v."setAttachment" THEN v."deviceId" ELSE e."attachedNetworkDeviceId" END,
          "attachedInterfaceIndex" = CASE
            WHEN v."setAttachment" AND v."attachmentSource" IS NOT NULL THEN v."attachedInterfaceIndex"
            WHEN v."setAttachment" THEN COALESCE(v."attachedInterfaceIndex", e."attachedInterfaceIndex")
            ELSE e."attachedInterfaceIndex"
          END,
          "attachedPortName" = CASE WHEN v."setAttachment" THEN COALESCE(v."attachedPortName", e."attachedPortName") ELSE e."attachedPortName" END,
          "vlanId" = CASE WHEN v."setAttachment" THEN COALESCE(v."vlanId", e."vlanId") ELSE e."vlanId" END,
          "siteId" = CASE WHEN v."setAttachment" THEN COALESCE(v."siteId", e."siteId") ELSE e."siteId" END,
          "ipAddress" = COALESCE(v."ipAddress", e."ipAddress"),
          "firstSeenAt" = COALESCE(e."firstSeenAt", v."lastSeenAt"),
          "lastSeenAt" = v."lastSeenAt",
          "hostname" = COALESCE(v."hostname", e."hostname"),
          "attachmentSource" = v."attachmentSource",
          "updatedAt" = now()
        FROM (VALUES ${valueFragments.join(", ")})
          AS v("macAddress", "setAttachment", "deviceId", "attachedInterfaceIndex", "attachedPortName", "vlanId", "siteId", "ipAddress", "lastSeenAt", "hostname", "attachmentSource")
        WHERE
          e."projectId" = $1
          AND e."macAddress" = v."macAddress"
          AND e."deletedAt" IS NULL
      `;

      await this.getRepository().manager.query(sql, params);
    }
  }
}

export default new Service();
