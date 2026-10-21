import ProjectService from "../../Services/ProjectService";
import StatusPageService from "../../Services/StatusPageService";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Express";
import logger from "../Logger";
import applyPublicPageNotFound from "../PublicPageNotFound";
import Response from "../Response";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import ObjectID from "../../../Types/ObjectID";
import { STATUS_PAGE_NOT_FOUND_MESSAGE } from "../../../Types/StatusPage/StatusPageArchive";

/*
 * THE STATUS PAGES OF A BLOCKED PROJECT ARE TAKEN DOWN.
 *
 * A master admin blocks a project (Project.isBlocked, Admin Dashboard >
 * Projects) to take it offline - most often for abuse: spam sites have used
 * status pages to put pages for pirated films into search results under
 * OneUptime's domain. Every public request for one of its status pages is
 * then answered the way a page that does not exist is answered: 404 "Status
 * Page not found", kept out of search results (PublicPageNotFound). Nothing
 * tells it apart from a page that was never made, and unblocking the project
 * brings every page back as it was.
 *
 * ONE GATE, NOT ONE CHECK PER ROUTE
 *
 * guard() puts it in front of the whole status page API: Express runs it for
 * every route whose path names the page - :statusPageId or
 * :statusPageIdOrDomain (STATUS_PAGE_ROUTE_PARAMS) - before any of the
 * route's own middleware. That is every public route of the API: what the
 * status page app loads, its badge, images and attachments, its subscribe and
 * master password prompts, and what the public MCP tools ask for; a route
 * added later is covered by naming the page the way they do. The /seo route
 * is one of them, and the two servers
 * that render a status page - its shell, its RSS feed and its llms.txt -
 * answer what /seo answers (getStatusPageData). /domain carries the page in
 * its body instead, and asks isStatusPageOfBlockedProject itself.
 *
 * IT READS NOTHING PER REQUEST
 *
 * A status page view is a burst of requests, and a page under a crawl is
 * many bursts. A custom domain is resolved through the cache every public
 * route shares (StatusPageService.resolveStatusPageIdOrNull), the page's
 * project - which never changes - is kept per process for an hour
 * (StatusPageService.getProjectIdOfStatusPage), and whether that project is
 * blocked is kept per process for a minute (ProjectService.isProjectBlocked):
 * a block takes the pages down at once on the server that wrote it, and
 * within BLOCKED_PROJECT_CACHE_TTL_MS everywhere else.
 *
 * IT FAILS OPEN
 *
 * A lookup that fails lets the request through, and the route answers as it
 * always has: a fault in a check that is there for abuse must not take every
 * status page down with it.
 *
 * THE PAGES SEND NOTHING
 *
 * Every subscriber notification - incidents, episodes, notes, postmortems,
 * scheduled maintenance, announcements, reports, and the confirmations a
 * subscription sends - finds its status pages in one place
 * (StatusPageSubscriberService.getStatusPagesToSendNotification), which
 * leaves the pages of a blocked project out (leaveOutStatusPagesOfBlockedProjects),
 * as it leaves archived pages out: the unsubscribe link every message
 * carries would lead to a page this gate takes down. It asks the same
 * per-process answers, once per project, so a notification adds no query;
 * and it fails open too - a notification goes out as usual when the answer
 * cannot be had. The dashboard says why a page sends nothing
 * (Types/StatusPage/StatusPageProjectBlock).
 */

// The route parameters that name a status page, by id or by custom domain.
export const STATUS_PAGE_ROUTE_PARAMS: ReadonlyArray<string> = [
  "statusPageId",
  "statusPageIdOrDomain",
];

export default class BlockedProjectStatusPages {
  // Puts the gate in front of every route of `router` that names a page.
  public static guard(router: ExpressRouter): void {
    for (const paramName of STATUS_PAGE_ROUTE_PARAMS) {
      router.param(
        paramName,
        (
          req: ExpressRequest,
          res: ExpressResponse,
          next: NextFunction,
          statusPageIdOrDomain: unknown,
        ): void => {
          void BlockedProjectStatusPages.letThroughUnlessBlocked({
            req,
            res,
            next,
            statusPageIdOrDomain: statusPageIdOrDomain,
          });
        },
      );
    }
  }

