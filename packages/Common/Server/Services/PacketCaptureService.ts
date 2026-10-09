import { EntityManager } from "./DatabaseService";
import FileService from "./FileService";
import NetworkDeviceService from "./NetworkDeviceService";
import ProbeService from "./ProbeService";
import ProjectReferencesService from "./ProjectReferencesService";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import Query from "../Types/Database/Query";
import QueryHelper from "../Types/Database/QueryHelper";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import PcapFile, { PcapInspection } from "../Utils/PacketCapture/PcapFile";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import File from "../../Models/DatabaseModels/File";
import NetworkDevice from "../../Models/DatabaseModels/NetworkDevice";
import Model from "../../Models/DatabaseModels/PacketCapture";
import Probe from "../../Models/DatabaseModels/Probe";
import ColumnLength from "../../Types/Database/ColumnLength";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import MimeType from "../../Types/File/MimeType";
import ObjectID from "../../Types/ObjectID";
import PacketCaptureCapabilityUtil, {
  PacketCaptureCapability,
} from "../../Types/PacketCapture/PacketCaptureCapability";
import PacketCaptureEndReason, {
  PacketCaptureEndReasonUtil,
} from "../../Types/PacketCapture/PacketCaptureEndReason";
import PacketCaptureFilterUtil from "../../Types/PacketCapture/PacketCaptureFilter";
import { PacketCaptureJob } from "../../Types/PacketCapture/PacketCaptureJob";
import {
  HARD_MAX_PACKET_CAPTURE_LIMITS,
  PACKET_CAPTURE_HEARTBEAT_TIMEOUT_IN_MINUTES,
  PACKET_CAPTURE_MAX_ACTIVE_PER_PROBE,
  PACKET_CAPTURE_PICKUP_TIMEOUT_IN_MINUTES,
  PACKET_CAPTURE_RETENTION_IN_DAYS,
  PACKET_CAPTURE_UPLOAD_GRACE_IN_MINUTES,
  PacketCaptureLimitCheck,
  PacketCaptureLimitsUtil,
} from "../../Types/PacketCapture/PacketCaptureLimits";
import { PACKET_CAPTURE_NOT_FOUND_MESSAGE } from "../../Types/PacketCapture/PacketCapturePermissions";
import PacketCaptureStatus from "../../Types/PacketCapture/PacketCaptureStatus";

/*
 * The two spellings a many-to-one reference reaches a hook under (see
 * RelationIdUtil): the dashboard posts the relation, server code the column.
 */
const PROBE_RELATION_KEYS: Array<string> = ["probeId", "probe"];
const NETWORK_DEVICE_RELATION_KEYS: Array<string> = [
  "networkDeviceId",
  "networkDevice",
];
const PROJECT_RELATION_KEYS: Array<string> = ["projectId", "project"];
const FILE_RELATION_KEYS: Array<string> = ["fileId", "file"];

/*
 * What the probe and the server write once the capture runs. Cleared on
 * create, so a capture can never START with a result: the dashboard reads
 * a Completed status as "there is a file to download".
 */
const RUN_COLUMNS: Array<string> = [
  "statusMessage",
  "endReason",
  "startedAt",
  "completedAt",
  "stopRequestedAt",
  "packetCount",
  "fileSizeInBytes",
];

// How many expired captures the retention sweep deletes per statement.
const RETENTION_BATCH_SIZE: number = 200;

export const GLOBAL_PROBE_MESSAGE: string =
  "Packet captures run only on your project's own probes. A global probe carries other projects' traffic, so it never captures.";

export const PROBE_NOT_FOUND_MESSAGE: string = "Probe not found.";

export const CAPABILITY_NOT_REPORTED_MESSAGE: string =
  "This probe has not said whether it can capture packets. Update it to the latest version, then turn packet capture on with PROBE_PACKET_CAPTURE_ENABLED=true.";

export const CAPTURE_TURNED_OFF_MESSAGE: string =
  "Packet capture is turned off on this probe. Whoever runs the probe can turn it on with PROBE_PACKET_CAPTURE_ENABLED=true.";

export const TOOL_MISSING_MESSAGE: string =
  "tcpdump is not installed on this probe. Run the official probe image, or install tcpdump where the probe runs.";

export const NO_INTERFACES_MESSAGE: string =
  "This probe reported no network interfaces it can capture on.";

export const PICKUP_TIMEOUT_MESSAGE: string = `The probe did not pick up this capture within ${PACKET_CAPTURE_PICKUP_TIMEOUT_IN_MINUTES} minutes. Check that the probe is connected and that packet capture is still turned on.`;

