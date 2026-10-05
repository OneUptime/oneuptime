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
import QueryHelper from "../Types/Database/QueryHelper";
import Query from "../Types/Database/Query";
import Select from "../Types/Database/Select";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import crypto from "crypto";

const generateImageAccessToken: () => string = (): string => {
  return crypto.randomBytes(32).toString("hex");
};

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

/*
 * What a caller deciding whether a file may be used somewhere needs to know
 * about it, without its bytes: its type, how many bytes it holds, and the
 * project it was uploaded in (null when it was uploaded with none, or before
 * files recorded it).
 */
// A record's file, and the record's stored project (null for none).
export interface RecordFile {
  fileId: ObjectID | undefined | null;
  projectId: ObjectID | null;
}

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
     * markdown without exposing the enumerable ObjectID.
     */
    if (!createBy.data.imageAccessToken) {
      createBy.data.imageAccessToken = generateImageAccessToken();
    }

    /*
     * The project the file is uploaded in is the request's - the
     * dashboard's tenant, an API key's project - never whatever the body
     * says, so a file can only ever claim the project it was uploaded from.
     * A project's records use only files of their own project
     * (FileOwnership).
     */
    (createBy.data as unknown as Dictionary<unknown>)["projectId"] =
      createBy.props.tenantId || null;

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

    const ids: Array<string> = Array.from(
      new Set(
        fileIds
          .map((fileId: ObjectID): string => {
            return normalizeFileId(fileId);
          })
          .filter((fileId: string): boolean => {
            return ObjectID.isValidUUID(fileId);
          }),
      ),
    );

    if (ids.length === 0) {
      return owners;
    }

    const rows: Array<{
      _id?: unknown;
      projectId?: unknown;
      createdByUserId?: unknown;
    }> = await this.getRepository()
      .createQueryBuilder("file")
      .select('"file"."_id"', "_id")
      .addSelect('"file"."projectId"', "projectId")
      .addSelect('"file"."createdByUserId"', "createdByUserId")
      .where('"file"."_id" IN (:...ids)', { ids: ids })
      .andWhere('"file"."deletedAt" IS NULL')
      .getRawMany();

    for (const row of rows) {
      if (typeof row._id !== "string") {
        continue;
      }

      owners.set(normalizeFileId(row._id), {
        projectId: readStoredId(row.projectId),
        createdByUserId: readStoredId(row.createdByUserId),
      });
    }

    return owners;
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
   * public. Uploads from the file picker arrive private, so attaching one is
   * the point at which it becomes public - but only a file of the record's
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