  /*
   * Whether a master admin blocked the project this status page belongs to.
   * False for a page that does not exist, and - failing open - when it
   * cannot be told.
   */
  public static async isStatusPageOfBlockedProject(
    statusPageId: ObjectID,
  ): Promise<boolean> {
    try {
      const projectId: ObjectID | null =
        await StatusPageService.getProjectIdOfStatusPage(statusPageId);

      if (!projectId) {
        return false;
      }

      return await ProjectService.isProjectBlocked(projectId);
    } catch (err) {
      logger.error(
        `Could not tell whether the project of status page ${statusPageId.toString()} is blocked; the page is served as usual.`,
      );
      logger.error(err);
      return false;
    }
  }

  /*
   * Whether a master admin blocked this project, for the subscriber jobs to
   * say why they send nothing. False without a project, and - failing open -
   * when it cannot be told.
   */
  public static async isProjectBlocked(
    projectId: ObjectID | null | undefined,
  ): Promise<boolean> {
    if (!projectId) {
      return false;
    }

    try {
      return await ProjectService.isProjectBlocked(projectId);
    } catch (err) {
      logger.error(
        `Could not tell whether project ${projectId.toString()} is blocked; its status pages send to their subscribers as usual.`,
      );
      logger.error(err);
      return false;
    }
  }

  /*
   * The pages of `statusPages` whose project is not blocked: the ones that
   * may send to their subscribers. Each project is asked once, by the page's
   * projectId; a page read without one is asked by its id
   * (isStatusPageOfBlockedProject). A page whose project cannot be told is
   * kept. The order of the pages is kept.
   */
  public static async leaveOutStatusPagesOfBlockedProjects(
    statusPages: Array<StatusPage>,
  ): Promise<Array<StatusPage>> {
    const isBlockedByProject: Map<string, Promise<boolean>> = new Map();

    const isBlocked: Array<boolean> = await Promise.all(
      statusPages.map((statusPage: StatusPage): Promise<boolean> => {
        const projectId: ObjectID | undefined = statusPage.projectId;

        if (!projectId) {
          return statusPage.id
            ? BlockedProjectStatusPages.isStatusPageOfBlockedProject(
                statusPage.id,
              )
            : Promise.resolve(false);
        }

        const key: string = projectId.toString().toLowerCase();
        let answer: Promise<boolean> | undefined = isBlockedByProject.get(key);

        if (!answer) {
          answer = BlockedProjectStatusPages.isProjectBlocked(projectId);
          isBlockedByProject.set(key, answer);
        }

        return answer;
      }),
    );

    return statusPages.filter(
      (_statusPage: StatusPage, index: number): boolean => {
        return !isBlocked[index];
      },
    );
  }

  private static async letThroughUnlessBlocked(data: {
    req: ExpressRequest;
    res: ExpressResponse;
    next: NextFunction;
    statusPageIdOrDomain: unknown;
  }): Promise<void> {
    let statusPageId: ObjectID | null = null;

    try {
      statusPageId = await BlockedProjectStatusPages.resolveStatusPageId(
        data.statusPageIdOrDomain,
      );
    } catch (err) {
      logger.error(
        "Could not resolve the status page a request names; it goes through to its route.",
      );
      logger.error(err);
    }

    if (
      !statusPageId ||
      !(await BlockedProjectStatusPages.isStatusPageOfBlockedProject(
        statusPageId,
      ))
    ) {
      data.next();
      return;
    }

    applyPublicPageNotFound(data.res);

    Response.sendErrorResponse(
      data.req,
      data.res,
      new NotFoundException(STATUS_PAGE_NOT_FOUND_MESSAGE),
    );
  }

  /*
   * The page a route parameter names, or null when it names none: then the
   * route answers it as it always has. Resolved the way the routes resolve
   * it - a value with a dot is a custom domain - so the gate and the route
   * never disagree about which page a request is for.
   */
  private static async resolveStatusPageId(
    value: unknown,
  ): Promise<ObjectID | null> {
    if (typeof value !== "string" || !value) {
      return null;
    }

    if (value.includes(".")) {
      return await StatusPageService.resolveStatusPageIdOrNull(value);
    }

    // Checked here, so a value that is neither is not logged as an error twice.
    if (!ObjectID.isValidUUID(value)) {
      return null;
    }

    return new ObjectID(value);
  }
}
