import UserMiddleware from "../../Middleware/UserAuthorization";
import FileService from "../../Services/FileService";
import Query from "../../Types/Database/Query";
import Select from "../../Types/Database/Select";
import { ExpressRequest, ExpressResponse } from "../Express";
import logger from "../Logger";
import FileOwnership, { OwnedFile, normalizeFileId } from "./FileOwnership";
import File from "../../../Models/DatabaseModels/File";
import SsoAuthorizationException from "../../../Types/Exception/SsoAuthorizationException";
import TenantNotFoundException from "../../../Types/Exception/TenantNotFoundException";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import ObjectID from "../../../Types/ObjectID";
import { UserTenantAccessPermission } from "../../../Types/Permission";

/*
 * Who may read a stored file through the image routes, which answer by the
 * file alone - an inline image's access token, a public icon's id - rather
 * than through a record that holds it (the routes that serve a record's
 * files hold them to the record's owner instead: FileOwnership).
 *
 *   - A public file: anyone. A file becomes public only when a record that
 *     shows it to everyone is published - an image in a public note, an
 *     announcement or a published postmortem, a probe's or an AI agent's
 *     icon - and private again when that record stops showing it
 *     (InlineImageAccessTokenSync, FileService.makeRecordFilesPublic). Every
 *     upload starts private (FileService).
 *   - A private file of a project: the people who can open that project,
 *     decided the way every request to the project is decided - a membership
 *     they have accepted, and the project's sign-in rules met (SSO, where
 *     the project requires it).
 *   - A private file uploaded outside any project: the person who uploaded
 *     it.
 *   - Server admins: every file, as with every other record.
 *
 * Anyone else is answered exactly as a file that does not exist is. The
 * decision is made on every request, from who is asking now, so an image's
 * address opens nothing for someone who has since left its project. A
 * file's bytes are read only once it is known the person asking may see
 * them.
 */

// The signed-in person an image request comes from.
export interface FileViewer {
  userId: ObjectID;
  isMasterAdmin: boolean;
}

// A file as the image routes read it: its owners, and whether it is public.
export interface ViewableFile extends OwnedFile {
  isPublic?: boolean | undefined;
}

// What deciding who may see a file reads of it: never its bytes.
export const FILE_VIEWERS_SELECT: Select<File> = {
  _id: true,
  isPublic: true,
  projectId: true,
  createdByUserId: true,
};

// What serving a file reads of it, once it may be served.
export const SERVED_FILE_SELECT: Select<File> = {
  _id: true,
  file: true,
  fileType: true,
  name: true,
  isPublic: true,
};

export default class FileViewerAccess {
  /*
   * isPublic is a real boolean column, but this stays deliberately strict.
   * It was created as a varchar, so every row held the STRING 'true' or
   * 'false' - and 'false' is truthy. Anything that is not exactly `true` is
   * private, so a loose value can never make a file public.
   */
  public static isPublic(
    file: { isPublic?: unknown } | null | undefined,
  ): boolean {
    return (file?.isPublic as unknown) === true;
  }

