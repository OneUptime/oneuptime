import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import FindBy from "../Types/Database/FindBy";
import { OnCreate, OnDelete, OnFind, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import DatabaseService from "./DatabaseService";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import File from "../../Models/DatabaseModels/File";
import Dictionary from "../../Types/Dictionary";
import MimeType from "../../Types/File/MimeType";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger from "../Utils/Logger";
import FileOwnership, {
  FileOwners,
  normalizeFileId,
} from "../Utils/File/FileOwnership";
import { FileAccessFacts } from "../Utils/File/RelatedFileAccess";
import {
  HIDE_PRIVATE_RECORD_IMAGES_SQL,
  HIDE_UNSHOWN_FILES_SQL,
  PUBLISH_SHOWN_IMAGES_SQL,
} from "../Utils/File/PublishedImages";
import QueryHelper from "../Types/Database/QueryHelper";
import Query from "../Types/Database/Query";
import Select from "../Types/Database/Select";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import crypto from "crypto";
import { SelectQueryBuilder } from "typeorm";

const generateImageAccessToken: () => string = (): string => {
  return crypto.randomBytes(32).toString("hex");
};

// The refusal for an upload into a project the uploader cannot act in.
export const UPLOAD_OUTSIDE_PROJECT_MESSAGE: string =
  "You can upload files only to a project you are a member of.";

// An id column as Postgres hands it back raw: a uuid string, or null.
const readStoredId: (value: unknown) => ObjectID | null = (
  value: unknown,
): ObjectID | null => {
  return typeof value === "string" && ObjectID.isValidUUID(value)
    ? new ObjectID(value)
    : null;
};

/*
 * fileType is declared as MimeType but persisted as a varchar, so the enum
 * buys nothing at runtime - the API will happily store "text/html" if a client
 * asks for it. Response.sendFileResponse refuses to echo an unknown type back,
 * but keeping junk out of the column in the first place means the stored row
 * matches what we are willing to serve.
 */
const ALLOWED_MIME_TYPES: Set<string> = new Set<string>(
  Object.values(MimeType),
);

// A record's file, and the record's stored project (null for none).
export interface RecordFile {
  fileId: ObjectID | undefined | null;
  projectId: ObjectID | null;
}

/*
 * What a caller deciding whether a file may be used somewhere needs to know
 * about it, without its bytes: its type, how many bytes it holds, and the
 * project it was uploaded in (null when it was uploaded with none, or before
 * files recorded it).
 */
export interface FileFacts {
  fileType: string;
  size: number;
  projectId: ObjectID | null;
}

export class Service extends DatabaseService<File> {
  public constructor() {
    super(File);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<File>,
  ): Promise<OnCreate<File>> {
    const fileType: string = (createBy.data.fileType || "")
      .trim()
      .toLowerCase();

    if (!ALLOWED_MIME_TYPES.has(fileType)) {
      throw new BadDataException(
        "This file type is not supported. Please upload a supported file type.",
      );
    }

    createBy.data.fileType = fileType as MimeType;

    /*
     * Always generate an unguessable access token server-side. The token
     * is the only safe way to address an inline-uploaded image in
     * markdown without exposing the enumerable ObjectID, so it is never
     * one the request chose. OneUptime's own code (root) may bring its own.
     */
    if (!createBy.props.isRoot || !createBy.data.imageAccessToken) {
      createBy.data.imageAccessToken = generateImageAccessToken();
    }

    /*
     * The project the file is uploaded in is the request's - the
     * dashboard's tenant, an API key's project - never whatever the body
     * says, so a file can only ever claim the project it was uploaded from.
     * A project's records use only files of their own project
     * (FileOwnership), and its private files are shown to its members
     * (FileViewerAccess), so only someone who can act in the project may
     * upload into it.
     */
    const projectId: ObjectID | null = createBy.props.tenantId || null;

    if (projectId) {
      Service.assertMayUploadToProject({
        props: createBy.props,
        projectId: projectId,
      });
    }

    (createBy.data as unknown as Dictionary<unknown>)["projectId"] = projectId;

    /*
     * Every upload starts private, whatever the request says. A file becomes
     * public only when a record that shows it to everyone is published - an
     * image in a public note, an announcement or a published postmortem
     * (InlineImageAccessTokenSync), a probe's or an AI agent's icon
     * (makeStoredIconsPublic) - never because an upload asked. OneUptime's
     * own code (root) says what it means.
     */
    if (!createBy.props.isRoot) {
      createBy.data.isPublic = false;
    }

    /*
     * Who uploads it is the signed-in user making the request, never the
     * body's say either: a profile picture may only be a file its user
     * uploaded. None for an API key or the system.
     */
    (createBy.data as unknown as Dictionary<unknown>)["createdByUserId"] =
      createBy.props.userId || null;

    return { createBy, carryForward: null };
  }

  /**
   * Refuses an upload into a project the uploader cannot act in. The
   * request was resolved for the project it names (UserMiddleware), so it
   * carries the uploader's access there exactly when they have it: a
   * membership they have accepted, signed in the way the project requires,
   * or an API key of the project (whose project is the key's own, whatever
   * header it was sent with). Server admins act in every project, and
   * OneUptime's own code (root) says what it means.
   */
  public static assertMayUploadToProject(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
  }): void {
    const props: DatabaseCommonInteractionProps = data.props;

    if (props.isRoot || props.isMasterAdmin) {
      return;
    }

    if (props.userTenantAccessPermission?.[data.projectId.toString()]) {
      return;
    }

    throw new NotAuthorizedException(UPLOAD_OUTSIDE_PROJECT_MESSAGE);
  }

  /**
   * Who each file belongs to - the project it was uploaded in and the user
   * who uploaded it - keyed by its id in lower case, read in one query and
   * never with the bytes. A file that does not exist, or an id that is not
   * one, is simply absent from the answer.
   */
  @CaptureSpan()
  public async getFileOwners(
    fileIds: Array<ObjectID>,
  ): Promise<Map<string, FileOwners>> {
    const owners: Map<string, FileOwners> = new Map();

    for (const [fileId, facts] of await this.readFileFacts({
      fileIds: fileIds,
      withVisibility: false,
    })) {
      owners.set(fileId, {
        projectId: facts.projectId,
        createdByUserId: facts.createdByUserId,
      });
    }

    return owners;
  }

  /**
   * Who may see each file - the project it was uploaded in, the user who
   * uploaded it, and whether it is public - keyed by its id in lower case,
   * read in one query and never with the bytes (RelatedFileAccess). A file
   * that does not exist, or an id that is not one, is absent from the
   * answer. Public is strictly true, as FileViewerAccess reads it.
   */
  @CaptureSpan()
  public async getFileAccess(
    fileIds: Array<ObjectID>,
  ): Promise<Map<string, FileAccessFacts>> {
    return await this.readFileFacts({ fileIds: fileIds, withVisibility: true });
  }

  /*
   * The one read behind getFileOwners and getFileAccess: each file's owners
   * (and, asked for, whether it is public) in one query, never the bytes.
   * An id that is not one is never sent to Postgres.
   */
  private async readFileFacts(data: {
    fileIds: Array<ObjectID>;
    withVisibility: boolean;
  }): Promise<Map<string, FileAccessFacts>> {
    const facts: Map<string, FileAccessFacts> = new Map();

    const ids: Array<string> = Array.from(
      new Set(
        data.fileIds
          .map((fileId: ObjectID): string => {
            return normalizeFileId(fileId);
          })
          .filter((fileId: string): boolean => {
            return ObjectID.isValidUUID(fileId);
          }),
      ),
    );

    if (ids.length === 0) {
      return facts;
    }

    let query: SelectQueryBuilder<File> = this.getRepository()
      .createQueryBuilder("file")
      .select('"file"."_id"', "_id")
      .addSelect('"file"."projectId"', "projectId")
      .addSelect('"file"."createdByUserId"', "createdByUserId");

    if (data.withVisibility) {
      query = query.addSelect('"file"."isPublic"', "isPublic");
    }

    const rows: Array<{
      _id?: unknown;
      projectId?: unknown;
      createdByUserId?: unknown;
      isPublic?: unknown;
    }> = await query
      .where('"file"."_id" IN (:...ids)', { ids: ids })
      .andWhere('"file"."deletedAt" IS NULL')
      .getRawMany();

    for (const row of rows) {
      if (typeof row._id !== "string") {
        continue;
      }

      facts.set(normalizeFileId(row._id), {
        projectId: readStoredId(row.projectId),
        createdByUserId: readStoredId(row.createdByUserId),
        isPublic: row.isPublic === true,
      });
    }

    return facts;
  }

  /**
   * Once, for files from before a file was public only while a record shows
   * it to everyone (PublishedImages): every image a published record of its
   * own project shows becomes public, and every other public file - one
   * nothing published shows, which is not a probe's or an AI agent's icon -
   * becomes private. Safe to run more than once, and at once: each statement
   * moves only rows not yet where they belong. Returns how many files moved
   * each way.
   */
  @CaptureSpan()
  public async setVisibilityFromPublishedRecords(): Promise<{
    madePublic: number;
    madePrivate: number;
  }> {
    const madePublic: number = await this.countUpdatedBy(
      PUBLISH_SHOWN_IMAGES_SQL,
    );

    const madePrivate: number = await this.countUpdatedBy(
      HIDE_UNSHOWN_FILES_SQL,
    );

    return { madePublic, madePrivate };
  }

  // Runs one UPDATE statement and returns how many rows it moved.
  private async countUpdatedBy(sql: string): Promise<number> {
    const result: unknown = await this.getRepository().manager.query(sql);

    // An UPDATE answers [rows, affected count].
    return Array.isArray(result) && typeof result[1] === "number"
      ? result[1]
      : 0;
  }

  /**
   * Once, for images a private incident or episode made public while its
   * Visible on Status Page switch was still on (a private record is never
   * shown on a status page - StatusPageVisibility): each becomes private,
   * unless a published record still shows it or it is an icon
   * (HIDE_PRIVATE_RECORD_IMAGES_SQL). Safe to run more than once, and at
   * once. Returns how many files were made private.
   */
  @CaptureSpan()
  public async hideImagesOfPrivateRecords(): Promise<number> {
    return await this.countUpdatedBy(HIDE_PRIVATE_RECORD_IMAGES_SQL);
  }

  /**
   * A file's type, size and project, measured in Postgres: a check of
   * whether a file may be used somewhere never loads its bytes (up to the
   * 10 MB an upload may be) only to count them. Null when there is no such
   * file, or the id is not one.
   */
  @CaptureSpan()
  public async getFileFacts(fileId: ObjectID): Promise<FileFacts | null> {
    if (!ObjectID.isValidUUID(fileId.toString())) {
      return null;
    }

    const row:
      | { fileType?: unknown; size?: unknown; projectId?: unknown }
      | undefined = await this.getRepository()
      .createQueryBuilder("file")
      .select('"file"."fileType"', "fileType")
      .addSelect('octet_length("file"."file")', "size")
      .addSelect('"file"."projectId"', "projectId")
      .where('"file"."_id" = :id', { id: fileId.toString() })
      .andWhere('"file"."deletedAt" IS NULL')
      .getRawOne();

    if (!row) {
      return null;
    }

    return {
      fileType: typeof row.fileType === "string" ? row.fileType : "",
      size: Number(row.size) || 0,
      projectId: readStoredId(row.projectId),
    };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<File>,
  ): Promise<OnUpdate<File>> {
    if (!updateBy.props.isRoot) {
      throw new NotAuthorizedException("Not authorized to update a file.");
    }

    return { updateBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<File>,
  ): Promise<OnDelete<File>> {
    if (!deleteBy.props.isRoot) {
      throw new NotAuthorizedException("Not authorized to delete a file.");
    }

    return { deleteBy, carryForward: null };
  }

  /*
   * Marks a record's file as anonymously readable: a probe's or an AI
   * agent's icon, which the id-based image route serves only once it is
   * public. Every upload arrives private, so attaching one is the point at
   * which it becomes public - but only a file of the record's
   * own project: a record never makes a file of another project, or one
   * uploaded with none, readable by everyone. A record outside any project
   * (a global probe or AI agent, which only server admins manage) has no
   * project to hold the file to. Best-effort: a visibility sync failure must
   * never fail the write the user actually asked for.
   */
  @CaptureSpan()
  public async makeRecordFilePublic(data: RecordFile): Promise<void> {
    await this.makeRecordFilesPublic([data]);
  }

  /*
   * makeRecordFilePublic for several records at once: the owners of their
   * files are read in one query, and each file that may become public does.
   */
  @CaptureSpan()
  public async makeRecordFilesPublic(
    records: Array<RecordFile>,
  ): Promise<void> {
    const withFiles: Array<{ fileId: ObjectID; projectId: ObjectID | null }> =
      [];

    for (const record of records) {
      if (record.fileId) {
        withFiles.push({ fileId: record.fileId, projectId: record.projectId });
      }
    }

    if (withFiles.length === 0) {
      return;
    }

    let owners: Map<string, FileOwners> = new Map();

    try {
      const ownedByProjects: Array<ObjectID> = withFiles
        .filter((record: { projectId: ObjectID | null }): boolean => {
          return Boolean(record.projectId);
        })
        .map((record: { fileId: ObjectID }): ObjectID => {
          return record.fileId;
        });

      if (ownedByProjects.length > 0) {
        owners = await this.getFileOwners(ownedByProjects);
      }
    } catch (err) {
      logger.error(`Failed to read the owners of files: ${String(err)}`);
      return;
    }

    const madePublic: Set<string> = new Set();

    for (const record of withFiles) {
      const key: string = normalizeFileId(record.fileId);

      if (
        madePublic.has(key) ||
        (record.projectId &&
          !FileOwnership.isFileOfProject(owners.get(key), record.projectId))
      ) {
        continue;
      }

      madePublic.add(key);

      try {
        await this.updateOneById({
          id: record.fileId,
          data: {
            isPublic: true,
          },
          props: {
            isRoot: true,
            ignoreHooks: true,
          },
        });
      } catch (err) {
        logger.error(
          `Failed to mark file ${record.fileId.toString()} public: ${String(err)}`,
        );
      }
    }
  }

  /*
   * After a write to records that show an icon - probes and AI agents - the
   * icon each written record holds now (read back, never taken from what
   * the write said) becomes public when it is a file of the record's own
   * project (makeRecordFilesPublic).
   */
  @CaptureSpan()
  public async makeStoredIconsPublic<TModel extends BaseModel>(data: {
    service: DatabaseService<TModel>;
    recordIds: Array<ObjectID>;
  }): Promise<void> {
    if (data.recordIds.length === 0) {
      return;
    }

    try {
      const records: Array<TModel> = await data.service.findBy({
        query: {
          _id: QueryHelper.any(data.recordIds),
        } as Query<TModel>,
        select: {
          _id: true,
          projectId: true,
          iconFileId: true,
        } as Select<TModel>,
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      await this.makeRecordFilesPublic(
        records.map((record: TModel): RecordFile => {
          return {
            fileId: record.getValue<ObjectID>("iconFileId") || null,
            projectId: record.getValue<ObjectID>("projectId") || null,
          };
        }),
      );
    } catch (err) {
      logger.error(`Failed to make stored icons public: ${String(err)}`);
    }
  }

  @CaptureSpan()
  protected override async onBeforeFind(
    findBy: FindBy<File>,
  ): Promise<OnFind<File>> {
    if (!findBy.props.isRoot) {
      findBy.query = {
        ...findBy.query,
        isPublic: true,
      };
    }

    return { findBy, carryForward: null };
  }
}
export default new Service();
