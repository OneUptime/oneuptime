import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/NetworkEndpoint";
import ColumnLength from "../../Types/Database/ColumnLength";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import OneUptimeDate from "../../Types/Date";
import ObjectID from "../../Types/ObjectID";
import EndpointAttachmentUtil, {
  EndpointAttachment,
  EndpointExistingRowSnapshot,
  EndpointIncomingObservation,
  EndpointIpBinding,
  EndpointUpsertContext,
  EndpointUpsertDecision,
  getEndpointLastSeenRefreshMs,
} from "../../Utils/Monitor/EndpointAttachmentUtil";
import OuiLookupUtil from "../Utils/Monitor/OuiLookupUtil";
import { OnCreate } from "../Types/Database/Hooks";
import QueryHelper from "../Types/Database/QueryHelper";
import UpdateBy from "../Types/Database/UpdateBy";
import { isPostgresLockContentionError } from "../Utils/Database/PostgresLockContention";
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

/*
 * One MAC a walk or a controller's read saw: what it saw, the rules its
 * write is decided by, and the device and site its row is attached to.
 */
interface EndpointSighting {
  mac: string;
  incoming: EndpointIncomingObservation;
  context: EndpointUpsertContext;
  deviceId: ObjectID;
  deviceSiteId?: ObjectID | undefined;
  vendor?: string | undefined;
}

// A sighting, and what was decided for it against the row its MAC has.
interface EndpointWrite extends EndpointSighting {
  decision: EndpointUpsertDecision;
}

/*
 * What a write of a walk's or a read's endpoints did (OneUptime issue
 * #7388). `written`: the rows it made or changed. `skipped`: the rows it was
 * to write and left for the next walk or read, which sees the MACs again -
 * a row another writer held, a row deleted under it, or the rows of a
 * statement that met a row lock past lock_timeout.
 */
export interface EndpointWriteCounts {
  written: number;
  skipped: number;
}

// What the inserts of a write did, and the MACs another writer made first.
interface EndpointInsertCounts extends EndpointWriteCounts {
  madeMeanwhile: Array<EndpointWrite>;
}

