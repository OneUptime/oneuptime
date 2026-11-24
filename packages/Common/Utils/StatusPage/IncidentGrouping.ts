import { JSONObject } from "../../Types/JSON";

/*
 * HOW A STATUS PAGE LISTS ITS INCIDENTS AND EPISODES (issue #10767).
 *
 * Three of the page's switches decide it (StatusPage): Show Incidents
 * (showIncidentsOnStatusPage), Show Episodes (showEpisodesOnStatusPage) and,
 * while both are on, Show Incidents Grouped by Episode (groupIncidentsByEpisode).
 * Between them the page is in one of five modes:
 *
 *   None              neither list: no incidents anywhere on the page.
 *   IncidentsOnly     a card for each incident.
 *   EpisodesOnly      a card for each episode. The page names no incident
 *                     on its own, so the uptime history's day details list
 *                     the episode an incident of that day belongs to.
 *   Separate          a card for each incident and one for each episode, so
 *                     an incident in an episode is listed twice: what every
 *                     page did before the grouping switch existed, and what
 *                     a page made before it keeps.
 *   GroupedByEpisode  an episode is one card that lists its incidents and
 *                     the resources they affect, and those incidents get no
 *                     card of their own; an incident in no episode the page
 *                     shows keeps its card. What a new page does.
 *
 * GROUPED, A PAGE SHOWS NOTHING IT DID NOT SHOW BEFORE. An episode card lists
 * only the incidents of it that the page shows on their own - visible on
 * status pages, not private, in scope for the page and on one of its
 * monitors (the server works them out: StatusPageEpisodeIncidents) - and an
 * episode none of whose incidents the page shows is not listed at all, as
 * it would list nothing. An incident whose episode the page does not show
 * (hidden, private, or out of its history) keeps a card of its own: it is
 * never folded into a card that is not there.
 *
 * Everything that draws or reads the list asks here: the page's Incidents
 * tab and overview, its RSS feed (StatusPageRssFeed), and the public API's
 * answers name the mode (INCIDENT_LIST_MODE_RESPONSE_KEY) so a reader of them
 * can lay the list out as the page does. The answers still hold every
 * incident the page shows, so a reader that ignores episodes misses none.
 */

export enum StatusPageIncidentListMode {
  None = "None",
  IncidentsOnly = "IncidentsOnly",
  EpisodesOnly = "EpisodesOnly",
  Separate = "Separate",
  GroupedByEpisode = "GroupedByEpisode",
}

// The column of the switch, as the API and the Dashboard name it.
export const GROUP_INCIDENTS_BY_EPISODE_COLUMN: string =
  "groupIncidentsByEpisode";

/*
 * The key the overview's, the incident list's and the episode list's
 * answers name the page's mode by.
 */
export const INCIDENT_LIST_MODE_RESPONSE_KEY: string = "incidentListMode";

/*
 * The key an episode lists its incidents under in those answers, while the
 * page shows both incidents and episodes (linksIncidentsAndEpisodes): the
 * incidents of it the page shows, newest first.
 */
export const EPISODE_INCIDENTS_KEY: string = "incidents";

/*
 * The key an incident's own answer (the incident read by its id) names the
 * episodes it is part of under, while the page shows both incidents and
 * episodes: each episode the page shows that holds it, by its _id and title.
 * Grouped, such an incident has no card of its own, so its page says where
 * it is listed.
 */
export const PART_OF_EPISODES_RESPONSE_KEY: string = "partOfEpisodes";

// What decides the mode: the page's three switches, as read or as stored.
export interface StatusPageIncidentListSwitches {
  showIncidentsOnStatusPage?: unknown;
  showEpisodesOnStatusPage?: unknown;
  groupIncidentsByEpisode?: unknown;
}

// The cards a list draws, in the order it was handed them.
export interface StatusPageIncidentListCards<TIncident, TEpisode> {
  // The incidents drawn on cards of their own.
  incidents: Array<TIncident>;
  // The episodes drawn as cards.
  episodes: Array<TEpisode>;
}

const MODES: ReadonlyArray<string> = Object.values(StatusPageIncidentListMode);

// A switch is on only when it says true: an odd or missing value is off.
const isOn: (value: unknown) => boolean = (value: unknown): boolean => {
  return value === true;
};

export default class StatusPageIncidentGrouping {
  /*
   * The page's mode, from its switches. A switch the reader did not get
   * counts as off, so an answer from a server that predates the grouping
   * switch lists both kinds as it always did (Separate).
   */
  public static getMode(
    switches: StatusPageIncidentListSwitches | null | undefined,
  ): StatusPageIncidentListMode {
    const showsIncidents: boolean = isOn(switches?.showIncidentsOnStatusPage);
    const showsEpisodes: boolean = isOn(switches?.showEpisodesOnStatusPage);

    if (showsIncidents && showsEpisodes) {
      return isOn(switches?.groupIncidentsByEpisode)
        ? StatusPageIncidentListMode.GroupedByEpisode
        : StatusPageIncidentListMode.Separate;
    }

    if (showsIncidents) {
      return StatusPageIncidentListMode.IncidentsOnly;
    }

    if (showsEpisodes) {
      return StatusPageIncidentListMode.EpisodesOnly;
    }

    return StatusPageIncidentListMode.None;
  }

