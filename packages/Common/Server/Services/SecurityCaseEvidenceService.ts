import FileService from "./FileService";
import ProjectReferencesService from "./ProjectReferencesService";
import SecurityCaseFeedService from "./SecurityCaseFeedService";
import Model from "../../Models/DatabaseModels/SecurityCaseEvidence";
import File from "../../Models/DatabaseModels/File";
import { SecurityCaseFeedEventType } from "../../Models/DatabaseModels/SecurityCaseFeed";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import FileOwnership from "../Utils/File/FileOwnership";
import logger from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import Protocol from "../../Types/API/Protocol";
import URL from "../../Types/API/URL";
import { Gray500, Red500 } from "../../Types/BrandColors";
import ColumnLength from "../../Types/Database/ColumnLength";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import SecurityCaseEvidenceKind, {
  isSecurityCaseEvidenceKind,
} from "../../Types/SecurityCase/SecurityCaseEvidenceKind";
import {
  eventEvidenceLineMarkdown,
  eventsAddedMarkdown,
  evidenceAddedMarkdown,
  evidenceRemovedMarkdown,
} from "../../Utils/SecurityCase/SecurityCaseMarkdown";
import FeedMarkdown, { MarkdownText } from "../../Utils/Markdown/FeedMarkdown";
import SecurityCase from "../../Models/DatabaseModels/SecurityCase";
import SecurityEvent from "../../Models/AnalyticsModels/SecurityEvent";
import SecurityCaseService from "./SecurityCaseService";
import SecurityDetectionService from "./SecurityDetectionService";
import SecurityEventService from "./SecurityEventService";
import SecurityDetection from "../../Models/DatabaseModels/SecurityDetection";
import {
  SecurityDetectionMatchedEvent,
  SecurityDetectionMatchedEvents,
  readSecurityDetectionMatchedEvents,
} from "../../Types/SecurityCase/SecurityDetectionMatchedEvents";
import { isKeptEventReadable } from "../Utils/SecurityCase/Context/SecurityCaseMatches";
import TelemetryReadAccess from "../Utils/Telemetry/TelemetryReadAccess";
import { TelemetryServiceFilter } from "../Utils/Telemetry/TelemetryReadScope";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../Types/BaseDatabase/Includes";
import InBetween from "../../Types/BaseDatabase/InBetween";
import Query from "../../Types/BaseDatabase/Query";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../Types/Date";
import Dictionary from "../../Types/Dictionary";
import Timezone from "../../Types/Timezone";
import QueryHelper from "../Types/Database/QueryHelper";
import Select from "../Types/AnalyticsDatabase/Select";
import {
  SECURITY_CASE_EVENT_EVIDENCE_MAX_PER_ADD,
  SECURITY_CASE_EVENT_SNAPSHOT_COLUMNS,
  SecurityCaseEventDetection,
  SecurityCaseEventHunt,
  SecurityCaseEventReference,
  SecurityCaseEventSnapshot,
  SecurityCaseEventsAddResult,
  buildSecurityCaseEventSnapshot,
  getSecurityCaseEventEvidenceName,
} from "../../Types/SecurityCase/SecurityCaseEventEvidence";
import crypto from "crypto";

/*
 * The evidence kept on a security case (SecurityCaseEvidence): a file
 * uploaded to OneUptime, or a link to evidence kept somewhere else.
 *
 * Kept as it was added. As a file is added, OneUptime reads it - once, from
 * the case's own project, which is the only project's file a case may point
 * at - and records its name, type, size and the SHA-256 of its bytes, so
 * whoever downloads it later can check it is what was kept. A link must be
 * an http or https address: it is drawn as a link on the case, and nothing
 * else belongs in one. Only the name and the description change after that
 * (the model's column permissions keep the rest create-only).
 *
 * The case's timeline says what was added - with the file's SHA-256 - and
 * what was removed, and by whom.
 */

// The longest description a piece of evidence keeps.
export const MAX_EVIDENCE_DESCRIPTION_LENGTH: number = 5000;

const FILE_KEYS: Array<string> = ["fileId", "file"];