// What a set of sightings decided on: rows to make, and rows to change.
interface EndpointWritePlan {
  creates: Array<EndpointWrite>;
  updates: Array<EndpointWrite>;
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

/*
 * The columns whose change by a person keeps a device on the Discovered
 * Devices list for good (see onUpdatePermitted): everything a person may
 * change on one but its classification.
 */
export const EDIT_KEEPING_COLUMNS: ReadonlyArray<string> = [
  "vendor",
  "ipAddress",
  "siteId",
  "site",
];

// Whether an update's data changes one of EDIT_KEEPING_COLUMNS.
export function isEditThatKeepsTheDevice(data: unknown): boolean {
  if (!data || typeof data !== "object") {
    return false;
  }

  return EDIT_KEEPING_COLUMNS.some((column: string): boolean => {
    return (data as Record<string, unknown>)[column] !== undefined;
  });
}

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * A device a person added, or whose vendor, address or site a person
   * changed, stays on the Discovered Devices list however long nothing sees
   * it (issue #6389): its editedAt says when. Stamped on every create and
   * every such update a person, an API key or a workflow makes - never on
   * the server's own writes, which run as root or as statements of their
   * own (the upserts below). A classification keeps a device for as long
   * as it has one, so a change of it alone stamps nothing: cleared, the
   * device ages again like any other.
   *
   * Stamped once the write passed every permission check: no caller may
   * write the column itself.
   */
  protected override async onCreatePermitted(
    onCreate: OnCreate<Model>,
  ): Promise<void> {
    await super.onCreatePermitted(onCreate);

    if (onCreate.createBy.props.isRoot) {
      return;
    }

    onCreate.createBy.data.editedAt = OneUptimeDate.getCurrentDate();
  }

  protected override async onUpdatePermitted(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    await super.onUpdatePermitted(updateBy);

    if (updateBy.props.isRoot || !isEditThatKeepsTheDevice(updateBy.data)) {
      return;
    }

    (updateBy.data as unknown as { editedAt?: Date }).editedAt =
      OneUptimeDate.getCurrentDate();
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
   *    write at all until their lastSeenAt is about two of the device's
   *    poll intervals old (getEndpointLastSeenRefreshMs), so a stable
   *    switch costs one SELECT and, every other poll, its refresh,
   *  - vendor is stamped from the MAC OUI on create only (user-correctable),
   *  - siteId follows the attaching device's site whenever an attachment is
   *    (re)written and the caller knows the site,
   *  - firstSeenAt is set on create, lastSeenAt on every touch that writes,
   *  - it never waits for an endpoint another writer holds, and never
   *    overwrites one another writer made first (OneUptime issue #7388):
   *    see writeSightings.
   *
   * Returns what it wrote, and what it left for the device's next walk.
   */
  public async upsertDiscoveredEndpoints(data: {
    projectId: ObjectID;
    deviceId: ObjectID;
    deviceSiteId?: ObjectID | undefined;
    /*
     * How often the walked device is polled, which is how often it sees its
     * endpoints again. Absent: the default interval.
     */
    devicePollingIntervalInMinutes?: number | null | undefined;
    attachments: Array<EndpointAttachment>;
    ipBindings: Array<EndpointIpBinding>;
    now: Date;
  }): Promise<EndpointWriteCounts> {
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
     * In MAC order, capped so a pathological FDB dump (or a MAC flood
     * attack on a customer switch) cannot write unbounded rows or exceed
     * the findBy limit. The order is the cap's, and it is the order the
     * inserts go in: what keeps two walks that insert the same new MACs at
     * once from waiting for each other in a circle (see
     * bulkInsertEndpoints).
     */
    const allMacs: Array<string> = Array.from(incomingByMac.keys()).sort();
    const macs: Array<string> = allMacs.slice(0, MAX_ENDPOINTS_PER_WALK);

    if (macs.length === 0) {
      return { written: 0, skipped: 0 };
    }

    if (allMacs.length > macs.length) {
      logger.warn(
        `NetworkEndpointService: device ${data.deviceId.toString()} reported ${allMacs.length} endpoint MACs; capping this walk at ${MAX_ENDPOINTS_PER_WALK}.`,
      );
    }

    const context: EndpointUpsertContext = {
      now: data.now,
      siteId: data.deviceSiteId?.toString(),
      lastSeenRefreshMs: getEndpointLastSeenRefreshMs(
        data.devicePollingIntervalInMinutes,
      ),
    };

    const counts: EndpointWriteCounts = await this.writeSightings({
      projectId: data.projectId,
      now: data.now,
      sightings: macs.map((mac: string): EndpointSighting => {
        return {
          mac,
          incoming: incomingByMac.get(mac)!,
          context,
          deviceId: data.deviceId,
          deviceSiteId: data.deviceSiteId,
        };
      }),
    });

    if (counts.skipped > 0) {
      logger.debug(
        `NetworkEndpointService: the walk of device ${data.deviceId.toString()} wrote ${counts.written} endpoints and left ${counts.skipped} for its next walk: another writer held them, they were deleted meanwhile, or a row lock outlasted the lock timeout.`,
      );
    }

    return counts;
  }

  /*
   * Applies what a network controller's client list says about its clients:
   * the same inventory and the same writes as a walk, for a list that spans
   * every switch of a read - so each row carries its own device and site,
   * and the rows are cut into chunks rather than capped. In MAC order, like
   * a walk's, for the same reason (see bulkInsertEndpoints). The rule
   * between a controller and a walk is EndpointAttachmentUtil.decideUpsert's.
   * Returns the rows it wrote; the ones another writer held are left for the
   * next read (see writeSightings).
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
    let skipped: number = 0;

    for (
      let offset: number = 0;
      offset < macs.length;
      offset += CONTROLLER_CLIENT_CHUNK_SIZE
    ) {
      const chunk: Array<string> = macs.slice(
        offset,
        offset + CONTROLLER_CLIENT_CHUNK_SIZE,
      );

      const counts: EndpointWriteCounts = await this.writeSightings({
        projectId: data.projectId,
        now: data.now,
        sightings: chunk.map((mac: string): EndpointSighting => {
          const client: EndpointControllerClient = clientByMac.get(mac)!;
          const ipAddress: string | undefined = truncateShortText(
            client.ipAddress,
          );

          return {
            mac,
            incoming: {
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
            context: { now: data.now, siteId: client.deviceSiteId?.toString() },
            deviceId: client.deviceId,
            deviceSiteId: client.deviceSiteId,
            vendor: truncateShortText(client.vendor),
          };
        }),
      });

      written += counts.written;
      skipped += counts.skipped;
    }

    if (skipped > 0) {
      logger.debug(
        `NetworkEndpointService: a ${data.source} read wrote ${written} clients and left ${skipped} for its next read: another writer held them, they were deleted meanwhile, or a row lock outlasted the lock timeout.`,
      );
    }

    return written;
  }

  /*
   * Writes what a walk, or a chunk of a controller's read, saw: one read of
   * the MACs' live rows, a decision for each by
   * EndpointAttachmentUtil.decideUpsert, then the inserts and the updates.
   *
   * It never waits for a row another writer holds, and never overwrites a
   * row another writer made first (OneUptime issue #7388). The same MAC is
   * seen by many devices at the same moment - its access switch's
   * forwarding table and every uplink's, its router's ARP table, a
   * controller's client list - so the walks of one project write the same
   * endpoints at once. Their writes used to wait for each other: the update
   * took its rows' locks in whatever order its plan met them, waiting for
   * each one another writer held while holding the ones it had, and the
   * insert's ON CONFLICT DO UPDATE waited for a row another writer had just
   * made. Two of them deadlocked, or one waited out lock_timeout, and the
   * error took the rest of the walk's inventory with it. Now:
   *
   *  - A new MAC another writer made between the read and the insert is
   *    decided again against the row it made - by the same rules as a row
   *    the read had found, so a switch's port is not a router's to take nor
   *    a controller's placement a walk's - and written by the update.
   *  - The update writes the rows nobody else holds right now. A row
   *    another writer holds is being written by it, with a sighting from
   *    the same moment, and the next walk sees the MAC again.
   *  - A statement that still meets a row lock past lock_timeout leaves its
   *    rows for the next walk, and the rest are written.
   *
   * Returns what it wrote, and what it left.
   */
  private async writeSightings(data: {
    projectId: ObjectID;
    now: Date;
    sightings: Array<EndpointSighting>;
  }): Promise<EndpointWriteCounts> {
    const planned: EndpointWritePlan = this.decideWrites(
      data.sightings,
      await this.findExistingByMac(
        data.projectId,
        data.sightings.map((sighting: EndpointSighting): string => {
          return sighting.mac;
        }),
      ),
    );

    const inserted: EndpointInsertCounts = await this.bulkInsertEndpoints({
      projectId: data.projectId,
      now: data.now,
      rows: planned.creates,
    });

    const updates: Array<EndpointWrite> = [...planned.updates];
    let skipped: number = inserted.skipped;

    if (inserted.madeMeanwhile.length > 0) {
      const replanned: EndpointWritePlan = this.decideWrites(
        inserted.madeMeanwhile,
        await this.findExistingByMac(
          data.projectId,
          inserted.madeMeanwhile.map((write: EndpointWrite): string => {
            return write.mac;
          }),
        ),
      );

      updates.push(...replanned.updates);
      // Deleted again before this read: the next walk makes the row.
      skipped += replanned.creates.length;
    }

    const updated: EndpointWriteCounts = await this.bulkUpdateEndpoints({
      projectId: data.projectId,
      now: data.now,
      rows: updates,
    });

    return {
      written: inserted.written + updated.written,
      skipped: skipped + updated.skipped,
    };
  }

  // Each sighting, decided against the live row of its MAC if it has one.
  private decideWrites(
    sightings: Array<EndpointSighting>,
    existingByMac: Map<string, Model>,
  ): EndpointWritePlan {
    const plan: EndpointWritePlan = { creates: [], updates: [] };

    for (const sighting of sightings) {
      const existing: Model | undefined = existingByMac.get(sighting.mac);
      const write: EndpointWrite = {
        ...sighting,
        decision: EndpointAttachmentUtil.decideUpsert(
          existing ? this.toSnapshot(existing) : null,
          sighting.incoming,
          sighting.context,
        ),
      };

      if (write.decision.action === "create") {
        plan.creates.push(write);
      } else if (write.decision.action === "update") {
        plan.updates.push(write);
      }
    }

    return plan;
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
   * New MACs, in MAC order: both callers sort them. An insert is the one
   * write here that can still wait - for another writer's uncommitted
   * insert or change of a row of the same MAC, as only that writer's end
   * says whether its row stands. In one order, two inserts of the same new
   * MACs never wait for each other in a circle: the later waits for the
   * earlier's statement, which never waits for it back. In opposite orders
   * - each walk in the order its switch listed them - they deadlocked.
   *
   * ON CONFLICT names the partial unique index on
   * (projectId, macAddress) WHERE "deletedAt" IS NULL — the predicate is
   * required for index inference, and it is what keeps a soft-deleted
   * row from colliding with a rediscovered MAC. DO NOTHING: a MAC another
   * writer made between the read and this insert is not overwritten. It
   * was, by a DO UPDATE that also waited for that row's lock, with the
   * create's attachment whatever the rules said - a router's ARP sighting
   * took a switch's port. The MACs it did not insert are answered, to be
   * decided again against the row that writer made (writeSightings).
   *
   * `vendor` is stamped from the OUI here, on create only: it is
   * user-correctable thereafter, and the update never writes it.
   */
  private async bulkInsertEndpoints(data: {
    projectId: ObjectID;
    now: Date;
    rows: Array<EndpointWrite>;
  }): Promise<EndpointInsertCounts> {
    const counts: EndpointInsertCounts = {
      written: 0,
      skipped: 0,
      madeMeanwhile: [],
    };

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
        DO NOTHING
        RETURNING "macAddress"
      `;

      const inserted: Set<string> | null = await this.runEndpointWrite({
        sql,
        params,
        rows: chunk.length,
      });

      if (!inserted) {
        counts.skipped += chunk.length;
        continue;
      }

      for (const row of chunk) {
        if (inserted.has(row.mac)) {
          counts.written++;
        } else {
          counts.madeMeanwhile.push(row);
        }
      }
    }

    return counts;
  }

  /*
   * Known MACs whose observation actually changed something. One statement
   * per chunk. The chunk's rows ride in "observed" (VALUES); the live rows
   * of those MACs that nobody else holds right now are locked - FOR NO KEY
   * UPDATE, the lock the UPDATE takes anyway, which a foreign key check
   * does not wait for - SKIP LOCKED, so the statement never waits for a row
   * at all; and only the locked rows are written, joined on the same
   * (projectId, macAddress) key the unique index covers, with "deletedAt"
   * IS NULL so a soft-deleted row is never resurrected. The MACs it wrote
   * are answered: another writer held the rest, or deleted them.
   *
   * It was a bare UPDATE ... FROM (VALUES ...), which took its rows' locks
   * in whatever order its plan met them - a hash join meets them in the
   * table's order, not the list's - and waited for each one another writer
   * held, holding every row it had reached (OneUptime issue #7388).
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
   *
   * lastSeenAt never moves backwards: the row keeps the later of its own
   * and the sighting's. A walk's sighting is timed when OneUptime received
   * the poll (OneUptime issue #7389), and an older poll processed after a
   * newer one would otherwise take an endpoint's last sighting back to it.
   */
  private async bulkUpdateEndpoints(data: {
    projectId: ObjectID;
    now: Date;
    rows: Array<EndpointWrite>;
  }): Promise<EndpointWriteCounts> {
    const counts: EndpointWriteCounts = { written: 0, skipped: 0 };

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
        WITH "observed" ("macAddress", "setAttachment", "deviceId", "attachedInterfaceIndex", "attachedPortName", "vlanId", "siteId", "ipAddress", "lastSeenAt", "hostname", "attachmentSource") AS (
          VALUES ${valueFragments.join(", ")}
        ),
        "locked" AS (
          SELECT e."_id"
          FROM "NetworkEndpoint" AS e
          INNER JOIN "observed" AS o ON o."macAddress" = e."macAddress"
          WHERE e."projectId" = $1
            AND e."deletedAt" IS NULL
          FOR NO KEY UPDATE OF e SKIP LOCKED
        ),
        "written" AS (
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
            "lastSeenAt" = GREATEST(e."lastSeenAt", v."lastSeenAt"),
            "hostname" = COALESCE(v."hostname", e."hostname"),
            "attachmentSource" = v."attachmentSource",
            "updatedAt" = now()
          FROM "observed" AS v
          WHERE
            e."projectId" = $1
            AND e."macAddress" = v."macAddress"
            AND e."deletedAt" IS NULL
            AND e."_id" IN (SELECT "_id" FROM "locked")
          RETURNING e."macAddress"
        )
        SELECT "macAddress" FROM "written"
      `;

      /*
       * Wrapped in a CTE: TypeORM answers a top-level UPDATE ... RETURNING
       * as [rows, rowCount].
       */
      const written: Set<string> | null = await this.runEndpointWrite({
        sql,
        params,
        rows: chunk.length,
      });

      if (!written) {
        counts.skipped += chunk.length;
        continue;
      }

      counts.written += written.size;
      counts.skipped += chunk.length - written.size;
    }

    return counts;
  }

  /*
   * One statement of a write, and the MACs it answered - or null when it
   * met another writer's row lock past lock_timeout, or was cancelled out
   * of a deadlock. Its rows are then left for the next walk or read rather
   * than failing the rows around them, and the rest of the walk's
   * inventory - its other statements, the ARP table's MAC learning - goes
   * on. Any other error is the caller's.
   */
  private async runEndpointWrite(data: {
    sql: string;
    params: Array<unknown>;
    rows: number;
  }): Promise<Set<string> | null> {
    let answered: unknown;

    try {
      answered = await this.getRepository().manager.query(
        data.sql,
        data.params,
      );
    } catch (error) {
      if (!isPostgresLockContentionError(error)) {
        throw error;
      }

      logger.warn(
        `NetworkEndpointService: ${data.rows} endpoints were left for the next walk: their statement met another writer's row lock past the lock timeout, or a deadlock (${error instanceof Error ? error.message : String(error)}).`,
      );

      return null;
    }

    const macs: Set<string> = new Set<string>();

    if (Array.isArray(answered)) {
      for (const row of answered as Array<{ macAddress?: unknown }>) {
        if (row && typeof row.macAddress === "string") {
          macs.add(row.macAddress);
        }
      }
    }

    return macs;
  }
}

export default new Service();
