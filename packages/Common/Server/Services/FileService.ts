import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import FindBy from "../Types/Database/FindBy";
import { OnCreate, OnDelete, OnFind, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import DatabaseService from "./DatabaseService";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import File from "../../Models/DatabaseModels/File";
import MimeType from "../../Types/File/MimeType";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger from "../Utils/Logger";
import crypto from "crypto";

const generateImageAccessToken: () => string = (): string => {
  return crypto.randomBytes(32).toString("hex");
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

    return { createBy, carryForward: null };
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
   * Marks a file as anonymously readable. Uploads from the file picker
   * arrive private, so attaching one as an intentionally public asset
   * (probe icon, AI agent icon) is the point at which it becomes public
   * — those are served by the id-based image route, which serves only
   * public files. Best-effort: a visibility sync failure must never fail
   * the write the user actually asked for.
   */
  @CaptureSpan()
  public async makeFilePublic(
    fileId: ObjectID | undefined | null,
  ): Promise<void> {
    if (!fileId) {
      return;
    }

    try {
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