// The answer for a file that is not there and for another project's: the same.
export const EVIDENCE_FILE_NOT_FOUND: string =
  "The evidence's file was not found. Upload it to this project, then add it.";

// The answer for a case that is not there and for one the person cannot read: the same.
export const SECURITY_CASE_EVENTS_CASE_NOT_FOUND: string =
  "This case was not found. It may have been deleted, or be one you cannot see.";

/*
 * How far an event's time may be from the time a request names: a list
 * row's time is the event's own, but a client may round it to the second.
 */
const EVENT_TIME_SLACK_IN_MS: number = 1000;

// An event's columns as a snapshot reads them, from the row OneUptime read.
function readEventColumns(event: SecurityEvent): { [column: string]: unknown } {
  const columns: { [column: string]: unknown } = {};

  for (const column of SECURITY_CASE_EVENT_SNAPSHOT_COLUMNS) {
    columns[column] = event.getColumnValue(column);
  }

  return columns;
}

// A piece of evidence's name as it is kept: trimmed, at most 500 characters.
export function normalizeEvidenceName(value: unknown): string {
  const name: string = typeof value === "string" ? value.trim() : "";

  return name.length > ColumnLength.LongText
    ? name.substring(0, ColumnLength.LongText)
    : name;
}

/*
 * A link's address as it is kept: an http or https address, anything else
 * refused - a link is drawn as one on the case, so a javascript: or a data:
 * address never gets near an href.
 */
export function readEvidenceUrl(value: unknown): URL {
  let url: URL | null = null;

  try {
    if (value instanceof URL) {
      url = value;
    } else if (typeof value === "string" && value.trim()) {
      url = URL.fromString(value.trim());
    }
  } catch {
    url = null;
  }

  if (
    !url ||
    (url.protocol !== Protocol.HTTPS && url.protocol !== Protocol.HTTP)
  ) {
    throw new BadDataException(
      "A link needs an http or https address of where the evidence is kept.",
    );
  }

  return url;
}

// What OneUptime records of an uploaded file, read once as it is added.
export interface EvidenceFileFacts {
  fileName: string;
  fileType: string;
  fileSizeInBytes: number;
  sha256: string;
}