export const HEARTBEAT_TIMEOUT_MESSAGE: string =
  "The probe stopped reporting on this capture. It may have restarted or lost its connection to OneUptime.";

export const UPLOAD_TIMEOUT_MESSAGE: string =
  "The probe did not upload this capture in time.";

export const NOT_STARTED_MESSAGE: string =
  "This capture has not started yet. Delete it instead.";

export const ALREADY_FINISHED_MESSAGE: string =
  "This capture has already finished.";

export const NOT_A_PCAP_MESSAGE: string =
  "The uploaded file is not a pcap capture.";

export const FILE_TOO_LARGE_MESSAGE: string =
  "The uploaded file is larger than the capture's size limit.";

export function getActiveCaptureLimitMessage(limit: number): string {
  return `This probe is already running ${limit} packet captures. Wait for one to finish, or stop one, and try again.`;
}

export function getUnknownInterfaceMessage(interfaceName: string): string {
  return `This probe has no network interface named "${interfaceName}". Pick one of the interfaces it reported.`;
}

/*
 * The name a capture is listed and audited under: its interface and its
 * filter, "eth0: host 10.0.0.5", cut to fit the column.
 */
export function getPacketCaptureName(data: {
  interfaceName: string;
  bpfFilter: string;
}): string {
  const name: string = `${data.interfaceName}: ${data.bpfFilter || "all traffic"}`;

  return name.length > ColumnLength.ShortText
    ? `${name.substring(0, ColumnLength.ShortText - 1)}…`
    : name;
}

/*
 * The file name a capture downloads as: what it captured, where and when,
 * in characters every file system takes -
 * "packet-capture-site-a-probe-eth0-2026-10-09T08-30-00Z.pcap".
 */
export function getPacketCaptureFileName(data: {
  probeName?: string | undefined;
  interfaceName: string;
  startedAt: Date;
}): string {
  const slug: (value: string) => string = (value: string): string => {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .substring(0, 40);
  };

  const timestamp: string = `${data.startedAt.toISOString().substring(0, 19).replace(/:/g, "-")}Z`;

  const parts: Array<string> = [
    "packet-capture",
    slug(data.probeName || ""),
    slug(data.interfaceName),
    timestamp,
  ].filter((part: string): boolean => {
    return part.length > 0;
  });

  return `${parts.join("-")}.pcap`;
}

/*
 * Rows a raw UPDATE ... RETURNING touched, read defensively: the postgres
 * driver hands TypeORM `[rows, rowCount]` for an UPDATE, a bare row array
 * for some statements. Anything else reads as none, so a write that may not
 * have landed is never acknowledged.
 */
function readReturnedRows(result: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(result)) {
    return [];
  }

  if (
    result.length === 2 &&
    Array.isArray(result[0]) &&
    typeof result[1] === "number"
  ) {
    return result[0] as Array<Record<string, unknown>>;
  }

  return result as Array<Record<string, unknown>>;
}

function readRowId(row: Record<string, unknown>): string {
  return String(row["_id"] || "").toLowerCase();
}

