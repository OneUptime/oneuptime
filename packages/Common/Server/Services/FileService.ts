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
import FileOwnership, { FileOwners } from "../Utils/File/FileOwnership";
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
            return fileId.toString().trim().toLowerCase();
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

      owners.set(row._id.toLowerCase(), {
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
  public async makeRecordFilePublic(data: {
    fileId: ObjectID | undefined | null;
    // The stored project of the record the file is attached to; null for none.
    projectId: ObjectID | null;
  }): Promise<void> {
    const fileId: ObjectID | undefined | null = data.fileId;

    if (!fileId) {
      return;
    }

    try {
      if (data.projectId) {
        const owners: Map<string, FileOwners> = await this.getFileOwners([
          fileId,
        ]);

        if (
          !FileOwnership.isFileOfProject(
            owners.get(fileId.toString().trim().toLowerCase()),
            data.projectId,
          )
        ) {
          return;
        }
      }

      await this.updateOneById({
        id: fileId,
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
        `Failed to mark file ${fileId.toString()} public: ${String(err)}`,
      );
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
