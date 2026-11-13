import UserMiddleware from "../../Middleware/UserAuthorization";
import ProjectService from "../../Services/ProjectService";
import StatusPageService from "../../Services/StatusPageService";
import { ExpressRequest } from "../Express";
import logger from "../Logger";
import ProjectMembership from "../TeamMember/ProjectMembership";
import JSONWebTokenData from "../../../Types/JsonWebTokenData";
import ObjectID from "../../../Types/ObjectID";

/*
 * A SAMPLE PROJECT'S STATUS PAGE IS NEVER PUBLIC (issue #6808).
 *
 * The sample's status page shows its made-up monitors and its open
 * incident, so a person can see what their customers would. It is made
 * private and kept out of search results, and nobody outside the sample can
 * open it whatever its own switches say - a member who turns "public" on, a
 * custom domain (which a sample is refused anyway), a private user or a
 * master password. The one way in is the Dashboard's own link: a request
 * that carries the session of someone signed in to OneUptime who is a member
 * of the sample.
 *
 * Asked by the gate in front of every public status page route
 * (BlockedProjectStatusPages), which answers anyone else as it answers a
 * page that does not exist, and by the read check every page read goes
 * through (StatusPageService.hasReadAccess), which lets the member read a
 * page that is not public without a status page sign-in.
 *
 * IT FAILS OPEN, TO A PRIVATE PAGE
 *
 * A lookup that fails lets the request through to the page's own rules,
 * which keep a private page - as the sample's is made - behind its sign-in.
 */
export default class SampleProjectStatusPages {
  /*
   * The sample project this status page belongs to, or null when it
   * belongs to an ordinary project, does not exist, or cannot be told.
   */
  public static async getSampleProjectOfStatusPage(
    statusPageId: ObjectID,
  ): Promise<ObjectID | null> {
    try {
      const projectId: ObjectID | null =
        await StatusPageService.getProjectIdOfStatusPage(statusPageId);

      if (!projectId) {
        return null;
      }

      return (await ProjectService.isSampleProject(projectId))
        ? projectId
        : null;
    } catch (err) {
      logger.error(
        `Could not tell whether status page ${statusPageId.toString()} belongs to a sample project; the page's own rules decide who reads it.`,
      );
      logger.error(err);
      return null;
    }
  }

  /*
   * Whether this request comes from someone signed in to OneUptime who is a
   * member of the project. False with no session, for a session that does
   * not verify, for a blocked person, and when it cannot be told.
   */
  public static async isMemberRequest(data: {
    req: ExpressRequest;
    projectId: ObjectID;
  }): Promise<boolean> {
    try {
      const session: JSONWebTokenData | null =
        await UserMiddleware.getSessionUser(data.req);

      if (!session?.userId) {
        return false;
      }

      return await ProjectMembership.isMember({
        projectId: data.projectId,
        userId: session.userId,
      });
    } catch (err) {
      logger.error(
        `Could not tell whether a request for a status page of sample project ${data.projectId.toString()} comes from a member; it is not let in.`,
      );
      logger.error(err);
      return false;
    }
  }

  /*
   * Who may read this page, when it is a sample's: true for a member of the
   * sample, false for anyone else. Null when the page is not a sample's, and
   * its own rules decide.
   */
  public static async getReadAccess(data: {
    req: ExpressRequest;
    statusPageId: ObjectID;
  }): Promise<boolean | null> {
    const sampleProjectId: ObjectID | null =
      await SampleProjectStatusPages.getSampleProjectOfStatusPage(
        data.statusPageId,
      );

    if (!sampleProjectId) {
      return null;
    }

    return await SampleProjectStatusPages.isMemberRequest({
      req: data.req,
      projectId: sampleProjectId,
    });
  }
}
