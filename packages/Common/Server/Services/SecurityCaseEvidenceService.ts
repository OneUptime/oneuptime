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
  evidenceAddedMarkdown,
  evidenceRemovedMarkdown,
} from "../../Utils/SecurityCase/SecurityCaseMarkdown";
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
