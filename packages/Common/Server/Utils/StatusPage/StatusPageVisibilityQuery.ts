import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Query from "../../Types/Database/Query";
import { applyIncidentSelfPrivacyFilter } from "../Incident/IncidentPrivacyFilter";
import { applyIncidentEpisodeSelfPrivacyFilter } from "../IncidentEpisode/IncidentEpisodePrivacyFilter";

/*
 * StatusPageVisibility's rule in SQL, for the queries that decide what a
 * status page shows: an incident or an episode is shown only when Visible on
 * Status Page is on and it is not private.
 *
 * "Not private" is what anyone outside the project may see: the privacy
 * filters' anonymous form (IncidentPrivacyFilter, IncidentEpisodePrivacyFilter,
 * as public dashboards read incidents), `isPrivate IS NULL OR isPrivate =
 * FALSE`. Status pages read as root, so the services' own privacy filters let
 * every row through; these add it to the query itself, so a private record is
 * left out before a list is cut to its limit, never after. A condition the
 * query already holds on isPrivate is kept, and both apply.
 *
 * Each returns a new query: the one passed in is not changed.
 */

// The props the privacy filters read as "someone outside the project".
const PUBLIC_VIEWER: DatabaseCommonInteractionProps = {};

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
}