export function readEvidenceFileFacts(file: File): EvidenceFileFacts {
  const bytes: Buffer = Buffer.isBuffer(file.file)
    ? file.file
    : Buffer.from((file.file || []) as unknown as Uint8Array);

  return {
    fileName: (file.name || "").substring(0, ColumnLength.ShortText),
    fileType: (file.fileType || "")
      .toString()
      .substring(0, ColumnLength.ShortText),
    fileSizeInBytes: bytes.length,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
  };
}

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Security events kept on a case (SecurityCaseEvidenceKind.Event), as the
   * person keeping them: the case must be one they can read, and each event
   * is read from the events table AS THEM - an event they cannot read, or
   * one past its retention, is not found, said the same way. What is kept
   * is what OneUptime read (Types/SecurityCase/SecurityCaseEventEvidence),
   * never what the request said it was. An event kept on the case already
   * is left as it was. The case's timeline gets one entry for them all,
   * with the hunt that found them.
   *
   * The caller's right to add evidence and to read security events is the
   * route's to check (SecurityCaseEvidenceAPI); the rows are written by
   * OneUptime, in the caller's name, as no caller may write an event's
   * snapshot.
   *
   * Events kept from what one of the case's detections matched (its "Why
   * This Case Was Opened", #9622) name the detection - one on this case the
   * person can read. An event past its retention is kept as that detection
   * kept it when it fired (SecurityDetection.matchedEvents, #9619): also
   * what OneUptime read, never what the request said, and only an event of
   * a source the person's role reads.
   */
  @CaptureSpan()
  public async addEvents(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    events: Array<SecurityCaseEventReference>;
    hunt: SecurityCaseEventHunt | null;
    // The detection on this case the events were matched by.
    detectionId?: ObjectID | null | undefined;
    props: DatabaseCommonInteractionProps;
  }): Promise<SecurityCaseEventsAddResult> {
    const result: SecurityCaseEventsAddResult = {
      added: [],
      alreadyOnCase: [],
      notFound: [],
    };

    if (data.events.length === 0) {
      return result;
    }

    if (data.events.length > SECURITY_CASE_EVENT_EVIDENCE_MAX_PER_ADD) {
      throw new BadDataException(
        `Keep at most ${SECURITY_CASE_EVENT_EVIDENCE_MAX_PER_ADD.toString()} events on a case at a time.`,
      );
    }

    const securityCase: SecurityCase | null =
      await SecurityCaseService.findOneBy({
        query: {
          _id: data.securityCaseId,
          projectId: data.projectId,
        },
        select: {
          _id: true,
        },
        props: data.props,
      });

    if (!securityCase) {
      throw new BadDataException(SECURITY_CASE_EVENTS_CASE_NOT_FOUND);
    }

    const detection: SecurityCaseEventDetection | null = data.detectionId
      ? await this.readMatchingDetection({
          projectId: data.projectId,
          securityCaseId: data.securityCaseId,
          detectionId: data.detectionId,
          props: data.props,
        })
      : null;

    const eventsByUid: Map<string, SecurityEvent> = await this.readEvents({
      projectId: data.projectId,
      events: data.events,
      props: data.props,
    });

    // Past their retention: as the detection kept them, when it kept them.
    const keptByUid: Map<string, SecurityDetectionMatchedEvent> = detection
      ? await this.readEventsTheDetectionKept({
          detectionId: new ObjectID(detection.id),
          events: data.events.filter(
            (reference: SecurityCaseEventReference): boolean => {
              return !eventsByUid.has(reference.eventUid);
            },
          ),
          props: data.props,
        })
      : new Map();

    const kept: Array<Model> = await this.findBy({
      query: {
        projectId: data.projectId,
        securityCaseId: data.securityCaseId,
        kind: SecurityCaseEvidenceKind.Event,
        eventUid: QueryHelper.any(
          data.events.map((event: SecurityCaseEventReference): string => {
            return event.eventUid;
          }),
        ),
      },
      select: {
        _id: true,
        eventUid: true,
      },
      skip: 0,
      limit: SECURITY_CASE_EVENT_EVIDENCE_MAX_PER_ADD,
      props: {
        isRoot: true,
      },
    });

    const keptUids: Set<string> = new Set<string>(
      kept.map((item: Model): string => {
        return item.eventUid || "";
      }),
    );

    const lines: Array<MarkdownText> = [];

    for (const reference of data.events) {
      if (keptUids.has(reference.eventUid)) {
        result.alreadyOnCase.push(reference.eventUid);
        continue;
      }

      const event: SecurityEvent | undefined = eventsByUid.get(
        reference.eventUid,
      );
      const keptCopy: SecurityDetectionMatchedEvent | undefined = keptByUid.get(
        reference.eventUid,
      );

      if (!event && !keptCopy) {
        result.notFound.push(reference.eventUid);
        continue;
      }

      const snapshot: SecurityCaseEventSnapshot =
        buildSecurityCaseEventSnapshot({
          event: event
            ? readEventColumns(event)
            : { ...keptCopy, primaryEntityId: keptCopy!.sourceId },
          hunt: data.hunt,
          detection,
        });

      const evidence: Model = new Model();
      evidence.projectId = data.projectId;
      evidence.securityCaseId = data.securityCaseId;
      evidence.kind = SecurityCaseEvidenceKind.Event;
      evidence.name = getSecurityCaseEventEvidenceName(snapshot);
      evidence.eventUid = snapshot.eventUid;
      if (snapshot.time) {
        evidence.eventTime = new Date(snapshot.time);
      }

      evidence.eventSnapshot = snapshot as unknown as JSONObject;

      if (data.props.userId) {
        evidence.createdByUserId = data.props.userId;
      }

      await this.create({
        data: evidence,
        props: {
          isRoot: true,
          ...(data.props.userId ? { userId: data.props.userId } : {}),
        },
      });

      keptUids.add(reference.eventUid);
      result.added.push(reference.eventUid);
      lines.push(
        eventEvidenceLineMarkdown({
          time: snapshot.time
            ? OneUptimeDate.getDateAsFormattedArrayInMultipleTimezones({
                date: snapshot.time,
                timezones: [Timezone.UTC],
              })[0] || snapshot.time
            : "",
          severity: snapshot.severityName,
          name: evidence.name || "",
        }),
      );
    }

    if (result.added.length > 0) {
      try {
        await SecurityCaseFeedService.createSecurityCaseFeedItem({
          projectId: data.projectId,
          securityCaseId: data.securityCaseId,
          feedInfoInMarkdown: eventsAddedMarkdown({
            count: result.added.length,
            huntName: data.hunt?.name,
            detectionName: detection?.name,
          }).toString(),
          moreInformationInMarkdown: FeedMarkdown.bulletList(lines).toString(),
          eventType: SecurityCaseFeedEventType.Evidence,
          displayColor: Gray500,
          userId: data.props.userId,
        });
      } catch (error) {
        // The events are kept; what the timeline says about them must not undo that.
        logger.error(
          `SecurityCaseEvidenceService: could not record the events kept on case ${data.securityCaseId.toString()}:`,
        );
        logger.error(error);
      }
    }

    return result;
  }

  /*
   * The detection a request names, as the person asking reads it: one of
   * this case's, named by its rule (or its title). None when it is not
   * there, not this case's, or not theirs to read: the events are then kept
   * as any are, naming nothing.
   */
  private async readMatchingDetection(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    detectionId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<SecurityCaseEventDetection | null> {
    try {
      const detection: SecurityDetection | null =
        await SecurityDetectionService.findOneBy({
          query: {
            _id: data.detectionId,
            projectId: data.projectId,
            securityCaseId: data.securityCaseId,
          },
          select: {
            _id: true,
            title: true,
            ruleName: true,
          },
          props: data.props,
        });
      const name: string = (
        detection?.ruleName ||
        detection?.title ||
        ""
      ).trim();

      return detection?.id && name
        ? { id: detection.id.toString(), name }
        : null;
    } catch (error) {
      logger.debug(
        `SecurityCaseEvidenceService: the detection ${data.detectionId.toString()} named to keep events from was not read: ${error}`,
      );
      return null;
    }
  }

  /*
   * The events a detection kept when it fired, by id, for the ones a
   * request names that the events table no longer has: each within a
   * second of the time named, and of a source the person's role reads, as
   * the case's "Why This Case Was Opened" shows them. Read as OneUptime -
   * no role reads the column itself - and handed on only as the person may
   * read each event. None when the person may read no security events.
   */
  private async readEventsTheDetectionKept(data: {
    detectionId: ObjectID;
    events: Array<SecurityCaseEventReference>;
    props: DatabaseCommonInteractionProps;
  }): Promise<Map<string, SecurityDetectionMatchedEvent>> {
    const found: Map<string, SecurityDetectionMatchedEvent> = new Map();

    if (data.events.length === 0) {
      return found;
    }

    let serviceFilter: TelemetryServiceFilter;

    try {
      serviceFilter = await TelemetryReadAccess.getServiceFilter({
        modelType: SecurityEvent,
        props: data.props,
      });
    } catch {
      return found;
    }

    const stored: SecurityDetection | null =
      await SecurityDetectionService.findOneById({
        id: data.detectionId,
        select: {
          matchedEvents: true,
        },
        props: {
          isRoot: true,
        },
      });
    const kept: SecurityDetectionMatchedEvents | null =
      readSecurityDetectionMatchedEvents(stored?.matchedEvents);

    for (const reference of data.events) {
      const event: SecurityDetectionMatchedEvent | undefined = (
        kept?.events || []
      ).find((candidate: SecurityDetectionMatchedEvent): boolean => {
        const time: number = candidate.time
          ? new Date(candidate.time).getTime()
          : NaN;

        return (
          candidate.eventUid === reference.eventUid &&
          !Number.isNaN(time) &&
          Math.abs(time - reference.time.getTime()) <= EVENT_TIME_SLACK_IN_MS
        );
      });

      if (event && isKeptEventReadable({ event, serviceFilter })) {
        found.set(reference.eventUid, event);
      }
    }

    return found;
  }

  /*
   * The events a request names, read as the person asking: each by its id,
   * in a window around the times named, the one closest to its time kept
   * where an id repeats.
   */
  private async readEvents(data: {
    projectId: ObjectID;
    events: Array<SecurityCaseEventReference>;
    props: DatabaseCommonInteractionProps;
  }): Promise<Map<string, SecurityEvent>> {
    const times: Array<number> = data.events.map(
      (event: SecurityCaseEventReference): number => {
        return event.time.getTime();
      },
    );
    const from: Date = new Date(Math.min(...times) - EVENT_TIME_SLACK_IN_MS);
    const to: Date = new Date(Math.max(...times) + EVENT_TIME_SLACK_IN_MS);
    const timeByUid: Map<string, number> = new Map<string, number>(
      data.events.map((event: SecurityCaseEventReference): [string, number] => {
        return [event.eventUid, event.time.getTime()];
      }),
    );

    const select: Select<SecurityEvent> = {};

    for (const column of SECURITY_CASE_EVENT_SNAPSHOT_COLUMNS) {
      (select as Dictionary<boolean>)[column] = true;
    }

    const rows: Array<SecurityEvent> = await SecurityEventService.findBy({
      query: {
        projectId: data.projectId,
        eventUid: new Includes(Array.from(timeByUid.keys())),
        time: new InBetween<Date>(from, to),
      } as Query<SecurityEvent>,
      select,
      sort: {
        time: SortOrder.Descending,
      },
      skip: 0,
      limit: data.events.length * 4,
      props: data.props,
    });

    const found: Map<string, SecurityEvent> = new Map<string, SecurityEvent>();

    for (const row of rows) {
      const uid: string = row.eventUid || "";
      const wanted: number | undefined = timeByUid.get(uid);
      const time: number = row.time ? new Date(row.time).getTime() : NaN;

      if (
        wanted === undefined ||
        Number.isNaN(time) ||
        Math.abs(time - wanted) > EVENT_TIME_SLACK_IN_MS
      ) {
        continue;
      }

      const current: SecurityEvent | undefined = found.get(uid);
      const currentTime: number = current?.time
        ? new Date(current.time).getTime()
        : NaN;

      if (
        !current ||
        Math.abs(time - wanted) < Math.abs(currentTime - wanted)
      ) {
        found.set(uid, row);
      }
    }

    return found;
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    const data: Model = createBy.data;
    const record: JSONObject = data as unknown as JSONObject;

    if (!isSecurityCaseEvidenceKind(data.kind)) {
      throw new BadDataException(
        "Evidence is a File, uploaded to OneUptime, or a Link to where it is kept.",
      );
    }

    if (
      data.description !== undefined &&
      data.description !== null &&
      data.description.length > MAX_EVIDENCE_DESCRIPTION_LENGTH
    ) {
      throw new BadDataException(
        `A description can be at most ${MAX_EVIDENCE_DESCRIPTION_LENGTH.toString()} characters.`,
      );
    }

    /*
     * An event is kept from what OneUptime reads of it (addEvents), never
     * from what a request says it was.
     */
    if (data.kind === SecurityCaseEvidenceKind.Event) {
      if (!createBy.props.isRoot) {
        throw new BadDataException(
          "Security events are kept on a case from Security Events: tick them on Events or a hunt, then choose Add to Case.",
        );
      }

      data.name = normalizeEvidenceName(data.name) || "Security event";

      return { createBy, carryForward: null };
    }

    const fileId: ObjectID | null = RelationIdUtil.readIntoIdColumn(
      record,
      FILE_KEYS,
      "File",
    );

    if (data.kind === SecurityCaseEvidenceKind.File) {
      if (record["url"]) {
        throw new BadDataException(
          "File evidence has a file, not a link. Add the link as Link evidence.",
        );
      }

      if (!fileId || !data.projectId) {
        throw new BadDataException("File evidence needs a file: upload one.");
      }

      const facts: EvidenceFileFacts = await this.readProjectFile({
        fileId,
        projectId: data.projectId,
      });

      data.fileName = facts.fileName;
      data.fileType = facts.fileType;
      data.fileSizeInBytes = facts.fileSizeInBytes;
      data.sha256 = facts.sha256;
      data.name = normalizeEvidenceName(data.name) || facts.fileName || "File";

      return { createBy, carryForward: null };
    }

    // A Link.
    if (fileId) {
      throw new BadDataException(
        "Link evidence has an address, not a file. Add the file as File evidence.",
      );
    }

    const url: URL = readEvidenceUrl(record["url"]);

    data.url = url;
    data.name = normalizeEvidenceName(data.name) || url.toString();

    return { createBy, carryForward: null };
  }

  /*
   * The file a piece of evidence is made of: one uploaded in the case's own
   * project, read once to measure it. Any other answers as a file that is
   * not there.
   */
  private async readProjectFile(data: {
    fileId: ObjectID;
    projectId: ObjectID;
  }): Promise<EvidenceFileFacts> {
    const file: File | null = await FileService.findOneById({
      id: data.fileId,
      select: {
        _id: true,
        name: true,
        fileType: true,
        file: true,
        projectId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!file || !FileOwnership.isFileOfProject(file, data.projectId)) {
      throw new BadDataException(EVIDENCE_FILE_NOT_FOUND);
    }

    return readEvidenceFileFacts(file);
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (!createdItem.projectId || !createdItem.securityCaseId) {
      return createdItem;
    }

    // Kept events are said once for them all (addEvents).
    if (createdItem.kind === SecurityCaseEvidenceKind.Event) {
      return createdItem;
    }

    try {
      await SecurityCaseFeedService.createSecurityCaseFeedItem({
        projectId: createdItem.projectId,
        securityCaseId: createdItem.securityCaseId,
        feedInfoInMarkdown: evidenceAddedMarkdown({
          name: createdItem.name || "",
          sha256: createdItem.sha256 || undefined,
          url: createdItem.url ? createdItem.url.toString() : undefined,
        }).toString(),
        eventType: SecurityCaseFeedEventType.Evidence,
        displayColor: Gray500,
        userId: createdItem.createdByUserId || onCreate.createBy.props.userId,
      });
    } catch (error) {
      // The evidence is kept; what the timeline says about it must not undo that.
      logger.error(
        `SecurityCaseEvidenceService: could not record the new evidence ${createdItem.id?.toString() || ""} on its case:`,
      );
      logger.error(error);
    }

    return createdItem;
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    const data: JSONObject = updateBy.data as unknown as JSONObject;

    if (data["name"] !== undefined) {
      const name: string = normalizeEvidenceName(data["name"]);

      if (!name) {
        throw new BadDataException("Evidence needs a name.");
      }

      data["name"] = name;
    }

    if (
      typeof data["description"] === "string" &&
      (data["description"] as string).length > MAX_EVIDENCE_DESCRIPTION_LENGTH
    ) {
      throw new BadDataException(
        `A description can be at most ${MAX_EVIDENCE_DESCRIPTION_LENGTH.toString()} characters.`,
      );
    }

    return { updateBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    // The rows are gone by onDeleteSuccess: what the timeline says is read here.
    const rows: Array<Model> = await this.findRowsAndHoldDeleteToThem(
      deleteBy,
      {
        _id: true,
        projectId: true,
        securityCaseId: true,
        name: true,
      },
    );

    return { deleteBy, carryForward: { rows } };
  }

  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    const rows: Array<Model> = (onDelete.carryForward?.rows ||
      []) as Array<Model>;
    const actorUserId: ObjectID | undefined =
      onDelete.deleteBy.deletedByUser?.id || onDelete.deleteBy.props.userId;

    for (const row of rows) {
      if (!row.projectId || !row.securityCaseId) {
        continue;
      }

      try {
        await SecurityCaseFeedService.createSecurityCaseFeedItem({
          projectId: row.projectId,
          securityCaseId: row.securityCaseId,
          feedInfoInMarkdown: evidenceRemovedMarkdown({
            name: row.name || "",
          }).toString(),
          eventType: SecurityCaseFeedEventType.Evidence,
          displayColor: Red500,
          userId: actorUserId,
        });
      } catch (error) {
        logger.error(
          `SecurityCaseEvidenceService: could not record the removed evidence ${row.id?.toString() || ""} on its case:`,
        );
        logger.error(error);
      }
    }

    return onDelete;
  }
}

export default new Service();