  /**
   * The file the access-token image route serves to the person asking, with
   * its bytes, or undefined - and the route answers as for a file that does
   * not exist. Who may see it is decided first, from a read of its owners
   * alone (keepReadableFile); the bytes are read only for someone who may.
   */
  public static async findReadableFile(data: {
    req: ExpressRequest;
    query: Query<File>;
  }): Promise<File | undefined> {
    const found: File | null = await FileService.findOneBy({
      query: data.query,
      select: FILE_VIEWERS_SELECT,
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    const readable: File | undefined = await this.keepReadableFile({
      req: data.req,
      file: found,
    });

    if (!readable || !readable._id) {
      return undefined;
    }

    return (
      (await FileService.findOneById({
        id: new ObjectID(readable._id.toString()),
        select: SERVED_FILE_SELECT,
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      })) || undefined
    );
  }

  /**
   * The file the id-based image route serves: a public one (a probe's or an
   * AI agent's icon), to anyone. Only a public file is read at all: an id is
   * no secret, so a private file - an inline image, an attachment - is never
   * served by it, however the request is signed in.
   */
  public static async findPublicFile(id: ObjectID): Promise<File | undefined> {
    const file: File | null = await FileService.findOneBy({
      query: {
        _id: id,
        isPublic: true,
      },
      select: SERVED_FILE_SELECT,
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    return this.keepPublicFile(file);
  }

  // A file the id-based image route may serve: a public one.
  public static keepPublicFile<T extends ViewableFile>(
    file: T | null | undefined,
  ): T | undefined {
    return file && this.isPublic(file) ? file : undefined;
  }

  /**
   * A file the access-token image route may serve to the person asking (see
   * the top of this file), or undefined. The file must have been read with
   * its isPublic, projectId and createdByUserId. When who is asking, or what
   * they may open, cannot be found out, the file is not served: the failure
   * is logged and the answer is the one a missing file gets.
   */
  public static async keepReadableFile<T extends ViewableFile>(data: {
    req: ExpressRequest;
    file: T | null | undefined;
  }): Promise<T | undefined> {
    const file: T | null | undefined = data.file;

    if (!file) {
      return undefined;
    }

    if (this.isPublic(file)) {
      return file;
    }

    try {
      const viewer: FileViewer | null = await this.getViewer(data.req);

      if (!viewer) {
        return undefined;
      }

      return (await this.mayViewPrivateFile({
        req: data.req,
        viewer: viewer,
        file: file,
      }))
        ? file
        : undefined;
    } catch (err) {
      logger.error(
        `Could not decide who may see a private file, so it is not served: ${String(err)}`,
      );

      return undefined;
    }
  }

  /**
   * The signed-in person a request comes from, read exactly as the API reads
   * a session (UserMiddleware.getSessionUser): the dashboard's access-token
   * cookie, or the mobile app's bearer token. Null for an anonymous request,
   * a token that does not verify or has expired, a blocked user, and a
   * status page visitor's own session (it signs in to one status page, not
   * to OneUptime). Throws when the lookup itself fails.
   */
  public static async getViewer(
    req: ExpressRequest,
  ): Promise<FileViewer | null> {
    const session: JSONWebTokenData | null =
      await UserMiddleware.getSessionUser(req);

    if (!session?.userId?.toString() || session.statusPageId) {
      return null;
    }

    return {
      userId: session.userId,
      isMasterAdmin: session.isMasterAdmin === true,
    };
  }

  /**
   * Whether this person may see this private file: a member of the project
   * it was uploaded in who can open the project now, the uploader of a file
   * with no project, or a server admin. Throws when what the person may
   * open cannot be looked up.
   */
  public static async mayViewPrivateFile(data: {
    req: ExpressRequest;
    viewer: FileViewer;
    file: ViewableFile;
  }): Promise<boolean> {
    if (data.viewer.isMasterAdmin) {
      return true;
    }

    const projectId: string = normalizeFileId(data.file.projectId);

    if (!projectId) {
      return FileOwnership.isFileOfUser(data.file, data.viewer.userId);
    }

    if (!ObjectID.isValidUUID(projectId)) {
      return false;
    }

    return await this.canOpenProject({
      req: data.req,
      userId: data.viewer.userId,
      projectId: new ObjectID(projectId),
    });
  }

  /*
   * Whether the person can open the project right now: what the API answers
   * for every request made to it (UserMiddleware): an accepted membership,
   * with the project's SSO requirement met. A project that requires SSO the
   * request has not signed in with, or a project that no longer exists, is a
   * no. A lookup that fails is an error, not a decision (keepReadableFile
   * turns it into a refusal).
   */
  private static async canOpenProject(data: {
    req: ExpressRequest;
    userId: ObjectID;
    projectId: ObjectID;
  }): Promise<boolean> {
    let permission: UserTenantAccessPermission | null = null;

    try {
      permission =
        await UserMiddleware.getUserTenantAccessPermissionWithTenantId({
          req: data.req,
          tenantId: data.projectId,
          userId: data.userId,
        });
    } catch (err) {
      if (
        err instanceof SsoAuthorizationException ||
        err instanceof TenantNotFoundException
      ) {
        return false;
      }

      throw err;
    }

    return Boolean(permission);
  }

  /*
   * How long a browser or a proxy may keep what an image route served: it
   * asks again before every use, since a file stops being public when the
   * record that showed it is unpublished. A private file was served to one
   * person, so nothing between them and OneUptime may keep it at all.
   */
  public static setCacheHeaders(
    res: ExpressResponse,
    file: ViewableFile,
  ): void {
    res.set(
      "Cache-Control",
      this.isPublic(file) ? "no-cache" : "private, no-cache",
    );
  }
}
