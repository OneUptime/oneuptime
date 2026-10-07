import UserMiddleware from "../../Middleware/UserAuthorization";
import FileService from "../../Services/FileService";
import Query from "../../Types/Database/Query";
import Select from "../../Types/Database/Select";
import { ExpressRequest, ExpressResponse } from "../Express";
import logger from "../Logger";
import FileOwnership, { OwnedFile } from "./FileOwnership";
import PublishedImages from "./PublishedImages";
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
 * files hold them to the record's owner instead: FileOwnership; a read of
 * a record hands back its files by the rule below: RelatedFileAccess).
 *
 *   - A public file: anyone. A file is public only while a record shows it
 *     to everyone - an image in a public note, an announcement once it is
 *     shown, a published postmortem, an incident's, an episode's or a
 *     maintenance event's description on a status page, a status page's own
 *     text (PublishedImages) - or while it is a probe's or an AI agent's
 *     icon (FileService.makeRecordFilesPublic). Every upload starts private
 *     (FileService). An image a record starts showing with no write at that
 *     moment - an announcement whose time to be shown has come - is made
 *     public by the first request for it the rules below would refuse
 *     (PublishedImages.publishWhenShown), and served as a public image.
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
  imageAccessToken: true,
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
   * not exist.
   *
   * A public file is read whole at once: anyone may see it, and status
   * pages ask for public images more than for anything else. Otherwise who
   * may see the file is decided from a read of its owners alone
   * (keepReadableFile), and its bytes are read only for someone who may -
   * still public, if being public is what let them see it. A private image
   * nobody else may see is served only once it is made public because a
   * record shows it now (PublishedImages.publishWhenShown): an announcement
   * whose time to be shown has come since it was written.
   */
  public static async findReadableFile(data: {
    req: ExpressRequest;
    query: Query<File>;
  }): Promise<File | undefined> {
    const publicFile: File | undefined = await this.readFile({
      ...data.query,
      isPublic: true,
    });

    if (publicFile) {
      return publicFile;
    }

    const owners: File | null = await FileService.findOneBy({
      query: data.query,
      select: FILE_VIEWERS_SELECT,
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    const readable: File | undefined = await this.keepReadableFile({
      req: data.req,
      file: owners,
    });

    if (readable && readable._id) {
      return await this.readFile({
        _id: readable._id.toString(),
        ...(this.isPublic(readable) ? { isPublic: true } : {}),
      });
    }

    if (
      owners &&
      owners._id &&
      (await PublishedImages.publishWhenShown(owners))
    ) {
      return await this.readFile({
        _id: owners._id.toString(),
        isPublic: true,
      });
    }

    return undefined;
  }

  /**
   * The file the id-based image route serves: a public one (a probe's or an
   * AI agent's icon, an image a published record shows), to anyone. Only a
   * public file is read at all: an id is no secret, so a private file - an
   * inline image nothing published shows, an attachment - is never served
   * by it, however the request is signed in.
   */
  public static async findPublicFile(id: ObjectID): Promise<File | undefined> {
    return await this.readFile({
      _id: id,
      isPublic: true,
    });
  }

  // One file, whole, as the image routes serve it.
  private static async readFile(query: Query<File>): Promise<File | undefined> {
    return (
      (await FileService.findOneBy({
        query: query,
        select: SERVED_FILE_SELECT,
        props: {
          isRoot: true,
          ignoreHooks: true,
        },
      })) || undefined
    );
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

    return await FileOwnership.maySeeFile({
      // Asked of a private file: being public is decided before.
      file: { ...data.file, isPublic: false },
      userId: data.viewer.userId,
      mayOpenProject: async (projectId: ObjectID): Promise<boolean> => {
        return await this.canOpenProject({
          req: data.req,
          userId: data.viewer.userId,
          projectId: projectId,
        });
      },
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
   * A private file was served to one person, so no cache between them and
   * OneUptime may keep it, and their own browser asks again before reusing
   * it. A public file's answer is cached as it always was.
   */
  public static setCacheHeaders(
    res: ExpressResponse,
    file: ViewableFile,
  ): void {
    if (!this.isPublic(file)) {
      res.set("Cache-Control", "private, no-cache");
    }
  }
}
