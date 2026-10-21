import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import IncidentScopeAddedPagesNotification from "../../../Types/StatusPage/IncidentScopeAddedPagesNotification";
import StatusPageService from "../../Services/StatusPageService";
import QueryHelper from "../../Types/Database/QueryHelper";

/*
 * Which status pages a caller may pick for an incident or an incident
 * template to be limited to.
 *
 * Limiting an incident to a status page decides who is told about it, so
 * picking a page needs read access to it - the way picking an incident's
 * monitors needs monitor read access. Incident roles do not read status
 * pages, and status page access can be limited to pages with some labels, so
 * someone who may edit an incident may still be unable to see some (or all)
 * of the project's status pages. The dashboard's picker only lists the pages
 * the person can read; this is the same rule for the API, so an incident
 * member cannot reach a page they were deliberately not given through a
 * hand-written request.
 *
 * Only pages being added are checked. Pages an incident or template is
 * already limited to stay, even when the person saving cannot read them
 * (IncidentService keeps them on every edit).
 */
export default class StatusPageReadAccess {
  /*
   * Which of these status pages the caller can read, through the status page
   * permissions and labels they actually hold, lower-cased. A caller with no
   * status page read access at all can read none of them.
   */
  public static async getReadableStatusPageIds(data: {
    statusPageIds: Array<string>;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<string>> {
    const statusPageIds: Array<string> =
      IncidentScopeAddedPagesNotification.normalizeStatusPageIds(
        data.statusPageIds,
      );

    if (statusPageIds.length === 0) {
      return [];
    }

    if (data.props.isRoot) {
      return statusPageIds;
    }

    try {
      const statusPages: Array<StatusPage> = await StatusPageService.findBy({
        query: {
          _id: QueryHelper.any(statusPageIds),
        },
        select: {
          _id: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: data.props,
      });

      return IncidentScopeAddedPagesNotification.normalizeStatusPageIds(
        statusPages,
      );
    } catch (err) {
      if (err instanceof NotAuthorizedException) {
        return [];
      }

      throw err;
    }
  }

  /*
   * Refuses status pages the caller cannot read. `allowedStatusPageIds` are
   * pages the caller may pick without reading them - an incident template's
   * pages, which a project admin chose for everyone who declares from it.
   * Root (internal) callers pick any page.
   */
  public static async assertCallerCanPickStatusPages(data: {
    statusPageIds: Array<string>;
    props: DatabaseCommonInteractionProps;
    // "incident" or "incident template", for the message.
    subject: string;
    allowedStatusPageIds?: Array<string> | undefined;
  }): Promise<void> {
    if (data.props.isRoot) {
      return;
    }

    const allowed: Array<string> =
      IncidentScopeAddedPagesNotification.normalizeStatusPageIds(
        data.allowedStatusPageIds || [],
      );

    const toCheck: Array<string> =
      IncidentScopeAddedPagesNotification.normalizeStatusPageIds(
        data.statusPageIds,
      ).filter((id: string): boolean => {
        return !allowed.includes(id);
      });

    if (toCheck.length === 0) {
      return;
    }

    const readable: Array<string> = await this.getReadableStatusPageIds({
      statusPageIds: toCheck,
      props: data.props,
    });

    const unreadable: Array<string> = toCheck.filter((id: string): boolean => {
      return !readable.includes(id);
    });

    if (unreadable.length > 0) {
      throw new NotAuthorizedException(this.getRefusalMessage(data.subject));
    }
  }

  public static getRefusalMessage(subject: string): string {
    return `You do not have access to some of the status pages you picked, so this ${subject} cannot be limited to them. Picking status pages needs a role that can read them, such as Status Page Viewer (it can be limited to pages with certain labels).`;
  }
}