interface DeletedCaptureFile {
  captureId: string;
  fileId: ObjectID;
}

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * The probe and the network device a capture names are checked by
   * onBeforeCreate itself, pinned to the project: the probe must be the
   * project's own (never a global one) and the device the project's, and
   * another project's answers exactly as a missing one.
   */
  protected override getRelationsCheckedByService(): Array<string> {
    return ["probe", "networkDevice"];
  }

  /*
   * A global probe is refused before anything else looks at the probe, in
   * words that say why: global probes are shown to every project, so naming
   * one is no secret, and "not found" would send someone looking for a
   * probe that is right there.
   */
  @CaptureSpan()
  protected override async checkCreateBeforeReferences(
    createBy: CreateBy<Model>,
  ): Promise<void> {
    const probeId: ObjectID | null = RelationIdUtil.readConsistent(
      createBy.data as unknown as Record<string, unknown>,
      PROBE_RELATION_KEYS,
      "Probe",
    );

    if (!probeId) {
      return;
    }

    const probe: Probe | null = await ProbeService.findOneById({
      id: probeId,
      select: { _id: true, projectId: true, isGlobalProbe: true },
      props: { isRoot: true },
    });

    if (probe && (probe.isGlobalProbe || !probe.projectId)) {
      throw new BadDataException(GLOBAL_PROBE_MESSAGE);
    }
  }

  /*
   * Everything a capture is started with is checked here, against what its
   * probe last reported, so a capture the probe could not run is refused
   * while the person is still looking at the form rather than failed a
   * minute later: the probe must be the project's own, have captures turned
   * on and tcpdump installed, and offer the interface; the filter must be one
   * BPF can be; the limits must be inside the probe's maximums; and the
   * probe must have a capture slot free.
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    const data: Record<string, unknown> = createBy.data as unknown as Record<
      string,
      unknown
    >;

    const probeId: ObjectID | null = RelationIdUtil.readConsistent(
      data,
      PROBE_RELATION_KEYS,
      "Probe",
    );

    if (!probeId) {
      throw new BadDataException("Pick the probe to capture on.");
    }

    const projectId: ObjectID | null =
      RelationIdUtil.readConsistent(data, PROJECT_RELATION_KEYS, "Project") ||
      createBy.props.tenantId ||
      null;

    if (!projectId) {
      throw new BadDataException(PROBE_NOT_FOUND_MESSAGE);
    }

    const probe: Probe | null = await ProbeService.findOneById({
      id: probeId,
      select: {
        _id: true,
        projectId: true,
        isGlobalProbe: true,
        packetCaptureCapability: true,
      },
      props: { isRoot: true },
    });

    if (!probe) {
      throw new BadDataException(PROBE_NOT_FOUND_MESSAGE);
    }

    if (probe.isGlobalProbe || !probe.projectId) {
      throw new BadDataException(GLOBAL_PROBE_MESSAGE);
    }

    // A probe of another project answers exactly as one that does not exist.
    if (probe.projectId.toString() !== projectId.toString()) {
      throw new BadDataException(PROBE_NOT_FOUND_MESSAGE);
    }

    const capability: PacketCaptureCapability = Service.assertCanCapture(probe);

    const interfaceName: string =
      typeof createBy.data.interfaceName === "string"
        ? createBy.data.interfaceName.trim()
        : "";

    if (!interfaceName) {
      throw new BadDataException("Pick the network interface to capture on.");
    }

    if (!PacketCaptureCapabilityUtil.findInterface(capability, interfaceName)) {
      throw new BadDataException(getUnknownInterfaceMessage(interfaceName));
    }

    const filterError: string | null = PacketCaptureFilterUtil.validate(
      createBy.data.bpfFilter,
    );

    if (filterError) {
      throw new BadDataException(filterError);
    }

    const bpfFilter: string = PacketCaptureFilterUtil.normalize(
      createBy.data.bpfFilter,
    );

    const limitCheck: PacketCaptureLimitCheck = PacketCaptureLimitsUtil.check({
      requested: {
        maxDurationInSeconds: createBy.data.maxDurationInSeconds,
        maxPackets: createBy.data.maxPackets,
        maxFileSizeInMB: createBy.data.maxFileSizeInMB,
      },
      probeMaximums: capability.limits,
    });

    if (limitCheck.error || !limitCheck.limits) {
      throw new BadDataException(limitCheck.error || "Check the limits.");
    }

    const networkDeviceId: ObjectID | null = RelationIdUtil.readConsistent(
      data,
      NETWORK_DEVICE_RELATION_KEYS,
      "Network Device",
    );

    if (networkDeviceId) {
      const device: NetworkDevice | null =
        await NetworkDeviceService.findOneById({
          id: networkDeviceId,
          select: { _id: true, projectId: true },
          props: { isRoot: true },
        });

      if (
        !device ||
        !device.projectId ||
        device.projectId.toString() !== projectId.toString()
      ) {
        throw new BadDataException("Network Device not found.");
      }
    }

    /*
     * Last, after every cheaper refusal: the one check that counts rows.
     * Two people starting the last free slot at the same moment can both
     * get it; the probe then runs them one after the other.
     */
    const activeCount: number = (
      await this.countBy({
        query: {
          probeId: probeId,
          status: QueryHelper.any([
            PacketCaptureStatus.Pending,
            PacketCaptureStatus.Running,
          ]),
        },
        props: { isRoot: true },
      })
    ).toNumber();

    if (activeCount >= PACKET_CAPTURE_MAX_ACTIVE_PER_PROBE) {
      throw new BadDataException(
        getActiveCaptureLimitMessage(PACKET_CAPTURE_MAX_ACTIVE_PER_PROBE),
      );
    }

    if (!createBy.data.projectId) {
      createBy.data.projectId = projectId;
    }

    /*
     * The relation spellings go once the checked ids sit in their columns:
     * TypeORM stores a relation's id over its column's when both are set.
     */
    data["project"] = undefined;
    RelationIdUtil.stamp(data, PROBE_RELATION_KEYS, probeId);
    RelationIdUtil.stamp(data, NETWORK_DEVICE_RELATION_KEYS, networkDeviceId);
    RelationIdUtil.stamp(data, FILE_RELATION_KEYS, null);

    createBy.data.interfaceName = interfaceName;
    createBy.data.bpfFilter = bpfFilter;
    createBy.data.maxDurationInSeconds = limitCheck.limits.maxDurationInSeconds;
    createBy.data.maxPackets = limitCheck.limits.maxPackets;
    createBy.data.maxFileSizeInMB = limitCheck.limits.maxFileSizeInMB;
    createBy.data.name = getPacketCaptureName({
      interfaceName: interfaceName,
      bpfFilter: bpfFilter,
    });
    createBy.data.status = PacketCaptureStatus.Pending;

    /*
     * Undefined rather than null: an undefined column is not written, and
     * is what ColumnPermission skips, so a client that posted a result is
     * corrected rather than refused.
     */
    for (const column of RUN_COLUMNS) {
      data[column] = undefined;
    }

    return { createBy, carryForward: null };
  }

  /*
   * The probe's report, or the refusal that says what is missing, in the
   * order someone would fix it: update the probe, turn captures on, install
   * the tool.
   */
  public static assertCanCapture(probe: Probe): PacketCaptureCapability {
    const capability: PacketCaptureCapability | null =
      PacketCaptureCapabilityUtil.parse(probe.packetCaptureCapability);

    if (!capability) {
      throw new BadDataException(CAPABILITY_NOT_REPORTED_MESSAGE);
    }

    if (!capability.isEnabled) {
      throw new BadDataException(CAPTURE_TURNED_OFF_MESSAGE);
    }

    if (!capability.isToolAvailable) {
      throw new BadDataException(TOOL_MISSING_MESSAGE);
    }

    if (capability.interfaces.length === 0) {
      throw new BadDataException(NO_INTERFACES_MESSAGE);
    }

    return capability;
  }

  /*
   * What the delete is about to remove, with their files: the rows the
   * caller may delete (DatabaseService narrows the query to them before this
   * hook), and only in the request's project.
   */
  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const query: Query<Model> = { ...deleteBy.query };

    if (deleteBy.props.tenantId) {
      query.projectId = deleteBy.props.tenantId;
    }

    const rows: Array<Model> = await this.findBy({
      query: query,
      select: { _id: true, fileId: true },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });

    const files: Array<DeletedCaptureFile> = [];

    for (const row of rows) {
      if (row.id && row.fileId) {
        files.push({
          captureId: row.id.toString().toLowerCase(),
          fileId: row.fileId,
        });
      }
    }

    return { deleteBy, carryForward: files };
  }

  /*
   * A deleted capture's file goes with it, at once: the file holds the
   * traffic, and nothing else points at it.
   */
  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    const deleted: Set<string> = new Set(
      itemIdsBeforeDelete.map((id: ObjectID): string => {
        return id.toString().toLowerCase();
      }),
    );

    const fileIds: Array<ObjectID> = (
      (onDelete.carryForward as Array<DeletedCaptureFile> | null) || []
    )
      .filter((file: DeletedCaptureFile): boolean => {
        return deleted.has(file.captureId);
      })
      .map((file: DeletedCaptureFile): ObjectID => {
        return file.fileId;
      });

    if (fileIds.length > 0) {
      await FileService.hardDeleteBy({
        query: {
          _id: QueryHelper.any(
            fileIds.map((fileId: ObjectID): string => {
              return fileId.toString();
            }),
          ),
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      });
    }

    return onDelete;
  }

  /*
   * Keeps what a probe reported about packet capture on the probe, for the
   * dashboard and for onBeforeCreate to read. Only a project's own probe
   * keeps one: a global probe never captures, so its report is dropped and
   * the answer is false. Written only when it changed (jsonb compares by
   * value), so a probe reporting the same thing every few minutes costs a
   * read, not a write.
   */
  @CaptureSpan()
  public async recordProbeCapability(data: {
    probeId: ObjectID;
    capability: PacketCaptureCapability;
  }): Promise<boolean> {
    const probe: Probe | null = await ProbeService.findOneById({
      id: data.probeId,
      select: { _id: true, projectId: true, isGlobalProbe: true },
      props: { isRoot: true },
    });

    if (!probe || !probe.projectId || probe.isGlobalProbe) {
      return false;
    }

    await this.executeTransaction(
      async (transactionalEntityManager: EntityManager): Promise<void> => {
        await transactionalEntityManager.query(
          `
            UPDATE "Probe"
            SET "packetCaptureCapability" = $2::jsonb
            WHERE "_id" = $1
              AND "projectId" IS NOT NULL
              AND "packetCaptureCapability" IS DISTINCT FROM $2::jsonb
          `,
          [data.probeId.toString(), JSON.stringify(data.capability)],
        );
      },
    );

    return true;
  }

  /*
   * Hands a probe its Pending captures, oldest first, at most `limit` (the
   * capture slots it has free), and marks them Running. FOR UPDATE SKIP
   * LOCKED, so two replicas of one probe never run the same capture.
   * Captures older than the pickup window are left for the sweep to fail:
   * whoever started one has long since been told it was not picked up.
   */
  @CaptureSpan()
  public async claimPendingForProbe(data: {
    probeId: ObjectID;
    limit: number;
  }): Promise<Array<PacketCaptureJob>> {
    if (data.limit < 1) {
      return [];
    }

    const pickupWindowStart: Date = OneUptimeDate.addRemoveMinutes(
      OneUptimeDate.getCurrentDate(),
      -PACKET_CAPTURE_PICKUP_TIMEOUT_IN_MINUTES,
    );

    return await this.executeTransaction(
      async (
        transactionalEntityManager: EntityManager,
      ): Promise<Array<PacketCaptureJob>> => {
        const rows: unknown = await transactionalEntityManager.query(
          `
            SELECT c."_id", c."interfaceName", c."bpfFilter",
                   c."maxDurationInSeconds", c."maxPackets", c."maxFileSizeInMB"
            FROM "PacketCapture" c
            WHERE c."probeId" = $1
              AND c."status" = $2
              AND c."createdAt" >= $3
              AND c."deletedAt" IS NULL
            ORDER BY c."createdAt" ASC
            LIMIT $4
            FOR UPDATE OF c SKIP LOCKED
          `,
          [
            data.probeId.toString(),
            PacketCaptureStatus.Pending,
            pickupWindowStart,
            data.limit,
          ],
        );

        const claimed: Array<Record<string, unknown>> = Array.isArray(rows)
          ? (rows as Array<Record<string, unknown>>)
          : [];

        if (claimed.length === 0) {
          return [];
        }

        await transactionalEntityManager.query(
          `
            UPDATE "PacketCapture"
            SET "status" = $2,
                "startedAt" = now(),
                "updatedAt" = now()
            WHERE "_id" = ANY($1::uuid[])
          `,
          [
            claimed.map((row: Record<string, unknown>): string => {
              return String(row["_id"]);
            }),
            PacketCaptureStatus.Running,
          ],
        );

        return claimed.map((row: Record<string, unknown>): PacketCaptureJob => {
          return Service.toJob(row);
        });
      },
    );
  }

  /*
   * A claimed row as the probe runs it, its limits held to the hard
   * maximums once more: a row written past them by hand is still run inside
   * them.
   */
  public static toJob(row: Record<string, unknown>): PacketCaptureJob {
    const holdTo: (value: unknown, fallback: number, max: number) => number = (
      value: unknown,
      fallback: number,
      max: number,
    ): number => {
      const parsed: number = Number(value);

      if (!Number.isFinite(parsed) || parsed < 1) {
        return fallback;
      }

      return Math.min(Math.floor(parsed), max);
    };

    return {
      id: String(row["_id"]),
      interfaceName: String(row["interfaceName"] || ""),
      bpfFilter: PacketCaptureFilterUtil.normalize(
        typeof row["bpfFilter"] === "string" ? row["bpfFilter"] : "",
      ),
      maxDurationInSeconds: holdTo(
        row["maxDurationInSeconds"],
        HARD_MAX_PACKET_CAPTURE_LIMITS.maxDurationInSeconds,
        HARD_MAX_PACKET_CAPTURE_LIMITS.maxDurationInSeconds,
      ),
      maxPackets: holdTo(
        row["maxPackets"],
        HARD_MAX_PACKET_CAPTURE_LIMITS.maxPackets,
        HARD_MAX_PACKET_CAPTURE_LIMITS.maxPackets,
      ),
      maxFileSizeInBytes: PacketCaptureLimitsUtil.toBytes(
        holdTo(
          row["maxFileSizeInMB"],
          HARD_MAX_PACKET_CAPTURE_LIMITS.maxFileSizeInMB,
          HARD_MAX_PACKET_CAPTURE_LIMITS.maxFileSizeInMB,
        ),
      ),
    };
  }

  /*
   * The probe names the captures it is running; each one that is still this
   * probe's and Running is marked as heard from (so the sweep leaves it
   * alone), and the answer is which of them to stop: one someone stopped
   * from the dashboard, and one the server no longer has - deleted, failed
   * by the sweep, or never this probe's.
   */
  @CaptureSpan()
  public async findCapturesToStop(data: {
    probeId: ObjectID;
    runningPacketCaptureIds: Array<string>;
  }): Promise<Array<string>> {
    const requested: Array<string> = Array.from(
      new Set(
        data.runningPacketCaptureIds.map((id: string): string => {
          return id.trim().toLowerCase();
        }),
      ),
    );

    const valid: Array<string> = requested.filter((id: string): boolean => {
      return ObjectID.isValidUUID(id);
    });

    const keepRunning: Set<string> = new Set();

    if (valid.length > 0) {
      const result: unknown = await this.executeTransaction(
        async (transactionalEntityManager: EntityManager): Promise<unknown> => {
          return await transactionalEntityManager.query(
            `
              UPDATE "PacketCapture"
              SET "updatedAt" = now()
              WHERE "_id" = ANY($1::uuid[])
                AND "probeId" = $2
                AND "status" = $3
                AND "deletedAt" IS NULL
              RETURNING "_id", "stopRequestedAt"
            `,
            [valid, data.probeId.toString(), PacketCaptureStatus.Running],
          );
        },
      );

      for (const row of readReturnedRows(result)) {
        if (!row["stopRequestedAt"]) {
          keepRunning.add(readRowId(row));
        }
      }
    }

    return requested.filter((id: string): boolean => {
      return !keepRunning.has(id);
    });
  }

  /*
   * A capture the probe could not run or finish: Failed, with the probe's
   * reason. Keyed on the reporting probe, so a probe settles only captures
   * it was handed. False when there is no such Running capture.
   */
  @CaptureSpan()
  public async recordFailure(data: {
    probeId: ObjectID;
    packetCaptureId: ObjectID;
    statusMessage: string;
  }): Promise<boolean> {
    const result: unknown = await this.executeTransaction(
      async (transactionalEntityManager: EntityManager): Promise<unknown> => {
        return await transactionalEntityManager.query(
          `
            UPDATE "PacketCapture"
            SET "status" = $3,
                "statusMessage" = $4,
                "completedAt" = now(),
                "updatedAt" = now()
            WHERE "_id" = $1
              AND "probeId" = $2
              AND "status" = $5
              AND "deletedAt" IS NULL
            RETURNING "_id"
          `,
          [
            data.packetCaptureId.toString(),
            data.probeId.toString(),
            PacketCaptureStatus.Failed,
            Service.cutMessage(data.statusMessage) ||
              "The probe could not run this capture.",
            PacketCaptureStatus.Running,
          ],
        );
      },
    );

    return readReturnedRows(result).length > 0;
  }

  /*
   * A capture the probe finished: its file stored as a private file of the
   * capture's project, and the capture Completed with what OneUptime counted
   * in the file - not what the probe said. The file must be a pcap file no
   * larger than the capture's size limit; a half-written last packet is
   * dropped. A capture that matched no packets is Completed with no file.
   * False when there is no such Running capture of this probe; the file is
   * then not kept.
   */
  @CaptureSpan()
  public async recordCompletion(data: {
    probeId: ObjectID;
    packetCaptureId: ObjectID;
    pcap: Buffer | null;
    endReason: PacketCaptureEndReason | undefined;
    statusMessage?: string | undefined;
  }): Promise<boolean> {
    const capture: Model | null = await this.findOneBy({
      query: {
        _id: data.packetCaptureId.toString(),
        probeId: data.probeId,
        status: PacketCaptureStatus.Running,
      },
      select: {
        _id: true,
        projectId: true,
        interfaceName: true,
        maxFileSizeInMB: true,
        startedAt: true,
        createdAt: true,
        probe: {
          name: true,
        },
      },
      props: { isRoot: true },
    });

    if (!capture || !capture.projectId) {
      return false;
    }

    let packetCount: number = 0;
    let fileSizeInBytes: number = 0;
    let fileId: ObjectID | null = null;

    if (data.pcap && data.pcap.length > 0) {
      const inspection: PcapInspection = PcapFile.inspect(data.pcap);

      if (!inspection.isPcap) {
        throw new BadDataException(NOT_A_PCAP_MESSAGE);
      }

      const maxBytes: number = PacketCaptureLimitsUtil.toBytes(
        Math.min(
          capture.maxFileSizeInMB ||
            HARD_MAX_PACKET_CAPTURE_LIMITS.maxFileSizeInMB,
          HARD_MAX_PACKET_CAPTURE_LIMITS.maxFileSizeInMB,
        ),
      );

      if (data.pcap.length > maxBytes) {
        throw new BadDataException(FILE_TOO_LARGE_MESSAGE);
      }

      packetCount = inspection.packetCount;

      if (packetCount > 0) {
        const wholeFile: Buffer =
          inspection.wholeLength < data.pcap.length
            ? Buffer.from(data.pcap.subarray(0, inspection.wholeLength))
            : data.pcap;

        fileSizeInBytes = wholeFile.length;

        const file: File = new File();
        file.file = wholeFile;
        file.fileType = MimeType.pcap;
        file.isPublic = false;
        file.name = getPacketCaptureFileName({
          probeName: capture.probe?.name,
          interfaceName: capture.interfaceName || "",
          startedAt: capture.startedAt || capture.createdAt || new Date(),
        });

        const createdFile: File = await FileService.create({
          data: file,
          props: { isRoot: true, tenantId: capture.projectId },
        });

        fileId = createdFile.id || null;
      }
    }

    const endReason: PacketCaptureEndReason | undefined =
      PacketCaptureEndReasonUtil.parse(data.endReason);

    const result: unknown = await this.executeTransaction(
      async (transactionalEntityManager: EntityManager): Promise<unknown> => {
        return await transactionalEntityManager.query(
          `
            UPDATE "PacketCapture"
            SET "status" = $3,
                "endReason" = $4,
                "statusMessage" = $5,
                "packetCount" = $6,
                "fileSizeInBytes" = $7,
                "fileId" = $8,
                "completedAt" = now(),
                "updatedAt" = now()
            WHERE "_id" = $1
              AND "probeId" = $2
              AND "status" = $9
              AND "deletedAt" IS NULL
            RETURNING "_id"
          `,
          [
            data.packetCaptureId.toString(),
            data.probeId.toString(),
            PacketCaptureStatus.Completed,
            endReason || null,
            Service.cutMessage(data.statusMessage),
            packetCount,
            fileSizeInBytes,
            fileId ? fileId.toString() : null,
            PacketCaptureStatus.Running,
          ],
        );
      },
    );

    const recorded: boolean = readReturnedRows(result).length > 0;

    // The capture was settled or deleted while the file was uploading.
    if (!recorded && fileId) {
      await FileService.hardDeleteBy({
        query: { _id: fileId.toString() },
        limit: 1,
        skip: 0,
        props: { isRoot: true },
      });
    }

    return recorded;
  }

  /*
   * Asks the probe to stop a running capture early: it stops at its next
   * check, within about ten seconds, and uploads what it has. Scoped to the
   * project by the caller, whose permission to stop it the route checked.
   */
  @CaptureSpan()
  public async requestStop(data: {
    packetCaptureId: ObjectID;
    projectId: ObjectID;
  }): Promise<void> {
    const capture: Model | null = await this.findOneBy({
      query: {
        _id: data.packetCaptureId.toString(),
        projectId: data.projectId,
      },
      select: { _id: true, status: true },
      props: { isRoot: true },
    });

    if (!capture) {
      throw new BadDataException(PACKET_CAPTURE_NOT_FOUND_MESSAGE);
    }

    if (capture.status === PacketCaptureStatus.Pending) {
      throw new BadDataException(NOT_STARTED_MESSAGE);
    }

    if (capture.status !== PacketCaptureStatus.Running) {
      throw new BadDataException(ALREADY_FINISHED_MESSAGE);
    }

    const result: unknown = await this.executeTransaction(
      async (transactionalEntityManager: EntityManager): Promise<unknown> => {
        return await transactionalEntityManager.query(
          `
            UPDATE "PacketCapture"
            SET "stopRequestedAt" = COALESCE("stopRequestedAt", now()),
                "updatedAt" = now()
            WHERE "_id" = $1
              AND "projectId" = $2
              AND "status" = $3
              AND "deletedAt" IS NULL
            RETURNING "_id"
          `,
          [
            data.packetCaptureId.toString(),
            data.projectId.toString(),
            PacketCaptureStatus.Running,
          ],
        );
      },
    );

    // It finished between the read and the write.
    if (readReturnedRows(result).length === 0) {
      throw new BadDataException(ALREADY_FINISHED_MESSAGE);
    }
  }

  /*
   * Fails the captures nobody will finish, every minute: one its probe did
   * not pick up in time, one its probe stopped naming (restarted, lost its
   * connection), and one past its duration and upload grace. Returns how
   * many it failed.
   */
  @CaptureSpan()
  public async failStaleCaptures(): Promise<number> {
    const now: Date = OneUptimeDate.getCurrentDate();

    const pickupDeadline: Date = OneUptimeDate.addRemoveMinutes(
      now,
      -PACKET_CAPTURE_PICKUP_TIMEOUT_IN_MINUTES,
    );

    const heartbeatDeadline: Date = OneUptimeDate.addRemoveMinutes(
      now,
      -PACKET_CAPTURE_HEARTBEAT_TIMEOUT_IN_MINUTES,
    );

    const uploadDeadline: Date = OneUptimeDate.addRemoveMinutes(
      now,
      -PACKET_CAPTURE_UPLOAD_GRACE_IN_MINUTES,
    );

    return await this.executeTransaction(
      async (transactionalEntityManager: EntityManager): Promise<number> => {
        const notPickedUp: unknown = await transactionalEntityManager.query(
          `
            UPDATE "PacketCapture"
            SET "status" = $1, "statusMessage" = $2,
                "completedAt" = now(), "updatedAt" = now()
            WHERE "status" = $3
              AND "createdAt" < $4
              AND "deletedAt" IS NULL
            RETURNING "_id"
          `,
          [
            PacketCaptureStatus.Failed,
            PICKUP_TIMEOUT_MESSAGE,
            PacketCaptureStatus.Pending,
            pickupDeadline,
          ],
        );

        const pastDeadline: unknown = await transactionalEntityManager.query(
          `
            UPDATE "PacketCapture"
            SET "status" = $1, "statusMessage" = $2,
                "completedAt" = now(), "updatedAt" = now()
            WHERE "status" = $3
              AND "startedAt" + ("maxDurationInSeconds" * INTERVAL '1 second') < $4
              AND "deletedAt" IS NULL
            RETURNING "_id"
          `,
          [
            PacketCaptureStatus.Failed,
            UPLOAD_TIMEOUT_MESSAGE,
            PacketCaptureStatus.Running,
            uploadDeadline,
          ],
        );

        const notHeardFrom: unknown = await transactionalEntityManager.query(
          `
            UPDATE "PacketCapture"
            SET "status" = $1, "statusMessage" = $2,
                "completedAt" = now(), "updatedAt" = now()
            WHERE "status" = $3
              AND "updatedAt" < $4
              AND "deletedAt" IS NULL
            RETURNING "_id"
          `,
          [
            PacketCaptureStatus.Failed,
            HEARTBEAT_TIMEOUT_MESSAGE,
            PacketCaptureStatus.Running,
            heartbeatDeadline,
          ],
        );

        return (
          readReturnedRows(notPickedUp).length +
          readReturnedRows(pastDeadline).length +
          readReturnedRows(notHeardFrom).length
        );
      },
    );
  }

  /*
   * Deletes captures - finished or not, deleted or not - and their files
   * once they are older than the retention period, a batch at a time.
   * Returns how many captures it deleted.
   */
  @CaptureSpan()
  public async deleteExpiredCaptures(): Promise<number> {
    const cutoff: Date = OneUptimeDate.addRemoveDays(
      OneUptimeDate.getCurrentDate(),
      -PACKET_CAPTURE_RETENTION_IN_DAYS,
    );

    let deletedCount: number = 0;

    for (;;) {
      const deletedInBatch: number = await this.executeTransaction(
        async (transactionalEntityManager: EntityManager): Promise<number> => {
          const result: unknown = await transactionalEntityManager.query(
            `
              DELETE FROM "PacketCapture"
              WHERE "_id" IN (
                SELECT "_id" FROM "PacketCapture"
                WHERE "createdAt" < $1
                ORDER BY "createdAt" ASC
                LIMIT $2
              )
              RETURNING "_id", "fileId"
            `,
            [cutoff, RETENTION_BATCH_SIZE],
          );

          const rows: Array<Record<string, unknown>> = readReturnedRows(result);

          const fileIds: Array<string> = rows
            .map((row: Record<string, unknown>): string => {
              return String(row["fileId"] || "");
            })
            .filter((fileId: string): boolean => {
              return ObjectID.isValidUUID(fileId);
            });

          if (fileIds.length > 0) {
            await transactionalEntityManager.query(
              `DELETE FROM "File" WHERE "_id" = ANY($1::uuid[])`,
              [fileIds],
            );
          }

          return rows.length;
        },
      );

      deletedCount += deletedInBatch;

      if (deletedInBatch < RETENTION_BATCH_SIZE) {
        return deletedCount;
      }
    }
  }

  /*
   * Raw SQL skips DatabaseService's length checks, and Postgres refuses a
   * value longer than the column - which would leave the capture Running.
   * Cut to fit instead.
   */
  private static cutMessage(message: string | undefined | null): string | null {
    const trimmed: string = (message || "").trim();

    if (!trimmed) {
      return null;
    }

    return trimmed.length > ColumnLength.LongText
      ? `${trimmed.substring(0, ColumnLength.LongText - 1)}…`
      : trimmed;
  }
}

export default new Service();