  /*
   * A mode as an answer names it (INCIDENT_LIST_MODE_RESPONSE_KEY), or
   * `fallback` when it names none this code knows: an older server's answer
   * has no such key.
   */
  public static readMode(
    value: unknown,
    fallback: StatusPageIncidentListMode,
  ): StatusPageIncidentListMode {
    if (typeof value === "string" && MODES.includes(value)) {
      return value as StatusPageIncidentListMode;
    }

    return fallback;
  }

  // Whether the page draws incidents, on cards of their own or in episodes.
  public static showsIncidents(mode: StatusPageIncidentListMode): boolean {
    return (
      mode === StatusPageIncidentListMode.IncidentsOnly ||
      mode === StatusPageIncidentListMode.Separate ||
      mode === StatusPageIncidentListMode.GroupedByEpisode
    );
  }

  // Whether the page draws episodes.
  public static showsEpisodes(mode: StatusPageIncidentListMode): boolean {
    return (
      mode === StatusPageIncidentListMode.EpisodesOnly ||
      mode === StatusPageIncidentListMode.Separate ||
      mode === StatusPageIncidentListMode.GroupedByEpisode
    );
  }

  public static isGroupedByEpisode(mode: StatusPageIncidentListMode): boolean {
    return mode === StatusPageIncidentListMode.GroupedByEpisode;
  }

  /*
   * Whether an episode's page lists its incidents and an incident's page
   * names its episodes: while the page shows both, grouped or not (#9181).
   * Either way the page already shows every incident it would list, each on
   * a card of its own or in its episode's; a page that shows episodes only
   * names no incident, and one that shows incidents only names no episode.
   */
  public static linksIncidentsAndEpisodes(
    mode: StatusPageIncidentListMode,
  ): boolean {
    return this.showsIncidents(mode) && this.showsEpisodes(mode);
  }

  /*
   * The cards a list draws in the page's mode, from the incidents and the
   * episodes the page shows. Grouped, an episode is drawn only when it holds
   * an incident (getEpisodeIncidentIds: the incidents of it the page shows),
   * and an incident one of the drawn episodes holds is drawn there instead
   * of on a card of its own. Each list keeps the order it came in.
   */
  public static getCards<TIncident, TEpisode>(data: {
    mode: StatusPageIncidentListMode;
    incidents: ReadonlyArray<TIncident>;
    episodes: ReadonlyArray<TEpisode>;
    getIncidentId: (incident: TIncident) => string | null | undefined;
    getEpisodeIncidentIds: (episode: TEpisode) => ReadonlyArray<string>;
  }): StatusPageIncidentListCards<TIncident, TEpisode> {
    const incidents: Array<TIncident> = this.showsIncidents(data.mode)
      ? [...data.incidents]
      : [];

    const episodes: Array<TEpisode> = this.showsEpisodes(data.mode)
      ? [...data.episodes]
      : [];

    if (!this.isGroupedByEpisode(data.mode)) {
      return { incidents: incidents, episodes: episodes };
    }

    const groupedIncidentIds: Set<string> = new Set<string>();

    const episodesWithIncidents: Array<TEpisode> = episodes.filter(
      (episode: TEpisode): boolean => {
        const incidentIds: Array<string> = this.normalizeIds(
          data.getEpisodeIncidentIds(episode),
        );

        for (const incidentId of incidentIds) {
          groupedIncidentIds.add(incidentId);
        }

        return incidentIds.length > 0;
      },
    );

    return {
      incidents: incidents.filter((incident: TIncident): boolean => {
        const incidentId: string | undefined = this.normalizeId(
          data.getIncidentId(incident),
        );

        return !incidentId || !groupedIncidentIds.has(incidentId);
      }),
      episodes: episodesWithIncidents,
    };
  }

  /*
   * The ids of the incidents an episode lists, as an answer sends the
   * episode: its EPISODE_INCIDENTS_KEY, each incident with its _id.
   */
  public static getEpisodeIncidentIdsFromJson(
    episode: JSONObject | null | undefined,
  ): Array<string> {
    return this.getEpisodeIncidentsFromJson(episode)
      .map((incident: JSONObject): string | undefined => {
        return this.normalizeId(incident["_id"]);
      })
      .filter((id: string | undefined): id is string => {
        return Boolean(id);
      });
  }

  // The incidents an episode lists, as an answer sends them.
  public static getEpisodeIncidentsFromJson(
    episode: JSONObject | null | undefined,
  ): Array<JSONObject> {
    const incidents: unknown = episode?.[EPISODE_INCIDENTS_KEY];

    if (!Array.isArray(incidents)) {
      return [];
    }

    return incidents.filter((incident: unknown): incident is JSONObject => {
      return (
        Boolean(incident) &&
        typeof incident === "object" &&
        !Array.isArray(incident)
      );
    });
  }

  private static normalizeIds(ids: ReadonlyArray<unknown>): Array<string> {
    const normalized: Array<string> = [];

    for (const id of ids) {
      const value: string | undefined = this.normalizeId(id);

      if (value && !normalized.includes(value)) {
        normalized.push(value);
      }
    }

    return normalized;
  }

  // An id in any shape it arrives in, lower-cased as the database returns it.
  private static normalizeId(value: unknown): string | undefined {
    if (value === undefined || value === null) {
      return undefined;
    }

    const id: string = String(value).trim().toLowerCase();

    return id || undefined;
  }
}
