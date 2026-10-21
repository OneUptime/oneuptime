import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import StatusPageAnnouncement from "../../../Models/DatabaseModels/StatusPageAnnouncement";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import StatusPageVisibility, {
  VISIBLE_ON_STATUS_PAGE_COLUMN,
} from "../../../Types/StatusPage/StatusPageVisibility";
import Query from "../../Types/Database/Query";
import QueryHelper from "../../Types/Database/QueryHelper";
import { applyIncidentSelfPrivacyFilter } from "../Incident/IncidentPrivacyFilter";
import { applyIncidentEpisodeSelfPrivacyFilter } from "../IncidentEpisode/IncidentEpisodePrivacyFilter";

/*
 * StatusPageVisibility's rule in SQL, for the queries that decide what a
 * status page shows: an incident or an episode is shown only when Visible on
 * Status Page is on and it is not private; a scheduled maintenance event
 * only when Visible on Status Page is on; an announcement only once the time
 * it is shown from has come.
 *
 * "Not private" is what anyone outside the project may see: the privacy
 * filters' anonymous form (IncidentPrivacyFilter, IncidentEpisodePrivacyFilter,
 * as public dashboards read incidents), `isPrivate IS NULL OR isPrivate =
 * FALSE`. Status pages read as root, so the services' own privacy filters let
 * every row through; these add it to the query itself, so a private record is
 * left out before a list is cut to its limit, never after. A condition the
 * query already holds on isPrivate is kept, and both apply.
 *
 * Every status page read of these records goes through one of these, a read
 * by id as much as a list (StatusPageVisibilityOneRule holds StatusPageAPI to
 * it): a record a page does not list is not one it shows by its id either.
 *
 * Each returns a new query: the one passed in is not changed.
 */

// The props the privacy filters read as "someone outside the project".
const PUBLIC_VIEWER: DatabaseCommonInteractionProps = {};

/*
 * Visible on Status Page as a write that turns it on stores it: on only
 * while the record is not private - Private as the database holds it when
 * the write reaches the row, under the row's lock, never as read before. A
 * Private never set (null) is not private.
 */
export const VISIBLE_UNLESS_PRIVATE_SQL: string = `("isPrivate" IS NOT TRUE)`;

export default class StatusPageVisibilityQuery {
  // Incidents a status page shows: Visible on Status Page on, and not private.
  public static shownIncidents(query: Query<Incident>): Query<Incident> {
    return this.notPrivateIncidents({
      ...query,
      isVisibleOnStatusPage: true,
    });
  }

  /*
   * Incidents that are not private, whatever their Visible on Status Page
   * says: what links an episode to a status page. The episode's own switches
   * decide whether it is shown (shownEpisodes); a private incident never
   * links it.
   */
  public static notPrivateIncidents(query: Query<Incident>): Query<Incident> {
    return applyIncidentSelfPrivacyFilter<Query<Incident>>(
      { ...query },
      PUBLIC_VIEWER,
    );
  }

  // Episodes a status page shows: Visible on Status Page on, and not private.
  public static shownEpisodes(
    query: Query<IncidentEpisode>,
  ): Query<IncidentEpisode> {
    return applyIncidentEpisodeSelfPrivacyFilter<Query<IncidentEpisode>>(
      {
        ...query,
        isVisibleOnStatusPage: true,
      },
      PUBLIC_VIEWER,
    );
  }

  /*
   * Scheduled maintenance events a status page shows: Visible on Status Page
   * on. An event has no Private switch.
   */
  public static shownScheduledMaintenance(
    query: Query<ScheduledMaintenance>,
  ): Query<ScheduledMaintenance> {
    return {
      ...query,
      isVisibleOnStatusPage: true,
    };
  }

  /*
   * Announcements a status page shows: those shown from a time that has
   * come (showAnnouncementAt) - from `since` on, when the page shows them
   * only for so long; any time up to now otherwise (one read by its id). An
   * announcement scheduled for later is shown nowhere yet.
   */
  public static shownAnnouncements(
    query: Query<StatusPageAnnouncement>,
    window: { now: Date; since?: Date | undefined },
  ): Query<StatusPageAnnouncement> {
    return {
      ...query,
      showAnnouncementAt: window.since
        ? QueryHelper.inBetween(window.since, window.now)
        : QueryHelper.lessThanEqualTo(window.now),
    };
  }

  /*
   * What an update of incidents or episodes writes in SQL
   * (DatabaseService.getRowWriteSql), to keep the rule on every row it
   * writes: a write that turns Visible on Status Page on and leaves Private
   * as stored (StatusPageVisibility.needsStoredPrivacy) stores it on only
   * while the record is not private, decided by the database in the row's
   * own write (VISIBLE_UNLESS_PRIVATE_SQL) - so a record made private by a
   * write landing at the same moment is never stored both private and
   * visible. Any other write needs nothing: one that writes Private decides
   * both switches itself (StatusPageVisibility.normalizeWrite).
   */
  public static getRowWriteSql(
    written: Record<string, unknown> | undefined | null,
  ): Dictionary<string> {
    if (!StatusPageVisibility.needsStoredPrivacy(written)) {
      return {};
    }

    return { [VISIBLE_ON_STATUS_PAGE_COLUMN]: VISIBLE_UNLESS_PRIVATE_SQL };
  }
}
