import UserMiddleware from "../../Middleware/UserAuthorization";
import UserService from "../../Services/UserService";
import { ExpressRequest, ExpressResponse } from "../Express";
import JSONWebToken from "../JsonWebToken";
import logger from "../Logger";
import FileOwnership, { OwnedFile, normalizeFileId } from "./FileOwnership";
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
 * address opens nothing for someone who has since left its project.
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
   * The file the id-based image route may serve: a public one (a probe's or
   * an AI agent's icon), to anyone. A private file is never served by its
   * id, however the request is signed in: ids are not secrets.
   */
  public static keepPublicFile<T extends ViewableFile>(
    file: T | null | undefined,
  ): T | undefined {
    return file && this.isPublic(file) ? file : undefined;
  }

  /**
   * The file the access-token image route may serve to the person asking
   * (see the top of this file), or undefined - and the route answers as for
   * a file that does not exist. The file must have been read with its
   * isPublic, projectId and createdByUserId.
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
  }

  /**
   * The signed-in person a request comes from, read as the API reads a
   * session: the dashboard's access-token cookie, or the mobile app's bearer
   * token. Null for an anonymous request, a token that does not verify or
   * has expired, a status page visitor's own session (it signs in to one
   * status page, not to OneUptime), and a blocked user.
   */
  public static async getViewer(
    req: ExpressRequest,
  ): Promise<FileViewer | null> {
    const accessToken: string | undefined =
      UserMiddleware.getAccessTokenFromExpressRequest(req);

    if (!accessToken) {
      return null;
    }

    let decoded: JSONWebTokenData;

    try {
      decoded = JSONWebToken.decode(accessToken);
    } catch {
      // decode() has already logged why the token was refused.
      return null;
    }

    if (!decoded?.userId?.toString() || decoded.statusPageId) {
      return null;
    }

    if (await UserService.isUserBlocked(decoded.userId)) {
      return null;
    }

    return {
      userId: decoded.userId,
      isMasterAdmin: decoded.isMasterAdmin === true,
    };
  }

  /**
   * Whether this person may see this private file: a member of the project
   * it was uploaded in who can open the project now, the uploader of a file
   * with no project, or a server admin.
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
   * no. A lookup that fails is an error, not a decision.
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

      logger.error(
        `Could not decide whether a user may open project ${data.projectId.toString()}: ${String(err)}`,
      );

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
